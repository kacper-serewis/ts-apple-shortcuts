import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { compile } from "../src/compiler.js";
import { evaluate } from "./support/evaluate.js";

const source = (body: string, helpers = "") => `import { showResult } from "@js-shortcuts/ios"; ${helpers}
export default async function main() { ${body} }`;

test("trimming uses ECMAScript whitespace, retains internal whitespace and composes all three variants", () => {
  for (const text of ["", " \t\r\n", "\uFEFF\u00A0 x \u2028\u2029", "\u0085x\u0085", "\u200Bx\u200B", "a\nb", "\u1680\u2000x\u205F\u3000"]) {
    assert.deepEqual(evaluate(source(`const text = ${JSON.stringify(text)}; await showResult(text.trim()); await showResult(text.trimStart()); await showResult(text.trimEnd());`)), [text.trim(), text.trimStart(), text.trimEnd()]);
  }
  const actions = compile(source('await showResult(" x ".trim());')).workflow.WFWorkflowActions;
  const trim = actions.find(a => a.WFWorkflowActionIdentifier.endsWith('.text.replace'))!.WFWorkflowActionParameters;
  const pattern = String(trim.WFReplaceTextFind).replace('\\A', '^').replace('\\z', '$');
  for (let i = 1; i <= 0xFFFF; i++) {
    const c = String.fromCharCode(i), input = c + 'x' + c;
    assert.equal(('JS:' + input).replace(new RegExp(pattern, 'u'), '$1'), input.trim(), `U+${i.toString(16)}`);
  }
});

test("case conversion and variadic concat preserve receiver/argument order and values", () => {
  const text = 'straße İ ΟΣ é 😀';
  assert.deepEqual(evaluate(source(`const text = ${JSON.stringify(text)}; await showResult(text.toUpperCase()); await showResult(text.toLowerCase()); await showResult("".concat("a", "", "😀")); await showResult(text.concat());`)), [text.toUpperCase(), text.toLowerCase(), 'a😀', text]);
  assert.deepEqual(evaluate(source('await showResult((await part("receiver")).concat(await part("first"), await part("second")));', 'async function part(x: string): Promise<string> { await showResult(x); return x; }')), ['receiver', 'first', 'second', 'receiverfirstsecond']);
});

test("search methods require literal text semantics for regex characters, empty text and Unicode", () => {
  for (const [text, needle] of [['', ''], ['', 'a'], ['abc', ''], ['abc', 'a'], ['abc', 'b'], ['abc', 'c'], ['abc', 'abcd'], ['Abc', 'a'], ['a\nb', '\n'], ['a.*+?^${}()|[]\\z', '.*+?^${}()|[]\\'], ['😀é', '😀'], ['é', 'e\u0301'], ['TS_MATCH', 'missing']]) {
    assert.deepEqual(evaluate(source(`const value = ${JSON.stringify(text)}, needle = ${JSON.stringify(needle)};
      await showResult(value.startsWith(needle) ? "Y" : "N"); await showResult(value.endsWith(needle) ? "Y" : "N"); await showResult(value.includes(needle) ? "Y" : "N");`)), [text.startsWith(needle), text.endsWith(needle), text.includes(needle)].map(v => v ? 'Y' : 'N'));
  }
});

test("receiver snapshot precedes argument mutation and search can be used as a boolean", () => {
  assert.deepEqual(evaluate(source(`let value = "before";
    const found = value.startsWith([0].reduce((acc, n) => { value = "after"; return "before"; }, ""));
    await showResult(found && value === "after" ? "yes" : "no");
    if (!value.includes("before")) { await showResult("changed"); }`)), ['yes', 'changed']);
});

test("emitted search patterns escape runtime needles and match the entire prefixed input", () => {
  const values = ["", "a", "abc", "Abc", "a\nb", "\n", "TS_MATCH", ".*+?^${}()|[]\\", "\\E\\Q", "$1", "😀", "é", "e\u0301"];
  for (const method of ['startsWith', 'endsWith', 'includes'] as const) {
    const actions = compile(source(`let a = "text", b = "needle"; await showResult(a.${method}(b) ? "Y" : "N");`)).workflow.WFWorkflowActions;
    const replacements = actions.filter(a => a.WFWorkflowActionIdentifier.endsWith('.text.replace')).map(a => a.WFWorkflowActionParameters);
    const [escape, strip, match] = replacements;
    assert.equal(escape.WFReplaceTextReplace, '\\\\$1');
    assert.equal(strip.WFReplaceTextFind, '\\AJS:');
    const encoded = match.WFReplaceTextFind as any;
    assert.equal(Object.values(encoded.Value.attachmentsByRange)[0] && (Object.values(encoded.Value.attachmentsByRange)[0] as any).OutputUUID, strip.UUID);
    assert.equal(match.WFReplaceTextReplace, 'TS_MATCH');
    for (const needle of values) {
      const escaped = ('JS:' + needle).replace(new RegExp(escape.WFReplaceTextFind as string, 'gu'), '\\$1').replace(/^JS:/, '');
      const pattern = encoded.Value.string.replace('\uFFFC', escaped).replace('\\A', '^').replace('\\z', '$(?![\\s\\S])');
      for (const value of values) assert.equal(new RegExp(pattern, 'u').test('JS:' + value), value[method](needle), `${method}: ${JSON.stringify([value, needle])}`);
    }
  }
});

test("ignored and awaited string methods retain effects, with array methods remaining distinct", () => {
  assert.deepEqual(evaluate(source(`(await part(" A ")).trim();
    await showResult(await "a".toUpperCase());
    const xs = [" a ", "b"].map(x => x.trim()).filter(x => x.includes("a"));
    await showResult(xs.includes("a") ? xs[0] : "missing");`, 'async function part(x: string): Promise<string> { await showResult(x); return x; }')), [' A ', 'A', 'a']);
});

test("native example produces all intended results", () => {
  const code = readFileSync(new URL('../../examples/string-methods-test.ts', import.meta.url), 'utf8');
  assert.deepEqual(evaluate(code), [
    'Trim: "Ada"; "x  "; "  x"', 'Whitespace: Y/Y/Y', 'Empty: ""/""/""/""',
    'Case: STRASSE İ ΟΣ É; straße i̇ ος é', 'ADA/ts/😀',
    'Search: YYY;NNN;YYY;YNY;NYY;NNY;NNN;NNN;NNY;YNY;NNN;NNN;NNY;',
    'Arrays: ts/ios/js; Y',
  ]);
});

for (const [body, error] of [
  ['"x".trim("y");', /takes no arguments/],
  ['"x".startsWith("x", 1);', /position arguments/],
  ['"x".endsWith();', /requires one text argument/],
  ['"x".includes(/x/);', /Unsupported expression|RegExp/],
  ['"x".concat(1);', /arguments must be text/],
  ['(1 as unknown as string).trim();', /text receiver/],
  ['"x"?.trim();', /Optional string/],
  ['"x".trim?.();', /Optional string/],
  ['"x".concat(...["a"]);', /argument spreads/],
] as const) test(`reject unsupported string form: ${body}`, () => assert.throws(() => compile(source(body)), error));
