import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { compile } from "../src/compiler.js";
import { evaluate } from "./support/evaluate.js";

const source = (body: string, helpers = "") => `import { showResult, parseJson, input, type NativeContent } from "@js-shortcuts/ios";
${helpers} export default async function main() { ${body} }`;

test("join agrees with JS on empty entries and runtime literal separators", () => {
  const lists = [[], [""], ["", ""], ["", "a", "", "b", ""], ["😀", "quote\"\\\n", "$1"]];
  const separators = [",", "", "\n", "😀", "$1\\.*"];
  for (const list of lists) {
    assert.deepEqual(evaluate(source(`const list: string[] = ${JSON.stringify(list)};
      for (const separator of ${JSON.stringify(separators)}) { await showResult(list.join(separator)); }`)),
    separators.map(separator => list.join(separator)));
  }
});

test("join converts numbers and booleans to JSON scalar text", () => {
  for (const list of [[0, -1, 1.25, 1e-7, 1234567], [false, true, false]]) {
    assert.deepEqual(evaluate(source(`const list = ${JSON.stringify(list)};
      await showResult(list.join()); await showResult(list.join("|")); await showResult(list.join(""));`)),
    [list.join(), list.join("|"), list.join("")]);
  }
});

test("join uses comma by default and supports untyped empty and readonly literal arrays", () => {
  assert.deepEqual(evaluate(source(`const names = ["Ada", "Lin"] as const;
    await showResult(names.join()); await showResult([].join()); await showResult([""].join("|"));`)), ["Ada,Lin", "", ""]);
});

test("join evaluates receiver then separator once, also for empty and ignored calls", () => {
  assert.deepEqual(evaluate(source(`await showResult((await list()).join(await separator()));
    const empty: string[] = []; empty.join(await separator());`,
  `async function list(): Promise<string[]> { await showResult("list"); return ["a", "b"]; }
   async function separator(): Promise<string> { await showResult("separator"); return "|"; }`)), ["list", "separator", "a|b", "separator"]);
});

test("join captures receiver before separator effects and leaves source unchanged", () => {
  assert.deepEqual(evaluate(source(`let values=["a","b"]; const result=values.join([1].reduce((text,n)=>{values=["changed"];return "|";},""));
    await showResult(result); await showResult(values.join());`)), ["a|b", "changed"]);
});

test("join works inside map, local helpers and parsed JSON pipelines", () => {
  assert.deepEqual(evaluate(source(`const rows=parseJson<{name:string}[]>('[{"name":"Ada"},{"name":"Lin"}]');
    await showResult(rows.map(row=>row.name).join(" / "));
    await showResult([1,2].map(n=>format(n)).join(";"));`,
  `function format(n:number):string { return [n,n+1].join(":"); }`)), ["Ada / Lin", "1:2;2:3"]);
});

test("join variable results remain independent across repeated calls", () => {
  assert.deepEqual(evaluate(source(`const values=[1,2]; const a=values.join("-"); const b=values.join("+");
    await showResult(a); await showResult(b); await showResult(values[0]);`)), ["1-2", "1+2", 1]);
});

test("native join example has expected scalar text and empty-entry output", () => {
  const code = readFileSync(new URL("../../examples/array-join-test.ts", import.meta.url), "utf8");
  assert.deepEqual(evaluate(code), [
    "Text: |a||b|; compact ab; default ,a,,b,",
    "Empty: <>/<>/|; singleton Ada",
    "Numbers: 0|-1|1.25|1234567; flags false,true,false",
    "Escapes: 😀$1\\.*$1$1\\.*quote\"\\\n",
    "Rows: Ada / Lin; nested 1:2;2:3",
    "Snapshot: a|b; source changed",
  ]);
});

for (const [body, error] of [
  ['[1].join(1);', /separator must be text/],
  ['[1].join(",",";");', /one optional text separator/],
  ['[1].join(...[","]);', /argument spreads/],
  ['[1]?.join();', /Optional array/],
  ['[1].join?.();', /Optional array/],
  ['[[1]].join();', /flat array/],
  ['[{n:1}].join();', /homogeneous text, number or boolean/],
  ['input<NativeContent[]>().join();', /homogeneous text, number or boolean/],
  ['[1,"a"].join();', /Unsupported JSON value type/],
] as const) test(`reject unsupported join: ${body}`, () => assert.throws(() => compile(source(body)), error));
