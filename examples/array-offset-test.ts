import { showResult } from "@js-shortcuts/ios";

function lookup(start: number): number {
  return [2, 4, 2].indexOf(2, start);
}

export default async function main(): Promise<void> {
  const values = [2, 4, 2, 6];
  let offsets = "";
  for (const start of [-99, -2.9, -2, -0.5, 1.9, 4, 99]) {
    offsets += `${values.indexOf(2, start)}${values.includes(2, start) ? "Y" : "N"};`;
  }
  await showResult(`Offsets: ${offsets}`);
  let text = "", flags = "";
  for (const start of [-2, 1.5, 9]) {
    text += `${["x", "", "x"].indexOf("x", start)}${["x", "", "x"].includes("", start) ? "Y" : "N"};`;
    flags += `${[false, true, false].indexOf(false, start)}${[false, true, false].includes(true, start) ? "Y" : "N"};`;
  }
  await showResult(`Text: ${text} Bool: ${flags}`);
  const empty: number[] = [];
  let empties = "";
  for (const start of [-99, 0.5, 99]) {
    empties += `${empty.indexOf(1, start)}${empty.includes(1, start) ? "Y" : "N"};`;
  }
  await showResult(`Empty: ${empties}`);
  let original = [2, 4, 2], needle = 2;
  const position = original.indexOf(needle, [1].reduce((sum, n) => { original = [9]; needle = 9; return 1; }, 0));
  await showResult(`Snapshot: ${position}; source ${original[0]}; needle ${needle}`);
  await showResult(`Nested: ${[-3, -1, 4].map(start => lookup(start)).join(",")}`);
}
