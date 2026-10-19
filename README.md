# TypeScript → Apple Shortcuts

Write TypeScript and compile it directly to native Shortcuts actions. The source
is parsed and type-checked, never executed during compilation. The pipeline is
TypeScript AST → typed intermediate representation → native workflow → optional
Apple signing. There is no JavaScript intermediate for your shortcut.

The toolkit provides:

- TypeScript constructs and convenient typed action functions for everyday code.
- Category functions for every catalog action: `LLM.ask({...})`,
  `Text.replace({...})`, `Clipboard.get({...})`, and app-specific categories.
- `actions["identifier"]<T>(parameters)` for catalog actions, with parameter-key
  checks and editor completion.
- `native<T>(identifier, parameters)` for arbitrary native/system/app action
  identifiers, with helpers for their serialized parameters.

The catalog contains **2,585 action metadata entries**, with identifier autocomplete,
search and optional parameter-key hints. This is not a claim that 2,585 actions
have been tested. It includes iOS 27/macOS 27 metadata, internal entries and
platform-specific actions. Device support, installed apps, permissions and the
correct native parameter/intent structure still determine whether an action runs.

## Start

Requires Node.js 22+. Signing and binary plist import require macOS.

```sh
npm ci
npm run typecheck
npm test
npm run build:toolkit

# Compile your own source:
npm run shortcut -- examples/toolkit-test.ts --out dist/my-shortcut

# Produce an importable file using private sharing:
npm run shortcut -- examples/toolkit-test.ts --out dist/my-shortcut --sign --mode people-who-know-me
```

Compilation writes `.unsigned.plist` and `.json` (workflow, IR and source locations).
Signing adds `.shortcut`. Public signing uses `--mode anyone` (the default).
Private sharing includes the signer's identity; on the receiving device, enable
Private Sharing and add the signer's Apple-account email to Contacts. Public
signing returned Apple service errors 500/502 on the development Mac; private
signing succeeded. Failed signing preserves any previous signed file.
Signing uses the system temporary directory before copying the signed result to
the output volume. This avoids Apple's signing service failing to save directly
into a project on an external volume ("signed.shortcut couldn't be saved").

To compile, sign, and transfer a shortcut to your phone with one command:

```sh
npm run shortcut -- examples/mijn-script.ts --share
```

`--share` includes signing and defaults to `people-who-know-me`. It detects a LAN
IPv4 address, chooses a free port, and prints a QR code and download link. Connect
your iPhone to the same Wi-Fi, scan the QR, and open the downloaded `.shortcut`
file from Safari Downloads or Files to add it to Shortcuts. Private sharing may
need to be enabled in the receiving device's Shortcuts settings.

The CLI also prints a browser QR-page link and saves `dist/mijn-script.share.html`
(or `<output>.share.html` with `--out`). Keep the command running while downloading;
Ctrl+C stops the server. Only the signed file from that run is served, along with
its QR page. This is a local transfer link, not a persistent iCloud sharing link.

Override the address or port when needed, for example when a VPN is active:

```sh
npm run shortcut -- examples/mijn-script.ts --share --host 192.168.1.164 --port 8765
```

Use `--mode anyone` to request public signing instead. Signing must succeed before
the server starts; a signing failure never shares an older or unsigned file.

### Auto-update during development

```sh
npm run shortcut -- examples/mijn-script.ts --dev --ssid "My Wi-Fi"
```

`--dev` does everything `--share` does, then keeps watching the source file. Each
save recompiles, re-signs and publishes the new build on the same URL. A dev build
starts with a short check: it fetches `version.json` from this server, and if the
build differs it opens the download link and stops. Open the downloaded file and
choose **Replace Shortcut**. Shortcuts always asks before replacing a shortcut, so
the update needs that one confirmation.

- `--ssid` limits the check to one Wi-Fi network. Without it, the shortcut also
  checks elsewhere and fails when this server is unreachable. macOS hides the
  current network name, so it can't be detected automatically.
- The token and port are saved in `<output>.dev.json` and reused, so an installed
  dev build keeps working after restarting `--dev`. Delete that file, or pass a
  different `--port`, and you'll need to reinstall from the new QR code.
- A failed build is reported and the previous build stays published.
- The check is only added with `--dev`. Build without it before sharing a shortcut
  with others.

`@js-shortcuts/ios` is a compiler intrinsic, not an npm package to install.
Include `api/ios.d.ts` in your authoring project's tsconfig, as demonstrated in
`examples/tsconfig.json`. It references the generated action catalog declarations.
The compiler itself is built to Node.js under `lib/` using the TypeScript 6 API.

## Optional app types (Home Assistant prototype)

App types are opt-in and can be shared without installing the app on the authoring
machine. Import compiler-generated `Metadata.appintents/extract.actionsdata` from
an iOS `.app` / `.appex` or a macOS `.app` bundle on macOS:

```sh
npm run shortcut -- apps import /path/to/HomeAssistant.app \
  --name HomeAssistant --out api/apps/my-home-assistant \
  --reference /path/to/reference-workflow.plist
```

This creates a portable `.json` manifest and editor declarations in `.d.ts`.
Choose a new output name when importing another version; existing files are never
overwritten. Import each extension or Watch bundle separately, under its own
namespace, rather than merging different bundle identities.

The manifest retains metadata, bundle/version and the metadata SHA-256. Types
cover strings, booleans, numbers, enums, arrays and branded opaque app entities.
Unsupported types remain `NativeContent`. Entity properties are not exposed as
JavaScript dictionary fields. Availability annotations, defaults and numeric
ranges remain in the metadata; they are not runtime validation.

Metadata alone does not prove a Shortcuts action's identifier or serialized
parameters. `--reference` reads an unsigned XML/binary plist or inspection JSON
from a native shortcut and copies only the matching action identifier and
`AppIntentDescriptor`. It does not copy server selections or other parameter
values. A signed/encrypted `.shortcut` must first be imported into Shortcuts and
its native workflow extracted. Omit `--reference` for type generation alone;
compiling an action without a native binding fails explicitly. Other actions need
their own reference, and a confirmed descriptor does not establish that every
parameter encoding or result type has been executed on-device.

A built Home Assistant development snapshot is included:

```sh
npm run shortcut -- examples/apps/home-assistant-brightness.ts \
  --app api/apps/home-assistant-dev.json \
  --out dist/home-assistant-brightness
```

```ts
/// <reference path="../../api/apps/home-assistant-dev.d.ts" />
import { HomeAssistant, raw } from "@js-shortcuts/ios";

export default async function main(): Promise<void> {
  await HomeAssistant.setBrightness({
    light: raw({ Value: { Type: "Ask" }, WFSerializationType: "WFTextTokenAttachment" }),
    brightness: 50,
  });
}
```

Include the generated `.d.ts` in your tsconfig or via a reference directive for
editor completion. Pass `--app` for compilation (repeat it for multiple apps), or
pass manifests as `compile(source, { apps: [...] })`. Restart `--dev` after changing
an app manifest. The web visualizer does not load optional app manifests yet.

The included snapshot has **64 actions and one native binding**, for
`SetBrightnessAppIntent`, from Home Assistant commit
`906aae66d977b3a1e560c9a17b9deab9c6e149bd`. It targets
`io.robbie.HomeAssistant.dev`, **not the App Store app**. Its sample asks for the
light at runtime; `"light.globe"` alone is not a serialized Home Assistant entity.
A phone export with `light.globe` selected and brightness 50 now confirms the
release identity and selected entity (see the release binding below). The user confirmed that the generated shortcut works on their iPhone for
`light.globe` at 50%; this is user-reported execution evidence.
The generated shortcut was publicly signed and imported into the iOS 27 simulator;
its saved action matches the compiler output exactly and the editor shows 50%.
This verifies import/recognition, not a server call. See
`artifacts/home-assistant-verification.json` for build and simulator evidence.
The upstream Apache-2.0 license is preserved in `api/apps/home-assistant-LICENSE.txt`.

A release binding is now also available in `api/apps/home-assistant-release.json`
(namespace `HomeAssistantRelease`). It contains only `setBrightness`, with the
production app identifier and descriptor verified against a phone export. Its
parameter types come from the development build above; the installed release
version is unknown. The exported lamp selection is kept in ignored local test
files, not in this manifest. Use `--app api/apps/home-assistant-release.json` and
include its companion `.d.ts` when writing a shortcut for the release app.
The generated 50% test was publicly signed, its download verified, and its
execution on the configured iPhone confirmed by the user.

## Visualize compiled blocks

Online: https://kacper-serewis.github.io/ts-apple-shortcuts/

```sh
npm run visualize   # http://localhost:5173 (--port to change)
npm run build:site  # static build in site/, as deployed to GitHub Pages
```

A web page with a TypeScript editor next to the compiled actions,
rendered as indented Shortcuts-style blocks. It recompiles as you type. Clicking
a block highlights the source line that produced it, and moving the cursor
highlights that line's blocks. Clicking a variable pill jumps to the action that
produced the value. Compile errors mark the offending line and dim the last good
output. Tabs show the raw workflow JSON and IR, and you can download the unsigned
plist. Examples from `examples/` load from the dropdown. The compiler runs
entirely in the browser with an in-memory file host, so the site is static; nothing
runs on a device. Pushes to `main` deploy it through `.github/workflows/pages.yml`.

## Write a shortcut

```ts
import { askNumber, showResult, repeat, menu } from "@js-shortcuts/ios";

export default async function main(): Promise<number> {
  const amount = await askNumber("Startbedrag?");
  let total = amount;

  for (const extra of [2, 3, 5]) {
    total += extra;
  }
  await repeat(2, async () => {
    total += 10;
  });

  if (total >= 20) {
    await showResult(`Totaal: ${total}`);
  }
  await menu("Wat wil je zien?", {
    Totaal: async () => { await showResult(total); },
    Bericht: async () => { await showResult("Klaar"); },
  });
  return total;
}
```

| Language feature | Native behavior |
| --- | --- |
| Strings, finite numbers, booleans | Text/number/boolean values |
| Templates and text/number `+` | Native text tokens; UTF-16 attachment positions |
| String `trim` / `trimStart` / `trimEnd`, case conversion, `concat`, `startsWith` / `endsWith` / `includes` | Native text actions; literal case-sensitive search and ECMAScript whitespace trimming |
| String `replace(search, replacement)` | First literal match; JavaScript replacement templates with captured input values |
| String `replaceAll(search, replacement)` | Every non-overlapping literal match; original prefix/suffix per match; see empty-search Unicode limit below |
| `+`, `-`, `*`, `/`, `%`, `**`, unary `-` on numbers | Calculate actions, including scientific operands |
| `Math.abs/sign/min/max/floor/ceil/trunc/round/pow/sqrt` and eight Math constants | Native calculations and numeric conditions; finite-number subset |
| `const`, initialized `let`, lexical blocks | Immutable references or scoped native variables |
| `=`, `+=`, `-=`, `*=`, `/=`, statement `++`/`--` on `let` | Read/assign native variables; reads snapshot their value |
| Object literals, named fields and static string brackets | Dictionary construction and Get Dictionary Value |
| Existing objects and flat lists as object literal fields | Native JSON composition preserves container shape, including empty/single-item lists |
| `{ ...base, field: value, ...overrides }` | Copy JSON fields; later entries win without modifying the source |
| `JSON.stringify`, `stringifyJson`, typed `parseJson<T>` | Native JSON text conversion with scalar/object/flat-array roots |
| Dictionary helpers with runtime keys | Native lookup, immutable update, all keys and all values |
| Object/array destructuring in declarations, loop bindings and parameters | Dictionary fields and list indices; source evaluated once |
| Homogeneous arrays, object arrays and arrays inside dictionary fields | Native List/Dictionary values; see the matrix limitation below |
| Existing objects in arrays and `[first, ...items, last]` | Native JSON composition preserves flat list order, empty segments and object fields |
| Array `slice(start?, end?)` and `concat(...items)` | Native range selection with normalized bounds; JSON-compatible concatenation |
| Array `join(separator?)` | Native text accumulation; preserves empty entries and renders booleans as true/false |
| `items[index]`, `items.length` | Literal or computed zero-based index → one-based native index; Count Items |
| Nested `for (const item of items)` | Repeat with Each, preserving outer-item references |
| Unlabeled `break` / `continue` in `for…of` | Scoped guards skip remaining loop body actions or iterations |
| `map`, `filter`, `reduce`, `forEach` with synchronous arrow callbacks | Repeat with Each; collected outputs or scoped accumulation |
| `some`, `every`, `findIndex`, scalar `includes` / `indexOf` | Guarded native iteration; first decisive result |
| `repeat(n, async index => { ... })` | Repeat Count with optional zero-based index; nonpositive dynamic counts are skipped |
| `if/else if/else`, comparisons, `!`, boolean `&&`/`||` | Native branches; short-circuit evaluation |
| `switch`, `case`, `default`, fallthrough and unlabeled `break` | Native conditions select the first matching case and guard the remaining bodies |
| Boolean comparison expressions and `condition ? a : b` | Deferred branches and a temporary result variable |
| `menu(prompt, { Label: async () => { ... } })` | Choose from Menu with native case groups |
| `return` in repeat/menu callbacks | Scoped exit from that invocation; subsequent iterations and caller continue |
| `return value` / `return` in main | Stop and Output / Stop This Shortcut |
| Named module-level functions and async functions | Inline native actions with isolated parameters and local return values |
| `input<T>()` | Shortcut Input variable |
| Type annotations, aliases, interfaces, assertions, `satisfies` | Checked and erased; cannot enable unsupported runtime syntax |

Text equality uses `===`/`!==` between string values with an escaped,
case-sensitive anchored regex. Both operands may be runtime text, templates,
field reads or awaited action/helper results. They are evaluated once, left to
right. Runtime right-hand text is escaped on-device before constructing the
anchored pattern; regex characters remain literal. Constant right-hand text keeps
the shorter existing compilation path. Numeric comparisons support both operands as
values. Conditions require booleans or explicit comparisons; arbitrary JS
truthiness is not implemented. Numeric calculations and formatting use native
Shortcuts behavior, not a complete JavaScript number runtime.

In loop bodies, `break` and `continue` target the innermost `for…of` loop in the same function.
Inside a `switch`, `break` exits that switch; `continue` still targets the nearest
enclosing loop. An inner loop owns its own `break` and `continue`.
Nested loops have independent state, and code after the loop continues normally.
They compose with helper returns and with loops inside menu/repeat callbacks;
jumps cannot cross a function or callback boundary. Native repeats still visit
remaining iterations after `break`, but guards skip their bodies, so a large list
can cost time even after breaking.

List indices can come from variables, arithmetic, loop items or awaited actions.
The index expression is evaluated once. Supply a nonnegative integer within the
list bounds: invalid literal indices are rejected at compile time, but dynamic
indices are not bounds-checked. Invalid dynamic indices follow native Shortcuts
behavior, which is not JavaScript's `undefined` behavior. See the device-tested
`examples/control-flow-test.ts`, or compile it with `npm run build:control`.

## Choose with switch

```ts
switch (command) {
  case "open":
    await showResult("Openen");
    // No break: also execute the next case's body.
  case "run":
    await showResult("Uitvoeren");
    break;
  default:
    await showResult("Onbekende opdracht");
}
```

The discriminant is evaluated once. Case expressions are tested in order until
the first match, before any case body runs. If no case matches, `default` runs
wherever it appears in the source; without a default, no body runs. Cases fall
through unless they break, return or continue an enclosing loop. Nested switches
have independent state, including inside loops, helpers and array callbacks.

Switches accept text, numbers or booleans. Case expressions may include awaited
actions or helper calls and must match the discriminant's value category. Text
cases support runtime strings and use case-sensitive literal matching. A case
expression after the first match is skipped even if execution falls through into
that case's body. Object identity matching and labeled breaks are not supported.
Use braces around cases with local
bindings when they need independent scopes; direct case declarations share one
switch scope, with normal TypeScript initialization checks.

```ts
const expected = await askText("Verwachte opdracht?");
const command = await askText("Opdracht?");
if (command === expected) { await showResult("Gelijk"); }
switch (command) {
  case expected: await showResult("Gevonden"); break;
  default: await showResult("Onbekend");
}
```

See `examples/dynamic-text-test.ts` or run `npm run build:dynamic-text` for runtime
text equality and dynamic cases with side effects and fallthrough.

Run `npm run build:switch` to compile `examples/switch-test.ts`.
Both this combined text/numeric example and the numeric-only example
(`npm run build:switch-numeric`) passed on the iOS 26.5 simulator. Text equality
now uses anchored, case-sensitive **Replace Text**, avoiding a native Match Text
intent failure. The successful text switch includes fallthrough, default selection,
loop control and helper return; see `artifacts/text-equality-verification.json`.

## Reuse logic with functions

```ts
import { showResult } from "@js-shortcuts/ios";

function firstPositive(items: number[]): number {
  for (const item of items) {
    if (item > 0) { return item; }
  }
  return -1;
}

async function describe(items: number[]): Promise<string> {
  return `Eerste: ${firstPositive(items)}`;
}

export default async function main(): Promise<void> {
  await showResult(await describe([-2, 0, 7, 9]));
  await showResult("De shortcut gaat door");
}
```

Helpers are named function declarations at module level. Their bodies compile
inline at each call site; only called helpers generate actions. Arguments are
evaluated once, from left to right, and parameter assignments use separate native
variables. Helpers see their own lexical scope, not local variables in the caller.
Async helpers must be awaited. Synchronous helpers can be called in expressions
or as statements. Supported return values include scalars, typed objects/lists
and opaque native content; `void` helpers are supported too.

`return` inside a helper returns to its caller, including inside branches and
nested `for…of` loops. It does not stop the shortcut. Returns from main retain
their native Stop/Output behavior. Native repeats still visit the remaining
iterations after an early helper return, with guards skipping their bodies;
large lists can therefore cost time even after finding a result.

Parameters may be identifiers or object/array binding patterns. Defaults, optional/rest
parameters, generics, recursion, nested function declarations,
closures and function values are not yet supported. Existing limitations on
value types and object/list mutation also apply inside helpers. See
`examples/functions-test.ts` for the device-tested example:

```sh
npm run build:functions
```

## Unpack objects and lists

```ts
const profile = { name: "Ada", scores: [7, 9], details: { city: "Amsterdam" } };
const { name: label, scores: [first, second], details: { city } } = profile;
let [total, , bonus] = [1, 2, 3];
total += bonus;
await showResult(`${label}: ${first}/${second}, ${city}; totaal ${total}`);

for (const { name, score } of [{ name: "Ada", score: 7 }]) {
  await showResult(`${name}: ${score}`);
}
```

Destructuring supports `const`/`let`, nested patterns, property aliases and skipped
array entries. It also works in helper and array-method parameters, such as
`rows.map(({ score }) => score * 2)`. Initializers and arguments are evaluated
once; bindings are read in source order. Mutable bindings and parameter assignments
are isolated from their source object/list. Names retain lexical scope and cannot
be read before their declaration.

Constant tuple indices and tuple patterns retain each element's type, including
heterogeneous readonly tuples. Array patterns require lists; object patterns
require typed dictionaries. Defaults, rest bindings, computed keys, dotted literal
keys, optional fields/elements and destructuring assignments are not supported.
List bounds follow the indexing rules above. Compile the complete example with
`npm run build:destructuring` (`examples/destructuring.ts`). This example has
compiler and IR behavior coverage; it has not been run on a device.

## Repeat and menu callbacks

```ts
await repeat(4, async index => {
  if (index === 1) { return; }
  await showResult(index); // 0, 2, 3
});
await menu("Choose", {
  Skip: async () => { return; },
  Show: async () => { await showResult("Selected"); },
});
await showResult("Continues after either choice");
```

These callbacks are inline async arrows with braced bodies. `repeat` accepts an
optional index parameter starting at zero; assigning to the parameter does not
change the next iteration's index. The count is evaluated once, before entering
the callback scope. Each nested repeat has its own index and return state.

A callback `return` exits just that invocation: the next repeat iteration still
runs, and execution after a menu continues normally. Returns inside nested
`for…of` loops or switches follow the same rule. `return await showResult(...)`
preserves the awaited action before exiting. Callback results must be void;
they do not supply a Repeat Results value. Defaults, rest parameters, generics,
function references and expression-bodied callbacks remain unsupported. A
`break` or `continue` cannot target a loop across a callback boundary.

See `examples/flow-callbacks-test.ts`, or run `npm run build:flow-callbacks`.
Both menu branches were verified on iOS, including zero-count repeats and
mutated index parameters. As with helper returns, native loops already in
progress traverse any remaining guarded iterations without running their bodies.

## Transform lists

```ts
import { showResult } from "@js-shortcuts/ios";

export default async function main(): Promise<void> {
  const rows = [{ name: "Ada", score: 2 }, { name: "Kacper", score: 5 }];
  const selected = rows
    .map(row => ({ name: row.name, score: row.score * 2 }))
    .filter(row => row.score > 4);
  const total = selected.reduce((sum, row) => sum + row.score, 0);
  await showResult(total);
}
```

`map`, `filter` and `forEach` accept `(item, index, originalArray)`; `reduce`
accepts `(accumulator, item, index, originalArray)` plus a required initial value.
Unused trailing parameters may be omitted. Indexes start at zero. The receiver
and initial accumulator are evaluated once, and callbacks run in source order.
An empty `reduce` returns its initial value without calling the callback.

Callbacks must be inline synchronous arrows, with an expression or braced body.
They can read captured variables, update captured `let` variables, call synchronous
helpers, and return early. Parameter reassignment stays local to that invocation;
`filter` keeps the original item. Nested list methods and chained operations are
supported. `forEach` ignores return values and a callback `return` does not stop
the shortcut or remaining callbacks.

`map` returns one scalar, dictionary or native item per iteration; nested-array
outputs are rejected because native Repeat Results would flatten them. Native
content must represent one item per mapping result. `filter` requires an actual
boolean result. `reduce` preserves the accumulator's value category. Callbacks
cannot be async or passed as function values; `thisArg`, optional/rest/default
parameters and array/object mutation remain unsupported. Use `for…of` when each
iteration needs awaited actions.

On iOS, the example verifies numeric results, dictionary outputs, skipped filter
items, early `forEach` returns, empty arrays, seeded empty reductions, and empty
text entries retaining their item count. Run it with `npm run build:arrays`;
source: `examples/array-methods-test.ts`.

## Search lists

```ts
const scores = [2, 4, 2, 6];
const hasHigh = scores.some(score => score > 5); // true
const allPositive = scores.every(score => score > 0); // true
const firstHigh = scores.findIndex(score => score > 3); // 1
const containsTwo = scores.includes(2); // true
const lastTwo = scores.indexOf(2, -2); // 2
```

`some`, `every` and `findIndex` accept inline synchronous arrow callbacks with
`(item, index, originalArray)` parameters and require a boolean return value.
They share the callback features described above, including destructuring,
captured variables, nested searches and early local returns. Further callbacks
are skipped as soon as the answer is known. `findIndex` returns the original
zero-based position even if the callback reassigns its index parameter. Empty
lists return `false`, `true` and `-1`, respectively, without calling the callback.

`includes` and `indexOf` search homogeneous lists of text, numbers or booleans.
The receiver, search value and optional start position evaluate once, in that
order, including for empty arrays and ignored results. Text matching
is exact, including empty text and regex-like characters. Object identity and
mixed-category lists are unsupported. An optional `fromIndex` accepts finite
constants or runtime numbers: fractions truncate toward zero, negative positions
count from the end, and out-of-range starts follow JavaScript behavior. A start
before the beginning searches the whole list; a start at/past its length returns
`false` or `-1`. Later argument effects cannot replace the already-captured
receiver or search value. Native calculations normalize runtime starts; constant
starts keep their existing shorter compilation. NaN/Infinity, explicit undefined,
implicit numeric coercion and argument spreads remain unsupported.

Shortcuts still traverses the remaining guarded iterations after finding a result;
it does not invoke additional callbacks or comparisons. This preserves effects
but adds native loop overhead for long lists. Run `npm run build:array-search`
for the simulator-verified example in `examples/array-search-test.ts`.
Run `npm run build:array-offset` for runtime start positions in
`examples/array-offset-test.ts`.

## Calculate with Math

```ts
const rounded = [1.2, -1.8, 2.5].map(n => Math.round(n));
const largest = rounded.reduce((best, n) => Math.max(best, n), -100);
const area = Math.PI * Math.pow(3, 2);
await showResult(`${largest}; ${Math.round(area)}`);
```

Supported global functions are `Math.abs`, `Math.sign`, `Math.min`, `Math.max`,
`Math.floor`, `Math.ceil`, `Math.trunc`, `Math.round`, `Math.pow` and `Math.sqrt`.
They compile to native Calculate actions and numeric conditions. Calls are
synchronous, support chaining/composition, and evaluate arguments once from left
to right. `min`/`max` accept one or more numeric arguments. Other functions accept
one argument, except `pow(base, exponent)`. Static bracket calls such as
`Math["sqrt"](81)` also work.

The constants `Math.E`, `Math.PI`, `Math.LN2`, `Math.LN10`, `Math.LOG2E`,
`Math.LOG10E`, `Math.SQRT1_2` and `Math.SQRT2` become numeric literals. Local
variables, parameters, helpers and imports named `Math` shadow the intrinsic.
Function aliases, computed member names, argument spreads, optional access,
implicit number coercion and other Math methods are not supported yet.

Rounding follows floor/ceiling/truncation rules; `round` resolves halfway cases
toward positive infinity, including `Math.round(-1.5) === -1`. The compiler uses
integer/remainder decomposition instead of native default rounding or adding
`0.5` to the input. Positive and negative cases were verified on iOS; adjacent
floating-point and large-value cases also have compiler/IR regression coverage.

This is a **finite-number subset**, subject to native numeric precision, range
and formatting. IEEE-754 equivalence for every value, `NaN`, infinities and
signed zero are not promised. Empty `min()`/`max()` calls and known negative
`sqrt` inputs are rejected. Runtime inputs must produce finite valid results;
domain/overflow failures follow native behavior rather than JS special values.
There is no runtime domain validator. Run `npm run build:math` for the
simulator-verified example in `examples/math-test.ts`.

## Transform and search text

Standard string methods compile directly into native text actions:

```ts
const name = "  Ada  ".trim().toUpperCase();
const label = name.concat("/", "typescript");
if (label.startsWith("ADA") && label.includes("script")) {
  await showResult(label);
}
const tags = [" TS ", "IOS"].map(tag => tag.trim().toLowerCase());
```

Supported methods are `trim()`, `trimStart()`, `trimEnd()`, `toUpperCase()`,
`toLowerCase()`, `concat(...texts)`, `startsWith(text)`, `endsWith(text)` and
`includes(text)`. They are synchronous and can be chained, used in conditions,
passed through helpers or called inside array callbacks. Receiver and arguments
are evaluated once in source order, including when the result is ignored.
String and array `includes` are selected by the receiver type.

Search is literal and case-sensitive: regex characters in the needle are
escaped, and an empty needle matches even an empty receiver. Accents and Unicode
normalization forms remain distinct. Search currently accepts one text argument;
optional position/end-position arguments and RegExp arguments are unsupported.
String `indexOf`, `slice`, `substring`, `split`, and `length` are not
implemented yet; explicit `splitText`/`replaceText` actions remain available.
`concat` accepts text arguments without implicit coercion or argument spreads.

Trimming uses the ECMAScript whitespace set, including BOM and nonbreaking
space, while preserving NEL and zero-width space. Case conversion uses the OS's
native Unicode casing tables. The iOS 26.5 verification includes sharp s, dotted
capital I, Greek final sigma, accents and empty text; locale-specific methods
and exact casing equivalence across different Unicode/OS versions are not
promised. Literal strings retain the compiler's plist character restrictions.

Run `npm run build:strings` for `examples/string-methods-test.ts`, which was
executed on the iOS simulator.

## Replacing the first text match

```ts
const once = "aba".replace("a", "X"); // Xba
const retained = "abc".replace("b", "[$&]"); // a[b]c
const literal = "abc".replace("b", "$1"); // a$1c
```

`replace(search, replacement)` accepts text for both arguments, including runtime
values. It replaces only the first literal, case-sensitive match. An empty search
matches at the beginning; no match returns the original text. Receiver, search
and replacement evaluate once, in that order, and later argument effects cannot
change the captured earlier values.

Replacement text implements the string-search forms of
[ECMAScript GetSubstitution](https://tc39.es/ecma262/multipage/text-processing.html#sec-getsubstitution):
`$$` is a literal dollar sign, `$&` inserts the matched text, `$` followed by a
backtick inserts the text before the match, and `$'` inserts the text after it.
Numeric and named capture references remain literal because a text search has no
capture groups. Backslashes are literal too. Replacement output is never scanned
again for replacement tokens or additional matches.

Constant templates are parsed during compilation; dynamic templates use native
split/loop/text actions with explicit dollar-pair handling. Regex escaping is
internal, so metacharacters in the search remain literal. RegExp search arguments,
replacement callbacks, implicit coercion, missing replacement arguments and optional
calls are unsupported. Native plist/Unicode restrictions still apply. Dynamic
templates add native loop overhead. Run `npm run build:text-replace` for
`examples/text-replace-test.ts`.

`replaceAll(search, replacement)` uses the same text-only arguments and substitution
tokens, replacing all non-overlapping matches. Each match's prefix and suffix refer
to the **original input**, even after earlier substitutions change the result length.
Receiver and arguments evaluate once, in order. A literal search omits the unused
empty/nonempty branch from the generated workflow.

```ts
const all = "aba".replaceAll("a", "X"); // XbX
const nonOverlapping = "aaaaa".replaceAll("aa", "X"); // XXa
const boundaries = "e\u0301".replaceAll("", "!"); // !e!́!
```

Empty searches insert at every UTF-16 boundary for BMP text, including between
base letters and combining accents. Native character counting uses graphemes, so
the compiler first converts each Unicode scalar to an ASCII marker before counting.
For supplementary characters such as emoji, an empty search with an inserting
replacement would require splitting surrogate pairs: this currently displays an
unsupported-operation alert and stops the shortcut. Empty or `$&`-only replacement
templates are no-ops and still work on that text. Nonempty searches support complete
emoji. RegExp/callback replacements and implicit coercion remain unsupported.

Run `npm run build:text-replace-all` for `examples/text-replace-all-test.ts`.
Native execution evidence and the Unicode guard probe are recorded in
`artifacts/text-replace-all-verification.json`.

## Convenient action functions

| Category | Functions |
| --- | --- |
| Input/display | `askText`, `askNumber`, `showResult`, `quickLook` |
| Text | `splitText`, `joinText`, `replaceText`, `replaceRegex`, `matchText` |
| Lists | `chooseFromList<T>`, `chooseMultiple<T>`, `count` |
| Dictionaries | `getDictionaryValue<T>`, `setDictionaryValue<T>`, `dictionaryKeys`, `dictionaryValues<T>` |
| JSON | `stringifyJson`, `parseJson<T>`; `JSON.stringify` is also recognized |
| Clipboard | `getClipboard`, `setClipboard` |
| Web | `getJson<T>`, `requestJson<T>`, `openURL` |
| Device | `notify`, `speak`, `wait`, `vibrate`, `getBatteryLevel` |
| Dates | `currentDate`, `formatDate` |
| Flow | `repeat`, `menu`, `input<T>` |

See `api/ios.d.ts` for signatures. Opaque native content (files, dates, images,
contacts, app entities) is represented by `NativeContent` and can be passed to
native actions or `quickLook`. Only the subset described under verification below
has been run on the simulator; other wrappers have compiler/metadata coverage.

`replaceText` searches for literal text. `replaceRegex` uses case-sensitive native
ICU regex syntax and replacement groups such as `$1`, rather than a JavaScript
`RegExp` object. For example, `await replaceRegex("a1 b22", "([a-z])(\\d+)", "$2:$1")`
returns `"1:a 22:b"`. Regex syntax errors follow native Shortcuts behavior.
`matchText` currently encounters an unresolved native intent failure on the test
simulator. The compiler's text comparisons and `replaceRegex` do not use that action.

## Read and update dictionaries

```ts
import { getDictionaryValue, setDictionaryValue, dictionaryKeys, showResult } from "@js-shortcuts/ios";

export default async function main(): Promise<void> {
  const original = { score: 7, details: { city: "Amsterdam" } };
  const updated = await setDictionaryValue<typeof original>(original, "score", 9);
  for (const key of ["score"]) {
    const value = await getDictionaryValue<number>(updated, key);
    await showResult(value);
  }
  await showResult(original["score"]); // 7: the update returned a new dictionary
  await showResult(await getDictionaryValue<string>(updated, "details.city"));
  for (const key of await dictionaryKeys(updated)) { await showResult(key); }
}
```

Known required fields support `object.field` and `object["field"]`. Runtime keys
use `getDictionaryValue<T>` explicitly: its native key paths interpret dots as
nesting. The setter updates a **top-level key**; dots in setter keys are literal.
To change a nested object, replace that top-level field with an updated object.
Literal dotted-key lookup through typed field access is rejected to avoid
silently treating the key as a path.

`setDictionaryValue<T>` accepts scalar values and existing typed object/list outputs.
`T` describes the expected complete result; it does not infer the new shape or
validate values at runtime. Getter/value-list generics similarly declare the
expected native types. Without an explicit or contextually inferred type, values default to opaque
`NativeContent`. Prefer explicit generics to make the expected shape clear.

Numbers remain numeric and object values remain structured. The direct native
setter rejects an empty list and collapses a singleton list to its item; use the
object construction below when preserving the list shape matters. Boolean setter
values use native `0`/`1`, so JSON export does not retain a JSON boolean. Key order,
missing-key behavior and nested-list handling follow Shortcuts rather than JS
`Object.keys`/`Object.values`; no ordering or missing-value guarantee is added.

`npm run build:dictionaries` builds the example in `examples/dictionaries-test.ts`.
Its numeric updates, nested paths, list preservation, boolean condition and
key/value enumeration passed on the iOS 26.5 simulator.

## Compose objects from existing data

```ts
const response = await getJson<{ name: string; score: number }>(url);
const selected = ["ts", "ios"].filter(tag => tag !== "ios");
const payload = { response, tags: selected, active: true };
const envelope = { payload, version: 1 };
await quickLook(envelope);
```

Object literal fields can contain existing typed dictionaries and one-dimensional
lists from actions, helpers, variables and array methods. Multiple levels of
object wrapping work. Fields evaluate once, in source order. An earlier field
retains its value if a later expression replaces its source variable.

The compiler uses native JSON serialization and Get Dictionary from Input when
an object contains a dynamic container. This keeps `[]`, `[42]`, arrays of
objects, empty text, boolean values and escaped keys/strings in their JSON shape.
Fixed literal objects retain their existing Dictionary action encoding. Input
data must be JSON-compatible; this is not a serializer for arbitrary native files,
dates or other opaque content. Native key ordering and numeric precision apply.
The additional serialization actions also increase workflow size and runtime.

Use `attachment(payload)` for native parameters that accept a dictionary variable.
The `dictionary(...)` helper specifically builds a native parameter field state;
it still requires an inline-encodable literal and does not accept these dynamically
constructed objects. Existing objects can also be embedded in array literals,
as described below.

Runtime nested arrays such as `number[][]`, mixed array nesting and recursive
array types are rejected when embedded in an object. The native matrix probe also
exposed a pre-existing failure in directly emitted nested array literals: those
can compile elsewhere but are not runtime-supported yet. Use dictionaries with
array fields instead of arrays of arrays. The failure and reproducer are retained
in `artifacts/dynamic-matrix-native-failure.log` and
`artifacts/dynamic-matrix-diagnostic.ts`; full matrix support remains unfinished.

Run `npm run build:dynamic-objects` for `examples/dynamic-objects-test.ts`.

## Copy and update objects with spreads

```ts
interface Result { name: string; score: number; tags: string[] }
const response = await getJson<Result>(url);
const updated = { ...response, score: response.score + 1, tags: [] };
const envelope = { ...updated, status: "ready" };
await showResult(`${envelope.name}: ${envelope.score}`);
```

Object spreads copy fields from existing JSON objects. Ordinary fields and spread
sources evaluate once, from left to right. Later fields/spreads overwrite earlier
ones without changing the source. An empty object contributes no fields. Actual
JSON keys are copied, including keys omitted from the declared TypeScript shape;
use `getDictionaryValue<T>` to read such runtime keys. Booleans, flat arrays,
nested objects and escaped keys/values retain their JSON value types. Spreads
also work inside array callbacks and composed arrays.

These operations reconstruct JSON data using native actions. Shared object
identity, property descriptors, getters, prototypes, symbol keys, and object
property mutation are outside this subset. Array/primitive/opaque spreads are
rejected. TypeScript's own duplicate-property diagnostics still apply. Native key
order and numeric precision remain in effect. Last-write-wins behavior is verified
on iOS 26.5; the compiler accounts for that parser's first-duplicate-key behavior
by reversing only the serialized fragments, after evaluating expressions.

HTTP headers can use spreads of known object literals and their `const` aliases,
provided the final header names remain static and values are text. Headers from
arbitrary runtime objects are still unsupported. A spread result is a constructed
dictionary variable; pass it with `attachment(...)` to native parameters that
accept variables. The `dictionary(...)` field-state helper retains its existing
inline-encoding restriction.

Run `npm run build:object-spread` for `examples/object-spread-test.ts`.

## Compose arrays from existing data

```ts
interface Row { name: string; score: number }
const remote = await getJson<Row[]>(url);
const first = { name: "Ada", score: 7 };
const all = [first, ...remote, { name: "Sam", score: 9 }];
const copy = [...all];
await showResult(copy.reduce((sum, row) => sum + row.score, 0));
```

Array literals accept existing JSON-compatible objects from helper functions,
actions, parsed JSON and variables. Array spreads append the elements of a typed
flat list at that position. Multiple spreads, ordinary elements and empty lists
can be combined. Receiver expressions and elements evaluate once, from left to
right; an earlier spread retains its value when a later expression reassigns the
source variable. Readonly tuples can be spread into a new array.

Native JSON composition preserves object fields, booleans, empty strings, escaped
text, empty lists and singleton lists. Result types still support indexing,
field access, loops and array methods. The resulting arrays can be dictionary
fields or spread again. This constructs JSON values; it does not preserve JS
object identity or provide shared-reference mutation semantics. Native number
precision and key ordering apply, and the conversion adds actions and runtime.
Static literals that need no composition keep their existing native encoding.

Spreads require flat JSON-compatible lists. String iteration, opaque files/app
entities, array holes, arrays of arrays, and spreads in function arguments are
unsupported. This does not change the native matrix limitation described above.
Native `dictionary(...)` parameter field state still requires inline-encodable
containers; pass a composed value using `attachment(...)` where the action accepts
a variable. Run `npm run build:array-composition` for the simulator-verified
example in `examples/array-composition-test.ts`.

## Array copies and ranges

```ts
const values = [0, 1, 2, 3, 4];
const middle = values.slice(1, 4); // [1, 2, 3]
const tail = values.slice(-2); // [3, 4]
const copy = values.slice();
const combined = middle.concat(tail, 9); // [1, 2, 3, 3, 4, 9]
```

`slice(start?, end?)` accepts finite numeric constants or runtime values. Bounds
truncate toward zero, negative bounds count from the end, and out-of-range bounds
are clamped. The end is exclusive. Empty or reversed ranges produce an empty list
without running an invalid native range action. Static bounds are simplified at
compile time; runtime selection uses Shortcuts' Get Items from List action.

`concat(...items)` copies the receiver and appends each scalar/object or the
elements of each array argument. Empty lists and a call with no arguments are
supported. Receiver and argument expressions evaluate once, from left to right;
later variable reassignment leaves the captured values intact. Typed object
fields, booleans, empty strings and escaped text survive composition.

Both methods require flat arrays; arrays of arrays remain unsupported. `concat`
uses JSON composition and requires JSON-compatible items. It does not reproduce
JavaScript shared-object identity, prototypes or custom spreadability. `slice`
passes native contents through directly; opaque native content arrays have
compiler coverage but have not been exercised with files on the simulator.
Explicit `undefined`, NaN/Infinity, argument spreads and optional calls are not
supported. These array methods do not add string `slice` support. Run
`npm run build:array-copy` for `examples/array-copy-test.ts`.

## Joining arrays into text

```ts
const names = [{ name: "Ada" }, { name: "Lin" }];
const message = names.map(person => person.name).join(" / "); // Ada / Lin
const flags = [false, true].join(); // false,true
const fields = ["", "a", "", "b", ""].join("|"); // |a||b|
```

`join(separator?)` accepts homogeneous text, number or boolean arrays, including
readonly arrays. An omitted separator defaults to a comma; a supplied separator
must be text and may be computed at runtime. Empty arrays and singleton empty
strings produce empty text. Leading, trailing and consecutive empty entries
retain their separators. Separators are literal: dollar signs, backslashes,
emoji and newlines are preserved. The receiver evaluates before the separator,
each exactly once, even for empty arrays or unused results. A separator expression
that reassigns the source variable does not change the captured receiver.

The implementation accumulates text in a native loop, adding a separator only
after the first item. Numbers and booleans use native JSON scalar conversion so
booleans become `true`/`false` and numbers avoid locale-specific formatting. Native
numeric precision and exponent notation still apply; this is not a complete
JavaScript number-to-string implementation. Repeated text accumulation adds
runtime cost for large arrays. Object coercion, mixed-type arrays, nested arrays,
null/undefined items, array holes, implicit separator coercion and optional calls
remain unsupported. Run `npm run build:array-join` for the simulator-verified
example in `examples/array-join-test.ts`.

## JSON text conversion

```ts
import { parseJson, stringifyJson, showResult } from "@js-shortcuts/ios";

export default async function main(): Promise<void> {
  const person = parseJson<{ name: string; score: number }>(
    '{"name":"Ada","score":7}',
  );
  const encoded = JSON.stringify({ person, active: true });
  await showResult(encoded);
  await showResult(stringifyJson(parseJson<number[]>("[2,4]")));
}
```

These are synchronous compiler intrinsics: expressions produce native actions
and can be used in helpers and supported callbacks. `stringifyJson(value)` and
the global `JSON.stringify(value)` support text, finite numbers, booleans,
JSON-compatible objects and flat lists. Empty and singleton lists keep their
brackets; empty text becomes `""`. Native JSON escaping handles quotes, backslashes,
newlines and Unicode. A local or imported binding named `JSON` is respected.

`parseJson<T>(text)` requires an explicit supported output type. It accepts valid
JSON with a text, number, boolean, object or flat-array root. An internal native
dictionary envelope allows scalar and array roots to be extracted with the right
compiler value category. This does not validate the declared schema or promise
JavaScript's strict syntax-error behavior: malformed input follows Shortcuts'
native parser behavior. Root `null`/`undefined`, opaque native output types and
arrays of arrays are unsupported. `JSON.parse` without the typed helper is not
implemented.

Arguments evaluate once. Native key order and number precision apply. Replacers,
revivers, indentation options, `toJSON` callbacks and arbitrary JavaScript values
are unsupported; no JavaScript runtime is installed on the device.

Run `npm run build:json` for `examples/json-conversion-test.ts`.

## HTTP and typed JSON

```ts
import { getJson, showResult } from "@js-shortcuts/ios";
interface Todo { title: string; completed: boolean }

export default async function main(): Promise<void> {
  const todos = await getJson<Todo[]>(
    "https://jsonplaceholder.typicode.com/todos?_limit=2"
  );
  for (const todo of todos) {
    if (!todo.completed) {
      await showResult(todo.title);
    }
  }
}
```

`getJson<T>` requires an explicit object/array type. It uses GET with
`Accept: application/json`; the server must return JSON with an appropriate
Content-Type. Required string, number, boolean, object and array fields can be
read. `T` describes the expected shape; it **does not validate the response**.
Network failures follow native Shortcuts behavior. There is no custom status-code,
retry or `try/catch` layer. Optional/nullable fields are rejected when read.

Use `requestJson<T>` for GET, POST, PUT, PATCH and DELETE with headers and a JSON
body. Like `getJson`, it requires an explicit object/array response type:

```ts
import { requestJson, showResult } from "@js-shortcuts/ios";
interface Echo { received: { name: string; tags: string[] } }

export default async function main(): Promise<void> {
  const result = await requestJson<Echo>("http://127.0.0.1:8765/echo", {
    method: "POST",
    headers: { "X-Toolkit-Test": "typescript" },
    json: { name: "Ada", tags: ["ts"] },
  });
  await showResult(result.received.name);
}
```

Options must be an inline object. The method is an uppercase literal or constant
alias; omitting it selects GET. GET cannot have a `json` body. Header names must
be static, with text values; object literals, their `const` aliases and spreads
of those known literals are accepted.
URL and option values are evaluated once, in source order. Defaults are
`Accept: application/json` and, when `json` is present,
`Content-Type: application/json`. Explicit headers override these defaults
without regard to case; duplicate header names and literal newline values are
rejected.

The body is serialized on the device using the same rules as `stringifyJson`.
Dynamic objects, flat arrays, text, numbers and booleans are supported; null,
opaque native content and arrays of arrays are unsupported. This emits native
Get Contents of URL actions, with no JavaScript network runtime. The response
must be JSON with an appropriate Content-Type; `T` declares its shape without
runtime validation. Status codes, redirects, timeouts and errors follow native
behavior; there is no custom retry or status-response wrapper.

Run `python3 scripts/http-echo.py` on this Mac and `npm run build:request-json`
to build the local simulator example. Keep the server running while executing
the shortcut. It records requests in `artifacts/http-requests.jsonl` by default;
`127.0.0.1` here targets the Mac from the simulator, not from a physical iPhone.
The native verification exercised all five methods, custom headers, object and
array responses, and preservation of JSON body values. Lower-level configuration
remains available through `native` and `dictionary`; `examples/native-http.ts`
is a separate compile-only example.

## Access native actions

```ts
import { native, text, attachment, quickLook } from "@js-shortcuts/ios";

export default async function main(): Promise<void> {
  const title = await native<string>("is.workflow.actions.gettext", {
    WFTextActionText: text("Geschreven in TypeScript"),
  });
  const pdf = await native("is.workflow.actions.makepdf", {
    WFInput: attachment(title),
  });
  await quickLook(pdf);
}
```

This illustrates the API; PDF creation is not part of the device acceptance test.
The identifier is passed through unchanged, including third-party app identifiers.
`native<T>` describes its output; the compiler cannot verify that the device will
produce that type, or that the action exists on that OS.

Native parameters are recursively constructed plist values:

- Plain strings, numbers, booleans and arrays remain literal parameters.
- Runtime references default to variable attachments.
- `text(value)` explicitly produces a text token string, needed by display/URL fields.
- `attachment(value)` explicitly connects native content without text formatting.
- `dictionary({ ... })` encodes native dictionary parameter state, useful for HTTP
  headers, JSON bodies and form parameters. Its input must be an inline-encodable
  literal or const alias; existing dynamic containers require a parameter that
  accepts a variable attachment.
- `raw({ ... })` preserves a static plist structure exactly, including existing
  UUIDs, intent definitions, control-flow groups and variable encodings.
- `plistData("AAH/gA==")` creates native binary data from static base64.
- `plistDate("2026-10-19T12:00:00Z")` creates a native whole-second UTC date.
  Both helpers work in native parameters, nested `raw(...)` values and exported
  `shortcut` settings, including aliased imports. They never execute author code.
  See `examples/native-plist.ts` for compile-only examples.

Use a real export for complex entity pickers, content filters or App Intent
metadata. An identifier and parameter names alone are not sufficient for every
app action. Raw control-flow parameters must themselves form valid native groups.
Duplicate action UUIDs are rejected.

```sh
npm run shortcut -- actions clipboard
npm run shortcut -- actions calendar
npm run shortcut -- action is.workflow.actions.downloadurl
```

Every catalog action also has a named function in a category. Import the categories
you need; editors complete their functions and native parameter keys:

```ts
import { LLM, Text, Clipboard, text, joinText, showResult } from "@js-shortcuts/ios";

export default async function main(): Promise<void> {
  const answer = await LLM.ask({
    WFLLMPrompt: text("Bedenk een leuke naam voor mijn app"),
  });
  const trimmed = await Text.trim({ WFInput: text(answer) });
  const message = await joinText(trimmed, "");
  await Clipboard.set({ WFInput: text(message) });
  await showResult(message);
}
```

All **2,585 catalog entries** have a generated category function. Common actions
use concise names such as `Text.create`, `Text.split`, `Text.join`,
`Numbers.calculate`, and `Dictionary.get`. Other functions derive their names
from the action's display name. App actions are grouped by app (with desktop/mobile
variants together where known); colliding names receive a source suffix. Search
with `npm run shortcut -- actions LLM` to see function names and native identifiers.
The full declarations are in `api/functions.generated.d.ts`.

Category functions have fixed return types derived from Apple's ToolKit output
schemas: primitives, arrays, native entities, `void`, and closed enum unions.
They do not accept a caller-selected generic return type. For example:

```ts
const orientation = await Shortcuts.getOrientation();
// "Portrait" | "Portrait Upside Down" | "Landscape Left" |
// "Landscape Right" | "Face Up" | "Face Down" | "Unknown"
if (orientation === "Portrait") {
  await showResult("Phone is upright");
}
```

Import `Shortcuts` and `showResult` from `@js-shortcuts/ios` for this example.
`DeviceOrientation` is also exported if you need to name the type. Enum literals
are English display values from Apple metadata; localized Shortcuts text coercion
may produce different labels.

`LLM.ask` selects native Text output by default and returns `string`. Explicit
non-Text output uses Apple's broader native-content result type. `Text.trim`
returns `string[]`, so the example joins its output before displaying it. Native
entities carry their Apple type identifier and can be passed to other actions;
they are not JavaScript objects with inferred properties.

The checked-in snapshot supplies output schemas for **2,323 of 2,585 actions**,
from Apple ToolKit v80 on macOS and v79/v67 simulator databases. The remaining
**262 actions** explicitly return `UnresolvedActionResult<"action.identifier">`:
no schema was available, so their types are not guessed. Function documentation
marks these gaps. Metadata describes declared outputs, not a guarantee that an
action exists or succeeds on every device.

For user-defined JSON shapes or missing schemas, `native<T>` and the low-level
`actions["identifier"]<T>` remain explicit escape hatches. Those assertions do not
validate or configure native output. Parameter names and encodings remain native,
with the same key checking and `text`, `attachment`, `dictionary`, and `raw` helpers
as the identifier API.

Call category functions directly with `await` and an inline parameters object.
Actions with no catalog parameters also accept no arguments, e.g. `Flow.nothing()`.
Import aliases such as `import { LLM as AI }` work. Dynamic member selection,
destructuring methods, and storing functions in variables are unsupported.
The compiler emits the native action directly, without a JavaScript runtime.
See `examples/categorized-actions.ts` for a complete example.

Regenerate category functions and parameter declarations from the checked-in
metadata with `npm run generate:catalog`. Categories and concise method names
are maintained in `scripts/action_functions.py`. Output schemas live in
`data/action-results.json`, with declarations in `api/results.generated.d.ts`.
To refresh them on a Mac with Apple ToolKit databases, run
`npm run extract:results`, then `npm run generate:catalog`. Extraction reads only
catalog/type metadata and never modifies the databases. Normal builds use the
checked-in snapshot and do not need access to those databases. Run the extractor
and renderer checks with `npm run test:metadata`.

For direct catalog calls with identifier and parameter-key completion:

```ts
import { actions, text, showResult } from "@js-shortcuts/ios";

export default async function main(): Promise<void> {
  const message = await actions["is.workflow.actions.gettext"]<string>({
    WFTextActionText: text("Hallo vanuit TypeScript"),
  });
  await showResult(message);
}
```

`actions` covers all **2,585 identifiers** in the checked-in catalog. The compiler
checks parameter names, and editors suggest identifiers and keys. Call it directly
with a literal identifier and an object literal; import aliases such as
`import { actions as ios }` work. Dynamic action selection and storing an action
function in a variable are unsupported. Calls compile directly to native actions;
no JavaScript object or runtime dispatch is installed on the device.

Use the same `text`, `attachment`, `dictionary` and `raw` encoding helpers as with
`native`. `raw({...})` deliberately bypasses catalog key checks to preserve exact
exports, including parameters missing from the snapshot. `native()` also accepts
identifiers outside the catalog, including third-party apps and internal flow
actions omitted by this metadata source. `T` declares the expected result; omitted
or contextually inferred types follow the same rules as `native<T>`.

Build the example with `npm run build:catalog`.

For optional parameter-key checking on an existing `native` call:

```ts
import { native, type NativeActionParameters } from "@js-shortcuts/ios";
// Inside main:
await native("is.workflow.actions.gettext", {
  WFTextActionText: "Hello",
} satisfies NativeActionParameters<"is.workflow.actions.gettext">);
```

These generated types suggest **keys**, not complete value schemas, enum cases or
required parameters. The catalog snapshot covers iOS 27/macOS 27 metadata; presence
does not establish availability on your device or successful runtime execution.
The automated catalog sweep checks compilation of all identifiers and parameter
keys using placeholder values, without running those actions. It is not a device
compatibility test. The regular regressions also compare catalog calls against
the existing device-verified workflow fixtures, with `native` fallback for entries
outside the catalog.
Regenerate metadata with `python3 scripts/generate-catalog.py /path/to/snapshot.json`.
The source/version/platform provenance is stored in `data/actions.json`.

## Import existing workflows

```sh
npm run shortcut -- import dist/TS-HTTP-Test.unsigned.plist --out examples/imported.ts
npm run shortcut -- examples/imported.ts --out dist/imported
```

The importer emits TypeScript using `native` and `raw`, preserving action
identifiers, parameter encodings, UUID links, grouping and existing root settings.
It validates the source before writing and refuses to overwrite existing files.
It does not reconstruct high-level `if`/`for` syntax from native actions.

Inputs: unsigned XML plist, binary plist on macOS, or inspection JSON (a workflow
object or `{ workflow: ... }`). Signed/encrypted `.shortcut` files cannot be read
directly. Plist data and whole-second dates become `plistData` / `plistDate` calls.
Nulls and unknown action-level fields are rejected rather than silently dropped.
Apple's XML conversion cannot retain subsecond binary dates; these are detected
before conversion and rejected. Recompilation preserves existing settings and adds
normal default root fields if the source omitted them. Eight complete tested
workflows have exact JSON round-trip regression coverage.

Inspection JSON containing data/date leaves uses a versioned
`{ "$shortcutsPlist": 1, "value": ... }` envelope. The importer restores the typed
leaves automatically; ordinary dictionaries that resemble type tags are escaped.
Workflows without typed leaves retain the previous plain JSON format.

Root workflow settings can also be written directly:

```ts
export const shortcut = {
  WFWorkflowName: "Mijn shortcut",
  WFWorkflowTypes: ["ActionExtension"],
  WFWorkflowInputContentItemClasses: ["WFStringContentItem"],
};
```

Settings are static native plist literals. `WFWorkflowActions` is generated by the
compiler and cannot be overridden. CLI `--name` takes precedence over the source
name. This configures a shortcut; creating personal automations/triggers on the
device remains a separate Shortcuts operation.

## Current boundaries

This is a compiler for a useful TypeScript subset and native action access, not
a full JS engine. Unsupported constructs produce errors with source locations.

- No arbitrary npm imports, function values, classes, closures outside
  supported inline callbacks, general promises or `try/catch`.
- No ordinary `for`, `while`, labeled jumps, destructuring assignments, array
  holes, argument spreads, object property mutation or other array methods such as `.sort()`.
- List indexing requires a valid nonnegative integer at runtime. Out-of-range
  behavior follows Shortcuts, not JavaScript's `undefined`; dynamic bounds are not checked.
- `let` reassignment must preserve its value category. Helper, array-method,
  menu and repeat callbacks have local returns; only main returns stop the shortcut.
- Boolean/opaque values do not implicitly interpolate into text. Use conditions
  for booleans or explicit native `text(...)` conversion where appropriate.
- Object literals can contain dynamic/API objects and flat lists. Arrays can
  contain existing JSON objects and spreads of flat lists. Dynamic containers
  inside native dictionary parameter states remain unsupported. Arrays of arrays
  are not runtime-supported yet; see the matrix limitation under object composition.
- Nullable values, optional chaining, runtime schema
  validation and automatic credentials management are not implemented.
- Runtime repeat counts should be finite integers. Positive fractional counts use
  native rounding behavior; nonpositive counts are skipped.
- Native OS/app availability, permissions, enum values, picker state and binary
  data parameters are not comprehensively validated by this compiler.

`.js`/`.mjs` input remains usable for the original small subset. New typed native
outputs and JSON features are intended for `.ts`/`.mts`.

## Verification

`npm run typecheck` checks compiler, tests and all examples. `npm test` currently
passes **646 tests**. `npm run test:metadata` passes four metadata tests, and
`npm run build:site` builds the browser visualizer. The in-memory browser compiler
and Node compiler produce equivalent workflows for the new object/list composition,
copy, join, runtime lookup and text replacement examples as well as existing control-flow/catalog/HTTP
examples. Historical native fixtures remain preserved. Comparisons
against newly compiled source explicitly account for the change from Match Text
to Replace Text in generated text equality; unrelated actions remain unchanged.
New native fixtures separately verify that replacement route. Raw workflow import
continues to preserve the original actions exactly, including legacy Match Text.
Source is never executed or fetched during compilation.

On 2026-10-19, the iPhone 17e iOS 26.5 simulator ran:

- `text-replace-all-test`: non-overlapping matches, missing matches, six dynamic
  templates with original prefix/suffix, empty input, combining-accent boundaries,
  emoji, literal regex characters and argument snapshots all passed. All five
  outputs appeared; all 762 imported actions match the compiler output exactly.
  `TS-Replace-All-Guard` showed the unsupported surrogate-splitting alert and
  stopped before the subsequent result action; all 53 actions match the output.
  Evidence: `artifacts/text-replace-all-verification.json`.
- `TS-Text-Replace`: first-match replacement, eight dynamic substitution templates,
  empty searches, no-match input, literal regex characters, backslashes, emoji
  and newline all passed. Argument capture and helper/map calls also passed.
  All five results appeared and all 469 imported actions match the compiler output.
  Native splitting retained empty replacement segments, including consecutive
  dollar signs, in a separate probe. Evidence: `artifacts/text-replace-verification.json`.
- `TS-Array-Offsets`: runtime negative/fractional and out-of-range starts worked
  for `includes` and `indexOf` on numeric, text and boolean lists. Empty lists
  returned **-1/N**; receiver and needle captures survived argument effects
  (**2; source 9; needle 9**). Nested helper calls produced **0,2,-1**. All five
  outputs appeared and all 470 imported actions match the compiler output.
  Evidence: `artifacts/array-offset-verification.json`.
- `TS-Array-Join`: empty entries retained their separators (**|a||b|**), empty
  and singleton lists produced the correct text, numbers used decimal dots,
  and booleans produced **false,true,false**. Nested helpers/map calls and
  receiver capture also passed. All six outputs appeared and all 342 imported
  actions match the compiler output. The 46-action `TS-Join-Escapes` probe used
  JSON to make trailing newlines and newline separators observable; both results
  passed. Evidence: `artifacts/array-join-verification.json`.
- `TS-Array-Copy`: `slice` handled runtime negative/fractional bounds, clamping,
  empty/reversed ranges and omitted bounds. `concat` preserved empty/singleton
  arrays, typed objects, booleans and escaped text. Reassigning the source left
  both copies intact (**[2,3]/[1,2,3]/[9]**). All six results appeared and all
  607 imported actions match the compiler output. Evidence:
  `artifacts/array-copy-verification.json`.
- `TS-Object-Spread-v2`: later fields and spreads overwrite earlier values while
  preserving the source, arrays, booleans and nested objects. Defaults produced
  **9/42**, empty copies produced **{}**, and undeclared JSON fields remained
  readable (**5/kept**). Escaped keys/values and `map` composition also passed.
  All seven results appeared and all 197 imported actions match the compiler
  output. The first native probe exposed the parser's duplicate-key behavior;
  the final implementation reverses serialized fragments to handle it. Evidence:
  `artifacts/object-spread-verification.json`.
- `TS-Array-Composition`: a helper object retained its fields in a singleton array;
  mixed object/spread construction produced **Rows: 3/Ada/Lin/Sam; sum 6**.
  Numeric arrays remained **[]/[42]/[0,2,4,6]**, booleans remained **[false,true]**,
  and empty text, JSON-like delimiters, quotes, backslashes, newline and emoji
  survived. Dictionary nesting and copying also passed. All seven results appeared
  and all 537 imported actions match the compiler output. Evidence:
  `artifacts/array-composition-verification.json`.
- `TS-Math`: all ten Math functions ran, including positive/negative fractions,
  halfway rounding, zero, minimum/maximum, powers and square roots. Eight scaled
  constants produced **3142/2718/693/2303/1443/434/707/1414**; `map`/`reduce`
  produced **Arrays: 1/-2/3; max 3**. All seven results appeared and all 383
  imported actions match the compiler output. Evidence: `artifacts/math-verification.json`.
- `TS-String-Methods`: all nine string methods ran successfully, including empty
  inputs, ECMAScript whitespace, Unicode case conversion, and 13 pairs tested
  with each of `startsWith`, `endsWith` and `includes`. Chained transformations
  produced **ADA/ts/😀**; array composition produced **Arrays: ts/ios/js; Y**.
  All seven results appeared and all 318 imported actions match the compiler
  output. Evidence: `artifacts/string-methods-verification.json`.
- `TS-Request-JSON`: six requests exercised GET, POST, PUT, PATCH and DELETE
  against a local echo server. The server log confirms custom headers, a nested
  object with `false` and a singleton list, `[]`, `[42]`, and escaped text arrived
  intact. A typed array response produced **Array: 2; som: 5**. All six results
  appeared and all 168 imported actions match the compiler output. Evidence:
  `artifacts/request-json-verification.json` and `artifacts/request-json-http.jsonl`.
- `TS-JSON-Conversion`: parsed **Ada/7/Y**, reconstructed **Ada; 1/ts**, and
  preserved `[]`, `[42]` and `[2,4]`. Escaped text round-tripped exactly, empty
  text became `""`, scalars produced **false/-2.5/true**, and the singleton object
  list produced **1/9; [{"n":9}]**. All eight results appeared and all 148 imported
  actions match the compiler output. Evidence: `artifacts/json-conversion-verification.json`.
- `TS-Dynamic-Objects-v3`: **Ada/7; ts/ios**, followed by JSON confirming a wrapped
  object with boolean fields, empty objects, `[]`, `[42]`, `[2,4]`, `[false]`,
  `[""]`, a singleton object list, and keys/strings with quotes, backslashes and
  newlines. All six outputs appeared and all 221 imported actions match the
  compiler output. Evidence: `artifacts/dynamic-objects-verification.json`.
- `TS-Flow-Callbacks`: repeat index mutation and early returns produced
  **0:10;2:12;3:13;**; nested repeats produced **00;02;eind;10;12;eind;**.
  The early menu branch produced **start;**, the other **start;klaar;**.
  Both runs continued after the menu and skipped the zero-count callback.
  All 112 imported actions match the compiler output. Evidence:
  `artifacts/flow-callbacks-verification.json`.
- `TS-Array-Search`: `some` stopped after indices **01**, `every` after items
  **123**, and `findIndex` returned **1** despite callback parameter mutation.
  Empty lists produced **N/Y/-1/N** with **0** callback calls. Literal text
  searches produced **0Y;-1N;1Y;**; numeric offsets and boolean search produced
  **0/2/2/-1; bool: 1**. All six results appeared in order and all 485 imported
  actions match the compiler output. Evidence: `artifacts/array-search-verification.json`.
- `TS-Dynamic-Text`: **52/52** runtime equality/inequality checks and **6/6**
  deliberately different pairs passed, including regex syntax, empty text, Unicode
  and newline inputs. Dynamic cases produced **ABMF; waarde: changed**, proving
  first-match evaluation, a frozen discriminant and fallthrough without evaluating
  the later case expression. A no-match switch selected its default after dynamic
  cases. All 292 imported actions match the compiler output. Evidence:
  `artifacts/dynamic-text-verification.json`.
- `TS-Text-Comparisons`: exact text, empty text with `===`/`!==`, regex metacharacters,
  composed/decomposed Unicode, emoji and marker-like input. All expected comparison
  outcomes passed. Regex replacement groups also produced **1:a 22:b**.
  All 129 imported actions match the compiler output.
- `TS-Switch-Text-Fixed`: text cases produced **open;voer uit;**, **voer uit;** and
  **onbekend;**; loop control produced **1;2;eind;**; helper return produced **twee**.
  All 199 imported actions match the compiler output. Both new workflows completed
  without a Match Text prompt. Evidence: `artifacts/text-equality-verification.json`.
- `TS-Catalog-Actions`: catalog text/number/calculation actions produced
  **Hallo vanuit de catalogus: 14**. All 5 imported actions match the compiler
  output and are retained as a native regression fixture. Evidence:
  `artifacts/catalog-actions-verification.json`.
- `TS-Dictionaries-Test`: numeric update with the original intact (**9 / 7**),
  nested city (**Utrecht**), preserved list (**ts/ios**), false condition,
  key count (**5**), value sum (**5**) and literal dotted setter key.
  JSON output confirmed structured objects/lists and numeric `enabled: 0`.
  All 54 imported actions match the compiler output. Evidence and limitations:
  `artifacts/dictionaries-verification.json`.
- `TS-Switch-Numeric`: default in the middle, fallthrough and loop control
  (**Loop: 1;2;D;eind;3;eind;**); helper return from a case (**Functie: twee**).
  Main stopped without an error. The 151 imported actions exactly match the
  compiled workflow and are a regression fixture.
- `TS-Arrays-Test`: index-aware map (**4 items; 10,43**); filter/reduce
  (**3 items; 96**); mapped and filtered dictionaries (**Kacper/10**); captured
  state and early `forEach` return (**0:1;2:3;3:4;**); empty map/filter and seeded
  reduction (**0/0/9**); two empty mapped strings retaining count **2**. The
  161-action workflow is a regression fixture.
- `TS-Control-Flow`: continue/break in a helper loop (**Som: 5**); inner-loop
  jumps with continued outer execution (**Genest: 11,13,eind1;eind2;**); mutable
  runtime indices and snapshots (**Index: nul/twee**); loop-item indices
  (**Selectie: twee;nul;**); main's explicit stop. The 106-action workflow is a
  regression fixture.
- `TS-Functions-Test`: nested synchronous/async helpers (**121**); early return
  from a list loop (**7**) and empty-list fallback (**-1**); parameter assignment
  (**11**) preserving the caller's value (**10**); early `void` return skipping a
  display; another call displaying **Helper: actief**; main continuing afterwards
  with **Na helpers: 0**. The 145-action imported workflow is a regression fixture.
- `TS-Toolkit-v3`: native action output; nested dictionary text/number/boolean
  fields; `&&` and numeric comparison; `let` updated inside a list loop and Repeat
  Count (result **30**); list index; Split/Combine Text; **both menu cases**;
  Stop and Output completed without an error (returned value not independently captured).
- `TS-Toolkit-Edges`: multiply/divide/modulus/power/negation (**18, 3, 1, 81, -9**);
  dynamic boolean dictionary value; ternary; `||` actually skipped an Ask Number
  action; object-list iteration (**Ada**, **Kacper**); list length (**2**); a
  dynamic zero-repeat count skipped its body (**total 0**); explicit stop.
- Earlier tests: case-sensitive IF/ELSE, nested text loops, empty lists, real GET
  requests, typed JSON lists and nested JSON fields.

Evidence and SHA-256 hashes are in `artifacts/toolkit-verification.json`, alongside
screenshots. In particular: [total](artifacts/ios-toolkit-total.png),
[menu](artifacts/ios-toolkit-menu-second.png), [math](artifacts/ios-toolkit-math.png),
[zero repeat](artifacts/ios-toolkit-zero-repeat.png).
Helper-function evidence is in `artifacts/functions-verification.json` with
screenshots for [early returns](artifacts/ios-functions-early-return.png) and
[parameter isolation](artifacts/ios-functions-parameters.png). Behavior tests also
exercise argument evaluation order, repeated calls, nested-loop returns,
object/list returns and helpers inside repeat callbacks using an IR evaluator;
these extra cases have not all been executed on the simulator.
Loop-control evidence is in `artifacts/control-flow-verification.json`, with
screenshots for [nested loops](artifacts/ios-control-nested.png) and
[runtime indices](artifacts/ios-control-index.png).
Array-method evidence is in `artifacts/array-methods-verification.json`, including
[filter/reduce](artifacts/ios-arrays-filter-reduce.png),
[empty arrays](artifacts/ios-arrays-empty.png) and
[empty strings](artifacts/ios-arrays-empty-text.png).
Destructuring tests cover nested bindings, tuples, source evaluation count,
parameter isolation, lexical scope, loop control and invalid patterns. A native
emission comparison checks that destructuring generates the same workflow as
explicit field/index reads. These checks use the compiler and IR evaluator;
they do not constitute additional device execution.
Switch evidence is in `artifacts/switch-verification.json`, with screenshots for
[loop control](artifacts/ios-switch-numeric-loop.png) and
[helper return](artifacts/ios-switch-numeric-return.png).

An earlier `TS-Switch-Test` run exposed a native Match Text failure on this
simulator. `examples/match-text-diagnostic.ts` reproduces it with a static string,
without a switch or loop: the intent receives `text = JS:open`, but resolution
returns `NeedsValue` with `text = <null>` and displays an unexpected input prompt.
Rebooting the simulator, using a named variable, adding `WFInput`, and disabling
`ShowWhenRun` did not fix it. The root cause remains unresolved for direct
`matchText` calls. The compiler now implements strict text equality with a
case-sensitive, fully anchored regex replacement: inputs are prefixed with `JS:`,
matching inputs become `TS_MATCH`, and a text condition checks that marker. A
nonmatch retains the prefix, so it cannot collide with the marker. This also
handles empty text without relying on an empty match result. New text-if and
text-switch runs above verify the replacement route; historical Match Text
records are retained as evidence of the separate unresolved native issue.

Testing caught two native-format requirements: dictionary row values need typed
parameter-state wrappers, and numeric IF inputs need an explicit Number coercion
with the correct comparison fields. Both now have regression coverage.

Physical iPhones, other OS versions and the full action catalog remain untested.
No notifications, clipboard writes, external messages or POST requests were sent
as part of this milestone's device tests.

The data/date extension additionally passes Apple `plutil` XML-to-binary
conversion and binary-import roundtrips, plus CLI import/compile/reimport tests.
Nineteen exported reference workflows pass compile and serialization roundtrips
with all original fields preserved (normal default root fields may be added).
These corpus checks do **not** execute those workflows or validate their apps.
See `artifacts/plist-corpus-verification.json` for source provenance and hashes.
Run the same checks on another export directory with:

```sh
npm run verify:corpus -- /path/to/unsigned/xml report.json
```

## Layout and references

`src/compiler.ts` lowers the TS subset; `src/model.ts` defines IR;
`src/emitter.ts` encodes native actions; `src/native.ts` handles static plist data;
`src/plist-codec.ts` preserves data/date types in XML and inspection JSON;
`src/actions.ts` / `src/wrappers.ts` map convenience APIs; `src/importer.ts`
round-trips native workflows; `src/catalog.ts` searches metadata; `src/cli.ts`
handles commands, artifacts and signing. `api/` provides editor types.

- [Apple: CLI and signing](https://support.apple.com/guide/shortcuts-mac/apd455c82f02/mac)
- [Apple: Repeat actions](https://support.apple.com/guide/shortcuts/apdc11deb2c1/ios)
- [Apple: API requests](https://support.apple.com/guide/shortcuts/apd58d46713f/ios)
- [0xdevalias: inspecting shortcut data](https://gist.github.com/0xdevalias/27d9aea9529be7b6ce59055332a94477)
- [Shortcuts Playground: exports and ToolKit metadata](https://github.com/viticci/shortcuts-playground-plugin/tree/main/codex/skills/shortcuts-playground)

The original shortcuts-toolkit repository is background, not a reliable current
format specification. Native exports and device behavior are used to verify this
implementation. TypeScript is bounded to major version 6 because version 7's
compiler API requires a separate migration.
