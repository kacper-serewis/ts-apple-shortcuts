import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { compile } from "../src/compiler.js";
import { evaluate } from "./support/evaluate.js";

const source = (body: string, helpers = "") => `import { showResult, askNumber, repeat } from "@js-shortcuts/ios";
  ${helpers}
  export default async function main() { ${body} }`;

test("map/filter/reduce/forEach compose with object outputs, empty lists and early callback returns", () => {
  const code = readFileSync(new URL("../../examples/array-methods-test.ts", import.meta.url), "utf8");
  assert.deepEqual(evaluate(code.replace("  return;\n}", "}")), ["Map: 4; 10,43", "Filter/reduce: 3; 96", "Objecten: Kacper/10", "ForEach: 0:1;2:3;3:4;", "Leeg: 0/0/9", "Lege tekst: 2"]);
});

test("callbacks get a stable original array and zero-based index, independent of reassigned parameter values", () => {
  assert.deepEqual(evaluate(source(`const values = [4, 5, 6];
    const result = values.map((item, index, original) => { item += 10; index += 1; return item + original[index - 1]; });
    await showResult(result[0]); await showResult(result[2]); await showResult(values[0]);`)), [18, 22, 4]);
});

test("reduce gets accumulator, current item, index and original array; its seed is evaluated once", () => {
  assert.deepEqual(evaluate(source(`const values = [2, 3];
    const result = values.reduce((acc, item, index, original) => acc + item * original[index], await askNumber("seed"));
    await showResult(result);`), [10]), [23]);
});

test("an awaited helper supplying the receiver runs once before mapping", () => {
  assert.deepEqual(evaluate(source(
    'const mapped = (await items()).map(n => n * 2); await showResult(mapped[0]); await showResult(mapped[1]);',
    'async function items(): Promise<number[]> { const n = await askNumber("once"); return [n, n + 1]; }'
  ), [3]), [6, 8]);
});

test("block callbacks reset local return state per iteration and retain captured mutations", () => {
  assert.deepEqual(evaluate(source(`let visits = 0;
    const result = [1, 2, 3].map(n => {
      visits++;
      if (n === 2) { return 20; }
      visits += 10;
      return n * 10;
    });
    await showResult(result[1]); await showResult(visits);`)), [20, 23]);
});

test("nested array methods keep their collections, indices and captures separate", () => {
  assert.deepEqual(evaluate(source(`const result = [1, 2].map((outer, oi) => {
    return [3, 4].map((inner, ii) => outer + inner + oi + ii).reduce((acc, n) => acc + n, 0);
  });
  await showResult(result[0]); await showResult(result[1]);`)), [10, 14]);
});

test("receiver is evaluated once and reassigning the outer variable does not change iteration input", () => {
  assert.deepEqual(evaluate(source(`let values = [1, 2, 3];
    const result = values.map((n, i, original) => { values = [99]; return original[i] + n; });
    await showResult(result.length); await showResult(result[2]); await showResult(values[0]);`)), [3, 6, 99]);
});

test("forEach supports expression assignments and discards expression results", () => {
  assert.deepEqual(evaluate(source(`let sum = 0; [1, 2, 3].forEach(n => sum += n); [4, 5].forEach(() => sum++); await showResult(sum);`)), [8]);
});

test("callbacks can call synchronous helpers and return from nested loops", () => {
  assert.deepEqual(evaluate(source(`const result = [1, 2].map(n => {
    for (const item of [3, 4]) { if (item === 3) { return double(n + item); } }
    return 0;
  });
  await showResult(result[0]); await showResult(result[1]);`, 'function double(n: number): number { return n * 2; }')), [8, 10]);
});

test("filter preserves original items even when callback reassigns its parameter", () => {
  assert.deepEqual(evaluate(source('const result = [1, 2, 3].filter(n => { n += 10; return n >= 12; }); await showResult(result[0]); await showResult(result[1]);')), [2, 3]);
});

test("ignored map results still execute callback effects; empty arrays do not execute callbacks", () => {
  assert.deepEqual(evaluate(source('let count = 0; [1, 2].map(n => { count++; return n; }); const empty: number[] = []; empty.forEach(n => { count += 99; }); await showResult(count);')), [2]);
});

test("reduce can build a scalar of a different category from the input items", () => {
  assert.deepEqual(evaluate(source('const text = [1, 2].reduce((acc, n) => acc + n + ";", ""); await showResult(text);')), ["1;2;"]);
});

test("repeat result references target the closing repeat action, and filter emits Nothing for rejected items", () => {
  const actions = compile(source('const result = [1, 2].filter(n => n > 1); await showResult(result.length);')).workflow.WFWorkflowActions;
  const end = actions.find(a => a.WFWorkflowActionIdentifier === "is.workflow.actions.repeat.each" && a.WFWorkflowActionParameters.WFControlFlowMode === 2)!;
  const count = actions.find(a => a.WFWorkflowActionIdentifier === "is.workflow.actions.count")!;
  assert.deepEqual(count.WFWorkflowActionParameters.Input, { Value: { Type: "ActionOutput", OutputUUID: end.WFWorkflowActionParameters.UUID, OutputName: "Repeat Results" }, WFSerializationType: "WFTextTokenAttachment" });
  assert.equal(actions.filter(a => a.WFWorkflowActionIdentifier === "is.workflow.actions.nothing").length, 1);
});

for (const [body, error] of [
  ['const xs = [1, 2].map(async n => n + 1);', /synchronous arrow callback/],
  ['const xs = [1, 2].map(n => [n]);', /nested arrays/],
  ['const xs = [1, 2].filter(n => n);', /return a boolean/],
  ['const xs = [1, 2].reduce((acc, n) => acc + n);', /initial value/],
  ['const xs = [1, 2].map(n => n, {});', /thisArg/],
  ['const xs = [1, 2].map((n = 1) => n);', /binding parameters/],
  ['const xs = [1, 2].map(([n]) => n);', /requires a list/],
  ['const xs = [1, 2].map(n => { if (n > 1) { return n; } });', /Unsupported JSON value type/],
  ['const n = [1, 2].forEach(n => n);', /no return value/],
  ['for (const x of [1]) { [1].forEach(n => { break; }); }', /enclosing supported loop/],
  ['[1].forEach(n => { await showResult(n); });', /TS1308/],
] as const) {
  test(`rejects unsupported array callback: ${body}`, () => assert.throws(() => compile(source(body)), error));
}
