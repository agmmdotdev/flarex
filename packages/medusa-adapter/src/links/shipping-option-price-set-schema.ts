import { Effect } from "effect";
import { ShippingOptionPriceSet } from "@medusajs/link-modules";
import { normalizeRelationalSchema } from "flarex-protocol/internal/relational-schema";
import { captureLogicalSchemaSource } from "@flarex/analysis/internal/logical-schema-candidate";
import { makeCoreRelationalNativeDefinition } from "@flarex/persistence-postgres/internal/core";
import { captureLinkMetadata, linkSchemaOrigins, LinkSchemaError } from "./schema";
import { lowerDmlSchema } from "../schema/lower";

/** The native one-to-one pair and Pricing cascade remain native Link policy;
 * there is no physical FK or adapter-owned price cleanup. */
export const captureShippingOptionPriceSetLinkMetadata = Effect.fn("ShippingOptionPriceSetLink.captureMetadata")(function* () {
  const [primary, foreign] = ShippingOptionPriceSet.relationships ?? [];
  if (primary?.serviceName !== "fulfillment" || primary.entity !== "ShippingOption" || primary.foreignKey !== "shipping_option_id"
    || primary.hasMany !== undefined || primary.deleteCascade !== undefined
    || foreign?.serviceName !== "pricing" || foreign.entity !== "PriceSet" || foreign.foreignKey !== "price_set_id"
    || foreign.hasMany !== undefined || foreign.deleteCascade !== true
    || ShippingOptionPriceSet.databaseConfig?.tableName !== "shipping_option_price_set"
    || ShippingOptionPriceSet.databaseConfig.idPrefix !== "sops")
    return yield* Effect.fail(new LinkSchemaError({ cause: "Unsupported Shipping Option Price Set Link" }));
  return yield* captureLinkMetadata(ShippingOptionPriceSet);
});
export const shippingOptionPriceSetLinkProvenance = Object.freeze({
  kind: "sourceSnapshot", repository: "https://github.com/agmmdotdev/medusa-fork.git",
  revision: "48d5cc675e4e8bc821e22c20c88a751acc66fb5f",
  paths: Object.freeze(["packages/modules/link-modules/src/definitions/shipping-option-price-set.ts",
    "packages/modules/link-modules/src/utils/generate-entity.ts"]),
} as const);
export const compileShippingOptionPriceSetLinkDefinition = Effect.fn("ShippingOptionPriceSetLink.compileDefinition")(function* () {
  const metadata = yield* captureShippingOptionPriceSetLinkMetadata();
  const schema = yield* Effect.fromResult(normalizeRelationalSchema(lowerDmlSchema(
    [metadata.frame], "commerce.link.shipping-option-price-set", linkSchemaOrigins,
  )));
  return Object.freeze({ schema, provenance: shippingOptionPriceSetLinkProvenance });
});

/** Preserve native one-to-one/cascade metadata at the logical Core source seam. */
export const compileShippingOptionPriceSetLinkCoreDefinition = Effect.fn("ShippingOptionPriceSetLink.compileCoreDefinition")(function* (target: Readonly<{
  scopeUuid: string; epochUuid: string; applicationRead?: boolean;
}>) {
  const nativeTarget = Object.freeze({ scopeUuid: target.scopeUuid, epochUuid: target.epochUuid,
    applicationRead: target.applicationRead ?? false });
  const definition = yield* compileShippingOptionPriceSetLinkDefinition();
  const source = yield* captureLogicalSchemaSource({ key: "medusa.link.shippingOptionPriceSet", owner: "medusa", writeProfile: "medusa.link.shippingOptionPriceSet",
    evidence: { provenance: definition.provenance, profile: "medusa.link.shippingOptionPriceSet" },
    definition: { kind: "relational", schema: definition.schema },
    bindings: definition.schema.tables.map(table => ({ kind: "definition", localName: table.identity.tableId,
      table: { namespace: "medusa", logicalName: `${definition.schema.coordinate.lineageId}/${table.identity.tableId}` } })) });
  return yield* makeCoreRelationalNativeDefinition({ ...nativeTarget, source, provenance: definition.provenance, commands: [] });
});
