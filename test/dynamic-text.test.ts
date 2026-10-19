import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { compile } from "../src/compiler.js";
import { evaluate } from "./support/evaluate.js";

const source = (body: string, helpers = "") => `import { showResult, askText } from "@js-shortcuts/ios";
${helpers}
export default async function main() { ${body} }`;

test("dynamic text example preserves equality, first match, fallthrough and default semantics", () => {
  const code = readFileSync(new URL("../../examples/dynamic-text-test.ts", import.meta.url), "utf8").replace("  return;\n", "");
  assert.deepEqual(evaluate(code), ["Dynamisch: 52/52", "Verschillend: 6/6", "Cases: ABMF; waarde: changed", "Default na dynamische cases"]);
});

test("text comparison evaluates left then right once, including awaited helper actions", () => {
  assert.deepEqual(evaluate(source(`if ((await get("left", "same")) === (await get("right", "same"))) { await showResult("equal"); }`,
    'async function get(label: string, value: string): Promise<string> { await showResult(label); return value; }')), ["left", "right", "equal"]);
});

test("left text is snapshotted before a right expression changes its source variable", () => {
  assert.deepEqual(evaluate(source(`let left = "original";
    if (left === ["original"].reduce((acc, item) => { left = "changed"; return item; }, "")) { await showResult("snapshot"); }
    await showResult(left);`)), ["snapshot", "changed"]);
});

test("dynamic text comparisons compose with short-circuit logic, ternaries and negation", () => {
  assert.deepEqual(evaluate(source(`for (const value of ["a", "b"]) {
    const same = value === identity("a");
    if (same || await log("not skipped", value) === value) { await showResult(value); }
    if (!same && await log("only b", value) !== identity("a")) { await showResult("different"); }
    await showResult(value !== identity("b") ? "A" : "B");
  }`, 'function identity(value: string): string { return value; } async function log(label: string, value: string): Promise<string> { await showResult(label); return value; }')),
  ["a", "A", "not skipped", "b", "only b", "different", "B"]);
});

test("dynamic text switch stops evaluating cases after its first match but retains fallthrough", () => {
  assert.deepEqual(evaluate(source(`switch (await get("selector", "b")) {
    case await get("first", "a"): await showResult("wrong"); break;
    default: await showResult("wrong default"); break;
    case await get("second", "b"): await showResult("match");
    case await get("must skip", "c"): await showResult("fallthrough");
  }`, 'async function get(label: string, value: string): Promise<string> { await showResult(label); return value; }')),
  ["selector", "first", "second", "match", "fallthrough"]);
});

test("a dynamic case may compare the discriminant with itself", () => {
  assert.deepEqual(evaluate(source('for (const s of ["a", ""]) { switch (s) { case s: await showResult("self"); break; default: await showResult("wrong"); } }')), ["self", "self"]);
});

test("constant aliases and parenthesized/template literals retain the static equality path", () => {
  for (const right of ['("value")', '`value`', 'expected', '"val" + "ue"']) {
    const actions = compile(source(`const expected = "value"; const actual = await askText("value"); if (actual === ${right}) { await showResult("yes"); }`)).workflow.WFWorkflowActions;
    const replacements = actions.filter(a => a.WFWorkflowActionIdentifier.endsWith(".text.replace"));
    assert.equal(replacements.length, 1);
    assert.equal(replacements[0].WFWorkflowActionParameters.WFReplaceTextFind, "\\AJS:value\\z");
  }
});

test("runtime RHS is prefixed, escaped and wired as an anchored pattern token", () => {
  const actions = compile(source('const a = await askText("a"); const b = await askText("b"); if (a === b) { await showResult("yes"); }')).workflow.WFWorkflowActions;
  const replacements = actions.filter(a => a.WFWorkflowActionIdentifier.endsWith(".text.replace"));
  assert.equal(replacements.length, 2);
  const escape = replacements[0].WFWorkflowActionParameters;
  const match = replacements[1].WFWorkflowActionParameters;
  assert.equal((escape.WFInput as any).Value.string, "JS:\uFFFC");
  assert.equal((escape.WFInput as any).Value.attachmentsByRange["{3, 1}"].OutputUUID, actions[1].WFWorkflowActionParameters.UUID);
  assert.equal(escape.WFReplaceTextReplace, "\\\\$1");
  const pattern = match.WFReplaceTextFind as any;
  assert.equal(pattern.Value.string, "\\A\uFFFC\\z");
  assert.equal(pattern.Value.attachmentsByRange["{2, 1}"].OutputUUID, escape.UUID);
  assert.equal(match.WFReplaceTextReplace, "TS_MATCH");
});

test("runtime escaping covers all regex syntax characters without changing ordinary text", () => {
  const actions = compile(source('const a = await askText("a"); const b = await askText("b"); if (a === b) { await showResult("yes"); }')).workflow.WFWorkflowActions;
  const escape = actions.find(a => a.WFWorkflowActionIdentifier.endsWith(".text.replace"))!.WFWorkflowActionParameters;
  // Translate ICU's replacement escape for this independent JS behavior check.
  const regex = new RegExp(escape.WFReplaceTextFind as string, "gu");
  const values = ["", ".*+?^${}()|[]\\", "\\E\\Q", "$1", "é", "e\u0301", "😀", "line\n", "TS_MATCH"];
  for (const expected of values) {
    const escaped = `JS:${expected}`.replace(regex, "\\$1");
    const match = new RegExp(`^${escaped}$(?![\\s\\S])`, "u");
    for (const actual of values) assert.equal(match.test(`JS:${actual}`), actual === expected);
  }
});

for (const body of ['const a = await askText("a"); if (a === 1) {}', 'const a = await askText("a"); if (a < "b") {}', 'const a = await askText("a"); if (a == "b") {}']) {
  test(`rejects unsupported text comparison: ${body}`, () => assert.throws(() => compile(source(body)), /text comparison/));
}
