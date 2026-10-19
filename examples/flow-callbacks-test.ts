import { repeat, menu, showResult } from "@js-shortcuts/ios";

export default async function main(): Promise<void> {
  let trace = "";
  await repeat(4, async index => {
    if (index === 1) { return; }
    trace += `${index}:`;
    index += 10;
    trace += `${index};`;
  });
  await showResult(`Index: ${trace}`);

  trace = "";
  await repeat(2, async outer => {
    await repeat(3, async inner => {
      if (inner === 1) { return; }
      trace += `${outer}${inner};`;
    });
    trace += "eind;";
  });
  await showResult(`Genest: ${trace}`);

  trace = "start;";
  await menu("Welke tak testen?", {
    "Vroeg stoppen": async () => {
      for (const n of [1, 2, 3]) {
        if (n === 1) { return; }
        trace += "fout;";
      }
      trace += "fout;";
    },
    Doorgaan: async () => { trace += "klaar;"; },
  });
  await showResult(`Menu: ${trace}`);

  let empty = 0;
  await repeat(0, async index => { empty += index + 1; return; });
  await showResult(`Na menu; leeg: ${empty}`);
}
