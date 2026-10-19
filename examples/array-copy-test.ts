import { showResult, stringifyJson, parseJson } from "@js-shortcuts/ios";

export default async function main(): Promise<void> {
  const values = [0, 1, 2, 3, 4];
  let ranges = "";
  for (const bounds of [{ start: 1, end: 4 }, { start: -3, end: -1 }, { start: -99, end: 99 }, { start: 4, end: 2 }, { start: 99, end: 100 }, { start: -2.9, end: 4.9 }]) {
    ranges += `${stringifyJson(values.slice(bounds.start, bounds.end))};`;
  }
  await showResult(`Ranges: ${ranges}`);
  const empty: number[] = [];
  await showResult(`Copies: ${stringifyJson(values.slice())}/${stringifyJson(values.slice(-1))}/${stringifyJson(empty.slice(0, 2))}/${stringifyJson(values.slice(0, 0))}`);
  await showResult(`Concat: ${stringifyJson(empty.concat())}/${stringifyJson(empty.concat(42))}/${stringifyJson([0].concat([1,2],3,empty))}`);
  const rows = parseJson<{ name: string; n: number }[]>('[{"name":"Ada","n":1},{"name":"Lin","n":2}]');
  const selected = rows.slice(-1).concat({ name: "Sam", n: 3 });
  await showResult(`Rows: ${selected.length}/${selected[0].name}/${selected[1].name}; sum ${selected.reduce((sum,row)=>sum+row.n,0)}`);
  const flags = [false,true,false].slice(0,2).concat(false);
  const texts = ["x", "", "😀"].slice(1).concat('quote"\\\n');
  await showResult(`Values: ${stringifyJson(flags)}; ${stringifyJson(texts)}`);
  let original = [1,2,3];
  const sliced = original.slice(1), copied = original.concat();
  original = [9];
  await showResult(`Independent: ${stringifyJson(sliced)}/${stringifyJson(copied)}/${stringifyJson(original)}`);
}
