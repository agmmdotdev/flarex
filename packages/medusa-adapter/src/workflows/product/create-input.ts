import { Schema } from "effect";
import { SimpleVariantInput } from "../../modules/product/variant-workflow-input";
import { BasePriceInput } from "../../modules/pricing/input";
import { ProductRelationshipReferences } from "../../modules/product/value-profile";

/** Selected simple creation contract, not the complete native Product DTO. */
export const SimpleProductInput = Schema.Struct({
  id: Schema.optionalKey(Schema.String.check(Schema.isLengthBetween(1, 256))), title: Schema.String,
});
export const ProductImageCreateInput = Schema.Struct({ id: Schema.optionalKey(Schema.String), url: Schema.String });
/** The admitted native create shape includes owned rows and existing
 * module-local tag/category memberships, not every Medusa Product DTO field. */
export const ProductCreateGraphInput = Schema.Struct({
  ...SimpleProductInput.fields,
  tags: Schema.optionalKey(ProductRelationshipReferences),
  categories: Schema.optionalKey(ProductRelationshipReferences),
  collection_id: Schema.optionalKey(Schema.NullOr(Schema.String.check(Schema.isLengthBetween(1, 256)))),
  tag_ids: Schema.optionalKey(Schema.Array(Schema.String.check(Schema.isLengthBetween(1, 256))).check(Schema.isMaxLength(256))),
  category_ids: Schema.optionalKey(Schema.Array(Schema.String.check(Schema.isLengthBetween(1, 256))).check(Schema.isMaxLength(256))),
  images: Schema.optionalKey(Schema.Array(ProductImageCreateInput).check(Schema.isMaxLength(256))),
  options: Schema.optionalKey(Schema.Array(Schema.Struct({
    title: Schema.String, values: Schema.Array(Schema.String).check(Schema.isMaxLength(256)),
  })).check(Schema.isMaxLength(256))),
  variants: Schema.optionalKey(Schema.Array(Schema.Struct({
    id: Schema.optionalKey(Schema.String), title: Schema.String,
    sku: Schema.optionalKey(Schema.String), thumbnail: Schema.optionalKey(Schema.NullOr(Schema.String)),
    options: Schema.Record(Schema.String, Schema.String),
  })).check(Schema.isMaxLength(256))),
});

/** Native scalar normalization and storage validation remain with the Product
 * value/DAL owner. This metadata allowlist extends the selected graph ABI; it
 * cannot admit managed columns or arbitrary JSON keys. */
export function productCreationInput(columns: readonly string[]) {
 const selected = columns.filter(name => !["created_at", "updated_at", "deleted_at", "collection_id", "type_id"].includes(name));
 return Schema.Struct({
  ...Object.fromEntries(selected.map(name => [name, Schema.optionalKey(Schema.Json)])),
  ...ProductCreateGraphInput.fields,
  type_id: Schema.optionalKey(Schema.NullOr(Schema.String.check(Schema.isLengthBetween(1,256)))),
 });
}

/** The finite native entry is shared by standalone and batch roots. Scalar
 * names and normalization retain the checked Product DML/value owners. */
export function productCreationWorkflowEntry(columns: readonly string[]) {
  const Id = Schema.String.check(Schema.isLengthBetween(1, 256));
  const { product_id: _parent, ...variantFields } = SimpleVariantInput.fields;
  const variants = Schema.Array(Schema.Struct({ ...variantFields,
    prices: Schema.optionalKey(Schema.Array(BasePriceInput).check(Schema.isMaxLength(2))),
  })).check(Schema.isMaxLength(4));
  return Schema.Struct({ ...productCreationInput(columns).fields,
    tags: Schema.optionalKey(ProductRelationshipReferences.check(Schema.isMaxLength(4))),
    categories: Schema.optionalKey(ProductRelationshipReferences.check(Schema.isMaxLength(4))),
    tag_ids: Schema.optionalKey(Schema.Array(Id).check(Schema.isMaxLength(4))),
    category_ids: Schema.optionalKey(Schema.Array(Id).check(Schema.isMaxLength(4))),
    images: Schema.optionalKey(Schema.Array(ProductImageCreateInput).check(Schema.isMaxLength(2))),
    options: Schema.optionalKey(Schema.Array(Schema.Struct({ title: Schema.String,
      values: Schema.Array(Schema.String).check(Schema.isLengthBetween(1, 4)),
    })).check(Schema.isMaxLength(1))),
    variants: Schema.optionalKey(variants),
    sales_channels: Schema.optionalKey(Schema.Array(Schema.Struct({ id: Id })).check(Schema.isMaxLength(2))),
    shipping_profile_id: Schema.optionalKey(Id),
  });
}

/** One admission contract for the promoted standalone Product creation root. */
export function productCreationWorkflowInput(columns: readonly string[]) {
  const Product = productCreationWorkflowEntry(columns);
  return Schema.Struct({ products: Schema.Array(Product).check(Schema.isLengthBetween(1, 4),
    Schema.makeFilter(products => products.reduce((total, product) => total + (product.variants?.length ?? 0), 0) <= 4)),
    additional_data: Schema.optionalKey(Schema.JsonObject),
  });
}
