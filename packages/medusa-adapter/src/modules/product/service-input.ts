import { Result, Schema } from "effect";
import { commerceDecoder } from "../../value/decoder";
import { captureCommerceInput } from "../../value/input";
import { commerceError, isJsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { VariantImagePairs } from "./variant-workflow-input";

const Read = Schema.Struct({
  id: Schema.optionalKey(Schema.String), filters: Schema.optionalKey(Schema.Json), config: Schema.optionalKey(Schema.Json),
});
const decodeExternalRead = commerceDecoder(Read, "invalidInput");
export const ProductNamedFilters = Schema.Struct({
    id: Schema.optionalKey(Schema.Union([Schema.String, Schema.Array(Schema.String).check(Schema.isMaxLength(256))])),
    value: Schema.optionalKey(Schema.String),
});
export const decodeProductNamedRead = commerceDecoder(Schema.Struct({
  ...Read.fields,
  filters: Schema.optionalKey(ProductNamedFilters),
}), "invalidInput");
export const decodeProductCategoryRead = commerceDecoder(Schema.Struct({
  ...Read.fields,
  filters: Schema.optionalKey(Schema.Struct({
    id: Schema.optionalKey(Schema.Union([Schema.String, Schema.Array(Schema.String).check(Schema.isMaxLength(256))])),
    name: Schema.optionalKey(Schema.String), handle: Schema.optionalKey(Schema.String),
    parent_category_id: Schema.optionalKey(Schema.NullOr(Schema.Union([Schema.String, Schema.Array(Schema.String).check(Schema.isMaxLength(256))]))),
    is_internal: Schema.optionalKey(Schema.Boolean), is_active: Schema.optionalKey(Schema.Boolean),
    include_descendants_tree: Schema.optionalKey(Schema.Boolean), include_ancestors_tree: Schema.optionalKey(Schema.Boolean),
  })),
}), "invalidInput");
export const decodeProductCollectionRead = commerceDecoder(Schema.Struct({
  ...Read.fields,
  filters: Schema.optionalKey(Schema.Struct({
    id: Schema.optionalKey(Schema.Union([Schema.String, Schema.Array(Schema.String).check(Schema.isMaxLength(256))])),
    title: Schema.optionalKey(Schema.String), handle: Schema.optionalKey(Schema.String),
  })),
}), "invalidInput");
export const decodeVariantImageInput = commerceDecoder(Schema.Union([
  VariantImagePairs.value, VariantImagePairs,
]), "invalidInput");
const ParentFilters = Schema.Struct({
  id: Schema.optionalKey(Schema.Union([Schema.String, Schema.Array(Schema.String).check(Schema.isMaxLength(256))])),
  title: Schema.optionalKey(Schema.String), product_id: Schema.optionalKey(Schema.String),
});
export const decodeProductParentRead = commerceDecoder(Schema.Struct({
  ...Read.fields, filters: Schema.optionalKey(ParentFilters),
}), "invalidInput");
// Native Price List Product removal selects all Variants belonging to its
// bounded Product cohort. Only Variant reads admit that parent-array producer;
// Option reads and every mutation retain their existing input contracts.
export const decodeProductVariantRead = commerceDecoder(Schema.Struct({ ...Read.fields,
  filters: Schema.optionalKey(Schema.Struct({ ...ParentFilters.fields,
    product_id: Schema.optionalKey(Schema.Union([Schema.String, Schema.Array(Schema.String).check(Schema.isMaxLength(4))])),
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
