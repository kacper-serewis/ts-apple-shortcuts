import assert from "node:assert/strict";
import { compile } from "../../src/compiler.js";
import type { IRNode, NativeNode, ScalarValue, Value } from "../../src/model.js";

/** Evaluate the executable IR subset for pure control-flow programs. Tests assert source-level
 * behavior, not generated instruction counts; native serialization is separately tested on iOS.
 */
export function evaluate(code: string, answers: number[] = [], menuChoices: string[] = [], onRequest?: (node: NativeNode, read: (value: Value) => any) => unknown): unknown[] {
  const { ir } = compile(code);
  let refs = new Map<number, unknown>();
  let variables = new Map<string, unknown>();
  const seen: unknown[] = [];
  let collections: unknown[][] = [];
  let shortcutInput: unknown = "";
  const returned = Symbol("return");
  const stopShortcut = Symbol("Stop Shortcut");
  const result = (v: Value): any => v.kind === "number" || v.kind === "boolean" ? v.value
    : v.kind === "text" ? v.parts.map(p => typeof p === "string" ? p : result(p)).join("")
    : refs.get(v.id);
  const condition = (left: ScalarValue, op: string, right: unknown) => {
    const a = result(left), b = right;
    switch (op) {
      case "===": return a === b; case "!==": return a !== b;
      case ">": return a > (b as number); case ">=": return a >= (b as number);
      case "<": return a < (b as number); case "<=": return a <= (b as number);
      default: throw new Error(`Unknown comparison ${op}`);
    }
  };
  function visit(nodes: IRNode[]): void {
    for (const node of nodes) {
      switch (node.kind) {
        case "set": variables.set(node.name, result(node.value)); break;
        case "get": assert.ok(variables.has(node.name), `Uninitialized ${node.name}`); refs.set(node.id, variables.get(node.name)); break;
        case "list": refs.set(node.id, node.items.map(result)); break;
        case "assemble-list": refs.set(node.id, node.items.flatMap(item => item.spread ? result(item.value) : [result(item.value)])); break;
        case "dictionary": refs.set(node.id, Object.fromEntries(node.entries.map(([key, value]) => [key, result(value)]))); break;
        case "assemble-dictionary": refs.set(node.id, Object.fromEntries(node.parts.flatMap(part => part.kind === "entry" ? [[part.key, result(part.value)]] : Object.entries(result(part.value))))); break;
        case "json": refs.set(node.id, node.operation === "parse" ? JSON.parse(result(node.input)) : JSON.stringify(result(node.input))); break;
        case "string": refs.set(node.id, (String.prototype[node.method] as (...args: string[]) => unknown).apply(result(node.input), node.args.map(result))); break;
        case "field": refs.set(node.id, result(node.input)[node.key]); break;
        // Test entities are plain objects keyed by App Intents property identifier.
        case "property": refs.set(node.id, result(node.input)[node.property]); break;
        case "index": refs.set(node.id, result(node.input)[typeof node.index === "number" ? node.index : result(node.index)]); break;
        case "math": {
          const a = result(node.left), b = result(node.right);
          refs.set(node.id, node.operator === "+" ? a + b : node.operator === "-" ? a - b : node.operator === "*" ? a * b : node.operator === "/" ? a / b : node.operator === "%" ? a % b : a ** b);
          break;
        }
        case "numeric-if": visit(condition(node.left, node.operator, result(node.right)) ? node.then : node.else ?? []); break;
        case "if": visit(condition(node.left, node.operator, typeof node.right === "string" ? node.right : result(node.right)) ? node.then : node.else ?? []); break;
        case "repeat": {
          const collected: unknown[] = [];
          collections.push(collected);
          for (const item of result(node.input)) { refs.set(node.id, item); visit(node.body); }
          collections.pop();
          if (node.resultId !== undefined) refs.set(node.resultId, collected);
          break;
        }
        case "yield": if (node.value) collections.at(-1)!.push(result(node.value)); break;
        case "repeat-count": for (let i = 0; i < result(node.count); i++) visit(node.body); break;
        case "menu": {
          assert.ok(menuChoices.length, "Unexpected menu");
          const title = menuChoices.shift();
          const branch = node.cases.find(item => item.title === title);
          assert.ok(branch, `Unknown menu selection ${title}`);
          visit(branch.body);
          break;
        }
        case "action":
          assert.equal(node.action, "showResult");
          seen.push(result(node.argument));
          break;
        case "native":
          if (node.identifier === "is.workflow.actions.output") {
            assert.equal(node.parameters.kind, "parameter-object");
            if (node.parameters.kind !== "parameter-object") throw new Error("Expected output parameters");
            const value = node.parameters.entries.find(([key]) => key === "WFOutput")![1];
            assert.equal(value.kind, "parameter-value");
            if (value.kind !== "parameter-value") throw new Error("Expected output value");
            throw { [returned]: result(value.value) };
          }
          if (node.identifier === "is.workflow.actions.getvariable" && node.parameters.kind === "literal") {
            refs.set(node.id, shortcutInput);
            break;
          }
          if (node.identifier === "is.workflow.actions.runworkflow") {
            assert.equal(node.parameters.kind, "parameter-object");
            if (node.parameters.kind !== "parameter-object") throw new Error("Expected Run Shortcut parameters");
            const input = node.parameters.entries.find(([key]) => key === "WFInput")![1];
            assert.equal(input.kind, "parameter-value");
            if (input.kind !== "parameter-value") throw new Error("Expected Run Shortcut input");
            const argument = result(input.value);
            const saved = { refs, variables, collections, shortcutInput };
            refs = new Map(); variables = new Map(); collections = []; shortcutInput = argument;
            let value: unknown;
            try { visit(ir); } catch (error) {
              if (typeof error === "object" && error !== null && returned in error) value = (error as { [returned]: unknown })[returned];
              else throw error;
            } finally { ({ refs, variables, collections, shortcutInput } = saved); }
            refs.set(node.id, value);
            break;
          }
          if (node.identifier === "is.workflow.actions.exit") throw stopShortcut;
          if (node.identifier === "is.workflow.actions.alert") {
            assert.equal(node.parameters.kind, "parameter-object");
            if (node.parameters.kind !== "parameter-object") throw new Error("Expected alert parameters");
            const message = node.parameters.entries.find(([key]) => key === "WFAlertActionMessage")![1];
            assert.equal(message.kind, "literal");
            if (message.kind === "literal") seen.push(message.value);
            break;
          }
          if (node.identifier === "is.workflow.actions.text.split" || node.identifier === "is.workflow.actions.text.replace") {
            assert.equal(node.parameters.kind, "parameter-object");
            if (node.parameters.kind !== "parameter-object") throw new Error("Expected text parameters");
            const params = new Map(node.parameters.entries);
            const read = (key: string): any => { const p = params.get(key)!; return p.kind === "literal" ? p.value : p.kind === "parameter-value" ? result(p.value) : undefined; };
            if (node.identifier.endsWith(".split")) {
              assert.equal(read("WFTextSeparator"), "Custom");
              refs.set(node.id, read("text").split(read("WFTextCustomSeparator")));
            } else {
              assert.equal(read("WFReplaceTextRegularExpression"), true);
              assert.equal(read("WFReplaceTextCaseSensitive"), true);
              const pattern = read("WFReplaceTextFind").replaceAll("\\A", "^").replaceAll("\\z", "$(?![\\s\\S])");
              const template: string = read("WFReplaceTextReplace");
              // ICU uses backslash quoting and $n groups, not JS replacement tokens.
              refs.set(node.id, read("WFInput").replace(new RegExp(pattern, "gu"), (...args: any[]) =>
                template.replace(/\\([\s\S])|\$(\d+)/g, (_: string, quoted: string | undefined, group: string) => quoted ?? args[Number(group)] ?? "")));
            }
            break;
          }
          if (node.identifier === "is.workflow.actions.getitemfromlist") {
            assert.equal(node.parameters.kind, "parameter-object");
            if (node.parameters.kind !== "parameter-object") throw new Error("Expected range parameters");
            const params = new Map(node.parameters.entries);
            const read = (key: string): any => { const p = params.get(key)!; return p.kind === "literal" ? p.value : p.kind === "parameter-value" ? result(p.value) : undefined; };
            assert.equal(read("WFItemSpecifier"), "Items in Range");
            const start = read("WFItemRangeStart"), end = read("WFItemRangeEnd"), input = read("WFInput");
            assert.ok(Number.isInteger(start) && start >= 1 && start <= end && end <= input.length, "Invalid native range must be guarded");
            refs.set(node.id, input.slice(start - 1, end)); break;
          }
          if ((node.identifier === "is.workflow.actions.downloadurl" || !node.identifier.startsWith("is.workflow.actions.")) && onRequest) {
            refs.set(node.id, onRequest(node, result));
            break;
          }
          if (["is.workflow.actions.getvalueforkey", "is.workflow.actions.setvalueforkey"].includes(node.identifier)) {
            assert.equal(node.parameters.kind, "parameter-object");
            if (node.parameters.kind !== "parameter-object") throw new Error("Expected dictionary parameters");
            const parameters = new Map(node.parameters.entries);
            const read = (key: string): any => {
              const p = parameters.get(key)!;
              if (p.kind === "literal") return p.value;
              assert.equal(p.kind, "parameter-value");
              if (p.kind !== "parameter-value") throw new Error("Expected dictionary value parameter");
              return result(p.value);
            };
            if (node.identifier === "is.workflow.actions.setvalueforkey") {
              refs.set(node.id, { ...read("WFDictionary"), [read("WFDictionaryKey")]: read("WFDictionaryValue") });
            } else {
              const dictionary = read("WFInput");
              const mode = read("WFGetDictionaryValueType");
              refs.set(node.id, mode === "All Keys" ? Object.keys(dictionary) : mode === "All Values" ? Object.values(dictionary)
                : read("WFDictionaryKey").split(".").reduce((item: any, key: string) => item[key], dictionary));
            }
            break;
          }
          if (node.identifier === "is.workflow.actions.count") {
            assert.equal(node.parameters.kind, "parameter-object");
            if (node.parameters.kind !== "parameter-object") throw new Error("Expected count parameters");
            const input = node.parameters.entries.find(([key]) => key === "Input")![1];
            assert.equal(input.kind, "parameter-value");
            if (input.kind !== "parameter-value") throw new Error("Expected count input");
            const countType = node.parameters.entries.find(([key]) => key === "WFCountType")?.[1];
            const value = result(input.value);
            if (countType?.kind === "literal" && countType.value === "Characters") {
              // iOS counts graphemes, as verified by TS-Text-Characters. This
              // catches accidental reliance on JS UTF-16 length in lowering.
              assert.equal(input.encoding, "attachment");
              refs.set(node.id, [...new Intl.Segmenter("en", { granularity: "grapheme" }).segment(value)].length);
            } else {
              refs.set(node.id, value.length);
            }
            break;
          }
          assert.equal(node.identifier, "is.workflow.actions.ask");
          assert.ok(answers.length, "Unexpected extra prompt");
          refs.set(node.id, answers.shift());
          break;
        case "return": throw { [returned]: node.value ? result(node.value) : undefined };
        default: throw new Error(`Unsupported test evaluator node ${JSON.stringify(node)}`);
      }
    }
  }
  try { visit(ir); } catch (error) { if (error !== stopShortcut && !(typeof error === "object" && error !== null && returned in error)) throw error; }
  return seen;
}

