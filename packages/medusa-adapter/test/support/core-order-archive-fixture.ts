import { Effect, Result, Schema } from "effect";
import { createStep, createWorkflow, StepResponse, WorkflowResponse, type WorkflowData } from "@medusajs/workflows-sdk";
import { archiveOrderWorkflow } from "@medusajs/core-flows/order/archive-orders";
import { makeOrderArchiveCommands } from "../../src/modules/order/service";
import { OrderArchiveInput, OrderArchiveStatuses, decodeOrderArchiveIds, decodeOrderArchiveStatuses } from "../../src/modules/order/input";
import { prepareOrderArchiveWorkflow } from "../../src/workflows/order/archive-orders";
import { prepareAtomicWorkflowHost } from "../../src/workflow/host";
import { prepareWorkflowResources } from "../../src/workflow/resources";
import { internalModuleWorkflowEvents, orderedWorkflowIdEvents } from "../../src/workflow/events";
import type { CorePersistenceFixture } from "../../../persistence-postgres/test/core/fixture";
import { orderFixtureHosts, prepareCoreOrderFixture, type CoreOrderInitialRow } from "./core-order-fixture";
import { orderArchiveRows } from "./order-archive-rows";

type Input = typeof OrderArchiveInput.Type;
const native = Result.getOrThrow(archiveOrderWorkflow.prepare());
const node = native.nodes.find(value => value.name === "archive-orders");
if (node?.kind !== "step" || node.compensation !== "transactionCovered" || node.compensate === undefined)
  throw new Error("Missing genuine retained native Order archive callbacks");
const retained = { invoke: node.invoke, compensate: node.compensate };

export async function prepareCoreOrderArchive(driver: "pglite" | "postgres", close: (cleanup: () => Promise<void>) => void,
  rows: readonly CoreOrderInitialRow[] = orderArchiveRows(),
  physical?: CorePersistenceFixture) {
  const order = await Effect.runPromise(makeOrderArchiveCommands());
  const base = await prepareCoreOrderFixture(driver, close, order.commands, rows, physical);
  const modules = { order: { module: order.workflow, nativeStorage: base.source } }, revision = "3".repeat(64);
  const options: Parameters<typeof prepareOrderArchiveWorkflow>[0] = { execution: base.execution, modules, revision,
    subscribers: [{ id: "native-order-archive-173", revision }] };
  const resources = Result.getOrThrow(prepareWorkflowResources({ order: { module: order.workflow,
    methods: ["listOrders", "archive", "updateOrders"], graph: false } }, true));
  const { own, closeCaseHosts } = orderFixtureHosts(close);
  const prepare = async () => own(await Effect.runPromise(prepareOrderArchiveWorkflow(options)));
  const prepareForward = async (roundtrip = false) => {
    const step = createStep("probe173-real-archive-forward", resources.callback(async (value: Input, context) => {
      const response = await retained.invoke(value, context);
      if (!(response instanceof StepResponse)) throw new Error("Missing genuine Order archive StepResponse");
      const statuses = Result.getOrThrow(decodeOrderArchiveStatuses(response.compensateInput));
      if (roundtrip) await retained.compensate(response.compensateInput, context);
      return { output: response.output, statuses };
    }));
    const flow = createWorkflow("probe173-real-archive-forward-root", (value: WorkflowData<Input>) => new WorkflowResponse(step(value)));
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
    const flow = createWorkflow("probe173-late-order-parent-root", (value: WorkflowData<Input>) =>
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
  return { ...base, lateFailure, prepare, prepareForward, prepareInverse, prepareLateFailure, closeCaseHosts };
}
