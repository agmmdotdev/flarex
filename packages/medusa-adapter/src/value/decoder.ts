import { Result, Schema } from "effect";
import { commerceError, type CommerceTransactionError } from "@flarex/persistence-postgres/internal/commerce-values";

/** Compile once at the adapter boundary. Profiles own their failure reason;
 * strict keys and original property order preserve capability refusal. */
export function commerceDecoder<S extends Schema.ConstraintDecoder<unknown>>(
  schema: S,
  reason: CommerceTransactionError["reason"],
): (input: unknown) => Result.Result<S["Type"], CommerceTransactionError> {
  const decode = Schema.decodeUnknownResult(schema, { onExcessProperty: "error", propertyOrder: "original" });
  return input => decode(input).pipe(Result.mapError(cause => commerceError(reason, cause)));
}

/** Optional JSON fields drawn from checked metadata. A field allowlist does
 * not establish its scalar storage type or grant write authority. */
export function commerceRowDecoder<const Name extends string>(
  names: readonly Name[],
  reason: CommerceTransactionError["reason"],
) {
  return commerceDecoder(Schema.Record(Schema.Literals(names), Schema.optionalKey(Schema.Json)), reason);
}
