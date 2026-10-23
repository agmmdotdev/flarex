import { Effect, Schema } from "effect";
import { cancelOrderChangeWorkflow } from "@medusajs/core-flows/order/cancel-order-change";
import type { AtomicCommerceEvents } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { OrderChangeCancellationInput } from "../../modules/order/change-cancellation-input";
import type { makeOrderChangeCancellationCommands } from "../../modules/order/change-cancellation-service";
import { captureWorkflowRecord } from "../../workflow/configuration";
import { internalModuleWorkflowEvents } from "../../workflow/events";
import { captureInstalledWorkflowModules, prepareAtomicWorkflowHost, type AtomicWorkflowExecution,
  type InstalledWorkflowModule } from "../../workflow/host";
import { workflowModuleDefinition } from "../../workflow/module";
import { prepareWorkflowResources } from "../../workflow/resources";

type Order = Effect.Success<ReturnType<typeof makeOrderChangeCancellationCommands>>["workflow"];

/** Native Change cancellation and its exact retained inverse borrow one Order
 * participant under the existing atomic settlement and replay owner. */
export const prepareOrderChangeCancellationWorkflow = Effect.fn("Order.prepareChangeCancellation")(function* (input: {
  readonly execution: AtomicWorkflowExecution;
  readonly modules: { readonly order: InstalledWorkflowModule<Order> };
  readonly revision: string;
  readonly subscribers: AtomicCommerceEvents["subscribers"];
}) {
  const options = yield* Effect.fromResult(captureWorkflowRecord(input));
  if (Object.keys(options).some(key => !["execution", "modules", "revision", "subscribers"].includes(key)))
    return yield* Effect.fail(commerceError("unsupportedProfile"));
  const registrations = yield* Effect.fromResult(captureWorkflowRecord(options.modules));
  if (Object.keys(registrations).length !== 1) return yield* Effect.fail(commerceError("unsupportedProfile"));
  const modules = yield* Effect.fromResult(captureInstalledWorkflowModules(registrations, ["order"]));
  const source = workflowModuleDefinition(modules.order.module)?.source;
  if (source?.name !== "flarex-order-change-cancellation" || source.profile !== "order.changeCancellation")
    return yield* Effect.fail(commerceError("invalidAuthority"));
  if (modules.order.logicalResources !== undefined || modules.order.logicalPublication !== undefined)
    return yield* Effect.fail(commerceError("unsupportedProfile"));
  const resources = yield* Effect.fromResult(prepareWorkflowResources({ order: { module: modules.order.module,
    methods: ["retrieveOrderChange", "cancelOrderChange", "restoreOrderChangeCancellation"], graph: false } }, true));
  const prepared = yield* Effect.fromResult(cancelOrderChangeWorkflow.prepare())
    .pipe(Effect.mapError(cause => commerceError("unsupportedProfile", cause)));
  return yield* prepareAtomicWorkflowHost({ ...options, modules,
    operationScheduling: "queued", borrowedOperationScheduling: "queued",
    workflow: { name: "cancelOrderChangeWorkflow", resources, prepared,
      input: OrderChangeCancellationInput, output: Schema.Null, events: internalModuleWorkflowEvents } });
});
