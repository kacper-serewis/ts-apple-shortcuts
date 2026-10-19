import type { PlistDictionary } from "./model.js";

/** Portable, opt-in app metadata. Bindings must come from native shortcut exports. */
export interface AppMetadata {
  format: 1;
  namespace: string;
  bundleIdentifier: string;
  source: { version: string; metadataSHA256: string };
  metadata: Record<string, unknown>;
  bindings: Record<string, { identifier: string; defaults: PlistDictionary }>;
}
export function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
const list = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const reserved = new Set("break case catch class const continue debugger default delete do else enum export extends false finally for function if import in instanceof new null return super switch this throw true try typeof var void while with yield let static implements interface package private protected public await".split(" "));
const identifier = /^[A-Za-z_$][\w$]*$/;
export function appActions(app: AppMetadata) {
  const entries = Object.entries(record(app.metadata.actions));
  const stems = entries.map(([id]) => id.replace(/(?:AppIntent|Intent)$/, ""));
  return entries.map(([id, value], index) => {
    const action = record(value);
    const stem = stems.filter(s => s === stems[index]).length > 1 ? id : stems[index];
    let name = stem.charAt(0).toLowerCase() + stem.slice(1);
    if (reserved.has(name)) name += "Intent";
    if (!identifier.test(name)) throw new Error(`Unsupported App Intent identifier: ${id}`);
    return { id, name, action, parameters: list(action.parameters).map(record) };
  });
}
export function validateAppMetadata(value: unknown): AppMetadata {
  const app = value as AppMetadata;
  if (!app || typeof app !== "object" || app.format !== 1 || typeof app.namespace !== "string" || !identifier.test(app.namespace) || reserved.has(app.namespace) || !/^[\w-]+(?:\.[\w-]+)+$/.test(app.bundleIdentifier)
    || !app.source || typeof app.source.version !== "string" || !/^[a-f0-9]{64}$/.test(app.source.metadataSHA256)
    || typeof app.metadata !== "object" || app.metadata === null || app.metadata.version !== 1 || typeof app.metadata.actions !== "object" || app.metadata.actions === null || Array.isArray(app.metadata.actions)
    || typeof app.bindings !== "object" || app.bindings === null || Array.isArray(app.bindings)) throw new Error("Invalid app metadata manifest (expected format 1 and App Intents metadata version 1).");
  const names = new Set<string>();
  for (const { id, name, action, parameters } of appActions(app)) {
    if (names.has(name)) throw new Error(`Ambiguous app function: ${name}`);
    names.add(name);
    if (action.identifier !== id || !Array.isArray(action.parameters)) throw new Error(`Invalid action metadata: ${id}`);
    const keys = new Set<string>();
    for (const p of parameters) {
      if (typeof p.name !== "string" || keys.has(p.name) || !p.valueType || typeof p.isOptional !== "boolean") throw new Error(`Invalid parameters: ${id}`);
      keys.add(p.name);
    }
  }
  for (const [id, binding] of Object.entries(app.bindings)) {
    const descriptor = record(binding?.defaults?.AppIntentDescriptor);
    if (descriptor.BundleIdentifier !== app.bundleIdentifier || descriptor.AppIntentIdentifier !== id
      || typeof descriptor.TeamIdentifier !== "string" || typeof descriptor.Name !== "string"
      || Object.keys(binding.defaults).some(key => key !== "AppIntentDescriptor")
      || !Object.hasOwn(record(app.metadata.actions), id) || !binding || typeof binding.identifier !== "string"
      || !/^[\w-]+(?:\.[\w-]+)+$/.test(binding.identifier) || typeof binding.defaults !== "object" || binding.defaults === null || Array.isArray(binding.defaults)) throw new Error(`Invalid native binding: ${id}`);
  }
  return app;
}

/** Keep entities opaque: their properties are not ordinary Shortcuts dictionaries. */
export function appDeclarations(app: AppMetadata): string {
  validateAppMetadata(app);
  const entities = record(app.metadata.entities);
  const enums = new Map(list(app.metadata.enums).map(record).map(e => [e.identifier, e]));
  function type(value: unknown, depth = 0): string {
    if (depth > 12) return "NativeContent";
    const v = record(value);
    const primitive = record(record(v.primitive).wrapper).typeIdentifier;
    if (primitive === 0) return "string";
    if (primitive === 1) return "boolean";
    if (primitive === 2 || primitive === 7) return "number";
    const entity = record(record(v.entity).wrapper).typeName;
    if (typeof entity === "string") return `Entity<${JSON.stringify(entity)}>`;
    const enumeration = record(record(v.linkEnumeration).wrapper).identifier;
    if (typeof enumeration === "string" && enums.has(enumeration)) {
      return list(enums.get(enumeration)!.cases).map(record).map(c => JSON.stringify(c.identifier)).filter(Boolean).join(" | ") || "NativeContent";
    }
    if (v.array) return `(${type(record(record(v.array).wrapper).memberValueType, depth + 1)})[]`;
    return "NativeContent";
  }
  const lines = ["// Generated from App Intents metadata. Availability and native bindings are separate.",
    'declare module "@js-shortcuts/ios" {', `  export namespace ${app.namespace} {`,
    "    export interface Entity<Name extends string> extends NativeContent { readonly __appEntity: Name; readonly __appBundle: " + JSON.stringify(app.bundleIdentifier) + " }",
  ];
  for (const name of Object.keys(entities).sort()) if (identifier.test(name)) lines.push(`    export type ${name} = Entity<${JSON.stringify(name)}>;`);
  for (const { id, name, action, parameters } of appActions(app)) {
    const fields = parameters.map(p => `${JSON.stringify(p.name)}${p.isOptional ? "?" : ""}: ${type(p.valueType)} | NativeEncoded`).join("; ");
    lines.push(`    /** ${app.bindings[id] ? "Native export binding available." : "Requires a native export binding before compilation."} */`);
    lines.push(`    export function ${name}(parameters${parameters.length ? "" : "?"}: { ${fields} }): Promise<${action.outputType ? type(action.outputType) : "void"}>;`);
  }
  lines.push("  }", "}", "");
  return lines.join("\n");
}
