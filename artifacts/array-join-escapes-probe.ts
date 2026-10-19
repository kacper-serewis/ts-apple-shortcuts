import { showResult, stringifyJson } from "@js-shortcuts/ios";

export default async function main(): Promise<void> {
  await showResult(stringifyJson(["😀", "$1", 'quote"\\\n'].join("$1\\.*")));
  await showResult(stringifyJson(["", "a", "", "b", ""].join("\n")));
}
