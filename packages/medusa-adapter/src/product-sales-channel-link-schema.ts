import { Effect } from "effect";
import { ProductSalesChannel } from "@medusajs/link-modules";
import { captureLinkMetadata, linkSchemaOrigins, LinkSchemaError } from "./link-schema";
import { normalizeRelationalSchema } from "flarex-protocol/internal/relational-schema";
import { lowerDmlSchema } from "./schema/lower";
export { LinkSchemaError } from "./link-schema";

/** Named admission stays with this binding; shared capture does not activate Links. */
export const captureProductSalesChannelLinkMetadata = Effect.fn("ProductSalesChannelLink.captureMetadata")(function* () {
  const [primary, foreign] = ProductSalesChannel.relationships ?? [];
  if (primary?.serviceName !== "product" || primary.foreignKey !== "product_id"
    || foreign?.serviceName !== "sales_channel" || foreign.foreignKey !== "sales_channel_id"
    || !primary.hasMany || !foreign.hasMany || ProductSalesChannel.databaseConfig?.tableName !== "product_sales_channel"
    || ProductSalesChannel.databaseConfig.idPrefix !== "prodsc") {
    return yield* Effect.fail(new LinkSchemaError({ cause: "Unsupported stored Link definition" }));
  }
  return yield* captureLinkMetadata(ProductSalesChannel);
});

export const productSalesChannelLinkSourceProvenance = Object.freeze({
  kind: "sourceSnapshot", repository: "https://github.com/agmmdotdev/medusa-fork.git",
  revision: "48d5cc675e4e8bc821e22c20c88a751acc66fb5f",
  paths: Object.freeze(["packages/modules/link-modules/src/definitions/product-sales-channel.ts",
    "packages/modules/link-modules/src/utils/generate-entity.ts"]),
} as const);

/** Preserve the pinned stored Link without a generated table or invented endpoint FK. */
export const compileProductSalesChannelLinkDefinition = Effect.fn("ProductSalesChannelLink.compileDefinition")(function* () {
  const metadata = yield* captureProductSalesChannelLinkMetadata();
  const lowered = lowerDmlSchema([metadata.frame], "commerce.link.product-sales-channel", linkSchemaOrigins);
  const schema = yield* Effect.fromResult(normalizeRelationalSchema({ ...lowered, tables: lowered.tables.map(table => ({
    ...table, indexes: [...table.indexes, { indexId: "product_sales_channel.restore-by-sales-channel",
      kind: "btree" as const, columns: ["sales_channel_id"], predicate: null,
      origin: { kind: "derived" as const, sourceId: "link.product_sales_channel.restore-by-sales-channel" } }],
  })) }));
  return Object.freeze({ schema, provenance: productSalesChannelLinkSourceProvenance });
});
