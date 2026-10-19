import { showResult, parseJson } from "@js-shortcuts/ios";

function format(n: number): string {
  return [n, n + 1].join(":");
}

export default async function main(): Promise<void> {
  const parts = ["", "a", "", "b", ""];
  await showResult(`Text: ${parts.join("|")}; compact ${parts.join("")}; default ${parts.join()}`);
  const empty: string[] = [];
  await showResult(`Empty: <${empty.join("|")}>/<${[""].join("|")}>/${["", ""].join("|")}; singleton ${["Ada"].join("|")}`);
  await showResult(`Numbers: ${[0, -1, 1.25, 1234567].join("|")}; flags ${[false, true, false].join()}`);
  const separator = "$1\\.*";
  await showResult(`Escapes: ${["😀", "$1", 'quote"\\\n'].join(separator)}`);
  const rows = parseJson<{ name: string }[]>('[{"name":"Ada"},{"name":"Lin"}]');
  await showResult(`Rows: ${rows.map(row => row.name).join(" / ")}; nested ${[1, 2].map(n => format(n)).join(";")}`);
  let values = ["a", "b"];
  const captured = values.join([1].reduce((text, n) => { values = ["changed"]; return "|"; }, ""));
  await showResult(`Snapshot: ${captured}; source ${values.join()}`);
}
