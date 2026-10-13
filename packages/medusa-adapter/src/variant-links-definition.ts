import { Effect } from "effect";
import { normalizeRelationalSchema } from "flarex-protocol/internal/relational-schema";
import { captureVariantInventoryLinkMetadata, variantInventoryLinkProvenance } from "./product-variant-inventory-schema";
import { captureVariantPricingLinkMetadata, variantPricingLinkSourceProvenance } from "./product-variant-pricing-schema";
import { linkSchemaOrigins } from "./link-schema";
import { lowerDmlSchema } from "./schema/lower";

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
