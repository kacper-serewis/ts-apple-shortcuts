import { showResult, repeat, native, text } from "@js-shortcuts/ios";

function profile(score: number): { name: string; score: number; enabled: boolean } {
  return { name: "Ada", score, enabled: true };
}
function numbers(n: number): number[] {
  if (n === 0) { return []; }
  if (n === 1) { return [42]; }
  return [2, 4];
}
function emptyObject(): {} { return {}; }
function strings(): string[] { return ["", "quote\"\\\n{}[]"]; }
function oneString(): string[] { return [""]; }
function flags(): boolean[] { return [false]; }
function rows(): { n: number }[] { return [{ n: 9 }]; }

export default async function main(): Promise<void> {
  const person = profile(7);
  const tags = ["ts", "ios"].map(tag => tag);
  const payload = { title: "nieuw", person, tags, active: false };
  const envelope = { payload, version: 1 };
  await showResult(`${envelope.payload.person.name}/${envelope.payload.person.score}; ${envelope.payload.tags[0]}/${envelope.payload.tags[1]}`);
  await showResult(await native<string>("is.workflow.actions.gettext", { WFTextActionText: text(envelope) }));
  await repeat(3, async index => {
    const wrapped = { items: numbers(index), empty: emptyObject(), ok: true };
    await showResult(await native<string>("is.workflow.actions.gettext", { WFTextActionText: text(wrapped) }));
  });
  const edge = { strings: strings(), single: oneString(), flags: flags(), rows: rows() };
  const special = { "quote\"\\\n": edge, ok: true };
  await showResult(await native<string>("is.workflow.actions.gettext", { WFTextActionText: text(special) }));
}
