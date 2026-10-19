import { test } from "node:test";
import assert from "node:assert/strict";
import { compile } from "../src/compiler.js";
import { evaluate } from "./support/evaluate.js";
import type { PlistDictionary } from "../src/model.js";

const source = (body: string, helpers = "") => `import { showResult, askNumber, getJson, native, attachment, dictionary, quickLook, getDictionaryValue } from "@js-shortcuts/ios";
${helpers}
export default async function main() { ${body} }`;

test("object literals contain helper-returned objects and transformed lists", () => {
  assert.deepEqual(evaluate(source(`const payload = { person: person(7), tags: [2, 3].map(n => n * 2), active: true };
    const envelope = { payload, version: 1 };
    await showResult(envelope.payload.person.n); await showResult(envelope.payload.tags[1]);
    if (envelope.payload.active) { await showResult(envelope.version); }`,
    'function person(n: number): { n: number } { return { n }; }')), [7, 6, 1]);
});

test("empty, singleton and multi-item lists retain list types and values in constructed objects", () => {
  assert.deepEqual(evaluate(source(`for (const n of [0, 1, 2]) {
    const obj = { items: items(n), empty: empty() };
    await showResult(obj.items.length); if (n > 0) { await showResult(obj.items[0]); }
  }`, `function items(n: number): number[] { if (n === 0) { return []; } if (n === 1) { return [42]; } return [2, 4]; }
    function empty(): {} { return {}; }`)), [0, 1, 42, 2, 2]);
});

test("dynamic-only object entries need no preceding fixed property", () => {
  assert.deepEqual(evaluate(source('const obj = { a: make(2), b: make(3) }; await showResult(obj.a.n + obj.b.n);',
    'function make(n: number): { n: number } { return { n }; }')), [5]);
});

test("object literal fields evaluate once in source order before composition", () => {
  assert.deepEqual(evaluate(source(`const obj = { a: await field("a"), b: await field("b"), n: await askNumber("n") };
    await showResult(obj.a.name); await showResult(obj.b.name); await showResult(obj.n);`,
    'async function field(name: string): Promise<{ name: string }> { await showResult(name); return { name }; }'), [9]), ["a", "b", "a", "b", 9]);
});

test("captured field snapshots precede later field effects", () => {
  assert.deepEqual(evaluate(source(`let current = { n: 1 };
    const obj = { before: current, after: [2].reduce((acc, n) => { current = { n: 9 }; return { n }; }, { n: 0 }) };
    await showResult(obj.before.n); await showResult(obj.after.n); await showResult(current.n);`)), [1, 2, 9]);
});

test("literal branches and repeated calls create independent object results", () => {
  assert.deepEqual(evaluate(source(`for (const n of [1, 2]) { const obj = wrap(n); await showResult(obj.child.n); }`,
    'function wrap(n: number): { child: { n: number } } { const child = n > 1 ? { n: 7 } : { n: 3 }; return { child }; }')), [3, 7]);
});

test("mapping objects can include captured dynamic dictionaries", () => {
  assert.deepEqual(evaluate(source(`const meta = make(); const rows = [1, 2].map(n => ({ n, meta }));
    await showResult(rows[1].n); await showResult(rows[0].meta.title);`,
    'function make(): { title: string } { return { title: "Ada" }; }')), [2, "Ada"]);
});

test("dynamic dictionary field names retain quotes, escapes and Unicode", () => {
  const key = 'quote"\\\n😀';
  assert.deepEqual(evaluate(source(`const obj = { ${JSON.stringify(key)}: make() };
    await showResult(obj[${JSON.stringify(key)}].n);`, 'function make(): { n: number } { return { n: 8 }; }')), [8]);
  const workflow = compile(source(`const obj = { ${JSON.stringify(key)}: make() }; await quickLook(obj);`,
    'function make(): {} { return {}; }')).workflow;
  assert.ok(workflow.WFWorkflowActions.some(a => JSON.stringify(a.WFWorkflowActionParameters).includes(JSON.stringify(JSON.stringify(key) + ':').slice(1, -1))));
});

test("native/API output dictionaries compile without running source or fetching input", () => {
  const { workflow } = compile(source('const data = await getJson<{ name: string }>("https://offline.invalid"); const obj = { data }; await quickLook(obj);'));
  assert.equal(workflow.WFWorkflowActions.filter(a => a.WFWorkflowActionIdentifier.endsWith(".downloadurl")).length, 1);
  assert.ok(workflow.WFWorkflowActions.some(a => a.WFWorkflowActionIdentifier.endsWith(".detect.dictionary")));
});

test("attachment of a constructed dictionary references the final parsed object", () => {
  const actions = compile(source('const obj = { child: make() }; await native("com.example.Use", { payload: attachment(obj) });',
    'function make(): {} { return {}; }')).workflow.WFWorkflowActions;
  const parsed = actions.findLast(a => a.WFWorkflowActionIdentifier.endsWith(".detect.dictionary"))!;
  const payload = actions.at(-1)!.WFWorkflowActionParameters.payload as any;
  assert.equal(payload.Value.OutputUUID, parsed.WFWorkflowActionParameters.UUID);
  assert.equal(payload.WFSerializationType, "WFTextTokenAttachment");
});

test("native JSON assembly keeps groups balanced, references defined outputs and maps every action to source", () => {
  const compilation = compile(source('const obj = { xs: values(), nested: { xs: values() } }; await quickLook(obj);',
    'function values(): number[] { return [1]; }'));
  const known = new Set<unknown>(); const stack: unknown[] = [];
  function inspect(value: unknown): void {
    if (Array.isArray(value)) { value.forEach(inspect); return; }
    if (!value || typeof value !== "object") return;
    const p = value as PlistDictionary;
    if (p.Type === "ActionOutput") assert.ok(known.has(p.OutputUUID), `Unknown reference ${p.OutputUUID}`);
    Object.values(p).forEach(inspect);
  }
  for (const action of compilation.workflow.WFWorkflowActions) {
    const p = action.WFWorkflowActionParameters;
    inspect(p);
    if (p.UUID) known.add(p.UUID);
    if (p.WFControlFlowMode === 0) stack.push(p.GroupingIdentifier);
    if (p.WFControlFlowMode === 1) assert.equal(p.GroupingIdentifier, stack.at(-1));
    if (p.WFControlFlowMode === 2) assert.equal(p.GroupingIdentifier, stack.pop());
  }
  assert.deepEqual(stack, []);
  assert.equal(compilation.sourceMap.length, compilation.workflow.WFWorkflowActions.length);
  compilation.sourceMap.forEach((s, i) => { assert.equal(s.actionIndex, i); assert.ok(s.line > 0); });
});

test("JSON extraction preserves arbitrary JSON values and anchored closing braces", () => {
  const actions = compile(source('const obj = { xs: values() }; await quickLook(obj);',
    'function values(): number[] { return [1]; }')).workflow.WFWorkflowActions;
  const replaces = actions.filter(a => a.WFWorkflowActionIdentifier.endsWith(".text.replace"));
  const extractor = replaces.find(a => String(a.WFWorkflowActionParameters.WFReplaceTextFind).includes('__value'))!;
  const regex = new RegExp(String(extractor.WFWorkflowActionParameters.WFReplaceTextFind).replace('\\A', '^').replace('\\z', '$'));
  for (const input of [[], [1, 2], 42, false, '', '"\\\n}[]😀', { child: { '__value': ['x', true] } }]) {
    const json = JSON.stringify({ __value: input });
    assert.deepEqual(JSON.parse(json.replace(regex, String(extractor.WFWorkflowActionParameters.WFReplaceTextReplace))), input);
  }
});

test("static literal containers keep the existing field-state backend", () => {
  const actions = compile(source('const obj = { child: { n: 2 }, xs: [1, 2] }; await quickLook(obj);')).workflow.WFWorkflowActions;
  assert.ok(!actions.some(a => a.WFWorkflowActionIdentifier.endsWith(".detect.dictionary")));
});

test("dictionary field-state helper rejects composed dynamic objects with an actionable diagnostic", () => {
  assert.throws(() => compile(source('const obj = { child: make() }; await native("com.example.Use", { payload: dictionary(obj) });',
    'function make(): {} { return {}; }')), /inline-encodable.*attachment/);
});

test("runtime matrices retain nesting metadata through parameters, returns and variable reads and are rejected", () => {
  for (const body of [
    'const obj = { xs: matrix() };',
    'let xs = matrix(); const obj = { xs };',
    'const obj = wrap(matrix());',
    'const data = { xs: [[1, 2]] }; const obj = { xs: data.xs };',
  ]) {
    assert.throws(() => compile(source(body, `function matrix(): number[][] { return [[1, 2]]; }
      function wrap(xs: number[][]): { xs: number[][] } { return { xs }; }`)), /runtime nested arrays/);
  }
});

test("mixed and recursive array nesting cannot silently enter the one-dimensional serializer", () => {
  assert.throws(() => compile(source('const obj = { xs: mixed() };',
    'function mixed(): (number | number[])[] { return [1, [2]]; }')), /runtime nested arrays/);
  assert.throws(() => compile(source('const xs = await native<Nested>("com.example.Data", {}); const obj = { xs };',
    'type Nested = Nested[];')), /runtime nested arrays/);
});
