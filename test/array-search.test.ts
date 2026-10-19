import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { compile } from "../src/compiler.js";
import { evaluate } from "./support/evaluate.js";

const source = (body: string, helpers = "") => `import { showResult, askNumber } from "@js-shortcuts/ios";
${helpers}
export default async function main() { ${body} }`;

test("array search example produces the intended predicate, empty-list and lookup results", () => {
  const code = readFileSync(new URL("../../examples/array-search-test.ts", import.meta.url), "utf8").replace("  return;\n", "");
  assert.deepEqual(evaluate(code), ["Some: Y; bezocht: 01", "Every: N; bezocht: 123", "FindIndex: 1; bezocht: 01", "Leeg: N/Y/-1/N; callbacks: 0", "Tekst: 0Y;-1N;1Y;", "Indices: 0/2/2/-1; bool: 1"]);
});

test("some stops after its first true callback and every stops after its first false callback", () => {
  assert.deepEqual(evaluate(source(`let visits = "";
    const some = [1, 2, 3, 4].some(n => { visits += n; return n > 1; });
    await showResult(some ? "some" : "wrong"); await showResult(visits);
    visits = "";
    const every = [1, 2, 3, 4].every(n => { visits += n; return n < 3; });
    await showResult(every ? "wrong" : "not every"); await showResult(visits);`)), ["some", "12", "not every", "123"]);
});

test("some/every/findIndex return the correct defaults for empty and unsuccessful searches", () => {
  assert.deepEqual(evaluate(source(`const empty: number[] = []; let visits = 0;
    await showResult(empty.some(n => { visits++; return true; }) ? "wrong" : "no");
    await showResult(empty.every(n => { visits++; return false; }) ? "yes" : "wrong");
    await showResult(empty.findIndex(n => { visits++; return true; })); await showResult(visits);
    await showResult([1, 2].some(n => n > 3) ? "wrong" : "no");
    await showResult([1, 2].every(n => n < 3) ? "yes" : "wrong");
    await showResult([1, 2].findIndex(n => n > 3));`)), ["no", "yes", -1, 0, "no", "yes", -1]);
});

test("findIndex returns the original zero-based position even if callback parameters change", () => {
  assert.deepEqual(evaluate(source(`let visits = 0;
    const index = [{ score: 1 }, { score: 4 }, { score: 8 }].findIndex(({ score }, i, original) => {
      visits++; i += 100; score += original[0].score; return score >= 5;
    }); await showResult(index); await showResult(visits);`)), [1, 2]);
});

test("findIndex tracks the index even when the callback omits its index parameter", () => {
  assert.deepEqual(evaluate(source('await showResult([2, 4, 6].findIndex(n => n === 6)); await showResult([2, 4].findIndex(() => true));')), [2, 0]);
});

test("predicate callbacks receive original arrays and mutable isolated item/index parameters", () => {
  assert.deepEqual(evaluate(source(`const values = [2, 4, 6]; let trace = "";
    values.some((n, i, original) => { trace += \`\${i}:\${original[i]};\`; n += 10; i += 10; return n >= 14; });
    await showResult(trace); await showResult(values[1]);`)), ["0:2;1:4;", 4]);
});

test("predicate local returns and nested searches compose without stopping the caller", () => {
  assert.deepEqual(evaluate(source(`const rows = [[1, 2], [3, 4]];
    const found = rows.findIndex(row => { for (const n of row) { if (n === 3) { return true; } } return false; });
    await showResult(found);
    const result = rows.every(row => row.some(n => n > 1));
    await showResult(result ? "all" : "wrong"); await showResult("after");`)), [1, "all", "after"]);
});

test("search states reset for each outer iteration, including after earlier early termination", () => {
  assert.deepEqual(evaluate(source(`for (const needle of [2, 9, 1]) {
    const values = [1, 2];
    await showResult(values.findIndex(n => n === needle));
    await showResult(values.includes(needle) ? "yes" : "no");
    await showResult(values.indexOf(needle));
  }`)), [1, "yes", 1, -1, "no", -1, 0, "yes", 0]);
});

test("receiver is evaluated once and remains stable if a predicate replaces its source variable", () => {
  assert.deepEqual(evaluate(source(`let values = [1, 2, 3];
    const index = values.findIndex((n, i, original) => { values = [99]; return original[i] === 3; });
    await showResult(index); await showResult(values[0]);`)), [2, 99]);
});

test("lookup evaluates its receiver then needle once, even when the receiver is empty", () => {
  assert.deepEqual(evaluate(source(`await showResult((await list()).includes(await needle()) ? "yes" : "no");
    const empty: number[] = []; await showResult(empty.indexOf(await askNumber("still evaluated")));`,
  'async function list(): Promise<number[]> { await showResult("receiver"); return [2, 3]; } async function needle(): Promise<number> { await showResult("needle"); return 3; }'), [9]), ["receiver", "needle", "yes", -1]);
});

test("lookup snapshots the receiver before a needle helper replaces its outer binding", () => {
  assert.deepEqual(evaluate(source(`let values = [1, 2];
    const needle = [0].map(() => values.indexOf([2].reduce((acc, n) => { values = [9]; return n; }, 0)));
    await showResult(needle[0]); await showResult(values[0]);`)), [1, 9]);
});

test("includes/indexOf use strict scalar equality for dynamic text and boolean values", () => {
  assert.deepEqual(evaluate(source(`for (const needle of ["a.*", "abc", "", "Open", "open", "e\u0301"]) {
    const values = ["a.*", "", "open", "é"];
    await showResult(values.indexOf(needle)); await showResult(values.includes(needle) ? "yes" : "no");
  }
  await showResult([false, true, false].indexOf(true));
  await showResult([false].includes(true) ? "wrong" : "no");
  await showResult([0, 1].indexOf(-0));`)), [0, "yes", -1, "no", 1, "yes", -1, "no", 2, "yes", -1, "no", 1, "no", 0]);
});

test("constant fromIndex follows truncation and negative-offset semantics", () => {
  const values = [2, 4, 2, 6];
  for (const start of [-99, -4, -3, -2.9, -1, -0.9, 0, 1.9, 2, 3, 4, 99]) {
    assert.deepEqual(evaluate(source(`const values = [2, 4, 2, 6];
      await showResult(values.indexOf(2, ${start}));
      await showResult(values.includes(2, ${start}) ? "yes" : "no");`)), [values.indexOf(2, start), values.includes(2, start) ? "yes" : "no"], `fromIndex=${start}`);
  }
});

test("empty typed lookups and constant aliases support negative offsets", () => {
  assert.deepEqual(evaluate(source(`const empty: number[] = []; const start = -2;
    await showResult(empty.indexOf(1, start)); await showResult(empty.includes(1) ? "wrong" : "no");
    const values = [1, 2, 1] as const; await showResult(values.indexOf(1, start));`)), [-1, "no", 2]);
});

test("ignored predicate results still run effects and stop at the decisive result", () => {
  assert.deepEqual(evaluate(source('let n = 0; [1, 2, 3].some(x => { n++; return x === 2; }); [1, 2, 3].every(x => { n++; return false; }); await showResult(n);')), [3]);
});

for (const [body, error] of [
  ['[1, 2].some(async n => n > 1);', /synchronous arrow callback/],
  ['[1, 2].every(n => n);', /return a boolean/],
  ['[1, 2].findIndex(n => "yes");', /return a boolean/],
  ['[1, 2].some(n => { if (n > 1) { return true; } });', /Unsupported JSON value type/],
  ['[1].some(n => true, {});', /thisArg/],
  ['[1].every((n = 1) => true);', /binding parameters/],
  ['[1].indexOf(1, "0");', /Expected a number/],
  ['[1].includes();', /requires a search value/],
  ['[1].indexOf(1, 0, 1);', /requires a search value/],
  ['[{ n: 1 }].includes({ n: 1 });', /object identity/],
  ['[1].indexOf("1");', /scalar value category/],
  ['"hello".indexOf("h");', /typed array/],
  ['[1]?.some(n => true);', /Optional array method/],
  ['[1].findIndex(n => { if (n > 0) { break; } return false; });', /enclosing supported loop/],
] as const) {
  test(`rejects unsupported array search: ${body}`, () => assert.throws(() => compile(source(body)), error));
}
