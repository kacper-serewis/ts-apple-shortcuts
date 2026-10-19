import { showResult, replaceRegex } from "@js-shortcuts/ios";

export default async function main(): Promise<void> {
  let cases = "";
  for (const value of ["open", "Open", "open\n", "opén", "", "TS_MATCH"]) {
    cases += value === "open" ? "Y" : "N";
  }
  await showResult(`Exact: ${cases}`);

  let empty = "";
  for (const value of ["", " ", "\n", "TS_MATCH"]) {
    empty += value === "" ? "Y" : "N";
    empty += value !== "" ? "Y" : "N";
  }
  await showResult(`Leeg: ${empty}`);

  let escaped = "";
  for (const value of ["a.*(b)[c]\\d$", "abbbcd", "a.*(b)[c]\\d$\n"]) {
    escaped += value === "a.*(b)[c]\\d$" ? "Y" : "N";
  }
  await showResult(`Letterlijk: ${escaped}`);

  let unicode = "";
  for (const value of ["é", "e\u0301", "É", "😀", "😀\n"]) {
    unicode += value === "é" ? "Y" : "N";
    unicode += value === "😀" ? "Y" : "N";
  }
  await showResult(`Unicode: ${unicode}`);

  let marker = "";
  for (const value of ["TS_MATCH", "JS:TS_MATCH", "ts_match", ""]) {
    marker += value === "TS_MATCH" ? "Y" : "N";
  }
  await showResult(`Marker: ${marker}`);
  await showResult(await replaceRegex("a1 b22", "([a-z])(\\d+)", "$2:$1"));
  return;
}
