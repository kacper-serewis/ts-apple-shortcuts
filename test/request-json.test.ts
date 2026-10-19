import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { compile } from "../src/compiler.js";
import { evaluate } from "./support/evaluate.js";
import type { NativeNode, Value } from "../src/model.js";
const source = (body: string, helpers = "") => `import { requestJson, showResult, askNumber, input, type NativeContent } from "@js-shortcuts/ios";
${helpers}
export default async function main() { ${body} }`;
function readRequest(node: NativeNode, read: (value: Value) => any) {
  assert.equal(node.parameters.kind, "parameter-object");
  if (node.parameters.kind !== "parameter-object") throw new Error("Expected HTTP parameters");
  const map = new Map(node.parameters.entries);
  const get = (name: string) => { const p = map.get(name); return p?.kind === "literal" ? p.value : p?.kind === "parameter-value" ? read(p.value) : undefined; };
  const headers = Object.fromEntries(Object.entries(get("WFHTTPHeaders") as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]));
  return { url: get("WFURL") as string, method: get("WFHTTPMethod"), headers, body: map.has("WFRequestVariable") ? JSON.parse(get("WFRequestVariable")) : undefined };
}

test("GET defaults and explicit header overrides survive native parameter lowering", () => {
  const requests: ReturnType<typeof readRequest>[] = [];
  assert.deepEqual(evaluate(source(`await requestJson<{}>("https://offline.invalid/one");
    await requestJson<{}>("https://offline.invalid/two", { headers: { accept: "custom", "X-Test": "yes" } });
    await showResult("done");`), [], [], (node, read) => { requests.push(readRequest(node, read)); return {}; }), ["done"]);
  assert.deepEqual(requests, [
    { url: "https://offline.invalid/one", method: "GET", headers: { accept: "application/json" }, body: undefined },
    { url: "https://offline.invalid/two", method: "GET", headers: { accept: "custom", "x-test": "yes" }, body: undefined },
  ]);
});

test("all write methods encode JSON containers and scalars without flattening singleton arrays", () => {
  for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
    const requests: ReturnType<typeof readRequest>[] = [];
    evaluate(source(`await requestJson<{}>("https://offline.invalid", { method: "${method}", json: [42] });
      await requestJson<{}>("https://offline.invalid", { method: "${method}", json: false });`), [], [], (n, r) => { requests.push(readRequest(n, r)); return {}; });
    assert.deepEqual(requests.map(r => [r.method, r.headers, r.body]), [
      [method, { accept: "application/json", "content-type": "application/json" }, [42]],
      [method, { accept: "application/json", "content-type": "application/json" }, false],
    ]);
  }
});

test("URL then option expressions are evaluated once in source order before the request", () => {
  const seen: string[] = [];
  const output = evaluate(source(`await requestJson<{}>(await url(), { json: await body(), headers: { "X-Test": await header() }, method: "POST" }); await showResult("after");`,
    `async function url(): Promise<string> { await showResult("url"); return "https://offline.invalid"; }
     async function body(): Promise<{ n: number }> { await showResult("body"); return { n: 7 }; }
     async function header(): Promise<string> { await showResult("header"); return "value"; }`), [], [], (n, r) => { const req = readRequest(n, r); seen.push(req.headers['x-test']); assert.deepEqual(req.body, { n: 7 }); return {}; });
  assert.deepEqual(output, ["url", "body", "header", "after"]); assert.deepEqual(seen, ["value"]);
});

test("header and body snapshots survive later option effects", () => {
  const requests: ReturnType<typeof readRequest>[] = [];
  evaluate(source(`let name = "before";
    await requestJson<{}>("https://offline.invalid", { headers: { "X-Test": name }, method: "POST",
      json: [1].reduce((acc, n) => { name = "after"; return { name }; }, { name: "" }) });
    let body = { n: 1 };
    await requestJson<{}>("https://offline.invalid", { json: body, method: "POST",
      headers: { "X-Test": [0].reduce((acc, n) => { body = { n: 2 }; return "changed"; }, "") } });`), [], [], (n, r) => { requests.push(readRequest(n, r)); return {}; });
  assert.equal(requests[0].headers['x-test'], 'before'); assert.deepEqual(requests[0].body, { name: 'after' });
  assert.deepEqual(requests[1].body, { n: 1 });
});

test("const method/header aliases and case-insensitive default overrides work", () => {
  evaluate(source(`const method = "PATCH"; const headers = { ACCEPT: "custom", "content-type": "application/vnd.test+json" };
    await requestJson<{}>("https://offline.invalid", { method, headers, json: [] });`), [], [], (n, r) => {
    const request = readRequest(n, r);
    assert.deepEqual(request, { url: "https://offline.invalid", method: "PATCH", headers: { accept: "custom", "content-type": "application/vnd.test+json" }, body: [] }); return {};
  });
});

test("a bodyless write request has no request body or automatic Content-Type", () => {
  const actions = compile(source('await requestJson<{}>("https://offline.invalid", { method: "DELETE" });')).workflow.WFWorkflowActions;
  const request = actions.find(a => a.WFWorkflowActionIdentifier.endsWith('.downloadurl'))!.WFWorkflowActionParameters;
  assert.equal(request.WFHTTPMethod, 'DELETE'); assert.equal(request.WFRequestVariable, undefined); assert.equal(request.WFHTTPBodyType, undefined);
  const items = (request.WFHTTPHeaders as any).Value.WFDictionaryFieldValueItems;
  assert.deepEqual(items.map((i: any) => i.WFKey.Value.string), ['Accept']);
});

test("headers composed from known object literals keep static names and overwrite values", () => {
  evaluate(source(`const defaults = { Accept: "default", "X-Test": "old" };
    const headers = {...defaults, "X-Test": "new"};
    await requestJson<{}>("https://offline.invalid", {headers});`), [], [], (n, r) => {
    assert.deepEqual(readRequest(n,r).headers, {accept:"default", "x-test":"new"}); return {};
  });
});

test("JSON bodies attach serialized text through File mode and responses retain typed arrays", () => {
  const actions = compile(source('const rows = await requestJson<{ n: number }[]>("https://offline.invalid", { method: "POST", json: { n: 1 } }); await showResult(rows[0].n);')).workflow.WFWorkflowActions;
  const request = actions.find(a => a.WFWorkflowActionIdentifier.endsWith('.downloadurl'))!.WFWorkflowActionParameters;
  assert.equal(request.WFHTTPBodyType, 'File'); assert.equal((request.WFRequestVariable as any).WFSerializationType, 'WFTextTokenAttachment');
  const producer = actions.find(a => a.WFWorkflowActionParameters.UUID === (request.WFRequestVariable as any).Value.OutputUUID)!;
  assert.equal(producer.WFWorkflowActionIdentifier, 'is.workflow.actions.gettext');
  assert.equal(request.WFJSONValues, undefined);
  assert.deepEqual(evaluate(source('const rows = await requestJson<{ n: number }[]>("https://offline.invalid"); await showResult(rows[0].n);'), [], [], () => [{ n: 9 }]), [9]);
});

test("local HTTP demo produces all intended echo results without making requests during compilation", () => {
  const code = readFileSync(new URL('../../examples/request-json-test.ts', import.meta.url), 'utf8');
  const methods: unknown[] = [];
  assert.deepEqual(evaluate(code, [], [], (node, read) => {
    const request = readRequest(node, read); methods.push(request.method);
    if (request.url.endsWith('/array')) return [{ n: 2 }, { n: 3 }];
    return { method: request.method, accept: request.headers.accept, contentType: request.headers['content-type'] ?? '', marker: request.headers['x-toolkit-test'] ?? '', received: request.body };
  }), ['GET: application/json', 'POST: ts-2; Ada/1/N', 'PUT: []; application/json', 'PATCH: [42]; application/json; profile=test; application/vnd.test+json', 'DELETE: "quote\\"\\\\\\n😀"', 'Array: 2; som: 5']);
  assert.deepEqual(methods, ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'GET']);
});

for (const [body, error] of [
  ['await requestJson("x");', /explicit object or array response type/],
  ['await requestJson<number>("x");', /object or array response/],
  ['await requestJson<{}>(1);', /URL must be text/],
  ['const options = { method: "GET" } as const; await requestJson<{}>("x", options);', /inline object literal/],
  ['let method = "POST"; await requestJson<{}>("x", { method });', /constant GET/],
  ['await requestJson<{}>("x", { method: "HEAD" });', /HTTP method must be GET/],
  ['await requestJson<{}>("x", { json: {} });', /GET requests cannot/],
  ['await requestJson<{}>("x", { timeout: 5 });', /Unknown requestJson option/],
  ['await requestJson<{}>("x", { headers: { Accept: "a", accept: "b" } });', /Duplicate HTTP header/],
  ['await requestJson<{}>("x", { headers: { "Bad Name": "x" } });', /Invalid HTTP header name/],
  ['await requestJson<{}>("x", { headers: { "X-Test": "a\\nb" } });', /cannot contain line breaks/],
  ['await requestJson<{}>("x", { headers: { "X-Test": 7 } });', /values must be text/],
  ['let headers = { Accept: "x" }; await requestJson<{}>("x", { headers });', /headers require an object literal/],
  ['await requestJson<{}>("x", { method: "POST", json: input<NativeContent>() });', /JSON-compatible data/],
  ['await requestJson?.<{}>("x");', /Optional requestJson/],
  ['requestJson<{}>("x");', /Actions must be called as await/],
] as const) {
  test(`reject invalid request: ${body}`, () => assert.throws(() => compile(source(body)), error));
}
