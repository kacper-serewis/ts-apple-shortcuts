import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { compile } from "../src/compiler.js";
import { evaluate } from "./support/evaluate.js";

const source = (body: string, helpers = "") => `import { showResult, askNumber } from "@js-shortcuts/ios";
${helpers} export default async function main() { ${body} }`;

test("dynamic lookup bounds agree with JS for negative, fractional and out-of-range starts", () => {
  const starts = [-99, -5, -3.9, -2, -1.5, -0.5, 0, 0.5, 1.5, 2, 3, 4, 99];
  for (const values of [[], [2], [2, 4, 2, 6]]) {
    const needles = [2, 4, 6, 9];
    const actual = evaluate(source(`const values: number[] = ${JSON.stringify(values)};
      for (const start of ${JSON.stringify(starts)}) { for (const needle of ${JSON.stringify(needles)}) {
        await showResult(values.indexOf(needle,start)); await showResult(values.includes(needle,start) ? "Y" : "N");
      } }`));
    assert.deepEqual(actual, starts.flatMap(start => needles.flatMap(needle => [values.indexOf(needle,start), values.includes(needle,start) ? "Y" : "N"])));
  }
});

test("dynamic text and boolean lookups retain strict equality and original indices", () => {
  assert.deepEqual(evaluate(source(`for (const start of [-2,1.5,9]) {
    await showResult(["x","","x"].indexOf("x",start));
    await showResult(["x","","x"].includes("",start) ? "Y" : "N");
    await showResult([false,true,false].indexOf(false,start));
    await showResult([false,true,false].includes(true,start) ? "Y" : "N");
  }`)), [2,"Y",2,"Y",2,"Y",2,"Y",-1,"N",-1,"N"]);
});

test("lookup evaluates receiver, needle and runtime start once in source order", () => {
  assert.deepEqual(evaluate(source('await showResult((await list()).indexOf(await needle(),await start()));',
    'async function list():Promise<number[]> {await showResult("list");return [2,4,2];} async function needle():Promise<number>{await showResult("needle");return 2;} async function start():Promise<number>{await showResult("start");return 1;}')),
  ["list","needle","start",2]);
});

test("runtime offset effects occur for empty receivers and ignored results", () => {
  assert.deepEqual(evaluate(source(`const empty:number[]=[];
    empty.indexOf(await askNumber("needle"),await askNumber("start")); await showResult(await askNumber("after"));
    empty.includes(await askNumber("needle"),await askNumber("start")); await showResult(await askNumber("after"));`), [1,-2,42,1,99,43]), [42,43]);
});

test("later start evaluation cannot replace the captured receiver or needle", () => {
  assert.deepEqual(evaluate(source(`let values=[2,4,2]; let needle=2;
    const position=values.indexOf(needle,[1].reduce((sum,n)=>{values=[9];needle=9;return 1;},0));
    await showResult(position); await showResult(values[0]); await showResult(needle);`)), [2,9,9]);
});

test("runtime lookup state resets inside helpers and map callbacks", () => {
  assert.deepEqual(evaluate(source(`await showResult([-3,-1,4].map(start=>lookup(start)).join(","));
    const start=await askNumber("start"); await showResult([1,2,1].includes(1,start) ? "Y" : "N");`,
    'function lookup(start:number):number {return [2,4,2].indexOf(2,start);}'), [-1]), ["0,2,-1","Y"]);
});

test("runtime offset example produces the expected native results", () => {
  const code=readFileSync(new URL('../../examples/array-offset-test.ts',import.meta.url),'utf8');
  assert.deepEqual(evaluate(code), [
    "Offsets: 0Y;2Y;2Y;0Y;2Y;-1N;-1N;",
    "Text: 2Y;2Y;-1N; Bool: 2Y;2Y;-1N;",
    "Empty: -1N;-1N;-1N;",
    "Snapshot: 2; source 9; needle 9",
    "Nested: 0,2,-1",
  ]);
});

for (const method of ["includes","indexOf"]) test(`${method} rejects argument spreads`,()=>{
  assert.throws(()=>compile(source(`[1].${method}(...[1]);`)),/argument spreads/);
});
