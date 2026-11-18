import { Effect } from "effect";
import { createPriceListsWorkflow } from "@medusajs/core-flows/price-list/create-price-lists";
import type { AtomicCommerceEvents } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { capturePricingMetadata } from "../../modules/pricing/schema";
import { PriceListWorkflowInput, compilePriceListCreationContracts } from "../../modules/pricing/list-input";
import type { makeLocalPricingCommands } from "../../modules/pricing/service";
import type { prepareVariantPricingLink } from "../../links/variant-pricing-service";
import { captureWorkflowRecord } from "../../workflow/configuration";
import { internalModuleWorkflowEvents } from "../../workflow/events";
import { prepareAtomicWorkflowHost, captureInstalledWorkflowModules, type AtomicWorkflowExecution,
  type InstalledWorkflowModule } from "../../workflow/host";
import { workflowModuleDefinition } from "../../workflow/module";
import { prepareWorkflowResources } from "../../workflow/resources";

/** The original workflow validates stored Variant–PriceSet links, creates the
 * complete native Pricing graph and retains its original physical inverse. */
export const prepareCreatePriceListsWorkflow = Effect.fn("PricingWorkflow.createPriceLists")(function* (input: {
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
  const modules = yield* Effect.fromResult(captureInstalledWorkflowModules(registrations, ["pricing", "link"]));
  if (Object.keys(registrations).length !== 2) return yield* Effect.fail(commerceError("unsupportedProfile"));
  const pricing = workflowModuleDefinition(modules.pricing.module), link = workflowModuleDefinition(modules.link.module);
  if (pricing?.source.name !== "flarex-pricing-local" || pricing.source.profile !== "pricing-price-list-creations" ||
    link?.source.profile !== "medusa.variant-pricing.link-workflow")
    return yield* Effect.fail(commerceError("invalidAuthority"));
  const contracts = yield* Effect.fromResult(compilePriceListCreationContracts((yield* capturePricingMetadata()).frame));
  const resources = yield* Effect.fromResult(prepareWorkflowResources({
    pricing: { module: modules.pricing.module, methods: ["createPriceLists", "deletePriceLists"], graph: false },
    link: { module: modules.link.module, methods: [], graph: true, expose: false },
  }, true));
  const prepared = yield* Effect.fromResult(createPriceListsWorkflow.prepare())
    .pipe(Effect.mapError(cause => commerceError("unsupportedProfile", cause)));
  return yield* prepareAtomicWorkflowHost({ execution: options.execution, modules,
    revision: options.revision, subscribers: options.subscribers, workflow: {
      name: "createPriceListsWorkflow", resources, prepared, input: PriceListWorkflowInput,
      output: contracts.Output, events: internalModuleWorkflowEvents,
    } });
});
