// Diagnostic for the unresolved iOS 26.5 simulator Match Text intent failure.
// Even the first, literal-only Match Text unexpectedly asks for input on that device.
// Expected results after the native issue is resolved: Static: 1, Dynamic: 1.
import { showResult, native, matchText } from "@js-shortcuts/ios";

export default async function main(): Promise<void> {
  const first = await matchText("JS:open", "\\AJS:open\\z");
  await showResult(`Static: ${first.length}`);
  const text = await native<string>("is.workflow.actions.gettext", { WFTextActionText: "JS:open" });
  const second = await matchText(text, "\\AJS:open\\z");
  await showResult(`Dynamic: ${second.length}`);
  return;
}
