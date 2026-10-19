import type { IRNode, OutputRef, ScalarValue } from "./model.js";
import { textOperations, type Text } from "./text-operations.js";

/** Native Characters counts graphemes. ASCII markers count UTF-16 units instead. */
export function lowerTextLength(input: Text, nextId: () => number, line: number): { nodes: IRNode[]; value: OutputRef } {
  const nodes: IRNode[] = [];
  const { text, ref, replace } = textOperations(nextId, line);
  const wide = replace(text("JS:", input), String.raw`[^\u0000-\uFFFF]`, "xx", nodes);
  const marks = replace(wide, String.raw`[\s\S]`, "x", nodes);
  const countId = nextId(), lengthId = nextId();
  nodes.push({ kind: "native", id: countId, identifier: "is.workflow.actions.count", parameters: { kind: "parameter-object", entries: [
    ["Input", { kind: "parameter-value", value: marks, encoding: "attachment" }],
    ["WFCountType", { kind: "literal", value: "Characters" }],
  ] }, line });
  nodes.push({ kind: "math", id: lengthId, left: { ...ref(countId, "Count"), valueType: "number" }, operator: "-", right: { kind: "number", value: 3 }, line });
  return { nodes, value: { ...ref(lengthId, "Calculation Result"), valueType: "number" } };
}

function lowerTextPosition(input: Text, suppliedStart: ScalarValue, nextId: () => number, line: number): { nodes: IRNode[]; value: ScalarValue } {
  const nodes: IRNode[] = [];
  const { ref, get } = textOperations(nextId, line);
  const num = (value: number): ScalarValue => ({ kind: "number", value });
  const getNumber = (name: string, into: IRNode[]): OutputRef => ({ ...get(name, into), valueType: "number" });
  const calc = (left: ScalarValue, operator: "-" | "%", right: ScalarValue, into: IRNode[]): OutputRef => {
    const id = nextId(); into.push({ kind: "math", id, left, operator, right, line }); return { ...ref(id, "Calculation Result"), valueType: "number" };
  };
  const length = (value: Text, into: IRNode[]): OutputRef => {
    const lowered = lowerTextLength(value, nextId, line); into.push(...lowered.nodes); return lowered.value;
  };
  let start: ScalarValue;
  if (suppliedStart.kind === "number" && suppliedStart.value < 1) {
    start = num(0);
  } else {
    const size = length(input, nodes);
    const integer = suppliedStart.kind === "number" ? num(Math.trunc(suppliedStart.value))
      : calc(suppliedStart, "-", calc(suppliedStart, "%", num(1), nodes), nodes);
    const startName = `ts_${nextId()}_text_start`;
    nodes.push({ kind: "numeric-if", left: integer, operator: "<", right: num(0), then: [
      { kind: "set", name: startName, value: num(0), line },
    ], else: [{ kind: "numeric-if", left: integer, operator: ">", right: size,
      then: [{ kind: "set", name: startName, value: size, line }],
      else: [{ kind: "set", name: startName, value: integer, line }], line }], line });
    start = getNumber(startName, nodes);
  }
  return { nodes, value: start };
}

/** Search from a UTF-16 position without slicing surrogate pairs into native text. */
export function lowerTextIndexOf(input: Text, needle: Text, suppliedStart: ScalarValue, nextId: () => number, line: number): { nodes: IRNode[]; value: OutputRef } {
  const start = lowerTextPosition(input, suppliedStart, nextId, line);
  const search = searchTextAt(input, needle, start.value, nextId, line);
  return { nodes: [...start.nodes, ...search.nodes], value: search.value };
}

/** Positional predicates compare against a clamped UTF-16 start or end. */
export function lowerTextPredicate(method: "includes" | "startsWith" | "endsWith", input: Text, needle: Text, suppliedPosition: ScalarValue, nextId: () => number, line: number): { nodes: IRNode[]; value: OutputRef } {
  const { nodes, value: position } = lowerTextPosition(input, suppliedPosition, nextId, line);
  const { set, get } = textOperations(nextId, line);
  const resultName = `ts_${nextId()}_text_predicate`;
  const yes: IRNode[] = [], no: IRNode[] = [];
  set(resultName, { kind: "boolean", value: true }, yes);
  set(resultName, { kind: "boolean", value: false }, no);
  const compareAt = (start: ScalarValue, into: IRNode[]): void => {
    const search = searchTextAt(input, needle, start, nextId, line);
    into.push(...search.nodes);
    into.push({ kind: "numeric-if", left: search.value, operator: method === "includes" ? ">=" : "===",
      right: method === "includes" ? { kind: "number", value: 0 } : start, then: yes, else: no, line });
  };
  if (method === "endsWith") {
    const length = lowerTextLength(needle, nextId, line);
    nodes.push(...length.nodes);
    const startId = nextId();
    const start: OutputRef = { kind: "ref", id: startId, outputName: "Calculation Result", valueType: "number" };
    nodes.push({ kind: "math", id: startId, left: position, operator: "-", right: length.value, line });
    const inRange: IRNode[] = []; compareAt(start, inRange);
    nodes.push({ kind: "numeric-if", left: start, operator: ">=", right: { kind: "number", value: 0 }, then: inRange, else: no, line });
  } else {
    compareAt(position, nodes);
  }
  return { nodes, value: { ...get(resultName, nodes), valueType: "boolean" } };
}

/** Internal search: start is already clamped to the receiver's UTF-16 bounds. */
function searchTextAt(input: Text, needle: Text, start: ScalarValue, nextId: () => number, line: number): { nodes: IRNode[]; value: OutputRef } {
  const nodes: IRNode[] = [];
  const { text, ref, set, get, replace, equal } = textOperations(nextId, line);
  const num = (value: number): ScalarValue => ({ kind: "number", value });
  const getNumber = (name: string, into: IRNode[]): OutputRef => ({ ...get(name, into), valueType: "number" });
  const calc = (left: ScalarValue, operator: "+" | "-" | "%", right: ScalarValue, into: IRNode[]): OutputRef => {
    const id = nextId(); into.push({ kind: "math", id, left, operator, right, line }); return { ...ref(id, "Calculation Result"), valueType: "number" };
  };
  const length = (value: Text, into: IRNode[]): OutputRef => {
    const lowered = lowerTextLength(value, nextId, line); into.push(...lowered.nodes); return lowered.value;
  };
  const resultName = `ts_${nextId()}_text_index`;
  set(resultName, num(-1), nodes);
  const nonempty: IRNode[] = [];
  const escaped = replace(text("JS:", needle), "([.*+?^${}()|\\[\\]\\\\])", "\\\\$1", nonempty);
  const literalNeedle = replace(escaped, String.raw`\AJS:`, "", nonempty);
  const pattern = text("\\AJS:([\\s\\S]*?)", literalNeedle, "[\\s\\S]*\\z");
  const search = (tail: Text, offset: ScalarValue, into: IRNode[]): void => {
    const foundId = nextId();
    into.push({ kind: "string", method: "includes", id: foundId, input: tail, args: [needle], line });
    const found: IRNode[] = [];
    const prefix = replace(text("JS:", tail), pattern, "$1", found);
    set(resultName, calc(offset, "+", length(prefix, found), found), found);
    into.push({ kind: "numeric-if", left: { ...ref(foundId, "If Result"), valueType: "boolean" }, operator: "===", right: { kind: "boolean", value: true }, then: found, else: null, line });
  };
  if (start.kind === "number" && start.value === 0) {
    search(input, start, nonempty);
  } else {
    const tailName = `ts_${nextId()}_search_tail`, offsetName = `ts_${nextId()}_search_offset`, doneName = `ts_${nextId()}_search_done`;
    set(tailName, input, nonempty); set(offsetName, num(0), nonempty); set(doneName, { kind: "boolean", value: false }, nonempty);
    const body: IRNode[] = [], active: IRNode[] = [];
    const offset = getNumber(offsetName, active), tail = get(tailName, active);
    const ready: IRNode[] = []; search(tail, offset, ready); set(doneName, { kind: "boolean", value: true }, ready);
    const advance: IRNode[] = [];
    const first = replace(text("JS:", tail), String.raw`\AJS:([\s\S])[\s\S]*\z`, "$1", advance);
    const rest = replace(text("JS:", tail), String.raw`\AJS:[\s\S]([\s\S]*)\z`, "$1", advance);
    set(offsetName, calc(offset, "+", length(first, advance), advance), advance); set(tailName, rest, advance);
    active.push({ kind: "numeric-if", left: offset, operator: ">=", right: start, then: ready, else: advance, line });
    const done = get(doneName, body);
    body.push({ kind: "numeric-if", left: done, operator: "===", right: { kind: "boolean", value: false }, then: active, else: null, line });
    // Advancing a scalar moves one or two UTF-16 units. At most start advances
    // reach the requested position; the final pass performs the search once.
    nonempty.push({ kind: "repeat-count", count: calc(start, "+", num(1), nonempty), body, line });
  }
  const empty: IRNode[] = [{ kind: "set", name: resultName, value: start, line }];
  if (needle.kind === "text" && needle.parts.every(part => typeof part === "string")) {
    nodes.push(...(needle.parts.join("") === "" ? empty : nonempty));
  } else {
    nodes.push(equal(needle, "", empty, nonempty));
  }
  return { nodes, value: getNumber(resultName, nodes) };
}
