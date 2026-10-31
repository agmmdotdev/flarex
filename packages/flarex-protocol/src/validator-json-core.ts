import { compareBytesLexicographically } from "@flarex/utils/bytes";
import { decodeFlarexNumericTagV1, encodeFlarexNumericJsonV1, FlarexValueRuntimeCoreV1Error, MAX_FLAREX_INT64_V1, MIN_FLAREX_INT64_V1, type FlarexNumericTagPolicyV1 } from "./value-runtime-core";

const OBJECT_DEFINE_PROPERTY = Object.defineProperty;
const OBJECT_GET_OWN_PROPERTY_DESCRIPTOR = Object.getOwnPropertyDescriptor;
const OBJECT_GET_PROTOTYPE_OF = Object.getPrototypeOf;
const OBJECT_ENTRIES = Object.entries;
const OBJECT_VALUES = Object.values;
const OBJECT_FREEZE = Object.freeze;
const OBJECT_HAS_OWN = Object.hasOwn;
const OBJECT_IS = Object.is;
const OBJECT_PROTOTYPE = Object.prototype;
const NUMBER_IS_FINITE = Number.isFinite;
const NUMBER_IS_SAFE_INTEGER = Number.isSafeInteger;
const ARRAY_IS_ARRAY = Array.isArray;
const ARRAY_SORT = Array.prototype.sort;
const REFLECT_OWN_KEYS = Reflect.ownKeys;
const REFLECT_APPLY = Reflect.apply;
const JSON_STRINGIFY = JSON.stringify;
const DATA_VIEW_SET_FLOAT64 = DataView.prototype.setFloat64;
const DATA_VIEW_GET_BIG_UINT64 = DataView.prototype.getBigUint64;
const TEXT_ENCODER_ENCODE = TextEncoder.prototype.encode;


export const MAX_VALIDATOR_JSON_NODES_V1 = 65_536;
export const MAX_VALIDATOR_JSON_DEPTH_V1 = 128;
export const MAX_VALIDATOR_JSON_OBJECT_FIELDS_V1 = 1_024;

export type ValidatorLiteralV1 = string | number | boolean | bigint;
export type ValidatorLiteralWireV1 = string | number | boolean | Readonly<{ readonly $integer: string }> | Readonly<{ readonly $float: string }>;
export type ObjectValidatorJsonWireV1 = { readonly type: "object"; readonly value: Readonly<Record<string, { readonly fieldType: ValidatorJsonWireV1; readonly optional: boolean }>> };
export type ValidatorJsonWireV1 =
  | { readonly type: "null" | "number" | "bigint" | "boolean" | "string" | "bytes" | "any" }
  | { readonly type: "id"; readonly tableName: string }
  | { readonly type: "literal"; readonly value: ValidatorLiteralWireV1 }
  | { readonly type: "array"; readonly value: ValidatorJsonWireV1 }
  | ObjectValidatorJsonWireV1
  | { readonly type: "record"; readonly keys: ValidatorJsonWireV1; readonly values: ValidatorJsonWireV1 }
  | { readonly type: "union"; readonly value: ReadonlyArray<ValidatorJsonWireV1> };

export type ObjectValidatorJsonV1 = {
  readonly type: "object";
  readonly value: Readonly<
    Record<
      string,
      { readonly fieldType: ValidatorJsonV1; readonly optional: boolean }
    >
  >;
};

export type ValidatorJsonV1 =
  | {
      readonly type:
        | "null"
        | "number"
        | "bigint"
        | "boolean"
        | "string"
        | "bytes"
        | "any";
    }
  | { readonly type: "id"; readonly tableName: string }
  | { readonly type: "literal"; readonly value: ValidatorLiteralV1 }
  | { readonly type: "array"; readonly value: ValidatorJsonV1 }
  | ObjectValidatorJsonV1
  | {
      readonly type: "record";
      readonly keys: ValidatorJsonV1;
      readonly values: ValidatorJsonV1;
    }
  | { readonly type: "union"; readonly value: ReadonlyArray<ValidatorJsonV1> };

export type ValidatorJsonAdmissionIssueV1 = Readonly<{
  readonly reason:
    | "tooManyNodes"
    | "tooDeep"
    | "tooManyObjectFields"
    | "malformedContainer";
}>;

const MISSING_VALIDATOR_PROPERTY = Symbol("missingValidatorProperty");
const MALFORMED_VALIDATOR_PROPERTY = Symbol("malformedValidatorProperty");

export type CapturedValidatorJsonDataV1 =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly issue: ValidatorJsonAdmissionIssueV1; readonly details: ValidatorJsonDecodeIssueV1 };

export function validatorJsonAdmissionIssueV1(root: unknown): ValidatorJsonAdmissionIssueV1 | undefined {
  const captured = processValidatorJsonDataV1(root, false);
  return captured.ok ? undefined : captured.issue;
}

/** Own descriptors are snapshotted before Schema reads an untrusted validator. */
export function captureValidatorJsonDataV1(root: unknown): CapturedValidatorJsonDataV1 {
  return processValidatorJsonDataV1(root, true);
}

class ValidatorJsonAdmissionFailure extends Error {
  constructor(readonly issue: ValidatorJsonAdmissionIssueV1, readonly path: ValidatorJsonPathV1 | undefined) { super("Validator JSON admission failed."); }
}

function processValidatorJsonDataV1(root: unknown, copy: boolean): CapturedValidatorJsonDataV1 {
  let nodes = 0;
  function refuse(reason: ValidatorJsonAdmissionIssueV1["reason"], path: ValidatorJsonPathV1 | undefined): never { throw new ValidatorJsonAdmissionFailure(admissionIssue(reason), path); }
  function own(value: unknown, key: PropertyKey, path: ValidatorJsonPathV1 | undefined): unknown | typeof MISSING_VALIDATOR_PROPERTY {
    if (typeof value !== "object" || value === null) return MISSING_VALIDATOR_PROPERTY;
    const data = ownValidatorDataProperty(value, key);
    if (data === MALFORMED_VALIDATOR_PROPERTY) return refuse("malformedContainer", validatorChildPath(path, key));
    return data;
  }
  function put(target: Record<string, unknown> | undefined, key: PropertyKey, value: unknown, enumerable = true): void {
    if (target !== undefined && value !== MISSING_VALIDATOR_PROPERTY) OBJECT_DEFINE_PROPERTY(target, key, { enumerable, value });
  }
  // Schema owns ignore/error policy. Extras carry only their keys, never foreign values/getters/graphs.
  function extras(input: unknown, output: Record<string, unknown> | undefined, known: readonly string[], path: ValidatorJsonPathV1 | undefined): void {
    if (output === undefined || typeof input !== "object" || input === null) return;
    const keys = REFLECT_OWN_KEYS(input);
    for (let index = 0; index < keys.length; index += 1) {
      const key = denseOwnItem(keys, index);
      let isKnown = false;
      for (let knownIndex = 0; knownIndex < known.length; knownIndex += 1) if (known[knownIndex] === key) isKnown = true;
      if (isKnown) continue;
      const descriptor = OBJECT_GET_OWN_PROPERTY_DESCRIPTOR(input, key);
      if (descriptor === undefined) return refuse("malformedContainer", validatorChildPath(path, key));
      put(output, key, undefined, descriptor.enumerable === true);
    }
  }
  function visit(value: unknown, depth: number, path: ValidatorJsonPathV1 | undefined): unknown {
    nodes += 1;
    if (nodes > MAX_VALIDATOR_JSON_NODES_V1) return refuse("tooManyNodes", path);
    if (depth > MAX_VALIDATOR_JSON_DEPTH_V1) return refuse("tooDeep", path);
    // Malformed containers never reach Schema, which may inspect their properties.
    if (typeof value !== "object" || value === null || ARRAY_IS_ARRAY(value)) return refuse("malformedContainer", path);
    const type = own(value, "type", path);
    if (typeof type !== "string") return refuse("malformedContainer", validatorChildPath(path, "type"));
    const output: Record<string, unknown> | undefined = copy ? {} : undefined;
    put(output, "type", type);
    switch (type) {
      case "literal": {
        const literal = own(value, "value", path);
        if (literal === MISSING_VALIDATOR_PROPERTY) return refuse("malformedContainer", validatorChildPath(path, "value"));
        if (isObjectContainer(literal)) {
          const tag = captureOwnNumericTagV1(literal);
          if (tag === undefined) return refuse("malformedContainer", validatorChildPath(path, "value"));
          put(output, "value", tag);
        } else {
          if (typeof literal !== "string" && typeof literal !== "boolean" && typeof literal !== "number" && typeof literal !== "bigint") return refuse("malformedContainer", validatorChildPath(path, "value"));
          put(output, "value", literal);
        }
        break;
      }
      case "id": {
        const tableName = own(value, "tableName", path);
        if (typeof tableName !== "string") return refuse("malformedContainer", validatorChildPath(path, "tableName"));
        put(output, "tableName", tableName); break;
      }
      case "array": {
        const child = own(value, "value", path);
        if (child !== MISSING_VALIDATOR_PROPERTY) put(output, "value", visit(child, depth + 1, validatorChildPath(path, "value")));
        break;
      }
      case "record": {
        const keys = ["keys", "values"] as const;
        for (let index = 0; index < keys.length; index += 1) {
          const key = denseOwnItem(keys, index);
          const child = own(value, key, path);
          if (child !== MISSING_VALIDATOR_PROPERTY) put(output, key, visit(child, depth + 1, validatorChildPath(path, key)));
        }
        break;
      }
      case "union": {
        const members = own(value, "value", path);
        if (!ARRAY_IS_ARRAY(members)) return refuse("malformedContainer", validatorChildPath(path, "value"));
        const length = own(members, "length", validatorChildPath(path, "value"));
        if (typeof length !== "number" || !NUMBER_IS_SAFE_INTEGER(length) || length < 0) return refuse("malformedContainer", path);
        if (length > MAX_VALIDATOR_JSON_NODES_V1 - nodes) return refuse("tooManyNodes", path);
        const captured: unknown[] | undefined = copy ? [] : undefined;
        if (captured !== undefined) OBJECT_DEFINE_PROPERTY(captured, "length", { value: length });
        for (let index = 0; index < length; index += 1) {
          const member = own(members, index, validatorChildPath(path, "value"));
          if (member === MISSING_VALIDATOR_PROPERTY) return refuse("malformedContainer", path);
          const child = visit(member, depth + 1, validatorChildPath(validatorChildPath(path, "value"), index));
          if (captured !== undefined) defineArrayItem(captured, index, child);
        }
        put(output, "value", captured); break;
      }
      case "object": {
        const fields = own(value, "value", path);
        if (typeof fields !== "object" || fields === null || ARRAY_IS_ARRAY(fields)) return refuse("malformedContainer", validatorChildPath(path, "value"));
        const keys = REFLECT_OWN_KEYS(fields);
        for (let index = 0; index < keys.length; index += 1) if (typeof denseOwnItem(keys, index) !== "string") return refuse("malformedContainer", path);
        if (keys.length > MAX_VALIDATOR_JSON_OBJECT_FIELDS_V1) return refuse("tooManyObjectFields", validatorChildPath(path, "value"));
        const capturedFields: Record<string, unknown> | undefined = copy ? {} : undefined;
        for (let index = 0; index < keys.length; index += 1) {
          const key = denseOwnItem(keys, index);
          if (typeof key !== "string") return refuse("malformedContainer", path);
          const fieldPath = validatorChildPath(validatorChildPath(path, "value"), key);
          const descriptor = OBJECT_GET_OWN_PROPERTY_DESCRIPTOR(fields, key);
          if (descriptor === undefined || !OBJECT_HAS_OWN(descriptor, "value")) return refuse("malformedContainer", fieldPath);
          const field: unknown = descriptor.value;
          if (typeof field !== "object" || field === null || ARRAY_IS_ARRAY(field)) return refuse("malformedContainer", fieldPath);
          const optional = own(field, "optional", fieldPath);
          if (typeof optional !== "boolean") return refuse("malformedContainer", validatorChildPath(fieldPath, "optional"));
          const fieldType = own(field, "fieldType", fieldPath);
          const capturedField: Record<string, unknown> | undefined = copy ? {} : undefined;
          put(capturedField, "optional", optional);
          if (fieldType !== MISSING_VALIDATOR_PROPERTY) put(capturedField, "fieldType", visit(fieldType, depth + 1, validatorChildPath(fieldPath, "fieldType")));
          extras(field, capturedField, ["fieldType", "optional"], fieldPath);
          put(capturedFields, key, capturedField, descriptor.enumerable === true);
        }
        put(output, "value", capturedFields); break;
      }
    }
    const known = type === "id" ? ["type", "tableName"] : type === "record" ? ["type", "keys", "values"] :
      type === "literal" || type === "array" || type === "object" || type === "union" ? ["type", "value"] : ["type"];
    extras(value, output, known, path);
    return copy ? output : value;
  }
  try { return { ok: true, value: visit(root, 1, undefined) }; }
  catch (cause) {
    const issue = cause instanceof ValidatorJsonAdmissionFailure ? cause.issue : admissionIssue("malformedContainer");
    const path = cause instanceof ValidatorJsonAdmissionFailure ? cause.path : undefined;
    return { ok: false, issue, details: validatorDecodeIssue(issue.reason, path, `Validator JSON admission failed: ${issue.reason}.`) };
  }
}

function isObjectContainer(value: unknown): value is object {
  return (
    (typeof value === "object" && value !== null) ||
    typeof value === "function"
  );
}

function ownValidatorDataProperty<T extends object>(
  value: T,
  key: PropertyKey,
): unknown | typeof MISSING_VALIDATOR_PROPERTY | typeof MALFORMED_VALIDATOR_PROPERTY {
  const descriptor = OBJECT_GET_OWN_PROPERTY_DESCRIPTOR(value, key);
  if (descriptor === undefined) return MISSING_VALIDATOR_PROPERTY;
  return OBJECT_HAS_OWN(descriptor, "value") ? descriptor.value : MALFORMED_VALIDATOR_PROPERTY;
}

function admissionIssue(
  reason: ValidatorJsonAdmissionIssueV1["reason"],
): ValidatorJsonAdmissionIssueV1 {
  return OBJECT_FREEZE({ reason });
}


export class ValidatorJsonV1InputError extends TypeError {
  constructor(message: string, readonly issue?: ValidatorJsonDecodeIssueV1) { super(message); OBJECT_DEFINE_PROPERTY(this, "name", { value: "ValidatorJsonV1InputError", configurable: true }); }
}

/** Intrinsic semantic admission; SDK construction may retain unchecked bigint until export. */
export function isValidatorLiteralV1(value: unknown): value is ValidatorLiteralV1 {
  return typeof value === "string" || typeof value === "boolean" || typeof value === "number" ||
    (typeof value === "bigint" && value >= MIN_FLAREX_INT64_V1 && value <= MAX_FLAREX_INT64_V1);
}
export function captureValidatorLiteralV1(value: unknown): ValidatorLiteralV1 {
  if (!isValidatorLiteralV1(value)) throw new ValidatorJsonV1InputError("A semantic literal must be a string, boolean, Float64, or signed Int64.");
  return value;
}

/** A literal's wire projection alone; ordinary string bytes are unchanged. */
export function encodeValidatorLiteralV1(value: ValidatorLiteralV1): ValidatorLiteralWireV1 {
  return typeof value === "number" || typeof value === "bigint" ? encodeFlarexNumericJsonV1(value) : value;
}

/** Strict JS wire by default; the source Rust schema parser also admits tagged +0. */
export function decodeValidatorLiteralWireV1(value: unknown, policy: FlarexNumericTagPolicyV1 = "canonical"): ValidatorLiteralV1 {
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && NUMBER_IS_FINITE(value) && (policy === "convexSchema" || !OBJECT_IS(value, -0))) return value;
  const tag = captureOwnNumericTagV1(value);
  if (tag === undefined) throw new ValidatorJsonV1InputError("A literal must be a string, boolean, ordinary finite number, or exact numeric tag.");
  return "$integer" in tag ? decodeFlarexNumericTagV1("$integer", tag.$integer, policy) : decodeFlarexNumericTagV1("$float", tag.$float, policy);
}

type NumericLiteralTagV1 = Readonly<{ readonly $integer: string }> | Readonly<{ readonly $float: string }>;
function captureOwnNumericTagV1(value: unknown): NumericLiteralTagV1 | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const prototype = OBJECT_GET_PROTOTYPE_OF(value);
  if (prototype !== OBJECT_PROTOTYPE && prototype !== null) return undefined;
  const keys = REFLECT_OWN_KEYS(value);
  const key = keys[0];
  if (keys.length !== 1 || (key !== "$integer" && key !== "$float")) return undefined;
  const descriptor = OBJECT_GET_OWN_PROPERTY_DESCRIPTOR(value, key);
  if (descriptor === undefined || !OBJECT_HAS_OWN(descriptor, "value") || descriptor.enumerable !== true || typeof descriptor.value !== "string" || descriptor.value.length !== 12) return undefined;
  return key === "$integer" ? OBJECT_FREEZE({ $integer: descriptor.value }) : OBJECT_FREEZE({ $float: descriptor.value });
}

const LITERAL_COMPARISON_VIEW = new DataView(new ArrayBuffer(16));
/** Convex TotalOrdF64 equality keeps signed zero and NaN payload/sign identity. */
export function validatorLiteralEqualV1(left: unknown, right: ValidatorLiteralV1): boolean {
  if (typeof left !== "number") return left === right;
  if (typeof right !== "number") return false;
  REFLECT_APPLY(DATA_VIEW_SET_FLOAT64, LITERAL_COMPARISON_VIEW, [0, left, false]);
  REFLECT_APPLY(DATA_VIEW_SET_FLOAT64, LITERAL_COMPARISON_VIEW, [8, right, false]);
  return REFLECT_APPLY(DATA_VIEW_GET_BIG_UINT64, LITERAL_COMPARISON_VIEW, [0, false]) === REFLECT_APPLY(DATA_VIEW_GET_BIG_UINT64, LITERAL_COMPARISON_VIEW, [8, false]);
}

/** Established semantic tree -> wire DTO; foreign input uses the bounded codec. */
export function encodeValidatorJsonWireCoreV1(value: ObjectValidatorJsonV1): ObjectValidatorJsonWireV1;
export function encodeValidatorJsonWireCoreV1(value: ValidatorJsonV1): ValidatorJsonWireV1;
export function encodeValidatorJsonWireCoreV1(value: ValidatorJsonV1): ValidatorJsonWireV1 {
  switch (value.type) {
    case "literal": return OBJECT_FREEZE({ type: "literal", value: encodeValidatorLiteralV1(value.value) });
    case "array": return OBJECT_FREEZE({ type: "array", value: encodeValidatorJsonWireCoreV1(value.value) });
    case "union": return OBJECT_FREEZE({ type: "union", value: OBJECT_FREEZE(projectValidatorArray(value.value, encodeValidatorJsonWireCoreV1)) });
    case "record": return OBJECT_FREEZE({ type: "record", keys: encodeValidatorJsonWireCoreV1(value.keys), values: encodeValidatorJsonWireCoreV1(value.values) });
    case "object": {
      const fields: Record<string, { readonly fieldType: ValidatorJsonWireV1; readonly optional: boolean }> = {};
      const entries = OBJECT_ENTRIES(value.value);
      for (let index = 0; index < entries.length; index += 1) {
        const entry = denseOwnItem(entries, index);
        OBJECT_DEFINE_PROPERTY(fields, entry[0], { enumerable: true, value: OBJECT_FREEZE({ fieldType: encodeValidatorJsonWireCoreV1(entry[1].fieldType), optional: entry[1].optional }) });
      }
      return OBJECT_FREEZE({ type: "object", value: OBJECT_FREEZE(fields) });
    }
    default: return OBJECT_FREEZE({ ...value });
  }
}

/** Previously bounded/decoded wire DTO -> detached semantic tree. */
export function decodeValidatorJsonWireCoreV1(value: ObjectValidatorJsonWireV1): ObjectValidatorJsonV1;
export function decodeValidatorJsonWireCoreV1(value: ValidatorJsonWireV1): ValidatorJsonV1;
export function decodeValidatorJsonWireCoreV1(value: ValidatorJsonWireV1): ValidatorJsonV1 {
  switch (value.type) {
    case "literal": return OBJECT_FREEZE({ type: "literal", value: decodeValidatorLiteralWireV1(value.value) });
    case "array": return OBJECT_FREEZE({ type: "array", value: decodeValidatorJsonWireCoreV1(value.value) });
    case "union": return OBJECT_FREEZE({ type: "union", value: OBJECT_FREEZE(projectValidatorArray(value.value, decodeValidatorJsonWireCoreV1)) });
    case "record": return OBJECT_FREEZE({ type: "record", keys: decodeValidatorJsonWireCoreV1(value.keys), values: decodeValidatorJsonWireCoreV1(value.values) });
    case "object": {
      const fields: Record<string, { readonly fieldType: ValidatorJsonV1; readonly optional: boolean }> = {};
      const entries = OBJECT_ENTRIES(value.value);
      for (let index = 0; index < entries.length; index += 1) {
        const entry = denseOwnItem(entries, index);
        OBJECT_DEFINE_PROPERTY(fields, entry[0], { enumerable: true, value: OBJECT_FREEZE({ fieldType: decodeValidatorJsonWireCoreV1(entry[1].fieldType), optional: entry[1].optional }) });
      }
      return OBJECT_FREEZE({ type: "object", value: OBJECT_FREEZE(fields) });
    }
    default: return OBJECT_FREEZE({ ...value });
  }
}

/** Persistence/analysis applies this policy after semantic parsing. */
export function validatorJsonHasNonfiniteLiteralV1(value: ValidatorJsonV1): boolean {
  switch (value.type) {
    case "literal": return typeof value.value === "number" && !NUMBER_IS_FINITE(value.value);
    case "array": return validatorJsonHasNonfiniteLiteralV1(value.value);
    case "union": {
      for (let index = 0; index < value.value.length; index += 1) if (validatorJsonHasNonfiniteLiteralV1(denseOwnItem(value.value, index))) return true;
      return false;
    }
    case "record": return validatorJsonHasNonfiniteLiteralV1(value.keys) || validatorJsonHasNonfiniteLiteralV1(value.values);
    case "object": {
      const fields = OBJECT_VALUES(value.value);
      for (let index = 0; index < fields.length; index += 1) if (validatorJsonHasNonfiniteLiteralV1(denseOwnItem(fields, index).fieldType)) return true;
      return false;
    }
    default: return false;
  }
}

/** Pinned Validator::is_subset(String), including the vacuous empty union. */
export function validatorIsSubsetOfStringV1(validator: ValidatorJsonV1): boolean {
  switch (validator.type) {
    case "string": case "id": return true;
    case "literal": return typeof validator.value === "string";
    case "union": {
      for (let index = 0; index < validator.value.length; index += 1) if (!validatorIsSubsetOfStringV1(denseOwnItem(validator.value, index))) return false;
      return true;
    }
    case "null": case "number": case "bigint": case "boolean": case "bytes": case "any":
    case "array": case "object": case "record": return false;
  }
}

/** common/schemas/validator.rs::is_string_subtype_with_string_literal. */
export function validatorIsStringSubtypeWithStringLiteralV1(validator: ValidatorJsonV1): boolean {
  switch (validator.type) {
    case "literal": return typeof validator.value === "string";
    case "union": {
      for (let index = 0; index < validator.value.length; index += 1) if (validatorIsStringSubtypeWithStringLiteralV1(denseOwnItem(validator.value, index))) return true;
      return false;
    }
    case "null": case "number": case "bigint": case "boolean": case "string": case "bytes": case "any":
    case "id": case "array": case "object": case "record": return false;
  }
}

/** Core source parsing may call the two predicates separately to retain error order. */
export function validatorIsValidRecordKeyV1(validator: ValidatorJsonV1): boolean {
  return validatorIsSubsetOfStringV1(validator) && !validatorIsStringSubtypeWithStringLiteralV1(validator);
}

export type ValidatorSourceRecordIssueV1 = Readonly<{
  readonly reason: "nonStringRecordKey" | "stringLiteralRecordKey";
  readonly path: string;
}>;
const SOURCE_VALIDATOR_FIELD_ENCODER = new TextEncoder();

/** After bounded semantic parsing, before analyzed-metadata finite normalization.
 * This is source record admission, not a restriction on generic/historical codecs. */
export function validatorSourceRecordIssueV1(validator: ValidatorJsonV1, path = "$"): ValidatorSourceRecordIssueV1 | undefined {
  switch (validator.type) {
    case "record": {
      const keyPath = `${path}.keys`;
      const keyIssue = validatorSourceRecordIssueV1(validator.keys, keyPath);
      if (keyIssue !== undefined) return keyIssue;
      if (!validatorIsSubsetOfStringV1(validator.keys)) return { reason: "nonStringRecordKey", path: keyPath };
      const valueIssue = validatorSourceRecordIssueV1(validator.values, `${path}.values`);
      if (valueIssue !== undefined) return valueIssue;
      if (validatorIsStringSubtypeWithStringLiteralV1(validator.keys)) return { reason: "stringLiteralRecordKey", path: keyPath };
      return undefined;
    }
    case "array": return validatorSourceRecordIssueV1(validator.value, `${path}.value`);
    case "union": {
      for (let index = 0; index < validator.value.length; index += 1) {
        const member = denseOwnItem(validator.value, index);
        const issue = validatorSourceRecordIssueV1(member, `${path}.value[${index}]`);
        if (issue !== undefined) return issue;
      }
      return undefined;
    }
    case "object": {
      // Rust converts BTreeMap<String, FieldTypeJson> in UTF-8 key order.
      const entries = OBJECT_ENTRIES(validator.value);
      const fields: Array<{ name: string; field: ObjectValidatorJsonV1["value"][string]; bytes: Uint8Array }> = [];
      for (let index = 0; index < entries.length; index += 1) {
        const entry = denseOwnItem(entries, index);
        const bytes: Uint8Array = REFLECT_APPLY(TEXT_ENCODER_ENCODE, SOURCE_VALIDATOR_FIELD_ENCODER, [entry[0]]);
        defineArrayItem(fields, index, { name: entry[0], field: entry[1], bytes });
      }
      REFLECT_APPLY(ARRAY_SORT, fields, [(left: typeof fields[number], right: typeof fields[number]) => compareBytesLexicographically(left.bytes, right.bytes)]);
      for (let index = 0; index < fields.length; index += 1) {
        const { name, field } = denseOwnItem(fields, index);
        const issue = validatorSourceRecordIssueV1(field.fieldType, `${path}.value[${JSON_STRINGIFY(name)}].fieldType`);
        if (issue !== undefined) return issue;
      }
      return undefined;
    }
    case "literal": case "null": case "number": case "bigint": case "boolean": case "string": case "bytes": case "any": case "id": return undefined;
  }
}

/** Native result arrays and admitted validator members are dense, with own items. */
function denseOwnItem<Value>(values: readonly Value[], index: number): Value {
  const item = OBJECT_GET_OWN_PROPERTY_DESCRIPTOR(values, index);
  if (item === undefined || !OBJECT_HAS_OWN(item, "value")) throw new ValidatorJsonV1InputError("An admitted validator array lost an own member.");
  return item.value;
}
function defineArrayItem<Value>(values: Value[], index: number, value: Value): void {
  OBJECT_DEFINE_PROPERTY(values, index, { configurable: true, enumerable: true, writable: true, value });
}
function projectValidatorArray<Source extends ValidatorJsonV1 | ValidatorJsonWireV1, Target>(values: readonly Source[], project: (value: Source) => Target): readonly Target[] {
  const result: Target[] = [];
  OBJECT_DEFINE_PROPERTY(result, "length", { value: values.length });
  for (let index = 0; index < values.length; index += 1) {
    if (!OBJECT_HAS_OWN(values, index)) continue;
    defineArrayItem(result, index, project(denseOwnItem(values, index)));
  }
  return OBJECT_FREEZE(result);
}

export interface ValidatorJsonDecodeOptionsV1 {
  readonly onExcessProperty?: "ignore" | "error" | "preserve" | undefined;
}
export type ValidatorJsonDecodeIssueV1 = Readonly<{
  readonly reason: ValidatorJsonAdmissionIssueV1["reason"] | "invalidShape" | "missingProperty" | "invalidLiteral" | "unexpectedField" | "unsupportedExcessPolicy";
  readonly path: string;
  readonly segments: readonly PropertyKey[];
  readonly message: string;
}>;
export type ValidatorJsonDecodeResultV1 =
  | { readonly ok: true; readonly value: ValidatorJsonV1 }
  | { readonly ok: false; readonly issue: ValidatorJsonDecodeIssueV1 };

type ValidatorJsonPathV1 = Readonly<{ parent: ValidatorJsonPathV1 | undefined; key: PropertyKey }>;
function validatorChildPath(path: ValidatorJsonPathV1 | undefined, key: PropertyKey): ValidatorJsonPathV1 { return { parent: path, key }; }
class ValidatorJsonDecodeFailure extends Error {
  constructor(readonly issue: ValidatorJsonDecodeIssueV1) { super(issue.message); }
}

function validatorDecodeIssue(reason: ValidatorJsonDecodeIssueV1["reason"], path: ValidatorJsonPathV1 | undefined, message: string): ValidatorJsonDecodeIssueV1 {
  const reversed: PropertyKey[] = [];
  let current = path;
  while (current !== undefined) { defineArrayItem(reversed, reversed.length, current.key); current = current.parent; }
  const segments: PropertyKey[] = [];
  let display = "$";
  for (let index = reversed.length - 1; index >= 0; index -= 1) {
    const key = denseOwnItem(reversed, index);
    defineArrayItem(segments, segments.length, key);
    display += typeof key === "symbol" ? "[symbol]" : `[${JSON_STRINGIFY(key)}]`;
  }
  return OBJECT_FREEZE({ reason, path: display, segments: OBJECT_FREEZE(segments), message });
}

/** Authoritative bounded semantic admission, independent of ambient Effect internals. */
export function decodeValidatorJsonResultCoreV1(root: unknown, options: ValidatorJsonDecodeOptionsV1 = {}): ValidatorJsonDecodeResultV1 {
  return decodeValidatorJsonInputCoreV1(root, "semantic", options);
}
/** Authoritative bounded canonical wire admission; numeric tags become semantic values. */
export function decodeValidatorJsonWireResultCoreV1(root: unknown, options: ValidatorJsonDecodeOptionsV1 = {}): ValidatorJsonDecodeResultV1 {
  return decodeValidatorJsonInputCoreV1(root, "wire", options);
}

function decodeValidatorJsonInputCoreV1(root: unknown, profile: "semantic" | "wire", options: ValidatorJsonDecodeOptionsV1): ValidatorJsonDecodeResultV1 {
  if (options.onExcessProperty === "preserve") return { ok: false, issue: validatorDecodeIssue("unsupportedExcessPolicy", undefined, "Canonical validator DTOs do not preserve foreign extra values.") };
  const captured = captureValidatorJsonDataV1(root);
  if (!captured.ok) return { ok: false, issue: captured.details };
  function fail(reason: ValidatorJsonDecodeIssueV1["reason"], path: ValidatorJsonPathV1 | undefined, message: string): never { throw new ValidatorJsonDecodeFailure(validatorDecodeIssue(reason, path, message)); }
  function record(value: unknown, path: ValidatorJsonPathV1 | undefined): object {
    if (typeof value !== "object" || value === null || ARRAY_IS_ARRAY(value)) return fail("invalidShape", path, "Expected a validator metadata object.");
    return value;
  }
  function required(value: unknown, key: string, path: ValidatorJsonPathV1 | undefined): unknown {
    const descriptor = OBJECT_GET_OWN_PROPERTY_DESCRIPTOR(record(value, path), key);
    if (descriptor === undefined || !OBJECT_HAS_OWN(descriptor, "value")) return fail("missingProperty", validatorChildPath(path, key), `Validator metadata is missing ${key}.`);
    return descriptor.value;
  }
  function excess(value: unknown, known: readonly string[], path: ValidatorJsonPathV1 | undefined): void {
    if (options.onExcessProperty !== "error") return;
    const keys = REFLECT_OWN_KEYS(record(value, path));
    for (let index = 0; index < keys.length; index += 1) {
      const key = denseOwnItem(keys, index);
      let allowed = false;
      for (let knownIndex = 0; knownIndex < known.length; knownIndex += 1) if (known[knownIndex] === key) allowed = true;
      if (!allowed) return fail("unexpectedField", validatorChildPath(path, key), "Unexpected validator metadata field.");
    }
  }
  function visit(input: unknown, path: ValidatorJsonPathV1 | undefined): ValidatorJsonV1 {
    const node = record(input, path);
    const type = required(node, "type", path);
    switch (type) {
      case "null": case "number": case "bigint": case "boolean": case "string": case "bytes": case "any":
        excess(node, ["type"], path); return OBJECT_FREEZE({ type });
      case "id": {
        excess(node, ["type", "tableName"], path);
        const tableName = required(node, "tableName", path);
        if (typeof tableName !== "string" || tableName.length === 0) return fail("invalidShape", validatorChildPath(path, "tableName"), "tableName must be a Convex-compatible table identifier");
        return OBJECT_FREEZE({ type, tableName });
      }
      case "literal": {
        excess(node, ["type", "value"], path);
        const raw = required(node, "value", path);
        let value: ValidatorLiteralV1;
        if (profile === "semantic") {
          if (!isValidatorLiteralV1(raw)) return fail("invalidLiteral", validatorChildPath(path, "value"), "Expected a string, boolean, Float64, or signed Int64 literal.");
          value = raw;
        } else {
          try { value = decodeValidatorLiteralWireV1(raw); }
          catch (cause) {
            if (cause instanceof ValidatorJsonV1InputError || cause instanceof FlarexValueRuntimeCoreV1Error) return fail("invalidLiteral", validatorChildPath(path, "value"), "Invalid canonical numeric literal encoding.");
            throw cause;
          }
        }
        return OBJECT_FREEZE({ type, value });
      }
      case "array": {
        excess(node, ["type", "value"], path);
        return OBJECT_FREEZE({ type, value: visit(required(node, "value", path), validatorChildPath(path, "value")) });
      }
      case "record": {
        excess(node, ["type", "keys", "values"], path);
        const keys = visit(required(node, "keys", path), validatorChildPath(path, "keys"));
        const values = visit(required(node, "values", path), validatorChildPath(path, "values"));
        return OBJECT_FREEZE({ type, keys, values });
      }
      case "union": {
        excess(node, ["type", "value"], path);
        const members = required(node, "value", path);
        if (!ARRAY_IS_ARRAY(members)) return fail("invalidShape", validatorChildPath(path, "value"), "Union validator value must be an array.");
        const value: ValidatorJsonV1[] = [];
        OBJECT_DEFINE_PROPERTY(value, "length", { value: members.length });
        for (let index = 0; index < members.length; index += 1) defineArrayItem(value, index, visit(denseOwnItem(members, index), validatorChildPath(validatorChildPath(path, "value"), index)));
        return OBJECT_FREEZE({ type, value: OBJECT_FREEZE(value) });
      }
      case "object": {
        excess(node, ["type", "value"], path);
        const inputFields = record(required(node, "value", path), validatorChildPath(path, "value"));
        const value: Record<string, { readonly fieldType: ValidatorJsonV1; readonly optional: boolean }> = {};
        const names = REFLECT_OWN_KEYS(inputFields);
        for (let index = 0; index < names.length; index += 1) {
          const name = denseOwnItem(names, index);
          const descriptor = OBJECT_GET_OWN_PROPERTY_DESCRIPTOR(inputFields, name);
          if (descriptor === undefined || descriptor.enumerable !== true) continue;
          if (typeof name !== "string" || !OBJECT_HAS_OWN(descriptor, "value")) return fail("invalidShape", validatorChildPath(path, "value"), "Object validator fields require string own data keys.");
          const fieldPath = validatorChildPath(validatorChildPath(path, "value"), name);
          const field = record(descriptor.value, fieldPath);
          excess(field, ["fieldType", "optional"], fieldPath);
          const fieldType = visit(required(field, "fieldType", fieldPath), validatorChildPath(fieldPath, "fieldType"));
          const optional = required(field, "optional", fieldPath);
          if (typeof optional !== "boolean") return fail("invalidShape", validatorChildPath(fieldPath, "optional"), "Object validator optional must be boolean.");
          OBJECT_DEFINE_PROPERTY(value, name, { enumerable: true, value: OBJECT_FREEZE({ fieldType, optional }) });
        }
        return OBJECT_FREEZE({ type, value: OBJECT_FREEZE(value) });
      }
      default: return fail("invalidShape", validatorChildPath(path, "type"), "Unknown validator type.");
    }
  }
  try { return { ok: true, value: visit(captured.value, undefined) }; }
  catch (cause) {
    if (cause instanceof ValidatorJsonDecodeFailure) return { ok: false, issue: cause.issue };
    throw cause;
  }
}