import { Effect } from "effect";
import { OrderWorkflowEvents } from "@medusajs/framework/utils/portable";
import { archiveOrderWorkflow } from "@medusajs/core-flows/order/archive-orders";
import type { AtomicCommerceEvents } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { OrderArchiveInput, compileOrderStatusContracts, decodeOrderArchiveIds } from "../../modules/order/input";
import { captureOrderMetadata } from "../../modules/order/schema";
import type { makeOrderArchiveCommands } from "../../modules/order/service";
import { captureWorkflowRecord } from "../../workflow/configuration";
import { orderedWorkflowIdEvents } from "../../workflow/events";
import { captureInstalledWorkflowModules, prepareAtomicWorkflowHost, type AtomicWorkflowExecution,
  type InstalledWorkflowModule } from "../../workflow/host";
import { workflowModuleDefinition } from "../../workflow/module";
import { prepareWorkflowResources } from "../../workflow/resources";

type OrderModule = Effect.Success<ReturnType<typeof makeOrderArchiveCommands>>["workflow"];

/** The native root's event IDs follow the raw request, including duplicates.
 * Module events/facts separately authenticate the actual changed Order rows. */
export const prepareOrderArchiveWorkflow = Effect.fn("Order.prepareArchive")(function* (input: {
  readonly execution: AtomicWorkflowExecution;
  readonly modules: { readonly order: InstalledWorkflowModule<OrderModule> };
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
  if (source?.name !== "flarex-order-archive" || source.profile !== "order.archive")
    return yield* Effect.fail(commerceError("invalidAuthority"));
  if (modules.order.logicalResources !== undefined || modules.order.logicalPublication !== undefined)
    return yield* Effect.fail(commerceError("unsupportedProfile"));
  const metadata = yield* captureOrderMetadata();
  const contracts = yield* Effect.fromResult(compileOrderStatusContracts(metadata.frame));
  const resources = yield* Effect.fromResult(prepareWorkflowResources({ order: { module: modules.order.module,
    methods: ["listOrders", "archive", "updateOrders"], graph: false } }, true));
  const prepared = yield* Effect.fromResult(archiveOrderWorkflow.prepare())
    .pipe(Effect.mapError(cause => commerceError("unsupportedProfile", cause)));
  const events = orderedWorkflowIdEvents(OrderWorkflowEvents.ARCHIVED, Effect.fn("Order.archiveEventIds")(function* (calls) {
    const archived = calls.calls(modules.order.module.methods.archive);
    if (archived.length !== 1 || calls.calls(modules.order.module.methods.listOrders).length !== 1 ||
      calls.calls(modules.order.module.methods.updateOrders).length !== 0) return yield* Effect.fail(commerceError("receiptMismatch"));
    return yield* Effect.fromResult(decodeOrderArchiveIds(archived[0]?.input));
  }));
  return yield* prepareAtomicWorkflowHost({ ...options, modules,
    operationScheduling: "queued", borrowedOperationScheduling: "queued",
    workflow: { name: "archiveOrderWorkflow", resources, prepared,
      input: OrderArchiveInput, output: contracts.Output, events } });
});
