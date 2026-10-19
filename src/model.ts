export type PlistValue = string | number | boolean | Date | Uint8Array | PlistValue[] | PlistDictionary;
export interface PlistDictionary { [key: string]: PlistValue }

export interface OutputRef {
  kind: "ref";
  id: number;
  outputName: string;
  valueType?: "number" | "boolean" | "content";
}
export interface TextValue {
  kind: "text";
  parts: (string | OutputRef)[];
}
export interface ListRef {
  kind: "list-ref";
  id: number;
  outputName: string;
  /** Omitted means one dimension; -1 means mixed or recursive array nesting. */
  arrayDepth?: number;
}
export interface NumberValue { kind: "number"; value: number }
export interface BooleanValue { kind: "boolean"; value: boolean }
export type ScalarValue = TextValue | OutputRef | NumberValue | BooleanValue;
export interface ObjectRef {
  kind: "object-ref";
  id: number;
  outputName: string;
}
export type Value = ScalarValue | ListRef | ObjectRef;
export type ActionName = "askText" | "showResult" | "notify" | "speak" | "getJson";

export interface ActionNode {
  kind: "action";
  action: ActionName;
  argument: ScalarValue;
  id: number;
  line: number;
}
export interface IfNode {
  kind: "if";
  left: ScalarValue;
  operator: "===" | "!==";
  right: string | TextValue | OutputRef;
  then: IRNode[];
  else: IRNode[] | null;
  line: number;
}
export interface ListNode {
  kind: "list";
  id: number;
  items: Value[];
  line: number;
}
export interface RepeatNode {
  kind: "repeat";
  id: number;
  input: ListRef;
  body: IRNode[];
  resultId?: number;
  line: number;
}
export interface FieldNode {
  kind: "field";
  id: number;
  input: ObjectRef;
  key: string;
  line: number;
}
export type NativeParameter =
  | { kind: "literal"; value: PlistValue }
  | { kind: "parameter-array"; items: NativeParameter[] }
  | { kind: "parameter-object"; entries: [string, NativeParameter][] }
  | { kind: "parameter-value"; value: Value; encoding: "auto" | "text" | "attachment" | "dictionary" | "token" };
export interface NativeNode {
  kind: "native"; id: number; identifier: string; parameters: NativeParameter; line: number;
  preserveParameters?: boolean;
}
export interface DictionaryNode { kind: "dictionary"; id: number; entries: [string, Value][]; line: number }
export interface MathNode { kind: "math"; id: number; left: ScalarValue; right: ScalarValue; operator: "+" | "-" | "*" | "/" | "%" | "**"; line: number }
export interface NumericIfNode { kind: "numeric-if"; left: ScalarValue; right: ScalarValue; operator: "===" | "!==" | "<" | "<=" | ">" | ">="; then: IRNode[]; else: IRNode[] | null; line: number }
export interface SetNode { kind: "set"; name: string; value: Value; line: number }
export interface GetNode { kind: "get"; id: number; name: string; line: number }
export interface ReturnNode { kind: "return"; value?: Value; line: number }
export interface RepeatCountNode { kind: "repeat-count"; count: ScalarValue; body: IRNode[]; line: number }
export interface MenuNode { kind: "menu"; prompt: ScalarValue; cases: { title: string; body: IRNode[] }[]; line: number }
export interface IndexNode { kind: "index"; id: number; input: ListRef; index: number | ScalarValue; line: number }
export interface YieldNode { kind: "yield"; value?: Value; line: number }
export interface JsonNode { kind: "json"; operation: "parse" | "stringify"; id: number; input: Value; line: number }
export type StringMethod = "trim" | "trimStart" | "trimEnd" | "toUpperCase" | "toLowerCase" | "concat" | "startsWith" | "endsWith" | "includes";
export interface StringNode { kind: "string"; method: StringMethod; id: number; input: ScalarValue; args: ScalarValue[]; line: number }
export type IRNode = ActionNode | IfNode | ListNode | RepeatNode | FieldNode | NativeNode | DictionaryNode | MathNode | NumericIfNode | SetNode | GetNode | ReturnNode | RepeatCountNode | MenuNode | IndexNode | YieldNode | JsonNode | StringNode;

export interface NativeAction extends PlistDictionary {
  WFWorkflowActionIdentifier: string;
  WFWorkflowActionParameters: PlistDictionary;
}
export interface Workflow extends PlistDictionary {
  WFWorkflowActions: NativeAction[];
}
export interface SourceLocation { actionIndex: number; line: number }
export interface Emission { workflow: Workflow; sourceMap: SourceLocation[] }
export interface Compilation extends Emission { ir: IRNode[] }
