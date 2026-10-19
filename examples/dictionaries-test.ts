import { showResult, getDictionaryValue, setDictionaryValue, dictionaryKeys, dictionaryValues, joinText, native, text } from "@js-shortcuts/ios";

interface Profile {
  name: string;
  score: number;
  enabled: boolean;
  details: { city: string };
  tags: string[];
}

export default async function main(): Promise<void> {
  const original: Profile = { name: "Ada", score: 7, enabled: true, details: { city: "Amsterdam" }, tags: ["old"] };
  const scored = await setDictionaryValue<Profile>(original, "score", 9);
  const moved = await setDictionaryValue<Profile>(scored, "details", { city: "Utrecht" });
  const tagged = await setDictionaryValue<Profile>(moved, "tags", ["ts", "ios"]);
  const updated = await setDictionaryValue<Profile>(tagged, "enabled", false);
  for (const key of ["score"]) {
    const score = await getDictionaryValue<number>(updated, key);
    await showResult(`Score: ${score}; origineel: ${original["score"]}`);
  }
  const city = await getDictionaryValue<string>(updated, "details.city");
  await showResult(`Stad: ${city}; tags: ${updated.tags[0]}/${updated.tags[1]}`);
  if (!updated.enabled) { await showResult("Uitgeschakeld"); }
  const keys = await dictionaryKeys(updated);
  const values = await dictionaryValues<number>({ a: 2, b: 3 });
  await showResult(`Keys: ${keys.length}; som: ${values.reduce((sum, n) => sum + n, 0)}`);
  const dotted = await setDictionaryValue<Record<string, string>>({ a: "old" }, "nested.path", "value");
  await showResult(`Dotted keys: ${await joinText(await dictionaryKeys(dotted), ",")}`);
  await showResult(await native<string>("is.workflow.actions.gettext", { WFTextActionText: text(updated) }));
  return;
}
