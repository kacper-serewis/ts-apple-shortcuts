import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { compile } from "../src/compiler.js";
import { evaluate } from "./support/evaluate.js";

const source = (body: string, helpers = "") => `import { showResult } from "@js-shortcuts/ios"; ${helpers}
export default async function main() { ${body} }`;
const templates = ["", "X", "$$", "$&", "$`", "$'", "$$&", "$$$&", "$$$$", "$1/$01/$99/$<name>", "\\$1\\$&", "$`/$&/$'", "\n😀$&", "tail$", "$&$", "$$$$$&", "$'$`$$"];

test("dynamic replacement templates agree with JS across literal needles and Unicode", () => {
  const pairs = [["", ""], ["", "a"], ["abc", ""], ["aba", "a"], ["abc", "b"], ["abc", "c"], ["abc", "missing"], ["aaa", "aa"], ["Aba", "a"], ["x.*[]\\$y", ".*[]\\$"], ["x\ny\n", "\n"], ["😀é😀", "😀"], ["é", "é"], ["JS:JS:", "JS:"]];
  for (const [input, needle] of pairs) {
    assert.deepEqual(evaluate(source(`let input=${JSON.stringify(input)}, needle=${JSON.stringify(needle)};
      for (const replacement of ${JSON.stringify(templates)}) { await showResult(input.replace(needle,replacement)); }`)),
    templates.map(replacement => input.replace(needle,replacement)), JSON.stringify([input,needle]));
  }
});

test("literal replacement templates retain the same substitution behavior", () => {
  const values = templates.flatMap(template => ["", "b", "missing"].map(needle => ({ template, needle })));
  const code = values.map(({template,needle}) => `await showResult("abc".replace(${JSON.stringify(needle)},${JSON.stringify(template)}));`).join("\n");
  assert.deepEqual(evaluate(source(code)), values.map(({template,needle}) => "abc".replace(needle,template)));
});

test("replace changes only the first match and never reprocesses replacement output", () => {
  assert.deepEqual(evaluate(source(`let replacement="aa";
    await showResult("aaa".replace("a",replacement)); await showResult("aaaa".replace("aa","$&$&"));
    await showResult("".replace("",${JSON.stringify("$&x$`$'")}));`)), ["aaaa", "aaaaaa", "x"]);
});

test("replace evaluates receiver then both arguments exactly once, even without a match", () => {
  assert.deepEqual(evaluate(source('await showResult((await part("input")).replace(await part("needle"),await part("replacement")));',
    'async function part(value:string):Promise<string>{await showResult(value);return value;}')), ["input","needle","replacement","input"]);
});

test("replace snapshots receiver and needle before later argument mutation", () => {
  assert.deepEqual(evaluate(source(`let input="aba", needle="a";
    const replaced=input.replace(needle,[1].reduce((acc,n)=>{input="changed";needle="z";return "$&!";},""));
    await showResult(replaced); await showResult(input); await showResult(needle);`)), ["a!ba","changed","z"]);
});

test("dynamic replacement locals reset across helpers and map invocations", () => {
  assert.deepEqual(evaluate(source('await showResult(["$$&","$&","$`"].map(t=>change(t)).join("|"));',
    'function change(t:string):string {return "aba".replace("b",t);}')), ["a$&a|aba|aaa"]);
});

test("native replacement example has the expected first-match, template and escape results", () => {
  const code = readFileSync(new URL("../../examples/text-replace-test.ts", import.meta.url), "utf8");
  assert.deepEqual(evaluate(code), [
    "First: Xba/aaaaaa",
    "Templates: a$ca;abca;aaca;acaca;a$&ca;a$bca;a$1ca;aa/b/caca;",
    'Empty: "!"/"!abcabc"; missing abc',
    "Escapes: " + JSON.stringify('x.*[]\\$:$1:\\:😀\ny'),
    "Snapshot: a!ba/changed/z; helpers a$&ca|abca|aaca",
  ]);
});

for (const [body, error] of [
  ['"abc".replace("a");', /requires a text search/],
  ['"abc".replace("a","b","c");', /requires a text search/],
  ['"abc".replace(1,"x");', /arguments must be text/],
  ['"abc".replace("a",1);', /arguments must be text/],
  ['"abc".replace(/a/,"b");', /Unsupported/],
  ['"abc".replace("a",()=>"b");', /Unsupported/],
  ['"abc"?.replace("a","b");', /Optional string/],
  ['"abc".replace(...["a","b"]);', /argument spreads/],
] as const) test(`reject unsupported replace form: ${body}`,()=>assert.throws(()=>compile(source(body)),error));
