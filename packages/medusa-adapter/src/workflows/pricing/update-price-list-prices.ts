import { Effect } from "effect";
import { jsonEqual } from "flarex-protocol/json";
import { updatePriceListPricesWorkflow } from "@medusajs/core-flows/price-list/update-price-list-prices";
import type { AtomicCommerceEvents } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { capturePricingMetadata } from "../../modules/pricing/schema";
import { PriceListPriceUpdateWorkflowInput, compilePriceListPriceUpdateContracts } from "../../modules/pricing/price-list-price-update-input";
import type { makeLocalPricingCommands } from "../../modules/pricing/service";
import type { prepareVariantPricingLink } from "../../links/variant-pricing-service";
import { captureWorkflowRecord } from "../../workflow/configuration";
import { internalModuleWorkflowEvents } from "../../workflow/events";
import { prepareAtomicWorkflowHost, captureInstalledWorkflowModules, type AtomicWorkflowExecution,
  type InstalledWorkflowModule } from "../../workflow/host";
import { workflowModuleDefinition } from "../../workflow/module";
import { prepareWorkflowResources } from "../../workflow/resources";
import { priceListPriceUpdateResources } from "../../workflow/policy";

/** Native validators and updates retain complete selected graphs and actual new
 * Price identities for the corrected native compensation callback. */
export const prepareUpdatePriceListPricesWorkflow = Effect.fn("PricingWorkflow.updatePriceListPrices")(function* (input: {
  readonly execution: AtomicWorkflowExecution;
  readonly modules: {
    readonly pricing: InstalledWorkflowModule<Effect.Success<ReturnType<typeof makeLocalPricingCommands>>["workflow"]>;
    readonly link: InstalledWorkflowModule<Effect.Success<ReturnType<typeof prepareVariantPricingLink>>["workflow"]>;
  };
  readonly revision: string;
  readonly subscribers: AtomicCommerceEvents["subscribers"];
}) {
  const options = yield* Effect.fromResult(captureWorkflowRecord(input));
  if (Object.keys(options).some(key => !["execution", "modules", "revision", "subscribers"].includes(key)))
    return yield* Effect.fail(commerceError("unsupportedProfile"));
  const registrations = yield* Effect.fromResult(captureWorkflowRecord(options.modules));
  const installed = yield* Effect.fromResult(captureInstalledWorkflowModules(registrations, ["pricing", "link"]));
  if (Object.keys(registrations).length !== 2) return yield* Effect.fail(commerceError("unsupportedProfile"));
  const pricing = workflowModuleDefinition(installed.pricing.module), link = workflowModuleDefinition(installed.link.module);
  if (pricing?.source.name !== "flarex-pricing-local" || pricing.source.profile !== "pricing-price-list-price-updates" ||
    link?.source.profile !== "medusa.variant-pricing.link-workflow")
    return yield* Effect.fail(commerceError("invalidAuthority"));
  for (const binding of [installed.pricing, installed.link]) {
    if (binding.logicalResources !== undefined && !jsonEqual(binding.logicalResources, priceListPriceUpdateResources))
      return yield* Effect.fail(commerceError("unsupportedProfile"));
  }
  const modules = {
    pricing: { ...installed.pricing, logicalResources: priceListPriceUpdateResources, logicalPublication: "mixed" as const },
    link: { ...installed.link, logicalResources: priceListPriceUpdateResources },
  };
  const contracts = yield* Effect.fromResult(compilePriceListPriceUpdateContracts((yield* capturePricingMetadata()).frame));
  const resources = yield* Effect.fromResult(prepareWorkflowResources({
    pricing: { module: modules.pricing.module, methods: ["listPriceLists", "snapshotPriceListPricesForUpdate", "updatePriceListPrices", "restorePriceListPrices"], graph: false },
    link: { module: modules.link.module, methods: [], graph: true, expose: false },
  }, true));
  const prepared = yield* Effect.fromResult(updatePriceListPricesWorkflow.prepare())
    .pipe(Effect.mapError(cause => commerceError("unsupportedProfile", cause)));
  return yield* prepareAtomicWorkflowHost({ execution: options.execution, modules,
    operationScheduling: "queued", borrowedOperationScheduling: "queued",
    revision: options.revision, subscribers: options.subscribers, requestCallLimit: priceListPriceUpdateResources.calls, workflow: {
      name: "updatePriceListPricesWorkflow", resources, prepared, input: PriceListPriceUpdateWorkflowInput,
      output: contracts.Output, events: internalModuleWorkflowEvents,
    } });
});
