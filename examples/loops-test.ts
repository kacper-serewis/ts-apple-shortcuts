import { showResult } from "@js-shortcuts/ios";

export default async function main(): Promise<void> {
  const names: readonly string[] = ["Kacper", "Ada"];
  for (const name of names) {
    const labels = [`${name}/A`, `${name}/B`];
    for (const label of labels) {
      if (name === "Kacper") {
        await showResult(`IF ${name}: ${label}`);
      } else {
        await showResult(`ELSE ${name}: ${label}`);
      }
    }
    await showResult(`Na binnenste lus: ${name}`);
  }
  const empty: string[] = [];
  for (const item of empty) {
    await showResult(`FOUT: lege lijst bevat ${item}`);
  }
  await showResult("Klaar: lege lijst overgeslagen");
}
