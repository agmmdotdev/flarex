import { Result, Schema } from "effect";
import { commerceDecoder } from "./commerce-decoder";
import { captureCommerceInput } from "./commerce-input";
import { commerceError, isJsonObject } from "@flarex/persistence-postgres/internal/commerce-values";

const Read = Schema.Struct({
  id: Schema.optionalKey(Schema.String), filters: Schema.optionalKey(Schema.Json), config: Schema.optionalKey(Schema.Json),
});
const decodeExternalRead = commerceDecoder(Read, "invalidInput");
export const decodeProductNamedRead = commerceDecoder(Schema.Struct({
  ...Read.fields,
  filters: Schema.optionalKey(Schema.Struct({
    id: Schema.optionalKey(Schema.Union([Schema.String, Schema.Array(Schema.String).check(Schema.isMaxLength(256))])),
    value: Schema.optionalKey(Schema.String),
  })),
}), "invalidInput");
const CommandRead = Schema.Struct({ ...Read.fields, deletedAfter: Schema.optionalKey(Schema.String) });
export const decodeProductRead = commerceDecoder(CommandRead, "invalidInput");
const decodeAfter = commerceDecoder(Schema.Struct({ $gt: Schema.String }), "unsupportedProfile");
/** Private command encoding for the admitted Medusa comparison. Flarex runtime
 * values reserve dollar-prefixed object keys; the original service still sees
 * its exact filter after this command-owned representation is decoded. */
export const prepareProductReadInput = (input: unknown) => Result.gen(function* () {
  const captured = yield* captureCommerceInput(input);
  const decoded = yield* decodeExternalRead(captured);
  if (decoded.filters === undefined || !isJsonObject(decoded.filters) || decoded.filters.deleted_at === undefined) return decoded;
  const comparison = yield* decodeAfter(decoded.filters.deleted_at);
  const { deleted_at: _deleted, ...filters } = decoded.filters;
  return { ...decoded, filters, deletedAfter: comparison.$gt };
});
export const productReadFilters = (decoded: typeof CommandRead.Type) => {
  if (decoded.deletedAfter === undefined) return Result.succeed(decoded.filters);
  if (decoded.filters !== undefined && (!isJsonObject(decoded.filters) || decoded.filters.deleted_at !== undefined)) return Result.fail(commerceError("invalidInput"));
  return Result.succeed({ ...decoded.filters, deleted_at: { $gt: decoded.deletedAfter } });
};
export const decodeProductFindConfig = commerceDecoder(Schema.Struct({
  select: Schema.optionalKey(Schema.Json), relations: Schema.optionalKey(Schema.Json), order: Schema.optionalKey(Schema.Json),
  skip: Schema.optionalKey(Schema.Number.check(Schema.isInt())), take: Schema.optionalKey(Schema.Number.check(Schema.isInt())),
  withDeleted: Schema.optionalKey(Schema.Boolean),
}), "unsupportedProfile");
// Bulk creation keeps the original service's per-product required-field checks.
export const decodeProductCreateInput = commerceDecoder(Schema.Union([
  Schema.Array(Schema.Json),
  Schema.StructWithRest(Schema.Struct({ title: Schema.String }), [Schema.Record(Schema.String, Schema.Json)]),
]), "invalidInput");
