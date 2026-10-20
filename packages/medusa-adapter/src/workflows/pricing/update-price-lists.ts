import { Effect, Schema } from "effect";
import { updatePriceListsWorkflow } from "@medusajs/core-flows/price-list/update-price-lists";
import type { AtomicCommerceEvents } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { PriceListUpdateWorkflowInput } from "../../modules/pricing/list-update-input";
import type { makeLocalPricingCommands } from "../../modules/pricing/service";
import { captureWorkflowRecord } from "../../workflow/configuration";
import { internalModuleWorkflowEvents } from "../../workflow/events";
import { prepareAtomicWorkflowHost, captureInstalledWorkflowModules, type AtomicWorkflowExecution,
  type InstalledWorkflowModule } from "../../workflow/host";
import { workflowModuleDefinition } from "../../workflow/module";
import { prepareWorkflowResources } from "../../workflow/resources";

/** The original root validates Price Lists, retains its sparse preimages and
 * uses the same native update method for forward and compensation. */
export const prepareUpdatePriceListsWorkflow = Effect.fn("PricingWorkflow.updatePriceLists")(function* (input: {
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
  if (definition?.source.name !== "flarex-pricing-local" || definition.source.profile !== "pricing-price-list-updates")
    return yield* Effect.fail(commerceError("invalidAuthority"));
  const modules = { pricing: { ...installed.pricing, logicalPublication: "mixed" as const } };
  const resources = yield* Effect.fromResult(prepareWorkflowResources({ pricing: {
    module: modules.pricing.module, methods: ["listPriceLists", "updatePriceLists"], graph: false,
  } }, true));
  const prepared = yield* Effect.fromResult(updatePriceListsWorkflow.prepare())
    .pipe(Effect.mapError(cause => commerceError("unsupportedProfile", cause)));
  return yield* prepareAtomicWorkflowHost({ execution: options.execution, modules,
    revision: options.revision, subscribers: options.subscribers, workflow: {
      name: "updatePriceListsWorkflow", resources, prepared, input: PriceListUpdateWorkflowInput,
      output: Schema.Null, events: internalModuleWorkflowEvents,
    } });
});
