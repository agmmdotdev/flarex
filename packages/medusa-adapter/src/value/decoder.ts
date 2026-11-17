import { Result, Schema } from "effect";
import { commerceError, inspectCapturedPrivateJsonData, isJsonObject, type CommerceTransactionError, type Json, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";

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
 * not establish its scalar storage type or grant write authority.
 *
 * A root the capture owner issued is recognized by object identity: its members
 * are already frozen JSON, so only the allowlist remains to be checked and the
 * row is the same fresh mutable record Schema returns. Every other input, and an
 * issued root holding any other key, takes the complete Schema decode. */
export function commerceRowDecoder<const Name extends string>(
  names: readonly Name[],
  reason: CommerceTransactionError["reason"],
) {
  const decode = commerceDecoder(Schema.Record(Schema.Literals(names), Schema.optionalKey(Schema.Json)), reason);
  const allowed: ReadonlySet<string> = new Set(names);
  const holdsOnlyAllowed = (row: JsonObject): row is JsonObject & { readonly [Key in Name]?: Json } => {
    for (const key of Object.keys(row)) if (!allowed.has(key)) return false;
    return true;
  };
  return (input: unknown): ReturnType<typeof decode> => {
    const issued = inspectCapturedPrivateJsonData(input)?.value;
    return issued !== undefined && isJsonObject(issued) && holdsOnlyAllowed(issued) ? Result.succeed({ ...issued }) : decode(input);
  };
}
