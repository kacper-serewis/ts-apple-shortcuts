import { showResult } from "@js-shortcuts/ios";

export default async function main(): Promise<void> {
  const values = [1, 2, 3, 4];
  let visits = "";
  const some = values.some((n, i) => { visits += i; return n === 2; });
  await showResult(`Some: ${some ? "Y" : "N"}; bezocht: ${visits}`);
  visits = "";
  const every = values.every(n => { visits += n; return n < 3; });
  await showResult(`Every: ${every ? "Y" : "N"}; bezocht: ${visits}`);

  visits = "";
  const people = [{ score: 2 }, { score: 5 }, { score: 9 }];
  const found = people.findIndex(({ score }, i, original) => {
    visits += i;
    i += 10;
    return score > original[0].score;
  });
  await showResult(`FindIndex: ${found}; bezocht: ${visits}`);

  const empty: number[] = [];
  let calls = 0;
  const any = empty.some(n => { calls++; return true; });
  const all = empty.every(n => { calls++; return false; });
  const index = empty.findIndex(n => { calls++; return true; });
  const contains = empty.includes(1);
  await showResult(`Leeg: ${any ? "Y" : "N"}/${all ? "Y" : "N"}/${index}/${contains ? "Y" : "N"}; callbacks: ${calls}`);

  let text = "";
  const words = ["a.*", ""];
  for (const needle of ["a.*", "abc", ""]) {
    text += `${words.indexOf(needle)}${words.includes(needle) ? "Y" : "N"};`;
  }
  await showResult(`Tekst: ${text}`);

  const numbers = [2, 4, 2, 6];
  await showResult(`Indices: ${numbers.indexOf(2)}/${numbers.indexOf(2, 1.9)}/${numbers.indexOf(2, -2.9)}/${numbers.indexOf(9)}; bool: ${[false, true].indexOf(true)}`);
  return;
}
