import { showResult } from "@js-shortcuts/ios";

function row(n: number): string {
  return `${n}:${Math.floor(n)},${Math.ceil(n)},${Math.trunc(n)},${Math.round(n)};`;
}

export default async function main(): Promise<void> {
  let negative = "";
  for (const n of [-2.5, -2.1, -1.5, -0.6, -0.5, -0.1, 0]) { negative += row(n); }
  await showResult(`Negative: ${negative}`);
  let positive = "";
  for (const n of [0.1, 0.5, 0.6, 1.5, 2.5, 3]) { positive += row(n); }
  await showResult(`Positive: ${positive}`);
  let signs = "";
  for (const n of [-2.5, -0.1, 0, 0.1, 2.5]) { signs += `${Math.abs(n)}/${Math.sign(n)};`; }
  await showResult(`Signs: ${signs}`);
  const values = [5, -7, 3];
  await showResult(`Extremes: ${Math.min(values[0], values[1], values[2], 0)}/${Math.max(values[0], values[1], values[2], 0)}/${Math.min(9)}`);
  await showResult(`Powers: ${Math.pow(2, 3)}/${Math.pow(-2, 3)}/${Math.sqrt(81)}/${Math.pow(256, 0.25)}`);
  await showResult(`Constants: ${Math.round(Math.PI * 1000)}/${Math.round(Math.E * 1000)}/${Math.round(Math.LN2 * 1000)}/${Math.round(Math.LN10 * 1000)}/${Math.round(Math.LOG2E * 1000)}/${Math.round(Math.LOG10E * 1000)}/${Math.round(Math.SQRT1_2 * 1000)}/${Math.round(Math.SQRT2 * 1000)}`);
  const rounded = [1.2, -1.8, 2.5].map(n => Math.round(n));
  const largest = rounded.reduce((best, n) => Math.max(best, n), -100);
  await showResult(`Arrays: ${rounded[0]}/${rounded[1]}/${rounded[2]}; max ${largest}`);
}
