import type { IRNode, OutputRef, ScalarValue } from "./model.js";

export const countedLoopError = "This for loop requires safe integer start, boundary and step values, a step toward the boundary, and a safe integer iteration span.";

/** Count an integer progression exactly; unsupported runtime ranges stop explicitly. */
export function lowerForCount(start: ScalarValue, end: ScalarValue, step: ScalarValue, ascending: boolean, inclusive: boolean, nextId: () => number, line: number): { nodes: IRNode[]; value: ScalarValue } {
  const nodes: IRNode[] = [];
  const num = (value: number): ScalarValue => ({ kind: "number", value });
  const ref = (id: number): OutputRef => ({ kind: "ref", id, outputName: "Calculation Result", valueType: "number" });
  const calc = (left: ScalarValue, operator: "+" | "-" | "/" | "%", right: ScalarValue, into: IRNode[]): OutputRef => {
    const id = nextId(); into.push({ kind: "math", id, left, operator, right, line }); return ref(id);
  };
  const reject = (): IRNode[] => [
    { kind: "native", id: nextId(), identifier: "is.workflow.actions.alert", parameters: { kind: "parameter-object", entries: [
      ["WFAlertActionTitle", { kind: "literal", value: "Unsupported for loop range" }],
      ["WFAlertActionMessage", { kind: "literal", value: countedLoopError }],
      ["WFAlertActionCancelButtonShown", { kind: "literal", value: false }],
    ] }, line },
    { kind: "native", id: nextId(), identifier: "is.workflow.actions.exit", parameters: { kind: "literal", value: {} }, line },
  ];
  const require = (left: ScalarValue, operator: "===" | ">" | "<" | ">=" | "<=", right: ScalarValue, into: IRNode[]): void => {
    into.push({ kind: "numeric-if", left, operator, right, then: [], else: reject(), line });
  };
  for (const input of [start, end, step]) if (input.kind !== "number") {
    require(calc(input, "%", num(1), nodes), "===", num(0), nodes);
    require(input, ">=", num(-Number.MAX_SAFE_INTEGER), nodes);
    require(input, "<=", num(Number.MAX_SAFE_INTEGER), nodes);
  }
  if (step.kind !== "number") require(step, ascending ? ">" : "<", num(0), nodes);
  const distance = calc(ascending ? end : start, "-", ascending ? start : end, nodes);
  const positive = ascending ? step : calc(num(0), "-", step, nodes);
  const name = `ts_${nextId()}_for_count`;
  const active: IRNode[] = [];
  require(distance, "<=", num(Number.MAX_SAFE_INTEGER), active);
  const remainder = calc(distance, "%", positive, active);
  const whole = calc(calc(distance, "-", remainder, active), "/", positive, active);
  const extra = calc(whole, "+", num(1), active);
  // Inclusive ranges need one more iteration even when the span divides evenly.
  if (inclusive) {
    require(extra, "<=", num(Number.MAX_SAFE_INTEGER), active);
    active.push({ kind: "set", name, value: extra, line });
  } else {
    active.push({ kind: "numeric-if", left: remainder, operator: ">", right: num(0),
      then: [{ kind: "set", name, value: extra, line }], else: [{ kind: "set", name, value: whole, line }], line });
  }
  nodes.push({ kind: "numeric-if", left: distance, operator: inclusive ? ">=" : ">", right: num(0),
    then: active, else: [{ kind: "set", name, value: num(0), line }], line });
  const id = nextId(); nodes.push({ kind: "get", id, name, line });
  return { nodes, value: { ...ref(id), outputName: "Variable" } };
}
