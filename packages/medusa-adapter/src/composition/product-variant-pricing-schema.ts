import { Effect } from "effect";
import { normalizeRelationalSchema } from "flarex-protocol/internal/relational-schema";
import { ProductVariantPriceSet } from "@medusajs/link-modules";
import { captureLogicalSchemaSource } from "@flarex/analysis/internal/logical-schema-candidate";
import { makeCoreRelationalNativeDefinition } from "@flarex/persistence-postgres/internal/core";
import { captureLinkMetadata, linkSchemaOrigins } from "../links/schema";
import { lowerDmlSchema } from "../schema/lower";

export const captureVariantPricingLinkMetadata = () => captureLinkMetadata(ProductVariantPriceSet);

export const variantPricingLinkSourceProvenance = Object.freeze({
  kind: "sourceSnapshot", repository: "https://github.com/agmmdotdev/medusa-fork.git",
  revision: "48d5cc675e4e8bc821e22c20c88a751acc66fb5f",
  paths: Object.freeze(["packages/modules/link-modules/src/definitions/product-variant-price-set.ts",
    "packages/modules/link-modules/src/utils/generate-entity.ts"]),
} as const);

/** Preserve the native rich Link record without generated module DDL. The
 * source intentionally has no endpoint FK: the pinned definition has none. */
export const compileVariantPricingLinkDefinition = Effect.fn("VariantPricingLink.compileDefinition")(function* () {
  const metadata = yield* captureVariantPricingLinkMetadata();
  const lowered = lowerDmlSchema([metadata.frame], "commerce.link.variant-pricing", linkSchemaOrigins);
  const schema = yield* Effect.fromResult(normalizeRelationalSchema({ ...lowered, tables: lowered.tables.map(table => ({
    ...table, indexes: [...table.indexes, { indexId: "product_variant_price_set.restore-by-price-set",
      kind: "btree" as const, columns: ["price_set_id"], predicate: null,
      origin: { kind: "derived" as const, sourceId: "link.product_variant_price_set.restore-by-price-set" } }],
  })) }));
  return Object.freeze({ schema, provenance: variantPricingLinkSourceProvenance });
});

/** The standalone native Link retains its authentic metadata and flat access. */
export const compileVariantPricingLinkCoreDefinition = Effect.fn("VariantPricingLink.compileCoreDefinition")(function* (
  target: Readonly<{ scopeUuid: string; epochUuid: string }>,
) {
  const native = yield* compileVariantPricingLinkDefinition();
  const source = yield* captureLogicalSchemaSource({ key: "medusa.variant-pricing-link", owner: "medusa",
    writeProfile: "medusa.variant-pricing-link", evidence: { provenance: native.provenance },
    definition: { kind: "relational", schema: native.schema },
    bindings: native.schema.tables.map(table => ({ kind: "definition", localName: table.identity.tableId,
      table: { namespace: "medusa", logicalName: `${native.schema.coordinate.lineageId}/${table.identity.tableId}` } })) });
  return yield* makeCoreRelationalNativeDefinition({ ...target, source, provenance: native.provenance, commands: [] });
});
