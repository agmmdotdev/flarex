import { Result } from "effect";
import { commerceDecoder } from "../../value/decoder";
import { captureCommerceInput } from "../../value/input";
import { commerceError, isJsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { Read, ProductNamedReadSchema, ProductCategoryReadSchema, ProductCollectionReadSchema,
  VariantImageInputSchema, ProductParentReadSchema, ProductVariantReadSchema, ProductReadSchema,
  AfterSchema, ProductFindConfigSchema, ProductCreateInputSchema } from "./service-schemas";
// Preserve schema exports used by native workflow consumers.
export { ProductNamedFilters } from "./service-schemas";

const decodeExternalRead = commerceDecoder(Read, "invalidInput");
export const decodeProductNamedRead = commerceDecoder(ProductNamedReadSchema, "invalidInput");
export const decodeProductCategoryRead = commerceDecoder(ProductCategoryReadSchema, "invalidInput");
export const decodeProductCollectionRead = commerceDecoder(ProductCollectionReadSchema, "invalidInput");
export const decodeVariantImageInput = commerceDecoder(VariantImageInputSchema, "invalidInput");
export const decodeProductParentRead = commerceDecoder(ProductParentReadSchema, "invalidInput");
export const decodeProductVariantRead = commerceDecoder(ProductVariantReadSchema, "invalidInput");
export const decodeProductRead = commerceDecoder(ProductReadSchema, "invalidInput");
const decodeAfter = commerceDecoder(AfterSchema, "unsupportedProfile");
export const decodeProductFindConfig = commerceDecoder(ProductFindConfigSchema, "unsupportedProfile");
export const decodeProductCreateInput = commerceDecoder(ProductCreateInputSchema, "invalidInput");

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

export const productReadFilters = (decoded: typeof ProductReadSchema.Type) => {
  if (decoded.deletedAfter === undefined) return Result.succeed(decoded.filters);
  if (decoded.filters !== undefined && (!isJsonObject(decoded.filters) || decoded.filters.deleted_at !== undefined)) return Result.fail(commerceError("invalidInput"));
  return Result.succeed({ ...decoded.filters, deleted_at: { $gt: decoded.deletedAfter } });
};
