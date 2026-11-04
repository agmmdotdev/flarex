import { randomUUID } from "node:crypto";
import { Effect, Result, Schema } from "effect";
import { createStep, createWorkflow, StepResponse, WorkflowResponse, type WorkflowData } from "@medusajs/workflows-sdk";
import { authorizePaymentSessionStep, authorizePaymentSessionStepId } from "@medusajs/core-flows/payment/authorize-payment-session-step";
import { capturePaymentStep } from "@medusajs/core-flows/payment/capture-payment-step";
import { refundPaymentStep } from "@medusajs/core-flows/payment/refund-payment-step";
import { prepareWorkflowResources } from "../../src/workflow/resources";
import { prepareAtomicWorkflowHost } from "../../src/workflow/host";
import { paymentAuthorizationWorkflow, preparePaymentAuthorizationWorkflow } from "../../src/workflows/payment/authorize-session";
import { internalModuleWorkflowEvents } from "../../src/workflow/events";
import { compileCoreNativeEventStorageDefinition } from "../../../persistence-postgres/src/commit/events/coreDefinition";
import type { CorePersistenceFixture } from "../../../persistence-postgres/test/core/fixture";
import { makePaymentLifecycleCommands } from "../../src/modules/payment/lifecycle-service";
import { PaymentAuthorization, PaymentCapture, PaymentRefund } from "../../src/modules/payment/lifecycle-input";
import { compilePaymentCoreDefinition } from "../../src/modules/payment/schema";
import { createCoreNativeWorkflowFixture, shareCoreNativeWorkflowPhysical, type CoreNativeWorkflowSource } from "./core-native-workflow-fixture";
import { makePaymentFixtureLogger, paymentCollectionSeed, paymentSessionSeed } from "./payment-fixture-data";

export async function prepareCorePaymentLifecycle(driver: "pglite" | "postgres", close: (cleanup: () => Promise<void>) => void,
  additionalRows: CoreNativeWorkflowSource["rows"] = [], physical?: CorePersistenceFixture) {
  const target = { scopeUuid: randomUUID(), epochUuid: randomUUID() };
  const { logger, errors } = makePaymentFixtureLogger();
  const { payment, definition, eventDefinition } = await Effect.runPromise(Effect.all({
    payment: makePaymentLifecycleCommands(logger),
    definition: compilePaymentCoreDefinition(target),
    eventDefinition: compileCoreNativeEventStorageDefinition(target),
  }));
  const fixture = await createCoreNativeWorkflowFixture(driver, { eventDefinition, sources: [{
    name: "payment", definition, initialCommands: payment.commands,
    rows: [paymentCollectionSeed(), paymentSessionSeed("payses_lifecycle"), ...additionalRows],
  }], ...(physical === undefined ? {} : { physical: await shareCoreNativeWorkflowPhysical(physical) }) });
  close(fixture.close);
  const modules = { payment: { module: payment.workflow, nativeStorage: fixture.source("payment") } };
  const resources = Result.getOrThrow(prepareWorkflowResources({ payment: { module: payment.workflow,
    methods: ["authorizePaymentSession", "retrievePaymentSession", "capturePayment", "refundPayment", "cancelPayment"], graph: true } }, true,
    { logger: payment.loggerResource }));
  const capture = createWorkflow("probe-native-payment-capture-step", (input: WorkflowData<typeof PaymentCapture.Type>) =>
    new WorkflowResponse(capturePaymentStep(input)));
  const refund = createWorkflow("probe-native-payment-refund-step", (input: WorkflowData<typeof PaymentRefund.Type>) =>
    new WorkflowResponse(refundPaymentStep(input)));
  const options = { execution: fixture.execution, modules, revision: "b".repeat(64),
    subscribers: [{ id: "native-payment-lifecycle", revision: "c".repeat(64) }],
    operationScheduling: "queued", borrowedOperationScheduling: "queued" } as const;
  const retained = Result.getOrThrow(paymentAuthorizationWorkflow.prepare()).nodes.find(node => node.name === authorizePaymentSessionStepId);
  if (retained?.kind !== "step" || retained.compensate === undefined) throw new Error("Missing native Payment authorization callbacks");
  const callbacks = { invoke: retained.invoke, compensate: retained.compensate };
  const prepareRetainedAuthorization = async (inverse = false) => {
    const direction = inverse ? "inverse" : "forward";
    const step = createStep("probe-retained-payment-authorization-" + direction, resources.callback(async (value: unknown, context) => {
      if (inverse) { await callbacks.compensate(value, context); return new StepResponse(null); }
      const response = await callbacks.invoke(Schema.decodeUnknownSync(PaymentAuthorization)(value), context);
      if (!(response instanceof StepResponse)) throw new Error("Missing native Payment authorization StepResponse");
      return new StepResponse({ output: response.output, retained: response.compensateInput });
    }));
    const flow = createWorkflow("probe-retained-payment-authorization-root-" + direction, (value: WorkflowData<unknown>) => new WorkflowResponse(step(value)));
    const host = await Effect.runPromise(prepareAtomicWorkflowHost({ ...options, workflow: {
      name: "probeRetainedPaymentAuthorization-" + direction, resources, prepared: Result.getOrThrow(flow.prepare()),
      input: Schema.Json, output: Schema.Json, events: internalModuleWorkflowEvents,
    } }));
    close(() => Effect.runPromise(host.close)); return host;
  };
  const lateFailure = new Error("Late parent failure after genuine native authorization");
  const prepareLateAuthorization = async () => {
    const fail = createStep("probe-late-authorization-parent", resources.callback(async (_value: unknown) => { throw lateFailure; }));
    const flow = createWorkflow("probe-late-authorization-root", (value: WorkflowData<typeof PaymentAuthorization.Type>) =>
      new WorkflowResponse(fail(authorizePaymentSessionStep(value))));
    const host = await Effect.runPromise(prepareAtomicWorkflowHost({ ...options, workflow: { name: "probeLatePaymentAuthorization", resources,
      prepared: Result.getOrThrow(flow.prepare()), input: PaymentAuthorization, output: Schema.Json, events: internalModuleWorkflowEvents } }));
    close(() => Effect.runPromise(host.close)); return host;
  };
  const prepareAuthorize = async () => {
    const host = await Effect.runPromise(preparePaymentAuthorizationWorkflow({ execution: options.execution, modules,
      revision: options.revision, subscribers: options.subscribers, logger: payment.loggerResource }));
    close(() => Effect.runPromise(host.close)); return host;
  };
  const prepareCapture = async () => {
    const host = await Effect.runPromise(prepareAtomicWorkflowHost({ ...options, workflow: { name: "probeNativePaymentCaptureStep", resources,
      prepared: Result.getOrThrow(capture.prepare()), input: PaymentCapture, output: Schema.JsonObject, events: internalModuleWorkflowEvents } }));
    close(() => Effect.runPromise(host.close)); return host;
  };
  const prepareRefund = async () => {
    const host = await Effect.runPromise(prepareAtomicWorkflowHost({ ...options, workflow: { name: "probeNativePaymentRefundStep", resources,
      prepared: Result.getOrThrow(refund.prepare()), input: PaymentRefund, output: Schema.JsonObject, events: internalModuleWorkflowEvents } }));
    close(() => Effect.runPromise(host.close)); return host;
  };
  return { fixture, payment, errors, prepareAuthorize, prepareCapture, prepareRefund,
    prepareRetainedAuthorization, prepareLateAuthorization, lateFailure, snapshot: fixture.snapshot, read: fixture.readRows };
}
