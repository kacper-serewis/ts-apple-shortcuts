import { askText, showResult } from "@js-shortcuts/ios";

export default async function main(): Promise<void> {
  const name: string = await askText("Hoe heet je? Test met Kacper of Ada.");
  if (name === "Kacper") {
    await showResult(`✅ IF werkt: Hoi ${name}!`);
  } else {
    await showResult(`✅ ELSE werkt: Welkom ${name}!`);
  }
}
