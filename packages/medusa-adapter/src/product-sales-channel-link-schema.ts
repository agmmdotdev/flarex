import { Effect } from "effect";
import { ProductSalesChannel } from "@medusajs/link-modules";
import { captureLinkMetadata, LinkSchemaError } from "./link-schema";
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
