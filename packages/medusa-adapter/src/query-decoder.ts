import { Result, Schema } from "effect";
import { commerceError, commerceLimits, type CommerceTransactionError } from "@flarex/persistence-postgres/internal/commerce-values";

/** Compile once at the profile boundary. Strict keys preserve capability
 * refusal; original property order preserves recursive first-failure order. */
export function queryDecoder<S extends Schema.ConstraintDecoder<unknown>>(
  schema: S,
  reason: "invalidInput" | "unsupportedProfile" | "limitExceeded",
): (input: unknown) => Result.Result<S["Type"], CommerceTransactionError> {
  const decode = Schema.decodeUnknownResult(schema, { onExcessProperty: "error", propertyOrder: "original" });
  return input => decode(input).pipe(Result.mapError(cause => commerceError(reason, cause)));
}

export const QueryEnvelope = Schema.Struct({
  where: Schema.optionalKey(Schema.Unknown),
  options: Schema.optionalKey(Schema.Unknown),
});

export const QueryOffset = Schema.Number.check(Schema.isInt(), Schema.isBetween({ minimum: 0, maximum: commerceLimits.catalogRows - 1 }));
export const QueryLimit = Schema.Number.check(Schema.isInt(), Schema.isBetween({ minimum: 0, maximum: commerceLimits.catalogRows }));
