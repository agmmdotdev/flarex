import { install as installSchemaAot } from "./value-schemas.schema-aot.generated.mjs";
import { Schema } from "effect";

export const ProductRelationshipId = Schema.String.check(Schema.isBetweenLength(1, 256));
export const ProductRelationshipIds = Schema.Array(ProductRelationshipId).check(Schema.isMaxLength(256));
export const ProductRelationshipReferences = Schema.Array(Schema.Struct({ id: ProductRelationshipId })).check(Schema.isMaxLength(256));
export const ProductRelationshipUpsertRows = Schema.Array(Schema.Struct({
  id: ProductRelationshipId, category_ids: ProductRelationshipIds,
})).check(Schema.isMaxLength(256));
export const GraphArraySchema = Schema.Array(Schema.Json);
export const ProductProjectionSchema = Schema.Union([
  Schema.JsonObject, Schema.Array(Schema.JsonObject),
]);
export const ProductCountSchema = Schema.Struct({
  rows: Schema.Array(Schema.JsonObject), count: Schema.Number,
});
export const ObjectSchema = Schema.JsonObject;
export const UpdatePairsSchema = Schema.Array(Schema.Struct({ entity: Schema.JsonObject, update: Schema.JsonObject })).check(Schema.isMaxLength(256));
export const RelatedUpdateSchema = Schema.Struct({
  id: Schema.String.check(Schema.isBetweenLength(1, 256)), data: Schema.JsonObject,
});
export const IdSchema = Schema.UndefinedOr(Schema.String.check(Schema.isBetweenLength(1, 256)));
export const OptionValuesSchema = Schema.Array(Schema.String);
export const VariantOptionsSchema = Schema.Record(Schema.String, Schema.String);
export const VariantReferenceSchema = Schema.StructWithRest(
  Schema.Struct({ id: Schema.String }), [Schema.Record(Schema.String, Schema.Json)],
);

/** Exact ordered build targets; install before any parser captures these ASTs. */
export const schemaAotTargets = [ProductRelationshipId, ProductRelationshipIds, ProductRelationshipReferences, ProductRelationshipUpsertRows, GraphArraySchema, ProductProjectionSchema, ProductCountSchema, ObjectSchema, UpdatePairsSchema, RelatedUpdateSchema, IdSchema, OptionValuesSchema, VariantOptionsSchema, VariantReferenceSchema] as const;
installSchemaAot(schemaAotTargets.map(schema => schema.ast));
