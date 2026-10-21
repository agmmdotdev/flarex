import { Effect } from "effect";
import { jsonEqual } from "flarex-protocol/json";
import { batchPriceListPricesWorkflow } from "@medusajs/core-flows/price-list/batch-price-list-prices";
import type { AtomicCommerceEvents } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { capturePricingMetadata } from "../../modules/pricing/schema";
import { PriceListPriceBatchWorkflowInput, compilePriceListPriceBatchContracts } from "../../modules/pricing/price-list-price-batch-input";
import type { makePriceListPriceBatchCommands } from "../../modules/pricing/price-list-price-batch-service";
import type { prepareVariantPricingLink } from "../../links/variant-pricing-service";
import { captureWorkflowRecord } from "../../workflow/configuration";
import { internalModuleWorkflowEvents } from "../../workflow/events";
import { prepareAtomicWorkflowHost, captureInstalledWorkflowModules, type AtomicWorkflowExecution,
  type InstalledWorkflowModule } from "../../workflow/host";
import { workflowModuleDefinition } from "../../workflow/module";
import { prepareWorkflowResources } from "../../workflow/resources";
import { priceListPriceBatchResources } from "../../workflow/policy";

/** Original parallel children share one outer settlement owner. Their native
 * service/repository modes remain fixed by each selected command's issuer. */
export const prepareBatchPriceListPricesWorkflow = Effect.fn("PricingWorkflow.batchPriceListPrices")(function* (input: {
  readonly execution: AtomicWorkflowExecution;
  readonly modules: {
    readonly pricing: InstalledWorkflowModule<Effect.Success<ReturnType<typeof makePriceListPriceBatchCommands>>["workflow"]>;
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
  if (pricing?.source.name !== "flarex-pricing-local" || pricing.source.profile !== "pricing-price-list-price-batch" ||
    link?.source.profile !== "medusa.variant-pricing.link-workflow")
    return yield* Effect.fail(commerceError("invalidAuthority"));
  for (const binding of [installed.pricing, installed.link]) {
    if (binding.logicalResources !== undefined && !jsonEqual(binding.logicalResources, priceListPriceBatchResources))
      return yield* Effect.fail(commerceError("unsupportedProfile"));
  }
  const modules = {
    pricing: { ...installed.pricing, logicalResources: priceListPriceBatchResources, logicalPublication: "mixed" as const },
    link: { ...installed.link, logicalResources: priceListPriceBatchResources },
  };
  const contracts = yield* Effect.fromResult(compilePriceListPriceBatchContracts((yield* capturePricingMetadata()).frame));
  const resources = yield* Effect.fromResult(prepareWorkflowResources({
    pricing: { module: modules.pricing.module, methods: ["listPriceLists", "addPriceListPrices", "removePrices",
      "snapshotPriceListPricesForUpdate", "updatePriceListPrices", "restorePriceListPrices", "listPrices", "softDeletePrices", "restorePrices"], graph: false },
    link: { module: modules.link.module, methods: [], graph: true, expose: false },
  }, true));
  const prepared = yield* Effect.fromResult(batchPriceListPricesWorkflow.prepare())
    .pipe(Effect.mapError(cause => commerceError("unsupportedProfile", cause)));
  return yield* prepareAtomicWorkflowHost({ execution: options.execution, modules,
    operationScheduling: "queued", borrowedOperationScheduling: "queued",
    revision: options.revision, subscribers: options.subscribers, requestCallLimit: priceListPriceBatchResources.calls,
    workflow: { name: "batchPriceListPricesWorkflow", resources, prepared, input: PriceListPriceBatchWorkflowInput,
      output: contracts.Output, events: internalModuleWorkflowEvents },
  });
});
