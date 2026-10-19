import type { PlistValue } from "./model.js";
import { plistData, plistDate } from "./native.js";

function xmlText(value: string): string {
  if (!value.isWellFormed() || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/u.test(value)) throw new Error("Invalid plist XML string.");
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\r/g, "&#13;");
}

/** Emit Apple-compatible XML without silently dropping unsupported values or date precision. */
export function buildPlist(value: PlistValue): string {
  function write(value: PlistValue, depth: number): string {
    const pad = "  ".repeat(depth);
    if (typeof value === "string") return `${pad}<string>${xmlText(value)}</string>`;
    if (typeof value === "boolean") return `${pad}<${value}/>`;
    if (typeof value === "number") {
      if (!Number.isFinite(value)) throw new Error("Plist numbers must be finite.");
      return Number.isInteger(value) ? `${pad}<integer>${BigInt(value)}</integer>` : `${pad}<real>${value}</real>`;
    }
    if (value instanceof Uint8Array) return `${pad}<data>${Buffer.from(value).toString("base64")}</data>`;
    if (value instanceof Date) return `${pad}<date>${plistDate(value.toISOString()).toISOString().replace(/\.000Z$/, "Z")}</date>`;
    if (Array.isArray(value)) return `${pad}<array>\n${value.map(v => write(v, depth + 1)).join("\n")}\n${pad}</array>`;
    if (value && Object.getPrototypeOf(value) === Object.prototype) {
      return `${pad}<dict>\n${Object.entries(value).map(([key, v]) => `${pad}  <key>${xmlText(key)}</key>\n${write(v, depth + 1)}`).join("\n")}\n${pad}</dict>`;
    }
    throw new Error("Unsupported plist value.");
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0">\n${write(value, 1)}\n</plist>\n`;
}

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

/** Preserve the historical plain JSON format unless data/date leaves need tagging.
 * The versioned envelope prevents tags in ordinary imported workflows being interpreted.
 * Dictionaries with the reserved key are escaped, so even tag-shaped user dictionaries round-trip.
 */
export function stringifyInspection(input: unknown): string {
  let typed = !!input && typeof input === "object" && Object.hasOwn(input, "$shortcutsPlist");
  function encode(value: unknown): Json {
    if (value instanceof Uint8Array) { typed = true; return { $plist: "data", value: Buffer.from(value).toString("base64") }; }
    if (value instanceof Date) { typed = true; return { $plist: "date", value: plistDate(value.toISOString()).toISOString() }; }
    if (Array.isArray(value)) return value.map(encode);
    if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
      const entries = Object.entries(value).filter(([, v]) => v !== undefined).map(([k, v]) => [k, encode(v)] as const);
      if (Object.hasOwn(value, "$plist")) return { $plist: "dictionary", value: entries.map(([k, v]) => [k, v]) };
      return Object.fromEntries(entries);
    }
    if (value === null || typeof value === "string" || typeof value === "boolean" || typeof value === "number" && Number.isFinite(value)) return value;
    throw new Error("Unsupported inspection JSON value.");
  }
  const encoded = encode(input);
  return JSON.stringify(typed ? { $shortcutsPlist: 1, value: encoded } : input, null, 2) + "\n";
}

export function parseInspection(text: string): unknown {
  const root = JSON.parse(text);
  if (!root || typeof root !== "object" || !Object.hasOwn(root, "$shortcutsPlist")) return root;
  if (Object.keys(root).length !== 2 || !Object.hasOwn(root, "value")) return root;
  if (root.$shortcutsPlist !== 1) throw new Error("Unsupported typed inspection JSON envelope.");
  function decode(value: Json): unknown {
    if (Array.isArray(value)) return value.map(decode);
    if (!value || typeof value !== "object") return value;
    if (!Object.hasOwn(value, "$plist")) return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, decode(v)]));
    if (Object.keys(value).length !== 2 || !Object.hasOwn(value, "value")) throw new Error("Invalid typed plist JSON value.");
    if (value.$plist === "data" && typeof value.value === "string") return plistData(value.value);
    if (value.$plist === "date" && typeof value.value === "string") return plistDate(value.value);
    if (value.$plist === "dictionary" && Array.isArray(value.value)) {
      const keys = new Set<string>();
      return Object.fromEntries(value.value.map(entry => {
        if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== "string" || keys.has(entry[0])) throw new Error("Invalid escaped plist dictionary.");
        keys.add(entry[0]);
        return [entry[0], decode(entry[1])];
      }));
    }
    throw new Error("Unknown typed plist JSON value.");
  }
  return decode(root.value);
}
