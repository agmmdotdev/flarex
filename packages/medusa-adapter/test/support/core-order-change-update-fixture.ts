import { Effect, Result, Schema } from "effect";
import { createStep, createWorkflow, StepResponse, WorkflowResponse, type WorkflowData } from "@medusajs/workflows-sdk";
import { updateOrderChangesWorkflow } from "@medusajs/core-flows/order/update-order-changes";
import { makeOrderChangeUpdateCommands } from "../../src/modules/order/change-update-service";
import { OrderChangeUpdateInput } from "../../src/modules/order/change-update-input";
import { prepareOrderChangeUpdateWorkflow } from "../../src/workflows/order/update-order-changes";
import { prepareAtomicWorkflowHost } from "../../src/workflow/host";
import { prepareWorkflowResources } from "../../src/workflow/resources";
import { internalModuleWorkflowEvents } from "../../src/workflow/events";
import type { CorePersistenceFixture } from "../../../persistence-postgres/test/core/fixture";
import { prepareCoreOrderChangeFixture } from "./core-order-change-fixture";
import { orderChangeUpdateRows, orderChangeUpdateIds, type OrderInitialRow } from "./order-change-rows";

export function maximumOrderChangeUpdateInput(): typeof OrderChangeUpdateInput.Type {
  return Schema.decodeUnknownSync(OrderChangeUpdateInput)(orderChangeUpdateIds.map((id, index) => ({
    id, status: ["requested", "confirmed", "pending", "declined"][index], description: "Updated " + id,
    internal_note: index % 2 ? "" : null, requested_by: "actor-request", confirmed_by: "actor-confirm",
    declined_by: "actor-decline", declined_reason: index % 2 ? null : "Changed", canceled_by: "actor-cancel",
    carry_over_promotions: index % 2 === 1,
  })));
}
type Input = typeof OrderChangeUpdateInput.Type;
/** The authoring DTO is narrower than native DML's nullable scalar domain.
 * This parent-composition probe needs only its ordinary description branch. */
export const OrderChangeUpdateLateInput = Schema.Array(Schema.Struct({ id: Schema.String, description: Schema.String }))
  .pipe(Schema.mutable).check(Schema.isMaxLength(4));
type LateInput = typeof OrderChangeUpdateLateInput.Type;
const node = Result.getOrThrow(updateOrderChangesWorkflow.prepare()).nodes.find(value => value.name === "update-order-changes");
if (node?.kind !== "step" || node.compensation !== "transactionCovered" || node.compensate === undefined)
  throw new Error("Missing genuine retained native Order Change update callbacks");
const retained = { invoke: node.invoke, compensate: node.compensate };

/** Only seed/observe native records here. Both forward and inverse execute the
 * actual retained SDK callbacks against their confined Order module. */
export async function prepareCoreOrderChangeUpdate(driver: "pglite" | "postgres", close: (cleanup: () => Promise<void>) => void,
  rows: readonly OrderInitialRow[] = orderChangeUpdateRows(), physical?: CorePersistenceFixture) {
  const order = await Effect.runPromise(makeOrderChangeUpdateCommands());
  const base = await prepareCoreOrderChangeFixture(driver, close, order.commands, rows, physical);
  const modules = { order: { module: order.workflow, nativeStorage: base.source } };
  const options: Parameters<typeof prepareOrderChangeUpdateWorkflow>[0] = { execution: base.execution, modules,
    revision: "9".repeat(64), subscribers: [{ id: "native-order-change-update", revision: "a".repeat(64) }] };
  const resources = Result.getOrThrow(prepareWorkflowResources({ order: { module: order.workflow,
    methods: ["listOrderChanges", "updateOrderChanges"], graph: false } }, true));
  const hosts: Array<() => Promise<void>> = [];
  const own = <H extends { readonly close: Effect.Effect<void> }>(host: H) => { hosts.push(() => Effect.runPromise(host.close)); return host; };
  const closeCaseHosts = async () => { for (const dispose of hosts.splice(0).reverse()) await dispose(); };
  close(closeCaseHosts);
  const prepare = async () => own(await Effect.runPromise(prepareOrderChangeUpdateWorkflow(options)));
  const prepareForward = async (roundtrip = false) => {
    const step = createStep("probe-real-change-update-forward", resources.callback(async (value: Input, context) => {
      const response = await retained.invoke(value, context);
      if (!(response instanceof StepResponse)) throw new Error("Missing genuine Order Change update StepResponse");
      const preimages = Result.getOrThrow(order.contracts.decodePreimages(response.compensateInput));
      if (roundtrip) await retained.compensate(response.compensateInput, context);
      return { output: response.output, preimages };
    }));
    const flow = createWorkflow("probe-real-change-update-forward-root", (value: WorkflowData<Input>) => new WorkflowResponse(step(value)));
    return own(await Effect.runPromise(prepareAtomicWorkflowHost({ ...options, operationScheduling: "queued", borrowedOperationScheduling: "queued",
      workflow: { name: "probeOrderChangeUpdateForward", resources, prepared: Result.getOrThrow(flow.prepare()), input: OrderChangeUpdateInput,
        output: Schema.Struct({ output: order.contracts.Output, preimages: OrderChangeUpdateInput }), events: internalModuleWorkflowEvents } })));
  };
  const prepareInverse = async () => {
    const step = createStep("probe-real-change-update-inverse", resources.callback(async (value: Input, context) => {
      await retained.compensate(value, context); return new StepResponse(null);
    }));
    const flow = createWorkflow("probe-real-change-update-inverse-root", (value: WorkflowData<Input>) => new WorkflowResponse(step(value)));
    return own(await Effect.runPromise(prepareAtomicWorkflowHost({ ...options, operationScheduling: "queued", borrowedOperationScheduling: "queued",
      workflow: { name: "probeOrderChangeUpdateInverse", resources, prepared: Result.getOrThrow(flow.prepare()), input: OrderChangeUpdateInput,
        output: Schema.Null, events: internalModuleWorkflowEvents } })));
  };
  const lateFailure = new Error("Late parent failure after genuine native Order Change update");
  const prepareLateFailure = async () => {
    const fail = createStep("probe-late-change-update-parent", resources.callback(async (_output: unknown) => { throw lateFailure; }));
    const flow = createWorkflow("probe-late-change-update-parent-root", (value: WorkflowData<LateInput>) =>
      new WorkflowResponse(fail(updateOrderChangesWorkflow.runAsStep({ input: value }))));
    return own(await Effect.runPromise(prepareAtomicWorkflowHost({ ...options, operationScheduling: "queued", borrowedOperationScheduling: "queued",
      workflow: { name: "probeOrderChangeUpdateLateParent", resources, prepared: Result.getOrThrow(flow.prepare()), input: OrderChangeUpdateLateInput,
        output: order.contracts.Output, events: internalModuleWorkflowEvents } })));
  };
  let escaped: (() => Promise<unknown>) | undefined;
  const prepareDeniedSibling = async () => {
    const step = createStep("probe-change-update-denied-sibling", resources.callback(async (value: Input, context) => {
      escaped = () => context.resources.order.listOrderChanges({ id: value.map(row => row.id) }, { select: ["id"], relations: [] });
      try { context.container.resolve("payment"); } catch { /* A caught refusal remains sticky at the authority owner. */ }
      return context.resources.order.updateOrderChanges(value);
    }));
    const flow = createWorkflow("probe-change-update-denied-sibling-root", (value: WorkflowData<Input>) => new WorkflowResponse(step(value)));
    return own(await Effect.runPromise(prepareAtomicWorkflowHost({ ...options, operationScheduling: "queued", borrowedOperationScheduling: "queued",
      workflow: { name: "probeOrderChangeUpdateDeniedSibling", resources, prepared: Result.getOrThrow(flow.prepare()), input: OrderChangeUpdateInput,
        output: order.contracts.Output, events: internalModuleWorkflowEvents } })));
  };
  return { ...base, order, modules, options, resources, prepare, prepareForward, prepareInverse, prepareLateFailure,
    lateFailure, prepareDeniedSibling, closeCaseHosts, readChanges: () => base.read(orderChangeUpdateIds),
    callEscaped: () => { if (escaped === undefined) throw new Error("No captured Order Change method"); return escaped(); } };
}
