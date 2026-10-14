import { Effect } from "effect";
import { ProductVariantInventoryItem } from "@medusajs/link-modules";
import { normalizeRelationalSchema } from "flarex-protocol/internal/relational-schema";
import { captureLinkMetadata, linkSchemaOrigins } from "../links/schema";
import { lowerDmlSchema } from "../schema/lower";

export const captureVariantInventoryLinkMetadata = () => captureLinkMetadata(ProductVariantInventoryItem);
export const variantInventoryLinkProvenance = Object.freeze({ kind: "sourceSnapshot",
  repository: "https://github.com/agmmdotdev/medusa-fork.git", revision: "48d5cc675e4e8bc821e22c20c88a751acc66fb5f",
  paths: Object.freeze(["packages/modules/link-modules/src/definitions/product-variant-inventory-item.ts", "packages/modules/link-modules/src/utils/generate-entity.ts"]),
} as const);
export const compileVariantInventoryLinkDefinition = Effect.fn("VariantInventoryLink.compileDefinition")(function* () {
  const metadata = yield* captureVariantInventoryLinkMetadata();
  const schema = yield* Effect.fromResult(normalizeRelationalSchema(lowerDmlSchema([metadata.frame], "commerce.link.variant-inventory", linkSchemaOrigins)));
  return Object.freeze({ schema, provenance: variantInventoryLinkProvenance });
});
