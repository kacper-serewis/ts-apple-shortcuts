import { showResult } from "@js-shortcuts/ios";

export default async function main(): Promise<void> {
  const input = "😀";
  await showResult(input.replaceAll("", "!"));
  await showResult("ERROR: unsupported replacement did not stop");
}
