import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { compile } from "../src/compiler.js";
import { evaluate } from "./support/evaluate.js";

const source = (body: string, helpers = "") => `import { repeat, menu, showResult, askNumber } from "@js-shortcuts/ios";
${helpers}
export default async function main() { ${body} }`;

test("repeat exposes zero-based indices, isolated from parameter mutations and outer shadowed bindings", () => {
  assert.deepEqual(evaluate(source(`let index = 40; let trace = "";
    await repeat(3, async index => { trace += index; index += 10; trace += \`:\${index};\`; });
    await showResult(trace); await showResult(index);`)), ["0:10;1:11;2:12;", 40]);
});

test("a local repeat return skips only that iteration and advances the counter", () => {
  assert.deepEqual(evaluate(source(`let trace = "";
    await repeat(4, async i => { if (i === 1) { return; } trace += i; });
    await showResult(trace); await showResult("after");`)), ["023", "after"]);
});

test("return without an index still resets on every iteration and avoids later prompts", () => {
  assert.deepEqual(evaluate(source(`let n = 0;
    await repeat(3, async () => { n++; if (n < 3) { return; } await showResult(n); return; await askNumber("wrong"); });
    await showResult(n);`)), [3, 3]);
});

test("returns from a repeat's nested loops stop both loops but preserve later iterations", () => {
  assert.deepEqual(evaluate(source(`let trace = "";
    await repeat(2, async i => {
      for (const x of [1, 2, 3]) { for (const y of [1, 2, 3]) {
        trace += \`\${i}\${x}\${y};\`; if (y === 2) { return; }
      } trace += "wrong"; }
      await askNumber("wrong");
    }); await showResult(trace);`)), ["011;012;111;112;"]);
});

test("nested repeats have independent counters and return frames", () => {
  assert.deepEqual(evaluate(source(`let trace = "";
    await repeat(2, async i => {
      await repeat(3, async j => { if (j === 1) { return; } trace += \`\${i}\${j};\`; });
      trace += "end;";
    }); await showResult(trace);`)), ["00;02;end;10;12;end;"]);
});

test("repeat count is evaluated once before parameter scope and a captured count mutation", () => {
  assert.deepEqual(evaluate(source(`let count = 3; let trace = "";
    await repeat(count, async count => { trace += count; count = 99; });
    await repeat(count, async i => { count = 0; trace += i; });
    await repeat(await askNumber("count"), async i => { trace += i; });
    await showResult(trace); await showResult(count);`), [2]), ["01201201", 0]);
});

test("zero and negative dynamic repeat counts invoke no callback", () => {
  assert.deepEqual(evaluate(source(`await repeat(0, async i => { await showResult(i); });
    await repeat(await askNumber("count"), async i => { await showResult(i); return; });
    await showResult("after");`), [-2]), ["after"]);
});

test("menu returns leave the selected case and retain effects and code after the menu", () => {
  const code = source(`let n = 0;
    await menu("Choice", {
      First: async () => { n++; return; await askNumber("wrong"); },
      Second: async () => { n += 2; },
    }); await showResult(n); await showResult("after");`);
  assert.deepEqual(evaluate(code, [], ["First"]), [1, "after"]);
  assert.deepEqual(evaluate(code, [], ["Second"]), [2, "after"]);
});

test("menu return from nested loops and switch prevents fallthrough effects", () => {
  assert.deepEqual(evaluate(source(`let n = 0;
    await menu("Choice", { Pick: async () => {
      for (const x of [1, 2]) { switch (x) { case 1: n++; return; default: n += 100; } }
      await askNumber("wrong");
    } }); await showResult(n);`), [], ["Pick"]), [1]);
});

test("menu inside repeat has a separate return frame, reset for each selected branch invocation", () => {
  assert.deepEqual(evaluate(source(`let trace = "";
    await repeat(3, async i => {
      await menu("Choice", { Pick: async () => { trace += i; if (i < 2) { return; } trace += "last"; } });
      trace += ";";
    }); await showResult(trace);`), [], ["Pick", "Pick", "Pick"]), ["0;1;2last;"]);
});

test("repeat inside menu and helper returns do not terminate their caller", () => {
  assert.deepEqual(evaluate(source(`await showResult(await helper());`, `async function helper(): Promise<number> {
    await menu("Choice", { Pick: async () => {
      await repeat(2, async () => { return; }); await showResult("case"); return;
    } }); return 42;
  }`), [], ["Pick"]), ["case", 42]);
});

test("return await action preserves the action effect and exits locally", () => {
  assert.deepEqual(evaluate(source(`await repeat(2, async i => { return await showResult(i); await askNumber("wrong"); });
    await menu("Choice", { Pick: async () => { return await showResult("case"); } });
    await showResult("after");`), [], ["Pick"]), [0, 1, "case", "after"]);
});

test("parenthesized callbacks compile and generic callbacks are rejected", () => {
  assert.deepEqual(evaluate(source('await repeat(1, (async i => { await showResult(i); return; })); await menu("x", { A: (async () => { return; }) });'), [], ["A"]), [0]);
  assert.throws(() => compile(source('await repeat(1, async <T>() => {});')), /Use repeat/);
  assert.throws(() => compile(source('await menu("x", { A: async <T>() => {} });')), /Menu cases/);
});

test("native callback demo produces both expected menu branches", () => {
  const code = readFileSync(new URL("../../examples/flow-callbacks-test.ts", import.meta.url), "utf8");
  const prefix = ["Index: 0:10;2:12;3:13;", "Genest: 00;02;eind;10;12;eind;"];
  assert.deepEqual(evaluate(code, [], ["Vroeg stoppen"]), [...prefix, "Menu: start;", "Na menu; leeg: 0"]);
  assert.deepEqual(evaluate(code, [], ["Doorgaan"]), [...prefix, "Menu: start;klaar;", "Na menu; leeg: 0"]);
  const actions = compile(code).workflow.WFWorkflowActions;
  assert.ok(!actions.some(a => /\.(exit|output)$/.test(a.WFWorkflowActionIdentifier)), "Local returns must not emit Stop/Output");
});

for (const [body, error] of [
  ['await repeat(1, async (i = 0) => {});', /plain parameter/],
  ['await repeat(1, async (i?: number) => {});', /plain parameter/],
  ['await repeat(1, async (...i) => {});', /plain parameter/],
  ['await repeat(1, async (a, b) => {});', /Use repeat/],
  ['await repeat(1, async i => { return 2; });', /TS2345/],
  ['await menu("x", { A: async () => { return 2; } });', /TS2322/],
  ['for (const n of [1]) { await repeat(1, async () => { break; }); }', /enclosing supported loop/],
  ['for (const n of [1]) { await menu("x", { A: async () => { continue; } }); }', /enclosing supported loop/],
  ['await repeat(1, async (i: string) => { await showResult(i); });', /TS2345/],
] as const) {
  test(`reject invalid native callback: ${body}`, () => assert.throws(() => compile(source(body)), error));
}
