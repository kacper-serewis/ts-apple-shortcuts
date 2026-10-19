import { showResult } from "@js-shortcuts/ios";

function sumUntilStop(items: number[]): number {
  let total = 0;
  for (const item of items) {
    if (item < 0) { continue; }
    if (item === 99) { break; }
    total += item;
  }
  return total;
}

export default async function main(): Promise<void> {
  await showResult(`Som: ${sumUntilStop([-1, 2, 3, 99, 100])}`);

  let trace = "";
  for (const outer of [1, 2]) {
    for (const inner of [1, 2, 3]) {
      if (inner === 2) { continue; }
      if (outer === 2) { break; }
      trace += `${outer}${inner},`;
    }
    trace += `eind${outer};`;
  }
  await showResult(`Genest: ${trace}`);

  const words = ["nul", "een", "twee"];
  let index = 0;
  const first = words[index];
  index += 2;
  await showResult(`Index: ${first}/${words[index]}`);

  let selected = "";
  for (const position of [2, 0]) {
    selected += words[position] + ";";
  }
  await showResult(`Selectie: ${selected}`);
  return;
}
