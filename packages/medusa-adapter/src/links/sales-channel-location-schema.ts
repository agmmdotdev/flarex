import { Effect } from "effect";
import { SalesChannelLocation } from "@medusajs/link-modules";
import { normalizeRelationalSchema } from "flarex-protocol/internal/relational-schema";
import { captureLinkMetadata, linkSchemaOrigins, LinkSchemaError } from "./schema";
import { lowerDmlSchema } from "../schema/lower";

/** The named native many-to-many source; capturing other Links never admits it. */
export const captureSalesChannelLocationLinkMetadata = Effect.fn("SalesChannelLocationLink.captureMetadata")(function* () {
  const [primary, foreign] = SalesChannelLocation.relationships ?? [];
  if (primary?.serviceName !== "sales_channel" || primary.foreignKey !== "sales_channel_id"
    || foreign?.serviceName !== "stock_location" || foreign.foreignKey !== "stock_location_id"
    || primary.hasMany !== true || foreign.hasMany !== true
    || SalesChannelLocation.databaseConfig?.tableName !== "sales_channel_stock_location"
    || SalesChannelLocation.databaseConfig.idPrefix !== "scloc")
    return yield* Effect.fail(new LinkSchemaError({ cause: "Unsupported Sales Channel Location Link" }));
  return yield* captureLinkMetadata(SalesChannelLocation);
});

export const salesChannelLocationLinkProvenance = Object.freeze({
  kind: "sourceSnapshot", repository: "https://github.com/agmmdotdev/medusa-fork.git",
  revision: "48d5cc675e4e8bc821e22c20c88a751acc66fb5f",
  paths: Object.freeze(["packages/modules/link-modules/src/definitions/sales-channel-location.ts",
    "packages/modules/link-modules/src/utils/generate-entity.ts"]),
} as const);

export const compileSalesChannelLocationLinkDefinition = Effect.fn("SalesChannelLocationLink.compileDefinition")(function* () {
  const metadata = yield* captureSalesChannelLocationLinkMetadata();
  const schema = yield* Effect.fromResult(normalizeRelationalSchema(lowerDmlSchema(
    [metadata.frame], "commerce.link.sales-channel-location", linkSchemaOrigins,
  )));
  return Object.freeze({ schema, provenance: salesChannelLocationLinkProvenance });
});
