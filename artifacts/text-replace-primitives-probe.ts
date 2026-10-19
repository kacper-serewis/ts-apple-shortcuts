import { native, text, showResult, splitText, stringifyJson } from "@js-shortcuts/ios";

export default async function main(): Promise<void> {
  for (const value of ["", "abc", "😀", "é", "👨‍👩‍👧‍👦"]) {
    const length = await native<number>("is.workflow.actions.count", { Input: text(value), WFCountType: "Characters" });
    await showResult(`Count: ${stringifyJson(value)}/${length}`);
  }
  for (const value of ["", "a", "|a||b|", "$$&", "$$$"]) {
    const parts = await splitText(value, value.includes("$") ? "$" : "|");
    await showResult(`Split: ${stringifyJson(value)} => ${stringifyJson(parts)}`);
  }
}
