import { Effect, Schema } from "effect";
import { deleteOrderChangeWorkflow } from "@medusajs/core-flows/order/delete-order-change";
import type { AtomicCommerceEvents } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { OrderChangeDeletionIds } from "../../modules/order/change-deletion-input";
import type { makeOrderChangeDeletionCommands } from "../../modules/order/change-deletion-service";
import { captureWorkflowRecord } from "../../workflow/configuration";
import { internalModuleWorkflowEvents } from "../../workflow/events";
import { captureInstalledWorkflowModules, prepareAtomicWorkflowHost, type AtomicWorkflowExecution,
  type InstalledWorkflowModule } from "../../workflow/host";
import { workflowModuleDefinition } from "../../workflow/module";
import { prepareWorkflowResources } from "../../workflow/resources";

type Order = Effect.Success<ReturnType<typeof makeOrderChangeDeletionCommands>>["workflow"];
export const OrderChangeDeletionInput = Schema.Struct({ ids: OrderChangeDeletionIds });

/** The retained native inverse restores raw requested roots and their complete
 * Action closure. The trusted outer owner settles rollback and replay. */
export const prepareOrderChangeDeletionWorkflow = Effect.fn("Order.prepareChangeDeletion")(function* (input: {
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
  if (source?.name !== "flarex-order-change-deletion" || source.profile !== "order.changeDeletion")
    return yield* Effect.fail(commerceError("invalidAuthority"));
  if (modules.order.logicalResources !== undefined || modules.order.logicalPublication !== undefined)
    return yield* Effect.fail(commerceError("unsupportedProfile"));
  const resources = yield* Effect.fromResult(prepareWorkflowResources({ order: { module: modules.order.module,
    methods: ["softDeleteOrderChanges", "restoreOrderChanges"], graph: false } }, true));
  const prepared = yield* Effect.fromResult(deleteOrderChangeWorkflow.prepare())
    .pipe(Effect.mapError(cause => commerceError("unsupportedProfile", cause)));
  return yield* prepareAtomicWorkflowHost({ ...options, modules,
    operationScheduling: "queued", borrowedOperationScheduling: "queued",
    workflow: { name: "deleteOrderChangeWorkflow", resources, prepared,
      input: OrderChangeDeletionInput, output: Schema.Null, events: internalModuleWorkflowEvents } });
});
