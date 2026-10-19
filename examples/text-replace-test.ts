import { showResult, stringifyJson } from "@js-shortcuts/ios";

function change(template: string): string {
  return "abca".replace("b", template);
}

export default async function main(): Promise<void> {
  await showResult(`First: ${"aba".replace("a", "X")}/${"aaaa".replace("aa", "$&$&")}`);
  let results = "";
  for (const template of ["$$", "$&", "$`", "$'", "$$&", "$$$&", "$1", "$`/$&/$'"]) {
    results += `${change(template)};`;
  }
  await showResult(`Templates: ${results}`);
  const empty = "";
  await showResult(`Empty: ${stringifyJson(empty.replace("", "!"))}/${stringifyJson("abc".replace("", "$&!$'"))}; missing ${"abc".replace("z", "X")}`);
  const needle = ".*[]\\$";
  const replacement = '$&:$1:\\:😀\n';
  await showResult(`Escapes: ${stringifyJson("x.*[]\\$y".replace(needle, replacement))}`);
  let input = "aba", search = "a";
  const captured = input.replace(search, [1].reduce((acc, n) => { input = "changed"; search = "z"; return "$&!"; }, ""));
  await showResult(`Snapshot: ${captured}/${input}/${search}; helpers ${["$$&", "$&", "$`"].map(t => change(t)).join("|")}`);
}
