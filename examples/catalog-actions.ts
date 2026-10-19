import { actions, text, attachment, showResult } from "@js-shortcuts/ios";

// Select a catalog identifier and receive parameter-key suggestions in your editor.
// These calls compile to the same native actions as the handwritten wrappers.
export default async function main(): Promise<void> {
  const greeting = await actions["is.workflow.actions.gettext"]<string>({
    WFTextActionText: text("Hallo vanuit de catalogus"),
  });
  const number = await actions["is.workflow.actions.number"]<number>({
    WFNumberActionNumber: 7,
  });
  const doubled = await actions["is.workflow.actions.math"]<number>({
    WFInput: attachment(number),
    WFMathOperation: "×",
    WFMathOperand: 2,
  });
  await showResult(`${greeting}: ${doubled}`);
  return;
}
