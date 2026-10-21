# Remaining work

Development paused at the user's request on 2026-10-19. The overall objective
remains: make everything Apple Shortcuts can do authorable in TypeScript.
The compiler already translates TypeScript directly to native actions.

## Resume here: finish counted-loop verification

- [x] Implement integer counted `for` loops, ascending/descending steps,
  inclusive/exclusive bounds, lexical scope, nested loops, `break`, `continue`
  and helper returns.
- [x] Add regression tests, a native workflow fixture and browser/Node parity coverage.
- [x] Run `npm run typecheck`, `npm test` (721 passed, zero failed),
  `npm run test:metadata` (4 passed), `npm run build:site`, plist lint and
  `git diff --check` successfully.
- [x] Run `examples/counted-loop-test.ts` as `TS-Counted-Loops` on the
  iPhone 17e iOS 26.5 simulator. All four outputs were observed in one run:
  `Ranges: 0,2,4,6,|5,3,1,|`, `Control: 0,2,3,4,; zero;2;3;`,
  `Nested: 11,13,end1;end2;31,33,end3;`, and
  `Helpers: 10,-1,30; scope 9`. Final Done returned to the editor with play
  available. Screenshots are `artifacts/ios-counted-loop-*.png`.
- [x] Compare the imported example's 637 actions with the generated workflow.
- [ ] Finish native invalid-range verification using
  `artifacts/counted-loop-guard-probe.ts`. It compiles/signs to
  `dist/TS-Counted-Loop-Guard.*` (58 actions), but has **not been run**.
  The file was downloaded in simulator Safari and reached the import preview
  before work stopped. Reopen the download and import it. Wait for the preview
  to stop scrolling before adding, then verify the editor name before running.
  Expected: an `Unsupported for loop range` alert for step zero; dismissing it
  must stop execution without either `ERROR` result appearing.
- [ ] Write `artifacts/counted-loop-verification.json` with the observed outputs,
  guard result, test counts, source/artifact hashes and simulator limitations.
- [ ] Add the completed native verification to README. Do not describe the guard
  as verified until it has actually run.

Generated `dist/` files are local build outputs. Recreate signed examples with:

```sh
npm run build
node lib/src/cli.js examples/counted-loop-test.ts --out dist/TS-Counted-Loops --name TS-Counted-Loops --sign --mode people-who-know-me
node lib/src/cli.js artifacts/counted-loop-guard-probe.ts --out dist/TS-Counted-Loop-Guard --name TS-Counted-Loop-Guard --sign --mode people-who-know-me
```

## Alarm sync (entityProperty + Home Assistant Fire Event)

- [x] `entityProperty(entity, "identifier")` with the editor's native property
  aggrandizement, generated `NativeEntityProperties`, tests and simulator probes.
- [ ] On the iPhone: install `dist/Wekkers-HA.shortcut` (Fire Event, release app)
  and run it once by hand. Answer the privacy prompts with "Always Allow", and check
  that the `iphone_wekkers` event arrives with the expected `alarms` data. Then
  attach the "Clock app is opened/closed" automation.
- [ ] Confirm the inferred release Fire Event binding. Export the shortcut after a
  device run, or build one with Fire event, and import it with
  `apps import ... --reference`. This also records the server entity's native
  shape; the build uses a placeholder server identifier.
- [ ] Not verified on any device yet: Find Alarms (`MTGetAlarmsIntent`) without an
  `AppIntentDescriptor` on iOS, the `repeatDays` text, number properties, and
  string properties with data. The simulator has no Clock app.
- [ ] Optional: make catalog "Find …" query actions return lists. 530 actions with
  `WFContentItemFilter` are currently typed as a single entity.

## Native action coverage — highest priority for the overall objective

- [ ] Expand typed parameters, enum values, result types, picker/entity encoding
  and practical examples across the action catalog. Its 2,585 metadata entries
  are not 2,585 runtime-verified actions.
- [ ] Track action verification by OS version and required installed app.
  Preserve `native()` access for actions without a dedicated typed wrapper.
- [ ] Extend opt-in app metadata/binding support beyond the Home Assistant
  prototype; verify each action's actual serialized parameters and outputs.
- [ ] Resolve the native Match Text wrapper's intent-resolution failure.
- [ ] Test representative workflows on a physical iPhone, including permissions,
  files, photos, contacts, app actions, signing and transfer.
- [ ] Document which automation triggers must still be configured in Shortcuts.

## TypeScript authoring gaps

- [ ] Add string `slice`, `substring` and `split`, preserving JavaScript UTF-16
  semantics or diagnosing cases the native representation cannot express.
- [ ] Add more array methods, safe indexing behavior and array mutation.
- [ ] Support nullable values, optional chaining and explicit runtime schema
  validation for external JSON where needed.
- [ ] Add object property mutation and destructuring assignment.
- [x] Add `while` conditions using self-invocation and JSON state, with nested
  loops, changing bounds, `break` and `continue`.
- [ ] Audit the existing main-return emitter: unlike the verified while runtime,
  it still encodes Stop and Output WFOutput as an attachment instead of a text token.
- [ ] Extend while boundaries to function-exiting returns, opaque native state
  and direct `input()` reads; investigate constant-stack execution.
- [ ] Investigate general `for` conditions and changing counted-loop bounds.
  Current counted loops require stable safe-integer start/bound/step values and
  a step toward the boundary; body updates to the counter are rejected.
- [ ] Resolve native nested-array handling before enabling matrices: previous
  native tests hit a `WFContentCollection` exception. Flat lists are supported.
- [ ] Assess function values, broader closures, argument spreads and error
  handling against what can faithfully execute as native Shortcuts actions.
  Full JavaScript/npm runtime compatibility remains outside current support.

## Efficiency and release readiness

- [ ] Reduce generated action counts through safe constant folding, redundant
  action removal and shared lowering improvements; preserve evaluation order.
- [ ] Benchmark long text operations and larger loops on a physical device.
- [ ] Expand native regression coverage alongside pure compiler tests; generated
  workflow equality alone does not prove native execution works.
- [ ] Keep browser compilation, CLI compilation and documentation synchronized.

## Verification notes

- Latest full test log: `/tmp/shortcuts-counted-loop-final-tests.log` (local,
  temporary; rerun checks after future changes).
- Native tests so far primarily use iPhone 17e, iOS 26.5 simulator
  `326EA910-2DC8-45AA-A44C-8A9A1377F3E6`.
- Between result dialogs, `agent-device snapshot -i --observe-only` avoids
  unnecessary activation of ShortcutsUI. An observation timeout is not proof
  the shortcut stopped: inspect/poll the existing run before restarting.
- Existing text-position and text-predicate verification manifests record the
  earlier completed native runs and their limitations.
