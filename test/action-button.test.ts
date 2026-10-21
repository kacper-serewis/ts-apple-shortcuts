import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { compile } from "../src/compiler.js";
import { validateAppMetadata } from "../src/app-metadata.js";
import { bindAppWorkflow } from "../src/app-importer.js";
import { evaluate } from "./support/evaluate.js";
import type { NativeAction, NativeNode, PlistDictionary, Value } from "../src/model.js";

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`../../test/fixtures/${name}`, import.meta.url), "utf8"));
const path = (name: string) => fileURLToPath(new URL(`../../${name}`, import.meta.url));
const read = (name: string) => readFileSync(path(name), "utf8");
const editor = fixture("ios26-action-button-editor-actions.json");
const release = validateAppMetadata(JSON.parse(read("api/apps/home-assistant-release-fire-event.json")));
const EXAMPLE = "examples/apps/action-button.ts";

/** UUIDs become stable placeholders; output names are display labels the editor picks. */
function normalize(value: unknown, ids = new Map<string, string>()): unknown {
  if (Array.isArray(value)) return value.map(v => normalize(v, ids));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value)
    .filter(([key]) => key !== "OutputName").map(([k, v]) => [k, normalize(v, ids)]));
  if (typeof value === "string" && /^[0-9A-F]{8}(?:-[0-9A-F]{4}){3}-[0-9A-F]{12}$/.test(value)) {
    if (!ids.has(value)) ids.set(value, `ID-${ids.size + 1}`);
    return ids.get(value);
  }
  return value;
}
const params = (action: NativeAction) => {
  const { UUID: _uuid, ...rest } = action.WFWorkflowActionParameters;
  return rest;
};
const source = (body: string, names = "Shortcuts, System, Maps, Focus, attachment, entityProperty, openApp, showResult, currentDate, formatDate") =>
  `import { ${names} } from "@js-shortcuts/ios";\nexport default async function main() { ${body} }`;
const actions = (code: string) => compile(code).workflow.WFWorkflowActions;
const byId = (list: NativeAction[], id: string) => list.filter(a => a.WFWorkflowActionIdentifier === id);

test("toggles and Open App match the iOS 26.5 editor", () => {
  const [, lock, flashlight, open] = editor.orientation.WFWorkflowActions as NativeAction[];
  const emitted = actions(source(`await System.setOrientationLock({ operation: "toggle" });
    await System.setFlashlight({ operation: "toggle" });
    await openApp({ bundleIdentifier: "nl.serewis.ikweetwatikeet", name: "Ik weet wat ik eet", teamIdentifier: "NYSBRSGD6C" });`));
  assert.deepEqual(emitted.map(params), [lock, flashlight, open].map(params));
  // Without a team identifier only the descriptor's bundle and name are stored.
  assert.deepEqual(params(actions(source('await openApp({ bundleIdentifier: "com.apple.mobilesafari", name: "Safari" });'))[0]),
    { WFSelectedApp: { BundleIdentifier: "com.apple.mobilesafari", Name: "Safari" }, WFAppIdentifier: "com.apple.mobilesafari" });
});

test("orientation comparisons compile to the editor's native enum conditions", () => {
  const recorded = editor.orientation.WFWorkflowActions as NativeAction[];
  const emitted = actions(source(`const orientation = await Shortcuts.getOrientation();
    if (orientation === "Landscape Left" || orientation === "Landscape Right") { await System.setOrientationLock({ operation: "toggle" }); }`));
  const [start] = byId(emitted, "is.workflow.actions.conditional");
  // The editor's "Any are true" condition: WFLinkEnumeration holds the case identifier.
  assert.deepEqual(normalize([emitted[0].WFWorkflowActionParameters.UUID, start.WFWorkflowActionParameters.WFConditions]),
    normalize([recorded[0].WFWorkflowActionParameters.UUID, recorded[4].WFWorkflowActionParameters.WFConditions]));
  // The editor adds an AppIntentDescriptor to Get Orientation; the action ran without it (simulator).
  assert.equal(emitted[0].WFWorkflowActionIdentifier, recorded[0].WFWorkflowActionIdentifier);

  const single = byId(actions(source(`const orientation = await Shortcuts.getOrientation();
    if ("Face Down" === orientation) { await showResult("down"); }`)), "is.workflow.actions.conditional")[0].WFWorkflowActionParameters;
  assert.equal(single.WFCondition, 4);
  assert.equal(single.WFLinkEnumeration, "5");
  assert.equal(((single.WFInput as PlistDictionary).Variable as PlistDictionary).WFSerializationType, "WFTextTokenAttachment");
});

test("enum conditions keep JavaScript semantics and fall back to text where not native", () => {
  const body = (condition: string) => source(`const orientation = await Shortcuts.getOrientation();
    if (${condition}) { await showResult("yes"); } else { await showResult("no"); }`);
  const ids = { Portrait: "0", "Landscape Left": "2", "Landscape Right": "3", Unknown: "6" };
  const run = (condition: string, value: keyof typeof ids) =>
    evaluate(body(condition), [], [], undefined, { natives: () => ids[value] });
  const either = 'orientation === "Landscape Left" || orientation === "Landscape Right"';
  assert.deepEqual(run(either, "Landscape Right"), ["yes"]);
  assert.deepEqual(run(either, "Portrait"), ["no"]);
  assert.deepEqual(run('!(orientation === "Unknown")', "Unknown"), ["no"]);
  // !== is not editor-verified for enums and keeps the text comparison.
  const negated = actions(body('orientation !== "Portrait"'));
  assert.ok(!negated.some(a => "WFLinkEnumeration" in a.WFWorkflowActionParameters));
  assert.ok(byId(negated, "is.workflow.actions.text.replace").length);
  // Mixed chains (an enum test or'ed with a text test) keep the generic lowering.
  const mixed = actions(source(`const orientation = await Shortcuts.getOrientation(); const name: string = "x";
    if (orientation === "Portrait" || name === "y") { await showResult("yes"); }`));
  assert.ok(!mixed.some(a => "WFConditions" in a.WFWorkflowActionParameters));
  // A combined condition cannot evaluate an action subject without skipping JavaScript's short circuit.
  assert.throws(() => compile(source('if ((await Shortcuts.getOrientation()) === "Portrait" || (await Shortcuts.getOrientation()) === "Unknown") { await showResult("x"); }')),
    /store each action result in a const first/);
});

test("content item properties use the editor's title encoding", () => {
  const [location, focus, latitude] = editor.location.WFWorkflowActions as NativeAction[];
  const [, focusName] = editor.focusName.WFWorkflowActions as NativeAction[];
  const emitted = actions(source(`const here = await Maps.getCurrentLocation({});
    await showResult(\`\${entityProperty<number>(here, "Latitude")}\`);
    await Maps.openDirections({ WFDestination: attachment(entityProperty(await Focus.getCurrentFocus(), "Name")) });`));
  const tokenOf = (action: NativeAction, key: string) => {
    const parameter = action.WFWorkflowActionParameters[key] as PlistDictionary;
    const value = parameter.Value as PlistDictionary;
    return (value.attachmentsByRange ? Object.values(value.attachmentsByRange as PlistDictionary)[0] : value) as PlistDictionary;
  };
  assert.equal(emitted[0].WFWorkflowActionIdentifier, location.WFWorkflowActionIdentifier);
  assert.deepEqual(tokenOf(byId(emitted, "is.workflow.actions.showresult")[0], "Text").Aggrandizements, tokenOf(latitude, "WFTextActionText").Aggrandizements);
  const directions = byId(emitted, "is.workflow.actions.getdirections")[0];
  assert.equal(byId(emitted, "is.workflow.actions.dnd.getfocus").length, 1);
  assert.deepEqual(normalize(params(directions)), normalize(params(focusName)));
  assert.equal(focus.WFWorkflowActionIdentifier, "is.workflow.actions.dnd.getfocus");
});

test("an address destination is a Text action attachment, as the editor connects it", () => {
  const [, recorded] = editor.textDestination.WFWorkflowActions as NativeAction[];
  const emitted = actions(source('await Maps.openDirections({ WFDestination: attachment("Klokgebouw 234, 5617 AC Eindhoven") });'));
  assert.deepEqual(emitted.map(a => a.WFWorkflowActionIdentifier), ["is.workflow.actions.gettext", "is.workflow.actions.getdirections"]);
  assert.deepEqual(normalize(emitted[1].WFWorkflowActionParameters.WFDestination), normalize(recorded.WFWorkflowActionParameters.WFDestination));
});

test("Number() marks text as a number for native conditions and calculations", () => {
  const code = source(`const hour = Number(await formatDate(await currentDate(), "H"));
    if (hour < 6) { await showResult("night"); } else if (hour >= 22) { await showResult("late"); } else { await showResult(\`day \${hour + 1}\`); }`);
  const emitted = actions(code);
  // No conversion action: the condition coerces the formatted date to a number.
  assert.deepEqual(emitted.slice(0, 3).map(a => a.WFWorkflowActionIdentifier), ["is.workflow.actions.date", "is.workflow.actions.format.date", "is.workflow.actions.conditional"]);
  const input = (emitted[2].WFWorkflowActionParameters.WFInput as PlistDictionary).Variable as PlistDictionary;
  assert.deepEqual((input.Value as PlistDictionary).Aggrandizements, [{ Type: "WFCoercionVariableAggrandizement", CoercionItemClass: "WFNumberContentItem" }]);
  const at = (hour: string) => evaluate(code, [], [], undefined, { natives: node => node.identifier.endsWith("format.date") ? hour : {} });
  assert.deepEqual([at("0"), at("5"), at("6"), at("21"), at("22"), at("23")].flat(), ["night", "night", "day 7", "day 22", "late", "late"]);
  // Templates are materialized once as Text; numbers pass through unchanged.
  const template = actions(source('const n = Number(`${await formatDate(await currentDate(), "H")}0`); if (n > 100) { await showResult("big"); }'));
  assert.equal(template[2].WFWorkflowActionIdentifier, "is.workflow.actions.gettext");
  assert.deepEqual(normalize(actions(source('const n = Number(7); if (n > 1) { await showResult("x"); }'))),
    normalize(actions(source('const n = 7; if (n > 1) { await showResult("x"); }'))));
  assert.throws(() => compile(source("const n = Number(true);")), /converts text or numbers only/);
  assert.throws(() => compile(source('const n = Number("1", "2" as never);')), /TS2554|takes one/);
});

test("openApp rejects dynamic or incomplete app descriptions", () => {
  assert.throws(() => compile(source('const id = "a.b"; await openApp({ bundleIdentifier: id, name: "A" });')), /static string/);
  assert.throws(() => compile(source('await openApp({ bundleIdentifier: "a.b" } as never);')), /requires bundleIdentifier and name/);
  assert.throws(() => compile(source('await openApp({ bundleIdentifier: "not an id", name: "A" });')), /bundle identifier/);
  assert.throws(() => compile(source('await openApp({ bundleIdentifier: "a.b", name: "A", extra: "x" } as never);')), /Unknown openApp field 'extra'/);
  assert.throws(() => compile(source('openApp({ bundleIdentifier: "a.b", name: "A" });')), /await openApp/);
});

test("Render template binding comes from the simulator editor; release reuses the Fire Event identity", () => {
  const reference = fixture("home-assistant-render-template-workflow.json");
  const dev = validateAppMetadata(JSON.parse(read("api/apps/home-assistant-dev-fire-event.json")));
  assert.deepEqual(bindAppWorkflow({ ...dev, bindings: {} }, reference).bindings.RenderTemplateIntent, dev.bindings.RenderTemplateIntent);
  assert.equal(typeof reference.WFWorkflowActions[0].WFWorkflowActionParameters.template, "string");
  const binding = release.bindings.RenderTemplateIntent;
  assert.equal(binding.identifier, "io.robbie.HomeAssistant.RenderTemplateIntent");
  assert.deepEqual(binding.defaults.AppIntentDescriptor, { ...release.bindings.FireEventIntent.defaults.AppIntentDescriptor as PlistDictionary, AppIntentIdentifier: "RenderTemplateIntent" });
  assert.deepEqual(release.metadata.actions, { FireEventIntent: (dev.metadata.actions as PlistDictionary).FireEventIntent, RenderTemplateIntent: (dev.metadata.actions as PlistDictionary).RenderTemplateIntent });
});

test("the Action Button example compiles to its recorded workflow and stays silent", () => {
  const compiled = compile(read(EXAMPLE), { filename: path(EXAMPLE), apps: [release] }).workflow.WFWorkflowActions;
  assert.deepEqual(normalize(compiled), normalize(fixture("action-button-workflow.json").WFWorkflowActions));
  const identifiers = compiled.map(a => a.WFWorkflowActionIdentifier);
  assert.ok(!identifiers.some(id => /showresult|alert|ask|notification|choosefrom|previewdocument/.test(id)));
  assert.equal(identifiers[0], "io.robbie.HomeAssistant.RenderTemplateIntent");
  assert.equal(identifiers.at(-1), "is.workflow.actions.vibrate");
  assert.equal(compiled[0].WFWorkflowActionParameters.template, "{{ is_state('media_player.spotify_kacper','playing') }}");
  assert.deepEqual(byId(compiled, "io.robbie.HomeAssistant.FireEventIntent").map(a => [a.WFWorkflowActionParameters.eventName, a.WFWorkflowActionParameters.eventData]),
    [["action_button", '{"mode":"spotify_pause"}'], ["action_button", '{"mode":"bedtijd"}']]);
  assert.ok(!JSON.stringify(compiled).includes("webhook"));
});

type Situation = { spotify: string; focus: string; lat?: number; lon?: number; orientation: string; hour: string };
function runExample(situation: Situation): string[] {
  const done: string[] = [];
  const ids: Record<string, string> = { Portrait: "0", "Landscape Left": "2", "Landscape Right": "3", "Face Up": "4", Unknown: "6" };
  const native = (node: NativeNode, readValue: (value: Value) => any): unknown => {
    const parameter = (key: string) => {
      if (node.parameters.kind === "literal") return (node.parameters.value as PlistDictionary)[key];
      const entry = node.parameters.kind === "parameter-object" ? node.parameters.entries.find(([k]) => k === key)?.[1] : undefined;
      return entry?.kind === "literal" ? entry.value : entry?.kind === "parameter-value" ? readValue(entry.value) : undefined;
    };
    const id = node.identifier.replace("is.workflow.actions.", "");
    switch (id) {
      case "io.robbie.HomeAssistant.RenderTemplateIntent": return situation.spotify;
      case "dnd.getfocus": return { Name: situation.focus };
      case "getcurrentlocation": return { Latitude: situation.lat, Longitude: situation.lon };
      case "com.apple.ShortcutsActions.GetOrientationAction": return ids[situation.orientation];
      case "date": return {};
      case "format.date": return situation.hour;
      case "gettext": return parameter("WFTextActionText");
      case "io.robbie.HomeAssistant.FireEventIntent": done.push(`event ${parameter("eventData")}`); return "";
      case "getdirections": done.push(`directions ${parameter("WFDestination")}`); return undefined;
      case "openapp": done.push(`open ${(parameter("WFSelectedApp") as PlistDictionary).Name}`); return {};
      default: done.push(id); return undefined;
    }
  };
  evaluate(read(EXAMPLE), [], [], native, { filename: path(EXAMPLE), apps: [release], natives: native });
  return done;
}

test("Action Button rules: the first matching rule wins, then a vibration", () => {
  const base: Situation = { spotify: "False", focus: "", orientation: "Portrait", hour: "12" };
  const WORK = { lat: 51.448972, lon: 5.4573266 }, HOME = { lat: 51.6671359, lon: 5.6309621 };
  const cases: [Partial<Situation>, string][] = [
    [{ spotify: "True", focus: "Driving", orientation: "Landscape Left", hour: "3" }, 'event {"mode":"spotify_pause"}'],
    [{ spotify: " true\n" }, 'event {"mode":"spotify_pause"}'],
    [{ focus: "Driving", ...WORK, orientation: "Landscape Right", hour: "23" }, "directions Wijsthoek 209, 5403 RB Uden"],
    // 0.89 km north and 0.97 km east of work are near; 1.11 km north is not.
    [{ focus: "Driving", lat: WORK.lat + 0.008, lon: WORK.lon }, "directions Wijsthoek 209, 5403 RB Uden"],
    [{ focus: "Driving", lat: WORK.lat, lon: WORK.lon + 0.014 }, "directions Wijsthoek 209, 5403 RB Uden"],
    [{ focus: "Driving", lat: WORK.lat + 0.01, lon: WORK.lon }, "directions Klokgebouw 234, 5617 AC Eindhoven"],
    [{ focus: "Driving", ...HOME }, "directions Klokgebouw 234, 5617 AC Eindhoven"],
    [{ focus: "Do Not Disturb", orientation: "Landscape Left", hour: "3" }, "orientationlock.set"],
    [{ orientation: "Landscape Right", hour: "23" }, "orientationlock.set"],
    [{ orientation: "Face Up", hour: "0" }, "flashlight"],
    [{ hour: "5" }, "flashlight"],
    [{ hour: "6" }, "open Ik weet wat ik eet"],
    [{ orientation: "Unknown", hour: "21" }, "open Ik weet wat ik eet"],
    [{ hour: "22" }, 'event {"mode":"bedtijd"}'],
    [{ hour: "23" }, 'event {"mode":"bedtijd"}'],
  ];
  for (const [change, expected] of cases) {
    assert.deepEqual(runExample({ ...base, ...change }), [expected, "vibrate"], JSON.stringify(change));
  }
});

test("the simulator probe compiles to the workflow imported on the iOS 26.5 simulator", () => {
  // AB-Probe2 was signed, imported through Files and read back from the simulator database.
  const name = "artifacts/action-button-probe.ts";
  const emitted = compile(read(name), { filename: path(name) }).workflow.WFWorkflowActions;
  const strict = (value: unknown, ids = new Map<string, string>()): unknown => Array.isArray(value) ? value.map(v => strict(v, ids))
    : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, strict(v, ids)]))
    : typeof value === "string" && /^[0-9A-F]{8}(?:-[0-9A-F]{4}){3}-[0-9A-F]{12}$/.test(value) ? (ids.has(value) || ids.set(value, `ID-${ids.size + 1}`), ids.get(value)) : value;
  assert.deepEqual(strict(emitted), strict(fixture("ios26-action-button-probe-actions.json").WFWorkflowActions));
});
