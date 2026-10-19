import { native, text, showResult } from "@js-shortcuts/ios";
function one(): number[][] { return [[2, 4]]; }
function many(): number[][] { return [[1, 2], [3]]; }
function emptyRow(): number[][] { return [[]]; }
export default async function main(): Promise<void> {
  const value = { one: one(), many: many(), empty: emptyRow() };
  await showResult(await native<string>("is.workflow.actions.gettext", { WFTextActionText: text(value) }));
}
