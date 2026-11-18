import { Effect } from "effect";
import { updateOrderChangesWorkflow } from "@medusajs/core-flows/order/update-order-changes";
import type { AtomicCommerceEvents } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { OrderChangeUpdateInput, compileOrderChangeUpdateContracts } from "../../modules/order/change-update-input";
import type { makeOrderChangeUpdateCommands } from "../../modules/order/change-update-service";
import { captureOrderMetadata } from "../../modules/order/schema";
import { captureWorkflowRecord } from "../../workflow/configuration";
import { internalModuleWorkflowEvents } from "../../workflow/events";
import { captureInstalledWorkflowModules, prepareAtomicWorkflowHost, type AtomicWorkflowExecution,
  type InstalledWorkflowModule } from "../../workflow/host";
import { workflowModuleDefinition } from "../../workflow/module";
import { prepareWorkflowResources } from "../../workflow/resources";

type Order = Effect.Success<ReturnType<typeof makeOrderChangeUpdateCommands>>["workflow"];

/** The native scalar Change update and retained inverse borrow one confined
 * Order participant and the existing outer transaction owner. */
export const prepareOrderChangeUpdateWorkflow = Effect.fn("Order.prepareChangeUpdate")(function* (input: {
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
  if (source?.name !== "flarex-order-change-update" || source.profile !== "order.changeUpdate")
    return yield* Effect.fail(commerceError("invalidAuthority"));
  if (modules.order.logicalResources !== undefined || modules.order.logicalPublication !== undefined)
    return yield* Effect.fail(commerceError("unsupportedProfile"));
  const resources = yield* Effect.fromResult(prepareWorkflowResources({ order: { module: modules.order.module,
    methods: ["listOrderChanges", "updateOrderChanges"], graph: false } }, true));
  const prepared = yield* Effect.fromResult(updateOrderChangesWorkflow.prepare())
    .pipe(Effect.mapError(cause => commerceError("unsupportedProfile", cause)));
  const metadata = yield* captureOrderMetadata();
  const contracts = yield* Effect.fromResult(compileOrderChangeUpdateContracts(metadata.frame));
  return yield* prepareAtomicWorkflowHost({ ...options, modules,
    operationScheduling: "queued", borrowedOperationScheduling: "queued",
    workflow: { name: "updateOrderChangesWorkflow", resources, prepared,
      input: OrderChangeUpdateInput, output: contracts.Output, events: internalModuleWorkflowEvents } });
});
