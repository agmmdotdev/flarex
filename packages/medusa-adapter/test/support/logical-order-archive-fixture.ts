import { Effect, Result, Schema } from "effect";
import { createStep, createWorkflow, StepResponse, WorkflowResponse, type WorkflowData } from "@medusajs/workflows-sdk";
import { archiveOrderWorkflow } from "@medusajs/core-flows/order/archive-orders";
import { makeOrderArchiveCommands } from "../../src/modules/order/service";
import { OrderArchiveInput, OrderArchiveStatuses, decodeOrderArchiveIds, decodeOrderArchiveStatuses } from "../../src/modules/order/input";
import { prepareOrderArchiveWorkflow } from "../../src/workflows/order/archive-orders";
import { prepareAtomicWorkflowHost } from "../../src/workflow/host";
import { prepareWorkflowResources } from "../../src/workflow/resources";
import { internalModuleWorkflowEvents, orderedWorkflowIdEvents } from "../../src/workflow/events";
import { prepareLogicalOrderFixture, type OrderFixtureShared, type OrderInitialRow } from "./logical-order-fixture";
export type { OrderInitialRow } from "./logical-order-fixture";

export const orderArchiveStamp = "2020-02-03T04:05:06.000Z";
export const orderArchiveIds = ["order173-d", "order173-b", "order173-c", "order173-a"] as const;
export type OrderArchiveWorkflowInput = typeof OrderArchiveInput.Type;
const native = Result.getOrThrow(archiveOrderWorkflow.prepare());
const node = native.nodes.find(value => value.name === "archive-orders");
if (node?.kind !== "step" || node.compensation !== "transactionCovered" || node.compensate === undefined)
  throw new Error("Missing genuine retained native Order archive callbacks");
const retained = { invoke: node.invoke, compensate: node.compensate };

/** Explicit existing native serial values. This seed grants no Order creation
 * or serial allocation capability and contains no fixture business algorithm. */
export function orderArchiveRows(): readonly OrderInitialRow[] {
  return orderArchiveIds.map((id, index) => ({ table: "order", row: {
    id, display_id: 300 + index, custom_display_id: "existing-" + id, region_id: "reg-existing", customer_id: "cus-existing",
    version: index + 1, sales_channel_id: "sc-existing", status: index === 1 ? "canceled" : index === 2 ? "draft" : "completed",
    is_draft_order: index === 2, email: `existing-${index}@example.invalid`, currency_code: index % 2 ? "eur" : "usd",
    locale: "en-US", no_notification: index % 2 === 0, metadata: { ordinal: index, preserved: { owner: id } },
    canceled_at: index === 1 ? orderArchiveStamp : null, shipping_address_id: null, billing_address_id: null,
    created_at: orderArchiveStamp, updated_at: orderArchiveStamp, deleted_at: null,
  } }));
}

export async function prepareLogicalOrderArchive(driver: "pglite" | "postgres", close: (cleanup: () => Promise<void>) => void,
  rows: readonly OrderInitialRow[] = orderArchiveRows(),
  shared?: OrderFixtureShared) {
  const order = await Effect.runPromise(makeOrderArchiveCommands());
  const base = await prepareLogicalOrderFixture(driver, close, order.commands, "order-archive", rows, shared);
  const { fixture, definition, execution, snapshot, read, withStoredOrderResult } = base;
  const modules = { order: { module: order.workflow, logicalStorage: base.logicalStorage } }, revision = "3".repeat(64);
  const options: Parameters<typeof prepareOrderArchiveWorkflow>[0] = { execution, modules, revision,
    subscribers: [{ id: "native-order-archive-173", revision }] };
  const resources = Result.getOrThrow(prepareWorkflowResources({ order: { module: order.workflow,
    methods: ["listOrders", "archive", "updateOrders"], graph: false } }, true));
  const hosts: Array<() => Promise<void>> = [];
  const own = <H extends { readonly close: Effect.Effect<void> }>(host: H) => { hosts.push(() => Effect.runPromise(host.close)); return host; };
  const closeCaseHosts = async () => { for (const dispose of hosts.splice(0).reverse()) await dispose(); };
  close(closeCaseHosts);
  const prepare = async () => own(await Effect.runPromise(prepareOrderArchiveWorkflow(options)));
  const prepareForward = async (roundtrip = false) => {
    const step = createStep("probe173-real-archive-forward", resources.callback(async (value: OrderArchiveWorkflowInput, context) => {
      const response = await retained.invoke(value, context);
      if (!(response instanceof StepResponse)) throw new Error("Missing genuine Order archive StepResponse");
      const statuses = Result.getOrThrow(decodeOrderArchiveStatuses(response.compensateInput));
      if (roundtrip) await retained.compensate(response.compensateInput, context);
      return { output: response.output, statuses };
    }));
    const flow = createWorkflow("probe173-real-archive-forward-root", (value: WorkflowData<OrderArchiveWorkflowInput>) => new WorkflowResponse(step(value)));
    return own(await Effect.runPromise(prepareAtomicWorkflowHost({ ...options, operationScheduling: "queued", borrowedOperationScheduling: "queued",
      workflow: { name: "probeOrderArchiveForward", resources, prepared: Result.getOrThrow(flow.prepare()), input: OrderArchiveInput,
        output: Schema.Struct({ output: order.contracts.Output, statuses: OrderArchiveStatuses }), events: internalModuleWorkflowEvents } })));
  };
  const prepareInverse = async () => {
    const step = createStep("probe173-real-archive-inverse", resources.callback(async (statuses: typeof OrderArchiveStatuses.Type, context) => {
      await retained.compensate(statuses, context); return new StepResponse(null);
    }));
    const flow = createWorkflow("probe173-real-archive-inverse-root", (value: WorkflowData<typeof OrderArchiveStatuses.Type>) => new WorkflowResponse(step(value)));
    return own(await Effect.runPromise(prepareAtomicWorkflowHost({ ...options, operationScheduling: "queued", borrowedOperationScheduling: "queued",
      workflow: { name: "probeOrderArchiveInverse", resources, prepared: Result.getOrThrow(flow.prepare()), input: OrderArchiveStatuses,
        output: Schema.Null, events: internalModuleWorkflowEvents } })));
  };
  const lateFailure = new Error("Late parent failure after genuine native Order archive");
  const prepareLateFailure = async () => {
    const fail = createStep("probe173-late-order-parent", resources.callback(async (_output: unknown) => { throw lateFailure; }));
    const flow = createWorkflow("probe173-late-order-parent-root", (value: WorkflowData<OrderArchiveWorkflowInput>) =>
      new WorkflowResponse(fail(archiveOrderWorkflow.runAsStep({ input: value }))));
    const events = orderedWorkflowIdEvents("order.archived", Effect.fn("OrderProbe.archivedIds")(function* (calls) {
      const archived = calls.calls(order.workflow.methods.archive);
      if (archived.length !== 1) throw new Error("Missing genuine Order archive call");
      return yield* Effect.fromResult(decodeOrderArchiveIds(archived[0]?.input));
    }));
    return own(await Effect.runPromise(prepareAtomicWorkflowHost({ ...options, operationScheduling: "queued", borrowedOperationScheduling: "queued",
      workflow: { name: "probeOrderArchiveLateParent", resources, prepared: Result.getOrThrow(flow.prepare()), input: OrderArchiveInput,
        output: order.contracts.Output, events } })));
  };
  return { fixture, definition, order, options, modules, execution, resources, lateFailure, prepare, prepareForward, prepareInverse,
    prepareLateFailure, closeCaseHosts, snapshot, read, withStoredOrderResult };
}
