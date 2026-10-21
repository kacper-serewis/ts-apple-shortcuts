import type { IRNode, ObjectRef, OutputRef, Value } from "./model.js";

// Internal calls carry text, so neither empty nor singleton lists are flattened
// by Run Shortcut. The prefix is reserved only in shortcuts that use while.
export const whilePrefix = "__ts_shortcuts_while_v1__:";
export interface WhileRoutine { id: number; body: IRNode[]; line: number }
export class WhileRuntime {
  readonly routines: WhileRoutine[] = [];
  private inputRef?: ObjectRef;
  get input(): ObjectRef {
    return this.inputRef ??= { kind: "object-ref", id: this.next(), outputName: "Loop State" };
  }
  constructor(private next: () => number, private name: string) {}
  private ref(id: number): OutputRef { return { kind: "ref", id, outputName: "Text" }; }
  private replace(input: Value, pattern: string, replacement: string, line: number): IRNode {
    return { kind: "native", id: this.next(), identifier: "is.workflow.actions.text.replace", line,
      parameters: { kind: "parameter-object", entries: [
        ["WFInput", { kind: "parameter-value", value: input, encoding: "text" }],
        ["WFReplaceTextFind", { kind: "literal", value: pattern }],
        ["WFReplaceTextReplace", { kind: "literal", value: replacement }],
        ["WFReplaceTextCaseSensitive", { kind: "literal", value: true }],
        ["WFReplaceTextRegularExpression", { kind: "literal", value: true }],
      ] } };
  }
  call(id: number, entries: [string, Value][], output: IRNode[], line: number): ObjectRef {
    const state = this.next(), json = this.next(), call = this.next(), result = this.next();
    output.push({ kind: "dictionary", id: state, entries: [["routine", { kind: "number", value: id }], ...entries], line });
    output.push({ kind: "json", operation: "stringify", id: json, input: { kind: "object-ref", id: state, outputName: "Dictionary" }, line });
    output.push({ kind: "native", id: call, identifier: "is.workflow.actions.runworkflow", line,
      parameters: { kind: "parameter-object", entries: [
        ["WFWorkflow", { kind: "literal", value: { workflowName: this.name } }],
        ["WFInput", { kind: "parameter-value", encoding: "attachment", value: { kind: "text", parts: [whilePrefix, this.ref(json)] } }],
      ] } });
    output.push({ kind: "json", operation: "parse", id: result, input: this.ref(call), line });
    return { kind: "object-ref", id: result, outputName: "Loop State" };
  }
  finish(entries: [string, Value][], output: IRNode[], line: number): void {
    const state = this.next(), json = this.next();
    output.push({ kind: "dictionary", id: state, entries, line });
    output.push({ kind: "json", operation: "stringify", id: json, input: { kind: "object-ref", id: state, outputName: "Dictionary" }, line });
    this.returnText(this.ref(json), output, line);
  }
  returnText(value: OutputRef, output: IRNode[], line: number): void {
    // Stop and Output has a text-token parameter, unlike Run Shortcut's input.
    output.push({ kind: "native", id: this.next(), identifier: "is.workflow.actions.output", line,
      parameters: { kind: "parameter-object", entries: [
        ["WFOutput", { kind: "parameter-value", value, encoding: "text" }],
      ] } });
  }
  wrap(main: IRNode[]): IRNode[] {
    if (!this.routines.length) return main;
    const line = this.routines[0].line, input = this.next();
    const raw = this.ref(input);
    const marker = this.replace(raw, `\\A${whilePrefix}[\\s\\S]*\\z`, whilePrefix, line);
    const stripped = this.replace(raw, `\\A${whilePrefix}`, "", line);
    if (marker.kind !== "native" || stripped.kind !== "native") throw new Error("Expected native replacement");
    const route = this.next();
    const dispatch: IRNode[] = [stripped,
      { kind: "json", operation: "parse", id: this.input.id, input: this.ref(stripped.id), line },
      { kind: "field", id: route, input: this.input, key: "routine", line },
      ...this.routines.map(routine => ({ kind: "numeric-if" as const, left: { ...this.ref(route), valueType: "number" as const },
        operator: "===" as const, right: { kind: "number" as const, value: routine.id }, then: routine.body, else: null, line: routine.line })),
      { kind: "return", line },
    ];
    return [
      { kind: "native", id: input, identifier: "is.workflow.actions.getvariable", parameters: { kind: "literal", value: {
        WFVariable: { Value: { Type: "ExtensionInput" }, WFSerializationType: "WFTextTokenAttachment" },
      } }, line }, marker,
      { kind: "if", left: this.ref(marker.id), operator: "===", right: whilePrefix, then: dispatch, else: null, line },
      ...main,
    ];
  }
}
