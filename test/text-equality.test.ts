import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { compile } from "../src/compiler.js";
import { evaluate } from "./support/evaluate.js";

test("text comparison example has independently evaluated strict equality outcomes", () => {
  const code = readFileSync(new URL("../../examples/text-comparisons-test.ts", import.meta.url), "utf8")
    .replace(/  await showResult\(await replaceRegex[^\n]+\n/, "")
    .replace("  return;\n", "");
  assert.deepEqual(evaluate(code), ["Exact: YNNNNN", "Leeg: YNNYNYNY", "Letterlijk: YNN", "Unicode: YNNNNNNYNN", "Marker: YNNN"]);
});

test("replacement-based text equality agrees with JS equality across adversarial inputs", () => {
  const values = ["", "open", "Open", "open\n", "open\r\n", "TS_MATCH", "JS:TS_MATCH", "js:ts_match", "é", "e\u0301", "É", "😀", "😀\n", "a.*(b)[c]\\d$", "\\E\\Q", "$1", "\u2028", "\u2029", "\t", " "];
  for (const expected of values) {
    const code = `import { askText, showResult } from "@js-shortcuts/ios";
      export default async function main() { const actual = await askText("value"); if (actual === ${JSON.stringify(expected)}) { await showResult("yes"); } }`;
    const actions = compile(code).workflow.WFWorkflowActions;
    assert.ok(!actions.some(a => a.WFWorkflowActionIdentifier.endsWith(".text.match")));
    const p = actions.find(a => a.WFWorkflowActionIdentifier.endsWith(".text.replace"))!.WFWorkflowActionParameters;
    assert.equal(p.WFReplaceTextCaseSensitive, true);
    assert.equal(p.WFReplaceTextRegularExpression, true);
    const pattern = p.WFReplaceTextFind as string;
    assert.ok(pattern.startsWith("\\AJS:") && pattern.endsWith("\\z"));
    // ICU absolute anchors translated to JS; replacements are a constant marker.
    const regex = new RegExp(`^${pattern.slice(2, -2)}$(?![\\s\\S])`, "u");
    for (const actual of values) {
      const replaced = `JS:${actual}`.replace(regex, p.WFReplaceTextReplace as string);
      assert.equal(replaced === "TS_MATCH", actual === expected, JSON.stringify({ actual, expected }));
    }
  }
});

test("both strict text comparison operators use the correct marker condition", () => {
  for (const [operator, code] of [["===", 4], ["!==", 5]] as const) {
    const result = compile(`import { askText, showResult } from "@js-shortcuts/ios";
      export default async function main() { const value = await askText("value"); if (value ${operator} "") { await showResult("yes"); } }`);
    const p = result.workflow.WFWorkflowActions.find(a => a.WFWorkflowActionIdentifier.endsWith(".conditional"))!.WFWorkflowActionParameters;
    assert.equal(p.WFCondition, code);
    assert.equal(p.WFConditionalActionString, "TS_MATCH");
    assert.deepEqual((p.WFInput as any).Variable.Value.Aggrandizements, [{ Type: "WFCoercionVariableAggrandizement", CoercionItemClass: "WFStringContentItem" }]);
  }
});

test("regex replacement wrapper retains dynamic pattern/replacement tokens and ICU options", () => {
  const result = compile(`import { askText, replaceRegex, showResult } from "@js-shortcuts/ios";
    export default async function main() {
      const pattern = await askText("pattern"); const replacement = await askText("replacement");
      await showResult(await replaceRegex("a1 b22", pattern, replacement));
    }`);
  const actions = result.workflow.WFWorkflowActions;
  const p = actions[2].WFWorkflowActionParameters;
  assert.equal(actions[2].WFWorkflowActionIdentifier, "is.workflow.actions.text.replace");
  assert.equal(p.WFReplaceTextCaseSensitive, true);
  assert.equal(p.WFReplaceTextRegularExpression, true);
  for (const [key, index] of [["WFReplaceTextFind", 0], ["WFReplaceTextReplace", 1]] as const) {
    assert.equal((p[key] as any).Value.attachmentsByRange["{0, 1}"].OutputUUID, actions[index].WFWorkflowActionParameters.UUID);
  }
});
