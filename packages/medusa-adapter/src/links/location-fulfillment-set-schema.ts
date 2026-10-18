import { Effect } from "effect";
import { LocationFulfillmentSet } from "@medusajs/link-modules";
import { normalizeRelationalSchema } from "flarex-protocol/internal/relational-schema";
import { captureLinkMetadata, linkSchemaOrigins, LinkSchemaError } from "./schema";
import { lowerDmlSchema } from "../schema/lower";

/** This named source selects the native scalar pair and accepted active
 * cardinality correction; endpoints carry no FK or existence requirement. */
export const captureLocationFulfillmentSetLinkMetadata = Effect.fn("LocationFulfillmentSetLink.captureMetadata")(function* () {
  const [primary, foreign] = LocationFulfillmentSet.relationships ?? [];
  if (primary?.serviceName !== "stock_location" || primary.foreignKey !== "stock_location_id"
    || primary.hasMany !== undefined || primary.deleteCascade !== undefined
    || foreign?.serviceName !== "fulfillment" || foreign.foreignKey !== "fulfillment_set_id"
    || foreign.hasMany !== true || foreign.deleteCascade !== true
    || LocationFulfillmentSet.databaseConfig?.tableName !== "location_fulfillment_set"
    || LocationFulfillmentSet.databaseConfig.idPrefix !== "locfs")
    return yield* Effect.fail(new LinkSchemaError({ cause: "Unsupported Location Fulfillment Set Link" }));
  return yield* captureLinkMetadata(LocationFulfillmentSet);
});

export const locationFulfillmentSetLinkProvenance = Object.freeze({
  kind: "sourceSnapshot", repository: "https://github.com/agmmdotdev/medusa-fork.git",
  revision: "48d5cc675e4e8bc821e22c20c88a751acc66fb5f",
  paths: Object.freeze(["packages/modules/link-modules/src/definitions/fulfillment-set-location.ts",
    "packages/modules/link-modules/src/utils/generate-entity.ts"]),
} as const);

export const compileLocationFulfillmentSetLinkDefinition = Effect.fn("LocationFulfillmentSetLink.compileDefinition")(function* () {
  const metadata = yield* captureLocationFulfillmentSetLinkMetadata();
  const schema = yield* Effect.fromResult(normalizeRelationalSchema(lowerDmlSchema(
    [metadata.frame], "commerce.link.location-fulfillment-set", linkSchemaOrigins,
  )));
  return Object.freeze({ schema, provenance: locationFulfillmentSetLinkProvenance });
});
