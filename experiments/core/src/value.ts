import { Result, Schema } from "effect";
import { capturePrivateJsonData } from "../../../packages/persistence-postgres/src/values/privateJsonData.ts";
import { CoreError } from "./errors.ts";

/** This construction profile persists JSON, not the full Flarex value codec.
 * JSON/JSONB erase negative zero; refuse it before guest execution or pending
 * changes so observable values and durable request identities cannot diverge. */
function representable(value: Schema.Json): boolean {
  if (typeof value === "number") return Number.isFinite(value) && !Object.is(value, -0);
  return value === null || typeof value !== "object" || Object.values(value).every(representable);
}
export const JsonValue = Schema.Json.check(Schema.makeFilter(representable));
export const FiniteNumber = Schema.Number.check(Schema.isFinite(), Schema.makeFilter(value => !Object.is(value, -0)));

/** Reuse the descriptor-safe value owner only: no persistence/admission imports.
 * Strict JSON preserves undefined refusal; Medusa's omission policy stays with
 * its own native input boundary. Capture bounds precede Schema field access. */
export function captureJsonInput(value: unknown) {
  return capturePrivateJsonData(value, 262144, (reason, cause) => new CoreError({ reason: reason === "limitExceeded" ? "limit" : "invalid", cause })).pipe(
    Result.flatMap(captured => Schema.decodeUnknownResult(JsonValue)(captured.value).pipe(Result.mapError(cause => new CoreError({ reason: "invalid", cause })))),
  );
}

/** Only call on detached, validated JSON. Never freeze caller-owned values. */
export function freezeOwnedJson(value: Schema.Json): void {
  if (value === null || typeof value !== "object") return;
  for (const child of Object.values(value)) freezeOwnedJson(child);
  Object.freeze(value);
}
