import { showResult } from "@js-shortcuts/ios";

function label(n: number): string {
  switch (n) {
    case 2: return "twee";
    default: return "anders";
  }
}

export default async function main(): Promise<void> {
  let trace = "";
  for (const n of [1, 2, 3]) {
    switch (n) {
      case 1: trace += "1;"; continue;
      case 2: trace += "2;";
      default: trace += "D;"; break;
      case 3: trace += "3;";
    }
    trace += "eind;";
  }
  await showResult(`Loop: ${trace}`);
  await showResult(`Functie: ${label(2)}`);
  return;
}
