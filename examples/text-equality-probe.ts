import { native, text, attachment, showResult } from "@js-shortcuts/ios";

// Isolated native comparison/regex-replacement diagnostic. Raw conditions below
// intentionally bypass the compiler's text-equality lowering under investigation.
export default async function main(): Promise<void> {
  let comparisons = "";
  let replacements = "";
  for (const value of ["JS:open", "JS:Open", "JS:open\n", "JS:opén", "JS:", "JS:TS_MATCH"]) {
    const input = await native<string>("is.workflow.actions.gettext", { WFTextActionText: text(value) });
    await native("is.workflow.actions.conditional", {
      GroupingIdentifier: "direct-comparison-probe", WFControlFlowMode: 0, WFCondition: 4,
      WFInput: { Type: "Variable", Variable: attachment(input) },
      WFConditionalActionString: "JS:open",
    });
    comparisons += "Y";
    await native("is.workflow.actions.conditional", { GroupingIdentifier: "direct-comparison-probe", WFControlFlowMode: 1 });
    comparisons += "N";
    await native("is.workflow.actions.conditional", { GroupingIdentifier: "direct-comparison-probe", WFControlFlowMode: 2 });
    const replaced = await native<string>("is.workflow.actions.text.replace", {
      WFInput: text(input), WFReplaceTextFind: "\\AJS:open\\z", WFReplaceTextReplace: "TS_MATCH",
      WFReplaceTextCaseSensitive: true, WFReplaceTextRegularExpression: true,
    });
    replacements += `${replaced};`;
  }
  await showResult(`Native is: ${comparisons}`);
  await showResult(`Regex: ${replacements}`);
  return;
}
