import { showResult } from "@js-shortcuts/ios";

function label(n: number): string {
  switch (n) {
    case 1: return "een";
    case 2: return "twee";
    default: return "anders";
  }
}

export default async function main(): Promise<void> {
  for (const command of ["open", "run", "unknown"]) {
    let description = "";
    switch (command) {
      case "open": description += "open;";
      case "run": description += "voer uit;"; break;
      default: description += "onbekend;";
    }
    await showResult(`Keuze: ${description}`);
  }
  let trace = "";
  for (const n of [1, 2]) {
    switch (n) {
      case 1: trace += "1;"; continue;
      default: trace += "2;"; break;
    }
    trace += "eind;";
  }
  await showResult(`Loop: ${trace}`);
  await showResult(`Functie: ${label(2)}`);
  return;
}
