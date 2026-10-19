import { Effect, Result, Schema } from "effect";
import { createFulfillmentWorkflow } from "@medusajs/core-flows/fulfillment/create-fulfillment";
import { createReturnFulfillmentWorkflow } from "@medusajs/core-flows/fulfillment/create-return-fulfillment";
import type { AtomicCommerceEvents } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError, type CommerceTransactionError } from "@flarex/persistence-postgres/internal/commerce-values";
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
import { prepareWorkflowResources, type PreparedWorkflowResources } from "../../workflow/resources";

type Fulfillment = Effect.Success<ReturnType<typeof makeLocalFulfillmentCreationCommands>>["workflow"];
type StockLocation = Effect.Success<ReturnType<typeof makeStockLocationUpdateCommands>>["workflow"];
export type FulfillmentCreationModules = { readonly fulfillment: Fulfillment; readonly stockLocation: StockLocation };
export const FulfillmentCreationInput = FulfillmentCreate;
type CreationKind = "ordinary" | "return";
export interface FulfillmentCreationWorkflowOptions {
  readonly execution: AtomicWorkflowExecution;
  readonly modules: { readonly [Key in keyof FulfillmentCreationModules]: InstalledWorkflowModule<FulfillmentCreationModules[Key]> };
  readonly revision: string;
  readonly subscribers: AtomicCommerceEvents["subscribers"];
}

// Each declaration must remain a static method tuple. The resource owner
// deliberately refuses unions in a declaration; select between whole profiles.
const ordinaryCreationResources = (modules: FulfillmentCreationModules) => prepareWorkflowResources({
  fulfillment: { module: modules.fulfillment, methods: ["createFulfillment", "cancelFulfillment"], graph: false },
  stockLocation: { module: modules.stockLocation, methods: [], graph: true, expose: false },
}, true);
const returnCreationResources = (modules: FulfillmentCreationModules) => prepareWorkflowResources({
  fulfillment: { module: modules.fulfillment, methods: ["createReturnFulfillment", "cancelFulfillment"], graph: false },
  stockLocation: { module: modules.stockLocation, methods: [], graph: true, expose: false },
}, true);
type CreationResources = Result.Result.Success<ReturnType<typeof ordinaryCreationResources>>
  | Result.Result.Success<ReturnType<typeof returnCreationResources>>;

/** Both production and retained native callbacks receive the same finite
 * selection. Location reads expose only Query, without Stock Location methods. */
export function selectFulfillmentCreationResources(input: FulfillmentCreationModules, kind: "ordinary"): ReturnType<typeof ordinaryCreationResources>;
export function selectFulfillmentCreationResources(input: FulfillmentCreationModules, kind: "return"): ReturnType<typeof returnCreationResources>;
export function selectFulfillmentCreationResources(input: FulfillmentCreationModules, kind: CreationKind): Result.Result<CreationResources, CommerceTransactionError>;
export function selectFulfillmentCreationResources(input: FulfillmentCreationModules, kind: CreationKind) {
  return Result.gen(function* () {
    if (kind !== "ordinary" && kind !== "return") return yield* Result.fail(commerceError("unsupportedProfile"));
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
    return kind === "return" ? yield* returnCreationResources(modules) : yield* ordinaryCreationResources(modules);
  });
}

/** The genuine singleton Location query, Manual creation and retained native
 * cancellation borrow one existing atomic settlement and publication owner. */
export const prepareFulfillmentCreationHost = Effect.fn("Fulfillment.prepareCreationHost")(function* (
  input: FulfillmentCreationWorkflowOptions, kind: CreationKind,
) {
  const options = yield* Effect.fromResult(captureWorkflowRecord(input));
  if (Object.keys(options).some(key => !["execution", "modules", "revision", "subscribers"].includes(key)))
    return yield* Effect.fail(commerceError("unsupportedProfile"));
  const registrations = yield* Effect.fromResult(captureWorkflowRecord(options.modules));
  const keys = ["fulfillment", "stockLocation"] as const;
  if (Object.keys(registrations).length !== keys.length) return yield* Effect.fail(commerceError("unsupportedProfile"));
  const installed = yield* Effect.fromResult(captureInstalledWorkflowModules(registrations, keys));
  // The outer host consumes the authenticated selection without authoring a
  // callback through it. Each facade keeps its own precise callback view.
  const resources: PreparedWorkflowResources = yield* Effect.fromResult(selectFulfillmentCreationResources({ fulfillment: installed.fulfillment.module,
    stockLocation: installed.stockLocation.module }, kind));
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
  const native = kind === "return" ? createReturnFulfillmentWorkflow : createFulfillmentWorkflow;
  const prepared = yield* Effect.fromResult(native.prepare())
    .pipe(Effect.mapError(cause => commerceError("unsupportedProfile", cause)));
  return yield* prepareAtomicWorkflowHost({ ...options, modules, operationScheduling: "queued",
    requestCallLimit: fulfillmentCreationResources.calls, requestEventLimit: fulfillmentCreationResources.eventMessages,
    requestByteLimit: fulfillmentCreationResources.commandBytes, requestCommandMs: fulfillmentCreationCommandMs,
    workflow: { name: kind === "return" ? "createReturnFulfillmentWorkflow" : "createFulfillmentWorkflow", resources, prepared, input: FulfillmentCreationInput, output,
      events: internalModuleWorkflowEvents } });
});
