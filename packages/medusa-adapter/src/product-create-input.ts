import { Schema } from "effect";

/** Selected simple creation contract, not the complete native Product DTO. */
export const SimpleProductInput = Schema.Struct({
  id: Schema.optionalKey(Schema.String.check(Schema.isLengthBetween(1, 256))), title: Schema.String,
});
export const ProductImageCreateInput = Schema.Struct({ id: Schema.optionalKey(Schema.String), url: Schema.String });
/** The admitted native create shape includes owned rows and existing
 * module-local tag/category memberships, not every Medusa Product DTO field. */
export const ProductCreateGraphInput = Schema.Struct({
  ...SimpleProductInput.fields,
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
