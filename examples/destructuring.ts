import { showResult } from "@js-shortcuts/ios";

interface Profile {
  name: string;
  scores: number[];
  details: { city: string };
}

function describe({ name, details: { city } }: Profile): string {
  name += "!";
  return `${name} uit ${city}`;
}

function sumPair([first, second]: readonly [number, number]): number {
  return first + second;
}

export default async function main(): Promise<void> {
  const profile: Profile = {
    name: "Ada", scores: [7, 9], details: { city: "Amsterdam" },
  };
  const { name, scores: [first, second], details: { city } } = profile;
  await showResult(`${name}: ${first}/${second}, ${city}`);
  await showResult(describe(profile));
  await showResult(`Paar: ${sumPair([first, second])}`);

  let [a, , c] = [1, 2, 3];
  a += c;
  await showResult(`Let: ${a}/${c}`);

  const people = [{ name: "Ada", score: 7 }, { name: "Kacper", score: 9 }];
  const labels = people.map(({ name: label, score }, index) => `${index}:${label}/${score}`);
  for (const { name: person, score } of people) {
    if (score < 8) { continue; }
    await showResult(`${person}: ${score}`);
  }
  await showResult(labels[0]);
  return;
}
