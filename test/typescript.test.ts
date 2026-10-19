import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { compile } from "../src/compiler.js";
import { migrateLegacyTextEquality } from "./support/legacy-text-equality.js";

function normalize(value: unknown, ids = new Map<string, string>()): unknown {
  if (Array.isArray(value)) return value.map(item => normalize(item, ids));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, key === "WFWorkflowName" ? "Shortcut" : normalize(item, ids)]));
  }
  if (typeof value === "string" && /^[0-9A-F]{8}(?:-[0-9A-F]{4}){3}-[0-9A-F]{12}$/.test(value)) {
    if (!ids.has(value)) ids.set(value, `ID-${ids.size + 1}`);
    return ids.get(value);
  }
  return value;
}

test("typed input retains the verified workflow with the explicit text-equality backend migration", () => {
  const source = readFileSync(new URL("../../examples/visible-test.ts", import.meta.url), "utf8");
  // Captured from the JS prototype that passed all three simulator cases.
  const fixture = JSON.parse(readFileSync(new URL("../../test/fixtures/ios26-visible-workflow.json", import.meta.url), "utf8"));
  assert.deepEqual(normalize(compile(source).workflow), migrateLegacyTextEquality(fixture));
});

test("nested loops retain the iOS fixture with the explicit text-equality migration", () => {
  const source = readFileSync(new URL("../../examples/loops-test.ts", import.meta.url), "utf8");
  const fixture = JSON.parse(readFileSync(new URL("../../test/fixtures/ios26-loops-workflow.json", import.meta.url), "utf8"));
  assert.deepEqual(normalize(compile(source).workflow), migrateLegacyTextEquality(fixture));
});

test("HTTP and JSON emit the workflow verified on iOS 26.5", () => {
  const source = readFileSync(new URL("../../examples/http-json-test.ts", import.meta.url), "utf8");
  const fixture = JSON.parse(readFileSync(new URL("../../test/fixtures/ios26-http-workflow.json", import.meta.url), "utf8"));
  assert.deepEqual(normalize(compile(source).workflow), migrateLegacyTextEquality(fixture));
});

for (const [example, fixture] of [
  ["toolkit-test", "ios26-toolkit-workflow"],
  ["toolkit-edge-test", "ios26-toolkit-edges-workflow"],
  ["functions-test", "ios26-functions-workflow"],
  ["control-flow-test", "ios26-control-flow-workflow"],
  ["array-methods-test", "ios26-array-methods-workflow"],
  ["switch-numeric-test", "ios26-switch-numeric-workflow"],
  ["dictionaries-test", "ios26-dictionaries-workflow"],
  ["catalog-actions", "ios26-catalog-actions-workflow"],
  ["text-comparisons-test", "ios26-text-comparisons-workflow"],
  ["switch-test", "ios26-switch-text-workflow"],
  ["dynamic-text-test", "ios26-dynamic-text-workflow"],
  ["array-search-test", "ios26-array-search-workflow"],
  ["flow-callbacks-test", "ios26-flow-callbacks-workflow"],
  ["dynamic-objects-test", "ios26-dynamic-objects-workflow"],
  ["json-conversion-test", "ios26-json-conversion-workflow"],
  ["request-json-test", "ios26-request-json-workflow"],
  ["string-methods-test", "ios26-string-methods-workflow"],
] as const) {
  test(`${example} retains the verified workflow with any legacy text-equality migration`, () => {
    const source = readFileSync(new URL(`../../examples/${example}.ts`, import.meta.url), "utf8");
    const expected = JSON.parse(readFileSync(new URL(`../../test/fixtures/${fixture}.json`, import.meta.url), "utf8"));
    assert.deepEqual(normalize(compile(source).workflow), migrateLegacyTextEquality(expected));
  });
}

test("type aliases, interfaces, type-only imports and satisfies are erased directly", () => {
  const typed = `import { askText, showResult, type ShortcutText } from "@js-shortcuts/ios";
    interface Metadata { title: string }
    type Name = ShortcutText;
    export default async function main(): Promise<void> {
      const name: Name = await askText("Name?");
      const message = (name satisfies string) as string;
      await showResult(message);
    }`;
  const plain = `import { askText, showResult } from "@js-shortcuts/ios";
    export default async function main() {
      const name = await askText("Name?");
      const message = name;
      await showResult(message);
    }`;
  assert.deepEqual(normalize(compile(typed).workflow), normalize(compile(plain, { filename: "legacy.js" }).workflow));
});

test("TypeScript checks inferred action output against explicit annotations", () => {
  assert.throws(() => compile(`import { askText } from "@js-shortcuts/ios";
export default async function main(): Promise<void> {
  const name: number = await askText("Name?");
}`, { filename: "bad.ts" }), /bad\.ts:3:\d+: TS2322: Type 'string' is not assignable to type 'number'/);
});

test("action API rejects incorrect asserted argument types", () => {
  assert.throws(() => compile(`import { askText, showResult } from "@js-shortcuts/ios";
export default async function main() {
  const name = await askText("Name?");
  await showResult(name as unknown as boolean);
}`), /TS2345.*boolean/);
});

test("unknown types and incompatible async return declarations are errors", () => {
  assert.throws(() => compile(`import { showResult } from "@js-shortcuts/ios";
export default async function main() { const text: MissingType = "hi"; await showResult(text); }`), /TS2304.*MissingType/);
  assert.throws(() => compile(`import { showResult } from "@js-shortcuts/ios";
export default async function main(): Promise<number> { await showResult("hi"); }`), /TS2355/);
});

test("type-only action imports cannot turn into runtime calls", () => {
  assert.throws(() => compile(`import type { showResult } from "@js-shortcuts/ios";
export default async function main() { await showResult("hi"); }`), /Only imported Shortcuts actions/);
});

test("unsupported runtime TypeScript is rejected instead of being erased", () => {
  assert.throws(() => compile(`import { showResult } from "@js-shortcuts/ios";
enum Color { Red }
export default async function main() { await showResult("hi"); }`), /module level/);
});

test("syntax errors retain the original TypeScript filename and line", () => {
  assert.throws(() => compile('export default async function main() {\n const name: = "x";\n}', { filename: "broken.ts" }), /broken\.ts:2:\d+: TS/);
});

test("CLI stops on a type error before writing artifacts or invoking signing", () => {
  const dir = mkdtempSync(join(tmpdir(), "ts-shortcuts-test-"));
  try {
    const input = join(dir, "invalid.ts");
    const output = join(dir, "invalid");
    writeFileSync(input, `import { askText } from "@js-shortcuts/ios";
export default async function main() { const value: number = await askText("Name?"); }`);
    const result = spawnSync(process.execPath, ["lib/src/cli.js", input, "--out", output, "--sign"], { encoding: "utf8" });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /TS2322/);
    assert.doesNotMatch(result.stdout, /Signing/);
    assert.equal(existsSync(`${output}.unsigned.plist`), false);
    assert.equal(existsSync(`${output}.shortcut`), false);
    assert.equal(existsSync(join(dir, "invalid.js")), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
