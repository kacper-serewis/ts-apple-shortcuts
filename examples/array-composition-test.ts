import { showResult, stringifyJson, parseJson } from "@js-shortcuts/ios";

interface Row { name: string; n: number; active: boolean; tags: string[] }
function row(name: string, n: number): Row { return { name, n, active: false, tags: ["ts"] }; }

export default async function main(): Promise<void> {
  const first = row("Ada", 1);
  const singleton = [first];
  await showResult(`Object: ${singleton.length}/${singleton[0].name}/${singleton[0].tags.length}/${singleton[0].active ? "Y" : "N"}`);
  const remote = parseJson<Row[]>('[{"name":"Lin","n":2,"active":true,"tags":[]}]');
  const empty = remote.filter(item => item.n < 0);
  const rows = [...empty, first, ...remote, row("Sam", 3), ...empty];
  await showResult(`Rows: ${rows.length}/${rows[0].name}/${rows[1].name}/${rows[2].name}; sum ${rows.reduce((sum, item) => sum + item.n, 0)}`);

  const none: number[] = [];
  const one = [42].map(n => n);
  const many = [2, 4].map(n => n);
  await showResult(`Numbers: ${stringifyJson([...none, ...none])}/${stringifyJson([...none, ...one, ...none])}/${stringifyJson([0, ...many, 6])}`);
  const flags = [false, true].filter(flag => !flag);
  await showResult(`Flags: ${stringifyJson([...flags, true])}`);
  const texts = ['",[', '],', '', 'quote"\\\n😀'].map(value => value);
  const joined = [...texts, "last"];
  await showResult(`Text: ${stringifyJson(joined)}`);
  const grouped = { rows, empty: [...none] };
  const decoded = parseJson<{ rows: Row[]; empty: number[] }>(stringifyJson(grouped));
  await showResult(`Nested: ${decoded.rows.length}/${decoded.rows[1].tags.length}/${decoded.empty.length}`);
  let original = [1, 2];
  const copy = [...original];
  original = [9];
  await showResult(`Copy: ${stringifyJson(copy)}; original ${stringifyJson(original)}`);
}
