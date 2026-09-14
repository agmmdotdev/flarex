import { Effect } from "effect";
import { ProductVariantPriceSet } from "@medusajs/link-modules";
import { captureRelationalSchemaArtifact } from "@flarex/persistence-postgres/internal/relational-schema-values";
import { captureRelationalPhysicalLayout, registerCommerceSchemaProfile, registerLocalCommerceProfile } from "@flarex/persistence-postgres/internal/commerce-profile";
import { commerceError, defaultCommerceResources } from "@flarex/persistence-postgres/internal/commerce-values";
import { captureProductSchema, productSourceProvenance } from "./product-schema";
import { capturePricingMetadata } from "./pricing-schema";
import { captureLinkMetadata } from "./link-schema";
import { lowerDmlSchema } from "./schema/lower";

export const productVariantPricingResources = Object.freeze({ ...defaultCommerceResources, calls: 128 });
export const captureVariantPricingLinkMetadata = () => captureLinkMetadata(ProductVariantPriceSet);

/** Fresh FK-closed schema. PriceList is structural only; its service and writes
 * are excluded from all three module profiles. Cascade metadata is inert. */
export const prepareProductVariantPricing = Effect.fn("Commerce.prepareProductVariantPricing")(function* (
  deploymentId: string, target: Omit<Parameters<typeof captureRelationalPhysicalLayout>[0], "artifact">,
) {
  const product = yield* captureProductSchema(deploymentId);
  const pricing = yield* capturePricingMetadata();
  const link = yield* captureVariantPricingLinkMetadata();
  const endpoints = lowerDmlSchema([...product.metadata.frame.tables, ...pricing.frame.tables], "commerce.product-variant-pricing");
  const links = lowerDmlSchema([link.frame], endpoints.lineageId, {
    table: table => ({ kind: "authored", sourceId: "link." + table.name }),
    column: (table, column) => ({ kind: ["created_at", "updated_at", "deleted_at"].includes(column.name) ? "implicit" : "authored", sourceId: "link." + table.name + "." + column.name }),
    primaryKey: table => ({ kind: "authored", sourceId: "link." + table.name + ".endpoints" }),
    searchable: table => ({ kind: "authored", sourceId: "link." + table.name + ".searchable" }),
  });
  const tables = [...endpoints.tables, ...links.tables];
  if (tables.length !== 18 || new Set(tables.map(table => table.tableId)).size !== 18) return yield* Effect.fail(commerceError("unsupportedProfile"));
  const captured = yield* captureRelationalSchemaArtifact({ deploymentId,
    provenance: { ...productSourceProvenance, paths: [...productSourceProvenance.paths,
      "packages/modules/pricing/src/models", "packages/modules/pricing/src/static-manifest.ts", "packages/modules/link-modules/src/definitions/product-variant-price-set.ts", "packages/modules/link-modules/src/utils/generate-entity.ts"] },
    schema: { ...endpoints, tables, capabilities: [...endpoints.capabilities, ...links.capabilities] },
  });
  const layout = yield* captureRelationalPhysicalLayout({ ...target, artifact: captured.artifact });
  const schemaProfile = yield* registerCommerceSchemaProfile(captured.artifact, layout);
  const grant = (tableId: string) => Effect.gen(function* () {
    const table = layout.frame.tables.find(table => table.identity.tableId === tableId);
    const key = table?.keys.find(key => key.kind === "primary") ?? table?.keys.find(key => key.kind === "unique");
    if (!key) return yield* Effect.fail(commerceError("unsupportedProfile"));
    return { tableId, keyId: key.identity.keyId };
  });
  const productGrants = [];
  for (const table of product.metadata.frame.tables) productGrants.push(yield* grant(table.name));
  const pricingGrants = [];
  for (const table of ["price_set", "price", "price_rule"]) pricingGrants.push(yield* grant(table));
  const productProfile = yield* registerLocalCommerceProfile(captured.artifact, layout, "medusa.product.pricing-workflow", productGrants, productVariantPricingResources);
  const pricingProfile = yield* registerLocalCommerceProfile(captured.artifact, layout, "medusa.pricing.base-price-workflow", pricingGrants, productVariantPricingResources, ["price_list"]);
  const linkProfile = yield* registerLocalCommerceProfile(captured.artifact, layout, "medusa.variant-pricing.link-workflow", [{
    ...yield* grant("product_variant_price_set"), update: "existingPrimaryKey", remove: "declaredKey", lifecycle: "managedSoftDelete", upsert: "activeRow", observeRows: true,
  }], productVariantPricingResources);
  return { ...captured, layout, schemaProfile, profile: linkProfile, profiles: { product: productProfile, pricing: pricingProfile, link: linkProfile }, initialization: { rows: undefined } };
});
