import { Schema } from "effect";

export const MAX_CATALOG_TABLE_ID = 2_147_483_647;
export const MAX_CATALOG_INDEX_ID = 2_147_483_647;

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
