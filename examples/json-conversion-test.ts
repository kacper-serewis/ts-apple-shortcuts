import { stringifyJson, parseJson, showResult } from "@js-shortcuts/ios";

export default async function main(): Promise<void> {
  const person = parseJson<{ name: string; score: number; active: boolean }>(' {"name":"Ada","score":7,"active":true} ');
  await showResult(`Object: ${person.name}/${person.score}/${person.active ? "Y" : "N"}`);
  const wrapped = { person, tags: ["ts", "ios"].filter(tag => tag !== "ios") };
  const again = parseJson<typeof wrapped>(JSON.stringify(wrapped));
  await showResult(`Terug: ${again.person.name}; ${again.tags.length}/${again.tags[0]}`);

  for (const input of ["[]", "[42]", "[2,4]"]) {
    const values = parseJson<number[]>(input);
    await showResult(`Array: ${values.length}; ${stringifyJson(values)}`);
  }

  const sample = 'quote"\\\n😀';
  const encoded = JSON.stringify(sample);
  const decoded = parseJson<string>(encoded);
  await showResult(`Tekst: ${decoded === sample ? "Y" : "N"}; leeg: ${stringifyJson(parseJson<string>('""'))}`);
  const flag = parseJson<boolean>("false");
  const n = parseJson<number>("-2.5");
  await showResult(`Scalars: ${stringifyJson(flag)}/${JSON.stringify(n)}/${JSON.stringify(true)}`);
  const rows = parseJson<{ n: number }[]>('[{"n":9}]');
  await showResult(`Rows: ${rows.length}/${rows[0].n}; ${JSON.stringify(rows)}`);
}
