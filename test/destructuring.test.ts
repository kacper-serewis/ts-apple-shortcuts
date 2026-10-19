import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { compile } from "../src/compiler.js";
import { evaluate } from "./support/evaluate.js";

const source = (body: string, helpers = "") => `import { showResult, askNumber, getJson, input } from "@js-shortcuts/ios";
  ${helpers}
  export default async function main() { ${body} }`;

function normalize(value: unknown, ids = new Map<string, string>()): unknown {
  if (Array.isArray(value)) return value.map(item => normalize(item, ids));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, normalize(item, ids)]));
  if (typeof value === "string" && /^[0-9A-F]{8}(?:-[0-9A-F]{4}){3}-[0-9A-F]{12}$/.test(value)) {
    if (!ids.has(value)) ids.set(value, `ID-${ids.size + 1}`);
    return ids.get(value);
  }
  return value;
}

test("object/array destructuring works in declarations, helper parameters, loops and map callbacks", () => {
  const code = readFileSync(new URL("../../examples/destructuring.ts", import.meta.url), "utf8");
  assert.deepEqual(evaluate(code.replace("  return;\n}", "}")), ["Ada: 7/9, Amsterdam", "Ada! uit Amsterdam", "Paar: 16", "Let: 4/3", "Kacper: 9", "0:Ada/7"]);
});

test("destructuring emits the same native actions as explicit dictionary and list reads", () => {
  const base = 'const profile = { name: "Ada", details: { city: "Amsterdam" }, scores: [7, 9] };';
  const destructured = source(`${base} const { name, details: { city }, scores: [a, b] } = profile; await showResult(\`\${name}/\${city}/\${a}/\${b}\`);`);
  const explicit = source(`${base} const name = profile.name; const details = profile.details; const city = details.city; const scores = profile.scores; const a = scores[0]; const b = scores[1]; await showResult(\`\${name}/\${city}/\${a}/\${b}\`);`);
  assert.deepEqual(normalize(compile(destructured).workflow), normalize(compile(explicit).workflow));
});

test("a destructured initializer is evaluated once, with each binding read in source order", () => {
  assert.deepEqual(evaluate(source(
    'const { a, b } = await values(); await showResult(a); await showResult(b);',
    'async function values(): Promise<{ a: number; b: number }> { const n = await askNumber("once"); return { a: n, b: n + 1 }; }'
  ), [3]), [3, 4]);
  const ir = compile(source('const [, second] = [1, 2]; await showResult(second);')).ir;
  assert.equal(ir.filter(node => node.kind === "index").length, 1);
  assert.deepEqual(evaluate(source('const [, second] = [1, 2]; await showResult(second);')), [2]);
});

test("let bindings can change independently while const snapshots and the original object stay unchanged", () => {
  assert.deepEqual(evaluate(source('const obj = { x: 1, y: 2 }; let { x, y: renamed } = obj; const saved = x; x += 5; renamed++; await showResult(`${saved}/${x}/${renamed}/${obj.x}/${obj.y}`);')), ["1/6/3/1/2"]);
});

test("destructured names obey lexical scope and temporal dead zones", () => {
  assert.deepEqual(evaluate(source('const n = 1; { const { n } = { n: 2 }; await showResult(n); } await showResult(n);')), [2, 1]);
  assert.throws(() => compile(source('const n = 1; { await showResult(n); const { n } = { n: 2 }; }')), /before its declaration/);
  assert.throws(() => compile(source('const [n] = [n];')), /before its declaration/);
  assert.throws(() => compile(source('const { n, nested: { n: again } } = { n: again, nested: { n: 1 } };')), /before its declaration/);
  assert.throws(() => compile(source('{ const { n } = { n: 1 }; } await showResult(n);')), /Unknown variable/);
});

test("for-of patterns are bound per iteration and compose with nested loops and continue", () => {
  assert.deepEqual(evaluate(source(`let text = "";
    for (const { name, scores: [first, second] } of [{ name: "A", scores: [1, 2] }, { name: "B", scores: [3, 4] }]) {
      if (first === 1) { continue; }
      for (const [n] of [[5], [6]]) { text += \`\${name}\${second}\${n};\`; }
    }
    await showResult(text);`)), ["B45;B46;"]);
  assert.throws(() => compile(source('const n = [{ n: 1 }]; for (const { n } of n) {}')), /before its declaration/);
});

test("tuple destructuring and constant tuple indexing preserve each element's own type", () => {
  assert.deepEqual(evaluate(source('const tuple = ["Ada", 7, true] as const; const [name, score, enabled] = tuple; if (enabled) { await showResult(`${name}:${score}`); } await showResult(tuple[1]);')), ["Ada:7", 7]);
  assert.doesNotThrow(() => compile(source('const values = input<[number, ...number[]]>(); await showResult(values[2]);')));
});

test("helper pattern parameters evaluate arguments once and isolate aliases from callers", () => {
  assert.deepEqual(evaluate(source(
    'const obj = { score: await askNumber("once") }; await showResult(bump(obj)); await showResult(obj.score);',
    'function bump({ score: points }: { score: number }): number { points += 10; return points; }'
  ), [2]), [12, 2]);
});

test("tuple helper parameters and callback patterns use declared types even for narrower literals", () => {
  assert.deepEqual(evaluate(source(
    'await showResult(label(["Ada", 7])); const empty: { score: number }[] = []; await showResult(empty.map(({ score }) => score * 2).length);',
    'function label([name, score]: readonly [string, number]): string { return `${name}:${score}`; }'
  )), ["Ada:7", 0]);
});

test("filter and reduce support destructured parameters without replacing the original items", () => {
  assert.deepEqual(evaluate(source(`const rows = [{ n: 1 }, { n: 2 }, { n: 3 }];
    const selected = rows.filter(({ n }) => { n += 10; return n >= 12; });
    const total = selected.reduce((acc, { n }) => acc + n, 0);
    await showResult(total); await showResult(selected[0].n);`)), [5, 2]);
});

test("destructuring works against typed runtime JSON without fetching during compilation", () => {
  const result = compile(source('const { title, stats: { count } } = await getJson<{ title: string; stats: { count: number } }>("https://offline.invalid"); await showResult(`${title}:${count}`);'));
  assert.deepEqual(result.ir.filter(n => n.kind === "field").map(n => n.key), ["title", "stats", "count"]);
});

for (const [body, error] of [
  ['const { x = 1 } = { x: 2 };', /Defaults and rest/],
  ['const [x, ...rest] = [1, 2];', /Defaults and rest/],
  ['const { x, ...rest } = { x: 1, y: 2 };', /Defaults and rest/],
  ['const { ["x"]: x } = { x: 1 };', /Computed property/],
  ['const { "x.y": value } = { "x.y": 1 };', /keys containing dots/],
  ['const { x } = [1, 2];', /requires a typed object/],
  ['const [x] = { x: 1 };', /requires a list/],
  ['const { missing } = { x: 1 };', /Unknown JSON field/],
  ['const { x } = input<{ x?: number }>();', /Optional JSON fields/],
  ['const [x] = input<[number?]>();', /Optional tuple/],
  ['const { x, nested: { x } } = { x: 1, nested: { x: 2 } };', /Duplicate declaration/],
  ['const { x } = { x: 1 }; x = 2;', /Only let variables/],
  ['let { x } = { x: 1 }; x = "wrong";', /preserve the variable/],
  ['let x = 0; ({ x } = { x: 1 });', /Actions must be called/],
] as const) {
  test(`rejects unsupported destructuring: ${body}`, () => assert.throws(() => compile(source(body)), error));
}

test("duplicate names across parameter patterns are rejected", () => {
  assert.throws(() => compile(source('await showResult(f({ a: 1 }, 2));', 'function f({ a: n }: { a: number }, n: number): number { return n; }')), /Duplicate parameter/);
});
