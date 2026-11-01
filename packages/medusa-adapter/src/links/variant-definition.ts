import { Effect } from "effect";
import { captureLogicalSchemaSource } from "@flarex/analysis/internal/logical-schema-candidate";
import { makeCoreRelationalNativeDefinition } from "@flarex/persistence-postgres/internal/core";
import { normalizeRelationalSchema } from "flarex-protocol/internal/relational-schema";
import { captureVariantInventoryLinkMetadata, variantInventoryLinkProvenance } from "../composition/product-variant-inventory-schema";
import { captureVariantPricingLinkMetadata, variantPricingLinkSourceProvenance } from "../composition/product-variant-pricing-schema";
import { linkSchemaOrigins } from "./schema";
import { lowerDmlSchema } from "../schema/lower";

/** Both native Link families share the selected native router resource. */
export const compileVariantLinksDefinition = Effect.fn("VariantLinks.compileDefinition")(function* () {
  const inventory = yield* captureVariantInventoryLinkMetadata();
  const pricing = yield* captureVariantPricingLinkMetadata();
  const schema = yield* Effect.fromResult(normalizeRelationalSchema(lowerDmlSchema(
    [inventory.frame, pricing.frame], "commerce.link.variant-links", linkSchemaOrigins,
  )));
  return Object.freeze({ schema, provenance: Object.freeze({ ...variantInventoryLinkProvenance,
    paths: Object.freeze([...new Set([...variantInventoryLinkProvenance.paths, ...variantPricingLinkSourceProvenance.paths])]),
  }) });
});

/** Both native Link families feed one source in the shared native lifecycle. */
export const compileVariantLinksCoreDefinition = Effect.fn("VariantLinks.compileCoreDefinition")(function* (target: Readonly<{
  scopeUuid: string; epochUuid: string; applicationRead?: boolean;
}>) {
  const nativeTarget = Object.freeze({ scopeUuid: target.scopeUuid, epochUuid: target.epochUuid,
    applicationRead: target.applicationRead ?? false });
  const definition = yield* compileVariantLinksDefinition();
  const source = yield* captureLogicalSchemaSource({ key: "medusa.variantLinks", owner: "medusa", writeProfile: "medusa.variantLinks",
    evidence: { provenance: definition.provenance, profile: "medusa.variantLinks" },
    definition: { kind: "relational", schema: definition.schema },
    bindings: definition.schema.tables.map(table => ({ kind: "definition", localName: table.identity.tableId,
      table: { namespace: "medusa", logicalName: `${definition.schema.coordinate.lineageId}/${table.identity.tableId}` } })) });
  return yield* makeCoreRelationalNativeDefinition({ ...nativeTarget, source, provenance: definition.provenance, commands: [] });
});
