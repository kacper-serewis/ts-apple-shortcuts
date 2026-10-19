import { native, showResult, askNumber, repeat } from "@js-shortcuts/ios";

export default async function main(): Promise<void> {
  const n = await native<number>("is.workflow.actions.number", { WFNumberActionNumber: 9 });
  await showResult(`Rekenen: ${n * 2}, ${n / 3}, ${n % 4}, ${n ** 2}, ${-n}`);

  const flags = { ok: n >= 3 };
  const label = flags.ok ? "ja" : "nee";
  const safe = true || (await askNumber("FOUT: kortsluiting")) > 0;
  if (safe && !false) {
    await showResult(`Ternary: ${label}`);
  }

  const rows = [{ name: "Ada" }, { name: "Kacper" }];
  for (const row of rows) {
    await showResult(`Objectlijst: ${row.name}`);
  }
  let total = 0;
  await repeat(n - 9, async () => { total += 100; });
  await showResult(`Lengte: ${rows.length}; nul herhalingen: ${total}`);
  return;
}
