// npm run verify:corpus -- /path/to/exported/xml/directory [report.json]
// Compile/serialization checks only: never run imported actions on a device.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { parse } from "plist";
import { compile } from "../lib/src/compiler.js";
import { readWorkflow, workflowToTypeScript } from "../lib/src/importer.js";
import { buildPlist, stringifyInspection, parseInspection } from "../lib/src/plist-codec.js";

const [directory, reportPath] = process.argv.slice(2);
if (!directory) throw new Error("Provide a directory of unsigned XML workflows.");
const root = resolve(directory);
const results = [];
for (const file of (await readdir(root)).filter(f => /\.(xml|plist)$/.test(f)).sort()) {
  const bytes = await readFile(join(root, file));
  const result = { file, sha256: createHash("sha256").update(bytes).digest("hex") };
  try {
    const original = await readWorkflow(join(root, file));
    const compiled = compile(workflowToTypeScript(original)).workflow;
    // New default root fields may be added; every original field must remain identical.
    for (const [key, value] of Object.entries(original)) assert.deepEqual(compiled[key], value, key);
    assert.deepEqual(parse(buildPlist(compiled)), compiled);
    assert.deepEqual(parseInspection(stringifyInspection(compiled)), compiled);
    result.actions = original.WFWorkflowActions.length;
    result.result = "pass";
  } catch (error) { result.result = "fail"; result.error = String(error); }
  results.push(result);
}
const passed = results.filter(r => r.result === "pass").length;
const report = { checkedAt: new Date().toISOString(), directory: root, validation: "Import → TypeScript → workflow, XML roundtrip, inspection JSON roundtrip. No action execution.", passed, failed: results.length - passed, results };
if (reportPath) await writeFile(reportPath, JSON.stringify(report, null, 2) + "\n");
console.log(`${passed}/${results.length} workflow roundtrips passed.`);
for (const result of results.filter(r => r.result === "fail")) console.error(`${result.file}: ${result.error}`);
if (!results.length || passed !== results.length) process.exitCode = 1;
