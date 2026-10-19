import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { compile } from "../src/compiler.js";
import { evaluate } from "./support/evaluate.js";

const source = (body: string, helpers = "") => `import { showResult } from "@js-shortcuts/ios"; ${helpers}
export default async function main() { ${body} }`;
const zero = (n: number) => n === 0 ? 0 : n; // Native number content has no signed zero contract.

for (const method of ['floor', 'ceil', 'trunc', 'round', 'abs', 'sign'] as const) {
  test(`Math.${method} agrees with JS for finite boundary cases apart from signed zero`, () => {
    const values = [-4503599627370495.5, -2.5, -2.1, -1.5, -0.999, -0.5000000000000001, -0.5, -0.49999999999999994, -0.1, 0, 0.1, 0.49999999999999994, 0.5, 0.5000000000000001, 0.999, 1, 1.5, 2.5, 4503599627370495.5];
    assert.deepEqual(evaluate(source(`for (const n of ${JSON.stringify(values)}) { await showResult(Math.${method}(n)); }`)).map(v => zero(v as number)), values.map(n => zero(Math[method](n))));
  });
}

test("Math.min/max accept numeric varargs and a singleton", () => {
  assert.deepEqual(evaluate(source(`await showResult(Math.min(8, -7, 4, -7, 0)); await showResult(Math.max(-8, -7, -4)); await showResult(Math.min(9)); await showResult(Math.max(9));`)), [-7, -4, 9, 9]);
});

test("Math argument effects occur once, left to right, with previous values frozen", () => {
  assert.deepEqual(evaluate(source(`let x = 7;
    await showResult(Math.min(x, [0].reduce((acc, n) => { x = 100; return 9; }, 0)));
    await showResult(Math.max(await part(1), await part(2), await part(3)));`,
    'async function part(n: number): Promise<number> { await showResult(n); return n; }')), [7, 1, 2, 3, 3]);
  assert.deepEqual(evaluate(source('Math.pow(await part(2), await part(3)); await showResult(await Math.abs(-9));', 'async function part(n: number): Promise<number> { await showResult(n); return n; }')), [2, 3, 9]);
});

test("powers, square roots, bracket access and constant aliases compose", () => {
  assert.deepEqual(evaluate(source(`const pi = Math.PI; const root = Math["sqrt"](81);
    await showResult(Math.pow(2, 3)); await showResult(Math.pow(-2, 3)); await showResult(root);
    await showResult(Math.round(pi * 1000)); await showResult(Math.pow(256, 0.25));`)), [8, -8, 9, 3142, 4]);
  for (const name of ['E', 'PI', 'LN2', 'LN10', 'LOG2E', 'LOG10E', 'SQRT1_2', 'SQRT2'] as const) {
    assert.deepEqual(evaluate(source(`await showResult(Math.${name});`)), [Math[name]]);
  }
});

test("lexical Math objects and parameters shadow the intrinsic, including TDZ", () => {
  assert.deepEqual(evaluate(source(`{ const Math = { PI: 7 }; await showResult(Math.PI); }
    await showResult(read({ PI: 9 })); await showResult(Math.round(Math.PI));`,
    'function read(Math: { PI: number }): number { return Math.PI; }')), [7, 9, 3]);
  assert.throws(() => compile(source('await showResult(Math.PI); const Math = { PI: 1 };')), /before its declaration/);
  assert.throws(() => compile(source('const Math = { abs: 7 }; await showResult(Math.abs(-1));')), /Unsupported expression: CallExpression/);
  assert.throws(() => compile(`import { askNumber as Math, showResult } from "@js-shortcuts/ios"; export default async function main() { await showResult(Math.PI); }`), /Unknown variable|Property access|Unsupported/);
  assert.throws(() => compile(source('await showResult(Math.PI);', 'function Math(): number { return 2; }')), /Unknown variable|Unsupported/);
});

test("native example and array composition produce the intended finite results", () => {
  const code = readFileSync(new URL('../../examples/math-test.ts', import.meta.url), 'utf8');
  assert.deepEqual(evaluate(code), [
    'Negative: -2.5:-3,-2,-2,-2;-2.1:-3,-2,-2,-2;-1.5:-2,-1,-1,-1;-0.6:-1,0,0,-1;-0.5:-1,0,0,0;-0.1:-1,0,0,0;0:0,0,0,0;',
    'Positive: 0.1:0,1,0,0;0.5:0,1,0,1;0.6:0,1,0,1;1.5:1,2,1,2;2.5:2,3,2,3;3:3,3,3,3;',
    'Signs: 2.5/-1;0.1/-1;0/0;0.1/1;2.5/1;', 'Extremes: -7/5/9', 'Powers: 8/-8/9/4',
    'Constants: 3142/2718/693/2303/1443/434/707/1414', 'Arrays: 1/-2/3; max 3',
  ]);
});

for (const [body, error] of [
  ['Math.min();', /at least one number/], ['Math.max();', /at least one number/],
  ['Math.abs();', /expects one number/], ['Math.pow(2);', /expects two numbers/],
  ['Math.abs("2");', /Expected a number/], ['Math.min(1, true);', /Expected a number/],
  ['Math.max(...[1, 2]);', /spreads/], ['Math.sqrt(-1);', /NaN is unsupported/],
  ['Math.random();', /not supported/], ['Math?.abs(1);', /Optional Math access/],
  ['Math.abs?.(1);', /Optional Math calls/], ['const m = "abs"; Math[m](1);', /static member name/],
  ['const fn = Math.abs; fn(-1);', /not a supported numeric constant/],
] as const) test(`reject unsupported Math form: ${body}`, () => assert.throws(() => compile(source(body)), error));
