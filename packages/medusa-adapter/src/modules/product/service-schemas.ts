import { install as installSchemaAot } from "./service-schemas.schema-aot.generated.mjs";
import { Schema } from "effect";
import { VariantImagePairs } from "./variant-workflow-input";
import { ProductCollectionTextFilter } from "./collection-read";

export const Read = Schema.Struct({
  id: Schema.optionalKey(Schema.String), filters: Schema.optionalKey(Schema.Json), config: Schema.optionalKey(Schema.Json),
});
export const ProductNamedFilters = Schema.Struct({
    id: Schema.optionalKey(Schema.Union([Schema.String, Schema.Array(Schema.String).check(Schema.isMaxLength(256))])),
    value: Schema.optionalKey(Schema.String),
});
export const ProductNamedReadSchema = Schema.Struct({
  ...Read.fields,
  filters: Schema.optionalKey(ProductNamedFilters),
});
export const ProductCategoryReadSchema = Schema.Struct({
  ...Read.fields,
  filters: Schema.optionalKey(Schema.Struct({
    id: Schema.optionalKey(Schema.Union([Schema.String, Schema.Array(Schema.String).check(Schema.isMaxLength(256))])),
    name: Schema.optionalKey(Schema.String), handle: Schema.optionalKey(Schema.String),
    parent_category_id: Schema.optionalKey(Schema.NullOr(Schema.Union([Schema.String, Schema.Array(Schema.String).check(Schema.isMaxLength(256))]))),
    is_internal: Schema.optionalKey(Schema.Boolean), is_active: Schema.optionalKey(Schema.Boolean),
    include_descendants_tree: Schema.optionalKey(Schema.Boolean), include_ancestors_tree: Schema.optionalKey(Schema.Boolean),
  })),
});
export const ProductCollectionReadSchema = Schema.Struct({
  ...Read.fields,
  filters: Schema.optionalKey(Schema.Struct({
    id: Schema.optionalKey(Schema.Union([Schema.String, Schema.Array(Schema.String).check(Schema.isMaxLength(256))])),
    title: Schema.optionalKey(ProductCollectionTextFilter), handle: Schema.optionalKey(ProductCollectionTextFilter),
  })),
});
export const VariantImageInputSchema = Schema.Union([
  VariantImagePairs.value, VariantImagePairs,
]);
export const ParentFilters = Schema.Struct({
  id: Schema.optionalKey(Schema.Union([Schema.String, Schema.Array(Schema.String).check(Schema.isMaxLength(256))])),
  title: Schema.optionalKey(Schema.String), product_id: Schema.optionalKey(Schema.String),
});
export const ProductParentReadSchema = Schema.Struct({
  ...Read.fields, filters: Schema.optionalKey(ParentFilters),
});
// Only Variant reads admit the bounded parent-array producer used by Price List removal.
export const ProductVariantReadSchema = Schema.Struct({ ...Read.fields,
  filters: Schema.optionalKey(Schema.Struct({ ...ParentFilters.fields,
    product_id: Schema.optionalKey(Schema.Union([Schema.String, Schema.Array(Schema.String).check(Schema.isMaxLength(4))])),
  })),
});
export const ProductReadSchema = Schema.Struct({ ...Read.fields, deletedAfter: Schema.optionalKey(Schema.String) });
export const AfterSchema = Schema.Struct({ $gt: Schema.String });
export const ProductFindConfigSchema = Schema.Struct({
  select: Schema.optionalKey(Schema.Json), relations: Schema.optionalKey(Schema.Json), order: Schema.optionalKey(Schema.Json),
  skip: Schema.optionalKey(Schema.Number.check(Schema.isInt())), take: Schema.optionalKey(Schema.Number.check(Schema.isInt())),
  withDeleted: Schema.optionalKey(Schema.Boolean),
});
// Bulk creation keeps the original service's per-product required-field checks.
export const ProductCreateInputSchema = Schema.Union([
  Schema.Array(Schema.Json),
  Schema.StructWithRest(Schema.Struct({ title: Schema.String }), [Schema.Record(Schema.String, Schema.Json)]),
]);

/** Exact ordered build targets; install before any parser captures these ASTs. */
export const schemaAotTargets = [Read, ProductNamedFilters, ProductNamedReadSchema, ProductCategoryReadSchema, ProductCollectionReadSchema, VariantImageInputSchema, ParentFilters, ProductParentReadSchema, ProductVariantReadSchema, ProductReadSchema, AfterSchema, ProductFindConfigSchema, ProductCreateInputSchema] as const;
installSchemaAot(schemaAotTargets.map(schema => schema.ast));
