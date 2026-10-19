import { showResult } from "@js-shortcuts/ios";

function addTax(amount: number): number {
  if (amount < 0) { return 0; }
  return amount * 1.21;
}

function firstPositive(items: number[]): number {
  for (const item of items) {
    if (item > 0) { return item; }
  }
  return -1;
}

async function describe(name: string, amount: number): Promise<string> {
  const total = addTax(amount);
  return `${name}: ${total}`;
}

async function announce(enabled: boolean): Promise<void> {
  if (!enabled) { return; }
  await showResult("Helper: actief");
}

function bump(value: number): number {
  value += 1;
  return value;
}

export default async function main(): Promise<void> {
  await showResult(await describe("Totaal", 100));
  await showResult(`Eerste: ${firstPositive([-2, 0, 7, 9])}; leeg: ${firstPositive([])}`);
  let value = 10;
  await showResult(`Parameter: ${bump(value)}; origineel: ${value}`);
  await announce(false);
  await announce(true);
  await showResult(`Na helpers: ${addTax(-1)}`);
}
