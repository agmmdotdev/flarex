import { jsonEqual } from "flarex-protocol/json";
import { Effect, Schema } from "effect";
import { deleteStockLocationsWorkflow } from "@medusajs/core-flows/stock-location/delete-stock-locations";
import { SalesChannelLocation, LocationFulfillmentSet, LocationFulfillmentProvider, ShippingOptionPriceSet } from "@medusajs/link-modules";
import type { AtomicCommerceEvents } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { StockLocationDeletionIds } from "../../modules/stock-location/delete-input";
import { stockLocationDeletionResources, stockLocationDeletionCommandMs } from "../../workflow/policy";
import type { makeFulfillmentSetDeletionCommands } from "../../modules/fulfillment/fulfillment-set-delete-service";
import type { makeStockLocationDeletionCommands } from "../../modules/stock-location/delete-service";
import type { prepareStockLocationDeletionLinks } from "../../links/stock-location-deletion";
import type { makeLocalPricingCommands } from "../../modules/pricing/service";
import { captureWorkflowRecord } from "../../workflow/configuration";
import { internalModuleWorkflowEvents } from "../../workflow/events";
import { prepareAtomicWorkflowHost, captureInstalledWorkflowModules, type AtomicWorkflowExecution, type InstalledWorkflowModule } from "../../workflow/host";
import { workflowModuleDefinition } from "../../workflow/module";
import { prepareWorkflowResources } from "../../workflow/resources";

type StockLocation = Effect.Success<ReturnType<typeof makeStockLocationDeletionCommands>>["workflow"];
type Links = Effect.Success<ReturnType<typeof prepareStockLocationDeletionLinks>>;
export const StockLocationDeletionInput = Schema.Struct({ ids: StockLocationDeletionIds });

/** The genuine module's returned map selects the one installed native Link
 * families and the genuine Fulfillment cascade. Addresses remain unchanged. */
export const prepareStockLocationDeletionWorkflow = Effect.fn("StockLocation.prepareDeletion")(function* (input: {
  readonly execution: AtomicWorkflowExecution;
  readonly modules: {
    readonly stock_location: InstalledWorkflowModule<StockLocation>;
    readonly sales_channel_location_links: InstalledWorkflowModule<Links["location"]["workflow"]>;
    readonly location_fulfillment_set_links: InstalledWorkflowModule<Links["fulfillmentSet"]["workflow"]>;
    readonly fulfillment: InstalledWorkflowModule<Effect.Success<ReturnType<typeof makeFulfillmentSetDeletionCommands>>["workflow"]>;
    readonly providerLinks: InstalledWorkflowModule<Links["provider"]["workflow"]>;
    readonly priceSetLinks: InstalledWorkflowModule<Links["priceSet"]["workflow"]>;
    readonly pricing: InstalledWorkflowModule<Effect.Success<ReturnType<typeof makeLocalPricingCommands>>["workflow"]>;
  };
  readonly link: Links["resource"];
  readonly revision: string;
  readonly subscribers: AtomicCommerceEvents["subscribers"];
}) {
  const options = yield* Effect.fromResult(captureWorkflowRecord(input));
  if (Object.keys(options).some(key => !["execution", "modules", "link", "revision", "subscribers"].includes(key)))
    return yield* Effect.fail(commerceError("unsupportedProfile"));
  const registrations = yield* Effect.fromResult(captureWorkflowRecord(options.modules));
  if (Object.keys(registrations).length !== 7) return yield* Effect.fail(commerceError("unsupportedProfile"));
  const modules = yield* Effect.fromResult(captureInstalledWorkflowModules(registrations, ["stock_location", "sales_channel_location_links", "location_fulfillment_set_links", "fulfillment", "providerLinks", "priceSetLinks", "pricing"]));
  for (const [module, name, profile] of [
    [modules.stock_location.module, "flarex-stock-location-delete", "stock-location-delete"],
    [modules.sales_channel_location_links.module, SalesChannelLocation.serviceName, "stock-location-deletions"],
    [modules.location_fulfillment_set_links.module, LocationFulfillmentSet.serviceName, "stock-location-deletions"],
    [modules.fulfillment.module, "flarex-fulfillment-set-delete", "fulfillment-set-delete"],
    [modules.providerLinks.module, LocationFulfillmentProvider.serviceName, "shipping-option-links"],
    [modules.priceSetLinks.module, ShippingOptionPriceSet.serviceName, "shipping-option-links"],
    [modules.pricing.module, "flarex-pricing-local", "pricing-shipping-options"],
  ] as const) {
    const definition = workflowModuleDefinition(module);
    if (definition === undefined || definition.source.name !== name || definition.source.profile !== profile)
      return yield* Effect.fail(commerceError("invalidAuthority"));
  }
  for (const installed of Object.values(modules)) if (installed.logicalResources !== undefined && !jsonEqual(installed.logicalResources, stockLocationDeletionResources))
    return yield* Effect.fail(commerceError("unsupportedProfile"));
  const select = <Module extends InstalledWorkflowModule>(binding: Module) => {
    const { logicalPublication: _publication, ...selected } = binding;
    return { ...selected, logicalResources: stockLocationDeletionResources };
  };
  const selected = {
    stock_location: select(modules.stock_location), sales_channel_location_links: select(modules.sales_channel_location_links),
    location_fulfillment_set_links: select(modules.location_fulfillment_set_links), fulfillment: select(modules.fulfillment),
    providerLinks: select(modules.providerLinks), priceSetLinks: select(modules.priceSetLinks),
    pricing: { ...select(modules.pricing), logicalPublication: "mixed" as const },
  };
  const resources = yield* Effect.fromResult(prepareWorkflowResources({
    stock_location: { module: modules.stock_location.module, methods: ["softDeleteStockLocations", "restoreStockLocations"], graph: false },
    sales_channel_location_links: { module: modules.sales_channel_location_links.module,
      methods: ["softDelete", "restore"], graph: false, expose: false },
    location_fulfillment_set_links: { module: modules.location_fulfillment_set_links.module,
      methods: ["softDelete", "restore"], graph: false, expose: false },
    fulfillment: { module: modules.fulfillment.module, methods: ["softDeleteFulfillmentSets", "restoreFulfillmentSets"], graph: false, expose: false },
    providerLinks: { module: modules.providerLinks.module, methods: ["softDelete", "restore"], graph: false, expose: false },
    priceSetLinks: { module: modules.priceSetLinks.module, methods: ["softDelete", "restore"], graph: false, expose: false },
    pricing: { module: modules.pricing.module, methods: ["softDeletePriceSets", "restorePriceSets"], graph: false, expose: false },
  }, true, { link: options.link }));
  const prepared = yield* Effect.fromResult(deleteStockLocationsWorkflow.prepare())
    .pipe(Effect.mapError(cause => commerceError("unsupportedProfile", cause)));
  return yield* prepareAtomicWorkflowHost({ ...options, modules: selected, operationScheduling: "queued",
    requestCallLimit: stockLocationDeletionResources.calls, requestEventLimit: stockLocationDeletionResources.eventMessages,
    requestByteLimit: stockLocationDeletionResources.commandBytes, requestCommandMs: stockLocationDeletionCommandMs,
    workflow: { name: "deleteStockLocationsWorkflow", resources, prepared,
      input: StockLocationDeletionInput, output: Schema.Null, events: internalModuleWorkflowEvents } });
});
