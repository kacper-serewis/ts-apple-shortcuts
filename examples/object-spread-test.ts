import { showResult, parseJson, stringifyJson, getDictionaryValue } from "@js-shortcuts/ios";

interface Payload { n: number; active: boolean; tags: string[]; child: { name: string } }
function payload(): Payload { return { n: 1, active: false, tags: ["ts"], child: { name: "Ada" } }; }

export default async function main(): Promise<void> {
  const original = payload();
  const changed = { ...original, n: 3, tags: [], ...{} };
  await showResult(`Override: ${changed.n}/${changed.active ? "Y" : "N"}/${changed.tags.length}/${changed.child.name}; original ${original.n}/${original.tags.length}`);
  const later = parseJson<{ n: number; active: boolean; tags: string[] }>('{"n":7,"active":true,"tags":["ios"]}');
  const merged = { ...original, ...later, child: { name: "Lin" } };
  await showResult(`Merge: ${merged.n}/${merged.active ? "Y" : "N"}/${merged.tags[0]}/${merged.child.name}`);
  const dynamic = parseJson<Record<string, number>>('{"n":9,"extra":42}');
  const defaults = { n: 0, ...dynamic };
  const additional = await getDictionaryValue<number>(defaults, "extra");
  await showResult(`Defaults: ${defaults.n}/${additional}`);
  const empty = { ...{}, ...parseJson<{}>("{}") };
  await showResult(`Empty: ${stringifyJson(empty)}`);
  const limited = parseJson<{ n: number }>('{"n":5,"extra":"kept"}');
  const copy = { ...limited };
  const extra = await getDictionaryValue<string>(copy, "extra");
  await showResult(`Extra: ${copy.n}/${extra}`);
  const escaped = { 'quote"\\\n😀': '},"n":999,{', tags: [""] };
  const preserved = { ...escaped, active: false };
  await showResult(`Escapes: ${preserved['quote"\\\n😀']}; ${stringifyJson(preserved.tags)}; ${preserved.active ? "Y" : "N"}`);
  const rows = [original, merged].map(row => ({ ...row, n: row.n + 10 }));
  await showResult(`Rows: ${rows[0].n}/${rows[1].n}/${rows[0].child.name}/${rows[1].child.name}`);
}
