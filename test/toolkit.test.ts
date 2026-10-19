import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { build, parse } from "plist";
import { compile } from "../src/compiler.js";
import { workflowToTypeScript } from "../src/importer.js";
import { readCatalog, searchActions } from "../src/catalog.js";
import type { NativeAction } from "../src/model.js";

const source = (body: string, result = "void") => `import { native, raw, text, attachment, input, showResult, askNumber, repeat, menu, splitText, joinText, chooseFromList, quickLook, currentDate, formatDate, getJson } from "@js-shortcuts/ios";
export default async function main(): Promise<${result}> { ${body} }`;
const list = (body: string, result = "void") => compile(source(body, result)).workflow.WFWorkflowActions;
const params = (actions: NativeAction[], id: string) => actions.filter(a => a.WFWorkflowActionIdentifier === `is.workflow.actions.${id}`).map(a => a.WFWorkflowActionParameters);
function get(value: unknown, ...keys: (string | number)[]): unknown {
  for (const key of keys) {
    assert.ok(value !== null && typeof value === "object");
    value = (value as Record<string | number, unknown>)[key];
  }
  return value;
}

test("native actions retain arbitrary first/third-party identifiers and exact raw structures", () => {
  const data = { IntentAppDefinition: { Identifier: "Example", Parameters: [{ Name: "message", Value: "hi" }] }, UUID: "FIXED", WFNumber: 7, Flag: true };
  const result = list(`await native("com.example.app.SendIntent", raw(${JSON.stringify(data)}));`);
  assert.equal(result[0].WFWorkflowActionIdentifier, "com.example.app.SendIntent");
  assert.deepEqual(result[0].WFWorkflowActionParameters, data);
});

test("native text and attachment wrappers preserve tokens and opaque content", () => {
  const actions = list(`const file = await native("com.example.app.GetFile", {});
    await native("com.example.app.UseFile", { file: attachment(file), label: text(file) });`);
  const p = actions.map(a => a.WFWorkflowActionParameters);
  assert.equal(get(p[1], "file", "WFSerializationType"), "WFTextTokenAttachment");
  assert.equal(get(p[1], "file", "Value", "OutputUUID"), p[0].UUID);
  assert.equal(get(p[1], "label", "WFSerializationType"), "WFTextTokenString");
  assert.equal(get(p[1], "label", "Value", "attachmentsByRange", "{0, 1}", "OutputUUID"), p[0].UUID);
});

test("native parameter objects preserve static numeric/boolean/array values and dynamic nesting", () => {
  const actions = list('const n = await askNumber("n"); await native("com.example.Action", { nested: { enabled: true, count: n }, items: [1, "a", false] });');
  const p = actions[1].WFWorkflowActionParameters;
  assert.equal(get(p, "nested", "enabled"), true);
  assert.equal(get(p, "nested", "count", "Value", "OutputUUID"), actions[0].WFWorkflowActionParameters.UUID);
  assert.deepEqual(p.items, [1, "a", false]);
});

test("dictionary helper serializes typed HTTP headers and JSON body without sending requests", () => {
  const source = readFileSync(new URL("../../examples/native-http.ts", import.meta.url), "utf8");
  const workflow = compile(source).workflow;
  const p = params(workflow.WFWorkflowActions, "downloadurl")[0];
  assert.equal(p.WFHTTPMethod, "POST");
  assert.equal(p.WFHTTPBodyType, "JSON");
  assert.equal(get(p, "WFJSONValues", "WFSerializationType"), "WFDictionaryFieldValue");
  assert.equal(get(p, "WFJSONValues", "Value", "WFDictionaryFieldValueItems", 2, "WFItemType"), 3);
  assert.deepEqual(parse(build(workflow)), workflow);
});

test("dynamic objects in array literals use native JSON construction instead of text coercion", () => {
  const actions = list('const data = await getJson<{ name: string }>("https://offline.invalid"); const values = [data]; await quickLook(values);');
  assert.equal(params(actions, "detect.dictionary").length, 1);
  assert.equal(params(actions, "getvalueforkey").at(-1)?.WFDictionaryKey, "__value");
});

test("native action outputs accept explicit number, boolean, object and list types", () => {
  const actions = list(`const data = await native<{ n: number; ok: boolean; names: string[] }>("com.example.Action", {});
    if (data.ok && data.n >= 2) { for (const name of data.names) { await showResult(name); } }`);
  assert.equal(params(actions, "getvalueforkey").length, 3);
  assert.equal(params(actions, "repeat.each").length, 2);
});

test("workflow settings and typed shortcut input become native metadata and references", () => {
  const result = compile(`import { input, showResult } from "@js-shortcuts/ios";
    export const shortcut = { WFWorkflowName: "Share test", WFWorkflowTypes: ["ActionExtension"], WFWorkflowInputContentItemClasses: ["WFStringContentItem"] };
    export default async function main() { const value = input<string>(); await showResult(value); }`);
  assert.equal(result.workflow.WFWorkflowName, "Share test");
  assert.equal(result.workflow.WFWorkflowHasShortcutInputVariables, true);
  assert.deepEqual(result.workflow.WFWorkflowTypes, ["ActionExtension"]);
  assert.equal(get(result.workflow.WFWorkflowActions[0], "WFWorkflowActionParameters", "WFVariable", "Value", "Type"), "ExtensionInput");
});

test("dictionary fields use the device-verified number/boolean/nested serialization", () => {
  const actions = list('const d = { text: "hi", n: 42, ok: true, child: { city: "Amsterdam" }, tags: ["a", "b"] }; await showResult(d.n);');
  const dictionaries = params(actions, "dictionary");
  const items = get(dictionaries.at(-1), "WFItems", "Value", "WFDictionaryFieldValueItems");
  assert.equal(get(items, 0, "WFValue", "WFSerializationType"), "WFTextTokenString");
  assert.equal(get(items, 1, "WFItemType"), 3);
  assert.equal(get(items, 1, "WFValue", "Value", "string"), "42");
  assert.equal(get(items, 2, "WFValue", "WFSerializationType"), "WFNumberSubstitutableState");
  assert.equal(get(items, 2, "WFValue", "Value"), 1);
  assert.equal(get(items, 3, "WFItemType"), 1);
  assert.equal(get(items, 3, "WFValue", "Value", "WFSerializationType"), "WFDictionaryFieldValue");
  assert.equal(get(items, 4, "WFValue", "WFSerializationType"), "WFArrayParameterState");
});

test("let reads snapshot the runtime variable and assignments survive branches/repeats", () => {
  const actions = list('let n = 1; const saved = n; if (n >= 1) { n += 2; } await repeat(2, async () => { n++; }); await showResult(saved); await showResult(n);');
  const sets = params(actions, "setvariable");
  assert.equal(sets.length, 3);
  assert.equal(new Set(sets.map(p => p.WFVariableName)).size, 1);
  const reads = params(actions, "getvariable");
  const results = params(actions, "showresult");
  assert.equal(get(results[0], "Text", "Value", "attachmentsByRange", "{0, 1}", "OutputUUID"), reads[0].UUID);
  assert.equal(get(results[1], "Text", "Value", "attachmentsByRange", "{0, 1}", "OutputUUID"), reads.at(-1)?.UUID);
});

test("nested shadowed let bindings have separate native variable names", () => {
  const actions = list('let n = 1; { let n = 2; n++; await showResult(n); } n++; await showResult(n);');
  const sets = params(actions, "setvariable");
  assert.notEqual(sets[0].WFVariableName, sets[1].WFVariableName);
  assert.equal(sets[1].WFVariableName, sets[2].WFVariableName);
  assert.equal(sets[0].WFVariableName, sets[3].WFVariableName);
});

test("math maps all six operations, including the scientific parameter variants", () => {
  const actions = list('const a = 2 + 3; const b = a - 1; const c = b * 2; const d = c / 2; const e = d % 3; const f = e ** 2; await showResult(-f);');
  const p = params(actions, "math");
  assert.deepEqual(p.slice(0, 6).map(v => v.WFMathOperation), ["+", "-", "×", "÷", "…", "…"]);
  assert.equal(p[4].WFScientificMathOperation, "Modulus");
  assert.equal(p[5].WFScientificMathOperation, "x^y");
  assert.equal(p[5].WFScientificMathOperand, 2);
});

test("numeric comparisons coerce input to Number and retain both comparison parameter fields", () => {
  const actions = list('const d = { enabled: true, n: 3 }; if (d.enabled && d.n >= 2) { await showResult("yes"); }');
  const p = params(actions, "conditional").filter(p => p.WFControlFlowMode === 0);
  assert.deepEqual(p.map(p => p.WFCondition), [4, 3]);
  assert.equal(get(p[0], "WFInput", "Variable", "Value", "Aggrandizements", 0, "CoercionItemClass"), "WFNumberContentItem");
  assert.equal(p[0].WFNumberValue, 1);
  assert.equal(p[0].WFConditionalActionString, "1");
});

test("boolean and ternary expressions compile as lazy branches; RHS actions stay inside guards", () => {
  const result = compile(source('const n = await askNumber("n"); const ok = n >= 2; const label = ok ? "yes" : "no"; if (!ok || (await askNumber("rhs")) > 0) { await showResult(label); }'));
  const json = JSON.stringify(result.ir);
  assert.match(json, /numeric-if/);
  const outer = result.ir.at(-1)!;
  assert.equal(outer.kind, "numeric-if");
  if (outer.kind !== "numeric-if") return;
  assert.equal(outer.then[0].kind, "native");
  assert.match(JSON.stringify(outer.then), /rhs/);
});

test("list indices are zero-based in TS and list length uses native Count", () => {
  const actions = list('const xs = [2, 3]; await showResult(xs[1]); await showResult(xs.length);');
  assert.equal(params(actions, "getitemfromlist")[0].WFItemIndex, 2);
  assert.equal(params(actions, "count")[0].WFCountType, "Items");
});

test("primitive JSON fields and number lists are supported", () => {
  assert.doesNotThrow(() => list('const data = await getJson<{ n: number; ok: boolean; xs: number[] }>("https://offline.invalid"); if (data.ok) { await showResult(data.n); } for (const n of data.xs) { await showResult(n); }'));
});

test("repeat zero omits the body; positive counts use native repeat groups", () => {
  const actions = list('await repeat(0, async () => { await showResult("never"); }); await repeat(3, async () => { await showResult("yes"); });');
  assert.equal(params(actions, "showresult").length, 1);
  const p = params(actions, "repeat.count");
  assert.equal(p[0].WFRepeatCount, 3);
  assert.equal(p[0].GroupingIdentifier, p[1].GroupingIdentifier);
});

test("dynamic repeat counts are guarded against zero and negative values", () => {
  const actions = list('const n = await askNumber("n"); await repeat(n, async () => { await showResult("yes"); });');
  const guard = params(actions, "conditional")[0];
  assert.equal(guard.WFCondition, 2);
  assert.equal(guard.WFNumberValue, 0);
});

test("else-if and compound assignment retain lexical scope and native control groups", () => {
  const actions = list('let n = 0; if (n === 1) { n = 4; } else if (n === 2) { n *= 3; } else { n -= 1; } await showResult(n);');
  assert.equal(params(actions, "conditional").filter(p => p.WFControlFlowMode === 0).length, 2);
  assert.equal(new Set(params(actions, "setvariable").map(p => p.WFVariableName)).size, 1);
});

test("menu cases have labels and balanced control-flow groups", () => {
  const actions = list('await menu("Choose", { One: async () => { await showResult("1"); }, Two: async () => { await showResult("2"); } });');
  const p = params(actions, "choosefrommenu");
  assert.deepEqual(p.map(p => p.WFControlFlowMode), [0, 1, 1, 2]);
  assert.equal(new Set(p.map(p => p.GroupingIdentifier)).size, 1);
  assert.deepEqual(p[0].WFMenuItems, ["One", "Two"]);
  assert.equal(p[2].WFMenuItemTitle, "Two");
});

test("return with output and early return map to distinct native stop actions", () => {
  assert.equal(list('return 42;', "number").at(-1)?.WFWorkflowActionIdentifier, "is.workflow.actions.output");
  assert.equal(list('return;').at(-1)?.WFWorkflowActionIdentifier, "is.workflow.actions.exit");
});

test("wrapper outputs retain number, list and opaque content types", () => {
  const actions = list('const n = await askNumber("N"); const words = await splitText("a,b", ","); const first = await chooseFromList(words, "Pick"); const date = await currentDate(); const formatted = await formatDate(date, "yyyy"); await showResult(first); await showResult(n); await quickLook(date);');
  assert.equal(params(actions, "ask")[0].WFInputType, "Number");
  assert.equal(params(actions, "text.split")[0].WFTextSeparator, "Custom");
  assert.equal(params(actions, "choosefromlist")[0].WFChooseFromListActionSelectMultiple, false);
  assert.equal(params(actions, "format.date")[0].WFDateFormatStyle, "Custom");
});

test("import -> TypeScript -> workflow preserves complete tested workflows byte-for-byte as JSON", () => {
  for (const name of ["ios26-visible-workflow", "ios26-loops-workflow", "ios26-http-workflow", "ios26-toolkit-workflow", "ios26-toolkit-edges-workflow", "ios26-functions-workflow", "ios26-control-flow-workflow", "ios26-array-methods-workflow", "ios26-switch-numeric-workflow", "ios26-dictionaries-workflow", "ios26-catalog-actions-workflow", "ios26-text-comparisons-workflow", "ios26-switch-text-workflow", "ios26-dynamic-text-workflow", "ios26-array-search-workflow", "ios26-flow-callbacks-workflow", "ios26-dynamic-objects-workflow", "ios26-json-conversion-workflow", "ios26-request-json-workflow", "ios26-string-methods-workflow", "ios26-math-workflow", "ios26-array-composition-workflow", "ios26-object-spread-workflow", "ios26-array-copy-workflow", "ios26-array-join-workflow", "ios26-array-offset-workflow", "ios26-text-replace-workflow", "ios26-text-replace-all-workflow", "ios26-text-position-workflow", "ios26-text-predicate-position-workflow", "ios26-counted-loop-workflow"]) {
    const workflow = JSON.parse(readFileSync(new URL(`../../test/fixtures/${name}.json`, import.meta.url), "utf8"));
    assert.deepEqual(compile(workflowToTypeScript(workflow)).workflow, workflow);
  }
});

test("import refuses signed input, unknown action fields and non-plist data rather than losing it", () => {
  assert.throws(() => workflowToTypeScript({ WFWorkflowActions: [{ WFWorkflowActionIdentifier: "com.example.Action", WFWorkflowActionParameters: {}, extra: 3 }] }), /lossy import/);
  assert.throws(() => workflowToTypeScript({ WFWorkflowActions: [], unsupported: null }), /Cannot import/);
});

test("catalog searches identifiers and exposes optional parameter-key types without claiming device coverage", () => {
  const catalog = readCatalog();
  assert.equal(catalog.actions.length, 2585);
  assert.ok(searchActions("clipboard").some(a => a.id === "is.workflow.actions.getclipboard"));
  assert.match(catalog.version, /iOS 27/);
  assert.doesNotThrow(() => compile(`import { native, type NativeActionParameters } from "@js-shortcuts/ios";
    export default async function main() { await native("is.workflow.actions.gettext", { WFTextActionText: "hi" } satisfies NativeActionParameters<"is.workflow.actions.gettext">); }`));
  assert.throws(() => compile(`import { native, type NativeActionParameters } from "@js-shortcuts/ios";
    export default async function main() { await native("is.workflow.actions.gettext", { Typo: "hi" } satisfies NativeActionParameters<"is.workflow.actions.gettext">); }`), /TS2353/);
});

test("CLI import writes reviewable TS and refuses to overwrite an existing file", () => {
  const dir = mkdtempSync(join(tmpdir(), "ts-shortcuts-import-"));
  try {
    const input = join(dir, "test.json"), output = join(dir, "test.ts");
    writeFileSync(input, JSON.stringify(compile(source('await showResult("hello");')).workflow));
    const args = ["lib/src/cli.js", "import", input, "--out", output];
    const first = spawnSync(process.execPath, args, { encoding: "utf8" });
    assert.equal(first.status, 0, first.stderr);
    const saved = readFileSync(output, "utf8");
    assert.match(saved, /await native/);
    assert.equal(spawnSync(process.execPath, args, { encoding: "utf8" }).status, 1);
    assert.equal(readFileSync(output, "utf8"), saved);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

for (const [body, message] of [
  ['await native("bad", {});', /full native action identifier/],
  ['await native("com.example.Action", raw(42));', /parameters must be an object/],
  ['const x = "hi"; await native("com.example.Action", raw({ x }));', /plain property assignments/],
  ['const x = 1; x = 2;', /Only let/],
  ['let x = 1; x = "two";', /preserve.*category/],
  ['let x = x;', /before its declaration/],
  ['const x = 1; const x = 2;', /Duplicate declaration/],
  ['await repeat(-1, async () => {});', /nonnegative integer/],
  ['await repeat(1.5, async () => {});', /nonnegative integer/],
  ['await menu("x", {});', /Use menu/],
  ['await menu("x", { A: async () => {}, A: async () => {} });', /Duplicate menu/],
  ['const xs = [1,2]; await showResult(xs[-1]);', /nonnegative integer/],
  ['if (1) { await showResult("x"); }', /implicit truthiness/],
  ['const n = true; await showResult(`${n}`);', /implicit text conversion/],
  ['const a = await native("com.example.Action", {}); await showResult(a);', /native content/],
  ['await native("com.example.Action", raw({ UUID: "same" })); await native("com.example.Action", raw({ UUID: "same" }));', /Duplicate native action UUID/],
] as const) {
  test(`rejects unsupported toolkit syntax: ${body}`, () => assert.throws(() => compile(source(body)), message));
}
