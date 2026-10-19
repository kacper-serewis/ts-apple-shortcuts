import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { isDeepStrictEqual } from "node:util";
import { appActions, record, validateAppMetadata, type AppMetadata } from "./app-metadata.js";
import { workflowToTypeScript } from "./importer.js";
import type { Workflow, PlistDictionary } from "./model.js";

export async function readAppManifest(path: string): Promise<AppMetadata> {
  return validateAppMetadata(JSON.parse(await readFile(path, "utf8")));
}

/** Import one bundle at a time: app, extension and Watch bundles have distinct identities. */
export async function importAppBundle(path: string, namespace: string): Promise<AppMetadata> {
  let metadataPath = join(path, "Metadata.appintents", "extract.actionsdata");
  let infoPath = join(path, "Info.plist");
  let contents: string;
  try { contents = await readFile(metadataPath, "utf8"); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    metadataPath = join(path, "Contents", "Resources", "Metadata.appintents", "extract.actionsdata");
    infoPath = join(path, "Contents", "Info.plist");
    contents = await readFile(metadataPath, "utf8");
  }
  const infoResult = spawnSync("plutil", ["-convert", "json", "-o", "-", infoPath], { encoding: "utf8", timeout: 10000 });
  if (infoResult.status !== 0) throw new Error(infoResult.error?.message ?? infoResult.stderr ?? "Cannot read bundle Info.plist (requires macOS).");
  const info = JSON.parse(infoResult.stdout);
  return validateAppMetadata({ format: 1, namespace, bundleIdentifier: info.CFBundleIdentifier,
    source: { version: String(info.CFBundleShortVersionString ?? info.CFBundleVersion ?? "unknown"), metadataSHA256: createHash("sha256").update(contents).digest("hex") },
    metadata: JSON.parse(contents), bindings: {} });
}

/** Learn only action identity and its descriptor, never copy selected entities or user data. */
export function bindAppWorkflow(app: AppMetadata, input: unknown): AppMetadata {
  workflowToTypeScript(input); // Validate plist values and workflow shape before reading bindings.
  const workflow = (record(input).workflow ?? input) as Workflow;
  const result: AppMetadata = { ...app, bindings: { ...app.bindings } };
  let matched = false;
  for (const native of workflow.WFWorkflowActions) {
    const params = native.WFWorkflowActionParameters;
    const descriptor = record(params.AppIntentDescriptor);
    if (descriptor.BundleIdentifier !== app.bundleIdentifier) continue;
    const intent = descriptor.AppIntentIdentifier;
    if (typeof intent !== "string" || !appActions(app).some(a => a.id === intent)) continue;
    matched = true;
    const defaults: PlistDictionary = { AppIntentDescriptor: params.AppIntentDescriptor };
    const binding = { identifier: native.WFWorkflowActionIdentifier, defaults };
    const previous = result.bindings[intent];
    if (previous && !isDeepStrictEqual(previous, binding)) throw new Error(`Conflicting native bindings for ${intent}.`);
    result.bindings[intent] = binding;
  }
  if (!matched) throw new Error(`No AppIntentDescriptor matched ${app.bundleIdentifier} in the reference workflow.`);
  return validateAppMetadata(result);
}
