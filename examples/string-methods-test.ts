import { showResult, stringifyJson } from "@js-shortcuts/ios";

function mark(value: boolean): string { return value ? "Y" : "N"; }

export default async function main(): Promise<void> {
  const padded = "\uFEFF\t  Ada \n\u00A0";
  await showResult(`Trim: ${stringifyJson(padded.trim())}; ${stringifyJson("  x  ".trimStart())}; ${stringifyJson("  x  ".trimEnd())}`);
  await showResult(`Whitespace: ${mark("\u0085x\u0085".trim() === "\u0085x\u0085")}/${mark("\u200Bx\u200B".trim() === "\u200Bx\u200B")}/${mark("\u2028\u3000x\u2029".trim() === "x")}`);
  await showResult(`Empty: ${stringifyJson("".trim())}/${stringifyJson(" \n".trim())}/${stringifyJson("".toUpperCase())}/${stringifyJson("".toLowerCase())}`);
  const mixed = "straße İ ΟΣ é";
  await showResult(`Case: ${mixed.toUpperCase()}; ${mixed.toLowerCase()}`);
  const name = "  Ada ";
  await showResult(name.trim().toUpperCase().concat("/", "ts".toLowerCase(), "", "/😀"));

  let checks = "";
  for (const pair of [
    { value: "", needle: "" },
    { value: "", needle: "x" },
    { value: "abc", needle: "" },
    { value: "abc", needle: "a" },
    { value: "abc", needle: "c" },
    { value: "abc", needle: "b" },
    { value: "Abc", needle: "a" },
    { value: "abc", needle: "abcd" },
    { value: "a\nb", needle: "\n" },
    { value: "😀é", needle: "😀" },
    { value: "é", needle: "e\u0301" },
    { value: "TS_MATCH", needle: "missing" },
    { value: "a.*+?^${}()|[]\\z", needle: ".*+?^${}()|[]\\" },
  ]) {
    checks += `${mark(pair.value.startsWith(pair.needle))}${mark(pair.value.endsWith(pair.needle))}${mark(pair.value.includes(pair.needle))};`;
  }
  await showResult(`Search: ${checks}`);
  const tags = [" TS ", "IOS", " js "].map(tag => tag.trim().toLowerCase()).filter(tag => tag.startsWith("t") || tag.endsWith("s"));
  await showResult(`Arrays: ${tags[0]}/${tags[1]}/${tags[2]}; ${mark(tags.includes("ts"))}`);
}
