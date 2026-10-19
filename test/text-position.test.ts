import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { compile } from "../src/compiler.js";
import { evaluate } from "./support/evaluate.js";

const source = (body: string, helpers = "") => `import { showResult } from "@js-shortcuts/ios"; ${helpers}
export default async function main() { ${body} }`;

test("text length counts UTF-16 units independently of grapheme clusters", () => {
  const values = ["", "abc", "é", "é", "😀", "a😀b", "👨‍👩‍👧‍👦", "🇳🇱", "👍🏽", "\r\n", "\uFEFF", "\uFFFD", "𝄞", "JS:", "x\n😀é"];
  assert.deepEqual(evaluate(source(`for (const text of ${JSON.stringify(values)}) { await showResult(text.length); }`)), values.map(v=>v.length));
});

test("length works in expressions, nested dictionaries and alongside list/object length", () => {
  assert.deepEqual(evaluate(source(`const data={text:"😀é",length:7}; const xs=["x",data.text];
    await showResult(data.text.length + xs.length + data.length);
    await showResult(xs.map(t=>t.length).join(","));
    if(data.text.length===4) {await showResult("four");}`)), [13,"1,4","four"]);
});

test("length evaluates its receiver once and captures mutable source values", () => {
  assert.deepEqual(evaluate(source(`let text="😀";
    const length=text.length; text="changed"; await showResult(length);
    await showResult((await part("é")).length);`,
  'async function part(text:string):Promise<string>{await showResult(text);return text;}')), [2,"é",2]);
});

test("default and static indexOf positions agree with JS, including overlapping matches", () => {
  const pairs = [["", ""], ["", "x"], ["abc", ""], ["abcabc", "bc"], ["aaaa", "aa"], ["Aba", "a"],
    ["x.*[]\\$y.*[]\\$", ".*[]\\$"], ["x\ny\n", "\n"], ["😀é😀", "😀"], ["é é", "é"], ["JS:JS:", "JS:"], ["abc", "z"]];
  const starts = [-100,-1.8,0,0.8,1,1.9,2,3,4,100];
  for(const [input,needle] of pairs) {
    const calls=[`await showResult(${JSON.stringify(input)}.indexOf(${JSON.stringify(needle)}));`, ...starts.map(start=>
      `await showResult(${JSON.stringify(input)}.indexOf(${JSON.stringify(needle)},${start}));`)];
    assert.deepEqual(evaluate(source(calls.join("\n"))), [input.indexOf(needle),...starts.map(start=>input.indexOf(needle,start))],JSON.stringify([input,needle]));
  }
});

test("runtime indexOf positions use UTF-16 offsets even inside supplementary characters", () => {
  const pairs = [["😀a😀b", "😀"], ["😀a😀b", "a"], ["😀a😀b", ""], ["éé", "́"], ["aaaa", "aa"],
    ["👨‍👩‍👧‍👦!", "!"], ["🇳🇱🇳🇱", "🇳🇱"], ["", ""], ["", "x"], ["abc", "abc"], ["abc", "missing"]];
  const starts=[-100,-2.9,-0.8,0,0.8,1,1.9,2,2.9,3,4,5,6,7,10,11,12,100];
  for(const [input,needle] of pairs) {
    assert.deepEqual(evaluate(source(`let input=${JSON.stringify(input)},needle=${JSON.stringify(needle)};
      for(const start of ${JSON.stringify(starts)}) {await showResult(input.indexOf(needle,start));}`)),
    starts.map(start=>input.indexOf(needle,start)), JSON.stringify([input,needle]));
  }
});

test("indexOf receiver and both arguments evaluate once in order, including empty search", () => {
  for(const needle of ["", "missing"]) {
    assert.deepEqual(evaluate(source(`await showResult((await part("input")).indexOf(await part(${JSON.stringify(needle)}),await start()));`,
      'async function part(text:string):Promise<string>{await showResult(text);return text;} async function start():Promise<number>{await showResult("start");return 2;}')),
    ["input",needle,"start",needle===""?2:-1]);
  }
});

test("indexOf snapshots receiver and search before start-argument mutations", () => {
  assert.deepEqual(evaluate(source(`let input="😀a😀",needle="😀";
    const found=input.indexOf(needle,[1].reduce((acc,n)=>{input="changed";needle="z";return 1;},0));
    await showResult(found); await showResult(input); await showResult(needle);`)), [3,"changed","z"]);
});

test("indexOf helper state resets and array lookup keeps its distinct negative-index rules", () => {
  assert.deepEqual(evaluate(source(`await showResult([0,1,2,100].map(n=>find(n)).join(","));
    await showResult(["a","b","a"].indexOf("a",-1)); await showResult("aba".indexOf("a",-1));`,
    'function find(start:number):number{return "😀a😀".indexOf("😀",start);}')), ["0,3,3,-1",2,0]);
});

test("text-position example produces native expected outputs", () => {
  assert.deepEqual(evaluate(readFileSync(new URL("../../examples/text-position-test.ts",import.meta.url),"utf8")), [
    "Lengths: 0,3,2,2,11,4,4,2",
    "Offsets: 0/1/-1",
    "Positions: 0:0;3:1;3:2;3:3;-1:6;",
    "Literal: 1; exact 2; combining 1",
    "Snapshot: 3/changed/z; length 2",
  ]);
});

for(const [body,error] of [
  ['"x".indexOf();',/requires a text search/],
  ['"x".indexOf("x",0,1);',/requires a text search/],
  ['"x".indexOf(1);',/text search value/],
  ['"x".indexOf("x","1");',/number/],
  ['"x".indexOf(/x/);',/Unsupported/],
  ['"x"?.indexOf("x");',/Optional string/],
  ['"x".indexOf(...["x"]);',/argument spreads/],
  ['await showResult("x"?.length);',/Optional chaining/],
] as const) test(`reject unsupported text position form: ${body}`,()=>assert.throws(()=>compile(source(body)),error));
