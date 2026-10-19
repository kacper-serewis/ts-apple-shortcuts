import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { compile } from "../src/compiler.js";
import { evaluate } from "./support/evaluate.js";

const source = (body: string, helpers = "") => `import { showResult, askNumber, repeat, menu } from "@js-shortcuts/ios";
  ${helpers}
  export default async function main() { ${body} }`;

test("switch chooses the first case and continues after break", () => {
  assert.deepEqual(evaluate(source(`for (const n of [1, 2, 3]) {
    switch (n) {
      case 1: await showResult("one"); break; await showResult("wrong");
      case 2: await showResult("two"); break;
      default: await showResult("other");
    }
    await showResult(n);
  }`)), ["one", 1, "two", 2, "other", 3]);
});

test("fallthrough, grouped labels and default in the middle follow source order", () => {
  assert.deepEqual(evaluate(source(`for (const n of [1, 2, 3, 4, 9]) {
    let text = "";
    switch (n) {
      case 1:
      case 2: text += "A";
      default: text += "D";
      case 3: text += "C"; break;
      case 4: text += "E";
    }
    await showResult(text);
  }`)), ["ADC", "ADC", "C", "E", "DC"]);
});

test("no matching case without default executes no body; an empty switch evaluates its input", () => {
  assert.deepEqual(evaluate(source(`const n = await askNumber("selector");
    switch (n) { case 1: await showResult("wrong"); }
    switch (await askNumber("empty")) {}
    await showResult("done");`), [9, 2]), ["done"]);
});

test("case expressions execute only until the first match, even around default", () => {
  assert.deepEqual(evaluate(source(`switch (await askNumber("selector")) {
    case await askNumber("first"): await showResult("first"); break;
    default: await showResult("default"); break;
    case await askNumber("second"): await showResult("second");
    case await askNumber("skipped expression, but body falls through"): await showResult("tail");
  }`), [2, 1, 2]), ["second", "tail"]);
  assert.deepEqual(evaluate(source(`switch (await askNumber("selector")) {
    default: await showResult("default"); break;
    case await askNumber("must check"): await showResult("wrong");
  }`), [2, 1]), ["default"]);
});

test("the discriminant is snapshotted before case helpers mutate captured state", () => {
  assert.deepEqual(evaluate(source(`let n = 2;
    const result = [0].map(() => {
      switch (n) {
        case [1].reduce((acc, item) => { n = 9; return acc + item; }, 0): return "wrong";
        case 2: return "two";
        default: return "changed";
      }
    });
    await showResult(result[0]); await showResult(n);`)), ["two", 9]);
});

test("numeric and boolean switches retain strict scalar types", () => {
  assert.deepEqual(evaluate(source('await showResult(check(true)); await showResult(check(false));', `function check(flag: boolean): string {
    switch (flag) { case true: return "yes"; case false: return "no"; }
  }`)), ["yes", "no"]);
  assert.deepEqual(evaluate(source('for (const n of [-2, 0, 1.5]) { switch (n) { case -2: await showResult("negative"); break; case 0: await showResult("zero"); break; case 1.5: await showResult("fraction"); } }')), ["negative", "zero", "fraction"]);
});

test("text switches use literal case-sensitive equality and accept static aliases", () => {
  assert.deepEqual(evaluate(source(`const key = "a.b";
    for (const text of ["a.b", "A.B", "aXb", "", "☀️"]) {
      switch (text) {
        case key: await showResult("dot"); break;
        case "": await showResult("empty"); break;
        case "☀️": await showResult("sun"); break;
        default: await showResult("other");
      }
    }`)), ["dot", "other", "other", "empty", "sun"]);
  const actions = compile(source('for (const s of ["a.b"]) { switch (s) { case "a.b": await showResult(s); } }')).workflow.WFWorkflowActions;
  assert.ok(JSON.stringify(actions).includes("a\\\\.b"), "Native regex escapes the literal dot");
});

test("duplicate case values use the first match, with ordinary fallthrough", () => {
  assert.deepEqual(evaluate(source(`for (const n of [1, 2]) {
    switch (n) { case 1: await showResult("first"); case 1: await showResult("second"); break; default: await showResult("default"); }
  }`)), ["first", "second", "default"]);
});

test("nested switches own their break flags and preserve the surrounding case tail", () => {
  assert.deepEqual(evaluate(source(`for (const n of [1, 2]) {
    switch (n) {
      case 1:
        switch (n) { case 1: await showResult("inner"); break; default: await showResult("wrong"); }
        await showResult("outer tail"); break;
      default: await showResult("default");
    }
    await showResult("loop tail");
  }`)), ["inner", "outer tail", "loop tail", "default", "loop tail"]);
});

test("continue inside switch targets the enclosing loop, break targets only switch", () => {
  assert.deepEqual(evaluate(source(`for (const n of [1, 2, 3, 4]) {
    switch (n) {
      case 1: continue; await showResult("wrong");
      case 2: { if (n > 0) { continue; } await showResult("wrong"); }
      default: await showResult(n); break;
      case 4: break;
    }
    await showResult("tail");
  }`)), [3, "tail", "tail"]);
});

test("loops inside a switch own their jumps and do not break the switch", () => {
  assert.deepEqual(evaluate(source(`for (const n of [1, 2]) {
    switch (n) {
      case 1:
        for (const x of [1, 2, 3]) { if (x === 1) { continue; } await showResult(x); break; }
        await showResult("after inner loop");
      default: await showResult("fallthrough");
    }
    await showResult("outer tail");
  }`)), [2, "after inner loop", "fallthrough", "outer tail", "fallthrough", "outer tail"]);
});

test("helper returns in cases skip later clauses and the function tail without exiting main", () => {
  assert.deepEqual(evaluate(source('for (const n of [1, 2, 3]) { await showResult(label(n)); } await showResult("main");', `function label(n: number): string {
    switch (n) {
      case 1: { if (n > 0) { return "one"; } break; }
      case 2: return "two";
      default: break;
    }
    return "other";
  }`)), ["one", "two", "other", "main"]);
});

test("switch returns compose with loop guards and array callbacks", () => {
  assert.deepEqual(evaluate(source('await showResult(find()); const xs = [1, 2, 3].map(n => { switch (n) { case 1: return 10; default: return n; } }); await showResult(xs[0]); await showResult(xs[2]);', `function find(): number {
    for (const n of [1, 2, 3]) { switch (n) { case 1: continue; case 2: return n; default: break; } }
    return -1;
  }`)), [2, 10, 3]);
});

test("switch is allowed inside repeat callbacks with local breaks", () => {
  assert.deepEqual(evaluate(source('await repeat(2, async () => { const n: number = 1; switch (n) { case 1: await showResult("case"); break; default: await showResult("wrong"); } await showResult("callback tail"); });')), ["case", "callback tail", "case", "callback tail"]);
});

test("case blocks support independent bindings and the case scope does not shadow the discriminant", () => {
  assert.deepEqual(evaluate(source(`const n = await askNumber("once");
    switch (n) { case 1: const n = 7; await showResult(n); break; default: break; }
    await showResult(n);
    for (const x of [1, 2]) { switch (x) { case 1: { let x = 10; x++; await showResult(x); break; } default: { const x = 20; await showResult(x); } } }`), [1]), [7, 1, 11, 20]);
});

for (const [body, error] of [
  ['switch (1) { case 1: continue; }', /enclosing supported loop/],
  ['switch (1) { case 1: break outer; }', /Labeled break/],
  ['switch (1) { default: break; default: break; }', /one default/],
  ['switch ([1]) { default: break; }', /requires text, number or boolean/],
  ['switch (1) { case "1": break; }', /same value category/],
  ['switch (1) { case 1: const x = 1; break; default: const x = 2; }', /Duplicate declaration/],
  ['const x = 1; switch (x) { case x: break; default: const x = 2; }', /before its declaration/],
  ['switch (1) { case 1: await showResult(x); const x = 2; }', /before its declaration/],
  ['switch (1) { case 1: const x = 2; } await showResult(x);', /Unknown variable/],
  ['const n = await askNumber("n"); switch (n) { case 1: const x = 2; case 2: await showResult(x); }', /used before being assigned/],
  ['const n = await askNumber("n"); switch (n) { case 1: let x = 2; case 2: x++; }', /used before being assigned/],
  ['switch (1) { case 1: await repeat(1, async () => { break; }); }', /enclosing supported loop/],
] as const) {
  test(`rejects invalid switch: ${body}`, () => assert.throws(() => compile(source(body)), error));
}

test("the switch example preserves native group nesting and only main emits a stop", () => {
  const code = readFileSync(new URL("../../examples/switch-test.ts", import.meta.url), "utf8");
  assert.deepEqual(evaluate(code.replace("  return;\n}", "}")), ["Keuze: open;voer uit;", "Keuze: voer uit;", "Keuze: onbekend;", "Loop: 1;2;eind;", "Functie: twee"]);
  const actions = compile(code).workflow.WFWorkflowActions;
  const stack: unknown[] = [];
  for (const { WFWorkflowActionParameters: p } of actions) {
    if (p.WFControlFlowMode === 0) stack.push(p.GroupingIdentifier);
    if (p.WFControlFlowMode === 1) assert.equal(p.GroupingIdentifier, stack.at(-1));
    if (p.WFControlFlowMode === 2) assert.equal(p.GroupingIdentifier, stack.pop());
  }
  assert.deepEqual(stack, []);
  assert.equal(actions.filter(a => a.WFWorkflowActionIdentifier === "is.workflow.actions.exit").length, 1);
});

test("the numeric-only device example exercises default placement, fallthrough, loop control and helper return", () => {
  const code = readFileSync(new URL("../../examples/switch-numeric-test.ts", import.meta.url), "utf8");
  assert.deepEqual(evaluate(code.replace("  return;\n}", "}")), ["Loop: 1;2;D;eind;3;eind;", "Functie: twee"]);
});
