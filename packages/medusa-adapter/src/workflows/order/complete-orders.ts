import { Effect, Result, Schema } from "effect";
import { OrderWorkflowEvents } from "@medusajs/framework/utils/portable";
import { completeOrderWorkflow } from "@medusajs/core-flows/order/complete-orders";
import type { AtomicCommerceEvents } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { OrderCompletionInput, compileOrderStatusContracts, decodeOrderCompletionIds } from "../../modules/order/input";
import { captureOrderMetadata } from "../../modules/order/schema";
import type { makeOrderCompletionCommands } from "../../modules/order/service";
import { commerceDecoder } from "../../value/decoder";
import { captureCommerceInput } from "../../value/input";
import { captureWorkflowRecord } from "../../workflow/configuration";
import { orderedWorkflowIdEvents } from "../../workflow/events";
import { captureInstalledWorkflowModules, prepareAtomicWorkflowHost, type AtomicWorkflowExecution,
  type InstalledWorkflowModule } from "../../workflow/host";
import { workflowModuleDefinition } from "../../workflow/module";
import { prepareWorkflowResources, type NativeWorkflowContext, type NativeWorkflowResources } from "../../workflow/resources";

type OrderModule = Effect.Success<ReturnType<typeof makeOrderCompletionCommands>>["workflow"];
type Contracts = Result.Result.Success<ReturnType<typeof compileOrderStatusContracts>>;
type Selections = { readonly order: { readonly module: OrderModule;
  readonly methods: readonly ["listOrders", "completeOrder", "updateOrders"]; readonly graph: false } };
type Resources = NativeWorkflowResources<Selections, true>;

export interface OrderCompletionHookInput {
  readonly orders: Result.Result.Success<ReturnType<Contracts["decodeRows"]>>;
  readonly additional_data?: JsonObject;
}
export interface OrderCompletionHooks {
  readonly ordersCompleted?: (input: OrderCompletionHookInput,
    context: NativeWorkflowContext<Resources>) => unknown | Promise<unknown>;
}

/** Native completion and its trusted finite hook borrow one outer settlement.
 * The hook may read Orders; additional status writes fail receipt validation. */
export const prepareOrderCompletionWorkflow = Effect.fn("Order.prepareCompletion")(function* (input: {
  readonly execution: AtomicWorkflowExecution;
  readonly modules: { readonly order: InstalledWorkflowModule<OrderModule> };
  readonly revision: string;
  readonly subscribers: AtomicCommerceEvents["subscribers"];
  readonly hooks?: OrderCompletionHooks;
}) {
  const options = yield* Effect.fromResult(captureWorkflowRecord(input));
  if (Object.keys(options).some(key => !["execution", "modules", "revision", "subscribers", "hooks"].includes(key)))
    return yield* Effect.fail(commerceError("unsupportedProfile"));
  const registrations = yield* Effect.fromResult(captureWorkflowRecord(options.modules));
  if (Object.keys(registrations).length !== 1) return yield* Effect.fail(commerceError("unsupportedProfile"));
  const modules = yield* Effect.fromResult(captureInstalledWorkflowModules(registrations, ["order"]));
  const source = workflowModuleDefinition(modules.order.module)?.source;
  if (source?.name !== "flarex-order-complete" || source.profile !== "order.complete")
    return yield* Effect.fail(commerceError("invalidAuthority"));
  if (modules.order.logicalResources !== undefined || modules.order.logicalPublication !== undefined)
    return yield* Effect.fail(commerceError("unsupportedProfile"));
  const metadata = yield* captureOrderMetadata();
  const contracts = yield* Effect.fromResult(compileOrderStatusContracts(metadata.frame));
  const resources = yield* Effect.fromResult(prepareWorkflowResources({ order: { module: modules.order.module,
    methods: ["listOrders", "completeOrder", "updateOrders"], graph: false } }, true));
  const decodeHookShape = commerceDecoder(Schema.Struct({ orders: contracts.Output,
    additional_data: Schema.optionalKey(Schema.JsonObject) }), "invalidInput");
  const decodeHook = (value: unknown) => captureCommerceInput(value).pipe(Result.flatMap(decodeHookShape));
  const registeredHooks = yield* Effect.fromResult(captureWorkflowRecord(options.hooks ?? {}));
  if (Object.keys(registeredHooks).some(name => name !== "ordersCompleted") ||
    registeredHooks.ordersCompleted !== undefined && typeof registeredHooks.ordersCompleted !== "function")
    return yield* Effect.fail(commerceError("unsupportedProfile"));
  const handler = registeredHooks.ordersCompleted;
  type Hooks = NonNullable<Parameters<typeof completeOrderWorkflow.prepare>[0]>;
  const hooks: Hooks = handler === undefined ? {} : { ordersCompleted: resources.callback((value: unknown, context) =>
    decodeHook(value).pipe(Result.match({ onFailure: error => Promise.reject(error), onSuccess: value => handler(value, context) }))) };
  const prepared = yield* Effect.fromResult(completeOrderWorkflow.prepare(hooks))
    .pipe(Effect.mapError(cause => commerceError("unsupportedProfile", cause)));
  const events = orderedWorkflowIdEvents(OrderWorkflowEvents.COMPLETED, Effect.fn("Order.completeEventIds")(function* (calls) {
    const completed = calls.calls(modules.order.module.methods.completeOrder);
    if (completed.length !== 1 || calls.calls(modules.order.module.methods.listOrders).length < 1 ||
      calls.calls(modules.order.module.methods.updateOrders).length !== 0)
      return yield* Effect.fail(commerceError("receiptMismatch"));
    return yield* Effect.fromResult(decodeOrderCompletionIds(completed[0]?.input));
  }));
  return yield* prepareAtomicWorkflowHost({ ...options, modules,
    operationScheduling: "queued", borrowedOperationScheduling: "queued",
    workflow: { name: "completeOrderWorkflow", resources, prepared,
      input: OrderCompletionInput, output: contracts.Output, events } });
});
