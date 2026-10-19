import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { compile } from "../src/compiler.js";
import { appActions, appDeclarations, validateAppMetadata, type AppMetadata } from "../src/app-metadata.js";
import { bindAppWorkflow } from "../src/app-importer.js";

const app = validateAppMetadata(JSON.parse(readFileSync(new URL("../../api/apps/home-assistant-dev.json", import.meta.url), "utf8")));
const reference = JSON.parse(readFileSync(new URL("../../test/fixtures/home-assistant-set-brightness-workflow.json", import.meta.url), "utf8"));
const source = (body: string) => `import { HomeAssistant, raw, input, type NativeContent } from "@js-shortcuts/ios";
export default async function main() { ${body} }`;
const run = (body: string, apps = [app]) => compile(source(body), { apps });

test("actual HA metadata provides entities, scalar inputs, enums and value/void results", () => {
  const declarations = appDeclarations(app);
  assert.equal(appActions(app).length, 64);
  assert.match(declarations, /function setBrightness\(parameters: \{ "light": Entity<"DimmableLightAppEntity"> \| NativeEncoded; "brightness": number \| NativeEncoded \}\): Promise<void>/);
  assert.match(declarations, /function getEntityState.*Promise<Entity<"HAEntityStateAppEntity">>/);
  assert.match(declarations, /"on" \| "off"/);
  assert.match(declarations, /function assistAppIntent/);
  assert.match(declarations, /function assistIntent/);
});

test("native export binding learns identity without copying a selected entity", () => {
  const custom = structuredClone(reference);
  custom.WFWorkflowActions[0].WFWorkflowActionParameters.light = { privateServer: "secret" };
  const bound = bindAppWorkflow({ ...app, bindings: {} }, custom);
  assert.deepEqual(bound.bindings, app.bindings);
  assert.doesNotMatch(JSON.stringify(bound.bindings), /secret|UUID/);
  const wrong = structuredClone(reference);
  wrong.WFWorkflowActions[0].WFWorkflowActionParameters.AppIntentDescriptor.BundleIdentifier = "another.app";
  assert.throws(() => bindAppWorkflow({ ...app, bindings: {} }, wrong), /No AppIntentDescriptor matched/);
  assert.throws(() => bindAppWorkflow(app, wrong), /No AppIntentDescriptor matched/);
  const reordered = structuredClone(reference);
  const descriptor = reordered.WFWorkflowActions[0].WFWorkflowActionParameters.AppIntentDescriptor;
  reordered.WFWorkflowActions[0].WFWorkflowActionParameters.AppIntentDescriptor = Object.fromEntries(Object.entries(descriptor).reverse());
  assert.deepEqual(bindAppWorkflow(app, reordered).bindings, app.bindings);
});

test("typed app calls use the exact exported identity and descriptor", () => {
  const actions = run('await HomeAssistant.setBrightness({ light: raw({ testEntity: "fixture" }), brightness: 50 });').workflow.WFWorkflowActions;
  assert.equal(actions.length, 1);
  const native = actions[0];
  assert.equal(native.WFWorkflowActionIdentifier, reference.WFWorkflowActions[0].WFWorkflowActionIdentifier);
  assert.deepEqual(native.WFWorkflowActionParameters.AppIntentDescriptor, reference.WFWorkflowActions[0].WFWorkflowActionParameters.AppIntentDescriptor);
  assert.deepEqual(native.WFWorkflowActionParameters.light, { testEntity: "fixture" });
  assert.equal(native.WFWorkflowActionParameters.brightness, 50);
});

test("app imports are opt-in and unbound actions fail without guessing identifiers", () => {
  assert.throws(() => run('await HomeAssistant.setBrightness({ light: raw({}), brightness: 50 });', []), /Unknown action import/);
  assert.throws(() => run('await HomeAssistant.setTemperature({});'), /No native export binding/);
  assert.throws(() => run('await HomeAssistant.setBrightness({ light: raw({}), brightness: 50 });', [app, app]), /Duplicate app namespace/);
});

test("app schemas reject wrong scalars, missing fields, plain entity IDs and incorrect entity types", () => {
  assert.throws(() => run('await HomeAssistant.setBrightness({ light: raw({}), brightness: "50" });'), /TS2322/);
  assert.throws(() => run('await HomeAssistant.setBrightness({ brightness: 50 });'), /light/);
  assert.throws(() => run('await HomeAssistant.setBrightness({ light: "light.globe", brightness: 50 });'), /TS2322/);
  assert.throws(() => run('await HomeAssistant.setBrightness({ light: input<HomeAssistant.LockAppEntity>(), brightness: 50 });'), /TS2322/);
  assert.throws(() => run('await HomeAssistant.setBrightness({ light: raw({}), brightness: 50, typo: 1 });'), /Unknown catalog parameter/);
  assert.doesNotThrow(() => run('await HomeAssistant.setBrightness({ light: input<HomeAssistant.DimmableLightAppEntity>(), brightness: 50 });'));
});

test("metadata is validated and opaque types never become invented dictionary shapes", () => {
  assert.throws(() => validateAppMetadata({ ...app, format: 2 }), /Invalid app metadata/);
  assert.throws(() => validateAppMetadata({ ...app, namespace: 'Bad;code' }), /Invalid app metadata/);
  const fixture: AppMetadata = structuredClone(app);
  const action = (fixture.metadata.actions as Record<string, Record<string, unknown>>).SetBrightnessAppIntent;
  action.outputType = { futureType: {} };
  assert.match(appDeclarations(fixture), /function setBrightness.*Promise<NativeContent>/);
});

test("checked-in app declarations are reproducible and the example preserves native Ask Each Time", () => {
  assert.equal(readFileSync(new URL("../../api/apps/home-assistant-dev.d.ts", import.meta.url), "utf8"), appDeclarations(app));
  const filename = new URL("../../examples/apps/home-assistant-brightness.ts", import.meta.url);
  const result = compile(readFileSync(filename, "utf8"), { filename: filename.pathname, apps: [app] });
  const actual = result.workflow.WFWorkflowActions[0];
  const expected = reference.WFWorkflowActions[0];
  assert.equal(actual.WFWorkflowActionIdentifier, expected.WFWorkflowActionIdentifier);
  assert.deepEqual(actual.WFWorkflowActionParameters.light, expected.WFWorkflowActionParameters.light);
  assert.deepEqual(actual.WFWorkflowActionParameters.AppIntentDescriptor, expected.WFWorkflowActionParameters.AppIntentDescriptor);
  // Shortcuts' editor stores the literal as text; the compiler emits a number.
  assert.equal(actual.WFWorkflowActionParameters.brightness, Number(expected.WFWorkflowActionParameters.brightness));
  assert.throws(() => run('await HomeAssistant.setBrightness(raw({ brightness: 50 }));'), /App parameters must be an object literal/);
});

test("bundle importer and CLI support separate app manifests without overwriting files", { skip: process.platform !== "darwin" }, async () => {
  const { mkdtemp, mkdir, writeFile, readFile, rm, access } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const { spawnSync } = await import("node:child_process");
  const { buildPlist } = await import("../src/plist-codec.js");
  const { importAppBundle } = await import("../src/app-importer.js");
  const directory = await mkdtemp(join(tmpdir(), "shortcuts-app-test-"));
  const cli = fileURLToPath(new URL("../src/cli.js", import.meta.url));
  try {
    for (const mac of [false, true]) {
      const bundle = join(directory, mac ? "Mac.app" : "Phone.app");
      const base = mac ? join(bundle, "Contents") : bundle;
      const resources = mac ? join(base, "Resources") : base;
      await mkdir(join(resources, "Metadata.appintents"), { recursive: true });
      await writeFile(join(resources, "Metadata.appintents", "extract.actionsdata"), JSON.stringify(app.metadata));
      await writeFile(join(base, "Info.plist"), buildPlist({ CFBundleIdentifier: app.bundleIdentifier, CFBundleShortVersionString: "test" }));
      const imported = await importAppBundle(bundle, "HomeAssistant");
      assert.equal(imported.source.version, "test");
      assert.deepEqual(imported.bindings, {});
      assert.deepEqual(imported.metadata, app.metadata);
    }
    const referencePath = join(directory, "reference.json");
    await writeFile(referencePath, JSON.stringify(reference));
    const out = join(directory, "ha");
    const args = [cli, "apps", "import", join(directory, "Phone.app"), "--name", "HomeAssistant", "--out", out, "--reference", referencePath];
    const imported = spawnSync(process.execPath, args, { encoding: "utf8" });
    assert.equal(imported.status, 0, imported.stderr);
    const manifest = await readFile(`${out}.json`, "utf8");
    assert.deepEqual(JSON.parse(manifest).bindings, app.bindings);
    assert.notEqual(spawnSync(process.execPath, args).status, 0);
    assert.equal(await readFile(`${out}.json`, "utf8"), manifest);
    const input = join(directory, "test.ts");
    await writeFile(input, source('await HomeAssistant.setBrightness({ light: raw({}), brightness: 50 });'));
    const compiled = spawnSync(process.execPath, [cli, input, "--app", `${out}.json`, "--out", join(directory, "built")], { encoding: "utf8" });
    assert.equal(compiled.status, 0, compiled.stderr);
    const collision = join(directory, "collision");
    await writeFile(`${collision}.d.ts`, "existing types");
    const blocked = spawnSync(process.execPath, [cli, "apps", "import", join(directory, "Phone.app"), "--name", "HomeAssistant", "--out", collision]);
    assert.notEqual(blocked.status, 0);
    assert.equal(await readFile(`${collision}.d.ts`, "utf8"), "existing types");
    await assert.rejects(access(`${collision}.json`));
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("release binding matches the phone export and preserves native entity selection", () => {
  const release = validateAppMetadata(JSON.parse(readFileSync(new URL("../../api/apps/home-assistant-release.json", import.meta.url), "utf8")));
  const native = JSON.parse(readFileSync(new URL("../../test/fixtures/home-assistant-release-workflow.json", import.meta.url), "utf8"));
  assert.equal(release.bundleIdentifier, "io.robbie.HomeAssistant");
  assert.equal(appActions(release).length, 1);
  assert.deepEqual(bindAppWorkflow({ ...release, bindings: {} }, native).bindings, release.bindings);
  assert.equal(appDeclarations(release), readFileSync(new URL("../../api/apps/home-assistant-release.d.ts", import.meta.url), "utf8"));
  const parameters = native.WFWorkflowActions[0].WFWorkflowActionParameters;
  const input = `import { HomeAssistantRelease, raw } from "@js-shortcuts/ios";
export default async function main() {
  await HomeAssistantRelease.setBrightness({ light: raw(${JSON.stringify(parameters.light)}), brightness: 50 });
}`;
  const actual = compile(input, { apps: [release] }).workflow.WFWorkflowActions[0];
  assert.equal(actual.WFWorkflowActionIdentifier, native.WFWorkflowActions[0].WFWorkflowActionIdentifier);
  assert.deepEqual(actual.WFWorkflowActionParameters.light, parameters.light);
  assert.deepEqual(actual.WFWorkflowActionParameters.AppIntentDescriptor, parameters.AppIntentDescriptor);
  assert.equal(actual.WFWorkflowActionParameters.brightness, Number(parameters.brightness));
});
