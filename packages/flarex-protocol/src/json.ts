import { isNonArrayRecord } from "@flarex/utils/records";
import { isNonNegativeSafeInteger } from "@flarex/utils/numbers";
import { Array as EffectArray, Order, Schema } from "effect";

const UTF16_STRING_ORDER = Order.String;

export type JsonObject = { readonly [key: string]: Json };

export type Json =
  | null
  | boolean
  | number
  | string
  | ReadonlyArray<Json>
  | JsonObject;

/**
 * JSON with writable array and object properties for compatibility APIs.
 * This is a compile-time shape and does not promise runtime mutability.
 */
export type WritableJson =
  | null
  | boolean
  | number
  | string
  | WritableJson[]
  | WritableJsonObject;

export type WritableJsonObject = { [key: string]: WritableJson };

export type CanonicalJsonEncodingInvariantIssue =
  | Readonly<{ readonly reason: "missingArrayItem"; readonly index: number }>
  | Readonly<{
      readonly reason: "missingObjectProperty";
      readonly key: string;
    }>
  | Readonly<{ readonly reason: "primitiveEncodingFailed" }>;

export type CanonicalJsonUtf8Measurement =
  | Readonly<{ readonly kind: "success"; readonly bytes: number }>
  | Readonly<{ readonly kind: "exceeded"; readonly observed: number }>
  | Readonly<{ readonly kind: "invalid" }>;

export const JsonValue = Schema.declare<Json>(isJson, {
  title: "JsonValue",
  description:
    "A JSON value: null, boolean, finite number, string, array, or plain record.",
});

/** Compatibility name for the same exact protocol JSON Schema. */
export const Json = JsonValue;

/**
 * Discriminates the array member of an already-validated JSON value.
 * Use {@link isJson} first when the input is unknown.
 */
export function isJsonArray(value: Json): value is ReadonlyArray<Json> {
  return Array.isArray(value);
}

/**
 * Discriminates the object member of an already-validated JSON value.
 * Use {@link isJson} first when the input is unknown.
 */
export function isJsonObject(value: Json): value is JsonObject {
  return isNonArrayRecord(value);
}

/**
 * Validates unknown input against the complete JSON contract before exposing
 * its readonly object member. This does not copy or freeze the input.
 */
export function isJsonObjectFromUnknown(
  value: unknown,
): value is JsonObject {
  return isJson(value) && isJsonObject(value);
}

/** Discriminates the object member of writable compatibility JSON. */
export function isWritableJsonObject(
  value: WritableJson,
): value is WritableJsonObject {
  return isNonArrayRecord(value);
}

/**
 * Validates unknown input before exposing the writable compatibility object
 * shape. This type narrowing does not promise runtime mutability.
 */
export function isWritableJsonObjectFromUnknown(
  value: unknown,
): value is WritableJsonObject {
  return isJsonObjectFromUnknown(value);
}

/** Compares validated JSON values without depending on object key order. */
export function jsonEqual(left: Json, right: Json): boolean {
  // JSON text encodes both negative and positive zero as 0.
  if (left === right) return true;
  if (isJsonArray(left)) {
    if (!isJsonArray(right) || left.length !== right.length) return false;
    for (let index = 0; index < left.length; index += 1) {
      if (!Object.hasOwn(left, index) || !Object.hasOwn(right, index)) {
        return false;
      }
      const leftValue = left[index];
      const rightValue = right[index];
      if (
        leftValue === undefined ||
        rightValue === undefined ||
        !jsonEqual(leftValue, rightValue)
      ) {
        return false;
      }
    }
    return true;
  }
  if (!isJsonObject(left) || !isJsonObject(right)) return false;
  const leftKeys = Object.keys(left);
  if (leftKeys.length !== Object.keys(right).length) return false;
  for (const key of leftKeys) {
    if (!Object.hasOwn(right, key)) return false;
    const leftValue = left[key];
    const rightValue = right[key];
    if (
      leftValue === undefined ||
      rightValue === undefined ||
      !jsonEqual(leftValue, rightValue)
    ) {
      return false;
    }
  }
  return true;
}

/**
 * Encodes validated JSON using ECMAScript UTF-16 key order and JSON primitive
 * spelling. The callback owns failures caused by a typed value losing an item
 * or property after validation.
 */
export function encodeCanonicalJson(
  value: Json,
  onInvariantViolation: (issue: CanonicalJsonEncodingInvariantIssue) => never,
): string {
  const chunks: string[] = [];
  const pending: CanonicalJsonEncodingFrame[] = [{ kind: "value", value }];
  while (pending.length > 0) {
    const frame = pending.pop();
    if (frame === undefined) throw new Error("Canonical JSON encoding lost a frame.");
    if (frame.kind === "array") {
      if (frame.index === frame.value.length) { chunks.push("]"); continue; }
      const index = frame.index;
      if (!Object.hasOwn(frame.value, index)) return onInvariantViolation({ reason: "missingArrayItem", index });
      const item = frame.value[index];
      if (item === undefined) return onInvariantViolation({ reason: "missingArrayItem", index });
      if (index > 0) chunks.push(",");
      pending.push({ ...frame, index: index + 1 }, { kind: "value", value: item });
      continue;
    }
    if (frame.kind === "object") {
      if (frame.index === frame.keys.length) { chunks.push("}"); continue; }
      const key = frame.keys[frame.index];
      if (key === undefined) throw new Error("Canonical JSON encoding lost a key.");
      const item = frame.value[key];
      if (item === undefined) return onInvariantViolation({ reason: "missingObjectProperty", key });
      if (frame.index > 0) chunks.push(",");
      chunks.push(JSON.stringify(key), ":");
      pending.push({ ...frame, index: frame.index + 1 }, { kind: "value", value: item });
      continue;
    }
    if (isJsonArray(frame.value)) {
      chunks.push("[");
      pending.push({ kind: "array", value: frame.value, index: 0 });
    } else if (isJsonObject(frame.value)) {
      chunks.push("{");
      pending.push({ kind: "object", value: frame.value,
        keys: EffectArray.sort(Object.keys(frame.value), UTF16_STRING_ORDER), index: 0 });
    } else {
      const encoded = JSON.stringify(frame.value);
      if (encoded === undefined) return onInvariantViolation({ reason: "primitiveEncodingFailed" });
      chunks.push(encoded);
    }
  }
  return chunks.join("");
}

type CanonicalJsonEncodingFrame =
  | Readonly<{ kind: "value"; value: Json }>
  | Readonly<{ kind: "array"; value: ReadonlyArray<Json>; index: number }>
  | Readonly<{ kind: "object"; value: JsonObject; keys: readonly string[]; index: number }>;

/**
 * Measures canonical JSON UTF-8 bytes without first allocating the canonical
 * string or encoded byte array. `observed` is a lower bound greater than the
 * supplied maximum; callers that need the exact size may retry with a larger
 * admitted maximum.
 */
export function measureCanonicalJsonUtf8Bytes(
  value: unknown,
  maximumBytes: number,
): CanonicalJsonUtf8Measurement {
  if (!isNonNegativeSafeInteger(maximumBytes)) return { kind: "invalid" };
  const ancestors = new WeakSet<object>();
  const memo = new WeakMap<object, number>();
  const pending = [measureCanonicalJsonValue(value, ancestors, memo, maximumBytes)];
  let completed: CanonicalJsonUtf8Measurement = { kind: "invalid" };
  while (pending.length > 0) {
    const current = pending[pending.length - 1];
    if (current === undefined) throw new Error("Canonical JSON measurement lost a frame.");
    const step = current.next(completed);
    if (step.done) { completed = step.value; pending.pop(); }
    else pending.push(measureCanonicalJsonValue(step.value.value, ancestors, memo, step.value.maximumBytes));
  }
  return completed;
}

type CanonicalJsonMeasurementWork = Generator<
  Readonly<{ value: unknown; maximumBytes: number }>,
  CanonicalJsonUtf8Measurement,
  CanonicalJsonUtf8Measurement
>;

function* measureCanonicalJsonValue(
  value: unknown,
  ancestors: WeakSet<object>,
  memo: WeakMap<object, number>,
  maximumBytes: number,
): CanonicalJsonMeasurementWork {
  if (value === null) return measuredPrimitive(4, maximumBytes);
  if (typeof value === "boolean") {
    return measuredPrimitive(value ? 4 : 5, maximumBytes);
  }
  if (typeof value === "string") {
    return measureCanonicalJsonString(value, maximumBytes);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return { kind: "invalid" };
    const spelling = JSON.stringify(value);
    return measuredPrimitive(spelling.length, maximumBytes);
  }
  if (typeof value !== "object" || ancestors.has(value)) {
    return { kind: "invalid" };
  }
  const prior = memo.get(value);
  if (prior !== undefined) return measuredPrimitive(prior, maximumBytes);
  let prototype: object | null;
  let isArray: boolean;
  let immutable: boolean;
  try {
    // Establish immutability before collecting a summary. A later Proxy trap
    // may freeze a mutable object after changing an already-visited member.
    immutable = Object.isFrozen(value);
    prototype = Object.getPrototypeOf(value);
    isArray = Array.isArray(value);
  } catch {
    return { kind: "invalid" };
  }
  if (
    !isArray &&
    prototype !== Object.prototype &&
    prototype !== null
  ) {
    return { kind: "invalid" };
  }
  ancestors.add(value);
  try {
    const measured = isArray
      ? yield* measureCanonicalJsonArray(value, memo, immutable, maximumBytes)
      : yield* measureCanonicalJsonObject(value, memo, immutable, maximumBytes);
    return measured;
  } catch {
    return { kind: "invalid" };
  } finally {
    ancestors.delete(value);
  }
}

function* measureCanonicalJsonArray<T extends object>(
  value: T,
  memo: WeakMap<object, number>,
  immutable: boolean,
  maximumBytes: number,
): CanonicalJsonMeasurementWork {
  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
  if (
    lengthDescriptor === undefined ||
    !("value" in lengthDescriptor) ||
    !isNonNegativeSafeInteger(lengthDescriptor.value)
  ) {
    return { kind: "invalid" };
  }
  let total = 2;
  if (total > maximumBytes) return { kind: "exceeded", observed: total };
  for (let index = 0; index < lengthDescriptor.value; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (
      descriptor === undefined ||
      !descriptor.enumerable ||
      !("value" in descriptor)
    ) {
      return { kind: "invalid" };
    }
    if (index > 0) {
      const nextTotal = checkedCanonicalByteAdd(total, 1);
      if (nextTotal === undefined) return { kind: "invalid" };
      total = nextTotal;
      if (total > maximumBytes) {
        return { kind: "exceeded", observed: total };
      }
    }
    const child = yield { value: descriptor.value, maximumBytes: maximumBytes - total };
    if (child.kind === "invalid") return child;
    if (descriptor.value !== null && typeof descriptor.value === "object" && !memo.has(descriptor.value)) immutable = false;
    const nextTotal = checkedCanonicalByteAdd(
      total,
      child.kind === "success" ? child.bytes : child.observed,
    );
    if (nextTotal === undefined) return { kind: "invalid" };
    total = nextTotal;
    if (child.kind === "exceeded" || total > maximumBytes) {
      return { kind: "exceeded", observed: total };
    }
  }
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.length !== lengthDescriptor.value + 1) {
    return { kind: "invalid" };
  }
  if (immutable) memo.set(value, total);
  return { kind: "success", bytes: total };
}

function* measureCanonicalJsonObject<T extends object>(
  value: T,
  memo: WeakMap<object, number>,
  immutable: boolean,
  maximumBytes: number,
): CanonicalJsonMeasurementWork {
  let total = 2;
  let fieldCount = 0;
  if (total > maximumBytes) return { kind: "exceeded", observed: total };
  for (const key in value) {
    if (!Object.hasOwn(value, key)) continue;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      descriptor === undefined ||
      !descriptor.enumerable ||
      !("value" in descriptor)
    ) {
      return { kind: "invalid" };
    }
    const keyLength = measureCanonicalJsonString(
      key,
      maximumBytes - total,
    );
    if (keyLength.kind === "invalid") return keyLength;
    const nextTotal = checkedCanonicalByteAdd(
      total,
      fieldCount === 0 ? 1 : 2,
      keyLength.kind === "success"
        ? keyLength.bytes
        : keyLength.observed,
    );
    if (nextTotal === undefined) return { kind: "invalid" };
    total = nextTotal;
    if (keyLength.kind === "exceeded" || total > maximumBytes) {
      return { kind: "exceeded", observed: total };
    }
    const child = yield { value: descriptor.value, maximumBytes: maximumBytes - total };
    if (child.kind === "invalid") return child;
    if (descriptor.value !== null && typeof descriptor.value === "object" && !memo.has(descriptor.value)) immutable = false;
    const nextChildTotal = checkedCanonicalByteAdd(
      total,
      child.kind === "success" ? child.bytes : child.observed,
    );
    if (nextChildTotal === undefined) return { kind: "invalid" };
    total = nextChildTotal;
    if (child.kind === "exceeded" || total > maximumBytes) {
      return { kind: "exceeded", observed: total };
    }
    fieldCount += 1;
  }
  const ownKeys = Reflect.ownKeys(value);
  if (
    ownKeys.length !== fieldCount ||
    ownKeys.some((key) => {
      if (typeof key !== "string") return true;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return descriptor === undefined ||
        !descriptor.enumerable ||
        !("value" in descriptor);
    })
  ) {
    return { kind: "invalid" };
  }
  if (immutable) memo.set(value, total);
  return { kind: "success", bytes: total };
}

function measureCanonicalJsonString(
  value: string,
  maximumBytes: number,
): CanonicalJsonUtf8Measurement {
  let bytes = 2;
  if (bytes > maximumBytes) return { kind: "exceeded", observed: bytes };
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    let next: number;
    if (
      codeUnit === 0x22 ||
      codeUnit === 0x5c ||
      codeUnit === 0x08 ||
      codeUnit === 0x09 ||
      codeUnit === 0x0a ||
      codeUnit === 0x0c ||
      codeUnit === 0x0d
    ) {
      next = 2;
    } else if (codeUnit <= 0x1f) {
      next = 6;
    } else if (codeUnit <= 0x7f) {
      next = 1;
    } else if (codeUnit <= 0x7ff) {
      next = 2;
    } else if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const low = value.charCodeAt(index + 1);
      if (low >= 0xdc00 && low <= 0xdfff) {
        next = 4;
        index += 1;
      } else {
        next = 6;
      }
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      next = 6;
    } else {
      next = 3;
    }
    const nextBytes = checkedCanonicalByteAdd(bytes, next);
    if (nextBytes === undefined) return { kind: "invalid" };
    bytes = nextBytes;
    if (bytes > maximumBytes) {
      return { kind: "exceeded", observed: bytes };
    }
  }
  return { kind: "success", bytes };
}

function measuredPrimitive(
  bytes: number,
  maximumBytes: number,
): CanonicalJsonUtf8Measurement {
  return bytes > maximumBytes
    ? { kind: "exceeded", observed: bytes }
    : { kind: "success", bytes };
}

function checkedCanonicalByteAdd(
  ...values: ReadonlyArray<number>
): number | undefined {
  let total = 0;
  for (const value of values) {
    if (
      !isNonNegativeSafeInteger(value) ||
      total > Number.MAX_SAFE_INTEGER - value
    ) {
      return undefined;
    }
    total += value;
  }
  return total;
}

export function isJson(value: unknown): value is Json {
  const ancestors = new WeakSet<object>();
  // Reuse only transitively frozen data. Mutable or accessor-bearing values
  // must be revisited because later getters or Proxy traps can change them.
  const completed = new WeakSet<object>();
  const frames: JsonValidationFrame[] = [{ kind: "value", value }];
  while (frames.length > 0) {
    const frame = frames.pop();
    if (frame === undefined) {
      throw new Error("JSON validation stack lost a frame.");
    }
    switch (frame.kind) {
      case "value": {
        const current = frame.value;
        if (
          current === null ||
          typeof current === "string" ||
          typeof current === "boolean"
        ) {
          break;
        }
        if (typeof current === "number") {
          if (!Number.isFinite(current)) return false;
          break;
        }
        if (Array.isArray(current)) {
          if (ancestors.has(current)) return false;
          if (completed.has(current)) break;
          ancestors.add(current);
          frames.push({ kind: "array", value: current, index: 0, immutable: Object.isFrozen(current) });
          break;
        }
        if (typeof current !== "object") return false;
        const frozen = Object.isFrozen(current);
        const prototype = Object.getPrototypeOf(current);
        if (prototype !== Object.prototype && prototype !== null) {
          return false;
        }
        if (Object.getOwnPropertySymbols(current).length > 0) {
          return false;
        }
        if (ancestors.has(current)) return false;
        if (completed.has(current)) break;
        ancestors.add(current);
        const immutable = frozen && Object.keys(current).every(key => {
          const descriptor = Object.getOwnPropertyDescriptor(current, key);
          return descriptor !== undefined && "value" in descriptor;
        });
        const values = Object.values(current);
        frames.push({
          kind: "object",
          value: current,
          values,
          index: 0,
          immutable,
        });
        break;
      }
      case "array": {
        const immutable = frame.immutable &&
          (frame.previous === null || typeof frame.previous !== "object" || completed.has(frame.previous));
        if (frame.index >= frame.value.length) {
          ancestors.delete(frame.value);
          if (immutable) completed.add(frame.value);
          break;
        }
        if (!Object.hasOwn(frame.value, frame.index)) return false;
        const descriptor = immutable ? Object.getOwnPropertyDescriptor(frame.value, frame.index) : undefined;
        const item = frame.value[frame.index];
        if (item === undefined) return false;
        frames.push({
          kind: "array",
          value: frame.value,
          index: frame.index + 1,
          immutable: immutable && descriptor !== undefined && "value" in descriptor,
          previous: item,
        });
        frames.push({ kind: "value", value: item });
        break;
      }
      case "object": {
        if (frame.index === frame.values.length) {
          ancestors.delete(frame.value);
          if (frame.immutable && frame.values.every(item => item === null || typeof item !== "object" || completed.has(item))) completed.add(frame.value);
          break;
        }
        const item = frame.values[frame.index];
        if (item === undefined) return false;
        frames.push({
          kind: "object",
          value: frame.value,
          values: frame.values,
          index: frame.index + 1,
          immutable: frame.immutable,
        });
        frames.push({ kind: "value", value: item });
        break;
      }
    }
  }
  return true;
}

/**
 * Validates unknown input against the complete JSON contract before exposing
 * the writable compatibility shape. This type narrowing does not promise
 * runtime mutability.
 */
export function isWritableJsonFromUnknown(
  value: unknown,
): value is WritableJson {
  return isJson(value);
}

type JsonValidationFrame =
  | Readonly<{ readonly kind: "value"; readonly value: unknown }>
  | Readonly<{
      readonly kind: "array";
      readonly value: ReadonlyArray<unknown>;
      readonly index: number;
      readonly immutable: boolean;
      readonly previous?: unknown;
    }>
  | Readonly<{
      readonly kind: "object";
      readonly value: object;
      readonly values: ReadonlyArray<unknown>;
      readonly index: number;
      readonly immutable: boolean;
    }>;
