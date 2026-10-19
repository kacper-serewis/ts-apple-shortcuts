import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { compile } from "../src/compiler.js";
import { evaluate } from "./support/evaluate.js";

const source = (body: string, helpers = "") => `import { showResult } from "@js-shortcuts/ios"; ${helpers}
export default async function main() { ${body} }`;
const templates = ["", "X", "$$", "$&", "$`", "$'", "$$&", "$$$&", "$$$$", "$1/$01/$99/$<name>", "\\$1\\$&", "$`/$&/$'", "\n😀$&", "tail$", "$&$", "$$$$$&", "$'$`$$"];

test("replaceAll dynamic templates match JS for literal searches and original contexts", () => {
  const pairs = [["", ""], ["", "a"], ["abc", ""], ["é", ""], ["TS_NON_BMP", ""],
    ["aba", "a"], ["aaaaa", "aa"], ["abcabc", "b"], ["abc", "missing"], ["AbaA", "a"],
    ["x.*[]\\$y.*[]\\$", ".*[]\\$"], ["x\ny\n", "\n"], ["😀é😀", "😀"], ["😀😀😀", "😀😀"],
    ["é é é", "é"], ["JS:JS:", "JS:"], ["ababa", "aba"], ["$$$", "$"], ["||||", "|"]];
  for (const [input, needle] of pairs) {
    assert.deepEqual(evaluate(source(`let input=${JSON.stringify(input)}, needle=${JSON.stringify(needle)};
      for (const replacement of ${JSON.stringify(templates)}) { await showResult(input.replaceAll(needle,replacement)); }`)),
    templates.map(replacement => input.replaceAll(needle,replacement)), JSON.stringify([input,needle]));
  }
});

test("replaceAll static templates match JS, including empty-search boundaries", () => {
  const cases = templates.flatMap(template => ["", "b", "missing"].map(needle => ({ template, needle })));
  assert.deepEqual(evaluate(source(cases.map(({template,needle}) =>
    `await showResult("abcabc".replaceAll(${JSON.stringify(needle)},${JSON.stringify(template)}));`).join("\n"))),
  cases.map(({template,needle}) => "abcabc".replaceAll(needle,template)));
});

test("replaceAll does not overlap or revisit inserted text", () => {
  assert.deepEqual(evaluate(source(`let replacement="aa";
    await showResult("aaa".replaceAll("a",replacement));
    await showResult("aaaaa".replaceAll("aa","X"));
    await showResult("aba".replaceAll("a","$&$'"));`)), ["aaaaaa", "XXa", "ababa"]);
});

test("replaceAll evaluates receiver and arguments once in source order even without matches", () => {
  assert.deepEqual(evaluate(source('await showResult((await part("input")).replaceAll(await part("needle"),await part("replacement")));',
    'async function part(value:string):Promise<string>{await showResult(value);return value;}')), ["input","needle","replacement","input"]);
});

test("replaceAll snapshots receiver and search before replacement effects", () => {
  assert.deepEqual(evaluate(source(`let input="aba", needle="a";
    const replaced=input.replaceAll(needle,[1].reduce((acc,n)=>{input="changed";needle="z";return "$&!";},""));
    await showResult(replaced); await showResult(input); await showResult(needle);`)), ["a!ba!","changed","z"]);
});

test("replaceAll locals reset across helpers, outer loops and templates", () => {
  assert.deepEqual(evaluate(source('await showResult(["$$&","$&","$`"].map(t=>change(t)).join("|"));',
    'function change(t:string):string {return "aba".replaceAll("a",t);}')), ["$&b$&|aba|bab"]);
});

test("empty-search insertions on supplementary characters stop before producing incorrect text", () => {
  for (const input of ["😀", "a😀b", "👨‍👩‍👧‍👦"]) {
    assert.deepEqual(evaluate(source(`await showResult("before");
      await showResult(${JSON.stringify(input)}.replaceAll("","!")); await showResult("after");`)), ["before",
      "replaceAll with an empty search and this Unicode text needs UTF-16 surrogate splitting, which is not supported yet."]);
  }
});

test("empty-search no-op templates still support supplementary characters", () => {
  assert.deepEqual(evaluate(source('for(const replacement of ["","$&","$&$&"]) { await showResult("😀é".replaceAll("",replacement)); }')),
    ["😀é","😀é","😀é"]);
});

test("native replaceAll example matches JS expectations", () => {
  assert.deepEqual(evaluate(readFileSync(new URL("../../examples/text-replace-all-test.ts", import.meta.url), "utf8")), [
    "Matches: XbX/XXa/abc",
    "Templates: $b$b;$&b$&b;abab;babb;babbbb;/babbab/bb;",
    'Empty: "!"/"!e!́!"; emoji 😀',
    'Unicode: [😀]é[😀]; literal X/X; exact éXé',
    "Snapshot: a!ba!/changed/z",
  ]);
});

for (const [body, error] of [
  ['"abc".replaceAll("a");', /requires a text search/],
  ['"abc".replaceAll("a","b","c");', /requires a text search/],
  ['"abc".replaceAll(1,"x");', /arguments must be text/],
  ['"abc".replaceAll("a",1);', /arguments must be text/],
  ['"abc".replaceAll(/a/g,"b");', /Unsupported/],
  ['"abc".replaceAll("a",()=>"b");', /Unsupported/],
  ['"abc"?.replaceAll("a","b");', /Optional string/],
  ['"abc".replaceAll(...["a","b"]);', /argument spreads/],
] as const) test(`reject unsupported replaceAll form: ${body}`,()=>assert.throws(()=>compile(source(body)),error));
