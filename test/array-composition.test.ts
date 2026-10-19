import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { compile } from "../src/compiler.js";
import { evaluate } from "./support/evaluate.js";

const source = (body: string, helpers = "") => `import { showResult, stringifyJson, parseJson, input, type NativeContent } from "@js-shortcuts/ios";
${helpers} export default async function main() { ${body} }`;

test("dynamic helper objects retain fields when put in an array", () => {
  assert.deepEqual(evaluate(source(`const data = row(); const rows = [data, row()]; await showResult(rows[0].name); await showResult(rows[1].n);`, 'function row(): { name: string; n: number } { return { name: "Ada", n: 7 }; }')), ['Ada', 7]);
  const actions = compile(source('const row = parseJson<{n:number}>(\'{"n":7}\'); const rows = [row]; await showResult(rows[0].n);')).workflow.WFWorkflowActions;
  assert.equal(actions.filter(a => a.WFWorkflowActionIdentifier.endsWith('.detect.dictionary')).length, 2);
  assert.equal(actions.filter(a => a.WFWorkflowActionIdentifier.endsWith('.list')).length, 0);
});

test("flat scalar spreads preserve order, empty segments and singleton shape", () => {
  for (const values of [[], [42], [2, 4]]) {
    assert.deepEqual(evaluate(source(`const values: number[] = ${JSON.stringify(values)}; const empty: number[] = [];
      await showResult(stringifyJson([...empty, ...values, ...empty]));
      await showResult(stringifyJson([0, ...values, 9]));
      await showResult([...values].length);`)), [JSON.stringify(values), JSON.stringify([0, ...values, 9]), values.length]);
  }
});

test("multiple object spreads keep typed fields and compose with map/reduce", () => {
  assert.deepEqual(evaluate(source(`const rows = parseJson<{n:number}[]>('[{"n":2},{"n":3}]');
    const combined = [{n:1}, ...rows, ...rows.filter(r => r.n > 2), {n:4}];
    await showResult(combined.reduce((sum, row) => sum + row.n, 0));
    await showResult(stringifyJson(combined.map(row => row.n)));`)), [13, '[1,2,3,3,4]']);
});

test("booleans, empty strings, escapes and delimiter-like strings are preserved", () => {
  const values = ['",[', '],', '', 'quote"\\\n😀'];
  assert.deepEqual(evaluate(source(`const texts = ${JSON.stringify(values)}; await showResult(stringifyJson([...texts, "last"]));
    const flags = [false]; await showResult(stringifyJson([...flags, true]));`)), [JSON.stringify([...values, 'last']), '[false,true]']);
});

test("spread source and ordinary element effects run exactly once in source order", () => {
  assert.deepEqual(evaluate(source('const all = [await item(1), ...await list(2), await item(3), ...await list(4)]; await showResult(stringifyJson(all));',
    'async function item(n: number): Promise<number> { await showResult(n); return n; } async function list(n: number): Promise<number[]> { await showResult(n); return [n]; }')), [1, 2, 3, 4, '[1,2,3,4]']);
});

test("spread references are captured before later argument reassignment", () => {
  assert.deepEqual(evaluate(source(`let values = [1,2];
    const copy = [...values, [0].reduce((acc,n) => { values = [9]; return 3; },0), ...values];
    await showResult(stringifyJson(copy)); await showResult(stringifyJson(values));`)), ['[1,2,3,9]', '[9]']);
});

test("assembled arrays can become dictionary fields and be copied again", () => {
  assert.deepEqual(evaluate(source(`const original = parseJson<{n:number}[]>('[{"n":2}]'); const assembled = [...original];
    const object = { rows: [...assembled, {n:3}], none: [...[]] };
    const copy = [...object.rows]; await showResult(copy[1].n); await showResult(object.none.length);`)), [3,0]);
});

test("readonly tuples can be spread into a new mutable array", () => {
  assert.deepEqual(evaluate(source('const tuple = [1,2] as const; const values = [...tuple,3]; await showResult(stringifyJson(values));')), ['[1,2,3]']);
});

test("native example produces every expected composition result", () => {
  const code = readFileSync(new URL('../../examples/array-composition-test.ts', import.meta.url), 'utf8');
  assert.deepEqual(evaluate(code), [
    'Object: 1/Ada/1/N', 'Rows: 3/Ada/Lin/Sam; sum 6', 'Numbers: []/[42]/[0,2,4,6]', 'Flags: [false,true]',
    'Text: ' + JSON.stringify(['",[', '],', '', 'quote"\\\n😀', 'last']), 'Nested: 3/0/0', 'Copy: [1,2]; original [9]',
  ]);
});

for (const [body, error] of [
  ['const x = [..."abc"];', /typed list/], ['const x = [...1];', /typed list/],
  ['const x = [1,,2];', /holes/], ['const x = [...[[1]]];', /flat lists/],
  ['const x = [0, ...[1], [2]];', /nested array elements/],
  ['const values = input<NativeContent[]>(); const x = [...values];', /opaque native content/],
  ['const values = input<(NativeContent | string)[]>(); const x = [...values];', /opaque native content/],
  ['const value = input<NativeContent>(); const x = [value, ...[]];', /opaque native content/],
] as const) test(`reject unsupported array composition: ${body}`, () => assert.throws(() => compile(source(body)), error));
