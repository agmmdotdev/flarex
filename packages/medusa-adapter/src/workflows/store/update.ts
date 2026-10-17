import { Effect, Schema } from "effect";
import { updateStoresWorkflow } from "@medusajs/core-flows/store/update-stores";
import type { AtomicCommerceEvents } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { StoreUpdateData, StoreUpdateSelector } from "../../modules/store/update-input";
import { compileStoreCreationContracts, StoreCurrencyCreate } from "../../modules/store/create-input";
import type { makeStoreUpdateCommands } from "../../modules/store/update-service";
import { captureStoreMetadata } from "../../modules/store/schema";
import type { makeLocalPricingCommands } from "../../modules/pricing/service";
import { captureWorkflowRecord } from "../../workflow/configuration";
import { internalModuleWorkflowEvents } from "../../workflow/events";
import { prepareAtomicWorkflowHost, captureInstalledWorkflowModules, type AtomicWorkflowExecution,
  type InstalledWorkflowModule } from "../../workflow/host";
import { workflowModuleDefinition } from "../../workflow/module";
import { prepareWorkflowResources } from "../../workflow/resources";
import { storeUpdateResources } from "../../workflow/policy";

type Store = Effect.Success<ReturnType<typeof makeStoreUpdateCommands>>["workflow"];
type Pricing = Effect.Success<ReturnType<typeof makeLocalPricingCommands>>["workflow"];
const Currency = Schema.Struct({ ...StoreCurrencyCreate.fields, is_tax_inclusive: Schema.optionalKey(Schema.Boolean) });
export const StoreUpdateWorkflowInput = Schema.Struct({ selector: StoreUpdateSelector, update: Schema.Struct({
  ...StoreUpdateData.fields,
  supported_currencies: Schema.optionalKey(Schema.Array(Currency).pipe(Schema.mutable).check(Schema.isMaxLength(2))),
}) });

/** Native Store selection/normalization and RAW Pricing preferences share the
 * trusted attempt. Child reconstitution remains authenticated by its owner. */
export const prepareStoreUpdateWorkflow = Effect.fn("Store.prepareUpdate")(function* (input: {
  readonly execution: AtomicWorkflowExecution;
  readonly modules: { readonly store: InstalledWorkflowModule<Store>; readonly pricing: InstalledWorkflowModule<Pricing> };
  readonly revision: string;
  readonly subscribers: AtomicCommerceEvents["subscribers"];
}) {
  const options = yield* Effect.fromResult(captureWorkflowRecord(input));
  if (Object.keys(options).some(key => !["execution", "modules", "revision", "subscribers"].includes(key)))
    return yield* Effect.fail(commerceError("unsupportedProfile"));
  const registrations = yield* Effect.fromResult(captureWorkflowRecord(options.modules));
  if (Object.keys(registrations).length !== 2) return yield* Effect.fail(commerceError("unsupportedProfile"));
  const modules = yield* Effect.fromResult(captureInstalledWorkflowModules(registrations, ["store", "pricing"]));
  for (const [module, name, profile] of [
    [modules.store.module, "flarex-store-update", "store-update"],
    [modules.pricing.module, "flarex-pricing-local", "pricing-store-preferences"],
  ] as const) {
    const definition = workflowModuleDefinition(module);
    if (definition === undefined || definition.source.name !== name || definition.source.profile !== profile)
      return yield* Effect.fail(commerceError("invalidAuthority"));
  }
  const metadata = yield* captureStoreMetadata();
  const contracts = yield* Effect.fromResult(compileStoreCreationContracts(metadata.frame));
  const resources = yield* Effect.fromResult(prepareWorkflowResources({
    store: { module: modules.store.module, methods: ["listStores", "updateStores", "upsertStores"], graph: false },
    pricing: { module: modules.pricing.module, methods: ["listPricePreferences", "upsertPricePreferences", "deletePricePreferences"], graph: false },
  }, true));
  const prepared = yield* Effect.fromResult(updateStoresWorkflow.prepare())
    .pipe(Effect.mapError(cause => commerceError("unsupportedProfile", cause)));
  return yield* prepareAtomicWorkflowHost({ ...options, modules, operationScheduling: "queued", borrowedOperationScheduling: "queued",
    executionIsolation: "scopeExclusive", requestCallLimit: storeUpdateResources.calls,
    workflow: { name: "updateStoresWorkflow", resources, prepared,
      input: StoreUpdateWorkflowInput, output: contracts.Output, events: internalModuleWorkflowEvents } });
});
