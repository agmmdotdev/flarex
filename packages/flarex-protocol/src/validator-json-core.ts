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
const WEAK_MAP = WeakMap;
const WEAK_SET = WeakSet;
const WEAK_MAP_GET = WeakMap.prototype.get;
const WEAK_MAP_SET = WeakMap.prototype.set;
const WEAK_SET_HAS = WeakSet.prototype.has;
const WEAK_SET_ADD = WeakSet.prototype.add;
const WEAK_SET_DELETE = WeakSet.prototype.delete;
const GENERATOR_NEXT = Object.getPrototypeOf(function* () {}.prototype).next;


export type ValidatorLiteralV1 = string | number | boolean | bigint;
export type ValidatorLiteralWireV1 = string | number | boolean | Readonly<{ readonly $integer: string }> | Readonly<{ readonly $float: string }>;
export type ObjectValidatorJsonWireV1 = { readonly type: "object"; readonly value: Readonly<Record<string, { readonly fieldType: ValidatorJsonWireV1; readonly optional: boolean }>> };
export type ValidatorJsonWireV1 =
  | { readonly type: "null" | "number" | "bigint" | "commitTs" | "boolean" | "string" | "bytes" | "any" }
  | { readonly type: "id"; readonly tableName: string }
  | { readonly type: "literal"; readonly value: ValidatorLiteralWireV1 }
  | { readonly type: "array"; readonly value: ValidatorJsonWireV1 }
  | ObjectValidatorJsonWireV1
  | { readonly type: "record"; readonly keys: ValidatorJsonWireV1; readonly values: { readonly fieldType: ValidatorJsonWireV1; readonly optional: false } }
  | { readonly type: "function"; readonly fnType?: "query" | "mutation" | "action"; readonly args?: ValidatorJsonWireV1; readonly returns?: ValidatorJsonWireV1 }
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
  | { readonly type: "null" }
  | { readonly type: "number" }
  | { readonly type: "bigint" }
  | { readonly type: "commitTs" }
  | { readonly type: "boolean" }
  | { readonly type: "string" }
  | { readonly type: "bytes" }
  | { readonly type: "any" }
  | { readonly type: "id"; readonly tableName: string }
  | { readonly type: "literal"; readonly value: ValidatorLiteralV1 }
  | { readonly type: "array"; readonly value: ValidatorJsonV1 }
  | { readonly type: "function"; readonly fnType?: "query" | "mutation" | "action"; readonly args?: ValidatorJsonV1; readonly returns?: ValidatorJsonV1 }
  | ObjectValidatorJsonV1
  | {
      readonly type: "record";
      readonly keys: ValidatorJsonV1;
      readonly values: ValidatorJsonV1;
    }
  | { readonly type: "union"; readonly value: ReadonlyArray<ValidatorJsonV1> };

export type DocumentValidatorJsonV1 =
  | { readonly type: "any" }
  | ObjectValidatorJsonV1
  | { readonly type: "union"; readonly value: readonly ObjectValidatorJsonV1[] };

/** Retained pre-09 identity bytes only; fresh ingress never selects this grammar. */
export type LegacyValidatorJsonWireV1 =
  | { readonly type: "null" | "number" | "bigint" | "boolean" | "string" | "bytes" | "any" }
  | { readonly type: "id"; readonly tableName: string }
  | { readonly type: "literal"; readonly value: ValidatorLiteralWireV1 }
  | { readonly type: "array"; readonly value: LegacyValidatorJsonWireV1 }
  | { readonly type: "object"; readonly value: Readonly<Record<string, { readonly fieldType: LegacyValidatorJsonWireV1; readonly optional: boolean }>> }
  | { readonly type: "record"; readonly keys: LegacyValidatorJsonWireV1; readonly values: LegacyValidatorJsonWireV1 }
  | { readonly type: "union"; readonly value: readonly LegacyValidatorJsonWireV1[] };

export type ValidatorJsonAdmissionIssueV1 = Readonly<{
  readonly reason:
    | "malformedContainer"
    // Quota reasons belong only to the frozen appDocument V1 object codec.
    | "tooManyNodes" | "tooDeep" | "tooManyObjectFields";
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

/** Current Source DTO wire admission; semantic records are never auto-detected. */
export function validatorJsonWireAdmissionIssueV1(root: unknown): ValidatorJsonAdmissionIssueV1 | undefined {
  const captured = processValidatorJsonDataV1(root, false, "wire");
  return captured.ok ? undefined : captured.issue;
}

/** Own descriptors are snapshotted before Schema reads an untrusted validator. */
export function captureValidatorJsonDataV1(root: unknown): CapturedValidatorJsonDataV1 {
  return processValidatorJsonDataV1(root, true);
}

class ValidatorJsonAdmissionFailure extends Error {
  constructor(readonly issue: ValidatorJsonAdmissionIssueV1, readonly path: ValidatorJsonPathV1 | undefined) { super("Validator JSON admission failed."); }
}

/** Frozen appDocument definition V1 policy, not a current Source/host quota. */
const LEGACY_OBJECT_VALIDATOR_V1_ADMISSION = OBJECT_FREEZE({ nodes: 65_536, depth: 128, objectFields: 1_024 });
interface LegacyObjectValidatorSubtreeSummary { readonly nodes: number; readonly depth: number }

function processValidatorJsonDataV1(root: unknown, copy: boolean, profile: "semantic" | "wire" | "legacy" = "semantic", legacyObjectV1 = false): CapturedValidatorJsonDataV1 {
  let nodes = 0;
  const summaries = legacyObjectV1 ? new WEAK_MAP<object, LegacyObjectValidatorSubtreeSummary>() : undefined;
  const memo = new WEAK_MAP<object, unknown>();
  const active = new WEAK_SET<object>();
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
  type Work = { value: unknown; depth: number; path: ValidatorJsonPathV1 | undefined; budgetOnly?: boolean; countRoot?: boolean };
  function* visit(value: unknown, depth: number, path: ValidatorJsonPathV1 | undefined, budgetOnly = false, countRoot = true): Generator<Work, unknown, unknown> {
    const nodesBeforeVisit = nodes;
    let subtreeDepth = 1;
    function observeChild(child: unknown): unknown {
      if (summaries !== undefined && !budgetOnly) {
        const summary: LegacyObjectValidatorSubtreeSummary | undefined = REFLECT_APPLY(WEAK_MAP_GET, summaries, [child]);
        if (summary !== undefined && summary.depth + 1 > subtreeDepth) subtreeDepth = summary.depth + 1;
      }
      return child;
    }
    if (legacyObjectV1 && countRoot) {
      nodes += 1;
      if (nodes > LEGACY_OBJECT_VALIDATOR_V1_ADMISSION.nodes) return refuse("tooManyNodes", path);
      if (depth > LEGACY_OBJECT_VALIDATOR_V1_ADMISSION.depth) return refuse("tooDeep", path);
    }
    // Malformed containers never reach Schema, which may inspect their properties.
    if (typeof value !== "object" || value === null || ARRAY_IS_ARRAY(value)) return refuse("malformedContainer", path);
    if (REFLECT_APPLY(WEAK_SET_HAS, active, [value])) return refuse("malformedContainer", path);
    const old: unknown = budgetOnly ? undefined : REFLECT_APPLY(WEAK_MAP_GET, memo, [value]);
    if (old !== undefined) {
      if (summaries !== undefined) {
        const summary: LegacyObjectValidatorSubtreeSummary | undefined = REFLECT_APPLY(WEAK_MAP_GET, summaries, [old]);
        if (summary !== undefined && summary.nodes - 1 <= LEGACY_OBJECT_VALIDATOR_V1_ADMISSION.nodes - nodes
          && summary.depth <= LEGACY_OBJECT_VALIDATOR_V1_ADMISSION.depth - depth + 1) {
          // The root occurrence was checked above. A complete captured subtree
          // fitting both remaining budgets has no quota refusal to replay.
          nodes += summary.nodes - 1;
          return old;
        }
        // A boundary-crossing reuse must retain the original descendant issue
        // and path. Replay only owned data, never foreign descriptors.
        yield { value: old, depth, path, budgetOnly: true, countRoot: false };
      }
      return old;
    }
    REFLECT_APPLY(WEAK_SET_ADD, active, [value]);
    const type = own(value, "type", path);
    if (typeof type !== "string") return refuse("malformedContainer", validatorChildPath(path, "type"));
    const output: Record<string, unknown> | undefined = copy && !budgetOnly ? {} : undefined;
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
        if (child !== MISSING_VALIDATOR_PROPERTY) put(output, "value", observeChild(yield { value: child, depth: depth + 1, path: validatorChildPath(path, "value"), budgetOnly }));
        break;
      }
      case "record": {
        const keys = ["keys", "values"] as const;
        for (let index = 0; index < keys.length; index += 1) {
          const key = denseOwnItem(keys, index);
          const child = own(value, key, path);
          if (child !== MISSING_VALIDATOR_PROPERTY) {
            if (key === "values" && profile === "wire") {
              if (typeof child !== "object" || child === null || ARRAY_IS_ARRAY(child)) return refuse("malformedContainer", validatorChildPath(path, key));
              const optional = own(child, "optional", validatorChildPath(path, key));
              if (typeof optional !== "boolean") return refuse("malformedContainer", validatorChildPath(validatorChildPath(path, key), "optional"));
              const fieldType = own(child, "fieldType", validatorChildPath(path, key));
              const wrapper: Record<string, unknown> = {};
              put(wrapper, "optional", optional);
              if (fieldType !== MISSING_VALIDATOR_PROPERTY) put(wrapper, "fieldType", observeChild(yield { value: fieldType, depth: depth + 1, path: validatorChildPath(validatorChildPath(path, key), "fieldType"), budgetOnly }));
              extras(child, wrapper, ["fieldType", "optional"], validatorChildPath(path, key));
              put(output, key, OBJECT_FREEZE(wrapper));
            } else put(output, key, observeChild(yield { value: child, depth: depth + 1, path: validatorChildPath(path, key), budgetOnly }));
          }
        }
        break;
      }
      case "union": {
        const members = own(value, "value", path);
        if (!ARRAY_IS_ARRAY(members)) return refuse("malformedContainer", validatorChildPath(path, "value"));
        const length = own(members, "length", validatorChildPath(path, "value"));
        if (typeof length !== "number" || !NUMBER_IS_SAFE_INTEGER(length) || length < 0) return refuse("malformedContainer", path);
        if (legacyObjectV1 && length > LEGACY_OBJECT_VALIDATOR_V1_ADMISSION.nodes - nodes) return refuse("tooManyNodes", path);
        const captured: unknown[] | undefined = copy && !budgetOnly ? [] : undefined;
        if (captured !== undefined) OBJECT_DEFINE_PROPERTY(captured, "length", { value: length });
        for (let index = 0; index < length; index += 1) {
          const member = own(members, index, validatorChildPath(path, "value"));
          if (member === MISSING_VALIDATOR_PROPERTY) return refuse("malformedContainer", path);
          const child = observeChild(yield { value: member, depth: depth + 1, path: validatorChildPath(validatorChildPath(path, "value"), index), budgetOnly });
          if (captured !== undefined) defineArrayItem(captured, index, child);
        }
        put(output, "value", captured); break;
      }
      case "object": {
        const fields = own(value, "value", path);
        if (typeof fields !== "object" || fields === null || ARRAY_IS_ARRAY(fields)) return refuse("malformedContainer", validatorChildPath(path, "value"));
        const keys = REFLECT_OWN_KEYS(fields);
        for (let index = 0; index < keys.length; index += 1) if (typeof denseOwnItem(keys, index) !== "string") return refuse("malformedContainer", path);
        if (legacyObjectV1 && keys.length > LEGACY_OBJECT_VALIDATOR_V1_ADMISSION.objectFields) return refuse("tooManyObjectFields", validatorChildPath(path, "value"));
        const capturedFields: Record<string, unknown> | undefined = copy && !budgetOnly ? {} : undefined;
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
          const capturedField: Record<string, unknown> | undefined = copy && !budgetOnly ? {} : undefined;
          put(capturedField, "optional", optional);
          if (fieldType !== MISSING_VALIDATOR_PROPERTY) put(capturedField, "fieldType", observeChild(yield { value: fieldType, depth: depth + 1, path: validatorChildPath(fieldPath, "fieldType"), budgetOnly }));
          extras(field, capturedField, ["fieldType", "optional"], fieldPath);
          put(capturedFields, key, capturedField, descriptor.enumerable === true);
        }
        put(output, "value", capturedFields); break;
      }
      case "function": {
        const fnType = own(value, "fnType", path);
        if (fnType !== MISSING_VALIDATOR_PROPERTY) put(output, "fnType", fnType);
        const names = ["args", "returns"] as const;
        for (let index = 0; index < names.length; index += 1) {
          const name = denseOwnItem(names, index);
          const child = own(value, name, path);
          if (child !== MISSING_VALIDATOR_PROPERTY) put(output, name, observeChild(yield { value: child, depth: depth + 1, path: validatorChildPath(path, name), budgetOnly }));
        }
        break;
      }
    }
    const known = type === "id" ? ["type", "tableName"] : type === "record" ? ["type", "keys", "values"] : type === "function" ? ["type", "fnType", "args", "returns"] :
      type === "literal" || type === "array" || type === "object" || type === "union" ? ["type", "value"] : ["type"];
    extras(value, output, known, path);
    REFLECT_APPLY(WEAK_SET_DELETE, active, [value]);
    const captured = copy && !budgetOnly ? output : value;
    if (!budgetOnly) {
      REFLECT_APPLY(WEAK_MAP_SET, memo, [value, captured]);
      if (summaries !== undefined) REFLECT_APPLY(WEAK_MAP_SET, summaries, [captured, { nodes: nodes - nodesBeforeVisit, depth: subtreeDepth }]);
    }
    return captured;
  }
  try {
    const work: Generator<Work, unknown, unknown>[] = [];
    defineArrayItem(work, 0, visit(root, 1, undefined));
    let completed: unknown;
    while (work.length > 0) {
      const current = denseOwnItem(work, work.length - 1);
      const step: IteratorResult<Work, unknown> = REFLECT_APPLY(GENERATOR_NEXT, current, [completed]);
      if (step.done) { completed = step.value; work.length -= 1; }
      else { const child = step.value; defineArrayItem(work, work.length, visit(child.value, child.depth, child.path, child.budgetOnly, child.countRoot)); completed = undefined; }
    }
    return { ok: true, value: completed };
  }
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
  const memo = new WEAK_MAP<ValidatorJsonV1, ValidatorJsonWireV1>();
  function* visit(node: ValidatorJsonV1): Generator<ValidatorJsonV1, ValidatorJsonWireV1, ValidatorJsonWireV1> {
    const prior: ValidatorJsonWireV1 | undefined = REFLECT_APPLY(WEAK_MAP_GET, memo, [node]); if (prior !== undefined) return prior;
    const operation = project(node); let wire: ValidatorJsonWireV1 = { type: "any" };
    while (true) { const step: IteratorResult<ValidatorJsonV1, ValidatorJsonWireV1> = REFLECT_APPLY(GENERATOR_NEXT, operation, [wire]); if (step.done) { wire = step.value; break; } wire = yield step.value; }
    REFLECT_APPLY(WEAK_MAP_SET, memo, [node, wire]); return wire;
  }
  function* project(node: ValidatorJsonV1): Generator<ValidatorJsonV1, ValidatorJsonWireV1, ValidatorJsonWireV1> {
    switch (node.type) {
      case "literal": return OBJECT_FREEZE({ type: "literal", value: encodeValidatorLiteralV1(node.value) });
      case "array": return OBJECT_FREEZE({ type: "array", value: yield node.value });
      case "union": { const values: ValidatorJsonWireV1[] = []; for (let index = 0; index < node.value.length; index += 1) defineArrayItem(values, index, yield denseOwnItem(node.value, index)); return OBJECT_FREEZE({ type: "union", value: OBJECT_FREEZE(values) }); }
      case "record": { const keys = yield node.keys; const values = yield node.values; return OBJECT_FREEZE({ type: "record", keys, values: OBJECT_FREEZE({ fieldType: values, optional: false }) }); }
      case "object": {
        const fields: Record<string, { readonly fieldType: ValidatorJsonWireV1; readonly optional: boolean }> = {}; const entries = OBJECT_ENTRIES(node.value);
        for (let index = 0; index < entries.length; index += 1) { const entry = denseOwnItem(entries, index); const name = entry[0]; const field = entry[1]; OBJECT_DEFINE_PROPERTY(fields, name, { enumerable: true, value: OBJECT_FREEZE({ fieldType: yield field.fieldType, optional: field.optional }) }); }
        return OBJECT_FREEZE({ type: "object", value: OBJECT_FREEZE(fields) });
      }
      case "function": { const args = node.args === undefined ? undefined : yield node.args; const returns = node.returns === undefined ? undefined : yield node.returns; return OBJECT_FREEZE({ type: "function", ...(node.fnType === undefined ? {} : { fnType: node.fnType }), ...(args === undefined ? {} : { args }), ...(returns === undefined ? {} : { returns }) }); }
      default: return OBJECT_FREEZE({ ...node });
    }
  }
  const work: Generator<ValidatorJsonV1, ValidatorJsonWireV1, ValidatorJsonWireV1>[] = []; defineArrayItem(work, 0, visit(value));
  let completed: ValidatorJsonWireV1 = { type: "any" };
  while (work.length > 0) { const current = denseOwnItem(work, work.length - 1); const step: IteratorResult<ValidatorJsonV1, ValidatorJsonWireV1> = REFLECT_APPLY(GENERATOR_NEXT, current, [completed]); if (step.done) { completed = step.value; work.length -= 1; } else defineArrayItem(work, work.length, visit(step.value)); }
  return completed;
}

/** Current wire transport is checked by the same iterative authoritative decoder. */
export function decodeValidatorJsonWireCoreV1(value: ObjectValidatorJsonWireV1): ObjectValidatorJsonV1;
export function decodeValidatorJsonWireCoreV1(value: ValidatorJsonWireV1): ValidatorJsonV1;
export function decodeValidatorJsonWireCoreV1(value: ValidatorJsonWireV1): ValidatorJsonV1 {
  const decoded = decodeValidatorJsonWireResultCoreV1(value);
  if (!decoded.ok) throw new ValidatorJsonV1InputError(`${decoded.issue.message} ${decoded.issue.path}`, decoded.issue);
  return decoded.value;
}

/** Persistence/analysis applies this policy after semantic parsing. */
function validatorChildren(value: ValidatorJsonV1): readonly ValidatorJsonV1[] {
  switch (value.type) {
    case "array": return [value.value];
    case "record": return [value.keys, value.values];
    case "union": return value.value;
    case "function": { const values: ValidatorJsonV1[] = []; if (value.args !== undefined) defineArrayItem(values, values.length, value.args); if (value.returns !== undefined) defineArrayItem(values, values.length, value.returns); return values; }
    case "object": { const values: ValidatorJsonV1[] = []; const fields = OBJECT_VALUES(value.value); for (let index = 0; index < fields.length; index += 1) defineArrayItem(values, index, denseOwnItem(fields, index).fieldType); return values; }
    default: return [];
  }
}
export function validatorJsonHasNonfiniteLiteralV1(value: ValidatorJsonV1): boolean {
  const work: ValidatorJsonV1[] = []; defineArrayItem(work, 0, value); const done = new WEAK_SET<ValidatorJsonV1>();
  while (work.length > 0) { const node = denseOwnItem(work, work.length - 1); work.length -= 1; if (REFLECT_APPLY(WEAK_SET_HAS, done, [node])) continue; REFLECT_APPLY(WEAK_SET_ADD, done, [node]); if (node.type === "literal" && typeof node.value === "number" && !NUMBER_IS_FINITE(node.value)) return true; const children = validatorChildren(node); for (let index = 0; index < children.length; index += 1) defineArrayItem(work, work.length, denseOwnItem(children, index)); }
  return false;
}
/** Pinned Validator::is_subset(String), including vacuous empty unions. */
export function validatorIsSubsetOfStringV1(value: ValidatorJsonV1): boolean {
  const work: ValidatorJsonV1[] = []; defineArrayItem(work, 0, value); const done = new WEAK_SET<ValidatorJsonV1>();
  while (work.length > 0) { const node = denseOwnItem(work, work.length - 1); work.length -= 1; if (REFLECT_APPLY(WEAK_SET_HAS, done, [node])) continue; REFLECT_APPLY(WEAK_SET_ADD, done, [node]); if (node.type === "union") { for (let index = 0; index < node.value.length; index += 1) defineArrayItem(work, work.length, denseOwnItem(node.value, index)); } else if (node.type !== "string" && node.type !== "id" && node.type !== "function" && !(node.type === "literal" && typeof node.value === "string")) return false; }
  return true;
}
export function validatorIsStringSubtypeWithStringLiteralV1(value: ValidatorJsonV1): boolean {
  const work: ValidatorJsonV1[] = []; defineArrayItem(work, 0, value); const done = new WEAK_SET<ValidatorJsonV1>();
  while (work.length > 0) { const node = denseOwnItem(work, work.length - 1); work.length -= 1; if (REFLECT_APPLY(WEAK_SET_HAS, done, [node])) continue; REFLECT_APPLY(WEAK_SET_ADD, done, [node]); if (node.type === "literal" && typeof node.value === "string") return true; if (node.type === "union") for (let index = 0; index < node.value.length; index += 1) defineArrayItem(work, work.length, denseOwnItem(node.value, index)); }
  return false;
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
  type Path = Readonly<{ parent: Path | undefined; segment: string }>;
  type Work = Readonly<{ node: ValidatorJsonV1; path: Path | undefined }>;
  const done = new WEAK_SET<ValidatorJsonV1>();
  function display(at: Path | undefined): string { const segments: string[] = []; while (at !== undefined) { defineArrayItem(segments, segments.length, at.segment); at = at.parent; } let text = path; for (let index = segments.length - 1; index >= 0; index -= 1) text += denseOwnItem(segments, index); return text; }
  function* visit(node: ValidatorJsonV1, at: Path | undefined): Generator<Work, ValidatorSourceRecordIssueV1 | undefined, ValidatorSourceRecordIssueV1 | undefined> {
    if (REFLECT_APPLY(WEAK_SET_HAS, done, [node])) return undefined;
    REFLECT_APPLY(WEAK_SET_ADD, done, [node]);
    switch (node.type) {
      case "record": {
        const keyPath = { parent: at, segment: ".keys" };
        const keyIssue = yield { node: node.keys, path: keyPath }; if (keyIssue !== undefined) return keyIssue;
        if (!validatorIsSubsetOfStringV1(node.keys)) return { reason: "nonStringRecordKey", path: display(keyPath) };
        const valueIssue = yield { node: node.values, path: { parent: at, segment: ".values" } }; if (valueIssue !== undefined) return valueIssue;
        return validatorIsStringSubtypeWithStringLiteralV1(node.keys) ? { reason: "stringLiteralRecordKey", path: display(keyPath) } : undefined;
      }
      case "array": return yield { node: node.value, path: { parent: at, segment: ".value" } };
      case "union": for (let index = 0; index < node.value.length; index += 1) { const issue = yield { node: denseOwnItem(node.value, index), path: { parent: at, segment: `.value[${index}]` } }; if (issue !== undefined) return issue; } return undefined;
      case "object": {
        const entries = OBJECT_ENTRIES(node.value); const fields: Array<{ name: string; field: ObjectValidatorJsonV1["value"][string]; bytes: Uint8Array }> = [];
        for (let index = 0; index < entries.length; index += 1) { const entry = denseOwnItem(entries, index); const bytes: Uint8Array = REFLECT_APPLY(TEXT_ENCODER_ENCODE, SOURCE_VALIDATOR_FIELD_ENCODER, [entry[0]]); defineArrayItem(fields, index, { name: entry[0], field: entry[1], bytes }); }
        REFLECT_APPLY(ARRAY_SORT, fields, [(left: typeof fields[number], right: typeof fields[number]) => compareBytesLexicographically(left.bytes, right.bytes)]);
        for (let index = 0; index < fields.length; index += 1) { const field = denseOwnItem(fields, index); const issue = yield { node: field.field.fieldType, path: { parent: at, segment: `.value[${JSON_STRINGIFY(field.name)}].fieldType` } }; if (issue !== undefined) return issue; } return undefined;
      }
      case "function": {
        if (node.args !== undefined) { const issue = yield { node: node.args, path: { parent: at, segment: ".args" } }; if (issue !== undefined) return issue; }
        if (node.returns !== undefined) return yield { node: node.returns, path: { parent: at, segment: ".returns" } };
        return undefined;
      }
      default: return undefined;
    }
  }
  const work: Generator<Work, ValidatorSourceRecordIssueV1 | undefined, ValidatorSourceRecordIssueV1 | undefined>[] = []; defineArrayItem(work, 0, visit(validator, undefined));
  let completed: ValidatorSourceRecordIssueV1 | undefined;
  while (work.length > 0) { const current = denseOwnItem(work, work.length - 1); const step: IteratorResult<Work, ValidatorSourceRecordIssueV1 | undefined> = REFLECT_APPLY(GENERATOR_NEXT, current, [completed]); if (step.done) { completed = step.value; work.length -= 1; } else { defineArrayItem(work, work.length, visit(step.value.node, step.value.path)); completed = undefined; } }
  return completed;
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

function decodeValidatorJsonInputCoreV1(root: unknown, profile: "semantic" | "wire" | "legacyWire" | "legacySemantic", options: ValidatorJsonDecodeOptionsV1, legacyObjectV1 = false): ValidatorJsonDecodeResultV1 {
  if (options.onExcessProperty === "preserve") return { ok: false, issue: validatorDecodeIssue("unsupportedExcessPolicy", undefined, "Canonical validator DTOs do not preserve foreign extra values.") };
  const captured = processValidatorJsonDataV1(root, true, profile === "wire" ? "wire" : profile === "legacyWire" || profile === "legacySemantic" ? "legacy" : "semantic", legacyObjectV1);
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
  type Work = { input: unknown; path: ValidatorJsonPathV1 | undefined };
  const memo = new WEAK_MAP<object, ValidatorJsonV1>();
  function* visit(input: unknown, path: ValidatorJsonPathV1 | undefined): Generator<Work, ValidatorJsonV1, ValidatorJsonV1> {
    if (typeof input === "object" && input !== null) { const prior: ValidatorJsonV1 | undefined = REFLECT_APPLY(WEAK_MAP_GET, memo, [input]); if (prior !== undefined) return prior; }
    const operation = nodeVisit(input, path); let value: ValidatorJsonV1 = { type: "any" };
    while (true) { const step: IteratorResult<Work, ValidatorJsonV1> = REFLECT_APPLY(GENERATOR_NEXT, operation, [value]); if (step.done) { value = step.value; break; } value = yield step.value; }
    if (typeof input === "object" && input !== null) REFLECT_APPLY(WEAK_MAP_SET, memo, [input, value]);
    return value;
  }
  function* nodeVisit(input: unknown, path: ValidatorJsonPathV1 | undefined): Generator<Work, ValidatorJsonV1, ValidatorJsonV1> {
    const node = record(input, path);
    const type = required(node, "type", path);
    switch (type) {
      case "null": case "number": case "bigint": case "commitTs": case "boolean": case "string": case "bytes": case "any":
        if (type === "commitTs" && (profile === "legacyWire" || profile === "legacySemantic")) return fail("invalidShape", validatorChildPath(path, "type"), "Unknown historical validator type.");
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
        if (profile === "semantic" || profile === "legacySemantic") {
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
      case "function": {
        if (profile === "legacyWire" || profile === "legacySemantic") return fail("invalidShape", validatorChildPath(path, "type"), "Unknown historical validator type.");
        excess(node, ["type", "fnType", "args", "returns"], path);
        const fnType = OBJECT_GET_OWN_PROPERTY_DESCRIPTOR(node, "fnType")?.value;
        if (fnType !== undefined && fnType !== "query" && fnType !== "mutation" && fnType !== "action") return fail("invalidShape", validatorChildPath(path, "fnType"), "Invalid function handle type.");
        const rawArgs = OBJECT_GET_OWN_PROPERTY_DESCRIPTOR(node, "args");
        const args = rawArgs === undefined ? undefined : yield { input: rawArgs.value, path: validatorChildPath(path, "args") };
        const rawReturns = OBJECT_GET_OWN_PROPERTY_DESCRIPTOR(node, "returns");
        const returns = rawReturns === undefined ? undefined : yield { input: rawReturns.value, path: validatorChildPath(path, "returns") };
        return OBJECT_FREEZE({ type, ...(fnType === undefined ? {} : { fnType }), ...(args === undefined ? {} : { args }), ...(returns === undefined ? {} : { returns }) });
      }
      case "array": {
        excess(node, ["type", "value"], path);
        return OBJECT_FREEZE({ type, value: yield { input: required(node, "value", path), path: validatorChildPath(path, "value") } });
      }
      case "record": {
        excess(node, ["type", "keys", "values"], path);
        const keys = yield { input: required(node, "keys", path), path: validatorChildPath(path, "keys") };
        const rawValues = required(node, "values", path);
        const valuePath = validatorChildPath(path, "values");
        const values = yield { input: profile === "wire" ? required(rawValues, "fieldType", valuePath) : rawValues, path: profile === "wire" ? validatorChildPath(valuePath, "fieldType") : valuePath };
        if (profile === "wire") { excess(rawValues, ["fieldType", "optional"], valuePath); if (required(rawValues, "optional", valuePath) !== false) return fail("invalidShape", validatorChildPath(valuePath, "optional"), "Current record values cannot be optional."); }
        return OBJECT_FREEZE({ type, keys, values });
      }
      case "union": {
        excess(node, ["type", "value"], path);
        const members = required(node, "value", path);
        if (!ARRAY_IS_ARRAY(members)) return fail("invalidShape", validatorChildPath(path, "value"), "Union validator value must be an array.");
        const value: ValidatorJsonV1[] = [];
        OBJECT_DEFINE_PROPERTY(value, "length", { value: members.length });
        for (let index = 0; index < members.length; index += 1) defineArrayItem(value, index, (yield { input: denseOwnItem(members, index), path: validatorChildPath(validatorChildPath(path, "value"), index) }));
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
          const fieldType = yield { input: required(field, "fieldType", fieldPath), path: validatorChildPath(fieldPath, "fieldType") };
          const optional = required(field, "optional", fieldPath);
          if (typeof optional !== "boolean") return fail("invalidShape", validatorChildPath(fieldPath, "optional"), "Object validator optional must be boolean.");
          OBJECT_DEFINE_PROPERTY(value, name, { enumerable: true, value: OBJECT_FREEZE({ fieldType, optional }) });
        }
        return OBJECT_FREEZE({ type, value: OBJECT_FREEZE(value) });
      }
      default: return fail("invalidShape", validatorChildPath(path, "type"), "Unknown validator type.");
    }
  }
  try {
    const work: Generator<Work, ValidatorJsonV1, ValidatorJsonV1>[] = [];
    defineArrayItem(work, 0, visit(captured.value, undefined));
    let completed: ValidatorJsonV1 = { type: "any" };
    while (work.length > 0) {
      const current = denseOwnItem(work, work.length - 1);
      const step: IteratorResult<Work, ValidatorJsonV1> = REFLECT_APPLY(GENERATOR_NEXT, current, [completed]);
      if (step.done) { completed = step.value; work.length -= 1; }
      else defineArrayItem(work, work.length, visit(step.value.input, step.value.path));
    }
    return { ok: true, value: completed };
  }
  catch (cause) {
    if (cause instanceof ValidatorJsonDecodeFailure) return { ok: false, issue: cause.issue };
    throw cause;
  }
}

/** Frozen pre-09 semantic admission selected only by authenticated stored format. */
export function decodeLegacyValidatorJsonResultCoreV1(root: unknown, options: ValidatorJsonDecodeOptionsV1 = {}): ValidatorJsonDecodeResultV1 { return decodeValidatorJsonInputCoreV1(root, "legacySemantic", options); }
export function decodeLegacyValidatorJsonWireResultCoreV1(root: unknown, options: ValidatorJsonDecodeOptionsV1 = {}): ValidatorJsonDecodeResultV1 { return decodeValidatorJsonInputCoreV1(root, "legacyWire", options); }
/** Closed appDocument definition V1 admission; generic historical formats keep
 * their own policies and current validators do not inherit these quotas. */
export function decodeLegacyObjectValidatorJsonResultCoreV1(root: unknown, options: ValidatorJsonDecodeOptionsV1 = {}): ValidatorJsonDecodeResultV1 { return decodeValidatorJsonInputCoreV1(root, "legacySemantic", options, true); }
export function decodeLegacyObjectValidatorJsonWireResultCoreV1(root: unknown, options: ValidatorJsonDecodeOptionsV1 = {}): ValidatorJsonDecodeResultV1 { return decodeValidatorJsonInputCoreV1(root, "legacyWire", options, true); }

export function encodeLegacyValidatorJsonWireCoreV1(value: ValidatorJsonV1): LegacyValidatorJsonWireV1 {
  switch (value.type) {
    case "function": case "commitTs": throw new ValidatorJsonV1InputError("Historical validator encoding does not support this tag.");
    case "literal": return OBJECT_FREEZE({ type: "literal", value: encodeValidatorLiteralV1(value.value) });
    case "array": return OBJECT_FREEZE({ type: "array", value: encodeLegacyValidatorJsonWireCoreV1(value.value) });
    case "union": { const members: LegacyValidatorJsonWireV1[] = []; for (let index = 0; index < value.value.length; index += 1) defineArrayItem(members, index, encodeLegacyValidatorJsonWireCoreV1(denseOwnItem(value.value, index))); return OBJECT_FREEZE({ type: "union", value: OBJECT_FREEZE(members) }); }
    case "record": return OBJECT_FREEZE({ type: "record", keys: encodeLegacyValidatorJsonWireCoreV1(value.keys), values: encodeLegacyValidatorJsonWireCoreV1(value.values) });
    case "object": { const fields: Record<string, { readonly fieldType: LegacyValidatorJsonWireV1; readonly optional: boolean }> = {}; const entries = OBJECT_ENTRIES(value.value); for (let index = 0; index < entries.length; index += 1) { const entry = denseOwnItem(entries, index); const name = entry[0]; const field = entry[1]; OBJECT_DEFINE_PROPERTY(fields, name, { enumerable: true, value: OBJECT_FREEZE({ fieldType: encodeLegacyValidatorJsonWireCoreV1(field.fieldType), optional: field.optional }) }); } return OBJECT_FREEZE({ type: "object", value: OBJECT_FREEZE(fields) }); }
    default: return OBJECT_FREEZE({ ...value });
  }
}
