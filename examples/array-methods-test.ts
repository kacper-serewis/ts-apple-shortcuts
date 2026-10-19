import { showResult } from "@js-shortcuts/ios";

export default async function main(): Promise<void> {
  const values = [1, 2, 3, 4];
  const mapped = values.map((n, index) => n * 10 + index);
  await showResult(`Map: ${mapped.length}; ${mapped[0]},${mapped[3]}`);

  const filtered = mapped.filter(n => n >= 20);
  const sum = filtered.reduce((total, n) => total + n, 0);
  await showResult(`Filter/reduce: ${filtered.length}; ${sum}`);

  const people = [{ name: "Ada", score: 2 }, { name: "Kacper", score: 5 }];
  const rows = people.map(p => ({ name: p.name, doubled: p.score * 2 }));
  for (const row of rows.filter(p => p.doubled > 4)) {
    await showResult(`Objecten: ${row.name}/${row.doubled}`);
  }

  let trace = "";
  values.forEach((n, index) => {
    if (n === 2) { return; }
    trace += `${index}:${n};`;
  });
  await showResult(`ForEach: ${trace}`);

  const empty: number[] = [];
  const none = values.filter(n => n > 100);
  await showResult(`Leeg: ${empty.map(n => n * 2).length}/${none.length}/${empty.reduce((sum, n) => sum + n, 9)}`);
  const blanks = [1, 2].map(() => "");
  await showResult(`Lege tekst: ${blanks.length}`);
  return;
}
