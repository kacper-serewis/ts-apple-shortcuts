import ts from "typescript";
import { actions } from "./actions.js";
import { wrappers } from "./wrappers.js";
import type { CatalogAction } from "./catalog.js";
import { nodeHost } from "./hosts/node-host.js";
import type { CompileHost } from "./hosts/host.js";
import { staticPlist, propertyName, isDictionary, unwrap, plistData, plistDate } from "./native.js";
import { emitWorkflow } from "./emitter.js";
import type { ActionName, Compilation, IRNode, ListRef, ObjectRef, OutputRef, ScalarValue, StringMethod, TextValue, Value, NativeParameter, PlistDictionary } from "./model.js";

export interface Position { line: number; column: number }
export class CompileError extends Error {
  constructor(message: string, filename: string, readonly position?: Position) {
    super(`${filename}${position ? `:${position.line}:${position.column}` : ""}: ${message}`);
    this.name = "CompileError";
  }
}

export interface CompileOptions { filename?: string; name?: string; host?: CompileHost }
type Scope = Map<string, Value | undefined>;
interface FunctionFrame { done: string; result?: string }
interface LoopFrame { skip: string; broken?: string }

// Direct TypeScript AST → IR → workflow. No JavaScript emit, eval or source import.
export function compile(source: string, { filename = "shortcut.ts", name = "TS Shortcut", host: environment = nodeHost }: CompileOptions = {}): Compilation {
  const inputPath = environment.resolve(filename);
  const isJavaScript = /\.m?js$/i.test(filename);
  const sourceFile = ts.createSourceFile(inputPath, source, ts.ScriptTarget.ES2023, true, isJavaScript ? ts.ScriptKind.JS : ts.ScriptKind.TS);
  function position(node: ts.Node): Position {
    const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
    return { line: line + 1, column: character + 1 };
  }
  function fail(message: string, node?: ts.Node): never {
    throw new CompileError(message, filename, node ? position(node) : undefined);
  }
  const compilerOptions: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2023,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true,
    noEmit: true,
    allowJs: true,
    checkJs: false,
    types: [],
    lib: ["lib.es2023.d.ts"],
    skipLibCheck: true,
  };
  const host = environment.createCompilerHost(compilerOptions);
  const originalGetSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (path, languageVersion, onError, shouldCreateNewSourceFile) =>
    environment.resolve(path) === inputPath ? sourceFile : originalGetSourceFile(path, languageVersion, onError, shouldCreateNewSourceFile);
  const program = ts.createProgram([inputPath, environment.apiPath], compilerOptions, host);
  const checker = program.getTypeChecker();
  // Type metadata stays in the frontend; the serializable IR holds native refs.
  const jsonTypes = new Map<number, ts.Type>();
  const dictionaryLiterals = new Map<number, [string, Value][]>();
  function checkDiagnostics(diagnostics: readonly ts.Diagnostic[]): void {
    const error = diagnostics.find(d => d.category === ts.DiagnosticCategory.Error);
    if (!error) return;
    const loc = error.file?.getLineAndCharacterOfPosition(error.start ?? 0);
    throw new CompileError(
      `TS${error.code}: ${ts.flattenDiagnosticMessageText(error.messageText, "\n")}`,
      error.file === sourceFile ? filename : (error.file?.fileName ?? filename),
      loc ? { line: loc.line + 1, column: loc.character + 1 } : undefined,
    );
  }
  checkDiagnostics(program.getSyntacticDiagnostics(sourceFile));

  const imports = new Map<string, string>();
  const functions = new Map<string, ts.FunctionDeclaration>();
  const callStack: ts.FunctionDeclaration[] = [];
  const special = new Set(["actions", "native", "raw", "text", "attachment", "dictionary", "repeat", "menu", "input", "plistData", "plistDate", "stringifyJson", "parseJson", "requestJson"]);
  // Load metadata only when catalog calls are used; ordinary compilation has no catalog I/O.
  let catalogKeys: Map<string, Set<string>> | undefined;
  let catalogCategories: Map<string, Map<string, CatalogAction>> | undefined;
  function loadCatalog(): void {
    if (catalogCategories) return;
    catalogKeys = new Map();
    catalogCategories = new Map();
    for (const action of environment.catalog().actions) {
      catalogKeys.set(action.id, new Set([...action.parameters.map(p => p.key), "UUID", "CustomOutputName"]));
      let category = catalogCategories.get(action.category);
      if (!category) catalogCategories.set(action.category, category = new Map());
      category.set(action.functionName, action);
    }
  }
  let settings: PlistDictionary = {};
  let settingsNode: ts.Expression | undefined;
  const mutable = new Map<Scope, Map<string, string>>();
  let entry: ts.FunctionDeclaration | undefined;
  const hasModifier = (node: ts.FunctionDeclaration, kind: ts.SyntaxKind) => node.modifiers?.some(m => m.kind === kind);
  const isTypeDeclaration = (node: ts.Node) => ts.isTypeAliasDeclaration(node) || ts.isInterfaceDeclaration(node);
  for (const node of sourceFile.statements) {
    if (isTypeDeclaration(node)) continue;
    if (ts.isVariableStatement(node) && node.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword)) {
      const declarations = node.declarationList.declarations;
      if (!(node.declarationList.flags & ts.NodeFlags.Const) || declarations.length !== 1 || declarations[0].name.getText(sourceFile) !== "shortcut" || !declarations[0].initializer) fail("Only export const shortcut = { native workflow settings } is supported at module level.", node);
      if (settingsNode) fail("Duplicate shortcut settings.", node);
      settingsNode = declarations[0].initializer;
      continue;
    }
    if (ts.isImportDeclaration(node)) {
      const clause = node.importClause;
      if (!ts.isStringLiteral(node.moduleSpecifier) || node.moduleSpecifier.text !== "@js-shortcuts/ios"
        || !clause || clause.name || !clause.namedBindings || !ts.isNamedImports(clause.namedBindings) || node.attributes) {
        fail('Only named imports from "@js-shortcuts/ios" are supported.', node);
      }
      for (const spec of clause.namedBindings.elements) {
        if (clause.isTypeOnly || spec.isTypeOnly) continue;
        const imported = (spec.propertyName ?? spec.name).text;
        if (!actions.has(imported as ActionName) && !Object.hasOwn(wrappers, imported) && !special.has(imported)) {
          loadCatalog();
          if (!catalogCategories!.has(imported)) fail(`Unknown action import '${imported}'. Import an action or catalog category such as LLM, Text or Clipboard.`, spec);
        }
        imports.set(spec.name.text, imported);
      }
    } else if (ts.isFunctionDeclaration(node) && hasModifier(node, ts.SyntaxKind.ExportKeyword)
      && hasModifier(node, ts.SyntaxKind.DefaultKeyword) && !entry) {
      entry = node;
    } else if (ts.isFunctionDeclaration(node) && node.name && node.body && !node.asteriskToken
      && !hasModifier(node, ts.SyntaxKind.DefaultKeyword)) {
      if (functions.has(node.name.text)) fail(`Duplicate function '${node.name.text}'.`, node);
      functions.set(node.name.text, node);
    } else {
      fail("Only action imports, type declarations, named helper functions and one default async function are supported at module level.", node);
    }
  }
  if (!entry || !hasModifier(entry, ts.SyntaxKind.AsyncKeyword) || entry.asteriskToken || entry.parameters.length || !entry.body) {
    fail("Expected export default async function main() with no parameters.", entry);
  }
  for (const [name, declaration] of functions) {
    if (imports.has(name) || name === entry.name?.text) fail(`Duplicate function/import name '${name}'.`, declaration);
  }
  if (settingsNode) {
    const parsed = staticPlist(settingsNode, fail, node => staticHelper(node, []));
    if (!isDictionary(parsed) || Object.hasOwn(parsed, "WFWorkflowActions")) fail("Shortcut settings must be an object without WFWorkflowActions.", settingsNode);
    settings = parsed;
  }

  let nextId = 0;
  function literal(value: string, node: ts.Node): TextValue {
    if (!value.isWellFormed() || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/u.test(value)) {
      fail("This string contains characters that a Shortcuts plist cannot represent.", node);
    }
    return { kind: "text", parts: [value] };
  }
  function resolve(id: ts.Identifier, scopes: Scope[], output: IRNode[]): Value {
    for (let i = scopes.length - 1; i >= 0; i--) {
      if (scopes[i].has(id.text)) {
        const value = scopes[i].get(id.text);
        if (!value) fail(`Cannot use '${id.text}' before its declaration.`, id);
        const name = mutable.get(scopes[i])?.get(id.text);
        if (name) {
          const next = nextId++;
          output.push({ kind: "get", id: next, name, line: position(id).line });
          return cloneRef(value, next, "Variable");
        }
        return value;
      }
    }
    fail(`Unknown variable '${id.text}'.`, id);
  }
  function arrayDepth(type: ts.Type, seen = new Set<ts.Type>()): number {
    if (seen.has(type)) return -1;
    const nested = new Set([...seen, type]);
    if (type.isUnion()) {
      const depths = new Set(type.types.map(item => arrayDepth(item, nested)));
      return depths.size === 1 ? [...depths][0] : -1;
    }
    if (!checker.isArrayType(type) && !checker.isTupleType(type)) return 0;
    const item = checker.getIndexTypeOfType(type, ts.IndexKind.Number);
    const depth = item ? arrayDepth(item, nested) : 0;
    return depth < 0 ? -1 : depth + 1;
  }
  function typedRef(type: ts.Type, id: number, outputName: string, node: ts.Node, nativeUnion = false): Value {
    if (type.flags & ts.TypeFlags.Never) return { kind: "ref", id, outputName };
    if (type.flags & ts.TypeFlags.StringLike || type.isUnion() && type.types.every(t => !!(t.flags & ts.TypeFlags.StringLike))) {
      return { kind: "ref", id, outputName };
    }
    if (type.flags & ts.TypeFlags.NumberLike || type.isUnion() && type.types.every(t => !!(t.flags & ts.TypeFlags.NumberLike))) return { kind: "ref", id, outputName, valueType: "number" };
    if (type.flags & ts.TypeFlags.BooleanLike || type.isUnion() && type.types.every(t => !!(t.flags & ts.TypeFlags.BooleanLike))) return { kind: "ref", id, outputName, valueType: "boolean" };
    if (type.getProperty("__nativeContent")) return { kind: "ref", id, outputName, valueType: "content" };
    // Heterogeneous native results can be forwarded as content. Do not pretend
    // they are JSON objects or coerce them implicitly to a particular scalar.
    if (nativeUnion && type.isUnion()) return { kind: "ref", id, outputName, valueType: "content" };
    if (checker.isArrayType(type) || checker.isTupleType(type)) {
      jsonTypes.set(id, type);
      const depth = arrayDepth(type);
      return { kind: "list-ref", id, outputName, ...(depth === 1 ? {} : { arrayDepth: depth }) };
    }
    if (type.flags & ts.TypeFlags.Object && !checker.isTupleType(type)
      && !type.getCallSignatures().length && !type.getConstructSignatures().length
      && !type.getSymbol()?.declarations?.some(d => ts.isClassDeclaration(d))) {
      jsonTypes.set(id, type);
      return { kind: "object-ref", id, outputName };
    }
    fail(`Unsupported JSON value type '${checker.typeToString(type)}'. Use required strings, numbers, booleans, objects or homogeneous arrays.`, node);
  }
  function call(node: ts.Expression, scopes: Scope[], output: IRNode[], needsValue: boolean): Value | undefined {
    const invocation = ts.isAwaitExpression(node) ? unwrap(node.expression) : unwrap(node);
    if (ts.isCallExpression(invocation)) {
      const target = unwrap(invocation.expression);
      if ((ts.isPropertyAccessExpression(target) || ts.isElementAccessExpression(target))
        && ts.isIdentifier(target.expression) && !scopes.some(scope => scope.has(target.expression.getText(sourceFile)))) {
        const categoryName = imports.get(target.expression.text);
        const category = categoryName && catalogCategories?.get(categoryName);
        if (category) {
          if (!ts.isAwaitExpression(node)) fail("Actions must be called as await Category.action({...}).", node);
          if (invocation.questionDotToken || target.questionDotToken) fail("Optional catalog calls are not supported.", invocation);
          if (!ts.isPropertyAccessExpression(target)) fail("Use a direct category function call: await Category.action({...}).", target);
          const action = category.get(target.name.text);
          if (!action) fail(`Unknown catalog function '${categoryName}.${target.name.text}'.`, target);
          if (invocation.arguments.length > 1 || (!invocation.arguments.length && action.parameters.length)) fail("Catalog actions expect one parameters object.", invocation);
          const argument = invocation.arguments[0] ?? ts.factory.createObjectLiteralExpression();
          return nativeCall(invocation, action.id, argument, scopes, output, needsValue, position(node).line, catalogKeys!.get(action.id), action.functionDefaults);
        }
      }
      if (mathMember(invocation.expression, scopes) !== undefined) return mathCall(invocation, scopes, output);
      const json = jsonOperation(invocation, scopes);
      if (json) return jsonCall(invocation, json, scopes, output);
      if (stringMethodName(invocation)) return stringMethod(invocation, scopes, output);
      if (arrayMethodName(invocation)) return arrayMethod(invocation, scopes, output, needsValue);
      const helper = helperDeclaration(invocation, scopes);
      if (helper) return inlineHelper(helper, invocation, scopes, output, needsValue, ts.isAwaitExpression(node));
    }
    if (!ts.isAwaitExpression(node) || !ts.isCallExpression(node.expression)) fail("Actions must be called as await action(text).", node);
    const expr = node.expression;
    const target = unwrap(expr.expression);
    if (ts.isElementAccessExpression(target) && ts.isIdentifier(target.expression)
      && imports.get(target.expression.text) === "actions" && !scopes.some(scope => scope.has(target.expression.getText(sourceFile)))) {
      if (target.questionDotToken || expr.questionDotToken) fail("Optional catalog calls are not supported.", expr);
      const identifierNode = target.argumentExpression;
      if (!identifierNode || !ts.isStringLiteralLike(unwrap(identifierNode))) fail('Catalog calls require a literal action identifier: actions["full.native.identifier"]({...}).', target);
      const identifier = (unwrap(identifierNode) as ts.StringLiteralLike).text;
      loadCatalog();
      const keys = catalogKeys!.get(identifier);
      if (!keys) fail(`Unknown catalog action '${identifier}'. Use native() for actions outside the catalog.`, identifierNode);
      if (expr.arguments.length !== 1) fail("Catalog actions expect one parameters object.", expr);
      return nativeCall(expr, identifier, expr.arguments[0], scopes, output, needsValue, position(node).line, keys);
    }
    if (!ts.isIdentifier(expr.expression) || scopes.some(scope => scope.has(expr.expression.getText(sourceFile)))) {
      fail("Only imported Shortcuts actions can be called.", expr);
    }
    const action = imports.get(expr.expression.text);
    if (!action) fail("Only imported Shortcuts actions can be called.", expr);
    if (action === "requestJson") return requestJson(expr, scopes, output);
    if (action === "native") {
      if (expr.arguments.length !== 2) fail("native expects an action identifier and a parameters object.", expr);
      const identifier = staticPlist(expr.arguments[0], fail);
      if (typeof identifier !== "string" || !/^[A-Za-z0-9_-]+(?:[.][A-Za-z0-9_-]+)+$/.test(identifier)) fail("Use a full native action identifier, such as is.workflow.actions.gettext.", expr.arguments[0]);
      return nativeCall(expr, identifier, expr.arguments[1], scopes, output, needsValue, position(node).line);
    }
    if (action === "repeat" || action === "menu") {
      if (needsValue || expr.arguments.length !== 2) fail(`${action} takes two arguments and has no return value.`, expr);
      if (action === "repeat") {
        const count = numeric(expr.arguments[0], scopes, output);
        const callback = unwrap(expr.arguments[1]);
        if (!ts.isArrowFunction(callback) || callback.parameters.length > 1 || callback.typeParameters?.length || !callback.modifiers?.some(m => m.kind === ts.SyntaxKind.AsyncKeyword) || !ts.isBlock(callback.body)) fail("Use repeat(count, async (index) => { ... }); the index parameter is optional.", callback);
        if (callback.parameters.some(p => !ts.isIdentifier(p.name) || p.initializer || p.questionToken || p.dotDotDotToken)) fail("Repeat's index must be a plain parameter without defaults, rest or optional syntax.", callback);
        if (count.kind === "number" && (!Number.isSafeInteger(count.value) || count.value < 0)) fail("Repeat count must be a nonnegative integer.", expr.arguments[0]);
        const line = position(node).line;
        const body: IRNode[] = [];
        const scope: Scope = new Map();
        mutable.set(scope, new Map());
        let counter: { name: string; value: ScalarValue } | undefined;
        if (callback.parameters.length) {
          const name = `ts_${nextId++}_repeat_index`;
          const id = nextId++;
          const index: ScalarValue = { kind: "ref", id, outputName: "Index", valueType: "number" };
          counter = { name, value: index };
          output.push({ kind: "set", name, value: { kind: "number", value: 0 }, line });
          body.push({ kind: "get", id, name, line });
          bindPattern(callback.parameters[0].name, index, scope, true, body, line);
        }
        body.push(...flowCallback(callback.body, [...scopes, scope]));
        if (counter) {
          // Advance even after a local callback return; parameter mutations do not change the counter.
          const id = nextId++;
          body.push({ kind: "math", id, left: counter.value, operator: "+", right: { kind: "number", value: 1 }, line });
          body.push({ kind: "set", name: counter.name, value: { kind: "ref", id, outputName: "Index", valueType: "number" }, line });
        }
        output.push({ kind: "repeat-count", count, body, line });
      } else {
        const prompt = scalar(expr.arguments[0], scopes, output);
        const cases = expr.arguments[1];
        if (!ts.isObjectLiteralExpression(cases) || !cases.properties.length) fail("Use menu(prompt, { Label: async () => { ... } }).", cases);
        const titles = new Set<string>();
        const branches = cases.properties.map(property => {
          if (!ts.isPropertyAssignment(property)) fail("Menu entries need named async callbacks.", property);
          const title = propertyName(property.name, fail);
          literal(title, property);
          if (titles.has(title)) fail("Duplicate menu label.", property);
          titles.add(title);
          const callback = unwrap(property.initializer);
          if (!ts.isArrowFunction(callback) || callback.parameters.length || callback.typeParameters?.length || !callback.modifiers?.some(m => m.kind === ts.SyntaxKind.AsyncKeyword) || !ts.isBlock(callback.body)) fail("Menu cases must be async () => { ... } callbacks.", callback);
          return { title, body: flowCallback(callback.body, scopes) };
        });
        output.push({ kind: "menu", prompt, cases: branches, line: position(node).line });
      }
      return undefined;
    }
    if (Object.hasOwn(wrappers, action)) {
      const wrapper = wrappers[action];
      if (expr.arguments.length !== wrapper.args.length) fail(`${action} expects ${wrapper.args.length} arguments.`, expr);
      if (needsValue && !wrapper.output) fail(`${action} has no supported return value.`, expr);
      const entries: [string, NativeParameter][] = Object.entries(wrapper.defaults ?? {}).map(([key, value]) => [key, { kind: "literal", value }]);
      wrapper.args.forEach((arg, i) => {
        const item = value(expr.arguments[i], scopes, output);
        if (wrapper.dictionaryInput === i && item.kind !== "object-ref") fail(`${action} requires a typed dictionary object.`, expr.arguments[i]);
        entries.push([arg.key, { kind: "parameter-value", value: item, encoding: arg.encoding }]);
      });
      const id = nextId++;
      output.push({ kind: "native", id, identifier: `is.workflow.actions.${wrapper.identifier}`, parameters: { kind: "parameter-object", entries }, line: position(node).line });
      if (!wrapper.output) return undefined;
      return typedRef(checker.getAwaitedType(checker.getTypeAtLocation(expr))!, id, wrapper.output, expr);
    }
    const definition = actions.get(action as ActionName);
    if (!definition) fail("This intrinsic cannot be called as an action here.", expr);
    if (expr.arguments.length !== 1 || ts.isSpreadElement(expr.arguments[0])) fail(`${action} expects exactly one text argument.`, expr);
    if (needsValue && !definition.output) fail(`${action} has no supported return value.`, expr);
    const argument = scalar(expr.arguments[0], scopes, output);
    const id = nextId++;
    let result: Value | undefined;
    if (action === "getJson") {
      if (isJavaScript || expr.typeArguments?.length !== 1) fail("getJson requires an explicit TypeScript response type: getJson<Response>(url).", expr);
      result = typedRef(checker.getTypeFromTypeNode(expr.typeArguments[0]), id, definition.output!, expr.typeArguments[0]);
      if (result.kind !== "object-ref" && result.kind !== "list-ref") fail("getJson requires an object or array response type.", expr);
    } else {
      result = definition.output ? { kind: "ref", id, outputName: definition.output } : undefined;
    }
    output.push({ kind: "action", action: action as ActionName, argument, id, line: position(node).line });
    return result;
  }
  function nativeCall(expr: ts.CallExpression, identifier: string, argument: ts.Expression, scopes: Scope[], output: IRNode[], needsValue: boolean, line: number, knownKeys?: Set<string>, defaults?: Record<string, string>): Value | undefined {
    if (!ts.isObjectLiteralExpression(unwrap(argument)) && !ts.isCallExpression(unwrap(argument))) fail("Native parameters must be an object literal or raw({...}).", argument);
    const parameters = parameter(argument, scopes, output);
    if (parameters.kind !== "parameter-object" && !(parameters.kind === "literal" && isDictionary(parameters.value))) fail("Native parameters must be an object literal or raw({...}).", argument);
    if (knownKeys && parameters.kind === "parameter-object") {
      for (const [key] of parameters.entries) {
        if (!knownKeys.has(key)) fail(`Unknown catalog parameter '${key}' for '${identifier}'. Use raw({...}) for exact exported parameters missing from the catalog.`, argument);
      }
    }
    if (defaults && parameters.kind === "parameter-object") {
      for (const [key, value] of Object.entries(defaults)) {
        if (!parameters.entries.some(([name]) => name === key)) parameters.entries.push([key, { kind: "literal", value }]);
      }
    }
    const id = nextId++;
    output.push({ kind: "native", id, identifier, parameters, preserveParameters: !needsValue && parameters.kind === "literal", line });
    if (!needsValue) return undefined;
    return typedRef(checker.getAwaitedType(checker.getTypeAtLocation(expr))!, id, "Result", expr, !!knownKeys);
  }
  function scalar(node: ts.Expression, scopes: Scope[], output: IRNode[]): ScalarValue {
    const result = value(node, scopes, output);
    if (result.kind === "list-ref") fail("Expected text, not a list. Use for…of to access its items.", node);
    if (result.kind === "object-ref") fail("Expected text, not an object. Read a text field first.", node);
    if (result.kind === "boolean" || result.kind === "ref" && (result.valueType === "boolean" || result.valueType === "content")) fail("Use booleans in conditions and native content in native parameters or quickLook; implicit text conversion is not supported.", node);
    return result;
  }
  function value(node: ts.Expression, scopes: Scope[], output: IRNode[]): Value {
    if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)
      || ts.isSatisfiesExpression(node) || ts.isNonNullExpression(node)) return value(node.expression, scopes, output);
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return literal(node.text, node);
    if (ts.isNumericLiteral(node)) return { kind: "number", value: staticPlist(node, fail) as number };
    if (node.kind === ts.SyntaxKind.TrueKeyword || node.kind === ts.SyntaxKind.FalseKeyword) return { kind: "boolean", value: node.kind === ts.SyntaxKind.TrueKeyword };
    if (ts.isIdentifier(node)) return resolve(node, scopes, output);
    if (ts.isCallExpression(node) && mathMember(node.expression, scopes) !== undefined) return mathCall(node, scopes, output);
    const mathConstant = mathMember(node, scopes);
    if (mathConstant !== undefined) {
      const constants: Record<string, number> = { E: Math.E, PI: Math.PI, LN2: Math.LN2, LN10: Math.LN10, LOG2E: Math.LOG2E, LOG10E: Math.LOG10E, SQRT1_2: Math.SQRT1_2, SQRT2: Math.SQRT2 };
      if (!Object.hasOwn(constants, mathConstant)) fail(`Math.${mathConstant} is not a supported numeric constant. Call supported Math functions directly.`, node);
      return { kind: "number", value: constants[mathConstant] };
    }
    if (ts.isCallExpression(node) && jsonOperation(node, scopes)) return jsonCall(node, jsonOperation(node, scopes)!, scopes, output);
    if (ts.isCallExpression(node) && stringMethodName(node)) return stringMethod(node, scopes, output);
    if (ts.isCallExpression(node) && arrayMethodName(node)) return arrayMethod(node, scopes, output, true)!;
    if (ts.isCallExpression(node) && helperDeclaration(node, scopes)) return call(node, scopes, output, true)!;
    if (ts.isCallExpression(node) && intrinsic(node, scopes) === "input") {
      if (node.arguments.length) fail("input<T>() takes no arguments.", node);
      const id = nextId++;
      output.push({ kind: "native", id, identifier: "is.workflow.actions.getvariable", parameters: { kind: "literal", value: { WFVariable: { Value: { Type: "ExtensionInput" }, WFSerializationType: "WFTextTokenAttachment" } } }, line: position(node).line });
      settings.WFWorkflowHasShortcutInputVariables = true;
      return typedRef(checker.getTypeAtLocation(node), id, "Shortcut Input", node);
    }
    if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.MinusToken) {
      const operand = numeric(node.operand, scopes, output);
      if (operand.kind === "number") return { kind: "number", value: -operand.value };
      const id = nextId++;
      output.push({ kind: "math", id, left: { kind: "number", value: 0 }, right: operand, operator: "-", line: position(node).line });
      return { kind: "ref", id, outputName: "Calculation Result", valueType: "number" };
    }
    if (ts.isBinaryExpression(node) && [ts.SyntaxKind.PlusToken, ts.SyntaxKind.MinusToken, ts.SyntaxKind.AsteriskToken, ts.SyntaxKind.SlashToken, ts.SyntaxKind.PercentToken, ts.SyntaxKind.AsteriskAsteriskToken].includes(node.operatorToken.kind)) {
      const left = value(node.left, scopes, output);
      const right = value(node.right, scopes, output);
      if (node.operatorToken.kind === ts.SyntaxKind.PlusToken && (category(left) === "text" || category(right) === "text")) {
        if (!["text", "number"].includes(category(left)) || !["text", "number"].includes(category(right))) fail("String concatenation supports text and numbers only.", node);
        return { kind: "text", parts: [...parts(left as ScalarValue), ...parts(right as ScalarValue)] };
      }
      if (category(left) !== "number" || category(right) !== "number") fail("Arithmetic requires numbers.", node);
      const id = nextId++;
      output.push({ kind: "math", id, left: left as ScalarValue, right: right as ScalarValue, operator: node.operatorToken.getText(sourceFile) as "+", line: position(node).line });
      return { kind: "ref", id, outputName: "Calculation Result", valueType: "number" };
    }
    if (ts.isObjectLiteralExpression(node)) {
      const keys = new Set<string>();
      const entries: [string, Value][] = node.properties.map(property => {
        if (!ts.isPropertyAssignment(property) && !ts.isShorthandPropertyAssignment(property)) fail("Object literals support plain properties only.", property);
        const key = propertyName(property.name, fail);
        literal(key, property);
        if (keys.has(key)) fail("Duplicate object key.", property);
        keys.add(key);
        return [key, value(ts.isShorthandPropertyAssignment(property) ? property.name : property.initializer, scopes, output)];
      });
      const id = nextId++;
      output.push({ kind: "dictionary", id, entries, line: position(node).line });
      jsonTypes.set(id, checker.getTypeAtLocation(node));
      dictionaryLiterals.set(id, entries);
      return { kind: "object-ref", id, outputName: "Dictionary" };
    }
    if (ts.isElementAccessExpression(node)) {
      if (node.questionDotToken) fail("Optional chaining is not supported.", node);
      const input = value(node.expression, scopes, output);
      if (input.kind === "object-ref" && node.argumentExpression) {
        const key = value(node.argumentExpression, scopes, output);
        if (key.kind !== "text" || key.parts.some(part => typeof part !== "string")) fail("Dictionary brackets require a static string key. Use getDictionaryValue<T>(dictionary, keyPath) for runtime keys and native paths.", node.argumentExpression);
        return readField(input, key.parts.join(""), node, output);
      }
      if (input.kind !== "list-ref" || !node.argumentExpression) fail("Bracket access requires a list and a numeric index.", node);
      const indexValue = numeric(node.argumentExpression, scopes, output);
      const index = indexValue.kind === "number" ? indexValue.value : indexValue;
      if (typeof index === "number" && (!Number.isSafeInteger(index) || index < 0)) fail("List index must be a nonnegative integer.", node);
      return readIndex(input, index, node, output);
    }
    if (ts.isAwaitExpression(node)) return call(node, scopes, output, true)!;
    if (ts.isConditionalExpression(node)) {
      const yes: IRNode[] = [], no: IRNode[] = [];
      const trueValue = value(node.whenTrue, scopes, yes);
      const falseValue = value(node.whenFalse, scopes, no);
      if (category(trueValue) !== category(falseValue)) fail("Both ternary branches must have the same value category.", node);
      const name = `ts_${nextId++}_choice`;
      yes.push({ kind: "set", name, value: trueValue, line: position(node.whenTrue).line });
      no.push({ kind: "set", name, value: falseValue, line: position(node.whenFalse).line });
      output.push(...condition(node.condition, scopes, () => yes, () => no));
      const id = nextId++;
      output.push({ kind: "get", id, name, line: position(node).line });
      return typedRef(checker.getTypeAtLocation(node), id, "Variable", node);
    }
    if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.ExclamationToken
      || ts.isBinaryExpression(node) && ["===", "!==", "<", "<=", ">", ">=", "&&", "||"].includes(node.operatorToken.getText(sourceFile))) {
      const name = `ts_${nextId++}_boolean`;
      output.push(...condition(node, scopes,
        () => [{ kind: "set", name, value: { kind: "boolean", value: true }, line: position(node).line }],
        () => [{ kind: "set", name, value: { kind: "boolean", value: false }, line: position(node).line }]));
      const id = nextId++;
      output.push({ kind: "get", id, name, line: position(node).line });
      return { kind: "ref", id, outputName: "Variable", valueType: "boolean" };
    }
    if (ts.isPropertyAccessExpression(node)) {
      if (node.questionDotToken) fail("Optional chaining is not supported for JSON fields.", node);
      const input = value(node.expression, scopes, output);
      if (input.kind === "list-ref" && node.name.text === "length") {
        const id = nextId++;
        output.push({ kind: "native", id, identifier: "is.workflow.actions.count", parameters: { kind: "parameter-object", entries: [
          ["Input", { kind: "parameter-value", value: input, encoding: "attachment" }],
          ["WFCountType", { kind: "literal", value: "Items" }],
        ] }, line: position(node).line });
        return { kind: "ref", id, outputName: "Count", valueType: "number" };
      }
      if (input.kind !== "object-ref") fail("Property access requires a typed JSON object.", node);
      return readField(input, node.name.text, node, output);
    }
    if (ts.isArrayLiteralExpression(node)) {
      const items = node.elements.map(element => {
        if (ts.isSpreadElement(element) || ts.isOmittedExpression(element)) fail("Array spreads and holes are not supported.", element);
        return value(element, scopes, output);
      });
      const id = nextId++;
      output.push({ kind: "list", id, items, line: position(node).line });
      return typedRef(checker.getTypeAtLocation(node), id, "List", node);
    }
    if (ts.isTemplateExpression(node)) {
      const parts: TextValue["parts"] = [...literal(node.head.text, node.head).parts];
      for (const span of node.templateSpans) {
        const item = scalar(span.expression, scopes, output);
        parts.push(...(item.kind === "text" ? item.parts : item.kind === "number" ? [String(item.value)] : item.kind === "boolean" ? [String(item.value)] : [item]));
        parts.push(...literal(span.literal.text, span.literal).parts);
      }
      return { kind: "text", parts };
    }
    fail(`Unsupported expression: ${ts.SyntaxKind[node.kind]}. Lists support text values only.`, node);
  }
  function category(value: Value): string {
    return value.kind === "ref" ? value.valueType ?? "text" : value.kind;
  }
  function parts(value: ScalarValue): TextValue["parts"] {
    return value.kind === "text" ? value.parts : value.kind === "ref" ? [value] : [String(value.value)];
  }
  function cloneRef(value: Value, id: number, outputName: string): Value {
    if (value.kind === "list-ref" || value.kind === "object-ref") {
      const type = jsonTypes.get(value.id);
      if (type) jsonTypes.set(id, type);
      return { ...value, id, outputName };
    }
    const valueType = category(value);
    return { kind: "ref", id, outputName, ...(valueType === "text" ? {} : { valueType: valueType as "number" | "boolean" | "content" }) };
  }
  function readField(input: ObjectRef, key: string, node: ts.Node, output: IRNode[]): Value {
    // Native Dictionary Value also interprets key paths; do not silently reinterpret literal dotted keys.
    if (key.includes(".")) fail("Literal dictionary keys containing dots are not supported by typed field access yet.", node);
    const property = checker.getPropertyOfType(jsonTypes.get(input.id)!, key);
    if (!property) fail(`Unknown JSON field '${key}'.`, node);
    if (property.flags & ts.SymbolFlags.Optional) fail("Optional JSON fields need runtime validation, which is not supported yet.", node);
    const id = nextId++;
    const result = typedRef(checker.getTypeOfSymbolAtLocation(property, node), id, "Dictionary Value", node);
    output.push({ kind: "field", id, input, key, line: position(node).line });
    return result;
  }
  function readIndex(input: ListRef, index: number | ScalarValue, node: ts.Node, output: IRNode[]): Value {
    const id = nextId++;
    output.push({ kind: "index", id, input, index, line: position(node).line });
    const type = jsonTypes.get(input.id);
    if (!type) return { kind: "ref", id, outputName: "Item from List" };
    const property = typeof index === "number" && checker.isTupleType(type) ? checker.getPropertyOfType(type, String(index)) : undefined;
    if (property?.flags && property.flags & ts.SymbolFlags.Optional) fail("Optional tuple elements are not supported yet.", node);
    return typedRef(property ? checker.getTypeOfSymbolAtLocation(property, node) : checker.getIndexTypeOfType(type, ts.IndexKind.Number)!, id, "Item from List", node);
  }
  function declarePattern(name: ts.BindingName, scope: Scope): void {
    if (ts.isIdentifier(name)) {
      if (scope.has(name.text)) fail(`Duplicate declaration '${name.text}'.`, name);
      scope.set(name.text, undefined);
      return;
    }
    for (const element of name.elements) {
      if (ts.isOmittedExpression(element)) continue;
      if (element.initializer || element.dotDotDotToken) fail("Defaults and rest in destructuring are not supported yet.", element);
      declarePattern(element.name, scope);
    }
  }
  function bindPattern(name: ts.BindingName, input: Value, scope: Scope, isMutable: boolean, output: IRNode[], line: number): void {
    if (ts.isIdentifier(name)) {
      scope.set(name.text, input);
      if (isMutable) {
        const runtimeName = `ts_${nextId++}_${name.text}`;
        mutable.get(scope)!.set(name.text, runtimeName);
        output.push({ kind: "set", name: runtimeName, value: input, line });
      }
      return;
    }
    if (ts.isObjectBindingPattern(name)) {
      if (input.kind !== "object-ref") fail("Object destructuring requires a typed object.", name);
      for (const element of name.elements) {
        if (element.initializer || element.dotDotDotToken) fail("Defaults and rest in destructuring are not supported yet.", element);
        const key = propertyName(element.propertyName ?? element.name as ts.Identifier, fail);
        bindPattern(element.name, readField(input, key, element, output), scope, isMutable, output, position(element).line);
      }
    } else {
      if (input.kind !== "list-ref") fail("Array destructuring requires a list.", name);
      name.elements.forEach((element, index) => {
        if (ts.isOmittedExpression(element)) return;
        if (element.initializer || element.dotDotDotToken) fail("Defaults and rest in destructuring are not supported yet.", element);
        bindPattern(element.name, readIndex(input, index, element, output), scope, isMutable, output, position(element).line);
      });
    }
  }
  function bindParameterPattern(parameter: ts.ParameterDeclaration, argument: Value, scope: Scope, output: IRNode[], line: number): void {
    declarePattern(parameter.name, scope);
    const id = nextId++;
    const name = `ts_${id}_parameter`;
    output.push({ kind: "set", name, value: argument, line });
    output.push({ kind: "get", id, name, line });
    const typed = typedRef(checker.getTypeAtLocation(parameter), id, "Parameter", parameter);
    bindPattern(parameter.name, typed, scope, true, output, line);
  }
  function numeric(node: ts.Expression, scopes: Scope[], output: IRNode[]): ScalarValue {
    const result = value(node, scopes, output);
    if (category(result) !== "number") fail("Expected a number.", node);
    return result as ScalarValue;
  }
  function intrinsic(expr: ts.CallExpression, scopes: Scope[]): string | undefined {
    if (!ts.isIdentifier(expr.expression) || scopes.some(scope => scope.has(expr.expression.getText(sourceFile)))) return undefined;
    return imports.get(expr.expression.text);
  }
  function helperDeclaration(expr: ts.CallExpression, scopes: Scope[]): ts.FunctionDeclaration | undefined {
    if (!ts.isIdentifier(expr.expression) || scopes.some(scope => scope.has(expr.expression.getText(sourceFile)))) return undefined;
    return functions.get(expr.expression.text);
  }
  function mathMember(node: ts.Expression, scopes: Scope[]): string | undefined {
    const access = unwrap(node);
    if (!ts.isPropertyAccessExpression(access) && !ts.isElementAccessExpression(access)) return undefined;
    const receiver = unwrap(access.expression);
    if (!ts.isIdentifier(receiver) || receiver.text !== "Math" || scopes.some(scope => scope.has("Math")) || functions.has("Math") || imports.has("Math")) return undefined;
    if (access.questionDotToken) fail("Optional Math access is not supported.", access);
    if (ts.isPropertyAccessExpression(access)) return access.name.text;
    const key = unwrap(access.argumentExpression);
    if (!ts.isStringLiteralLike(key)) fail("Math access requires a static member name.", access);
    return key.text;
  }
  function mathCall(expr: ts.CallExpression, scopes: Scope[], output: IRNode[]): ScalarValue {
    const method = mathMember(expr.expression, scopes)!;
    if (expr.questionDotToken) fail("Optional Math calls are not supported.", expr);
    if (expr.typeArguments?.length || expr.arguments.some(ts.isSpreadElement)) fail("Math calls do not support type arguments or spreads.", expr);
    if (!["abs", "sign", "min", "max", "floor", "ceil", "trunc", "round", "pow", "sqrt"].includes(method)) fail(`Math.${method} is not supported yet.`, expr);
    if (method === "min" || method === "max") {
      if (!expr.arguments.length) fail(`Math.${method} requires at least one number; infinite results are unsupported.`, expr);
    } else if (expr.arguments.length !== (method === "pow" ? 2 : 1)) fail(`Math.${method} expects ${method === "pow" ? "two numbers" : "one number"}.`, expr);
    // Freeze all arguments before computing, matching JS argument evaluation order.
    const args = expr.arguments.map(argument => numeric(argument, scopes, output));
    const line = position(expr).line;
    const num = (value: number): ScalarValue => ({ kind: "number", value });
    const calc = (left: ScalarValue, operator: "+" | "-" | "%" | "**", right: ScalarValue): ScalarValue => {
      const id = nextId++;
      output.push({ kind: "math", id, left, right, operator, line });
      return { kind: "ref", id, outputName: "Calculation Result", valueType: "number" };
    };
    const choose = (left: ScalarValue, operator: "<" | ">" | ">=", right: ScalarValue, yes: ScalarValue, no: ScalarValue): ScalarValue => {
      const name = `ts_${nextId++}_math`;
      output.push({ kind: "numeric-if", left, right, operator,
        then: [{ kind: "set", name, value: yes, line }], else: [{ kind: "set", name, value: no, line }], line });
      const id = nextId++;
      output.push({ kind: "get", id, name, line });
      return { kind: "ref", id, outputName: "Variable", valueType: "number" };
    };
    const x = args[0];
    if (method === "pow") return calc(x, "**", args[1]);
    if (method === "sqrt") {
      if (x.kind === "number" && x.value < 0) fail("Math.sqrt requires a nonnegative number; NaN is unsupported.", expr);
      return calc(x, "**", num(0.5));
    }
    if (method === "abs") return choose(x, "<", num(0), calc(num(0), "-", x), x);
    if (method === "sign") return choose(x, "<", num(0), num(-1), choose(x, ">", num(0), num(1), num(0)));
    if (method === "min" || method === "max") {
      return args.slice(1).reduce((best, item) => choose(item, method === "min" ? "<" : ">", best, item, best), x);
    }
    // Decompose into integer/remainder instead of using native round-to-nearest.
    // This also avoids adding 0.5 to a large input before truncating.
    const fraction = calc(x, "%", num(1));
    const integer = calc(x, "-", fraction);
    if (method === "trunc") return integer;
    if (method === "floor") return choose(fraction, "<", num(0), calc(integer, "-", num(1)), integer);
    if (method === "ceil") return choose(fraction, ">", num(0), calc(integer, "+", num(1)), integer);
    const negative = choose(fraction, "<", num(-0.5), calc(integer, "-", num(1)), integer);
    return choose(fraction, ">=", num(0.5), calc(integer, "+", num(1)), negative);
  }
  function stringMethodName(expr: ts.CallExpression): StringMethod | undefined {
    const access = unwrap(expr.expression);
    if (!ts.isPropertyAccessExpression(access)) return undefined;
    const method = access.name.text;
    if (!["trim", "trimStart", "trimEnd", "toUpperCase", "toLowerCase", "concat", "startsWith", "endsWith", "includes"].includes(method)) return undefined;
    // includes and concat also exist on arrays; dispatch from the checked receiver type.
    if (["includes", "concat"].includes(method)) {
      const type = checker.getTypeAtLocation(access.expression);
      if (!(type.isUnion() ? type.types : [type]).every(t => !!(t.flags & ts.TypeFlags.StringLike))) return undefined;
    }
    return method as StringMethod;
  }
  function stringMethod(expr: ts.CallExpression, scopes: Scope[], output: IRNode[]): Value {
    const access = unwrap(expr.expression) as ts.PropertyAccessExpression;
    const method = stringMethodName(expr)!;
    if (expr.questionDotToken || access.questionDotToken) fail("Optional string method calls are not supported.", expr);
    if (expr.typeArguments?.length || expr.arguments.some(ts.isSpreadElement)) fail("String methods do not support type arguments or argument spreads.", expr);
    const predicate = ["startsWith", "endsWith", "includes"].includes(method);
    if (method !== "concat" && expr.arguments.length !== (predicate ? 1 : 0)) fail(predicate ? `${method} requires one text argument; position arguments are not supported yet.` : `${method} takes no arguments.`, expr);
    const input = value(access.expression, scopes, output);
    if (category(input) !== "text") fail("String methods require a text receiver.", access.expression);
    const args = expr.arguments.map(argument => {
      const item = value(argument, scopes, output);
      if (category(item) !== "text") fail("String method arguments must be text; implicit conversion and RegExp arguments are not supported.", argument);
      return item as ScalarValue;
    });
    const id = nextId++;
    output.push({ kind: "string", method, id, input: input as ScalarValue, args, line: position(expr).line });
    return { kind: "ref", id, outputName: predicate ? "If Result" : "Text", ...(predicate ? { valueType: "boolean" as const } : {}) };
  }
  function arrayMethodName(expr: ts.CallExpression): string | undefined {
    return ts.isPropertyAccessExpression(expr.expression) && ["map", "filter", "reduce", "forEach", "some", "every", "findIndex", "includes", "indexOf"].includes(expr.expression.name.text) ? expr.expression.name.text : undefined;
  }
  function jsonOperation(expr: ts.CallExpression, scopes: Scope[]): "parse" | "stringify" | undefined {
    const target = unwrap(expr.expression);
    if (ts.isIdentifier(target) && !scopes.some(scope => scope.has(target.text))) {
      if (imports.get(target.text) === "stringifyJson") return "stringify";
      if (imports.get(target.text) === "parseJson") return "parse";
    }
    if (ts.isPropertyAccessExpression(target) && ts.isIdentifier(target.expression)
      && target.expression.text === "JSON" && target.name.text === "stringify"
      && !scopes.some(scope => scope.has("JSON")) && !functions.has("JSON") && !imports.has("JSON")) return "stringify";
    return undefined;
  }
  function requestJson(expr: ts.CallExpression, scopes: Scope[], output: IRNode[]): Value {
    if (expr.questionDotToken) fail("Optional requestJson calls are not supported.", expr);
    if (expr.arguments.length < 1 || expr.arguments.length > 2 || expr.arguments.some(ts.isSpreadElement)) fail("requestJson expects a URL and optional inline options object.", expr);
    if (isJavaScript || expr.typeArguments?.length !== 1) fail("Use requestJson<Response>(url, options) with an explicit object or array response type.", expr);
    const url = value(expr.arguments[0], scopes, output);
    if (category(url) !== "text") fail("requestJson URL must be text.", expr.arguments[0]);
    let method = "GET";
    let body: Value | undefined;
    let headers: [string, Value][] = [];
    if (expr.arguments[1]) {
      const options = unwrap(expr.arguments[1]);
      if (!ts.isObjectLiteralExpression(options)) fail("requestJson options must be an inline object literal.", options);
      const keys = new Set<string>();
      for (const property of options.properties) {
        if (!ts.isPropertyAssignment(property) && !ts.isShorthandPropertyAssignment(property)) fail("Request options require plain properties without spreads or methods.", property);
        const key = propertyName(property.name, fail);
        if (!["method", "headers", "json"].includes(key)) fail(`Unknown requestJson option '${key}'.`, property);
        if (keys.has(key)) fail(`Duplicate requestJson option '${key}'.`, property);
        keys.add(key);
        const input = value(ts.isShorthandPropertyAssignment(property) ? property.name : property.initializer, scopes, output);
        if (key === "method") {
          if (input.kind !== "text" || input.parts.some(p => typeof p !== "string")) fail("HTTP method must be a constant GET, POST, PUT, PATCH or DELETE.", property);
          method = input.parts.join("");
          if (!["GET", "POST", "PUT", "PATCH", "DELETE"].includes(method)) fail("HTTP method must be GET, POST, PUT, PATCH or DELETE.", property);
        } else if (key === "headers") {
          if (input.kind !== "object-ref" || !dictionaryLiterals.has(input.id)) fail("HTTP headers require an object literal or const alias with static names and text values.", property);
          headers = dictionaryLiterals.get(input.id)!;
          const names = new Set<string>();
          for (const [name, item] of headers) {
            if (!/^[!#$%&'*+.^_\x60|~0-9A-Za-z-]+$/.test(name)) fail(`Invalid HTTP header name '${name}'.`, property);
            const lower = name.toLowerCase();
            if (names.has(lower)) fail(`Duplicate HTTP header '${name}' (case-insensitive).`, property);
            names.add(lower);
            if (category(item) !== "text") fail("HTTP header values must be text.", property);
            if (item.kind === "text" && item.parts.some(p => typeof p === "string" && /[\r\n]/.test(p))) fail("HTTP header values cannot contain line breaks.", property);
          }
        } else {
          if (category(input) === "content") fail("requestJson json requires JSON-compatible data, not opaque native content.", property);
          body = input;
        }
      }
    }
    if (method === "GET" && body !== undefined) fail("GET requests cannot include a json body; choose POST, PUT, PATCH or DELETE.", expr);
    const merged = new Map<string, [string, Value]>([["accept", ["Accept", { kind: "text", parts: ["application/json"] }]]]);
    if (body !== undefined) merged.set("content-type", ["Content-Type", { kind: "text", parts: ["application/json"] }]);
    for (const entry of headers) merged.set(entry[0].toLowerCase(), entry);
    const line = position(expr).line;
    const headerId = nextId++;
    output.push({ kind: "dictionary", id: headerId, entries: [...merged.values()], line });
    const parameters: [string, NativeParameter][] = [
      ["WFURL", { kind: "parameter-value", value: url, encoding: "text" }],
      ["WFHTTPMethod", { kind: "literal", value: method }],
      ["WFHTTPHeaders", { kind: "parameter-value", value: { kind: "object-ref", id: headerId, outputName: "Headers" }, encoding: "dictionary" }],
    ];
    if (body !== undefined) {
      const bodyId = nextId++;
      output.push({ kind: "json", operation: "stringify", id: bodyId, input: body, line });
      parameters.push(["WFHTTPBodyType", { kind: "literal", value: "File" }],
        ["WFRequestVariable", { kind: "parameter-value", value: { kind: "ref", id: bodyId, outputName: "JSON Text" }, encoding: "attachment" }],
        ["WFFormValues", { kind: "literal", value: { WFSerializationType: "WFDictionaryFieldValue", Value: { WFDictionaryFieldValueItems: [] } } }]);
    }
    const id = nextId++;
    const result = typedRef(checker.getTypeFromTypeNode(expr.typeArguments[0]), id, "Contents of URL", expr);
    if (result.kind !== "object-ref" && result.kind !== "list-ref") fail("requestJson requires an object or array response type.", expr);
    output.push({ kind: "native", id, identifier: "is.workflow.actions.downloadurl", parameters: { kind: "parameter-object", entries: parameters }, line });
    return result;
  }
  function jsonCall(expr: ts.CallExpression, operation: "parse" | "stringify", scopes: Scope[], output: IRNode[]): Value {
    const target = unwrap(expr.expression);
    if (expr.questionDotToken || ts.isPropertyAccessExpression(target) && target.questionDotToken) fail("Optional JSON calls are not supported.", expr);
    if (expr.arguments.length !== 1 || ts.isSpreadElement(expr.arguments[0])) fail("JSON conversion requires one argument; replacers, revivers and indentation are not supported.", expr);
    if (operation === "parse" && (isJavaScript || expr.typeArguments?.length !== 1)) fail("Use parseJson<Result>(text) with an explicit supported result type.", expr);
    if (operation === "stringify" && expr.typeArguments?.length) fail("JSON serialization does not take type arguments.", expr);
    const input = value(expr.arguments[0], scopes, output);
    if (operation === "parse" && category(input) !== "text") fail("parseJson requires text.", expr.arguments[0]);
    if (category(input) === "content") fail("JSON conversion requires JSON-compatible values, not opaque native content.", expr.arguments[0]);
    const id = nextId++;
    const result = operation === "parse" ? typedRef(checker.getTypeFromTypeNode(expr.typeArguments![0]), id, "JSON Value", expr) : { kind: "ref" as const, id, outputName: "JSON Text" };
    if (operation === "parse" && (category(result) === "content" || result.kind === "list-ref" && result.arrayDepth !== undefined && result.arrayDepth !== 1)) fail("parseJson results require supported JSON values; native content and arrays of arrays are not supported.", expr);
    output.push({ kind: "json", operation, id, input, line: position(expr).line });
    return result;
  }
  function arrayMethod(expr: ts.CallExpression, scopes: Scope[], output: IRNode[], needsValue: boolean): Value | undefined {
    const access = expr.expression as ts.PropertyAccessExpression;
    const method = access.name.text;
    const line = position(expr).line;
    if (expr.questionDotToken || access.questionDotToken) fail("Optional array method calls are not supported.", expr);
    if (method === "includes" || method === "indexOf") return arrayLookup(expr, scopes, output);
    if (method === "forEach" && needsValue) fail("forEach has no return value.", expr);
    if (expr.arguments.length !== (method === "reduce" ? 2 : 1)) fail(method === "reduce" ? "reduce requires a callback and an initial value." : `${method} requires one callback; thisArg is not supported.`, expr);
    const input = value(access.expression, scopes, output);
    if (input.kind !== "list-ref") fail(`${method} requires a typed array.`, access.expression);
    const callback = unwrap(expr.arguments[0]);
    if (!ts.isArrowFunction(callback) || callback.modifiers?.some(m => m.kind === ts.SyntaxKind.AsyncKeyword)) fail(`${method} requires a synchronous arrow callback. Async array callbacks are not supported.`, callback);
    const maxParameters = method === "reduce" ? 4 : 3;
    if (callback.typeParameters?.length || callback.parameters.length > maxParameters || callback.parameters.some(p => p.initializer || p.dotDotDotToken || p.questionToken)) fail("Array callbacks require binding parameters without defaults, rest or generics.", callback);
    const loopId = nextId++;
    const itemType = checker.getIndexTypeOfType(jsonTypes.get(input.id)!, ts.IndexKind.Number)!;
    const item = typedRef(itemType, loopId, "Repeat Item", callback);
    const body: IRNode[] = [];
    const resultId = nextId++;
    const search = ["some", "every", "findIndex"].includes(method) ? { result: `ts_${nextId++}_search_result`, done: `ts_${nextId++}_search_done` } : undefined;
    const result = method === "forEach" ? undefined : typedRef(checker.getTypeAtLocation(expr), resultId, method === "reduce" || search ? "Variable" : "Repeat Results", expr);
    if (search) {
      output.push({ kind: "set", name: search.result, value: method === "findIndex" ? { kind: "number", value: -1 } : { kind: "boolean", value: method === "every" }, line });
      output.push({ kind: "set", name: search.done, value: { kind: "boolean", value: false }, line });
    }
    const args: Value[] = [];
    let accumulator: { name: string; initial: Value } | undefined;
    if (method === "reduce") {
      const initial = value(expr.arguments[1], scopes, output);
      accumulator = { name: `ts_${nextId++}_accumulator`, initial };
      output.push({ kind: "set", name: accumulator.name, value: initial, line });
      const id = nextId++;
      body.push({ kind: "get", id, name: accumulator.name, line });
      args.push(cloneRef(initial, id, "Accumulator"));
    }
    args.push(item);
    let counter: { name: string; value: ScalarValue } | undefined;
    if (method === "findIndex" || callback.parameters.length > args.length) {
      const name = `ts_${nextId++}_index`;
      const id = nextId++;
      output.push({ kind: "set", name, value: { kind: "number", value: 0 }, line });
      body.push({ kind: "get", id, name, line });
      counter = { name, value: { kind: "ref", id, outputName: "Index", valueType: "number" } };
      args.push(counter.value, input);
    }
    const scope: Scope = new Map();
    mutable.set(scope, new Map());
    callback.parameters.forEach((parameter, i) => {
      if (!ts.isIdentifier(parameter.name)) { bindParameterPattern(parameter, args[i], scope, body, line); return; }
      const name = (parameter.name as ts.Identifier).text;
      if (scope.has(name)) fail(`Duplicate callback parameter '${name}'.`, parameter);
      const runtimeName = `ts_${nextId++}_${name}`;
      scope.set(name, typedRef(checker.getTypeAtLocation(parameter), nextId++, "Parameter", parameter));
      mutable.get(scope)!.set(name, runtimeName);
      body.push({ kind: "set", name: runtimeName, value: args[i], line });
    });
    const nested = [...scopes, scope];
    let returned: Value | undefined;
    if (ts.isBlock(callback.body)) {
      const returnType = checker.getReturnTypeOfSignature(checker.getSignatureFromDeclaration(callback)!);
      const id = nextId++;
      if (method !== "forEach") returned = typedRef(returnType, id, "Callback Result", callback);
      const frame: FunctionFrame = { done: `ts_${nextId++}_returned`, ...(returned ? { result: `ts_${id}_result` } : {}) };
      body.push({ kind: "set", name: frame.done, value: { kind: "boolean", value: false }, line });
      body.push(...block(callback.body, nested, frame));
      if (returned) body.push({ kind: "get", id, name: frame.result!, line });
    } else if (method === "forEach" && assignment(callback.body, nested, body)) {
      // The result of an assignment/update expression is ignored by forEach.
    } else if (method === "forEach" && checker.getTypeAtLocation(callback.body).flags & ts.TypeFlags.Void) {
      if (!assignment(callback.body, nested, body)) call(callback.body, nested, body, false);
    } else {
      returned = value(callback.body, nested, body);
    }
    if (counter) {
      const id = nextId++;
      body.push({ kind: "math", id, left: counter.value, operator: "+", right: { kind: "number", value: 1 }, line });
      body.push({ kind: "set", name: counter.name, value: { kind: "ref", id, outputName: "Index", valueType: "number" }, line });
    }
    if (method === "map") {
      if (!returned || returned.kind === "list-ref") fail("map must return one scalar, object or native item per iteration; nested arrays are not supported.", callback);
      body.push({ kind: "yield", value: returned, line });
    } else if (method === "filter") {
      if (!returned || category(returned) !== "boolean") fail("filter callbacks must return a boolean; implicit truthiness is not supported.", callback);
      body.push({ kind: "numeric-if", left: returned as ScalarValue, operator: "===", right: { kind: "boolean", value: true }, then: [{ kind: "yield", value: item, line }], else: [{ kind: "yield", line }], line });
    } else if (accumulator) {
      if (!returned || category(returned) !== category(accumulator.initial)) fail("reduce must preserve the accumulator's value category.", callback);
      body.push({ kind: "set", name: accumulator.name, value: returned, line });
    } else if (search) {
      if (!returned || category(returned) !== "boolean") fail(`${method} callbacks must return a boolean; implicit truthiness is not supported.`, callback);
      body.push({ kind: "numeric-if", left: returned as ScalarValue, operator: "===", right: { kind: "boolean", value: method !== "every" }, then: [
        { kind: "set", name: search.result, value: method === "findIndex" ? counter!.value : { kind: "boolean", value: method === "some" }, line },
        { kind: "set", name: search.done, value: { kind: "boolean", value: true }, line },
      ], else: null, line });
    }
    output.push({ kind: "repeat", id: loopId, input, body: search ? whenFalse(search.done, body, line) : body, ...(method === "map" || method === "filter" ? { resultId } : {}), line });
    if (accumulator) output.push({ kind: "get", id: resultId, name: accumulator.name, line });
    if (search) output.push({ kind: "get", id: resultId, name: search.result, line });
    return result;
  }
  function arrayLookup(expr: ts.CallExpression, scopes: Scope[], output: IRNode[]): Value {
    const access = expr.expression as ts.PropertyAccessExpression;
    const method = access.name.text;
    const line = position(expr).line;
    if (expr.arguments.length < 1 || expr.arguments.length > 2) fail(`${method} requires a search value and optional constant fromIndex.`, expr);
    const input = value(access.expression, scopes, output);
    if (input.kind !== "list-ref") fail(`${method} requires a typed array.`, access.expression);
    const needle = value(expr.arguments[0], scopes, output);
    if (!["text", "number", "boolean"].includes(category(needle))) fail(`${method} supports scalar text, number or boolean values; object identity is not supported.`, expr.arguments[0]);
    const suppliedStart = expr.arguments[1] ? numeric(expr.arguments[1], scopes, output) : { kind: "number" as const, value: 0 };
    if (suppliedStart.kind !== "number") fail(`${method} fromIndex must be a constant number; runtime offsets are not supported yet.`, expr.arguments[1]);
    const start = Math.trunc(suppliedStart.value);
    const loopId = nextId++;
    const itemType = checker.getIndexTypeOfType(jsonTypes.get(input.id)!, ts.IndexKind.Number)!;
    const item = itemType.flags & ts.TypeFlags.Never ? cloneRef(needle, loopId, "Repeat Item") : typedRef(itemType, loopId, "Repeat Item", expr);
    if (category(item) !== category(needle)) fail(`${method} requires the search value to have the array's scalar value category.`, expr);
    let minimum: ScalarValue = { kind: "number", value: start };
    if (start < 0) {
      const lengthId = nextId++;
      output.push({ kind: "native", id: lengthId, identifier: "is.workflow.actions.count", parameters: { kind: "parameter-object", entries: [
        ["Input", { kind: "parameter-value", value: input, encoding: "attachment" }], ["WFCountType", { kind: "literal", value: "Items" }],
      ] }, line });
      const offsetId = nextId++;
      output.push({ kind: "math", id: offsetId, left: { kind: "ref", id: lengthId, outputName: "Count", valueType: "number" }, operator: "+", right: minimum, line });
      minimum = { kind: "ref", id: offsetId, outputName: "Calculation Result", valueType: "number" };
    }
    const resultName = `ts_${nextId++}_lookup_result`;
    const doneName = `ts_${nextId++}_lookup_done`;
    const indexName = `ts_${nextId++}_lookup_index`;
    output.push({ kind: "set", name: resultName, value: method === "includes" ? { kind: "boolean", value: false } : { kind: "number", value: -1 }, line });
    output.push({ kind: "set", name: doneName, value: { kind: "boolean", value: false }, line });
    output.push({ kind: "set", name: indexName, value: { kind: "number", value: 0 }, line });
    const indexId = nextId++;
    const index: ScalarValue = { kind: "ref", id: indexId, outputName: "Index", valueType: "number" };
    const found: IRNode[] = [
      { kind: "set", name: resultName, value: method === "includes" ? { kind: "boolean", value: true } : index, line },
      { kind: "set", name: doneName, value: { kind: "boolean", value: true }, line },
    ];
    const compare: IRNode = category(item) === "text"
      ? { kind: "if", left: item as ScalarValue, operator: "===", right: textComparisonRight(needle as TextValue | OutputRef), then: found, else: null, line }
      : { kind: "numeric-if", left: item as ScalarValue, operator: "===", right: needle as ScalarValue, then: found, else: null, line };
    const incrementId = nextId++;
    const body: IRNode[] = [
      { kind: "get", id: indexId, name: indexName, line },
      { kind: "numeric-if", left: index, operator: ">=", right: minimum, then: [compare], else: null, line },
      { kind: "math", id: incrementId, left: index, operator: "+", right: { kind: "number", value: 1 }, line },
      { kind: "set", name: indexName, value: { kind: "ref", id: incrementId, outputName: "Index", valueType: "number" }, line },
    ];
    output.push({ kind: "repeat", id: loopId, input, body: whenFalse(doneName, body, line), line });
    const resultId = nextId++;
    output.push({ kind: "get", id: resultId, name: resultName, line });
    return typedRef(checker.getTypeAtLocation(expr), resultId, "Variable", expr);
  }
  function inlineHelper(declaration: ts.FunctionDeclaration, expr: ts.CallExpression, scopes: Scope[], output: IRNode[], needsValue: boolean, awaited: boolean): Value | undefined {
    if (hasModifier(declaration, ts.SyntaxKind.AsyncKeyword) && !awaited) fail("Async helper functions must be awaited.", expr);
    if (callStack.includes(declaration)) fail(`Recursive helper calls cannot be inlined: ${[...callStack, declaration].map(fn => fn.name!.text).join(" → ")}.`, expr);
    if (declaration.typeParameters?.length || expr.typeArguments?.length) fail("Generic helper functions are not supported yet.", expr);
    if (declaration.parameters.some(p => p.dotDotDotToken || p.questionToken || p.initializer || p.name.getText(sourceFile) === "this")) {
      fail("Helper parameters must be required bindings without defaults or rest.", declaration);
    }
    if (expr.arguments.length !== declaration.parameters.length || expr.arguments.some(ts.isSpreadElement)) fail(`Helper '${declaration.name!.text}' expects ${declaration.parameters.length} arguments.`, expr);
    // Evaluate arguments in caller scope, left to right, before entering the callee.
    const args = expr.arguments.map(argument => value(argument, scopes, output));
    const scope: Scope = new Map();
    const bindings = new Map<string, string>();
    mutable.set(scope, bindings);
    declaration.parameters.forEach((parameter, index) => {
      if (!ts.isIdentifier(parameter.name)) { bindParameterPattern(parameter, args[index], scope, output, position(expr).line); return; }
      const name = (parameter.name as ts.Identifier).text;
      if (scope.has(name)) fail(`Duplicate parameter '${name}'.`, parameter);
      // Use the declared parameter type, not a narrower caller literal such as never[].
      // This placeholder carries type metadata; reads emit Get Variable with a fresh output ID.
      scope.set(name, typedRef(checker.getTypeAtLocation(parameter), nextId++, "Parameter", parameter));
      const runtimeName = `ts_${nextId++}_${name}`;
      bindings.set(name, runtimeName);
      output.push({ kind: "set", name: runtimeName, value: args[index], line: position(expr).line });
    });
    const id = nextId++;
    const type = checker.getAwaitedType(checker.getTypeAtLocation(expr))!;
    if (needsValue && type.flags & (ts.TypeFlags.Void | ts.TypeFlags.Undefined)) fail("This helper has no supported return value.", expr);
    const result = needsValue ? typedRef(type, id, "Function Result", expr) : undefined;
    const frame: FunctionFrame = { done: `ts_${nextId++}_returned`, ...(needsValue ? { result: `ts_${id}_result` } : {}) };
    output.push({ kind: "set", name: frame.done, value: { kind: "boolean", value: false }, line: position(expr).line });
    callStack.push(declaration);
    try {
      // Module-level helpers see their own parameters, not the caller's local bindings.
      output.push(...block(declaration.body!, [scope], frame));
    } finally { callStack.pop(); }
    if (needsValue) output.push({ kind: "get", id, name: frame.result!, line: position(expr).line });
    return result;
  }
  function hasLocalReturn(node: ts.Node): boolean {
    if (ts.isReturnStatement(node)) return true;
    if (ts.isFunctionLike(node)) return false;
    return !!ts.forEachChild(node, child => hasLocalReturn(child) || undefined);
  }
  function flowCallback(body: ts.Block, scopes: Scope[]): IRNode[] {
    if (!hasLocalReturn(body)) return block(body, scopes);
    const frame: FunctionFrame = { done: `ts_${nextId++}_callback_returned` };
    return [
      { kind: "set", name: frame.done, value: { kind: "boolean", value: false }, line: position(body).line },
      ...block(body, scopes, frame),
    ];
  }
  function hasLoopJump(node: ts.Node, kind?: ts.SyntaxKind, insideSwitch = false): boolean {
    if (ts.isBreakStatement(node) || ts.isContinueStatement(node)) {
      return !(insideSwitch && ts.isBreakStatement(node)) && (kind === undefined || node.kind === kind);
    }
    // A nested loop or function owns its own jumps; a surrounding loop must not consume them.
    if (ts.isFunctionLike(node) || ts.isForOfStatement(node) || ts.isForInStatement(node)
      || ts.isForStatement(node) || ts.isWhileStatement(node) || ts.isDoStatement(node)) return false;
    return !!ts.forEachChild(node, child => hasLoopJump(child, kind, insideSwitch || ts.isSwitchStatement(node)) || undefined);
  }
  function whenFalse(name: string, body: IRNode[], line: number): IRNode[] {
    const id = nextId++;
    return [
      { kind: "get", id, name, line },
      { kind: "numeric-if", left: { kind: "ref", id, outputName: "Variable", valueType: "boolean" }, operator: "===", right: { kind: "boolean", value: false }, then: body, else: null, line },
    ];
  }
  function staticHelper(node: ts.CallExpression, scopes: Scope[]): PlistDictionary[string] | undefined {
    const helper = intrinsic(node, scopes);
    if (helper !== "plistData" && helper !== "plistDate") return undefined;
    if (node.arguments.length !== 1) fail(`${helper} expects one static string argument.`, node);
    const argument = staticPlist(node.arguments[0], fail);
    if (typeof argument !== "string") fail(`${helper} expects one static string argument.`, node);
    try { return helper === "plistData" ? plistData(argument) : plistDate(argument); }
    catch (error) { fail(error instanceof Error ? error.message : String(error), node); }
  }
  function parameter(node: ts.Expression, scopes: Scope[], output: IRNode[]): NativeParameter {
    node = unwrap(node);
    if (ts.isCallExpression(node)) {
      const staticValue = staticHelper(node, scopes);
      if (staticValue !== undefined) return { kind: "literal", value: staticValue };
      const helper = intrinsic(node, scopes);
      if (["raw", "text", "attachment", "dictionary"].includes(helper ?? "")) {
        if (node.arguments.length !== 1) fail(`${helper} expects one argument.`, node);
        if (helper === "raw") return { kind: "literal", value: staticPlist(node.arguments[0], fail, call => staticHelper(call, scopes)) };
        return { kind: "parameter-value", value: value(node.arguments[0], scopes, output), encoding: helper as "text" | "attachment" | "dictionary" };
      }
    }
    if (ts.isObjectLiteralExpression(node)) {
      const keys = new Set<string>();
      return { kind: "parameter-object", entries: node.properties.map(property => {
        if (!ts.isPropertyAssignment(property) && !ts.isShorthandPropertyAssignment(property)) fail("Native parameters support plain properties only.", property);
        const key = propertyName(property.name, fail);
        literal(key, property);
        if (keys.has(key)) fail("Duplicate native parameter.", property);
        keys.add(key);
        return [key, parameter(ts.isShorthandPropertyAssignment(property) ? property.name : property.initializer, scopes, output)];
      }) };
    }
    if (ts.isArrayLiteralExpression(node)) return { kind: "parameter-array", items: node.elements.map(item => parameter(item, scopes, output)) };
    return { kind: "parameter-value", value: value(node, scopes, output), encoding: "auto" };
  }
  function assignment(node: ts.Expression, scopes: Scope[], output: IRNode[]): boolean {
    const unary = ts.isPostfixUnaryExpression(node) || ts.isPrefixUnaryExpression(node);
    const increment = unary && [ts.SyntaxKind.PlusPlusToken, ts.SyntaxKind.MinusMinusToken].includes(node.operator);
    const binary = ts.isBinaryExpression(node) && [ts.SyntaxKind.EqualsToken, ts.SyntaxKind.PlusEqualsToken, ts.SyntaxKind.MinusEqualsToken, ts.SyntaxKind.AsteriskEqualsToken, ts.SyntaxKind.SlashEqualsToken].includes(node.operatorToken.kind);
    if (!increment && !binary) return false;
    const target = increment ? node.operand : (node as ts.BinaryExpression).left;
    if (!ts.isIdentifier(target)) fail("Assign only to let variables; object/list mutation is not supported.", target);
    const scope = scopes.toReversed().find(scope => scope.has(target.text));
    const name = scope && mutable.get(scope)?.get(target.text);
    if (!name || !scope) fail("Only let variables can be assigned.", target);
    const initial = scope.get(target.text)!;
    let result: Value;
    if (binary && (node as ts.BinaryExpression).operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      result = value((node as ts.BinaryExpression).right, scopes, output);
    } else {
      const left = resolve(target, scopes, output);
      const right: Value = increment ? { kind: "number", value: 1 } : value((node as ts.BinaryExpression).right, scopes, output);
      const operator = increment ? node.operator === ts.SyntaxKind.PlusPlusToken ? "+" : "-" : (node as ts.BinaryExpression).operatorToken.getText(sourceFile).slice(0, -1);
      if (operator === "+" && category(left) === "text" && ["text", "number"].includes(category(right))) {
        result = { kind: "text", parts: [...parts(left as ScalarValue), ...parts(right as ScalarValue)] };
      } else {
        if (category(left) !== "number" || category(right) !== "number") fail("Numeric assignment requires numbers.", node);
        const id = nextId++;
        output.push({ kind: "math", id, left: left as ScalarValue, right: right as ScalarValue, operator: operator as "+", line: position(node).line });
        result = { kind: "ref", id, outputName: "Calculation Result", valueType: "number" };
      }
    }
    if (category(initial) !== category(result)) fail("Assignment must preserve the variable's value category.", node);
    output.push({ kind: "set", name, value: result, line: position(node).line });
    return true;
  }
  function condition(node: ts.Expression, scopes: Scope[], thenBody: () => IRNode[], elseBody: () => IRNode[]): IRNode[] {
    node = unwrap(node);
    if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.ExclamationToken) return condition(node.operand, scopes, elseBody, thenBody);
    if (ts.isBinaryExpression(node)) {
      if (node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) return condition(node.left, scopes, () => condition(node.right, scopes, thenBody, elseBody), elseBody);
      if (node.operatorToken.kind === ts.SyntaxKind.BarBarToken) return condition(node.left, scopes, thenBody, () => condition(node.right, scopes, thenBody, elseBody));
      const operator = node.operatorToken.getText(sourceFile);
      if (!["===", "!==", "<", "<=", ">", ">="].includes(operator)) fail("Use a strict text comparison or numeric comparison.", node);
      const output: IRNode[] = [];
      const left = value(node.left, scopes, output);
      const right = value(node.right, scopes, output);
      if (category(left) === "text" && category(right) === "text" && ["===", "!=="].includes(operator)) {
        output.push({ kind: "if", left: left as ScalarValue, operator: operator as "===", right: textComparisonRight(right as TextValue | OutputRef), then: thenBody(), else: elseBody(), line: position(node).line });
        return output;
      }
      if (!["number", "boolean"].includes(category(left)) || category(left) !== category(right)) fail("Use a strict text comparison between strings, or compare two numbers/booleans.", node);
      if (category(left) === "boolean" && !["===", "!=="].includes(operator)) fail("Booleans support === and !== only.", node);
      output.push({ kind: "numeric-if", left: left as ScalarValue, right: right as ScalarValue, operator: operator as "===", then: thenBody(), else: elseBody(), line: position(node).line });
      return output;
    }
    const output: IRNode[] = [];
    const flag = value(node, scopes, output);
    if (category(flag) !== "boolean") fail("Conditions require booleans or explicit comparisons; implicit truthiness is not supported.", node);
    output.push({ kind: "numeric-if", left: flag as ScalarValue, right: { kind: "boolean", value: true }, operator: "===", then: thenBody(), else: elseBody(), line: position(node).line });
    return output;
  }
  function textComparisonRight(value: TextValue | OutputRef): string | TextValue | OutputRef {
    return value.kind === "text" && value.parts.every(part => typeof part === "string") ? value.parts.join("") : value;
  }
  function switchStatement(node: ts.SwitchStatement, scopes: Scope[], frame?: FunctionFrame, loop?: LoopFrame): IRNode[] {
    const output: IRNode[] = [];
    const line = position(node).line;
    // The discriminant is outside the case block's lexical scope, and is frozen
    // before any case expression can run actions or mutate variables.
    const selected = value(node.expression, scopes, output);
    const type = category(selected);
    if (!["text", "number", "boolean"].includes(type)) fail("switch requires text, number or boolean values.", node.expression);
    const selectedId = nextId++;
    const selectedName = `ts_${selectedId}_switch_value`;
    output.push({ kind: "set", name: selectedName, value: selected, line });
    output.push({ kind: "get", id: selectedId, name: selectedName, line });
    const left = cloneRef(selected, selectedId, "Variable") as ScalarValue;
    const start = `ts_${nextId++}_switch_start`;
    const broken = `ts_${nextId++}_switch_break`;
    output.push({ kind: "set", name: start, value: { kind: "number", value: -1 }, line });
    output.push({ kind: "set", name: broken, value: { kind: "boolean", value: false }, line });
    const scope: Scope = new Map();
    mutable.set(scope, new Map());
    for (const clause of node.caseBlock.clauses) predeclare(clause.statements, scope);
    const nested = [...scopes, scope];
    let defaultIndex = -1;
    // Find the first match before executing a body. A default in the middle
    // does not prevent later case expressions from being tested.
    node.caseBlock.clauses.forEach((clause, index) => {
      if (ts.isDefaultClause(clause)) {
        if (defaultIndex !== -1) fail("switch permits only one default clause.", clause);
        defaultIndex = index;
        return;
      }
      const branch: IRNode[] = [];
      const right = value(clause.expression, nested, branch);
      if (category(right) !== type) fail("switch cases must have the same value category as the discriminant.", clause.expression);
      const match: IRNode[] = [{ kind: "set", name: start, value: { kind: "number", value: index }, line: position(clause).line }];
      if (type === "text") {
        branch.push({ kind: "if", left, operator: "===", right: textComparisonRight(right as TextValue | OutputRef), then: match, else: null, line: position(clause).line });
      } else {
        branch.push({ kind: "numeric-if", left, operator: "===", right: right as ScalarValue, then: match, else: null, line: position(clause).line });
      }
      const id = nextId++;
      output.push({ kind: "get", id, name: start, line });
      output.push({ kind: "numeric-if", left: { kind: "ref", id, outputName: "Variable", valueType: "number" }, operator: "===", right: { kind: "number", value: -1 }, then: branch, else: null, line });
    });
    const startId = nextId++;
    output.push({ kind: "get", id: startId, name: start, line });
    if (defaultIndex !== -1) {
      output.push({ kind: "numeric-if", left: { kind: "ref", id: startId, outputName: "Variable", valueType: "number" }, operator: "===", right: { kind: "number", value: -1 },
        then: [{ kind: "set", name: start, value: { kind: "number", value: defaultIndex }, line }], else: null, line });
    }
    const indexId = nextId++;
    output.push({ kind: "get", id: indexId, name: start, line });
    const indexRef: ScalarValue = { kind: "ref", id: indexId, outputName: "Variable", valueType: "number" };
    const bodies: IRNode[] = [];
    node.caseBlock.clauses.forEach((clause, index) => {
      let body = statements(clause.statements, scopes, frame, loop, broken, scope);
      body = whenFalse(broken, body, position(clause).line);
      if (loop) body = whenFalse(loop.skip, body, line);
      if (frame) body = whenFalse(frame.done, body, line);
      bodies.push({ kind: "numeric-if", left: indexRef, operator: "<=", right: { kind: "number", value: index }, then: body, else: null, line: position(clause).line });
    });
    output.push({ kind: "numeric-if", left: indexRef, operator: ">=", right: { kind: "number", value: 0 }, then: bodies, else: null, line });
    return output;
  }
  function predeclare(nodes: readonly ts.Statement[], scope: Scope): void {
    for (const statement of nodes) {
      if (!ts.isVariableStatement(statement)) continue;
      for (const d of statement.declarationList.declarations) declarePattern(d.name, scope);
    }
  }
  function block(node: ts.Statement, scopes: Scope[], frame?: FunctionFrame, loop?: LoopFrame, switchBreak?: string): IRNode[] {
    if (!ts.isBlock(node)) fail("Use braces around each branch or loop body.", node);
    return statements(node.statements, scopes, frame, loop, switchBreak);
  }
  function statements(nodes: readonly ts.Statement[], scopes: Scope[], frame?: FunctionFrame, loop?: LoopFrame, switchBreak?: string, sharedScope?: Scope): IRNode[] {
    const scope: Scope = sharedScope ?? new Map();
    if (!sharedScope) {
      mutable.set(scope, new Map());
      predeclare(nodes, scope);
    }
    const nested = [...scopes, scope];
    const root: IRNode[] = [];
    let output = root;
    for (const statement of nodes) {
      if (isTypeDeclaration(statement)) continue;
      if (ts.isVariableStatement(statement)) {
        if (!(statement.declarationList.flags & (ts.NodeFlags.Const | ts.NodeFlags.Let)) || statement.modifiers?.length) fail("Only const and let declarations are supported.", statement);
        for (const d of statement.declarationList.declarations) {
          if (!d.initializer) fail("A const needs a value.", d);
          const initial = value(d.initializer, nested, output);
          bindPattern(d.name, initial, scope, !!(statement.declarationList.flags & ts.NodeFlags.Let), output, position(d).line);
        }
      } else if (ts.isExpressionStatement(statement)) {
        if (!assignment(statement.expression, nested, output)) call(statement.expression, nested, output, false);
      } else if (ts.isBlock(statement)) {
        output.push(...block(statement, nested, frame, loop, switchBreak));
      } else if (ts.isSwitchStatement(statement)) {
        output.push(...switchStatement(statement, nested, frame, loop));
      } else if (ts.isForOfStatement(statement)) {
        if (statement.awaitModifier) fail("for await…of is not supported; use for…of.", statement);
        const init = statement.initializer;
        if (!ts.isVariableDeclarationList(init) || !(init.flags & ts.NodeFlags.Const) || init.declarations.length !== 1) {
          fail("Use for (const item of items).", init);
        }
        const declaration = init.declarations[0];
        if (declaration.initializer) fail("The loop binding must be a const binding without an initializer.", declaration);
        // The binding is in its temporal dead zone even in the iterable expression.
        const loopScope: Scope = new Map();
        declarePattern(declaration.name, loopScope);
        const loopScopes = [...nested, loopScope];
        const input = value(statement.expression, loopScopes, output);
        if (input.kind !== "list-ref") fail("for…of requires a list of text values or typed JSON objects.", statement.expression);
        const id = nextId++;
        const listType = jsonTypes.get(input.id);
        const item: Value = listType
          ? typedRef(checker.getIndexTypeOfType(listType, ts.IndexKind.Number)!, id, "Repeat Item", declaration)
          : { kind: "ref", id, outputName: "Repeat Item" };
        const bindings: IRNode[] = [];
        bindPattern(declaration.name, item, loopScope, false, bindings, position(declaration).line);
        const line = position(statement).line;
        const innerLoop: LoopFrame | undefined = hasLoopJump(statement.statement) ? {
          skip: `ts_${nextId++}_skip`,
          ...(hasLoopJump(statement.statement, ts.SyntaxKind.BreakStatement) ? { broken: `ts_${nextId++}_break` } : {}),
        } : undefined;
        if (innerLoop?.broken) output.push({ kind: "set", name: innerLoop.broken, value: { kind: "boolean", value: false }, line });
        let body = [...bindings, ...block(statement.statement, loopScopes, frame, innerLoop)];
        if (innerLoop) {
          body.unshift({ kind: "set", name: innerLoop.skip, value: { kind: "boolean", value: false }, line });
          if (innerLoop.broken) body = whenFalse(innerLoop.broken, body, line);
        }
        if (frame && hasLocalReturn(statement.statement)) body = whenFalse(frame.done, body, line);
        output.push({ kind: "repeat", id, input, body, line });
      } else if (ts.isIfStatement(statement)) {
        output.push(...condition(statement.expression, nested,
          () => block(statement.thenStatement, nested, frame, loop, switchBreak),
          () => statement.elseStatement ? ts.isIfStatement(statement.elseStatement)
            ? block(ts.factory.createBlock([statement.elseStatement]), nested, frame, loop, switchBreak)
            : block(statement.elseStatement, nested, frame, loop, switchBreak) : []));
      } else if (ts.isBreakStatement(statement) || ts.isContinueStatement(statement)) {
        if (statement.label) fail("Labeled break/continue is not supported yet.", statement);
        if (ts.isBreakStatement(statement) && switchBreak) {
          output.push({ kind: "set", name: switchBreak, value: { kind: "boolean", value: true }, line: position(statement).line });
        } else {
          if (!loop) fail("break/continue requires an enclosing supported loop (or switch for break) in the same function.", statement);
          if (ts.isBreakStatement(statement)) {
            if (!loop.broken) fail("Missing break target.", statement);
            output.push({ kind: "set", name: loop.broken, value: { kind: "boolean", value: true }, line: position(statement).line });
          }
          output.push({ kind: "set", name: loop.skip, value: { kind: "boolean", value: true }, line: position(statement).line });
        }
      } else if (ts.isReturnStatement(statement)) {
        if (frame) {
          if (statement.expression) {
            if (frame.result) output.push({ kind: "set", name: frame.result, value: value(statement.expression, nested, output), line: position(statement).line });
            else if (checker.getAwaitedType(checker.getTypeAtLocation(statement.expression))!.flags & ts.TypeFlags.Void) call(unwrap(statement.expression), nested, output, false);
            else value(statement.expression, nested, output); // Retain side effects even when the result is ignored.
          } else if (frame.result) fail("A value-returning helper must return a value on each return path.", statement);
          output.push({ kind: "set", name: frame.done, value: { kind: "boolean", value: true }, line: position(statement).line });
        } else {
          output.push({ kind: "return", value: statement.expression ? value(statement.expression, nested, output) : undefined, line: position(statement).line });
        }
      } else {
        fail(`Unsupported statement: ${ts.SyntaxKind[statement.kind]}.`, statement);
      }
      const loopJump = loop && (hasLoopJump(statement, ts.SyntaxKind.ContinueStatement) || !switchBreak && hasLoopJump(statement, ts.SyntaxKind.BreakStatement));
      const switchJump = switchBreak && hasLoopJump(statement, ts.SyntaxKind.BreakStatement);
      if ((frame && hasLocalReturn(statement) || loopJump || switchJump) && statement !== nodes.at(-1)) {
        const tail: IRNode[] = [];
        let guarded = loopJump ? whenFalse(loop!.skip, tail, position(statement).line) : tail;
        if (switchJump) guarded = whenFalse(switchBreak!, guarded, position(statement).line);
        if (frame && hasLocalReturn(statement)) guarded = whenFalse(frame.done, guarded, position(statement).line);
        output.push(...guarded);
        output = tail;
      }
    }
    return root;
  }
  const ir = block(entry.body, []);
  if (!ir.length) fail("The shortcut must contain at least one action.", entry);
  if (!isJavaScript) checkDiagnostics(ts.getPreEmitDiagnostics(program));
  return { ir, ...emitWorkflow(ir, { name, settings }) };
}
