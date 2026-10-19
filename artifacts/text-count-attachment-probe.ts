import { native, text, attachment, showResult, stringifyJson } from "@js-shortcuts/ios";

export default async function main(): Promise<void> {
  let counts = "";
  for (const value of ["", "abc", "😀", "é", "👨‍👩‍👧‍👦"]) {
    const length = await native<number>("is.workflow.actions.count", { Input: attachment(value), WFCountType: "Characters" });
    counts += `${length}/`;
  }
  await showResult(`Counts with attachment: ${counts}`);
  for (const value of ["", "ab", "😀", "é"]) {
    const parts = await native<string[]>("is.workflow.actions.text.split", { text: text(value), WFTextSeparator: "Every Character" });
    await showResult(`Characters: ${stringifyJson(value)} => ${stringifyJson(parts)}`);
  }
}
