import { native, text, showResult, repeat, menu, splitText, joinText } from "@js-shortcuts/ios";

export const shortcut = { WFWorkflowIcon: { WFWorkflowIconStartColor: 4282601983, WFWorkflowIconGlyphNumber: 59511 } };

export default async function main(): Promise<number> {
  const prefix = await native<string>("is.workflow.actions.gettext", {
    WFTextActionText: text("Native TS"),
  });
  const profile = {
    name: "Ada", score: 7, enabled: true,
    details: { city: "Amsterdam" }, tags: ["ts", "ios"],
  };
  await showResult(`${prefix}: ${profile.name}, ${profile.score}, ${profile.details.city}`);
  if (profile.enabled && profile.score >= 5) {
    await showResult("Boolean + vergelijking werkt");
  } else {
    await showResult("FOUT: voorwaarde");
  }

  let total = 0;
  for (const n of [2, 3, 5]) {
    total += n;
  }
  await repeat(2, async () => {
    total += 10;
  });
  await showResult(`Totaal: ${total}; tweede tag: ${profile.tags[1]}`);

  const words = await splitText("TypeScript|naar|Shortcuts", "|");
  const sentence = await joinText(words, " ");
  await showResult(sentence);

  await menu("Kies een tak", {
    Eerste: async () => { await showResult("Menu: eerste tak"); },
    Tweede: async () => { await showResult("Menu: tweede tak"); },
  });
  return total;
}
