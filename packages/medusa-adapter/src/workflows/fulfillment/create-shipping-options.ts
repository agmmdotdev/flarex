import { Effect, Result, Schema } from "effect";
import { ShippingOptionWorkflowPrice } from "./shipping-option-prices";
import { createShippingOptionsWorkflow } from "@medusajs/core-flows/fulfillment/create-shipping-options";
import { ShippingOptionWorkflowEvents } from "@medusajs/framework/utils/portable";
import { LocationFulfillmentSet, LocationFulfillmentProvider, ShippingOptionPriceSet } from "@medusajs/link-modules";
import type { AtomicCommerceEvents } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError, isJsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { jsonEqual } from "flarex-protocol/json";
import { ShippingOptionCreate, ShippingOptionInlineType, ShippingOptionId,
  compileShippingOptionCreationContracts } from "../../modules/fulfillment/shipping-option-create-input";
import { captureServiceZoneCreationMetadata } from "../../modules/fulfillment/shipping-profile-schema";
import type { makeLocalShippingOptionCreationCommands } from "../../modules/fulfillment/shipping-option-create-service";
import type { makeLocalPricingCommands } from "../../modules/pricing/service";
import type { makeLocalRegionReadCommands } from "../../modules/region/service";
import type { makeStockLocationCommands } from "../../modules/stock-location/service";
import type { prepareShippingOptionLinkService } from "../../links/shipping-option-link-service";
import type { prepareShippingOptionCreationLinkResource } from "../../links/shipping-option-price-set-service";
import { captureWorkflowRecord } from "../../workflow/configuration";
import { orderedWorkflowIdEvents } from "../../workflow/events";
import { prepareAtomicWorkflowHost, captureInstalledWorkflowModules, type AtomicWorkflowExecution,
  type InstalledWorkflowModule } from "../../workflow/host";
import { workflowModuleDefinition, type WorkflowMethod } from "../../workflow/module";
import { prepareWorkflowResources } from "../../workflow/resources";
import { shippingOptionCreationResources } from "../../workflow/policy";
import { composedWorkflowResourceDefinition } from "../../workflow/composed-resource";

type Fulfillment = Effect.Success<ReturnType<typeof makeLocalShippingOptionCreationCommands>>["workflow"];
type Pricing = Effect.Success<ReturnType<typeof makeLocalPricingCommands>>["workflow"];
type Region = Effect.Success<ReturnType<typeof makeLocalRegionReadCommands>>["workflow"];
type Stock = Effect.Success<ReturnType<typeof makeStockLocationCommands>>["workflow"];
type Links = Effect.Success<ReturnType<typeof prepareShippingOptionLinkService>>["workflow"];
type Link = Result.Result.Success<ReturnType<typeof prepareShippingOptionCreationLinkResource>>;
type Contracts = Result.Result.Success<ReturnType<typeof compileShippingOptionCreationContracts>>;
export type ShippingOptionCreationModules = {
  readonly fulfillment: Fulfillment;
  readonly pricing: Pricing;
  readonly region: Region;
  readonly stockLocation: Stock;
  readonly locationLinks: Links;
  readonly providerLinks: Links;
  readonly priceSetLinks: Links;
};
/** Two numeric rules plus native automatic Region expansion fit the selected
 * 24-rule creation graph. Native helpers retain grouping and override order. */
export const ShippingOptionCreationInput = Schema.Array(Schema.Struct({ ...ShippingOptionCreate.fields,
  type: Schema.optionalKey(ShippingOptionInlineType),
  prices: Schema.optionalKey(Schema.Array(ShippingOptionWorkflowPrice).check(Schema.isMaxLength(2))),
})).check(Schema.isMaxLength(4));

/** One authentic capability selection is shared by production preparation and
 * retained-callback proofs; neither caller receives additional module methods. */
export function prepareShippingOptionCreationResources(input: ShippingOptionCreationModules, resource: Link) {
  return Result.gen(function* () {
    const modules = yield* captureWorkflowRecord(input);
    if (Object.keys(modules).length !== 7) return yield* Result.fail(commerceError("unsupportedProfile"));
    for (const [key, name, profile] of [
      ["fulfillment", "flarex-shipping-option-create", "shipping-option-create"],
      ["pricing", "flarex-pricing-local", "pricing-shipping-options"],
      ["region", "flarex-region-read", "region-shipping-option-read"],
      ["stockLocation", "flarex-stock-location-read", "stock-location-id-read"],
    ] as const) {
      const source = workflowModuleDefinition(modules[key])?.source;
      if (source?.name !== name || source.profile !== profile) return yield* Result.fail(commerceError("invalidAuthority"));
    }
    for (const [key, name] of [["locationLinks", LocationFulfillmentSet.serviceName], ["providerLinks", LocationFulfillmentProvider.serviceName],
      ["priceSetLinks", ShippingOptionPriceSet.serviceName]] as const) {
      const source = workflowModuleDefinition(modules[key])?.source;
      if (source === undefined || source.name !== name || source.profile !== "shipping-option-links") return yield* Result.fail(commerceError("invalidAuthority"));
    }
    const link = composedWorkflowResourceDefinition(resource), methods = modules.priceSetLinks.methods;
    const dependencies = new Set<WorkflowMethod>([methods.create, methods.list, methods.dismiss]);
    if (link === undefined || !isJsonObject(link.identity) || link.identity.format !== "medusa.shipping-option.creation-links" ||
      link.dependencies.length !== dependencies.size || link.dependencies.some(method => !dependencies.has(method)))
      return yield* Result.fail(commerceError("invalidAuthority"));
    return yield* prepareWorkflowResources({
      fulfillment: { module: modules.fulfillment, methods: ["upsertShippingOptions", "deleteShippingOptions", "validateShippingOptionsForPriceCalculation", "listShippingOptions", "listFulfillmentProviders"], graph: true },
      pricing: { module: modules.pricing, methods: ["createPriceSets", "deletePriceSets"], graph: true },
      region: { module: modules.region, methods: ["listRegions"], graph: false },
      stockLocation: { module: modules.stockLocation, methods: [], graph: true, expose: false },
      locationLinks: { module: modules.locationLinks, methods: ["list"], graph: true, expose: false },
      providerLinks: { module: modules.providerLinks, methods: ["list"], graph: true, expose: false },
      priceSetLinks: { module: modules.priceSetLinks, methods: ["create", "list", "dismiss"], graph: true, expose: false },
    }, true, { link: resource });
  });
}

/** Cancellation changes publication only; ordered creation evidence continues
 * to correlate with the genuine successful native Fulfillment call. */
export function shippingOptionCreationEvents(fulfillment: Fulfillment, contracts: Contracts) {
  return orderedWorkflowIdEvents(ShippingOptionWorkflowEvents.CREATED, Effect.fn("ShippingOption.createdIds")(function* (calls) {
    const writes = calls.calls(fulfillment.methods.upsertShippingOptions), call = writes[0];
    if (writes.length === 0) return [];
    if (writes.length !== 1 || call === undefined) return yield* Effect.fail(commerceError("receiptMismatch"));
    const rows = yield* Effect.fromResult(contracts.decodeRows(call.result));
    const ids: string[] = [];
    for (const row of rows) {
      if (typeof row.id !== "string") return yield* Effect.fail(commerceError("receiptMismatch"));
      ids.push(row.id);
    }
    return ids;
  }), { pendingCancellation: true });
}

/** The native root, provider checks, normalization, Links and retained inverses
 * all borrow the existing outer owner. Manual calculation refusal stays native. */
export const prepareShippingOptionCreationWorkflow = Effect.fn("ShippingOption.prepareCreation")(function* (input: {
  readonly execution: AtomicWorkflowExecution;
  readonly modules: { readonly [Key in keyof ShippingOptionCreationModules]: InstalledWorkflowModule<ShippingOptionCreationModules[Key]> };
  readonly link: Link;
  readonly revision: string;
  readonly subscribers: AtomicCommerceEvents["subscribers"];
}) {
  const options = yield* Effect.fromResult(captureWorkflowRecord(input));
  if (Object.keys(options).some(key => !["execution", "modules", "link", "revision", "subscribers"].includes(key)))
    return yield* Effect.fail(commerceError("unsupportedProfile"));
  const registrations = yield* Effect.fromResult(captureWorkflowRecord(options.modules));
  const keys = ["fulfillment", "pricing", "region", "stockLocation", "locationLinks", "providerLinks", "priceSetLinks"] as const;
  if (Object.keys(registrations).length !== keys.length) return yield* Effect.fail(commerceError("unsupportedProfile"));
  const installed = yield* Effect.fromResult(captureInstalledWorkflowModules(registrations, keys));
  const resources = yield* Effect.fromResult(prepareShippingOptionCreationResources({ fulfillment: installed.fulfillment.module,
    pricing: installed.pricing.module, region: installed.region.module, stockLocation: installed.stockLocation.module,
    locationLinks: installed.locationLinks.module, providerLinks: installed.providerLinks.module, priceSetLinks: installed.priceSetLinks.module }, options.link));
  for (const module of Object.values(installed)) if (module.logicalResources !== undefined && !jsonEqual(module.logicalResources, shippingOptionCreationResources))
    return yield* Effect.fail(commerceError("unsupportedProfile"));
  const modules = Object.fromEntries(Object.entries(installed).map(([name, module]) => {
    const { logicalPublication: _publication, ...binding } = module;
    return [name, { ...binding, logicalResources: shippingOptionCreationResources }];
  }));
  const metadata = yield* captureServiceZoneCreationMetadata();
  const contracts = yield* Effect.fromResult(compileShippingOptionCreationContracts(metadata.frame));
  const output = Schema.Array(Schema.Record(Schema.String, Schema.Json)).check(Schema.makeFilter(rows => Result.isSuccess(contracts.decodeRows(rows))));
  const prepared = yield* Effect.fromResult(createShippingOptionsWorkflow.prepare()).pipe(Effect.mapError(cause => commerceError("unsupportedProfile", cause)));
  const events = shippingOptionCreationEvents(installed.fulfillment.module, contracts);
  return yield* prepareAtomicWorkflowHost({ execution: options.execution, modules, revision: options.revision, subscribers: options.subscribers,
    operationScheduling: "queued", requestCallLimit: shippingOptionCreationResources.calls,
    requestEventLimit: shippingOptionCreationResources.eventMessages, requestByteLimit: shippingOptionCreationResources.commandBytes,
    workflow: { name: "createShippingOptionsWorkflow", resources, prepared, input: ShippingOptionCreationInput, output, events } });
});
