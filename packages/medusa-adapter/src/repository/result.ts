import { jsonEqual } from "flarex-protocol/json";
import { isJsonObject, type Json, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";

/** Native DML rows omit exactly the two core-owned document metadata fields.
 * Retain every other key so the native decoder still refuses unknown fields. */
export function projectNativeRow(stored: JsonObject): JsonObject {
  return Object.fromEntries(Object.entries(stored).filter(([field]) => field !== "_id" && field !== "_creationTime"));
}

/** Public native rows contain the stored fields without Flarex document metadata. */
export function matchesPublicRow(stored: JsonObject, returned: Json): boolean {
  if (!isJsonObject(returned)) return false;
  const native = projectNativeRow(stored), fields = Object.keys(native);
  return Object.keys(returned).length === fields.length && fields.every(key => {
    const actual = returned[key], expected = native[key];
    return actual !== undefined && expected !== undefined && jsonEqual(actual, expected);
  });
}
