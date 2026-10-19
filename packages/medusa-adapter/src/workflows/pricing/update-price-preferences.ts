import { Effect } from "effect";
import { updatePricePreferencesWorkflow } from "@medusajs/core-flows/pricing/update-price-preferences";
import type { AtomicCommerceEvents } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { capturePricingMetadata } from "../../modules/pricing/schema";
import { PricePreferenceUpdateInput, compilePricePreferenceContracts } from "../../modules/pricing/preference-input";
import type { makeLocalPricingCommands } from "../../modules/pricing/service";
import { captureWorkflowRecord } from "../../workflow/configuration";
import { workflowModuleDefinition } from "../../workflow/module";
import { prepareWorkflowResources } from "../../workflow/resources";
import { internalModuleWorkflowEvents } from "../../workflow/events";
import { prepareAtomicWorkflowHost, captureInstalledWorkflowModules, type AtomicWorkflowExecution,
  type InstalledWorkflowModule } from "../../workflow/host";

/** The original workflow retains sparse preimages and invokes its actual
 * inverse. All three native methods borrow the existing Pricing owner. */
export const prepareUpdatePricePreferencesWorkflow = Effect.fn("PricingWorkflow.updatePricePreferences")(function* (input: {
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
    definition.source.profile !== "pricing-price-preference-updates")
    return yield* Effect.fail(commerceError("invalidAuthority"));
  const contracts = yield* Effect.fromResult(compilePricePreferenceContracts((yield* capturePricingMetadata()).frame));
  const resources = yield* Effect.fromResult(prepareWorkflowResources({ pricing: {
    module: modules.pricing.module,
    methods: ["listPricePreferences", "updatePricePreferences", "upsertPricePreferences"], graph: false,
  } }, true));
  const prepared = yield* Effect.fromResult(updatePricePreferencesWorkflow.prepare())
    .pipe(Effect.mapError(cause => commerceError("unsupportedProfile", cause)));
  return yield* prepareAtomicWorkflowHost({ execution: options.execution, revision: options.revision, subscribers: options.subscribers,
    modules, workflow: { name: "updatePricePreferencesWorkflow", resources, prepared,
      input: PricePreferenceUpdateInput, output: contracts.Output, events: internalModuleWorkflowEvents } });
});
