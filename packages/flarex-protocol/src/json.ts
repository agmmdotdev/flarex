import { isNonArrayRecord } from "@flarex/utils/records";
import { compareUtf16Strings } from "@flarex/utils/strings";
import { Schema } from "effect";

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
  if (isJsonArray(value)) {
    const items: string[] = [];
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.hasOwn(value, index)) {
        return onInvariantViolation({ reason: "missingArrayItem", index });
      }
      const item = value[index];
      if (item === undefined) {
        return onInvariantViolation({ reason: "missingArrayItem", index });
      }
      items.push(encodeCanonicalJson(item, onInvariantViolation));
    }
    return `[${items.join(",")}]`;
  }
  if (isJsonObject(value)) {
    const fields: string[] = [];
    for (const key of Object.keys(value).sort(compareUtf16Strings)) {
      const item = value[key];
      if (item === undefined) {
        return onInvariantViolation({ reason: "missingObjectProperty", key });
      }
      fields.push(
        `${JSON.stringify(key)}:${encodeCanonicalJson(
          item,
          onInvariantViolation,
        )}`,
      );
    }
    return `{${fields.join(",")}}`;
  }
  const encoded = JSON.stringify(value);
  if (encoded === undefined) {
    return onInvariantViolation({ reason: "primitiveEncodingFailed" });
  }
  return encoded;
}

export function isJson(value: unknown): value is Json {
  const ancestors = new WeakSet<object>();
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
          ancestors.add(current);
          frames.push({ kind: "array", value: current, index: 0 });
          break;
        }
        if (typeof current !== "object") return false;
        const prototype = Object.getPrototypeOf(current);
        if (prototype !== Object.prototype && prototype !== null) {
          return false;
        }
        if (Object.getOwnPropertySymbols(current).length > 0) {
          return false;
        }
        if (ancestors.has(current)) return false;
        ancestors.add(current);
        frames.push({
          kind: "object",
          value: current,
          values: Object.values(current as Record<string, unknown>),
          index: 0,
        });
        break;
      }
      case "array": {
        if (frame.index >= frame.value.length) {
          ancestors.delete(frame.value);
          break;
        }
        if (!Object.hasOwn(frame.value, frame.index)) return false;
        const item = frame.value[frame.index];
        if (item === undefined) return false;
        frames.push({
          kind: "array",
          value: frame.value,
          index: frame.index + 1,
        });
        frames.push({ kind: "value", value: item });
        break;
      }
      case "object": {
        if (frame.index === frame.values.length) {
          ancestors.delete(frame.value);
          break;
        }
        const item = frame.values[frame.index];
        if (item === undefined) return false;
        frames.push({
          kind: "object",
          value: frame.value,
          values: frame.values,
          index: frame.index + 1,
        });
        frames.push({ kind: "value", value: item });
        break;
      }
    }
  }
  return true;
}

type JsonValidationFrame =
  | Readonly<{ readonly kind: "value"; readonly value: unknown }>
  | Readonly<{
      readonly kind: "array";
      readonly value: ReadonlyArray<unknown>;
      readonly index: number;
    }>
  | Readonly<{
      readonly kind: "object";
      readonly value: object;
      readonly values: ReadonlyArray<unknown>;
      readonly index: number;
    }>;
