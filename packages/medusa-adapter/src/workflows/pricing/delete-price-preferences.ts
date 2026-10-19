import { Effect, Schema, type Result } from "effect";
import { deletePricePreferencesWorkflow } from "@medusajs/core-flows/pricing/delete-price-preferences";
import type { AtomicCommerceEvents } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { PricePreferenceDeletionIds } from "../../modules/pricing/preference-input";
import type { makeLocalPricingCommands } from "../../modules/pricing/service";
import type { preparePricePreferenceDeletionLinkResource } from "../../links/price-preference-deletion";
import { captureWorkflowRecord } from "../../workflow/configuration";
import { internalModuleWorkflowEvents } from "../../workflow/events";
import { prepareAtomicWorkflowHost, captureInstalledWorkflowModules, type AtomicWorkflowExecution,
  type InstalledWorkflowModule } from "../../workflow/host";
import { workflowModuleDefinition } from "../../workflow/module";
import { prepareWorkflowResources } from "../../workflow/resources";

type Pricing = Effect.Success<ReturnType<typeof makeLocalPricingCommands>>["workflow"];
type Links = Result.Result.Success<ReturnType<typeof preparePricePreferenceDeletionLinkResource>>;

/** The genuine linear workflow retains both raw Pricing IDs and the grouped
 * Link endpoint. Their native callbacks share the existing outer settlement. */
export const prepareDeletePricePreferencesWorkflow = Effect.fn("PricingWorkflow.deletePricePreferences")(function* (input: {
  readonly execution: AtomicWorkflowExecution;
  readonly pricing: InstalledWorkflowModule<Pricing>;
  readonly link: Links;
  readonly revision: string;
  readonly subscribers: AtomicCommerceEvents["subscribers"];
}) {
  const options = yield* Effect.fromResult(captureWorkflowRecord(input));
  if (Object.keys(options).some(key => !["execution", "pricing", "link", "revision", "subscribers"].includes(key)))
    return yield* Effect.fail(commerceError("unsupportedProfile"));
  const modules = yield* Effect.fromResult(captureInstalledWorkflowModules({ pricing: options.pricing }, ["pricing"]));
  const definition = workflowModuleDefinition(modules.pricing.module);
  if (definition === undefined || definition.source.name !== "flarex-pricing-local" ||
    definition.source.profile !== "pricing-price-preference-deletions")
    return yield* Effect.fail(commerceError("invalidAuthority"));
  const resources = yield* Effect.fromResult(prepareWorkflowResources({
    pricing: { module: modules.pricing.module, methods: ["softDeletePricePreferences", "restorePricePreferences"], graph: false },
  }, true, { link: options.link }));
  const prepared = yield* Effect.fromResult(deletePricePreferencesWorkflow.prepare())
    .pipe(Effect.mapError(cause => commerceError("unsupportedProfile", cause)));
  return yield* prepareAtomicWorkflowHost({ execution: options.execution, revision: options.revision, subscribers: options.subscribers,
    modules, operationScheduling: "queued", workflow: { name: "deletePricePreferencesWorkflow", resources, prepared,
      input: PricePreferenceDeletionIds, output: Schema.Null, events: internalModuleWorkflowEvents } });
});
