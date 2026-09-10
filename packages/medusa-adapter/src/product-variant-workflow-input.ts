import { Schema } from "effect";
import { ProductLifecycleIds } from "./product-lifecycle";
import { commerceDecoder } from "./commerce-decoder";

const Id = ProductLifecycleIds.value;
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
