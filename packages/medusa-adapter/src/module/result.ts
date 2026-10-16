import { Result, Schema } from "effect";
import type { Json } from "@flarex/persistence-postgres/internal/commerce-values";
import { commerceDecoder } from "../value/decoder";

const decodeOptional = commerceDecoder(Schema.Union([
  Schema.Struct({ kind: Schema.Literal("absent") }),
  Schema.Struct({ kind: Schema.Literal("present"), value: Schema.Json }),
]), "storedCorruption");

/** A selected native service method can return undefined. Wrap its entire
 * foreign result before the ordinary command owner captures and budgets JSON.
 * This envelope is private command data, never a substitute native result. */
export const encodeOptionalServiceResult = (value: unknown) => value === undefined
  ? { kind: "absent" } : { kind: "present", value };

export const decodeOptionalServiceResult = (value: Json) => decodeOptional(value).pipe(
  Result.map(result => result.kind === "absent" ? undefined : result.value),
);
