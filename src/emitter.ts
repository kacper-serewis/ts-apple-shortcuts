import { actions } from "./actions.js";
import { isDictionary } from "./native.js";
import type { Emission, IRNode, ListRef, NativeAction, ObjectRef, OutputRef, PlistDictionary, PlistValue, ScalarValue, SourceLocation, Value, NativeParameter } from "./model.js";

export function emitWorkflow(ir: IRNode[], { name, settings = {} }: { name: string; settings?: PlistDictionary }): Emission {
  const emitted: NativeAction[] = [];
  const sourceMap: SourceLocation[] = [];
  const refs = new Map<number, string>();
  const dictionaries = new Map<number, [string, Value][]>();
  const lists = new Map<number, Value[]>();
  const uuid = () => crypto.randomUUID().toUpperCase();
  function token(ref: OutputRef | ListRef | ObjectRef): PlistDictionary {
    const id = refs.get(ref.id);
    if (!id) throw new Error(`Missing action output ${ref.id}`);
    return { Type: "ActionOutput", OutputUUID: id, OutputName: ref.outputName };
  }
  const attachment = (ref: OutputRef | ListRef | ObjectRef) => ({ Value: token(ref), WFSerializationType: "WFTextTokenAttachment" });
  function text(value: ScalarValue): PlistValue {
    const parts = value.kind === "ref" ? [value] : value.kind === "text" ? value.parts : [String(value.value)];
    let string = "";
    const attachmentsByRange: PlistDictionary = {};
    for (const part of parts) {
      if (typeof part === "string") string += part;
      else {
        // NSString ranges and JavaScript string.length both count UTF-16 units.
        attachmentsByRange[`{${string.length}, 1}`] = token(part);
        string += "\uFFFC";
      }
    }
    return Object.keys(attachmentsByRange).length
      ? { Value: { string, attachmentsByRange }, WFSerializationType: "WFTextTokenString" }
      : string;
  }
  function emit(identifier: string, parameters: PlistDictionary, line: number): void {
    emitted.push({ WFWorkflowActionIdentifier: `is.workflow.actions.${identifier}`, WFWorkflowActionParameters: parameters });
    sourceMap.push({ actionIndex: emitted.length - 1, line });
  }
  function materialize(value: Value, line: number): PlistDictionary {
    if (value.kind === "ref" || value.kind === "list-ref" || value.kind === "object-ref") return attachment(value);
    const id = uuid();
    if (value.kind === "number" || value.kind === "boolean") {
      emit("number", { UUID: id, WFNumberActionNumber: Number(value.value) }, line);
      return { Value: { Type: "ActionOutput", OutputUUID: id, OutputName: "Number" }, WFSerializationType: "WFTextTokenAttachment" };
    }
    emit("gettext", { UUID: id, WFTextActionText: text(value) }, line);
    return { Value: { Type: "ActionOutput", OutputUUID: id, OutputName: "Text" }, WFSerializationType: "WFTextTokenAttachment" };
  }
  function nativeValue(value: Value, line: number): PlistValue {
    if (value.kind === "text") return text(value);
    if (value.kind === "number" || value.kind === "boolean") return value.value;
    return materialize(value, line);
  }
  function parameter(node: NativeParameter, line: number): PlistValue {
    if (node.kind === "literal") return node.value;
    if (node.kind === "parameter-array") return node.items.map(item => parameter(item, line));
    if (node.kind === "parameter-object") return Object.fromEntries(node.entries.map(([key, item]) => [key, parameter(item, line)]));
    if (node.encoding === "attachment") return materialize(node.value, line);
    if (node.encoding === "token") {
      // Dictionary Value is a text-token parameter, but the payload must retain
      // its native content type. Materialize scalars instead of stringifying them.
      const input = materialize(node.value, line);
      return { Value: { string: "\uFFFC", attachmentsByRange: { "{0, 1}": input.Value } }, WFSerializationType: "WFTextTokenString" };
    }
    if (node.encoding === "dictionary") {
      if (node.value.kind !== "object-ref" || !dictionaries.has(node.value.id)) throw new Error(`Line ${line}: dictionary() requires an inline-encodable object literal or a const alias. Use attachment() for an existing dictionary when the native parameter accepts a variable.`);
      return dictionary(dictionaries.get(node.value.id)!, line);
    }
    if (node.encoding === "text") {
      if (node.value.kind === "list-ref" || node.value.kind === "object-ref") {
        return { Value: { string: "\uFFFC", attachmentsByRange: { "{0, 1}": token(node.value) } }, WFSerializationType: "WFTextTokenString" };
      }
      return text(node.value);
    }
    return nativeValue(node.value, line);
  }
  function listItem(value: Value, line: number): PlistDictionary {
    if (value.kind === "object-ref" && dictionaries.has(value.id)) {
      return { WFItemType: 1, WFValue: { Value: dictionary(dictionaries.get(value.id)!, line), WFSerializationType: "WFDictionaryFieldValue" } };
    }
    if (value.kind === "list-ref" && lists.has(value.id)) {
      return { WFItemType: 2, WFValue: { Value: lists.get(value.id)!.map(v => listItem(v, line)), WFSerializationType: "WFArrayParameterState" } };
    }
    if (value.kind === "object-ref" || value.kind === "list-ref") {
      throw new Error(`Line ${line}: embedding a dynamic object/list in native parameter field state is not supported. Compose the value in TypeScript and pass its result with attachment().`);
    }
    if (value.kind === "boolean" || value.kind === "ref" && value.valueType === "boolean") {
      return { WFItemType: 4, WFValue: { Value: value.kind === "boolean" ? Number(value.value) : attachment(value), WFSerializationType: "WFNumberSubstitutableState" } };
    }
    const type = value.kind === "number" || value.kind === "ref" && value.valueType === "number" ? 3 : 0;
    const encoded = parameter({ kind: "parameter-value", value, encoding: "text" }, line);
    return { WFItemType: type, WFValue: typeof encoded === "string" ? { Value: { string: encoded }, WFSerializationType: "WFTextTokenString" } : encoded };
  }
  function dictionary(entries: [string, Value][], line: number): PlistDictionary {
    return { Value: { WFDictionaryFieldValueItems: entries.map(([key, value]) => ({
      ...listItem(value, line), WFKey: { Value: { string: key }, WFSerializationType: "WFTextTokenString" },
    })) }, WFSerializationType: "WFDictionaryFieldValue" };
  }
  function dynamicContainer(value: Value): boolean {
    return value.kind === "object-ref" && !dictionaries.has(value.id)
      || value.kind === "list-ref" && !lists.has(value.id);
  }
  let internalId = -1;
  function localRef(id: string, outputName: string): OutputRef;
  function localRef(id: string, outputName: string, kind: "object-ref"): ObjectRef;
  function localRef(id: string, outputName: string, kind: "ref" | "object-ref" = "ref"): OutputRef | ObjectRef {
    const ref = { kind, id: internalId--, outputName };
    refs.set(ref.id, id);
    return ref;
  }
  function replace(input: OutputRef, pattern: string, replacement: string, line: number): OutputRef {
    const id = uuid();
    emit("text.replace", { UUID: id, WFInput: text(input), WFReplaceTextFind: pattern,
      WFReplaceTextReplace: replacement, WFReplaceTextCaseSensitive: true, WFReplaceTextRegularExpression: true }, line);
    return localRef(id, "Updated Text");
  }
  function jsonContainer(value: ObjectRef | ListRef, line: number): OutputRef {
    if (value.kind === "object-ref") {
      const id = uuid();
      emit("gettext", { UUID: id, WFTextActionText: parameter({ kind: "parameter-value", value, encoding: "text" }, line) }, line);
      return localRef(id, "Text");
    }
    if (value.arrayDepth !== undefined && value.arrayDepth !== 1) throw new Error(`Line ${line}: runtime nested arrays (including mixed or recursive array nesting) cannot be serialized as JSON yet.`);
    const countId = uuid();
    emit("count", { UUID: countId, Input: attachment(value), WFCountType: "Items" }, line);
    const count = localRef(countId, "Count");
    const conditionInput = { Type: "Variable", Variable: attachment(count) };
    const group = uuid();
    emit("conditional", { GroupingIdentifier: group, WFControlFlowMode: 0, WFCondition: 2, WFNumberValue: 0, WFInput: conditionInput }, line);
    const empty = uuid();
    emit("dictionary", { UUID: empty, WFItems: dictionary([], line) }, line);
    const wrapped = uuid();
    emit("setvalueforkey", { UUID: wrapped, WFDictionary: attachment(localRef(empty, "Dictionary", "object-ref")), WFDictionaryKey: "__value",
      WFDictionaryValue: parameter({ kind: "parameter-value", value, encoding: "token" }, line) }, line);
    const json = jsonContainer(localRef(wrapped, "Dictionary", "object-ref"), line);
    const contents = replace(json, String.raw`\A\s*\{\s*"__value"\s*:\s*([\s\S]*)\}\s*\z`, "$1", line);
    const singleton = uuid();
    emit("conditional", { GroupingIdentifier: singleton, WFControlFlowMode: 0, WFCondition: 4, WFNumberValue: 1, WFInput: conditionInput }, line);
    emit("gettext", { UUID: uuid(), WFTextActionText: text({ kind: "text", parts: ["[", contents, "]"] }) }, line);
    emit("conditional", { GroupingIdentifier: singleton, WFControlFlowMode: 1 }, line);
    emit("getvariable", { UUID: uuid(), WFVariable: attachment(contents) }, line);
    emit("conditional", { UUID: uuid(), GroupingIdentifier: singleton, WFControlFlowMode: 2 }, line);
    emit("conditional", { GroupingIdentifier: group, WFControlFlowMode: 1 }, line);
    emit("gettext", { UUID: uuid(), WFTextActionText: "[]" }, line);
    const result = uuid();
    emit("conditional", { UUID: result, GroupingIdentifier: group, WFControlFlowMode: 2 }, line);
    return localRef(result, "If Result");
  }
  function branches(identifier: string, group: string, yes: IRNode[], no: IRNode[] | null, line: number): void {
    visit(yes);
    if (no?.length) {
      emit(identifier, { GroupingIdentifier: group, WFControlFlowMode: 1 }, line);
      visit(no);
    }
    emit(identifier, { GroupingIdentifier: group, WFControlFlowMode: 2 }, line);
  }
  function jsonValue(value: Value, line: number): OutputRef {
    if (value.kind === "object-ref" || value.kind === "list-ref") return jsonContainer(value, line);
    if (value.kind === "ref" && value.valueType === "content") throw new Error(`Line ${line}: JSON composition requires JSON-compatible values, not opaque native content.`);
    const wrapped = uuid();
    emit("dictionary", { UUID: wrapped, WFItems: dictionary([["__value", value]], line) }, line);
    return replace(jsonContainer(localRef(wrapped, "Dictionary", "object-ref"), line), String.raw`\A\s*\{\s*"__value"\s*:\s*([\s\S]*)\}\s*\z`, "$1", line);
  }
  function assembleList(items: { value: Value; spread: boolean }[], line: number): string {
    // Serialize each item independently. Delimiters are only edited at the
    // boundaries of complete JSON fragments, never inside user strings.
    const parts: (string | OutputRef)[] = ['{"__value":['];
    for (const item of items) {
      if (item.spread) {
        if (item.value.kind !== "list-ref") throw new Error(`Line ${line}: array spreads require a list.`);
        const contents = replace(jsonContainer(item.value, line), String.raw`\A\[([\s\S]+)\]\z`, ",$1", line);
        parts.push(replace(contents, String.raw`\A\[\]\z`, "", line));
      } else {
        if (item.value.kind === "list-ref") throw new Error(`Line ${line}: nested array elements are not supported in composed arrays; use a spread to append a flat list.`);
        parts.push(",", jsonValue(item.value, line));
      }
    }
    parts.push("]}");
    const joined = uuid();
    emit("gettext", { UUID: joined, WFTextActionText: text({ kind: "text", parts }) }, line);
    const json = replace(localRef(joined, "Text"), String.raw`\A\{"__value":\[,`, '{"__value":[', line);
    const parsed = uuid();
    emit("detect.dictionary", { UUID: parsed, WFInput: attachment(json) }, line);
    const result = uuid();
    emit("getvalueforkey", { UUID: result, WFInput: attachment(localRef(parsed, "Dictionary", "object-ref")), WFDictionaryKey: "__value", WFGetDictionaryValueType: "Value" }, line);
    return result;
  }
  function visit(nodes: IRNode[]): void {
    for (const node of nodes) {
      if (node.kind === "action") {
        const definition = actions.get(node.action)!;
        const id = uuid();
        refs.set(node.id, id);
        emit(definition.id, { ...definition.defaults, UUID: id, [definition.parameter]: text(node.argument) }, node.line);
      } else if (node.kind === "native") {
        const parameters = parameter(node.parameters, node.line);
        if (!isDictionary(parameters)) throw new Error("Native parameters must be a dictionary.");
        const id = parameters.UUID ?? uuid();
        if (typeof id !== "string") throw new Error("Native UUID must be a string.");
        refs.set(node.id, id);
        emitted.push({ WFWorkflowActionIdentifier: node.identifier, WFWorkflowActionParameters: node.preserveParameters ? parameters : { ...parameters, UUID: id } });
        sourceMap.push({ actionIndex: emitted.length - 1, line: node.line });
      } else if (node.kind === "string") {
        const parts = (value: ScalarValue) => value.kind === "text" ? value.parts : value.kind === "ref" ? [value] : [String(value.value)];
        const id = uuid();
        refs.set(node.id, id);
        if (node.method === "concat") {
          emit("gettext", { UUID: id, WFTextActionText: text({ kind: "text", parts: [node.input, ...node.args].flatMap(parts) }) }, node.line);
        } else if (node.method === "toUpperCase" || node.method === "toLowerCase") {
          emit("text.changecase", { UUID: id, text: text(node.input), WFCaseType: node.method === "toUpperCase" ? "UPPERCASE" : "lowercase" }, node.line);
        } else if (node.method === "trim" || node.method === "trimStart" || node.method === "trimEnd") {
          // ECMAScript WhiteSpace + LineTerminator, deliberately not ICU's broader \s.
          const whitespace = String.raw`[\u0009-\u000D\u0020\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF]`;
          emit("text.replace", { UUID: id,
            WFInput: text({ kind: "text", parts: ["JS:", ...parts(node.input)] }),
            WFReplaceTextFind: `\\AJS:${node.method !== "trimEnd" ? whitespace + "*" : ""}([\\s\\S]*?)${node.method !== "trimStart" ? whitespace + "*" : ""}\\z`,
            WFReplaceTextReplace: "$1", WFReplaceTextCaseSensitive: true, WFReplaceTextRegularExpression: true,
          }, node.line);
        } else {
          // Prefix both native inputs to keep empty text valid. Escape the search
          // literally, then remove its prefix before composing the anchored pattern.
          const searchId = uuid();
          emit("gettext", { UUID: searchId, WFTextActionText: text({ kind: "text", parts: ["JS:", ...parts(node.args[0])] }) }, node.line);
          const escaped = replace(localRef(searchId, "Text"), "([.*+?^${}()|\\[\\]\\\\])", "\\\\$1", node.line);
          const needle = replace(escaped, String.raw`\AJS:`, "", node.line);
          const matchId = uuid();
          emit("text.replace", { UUID: matchId,
            WFInput: text({ kind: "text", parts: ["JS:", ...parts(node.input)] }),
            WFReplaceTextFind: text({ kind: "text", parts: [node.method === "startsWith" ? "\\AJS:" : "\\AJS:[\\s\\S]*", needle, node.method === "endsWith" ? "\\z" : "[\\s\\S]*\\z"] }),
            WFReplaceTextReplace: "TS_MATCH", WFReplaceTextCaseSensitive: true, WFReplaceTextRegularExpression: true,
          }, node.line);
          const group = uuid();
          emit("conditional", { GroupingIdentifier: group, WFControlFlowMode: 0, WFCondition: 4,
            WFConditionalActionString: "TS_MATCH",
            WFInput: { Type: "Variable", Variable: { Value: {
              Type: "ActionOutput", OutputUUID: matchId, OutputName: "Updated Text",
              Aggrandizements: [{ Type: "WFCoercionVariableAggrandizement", CoercionItemClass: "WFStringContentItem" }],
            }, WFSerializationType: "WFTextTokenAttachment" } },
          }, node.line);
          emit("number", { UUID: uuid(), WFNumberActionNumber: 1 }, node.line);
          emit("conditional", { GroupingIdentifier: group, WFControlFlowMode: 1 }, node.line);
          emit("number", { UUID: uuid(), WFNumberActionNumber: 0 }, node.line);
          emit("conditional", { UUID: id, GroupingIdentifier: group, WFControlFlowMode: 2 }, node.line);
        }
      } else if (node.kind === "assemble-dictionary") {
        const parts: (string | OutputRef)[] = ["{"];
        // All expressions have already been evaluated in source order by the
        // frontend. Reverse only JSON fragments: this native parser keeps the
        // first duplicate key, so later TS fields must occur first here.
        for (const part of [...node.parts].reverse()) {
          if (part.kind === "entry") parts.push("," + JSON.stringify(part.key) + ":", jsonValue(part.value, node.line));
          else {
            const contents = replace(jsonContainer(part.value, node.line), String.raw`\A\s*\{([\s\S]*)\}\s*\z`, ",$1", node.line);
            parts.push(replace(contents, String.raw`\A,\s*\z`, "", node.line));
          }
        }
        parts.push("}");
        const joined = uuid();
        emit("gettext", { UUID: joined, WFTextActionText: text({ kind: "text", parts }) }, node.line);
        const json = replace(localRef(joined, "Text"), String.raw`\A\{,`, "{", node.line);
        const id = uuid();
        emit("detect.dictionary", { UUID: id, WFInput: attachment(json) }, node.line);
        refs.set(node.id, id);
      } else if (node.kind === "dictionary") {
        const dynamic = node.entries.filter(([, value]) => dynamicContainer(value));
        const fixed = node.entries.filter(([, value]) => !dynamicContainer(value));
        const id = uuid();
        emit("dictionary", { UUID: id, WFItems: dictionary(fixed, node.line) }, node.line);
        if (!dynamic.length) {
          refs.set(node.id, id);
          dictionaries.set(node.id, node.entries);
        } else {
          // Native setters collapse a singleton list and reject an empty list.
          // Assemble native JSON fragments, preserving each list's outer brackets.
          const base = jsonContainer(localRef(id, "Dictionary", "object-ref"), node.line);
          const prefix = replace(base, String.raw`\}\s*\z`, "", node.line);
          const fragments: (string | OutputRef)[] = [prefix];
          dynamic.forEach(([key, value], index) => {
            fragments.push(`${fixed.length || index ? "," : ""}${JSON.stringify(key)}:`, jsonContainer(value as ObjectRef | ListRef, node.line));
          });
          fragments.push("}");
          const json = materialize({ kind: "text", parts: fragments }, node.line);
          const result = uuid();
          emit("detect.dictionary", { UUID: result, WFInput: json }, node.line);
          refs.set(node.id, result);
        }
      } else if (node.kind === "json") {
        if (node.operation === "parse") {
          // A dictionary envelope lets the native parser handle scalar and flat-array
          // roots as well as objects. The generic type is a declaration, not validation.
          const input = materialize({ kind: "text", parts: ["{\"__value\":", ...(node.input.kind === "text" ? node.input.parts : [node.input as OutputRef]), "}"] }, node.line);
          const parsed = uuid();
          emit("detect.dictionary", { UUID: parsed, WFInput: input }, node.line);
          const id = uuid();
          emit("getvalueforkey", { UUID: id, WFInput: attachment(localRef(parsed, "Dictionary", "object-ref")), WFDictionaryKey: "__value", WFGetDictionaryValueType: "Value" }, node.line);
          refs.set(node.id, id);
        } else {
          const json = jsonValue(node.input, node.line);
          refs.set(node.id, refs.get(json.id)!);
        }
      } else if (node.kind === "math") {
        const id = uuid();
        refs.set(node.id, id);
        const operations = { "+": "+", "-": "-", "*": "×", "/": "÷", "%": "Modulus", "**": "x^y" };
        const scientific = node.operator === "%" || node.operator === "**";
        emit("math", {
          UUID: id, WFInput: nativeValue(node.left, node.line),
          WFMathOperation: scientific ? "…" : operations[node.operator],
          ...(scientific
            ? { WFScientificMathOperation: operations[node.operator], WFScientificMathOperand: nativeValue(node.right, node.line) }
            : { WFMathOperand: nativeValue(node.right, node.line) }),
        }, node.line);
      } else if (node.kind === "numeric-if") {
        const group = uuid();
        const codes = { "===": 4, "!==": 5, "<": 0, "<=": 1, ">": 2, ">=": 3 };
        const rhs = node.right.kind === "boolean" ? Number(node.right.value) : nativeValue(node.right, node.line);
        const input = materialize(node.left, node.line);
        input.Value = { ...(input.Value as PlistDictionary), Aggrandizements: [{ Type: "WFCoercionVariableAggrandizement", CoercionItemClass: "WFNumberContentItem" }] };
        emit("conditional", {
          GroupingIdentifier: group, WFControlFlowMode: 0, WFCondition: codes[node.operator],
          WFInput: { Type: "Variable", Variable: input },
          WFNumberValue: rhs,
          WFConditionalActionString: typeof rhs === "number" ? String(rhs) : text(node.right),
        }, node.line);
        branches("conditional", group, node.then, node.else, node.line);
      } else if (node.kind === "set") {
        emit("setvariable", { WFVariableName: node.name, WFInput: materialize(node.value, node.line) }, node.line);
      } else if (node.kind === "get") {
        const id = uuid();
        refs.set(node.id, id);
        emit("getvariable", { UUID: id, WFVariable: { Value: { Type: "Variable", VariableName: node.name }, WFSerializationType: "WFTextTokenAttachment" } }, node.line);
      } else if (node.kind === "return") {
        if (node.value) emit("output", { WFOutput: materialize(node.value, node.line) }, node.line);
        else emit("exit", {}, node.line);
      } else if (node.kind === "yield") {
        // A Repeat collects its final action's output. Always emit an action, even for an existing ref.
        if (node.value) emit("getvariable", { UUID: uuid(), WFVariable: materialize(node.value, node.line) }, node.line);
        else emit("nothing", {}, node.line);
      } else if (node.kind === "repeat-count") {
        if (node.count.kind === "number" && node.count.value === 0) continue;
        const guard = node.count.kind !== "number" ? uuid() : undefined;
        if (guard) {
          const input = materialize(node.count, node.line);
          input.Value = { ...(input.Value as PlistDictionary), Aggrandizements: [{ Type: "WFCoercionVariableAggrandizement", CoercionItemClass: "WFNumberContentItem" }] };
          emit("conditional", { GroupingIdentifier: guard, WFControlFlowMode: 0, WFCondition: 2, WFNumberValue: 0, WFInput: { Type: "Variable", Variable: input } }, node.line);
        }
        const group = uuid();
        emit("repeat.count", { GroupingIdentifier: group, WFControlFlowMode: 0, WFRepeatCount: nativeValue(node.count, node.line) }, node.line);
        visit(node.body);
        emit("repeat.count", { UUID: uuid(), GroupingIdentifier: group, WFControlFlowMode: 2 }, node.line);
        if (guard) emit("conditional", { GroupingIdentifier: guard, WFControlFlowMode: 2 }, node.line);
      } else if (node.kind === "menu") {
        const group = uuid();
        emit("choosefrommenu", { GroupingIdentifier: group, WFControlFlowMode: 0, WFMenuPrompt: text(node.prompt), WFMenuItems: node.cases.map(c => c.title) }, node.line);
        for (const branch of node.cases) {
          emit("choosefrommenu", { GroupingIdentifier: group, WFControlFlowMode: 1, WFMenuItemTitle: branch.title }, node.line);
          visit(branch.body);
        }
        emit("choosefrommenu", { GroupingIdentifier: group, WFControlFlowMode: 2 }, node.line);
      } else if (node.kind === "index") {
        const id = uuid();
        refs.set(node.id, id);
        let index: PlistValue;
        if (typeof node.index === "number") index = node.index + 1;
        else {
          const offset = uuid();
          emit("math", { UUID: offset, WFInput: nativeValue(node.index, node.line), WFMathOperation: "+", WFMathOperand: 1 }, node.line);
          index = { Value: { Type: "ActionOutput", OutputUUID: offset, OutputName: "Calculation Result" }, WFSerializationType: "WFTextTokenAttachment" };
        }
        emit("getitemfromlist", { UUID: id, WFInput: attachment(node.input), WFItemSpecifier: "Item At Index", WFItemIndex: index }, node.line);
      } else if (node.kind === "field") {
        const id = uuid();
        refs.set(node.id, id);
        emit("getvalueforkey", {
          UUID: id, WFInput: attachment(node.input),
          WFDictionaryKey: node.key, WFGetDictionaryValueType: "Value",
        }, node.line);
      } else if (node.kind === "assemble-list") {
        refs.set(node.id, assembleList(node.items, node.line));
      } else if (node.kind === "list") {
        if (node.items.some(dynamicContainer)) {
          refs.set(node.id, assembleList(node.items.map(value => ({ value, spread: false })), node.line));
          continue;
        }
        const id = uuid();
        refs.set(node.id, id);
        lists.set(node.id, node.items);
        emit("list", {
          UUID: id,
          WFItems: node.items.map(item => {
            if (item.kind === "text") {
              const encoded = text(item);
              return typeof encoded === "string" ? encoded : { WFItemType: 0, WFValue: encoded };
            }
            if (item.kind === "ref" && !item.valueType) return { WFItemType: 0, WFValue: text(item) };
            return listItem(item, node.line);
          }),
        }, node.line);
      } else if (node.kind === "repeat") {
        const group = uuid();
        const start = uuid();
        // Bind to this loop's start UUID, not the ambiguous named "Repeat Item".
        // This preserves outer references and shadowing in nested loops (iOS 26.5).
        refs.set(node.id, start);
        emit("repeat.each", { UUID: start, GroupingIdentifier: group, WFControlFlowMode: 0, WFInput: attachment(node.input) }, node.line);
        visit(node.body);
        const end = uuid();
        if (node.resultId !== undefined) refs.set(node.resultId, end);
        emit("repeat.each", { UUID: end, GroupingIdentifier: group, WFControlFlowMode: 2 }, node.line);
      } else {
        const group = uuid();
        // Use a case-sensitive, anchored regex for literal equality. Replace Text
        // avoids Match Text's failing Siri-intent resolution on the iOS simulator.
        // A successful match becomes TS_MATCH; every nonmatch still starts JS:,
        // so the marker cannot collide with user input (including empty strings).
        const parts = node.left.kind === "ref" ? [node.left] : node.left.kind === "text" ? node.left.parts : [String(node.left.value)];
        const input = materialize({ kind: "text", parts: ["JS:", ...parts] }, node.line);
        let pattern: PlistValue;
        if (typeof node.right === "string") {
          const escaped = node.right.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          pattern = `\\AJS:${escaped}\\z`;
        } else {
          // Escape the runtime RHS before using it as a regex. ICU replacement
          // syntax needs two backslashes to emit one literal backslash before $1.
          // Prefix before escaping so even an empty RHS is a nonempty native input.
          const escapeId = uuid();
          const rightParts = node.right.kind === "text" ? node.right.parts : [node.right];
          emit("text.replace", {
            UUID: escapeId, WFInput: text({ kind: "text", parts: ["JS:", ...rightParts] }),
            WFReplaceTextFind: "([.*+?^${}()|\\[\\]\\\\])", WFReplaceTextReplace: "\\\\$1",
            WFReplaceTextCaseSensitive: true, WFReplaceTextRegularExpression: true,
          }, node.line);
          pattern = { Value: { string: "\\A\uFFFC\\z", attachmentsByRange: {
            "{2, 1}": { Type: "ActionOutput", OutputUUID: escapeId, OutputName: "Updated Text" },
          } }, WFSerializationType: "WFTextTokenString" };
        }
        const matchId = uuid();
        emit("text.replace", {
          UUID: matchId,
          WFInput: { Value: { string: "\uFFFC", attachmentsByRange: { "{0, 1}": input.Value } }, WFSerializationType: "WFTextTokenString" },
          WFReplaceTextFind: pattern,
          WFReplaceTextReplace: "TS_MATCH",
          WFReplaceTextCaseSensitive: true,
          WFReplaceTextRegularExpression: true,
        }, node.line);
        emit("conditional", {
          GroupingIdentifier: group, WFControlFlowMode: 0,
          WFCondition: node.operator === "===" ? 4 : 5,
          WFConditionalActionString: "TS_MATCH",
          WFInput: { Type: "Variable", Variable: {
            Value: { Type: "ActionOutput", OutputUUID: matchId, OutputName: "Updated Text", Aggrandizements: [{ Type: "WFCoercionVariableAggrandizement", CoercionItemClass: "WFStringContentItem" }] },
            WFSerializationType: "WFTextTokenAttachment",
          } },
        }, node.line);
        visit(node.then);
        if (node.else?.length) {
          emit("conditional", { GroupingIdentifier: group, WFControlFlowMode: 1 }, node.line);
          visit(node.else);
        }
        emit("conditional", { GroupingIdentifier: group, WFControlFlowMode: 2 }, node.line);
      }
    }
  }
  visit(ir);
  const ids = new Set<string>();
  for (const action of emitted) {
    const id = action.WFWorkflowActionParameters.UUID;
    if (typeof id !== "string") continue;
    if (ids.has(id)) throw new Error(`Duplicate native action UUID: ${id}`);
    ids.add(id);
  }
  return {
    workflow: {
      WFWorkflowName: name,
      WFWorkflowClientVersion: "3036.0.4.2",
      WFWorkflowMinimumClientVersion: 900,
      WFWorkflowMinimumClientVersionString: "900",
      WFWorkflowIcon: { WFWorkflowIconStartColor: 4282601983, WFWorkflowIconGlyphNumber: 59511 },
      WFWorkflowImportQuestions: [],
      WFWorkflowInputContentItemClasses: [],
      WFWorkflowTypes: [],
      WFWorkflowHasShortcutInputVariables: false,
      ...settings,
      WFWorkflowActions: emitted,
    },
    sourceMap,
  };
}
