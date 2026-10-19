import { showResult } from "@js-shortcuts/ios";

export default async function main(): Promise<void> {
  const names: string[] = ["Kacper", "Ada"];
  for (const name of names) {
    await showResult(`Hoi ${name}!`);
  }
}
