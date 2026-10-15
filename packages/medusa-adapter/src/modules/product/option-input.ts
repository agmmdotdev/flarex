import { Schema } from "effect";
import { commerceDecoder } from "../../value/decoder";
import { NativePreimageConfig } from "../../workflow/preimage";

const Id = Schema.String.check(Schema.isLengthBetween(1, 256));
export const ProductOptionIds = Schema.Array(Id).pipe(Schema.mutable).check(Schema.isMaxLength(4));
const ValueIds = Schema.Array(Id).pipe(Schema.mutable).check(Schema.isMaxLength(16));
const Values = Schema.Array(Schema.String).pipe(Schema.mutable).check(Schema.isMaxLength(4));
export const ProductOptionSelector = Schema.Struct({
  id: Schema.optionalKey(Schema.Union([Id, ProductOptionIds])),
  product_id: Schema.optionalKey(Schema.Union([Id, ProductOptionIds])),
  title: Schema.optionalKey(Schema.String),
});
/** Native normalization owns Value identities. The command additionally checks
 * these fields against the compiled Option DML before service invocation. */
export const ProductOptionCreateInput = Schema.Array(Schema.Struct({
  id: Schema.optionalKey(Id), title: Schema.String, product_id: Id,
  values: Schema.optionalKey(Values), metadata: Schema.optionalKey(Schema.NullOr(Schema.JsonObject)),
})).pipe(Schema.mutable).check(Schema.isMaxLength(4));
/** Omitted Values preserve the relation; an empty array requests replacement
 * with no Values. Product reassignment is outside this named profile. */
export const ProductOptionUpdateData = Schema.Struct({
  title: Schema.optionalKey(Schema.String), values: Schema.optionalKey(Values),
  metadata: Schema.optionalKey(Schema.NullOr(Schema.JsonObject)),
});
export const ProductOptionUpdateInput = Schema.Struct({ selector: ProductOptionSelector, update: ProductOptionUpdateData });
export const ProductOptionReadInput = Schema.Struct({ filters: ProductOptionSelector, config: NativePreimageConfig });
const Value = Schema.StructWithRest(Schema.Struct({ id: Id, value: Schema.String, option_id: Schema.NullOr(Id) }),
  [Schema.Record(Schema.String, Schema.Json)]);
export const ProductOptionOutput = Schema.Array(Schema.StructWithRest(Schema.Struct({
  id: Id, title: Schema.String, product_id: Id,
  values: Schema.Array(Value).check(Schema.isMaxLength(4)),
}), [Schema.Record(Schema.String, Schema.Json)])).check(Schema.isMaxLength(4));
/** Native compensation reads retain keys while projecting requested fields. */
export const ProductOptionPreimages = Schema.Array(Schema.StructWithRest(Schema.Struct({
  id: Id, values: Schema.optionalKey(Schema.Array(Schema.StructWithRest(Schema.Struct({ id: Id }),
    [Schema.Record(Schema.String, Schema.Json)])).check(Schema.isMaxLength(4))),
}), [Schema.Record(Schema.String, Schema.Json)])).check(Schema.isMaxLength(4));
export const ProductOptionSoftDeleteOutput = Schema.Struct({
  product_option_id: Schema.optionalKey(ProductOptionIds),
  product_option_value_id: Schema.optionalKey(ValueIds),
});
export const decodeProductOptionOutput = commerceDecoder(ProductOptionOutput, "storedCorruption");
export const decodeProductOptionPreimages = commerceDecoder(ProductOptionPreimages, "unsupportedProfile");
export const decodeProductOptionCreateInput = commerceDecoder(ProductOptionCreateInput, "invalidInput");
export const decodeProductOptionUpdateInput = commerceDecoder(ProductOptionUpdateInput, "invalidInput");
export const decodeProductOptionIds = commerceDecoder(ProductOptionIds, "invalidInput");
