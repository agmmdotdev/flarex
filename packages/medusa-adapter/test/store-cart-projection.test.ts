import { Effect, Result } from "effect";
import { expect, it } from "vitest";
import { prepareListQuery } from "../../medusa-framework/src/http/utils/get-query-config";
import { retrieveTransformQueryConfig } from "../../medusa-http/src/api/store/carts/query-config";
import { compileStoreCartRequestFixtureCatalog } from "./support/store-cart-request-catalog";
import { prepareCartCreationModules } from "../src/workflows/cart/creation-graph";
import { prepareCartShippingModules } from "../src/workflows/cart/shipping-graph";
import { workflowModuleDefinition } from "../src/workflow/module";
import { defineAtomicCommerceParticipant } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { prepareLocalGraph } from "../src/local-graph/query";
import { prepareCartShippingMutationResources } from "../src/workflows/cart/mutations";
import { cartFieldsForRefreshSteps, cartFieldsForPricingContext, cartFieldsForCalculateShippingOptionsPrices,
  productVariantsFields } from "@medusajs/core-flows/cart/variant-pricing-fields";
import { requiredVariantFieldsForInventoryConfirmation } from "@medusajs/core-flows/cart/prepare-confirm-inventory-input";

it("admits the native HTTP defaults and complete Cart mutation projections through the genuine graph", async () => {
  const { catalog } = await Effect.runPromise(compileStoreCartRequestFixtureCatalog());
  const selected = await Effect.runPromise(prepareCartCreationModules(catalog.modules, catalog.runtimes.salesChannelRead));
  const modules = Result.getOrThrow(prepareCartShippingModules(selected.modules, catalog.shippingLinks));
  const resources = prepareCartShippingMutationResources(modules, selected.inventory, catalog.runtimes.link, catalog.runtimes.logger, modules);
  expect(Result.isSuccess(resources), "Complete genuine Cart mutation resources").toBe(true);
  const graph = Result.getOrThrow(prepareLocalGraph(catalog.nativeSources.map(source => {
    const definition = workflowModuleDefinition(modules[source.name].module);
    if (definition === undefined) throw new Error("Missing authenticated Cart module");
    return { participant: defineAtomicCommerceParticipant(source.name), module: definition.graph };
  })));
  const parsed = await prepareListQuery({}, retrieveTransformQueryConfig);
  for (const [profile, entity, fields] of [
    ["HTTP defaults", "cart", parsed.remoteQueryConfig.fields],
    ["native refresh", "cart", cartFieldsForRefreshSteps],
    ["native pricing context", "cart", cartFieldsForPricingContext],
    ["native Shipping listing Cart Inventory", "cart", [...cartFieldsForPricingContext, "items.*", "items.variant.manage_inventory",
      "items.variant.inventory_items.inventory_item_id", "items.variant.inventory_items.inventory.requires_shipping",
      "items.variant.inventory_items.inventory.location_levels.*"]],
    ["native Shipping Option pricing context", "cart", cartFieldsForCalculateShippingOptionsPrices],
    ["native variants and Inventory confirmation", "variants", [...productVariantsFields, ...requiredVariantFieldsForInventoryConfirmation, "calculated_price.*"]],
    ["native channel Fulfillment availability", "sales_channels", ["stock_locations.id", "stock_locations.name", "stock_locations.address.*", "stock_locations.fulfillment_sets.id"]],
    ["native Shipping Option price and location aliases", "shipping_options", ["id", "name", "price_type", "provider.id", "provider.is_enabled", "rules.*", "type.*",
      "service_zone.fulfillment_set_id", "service_zone.fulfillment_set.type", "service_zone.fulfillment_set.location.id", "service_zone.fulfillment_set.location.address.*",
      "calculated_price.*", "prices.*", "prices.price_rules.*"]],
  ] as const) {
    const refused = fields.filter(field => Result.isFailure(graph.admitProjection(entity, ["id", field])));
    expect(refused, profile).toEqual([]);
    expect(Result.isSuccess(graph.admitProjection(entity, fields)), profile).toBe(true);
  }
  expect(Result.isFailure(graph.admitProjection("shipping_options", ["price_set_link.price_set.id"]))).toBe(true);
});
