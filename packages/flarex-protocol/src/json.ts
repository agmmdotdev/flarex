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

export const Json: Schema.Schema<Json> = Schema.suspend(() =>
  Schema.Union([
    Schema.Null,
    Schema.Boolean,
    Schema.Number,
    Schema.String,
    Schema.Array(Json),
    Schema.Record(Schema.String, Json),
  ]),
);

export const JsonValue = Schema.declare<Json>(isJson, {
  title: "JsonValue",
  description:
    "A JSON value: null, boolean, finite number, string, array, or plain record.",
});

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
  return isJson(value) && isJsonObject(value);
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
  return isJsonWithAncestors(value, new WeakSet<object>());
}

function isJsonWithAncestors(
  value: unknown,
  ancestors: WeakSet<object>,
): value is Json {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return true;
  }
  if (typeof value === "number") {
    return Number.isFinite(value);
  }
  if (Array.isArray(value)) {
    if (ancestors.has(value)) return false;
    ancestors.add(value);
    try {
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.hasOwn(value, index)) return false;
        const item = value[index];
        if (item === undefined || !isJsonWithAncestors(item, ancestors)) {
          return false;
        }
      }
      return true;
    } finally {
      ancestors.delete(value);
    }
  }
  if (typeof value === "object") {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      return false;
    }
    if (Object.getOwnPropertySymbols(value).length > 0) {
      return false;
    }
    if (ancestors.has(value)) return false;
    ancestors.add(value);
    try {
      return Object.values(value as Record<string, unknown>).every((item) =>
        isJsonWithAncestors(item, ancestors),
      );
    } finally {
      ancestors.delete(value);
    }
  }
  return false;
}
