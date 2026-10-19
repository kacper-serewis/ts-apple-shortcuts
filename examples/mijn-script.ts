import { askText, LLM, text, showResult, Shortcuts, quickLook } from "@js-shortcuts/ios";


export default async function main(): Promise<void> {

  const orientation = await Shortcuts.getOrientation();

  await quickLook(orientation);
}
