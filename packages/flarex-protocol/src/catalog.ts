import { Schema } from "effect";

export const MAX_CATALOG_TABLE_ID = 2_147_483_647;

export const CatalogTableIdSchema = Schema.Int.check(
  Schema.isBetween({ minimum: 1, maximum: MAX_CATALOG_TABLE_ID }),
).pipe(Schema.brand("FlarexDB/CatalogTableId"));
export type CatalogTableId = typeof CatalogTableIdSchema.Type;
export const decodeCatalogTableId = Schema.decodeUnknownSync(
  CatalogTableIdSchema,
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
