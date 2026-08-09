import { Schema } from "effect";

export const MAX_CATALOG_TABLE_ID = 2_147_483_647;
export const MAX_CATALOG_INDEX_ID = 2_147_483_647;
export const MAX_CATALOG_INDEX_DEFINITION_ID = 2_147_483_647;
export const MAX_CATALOG_UNIQUE_CONSTRAINT_ID = 2_147_483_647;
export const MAX_CATALOG_UNIQUE_CONSTRAINT_DEFINITION_ID = 2_147_483_647;

export const CatalogTableIdSchema = Schema.Int.check(
  Schema.isBetween({ minimum: 1, maximum: MAX_CATALOG_TABLE_ID }),
).pipe(Schema.brand("FlarexDB/CatalogTableId"));
export type CatalogTableId = typeof CatalogTableIdSchema.Type;
export const decodeCatalogTableId = Schema.decodeUnknownSync(
  CatalogTableIdSchema,
);

/**
 * Stable deployment-scoped identity for one logical index access path.
 *
 * This is deliberately not the identity of a physical index definition or
 * build. A changed ordered-field or codec specification must receive a
 * separate immutable definition identity so the old enabled build and its
 * replacement can coexist.
 */
export const CatalogIndexIdSchema = Schema.Int.check(
  Schema.isBetween({ minimum: 1, maximum: MAX_CATALOG_INDEX_ID }),
).pipe(Schema.brand("FlarexDB/CatalogIndexId"));
export type CatalogIndexId = typeof CatalogIndexIdSchema.Type;
export const decodeCatalogIndexId = Schema.decodeUnknownSync(
  CatalogIndexIdSchema,
);

/**
 * Deployment-scoped identity for one immutable physical index specification.
 *
 * This identity is deliberately distinct from the stable logical index ID. A
 * changed field lowering, collation, or ordered-key codec must receive another
 * physical definition ID while the prior definition remains addressable.
 */
export const CatalogIndexDefinitionIdSchema = Schema.Int.check(
  Schema.isBetween({
    minimum: 1,
    maximum: MAX_CATALOG_INDEX_DEFINITION_ID,
  }),
).pipe(Schema.brand("FlarexDB/CatalogIndexDefinitionId"));
export type CatalogIndexDefinitionId =
  typeof CatalogIndexDefinitionIdSchema.Type;
export const decodeCatalogIndexDefinitionId = Schema.decodeUnknownSync(
  CatalogIndexDefinitionIdSchema,
);

/** Stable deployment-scoped identity for one logical unique constraint. */
export const CatalogUniqueConstraintIdSchema = Schema.Int.check(
  Schema.isBetween({
    minimum: 1,
    maximum: MAX_CATALOG_UNIQUE_CONSTRAINT_ID,
  }),
).pipe(Schema.brand("FlarexDB/CatalogUniqueConstraintId"));
export type CatalogUniqueConstraintId =
  typeof CatalogUniqueConstraintIdSchema.Type;
export const decodeCatalogUniqueConstraintId = Schema.decodeUnknownSync(
  CatalogUniqueConstraintIdSchema,
);

/**
 * Deployment-scoped identity for one immutable unique-key specification.
 *
 * A logical constraint keeps its stable ID when a later schema version changes
 * its ordered fields or sparse policy. Each such physical generation receives
 * a distinct definition ID so claims can remain tied to exact semantics.
 */
export const CatalogUniqueConstraintDefinitionIdSchema = Schema.Int.check(
  Schema.isBetween({
    minimum: 1,
    maximum: MAX_CATALOG_UNIQUE_CONSTRAINT_DEFINITION_ID,
  }),
).pipe(Schema.brand("FlarexDB/CatalogUniqueConstraintDefinitionId"));
export type CatalogUniqueConstraintDefinitionId =
  typeof CatalogUniqueConstraintDefinitionIdSchema.Type;
export const decodeCatalogUniqueConstraintDefinitionId =
  Schema.decodeUnknownSync(CatalogUniqueConstraintDefinitionIdSchema);

export const CatalogTableNamespaceSchema = Schema.Union([
  Schema.Literal("app"),
  Schema.Literal("payload"),
  Schema.Literal("medusa"),
  Schema.Literal("system"),
]);
export type CatalogTableNamespace =
  typeof CatalogTableNamespaceSchema.Type;
export const decodeCatalogTableNamespace = Schema.decodeUnknownSync(
  CatalogTableNamespaceSchema,
);
