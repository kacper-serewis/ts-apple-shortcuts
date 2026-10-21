/// <reference path="./actions.generated.d.ts" />
/// <reference path="./functions.generated.d.ts" />
/// <reference path="./results.generated.d.ts" />
declare module "@js-shortcuts/ios" {
  /** Text supported by the native Shortcuts compiler. */
  export type ShortcutText = string;

  /** Ask for text on the device. Cancelling stops the shortcut. */
  export function askText(prompt: string): Promise<string>;
  /** Display text in the native result dialog. */
  export function showResult(text: string | number): Promise<void>;
  /** Display a notification without sound. */
  export function notify(text: string): Promise<void>;
  /** Speak text and wait until speech finishes. */
  export function speak(text: string): Promise<void>;
  /** HTTP GET on the device. T describes the JSON response; it is not runtime validation.
   * Requires an explicit object or array type argument and a JSON response.
   * Network failures follow Shortcuts' native behavior.
   */
  export function getJson<T extends object>(url: string): Promise<T>;
  export type JsonRequestOptions = { readonly headers?: Readonly<Record<string, string>> } & (
    | { readonly method?: "GET"; readonly json?: never }
    | { readonly method: "POST" | "PUT" | "PATCH" | "DELETE"; readonly json?: string | number | boolean | object }
  );
  /** Native HTTP request with a JSON response. Use an inline options object and a constant method.
   * Headers have static names and text values; literals, const aliases and spreads of known literals are supported.
   * json is serialized on-device. Defaults: Accept application/json; Content-Type application/json
   * when json is present. Explicit headers override defaults case-insensitively.
   * T declares the object/array response shape; no status, schema validation or retry layer is added.
   */
  export function requestJson<T extends object>(url: string, options?: JsonRequestOptions): Promise<T>;
  /** Native JSON serialization of supported text, finite numbers, booleans, objects and flat lists.
   * Native key ordering and number precision apply; no replacer, indentation or toJSON callbacks.
   */
  export function stringifyJson(value: string | number | boolean | object): string;
  /** Parse valid JSON text on the device. An explicit T declares the expected shape without
   * runtime schema validation. Native parser behavior applies to invalid input.
   * Null/undefined and arrays of arrays are not supported result types.
   */
  export function parseJson<T>(json: string): T;

  /** Opaque native content: files, images, locations, contacts and other app entities. */
  export interface NativeContent { readonly __nativeContent: unique symbol }
  export interface NativeEncoded { readonly __nativeEncoding: unique symbol }
  export type NativeParameter = string | number | boolean | NativeContent | NativeEncoded
    | readonly NativeParameter[] | { readonly [key: string]: NativeParameter };
  export type NativeParameters = { readonly [key: string]: NativeParameter };
  /** Calls a native action. Parameter names/encodings come from an exported shortcut or catalog.
   * T declares the output shape; it does not validate the action or its runtime output.
   */
  export function native<T = NativeContent>(identifier: NativeActionIdentifier, parameters: NativeParameters | NativeEncoded): Promise<T>;
  /** Catalog actions with parameter-key completion. Keys are optional metadata hints, not value
   * schemas or availability guarantees. T declares the expected native output without validation.
   * Call directly with a literal identifier: await actions["is.workflow.actions.gettext"]<string>({...}).
   * Use raw({...}) for exact exported parameters, or native() for identifiers outside the catalog.
   */
  export const actions: {
    readonly [K in KnownNativeAction]: <T = NativeContent>(parameters: KnownNativeParameters[K] | NativeEncoded) => Promise<T>;
  };
  /** Preserve a static plist structure exactly; no expressions or variables. */
  export function raw(value: NativeParameter): NativeEncoded;
  /** Static base64 bytes, emitted as plist <data>; allowed inside raw() and shortcut settings. */
  export function plistData(base64: string): NativeEncoded;
  /** Static whole-second UTC ISO date, emitted as plist <date>; allowed inside raw() and shortcut settings. */
  export function plistDate(iso: string): NativeEncoded;
  /** Serialize as a native text token string, including display/URL parameters. */
  export function text(value: unknown): NativeEncoded;
  /** Serialize as a native variable attachment, preserving content types. */
  export function attachment(value: unknown): NativeEncoded;
  /** Encode an object literal (or const alias) as a native dictionary parameter state. */
  export function dictionary(value: object): NativeEncoded;
  /** Value types an App Intents entity property can declare. */
  export type EntityPropertyValue = string | number | boolean | NativeContent | readonly (string | number | boolean | NativeContent)[];
  /** Read a property of an App Intents entity, such as an alarm's "hours".
   * Pass the property identifier from Apple metadata (see NativeEntityProperties), not its
   * localized title. Compiles to a native property variable; no action is added.
   * Use one entity at a time: inside for…of for lists. Values follow native Shortcuts behavior.
   */
  export function entityProperty<E extends NativeEntity<keyof NativeEntityProperties & string>, P extends keyof NativeEntityProperties[E["__nativeType"]] & string>(entity: E, property: P): NativeEntityProperties[E["__nativeType"]][P];
  /** Entities without catalog property metadata (app manifests, native<T>() results).
   * T declares the property value; it is not validated. Catalog entities must use a declared identifier.
   */
  export function entityProperty<T extends EntityPropertyValue = NativeContent>(entity: NativeContent, property: string): T;
  /** Receive input passed to this shortcut (for example by a share sheet). */
  export function input<T = NativeContent>(): T;
  /** Repeat n times with a zero-based index. A callback return skips only the rest of that iteration. */
  export function repeat(count: number, body: (index: number) => Promise<void>): Promise<void>;
  /** Native Choose from Menu. A callback return exits only the selected case; execution continues after menu. */
  export function menu(prompt: string, cases: Record<string, () => Promise<void>>): Promise<void>;

  export function askNumber(prompt: string): Promise<number>;
  export function getClipboard(): Promise<NativeContent>;
  export function setClipboard(content: unknown): Promise<void>;
  export function openURL(url: string): Promise<void>;
  export function quickLook(content: unknown): Promise<void>;
  export function chooseFromList<T>(items: readonly T[], prompt: string): Promise<T>;
  export function chooseMultiple<T>(items: readonly T[], prompt: string): Promise<T[]>;
  export function splitText(value: string, separator: string): Promise<string[]>;
  export function joinText(items: readonly string[], separator: string): Promise<string>;
  export function replaceText(value: string, find: string, replacement: string): Promise<string>;
  /** Case-sensitive native ICU regex replacement. Replacement groups use $1, $2, etc. */
  export function replaceRegex(value: string, pattern: string, replacement: string): Promise<string>;
  /** Native ICU regular expression syntax. Currently affected by an unresolved
   * Match Text intent-resolution failure on the iOS 26.5 simulator; text equality
   * and replaceRegex use a separate, device-verified Replace Text action.
   */
  export function matchText(value: string, pattern: string): Promise<string[]>;
  export function count(items: readonly unknown[]): Promise<number>;
  export function wait(seconds: number): Promise<void>;
  export function vibrate(): Promise<void>;
  export function currentDate(): Promise<NativeContent>;
  /** Native date format (Unicode date patterns). */
  export function formatDate(date: NativeContent, format: string): Promise<string>;
  export function getBatteryLevel(): Promise<number>;
  /** Open an installed app by bundle identifier, as the Open App action does after picking
   * the app in the editor (iOS 26.5): WFSelectedApp plus WFAppIdentifier. Static strings only.
   * The team identifier is optional; the editor stores it when the app is installed.
   */
  export function openApp(app: { bundleIdentifier: string; name: string; teamIdentifier?: string }): Promise<NativeEntity<"app">>;

  /** Get a native dictionary value. The key may be a runtime string or native dotted key path.
   * T declares the expected value; it does not validate the dictionary or handle missing keys.
   */
  export function getDictionaryValue<T = NativeContent>(dictionary: object, keyPath: string): Promise<T>;
  /** Return a dictionary with a top-level key updated. Dots in this key are literal.
   * Does not reassign the source variable. Boolean values use native numeric 0/1 representation.
   * T declares the expected complete output shape; it is not inferred or runtime-validated.
   */
  export function setDictionaryValue<T extends object = Record<string, NativeContent>>(dictionary: object, key: string, value: unknown): Promise<T>;
  /** Native dictionary key order; no JavaScript Object.keys ordering guarantee. */
  export function dictionaryKeys(dictionary: object): Promise<string[]>;
  /** T declares the expected value type. Native list handling applies to nested list values. */
  export function dictionaryValues<T = NativeContent>(dictionary: object): Promise<T[]>;

  export type NativeActionIdentifier = KnownNativeAction | (string & {});
}
