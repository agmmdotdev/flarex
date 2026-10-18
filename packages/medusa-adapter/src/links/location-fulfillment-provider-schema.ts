import { Effect } from "effect";
import { LocationFulfillmentProvider } from "@medusajs/link-modules";
import { normalizeRelationalSchema } from "flarex-protocol/internal/relational-schema";
import { captureLinkMetadata, linkSchemaOrigins, LinkSchemaError } from "./schema";
import { lowerDmlSchema } from "../schema/lower";

/** Native many-to-many availability records retain their complete routing
 * metadata. Neither endpoint is a database FK or a deletion cascade. */
export const captureLocationFulfillmentProviderLinkMetadata = Effect.fn("LocationFulfillmentProviderLink.captureMetadata")(function* () {
  const [primary, foreign] = LocationFulfillmentProvider.relationships ?? [];
  if (primary?.serviceName !== "stock_location" || primary.entity !== "StockLocation" || primary.foreignKey !== "stock_location_id"
    || primary.hasMany !== true || primary.deleteCascade !== undefined
    || foreign?.serviceName !== "fulfillment" || foreign.entity !== "FulfillmentProvider" || foreign.foreignKey !== "fulfillment_provider_id"
    || foreign.hasMany !== true || foreign.deleteCascade !== undefined
    || LocationFulfillmentProvider.databaseConfig?.tableName !== "location_fulfillment_provider"
    || LocationFulfillmentProvider.databaseConfig.idPrefix !== "locfp")
    return yield* Effect.fail(new LinkSchemaError({ cause: "Unsupported Location Fulfillment Provider Link" }));
  return yield* captureLinkMetadata(LocationFulfillmentProvider);
});
export const locationFulfillmentProviderLinkProvenance = Object.freeze({
  kind: "sourceSnapshot", repository: "https://github.com/agmmdotdev/medusa-fork.git",
  revision: "48d5cc675e4e8bc821e22c20c88a751acc66fb5f",
  paths: Object.freeze(["packages/modules/link-modules/src/definitions/fulfillment-provider-location.ts",
    "packages/modules/link-modules/src/utils/generate-entity.ts"]),
} as const);
export const compileLocationFulfillmentProviderLinkDefinition = Effect.fn("LocationFulfillmentProviderLink.compileDefinition")(function* () {
  const metadata = yield* captureLocationFulfillmentProviderLinkMetadata();
  const schema = yield* Effect.fromResult(normalizeRelationalSchema(lowerDmlSchema(
    [metadata.frame], "commerce.link.location-fulfillment-provider", linkSchemaOrigins,
  )));
  return Object.freeze({ schema, provenance: locationFulfillmentProviderLinkProvenance });
});
