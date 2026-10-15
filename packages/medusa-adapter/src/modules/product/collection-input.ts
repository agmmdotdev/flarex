import { Schema } from "effect";
import { commerceDecoder } from "../../value/decoder";
import { NativePreimageConfig } from "../../workflow/preimage";

const Id = Schema.String.check(Schema.isLengthBetween(1, 256));
export const ProductCollectionIds = Schema.Array(Id).pipe(Schema.mutable).check(Schema.isMaxLength(4));
export const ProductCollectionSelector = Schema.Struct({
  id: Schema.optionalKey(Schema.Union([Id, ProductCollectionIds])),
  title: Schema.optionalKey(Schema.String), handle: Schema.optionalKey(Schema.String),
});
/** The selected native DTO is checked again against Collection's own compiled
 * DML before service normalization. Product IDs are existing references. */
export const ProductCollectionCreateInput = Schema.Array(Schema.Struct({
  id: Schema.optionalKey(Id), title: Schema.String, handle: Schema.optionalKey(Schema.String),
  metadata: Schema.optionalKey(Schema.NullOr(Schema.JsonObject)),
  product_ids: Schema.optionalKey(ProductCollectionIds),
})).pipe(Schema.mutable).check(Schema.isMaxLength(4),
  Schema.makeFilter(rows => rows.reduce((total, row) => total + (row.product_ids?.length ?? 0), 0) <= 4));
export const ProductCollectionUpdateData = Schema.Struct({
  title: Schema.optionalKey(Schema.String), handle: Schema.optionalKey(Schema.String),
  metadata: Schema.optionalKey(Schema.NullOr(Schema.JsonObject)),
  product_ids: Schema.optionalKey(ProductCollectionIds),
});
export const ProductCollectionUpdateInput = Schema.Struct({ selector: ProductCollectionSelector, update: ProductCollectionUpdateData });
export const ProductCollectionReadInput = Schema.Struct({ filters: ProductCollectionSelector, config: NativePreimageConfig });
const Product = Schema.StructWithRest(Schema.Struct({ id: Id }), [Schema.Record(Schema.String, Schema.Json)]);
/** Creation returns loaded Product rows; update returns requested ID stubs.
 * Neither representation is changed by the workflow boundary. */
export const ProductCollectionOutput = Schema.Array(Schema.StructWithRest(Schema.Struct({
  id: Id, title: Schema.String, handle: Schema.String,
  products: Schema.Array(Product).check(Schema.isMaxLength(4)),
}), [Schema.Record(Schema.String, Schema.Json)])).check(Schema.isMaxLength(4));
export const ProductCollectionPreimages = Schema.Array(Schema.StructWithRest(Schema.Struct({ id: Id,
  products: Schema.optionalKey(Schema.Array(Product).check(Schema.isMaxLength(4))),
}), [Schema.Record(Schema.String, Schema.Json)])).check(Schema.isMaxLength(4));
export const ProductCollectionSoftDeleteOutput = Schema.Struct({ product_collection_id: Schema.optionalKey(ProductCollectionIds) });
export const decodeProductCollectionOutput = commerceDecoder(ProductCollectionOutput, "storedCorruption");
export const decodeProductCollectionUpdateInput = commerceDecoder(ProductCollectionUpdateInput, "invalidInput");
export const decodeProductCollectionIds = commerceDecoder(ProductCollectionIds, "invalidInput");
