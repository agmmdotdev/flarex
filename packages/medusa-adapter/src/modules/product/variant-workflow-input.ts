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
export const VariantUpdateSelector = Schema.Struct({ id: Schema.Union([Id, Schema.Array(Id).check(Schema.isMaxLength(4))]) });
export const VariantSelectorUpdate = Schema.Struct({ selector: VariantUpdateSelector, update: Schema.JsonObject });
export const decodeVariantSelectorUpdate = commerceDecoder(VariantSelectorUpdate, "invalidInput");
/** Checked DML owns the scalar allowlist; the value/DAL owner validates values. */
export function variantUpdateData<const Extra extends Schema.Struct.Fields>(columns: readonly string[], extra: Extra) {
  const scalarNames = columns.filter(name => !["id", "product_id", "created_at", "updated_at", "deleted_at"].includes(name));
  const allowed = new Set(scalarNames);
  const extras = new Set([...Object.keys(extra), "options"]);
  return Schema.StructWithRest(Schema.Struct({ ...extra,
    options: Schema.optionalKey(Schema.Record(Schema.String, Schema.String).check(Schema.makeFilter(value => Object.keys(value).length <= 1))),
  }), [Schema.Record(Schema.String, Schema.Json)]).check(Schema.makeFilter(value =>
    Object.keys(value).every(name => allowed.has(name) || extras.has(name))));
}
export function variantUpdateInput(columns: readonly string[]) {
  return variantUpdateData(columns, { id: Id });
}
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
