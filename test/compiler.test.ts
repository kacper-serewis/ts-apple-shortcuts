import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { build, parse } from "plist";
import { compile } from "../src/compiler.js";

const source = (body: string) => `import { askText, showResult, notify, speak } from "@js-shortcuts/ios";
export default async function main() { ${body} }`;
const actionList = (code: string) => compile(code, { filename: "fixture.js" }).workflow.WFWorkflowActions;

function get(value: unknown, ...keys: (string | number)[]): unknown {
  for (const key of keys) {
    assert.ok(value !== null && typeof value === "object", `Expected an object before ${key}`);
    value = (value as Record<string | number, unknown>)[key];
  }
  return value;
}
function string(value: unknown): string {
  assert.equal(typeof value, "string");
  return value as string;
}

test("visible demo has correctly wired outputs, branches, and source locations", () => {
  const result = compile(readFileSync(new URL("../../examples/visible-test.ts", import.meta.url), "utf8"));
  const list = result.workflow.WFWorkflowActions;
  assert.deepEqual(list.map(a => a.WFWorkflowActionIdentifier.split("actions.")[1]), ["ask", "gettext", "text.replace", "conditional", "showresult", "conditional", "showresult", "conditional"]);
  const params = list.map(a => a.WFWorkflowActionParameters);
  const inputId = params[0].UUID;
  assert.equal(get(params[1], "WFTextActionText", "Value", "attachmentsByRange", "{3, 1}", "OutputUUID"), inputId);
  assert.equal(get(params[2], "WFInput", "WFSerializationType"), "WFTextTokenString");
  assert.equal(get(params[2], "WFInput", "Value", "attachmentsByRange", "{0, 1}", "OutputUUID"), params[1].UUID);
  assert.equal(get(params[3], "WFInput", "Variable", "Value", "OutputUUID"), params[2].UUID);
  assert.deepEqual([params[3], params[5], params[7]].map(p => p.WFControlFlowMode), [0, 1, 2]);
  assert.equal(new Set([params[3], params[5], params[7]].map(p => p.GroupingIdentifier)).size, 1);
  assert.equal(result.sourceMap.length, list.length);
  assert.equal(result.sourceMap[0].line, 4);
  for (const p of [params[4], params[6]]) {
    const attachments = get(p, "Text", "Value", "attachmentsByRange");
    assert.ok(attachments && typeof attachments === "object");
    assert.equal(get(Object.values(attachments)[0], "OutputUUID"), inputId);
  }
  assert.deepEqual(parse(build(result.workflow)), result.workflow);
});

test("template ranges use UTF-16 positions and preserve repeated references", () => {
  const list = actionList(source('const x = await askText("?"); await showResult(`😀${x}/${x}`);'));
  const value = get(list[1], "WFWorkflowActionParameters", "Text", "Value");
  assert.equal(get(value, "string"), "😀\uFFFC/\uFFFC");
  const attachments = get(value, "attachmentsByRange");
  assert.ok(attachments && typeof attachments === "object");
  assert.deepEqual(Object.keys(attachments), ["{2, 1}", "{4, 1}"]);
});

test("equality is anchored, escaped, case-sensitive and handles empty strings", () => {
  for (const literal of ["Kacper", "", "a.*(b)[c]\\d$", "line\n"]) {
    const list = actionList(source(`const x = await askText("?"); if (x === ${JSON.stringify(literal)}) { await showResult("yes"); }`));
    const match = list.find(a => a.WFWorkflowActionIdentifier.endsWith(".text.replace"))!.WFWorkflowActionParameters;
    assert.equal(match.WFReplaceTextCaseSensitive, true);
    assert.equal(match.WFReplaceTextRegularExpression, true);
    assert.equal(match.WFReplaceTextReplace, "TS_MATCH");
    const pattern = string(match.WFReplaceTextFind);
    assert.ok(pattern.startsWith("\\AJS:"));
    assert.ok(pattern.endsWith("\\z"));
    // Translate only ICU's absolute anchors for an independent JS behavior check.
    const regexp = new RegExp(`^${pattern.slice(2, -2)}$(?![\\s\\S])`, "u");
    assert.equal(regexp.test(`JS:${literal}`), true);
    assert.equal(regexp.test(`JS:${literal}\n`), false);
    assert.equal(regexp.test(`JS:prefix${literal}`), false);
    if (literal === "Kacper") assert.equal(regexp.test("JS:kacper"), false);
  }
  const list = actionList(source('if ("x" !== "y") { await showResult("yes"); }'));
  const condition = list.find(a => a.WFWorkflowActionIdentifier.endsWith(".conditional"))!.WFWorkflowActionParameters;
  assert.equal(condition.WFCondition, 5);
  assert.equal(condition.WFConditionalActionString, "TS_MATCH");
  assert.equal(get(condition, "WFInput", "Variable", "Value", "Aggrandizements", 0, "CoercionItemClass"), "WFStringContentItem");
});

test("nested conditionals have independent groups and lexical scopes", () => {
  const list = actionList(source('const x = "outer"; if (x === "outer") { const x = "inner"; if (x === "inner") { await showResult(x); } } await showResult(x);'));
  const starts = list.filter(a => a.WFWorkflowActionParameters.WFControlFlowMode === 0);
  assert.equal(starts.length, 2);
  assert.notEqual(starts[0].WFWorkflowActionParameters.GroupingIdentifier, starts[1].WFWorkflowActionParameters.GroupingIdentifier);
  assert.deepEqual(list.filter(a => a.WFWorkflowActionIdentifier.endsWith(".showresult")).map(a => a.WFWorkflowActionParameters.Text), ["inner", "outer"]);
});

test("action aliases resolve statically without executing JavaScript", () => {
  const list = actionList('import { showResult as display } from "@js-shortcuts/ios"; export default async function main() { await display("hello"); }');
  assert.equal(list[0].WFWorkflowActionParameters.Text, "hello");
});

test("speaking and notification use the correct native parameters", () => {
  const list = actionList(source('await speak("hello"); await notify("done");'));
  assert.equal(list[0].WFWorkflowActionParameters.WFText, "hello");
  assert.equal(list[0].WFWorkflowActionParameters.WFSpeakTextWait, true);
  assert.equal(list[1].WFWorkflowActionParameters.WFNotificationActionBody, "done");
});

for (const [body, message] of [
  ['await showResult(missing);', /Unknown variable/],
  ['showResult("hi");', /await action/],
  ['const x = await notify("hi");', /no supported return value/],
  ['await askText();', /exactly one/],
  ['if ("a" == "b") {}', /text comparison/],
  ['while (true) {}', /Unsupported statement/],
  ['const x = "a"; { await showResult(x); const x = "b"; }', /before its declaration/],
  ['{ const x = "a"; } await showResult(x);', /Unknown variable/],
  ['const showResult = "x"; await showResult("a");', /Only imported/],
  ['await showResult("\\u0000");', /cannot represent/],
  ['await showResult("\\ud800");', /cannot represent/],
] as const) {
  test(`rejects unsupported or unsafe source: ${body}`, () => {
    assert.throws(() => compile(source(body), { filename: "input.js" }), error => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /input\.js:\d+:\d+:/);
      assert.match(error.message, message);
      return true;
    });
  });
}

test("arbitrary modules and top-level code are rejected", () => {
  assert.throws(() => compile('import fs from "node:fs"; export default async function main() {}'), /Only named imports/);
  assert.throws(() => compile('throw new Error("executed");'), /module level/);
  assert.throws(() => compile('export default function main() {}'), /default async/);
});

test("CLI produces parseable XML and inspection JSON without signing", () => {
  const dir = mkdtempSync(join(tmpdir(), "js-shortcuts-test-"));
  try {
    const output = join(dir, "test file");
    const result = spawnSync(process.execPath, ["lib/src/cli.js", "examples/visible-test.ts", "--out", output], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    const xml = parse(readFileSync(`${output}.unsigned.plist`, "utf8"));
    const json = JSON.parse(readFileSync(`${output}.json`, "utf8"));
    assert.deepEqual(xml, json.workflow);
    assert.equal(existsSync(`${output}.shortcut`), false);
    const bad = spawnSync(process.execPath, ["lib/src/cli.js", "examples/visible-test.ts", "--mode", "invalid"], { encoding: "utf8" });
    assert.equal(bad.status, 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
