import { Effect, Result } from "effect";
import { LocationFulfillmentSet, ShippingOptionPriceSet, SalesChannelLocation } from "@medusajs/link-modules";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { nativeLinkGraphPaths } from "../../local-graph/links";
import type { GraphDirectPath } from "../../local-graph/direct-paths";
import { captureLocationFulfillmentSetLinkMetadata, compileLocationFulfillmentSetLinkCoreDefinition } from "../../links/location-fulfillment-set-schema";
import { captureShippingOptionPriceSetLinkMetadata, compileShippingOptionPriceSetLinkCoreDefinition } from "../../links/shipping-option-price-set-schema";
import { prepareShippingOptionLinkService } from "../../links/shipping-option-link-service";
import { captureInstalledWorkflowModules, type InstalledWorkflowModule } from "../../workflow/host";
import { defineWorkflowModule, workflowModuleDefinition } from "../../workflow/module";
import { cartCreationModuleNames, type CartCreationModules } from "./creation-graph";
import { cartCreationCoreDefinitions } from "./creation-runtimes";

export const cartShippingLinkNames = ["location_fulfillment_set_links", "shipping_option_price_set_links"] as const;
export const cartShippingModuleNames = [...cartCreationModuleNames, ...cartShippingLinkNames] as const;
export type CartShippingLinks = Readonly<Record<typeof cartShippingLinkNames[number], InstalledWorkflowModule>>;
export const cartShippingCoreDefinitions = Effect.fn("CartShipping.compileDefinitions")(function* (target: Readonly<{ scopeUuid: string; epochUuid: string }>) {
  return { ...yield* cartCreationCoreDefinitions(target), location_fulfillment_set_links: yield* compileLocationFulfillmentSetLinkCoreDefinition(target),
    shipping_option_price_set_links: yield* compileShippingOptionPriceSetLinkCoreDefinition(target) };
});
export const makeCartShippingLinkRuntimes = Effect.fn("CartShipping.makeLinkRuntimes")(function* () {
  return { location_fulfillment_set_links: (yield* prepareShippingOptionLinkService(yield* captureLocationFulfillmentSetLinkMetadata(),
    { name: "location_fulfillment_set_links", prefix: "cartShippingLocationFulfillmentSetLink" })).workflow,
  shipping_option_price_set_links: (yield* prepareShippingOptionLinkService(yield* captureShippingOptionPriceSetLinkMetadata(),
    { name: "shipping_option_price_set_links", prefix: "cartShippingOptionPriceSetLink" })).workflow };
});

/** Existing Cart roots keep their eighteen-source graph. The HTTP Shipping
 * profile adds the two genuine stored Link owners and their native aliases. */
export function prepareCartShippingModules(modules: CartCreationModules, input: CartShippingLinks) {
  return Result.gen(function* () {
    const links = yield* captureInstalledWorkflowModules(input, cartShippingLinkNames);
    for (const [name, native] of [["location_fulfillment_set_links", LocationFulfillmentSet], ["shipping_option_price_set_links", ShippingOptionPriceSet]] as const) {
      const source = workflowModuleDefinition(links[name].module)?.source;
      if (source === undefined || source.name !== native.serviceName || source.profile !== "shipping-option-links" || links[name].logicalResources !== undefined || links[name].logicalPublication !== undefined)
        return yield* Result.fail(commerceError("invalidAuthority"));
    }
    const clone = (installed: InstalledWorkflowModule, remotePaths: Result.Result.Success<ReturnType<typeof nativeLinkGraphPaths>>,
      directPaths: readonly GraphDirectPath[] = []) => Result.gen(function* () {
      const definition = workflowModuleDefinition(installed.module);
      if (definition === undefined) return yield* Result.fail(commerceError("invalidAuthority"));
      return { ...installed, module: yield* defineWorkflowModule({ name: installed.module.name, source: definition.source,
        methods: installed.module.methods, graph: { ...definition.graph, remotePaths: [...definition.graph.remotePaths ?? [], ...remotePaths],
          ...(directPaths.length === 0 ? {} : { directPaths: [...definition.graph.directPaths ?? [], ...directPaths] }) },
        ...(definition.logical === undefined ? {} : { logical: definition.logical }) }) };
    });
    const bounds = { maximumSources: 4, maximumLinks: 8, maximumTargets: 4, maximumPerSource: 4 };
    const channelLocations = yield* nativeLinkGraphPaths(SalesChannelLocation, [{ ...bounds, root: "SalesChannel", path: "stock_locations" }]);
    const sets = yield* nativeLinkGraphPaths(LocationFulfillmentSet, [{ ...bounds, root: "SalesChannel", path: "stock_locations.fulfillment_sets" }], "StockLocation");
    const location = yield* nativeLinkGraphPaths(LocationFulfillmentSet, [{ ...bounds, maximumPerSource: 1,
      root: "ShippingOption", path: "service_zone.fulfillment_set.location" }], "FulfillmentSet");
    const prices = yield* nativeLinkGraphPaths(ShippingOptionPriceSet, ["prices", "calculated_price"].map(path => ({ ...bounds,
      maximumLinks: 4, maximumPerSource: 1, root: "ShippingOption", path })));
    const cartVariant = workflowModuleDefinition(modules.cart.module)?.graph.directPaths?.find(path => path.root === "Cart" && path.path === "items.variant");
    if (cartVariant === undefined) return yield* Result.fail(commerceError("invalidAuthority"));
    // Native listing traverses the same authenticated Variant Inventory edges
    // from Cart.items.variant. Reuse their endpoints and existing cohort bounds.
    const inventoryPaths = (installed: InstalledWorkflowModule, names: readonly string[]) => Result.gen(function* () {
      const paths = workflowModuleDefinition(installed.module)?.graph.directPaths ?? [];
      const selected: GraphDirectPath[] = [];
      for (const name of names) {
        const candidates = paths.filter(path => path.root === cartVariant.targetModel && path.path === name), path = candidates[0];
        if (candidates.length !== 1 || path === undefined) return yield* Result.fail(commerceError("invalidAuthority"));
        selected.push({ ...path, root: cartVariant.root, path: `${cartVariant.path}.${path.path}` });
      }
      return selected;
    });
    const itemInventory = yield* inventoryPaths(modules.variant_links, ["inventory_items", "inventory_items.inventory"]);
    const levels = yield* inventoryPaths(modules.inventory, ["inventory_items.inventory.location_levels"]);
    return { ...modules, sales_channel_locations: yield* clone(modules.sales_channel_locations, channelLocations),
      variant_links: yield* clone(modules.variant_links, [], itemInventory), inventory: yield* clone(modules.inventory, [], levels),
      location_fulfillment_set_links: yield* clone(links.location_fulfillment_set_links, [...sets, ...location]),
      shipping_option_price_set_links: yield* clone(links.shipping_option_price_set_links, prices) };
  });
}
