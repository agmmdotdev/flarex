import { Effect, Result, Schema } from "effect";
import { deleteShippingOptionsWorkflow } from "@medusajs/core-flows/fulfillment/delete-shipping-options";
import { ShippingOptionWorkflowEvents } from "@medusajs/framework/utils/portable";
import { ShippingOptionPriceSet } from "@medusajs/link-modules";
import type { AtomicCommerceEvents } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError, isJsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { jsonEqual } from "flarex-protocol/json";
import { ShippingOptionDeletionIds, decodeShippingOptionDeletionIds } from "../../modules/fulfillment/shipping-option-delete-input";
import type { makeShippingOptionDeletionCommands } from "../../modules/fulfillment/shipping-option-delete-service";
import type { makeLocalPricingCommands } from "../../modules/pricing/service";
import type { prepareShippingOptionPriceSetLink } from "../../links/shipping-option-price-set-service";
import type { prepareShippingOptionDeletionLinkResource } from "../../links/shipping-option-deletion";
import { composedWorkflowResourceDefinition } from "../../workflow/composed-resource";
import { captureWorkflowRecord } from "../../workflow/configuration";
import { orderedWorkflowIdEvents } from "../../workflow/events";
import { prepareAtomicWorkflowHost, captureInstalledWorkflowModules, type AtomicWorkflowExecution,
  type InstalledWorkflowModule } from "../../workflow/host";
import { workflowModuleDefinition, type WorkflowMethod } from "../../workflow/module";
import { shippingOptionDeletionResources, shippingOptionDeletionCommandMs } from "../../workflow/policy";
import { prepareWorkflowResources } from "../../workflow/resources";

type Fulfillment = Effect.Success<ReturnType<typeof makeShippingOptionDeletionCommands>>["workflow"];
type Pricing = Effect.Success<ReturnType<typeof makeLocalPricingCommands>>["workflow"];
type PriceSetLinks = Effect.Success<ReturnType<typeof prepareShippingOptionPriceSetLink>>["workflow"];
type Links = Result.Result.Success<ReturnType<typeof prepareShippingOptionDeletionLinkResource>>;
export type ShippingOptionDeletionModules = {
  readonly fulfillment: Fulfillment; readonly priceSetLinks: PriceSetLinks; readonly pricing: Pricing;
};
export const ShippingOptionDeletionInput = Schema.Struct({ ids: ShippingOptionDeletionIds });

/** Production and retained-callback proofs share the same authentic finite
 * selection. No Query or provider execution belongs to this native root. */
export function prepareShippingOptionDeletionResources(input: ShippingOptionDeletionModules, resource: Links) {
  return Result.gen(function* () {
    const modules = yield* captureWorkflowRecord(input);
    if (Object.keys(modules).length !== 3) return yield* Result.fail(commerceError("unsupportedProfile"));
    for (const [key, name, profile] of [
      ["fulfillment", "flarex-shipping-option-delete", "shipping-option-delete"],
      ["priceSetLinks", ShippingOptionPriceSet.serviceName, "shipping-option-links"],
      ["pricing", "flarex-pricing-local", "pricing-shipping-options"],
    ] as const) {
      const source = workflowModuleDefinition(modules[key])?.source;
      if (source === undefined || source.name !== name || source.profile !== profile) return yield* Result.fail(commerceError("invalidAuthority"));
    }
    const link = composedWorkflowResourceDefinition(resource);
    const softDelete = modules.priceSetLinks.methods.softDelete, restore = modules.priceSetLinks.methods.restore;
    const pricingDelete = modules.pricing.methods.softDeletePriceSets, pricingRestore = modules.pricing.methods.restorePriceSets;
    if (softDelete === undefined || restore === undefined || pricingDelete === undefined || pricingRestore === undefined)
      return yield* Result.fail(commerceError("invalidAuthority"));
    const dependencies = new Set<WorkflowMethod>([softDelete, restore, pricingDelete, pricingRestore]);
    if (link === undefined || !isJsonObject(link.identity) || link.identity.format !== "medusa.shipping-option.deletion-links" ||
      link.dependencies.length !== dependencies.size || link.dependencies.some(method => !dependencies.has(method)))
      return yield* Result.fail(commerceError("invalidAuthority"));
    return yield* prepareWorkflowResources({
      fulfillment: { module: modules.fulfillment, methods: ["softDeleteShippingOptions", "restoreShippingOptions"], graph: false },
      priceSetLinks: { module: modules.priceSetLinks, methods: ["softDelete", "restore"], graph: false, expose: false },
      pricing: { module: modules.pricing, methods: ["softDeletePriceSets", "restorePriceSets"], graph: false, expose: false },
    }, true, { link: resource });
  });
}

/** Workflow messages preserve raw missing/repeated input IDs independently of
 * affected-row maps. Cancellation removes only this pending event family. */
export function shippingOptionDeletionEvents(fulfillment: Fulfillment) {
  return orderedWorkflowIdEvents(ShippingOptionWorkflowEvents.DELETED, Effect.fn("ShippingOption.deletedIds")(function* (calls) {
    const writes = calls.calls(fulfillment.methods.softDeleteShippingOptions), call = writes[0];
    if (writes.length === 0) return [];
    if (writes.length !== 1 || call === undefined) return yield* Effect.fail(commerceError("receiptMismatch"));
    return yield* Effect.fromResult(decodeShippingOptionDeletionIds(call.input));
  }), { pendingCancellation: true, dataShape: "string" });
}

/** Native soft deletion and its actual retained inverses share one outer
 * settlement, including historical revival and the installed Link invariants. */
export const prepareShippingOptionDeletionWorkflow = Effect.fn("ShippingOption.prepareDeletion")(function* (input: {
  readonly execution: AtomicWorkflowExecution;
  readonly modules: { readonly [Key in keyof ShippingOptionDeletionModules]: InstalledWorkflowModule<ShippingOptionDeletionModules[Key]> };
  readonly link: Links;
  readonly revision: string;
  readonly subscribers: AtomicCommerceEvents["subscribers"];
}) {
  const options = yield* Effect.fromResult(captureWorkflowRecord(input));
  if (Object.keys(options).some(key => !["execution", "modules", "link", "revision", "subscribers"].includes(key)))
    return yield* Effect.fail(commerceError("unsupportedProfile"));
  const registrations = yield* Effect.fromResult(captureWorkflowRecord(options.modules));
  const keys = ["fulfillment", "priceSetLinks", "pricing"] as const;
  if (Object.keys(registrations).length !== keys.length) return yield* Effect.fail(commerceError("unsupportedProfile"));
  const installed = yield* Effect.fromResult(captureInstalledWorkflowModules(registrations, keys));
  const resources = yield* Effect.fromResult(prepareShippingOptionDeletionResources({ fulfillment: installed.fulfillment.module,
    priceSetLinks: installed.priceSetLinks.module, pricing: installed.pricing.module }, options.link));
  for (const module of Object.values(installed))
    if (module.logicalResources !== undefined && !jsonEqual(module.logicalResources, shippingOptionDeletionResources))
      return yield* Effect.fail(commerceError("unsupportedProfile"));
  const select = <Module extends InstalledWorkflowModule>(binding: Module) => {
    const { logicalPublication: _publication, ...selected } = binding;
    return { ...selected, logicalResources: shippingOptionDeletionResources };
  };
  const modules = { fulfillment: select(installed.fulfillment), priceSetLinks: select(installed.priceSetLinks),
    pricing: { ...select(installed.pricing), logicalPublication: "mixed" as const } };
  const prepared = yield* Effect.fromResult(deleteShippingOptionsWorkflow.prepare())
    .pipe(Effect.mapError(cause => commerceError("unsupportedProfile", cause)));
  return yield* prepareAtomicWorkflowHost({ ...options, modules, operationScheduling: "queued",
    requestCallLimit: shippingOptionDeletionResources.calls, requestEventLimit: shippingOptionDeletionResources.eventMessages,
    requestByteLimit: shippingOptionDeletionResources.commandBytes, requestCommandMs: shippingOptionDeletionCommandMs,
    workflow: { name: "deleteShippingOptionsWorkflow", resources, prepared,
      input: ShippingOptionDeletionInput, output: Schema.Null, events: shippingOptionDeletionEvents(installed.fulfillment.module) } });
});
