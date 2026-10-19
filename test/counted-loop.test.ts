import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { compile } from "../src/compiler.js";
import { countedLoopError } from "../src/counted-loop.js";
import { evaluate } from "./support/evaluate.js";

const source = (body: string, helpers = "") => `import { showResult, askNumber } from "@js-shortcuts/ios"; ${helpers}
export default async function main() { ${body} }`;

test("counted for ranges match JS for both directions, inclusive bounds and runtime steps", () => {
  for(const op of ["<","<=",">",">="]) {
    const ascending=op.startsWith("<"), inclusive=op.endsWith("=");
    const cases=[-3,0,2,5].flatMap(start=>[-5,0,1,7].flatMap(end=>[1,2,4].map(n=>({start,end,step:ascending?n:-n}))));
    const expected=cases.map(({start,end,step})=>{
      let trace="";
      for(let i=start;ascending?(inclusive?i<=end:i<end):(inclusive?i>=end:i>end);i+=step) trace+=`${i},`;
      return trace;
    });
    assert.deepEqual(evaluate(source(`for(const row of ${JSON.stringify(cases)}) { await showResult(walk(row.start,row.end,row.step)); }`,
      `function walk(start:number,end:number,step:number):string {let trace="";for(let i=start;i${op}end;i+=step) {trace+=\`\${i},\`;}return trace;}`)), expected,op);
  }
});

test("all counter update forms and reversed comparisons keep their direction", () => {
  const updates=["i++","++i","i+=1","i=i+1","i=1+i","i-= -1"];
  assert.deepEqual(evaluate(source(updates.map(update=>`let trace${updates.indexOf(update)}="";for(let i=0;3>i;${update}) {trace${updates.indexOf(update)}+=\`\${i}\`;}await showResult(trace${updates.indexOf(update)});`).join("\n"))),updates.map(()=>"012"));
  for(const update of ["i--","--i","i-=1","i=i-1","i+= -1"]) {
    assert.deepEqual(evaluate(source(`let trace="";for(let i=2;0<=i;${update}) {trace+=\`\${i}\`;}await showResult(trace);`)),["210"]);
  }
});

test("continue advances the counter and break skips the remaining iterations", () => {
  assert.deepEqual(evaluate(source(`let trace="";for(let i=0;i<7;i++) {
    if(i===1) {continue;} if(i===5) {break;} trace+=\`\${i},\`;
  } await showResult(trace);await showResult("after");`)),["0,2,3,4,","after"]);
});

test("nested loops own their jumps and reset on each outer iteration", () => {
  assert.deepEqual(evaluate(source(`let trace="";for(let a=1;a<=3;a++) {
    for(let b=1;b<=3;b++) {if(b===2) {continue;} if(a===2) {break;} trace+=\`\${a}\${b},\`;}
    trace+=\`end\${a};\`;
  } await showResult(trace);`)),["11,13,end1;end2;31,33,end3;"]);
});

test("switch break stays in the switch while continue targets the for loop", () => {
  assert.deepEqual(evaluate(source(`let trace="";for(let i=0;i<4;i++) {
    switch(i) {case 0: trace+="zero";break;case 1: continue;default: trace+=\`\${i}\`;}
    trace+=";";
  }await showResult(trace);`)),["zero;2;3;"]);
});

test("helper returns stop the loop and state resets across invocations", () => {
  assert.deepEqual(evaluate(source('for(const value of [1,2,3]) {await showResult(find(value));}',
    'function find(value:number):number {for(let i=0;i<4;i++) {if(i===0) {continue;} if(value===2) {break;} if(i===value) {return i*10;}}return -1;}')),[10,-1,30]);
});

test("loop counters remain lexical and shadowed body variables may mutate", () => {
  assert.deepEqual(evaluate(source(`let i=9,limit=2;let trace="";
    for(let i=0;i<limit;i++) {const saved=i;{let i=10; i++; let limit=4;limit++;trace+=\`\${saved}/\${i}/\${limit};\`;}}
    limit=3;await showResult(trace);await showResult(i);await showResult(limit);`)),["0/11/5;1/11/5;",9,3]);
});

test("initializer effects occur once before boundary capture, even on an empty loop", () => {
  assert.deepEqual(evaluate(source(`let limit=2;let trace="";
    for(let i=[1].reduce((acc,n)=>{limit=3;return 0;},0);i<limit;i++) {trace+=\`\${i}\`;}
    for(let i=await askNumber("start");i<0;i++) {await askNumber("unreachable");}
    await showResult(trace);`),[5]),["012"]);
});

test("stable expression bounds support lengths and Math while captured const values remain independent", () => {
  assert.deepEqual(evaluate(source(`let sourceLimit=3;const limit=sourceLimit;const items=[2,4,6];let sum=0;
    for(let i=0;i<Math.min(limit,items.length);i+=1) {sourceLimit=0;sum+=items[i];}
    await showResult(sum);await showResult(sourceLimit);`)),[12,0]);
});

test("callee parameter writes do not mutate the caller's protected boundary", () => {
  assert.deepEqual(evaluate(source('let limit=2;for(let i=0;i<limit;i++) {await showResult(change(limit));}await showResult(limit);',
    'function change(limit:number):number {limit+=10;return limit;}')),[12,12,2]);
});

test("invalid runtime ranges stop before the body or subsequent effects", () => {
  for(const [start,end,step] of [[0.5,3,1],[0,3.5,1],[0,3,0.5],[0,3,0],[0,3,-1],[0,Number.MAX_SAFE_INTEGER+1,1],[-1,Number.MAX_SAFE_INTEGER,1]]) {
    assert.deepEqual(evaluate(source(`await walk(${start},${end},${step});await showResult("after");`,
      'async function walk(start:number,end:number,step:number):Promise<void> {for(let i=start;i<end;i+=step) {await showResult("body");}}')),[countedLoopError]);
  }
});

test("counted-loop native example produces the expected ranges and control flow", () => {
  assert.deepEqual(evaluate(readFileSync(new URL("../../examples/counted-loop-test.ts",import.meta.url),"utf8")),[
    "Ranges: 0,2,4,6,|5,3,1,|",
    "Control: 0,2,3,4,; zero;2;3;",
    "Nested: 11,13,end1;end2;31,33,end3;",
    "Helpers: 10,-1,30; scope 9",
  ]);
});

for(const [body,error] of [
  ['for(;;) {}',/initialized let counter/],
  ['for(let i=0;;i++) {}',/comparison and counter update/],
  ['for(var i=0;i<3;i++) {}',/initialized let counter/],
  ['for(let i=0,j=0;i<3;i++) {}',/initialized let counter/],
  ['for(let i=0;i!==3;i++) {}',/Use <, <=/],
  ['for(let i=0;i+1<3;i++) {}',/counter directly/],
  ['for(let i=0;i<i+3;i++) {}',/independent of the counter/],
  ['for(let i=0;i<3;i+=i) {}',/independent of the counter/],
  ['for(let i=0;i<3;i*=2) {}',/Update the for counter/],
  ['for(let i=0;i<3;i--) {}',/move toward/],
  ['for(let i=0;i<3;i+=0) {}',/move toward/],
  ['for(let i=0.5;i<3;i++) {}',/safe integer/],
  ['for(let i=0;i<3.5;i++) {}',/safe integer/],
  ['for(let i=0;i<3;i+=0.5) {}',/safe integer/],
  ['for(let i=0;i<3;i++) {i++;}',/Only the for header/],
  ['let limit=3;for(let i=0;i<limit;i++) {limit++;}',/cannot change inside/],
  ['let step=1;for(let i=0;i<3;i+=step) {[1].forEach(n=>{step++;});}',/cannot change inside/],
  ['for(let i=0;i<(await askNumber("bound"));i++) {}',/without calls or side effects/],
  ['let i=1;for(let i=i;i<3;i++) {}',/before its declaration/],
  ['for(let i=0;i<3;i++) {} await showResult(i);',/Unknown variable/],
  ['for(let i=0;i<3;i++) {await showResult(i);const i=4;}',/before its declaration/],
  ['for(let i=0;i<3;i++) await showResult(i);',/Use braces/],
] as const) test(`reject unsupported counted loop: ${body}`,()=>assert.throws(()=>compile(source(body)),error));
