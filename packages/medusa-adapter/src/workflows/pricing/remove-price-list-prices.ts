import { Effect } from "effect";
import { jsonEqual } from "flarex-protocol/json";
import { removePriceListPricesWorkflow } from "@medusajs/core-flows/price-list/remove-price-list-prices";
import type { AtomicCommerceEvents } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { PriceListPriceRemovalWorkflowInput } from "../../modules/pricing/price-list-price-removal-input";
import type { makeLocalPricingCommands } from "../../modules/pricing/service";
import { captureWorkflowRecord } from "../../workflow/configuration";
import { internalModuleWorkflowEvents } from "../../workflow/events";
import { prepareAtomicWorkflowHost, captureInstalledWorkflowModules, type AtomicWorkflowExecution,
  type InstalledWorkflowModule } from "../../workflow/host";
import { workflowModuleDefinition } from "../../workflow/module";
import { prepareWorkflowResources } from "../../workflow/resources";
import { priceListPriceRemovalResources } from "../../workflow/policy";

/** The original root selects actual Price IDs and retains them for native
 * current-graph restoration. Pricing is its only commerce resource. */
export const prepareRemovePriceListPricesWorkflow = Effect.fn("PricingWorkflow.removePriceListPrices")(function* (input: {
  readonly execution: AtomicWorkflowExecution;
  readonly pricing: InstalledWorkflowModule<Effect.Success<ReturnType<typeof makeLocalPricingCommands>>["workflow"]>;
  readonly revision: string;
  readonly subscribers: AtomicCommerceEvents["subscribers"];
}) {
  const options = yield* Effect.fromResult(captureWorkflowRecord(input));
  if (Object.keys(options).some(key => !["execution", "pricing", "revision", "subscribers"].includes(key)))
    return yield* Effect.fail(commerceError("unsupportedProfile"));
  const installed = yield* Effect.fromResult(captureInstalledWorkflowModules({ pricing: options.pricing }, ["pricing"]));
  const definition = workflowModuleDefinition(installed.pricing.module);
  if (definition?.source.name !== "flarex-pricing-local" || definition.source.profile !== "pricing-price-list-price-removals")
    return yield* Effect.fail(commerceError("invalidAuthority"));
  if (installed.pricing.logicalResources !== undefined && !jsonEqual(installed.pricing.logicalResources, priceListPriceRemovalResources))
    return yield* Effect.fail(commerceError("unsupportedProfile"));
  const modules = { pricing: { ...installed.pricing, logicalResources: priceListPriceRemovalResources,
    logicalPublication: "mixed" as const } };
  const resources = yield* Effect.fromResult(prepareWorkflowResources({ pricing: {
    module: modules.pricing.module, methods: ["listPrices", "softDeletePrices", "restorePrices"], graph: false,
  } }, true));
  const prepared = yield* Effect.fromResult(removePriceListPricesWorkflow.prepare())
    .pipe(Effect.mapError(cause => commerceError("unsupportedProfile", cause)));
  return yield* prepareAtomicWorkflowHost({ execution: options.execution, modules,
    revision: options.revision, subscribers: options.subscribers,
    operationScheduling: "queued", borrowedOperationScheduling: "queued", requestCallLimit: priceListPriceRemovalResources.calls,
    workflow: { name: "removePriceListPricesWorkflow", resources, prepared, input: PriceListPriceRemovalWorkflowInput,
      output: PriceListPriceRemovalWorkflowInput.fields.ids, events: internalModuleWorkflowEvents },
  });
});
