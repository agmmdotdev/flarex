import { Schema } from "effect";

export type JsonObject = { readonly [key: string]: Json };

export type Json =
  | null
  | boolean
  | number
  | string
  | ReadonlyArray<Json>
  | JsonObject;

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

export function isJson(value: unknown): value is Json {
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
    return value.every(isJson);
  }
  if (typeof value === "object") {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      return false;
    }
    if (Object.getOwnPropertySymbols(value).length > 0) {
      return false;
    }
    return Object.values(value as Record<string, unknown>).every(isJson);
  }
  return false;
}
