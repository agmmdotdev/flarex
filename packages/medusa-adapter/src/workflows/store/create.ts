import { Effect, Schema } from "effect";
import { createStoresWorkflow } from "@medusajs/core-flows/store/create-stores";
import type { AtomicCommerceEvents } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { StoreCreate, StoreCurrencyCreate, compileStoreCreationContracts } from "../../modules/store/create-input";
import type { makeStoreCreationCommands } from "../../modules/store/create-service";
import { captureStoreMetadata } from "../../modules/store/schema";
import type { makeLocalPricingCommands } from "../../modules/pricing/service";
import { captureWorkflowRecord } from "../../workflow/configuration";
import { internalModuleWorkflowEvents } from "../../workflow/events";
import { prepareAtomicWorkflowHost, captureInstalledWorkflowModules, type AtomicWorkflowExecution,
  type InstalledWorkflowModule } from "../../workflow/host";
import { workflowModuleDefinition } from "../../workflow/module";
import { prepareWorkflowResources } from "../../workflow/resources";
import { storeCreationResources } from "../../workflow/policy";

type Store = Effect.Success<ReturnType<typeof makeStoreCreationCommands>>["workflow"];
type Pricing = Effect.Success<ReturnType<typeof makeLocalPricingCommands>>["workflow"];
const Currency = Schema.Struct({ ...StoreCurrencyCreate.fields, is_tax_inclusive: Schema.optionalKey(Schema.Boolean) });
const StoreInput = Schema.Struct({ ...StoreCreate.fields,
  supported_currencies: Schema.Array(Currency).pipe(Schema.mutable).check(Schema.isMaxLength(2)),
});
export const StoreCreationInput = Schema.Struct({ stores: Schema.Array(StoreInput).pipe(Schema.mutable).check(
  Schema.isMaxLength(4),
  Schema.makeFilter(stores => new Set(stores.flatMap(store => store.supported_currencies.map(currency => currency.currency_code))).size <= 4),
) });

/** The genuine Store root owns normalization and raw-key preference selection.
 * Both module participants borrow the existing outer settlement authority. */
export const prepareStoreCreationWorkflow = Effect.fn("Store.prepareCreation")(function* (input: {
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
    [modules.store.module, "flarex-store-create", "store-create"],
    [modules.pricing.module, "flarex-pricing-local", "pricing-price-preferences"],
  ] as const) {
    const definition = workflowModuleDefinition(module);
    if (definition === undefined || definition.source.name !== name || definition.source.profile !== profile)
      return yield* Effect.fail(commerceError("invalidAuthority"));
  }
  const metadata = yield* captureStoreMetadata();
  const contracts = yield* Effect.fromResult(compileStoreCreationContracts(metadata.frame));
  const resources = yield* Effect.fromResult(prepareWorkflowResources({
    store: { module: modules.store.module, methods: ["createStores", "deleteStores"], graph: false },
    pricing: { module: modules.pricing.module, methods: ["listPricePreferences", "upsertPricePreferences", "deletePricePreferences"], graph: false },
  }, true));
  const prepared = yield* Effect.fromResult(createStoresWorkflow.prepare())
    .pipe(Effect.mapError(cause => commerceError("unsupportedProfile", cause)));
  return yield* prepareAtomicWorkflowHost({ ...options, modules, operationScheduling: "queued", borrowedOperationScheduling: "queued",
    requestCallLimit: storeCreationResources.calls,
    workflow: { name: "createStoresWorkflow", resources, prepared,
      input: StoreCreationInput, output: contracts.Output, events: internalModuleWorkflowEvents } });
});
