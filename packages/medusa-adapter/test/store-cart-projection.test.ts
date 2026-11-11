import { Effect, Result } from "effect";
import { expect, it } from "vitest";
import { prepareListQuery } from "../../medusa-framework/src/http/utils/get-query-config";
import { retrieveTransformQueryConfig } from "../../medusa-http/src/api/store/carts/query-config";
import { compileStoreCartRequestFixtureCatalog } from "./support/store-cart-request-catalog";
import { prepareCartCreationModules } from "../src/workflows/cart/creation-graph";
import { workflowModuleDefinition } from "../src/workflow/module";
import { defineAtomicCommerceParticipant } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { prepareLocalGraph } from "../src/local-graph/query";
import { prepareCartMutationResources } from "../src/workflows/cart/mutations";
import { cartFieldsForRefreshSteps, cartFieldsForPricingContext, cartFieldsForCalculateShippingOptionsPrices,
  productVariantsFields } from "@medusajs/core-flows/cart/variant-pricing-fields";
import { requiredVariantFieldsForInventoryConfirmation } from "@medusajs/core-flows/cart/prepare-confirm-inventory-input";

it("admits the native HTTP defaults and complete Cart mutation projections through the genuine graph", async () => {
  const { catalog } = await Effect.runPromise(compileStoreCartRequestFixtureCatalog());
  const selected = await Effect.runPromise(prepareCartCreationModules(catalog.modules, catalog.runtimes.salesChannelRead));
  const resources = prepareCartMutationResources(selected.modules, selected.inventory, catalog.runtimes.link, catalog.runtimes.logger);
  expect(Result.isSuccess(resources), "Complete genuine Cart mutation resources").toBe(true);
  const graph = Result.getOrThrow(prepareLocalGraph(catalog.nativeSources.map(source => {
    const definition = workflowModuleDefinition(selected.modules[source.name].module);
    if (definition === undefined) throw new Error("Missing authenticated Cart module");
    return { participant: defineAtomicCommerceParticipant(source.name), module: definition.graph };
  })));
  const parsed = await prepareListQuery({}, retrieveTransformQueryConfig);
  for (const [profile, entity, fields] of [
    ["HTTP defaults", "cart", parsed.remoteQueryConfig.fields],
    ["native refresh", "cart", cartFieldsForRefreshSteps],
    ["native pricing context", "cart", cartFieldsForPricingContext],
    ["native Shipping Option pricing context", "cart", cartFieldsForCalculateShippingOptionsPrices],
    ["native variants and Inventory confirmation", "variants", [...productVariantsFields, ...requiredVariantFieldsForInventoryConfirmation, "calculated_price.*"]],
  ] as const) {
    const refused = fields.filter(field => Result.isFailure(graph.admitProjection(entity, ["id", field])));
    expect(refused, profile).toEqual([]);
    expect(Result.isSuccess(graph.admitProjection(entity, fields)), profile).toBe(true);
  }
});
