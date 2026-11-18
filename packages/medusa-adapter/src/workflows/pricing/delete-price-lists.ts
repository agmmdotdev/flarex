import { Effect, Schema, type Result } from "effect";
import { jsonEqual } from "flarex-protocol/json";
import { deletePriceListsWorkflow } from "@medusajs/core-flows/price-list/delete-price-lists";
import type { AtomicCommerceEvents } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { PriceListDeletionWorkflowInput } from "../../modules/pricing/list-deletion-input";
import type { makeLocalPricingCommands } from "../../modules/pricing/service";
import type { preparePriceListDeletionLinkResource } from "../../links/price-list-deletion";
import { captureWorkflowRecord } from "../../workflow/configuration";
import { internalModuleWorkflowEvents } from "../../workflow/events";
import { prepareAtomicWorkflowHost, captureInstalledWorkflowModules, type AtomicWorkflowExecution,
  type InstalledWorkflowModule } from "../../workflow/host";
import { workflowModuleDefinition } from "../../workflow/module";
import { prepareWorkflowResources } from "../../workflow/resources";
import { priceListDeletionResources } from "../../workflow/policy";

type Pricing = Effect.Success<ReturnType<typeof makeLocalPricingCommands>>["workflow"];
type Links = Result.Result.Success<ReturnType<typeof preparePriceListDeletionLinkResource>>;

/** The original staged void root deletes Pricing before its genuine Link
 * cleanup. Original retained callbacks restore Link before Pricing. */
export const prepareDeletePriceListsWorkflow = Effect.fn("PricingWorkflow.deletePriceLists")(function* (input: {
  readonly execution: AtomicWorkflowExecution;
  readonly pricing: InstalledWorkflowModule<Pricing>;
  readonly link: Links;
  readonly revision: string;
  readonly subscribers: AtomicCommerceEvents["subscribers"];
}) {
  const options = yield* Effect.fromResult(captureWorkflowRecord(input));
  if (Object.keys(options).some(key => !["execution", "pricing", "link", "revision", "subscribers"].includes(key)))
    return yield* Effect.fail(commerceError("unsupportedProfile"));
  const installed = yield* Effect.fromResult(captureInstalledWorkflowModules({ pricing: options.pricing }, ["pricing"]));
  const definition = workflowModuleDefinition(installed.pricing.module);
  if (definition?.source.name !== "flarex-pricing-local" || definition.source.profile !== "pricing-price-list-deletions")
    return yield* Effect.fail(commerceError("invalidAuthority"));
  if (installed.pricing.logicalResources !== undefined && !jsonEqual(installed.pricing.logicalResources, priceListDeletionResources))
    return yield* Effect.fail(commerceError("unsupportedProfile"));
  const modules = { pricing: { ...installed.pricing, logicalResources: priceListDeletionResources } };
  const resources = yield* Effect.fromResult(prepareWorkflowResources({
    pricing: { module: modules.pricing.module, methods: ["softDeletePriceLists", "restorePriceLists"], graph: false },
  }, true, { link: options.link }));
  const prepared = yield* Effect.fromResult(deletePriceListsWorkflow.prepare())
    .pipe(Effect.mapError(cause => commerceError("unsupportedProfile", cause)));
  return yield* prepareAtomicWorkflowHost({ execution: options.execution, revision: options.revision, subscribers: options.subscribers,
    modules, operationScheduling: "queued", requestCallLimit: priceListDeletionResources.calls, workflow: { name: "deletePriceListsWorkflow", resources, prepared,
      input: PriceListDeletionWorkflowInput, output: Schema.Null, events: internalModuleWorkflowEvents } });
});
