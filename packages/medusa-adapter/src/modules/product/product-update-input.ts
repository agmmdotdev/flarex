import { Schema } from "effect";
import { ProductLifecycleIds } from "./lifecycle";
import { commerceDecoder } from "../../value/decoder";

const Id = ProductLifecycleIds.value;
export const ProductUpdateSelector = Schema.Struct({ id: Schema.Union([Id, Schema.Array(Id).check(Schema.isMaxLength(4))]) });
export const ProductSelectorUpdate = Schema.Struct({ selector: ProductUpdateSelector, update: Schema.JsonObject });
export const decodeProductSelectorUpdate = commerceDecoder(ProductSelectorUpdate, "invalidInput");
const JsonRow = Schema.StructWithRest(Schema.Struct({ id: Id }), [Schema.Record(Schema.String, Schema.Json)]);
const VariantRows = Schema.Array(JsonRow).check(Schema.isMaxLength(4));
const RelatedRows = Schema.Array(JsonRow).check(Schema.isMaxLength(4));
const OptionRows = Schema.Array(Schema.StructWithRest(Schema.Struct({ id: Id,
  values: Schema.Array(JsonRow).check(Schema.isMaxLength(4)),
}), [Schema.Record(Schema.String, Schema.Json)])).check(Schema.isMaxLength(1));
export const ProductUpdateOutput = Schema.Array(Schema.StructWithRest(Schema.Struct({ id: Id,
  variants: VariantRows, images: Schema.Array(JsonRow).check(Schema.isMaxLength(2)),
  options: OptionRows, tags: RelatedRows, categories: RelatedRows,
}), [Schema.Record(Schema.String, Schema.Json)])).check(Schema.isMaxLength(4),
  Schema.makeFilter(rows => rows.reduce((total, row) => total + row.variants.length, 0) <= 4));
/** Preimages can be partial; retain native selected fields and check each
 * admitted relation whenever present. The graph reader uses the same closure. */
export const ProductUpdatePreimages = Schema.Array(Schema.StructWithRest(Schema.Struct({ id: Id,
  variants: Schema.optionalKey(VariantRows), images: Schema.optionalKey(Schema.Array(JsonRow).check(Schema.isMaxLength(2))),
  options: Schema.optionalKey(Schema.Array(Schema.JsonObject).check(Schema.isMaxLength(1))),
  tags: Schema.optionalKey(RelatedRows), categories: Schema.optionalKey(RelatedRows),
}), [Schema.Record(Schema.String, Schema.Json)])).check(Schema.isMaxLength(4),
  Schema.makeFilter(rows => rows.reduce((total, row) => total + (row.variants?.length ?? 0), 0) <= 4));

/** Metadata owns scalar names/values. These nested fields retain the existing
 * finite Product creation envelope while admitting native replacement. */
export function productUpdateData<const Extra extends Schema.Struct.Fields>(columns: readonly string[], extra: Extra) {
  const scalarNames = columns.filter(name => !["id", "created_at", "updated_at", "deleted_at", "collection_id", "type_id"].includes(name));
  const allowed = new Set(scalarNames);
  const extras = new Set([...Object.keys(extra), "collection_id", "type_id", "tag_ids", "category_ids", "images", "options"]);
  return Schema.StructWithRest(Schema.Struct({ ...extra,
    collection_id: Schema.optionalKey(Schema.NullOr(Id)), type_id: Schema.optionalKey(Schema.NullOr(Id)),
    tag_ids: Schema.optionalKey(Schema.Array(Id).check(Schema.isMaxLength(4))),
    category_ids: Schema.optionalKey(Schema.Array(Id).check(Schema.isMaxLength(4))),
    images: Schema.optionalKey(Schema.Array(Schema.Struct({ id: Schema.optionalKey(Id), url: Schema.String })).check(Schema.isMaxLength(2))),
    options: Schema.optionalKey(Schema.Array(Schema.Struct({ id: Schema.optionalKey(Id), title: Schema.String,
      values: Schema.Array(Schema.String).check(Schema.isMaxLength(4)),
    })).check(Schema.isMaxLength(1))),
  }), [Schema.Record(Schema.String, Schema.Json)]).check(Schema.makeFilter(value =>
    Object.keys(value).every(name => allowed.has(name) || extras.has(name))));
}
