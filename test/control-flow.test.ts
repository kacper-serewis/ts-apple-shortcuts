import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { compile } from "../src/compiler.js";
import { evaluate } from "./support/evaluate.js";

const source = (body: string, helpers = "") => `import { showResult, askNumber, repeat, menu } from "@js-shortcuts/ios";
  ${helpers}
  export default async function main() { ${body} }`;

test("break and continue skip effects while preserving code following each loop", () => {
  assert.deepEqual(evaluate(source(`let n = 0;
    for (const item of [-1, 2, 3, 99, 100]) {
      if (item < 0) { continue; }
      if (item === 99) { break; }
      n += item;
    }
    await showResult(n); await showResult("after");`)), [5, "after"]);
});

test("inner jumps stay inside their own loop; flags reset on each outer iteration", () => {
  assert.deepEqual(evaluate(source(`let trace = "";
    for (const a of [1, 2, 3]) {
      for (const b of [1, 2, 3]) {
        if (b === 2) { continue; }
        if (a === 2) { break; }
        trace += \`\${a}\${b},\`;
      }
      trace += \`end\${a};\`;
    }
    await showResult(trace);`)), ["11,13,end1;end2;31,33,end3;"]);
});

test("unconditional jumps, nested blocks and else-if all skip the correct tail", () => {
  assert.deepEqual(evaluate(source(`let n = 0;
    for (const x of [1, 2, 3, 4]) {
      { if (x === 1) { n += 10; } else if (x === 2) { continue; } else { break; } }
      n += x;
    }
    for (const x of [1, 2]) { continue; n += 100; }
    for (const x of [1, 2]) { break; n += 1000; }
    await showResult(n);`)), [11]);
});

test("helper returns compose with break/continue and subsequent calls reset all flags", () => {
  assert.deepEqual(evaluate(source(
    'for (const n of [1, 2, 3]) { await showResult(search(n)); }',
    `function search(n: number): number {
      for (const x of [1, 2, 3]) {
        if (x === 1) { continue; }
        if (n === 2) { break; }
        if (x === n) { return x * 10; }
      }
      return -1;
    }`
  )), [-1, -1, 30]);
});

test("a break in a helper loop does not skip the caller's loop body", () => {
  assert.deepEqual(evaluate(source(
    'for (const x of [1, 2]) { stop(); await showResult(x); }',
    'function stop(): void { for (const y of [1, 2]) { break; } }'
  )), [1, 2]);
});

test("a loop inside a repeat callback owns its jumps", () => {
  assert.deepEqual(evaluate(source('await repeat(2, async () => { for (const x of [1, 2, 3]) { if (x === 2) { break; } await showResult(x); } await showResult("callback"); });')), [1, "callback", 1, "callback"]);
});

test("a prompt in a skipped branch or after break is not executed", () => {
  assert.deepEqual(evaluate(source('for (const x of [1, 2]) { if (x === 1) { continue; } break; await askNumber("wrong"); } await showResult("done");')), ["done"]);
});

test("dynamic indices use the current value and evaluate their expression once", () => {
  assert.deepEqual(evaluate(source(`const values = [10, 20, 30]; let index = 0;
    const first = values[index]; index += 2;
    await showResult(first); await showResult(values[index]);
    await showResult(values[(await askNumber("index")) - 1]);
    for (const i of [2, 0]) { await showResult(values[i]); }`), [2]), [10, 30, 20, 30, 10]);
});

test("typed objects selected by dynamic index retain their field types", () => {
  assert.deepEqual(evaluate(source('const rows = [{ name: "Ada", n: 1 }, { name: "Kacper", n: 2 }]; let i = 1; const row = rows[i]; await showResult(`${row.name}:${row.n}`);')), ["Kacper:2"]);
});

test("dynamic index serialization converts zero-based index exactly once to native one-based index", () => {
  const result = compile(source('const rows = [1, 2]; let i = 1; await showResult(rows[i]);'));
  const actions = result.workflow.WFWorkflowActions;
  const position = actions.findIndex(a => a.WFWorkflowActionIdentifier === "is.workflow.actions.getitemfromlist");
  const math = actions[position - 1].WFWorkflowActionParameters;
  assert.equal(actions[position - 1].WFWorkflowActionIdentifier, "is.workflow.actions.math");
  assert.equal(math.WFMathOperation, "+");
  assert.equal(math.WFMathOperand, 1);
  assert.deepEqual(actions[position].WFWorkflowActionParameters.WFItemIndex, {
    Value: { Type: "ActionOutput", OutputUUID: math.UUID, OutputName: "Calculation Result" }, WFSerializationType: "WFTextTokenAttachment",
  });
});

test("the combined loop demo has balanced native groups and no stop actions from break/continue", () => {
  const code = readFileSync(new URL("../../examples/control-flow-test.ts", import.meta.url), "utf8");
  // Remove only the main's explicit stop for the pure IR evaluator.
  assert.deepEqual(evaluate(code.replace("  return;\n}", "}")), ["Som: 5", "Genest: 11,13,eind1;eind2;", "Index: nul/twee", "Selectie: twee;nul;"]);
  const actions = compile(code).workflow.WFWorkflowActions;
  assert.equal(actions.filter(a => a.WFWorkflowActionIdentifier === "is.workflow.actions.exit").length, 1);
  assert.ok(!actions.some(a => a.WFWorkflowActionIdentifier === "is.workflow.actions.output"));
  const stack: unknown[] = [];
  for (const { WFWorkflowActionParameters: p } of actions) {
    if (p.WFControlFlowMode === 0) stack.push(p.GroupingIdentifier);
    if (p.WFControlFlowMode === 1) assert.equal(p.GroupingIdentifier, stack.at(-1));
    if (p.WFControlFlowMode === 2) assert.equal(p.GroupingIdentifier, stack.pop());
  }
  assert.deepEqual(stack, []);
});

for (const [body, error] of [
  ['break;', /enclosing supported loop/],
  ['continue;', /enclosing supported loop/],
  ['for (const n of [1]) { await repeat(1, async () => { break; }); }', /enclosing supported loop/],
  ['for (const n of [1]) { await menu("x", { A: async () => { continue; } }); }', /enclosing supported loop/],
  ['for (const n of [1]) { break outer; }', /Labeled break/],
  ['const xs = [1, 2]; await showResult(xs[1.5]);', /nonnegative integer/],
  ['const xs = [1, 2]; await showResult(xs[-1]);', /nonnegative integer/],
  ['const xs = [1, 2]; const i = "1"; await showResult(xs[i]);', /Expected a number/],
] as const) {
  test(`rejects invalid loop control/index: ${body}`, () => assert.throws(() => compile(source(body)), error));
}

test("helper bodies cannot break the caller's loop", () => {
  assert.throws(() => compile(source('for (const x of [1, 2]) { stop(); }', 'function stop(): void { break; }')), /enclosing supported loop/);
});
