import { Effect, Result, Schema } from "effect";
import { createStep, createWorkflow, StepResponse, WorkflowResponse, type WorkflowData } from "@medusajs/workflows-sdk";
import { completeOrderWorkflow } from "@medusajs/core-flows/order/complete-orders";
import { makeOrderCompletionCommands } from "../../src/modules/order/service";
import { OrderCompletionInput, OrderCompletionStatuses, decodeOrderCompletionIds, decodeOrderCompletionStatuses } from "../../src/modules/order/input";
import { prepareOrderCompletionWorkflow } from "../../src/workflows/order/complete-orders";
import { prepareAtomicWorkflowHost } from "../../src/workflow/host";
import { prepareWorkflowResources } from "../../src/workflow/resources";
import { internalModuleWorkflowEvents, orderedWorkflowIdEvents } from "../../src/workflow/events";
import type { CorePersistenceFixture } from "../../../persistence-postgres/test/core/fixture";
import { orderFixtureHosts, prepareCoreOrderFixture, type CoreOrderInitialRow } from "./core-order-fixture";
import { orderCompletionRows } from "./order-completion-rows";

export const orderCompletionSubscriberId = "native-order-completion";

type Input = typeof OrderCompletionInput.Type;
const node = Result.getOrThrow(completeOrderWorkflow.prepare()).nodes.find(value => value.name === "complete-orders");
if (node?.kind !== "step" || node.compensation !== "transactionCovered" || node.compensate === undefined)
  throw new Error("Missing genuine retained native Order completion callbacks");
const retained = { invoke: node.invoke, compensate: node.compensate };

/** Reuse the existing Order model install, initialization and inventory owner.
 * Every completion operation below uses its independent confined service. */
export async function prepareCoreOrderCompletion(driver: "pglite" | "postgres", close: (cleanup: () => Promise<void>) => void,
  rows: readonly CoreOrderInitialRow[] = orderCompletionRows(), physical?: CorePersistenceFixture) {
  const order = await Effect.runPromise(makeOrderCompletionCommands());
  const base = await prepareCoreOrderFixture(driver, close, order.commands, rows, physical);
  const modules = { order: { module: order.workflow, nativeStorage: base.source } };
  const options: Parameters<typeof prepareOrderCompletionWorkflow>[0] = { execution: base.execution, modules,
    revision: "7".repeat(64), subscribers: [{ id: orderCompletionSubscriberId, revision: "8".repeat(64) }] };
  const resources = Result.getOrThrow(prepareWorkflowResources({ order: { module: order.workflow,
    methods: ["listOrders", "completeOrder", "updateOrders"], graph: false } }, true));
  const { own, closeCaseHosts } = orderFixtureHosts(close);
  const prepare = async (hooks: NonNullable<typeof options.hooks> = {}) =>
    own(await Effect.runPromise(prepareOrderCompletionWorkflow({ ...options, hooks })));
  const prepareForward = async (roundtrip = false) => {
    const step = createStep("probe-real-completion-forward", resources.callback(async (value: Input, context) => {
      const response = await retained.invoke(value, context);
      if (!(response instanceof StepResponse)) throw new Error("Missing genuine Order completion StepResponse");
      const statuses = Result.getOrThrow(decodeOrderCompletionStatuses(response.compensateInput));
      if (roundtrip) await retained.compensate(response.compensateInput, context);
      return { output: response.output, statuses };
    }));
    const flow = createWorkflow("probe-real-completion-forward-root", (value: WorkflowData<Input>) => new WorkflowResponse(step(value)));
    return own(await Effect.runPromise(prepareAtomicWorkflowHost({ ...options, operationScheduling: "queued", borrowedOperationScheduling: "queued",
      workflow: { name: "probeOrderCompletionForward", resources, prepared: Result.getOrThrow(flow.prepare()), input: OrderCompletionInput,
        output: Schema.Struct({ output: order.contracts.Output, statuses: OrderCompletionStatuses }), events: internalModuleWorkflowEvents } })));
  };
  const prepareInverse = async () => {
    const step = createStep("probe-real-completion-inverse", resources.callback(async (statuses: typeof OrderCompletionStatuses.Type, context) => {
      await retained.compensate(statuses, context); return new StepResponse(null);
    }));
    const flow = createWorkflow("probe-real-completion-inverse-root", (value: WorkflowData<typeof OrderCompletionStatuses.Type>) => new WorkflowResponse(step(value)));
    return own(await Effect.runPromise(prepareAtomicWorkflowHost({ ...options, operationScheduling: "queued", borrowedOperationScheduling: "queued",
      workflow: { name: "probeOrderCompletionInverse", resources, prepared: Result.getOrThrow(flow.prepare()), input: OrderCompletionStatuses,
        output: Schema.Null, events: internalModuleWorkflowEvents } })));
  };
  const lateFailure = new Error("Late parent failure after genuine native Order completion");
  const prepareLateFailure = async () => {
    const fail = createStep("probe-late-completion-parent", resources.callback(async (_output: unknown) => { throw lateFailure; }));
    const flow = createWorkflow("probe-late-completion-parent-root", (value: WorkflowData<Input>) =>
      new WorkflowResponse(fail(completeOrderWorkflow.runAsStep({ input: value }))));
    const events = orderedWorkflowIdEvents("order.completed", Effect.fn("OrderProbe.completedIds")(function* (calls) {
      const completed = calls.calls(order.workflow.methods.completeOrder);
      if (completed.length !== 1) throw new Error("Missing genuine Order completion call");
      return yield* Effect.fromResult(decodeOrderCompletionIds(completed[0]?.input));
    }));
    return own(await Effect.runPromise(prepareAtomicWorkflowHost({ ...options, operationScheduling: "queued", borrowedOperationScheduling: "queued",
      workflow: { name: "probeOrderCompletionLateParent", resources, prepared: Result.getOrThrow(flow.prepare()), input: OrderCompletionInput,
        output: order.contracts.Output, events } })));
  };
  return { ...base, order, modules, options, resources, prepare, prepareForward, prepareInverse, prepareLateFailure, lateFailure, closeCaseHosts };
}
