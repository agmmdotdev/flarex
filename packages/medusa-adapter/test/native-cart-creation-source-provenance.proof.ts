import { readFileSync } from "node:fs";
import { Effect, Schema } from "effect";
import { expect, inject, it } from "vitest";
import { createCartWorkflow, createCartWorkflowId } from "@medusajs/core-flows/cart/create-carts";
import { updateCartPromotionsWorkflow, updateCartPromotionsWorkflowId } from "@medusajs/core-flows/cart/update-cart-promotions";
import { updateCartPromotionsStep, updateCartPromotionsStepId } from "@medusajs/core-flows/cart/update-cart-promotions-step";
import { refreshPaymentCollectionForCartWorkflow, refreshPaymentCollectionForCartWorkflowId } from "@medusajs/core-flows/cart/refresh-payment-collection";
import { CartPromotion, CartShippingOption, ProductShippingProfile } from "@medusajs/link-modules";
import { FulfillmentModuleService } from "@medusajs/fulfillment/services";
import { fulfillmentModuleExports, fulfillmentModuleModels, fulfillmentStaticResources } from "@medusajs/fulfillment/static-manifest";
import { compileCartPromotionCreationLinkCoreDefinition, compileCartPromotionCreationLinkDefinition } from "../src/links/cart-promotion-creation-schema";
import { compileFulfillmentCreationCoreDefinition, compileFulfillmentCreationDefinition } from "../src/modules/fulfillment/shipping-profile-schema";
import { nativeCartCreationSourceTargets } from "./support/native-cart-creation-source-provenance";
import { NativeSourceEvidenceSchema } from "./support/native-stock-sales-source-provenance";

const decodeManifest = Schema.decodeUnknownSync(Schema.Struct({
  files: Schema.Array(Schema.Struct({ target: Schema.String, targetSha256: Schema.String })),
}));
const target = { scopeUuid: "24e6ff2f-9610-488a-9544-a524c1b92d8e", epochUuid: "4c86656f-a9d5-417c-a78c-bee23f8c1d1a" };
const active = { field: "deleted_at", value: null };

it("resolves the promoted Cart root, Fulfillment models and native Link preimage programs", () => {
  const evidence = Schema.decodeUnknownSync(NativeSourceEvidenceSchema)(inject("nativeCartCreationSource"));
  expect(evidence.entries).toHaveLength(nativeCartCreationSourceTargets.length);
  const manifest = new URL("../../../roadmaps/flarexdb-framework-integration/preflight/medusa-currency-promotion.json", import.meta.url);
  const { files } = decodeManifest(JSON.parse(readFileSync(manifest, "utf8")));
  for (const entry of evidence.entries) {
    for (const [target, targetSha256] of [[entry.entry, entry.entrySha256], [entry.leaf, entry.leafSha256]]) {
      expect(files.filter(file => file.target === target)).toEqual([{ target, targetSha256 }]);
    }
  }
  expect(fulfillmentModuleExports.service).toBe(FulfillmentModuleService);
  expect(fulfillmentStaticResources.models).toBe(fulfillmentModuleModels);
  expect(fulfillmentModuleModels).toHaveLength(12);
  expect(CartPromotion.databaseConfig).toMatchObject({ tableName: "cart_promotion", idPrefix: "cartpromo" });
  expect(CartShippingOption).toMatchObject({ isReadOnlyLink: true, extends: [{ serviceName: "cart", entity: "ShippingMethod",
    relationship: { serviceName: "fulfillment", primaryKey: "id", foreignKey: "shipping_option_id", alias: "shipping_option" } }] });
  expect(ProductShippingProfile.databaseConfig).toMatchObject({ tableName: "product_shipping_profile" });
  expect(createCartWorkflowId).toBe("create-cart");
  expect(updateCartPromotionsWorkflowId).toBe("update-cart-promotions");
  expect(updateCartPromotionsStepId).toBe("update-cart-promotions");
  expect(refreshPaymentCollectionForCartWorkflowId).toBe("refresh-payment-collection-for-cart");
  for (const declaration of [createCartWorkflow, updateCartPromotionsWorkflow, updateCartPromotionsStep,
    refreshPaymentCollectionForCartWorkflow]) expect(declaration).toBeTypeOf("function");
});

it("authenticates the complete Fulfillment source, native indexed keys and local references", async () => {
  const [native, compiled] = await Effect.runPromise(Effect.all([compileFulfillmentCreationCoreDefinition(target), compileFulfillmentCreationDefinition()]));
  const sourceKey = "medusa.shippingProfile";
  const localNames = ["fulfillment", "fulfillment_address", "fulfillment_item", "fulfillment_label", "fulfillment_provider", "fulfillment_set",
    "geo_zone", "service_zone", "shipping_option", "shipping_option_rule", "shipping_option_type", "shipping_profile"];
  expect(native.identity).toMatchObject({ ...target, sourceKey });
  expect(native.source).toMatchObject({ key: sourceKey, writeProfile: sourceKey, owner: "medusa",
    evidence: { provenance: compiled.provenance, profile: sourceKey } });
  expect(native.source.definition).toEqual({ kind: "relational", schema: compiled.schema });
  expect(native.applicationRead).toBe(false);
  expect(native.commands).toEqual([]);
  expect(native.source.bindings.toSorted((left, right) => left.localName.localeCompare(right.localName))).toEqual(localNames.map(localName => ({
    kind: "definition", localName, table: { namespace: "medusa", logicalName: `commerce.shipping-profile/${localName}` },
  })));
  expect(native.tables.map(table => table.localName).toSorted()).toEqual(localNames);
  const profile = native.tables.find(table => table.localName === "shipping_profile");
  const option = native.tables.find(table => table.localName === "shipping_option");
  const fulfillment = native.tables.find(table => table.localName === "fulfillment");
  const item = native.tables.find(table => table.localName === "fulfillment_item");
  if (profile === undefined || option === undefined || fulfillment === undefined || item === undefined)
    throw new Error("Missing authenticated Fulfillment table");
  expect(profile.rowKey?.fields).toEqual(["id"]);
  expect(profile.indexes).toContainEqual(expect.objectContaining({ nativeId: "shipping_profile.type-equality", fields: ["type"] }));
  expect(profile.uniqueConstraints).toContainEqual(expect.objectContaining({ fields: ["name"], eligibility: active }));
  const profileKey = option.foreignKeys?.find(key => key.descriptor === "shipping_option_shipping_profile_id_foreign");
  expect(profileKey).toMatchObject({ sourceTable: option.name, sourceFields: ["shipping_profile_id"], targetTable: profile.name,
    targetFields: ["id"], targetIndexName: profile.rowKey?.indexName, onDelete: "noAction", onUpdate: "noAction" });
  expect(option.indexes).toContainEqual(expect.objectContaining({ indexName: profileKey?.sourceIndexName, fields: ["shipping_profile_id"] }));
  expect(item.foreignKeys).toContainEqual(expect.objectContaining({ sourceTable: item.name, sourceFields: ["fulfillment_id"],
    targetTable: fulfillment.name, targetFields: ["id"], onDelete: "cascade" }));
});

it("authenticates the Cart Promotion pair and its independent operation and revision tables", async () => {
  const [native, compiled] = await Effect.runPromise(Effect.all([compileCartPromotionCreationLinkCoreDefinition(target),
    compileCartPromotionCreationLinkDefinition()]));
  const sourceKey = "medusa.cart-promotion-preimages";
  const localNames = ["cart_promotion", "link_pair_revision", "link_workflow_operation"];
  expect(native.identity).toMatchObject({ ...target, sourceKey });
  expect(native.source).toMatchObject({ key: sourceKey, writeProfile: sourceKey, owner: "medusa",
    evidence: { provenance: compiled.provenance, profile: sourceKey } });
  expect(native.source.definition).toEqual({ kind: "relational", schema: compiled.schema });
  expect(native.applicationRead).toBe(false);
  expect(native.commands).toEqual([]);
  expect(native.source.bindings.toSorted((left, right) => left.localName.localeCompare(right.localName))).toEqual(localNames.map(localName => ({
    kind: "definition", localName, table: { namespace: "medusa", logicalName: `commerce.link.cart-promotion-creation/${localName}` },
  })));
  expect(native.tables.map(table => table.localName).toSorted()).toEqual(localNames);
  const link = native.tables.find(table => table.localName === "cart_promotion");
  const revision = native.tables.find(table => table.localName === "link_pair_revision");
  const operation = native.tables.find(table => table.localName === "link_workflow_operation");
  if (link === undefined || revision === undefined || operation === undefined) throw new Error("Missing authenticated Link operation table");
  expect(link.rowKey?.fields).toEqual(["cart_id", "promotion_id"]);
  for (const field of ["cart_id", "promotion_id"]) {
    expect(link.indexes).toContainEqual(expect.objectContaining({ fields: ["deleted_at", field], requiredPrefix: active }));
  }
  expect(operation.indexes).toContainEqual(expect.objectContaining({ nativeId: "LinkWorkflowOperation_service_name_state_0",
    fields: ["deleted_at", "service_name", "state"], requiredPrefix: active }));
  for (const table of [revision, operation]) expect(table.rowKey?.fields).toEqual(["id"]);
  for (const table of [link, revision, operation]) expect(table.foreignKeys).toBeUndefined();
});
