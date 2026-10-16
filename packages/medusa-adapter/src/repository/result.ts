import { jsonEqual } from "flarex-protocol/json";
import { isJsonObject, type Json, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";

/** Public native rows contain the stored fields without Flarex document metadata. */
export function matchesPublicRow(stored: JsonObject, returned: Json): boolean {
  if (!isJsonObject(returned)) return false;
  const fields = Object.keys(stored).filter(key => key !== "_id" && key !== "_creationTime");
  return Object.keys(returned).length === fields.length && fields.every(key => {
    const actual = returned[key], expected = stored[key];
    return actual !== undefined && expected !== undefined && jsonEqual(actual, expected);
  });
}
