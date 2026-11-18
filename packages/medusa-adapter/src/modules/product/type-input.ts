import { Schema } from "effect";
import { commerceDecoder } from "../../value/decoder";
import { NativePreimageConfig } from "../../workflow/preimage";

const Id = Schema.String.check(Schema.isLengthBetween(1, 256));
export const ProductTypeIds = Schema.Array(Id).pipe(Schema.mutable).check(Schema.isMaxLength(4));
export const ProductTypeSelector = Schema.Struct({
  id: Schema.optionalKey(Schema.Union([Id, ProductTypeIds])),
  value: Schema.optionalKey(Schema.String),
});
/** This is Type's native scalar DTO profile. The command additionally checks
 * its own compiled Type DML fields before invoking the native service. */
export const ProductTypeCreateInput = Schema.Array(Schema.Struct({
  id: Schema.optionalKey(Id), value: Schema.String,
  metadata: Schema.optionalKey(Schema.NullOr(Schema.JsonObject)),
})).pipe(Schema.mutable).check(Schema.isMaxLength(4));
export const ProductTypeUpdateData = Schema.Struct({
  value: Schema.optionalKey(Schema.String),
  metadata: Schema.optionalKey(Schema.NullOr(Schema.JsonObject)),
});
export const ProductTypeUpdateInput = Schema.Struct({ selector: ProductTypeSelector, update: ProductTypeUpdateData });
export const ProductTypeReadConfig = NativePreimageConfig;
export const ProductTypeReadInput = Schema.Struct({ filters: ProductTypeSelector, config: ProductTypeReadConfig });
export const ProductTypeOutput = Schema.Array(Schema.StructWithRest(Schema.Struct({ id: Id, value: Schema.String }),
  [Schema.Record(Schema.String, Schema.Json)])).check(Schema.isMaxLength(4));
/** Native compensation preimages may contain only the retained primary key. */
export const ProductTypePreimages = Schema.Array(Schema.StructWithRest(Schema.Struct({ id: Id }),
  [Schema.Record(Schema.String, Schema.Json)])).check(Schema.isMaxLength(4));
export const ProductTypeSoftDeleteOutput = Schema.Struct({ product_type_id: Schema.optionalKey(ProductTypeIds) });
export const decodeProductTypeOutput = commerceDecoder(ProductTypeOutput, "storedCorruption");
export const decodeProductTypeUpdateInput = commerceDecoder(ProductTypeUpdateInput, "invalidInput");
export const decodeProductTypeIds = commerceDecoder(ProductTypeIds, "invalidInput");
