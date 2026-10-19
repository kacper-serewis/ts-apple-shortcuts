import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { parse, buildBinary } from "plist";
import { compile } from "../src/compiler.js";
import { workflowToTypeScript, readWorkflow } from "../src/importer.js";
import { buildPlist, parseInspection, stringifyInspection } from "../src/plist-codec.js";
import { plistData, plistDate } from "../src/native.js";

const source = (params: string) => `import { native, raw, plistData, plistDate } from "@js-shortcuts/ios";
  export default async function main() { await native("com.example.Action", ${params}); }`;

test("static data and dates preserve native plist types through compile, XML and reimport", () => {
  const compiled = compile(source('raw({ UUID: "fixed", bytes: plistData("AP+AAQ=="), dates: [plistDate("2026-10-19T12:00:00Z")], empty: plistData("") })'));
  const parameters = compiled.workflow.WFWorkflowActions[0].WFWorkflowActionParameters;
  assert.deepEqual(parameters.bytes, new Uint8Array([0, 255, 128, 1]));
  assert.deepEqual(parameters.dates, [new Date("2026-10-19T12:00:00Z")]);
  const xml = buildPlist(compiled.workflow);
  assert.match(xml, /<data>AP\+AAQ==<\/data>/);
  assert.match(xml, /<date>2026-10-19T12:00:00Z<\/date>/);
  const parsed = parse(xml);
  assert.deepEqual(parsed, compiled.workflow);
  const imported = workflowToTypeScript(parsed);
  assert.match(imported, /plistData\("AP\+AAQ=="\)/);
  assert.match(imported, /plistDate\("2026-10-19T12:00:00.000Z"\)/);
  assert.deepEqual(compile(imported).workflow, compiled.workflow);
});

test("static helpers work as native parameters, nested raw leaves and aliased settings imports", () => {
  const compiled = compile(`export const shortcut = { iconData: bytes("AA=="), modified: when("2026-10-19T00:00:00Z") };
    import { native, raw, plistData as bytes, plistDate as when } from "@js-shortcuts/ios";
    export default async function main() {
      await native("com.example.Action", { bytes: bytes(" /w== \\n"), settings: raw({ date: when("2026-10-19T00:00:00.000Z") }) });
    }`);
  assert.deepEqual(compiled.workflow.iconData, new Uint8Array([0]));
  assert.ok(compiled.workflow.modified instanceof Date);
  assert.deepEqual(compiled.workflow.WFWorkflowActions[0].WFWorkflowActionParameters.bytes, new Uint8Array([255]));
});

test("data/date helpers never execute expressions, variables, arbitrary calls or shadowed imports", () => {
  for (const expression of ['plistData("not base64")', 'plistData("AB==")', 'plistDate("2026-02-30T00:00:00Z")', 'plistDate("2026-10-19T00:00:00.123Z")', 'plistDate("October 19, 2026")', 'plistData(String("AA=="))']) {
    assert.throws(() => compile(source(`raw({ value: ${expression} })`)), /plistData|plistDate|static plist literal/);
  }
  assert.throws(() => compile(source('plistData("AA==")')), /parameters must be/);
  assert.throws(() => compile(`import { native, raw, plistData } from "@js-shortcuts/ios";
    export default async function main() { const plistData = "shadow"; await native("com.example.Action", raw({ value: plistData("AA==") })); }`), /static plist literal/);
  assert.throws(() => compile(`import { native, raw, type plistData } from "@js-shortcuts/ios";
    export default async function main() { await native("com.example.Action", raw({ value: plistData("AA==") })); }`), /static plist literal/);
});

test("inspection JSON preserves typed leaves and escapes dictionaries that look like tags", () => {
  const ordinary = { $plist: "data", value: "AA==", arbitrary: [true] };
  const data = { workflow: { blob: plistData("AA=="), modified: plistDate("2026-10-19T00:00:00Z"), literalTag: ordinary, nested: { $plist: "dictionary", value: [] } } };
  const json = stringifyInspection(data);
  assert.match(json, /"\$shortcutsPlist": 1/);
  assert.deepEqual(parseInspection(json), data);
  assert.deepEqual(parseInspection(JSON.stringify(ordinary)), ordinary);
  assert.deepEqual(JSON.parse(stringifyInspection(ordinary)), ordinary);
  const reservedRoot = { $shortcutsPlist: 1, value: { $plist: "data", value: "AA==" } };
  assert.deepEqual(parseInspection(stringifyInspection(reservedRoot)), reservedRoot);
  const metadata = { $shortcutsPlist: "user metadata", WFWorkflowActions: [] };
  assert.deepEqual(parseInspection(JSON.stringify(metadata)), metadata);
  assert.deepEqual(parseInspection(stringifyInspection({ bytes: Buffer.from([0, 255]) })), { bytes: new Uint8Array([0, 255]) });
  assert.throws(() => parseInspection('{"$shortcutsPlist":2,"value":{}}'), /envelope/);
  assert.throws(() => parseInspection('{"$shortcutsPlist":1,"value":{"$plist":"data","value":"wrong"}}'), /base64/);
  assert.throws(() => parseInspection('{"$shortcutsPlist":1,"value":{"$plist":"dictionary","value":[["x",1],["x",2]]}}'), /dictionary/);
});

test("plist serializer preserves carriage returns, unicode, XML text, empty containers and bytes", () => {
  const workflow = { "<&\r🌍": "a\r\nb\t<>&🌍", bytes: new Uint8Array([0, 255]), date: new Date("2026-10-19T12:00:00Z"), empty: [], dictionary: {}, number: -42, real: 1.25, flag: false };
  assert.deepEqual(parse(buildPlist(workflow)), workflow);
  assert.throws(() => buildPlist({ date: new Date("2026-10-19T12:00:00.001Z") }), /whole-second/);
  assert.throws(() => buildPlist({ bad: "\u0000" }), /XML/);
  assert.throws(() => buildPlist({ bad: Infinity }), /finite/);
});

test("CLI typed inspection JSON reimports without changing data/date values or UUID links", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ts-shortcuts-plist-"));
  try {
    const input = join(dir, "input.ts");
    await writeFile(input, source('raw({ UUID: "fixed", archived: plistData("AP8="), date: plistDate("2026-10-19T00:00:00Z"), link: { OutputUUID: "fixed" } })'));
    const output = join(dir, "compiled");
    const first = spawnSync(process.execPath, ["lib/src/cli.js", input, "--out", output], { encoding: "utf8" });
    assert.equal(first.status, 0, first.stderr);
    const imported = join(dir, "imported.ts");
    const result = spawnSync(process.execPath, ["lib/src/cli.js", "import", `${output}.json`, "--out", imported], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(compile(await readFile(imported, "utf8")).workflow, await readWorkflow(`${output}.unsigned.plist`));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("Apple plutil validates XML and binary import preserves dates/data", { skip: process.platform !== "darwin" }, async () => {
  const dir = await mkdtemp(join(tmpdir(), "ts-shortcuts-binary-"));
  try {
    const workflow = compile(source('raw({ bytes: plistData("AAH/"), date: plistDate("2026-10-19T12:00:00Z") })')).workflow;
    const xml = join(dir, "input.plist");
    const binary = join(dir, "input.binary.plist");
    await writeFile(xml, buildPlist(workflow));
    const conversion = spawnSync("plutil", ["-convert", "binary1", "-o", binary, xml], { encoding: "utf8" });
    assert.equal(conversion.status, 0, conversion.stderr);
    assert.deepEqual(await readWorkflow(binary), workflow);
    assert.deepEqual(compile(workflowToTypeScript(await readWorkflow(binary))).workflow, workflow);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("binary import detects fractional dates before plutil can silently truncate them", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ts-shortcuts-date-"));
  try {
    const binary = join(dir, "date.plist");
    await writeFile(binary, buildBinary({ date: new Date("2026-10-19T00:00:00.125Z") }));
    await assert.rejects(() => readWorkflow(binary), /subsecond binary plist date/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
