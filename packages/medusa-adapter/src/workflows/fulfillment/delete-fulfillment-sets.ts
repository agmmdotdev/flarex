import { Effect, Result, Schema } from "effect";
import { deleteFulfillmentSetsWorkflow } from "@medusajs/core-flows/fulfillment/delete-fulfillment-sets";
import type { AtomicCommerceEvents } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { jsonEqual } from "flarex-protocol/json";
import { FulfillmentSetDeletionIds } from "../../modules/fulfillment/fulfillment-set-delete-input";
import type { makeFulfillmentSetDeletionCommands } from "../../modules/fulfillment/fulfillment-set-delete-service";
import type { prepareFulfillmentSetDeletionLinkResource } from "../../links/fulfillment-set-deletion";
import type { prepareLocationFulfillmentSetDeletionLinks } from "../../links/location-fulfillment-set-deletion";
import type { prepareLocationFulfillmentProviderLink } from "../../links/location-fulfillment-provider-service";
import type { prepareShippingOptionPriceSetLink } from "../../links/shipping-option-price-set-service";
import type { makeLocalPricingCommands } from "../../modules/pricing/service";
import { LocationFulfillmentProvider, ShippingOptionPriceSet } from "@medusajs/link-modules";
import { fulfillmentSetDeletionResources, fulfillmentSetDeletionCommandMs } from "../../workflow/policy";
import { captureWorkflowRecord } from "../../workflow/configuration";
import { internalModuleWorkflowEvents } from "../../workflow/events";
import { prepareAtomicWorkflowHost, captureInstalledWorkflowModules, type AtomicWorkflowExecution,
  type InstalledWorkflowModule } from "../../workflow/host";
import { workflowModuleDefinition } from "../../workflow/module";
import { prepareWorkflowResources } from "../../workflow/resources";

type Fulfillment = Effect.Success<ReturnType<typeof makeFulfillmentSetDeletionCommands>>["workflow"];
type Links = Result.Result.Success<ReturnType<typeof prepareFulfillmentSetDeletionLinkResource>>;
type LocationLinks = Effect.Success<ReturnType<typeof prepareLocationFulfillmentSetDeletionLinks>>["workflow"];
export const FulfillmentSetDeletionInput = Schema.Struct({ ids: FulfillmentSetDeletionIds });

/** The genuine Set lifecycle and installed locfs router share one outer
 * settlement, including the actual raw-input retained callbacks. */
export const prepareFulfillmentSetDeletionWorkflow = Effect.fn("FulfillmentSet.prepareDeletion")(function* (input: {
  readonly execution: AtomicWorkflowExecution;
  readonly modules: { readonly fulfillment: InstalledWorkflowModule<Fulfillment>; readonly locationLinks: InstalledWorkflowModule<LocationLinks>;
    readonly providerLinks: InstalledWorkflowModule<Effect.Success<ReturnType<typeof prepareLocationFulfillmentProviderLink>>["workflow"]>;
    readonly priceSetLinks: InstalledWorkflowModule<Effect.Success<ReturnType<typeof prepareShippingOptionPriceSetLink>>["workflow"]>;
    readonly pricing: InstalledWorkflowModule<Effect.Success<ReturnType<typeof makeLocalPricingCommands>>["workflow"]> };
  readonly link: Links;
  readonly revision: string;
  readonly subscribers: AtomicCommerceEvents["subscribers"];
}) {
  const options = yield* Effect.fromResult(captureWorkflowRecord(input));
  if (Object.keys(options).some(key => !["execution", "modules", "link", "revision", "subscribers"].includes(key)))
    return yield* Effect.fail(commerceError("unsupportedProfile"));
  const registrations = yield* Effect.fromResult(captureWorkflowRecord(options.modules));
  if (Object.keys(registrations).length !== 5) return yield* Effect.fail(commerceError("unsupportedProfile"));
  const installed = yield* Effect.fromResult(captureInstalledWorkflowModules(registrations, ["fulfillment", "locationLinks", "providerLinks", "priceSetLinks", "pricing"]));
  const source = workflowModuleDefinition(installed.fulfillment.module)?.source;
  if (source?.name !== "flarex-fulfillment-set-delete" || source.profile !== "fulfillment-set-delete")
    return yield* Effect.fail(commerceError("invalidAuthority"));
  const linkSource = workflowModuleDefinition(installed.locationLinks.module)?.source;
  if (linkSource?.profile !== "fulfillment-set-deletions") return yield* Effect.fail(commerceError("invalidAuthority"));
  for (const [module, name, profile] of [[installed.providerLinks.module, LocationFulfillmentProvider.serviceName, "shipping-option-links"],
    [installed.priceSetLinks.module, ShippingOptionPriceSet.serviceName, "shipping-option-links"],
    [installed.pricing.module, "flarex-pricing-local", "pricing-shipping-options"]] as const) {
    const source = workflowModuleDefinition(module)?.source;
    if (source === undefined || source.name !== name || source.profile !== profile) return yield* Effect.fail(commerceError("invalidAuthority"));
  }
  for (const registration of Object.values(installed))
    if (registration.logicalResources !== undefined && !jsonEqual(registration.logicalResources, fulfillmentSetDeletionResources))
      return yield* Effect.fail(commerceError("unsupportedProfile"));
  const select = <Module extends InstalledWorkflowModule>(binding: Module) => {
    const { logicalPublication: _publication, ...selected } = binding;
    return { ...selected, logicalResources: fulfillmentSetDeletionResources };
  };
  const modules = { fulfillment: select(installed.fulfillment), locationLinks: select(installed.locationLinks),
    providerLinks: select(installed.providerLinks), priceSetLinks: select(installed.priceSetLinks),
    pricing: { ...select(installed.pricing), logicalPublication: "mixed" as const } };
  const resources = yield* Effect.fromResult(prepareWorkflowResources({ fulfillment: {
    module: modules.fulfillment.module, methods: ["softDeleteFulfillmentSets", "restoreFulfillmentSets"], graph: false,
  }, locationLinks: { module: modules.locationLinks.module, methods: ["create", "list", "softDelete", "restore"], graph: false, expose: false },
    providerLinks: { module: modules.providerLinks.module, methods: ["softDelete", "restore"], graph: false, expose: false },
    priceSetLinks: { module: modules.priceSetLinks.module, methods: ["softDelete", "restore"], graph: false, expose: false },
    pricing: { module: modules.pricing.module, methods: ["softDeletePriceSets", "restorePriceSets"], graph: false, expose: false },
  }, true, { link: options.link }));
  const prepared = yield* Effect.fromResult(deleteFulfillmentSetsWorkflow.prepare()).pipe(Effect.mapError(cause => commerceError("unsupportedProfile", cause)));
  return yield* prepareAtomicWorkflowHost({ ...options, modules, operationScheduling: "queued",
    requestCallLimit: fulfillmentSetDeletionResources.calls, requestEventLimit: fulfillmentSetDeletionResources.eventMessages,
    requestByteLimit: fulfillmentSetDeletionResources.commandBytes, requestCommandMs: fulfillmentSetDeletionCommandMs,
    workflow: { name: "deleteFulfillmentSetsWorkflow", resources, prepared,
      input: FulfillmentSetDeletionInput, output: Schema.Null, events: internalModuleWorkflowEvents } });
});
