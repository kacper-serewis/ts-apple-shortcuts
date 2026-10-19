import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { build, parse } from "plist";
import { compile } from "../src/compiler.js";

const source = (body: string) => `import { askText, showResult } from "@js-shortcuts/ios";
export default async function main(): Promise<void> { ${body} }`;
function get(value: unknown, ...keys: (string | number)[]): unknown {
  for (const key of keys) {
    assert.ok(value !== null && typeof value === "object");
    value = (value as Record<string | number, unknown>)[key];
  }
  return value;
}

test("string arrays become native lists and repeat blocks with source mapping", () => {
  const result = compile(readFileSync(new URL("../../examples/loops.ts", import.meta.url), "utf8"));
  const list = result.workflow.WFWorkflowActions;
  assert.deepEqual(list.map(a => a.WFWorkflowActionIdentifier), ["list", "repeat.each", "showresult", "repeat.each"].map(a => `is.workflow.actions.${a}`));
  const p = list.map(a => a.WFWorkflowActionParameters);
  assert.deepEqual(p[0].WFItems, ["Kacper", "Ada"]);
  assert.equal(get(p[1], "WFInput", "Value", "OutputUUID"), p[0].UUID);
  assert.equal(get(p[2], "Text", "Value", "attachmentsByRange", "{4, 1}", "OutputUUID"), p[1].UUID);
  assert.equal(p[1].GroupingIdentifier, p[3].GroupingIdentifier);
  assert.deepEqual([p[1].WFControlFlowMode, p[3].WFControlFlowMode], [0, 2]);
  assert.deepEqual(result.sourceMap.map(s => s.line), [4, 5, 6, 5]);
  assert.deepEqual(parse(build(result.workflow)), result.workflow);
});

test("nested loops keep outer references and aliases bound to their own iterations", () => {
  const result = compile(source(`
    for (const name of ["outer"]) {
      const saved = name;
      for (const name of ["inner"]) {
        await showResult(\`\${saved}/\${name}\`);
      }
      await showResult(name);
    }`));
  const p = result.workflow.WFWorkflowActions.map(a => a.WFWorkflowActionParameters);
  const tokens = get(p[4], "Text", "Value", "attachmentsByRange");
  assert.equal(get(tokens, "{0, 1}", "OutputUUID"), p[1].UUID);
  assert.equal(get(tokens, "{2, 1}", "OutputUUID"), p[3].UUID);
  assert.notEqual(p[1].GroupingIdentifier, p[3].GroupingIdentifier);
  assert.equal(p[5].GroupingIdentifier, p[3].GroupingIdentifier);
  assert.equal(p[7].GroupingIdentifier, p[1].GroupingIdentifier);
  assert.equal(get(p[6], "Text", "Value", "attachmentsByRange", "{0, 1}", "OutputUUID"), p[1].UUID);
});

test("list literals evaluate action expressions once, in source order, and aliases reuse the list", () => {
  const result = compile(source(`const a = [await askText("First"), await askText("Second")];
    const b: readonly string[] = a;
    for (const x of b) { await showResult(x); }
    for (const x of a) { await showResult(x); }`));
  const p = result.workflow.WFWorkflowActions.map(a => a.WFWorkflowActionParameters);
  assert.equal(p[0].WFAskActionPrompt, "First");
  assert.equal(p[1].WFAskActionPrompt, "Second");
  for (const i of [0, 1]) {
    assert.equal(get(p[2], "WFItems", i, "WFItemType"), 0);
    assert.equal(get(p[2], "WFItems", i, "WFValue", "Value", "attachmentsByRange", "{0, 1}", "OutputUUID"), p[i].UUID);
  }
  assert.equal(get(p[3], "WFInput", "Value", "OutputUUID"), p[2].UUID);
  assert.equal(get(p[6], "WFInput", "Value", "OutputUUID"), p[2].UUID);
});

test("empty arrays and readonly tuples retain their native list representation", () => {
  const result = compile(source(`const empty: string[] = [];
    for (const x of empty) { await showResult(x); }
    for (const x of (["one", "two"] as const)) { await showResult(x); }`));
  const lists = result.workflow.WFWorkflowActions.filter(a => a.WFWorkflowActionIdentifier.endsWith(".list"));
  assert.deepEqual(lists.map(a => a.WFWorkflowActionParameters.WFItems), [[], ["one", "two"]]);
});

test("loops and conditionals compose with balanced independent groups", () => {
  const result = compile(readFileSync(new URL("../../examples/loops-test.ts", import.meta.url), "utf8"));
  const groups: unknown[] = [];
  for (const action of result.workflow.WFWorkflowActions) {
    const p = action.WFWorkflowActionParameters;
    if (p.WFControlFlowMode === 0) groups.push(p.GroupingIdentifier);
    if (p.WFControlFlowMode === 1) assert.equal(p.GroupingIdentifier, groups.at(-1));
    if (p.WFControlFlowMode === 2) assert.equal(p.GroupingIdentifier, groups.pop());
  }
  assert.deepEqual(groups, []);
});

for (const [body, error] of [
  ['for (const x of "abc") { await showResult(x); }', /requires a list/],
  ['for (let x of ["a"]) {}', /Use for \(const/],
  ['for await (const x of ["a"]) {}', /for await/],
  ['for (const [x] of ["a"]) {}', /requires a list/],
  ['for (const x of ["a"]) await showResult(x);', /Use braces/],
  ['for (const x of ["a"]) {} await showResult(x);', /Unknown variable/],
  ['const x = ["a"]; for (const x of x) {}', /before its declaration/],
  ['for (const x of ["a"]) { await showResult(x); const x = "b"; }', /before its declaration/],
  ['const x = [,"a"];', /Array holes/],
  ['const x = [..."abc"];', /Array spreads require a typed list/],
  ['await showResult(["a"] as unknown as string);', /Expected text, not a list/],
  ['const x = ["a"]; await showResult(`${x}`);', /Expected text, not a list/],
  ['const x = ["a"]; if (x === "a") {}', /text comparison/],
  ['const x: number[] = ["a"];', /TS2322/],
  ['const x = ["a"]; x.push("b");', /await action/],
] as const) {
  test(`rejects unsupported list/loop behavior: ${body}`, () => {
    assert.throws(() => compile(source(body), { filename: "loops.ts" }), error);
  });
}
