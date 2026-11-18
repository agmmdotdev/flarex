import { randomUUID } from "node:crypto";
import { Effect, Result, Schema } from "effect";
import { createStep, createWorkflow, StepResponse, WorkflowResponse, transform, type WorkflowData } from "@medusajs/workflows-sdk";
import { createPaymentSessionsWorkflow } from "@medusajs/core-flows/payment-collection/create-payment-session";
import { deletePaymentSessionsWorkflow } from "@medusajs/core-flows/payment-collection/delete-payment-sessions";
import { createPaymentSessionStep } from "@medusajs/core-flows/payment-collection/create-payment-session-step";
import { compileCoreNativeEventStorageDefinition } from "../../../persistence-postgres/src/commit/events/coreDefinition";
import type { CorePersistenceFixture } from "../../../persistence-postgres/test/core/fixture";
import { compilePaymentCoreDefinition } from "../../src/modules/payment/schema";
import { makePaymentSessionCommands } from "../../src/modules/payment/service";
import { PaymentSessionCreate, PaymentSessionRootInput, PaymentSessionIds, PaymentCollectionCreate } from "../../src/modules/payment/input";
import { preparePaymentSessionDeletionWorkflow } from "../../src/workflows/payment/delete-sessions";
import { preparePaymentSessionCreationWorkflow } from "../../src/workflows/payment/create-session";
import { prepareAtomicWorkflowHost } from "../../src/workflow/host";
import { prepareWorkflowResources } from "../../src/workflow/resources";
import { internalModuleWorkflowEvents } from "../../src/workflow/events";
import { createCoreNativeWorkflowFixture, shareCoreNativeWorkflowPhysical, type CoreNativeWorkflowSource } from "./core-native-workflow-fixture";
import { orderFixtureHosts } from "./core-order-fixture";
import { makePaymentFixtureLogger, paymentCollectionSeed } from "./payment-fixture-data";

export async function prepareCorePaymentSessions(driver: "pglite" | "postgres", close: (cleanup: () => Promise<void>) => void,
  sessions: CoreNativeWorkflowSource["rows"] = [], physical?: CorePersistenceFixture) {
  const target = { scopeUuid: randomUUID(), epochUuid: randomUUID() };
  const { logger, errors } = makePaymentFixtureLogger();
  const { payment, definition, eventDefinition } = await Effect.runPromise(Effect.all({
    payment: makePaymentSessionCommands(logger),
    definition: compilePaymentCoreDefinition(target),
    eventDefinition: compileCoreNativeEventStorageDefinition(target),
  }));
  const fixture = await createCoreNativeWorkflowFixture(driver, { eventDefinition, sources: [{
    name: "payment", definition, initialCommands: payment.commands, rows: [paymentCollectionSeed(), ...sessions],
  }], ...(physical === undefined ? {} : { physical: await shareCoreNativeWorkflowPhysical(physical) }) });
  close(fixture.close);
  const { own } = orderFixtureHosts(close);
  const options = { execution: fixture.execution, modules: { payment: { module: payment.workflow, nativeStorage: fixture.source("payment") } },
    revision: "b".repeat(64), subscribers: [{ id: "native-payment-sessions", revision: "c".repeat(64) }] };
  const workflowOptions = { ...options, operationScheduling: "queued", borrowedOperationScheduling: "queued" } as const;
  const facadeOptions = { ...options, logger: payment.loggerResource };
  const prepareDelete = async () => own(await Effect.runPromise(preparePaymentSessionDeletionWorkflow(facadeOptions)));
  const prepareCreate = async () => own(await Effect.runPromise(preparePaymentSessionCreationWorkflow(facadeOptions)));
  const prepareCreateCollection = async () => {
    const selected = Result.getOrThrow(prepareWorkflowResources({ payment: { module: payment.workflow,
      methods: ["createPaymentCollections"], graph: false } }, true));
    const step = createStep("probe-native-payment-collection", selected.callback(async (data: typeof PaymentCollectionCreate.Type, context) =>
      new StepResponse(await context.resources.payment.createPaymentCollections(data))));
    const flow = createWorkflow("probe-native-payment-collection", (data: WorkflowData<typeof PaymentCollectionCreate.Type>) => new WorkflowResponse(step(data)));
    return own(await Effect.runPromise(prepareAtomicWorkflowHost({ ...workflowOptions, workflow: {
      name: "probePaymentCollectionCreate", resources: selected, prepared: Result.getOrThrow(flow.prepare()),
      input: PaymentCollectionCreate, output: Schema.JsonObject, events: internalModuleWorkflowEvents,
    } })));
  };
  const prepareCreateStep = async () => {
    const resources = Result.getOrThrow(prepareWorkflowResources({ payment: { module: payment.workflow,
      methods: ["createPaymentSession", "deletePaymentSession", "listPaymentSessions"], graph: false } }, true, { logger: payment.loggerResource }));
    const flow = createWorkflow("probe-native-payment-session-creation", (data: WorkflowData<typeof PaymentSessionCreate.Type>) =>
      new WorkflowResponse(createPaymentSessionStep(data)));
    return own(await Effect.runPromise(prepareAtomicWorkflowHost({ ...workflowOptions, workflow: {
      name: "probeNativePaymentSessionCreation", resources, prepared: Result.getOrThrow(flow.prepare()),
      input: PaymentSessionCreate, output: Schema.JsonObject, events: internalModuleWorkflowEvents,
    } })));
  };
  const resources = Result.getOrThrow(prepareWorkflowResources({ payment: { module: payment.workflow,
    methods: ["createPaymentSession", "deletePaymentSession", "listPaymentSessions"], graph: true } }, true, { logger: payment.loggerResource }));
  const prepareLateFailure = async () => {
    const flow = createWorkflow("probe-payment-late-failure", (data: WorkflowData<typeof PaymentSessionRootInput.Type>) => {
      const session = createPaymentSessionsWorkflow.runAsStep({ input: data });
      return new WorkflowResponse(transform(session, () => { throw new Error("Late parent failure after genuine Payment root"); }));
    });
    return own(await Effect.runPromise(prepareAtomicWorkflowHost({ ...workflowOptions, workflow: {
      name: "probePaymentLateFailure", resources, prepared: Result.getOrThrow(flow.prepare()),
      input: PaymentSessionRootInput, output: Schema.Json, events: internalModuleWorkflowEvents,
    } })));
  };
  const deletion = Result.getOrThrow(deletePaymentSessionsWorkflow.prepare()).nodes.find(node => node.name === "delete-payment-sessions");
  if (deletion?.kind !== "step" || deletion.compensate === undefined) throw new Error("Missing native Payment deletion inverse");
  const invokeDeletion = deletion.invoke, compensateDeletion = deletion.compensate;
  const prepareRetainedDeletion = async (inverse = false) => {
    const step = createStep("probe-payment-retained-deletion", resources.callback(async (data: unknown, context) => {
      if (inverse) { await compensateDeletion(data, context); return new StepResponse(null); }
      const response = await invokeDeletion({ ids: Schema.decodeUnknownSync(PaymentSessionIds)(data) }, context);
      if (!(response instanceof StepResponse)) throw new Error("Missing genuine Payment deletion response");
      return new StepResponse({ output: response.output, retained: response.compensateInput });
    }));
    const flow = createWorkflow("probe-payment-retained-deletion", (data: WorkflowData<unknown>) => new WorkflowResponse(step(data)));
    return own(await Effect.runPromise(prepareAtomicWorkflowHost({ ...workflowOptions, workflow: {
      name: "probePaymentRetainedDeletion", resources, prepared: Result.getOrThrow(flow.prepare()),
      input: Schema.Json, output: Schema.Json, events: internalModuleWorkflowEvents,
    } })));
  };
  const prepareRetainedCreation = async (inverse = false) => {
    const native = createWorkflow("probe-payment-creation-callback", (data: WorkflowData<typeof PaymentSessionCreate.Type>) => new WorkflowResponse(createPaymentSessionStep(data)));
    const creation = Result.getOrThrow(native.prepare()).nodes.find(node => node.name === "create-payment-session");
    if (creation?.kind !== "step" || creation.compensate === undefined) throw new Error("Missing native Payment creation inverse");
    const invoke = creation.invoke, compensate = creation.compensate;
    const step = createStep("probe-payment-retained-creation", resources.callback(async (data: unknown, context) => {
      if (inverse) { await compensate(data, context); return new StepResponse(null); }
      const response = await invoke(Schema.decodeUnknownSync(PaymentSessionCreate)(data), context);
      if (!(response instanceof StepResponse)) throw new Error("Missing genuine Payment creation response");
      return new StepResponse({ output: response.output, retained: response.compensateInput });
    }));
    const flow = createWorkflow("probe-payment-retained-creation", (data: WorkflowData<unknown>) => new WorkflowResponse(step(data)));
    return own(await Effect.runPromise(prepareAtomicWorkflowHost({ ...workflowOptions, workflow: {
      name: "probePaymentRetainedCreation", resources, prepared: Result.getOrThrow(flow.prepare()),
      input: Schema.Json, output: Schema.Json, events: internalModuleWorkflowEvents,
    } })));
  };
  return { fixture, errors, prepareDelete, prepareCreate, prepareCreateCollection, prepareCreateStep,
    prepareLateFailure, prepareRetainedDeletion, prepareRetainedCreation, read: () => fixture.readRows("payment"), snapshot: fixture.snapshot };
}
