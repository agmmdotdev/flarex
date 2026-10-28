import { Effect, Schema } from "effect";
import { createWorkflow, parallelize, WorkflowResponse, type WorkflowData } from "@medusajs/workflows-sdk";
import { findSalesChannelStep } from "@medusajs/core-flows/cart/find-sales-channel-step";
import { findOneOrAnyRegionStep } from "@medusajs/core-flows/cart/find-one-or-any-region-step";
import { validateSalesChannelStep } from "@medusajs/core-flows/cart/validate-sales-channel-step";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { captureWorkflowRecord } from "../../workflow/configuration";
import { captureInstalledWorkflowModules, prepareAtomicWorkflowHost,
  type AtomicWorkflowExecution, type InstalledWorkflowModule } from "../../workflow/host";
import { prepareWorkflowResources } from "../../workflow/resources";
import { workflowModuleDefinition } from "../../workflow/module";

// Empty and null Channel IDs are native branches, distinct from omission.
const Identifier = Schema.String.check(Schema.isMaxLength(256));
export const CartContextReadInput = Schema.Struct({
  sales_channel_id: Schema.optionalKey(Schema.NullOr(Identifier)),
  region_id: Schema.optionalKey(Identifier),
});
export const CartContextReadOutput = Schema.Struct({
  sales_channel: Schema.JsonObject,
  region: Schema.optionalKey(Schema.NullOr(Schema.JsonObject)),
});

/** The native Cart context branch, without Customer creation or Cart writes.
 * Both selections and Channel validation execute their actual native steps. */
const contextReads = createWorkflow("native-cart-context-reads", (input: WorkflowData<typeof CartContextReadInput.Type>) => {
  const [salesChannel, region] = parallelize(
    findSalesChannelStep({ salesChannelId: input.sales_channel_id }),
    findOneOrAnyRegionStep({ regionId: input.region_id }),
  );
  validateSalesChannelStep({ salesChannel });
  return new WorkflowResponse({ sales_channel: salesChannel, region });
});
const names = ["store", "region", "sales_channel"] as const;

export const prepareCartContextReadWorkflow = Effect.fn("MedusaWorkflow.prepareCartContextReads")(function* (input: {
  readonly execution: AtomicWorkflowExecution;
  readonly modules: { readonly [Key in typeof names[number]]: InstalledWorkflowModule };
  readonly revision: string;
}) {
  const options = yield* Effect.fromResult(captureWorkflowRecord(input));
  if (Object.keys(options).some(key => !["execution", "modules", "revision"].includes(key)))
    return yield* Effect.fail(commerceError("unsupportedProfile"));
  const registrations = yield* Effect.fromResult(captureWorkflowRecord(options.modules));
  if (Object.keys(registrations).length !== names.length) return yield* Effect.fail(commerceError("unsupportedProfile"));
  const modules = yield* Effect.fromResult(captureInstalledWorkflowModules(registrations, names));
  const sources = {
    store: ["flarex-store-cart-context-read", "store.cart-context-read"],
    region: ["flarex-region-cart-read", "region-cart-context-read"],
    sales_channel: ["flarex-sales-channel-local", "sales-channel"],
  } as const;
  for (const name of names) {
    const binding = modules[name], source = workflowModuleDefinition(binding.module)?.source;
    if (source?.name !== sources[name][0] || source.profile !== sources[name][1])
      return yield* Effect.fail(commerceError("invalidAuthority"));
    if (binding.logicalResources !== undefined || binding.logicalPublication !== undefined)
      return yield* Effect.fail(commerceError("unsupportedProfile"));
  }
  const resources = yield* Effect.fromResult(prepareWorkflowResources({
    store: { module: modules.store.module, methods: ["listStores"], graph: true },
    region: { module: modules.region.module, methods: [], graph: true },
    sales_channel: { module: modules.sales_channel.module, methods: ["retrieveSalesChannel"], graph: false },
  }, false, undefined, { absent: ["caching"] }));
  const prepared = yield* Effect.fromResult(contextReads.prepare())
    .pipe(Effect.mapError(cause => commerceError("unsupportedProfile", cause)));
  return yield* prepareAtomicWorkflowHost({ execution: options.execution, revision: options.revision, modules, operationScheduling: "queued", workflow: {
    name: "nativeCartContextReads", resources, prepared,
    input: CartContextReadInput, output: CartContextReadOutput,
  } });
});
