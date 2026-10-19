import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { compile } from "../src/compiler.js";
import { evaluate } from "./support/evaluate.js";
const source = (body: string, helpers = "") => `import { stringifyJson, parseJson, showResult, askNumber, input, native, type NativeContent } from "@js-shortcuts/ios";
${helpers}
export default async function main() { ${body} }`;

test("JSON conversion demo has exact object, list, scalar and escaped-text round trips", () => {
  const code = readFileSync(new URL("../../examples/json-conversion-test.ts", import.meta.url), "utf8");
  assert.deepEqual(evaluate(code), ["Object: Ada/7/Y", "Terug: Ada; 1/ts", "Array: 0; []", "Array: 1; [42]", "Array: 2; [2,4]", 'Tekst: Y; leeg: ""', "Scalars: false/-2.5/true", 'Rows: 1/9; [{"n":9}]']);
});

test("both stringify entry points preserve scalar values and JSON escaping", () => {
  for (const value of ["", 'a"\\\n😀', 0, -12.5, true, false]) {
    const literal = JSON.stringify(value);
    assert.deepEqual(evaluate(source(`await showResult(stringifyJson(${literal})); await showResult(JSON.stringify(${literal}));`)), [JSON.stringify(value), JSON.stringify(value)]);
  }
});

test("parse preserves supported result categories and composes with native operations", () => {
  assert.deepEqual(evaluate(source(`const data = parseJson<{ xs: number[]; ok: boolean }>('{"xs":[2,4],"ok":true}');
    await showResult(data.xs.reduce((sum, n) => sum + n, 0));
    if (data.ok) { await showResult(parseJson<number>("12") + 1); }
    await showResult(parseJson<string>('"Ada"'));`)), [6, 13, "Ada"]);
});

test("JSON conversion evaluates argument effects once and retains effects for ignored results", () => {
  assert.deepEqual(evaluate(source(`const obj = parseJson<{ n: number }>(await text());
    stringifyJson(await data()); JSON.stringify(await data());
    await showResult(obj.n);`,
    `async function text(): Promise<string> { await showResult("text"); return '{"n":9}'; }
     async function data(): Promise<{ n: number }> { await showResult("data"); return { n: 1 }; }`)), ["text", "data", "data", 9]);
});

test("sync helpers, array callbacks and awaited conversions can compose", () => {
  assert.deepEqual(evaluate(source(`const xs = [1, 2].map(n => stringifyJson({ n }));
    for (const encoded of xs) { await showResult(read(encoded)); }
    await showResult(await stringifyJson(false)); await showResult(await parseJson<number>("7"));`,
    'function read(encoded: string): number { return parseJson<{ n: number }>(encoded).n; }')), [1, 2, "false", 7]);
});

test("JSON built-in recognition respects lexical and import shadowing", () => {
  assert.throws(() => compile(source('const JSON = { stringify: "local" }; JSON.stringify(1);')), /Actions must be called|Only imported Shortcuts actions/);
  assert.throws(() => compile('import { stringifyJson as JSON } from "@js-shortcuts/ios"; export default async function main() { JSON.stringify(1); }'), /Actions must be called|Only imported Shortcuts actions/);
  assert.deepEqual(evaluate('import { stringifyJson as encode, parseJson as decode, showResult } from "@js-shortcuts/ios"; export default async function main() { await showResult(decode<number>(encode(7))); }'), [7]);
});

test("parser takes an explicit text attachment and output references the extracted value", () => {
  const { workflow, sourceMap } = compile(source('const n = parseJson<number>("7"); await showResult(n);'));
  const actions = workflow.WFWorkflowActions;
  const parser = actions.find(a => a.WFWorkflowActionIdentifier.endsWith(".detect.dictionary"))!;
  const extractor = actions.find(a => a.WFWorkflowActionIdentifier.endsWith(".getvalueforkey"))!;
  assert.equal((parser.WFWorkflowActionParameters.WFInput as any).WFSerializationType, "WFTextTokenAttachment");
  assert.equal((extractor.WFWorkflowActionParameters.WFInput as any).Value.OutputUUID, parser.WFWorkflowActionParameters.UUID);
  assert.equal(extractor.WFWorkflowActionParameters.WFDictionaryKey, "__value");
  assert.equal(sourceMap.length, actions.length);
});

for (const [body, error] of [
  ['parseJson("{}");', /explicit supported result type/],
  ['parseJson<number>(7);', /requires text/],
  ['parseJson<null>("null");', /Unsupported JSON value type/],
  ['parseJson<number | null>("null");', /Unsupported JSON value type/],
  ['parseJson<NativeContent>("{}");', /supported JSON values/],
  ['parseJson<number[][]>("[[1]]");', /arrays of arrays/],
  ['stringifyJson(input<NativeContent>());', /opaque native content/],
  ['JSON.stringify(undefined);', /Unknown variable/],
  ['JSON.stringify({ n: 1 }, null, 2);', /one argument/],
  ['JSON.stringify?.({ n: 1 });', /Optional JSON calls/],
  ['parseJson?.<number>("7");', /Optional JSON calls/],
  ['stringifyJson<number>(7);', /does not take type arguments/],
  ['parseJson<{ n: number }>("{}").missing;', /Unknown JSON field|Actions must be called/],
] as const) {
  test(`reject unsupported JSON conversion: ${body}`, () => assert.throws(() => compile(source(body)), error));
}
