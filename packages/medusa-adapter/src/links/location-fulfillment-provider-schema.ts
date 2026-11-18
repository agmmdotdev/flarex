import { Effect } from "effect";
import { LocationFulfillmentProvider } from "@medusajs/link-modules";
import { normalizeRelationalSchema } from "flarex-protocol/internal/relational-schema";
import { captureLogicalSchemaSource } from "@flarex/analysis/internal/logical-schema-candidate";
import { makeCoreRelationalNativeDefinition } from "@flarex/persistence-postgres/internal/core";
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

/** Complete native routing records feed Core without endpoint FK enforcement. */
export const compileLocationFulfillmentProviderLinkCoreDefinition = Effect.fn("LocationFulfillmentProviderLink.compileCoreDefinition")(function* (target: Readonly<{
  scopeUuid: string; epochUuid: string; applicationRead?: boolean;
}>) {
  const nativeTarget = Object.freeze({ scopeUuid: target.scopeUuid, epochUuid: target.epochUuid,
    applicationRead: target.applicationRead ?? false });
  const definition = yield* compileLocationFulfillmentProviderLinkDefinition();
  const source = yield* captureLogicalSchemaSource({ key: "medusa.link.locationFulfillmentProvider", owner: "medusa", writeProfile: "medusa.link.locationFulfillmentProvider",
    evidence: { provenance: definition.provenance, profile: "medusa.link.locationFulfillmentProvider" },
    definition: { kind: "relational", schema: definition.schema },
    bindings: definition.schema.tables.map(table => ({ kind: "definition", localName: table.identity.tableId,
      table: { namespace: "medusa", logicalName: `${definition.schema.coordinate.lineageId}/${table.identity.tableId}` } })) });
  return yield* makeCoreRelationalNativeDefinition({ ...nativeTarget, source, provenance: definition.provenance, commands: [] });
});
