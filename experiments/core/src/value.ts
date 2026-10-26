import { Schema } from "effect";

/** This construction profile persists JSON, not the full Flarex value codec.
 * JSON/JSONB erase negative zero; refuse it before guest execution or pending
 * changes so observable values and durable request identities cannot diverge. */
function representable(value: Schema.Json): boolean {
  if (typeof value === "number") return Number.isFinite(value) && !Object.is(value, -0);
  return value === null || typeof value !== "object" || Object.values(value).every(representable);
}
export const JsonValue = Schema.Json.check(Schema.makeFilter(representable));
export const FiniteNumber = Schema.Number.check(Schema.isFinite(), Schema.makeFilter(value => !Object.is(value, -0)));
