import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { compile } from "../src/compiler.js";
import { evaluate } from "./support/evaluate.js";

const source = (body: string, helpers = "") => `import { showResult, stringifyJson, parseJson, getDictionaryValue, input, type NativeContent } from "@js-shortcuts/ios";
${helpers} export default async function main() { ${body} }`;

test("later explicit fields and spreads override earlier values without changing the source", () => {
  assert.deepEqual(evaluate(source(`const original = { n: 1, name: "Ada", flag: false };
    const second = { n: 2, flag: true };
    const result = { ...original, ...second, name: "Lin" };
    await showResult(result.n); await showResult(result.name); await showResult(result.flag ? "Y" : "N");
    await showResult(original.n); await showResult(original.name);`)), [2,'Lin','Y',1,'Ada']);
});

test("dynamic record spreads override defaults and copy keys absent from the declared type", () => {
  assert.deepEqual(evaluate(source(`const data = parseJson<Record<string, number>>('{"n":7,"extra":42}');
    const result = { n: 0, ...data }; await showResult(result.n);
    await showResult(await getDictionaryValue<number>(result, "extra"));
    const limited = parseJson<{n:number}>('{"n":2,"secret":"kept"}');
    const copy = {...limited}; await showResult(await getDictionaryValue<string>(copy, "secret"));`)), [7,42,'kept']);
});

test("empty object spreads work alone, at either end and between fields", () => {
  assert.deepEqual(evaluate(source(`const empty = parseJson<{}>('{}');
    await showResult(stringifyJson({...empty,...{}}));
    const merged = {...empty,n:1,...empty,name:"Ada",...empty}; await showResult(merged.n); await showResult(merged.name);`)), ['{}',1,'Ada']);
});

test("spreads preserve booleans, lists and nested object fields", () => {
  assert.deepEqual(evaluate(source(`const original = parseJson<{ok:boolean;xs:number[];child:{name:string}}>('{"ok":false,"xs":[42],"child":{"name":"Ada"}}');
    const clone = {...original}; const changed = {...clone,xs:[]};
    await showResult(clone.ok ? "Y" : "N"); await showResult(stringifyJson(clone.xs));
    await showResult(changed.xs.length); await showResult(changed.child.name);`)), ['N','[42]',0,'Ada']);
});

test("ordinary fields and spread expressions run once in source order", () => {
  assert.deepEqual(evaluate(source(`const result = { a: await field(1), ...await spread(2), b: await field(3), ...await spread(4) };
    await showResult(result.a + result.b + result.n);`,
    'async function field(n:number):Promise<number>{ await showResult(n); return n; } async function spread(n:number):Promise<{n:number}>{ await showResult(n); return {n}; }')), [1,2,3,4,8]);
});

test("earlier spreads retain snapshots when later fields reassign the source", () => {
  assert.deepEqual(evaluate(source(`let base = { n: 1 };
    const result = {...base, other: [0].reduce((acc,n)=>{base={n:9};return 2;},0)};
    await showResult(result.n); await showResult(base.n); await showResult(result.other);`)), [1,9,2]);
});

test("escaped keys and delimiter-looking values survive copying", () => {
  const key = 'quote"\\\n😀', text = '},"n":999,{';
  assert.deepEqual(evaluate(source(`const base = {${JSON.stringify(key)}:${JSON.stringify(text)}}; const copy = {...base}; await showResult(copy[${JSON.stringify(key)}]);`)), [text]);
});

test("native example produces the intended merge, preservation and array results", () => {
  const code = readFileSync(new URL('../../examples/object-spread-test.ts', import.meta.url),'utf8');
  assert.deepEqual(evaluate(code), ['Override: 3/N/0/Ada; original 1/1','Merge: 7/Y/ios/Lin','Defaults: 9/42','Empty: {}','Extra: 5/kept','Escapes: },"n":999,{; [""]; N','Rows: 11/17/Ada/Lin']);
});

for (const [body,error] of [
  ['const x = {...[1,2]};', /typed JSON object/],
  ['const x = {..."hi"};', /typed JSON object/],
  ['const x = {...1};', /typed JSON object/],
  ['const data=input<NativeContent>(); const x={...data};', /typed JSON object/],
  ['const x = {...{},value:input<NativeContent>()};', /JSON-compatible/],
  ['const x = {...{},n:1,n:2};', /Duplicate object key/],
  ['const x = {...{},get n(){return 1;}};', /plain properties/],
] as const) test(`reject unsupported object spread: ${body}`, () => assert.throws(()=>compile(source(body)),error));
