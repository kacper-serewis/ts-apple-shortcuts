import { showResult, stringifyJson } from "@js-shortcuts/ios";

function change(template: string): string { return "abab".replaceAll("a", template); }

export default async function main(): Promise<void> {
  await showResult(`Matches: ${"aba".replaceAll("a", "X")}/${"aaaaa".replaceAll("aa", "X")}/${"abc".replaceAll("z", "X")}`);
  let templates = "";
  for (const template of ["$$", "$$&", "$&", "$`", "$'", "$`/$'"]) {
    templates += `${change(template)};`;
  }
  await showResult(`Templates: ${templates}`);
  await showResult(`Empty: ${stringifyJson("".replaceAll("", "!"))}/${stringifyJson("é".replaceAll("", "!"))}; emoji ${"😀".replaceAll("", "$&")}`);
  await showResult(`Unicode: ${"😀é😀".replaceAll("😀", "[$&]")}; literal ${".*[]\\$/.*[]\\$".replaceAll(".*[]\\$", "X")}; exact ${"ééé".replaceAll("éé", "éX")}`);
  let input = "aba", search = "a";
  const captured = input.replaceAll(search, [1].reduce((acc, n) => { input = "changed"; search = "z"; return "$&!"; }, ""));
  await showResult(`Snapshot: ${captured}/${input}/${search}`);
}
