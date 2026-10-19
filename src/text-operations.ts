import type { IRNode, NativeParameter, OutputRef, TextValue, Value } from "./model.js";

export type Text = TextValue | OutputRef;

export function textOperations(nextId: () => number, line: number) {
  const text = (...values: (Text | string)[]): TextValue => ({ kind: "text", parts: values.flatMap(value => typeof value === "string" ? [value] : value.kind === "text" ? value.parts : [value]) });
  const ref = (id: number, outputName = "Variable"): OutputRef => ({ kind: "ref", id, outputName });
  const set = (name: string, value: Value, into: IRNode[]): void => { into.push({ kind: "set", name, value, line }); };
  const get = (name: string, into: IRNode[]): OutputRef => {
    const id = nextId(); into.push({ kind: "get", id, name, line }); return ref(id);
  };
  const flag = (name: string, value: boolean, into: IRNode[]): void => { into.push({ kind: "set", name, value: { kind: "boolean", value }, line }); };
  const native = (identifier: string, entries: [string, NativeParameter][], into: IRNode[]): OutputRef => {
    const id = nextId(); into.push({ kind: "native", id, identifier: `is.workflow.actions.${identifier}`, parameters: { kind: "parameter-object", entries }, line }); return ref(id, "Text");
  };
  const param = (value: Text): NativeParameter => ({ kind: "parameter-value", value, encoding: "text" });
  const replace = (value: Text, pattern: Text | string, substitution: string, into: IRNode[]): OutputRef => native("text.replace", [
    ["WFInput", param(value)], ["WFReplaceTextFind", typeof pattern === "string" ? { kind: "literal", value: pattern } : param(pattern)],
    ["WFReplaceTextReplace", { kind: "literal", value: substitution }], ["WFReplaceTextCaseSensitive", { kind: "literal", value: true }],
    ["WFReplaceTextRegularExpression", { kind: "literal", value: true }],
  ], into);
  const equal = (left: Text, right: string, yes: IRNode[], no: IRNode[] | null): IRNode => ({ kind: "if", left, operator: "===", right, then: yes, else: no, line });
  const whenFlag = (name: string, yes: IRNode[], no: IRNode[], into: IRNode[]): void => {
    into.push({ kind: "numeric-if", left: get(name, into), operator: "===", right: { kind: "boolean", value: true }, then: yes, else: no, line });
  };
  return { text, ref, set, get, flag, native, param, replace, equal, whenFlag };
}

