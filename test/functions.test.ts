import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { compile } from "../src/compiler.js";
import { buildPlist } from "../src/plist-codec.js";
import { parse } from "plist";
import { evaluate } from "./support/evaluate.js";

const source = (helpers: string, body: string) => `import { showResult, askNumber, repeat, menu, input, native, quickLook } from "@js-shortcuts/ios";
  ${helpers}
  export default async function main() { ${body} }`;


test("sync and async helpers compose, return locally and preserve parameter isolation", () => {
  const demo = readFileSync(new URL("../../examples/functions-test.ts", import.meta.url), "utf8");
  assert.deepEqual(evaluate(demo), ["Totaal: 121", "Eerste: 7; leeg: -1", "Parameter: 11; origineel: 10", "Helper: actief", "Na helpers: 0"]);
  const compiled = compile(demo);
  assert.deepEqual(parse(buildPlist(compiled.workflow)), compiled.workflow);
  assert.ok(!compiled.workflow.WFWorkflowActions.some(a => /\.(output|exit)$/.test(a.WFWorkflowActionIdentifier)));
  const stack: unknown[] = [];
  for (const action of compiled.workflow.WFWorkflowActions) {
    const p = action.WFWorkflowActionParameters;
    if (p.WFControlFlowMode === 0) stack.push(p.GroupingIdentifier);
    if (p.WFControlFlowMode === 1) assert.equal(p.GroupingIdentifier, stack.at(-1));
    if (p.WFControlFlowMode === 2) assert.equal(p.GroupingIdentifier, stack.pop());
  }
  assert.deepEqual(stack, []);
});

test("arguments are evaluated once left to right, including nested calls to the same helper", () => {
  assert.deepEqual(evaluate(source(
    'function add(a: number, b: number): number { return a + b; }',
    'await showResult(add(await askNumber("a"), add(await askNumber("b"), await askNumber("c"))));'
  ), [1, 20, 300]), [321]);
});

test("each call in a repeat resets result and return state; fallback returns do not replace earlier returns", () => {
  assert.deepEqual(evaluate(source(
    'function choose(n: number): string { if (n > 0) { return "positive"; } return "other"; }',
    'for (const n of [2, -1, 3]) { await showResult(choose(n)); }'
  )), ["positive", "other", "positive"]);
});

test("nested loops and trailing effects are skipped after a helper return", () => {
  assert.deepEqual(evaluate(source(
    `async function search(): Promise<number> {
      for (const a of [1, 2]) {
        for (const b of [3, 4]) {
          if (b === 3) { return a + b; }
          await showResult("wrong-inner");
        }
        await showResult("wrong-outer");
      }
      await showResult("wrong-tail"); return 99;
    }`,
    'await showResult(await search()); await showResult("continued");'
  )), [4, "continued"]);
});

test("ignored return values still evaluate awaited actions and do not stop main", () => {
  assert.deepEqual(evaluate(source(
    'async function ask(): Promise<number> { return await askNumber("once"); } async function display(): Promise<void> { return await showResult("void result"); }',
    'await ask(); await display(); await showResult("continued");'
  ), [42]), ["void result", "continued"]);
});

test("helper call scopes are lexical and allow parameter/local shadowing without leaking assignments", () => {
  assert.deepEqual(evaluate(source(
    'function step(n: number): number { { let n = 99; n++; } n += 1; return n; }',
    'let n = 5; const a = step(n); const b = step(a); await showResult(`${n},${a},${b}`);'
  )), ["5,6,7"]);
  assert.throws(() => compile(source('function wrong(): number { return secret; }', 'const secret = 2; await showResult(wrong());')), /Unknown variable 'secret'/);
});

test("helpers return typed objects and lists that can be consumed by the caller", () => {
  assert.deepEqual(evaluate(source(
    'function profile(n: number): { score: number; name: string } { return { score: n, name: "Ada" }; } function scores(n: number): number[] { return [n, n + 1]; }',
    'const p = profile(7); await showResult(`${p.name}:${p.score}`); for (const n of scores(p.score)) { await showResult(n); }'
  )), ["Ada:7", 7, 8]);
});

test("helpers can run inside repeat callbacks and return without stopping the callback", () => {
  assert.deepEqual(evaluate(source(
    'async function skip(): Promise<void> { return; }',
    'await repeat(2, async () => { await skip(); await showResult("body"); });'
  )), ["body", "body"]);
});

test("helper return flags do not hide main's native Stop and Output", () => {
  const result = compile(source('function f(): number { return 7; }', 'return f();'));
  assert.equal(result.workflow.WFWorkflowActions.at(-1)?.WFWorkflowActionIdentifier, "is.workflow.actions.output");
});

test("ignored shortcut-input return is supported without turning it into an action call", () => {
  assert.doesNotThrow(() => compile(source('function f(): string { return input<string>(); }', 'f(); await showResult("done");')));
});

for (const [helpers, body, error] of [
  ['function f(n: number): number { return f(n); }', 'await showResult(f(1));', /Recursive helper.*f → f/],
  ['function a(): number { return b(); } function b(): number { return a(); }', 'await showResult(a());', /Recursive helper.*a → b → a/],
  ['async function f(): Promise<number> { return 1; }', 'const n = f();', /must be awaited/],
  ['function f(): void { return; }', 'const n = f();', /no supported return value/],
  ['function f(n: number): number { return n; }', 'await showResult(f());', /expects 1 arguments/],
  ['function f(n: number): number { return n; }', 'await showResult(f("bad"));', /TS2345/],
  ['function f(n = 2): number { return n; }', 'await showResult(f());', /without defaults/],
  ['function f<T>(n: T): T { return n; }', 'await showResult(f(1));', /Generic helper/],
  ['function f(n: number): number { if (n > 1) { return n; } }', 'await showResult(f(1));', /TS2366/],
  ['function f(): number { return 1; }', 'const f = "shadow"; await showResult(f());', /Unsupported expression/],
  ['function f(): number { return 1; } function f(): number { return 2; }', 'await showResult(f());', /Duplicate function/],
  ['function showResult(): number { return 1; }', 'await showResult("bad");', /Duplicate function\/import/],
] as const) {
  test(`rejects unsupported helper use: ${body} ${helpers}`, () => {
    assert.throws(() => compile(source(helpers, body), { filename: "functions.ts" }), error);
  });
}
