import { Effect, Result, Schema } from "effect";
import { createStep, createWorkflow, StepResponse, WorkflowResponse, type WorkflowData } from "@medusajs/workflows-sdk";
import { deleteOrderChangeWorkflow } from "@medusajs/core-flows/order/delete-order-change";
import { makeOrderChangeDeletionCommands } from "../../src/modules/order/change-deletion-service";
import { OrderChangeDeletionIds, OrderChangeDeletionOutput } from "../../src/modules/order/change-deletion-input";
import { OrderChangeDeletionInput, prepareOrderChangeDeletionWorkflow } from "../../src/workflows/order/delete-order-change";
import { prepareAtomicWorkflowHost } from "../../src/workflow/host";
import { prepareWorkflowResources } from "../../src/workflow/resources";
import { internalModuleWorkflowEvents } from "../../src/workflow/events";
import { prepareLogicalOrderFixture, type OrderFixtureShared, type OrderInitialRow } from "./logical-order-fixture";
import { orderChangeUpdateRows, orderChangeUpdateStamp } from "./logical-order-change-update-fixture";

export type { OrderInitialRow } from "./logical-order-fixture";
export const orderChangeDeletionStamp = orderChangeUpdateStamp;

/** Canonical existing data only. Full native row shapes come from the existing
 * Change fixture; no fixture implements deletion, cascade or restoration. */
export function orderChangeDeletionGraph(prefix: string, count = 1, actionCount = 2,
  history: Readonly<{ orders?: boolean; changes?: boolean; actions?: number }> = {}) {
  const source = orderChangeUpdateRows(), parent = source.find(value => value.table === "order"),
    change = source.find(value => value.table === "order_change"), action = source.find(value => value.table === "order_change_action");
  if (parent === undefined || change === undefined || action === undefined) throw new Error("Missing complete Order Change fixture rows");
  const orders = Array.from({ length: count }, (_, index) => `${prefix}-order-${index}`),
    changes = Array.from({ length: count }, (_, index) => `${prefix}-change-${index}`),
    actions = changes.flatMap(id => Array.from({ length: actionCount }, (_, index) => `${id}-action-${index}`));
  const rows: OrderInitialRow[] = [
    ...orders.map((id, index) => ({ table: "order", row: { ...parent.row, id, display_id: 700 + index,
      custom_display_id: "existing-" + id, metadata: { protected: id }, deleted_at: history.orders === true ? orderChangeDeletionStamp : null } })),
    ...changes.map((id, index) => ({ table: "order_change", row: { ...change.row, id, order_id: orders[index]!,
      status: ["pending", "requested", "confirmed", "canceled"][index % 4]!, description: "Preserved " + id,
      metadata: { preserved: id, nested: { literal_empty: "" } }, deleted_at: history.changes === true ? orderChangeDeletionStamp : null } })),
    ...changes.flatMap((id, index) => Array.from({ length: actionCount }, (_, ordinal) => ({ table: "order_change_action", row: {
      ...action.row, id: `${id}-action-${ordinal}`, order_id: orders[index]!, order_change_id: id,
      ordering: 900 + index * actionCount + ordinal, version: index + 1, applied: ordinal % 2 === 0,
      amount: "3.1250000000000000000", raw_amount: { value: "3.1250000000000000000", precision: 20 },
      details: { preserved: id, ordinal, nested: { literal_empty: "", value: null } }, internal_note: "Preserved Action " + ordinal,
      deleted_at: ordinal < (history.actions ?? 0) ? orderChangeDeletionStamp : null,
    } }))),
  ];
  return { orders, changes, actions, rows };
}

type Input = typeof OrderChangeDeletionInput.Type;
const node = Result.getOrThrow(deleteOrderChangeWorkflow.prepare()).nodes.find(value => value.name === "delete-order-change");
if (node?.kind !== "step" || node.compensation !== "transactionCovered" || node.compensate === undefined)
  throw new Error("Missing genuine retained native Delete Order Change callbacks");
const retained = { invoke: node.invoke, compensate: node.compensate };

/** Reuse complete Order initialization and observation. Every mutation calls the
 * retained genuine SDK callback against the confined native Order service. */
export async function prepareLogicalOrderChangeDeletion(driver: "pglite" | "postgres", close: (cleanup: () => Promise<void>) => void,
  rows: readonly OrderInitialRow[] = orderChangeDeletionGraph("order-change-delete").rows, shared?: OrderFixtureShared) {
  const order = await Effect.runPromise(makeOrderChangeDeletionCommands());
  const base = await prepareLogicalOrderFixture(driver, close, order.commands, "order-change-deletion", rows, shared);
  const modules = { order: { module: order.workflow, logicalStorage: base.logicalStorage } };
  const options: Parameters<typeof prepareOrderChangeDeletionWorkflow>[0] = { execution: base.execution, modules,
    revision: "d".repeat(64), subscribers: [{ id: "native-order-change-deletion", revision: "e".repeat(64) }] };
  const resources = Result.getOrThrow(prepareWorkflowResources({ order: { module: order.workflow,
    methods: ["softDeleteOrderChanges", "restoreOrderChanges"], graph: false } }, true));
  const hosts: Array<() => Promise<void>> = [];
  const own = <H extends { readonly close: Effect.Effect<void> }>(host: H) => { hosts.push(() => Effect.runPromise(host.close)); return host; };
  const closeCaseHosts = async () => { for (const dispose of hosts.splice(0).reverse()) await dispose(); };
  close(closeCaseHosts);
  const prepare = async () => own(await Effect.runPromise(prepareOrderChangeDeletionWorkflow(options)));
  const prepareForward = async (roundtrip = false) => {
    const step = createStep("probe-real-change-delete-forward", resources.callback(async (value: Input, context) => {
      const original = structuredClone(value), response = await retained.invoke(value, context);
      if (!(response instanceof StepResponse)) throw new Error("Missing genuine Delete Order Change StepResponse");
      const retainedIds = Schema.decodeUnknownSync(OrderChangeDeletionIds)(response.compensateInput);
      if (roundtrip) await retained.compensate(response.compensateInput, context);
      if (JSON.stringify(value) !== JSON.stringify(original)) throw new Error("Native deletion mutated its raw input");
      return { output: response.output, retainedIds };
    }));
    const flow = createWorkflow("probe-real-change-delete-forward-root", (value: WorkflowData<Input>) => new WorkflowResponse(step(value)));
    return own(await Effect.runPromise(prepareAtomicWorkflowHost({ ...options, operationScheduling: "queued", borrowedOperationScheduling: "queued",
      workflow: { name: "probeOrderChangeDeletionForward", resources, prepared: Result.getOrThrow(flow.prepare()), input: OrderChangeDeletionInput,
        output: Schema.Struct({ output: OrderChangeDeletionOutput, retainedIds: OrderChangeDeletionIds }), events: internalModuleWorkflowEvents } })));
  };
  const prepareRestore = async () => {
    const step = createStep("probe-real-change-delete-inverse", resources.callback(async (value: Input, context) => {
      const original = structuredClone(value);
      await retained.compensate(value.ids, context);
      if (JSON.stringify(value) !== JSON.stringify(original)) throw new Error("Native deletion inverse mutated its raw input");
      return new StepResponse(null);
    }));
    const flow = createWorkflow("probe-real-change-delete-inverse-root", (value: WorkflowData<Input>) => new WorkflowResponse(step(value)));
    return own(await Effect.runPromise(prepareAtomicWorkflowHost({ ...options, operationScheduling: "queued", borrowedOperationScheduling: "queued",
      workflow: { name: "probeOrderChangeDeletionInverse", resources, prepared: Result.getOrThrow(flow.prepare()), input: OrderChangeDeletionInput,
        output: Schema.Null, events: internalModuleWorkflowEvents } })));
  };
  const lateFailure = new Error("Late parent failure after genuine native Order Change deletion");
  const prepareLateFailure = async () => {
    const fail = createStep("probe-late-change-delete-parent", resources.callback(async (_output: unknown) => { throw lateFailure; }));
    const flow = createWorkflow("probe-late-change-delete-parent-root", (value: WorkflowData<Input>) =>
      new WorkflowResponse(fail(deleteOrderChangeWorkflow.runAsStep({ input: value }))));
    return own(await Effect.runPromise(prepareAtomicWorkflowHost({ ...options, operationScheduling: "queued", borrowedOperationScheduling: "queued",
      workflow: { name: "probeOrderChangeDeletionLateParent", resources, prepared: Result.getOrThrow(flow.prepare()), input: OrderChangeDeletionInput,
        output: Schema.Null, events: internalModuleWorkflowEvents } })));
  };
  let escaped: (() => Promise<unknown>) | undefined;
  const prepareDeniedSibling = async () => {
    const step = createStep("probe-change-delete-denied-sibling", resources.callback(async (value: Input, context) => {
      escaped = () => context.resources.order.softDeleteOrderChanges(value.ids);
      try { context.container.resolve("payment"); } catch { /* A caught refusal remains sticky at its owner. */ }
      await retained.invoke(value, context); return new StepResponse(null);
    }));
    const flow = createWorkflow("probe-change-delete-denied-sibling-root", (value: WorkflowData<Input>) => new WorkflowResponse(step(value)));
    return own(await Effect.runPromise(prepareAtomicWorkflowHost({ ...options, operationScheduling: "queued", borrowedOperationScheduling: "queued",
      workflow: { name: "probeOrderChangeDeletionDeniedSibling", resources, prepared: Result.getOrThrow(flow.prepare()), input: OrderChangeDeletionInput,
        output: Schema.Null, events: internalModuleWorkflowEvents } })));
  };
  return { ...base, order, modules, options, resources, prepare, prepareForward, prepareRestore, prepareLateFailure, lateFailure,
    prepareDeniedSibling, closeCaseHosts, callEscaped: () => {
      if (escaped === undefined) throw new Error("No captured Order Change deletion method"); return escaped();
    } };
}
