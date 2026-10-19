import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { build, parse } from "plist";
import { compile } from "../src/compiler.js";

const source = (body: string, types = "interface Todo { title: string }") => `
import { getJson, askText, showResult } from "@js-shortcuts/ios";
${types}
export default async function main(): Promise<void> { ${body} }`;
function get(value: unknown, ...keys: (string | number)[]): unknown {
  for (const key of keys) {
    assert.ok(value !== null && typeof value === "object");
    value = (value as Record<string | number, unknown>)[key];
  }
  return value;
}

test("GET and field access emit a wired native workflow without fetching during compilation", () => {
  const result = compile(readFileSync(new URL("../../examples/http-json.ts", import.meta.url), "utf8"));
  const actions = result.workflow.WFWorkflowActions;
  assert.deepEqual(actions.map(a => a.WFWorkflowActionIdentifier), ["downloadurl", "getvalueforkey", "showresult"].map(a => `is.workflow.actions.${a}`));
  const p = actions.map(a => a.WFWorkflowActionParameters);
  assert.equal(p[0].WFURL, "https://jsonplaceholder.typicode.com/todos/1");
  assert.equal(p[0].WFHTTPMethod, "GET");
  assert.equal(get(p[0], "WFHTTPHeaders", "Value", "WFDictionaryFieldValueItems", 0, "WFValue", "Value", "string"), "application/json");
  assert.equal(p[1].WFDictionaryKey, "title");
  assert.equal(get(p[1], "WFInput", "Value", "OutputUUID"), p[0].UUID);
  assert.equal(get(p[2], "Text", "Value", "attachmentsByRange", "{0, 1}", "OutputUUID"), p[1].UUID);
  assert.deepEqual(result.sourceMap.map(s => s.line), [8, 11, 11]);
  assert.deepEqual(parse(build(result.workflow)), result.workflow);
  // An invalid/offline URL is still compiled, never requested by this process.
  assert.doesNotThrow(() => compile(source('const t = await getJson<Todo>("https://offline.invalid/"); await showResult(t.title);')));
});

test("dynamic URLs and action aliases retain token serialization", () => {
  const result = compile(`import { askText, getJson as load, showResult } from "@js-shortcuts/ios";
    export default async function main() {
      const url = await askText("URL?");
      const item = await load<{ title: string }>(url);
      await showResult(item.title);
    }`);
  const p = result.workflow.WFWorkflowActions.map(a => a.WFWorkflowActionParameters);
  assert.equal(get(p[1], "WFURL", "WFSerializationType"), "WFTextTokenString");
  assert.equal(get(p[1], "WFURL", "Value", "attachmentsByRange", "{0, 1}", "OutputUUID"), p[0].UUID);
});

test("nested object aliases read from the correct dictionary", () => {
  const result = compile(source(`const u = await getJson<{ address: { city: string } }>("https://offline.invalid");
    const address = u.address; await showResult(address.city);`));
  const p = result.workflow.WFWorkflowActions.map(a => a.WFWorkflowActionParameters);
  assert.equal(p[1].WFDictionaryKey, "address");
  assert.equal(p[2].WFDictionaryKey, "city");
  assert.equal(get(p[2], "WFInput", "Value", "OutputUUID"), p[1].UUID);
});

test("static dictionary brackets work on typed HTTP outputs", () => {
  const actions = compile(source('const t = await getJson<Todo>("https://offline.invalid"); await showResult(t["title"]);')).workflow.WFWorkflowActions;
  assert.equal(actions[1].WFWorkflowActionParameters.WFDictionaryKey, "title");
  assert.equal(get(actions[1], "WFWorkflowActionParameters", "WFInput", "Value", "OutputUUID"), actions[0].WFWorkflowActionParameters.UUID);
});

test("readonly object arrays wire dictionary lookups to Repeat Item", () => {
  const result = compile(source(`const todos = await getJson<ReadonlyArray<Todo>>("https://offline.invalid");
    const alias = todos;
    for (const todo of alias) { await showResult(todo.title); }`));
  const p = result.workflow.WFWorkflowActions.map(a => a.WFWorkflowActionParameters);
  assert.equal(get(p[1], "WFInput", "Value", "OutputUUID"), p[0].UUID);
  assert.equal(get(p[2], "WFInput", "Value", "OutputUUID"), p[1].UUID);
  assert.equal(p[2].WFDictionaryKey, "title");
  assert.equal(p[1].GroupingIdentifier, p[4].GroupingIdentifier);
});

test("nested array fields and outer object references survive nested loops", () => {
  const result = compile(source(`const data = await getJson<{ items: { title: string; tags: string[] }[] }>("https://offline.invalid");
    for (const item of data.items) {
      for (const tag of item.tags) { await showResult(\`\${item.title}: \${tag}\`); }
    }`));
  const p = result.workflow.WFWorkflowActions.map(a => a.WFWorkflowActionParameters);
  assert.equal(p[1].WFDictionaryKey, "items");
  assert.equal(p[3].WFDictionaryKey, "tags");
  assert.equal(p[5].WFDictionaryKey, "title");
  assert.equal(get(p[3], "WFInput", "Value", "OutputUUID"), p[2].UUID);
  assert.equal(get(p[5], "WFInput", "Value", "OutputUUID"), p[2].UUID);
  assert.equal(get(p[6], "Text", "Value", "attachmentsByRange", "{3, 1}", "OutputUUID"), p[4].UUID);
});

for (const [body, message] of [
  ['const t = await getJson("https://offline.invalid");', /explicit TypeScript response type/],
  ['const t = await getJson<any>("x");', /Unsupported JSON value type/],
  ['const t = await getJson<unknown>("x");', /Unsupported JSON value type/],
  ['const t = await getJson<string>("x");', /object or array response/],
  ['const t = await getJson<Date>("x"); await showResult(t.toISOString);', /Unsupported JSON value type/],
  ['const t = await getJson<Todo>("x"); await showResult(t.missing);', /Unknown JSON field/],
  ['const t = await getJson<{ title?: string }>("x"); await showResult(t.title!);', /Optional JSON fields/],
  ['const t = await getJson<{ title: string | null }>("x"); await showResult(t.title!);', /Unsupported JSON value type/],
  ['const t = await getJson<Todo>("x"); await showResult(t?.title);', /Optional chaining/],
  ['const t = await getJson<Todo>("x"); await showResult(t as unknown as string);', /Expected text, not an object/],
  ['const t = await getJson<Todo[]>("x"); await showResult(t.title);', /typed JSON object/],
  ['const t = await getJson<Todo>("x"); for (const x of t) {}', /requires a list/],
  ['const t = await getJson<Todo>("x"); const n: number = t.title;', /TS2322/],
  ['const t = await getJson<Todo>("x"); const x = (t as unknown as { missing: string }).missing;', /Unknown JSON field/],
  ['const getJson = "x"; const t = await getJson<Todo>("x");', /Only imported/],
  ['getJson<Todo>("x");', /await action/],
  ['const t = await getJson<Todo>("x", "y");', /exactly one/],
] as const) {
  test(`rejects unsupported JSON behavior: ${body}`, () => {
    assert.throws(() => compile(source(body), { filename: "http.ts" }), message);
  });
}
