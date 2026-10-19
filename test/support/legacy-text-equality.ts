import assert from "node:assert/strict";
import type { Workflow } from "../../src/model.js";

/** Old on-device fixtures retain their historical Match Text serialization. Only
 * compiler-generated equality pairs are migrated for comparison with today's backend.
 * New text-equality fixtures are separately captured and verified on-device.
 */
export function migrateLegacyTextEquality(workflow: Workflow): Workflow {
  const result = structuredClone(workflow);
  for (let i = 0; i < result.WFWorkflowActions.length - 1; i++) {
    const match = result.WFWorkflowActions[i];
    const params = match.WFWorkflowActionParameters;
    if (match.WFWorkflowActionIdentifier !== "is.workflow.actions.text.match"
      || typeof params.WFMatchTextPattern !== "string" || !params.WFMatchTextPattern.startsWith("\\AJS:")
      || !params.WFMatchTextPattern.endsWith("\\z") || params.WFMatchTextCaseSensitive !== true) continue;
    const conditional = result.WFWorkflowActions[i + 1];
    const condition = conditional.WFWorkflowActionParameters;
    const variable = (condition.WFInput as any)?.Variable?.Value;
    assert.equal(conditional.WFWorkflowActionIdentifier, "is.workflow.actions.conditional");
    assert.equal(condition.WFControlFlowMode, 0);
    assert.ok(condition.WFCondition === 100 || condition.WFCondition === 101);
    assert.equal(variable.OutputUUID, params.UUID);
    match.WFWorkflowActionIdentifier = "is.workflow.actions.text.replace";
    match.WFWorkflowActionParameters = {
      UUID: params.UUID, WFInput: params.text,
      WFReplaceTextFind: params.WFMatchTextPattern, WFReplaceTextReplace: "TS_MATCH",
      WFReplaceTextCaseSensitive: true, WFReplaceTextRegularExpression: true,
    };
    condition.WFCondition = condition.WFCondition === 100 ? 4 : 5;
    condition.WFConditionalActionString = "TS_MATCH";
    variable.OutputName = "Updated Text";
    variable.Aggrandizements = [{ Type: "WFCoercionVariableAggrandizement", CoercionItemClass: "WFStringContentItem" }];
  }
  return result;
}
