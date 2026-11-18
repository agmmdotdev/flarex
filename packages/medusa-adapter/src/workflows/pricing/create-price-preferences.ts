import { Effect } from "effect";
import { createPricePreferencesWorkflow } from "@medusajs/core-flows/pricing/create-price-preferences";
import type { AtomicCommerceEvents } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { PricePreferencesInput } from "../../modules/pricing/input";
import { capturePricingMetadata } from "../../modules/pricing/schema";
import { compilePricePreferenceContracts } from "../../modules/pricing/preference-input";
import type { makeLocalPricingCommands } from "../../modules/pricing/service";
import { captureWorkflowRecord } from "../../workflow/configuration";
import { workflowModuleDefinition } from "../../workflow/module";
import { prepareWorkflowResources } from "../../workflow/resources";
import { internalModuleWorkflowEvents } from "../../workflow/events";
import { prepareAtomicWorkflowHost, captureInstalledWorkflowModules, type AtomicWorkflowExecution,
  type InstalledWorkflowModule } from "../../workflow/host";

/** The genuine creation root and physical inverse borrow one existing Pricing
 * preference owner. No graph, Region, provider or other Pricing method follows. */
export const prepareCreatePricePreferencesWorkflow = Effect.fn("PricingWorkflow.createPricePreferences")(function* (input: {
  readonly execution: AtomicWorkflowExecution;
  readonly pricing: InstalledWorkflowModule<Effect.Success<ReturnType<typeof makeLocalPricingCommands>>["workflow"]>;
  readonly revision: string;
  readonly subscribers: AtomicCommerceEvents["subscribers"];
}) {
  const options = yield* Effect.fromResult(captureWorkflowRecord(input));
  if (Object.keys(options).some(key => !["execution", "pricing", "revision", "subscribers"].includes(key)))
    return yield* Effect.fail(commerceError("unsupportedProfile"));
  const modules = yield* Effect.fromResult(captureInstalledWorkflowModules({ pricing: options.pricing }, ["pricing"]));
  const definition = workflowModuleDefinition(modules.pricing.module);
  if (definition === undefined || definition.source.name !== "flarex-pricing-local" ||
    definition.source.profile !== "pricing-price-preferences")
    return yield* Effect.fail(commerceError("invalidAuthority"));
  const contracts = yield* Effect.fromResult(compilePricePreferenceContracts((yield* capturePricingMetadata()).frame));
  const resources = yield* Effect.fromResult(prepareWorkflowResources({ pricing: {
    module: modules.pricing.module, methods: ["createPricePreferences", "deletePricePreferences"], graph: false,
  } }, true));
  const prepared = yield* Effect.fromResult(createPricePreferencesWorkflow.prepare())
    .pipe(Effect.mapError(cause => commerceError("unsupportedProfile", cause)));
  return yield* prepareAtomicWorkflowHost({ execution: options.execution, revision: options.revision, subscribers: options.subscribers,
    modules, workflow: { name: "createPricePreferencesWorkflow", resources, prepared,
      input: PricePreferencesInput, output: contracts.Output, events: internalModuleWorkflowEvents } });
});
