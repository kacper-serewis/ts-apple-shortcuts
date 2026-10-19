import { askText, notify, speak } from "@js-shortcuts/ios";

export default async function main(): Promise<void> {
  const name: string = await askText("Hoe heet je?");
  if (name === "Kacper") {
    await speak(`Hoi ${name}!`);
  } else {
    await notify(`Welkom ${name}`);
  }
}
