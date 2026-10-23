import { Effect, Result, Schema } from "effect";
import { createStep, createWorkflow, StepResponse, WorkflowResponse, type WorkflowData } from "@medusajs/workflows-sdk";
import { cancelOrderChangeWorkflow } from "@medusajs/core-flows/order/cancel-order-change";
import { makeOrderChangeCancellationCommands } from "../../src/modules/order/change-cancellation-service";
import { OrderChangeCancellationInput } from "../../src/modules/order/change-cancellation-input";
import { prepareOrderChangeCancellationWorkflow } from "../../src/workflows/order/cancel-order-change";
import { prepareAtomicWorkflowHost } from "../../src/workflow/host";
import { prepareWorkflowResources } from "../../src/workflow/resources";
import { internalModuleWorkflowEvents } from "../../src/workflow/events";
import { prepareLogicalOrderFixture, type OrderFixtureShared, type OrderInitialRow } from "./logical-order-fixture";
import { orderChangeUpdateIds, orderChangeUpdateRows, orderChangeUpdateStamp } from "./logical-order-change-update-fixture";

export type { OrderInitialRow } from "./logical-order-fixture";
export const orderChangeCancellationIds = orderChangeUpdateIds;
export const orderChangeCancellationStamp = orderChangeUpdateStamp;
export function orderChangeCancellationRows(): readonly OrderInitialRow[] {
  return orderChangeUpdateRows().map(value => value.table === "order_change"
    ? { ...value, row: { ...value.row, status: value.row.id === orderChangeCancellationIds[1] ? "requested" : "pending" } } : value);
}

type Input = typeof OrderChangeCancellationInput.Type;
const node = Result.getOrThrow(cancelOrderChangeWorkflow.prepare()).nodes.find(value => value.name === "cancel-order-change");
if (node?.kind !== "step" || node.compensation !== "transactionCovered" || node.compensate === undefined)
  throw new Error("Missing genuine retained native Order Change cancellation callbacks");
const retained = { invoke: node.invoke, compensate: node.compensate };

/** Initialization and observation reuse the existing Order fixture. Every
 * mutation below uses the retained native cancellation callback and its inverse. */
export async function prepareLogicalOrderChangeCancellation(driver: "pglite" | "postgres", close: (cleanup: () => Promise<void>) => void,
  rows: readonly OrderInitialRow[] = orderChangeCancellationRows(), shared?: OrderFixtureShared) {
  const order = await Effect.runPromise(makeOrderChangeCancellationCommands());
  const base = await prepareLogicalOrderFixture(driver, close, order.commands, "order-change-cancellation", rows, shared);
  const modules = { order: { module: order.workflow, logicalStorage: base.logicalStorage } };
  const options: Parameters<typeof prepareOrderChangeCancellationWorkflow>[0] = { execution: base.execution, modules,
    revision: "b".repeat(64), subscribers: [{ id: "native-order-change-cancellation", revision: "c".repeat(64) }] };
  const resources = Result.getOrThrow(prepareWorkflowResources({ order: { module: order.workflow,
    methods: ["retrieveOrderChange", "cancelOrderChange", "restoreOrderChangeCancellation"], graph: false } }, true));
  const hosts: Array<() => Promise<void>> = [];
  const own = <H extends { readonly close: Effect.Effect<void> }>(host: H) => { hosts.push(() => Effect.runPromise(host.close)); return host; };
  const closeCaseHosts = async () => { for (const dispose of hosts.splice(0).reverse()) await dispose(); };
  close(closeCaseHosts);
  const prepare = async () => own(await Effect.runPromise(prepareOrderChangeCancellationWorkflow(options)));
  const prepareForward = async (roundtrip = false) => {
    const step = createStep("probe-real-change-cancellation-forward", resources.callback(async (value: Input, context) => {
      const response = await retained.invoke(value, context);
      if (!(response instanceof StepResponse) || response.output !== undefined)
        throw new Error("Missing genuine void Order Change cancellation StepResponse");
      const original = JSON.stringify(response.compensateInput);
      const preimage = Result.getOrThrow(order.contracts.decodePreimage(response.compensateInput));
      const detached = structuredClone(preimage);
      if (roundtrip) await retained.compensate(response.compensateInput, context);
      if (JSON.stringify(response.compensateInput) !== original || JSON.stringify(preimage) !== JSON.stringify(detached))
        throw new Error("Native cancellation mutated its retained preimage");
      return { preimage };
    }));
    const flow = createWorkflow("probe-real-change-cancellation-forward-root", (value: WorkflowData<Input>) => new WorkflowResponse(step(value)));
    return own(await Effect.runPromise(prepareAtomicWorkflowHost({ ...options, operationScheduling: "queued", borrowedOperationScheduling: "queued",
      workflow: { name: "probeOrderChangeCancellationForward", resources, prepared: Result.getOrThrow(flow.prepare()), input: OrderChangeCancellationInput,
        output: Schema.Struct({ preimage: order.contracts.Preimage }), events: internalModuleWorkflowEvents } })));
  };
  const prepareInverse = async () => {
    type Preimage = typeof order.contracts.Preimage.Type;
    const step = createStep("probe-real-change-cancellation-inverse", resources.callback(async (value: Preimage, context) => {
      const detached = structuredClone(value);
      await retained.compensate(value, context);
      if (JSON.stringify(value) !== JSON.stringify(detached)) throw new Error("Native cancellation inverse mutated its retained input");
      return new StepResponse(null);
    }));
    const flow = createWorkflow("probe-real-change-cancellation-inverse-root", (value: WorkflowData<Preimage>) => new WorkflowResponse(step(value)));
    return own(await Effect.runPromise(prepareAtomicWorkflowHost({ ...options, operationScheduling: "queued", borrowedOperationScheduling: "queued",
      workflow: { name: "probeOrderChangeCancellationInverse", resources, prepared: Result.getOrThrow(flow.prepare()), input: order.contracts.Preimage,
        output: Schema.Null, events: internalModuleWorkflowEvents } })));
  };
  const lateFailure = new Error("Late parent failure after genuine native Order Change cancellation");
  const prepareLateFailure = async () => {
    const fail = createStep("probe-late-change-cancellation-parent", resources.callback(async (_output: unknown) => { throw lateFailure; }));
    const flow = createWorkflow("probe-late-change-cancellation-parent-root", (value: WorkflowData<Input>) => {
      const canceled = cancelOrderChangeWorkflow.runAsStep({ input: value });
      return new WorkflowResponse(fail(canceled));
    });
    return own(await Effect.runPromise(prepareAtomicWorkflowHost({ ...options, operationScheduling: "queued", borrowedOperationScheduling: "queued",
      workflow: { name: "probeOrderChangeCancellationLateParent", resources, prepared: Result.getOrThrow(flow.prepare()), input: OrderChangeCancellationInput,
        output: Schema.Null, events: internalModuleWorkflowEvents } })));
  };
  const ConcurrentInput = Schema.Array(OrderChangeCancellationInput).pipe(Schema.mutable).check(Schema.isLengthBetween(2, 2));
  const prepareConcurrent = async () => {
    const step = createStep("probe-concurrent-change-cancellation-children", resources.callback(async (values: typeof ConcurrentInput.Type, context) => {
      await Promise.all(values.map(async value => {
        const response = await retained.invoke(value, context);
        if (!(response instanceof StepResponse) || response.output !== undefined)
          throw new Error("Missing genuine concurrent cancellation StepResponse");
      }));
      return new StepResponse(null);
    }));
    const flow = createWorkflow("probe-concurrent-change-cancellation-root", (values: WorkflowData<typeof ConcurrentInput.Type>) =>
      new WorkflowResponse(step(values)));
    return own(await Effect.runPromise(prepareAtomicWorkflowHost({ ...options, operationScheduling: "queued", borrowedOperationScheduling: "queued",
      workflow: { name: "probeOrderChangeCancellationConcurrentChildren", resources, prepared: Result.getOrThrow(flow.prepare()), input: ConcurrentInput,
        output: Schema.Null, events: internalModuleWorkflowEvents } })));
  };
  let escaped: (() => Promise<unknown>) | undefined;
  const prepareDeniedSibling = async () => {
    const step = createStep("probe-change-cancellation-denied-sibling", resources.callback(async (value: Input, context) => {
      escaped = () => context.resources.order.retrieveOrderChange(value.id, { select: ["id"], relations: [] });
      try { context.container.resolve("payment"); } catch { /* Refusal remains sticky at the authority owner. */ }
      await retained.invoke(value, context); return new StepResponse(null);
    }));
    const flow = createWorkflow("probe-change-cancellation-denied-sibling-root", (value: WorkflowData<Input>) => new WorkflowResponse(step(value)));
    return own(await Effect.runPromise(prepareAtomicWorkflowHost({ ...options, operationScheduling: "queued", borrowedOperationScheduling: "queued",
      workflow: { name: "probeOrderChangeCancellationDeniedSibling", resources, prepared: Result.getOrThrow(flow.prepare()), input: OrderChangeCancellationInput,
        output: Schema.Null, events: internalModuleWorkflowEvents } })));
  };
  return { ...base, order, modules, options, resources, prepare, prepareForward, prepareInverse, prepareLateFailure,
    lateFailure, prepareConcurrent, prepareDeniedSibling, closeCaseHosts, readChanges: () => base.read(orderChangeCancellationIds),
    callEscaped: () => { if (escaped === undefined) throw new Error("No captured Order Change method"); return escaped(); } };
}
