import { Effect, Result, Schema } from "effect";
import { createStep, createWorkflow, StepResponse, WorkflowResponse, type WorkflowData } from "@medusajs/workflows-sdk";
import { declineOrderChangeWorkflow } from "@medusajs/core-flows/order/decline-order-change";
import { makeOrderChangeDeclineCommands } from "../../src/modules/order/change-decline-service";
import { OrderChangeDeclineInput } from "../../src/modules/order/change-decline-input";
import { prepareOrderChangeDeclineWorkflow } from "../../src/workflows/order/decline-order-change";
import { prepareAtomicWorkflowHost } from "../../src/workflow/host";
import { prepareWorkflowResources } from "../../src/workflow/resources";
import { internalModuleWorkflowEvents } from "../../src/workflow/events";
import { prepareLogicalOrderFixture, type OrderFixtureShared, type OrderInitialRow } from "./logical-order-fixture";
import { orderChangeUpdateIds, orderChangeUpdateRows, orderChangeUpdateStamp } from "./logical-order-change-update-fixture";

export type { OrderInitialRow } from "./logical-order-fixture";
export const orderChangeDeclineIds = orderChangeUpdateIds;
export const orderChangeDeclineStamp = orderChangeUpdateStamp;
export function orderChangeDeclineRows(): readonly OrderInitialRow[] {
  return orderChangeUpdateRows().map(value => value.table === "order_change"
    ? { ...value, row: { ...value.row, status: value.row.id === orderChangeDeclineIds[1] ? "requested" : "pending",
      declined_by: value.row.id === orderChangeDeclineIds[2] ? "original-decliner" : null,
      declined_at: value.row.id === orderChangeDeclineIds[2] ? orderChangeDeclineStamp : null,
      declined_reason: "original-reason-" + value.row.id } } : value);
}

type Input = typeof OrderChangeDeclineInput.Type;
const node = Result.getOrThrow(declineOrderChangeWorkflow.prepare()).nodes.find(value => value.name === "decline-order-change");
if (node?.kind !== "step" || node.compensation !== "transactionCovered" || node.compensate === undefined)
  throw new Error("Missing genuine retained native Order Change decline callbacks");
const retained = { invoke: node.invoke, compensate: node.compensate };

/** Initialization and observation reuse the existing Order fixture. Every
 * mutation below uses the retained native decline callback and its inverse. */
export async function prepareLogicalOrderChangeDecline(driver: "pglite" | "postgres", close: (cleanup: () => Promise<void>) => void,
  rows: readonly OrderInitialRow[] = orderChangeDeclineRows(), shared?: OrderFixtureShared) {
  const order = await Effect.runPromise(makeOrderChangeDeclineCommands());
  const base = await prepareLogicalOrderFixture(driver, close, order.commands, "order-change-decline", rows, shared);
  const modules = { order: { module: order.workflow, logicalStorage: base.logicalStorage } };
  const options: Parameters<typeof prepareOrderChangeDeclineWorkflow>[0] = { execution: base.execution, modules,
    revision: "b".repeat(64), subscribers: [{ id: "native-order-change-decline", revision: "c".repeat(64) }] };
  const resources = Result.getOrThrow(prepareWorkflowResources({ order: { module: order.workflow,
    methods: ["retrieveOrderChange", "declineOrderChange", "restoreOrderChangeDecline"], graph: false } }, true));
  const hosts: Array<() => Promise<void>> = [];
  const own = <H extends { readonly close: Effect.Effect<void> }>(host: H) => { hosts.push(() => Effect.runPromise(host.close)); return host; };
  const closeCaseHosts = async () => { for (const dispose of hosts.splice(0).reverse()) await dispose(); };
  close(closeCaseHosts);
  const prepare = async () => own(await Effect.runPromise(prepareOrderChangeDeclineWorkflow(options)));
  const prepareForward = async (roundtrip = false) => {
    const step = createStep("probe-real-change-decline-forward", resources.callback(async (value: Input, context) => {
      const response = await retained.invoke(value, context);
      if (!(response instanceof StepResponse) || response.output !== undefined)
        throw new Error("Missing genuine void Order Change decline StepResponse");
      const original = JSON.stringify(response.compensateInput);
      const preimage = Result.getOrThrow(order.contracts.decodePreimage(response.compensateInput));
      const detached = structuredClone(preimage);
      if (roundtrip) await retained.compensate(response.compensateInput, context);
      if (JSON.stringify(response.compensateInput) !== original || JSON.stringify(preimage) !== JSON.stringify(detached))
        throw new Error("Native decline mutated its retained preimage");
      return { preimage };
    }));
    const flow = createWorkflow("probe-real-change-decline-forward-root", (value: WorkflowData<Input>) => new WorkflowResponse(step(value)));
    return own(await Effect.runPromise(prepareAtomicWorkflowHost({ ...options, operationScheduling: "queued", borrowedOperationScheduling: "queued",
      workflow: { name: "probeOrderChangeDeclineForward", resources, prepared: Result.getOrThrow(flow.prepare()), input: OrderChangeDeclineInput,
        output: Schema.Struct({ preimage: order.contracts.Preimage }), events: internalModuleWorkflowEvents } })));
  };
  const prepareInverse = async () => {
    type Preimage = typeof order.contracts.Preimage.Type;
    const step = createStep("probe-real-change-decline-inverse", resources.callback(async (value: Preimage, context) => {
      const detached = structuredClone(value);
      await retained.compensate(value, context);
      if (JSON.stringify(value) !== JSON.stringify(detached)) throw new Error("Native decline inverse mutated its retained input");
      return new StepResponse(null);
    }));
    const flow = createWorkflow("probe-real-change-decline-inverse-root", (value: WorkflowData<Preimage>) => new WorkflowResponse(step(value)));
    return own(await Effect.runPromise(prepareAtomicWorkflowHost({ ...options, operationScheduling: "queued", borrowedOperationScheduling: "queued",
      workflow: { name: "probeOrderChangeDeclineInverse", resources, prepared: Result.getOrThrow(flow.prepare()), input: order.contracts.Preimage,
        output: Schema.Null, events: internalModuleWorkflowEvents } })));
  };
  const lateFailure = new Error("Late parent failure after genuine native Order Change decline");
  const prepareLateFailure = async () => {
    const fail = createStep("probe-late-change-decline-parent", resources.callback(async (_output: unknown) => { throw lateFailure; }));
    const flow = createWorkflow("probe-late-change-decline-parent-root", (value: WorkflowData<Input>) => {
      const declined = declineOrderChangeWorkflow.runAsStep({ input: value });
      return new WorkflowResponse(fail(declined));
    });
    return own(await Effect.runPromise(prepareAtomicWorkflowHost({ ...options, operationScheduling: "queued", borrowedOperationScheduling: "queued",
      workflow: { name: "probeOrderChangeDeclineLateParent", resources, prepared: Result.getOrThrow(flow.prepare()), input: OrderChangeDeclineInput,
        output: Schema.Null, events: internalModuleWorkflowEvents } })));
  };
  const ConcurrentInput = Schema.Array(OrderChangeDeclineInput).pipe(Schema.mutable).check(Schema.isLengthBetween(2, 2));
  const prepareConcurrent = async () => {
    const step = createStep("probe-concurrent-change-decline-children", resources.callback(async (values: typeof ConcurrentInput.Type, context) => {
      await Promise.all(values.map(async value => {
        const response = await retained.invoke(value, context);
        if (!(response instanceof StepResponse) || response.output !== undefined)
          throw new Error("Missing genuine concurrent decline StepResponse");
      }));
      return new StepResponse(null);
    }));
    const flow = createWorkflow("probe-concurrent-change-decline-root", (values: WorkflowData<typeof ConcurrentInput.Type>) =>
      new WorkflowResponse(step(values)));
    return own(await Effect.runPromise(prepareAtomicWorkflowHost({ ...options, operationScheduling: "queued", borrowedOperationScheduling: "queued",
      workflow: { name: "probeOrderChangeDeclineConcurrentChildren", resources, prepared: Result.getOrThrow(flow.prepare()), input: ConcurrentInput,
        output: Schema.Null, events: internalModuleWorkflowEvents } })));
  };
  let escaped: (() => Promise<unknown>) | undefined;
  const prepareDeniedSibling = async () => {
    const step = createStep("probe-change-decline-denied-sibling", resources.callback(async (value: Input, context) => {
      escaped = () => context.resources.order.retrieveOrderChange(value.id, { select: ["id"], relations: [] });
      try { context.container.resolve("payment"); } catch { /* Refusal remains sticky at the authority owner. */ }
      await retained.invoke(value, context); return new StepResponse(null);
    }));
    const flow = createWorkflow("probe-change-decline-denied-sibling-root", (value: WorkflowData<Input>) => new WorkflowResponse(step(value)));
    return own(await Effect.runPromise(prepareAtomicWorkflowHost({ ...options, operationScheduling: "queued", borrowedOperationScheduling: "queued",
      workflow: { name: "probeOrderChangeDeclineDeniedSibling", resources, prepared: Result.getOrThrow(flow.prepare()), input: OrderChangeDeclineInput,
        output: Schema.Null, events: internalModuleWorkflowEvents } })));
  };
  return { ...base, order, modules, options, resources, prepare, prepareForward, prepareInverse, prepareLateFailure,
    lateFailure, prepareConcurrent, prepareDeniedSibling, closeCaseHosts, readChanges: () => base.read(orderChangeDeclineIds),
    callEscaped: () => { if (escaped === undefined) throw new Error("No captured Order Change method"); return escaped(); } };
}
