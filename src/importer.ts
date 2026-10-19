import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { parse } from "plist";
import type { PlistDictionary, PlistValue } from "./model.js";
import { isDictionary, plistDate } from "./native.js";
import { parseInspection } from "./plist-codec.js";

function validate(value: unknown, path: string): asserts value is PlistValue {
  if (typeof value === "string" || typeof value === "boolean" || typeof value === "number" && Number.isFinite(value)) return;
  if (value instanceof Uint8Array) return;
  if (value instanceof Date && Number.isFinite(value.getTime())) { plistDate(value.toISOString()); return; }
  if (Array.isArray(value)) { value.forEach((item, i) => validate(item, `${path}[${i}]`)); return; }
  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    for (const [key, item] of Object.entries(value)) validate(item, `${path}.${key}`);
    return;
  }
  throw new Error(`Cannot import ${path}: expected plist text, numbers, booleans, data, dates, arrays or dictionaries (no null values).`);
}

/** Preserve action IDs, raw parameter encodings, UUID links, control flow and root settings. */
export function workflowToTypeScript(input: unknown): string {
  if (input && typeof input === "object" && "workflow" in input) input = input.workflow;
  validate(input, "workflow");
  if (!isDictionary(input)) throw new Error("Expected a workflow dictionary.");
  const { WFWorkflowActions: actions, ...settings } = input;
  if (!Array.isArray(actions)) throw new Error("Missing WFWorkflowActions array.");
  const helpers = new Set(["native", "raw"]);
  function source(value: PlistValue, depth = 0): string {
    if (value instanceof Uint8Array) { helpers.add("plistData"); return `plistData(${JSON.stringify(Buffer.from(value).toString("base64"))})`; }
    if (value instanceof Date) { helpers.add("plistDate"); return `plistDate(${JSON.stringify(value.toISOString())})`; }
    if (Array.isArray(value)) return `[${value.map(v => source(v, depth + 1)).join(", ")}]`;
    if (isDictionary(value)) {
      const entries = Object.entries(value).map(([k, v]) => `${"  ".repeat(depth + 1)}${JSON.stringify(k)}: ${source(v, depth + 1)}`);
      return entries.length ? `{\n${entries.join(",\n")}\n${"  ".repeat(depth)}}` : "{}";
    }
    return JSON.stringify(value);
  }
  const statements = actions.map((action, index) => {
    if (!isDictionary(action)) throw new Error(`Invalid action ${index}.`);
    const { WFWorkflowActionIdentifier: identifier, WFWorkflowActionParameters: parameters, ...extra } = action;
    if (Object.keys(extra).length) throw new Error(`Action ${index} has unsupported action-level fields; refusing a lossy import.`);
    if (typeof identifier !== "string" || !parameters || !isDictionary(parameters)) throw new Error(`Invalid action ${index}.`);
    return `  await native(${JSON.stringify(identifier)}, raw(${source(parameters).replace(/\n/g, "\n  ")}));`;
  });
  const settingsSource = source(settings);
  return `// Imported native workflow. Raw encodings and UUID links are intentionally preserved.\nimport { ${[...helpers].join(", ")} } from "@js-shortcuts/ios";\n\nexport const shortcut = ${settingsSource};\n\nexport default async function main(): Promise<void> {\n${statements.join("\n")}\n}\n`;
}

export async function readWorkflow(path: string): Promise<unknown> {
  const bytes = await readFile(path);
  if (bytes.subarray(0, 4).toString() === "AEA1") throw new Error("Signed/encrypted shortcuts cannot be imported directly. Supply an unsigned XML/binary plist or inspection JSON.");
  if (bytes.subarray(0, 6).toString() === "bplist") {
    assertBinaryDatePrecision(bytes);
    if (process.platform !== "darwin") throw new Error("Binary plist import currently requires macOS plutil; XML/JSON works on all platforms.");
    const converted = spawnSync("plutil", ["-convert", "xml1", "-o", "-", path], { encoding: "utf8", timeout: 10000, maxBuffer: 32 * 1024 * 1024 });
    if (converted.status !== 0) throw new Error(converted.error?.message || converted.stderr || "Binary plist conversion failed.");
    return parse(converted.stdout) as PlistDictionary;
  }
  const text = bytes.toString("utf8").trim();
  return text.startsWith("{") ? parseInspection(text) : parse(text);
}

/** plutil drops fractional binary dates during XML conversion. Inspect object markers first. */
function assertBinaryDatePrecision(bytes: Buffer): void {
  if (bytes.length < 40 || bytes.subarray(0, 8).toString() !== "bplist00") throw new Error("Invalid binary plist header.");
  const trailer = bytes.length - 32;
  function integer(offset: number, size: number): number {
    if (size < 1 || size > 8 || offset < 0 || offset + size > bytes.length) throw new Error("Invalid binary plist offset.");
    let number = 0n;
    for (const byte of bytes.subarray(offset, offset + size)) number = (number << 8n) | BigInt(byte);
    if (number > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("Binary plist offset is too large.");
    return Number(number);
  }
  const offsetSize = bytes[trailer + 6];
  const count = integer(trailer + 8, 8);
  const table = integer(trailer + 24, 8);
  if (offsetSize < 1 || offsetSize > 8 || table < 8 || table > trailer || count > (trailer - table) / offsetSize) throw new Error("Invalid binary plist offset table.");
  for (let index = 0; index < count; index++) {
    const offset = integer(table + index * offsetSize, offsetSize);
    if (offset < 8 || offset >= table) throw new Error("Invalid binary plist object offset.");
    if (bytes[offset] === 0x33) {
      if (offset + 9 > table) throw new Error("Truncated binary plist date.");
      if (!Number.isInteger(bytes.readDoubleBE(offset + 1))) throw new Error("Cannot import a subsecond binary plist date through XML without losing precision.");
    }
  }
}
