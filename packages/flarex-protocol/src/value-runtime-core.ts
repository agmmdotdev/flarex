import { compareUtf16Strings } from "@flarex/utils/strings";

import { isCanonicalArrayIndex } from "./canonical-array-index";
import type { Json } from "./json";

/** The JavaScript value domain accepted at Flarex API boundaries. */
export type FlarexValue =
  | null
  | bigint
  | number
  | boolean
  | string
  | ArrayBuffer
  | ReadonlyArray<FlarexValue>
  | { readonly [key: string]: FlarexValue | undefined };

export type CanonicalFlarexRuntimeObjectV1 = {
  readonly [key: string]: CanonicalFlarexRuntimeValueV1;
};

export type CanonicalFlarexRuntimeValueV1 =
  | null
  | bigint
  | number
  | boolean
  | string
  | ArrayBuffer
  | ReadonlyArray<CanonicalFlarexRuntimeValueV1>
  | CanonicalFlarexRuntimeObjectV1;

export function isCanonicalFlarexRuntimeObjectV1(
  value: CanonicalFlarexRuntimeValueV1,
): value is CanonicalFlarexRuntimeObjectV1 {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    !(value instanceof ArrayBuffer)
  );
}

export const MIN_FLAREX_INT64_V1 = -(1n << 63n);
export const MAX_FLAREX_INT64_V1 = (1n << 63n) - 1n;
export const MAX_FLAREX_VALUE_SEMANTIC_BYTES_V1 = 1 << 25;
export const MAX_FLAREX_APP_DOCUMENT_SEMANTIC_BYTES_V1 = 1 << 20;
export const MAX_FLAREX_VALUE_NESTING_V1 = 64;
export const MAX_FLAREX_APP_DOCUMENT_NESTING_V1 = 16;
export const MAX_FLAREX_VALUE_ARRAY_ITEMS_V1 = 8_192;
export const MAX_FLAREX_VALUE_OBJECT_FIELDS_V1 = 1_024;
export const MAX_FLAREX_VALUE_OBJECT_FIELD_BYTES_V1 = 1_024;

export type FlarexValueProfileV1 = "generalValue" | "appDocument";

export interface FlarexValueLimitsV1 {
  readonly profile: FlarexValueProfileV1;
  readonly maxSemanticBytes: number;
  readonly maxNesting: number;
  readonly maxArrayItems: number;
  readonly maxObjectFields: number;
  readonly requireDocumentObject: boolean;
}

export const FLAREX_GENERAL_VALUE_LIMITS_V1 = Object.freeze({
  profile: "generalValue",
  maxSemanticBytes: MAX_FLAREX_VALUE_SEMANTIC_BYTES_V1,
  maxNesting: MAX_FLAREX_VALUE_NESTING_V1,
  maxArrayItems: MAX_FLAREX_VALUE_ARRAY_ITEMS_V1,
  maxObjectFields: MAX_FLAREX_VALUE_OBJECT_FIELDS_V1,
  requireDocumentObject: false,
} satisfies FlarexValueLimitsV1);

export const FLAREX_APP_DOCUMENT_LIMITS_V1 = Object.freeze({
  profile: "appDocument",
  maxSemanticBytes: MAX_FLAREX_APP_DOCUMENT_SEMANTIC_BYTES_V1,
  maxNesting: MAX_FLAREX_APP_DOCUMENT_NESTING_V1,
  maxArrayItems: MAX_FLAREX_VALUE_ARRAY_ITEMS_V1,
  maxObjectFields: MAX_FLAREX_VALUE_OBJECT_FIELDS_V1,
  requireDocumentObject: true,
} satisfies FlarexValueLimitsV1);

export interface NormalizedFlarexRuntimeValueV1 {
  readonly profile: FlarexValueProfileV1;
  readonly value: CanonicalFlarexRuntimeValueV1;
  readonly semanticSizeBytes: number;
  readonly nestingDepth: number;
}

export type FlarexValueCodecV1Issue =
  | { readonly reason: "unsupportedValue"; readonly path: string; readonly detail: string }
  | { readonly reason: "invalidContainer"; readonly path: string; readonly detail: string }
  | { readonly reason: "cyclicValue"; readonly path: string }
  | {
      readonly reason: "nestingTooDeep";
      readonly path: string;
      readonly profile: FlarexValueProfileV1;
      readonly observed: number;
      readonly maximum: number;
    }
  | {
      readonly reason: "valueTooLarge";
      readonly path: string;
      readonly profile: FlarexValueProfileV1;
      readonly observedBytes: number;
      readonly maximumBytes: number;
    }
  | { readonly reason: "arrayTooLong"; readonly path: string; readonly observed: number; readonly maximum: number }
  | { readonly reason: "objectTooLarge"; readonly path: string; readonly observed: number; readonly maximum: number }
  | {
      readonly reason: "invalidObjectField";
      readonly path: string;
      readonly field: string;
      readonly detail: string;
    }
  | {
      readonly reason: "invalidTaggedValue";
      readonly path: string;
      readonly tag: string;
      readonly detail: string;
    }
  | { readonly reason: "appDocumentRoot"; readonly path: string };

/** Private failure used by generated runtimes and translated by the public codec. */
export class FlarexValueRuntimeCoreV1Error extends Error {
  readonly issue: FlarexValueCodecV1Issue;

  constructor(issue: FlarexValueCodecV1Issue) {
    super("Flarex Value Codec V1 rejected a runtime value.");
    Object.defineProperty(this, "name", {
      configurable: true,
      value: "FlarexValueRuntimeCoreV1Error",
    });
    this.issue = issue;
  }
}

interface NormalizedNode {
  readonly value: CanonicalFlarexRuntimeValueV1;
  readonly semanticSizeBytes: number;
  readonly nestingDepth: number;
}

interface CodecContext {
  readonly limits: FlarexValueLimitsV1;
  readonly ancestors: WeakSet<object>;
}

export function normalizeFlarexRuntimeValueV1(
  value: unknown,
  profile: FlarexValueProfileV1 = "generalValue",
  rootPath = "$",
): NormalizedFlarexRuntimeValueV1 {
  return normalizeFlarexRuntimeValueWithLimitsV1(
    value,
    limitsForProfile(profile),
    rootPath,
  );
}

export function normalizeFlarexRuntimeValueWithLimitsV1(
  value: unknown,
  limits: FlarexValueLimitsV1,
  rootPath = "$",
): NormalizedFlarexRuntimeValueV1 {
  const node = normalizeRuntimeNode(value, rootPath, 0, {
    limits,
    ancestors: new WeakSet(),
  });
  assertProfileRoot(node.value, limits, rootPath);
  return Object.freeze({
    profile: limits.profile,
    value: node.value,
    semanticSizeBytes: node.semanticSizeBytes,
    nestingDepth: node.nestingDepth,
  } satisfies NormalizedFlarexRuntimeValueV1);
}

/** Converts an already-owned canonical runtime value to its frozen JSON form. */
export function canonicalFlarexRuntimeValueToJsonV1(
  value: CanonicalFlarexRuntimeValueV1,
): Json {
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") {
    return isSpecialFloat(value)
      ? taggedJson("$float", encodeFloat64(value))
      : value;
  }
  if (typeof value === "bigint") {
    return taggedJson("$integer", encodeInt64(value));
  }
  if (typeof value === "string") {
    return value.includes(NUL)
      ? taggedJson("$string", encodeBase64(TEXT_ENCODER.encode(value)))
      : value;
  }
  if (value instanceof ArrayBuffer) {
    return taggedJson("$bytes", encodeBase64(new Uint8Array(value)));
  }
  if (Array.isArray(value)) {
    return Object.freeze(value.map(canonicalFlarexRuntimeValueToJsonV1));
  }
  const json: Record<string, Json> = {};
  for (const [key, member] of Object.entries(value)) {
    defineFrozenProperty(json, key, canonicalFlarexRuntimeValueToJsonV1(member));
  }
  return Object.freeze(json);
}

function normalizeRuntimeNode(
  value: unknown,
  path: string,
  parentNesting: number,
  context: CodecContext,
): NormalizedNode {
  if (value === null || typeof value === "boolean") {
    return primitiveNode(value, 1, path, context);
  }
  if (typeof value === "number") {
    return primitiveNode(value, 9, path, context);
  }
  if (typeof value === "bigint") {
    if (value < MIN_FLAREX_INT64_V1 || value > MAX_FLAREX_INT64_V1) {
      throw unsupported(path, "bigint must fit in a signed 64-bit integer");
    }
    return primitiveNode(value, 9, path, context);
  }
  if (typeof value === "string") {
    assertWellFormedUnicode(value, path);
    if (value.length > context.limits.maxSemanticBytes) {
      assertSemanticSize(value.length + 2, path, context.limits);
    }
    const semanticSizeBytes = 2 + TEXT_ENCODER.encode(value).byteLength;
    assertSemanticSize(semanticSizeBytes, path, context.limits);
    return Object.freeze({ value, semanticSizeBytes, nestingDepth: 0 });
  }
  if (value instanceof ArrayBuffer) {
    const semanticSizeBytes = 2 + value.byteLength;
    assertSemanticSize(semanticSizeBytes, path, context.limits);
    return Object.freeze({
      value: value.slice(0),
      semanticSizeBytes,
      nestingDepth: 0,
    });
  }
  if (Array.isArray(value)) {
    return normalizeRuntimeArray(value, path, parentNesting, context);
  }
  if (typeof value === "object" && value !== null) {
    return normalizeRuntimeObject(value, path, parentNesting, context);
  }
  throw unsupported(path, `unsupported JavaScript type ${typeof value}`);
}

function normalizeRuntimeArray(
  value: ReadonlyArray<unknown>,
  path: string,
  parentNesting: number,
  context: CodecContext,
): NormalizedNode {
  validateArrayShape(value, path);
  assertArrayLength(value.length, path, context.limits);
  const nesting = parentNesting + 1;
  assertNesting(nesting, path, context.limits);
  return withAncestor(value, path, context, () => {
    const normalized: CanonicalFlarexRuntimeValueV1[] = [];
    let semanticSizeBytes = 2;
    let childDepth = 0;
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (descriptor === undefined || !("value" in descriptor)) {
        throw invalidContainer(path, "array must be dense and contain only data properties");
      }
      const child = normalizeRuntimeNode(
        descriptor.value,
        `${path}[${index}]`,
        nesting,
        context,
      );
      semanticSizeBytes += child.semanticSizeBytes;
      assertSemanticSize(semanticSizeBytes, path, context.limits);
      childDepth = Math.max(childDepth, child.nestingDepth);
      normalized.push(child.value);
    }
    return Object.freeze({
      value: Object.freeze(normalized),
      semanticSizeBytes,
      nestingDepth: 1 + childDepth,
    });
  });
}

function normalizeRuntimeObject(
  value: object,
  path: string,
  parentNesting: number,
  context: CodecContext,
): NormalizedNode {
  validatePlainObject(value, path);
  const defined = enumerableDataProperties(value, path)
    .filter((entry) => entry.value !== undefined);
  assertObjectFieldCount(defined.length, path, context.limits);
  const nesting = parentNesting + 1;
  assertNesting(nesting, path, context.limits);
  return withAncestor(value, path, context, () => {
    const normalized: Record<string, CanonicalFlarexRuntimeValueV1> = {};
    let semanticSizeBytes = 2;
    let childDepth = 0;
    for (const entry of defined.toSorted(compareDataProperties)) {
      validateObjectField(entry.key, path);
      const child = normalizeRuntimeNode(
        entry.value,
        propertyPath(path, entry.key),
        nesting,
        context,
      );
      semanticSizeBytes += entry.key.length + 1 + child.semanticSizeBytes;
      assertSemanticSize(semanticSizeBytes, path, context.limits);
      childDepth = Math.max(childDepth, child.nestingDepth);
      defineFrozenProperty(normalized, entry.key, child.value);
    }
    return Object.freeze({
      value: Object.freeze(normalized),
      semanticSizeBytes,
      nestingDepth: 1 + childDepth,
    });
  });
}

interface DataProperty {
  readonly key: string;
  readonly value: unknown;
}

function enumerableDataProperties(value: object, path: string): DataProperty[] {
  const properties: DataProperty[] = [];
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string") {
      throw invalidContainer(path, "symbol properties are not supported");
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) {
      throw invalidContainer(path, "object must contain only enumerable data properties");
    }
    properties.push({ key, value: descriptor.value });
  }
  return properties;
}

function validateArrayShape(value: ReadonlyArray<unknown>, path: string): void {
  const keys = Reflect.ownKeys(value);
  if (keys.length !== value.length + 1) {
    throw invalidContainer(path, "array must be dense and have no extra properties");
  }
  for (const key of keys) {
    if (key === "length") continue;
    if (typeof key !== "string" || !isCanonicalArrayIndex(key, value.length)) {
      throw invalidContainer(path, "array contains a non-index property");
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) {
      throw invalidContainer(path, "array items must be enumerable data properties");
    }
  }
}

function validatePlainObject(value: object, path: string): void {
  const prototype = Object.getPrototypeOf(value);
  if (
    prototype === Object.prototype ||
    prototype === null ||
    isCrossRealmObjectPrototype(prototype)
  ) return;
  throw invalidContainer(path, "value object must be a plain object");
}

function isCrossRealmObjectPrototype(prototype: object): boolean {
  const constructor = Object.getOwnPropertyDescriptor(prototype, "constructor");
  return constructor !== undefined &&
    "value" in constructor &&
    typeof constructor.value === "function" &&
    constructor.value.name === "Object";
}

function validateObjectField(field: string, path: string): void {
  if (field.length > MAX_FLAREX_VALUE_OBJECT_FIELD_BYTES_V1) {
    throw invalidField(path, field, "field exceeds 1,024 ASCII bytes");
  }
  if (field.startsWith("$")) {
    throw invalidField(path, field, "field starts with reserved '$'");
  }
  for (let index = 0; index < field.length; index += 1) {
    const code = field.charCodeAt(index);
    if (code < 0x20 || code >= 0x7f) {
      throw invalidField(path, field, "field must contain only non-control ASCII characters");
    }
  }
}

function assertWellFormedUnicode(value: string, path: string): void {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!Number.isInteger(next) || next < 0xdc00 || next > 0xdfff) {
        throw unsupported(path, "string contains an unpaired high surrogate");
      }
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      throw unsupported(path, "string contains an unpaired low surrogate");
    }
  }
}

function assertProfileRoot(
  value: CanonicalFlarexRuntimeValueV1,
  limits: FlarexValueLimitsV1,
  path: string,
): void {
  if (limits.requireDocumentObject && !isCanonicalFlarexRuntimeObjectV1(value)) {
    throw failure({ reason: "appDocumentRoot", path });
  }
}

function assertNesting(observed: number, path: string, limits: FlarexValueLimitsV1): void {
  if (observed > limits.maxNesting) {
    throw failure({
      reason: "nestingTooDeep",
      path,
      profile: limits.profile,
      observed,
      maximum: limits.maxNesting,
    });
  }
}

function assertSemanticSize(
  observedBytes: number,
  path: string,
  limits: FlarexValueLimitsV1,
): void {
  if (observedBytes > limits.maxSemanticBytes) {
    throw failure({
      reason: "valueTooLarge",
      path,
      profile: limits.profile,
      observedBytes,
      maximumBytes: limits.maxSemanticBytes,
    });
  }
}

function assertArrayLength(observed: number, path: string, limits: FlarexValueLimitsV1): void {
  if (observed > limits.maxArrayItems) {
    throw failure({ reason: "arrayTooLong", path, observed, maximum: limits.maxArrayItems });
  }
}

function assertObjectFieldCount(
  observed: number,
  path: string,
  limits: FlarexValueLimitsV1,
): void {
  if (observed > limits.maxObjectFields) {
    throw failure({ reason: "objectTooLarge", path, observed, maximum: limits.maxObjectFields });
  }
}

function primitiveNode(
  value: CanonicalFlarexRuntimeValueV1,
  semanticSizeBytes: number,
  path: string,
  context: CodecContext,
): NormalizedNode {
  assertSemanticSize(semanticSizeBytes, path, context.limits);
  return Object.freeze({ value, semanticSizeBytes, nestingDepth: 0 });
}

function withAncestor<T>(
  value: object,
  path: string,
  context: CodecContext,
  operation: () => T,
): T {
  if (context.ancestors.has(value)) {
    throw failure({ reason: "cyclicValue", path });
  }
  context.ancestors.add(value);
  try {
    return operation();
  } finally {
    context.ancestors.delete(value);
  }
}

function limitsForProfile(profile: FlarexValueProfileV1): FlarexValueLimitsV1 {
  if (profile === "generalValue") return FLAREX_GENERAL_VALUE_LIMITS_V1;
  if (profile === "appDocument") return FLAREX_APP_DOCUMENT_LIMITS_V1;
  throw unsupported("$profile", `unsupported value profile ${String(profile)}`);
}

function compareDataProperties(left: DataProperty, right: DataProperty): number {
  return compareUtf16Strings(left.key, right.key);
}

function propertyPath(path: string, field: string): string {
  return `${path}[${JSON.stringify(field)}]`;
}

function defineFrozenProperty<Value>(
  target: Record<string, Value>,
  key: string,
  value: Value,
): void {
  Object.defineProperty(target, key, {
    configurable: false,
    enumerable: true,
    writable: false,
    value,
  });
}

function taggedJson(tag: string, payload: string): Json {
  const value: Record<string, Json> = {};
  defineFrozenProperty(value, tag, payload);
  return Object.freeze(value);
}

function encodeInt64(value: bigint): string {
  let unsigned = value < 0 ? value + (1n << 64n) : value;
  const bytes = new Uint8Array(8);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number(unsigned & 0xffn);
    unsigned >>= 8n;
  }
  return encodeBase64(bytes);
}

function encodeFloat64(value: number): string {
  const buffer = new ArrayBuffer(8);
  new DataView(buffer).setFloat64(0, value, true);
  return encodeBase64(new Uint8Array(buffer));
}

function isSpecialFloat(value: number): boolean {
  return Number.isNaN(value) || !Number.isFinite(value) || Object.is(value, -0);
}

function encodeBase64(bytes: Uint8Array): string {
  let output = "";
  let index = 0;
  while (index + 2 < bytes.length) {
    const first = requiredByte(bytes, index);
    const second = requiredByte(bytes, index + 1);
    const third = requiredByte(bytes, index + 2);
    output += base64Character(first >> 2);
    output += base64Character(((first & 0x03) << 4) | (second >> 4));
    output += base64Character(((second & 0x0f) << 2) | (third >> 6));
    output += base64Character(third & 0x3f);
    index += 3;
  }
  const remaining = bytes.length - index;
  if (remaining === 1) {
    const first = requiredByte(bytes, index);
    output += base64Character(first >> 2);
    output += base64Character((first & 0x03) << 4);
    output += "==";
  } else if (remaining === 2) {
    const first = requiredByte(bytes, index);
    const second = requiredByte(bytes, index + 1);
    output += base64Character(first >> 2);
    output += base64Character(((first & 0x03) << 4) | (second >> 4));
    output += base64Character((second & 0x0f) << 2);
    output += "=";
  }
  return output;
}

function base64Character(index: number): string {
  return BASE64_ALPHABET.charAt(index);
}

function requiredByte(bytes: Uint8Array, index: number): number {
  const value = bytes[index];
  if (value === undefined) throw new Error("Byte array lost an item during base64 encoding.");
  return value;
}

function failure(issue: FlarexValueCodecV1Issue): FlarexValueRuntimeCoreV1Error {
  return new FlarexValueRuntimeCoreV1Error(issue);
}

function unsupported(path: string, detail: string): FlarexValueRuntimeCoreV1Error {
  return failure({ reason: "unsupportedValue", path, detail });
}

function invalidContainer(path: string, detail: string): FlarexValueRuntimeCoreV1Error {
  return failure({ reason: "invalidContainer", path, detail });
}

function invalidField(
  path: string,
  field: string,
  detail: string,
): FlarexValueRuntimeCoreV1Error {
  return failure({ reason: "invalidObjectField", path, field, detail });
}

const TEXT_ENCODER = new TextEncoder();
const NUL = "\u0000";
const BASE64_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
