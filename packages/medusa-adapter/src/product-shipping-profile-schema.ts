import { Effect } from "effect";
import { captureRelationalSchemaArtifact } from "@flarex/persistence-postgres/internal/relational-schema-values";
import { captureRelationalPhysicalLayout, registerCommerceSchemaProfile, registerLocalCommerceProfile } from "@flarex/persistence-postgres/internal/commerce-profile";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { captureProductSchema, productSourceProvenance } from "./product-schema";
import { captureSalesChannelMetadata } from "./sales-channel-schema";
import { captureShippingProfileMetadata } from "./shipping-profile-schema";
import { captureProductSalesChannelLinkMetadata } from "./product-sales-channel-link-schema";
import { captureProductShippingProfileLinkMetadata } from "./product-shipping-profile-link-schema";
import { lowerDmlSchema } from "./schema/lower";
import { productShippingProfileResources } from "./product-shipping-profile-contract";

/** Fresh selected 17-table installation. Importing all Fulfillment models does
 * not grant its other tables, providers, hydration or deletion semantics. */
export const prepareProductShippingProfileSchema = Effect.fn("Commerce.prepareProductShippingProfileSchema")(function* (
  deploymentId: string, target: Omit<Parameters<typeof captureRelationalPhysicalLayout>[0], "artifact">,
) {
  const product = yield* captureProductSchema(deploymentId);
  const sales = yield* captureSalesChannelMetadata();
  const shipping = yield* captureShippingProfileMetadata();
  const salesLink = yield* captureProductSalesChannelLinkMetadata();
  const shippingLink = yield* captureProductShippingProfileLinkMetadata();
  const endpoints = lowerDmlSchema([...product.metadata.frame.tables, ...sales.frame.tables, ...shipping.frame.tables], "commerce.product-shipping-profile");
  const links = lowerDmlSchema([salesLink.frame, shippingLink.frame], endpoints.lineageId, {
    table: table => ({ kind: "authored", sourceId: "link." + table.name }),
    column: (table, column) => ({ kind: ["created_at", "updated_at", "deleted_at"].includes(column.name) ? "implicit" : "authored",
      sourceId: "link." + table.name + "." + column.name }),
    primaryKey: table => ({ kind: "authored", sourceId: "link." + table.name + ".endpoints" }),
    searchable: table => ({ kind: "authored", sourceId: "link." + table.name + ".searchable" }),
  });
  const tables = [...endpoints.tables, ...links.tables];
  if (tables.length !== 17 || new Set(tables.map(table => table.tableId)).size !== 17) return yield* Effect.fail(commerceError("unsupportedProfile"));
  const captured = yield* captureRelationalSchemaArtifact({ deploymentId,
    provenance: { ...productSourceProvenance, paths: [...productSourceProvenance.paths,
      "packages/modules/sales-channel/src/models", "packages/modules/fulfillment/src/models",
      "packages/modules/fulfillment/src/static-manifest.ts", "packages/modules/link-modules/src/definitions/product-sales-channel.ts",
      "packages/modules/link-modules/src/definitions/product-shipping-profile.ts", "packages/modules/link-modules/src/utils/generate-entity.ts"] },
    schema: { ...endpoints, tables, capabilities: [...endpoints.capabilities, ...links.capabilities] },
  });
  const layout = yield* captureRelationalPhysicalLayout({ ...target, artifact: captured.artifact });
  const profile = yield* registerCommerceSchemaProfile(captured.artifact, layout);
  return { ...captured, layout, profile };
});

export const prepareLocalShippingProfile = Effect.fn("ShippingProfile.prepareProfile")(function* (
  ...args: Parameters<typeof prepareProductShippingProfileSchema>
) {
  const prepared = yield* prepareProductShippingProfileSchema(...args);
  const key = prepared.layout.frame.tables.find(table => table.identity.tableId === "shipping_profile")?.keys.find(key => key.kind === "primary");
  if (key === undefined) return yield* Effect.fail(commerceError("unsupportedProfile"));
  const profile = yield* registerLocalCommerceProfile(prepared.artifact, prepared.layout, "medusa.shipping-profile.local",
    [{ tableId: "shipping_profile", keyId: key.identity.keyId }]);
  return { ...prepared, profile, initialization: { rows: undefined } };
});

/** One fresh schema selection, four distinct native module profiles. Existing
 * standalone profiles retain their default resources and canonical identities. */
export const prepareProductShippingProfile = Effect.fn("Commerce.prepareProductShippingProfile")(function* (
  ...args: Parameters<typeof prepareProductShippingProfileSchema>
) {
  const prepared = yield* prepareProductShippingProfileSchema(...args);
  const tables = prepared.layout.frame.tables;
  const grant = (tableId: string) => Effect.gen(function* () {
    const table = tables.find(table => table.identity.tableId === tableId);
    const key = table?.keys.find(key => key.kind === "primary") ?? table?.keys.find(key => key.kind === "unique");
    if (key === undefined) return yield* Effect.fail(commerceError("unsupportedProfile"));
    return { tableId, keyId: key.identity.keyId };
  });
  const productGrants = [];
  for (const table of tables) if (!["sales_channel", "shipping_profile", "product_sales_channel", "product_shipping_profile"].includes(table.identity.tableId)) {
    productGrants.push(yield* grant(table.identity.tableId));
  }
  const product = yield* registerLocalCommerceProfile(prepared.artifact, prepared.layout,
    "medusa.product.shipping-workflow", productGrants, productShippingProfileResources);
  const sales_channel = yield* registerLocalCommerceProfile(prepared.artifact, prepared.layout,
    "medusa.sales-channel.shipping-workflow", [yield* grant("sales_channel")], productShippingProfileResources);
  const fulfillment = yield* registerLocalCommerceProfile(prepared.artifact, prepared.layout,
    "medusa.shipping-profile.workflow", [yield* grant("shipping_profile")], productShippingProfileResources);
  const links = [];
  for (const tableId of ["product_sales_channel", "product_shipping_profile"]) links.push({
    ...yield* grant(tableId), update: "existingPrimaryKey" as const, remove: "declaredKey" as const,
    lifecycle: "managedSoftDelete" as const, upsert: "activeRow" as const, observeRows: true as const,
  });
  const link = yield* registerLocalCommerceProfile(prepared.artifact, prepared.layout,
    "medusa.product.links.shipping-workflow", links, productShippingProfileResources);
  return { ...prepared, profile: link, profiles: { product, sales_channel, fulfillment, link }, initialization: { rows: undefined } };
});
