import { Result, Schema } from "effect";
import type { Json } from "@flarex/persistence-postgres/internal/commerce-values";
import { commerceDecoder } from "../../value/decoder";
import { NativePreimageConfig } from "../../workflow/preimage";
import { decodeCategoryProjection } from "./category-projection";

const Id = Schema.String.check(Schema.isLengthBetween(1, 256));
const StoredRank = Schema.Number.check(Schema.isInt(), Schema.isBetween({ minimum: Number.MIN_SAFE_INTEGER, maximum: Number.MAX_SAFE_INTEGER }));
const Rank = StoredRank.check(Schema.isGreaterThanOrEqualTo(0));
export const ProductCategoryIds = Schema.Array(Id).pipe(Schema.mutable).check(Schema.isMaxLength(4));
export const ProductCategorySelector = Schema.Struct({
  id: Schema.optionalKey(Schema.Union([Id, ProductCategoryIds])),
  name: Schema.optionalKey(Schema.String), handle: Schema.optionalKey(Schema.String),
  parent_category_id: Schema.optionalKey(Schema.NullOr(Schema.Union([Id, ProductCategoryIds]))),
  is_active: Schema.optionalKey(Schema.Boolean), is_internal: Schema.optionalKey(Schema.Boolean),
});
/** The genuine service owns handle defaults, rank clamping and tree changes.
 * The command checks these admitted DTOs against Category's compiled DML. */
export const ProductCategoryCreateInput = Schema.Array(Schema.Struct({
  id: Schema.optionalKey(Id), name: Schema.String,
  description: Schema.optionalKey(Schema.String), handle: Schema.optionalKey(Schema.NullOr(Schema.String)),
  is_active: Schema.optionalKey(Schema.Boolean), is_internal: Schema.optionalKey(Schema.Boolean),
  parent_category_id: Schema.optionalKey(Schema.NullOr(Id)), rank: Schema.optionalKey(Rank),
  metadata: Schema.optionalKey(Schema.NullOr(Schema.JsonObject)),
  products: Schema.optionalKey(Schema.Array(Schema.Struct({ id: Id })).pipe(Schema.mutable).check(Schema.isMaxLength(4))),
})).pipe(Schema.mutable).check(Schema.isMaxLength(4),
  Schema.makeFilter(rows => rows.reduce((total, row) => total + (row.products?.length ?? 0), 0) <= 4));
/** Native Category updates replace supplied metadata rather than merging it. */
export const ProductCategoryUpdateData = Schema.Struct({
  name: Schema.optionalKey(Schema.String), description: Schema.optionalKey(Schema.String),
  handle: Schema.optionalKey(Schema.String),
  is_active: Schema.optionalKey(Schema.Boolean), is_internal: Schema.optionalKey(Schema.Boolean),
  parent_category_id: Schema.optionalKey(Schema.NullOr(Id)), rank: Schema.optionalKey(Rank),
  metadata: Schema.optionalKey(Schema.NullOr(Schema.JsonObject)),
});
export const ProductCategoryUpdateInput = Schema.Struct({ selector: ProductCategorySelector, update: ProductCategoryUpdateData });
export const ProductCategoryReadInput = Schema.Struct({ filters: ProductCategorySelector, config: NativePreimageConfig });
export const ProductCategoryOutput = Schema.Array(Schema.StructWithRest(Schema.Struct({
  id: Id, name: Schema.String, description: Schema.String, handle: Schema.String,
  mpath: Schema.String, rank: StoredRank, is_active: Schema.Boolean, is_internal: Schema.Boolean,
  parent_category_id: Schema.NullOr(Id),
}), [Schema.Record(Schema.String, Schema.Json)])).check(Schema.isMaxLength(4));
export const ProductCategoryPreimages = Schema.Array(Schema.StructWithRest(Schema.Struct({ id: Id, rank: Schema.optionalKey(StoredRank) }),
  [Schema.Record(Schema.String, Schema.Json)])).check(Schema.isMaxLength(4));
export const ProductCategorySoftDeleteOutput = Schema.Struct({ product_category_id: Schema.optionalKey(ProductCategoryIds) });

const decodeOutputEnvelope = commerceDecoder(Schema.Struct({ payload: ProductCategoryOutput,
  omitted: Schema.Array(Schema.Array(Schema.String)),
}), "storedCorruption");
const decodePreimageEnvelope = commerceDecoder(Schema.Struct({ payload: ProductCategoryPreimages,
  omitted: Schema.Array(Schema.Array(Schema.String)),
}), "unsupportedProfile");
const decodeOutput = commerceDecoder(ProductCategoryOutput, "storedCorruption");
const decodeRestoredArray = commerceDecoder(Schema.Array(Schema.Unknown).check(Schema.isMaxLength(4)), "storedCorruption");

/** Writes return ordinary complete DTOs. Validate the entire native projection
 * envelope before restoring, then enforce the JSON workflow output contract. */
export const decodeProductCategoryOutput = (input: Json) => decodeOutputEnvelope(input).pipe(
  Result.flatMap(() => decodeCategoryProjection(input)), Result.flatMap(decodeOutput),
);
/** Compensation preimages can contain own undefined parent fields. The checked
 * payload bounds every root; the existing projection codec restores those exact
 * fields without pretending the native representation is JSON. */
export const decodeProductCategoryPreimages = (input: Json) => decodePreimageEnvelope(input).pipe(
  Result.flatMap(() => decodeCategoryProjection(input)), Result.flatMap(decodeRestoredArray),
);
export const decodeProductCategoryUpdateInput = commerceDecoder(ProductCategoryUpdateInput, "invalidInput");
export const decodeProductCategoryIds = commerceDecoder(ProductCategoryIds, "invalidInput");
