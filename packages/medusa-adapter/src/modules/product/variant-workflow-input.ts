import { Schema } from "effect";
import { ProductLifecycleIds } from "./lifecycle";
import { commerceDecoder } from "../../value/decoder";

const Id = ProductLifecycleIds.value;
export const SimpleVariantInput = Schema.Struct({
  id: Schema.optionalKey(Id), product_id: Id, title: Schema.String,
  options: Schema.Record(Schema.String, Schema.String),
  sku: Schema.optionalKey(Schema.NullOr(Schema.String)),
  manage_inventory: Schema.optionalKey(Schema.Boolean),
  origin_country: Schema.optionalKey(Schema.NullOr(Schema.String)),
  mid_code: Schema.optionalKey(Schema.NullOr(Schema.String)),
  hs_code: Schema.optionalKey(Schema.NullOr(Schema.String)),
  material: Schema.optionalKey(Schema.NullOr(Schema.String)),
  weight: Schema.optionalKey(Schema.NullOr(Schema.Number)),
  length: Schema.optionalKey(Schema.NullOr(Schema.Number)),
  height: Schema.optionalKey(Schema.NullOr(Schema.Number)),
  width: Schema.optionalKey(Schema.NullOr(Schema.Number)),
  inventory_items: Schema.optionalKey(Schema.Array(Schema.Struct({ inventory_item_id: Id,
    required_quantity: Schema.optionalKey(Schema.Number.check(Schema.isInt(), Schema.isBetween({ minimum: -2147483648, maximum: 2147483647 }))),
  })).check(Schema.isMaxLength(2))),
});
export const VariantSelector = Schema.Struct({ id: Id });
export const VariantThumbnailUpdate = Schema.Struct({ thumbnail: Schema.Null });
export const decodeVariantThumbnailUpdate = commerceDecoder(Schema.Struct({
  selector: VariantSelector, update: VariantThumbnailUpdate,
}), "invalidInput");
export const VariantImagePairs = Schema.Array(Schema.Struct({ variant_id: Id, image_id: Id })).check(Schema.isMaxLength(256));
export const VariantImagesWorkflowInput = Schema.Struct({ variant_id: Id,
  add: Schema.optionalKey(ProductLifecycleIds), remove: Schema.optionalKey(ProductLifecycleIds),
}).check(Schema.makeFilter(value => {
  const add = value.add ?? [], remove = value.remove ?? [];
  return new Set(add).size === add.length && new Set(remove).size === remove.length && !add.some(id => remove.includes(id));
}));
export const VariantImagesWorkflowOutput = Schema.Struct({ added: ProductLifecycleIds, removed: ProductLifecycleIds });
