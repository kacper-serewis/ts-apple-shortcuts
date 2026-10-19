import { test } from "node:test";
import assert from "node:assert/strict";
import { compile } from "../src/compiler.js";
import { evaluate } from "./support/evaluate.js";

const source = (body: string, helpers = "") => `import { showResult, askNumber, input, getDictionaryValue, setDictionaryValue, dictionaryKeys, dictionaryValues } from "@js-shortcuts/ios";
${helpers}
export default async function main() { ${body} }`;

test("dictionary updates produce new values without changing earlier dictionaries", () => {
  assert.deepEqual(evaluate(source(`const original = { n: 7 };
    const changed = await setDictionaryValue<{ n: number }>(original, "n", 9);
    const extended = await setDictionaryValue<{ n: number; label: string }>(changed, "label", "new");
    await showResult(original.n); await showResult(changed.n); await showResult(extended.label);`)), [7, 9, "new"]);
});

test("runtime keys select typed values and getter paths traverse nested dictionaries", () => {
  assert.deepEqual(evaluate(source(`const data = { a: 2, b: 3, child: { n: 4 } };
    for (const key of ["a", "b", "child.n"]) { await showResult(await getDictionaryValue<number>(data, key)); }`)), [2, 3, 4]);
});

test("dictionary setters preserve dynamic nested dictionaries and lists", () => {
  assert.deepEqual(evaluate(source(`const nested = await setDictionaryValue<{ n: number }>({ n: 1 }, "n", 5);
    const list = [2, 3].map(n => n * 2);
    const one = await setDictionaryValue<{ child: { n: number } }>({}, "child", nested);
    const two = await setDictionaryValue<{ child: { n: number }; xs: number[] }>(one, "xs", list);
    await showResult(two.child.n); await showResult(two.xs[1]);`)), [5, 6]);
});

test("dictionary key and value collections compose with native loops and array methods", () => {
  const outputs = evaluate(source(`const d = { first: 2, second: 3 };
    for (const key of await dictionaryKeys(d)) { await showResult(key); }
    await showResult((await dictionaryValues<number>(d)).reduce((sum, n) => sum + n, 0));
    await showResult((await dictionaryKeys({})).length);`));
  assert.deepEqual(new Set(outputs.slice(0, 2)), new Set(["first", "second"]));
  assert.deepEqual(outputs.slice(2), [5, 0]);
});

test("setter dots are literal keys, not getter-style key paths", () => {
  assert.deepEqual(evaluate(source(`const d = await setDictionaryValue({ a: 1 }, "nested.path", 2);
    for (const key of await dictionaryKeys(d)) { await showResult(key); }`)).sort(), ["a", "nested.path"]);
});

test("setter arguments are evaluated once in left-to-right source order", () => {
  assert.deepEqual(evaluate(source(`const updated = await setDictionaryValue<{ n: number }>(await makeDictionary(), await makeKey(), await askNumber("value"));
    await showResult(updated.n);`, `async function makeDictionary(): Promise<{ n: number }> { await showResult("dictionary"); return { n: 0 }; }
    async function makeKey(): Promise<string> { await showResult("key"); return "n"; }`), [8]), ["dictionary", "key", 8]);
});

test("static bracket access preserves declared field types and aliases", () => {
  assert.deepEqual(evaluate(source(`const obj = { n: 7, child: { title: "Ada" }, xs: [2, 4], ok: true };
    const key = "n"; await showResult(obj[key]); await showResult(obj["child"]["title"]);
    await showResult(obj["xs"][1]); if (obj["ok"]) { await showResult("yes"); }`)), [7, "Ada", 4, "yes"]);
});

test("getter preserves object, list and boolean output categories", () => {
  assert.deepEqual(evaluate(source(`const d = { child: { n: 4 }, xs: [2, 3], ok: true };
    const child = await getDictionaryValue<{ n: number }>(d, "child");
    const xs = await getDictionaryValue<number[]>(d, "xs");
    if (await getDictionaryValue<boolean>(d, "ok")) { await showResult(child.n + xs[0]); }`)), [6]);
});

test("dictionary value parameters attach native numeric and container outputs instead of stringifying", () => {
  const actions = compile(source(`const n = await setDictionaryValue({}, "n", 9);
    const b = await setDictionaryValue(n, "ok", false);
    const child = { n: 2 }; const c = await setDictionaryValue(b, "child", child);
    await setDictionaryValue(c, "xs", ["a", "b"]);`)).workflow.WFWorkflowActions;
  const setters = actions.filter(a => a.WFWorkflowActionIdentifier.endsWith(".setvalueforkey"));
  const types: string[] = [];
  for (const setter of setters) {
    const token = setter.WFWorkflowActionParameters.WFDictionaryValue as any;
    assert.equal(token.WFSerializationType, "WFTextTokenString");
    assert.equal(token.Value.string, "\uFFFC");
    const ref = token.Value.attachmentsByRange["{0, 1}"];
    const producer = actions.find(a => a.WFWorkflowActionParameters.UUID === ref.OutputUUID)!;
    assert.ok(producer);
    types.push(producer.WFWorkflowActionIdentifier);
    if (types.length === 1) assert.equal(producer.WFWorkflowActionParameters.WFNumberActionNumber, 9);
    if (types.length === 2) assert.equal(producer.WFWorkflowActionParameters.WFNumberActionNumber, 0);
  }
  assert.deepEqual(types, ["number", "number", "dictionary", "list"].map(id => `is.workflow.actions.${id}`));
});

for (const [body, error] of [
  ['await dictionaryKeys([1, 2]);', /typed dictionary object/],
  ['await dictionaryValues(3);', /typed dictionary object/],
  ['await getDictionaryValue<number>("x", "n");', /typed dictionary object/],
  ['await setDictionaryValue([], "n", 1);', /typed dictionary object/],
  ['const d = { n: 1 }; for (const key of ["n"]) { await showResult(d[key]); }', /static string key/],
  ['const d = { "a.b": 1 }; await showResult(d["a.b"]);', /keys containing dots/],
  ['const d = input<{ n?: number }>(); await showResult(d["n"]);', /Optional JSON fields/],
  ['const d = { n: 1 }; await showResult(d["missing"]);', /Unknown JSON field/],
  ['const value: string = await getDictionaryValue<number>({ n: 1 }, "n");', /TS2322/],
  ['await setDictionaryValue<number>({}, "n", 1);', /TS2344/],
  ['const value = await getDictionaryValue({ n: 1 }, "n"); await showResult(value);', /native content|TS2345/],
] as const) {
  test(`rejects unsupported dictionary use: ${body}`, () => assert.throws(() => compile(source(body)), error));
}
