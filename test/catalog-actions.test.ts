import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import ts from "typescript";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { compile } from "../src/compiler.js";
import { readCatalog } from "../src/catalog.js";
import { workflowToTypeScript } from "../src/importer.js";

const source = (body: string, imports = "actions, native, raw, text, attachment, showResult, askNumber, input") => `import { ${imports} } from "@js-shortcuts/ios";
export default async function main() { ${body} }`;
function normalize(value: unknown, ids = new Map<string, string>()): unknown {
  if (Array.isArray(value)) return value.map(v => normalize(v, ids));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, normalize(v, ids)]));
  if (typeof value === "string" && /^[0-9A-F]{8}(?:-[0-9A-F]{4}){3}-[0-9A-F]{12}$/.test(value)) {
    if (!ids.has(value)) ids.set(value, `ID-${ids.size + 1}`);
    return ids.get(value);
  }
  return value;
}

test("every catalog identifier and parameter key compiles through the checked action API", () => {
  const catalog = readCatalog();
  // Values here are compilation probes, not runnable action configurations.
  const parameters = catalog.actions.map(a => Object.fromEntries(a.parameters.map(p => [p.key, "metadata probe"])));
  const body = catalog.actions.map((a, i) => `await actions[${JSON.stringify(a.id)}](${JSON.stringify(parameters[i])});`).join("\n");
  const emitted = compile(source(body)).workflow.WFWorkflowActions;
  assert.equal(emitted.length, catalog.actions.length);
  for (const [i, action] of emitted.entries()) {
    assert.equal(action.WFWorkflowActionIdentifier, catalog.actions[i].id);
    const { UUID, ...values } = action.WFWorkflowActionParameters;
    assert.equal(typeof UUID, "string");
    assert.deepEqual(values, parameters[i]);
  }
});

test("catalog and native calls emit equivalent typed outputs, encodings and source locations", () => {
  const body = `const n = await askNumber("N");
    const value = await actions["is.workflow.actions.gettext"]<string>({ WFTextActionText: text(\`N: \${n}\`) });
    await actions["is.workflow.actions.showresult"]({ Text: text(value) });`;
  const checked = compile(source(body));
  const unchecked = compile(source(body.replace(/actions\["([^"]+)"\](<[^>]+>)?\(/g, 'native$2("$1", ')));
  assert.deepEqual(normalize(checked), normalize(unchecked));
});

test("catalog import aliases, typed objects and list outputs compose with the compiler", () => {
  assert.doesNotThrow(() => compile(source(`
    const d = await catalog["is.workflow.actions.detect.dictionary"]<{ n: number; xs: string[] }>({ WFInput: "{}" });
    for (const x of d.xs) { await showResult(x); } await showResult(d.n);
    const b = await catalog["is.workflow.actions.number"]<boolean>({ WFNumberActionNumber: 1 });
    if (b) { await showResult("yes"); }
    const xs = await catalog["is.workflow.actions.text.split"]<string[]>({ text: "a,b" });
    await showResult(xs[0]);`, "actions as catalog, showResult")));
});

test("raw catalog parameters retain exact export data and can exceed metadata keys", () => {
  const original = { UUID: "EXPORTED-ID", FutureNativeParameter: { Nested: [1, true, "a"] } };
  const compiled = compile(source(`await actions["is.workflow.actions.gettext"](raw(${JSON.stringify(original)}));`));
  assert.deepEqual(compiled.workflow.WFWorkflowActions[0].WFWorkflowActionParameters, original);
  assert.deepEqual(compile(workflowToTypeScript(compiled.workflow)).workflow, compiled.workflow);
});

test("catalog calls default to opaque content that can be attached to other actions", () => {
  const compiled = compile(source(`const file = await actions["is.workflow.actions.makepdf"]({ WFInput: "hello" });
    await actions["is.workflow.actions.previewdocument"]({ WFInput: attachment(file) });`));
  const [producer, consumer] = compiled.workflow.WFWorkflowActions;
  const input = consumer.WFWorkflowActionParameters.WFInput as any;
  assert.equal(input.Value.OutputUUID, producer.WFWorkflowActionParameters.UUID);
});

test("native escape hatch still accepts third-party identifiers and unknown parameter keys", () => {
  assert.doesNotThrow(() => compile(source('await native("com.example.ThirdPartyAction", { UnlistedParameter: 1 });')));
});

test("catalog example uses the same serialization path as native and survives import", () => {
  const code = readFileSync(new URL("../../examples/catalog-actions.ts", import.meta.url), "utf8");
  const compiled = compile(code);
  assert.deepEqual(compile(workflowToTypeScript(compiled.workflow)).workflow, compiled.workflow);
  assert.deepEqual(compiled.workflow.WFWorkflowActions.map(a => a.WFWorkflowActionIdentifier), ["gettext", "number", "math", "showresult", "exit"].map(id => `is.workflow.actions.${id}`));
});

test("catalog calls with native fallback preserve all device-verified workflow fixtures exactly", () => {
  const folder = new URL("../../test/fixtures/", import.meta.url);
  const names = readdirSync(folder).filter(name => /^ios26-.*-workflow\.json$/.test(name));
  const known = new Set(readCatalog().actions.map(a => a.id));
  assert.ok(names.length >= 10);
  for (const name of names) {
    const workflow = JSON.parse(readFileSync(new URL(name, folder), "utf8"));
    let converted = 0;
    const code = workflowToTypeScript(workflow).replace("{ native,", "{ actions, native,")
      .replace(/native\("([^"]+)", /g, (original, identifier: string) => {
        if (!known.has(identifier)) return original;
        converted++;
        return `actions[${JSON.stringify(identifier)}](`;
      });
    assert.ok(converted > 0, name);
    assert.deepEqual(compile(code).workflow, workflow, name);
  }
});

for (const [body, error] of [
  ['await actions["is.workflow.actions.gettext"]({ Typo: 1 });', /Unknown catalog parameter 'Typo'/],
  ['await actions["com.example.Unlisted"]({});', /Unknown catalog action/],
  ['const id = "is.workflow.actions.gettext"; await actions[id]({});', /literal action identifier/],
  ['await actions["is.workflow.actions.gettext"]();', /one parameters object/],
  ['await actions["is.workflow.actions.gettext"]({}, {});', /one parameters object/],
  ['await actions["is.workflow.actions.gettext"](raw(3));', /parameters must be an object/],
  ['const p = { WFTextActionText: "hello" }; await actions["is.workflow.actions.gettext"](p);', /parameters must be an object/],
  ['const actions = input<{ x: string }>(); await actions["is.workflow.actions.gettext"]({});', /Only imported Shortcuts/],
  ['{ await actions["is.workflow.actions.gettext"]({}); const actions = 1; }', /Only imported Shortcuts/],
  ['actions["is.workflow.actions.gettext"]({});', /await action/],
  ['await actions["is.workflow.actions.gettext"]?.({});', /Optional catalog/],
  ['const n: number = await actions["is.workflow.actions.gettext"]<string>({});', /TS2322/],
  ['const action = actions["is.workflow.actions.gettext"];', /Unknown variable/],
  ['await actions["is.workflow.actions.gettext"]({ UUID: "same" }); await actions["is.workflow.actions.gettext"]({ UUID: "same" });', /Duplicate native action UUID/],
] as const) {
  test(`rejects invalid catalog use: ${body}`, () => assert.throws(() => compile(source(body)), error));
}

test("catalog validation also catches unknown parameters in JavaScript input", () => {
  assert.throws(() => compile(source('await actions["is.workflow.actions.gettext"]({ Typo: 1 });'), { filename: "example.js" }), /Unknown catalog parameter/);
});

test("type-only catalog imports cannot be used to invoke native actions", () => {
  assert.throws(() => compile(source('await actions["is.workflow.actions.gettext"]({});', "type actions")), /Only imported Shortcuts/);
});

function completions(code: string): string[] {
  const filename = resolve("catalog-editor-test.ts");
  const api = fileURLToPath(new URL("../../api/ios.d.ts", import.meta.url));
  const position = code.indexOf("/*cursor*/");
  assert.ok(position >= 0);
  code = code.replace("/*cursor*/", "");
  const options: ts.CompilerOptions = { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, strict: true, types: [] };
  const service = ts.createLanguageService({
    getCompilationSettings: () => options,
    getScriptFileNames: () => [filename, api],
    getScriptVersion: () => "0",
    getScriptSnapshot: path => {
      const content = path === filename ? code : ts.sys.readFile(path);
      return content === undefined ? undefined : ts.ScriptSnapshot.fromString(content);
    },
    getCurrentDirectory: () => process.cwd(),
    getDefaultLibFileName: options => ts.getDefaultLibFilePath(options),
    fileExists: ts.sys.fileExists,
    readFile: ts.sys.readFile,
    readDirectory: ts.sys.readDirectory,
  });
  try { return service.getCompletionsAtPosition(filename, position, {})?.entries.map(e => e.name) ?? []; }
  finally { service.dispose(); }
}

test("TypeScript editor suggests catalog identifiers and action-specific parameter keys", () => {
  const identifiers = completions(source('await actions["/*cursor*/"]({});'));
  for (const action of readCatalog().actions) assert.ok(identifiers.includes(action.id), `Missing action completion ${action.id}`);
  const keys = completions(source('await actions["is.workflow.actions.gettext"]({ /*cursor*/ });'));
  assert.ok(keys.includes("WFTextActionText"));
  assert.ok(keys.includes("UUID"));
  assert.ok(!keys.includes("WFMathOperand"));
});
