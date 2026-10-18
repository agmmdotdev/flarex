import { Effect, Result, Schema } from "effect";
import { createFulfillmentWorkflow } from "@medusajs/core-flows/fulfillment/create-fulfillment";
import type { AtomicCommerceEvents } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { jsonEqual } from "flarex-protocol/json";
import { FulfillmentCreate, compileFulfillmentCreationContracts } from "../../modules/fulfillment/fulfillment-create-input";
import type { makeLocalFulfillmentCreationCommands } from "../../modules/fulfillment/fulfillment-create-service";
import { captureFulfillmentCreationMetadata } from "../../modules/fulfillment/shipping-profile-schema";
import type { makeStockLocationUpdateCommands } from "../../modules/stock-location/update-service";
import { captureWorkflowRecord } from "../../workflow/configuration";
import { internalModuleWorkflowEvents } from "../../workflow/events";
import { prepareAtomicWorkflowHost, captureInstalledWorkflowModules, type AtomicWorkflowExecution,
  type InstalledWorkflowModule } from "../../workflow/host";
import { workflowModuleDefinition } from "../../workflow/module";
import { fulfillmentCreationResources, fulfillmentCreationCommandMs } from "../../workflow/policy";
import { prepareWorkflowResources } from "../../workflow/resources";

type Fulfillment = Effect.Success<ReturnType<typeof makeLocalFulfillmentCreationCommands>>["workflow"];
type StockLocation = Effect.Success<ReturnType<typeof makeStockLocationUpdateCommands>>["workflow"];
export type FulfillmentCreationModules = { readonly fulfillment: Fulfillment; readonly stockLocation: StockLocation };
export const FulfillmentCreationInput = FulfillmentCreate;

/** Both production and retained native callbacks receive the same finite
 * selection. Location reads expose only Query, without Stock Location methods. */
export function prepareFulfillmentCreationResources(input: FulfillmentCreationModules) {
  return Result.gen(function* () {
    const modules = yield* captureWorkflowRecord(input);
    if (Object.keys(modules).length !== 2) return yield* Result.fail(commerceError("unsupportedProfile"));
    for (const [key, name, profile] of [
      ["fulfillment", "flarex-fulfillment-create", "fulfillment-create"],
      ["stockLocation", "flarex-stock-location-update", "stock-location-update"],
    ] as const) {
      const source = workflowModuleDefinition(modules[key])?.source;
      if (source === undefined || source.name !== name || source.profile !== profile)
        return yield* Result.fail(commerceError("invalidAuthority"));
    }
    return yield* prepareWorkflowResources({
      fulfillment: { module: modules.fulfillment, methods: ["createFulfillment", "cancelFulfillment"], graph: false },
      stockLocation: { module: modules.stockLocation, methods: [], graph: true, expose: false },
    }, true);
  });
}

/** The genuine singleton Location query, Manual creation and retained native
 * cancellation borrow one existing atomic settlement and publication owner. */
export const prepareFulfillmentCreationWorkflow = Effect.fn("Fulfillment.prepareCreation")(function* (input: {
  readonly execution: AtomicWorkflowExecution;
  readonly modules: { readonly [Key in keyof FulfillmentCreationModules]: InstalledWorkflowModule<FulfillmentCreationModules[Key]> };
  readonly revision: string;
  readonly subscribers: AtomicCommerceEvents["subscribers"];
}) {
  const options = yield* Effect.fromResult(captureWorkflowRecord(input));
  if (Object.keys(options).some(key => !["execution", "modules", "revision", "subscribers"].includes(key)))
    return yield* Effect.fail(commerceError("unsupportedProfile"));
  const registrations = yield* Effect.fromResult(captureWorkflowRecord(options.modules));
  const keys = ["fulfillment", "stockLocation"] as const;
  if (Object.keys(registrations).length !== keys.length) return yield* Effect.fail(commerceError("unsupportedProfile"));
  const installed = yield* Effect.fromResult(captureInstalledWorkflowModules(registrations, keys));
  const resources = yield* Effect.fromResult(prepareFulfillmentCreationResources({ fulfillment: installed.fulfillment.module,
    stockLocation: installed.stockLocation.module }));
  for (const module of Object.values(installed))
    if (module.logicalResources !== undefined && !jsonEqual(module.logicalResources, fulfillmentCreationResources))
      return yield* Effect.fail(commerceError("unsupportedProfile"));
  const select = <Module extends InstalledWorkflowModule>(binding: Module) => {
    const { logicalPublication: _publication, ...selected } = binding;
    return { ...selected, logicalResources: fulfillmentCreationResources };
  };
  const modules = { fulfillment: select(installed.fulfillment), stockLocation: select(installed.stockLocation) };
  const metadata = yield* captureFulfillmentCreationMetadata();
  const contracts = yield* Effect.fromResult(compileFulfillmentCreationContracts(metadata.frame));
  const output = Schema.JsonObject.check(Schema.makeFilter(value => Result.isSuccess(contracts.decodeOutput(value))));
  const prepared = yield* Effect.fromResult(createFulfillmentWorkflow.prepare())
    .pipe(Effect.mapError(cause => commerceError("unsupportedProfile", cause)));
  return yield* prepareAtomicWorkflowHost({ ...options, modules, operationScheduling: "queued",
    requestCallLimit: fulfillmentCreationResources.calls, requestEventLimit: fulfillmentCreationResources.eventMessages,
    requestByteLimit: fulfillmentCreationResources.commandBytes, requestCommandMs: fulfillmentCreationCommandMs,
    workflow: { name: "createFulfillmentWorkflow", resources, prepared, input: FulfillmentCreationInput, output,
      events: internalModuleWorkflowEvents } });
});
