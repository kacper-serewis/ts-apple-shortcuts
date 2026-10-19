import ts from "typescript";
import type { PlistDictionary, PlistValue } from "./model.js";

export function unwrap(node: ts.Expression): ts.Expression {
  while (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)
    || ts.isSatisfiesExpression(node) || ts.isNonNullExpression(node)) node = node.expression;
  return node;
}

/** Static plist literals only: never eval/import author code. */
export function staticPlist(node: ts.Expression, fail: (message: string, node: ts.Node) => never,
  special?: (node: ts.CallExpression) => PlistValue | undefined): PlistValue {
  node = unwrap(node);
  if (ts.isCallExpression(node) && special) {
    const result = special(node);
    if (result !== undefined) return result;
  }
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    if (!node.text.isWellFormed() || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/u.test(node.text)) fail("Invalid plist string.", node);
    return node.text;
  }
  if (ts.isNumericLiteral(node)) {
    const number = Number(node.text);
    if (!Number.isFinite(number)) fail("Plist numbers must be finite.", node);
    return number;
  }
  if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.MinusToken) {
    const number = staticPlist(node.operand, fail, special);
    if (typeof number !== "number") fail("Expected a number.", node);
    return -number;
  }
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (ts.isArrayLiteralExpression(node)) return node.elements.map(item => staticPlist(item, fail, special));
  if (ts.isObjectLiteralExpression(node)) {
    const result: PlistDictionary = Object.create(null);
    for (const property of node.properties) {
      if (!ts.isPropertyAssignment(property)) fail("Use plain property assignments in static settings.", property);
      const key = propertyName(property.name, fail);
      if (Object.hasOwn(result, key)) fail(`Duplicate key '${key}'.`, property);
      result[key] = staticPlist(property.initializer, fail, special);
    }
    return { ...result };
  }
  fail("Expected a static plist literal (text, number, boolean, array, object, plistData or plistDate).", node);
}

export function propertyName(node: ts.PropertyName, fail: (message: string, node: ts.Node) => never): string {
  if (ts.isIdentifier(node) || ts.isStringLiteral(node) || ts.isNumericLiteral(node)) {
    const key = ts.isNumericLiteral(node) ? String(Number(node.text)) : node.text;
    if (!key.isWellFormed() || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/u.test(key)) fail("Invalid plist key.", node);
    return key;
  }
  fail("Computed property names are not supported.", node);
}

export function isDictionary(value: PlistValue): value is PlistDictionary {
  return value !== null && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype;
}

// atob/btoa instead of Buffer so the compiler also runs in browsers.
export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** Canonical base64, optionally wrapped in whitespace as in exported plist data. */
export function plistData(base64: string): Uint8Array {
  const compact = base64.replace(/\s/g, "");
  let bytes: Uint8Array;
  try {
    bytes = Uint8Array.from(atob(compact), char => char.charCodeAt(0));
  } catch {
    throw new Error("plistData expects valid padded base64.");
  }
  if (toBase64(bytes) !== compact) throw new Error("plistData expects valid padded base64.");
  return bytes;
}

/** Apple plutil accepts whole-second UTC dates in XML. Reject rather than truncate subsecond values. */
export function plistDate(iso: string): Date {
  const date = new Date(iso);
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.000)?Z$/.test(iso)
    || !Number.isFinite(date.getTime()) || date.toISOString() !== iso.replace(/(?<!\.000)Z$/, ".000Z")) {
    throw new Error("plistDate expects a valid whole-second UTC ISO date, such as 2026-10-19T12:00:00Z. Subsecond dates cannot be represented in Apple's XML plist format.");
  }
  return date;
}
