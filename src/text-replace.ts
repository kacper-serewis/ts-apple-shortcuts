import type { IRNode, OutputRef } from "./model.js";
import { textOperations, type Text } from "./text-operations.js";

function emitTemplate(before: Text, after: Text, needle: Text, replacement: Text, resultName: string, matched: IRNode[], nextId: () => number, line: number, context?: { before: Text; after: Text }): void {
  const { text, ref, set, get, flag, native, param, replace, equal, whenFlag } = textOperations(nextId, line);
  const templateBefore = context?.before ?? before, templateAfter = context?.after ?? after;
  if (replacement.kind === "text" && replacement.parts.every(part => typeof part === "string")) {
    // Interpret literal templates at compile time, never execute source code.
    const template = replacement.parts.join("");
    const parts: (Text | string)[] = [before];
    let position = 0;
    for (const match of template.matchAll(/\$[$&`']/g)) {
      parts.push(template.slice(position, match.index));
      parts.push(match[0] === "$$" ? "$" : match[0] === "$&" ? needle : match[0] === "$`" ? templateBefore : templateAfter);
      position = match.index + 2;
    }
    parts.push(template.slice(position), after);
    set(resultName, text(...parts), matched);
  } else {
    const chunks = native("text.split", [["text", param(replacement)], ["WFTextSeparator", { kind: "literal", value: "Custom" }], ["WFTextCustomSeparator", { kind: "literal", value: "$" }]], matched);
    const firstName = `ts_${nextId()}_replacement_first`, quotedName = `ts_${nextId()}_replacement_quoted`;
    flag(firstName, true, matched); flag(quotedName, false, matched);
    set(resultName, before, matched);
    const append = (value: Text, into: IRNode[]): void => { const previous = get(resultName, into); set(resultName, text(previous, value), into); };
    const loopId = nextId(), chunk = ref(loopId, "Repeat Item"), body: IRNode[] = [];
    const first: IRNode[] = []; append(chunk, first); flag(firstName, false, first);
    const quoted: IRNode[] = []; append(chunk, quoted); flag(quotedName, false, quoted);
    const dollar: IRNode[] = []; append(text("$"), dollar); flag(quotedName, true, dollar);
    const nonempty: IRNode[] = [];
    const head = replace(text("JS:", chunk), String.raw`\AJS:([\s\S])[\s\S]*\z`, "$1", nonempty);
    const tail = replace(text("JS:", chunk), String.raw`\AJS:[\s\S]([\s\S]*)\z`, "$1", nonempty);
    const literal: IRNode[] = []; append(text("$", chunk), literal);
    const substitutions = [needle, templateBefore, templateAfter].map(value => { const branch: IRNode[] = []; append(text(value, tail), branch); return branch; });
    nonempty.push(equal(head, "&", substitutions[0], [equal(head, "`", substitutions[1], [equal(head, "'", substitutions[2], literal)])]));
    const unquoted = [equal(chunk, "", dollar, nonempty)];
    const rest: IRNode[] = []; whenFlag(quotedName, quoted, unquoted, rest);
    whenFlag(firstName, first, rest, body);
    matched.push({ kind: "repeat", id: loopId, input: { kind: "list-ref", id: chunks.id, outputName: "Split Text" }, body, line });
    append(after, matched);
  }
}

/** Lower literal-string replace without passing JS replacement syntax to ICU. */
export function lowerTextReplace(input: Text, needle: Text, replacement: Text, nextId: () => number, line: number): { nodes: IRNode[]; value: OutputRef } {
  const nodes: IRNode[] = [];
  const { text, ref, set, get, replace } = textOperations(nextId, line);
  const resultName = `ts_${nextId()}_replace_result`;
  set(resultName, input, nodes);
  const foundId = nextId();
  nodes.push({ kind: "string", method: "includes", id: foundId, input, args: [needle], line });
  const matched: IRNode[] = [];
  const escaped = replace(text("JS:", needle), "([.*+?^${}()|\\[\\]\\\\])", "\\\\$1", matched);
  const pattern = text("\\AJS:([\\s\\S]*?)", replace(escaped, String.raw`\AJS:`, "", matched), "([\\s\\S]*)\\z");
  const before = replace(text("JS:", input), pattern, "$1", matched);
  const after = replace(text("JS:", input), pattern, "$2", matched);
  emitTemplate(before, after, needle, replacement, resultName, matched, nextId, line);
  nodes.push({ kind: "numeric-if", left: { ...ref(foundId, "If Result"), valueType: "boolean" }, operator: "===", right: { kind: "boolean", value: true }, then: matched, else: null, line });
  return { nodes, value: get(resultName, nodes) };
}

/** All matches use prefix/suffix from the original input, never from replaced text. */
export function lowerTextReplaceAll(input: Text, needle: Text, replacement: Text, nextId: () => number, line: number): { nodes: IRNode[]; value: OutputRef } {
  const nodes: IRNode[] = [];
  const { text, ref, set, get, native, replace, equal } = textOperations(nextId, line);
  const resultName = `ts_${nextId()}_replace_all`, beforeName = `ts_${nextId()}_original_before`, tailName = `ts_${nextId()}_original_tail`;
  const renderedName = `ts_${nextId()}_replacement`;
  set(resultName, text(""), nodes); set(beforeName, text(""), nodes); set(tailName, input, nodes);
  const substitute = (before: Text, after: Text, into: IRNode[]): OutputRef => {
    emitTemplate(text(""), text(""), needle, replacement, renderedName, into, nextId, line, { before, after });
    return get(renderedName, into);
  };
  const append = (value: Text, into: IRNode[]): void => { const previous = get(resultName, into); set(resultName, text(previous, value), into); };

  const countScalars = (value: Text, into: IRNode[]): OutputRef => {
    const marks = replace(text("JS:", value), String.raw`[\s\S]`, "x", into);
    const countId = nextId(), lengthId = nextId();
    into.push({ kind: "native", id: countId, identifier: "is.workflow.actions.count", parameters: { kind: "parameter-object", entries: [
      ["Input", { kind: "parameter-value", value: marks, encoding: "attachment" }], ["WFCountType", { kind: "literal", value: "Characters" }],
    ] }, line });
    into.push({ kind: "math", id: lengthId, left: { ...ref(countId, "Count"), valueType: "number" }, operator: "-", right: { kind: "number", value: 3 }, line });
    return { ...ref(lengthId, "Calculation Result"), valueType: "number" };
  };
  const nonempty: IRNode[] = [];
  const escaped = replace(text("JS:", needle), "([.*+?^${}()|\\[\\]\\\\])", "\\\\$1", nonempty);
  const literalNeedle = replace(escaped, String.raw`\AJS:`, "", nonempty);
  const pattern = text("\\AJS:([\\s\\S]*?)", literalNeedle, "([\\s\\S]*)\\z");
  // Keep only non-overlapping literal matches; the fallback consumes every other
  // scalar. A fixed lookbehind excludes the three-character empty-input prefix.
  const retained = replace(text("JS:", input), text("(?<=[\\s\\S]{3})(", literalNeedle, ")|[\\s\\S]"), "$1", nonempty);
  const keptLength = countScalars(retained, nonempty), needleLength = countScalars(needle, nonempty);
  const matchesId = nextId();
  nonempty.push({ kind: "math", id: matchesId, left: keptLength, operator: "/", right: needleLength, line });
  const body: IRNode[] = [];
  const originalBefore = get(beforeName, body), tail = get(tailName, body);
  const matchPrefix = replace(text("JS:", tail), pattern, "$1", body);
  const after = replace(text("JS:", tail), pattern, "$2", body);
  const before = text(originalBefore, matchPrefix);
  append(text(matchPrefix, substitute(before, after, body)), body);
  set(beforeName, text(before, needle), body); set(tailName, after, body);
  nonempty.push({ kind: "repeat-count", count: { ...ref(matchesId, "Calculation Result"), valueType: "number" }, body, line });
  append(get(tailName, nonempty), nonempty);

  const empty: IRNode[] = [];
  // Empty/$&-only templates are a no-op even when the input has surrogate pairs.
  const noMatchTokens = replace(text("JS:", replacement), String.raw`\$&`, "", empty);
  const withInsertions: IRNode[] = [];
  const unicodeCheck = replace(text("JS:", input), String.raw`\AJS:[\s\S]*[^\u0000-\uFFFF][\s\S]*\z`, "TS_NON_BMP", withInsertions);
  const unsupported: IRNode[] = [];
  native("alert", [
    ["WFAlertActionTitle", { kind: "literal", value: "Unsupported text replacement" }],
    ["WFAlertActionMessage", { kind: "literal", value: "replaceAll with an empty search and this Unicode text needs UTF-16 surrogate splitting, which is not supported yet." }],
    ["WFAlertActionCancelButtonShown", { kind: "literal", value: false }],
  ], unsupported);
  native("exit", [], unsupported);
  const supported: IRNode[] = [];
  // Replace each Unicode scalar with ASCII before counting; native Characters
  // counts grapheme clusters. For BMP text these scalar boundaries are JS units.
  const marks = replace(text("JS:", input), String.raw`[\s\S]`, "x", supported);
  const countId = nextId();
  supported.push({ kind: "native", id: countId, identifier: "is.workflow.actions.count", parameters: { kind: "parameter-object", entries: [
    ["Input", { kind: "parameter-value", value: marks, encoding: "attachment" }], ["WFCountType", { kind: "literal", value: "Characters" }],
  ] }, line });
  const repetitions = nextId();
  supported.push({ kind: "math", id: repetitions, left: { ...ref(countId, "Count"), valueType: "number" }, operator: "-", right: { kind: "number", value: 2 }, line });
  const boundaries: IRNode[] = [], prefix = get(beforeName, boundaries), suffix = get(tailName, boundaries);
  append(substitute(prefix, suffix, boundaries), boundaries);
  const advance: IRNode[] = [];
  const char = replace(text("JS:", suffix), String.raw`\AJS:([\s\S])[\s\S]*\z`, "$1", advance);
  const remaining = replace(text("JS:", suffix), String.raw`\AJS:[\s\S]([\s\S]*)\z`, "$1", advance);
  append(char, advance); set(beforeName, text(prefix, char), advance); set(tailName, remaining, advance);
  boundaries.push(equal(suffix, "", [], advance));
  supported.push({ kind: "repeat-count", count: { ...ref(repetitions, "Calculation Result"), valueType: "number" }, body: boundaries, line });
  withInsertions.push(equal(unicodeCheck, "TS_NON_BMP", unsupported, supported));
  empty.push(equal(noMatchTokens, "JS:", [{ kind: "set", name: resultName, value: input, line }], withInsertions));
  // A literal search cannot switch between these paths at runtime. Omit its
  // unused branch to keep imported workflows and native editor previews small.
  if (needle.kind === "text" && needle.parts.every(part => typeof part === "string")) {
    nodes.push(...(needle.parts.join("") === "" ? empty : nonempty));
  } else {
    nodes.push(equal(needle, "", empty, nonempty));
  }
  return { nodes, value: get(resultName, nodes) };
}
