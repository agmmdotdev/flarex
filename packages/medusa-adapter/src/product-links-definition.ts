import { Effect } from "effect";
import { normalizeRelationalSchema } from "flarex-protocol/internal/relational-schema";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { captureProductSalesChannelLinkMetadata } from "./product-sales-channel-link-schema";
import { captureProductShippingProfileLinkMetadata } from "./product-shipping-profile-link-schema";
import { linkSchemaOrigins } from "./link-schema";
import { lowerDmlSchema } from "./schema/lower";

export const productLinksSourceProvenance = Object.freeze({
  kind: "sourceSnapshot", repository: "https://github.com/agmmdotdev/medusa-fork.git",
  revision: "48d5cc675e4e8bc821e22c20c88a751acc66fb5f",
  paths: Object.freeze(["packages/modules/link-modules/src/definitions/product-sales-channel.ts",
    "packages/modules/link-modules/src/definitions/product-shipping-profile.ts",
    "packages/modules/link-modules/src/utils/generate-entity.ts"]),
} as const);

/** One admitted source for the native router's selected stored Link tables. */
export const compileProductLinksDefinition = Effect.fn("ProductLinks.compileDefinition")(function* (selection: {
  readonly salesChannel: boolean; readonly shippingProfile: boolean;
}) {
  if (!selection.salesChannel && !selection.shippingProfile) return yield* Effect.fail(commerceError("unsupportedProfile"));
  const tables = [];
  if (selection.salesChannel) tables.push((yield* captureProductSalesChannelLinkMetadata()).frame);
  if (selection.shippingProfile) tables.push((yield* captureProductShippingProfileLinkMetadata()).frame);
  const lowered = lowerDmlSchema(tables, "commerce.link.product-links", linkSchemaOrigins);
  const schema = yield* Effect.fromResult(normalizeRelationalSchema({ ...lowered, tables: lowered.tables.map(table => ({
    ...table,
    indexes: table.tableId === "product_sales_channel" ? [...table.indexes, {
      indexId: "product_sales_channel.restore-by-sales-channel", kind: "btree" as const,
      columns: ["sales_channel_id"], predicate: null,
      origin: { kind: "derived" as const, sourceId: "link.product_sales_channel.restore-by-sales-channel" },
    }] : table.tableId === "product_shipping_profile" ? [...table.indexes, {
      indexId: "product_shipping_profile.restore-by-shipping-profile", kind: "btree" as const,
      columns: ["shipping_profile_id"], predicate: null,
      origin: { kind: "derived" as const, sourceId: "link.product_shipping_profile.restore-by-shipping-profile" },
    }] : table.indexes,
  })) }));
  return Object.freeze({ schema, provenance: productLinksSourceProvenance });
});
