import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { compile } from "../src/compiler.js";
import { memoryHost } from "../src/hosts/memory-host.js";
import { readCatalog } from "../src/catalog.js";
import { workflowBlocks, type Block, type Part } from "../src/visualizer/blocks.js";
import { createVisualizer } from "../src/visualizer/browser.js";

const blocks = (body: string) => {
  const { workflow, sourceMap } = compile(`import { askText, showResult, menu } from "@js-shortcuts/ios";
export default async function main() {
${body}
}`);
  return workflowBlocks(workflow, sourceMap, readCatalog().actions);
};
const show = (parts: Part[]) => parts.map(part => part.kind === "token" ? `[${part.text}]` : part.text).join("");
const outline = (items: Block[]) => items.map(block => `${"  ".repeat(block.depth)}${block.title}`);

test("control flow nests between start, middle and end actions", () => {
  const result = blocks(`const name = await askText("Name?");
if (name === "Ada") { await showResult("Hi"); } else { await showResult("Who?"); }
for (const n of [1, 2]) { await showResult(n); }`);
  assert.deepEqual(result.map(block => block.role).filter(role => role !== "action"), ["start", "middle", "end", "start", "end"]);
  const outer = result.filter(block => block.depth === 0).map(block => block.title);
  assert.ok(outer.includes("If") && outer.includes("Otherwise") && outer.includes("End If"));
  assert.ok(outer.includes("Repeat with Each") && outer.includes("End Repeat"));
  assert.ok(result.filter(block => block.title === "Show Content").every(block => block.depth === 1));
});

test("tokens resolve to their producing action and blocks map to source lines", () => {
  const result = blocks(`const name = await askText("Name?");
await showResult(\`Hello \${name}!\`);`);
  const ask = result.find(block => block.identifier === "is.workflow.actions.ask")!;
  assert.equal(show(ask.summary), "for Text with Name?");
  assert.equal(ask.output, "Provided Input");
  assert.equal(ask.line, 3);
  const shown = result.find(block => block.identifier === "is.workflow.actions.showresult")!;
  assert.equal(show(shown.summary), "Hello [Provided Input]!");
  const token = shown.summary.find(part => part.kind === "token");
  assert.equal(token?.kind === "token" && token.source, ask.index);
  assert.equal(shown.line, 4);
});

test("menus show their cases and unknown parameters fall back to catalog names", () => {
  const result = blocks(`await menu("Pick", { One: async () => { await showResult(1); }, Two: async () => {} });`);
  assert.deepEqual(outline(result).filter(line => !line.includes("Number") && !line.includes("Show")),
    ["Choose from Menu", "One", "Two", "End Menu"]);
  assert.equal(show(result[0].summary), "with Pick");
  const items = result[0].details.find(detail => detail.value.length);
  assert.ok(items && show(items.value).includes("One"));
});

// The files scripts/build-site.mjs ships: TypeScript libs and the API declarations, apps included.
function siteFiles() {
  const libDir = dirname(createRequire(import.meta.url).resolve("typescript/lib/lib.es2023.d.ts"));
  const files: Record<string, string> = {};
  for (const name of readdirSync(libDir).filter(file => /^lib\..*\.d\.ts$/.test(file))) files[`/lib/${name}`] = readFileSync(join(libDir, name), "utf8");
  for (const dir of ["api/", "api/apps/"]) {
    const api = new URL(`../../${dir}`, import.meta.url);
    for (const name of readdirSync(api).filter(file => file.endsWith(".d.ts"))) files[`/${dir}${name}`] = readFileSync(new URL(name, api), "utf8");
  }
  return files;
}

test("the in-memory browser host compiles like the Node host", () => {
  const files = siteFiles();
  const host = memoryHost(files, readCatalog());
  // UUIDs are random per compilation; compare everything else.
  const normalize = (value: unknown) => JSON.stringify(value).replace(/[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}/g, "UUID");
  for (const example of ["control-flow-test.ts", "catalog-actions.ts", "http-json.ts", "object-spread-test.ts", "array-composition-test.ts", "array-copy-test.ts", "array-join-test.ts", "array-offset-test.ts", "text-replace-test.ts", "text-replace-all-test.ts", "text-position-test.ts", "text-predicate-position-test.ts", "counted-loop-test.ts", "while-loop-test.ts"]) {
    const source = readFileSync(new URL(`../../examples/${example}`, import.meta.url), "utf8");
    assert.equal(normalize(compile(source, { host }).workflow), normalize(compile(source).workflow), example);
  }
  // Type checking uses the in-memory lib and API declarations too.
  assert.throws(() => compile(`import { askText } from "@js-shortcuts/ios";
export default async function main() { await askText(42); }`, { host }), /TS2345/);
});

test("the browser visualizer compiles app examples with the manifests they reference", () => {
  const appsDir = new URL("../../api/apps/", import.meta.url);
  const apps = Object.fromEntries(readdirSync(appsDir).filter(file => file.endsWith(".json"))
    .map(file => [file.replace(/\.json$/, ""), JSON.parse(readFileSync(new URL(file, appsDir), "utf8"))]));
  const visualize = createVisualizer({ files: siteFiles(), catalog: readCatalog(), apps, examples: {} });
  const examples = new URL("../../examples/apps/", import.meta.url);
  for (const example of readdirSync(examples).filter(file => file.endsWith(".ts"))) {
    const result = visualize(readFileSync(new URL(example, examples), "utf8"), example);
    assert.ok(result.ok, `${example}: ${!result.ok && result.error}`);
    assert.ok(result.blocks.length > 0, example);
  }
});
