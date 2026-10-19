import { native, attachment, showResult } from "@js-shortcuts/ios";
export default async function main(): Promise<void> {
  const obj = await native<{ n: number }>("is.workflow.actions.detect.dictionary", { WFInput: attachment('{"n":7}') });
  await showResult(`Object: ${obj.n}`);
  const list = await native<number[]>("is.workflow.actions.detect.dictionary", { WFInput: attachment('[2,4]') });
  await showResult(`Array: ${list.length}/${list[0]}/${list[1]}`);
  const num = await native<number>("is.workflow.actions.detect.dictionary", { WFInput: attachment('42') });
  await showResult(`Number: ${num}`);
}
