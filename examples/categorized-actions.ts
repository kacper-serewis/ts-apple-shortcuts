import { LLM, Text, Clipboard, text, showResult, joinText } from "@js-shortcuts/ios";

export default async function main(): Promise<void> {
  const answer = await LLM.ask({
    WFLLMPrompt: text("Bedenk een korte, leuke naam voor een recepten-app"),
  });
  const trimmed = await Text.trim({ WFInput: text(answer) });
  const message = await joinText(trimmed, "");
  await Clipboard.set({ WFInput: text(message) });
  await showResult(message);
}
