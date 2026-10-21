import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { compile } from "../src/compiler.js";
import { validateAppMetadata } from "../src/app-metadata.js";
import { bindAppWorkflow } from "../src/app-importer.js";
import { evaluate } from "./support/evaluate.js";
import type { PlistDictionary } from "../src/model.js";

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`../../test/fixtures/${name}`, import.meta.url), "utf8"));
const examplePath = (name: string) => fileURLToPath(new URL(`../../${name}`, import.meta.url));
const example = (name: string) => readFileSync(examplePath(name), "utf8");
const source = (body: string) => `import { actions, native, entityProperty, requestJson, showResult, stringifyJson, type NativeContent, type NativeEntity } from "@js-shortcuts/ios";
type Alarm = NativeEntity<"com.apple.clock.AlarmEntity">;
export default async function main() { ${body} }`;
const findAlarms = 'await actions["com.apple.mobiletimer-framework.MobileTimerIntents.MTGetAlarmsIntent"]<Alarm[]>({})';
const property = (id: string) => ({
  Type: "WFPropertyVariableAggrandizement", PropertyName: id,
  PropertyUserInfo: { WFLinkEntityContentPropertyUserInfoPropertyIdentifier: id },
});
function normalize(value: unknown, ids = new Map<string, string>()): unknown {
  if (Array.isArray(value)) return value.map(v => normalize(v, ids));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, normalize(v, ids)]));
  if (typeof value === "string" && /^[0-9A-F]{8}(?:-[0-9A-F]{4}){3}-[0-9A-F]{12}$/.test(value)) {
    if (!ids.has(value)) ids.set(value, `ID-${ids.size + 1}`);
    return ids.get(value);
  }
  return value;
}
function tokens(value: unknown, found: PlistDictionary[] = []): PlistDictionary[] {
  if (Array.isArray(value)) value.forEach(v => tokens(v, found));
  else if (value && typeof value === "object") {
    const record = value as PlistDictionary;
    if (record.Type === "ActionOutput") found.push(record);
    Object.values(record).forEach(v => tokens(v, found));
  }
  return found;
}

test("entity properties match the iOS 26.5 editor's property variable encoding", () => {
  // The editor stores the property identifier (not the title) and repeats it in PropertyUserInfo.
  const editor = fixture("ios26-entity-property-editor-actions.json").WFWorkflowActions[1];
  const [reference] = tokens(editor);
  assert.deepEqual(reference.Aggrandizements, [property("conversationGUID")]);
  const body = `const items = await actions["com.apple.MobileSMS.ConversationEntity"]<NativeEntity<"com.apple.MobileSMS.ConversationEntity">[]>({});
    for (const item of items) { await showResult(entityProperty(item, "displayName")); }`;
  const emitted = compile(source(body)).workflow.WFWorkflowActions;
  const shown = emitted.find(a => a.WFWorkflowActionIdentifier === "is.workflow.actions.showresult")!;
  const [token] = tokens(shown);
  assert.deepEqual(token.Aggrandizements, [property("displayName")]);
  // A property read adds no action: it aliases the loop item's output.
  const loop = emitted.find(a => a.WFWorkflowActionIdentifier === "is.workflow.actions.repeat.each")!;
  assert.equal(token.OutputUUID, loop.WFWorkflowActionParameters.UUID);
  assert.equal(token.OutputName, "Repeat Item");
  assert.equal(emitted.length, 4);
});

test("typed alarm properties keep their native value types in dictionaries and JSON", () => {
  const body = `const alarms = (${findAlarms}).map(alarm => ({
      label: entityProperty(alarm, "label"), hours: entityProperty(alarm, "hours"),
      enabled: entityProperty(alarm, "enabled"), days: entityProperty(alarm, "repeatDays").join(", "),
    }));
    await requestJson<{}>("https://offline.invalid/hook", { method: "POST", json: { alarms } });`;
  const emitted = compile(source(body)).workflow.WFWorkflowActions;
  assert.equal(emitted[0].WFWorkflowActionIdentifier, "com.apple.mobiletimer-framework.MobileTimerIntents.MTGetAlarmsIntent");
  assert.deepEqual(Object.keys(emitted[0].WFWorkflowActionParameters), ["UUID"]);
  const dictionary = emitted.find(a => a.WFWorkflowActionIdentifier === "is.workflow.actions.dictionary")!;
  const items = ((dictionary.WFWorkflowActionParameters.WFItems as PlistDictionary).Value as PlistDictionary).WFDictionaryFieldValueItems as PlistDictionary[];
  const types = Object.fromEntries(items.map(item => [((item.WFKey as PlistDictionary).Value as PlistDictionary).string, item.WFItemType]));
  assert.deepEqual(types, { label: 0, hours: 3, enabled: 4, days: 0 });
  for (const [index, id] of ["label", "hours", "enabled"].entries()) {
    assert.deepEqual(tokens(items[index])[0].Aggrandizements, [property(id)]);
  }
  // The list property is iterated directly for join(); each day is text.
  const loops = emitted.filter(a => a.WFWorkflowActionIdentifier === "is.workflow.actions.repeat.each" && a.WFWorkflowActionParameters.WFControlFlowMode === 0);
  assert.deepEqual(tokens(loops[1].WFWorkflowActionParameters.WFInput)[0].Aggrandizements, [property("repeatDays")]);

  const posted: unknown[] = [];
  const entities = [
    { label: "Werk", hours: 7, enabled: true, repeatDays: ["Monday", "Tuesday"] },
    { label: "", hours: 0, enabled: false, repeatDays: [] },
  ];
  evaluate(source(body), [], [], (node, read) => {
    if (node.identifier.startsWith("com.apple.")) return entities;
    const params = node.parameters.kind === "parameter-object" ? new Map(node.parameters.entries) : new Map();
    const bodyParam = params.get("WFRequestVariable");
    posted.push(JSON.parse(bodyParam?.kind === "parameter-value" ? read(bodyParam.value) : "null"));
    return {};
  });
  assert.deepEqual(posted, [{ alarms: [
    { label: "Werk", hours: 7, enabled: true, days: "Monday, Tuesday" },
    { label: "", hours: 0, enabled: false, days: "" },
  ] }]);
});

test("conditions coerce after the property aggrandizement and chained reads compose", () => {
  const body = `let on = 0;
    for (const alarm of ${findAlarms}) {
      if (entityProperty(alarm, "enabled")) { on += 1; }
      if (entityProperty(alarm, "hours") >= 12) { on += 10; }
    }
    await showResult(on);`;
  const conditions = compile(source(body)).workflow.WFWorkflowActions
    .filter(a => a.WFWorkflowActionIdentifier === "is.workflow.actions.conditional" && a.WFWorkflowActionParameters.WFControlFlowMode === 0);
  for (const [index, id] of ["enabled", "hours"].entries()) {
    assert.deepEqual(tokens(conditions[index].WFWorkflowActionParameters.WFInput)[0].Aggrandizements,
      [property(id), { Type: "WFCoercionVariableAggrandizement", CoercionItemClass: "WFNumberContentItem" }]);
  }
  assert.deepEqual(evaluate(source(body), [], [], () => [{ enabled: true, hours: 7 }, { enabled: false, hours: 13 }, { enabled: true, hours: 12 }]), [22]);

  const chained = compile(source(`const items = await native<NativeContent[]>("example.app.FindItem", {});
    for (const item of items) { await showResult(entityProperty<string>(entityProperty(item, "owner"), "name")); }`)).workflow.WFWorkflowActions;
  const [token] = tokens(chained.find(a => a.WFWorkflowActionIdentifier === "is.workflow.actions.showresult"));
  assert.deepEqual(token.Aggrandizements, [property("owner"), property("name")]);
});

test("entityProperty rejects titles, unknown catalog identifiers, lists and non-entities", () => {
  const loop = (read: string) => source(`for (const alarm of ${findAlarms}) { ${read} }`);
  assert.throws(() => compile(loop('await showResult(entityProperty(alarm, "hour"));')), /Unknown property 'hour' for entity 'com.apple.clock.AlarmEntity'|TS2/);
  assert.throws(() => compile(loop('await showResult(entityProperty<string>(alarm, "hour"));')), /Unknown property 'hour' for entity 'com.apple.clock.AlarmEntity'/);
  assert.throws(() => compile(loop('await showResult(entityProperty<string>(alarm, "Is Enabled"));')), /not an App Intents property identifier/);
  assert.throws(() => compile(loop('const name = "label"; await showResult(entityProperty<string>(alarm, name));')), /literal property identifier/);
  assert.throws(() => compile(source(`const alarms = ${findAlarms}; await showResult(entityProperty<string>(alarms as unknown as NativeContent, "label"));`)), /reads one entity/);
  assert.throws(() => compile(source('await showResult(entityProperty<string>("text" as unknown as NativeContent, "label"));')), /requires native entity content/);
  assert.throws(() => compile(loop('const hours: string = entityProperty(alarm, "hours");')), /TS2322/);
  assert.throws(() => compile(source('for (const item of await native<NativeContent[]>("example.app.FindItem", {})) { const value = entityProperty<{ a: string }>(item, "value"); }')), /TS2344|Unsupported JSON value type/);
});

test("Fire Event binding comes from the simulator export; the release manifest only renames its identity", () => {
  const reference = fixture("home-assistant-fire-event-workflow.json");
  const dev = validateAppMetadata(JSON.parse(example("api/apps/home-assistant-dev-fire-event.json")));
  assert.deepEqual(bindAppWorkflow({ ...dev, bindings: {} }, reference).bindings, { FireEventIntent: dev.bindings.FireEventIntent });
  const parameters = reference.WFWorkflowActions[0].WFWorkflowActionParameters;
  // The native editor stores event data as plain text, not a dictionary.
  assert.equal(typeof parameters.eventData, "string");
  const release = validateAppMetadata(JSON.parse(example("api/apps/home-assistant-release-fire-event.json")));
  const devBinding = dev.bindings.FireEventIntent, releaseBinding = release.bindings.FireEventIntent;
  assert.equal(releaseBinding.identifier, devBinding.identifier.replace(".dev.", "."));
  const brightness = JSON.parse(example("api/apps/home-assistant-release.json")).bindings.SetBrightnessAppIntent.defaults.AppIntentDescriptor;
  assert.deepEqual(releaseBinding.defaults.AppIntentDescriptor, { ...brightness, AppIntentIdentifier: "FireEventIntent" });
});

test("the alarm examples and simulator probes compile to their recorded native workflows", () => {
  const dev = validateAppMetadata(JSON.parse(example("api/apps/home-assistant-dev-fire-event.json")));
  const release = validateAppMetadata(JSON.parse(example("api/apps/home-assistant-release-fire-event.json")));
  for (const [path, recorded, apps] of [
    ["artifacts/entity-property-probe.ts", "ios26-entity-properties-workflow.json", []],
    ["artifacts/fire-event-probe.ts", "ios26-fire-event-probe-workflow.json", [dev]],
  ] as const) {
    const emitted = compile(example(path), { filename: examplePath(path), apps: [...apps] }).workflow.WFWorkflowActions;
    assert.deepEqual(normalize(emitted), normalize(fixture(recorded).WFWorkflowActions), path);
  }
  const fire = compile(example("examples/apps/iphone-wekkers-home-assistant.ts"), { filename: examplePath("examples/apps/iphone-wekkers-home-assistant.ts"), apps: [release] }).workflow.WFWorkflowActions.at(-1)!;
  assert.equal(fire.WFWorkflowActionIdentifier, "io.robbie.HomeAssistant.FireEventIntent");
  assert.equal(fire.WFWorkflowActionParameters.eventName, "iphone_wekkers");
  assert.equal((fire.WFWorkflowActionParameters.eventData as PlistDictionary).WFSerializationType, "WFTextTokenString");
  for (const path of ["examples/apps/iphone-wekkers-home-assistant.ts"]) {
    // Silent for personal automations: no dialogs, prompts or result views.
    const identifiers = compile(example(path), { filename: examplePath(path), apps: [release] }).workflow.WFWorkflowActions.map(a => a.WFWorkflowActionIdentifier);
    assert.ok(!identifiers.some(id => /showresult|alert|ask|notification|choosefrom/.test(id)), path);
  }
});
