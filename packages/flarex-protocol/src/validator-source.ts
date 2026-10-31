/** Pinned Convex db914cf06 schemas/json.rs DTO and ordered semantic boundary.
 * Text stays lossless through DTO parsing: JSON.parse would erase duplicate keys. */
import {
  decodeValidatorJsonResultCoreV1, decodeValidatorLiteralWireV1,
  validatorIsSubsetOfStringV1, validatorIsStringSubtypeWithStringLiteralV1,
  ValidatorJsonV1InputError, type ValidatorJsonV1, type ObjectValidatorJsonV1, type DocumentValidatorJsonV1,
} from "./validator-json-core";
import { FlarexValueRuntimeCoreV1Error } from "./value-runtime-core";

const FREEZE = Object.freeze;
const DEFINE = Object.defineProperty;
const DESCRIPTOR = Object.getOwnPropertyDescriptor;
const KEYS = Reflect.ownKeys;
const APPLY = Reflect.apply;
const HAS = Object.hasOwn;
const IS_ARRAY = Array.isArray;
const IS_FINITE = Number.isFinite;
const IS_SAFE_INTEGER = Number.isSafeInteger;
const GENERATOR_NEXT = Object.getPrototypeOf(function* () {}.prototype).next;
const ENCODER = new TextEncoder();
const ENCODE = TextEncoder.prototype.encode;
const PARSE = JSON.parse;
const SYNTAX_ERROR = SyntaxError;
const STRINGIFY = JSON.stringify;
const CHAR_CODE = String.prototype.charCodeAt;
const SLICE = String.prototype.slice;
const SORT = Array.prototype.sort;
const WEAK_MAP = WeakMap;
const WEAK_SET_CLASS = WeakSet;
const WEAK_GET = WeakMap.prototype.get;
const WEAK_SET = WeakMap.prototype.set;
const SET_HAS = WeakSet.prototype.has;
const SET_ADD = WeakSet.prototype.add;
const SET_DELETE = WeakSet.prototype.delete;

export type SourceJsonNode =
  | Readonly<{ kind: "scalar"; value: null | boolean | string | number; numberToken?: string }>
  | Readonly<{ kind: "array"; items: readonly SourceJsonNode[] }>
  | Readonly<{ kind: "object"; entries: readonly (readonly [string, SourceJsonNode])[] }>;
export type SourceIssue = Readonly<{ phase: "raw" | "semantic"; reason: string; path: string; message: string }>;
export type SourceResult<Value> = { readonly ok: true; readonly value: Value } | { readonly ok: false; readonly issue: SourceIssue };

class SourceFailure extends Error {
  constructor(readonly issue: SourceIssue) { super(issue.message); }
}
function fail(phase: SourceIssue["phase"], reason: string, path: string, message: string): never {
  throw new SourceFailure(FREEZE({ phase, reason, path, message }));
}
function result<Value>(run: () => Value): SourceResult<Value> {
  try { return { ok: true, value: run() }; }
  catch (cause) { if (cause instanceof SourceFailure) return { ok: false, issue: cause.issue }; throw cause; }
}
function put<Value>(array: Value[], value: Value): void { DEFINE(array, array.length, { value, enumerable: true, configurable: true, writable: true }); }
function code(text: string, index: number): number { return APPLY(CHAR_CODE, text, [index]); }
function slice(text: string, start: number, end?: number): string { return APPLY(SLICE, text, end === undefined ? [start] : [start, end]); }
function hasLoneSurrogate(text: string): boolean {
  for (let index = 0; index < text.length; index += 1) {
    const unit = code(text, index);
    if (unit >= 0xd800 && unit <= 0xdbff) { const next = code(text, ++index); if (!(next >= 0xdc00 && next <= 0xdfff)) return true; }
    else if (unit >= 0xdc00 && unit <= 0xdfff) return true;
  }
  return false;
}

export const SOURCE_JSON_MAXIMUM_OPEN_CONTAINERS = 127;

/** serde_json's default recursion budget admits 127 simultaneously open containers. */
export function parseSourceJsonText(text: string): SourceResult<SourceJsonNode> {
  return result(() => {
    if (typeof text !== "string") return fail("raw", "invalidJson", "$", "Source JSON must be text.");
    let offset = 0;
    function whitespace(): void { while (offset < text.length && (code(text, offset) === 32 || code(text, offset) === 9 || code(text, offset) === 10 || code(text, offset) === 13)) offset += 1; }
    function string(): string {
      const start = offset++;
      let escaped = false;
      while (offset < text.length) {
        const unit = code(text, offset++);
        if (!escaped && unit === 34) {
          let value: unknown;
          try { value = PARSE(slice(text, start, offset)); }
          catch (cause) { if (cause instanceof SYNTAX_ERROR) return fail("raw", "invalidJson", "$", "Malformed source JSON string."); throw cause; }
          if (typeof value !== "string" || hasLoneSurrogate(value)) return fail("raw", "invalidUnicode", "$", "Source strings must contain Unicode scalar values.");
          return value;
        }
        if (!escaped && unit < 32) return fail("raw", "invalidJson", "$", "Unescaped control character in JSON string.");
        if (!escaped && unit === 92) escaped = true; else escaped = false;
      }
      return fail("raw", "invalidJson", "$", "Unterminated source JSON string.");
    }
    function visit(depth: number): SourceJsonNode {
      whitespace();
      const start = offset;
      const unit = code(text, offset);
      if (unit === 123 || unit === 91) {
        if (depth >= SOURCE_JSON_MAXIMUM_OPEN_CONTAINERS) return fail("raw", "recursionLimit", "$", "Source JSON recursion limit exceeded.");
        offset += 1; whitespace();
        if (unit === 91) {
          const items: SourceJsonNode[] = [];
          if (code(text, offset) !== 93) while (true) { put(items, visit(depth + 1)); whitespace(); if (code(text, offset) !== 44) break; offset += 1; }
          if (code(text, offset++) !== 93) return fail("raw", "invalidJson", "$", "Expected JSON array terminator.");
          return FREEZE({ kind: "array", items: FREEZE(items) });
        }
        const entries: (readonly [string, SourceJsonNode])[] = [];
        if (code(text, offset) !== 125) while (true) {
          whitespace(); if (code(text, offset) !== 34) return fail("raw", "invalidJson", "$", "Expected JSON object key.");
          const name = string(); whitespace();
          if (code(text, offset++) !== 58) return fail("raw", "invalidJson", "$", "Expected JSON object colon.");
          put(entries, FREEZE([name, visit(depth + 1)] as const)); whitespace();
          if (code(text, offset) !== 44) break; offset += 1;
        }
        if (code(text, offset++) !== 125) return fail("raw", "invalidJson", "$", "Expected JSON object terminator.");
        return FREEZE({ kind: "object", entries: FREEZE(entries) });
      }
      if (unit === 34) return FREEZE({ kind: "scalar", value: string() });
      while (offset < text.length && code(text, offset) !== 44 && code(text, offset) !== 93 && code(text, offset) !== 125 && code(text, offset) !== 32 && code(text, offset) !== 9 && code(text, offset) !== 10 && code(text, offset) !== 13) offset += 1;
      if (start === offset) return fail("raw", "invalidJson", "$", "Expected JSON value.");
      let value: unknown;
      try { value = PARSE(slice(text, start, offset)); } catch (cause) { if (cause instanceof SYNTAX_ERROR) return fail("raw", "invalidJson", "$", "Malformed source JSON value."); throw cause; }
      if (value !== null && typeof value !== "boolean" && typeof value !== "number") return fail("raw", "invalidJson", "$", "Invalid JSON scalar.");
      if (typeof value === "number" && !IS_FINITE(value)) return fail("raw", "numberRange", "$", "JSON number is outside the finite Float64 range.");
      return FREEZE({ kind: "scalar", value, ...(typeof value === "number" ? { numberToken: slice(text, start, offset) } : {}) });
    }
    const value = visit(0); whitespace();
    if (offset !== text.length) return fail("raw", "invalidJson", "$", "Trailing source JSON data.");
    return value;
  });
}

/** Descriptor-only capture for callers that already own a decoded JSON value. */
export function captureSourceJson(input: unknown): SourceResult<SourceJsonNode> {
  return result(() => {
    const memo = new WEAK_MAP<object, SourceJsonNode>();
    const heights = new WEAK_MAP<SourceJsonNode, number>();
    const active = new WEAK_SET_CLASS<object>();
    function visit(value: unknown, depth: number, path: string): SourceJsonNode {
      if (value === null || typeof value === "boolean" || typeof value === "number" || typeof value === "string") {
        if (typeof value === "number" && !IS_FINITE(value)) return fail("raw", "numberRange", path, "JSON numbers must be finite.");
        if (typeof value === "string" && hasLoneSurrogate(value)) return fail("raw", "invalidUnicode", path, "Source strings must contain Unicode scalar values.");
        return FREEZE({ kind: "scalar", value });
      }
      if (typeof value !== "object") return fail("raw", "invalidJson", path, "Expected a JSON data value.");
      if (depth >= SOURCE_JSON_MAXIMUM_OPEN_CONTAINERS) return fail("raw", "recursionLimit", path, "Source JSON recursion limit exceeded.");
      if (APPLY(SET_HAS, active, [value])) return fail("raw", "cycle", path, "Cyclic source JSON is invalid.");
      const old: SourceJsonNode | undefined = APPLY(WEAK_GET, memo, [value]);
      if (old !== undefined) { const height: number = APPLY(WEAK_GET, heights, [old]); if (depth + height > SOURCE_JSON_MAXIMUM_OPEN_CONTAINERS) return fail("raw", "recursionLimit", path, "Source JSON recursion limit exceeded."); return old; }
      APPLY(SET_ADD, active, [value]);
      let node: SourceJsonNode;
      if (IS_ARRAY(value)) {
        const lengthDescriptor = DESCRIPTOR(value, "length");
        const length: unknown = lengthDescriptor?.value;
        if (typeof length !== "number" || !IS_SAFE_INTEGER(length) || length < 0) return fail("raw", "invalidJson", path, "Invalid JSON array length.");
        const items: SourceJsonNode[] = [];
        for (let index = 0; index < length; index += 1) {
          const member = DESCRIPTOR(value, index);
          if (member === undefined || !HAS(member, "value")) return fail("raw", "invalidJson", `${path}[${index}]`, "JSON arrays require own data members.");
          put(items, visit(member.value, depth + 1, `${path}[${index}]`));
        }
        node = FREEZE({ kind: "array", items: FREEZE(items) });
      } else {
        const entries: (readonly [string, SourceJsonNode])[] = [];
        const names = KEYS(value);
        for (let index = 0; index < names.length; index += 1) {
          const name = names[index]; const descriptor = name === undefined ? undefined : DESCRIPTOR(value, name);
          if (descriptor?.enumerable !== true) continue;
          if (typeof name !== "string" || !HAS(descriptor, "value") || hasLoneSurrogate(name)) return fail("raw", "invalidJson", path, "JSON objects require string own data members.");
          put(entries, FREEZE([name, visit(descriptor.value, depth + 1, `${path}[${STRINGIFY(name)}]`)] as const));
        }
        node = FREEZE({ kind: "object", entries: FREEZE(entries) });
      }
      let height = 1;
      if (node.kind === "array") { for (let index = 0; index < node.items.length; index += 1) { const childHeight: number | undefined = APPLY(WEAK_GET, heights, [node.items[index]!]); if (childHeight !== undefined && childHeight + 1 > height) height = childHeight + 1; } }
      else { for (let index = 0; index < node.entries.length; index += 1) { const childHeight: number | undefined = APPLY(WEAK_GET, heights, [node.entries[index]![1]]); if (childHeight !== undefined && childHeight + 1 > height) height = childHeight + 1; } }
      APPLY(WEAK_SET, heights, [node, height]); APPLY(SET_DELETE, active, [value]); APPLY(WEAK_SET, memo, [value, node]); return node;
    }
    return visit(input, 0, "$");
  });
}

export type FieldTypeSourceDto = Readonly<{ fieldType: ValidatorSourceDto; optional: boolean }>;
export type ValidatorSourceDto =
  | Readonly<{ type: "null" | "number" | "bigint" | "commitTs" | "boolean" | "string" | "bytes" | "any" }>
  | Readonly<{ type: "id"; tableName: string }>
  | Readonly<{ type: "literal"; value: SourceJsonNode }>
  | Readonly<{ type: "array"; value: ValidatorSourceDto }>
  | Readonly<{ type: "record"; keys: ValidatorSourceDto; values: FieldTypeSourceDto }>
  | Readonly<{ type: "object"; value: Readonly<Record<string, FieldTypeSourceDto>> }>
  | Readonly<{ type: "union"; value: readonly ValidatorSourceDto[] }>
  | Readonly<{ type: "function"; fnType?: "query" | "mutation" | "action"; args?: ValidatorSourceDto; returns?: ValidatorSourceDto }>;

function scalar(node: SourceJsonNode | undefined, path: string): null | boolean | string | number {
  if (node?.kind !== "scalar") return fail("raw", "invalidShape", path, "Expected a scalar source DTO member.");
  return node.value;
}
function isNull(node: SourceJsonNode): boolean { return node.kind === "scalar" && node.value === null; }

/** Struct members are parsed in encounter order, including before duplicate refusal. */
interface SourceStructFields<Value> { readonly [name: string]: Value }
interface SourceDtoConstruction { readonly type: string; readonly [name: string]: unknown }
function parseFields<Value>(node: SourceJsonNode, names: readonly string[], path: string, parse: (name: string, node: SourceJsonNode, path: string) => Value): SourceStructFields<Value> {
  const fields: Record<string, Value> = {};
  if (node.kind === "array") {
    if (node.items.length !== names.length) return fail("raw", "invalidLength", path, "Invalid source DTO sequence length.");
    for (let index = 0; index < names.length; index += 1) { const name = names[index]!; DEFINE(fields, name, { enumerable: true, value: parse(name, node.items[index]!, `${path}.${name}`) }); }
    return fields;
  }
  if (node.kind !== "object") return fail("raw", "invalidShape", path, "Expected source DTO struct.");
  for (let index = 0; index < node.entries.length; index += 1) {
    const entry = node.entries[index]!; const name = entry[0]; const value = entry[1];
    let known = false; for (let slot = 0; slot < names.length; slot += 1) if (names[slot] === name) known = true;
    if (!known) continue;
    if (HAS(fields, name)) return fail("raw", "duplicateProperty", `${path}.${name}`, `Duplicate source DTO field ${name}.`);
    DEFINE(fields, name, { enumerable: true, value: parse(name, value, `${path}.${name}`) });
  }
  return fields;
}
interface SourceDtoMemo { readonly validators: WeakMap<SourceJsonNode, ValidatorSourceDto>; readonly fields: WeakMap<SourceJsonNode, FieldTypeSourceDto> }
function dtoMemo(): SourceDtoMemo { return { validators: new WEAK_MAP(), fields: new WEAK_MAP() }; }
function decodeField(node: SourceJsonNode, path: string, memo: SourceDtoMemo): FieldTypeSourceDto {
  const old: FieldTypeSourceDto | undefined = APPLY(WEAK_GET, memo.fields, [node]); if (old !== undefined) return old;
  const fields = parseFields<ValidatorSourceDto | boolean>(node, ["fieldType", "optional"], path, (name, child, childPath) => {
    if (name === "fieldType") return decodeDto(child, childPath, memo);
    const value = scalar(child, childPath); if (typeof value !== "boolean") return fail("raw", "invalidShape", childPath, "Source optional must be boolean."); return value;
  });
  if (!HAS(fields, "fieldType") || !HAS(fields, "optional")) return fail("raw", "missingProperty", path, "Source field requires fieldType and optional.");
  const fieldType = fields.fieldType; const optional = fields.optional;
  if (typeof fieldType !== "object" || typeof optional !== "boolean") return fail("raw", "invalidShape", path, "Invalid source field wrapper.");
  const field = FREEZE({ fieldType, optional }); APPLY(WEAK_SET, memo.fields, [node, field]); return field;
}
function decodeDto(node: SourceJsonNode, path: string, memo: SourceDtoMemo): ValidatorSourceDto {
  const old: ValidatorSourceDto | undefined = APPLY(WEAK_GET, memo.validators, [node]); if (old !== undefined) return old;
  // Internally tagged serde enums buffer content; the first type determines the variant.
  let typeNode: SourceJsonNode | undefined;
  if (node.kind === "array") typeNode = node.items[0];
  else if (node.kind === "object") for (let index = 0; index < node.entries.length; index += 1) { const entry = node.entries[index]!; if (entry[0] === "type") { typeNode = entry[1]; break; } }
  const rawType = scalar(typeNode, `${path}.type`);
  if (typeof rawType !== "string") return fail("raw", "invalidShape", `${path}.type`, "Source validator type must be a string.");
  const type = rawType === "map" || rawType === "set" ? "any" : rawType;
  const names = type === "record" ? ["keys", "values"] : type === "id" ? ["tableName"] : type === "function" ? ["fnType", "args", "returns"] : type === "literal" || type === "array" || type === "object" || type === "union" ? ["value"] : [];
  if (type !== "null" && type !== "number" && type !== "bigint" && type !== "commitTs" && type !== "boolean" && type !== "string" && type !== "bytes" && type !== "any" && type !== "function" && type !== "literal" && type !== "id" && type !== "array" && type !== "record" && type !== "object" && type !== "union") return fail("raw", "unknownVariant", `${path}.type`, "Unknown source validator type.");
  let content: SourceJsonNode = node;
  if (node.kind === "array") { const items: SourceJsonNode[] = []; for (let index = 1; index < node.items.length; index += 1) put(items, node.items[index]!); content = FREEZE({ kind: "array", items: FREEZE(items) }); }
  else if (node.kind === "object") {
    let seen = false;
    const entries: (readonly [string, SourceJsonNode])[] = [];
    for (let index = 0; index < node.entries.length; index += 1) { const entry = node.entries[index]!; if (entry[0] === "type") { if (seen) return fail("raw", "duplicateProperty", `${path}.type`, "Duplicate source DTO field type."); seen = true; } else put(entries, entry); }
    content = FREEZE({ kind: "object", entries: FREEZE(entries) });
  }
  // Parse members now rather than collecting unparsed last values.
  const parsed = parseFields<unknown>(content, names, path, (name, child, childPath) => {
    if (type === "literal") return child;
    if (type === "id") { const value = scalar(child, childPath); if (typeof value !== "string") return fail("raw", "invalidShape", childPath, "ID tableName must be a string."); return value; }
    if (type === "function" && isNull(child)) return undefined;
    if (type === "function" && name === "fnType") { const value = scalar(child, childPath); if (value !== "query" && value !== "mutation" && value !== "action") return fail("raw", "invalidShape", childPath, "Invalid function handle type."); return value; }
    if (type === "record" && name === "values") return decodeField(child, childPath, memo);
    if (type === "object") {
      if (child.kind !== "object") return fail("raw", "invalidShape", childPath, "Source object fields must be a map.");
      const fields: Record<string, FieldTypeSourceDto> = {};
      for (let index = 0; index < child.entries.length; index += 1) { const entry = child.entries[index]!; const key = entry[0]; const value = entry[1]; DEFINE(fields, key, { configurable: true, enumerable: true, value: decodeField(value, `${childPath}[${STRINGIFY(key)}]`, memo) }); }
      return FREEZE(fields);
    }
    if (type === "union") { if (child.kind !== "array") return fail("raw", "invalidShape", childPath, "Source union requires an array."); const values: ValidatorSourceDto[] = []; for (let index = 0; index < child.items.length; index += 1) put(values, decodeDto(child.items[index]!, `${childPath}[${index}]`, memo)); return FREEZE(values); }
    return decodeDto(child, childPath, memo);
  });
  const out: SourceDtoConstruction = { type };
  for (let index = 0; index < names.length; index += 1) {
    const name = names[index]!;
    if (!HAS(parsed, name)) { if (type !== "function") return fail("raw", "missingProperty", `${path}.${name}`, `Missing source DTO field ${name}.`); }
    else if (parsed[name] !== undefined) DEFINE(out, name, { enumerable: true, value: parsed[name] });
  }
  // SAFETY: the selected variant parser above checks each required member, its recursive DTO type, and optional fields before building this immutable discriminated DTO.
  const decoded = FREEZE(out) as ValidatorSourceDto; APPLY(WEAK_SET, memo.validators, [node, decoded]); return decoded;
}
export function decodeValidatorSourceDto(node: SourceJsonNode, path = "$"): SourceResult<ValidatorSourceDto> { return result(() => decodeDto(node, path, dtoMemo())); }
export function decodeFieldTypeSourceDto(node: SourceJsonNode, path = "$"): SourceResult<FieldTypeSourceDto> { return result(() => decodeField(node, path, dtoMemo())); }

/** Literal semantics need only a scalar or an exact one-member numeric tag.
 * The raw DTO phase already parsed all nested arbitrary JSON before this point. */
function literalJsonValue(node: SourceJsonNode): unknown {
  if (node.kind === "scalar") return node.value;
  if (node.kind === "array") return FREEZE([]);
  const object: Record<string, unknown> = {};
  for (let index = 0; index < node.entries.length; index += 1) { const entry = node.entries[index]!; const child = entry[1]; DEFINE(object, entry[0], { configurable: true, enumerable: true, value: child.kind === "scalar" ? child.value : FREEZE({}) }); }
  return FREEZE(object);
}

function identifier(value: string, path: string | (() => string), field: boolean): void {
  function at(): string { return typeof path === "string" ? path : path(); }
  if (field) {
    if (code(value, 0) === 36 || value.length > 1024) return fail("semantic", "invalidFieldName", at(), "Invalid source field name.");
    for (let index = 0; index < value.length; index += 1) if (code(value, index) < 32 || code(value, index) > 126) return fail("semantic", "invalidFieldName", at(), "Source field names require printable ASCII.");
  }
  if (value.length === 0 || value.length > 64) return fail("semantic", "invalidIdentifier", at(), "Source identifiers require 1 to 64 ASCII characters.");
  let nonUnderscore = false;
  for (let index = 0; index < value.length; index += 1) {
    const unit = code(value, index); const letter = unit >= 65 && unit <= 90 || unit >= 97 && unit <= 122; const digit = unit >= 48 && unit <= 57;
    if (!(letter || unit === 95 || index > 0 && digit)) return fail("semantic", "invalidIdentifier", at(), "Invalid source identifier.");
    if (unit !== 95) nonUnderscore = true;
  }
  if (!nonUnderscore) return fail("semantic", "invalidIdentifier", at(), "Source identifiers cannot contain only underscores.");
}
type SourceObjectFields = Readonly<Record<string, FieldTypeSourceDto | ObjectValidatorJsonV1["value"][string]>>;
function orderedNames(object: SourceObjectFields): string[] {
  const names: string[] = []; const keys = KEYS(object); for (let index = 0; index < keys.length; index += 1) { const key = keys[index]; if (typeof key === "string") put(names, key); }
  // Invalid non-ASCII keys still need Rust UTF-8 ordering before name admission.
  APPLY(SORT, names, [(left: string, right: string) => {
    const a: Uint8Array = APPLY(ENCODE, ENCODER, [left]); const b: Uint8Array = APPLY(ENCODE, ENCODER, [right]);
    const length = a.length < b.length ? a.length : b.length;
    for (let index = 0; index < length; index += 1) if (a[index] !== b[index]) return a[index]! - b[index]!;
    return a.length - b.length;
  }]); return names;
}

/** All raw DTOs must be decoded before invoking this ordered semantic stage. */
export function convertValidatorSourceDto(dto: ValidatorSourceDto, path = "$"): SourceResult<ValidatorJsonV1> {
  return result(() => {
    const memo = new WEAK_MAP<ValidatorSourceDto, ValidatorJsonV1>();
    function visit(node: ValidatorSourceDto, at: string): ValidatorJsonV1 {
      const old: ValidatorJsonV1 | undefined = APPLY(WEAK_GET, memo, [node]); if (old !== undefined) return old;
      let value: ValidatorJsonV1;
      switch (node.type) {
        case "literal": {
          try { value = FREEZE({ type: "literal", value: decodeValidatorLiteralWireV1(literalJsonValue(node.value), "convexSchema") }); }
          catch (cause) { if (cause instanceof ValidatorJsonV1InputError || cause instanceof FlarexValueRuntimeCoreV1Error) return fail("semantic", "invalidLiteral", `${at}.value`, "Invalid source literal value."); throw cause; } break;
        }
        case "id": identifier(node.tableName, `${at}.tableName`, false); value = FREEZE({ ...node }); break;
        case "array": value = FREEZE({ type: "array", value: visit(node.value, `${at}.value`) }); break;
        case "union": { const values: ValidatorJsonV1[] = []; for (let index = 0; index < node.value.length; index += 1) put(values, visit(node.value[index]!, `${at}.value[${index}]`)); value = FREEZE({ type: "union", value: FREEZE(values) }); break; }
        case "object": {
          const fields: Record<string, { readonly fieldType: ValidatorJsonV1; readonly optional: boolean }> = {}; const names = orderedNames(node.value);
          for (let index = 0; index < names.length; index += 1) { const name = names[index]!; const fieldPath = `${at}.value[${STRINGIFY(name)}]`; identifier(name, fieldPath, true); const field = node.value[name]!; DEFINE(fields, name, { enumerable: true, value: FREEZE({ fieldType: visit(field.fieldType, `${fieldPath}.fieldType`), optional: field.optional }) }); }
          value = FREEZE({ type: "object", value: FREEZE(fields) }); break;
        }
        case "record": {
          const keys = visit(node.keys, `${at}.keys`);
          if (!validatorIsSubsetOfStringV1(keys)) return fail("semantic", "nonStringRecordKey", `${at}.keys`, "Records require string-subtype keys.");
          const values = visit(node.values.fieldType, `${at}.values.fieldType`);
          if (validatorIsStringSubtypeWithStringLiteralV1(keys)) return fail("semantic", "stringLiteralRecordKey", `${at}.keys`, "Records cannot have string literal keys.");
          if (node.values.optional) return fail("semantic", "optionalRecordValue", `${at}.values.optional`, "Records cannot have optional values.");
          value = FREEZE({ type: "record", keys, values }); break;
        }
        case "function": {
          const args = node.args === undefined ? undefined : visit(node.args, `${at}.args`);
          const returns = node.returns === undefined ? undefined : visit(node.returns, `${at}.returns`);
          value = FREEZE({ type: "function", ...(node.fnType === undefined ? {} : { fnType: node.fnType }), ...(args === undefined ? {} : { args }), ...(returns === undefined ? {} : { returns }) }); break;
        }
        default: value = FREEZE({ ...node });
      }
      APPLY(WEAK_SET, memo, [node, value]); return value;
    }
    return visit(dto, path);
  });
}
export function decodeValidatorSourceTextResult(text: string): SourceResult<ValidatorJsonV1> {
  const parsed = parseSourceJsonText(text); if (!parsed.ok) return parsed;
  const dto = decodeValidatorSourceDto(parsed.value); return dto.ok ? convertValidatorSourceDto(dto.value) : dto;
}
export function decodeValidatorSourceResult(input: unknown): SourceResult<ValidatorJsonV1> {
  const captured = captureSourceJson(input); if (!captured.ok) return captured;
  const dto = decodeValidatorSourceDto(captured.value); return dto.ok ? convertValidatorSourceDto(dto.value) : dto;
}
type SourceSemanticPath = Readonly<{ parent: SourceSemanticPath | undefined; segment: string }>;
function semanticChild(parent: SourceSemanticPath | undefined, segment: string): SourceSemanticPath { return { parent, segment }; }
export function validateSourceValidatorResult(input: unknown): SourceResult<ValidatorJsonV1> {
  const semantic = decodeValidatorJsonResultCoreV1(input);
  if (!semantic.ok) return { ok: false, issue: FREEZE({ phase: "semantic", reason: semantic.issue.reason, path: semantic.issue.path, message: semantic.issue.message }) };
  return result(() => {
    function display(path: SourceSemanticPath | undefined): string { const parts: string[] = []; while (path !== undefined) { put(parts, path.segment); path = path.parent; } let text = "$"; for (let index = parts.length - 1; index >= 0; index -= 1) text += DESCRIPTOR(parts, index)!.value; return text; }
    type Work = { node: ValidatorJsonV1; path: SourceSemanticPath | undefined };
    const done = new WEAK_SET_CLASS<ValidatorJsonV1>();
    function* visit(node: ValidatorJsonV1, path: SourceSemanticPath | undefined): Generator<Work, void, void> {
      if (APPLY(SET_HAS, done, [node])) return;
      switch (node.type) {
        case "literal": if (typeof node.value === "string" && hasLoneSurrogate(node.value)) return fail("semantic", "invalidUnicode", display(semanticChild(path, ".value")), "Source strings must contain Unicode scalar values."); break;
        case "id": identifier(node.tableName, () => display(semanticChild(path, ".tableName")), false); break;
        case "array": yield { node: node.value, path: semanticChild(path, ".value") }; break;
        case "union": for (let index = 0; index < node.value.length; index += 1) yield { node: node.value[index]!, path: semanticChild(path, `.value[${index}]`) }; break;
        case "object": {
          const names = orderedNames(node.value);
          for (let index = 0; index < names.length; index += 1) { const name = names[index]!; const at = semanticChild(path, `.value[${STRINGIFY(name)}]`); identifier(name, () => display(at), true); yield { node: node.value[name]!.fieldType, path: semanticChild(at, ".fieldType") }; } break;
        }
        case "record":
          yield { node: node.keys, path: semanticChild(path, ".keys") };
          if (!validatorIsSubsetOfStringV1(node.keys)) return fail("semantic", "nonStringRecordKey", display(semanticChild(path, ".keys")), "Records require string-subtype keys.");
          yield { node: node.values, path: semanticChild(path, ".values") };
          if (validatorIsStringSubtypeWithStringLiteralV1(node.keys)) return fail("semantic", "stringLiteralRecordKey", display(semanticChild(path, ".keys")), "Records cannot have string literal keys.");
          break;
        case "function":
          if (node.args !== undefined) yield { node: node.args, path: semanticChild(path, ".args") };
          if (node.returns !== undefined) yield { node: node.returns, path: semanticChild(path, ".returns") };
          break;
      }
      APPLY(SET_ADD, done, [node]);
    }
    const work: Generator<Work, void, void>[] = []; put(work, visit(semantic.value, undefined));
    while (work.length > 0) {
      const current = DESCRIPTOR(work, work.length - 1)!.value;
      const step: IteratorResult<Work, void> = APPLY(GENERATOR_NEXT, current, []);
      if (step.done) work.length -= 1; else put(work, visit(step.value.node, step.value.path));
    }
    return semantic.value;
  });
}

/** DocumentSchema admits only Any/Object/immediate object unions; children were parsed first. */
export function normalizeSourceDocumentValidator(input: ValidatorJsonV1): SourceResult<DocumentValidatorJsonV1> {
  const validated = validateSourceValidatorResult(input); if (!validated.ok) return validated;
  const validator = validated.value;
  return result(() => {
    function strip(object: ObjectValidatorJsonV1): ObjectValidatorJsonV1 {
      const fields: Record<string, { readonly fieldType: ValidatorJsonV1; readonly optional: boolean }> = {}; const names = orderedNames(object.value);
      for (let index = 0; index < names.length; index += 1) { const name = names[index]!; if (code(name, 0) !== 95) DEFINE(fields, name, { enumerable: true, value: object.value[name] }); }
      return FREEZE({ type: "object", value: FREEZE(fields) });
    }
    if (validator.type === "any") return FREEZE({ type: "any" as const });
    if (validator.type === "object") return strip(validator);
    if (validator.type !== "union") return fail("semantic", "invalidDocumentRoot", "$", "Document validators must be any, an object, or an immediate union of objects.");
    const members: ObjectValidatorJsonV1[] = [];
    for (let index = 0; index < validator.value.length; index += 1) { const member = validator.value[index]!; if (member.type !== "object") return fail("semantic", "invalidDocumentRoot", `$.value[${index}]`, "Document union members must be objects."); put(members, strip(member)); }
    return members.length === 1 ? members[0]! : FREEZE({ type: "union", value: FREEZE(members) });
  });
}
