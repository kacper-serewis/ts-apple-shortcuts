import { showResult } from "@js-shortcuts/ios";

export default async function main() {
  let n = 0;
  let trace = "";
  while (n < 5) {
    n++;
    if (n === 2) { continue; }
    if (n === 4) { break; }
    trace += `${n},`;
  }
  await showResult(`While: ${trace}; n=${n}`);
}
