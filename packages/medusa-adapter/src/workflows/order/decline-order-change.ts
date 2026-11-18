import { Effect, Schema } from "effect";
import { declineOrderChangeWorkflow } from "@medusajs/core-flows/order/decline-order-change";
import type { AtomicCommerceEvents } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { OrderChangeDeclineInput } from "../../modules/order/change-decline-input";
import type { makeOrderChangeDeclineCommands } from "../../modules/order/change-decline-service";
import { captureWorkflowRecord } from "../../workflow/configuration";
import { internalModuleWorkflowEvents } from "../../workflow/events";
import { captureInstalledWorkflowModules, prepareAtomicWorkflowHost, type AtomicWorkflowExecution,
  type InstalledWorkflowModule } from "../../workflow/host";
import { workflowModuleDefinition } from "../../workflow/module";
import { prepareWorkflowResources } from "../../workflow/resources";

type Order = Effect.Success<ReturnType<typeof makeOrderChangeDeclineCommands>>["workflow"];

/** Native Change decline and its exact retained inverse borrow one Order
 * participant under the existing atomic settlement and replay owner. */
export const prepareOrderChangeDeclineWorkflow = Effect.fn("Order.prepareChangeDecline")(function* (input: {
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
  if (source?.name !== "flarex-order-change-decline" || source.profile !== "order.changeDecline")
    return yield* Effect.fail(commerceError("invalidAuthority"));
  if (modules.order.logicalResources !== undefined || modules.order.logicalPublication !== undefined)
    return yield* Effect.fail(commerceError("unsupportedProfile"));
  const resources = yield* Effect.fromResult(prepareWorkflowResources({ order: { module: modules.order.module,
    methods: ["retrieveOrderChange", "declineOrderChange", "restoreOrderChangeDecline"], graph: false } }, true));
  const prepared = yield* Effect.fromResult(declineOrderChangeWorkflow.prepare())
    .pipe(Effect.mapError(cause => commerceError("unsupportedProfile", cause)));
  return yield* prepareAtomicWorkflowHost({ ...options, modules,
    operationScheduling: "queued", borrowedOperationScheduling: "queued",
    workflow: { name: "declineOrderChangeWorkflow", resources, prepared,
      input: OrderChangeDeclineInput, output: Schema.Null, events: internalModuleWorkflowEvents } });
});
