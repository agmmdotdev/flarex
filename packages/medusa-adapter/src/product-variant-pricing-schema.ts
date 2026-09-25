import { Effect } from "effect";
import { normalizeRelationalSchema } from "flarex-protocol/internal/relational-schema";
import { ProductVariantPriceSet } from "@medusajs/link-modules";
import { defaultCommerceResources } from "@flarex/persistence-postgres/internal/commerce-values";
import { captureLinkMetadata, linkSchemaOrigins } from "./link-schema";
import { lowerDmlSchema } from "./schema/lower";

export const productVariantPricingResources = Object.freeze({ ...defaultCommerceResources, calls: 128 });
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
