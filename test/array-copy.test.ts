import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { compile } from "../src/compiler.js";
import { evaluate } from "./support/evaluate.js";

const source = (body: string, helpers = "") => `import { showResult, stringifyJson, parseJson, input, quickLook, type NativeContent } from "@js-shortcuts/ios";
${helpers} export default async function main() { ${body} }`;

test("slice clamps and truncates dynamic bounds like JS, without emitting an invalid native range", () => {
  const bounds = [-99,-5,-2.9,-1,-0.5,0,0.5,1,2.9,5,99];
  for (const values of [[],[42],[0,1,2,3,4]]) {
    const actual = evaluate(source(`const values: number[] = ${JSON.stringify(values)};
      for (const start of ${JSON.stringify(bounds)}) { for (const end of ${JSON.stringify(bounds)}) {
        await showResult(stringifyJson(values.slice(start,end)));
      } }`));
    assert.deepEqual(actual, bounds.flatMap(start => bounds.map(end => JSON.stringify(values.slice(start,end)))));
  }
});

test("slice supports omitted and constant bounds, fractional negatives and empty inputs", () => {
  assert.deepEqual(evaluate(source(`const values = [0,1,2,3]; const empty: number[] = [];
    await showResult(stringifyJson(values.slice())); await showResult(stringifyJson(values.slice(-2.9)));
    await showResult(stringifyJson(values.slice(-0.5))); await showResult(stringifyJson(values.slice(9)));
    await showResult(stringifyJson(values.slice(2,1))); await showResult(stringifyJson(empty.slice()));`)), ['[0,1,2,3]','[2,3]','[0,1,2,3]','[]','[]','[]']);
});

test("slice evaluates receiver then start and end once, including ignored calls", () => {
  assert.deepEqual(evaluate(source('const selected = (await list()).slice(await bound(1),await bound(3)); await showResult(stringifyJson(selected)); (await list()).slice(await bound(2));',
    'async function list():Promise<number[]>{await showResult("list");return [0,1,2,3];} async function bound(n:number):Promise<number>{await showResult(n);return n;}')), ['list',1,3,'[1,2]','list',2]);
});

test("slice captures receiver and start before later bound effects", () => {
  assert.deepEqual(evaluate(source(`let values=[0,1,2,3]; let start=1;
    const selected=values.slice(start,[0].reduce((acc,n)=>{values=[9];start=3;return 3;},0));
    await showResult(stringifyJson(selected)); await showResult(stringifyJson(values));`)), ['[1,2]','[9]']);
});

test("slice retains objects, booleans and empty strings for further operations", () => {
  assert.deepEqual(evaluate(source(`const rows=[{n:1},{n:2},{n:3}].slice(-2);
    await showResult(rows.reduce((sum,row)=>sum+row.n,0));
    await showResult(stringifyJson([false,true].slice(0,1)));
    await showResult(stringifyJson(["x","","😀"].slice(1)));`)), [5,'[false]','["","😀"]']);
});

test("concat supports copies, empty and singleton lists, scalar entries and multiple arrays", () => {
  assert.deepEqual(evaluate(source(`const empty:number[]=[]; const values=[1,2];
    await showResult(stringifyJson(empty.concat())); await showResult(stringifyJson(empty.concat(42)));
    await showResult(stringifyJson(values.concat([],3,[4,5]))); await showResult(stringifyJson(values));
    await showResult(stringifyJson([false].concat(true,[false]))); await showResult("a".concat("b"));`)), ['[]','[42]','[1,2,3,4,5]','[1,2]','[false,true,false]','ab']);
});

test("concat evaluates receiver and arguments once in source order", () => {
  assert.deepEqual(evaluate(source('await showResult(stringifyJson((await values(1)).concat(await item(2),await values(3))));',
    'async function values(n:number):Promise<number[]>{await showResult(n);return [n];} async function item(n:number):Promise<number>{await showResult(n);return n;}')), [1,2,3,'[1,2,3]']);
});

test("concat and slice copies survive source reassignment and preserve object element types", () => {
  assert.deepEqual(evaluate(source(`let original=[{n:1},{n:2}]; const sliced=original.slice(1), copied=original.concat({n:3});
    original=[{n:9}]; await showResult(sliced[0].n); await showResult(copied[2].n); await showResult(copied[0].n);`)), [2,3,1]);
});

test("slice can pass opaque native item lists through without JSON serialization (compile-only)", () => {
  const actions=compile(source('const files=input<NativeContent[]>(); const selected=files.slice(0,2); await quickLook(selected);')).workflow.WFWorkflowActions;
  assert.ok(actions.some(a=>a.WFWorkflowActionIdentifier.endsWith('.getitemfromlist')));
  assert.ok(!actions.some(a=>a.WFWorkflowActionIdentifier.endsWith('.detect.dictionary')));
});

test("native example has the expected ranges, concatenation and copied results", () => {
  const code=readFileSync(new URL('../../examples/array-copy-test.ts',import.meta.url),'utf8');
  assert.deepEqual(evaluate(code), ['Ranges: [1,2,3];[2,3];[0,1,2,3,4];[];[];[3];',
    'Copies: [0,1,2,3,4]/[4]/[]/[]','Concat: []/[42]/[0,1,2,3]',
    'Rows: 2/Lin/Sam; sum 5','Values: [false,true,false]; '+JSON.stringify(['','😀','quote"\\\n']),
    'Independent: [2,3]/[1,2,3]/[9]']);
});

for(const [body,error] of [
  ['[1].slice(0,1,2);',/optional start and end/], ['[1].slice("1");',/Expected a number/],
  ['[1].slice(...[0]);',/argument spreads/], ['[1]?.slice();',/Optional array/],
  ['[1].concat?.([2]);',/Optional array/], ['[1].concat(...[[2]]);',/argument spreads/],
  ['[[1]].slice();',/flat array/], ['[1].concat([[2]]);',/flat JSON-compatible/],
  ['"abc".slice(1);',/typed array/], ['const files=input<NativeContent[]>(); files.concat();',/opaque native content/],
] as const) test(`reject unsupported array copy form: ${body}`,()=>assert.throws(()=>compile(source(body)),error));
