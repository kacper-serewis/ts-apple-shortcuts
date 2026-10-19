import { showResult } from "@js-shortcuts/ios";

function echo(value: string): string { return value; }

export default async function main(): Promise<void> {
  let passed = 0;
  const values = ["", "open", "Open", "a.*(b)[c]\\d${}|^+?", "\\E\\Q", "$1",
    ".", "*", "+", "?", "^", "$", "{", "}", "(", ")", "|", "[", "]", "\\",
    "é", "e\u0301", "😀", "line\n", "line\r\n", "TS_MATCH"];
  for (const value of values) {
    if (value === echo(value)) { passed++; }
    if (`${value}x` !== value) { passed++; }
  }
  await showResult(`Dynamisch: ${passed}/${values.length * 2}`);

  let different = 0;
  for (const pair of [
    { a: "open", b: "Open" }, { a: "é", b: "e\u0301" }, { a: "😀", b: "😀\n" },
    { a: "a.*", b: "abc" }, { a: "TS_MATCH", b: "" }, { a: "", b: " " },
  ]) {
    if (pair.a !== pair.b) { different++; }
  }
  await showResult(`Verschillend: ${different}/6`);

  let trace = "";
  let command = "run";
  switch (command) {
    case ["wrong"].reduce((acc, item) => { trace += "A"; return item; }, ""):
      trace += "!"; break;
    default: trace += "D"; break;
    case ["run"].reduce((acc, item) => { trace += "B"; command = "changed"; return item; }, ""):
      trace += "M";
    case ["never"].reduce((acc, item) => { trace += "C"; return item; }, ""):
      trace += "F"; break;
  }
  await showResult(`Cases: ${trace}; waarde: ${command}`);

  switch (echo("missing")) {
    case echo("a"): await showResult("fout a"); break;
    default: await showResult("Default na dynamische cases"); break;
    case echo("b"): await showResult("fout b");
  }
  return;
}
