import type { CatalogAction } from "../catalog.js";
import type { PlistDictionary, PlistValue, SourceLocation, Workflow } from "../model.js";
import { isDictionary } from "../native.js";

// Workflow → flat, indented view model resembling the Shortcuts editor.
// Pure data so it can be tested in Node and rendered by any frontend.

export type Part =
  | { kind: "text"; text: string }
  | { kind: "literal"; text: string }
  | { kind: "token"; text: string; variant: "output" | "variable" | "input" | "other"; source?: number };
export type Category = "scripting" | "variables" | "text" | "web" | "output" | "other";
export interface Block {
  index: number;
  identifier: string;
  line?: number;
  depth: number;
  role: "action" | "start" | "middle" | "end";
  category: Category;
  title: string;
  summary: Part[];
  details: { label: string; value: Part[] }[];
  output?: string;
}

const hidden = new Set(["UUID", "GroupingIdentifier", "WFControlFlowMode", "CustomOutputName"]);
const conditions: Record<number, string> = {
  0: "is less than", 1: "is less than or equal to", 2: "is greater than", 3: "is greater than or equal to",
  4: "is", 5: "is not", 8: "begins with", 9: "ends with", 99: "contains", 999: "does not contain",
  100: "has any value", 101: "does not have any value",
};
const categories: [RegExp, Category][] = [
  [/\.(setvariable|getvariable|appendvariable)$/, "variables"],
  [/\.(gettext|text\.[a-z.]+|detect\.text)$/, "text"],
  [/\.(downloadurl|openurl|url|getwebpagecontents)$/, "web"],
  [/\.(showresult|notification|speaktext|alert|quicklook|output|exit)$/, "output"],
  [/^is\.workflow\.actions\./, "scripting"],
];

const text = (value: string): Part => ({ kind: "text", text: value });
const literal = (value: string): Part => ({ kind: "literal", text: value });

export function workflowBlocks(workflow: Workflow, sourceMap: SourceLocation[] = [], catalog: CatalogAction[] = []): Block[] {
  const actions = workflow.WFWorkflowActions;
  const producers = new Map<string, number>();
  actions.forEach((action, index) => {
    const id = action.WFWorkflowActionParameters.UUID;
    if (typeof id === "string") producers.set(id, index);
  });
  // Name each produced value after the output name its consumers reference.
  const outputs = new Map<string, string>();
  const collect = (value: PlistValue): void => {
    if (Array.isArray(value)) value.forEach(collect);
    else if (isDictionary(value)) {
      if (value.Type === "ActionOutput" && typeof value.OutputUUID === "string" && !outputs.has(value.OutputUUID)) outputs.set(value.OutputUUID, String(value.OutputName));
      Object.values(value).forEach(collect);
    }
  };
  actions.forEach(action => collect(action.WFWorkflowActionParameters));
  const lines = new Map(sourceMap.map(location => [location.actionIndex, location.line]));
  const names = new Map(catalog.map(action => [action.id, action]));

  function token(value: PlistDictionary): Part {
    const type = value.Type;
    if (type === "ActionOutput") {
      const source = typeof value.OutputUUID === "string" ? producers.get(value.OutputUUID) : undefined;
      return { kind: "token", text: String(value.OutputName ?? "Output"), variant: "output", source };
    }
    if (type === "Variable") return { kind: "token", text: String(value.VariableName), variant: "variable" };
    if (type === "ExtensionInput") return { kind: "token", text: "Shortcut Input", variant: "input" };
    return { kind: "token", text: String(type ?? "Value"), variant: "other" };
  }
  function parts(value: PlistValue | undefined): Part[] {
    if (value === undefined) return [];
    if (typeof value === "string") return [literal(value)];
    if (typeof value === "number" || typeof value === "boolean") return [literal(String(value))];
    if (value instanceof Date) return [literal(value.toISOString())];
    if (value instanceof Uint8Array) return [literal(`${value.byteLength} bytes`)];
    if (Array.isArray(value)) return value.flatMap((item, i) => i ? [text(", "), ...parts(item)] : parts(item));
    const serialization = value.WFSerializationType;
    const inner = value.Value ?? {};
    if (serialization === "WFTextTokenAttachment" && isDictionary(inner)) return [token(inner)];
    if (serialization === "WFTextTokenString" && isDictionary(inner)) return tokenString(inner);
    if (serialization === "WFNumberSubstitutableState" || serialization === "WFArrayParameterState") return parts(value.Value);
    if (serialization === "WFDictionaryFieldValue" && isDictionary(inner)) {
      const items = inner.WFDictionaryFieldValueItems;
      return Array.isArray(items) ? items.flatMap((item, i) => [...(i ? [text(", ")] : []), ...dictionaryItem(item)]) : [];
    }
    if (value.Type === "Variable" && value.Variable !== undefined) return parts(value.Variable);
    if (typeof value.Type === "string") return [token(value)];
    if (value.WFValue !== undefined) return parts(value.WFValue);
    return [literal(JSON.stringify(value))];
  }
  function tokenString(value: PlistDictionary): Part[] {
    const string = String(value.string ?? "");
    const attachments = value.attachmentsByRange !== undefined && isDictionary(value.attachmentsByRange) ? value.attachmentsByRange : {};
    const positions = new Map<number, PlistDictionary>();
    for (const [range, attachment] of Object.entries(attachments)) {
      const start = Number(/^\{(\d+),/.exec(range)?.[1]);
      if (Number.isInteger(start) && isDictionary(attachment)) positions.set(start, attachment);
    }
    const result: Part[] = [];
    let buffer = "";
    // Ranges count UTF-16 units, matching JavaScript string indices.
    for (let i = 0; i < string.length; i++) {
      const attachment = positions.get(i);
      if (attachment) {
        if (buffer) result.push(literal(buffer));
        buffer = "";
        result.push(token(attachment));
      } else buffer += string[i];
    }
    if (buffer || !result.length) result.push(literal(buffer));
    return result;
  }
  function dictionaryItem(item: PlistValue): Part[] {
    if (!isDictionary(item)) return parts(item);
    return [...parts(item.WFKey), text(": "), ...parts(item.WFValue)];
  }

  let depth = 0;
  return actions.map((action, index): Block => {
    const identifier = action.WFWorkflowActionIdentifier;
    const p = action.WFWorkflowActionParameters;
    const short = identifier.replace(/^is\.workflow\.actions\./, "");
    const mode = p.GroupingIdentifier !== undefined ? Number(p.WFControlFlowMode ?? 0) : undefined;
    const role = mode === 0 ? "start" : mode === 1 ? "middle" : mode === 2 ? "end" : "action";
    if (role !== "action" && role !== "start") depth = Math.max(0, depth - 1);
    const block: Block = {
      index, identifier, line: lines.get(index), depth, role,
      category: categories.find(([pattern]) => pattern.test(identifier))?.[1] ?? "other",
      title: names.get(identifier)?.name ?? short,
      summary: [],
      details: [],
    };
    if (role === "start" || role === "middle") depth++;
    const used = new Set<string>();
    const get = (key: string) => { used.add(key); return parts(p[key]); };
    const summary = (...items: (Part | Part[])[]) => { block.summary = items.flat(); };

    switch (short) {
      case "conditional":
        block.title = role === "start" ? "If" : role === "middle" ? "Otherwise" : "End If";
        if (role === "start") {
          const condition = conditions[Number(p.WFCondition)] ?? `condition ${p.WFCondition}`;
          used.add("WFCondition");
          const compared = p.WFConditionalActionString !== undefined ? get("WFConditionalActionString") : get("WFNumberValue");
          used.add("WFNumberValue");
          summary(get("WFInput"), text(` ${condition} `), condition.endsWith("value") ? [] : compared);
        }
        break;
      case "repeat.each":
        block.title = role === "start" ? "Repeat with Each" : "End Repeat";
        if (role === "start") summary(text("item in "), get("WFInput"));
        break;
      case "repeat.count":
        block.title = role === "start" ? "Repeat" : "End Repeat";
        if (role === "start") summary(get("WFRepeatCount"), text(" times"));
        break;
      case "choosefrommenu":
        block.title = role === "start" ? "Choose from Menu" : role === "middle" ? String(p.WFMenuItemTitle ?? "") : "End Menu";
        used.add("WFMenuItemTitle");
        if (role === "start") summary(text("with "), get("WFMenuPrompt"));
        break;
      case "ask":
        summary(text(`for ${p.WFInputType ?? "Text"} with `), get("WFAskActionPrompt"));
        used.add("WFInputType");
        break;
      case "showresult": summary(get("Text")); break;
      case "notification": summary(get("WFNotificationActionBody")); break;
      case "speaktext": summary(get("WFText")); break;
      case "output": summary(get("WFOutput")); break;
      case "downloadurl": summary(get("WFURL")); break;
      case "setvariable": summary(literal(String(p.WFVariableName)), text(" to "), get("WFInput")); used.add("WFVariableName"); break;
      case "getvariable": summary(get("WFVariable")); break;
      case "number": summary(get("WFNumberActionNumber")); break;
      case "gettext": summary(get("WFTextActionText")); break;
      case "list": summary(get("WFItems")); break;
      case "dictionary": summary(get("WFItems")); break;
      case "math": {
        const scientific = p.WFMathOperation === "…";
        summary(get("WFInput"), text(" "), get(scientific ? "WFScientificMathOperation" : "WFMathOperation"), text(" "),
          get(scientific ? "WFScientificMathOperand" : "WFMathOperand"));
        used.add("WFMathOperation");
        break;
      }
      case "count": summary(get("WFCountType"), text(" in "), get("Input")); break;
      case "getitemfromlist": summary(get("WFItemSpecifier"), text(" "), get("WFItemIndex"), text(" from "), get("WFInput")); break;
      case "getvalueforkey":
        summary(get("WFGetDictionaryValueType"), ...(p.WFDictionaryKey !== undefined ? [text(" for "), get("WFDictionaryKey")] : []), text(" in "), get("WFInput"));
        break;
      case "setvalueforkey": summary(get("WFDictionaryKey"), text(" to "), get("WFDictionaryValue"), text(" in "), get("WFDictionary")); break;
      case "detect.dictionary": summary(text("from "), get("WFInput")); break;
      case "text.replace": summary(get("WFReplaceTextFind"), text(" with "), get("WFReplaceTextReplace"), text(" in "), get("WFInput")); break;
      case "text.match": summary(get("WFMatchTextPattern"), text(" in "), get("text")); break;
      case "text.changecase": summary(get("text"), text(" to "), get("WFCaseType")); break;
      case "text.combine":
      case "text.split":
        summary(get("text"), text(short === "text.split" ? " by " : " with "), p.WFTextSeparator === "Custom" ? get("WFTextCustomSeparator") : get("WFTextSeparator"));
        used.add("WFTextSeparator").add("WFTextCustomSeparator");
        break;
    }
    const parameters = names.get(identifier)?.parameters ?? [];
    for (const [key, value] of Object.entries(p)) {
      if (hidden.has(key) || used.has(key)) continue;
      block.details.push({ label: parameters.find(parameter => parameter.key === key)?.name ?? key, value: parts(value) });
    }
    if (typeof p.UUID === "string") block.output = outputs.get(p.UUID) ?? block.output;
    return block;
  });
}
