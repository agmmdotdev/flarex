import { Effect, Result, Schema } from "effect";
import { createStep, createWorkflow, StepResponse, WorkflowResponse, type WorkflowData } from "@medusajs/workflows-sdk";
import { authorizePaymentSessionStep, authorizePaymentSessionStepId } from "@medusajs/core-flows/payment/authorize-payment-session-step";
import { capturePaymentStep } from "@medusajs/core-flows/payment/capture-payment-step";
import { refundPaymentStep } from "@medusajs/core-flows/payment/refund-payment-step";
import { prepareWorkflowResources } from "../../src/workflow/resources";
import { prepareAtomicWorkflowHost } from "../../src/workflow/host";
import { paymentAuthorizationWorkflow, preparePaymentAuthorizationWorkflow } from "../../src/workflows/payment/authorize-session";
import { internalModuleWorkflowEvents } from "../../src/workflow/events";
import { defineCommerceCommand } from "../../../persistence-postgres/src/frameworks/commerceTransaction/commands";
import { makeCommerceHost } from "../../../persistence-postgres/src/frameworks/commerceTransaction/host";
import { commerceError, isJsonObject, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { makePaymentLifecycleCommands } from "../../src/modules/payment/lifecycle-service";
import { PaymentAuthorization, PaymentCapture, PaymentRefund } from "../../src/modules/payment/lifecycle-input";
import { prepareLogicalPaymentSessions, paymentSessionSeed } from "./logical-payment-session-fixture";

export async function prepareLogicalPaymentLifecycle(driver: "pglite" | "postgres", close: (cleanup: () => Promise<void>) => void,
  shared?: Parameters<typeof prepareLogicalPaymentSessions>[3], additionalRows: Parameters<typeof prepareLogicalPaymentSessions>[2] = []) {
  const base = await prepareLogicalPaymentSessions(driver, close, [paymentSessionSeed("payses_lifecycle"), ...additionalRows], shared);
  const payment = await Effect.runPromise(makePaymentLifecycleCommands(base.logger));
  const modules = { payment: { ...base.modules.payment, module: payment.workflow } };
  const resources = Result.getOrThrow(prepareWorkflowResources({ payment: { module: payment.workflow,
    methods: ["authorizePaymentSession", "retrievePaymentSession", "capturePayment", "refundPayment", "cancelPayment"], graph: true } }, true,
    { logger: payment.loggerResource }));
  const capture = createWorkflow("probe-native-payment-capture-step", (input: WorkflowData<typeof PaymentCapture.Type>) =>
    new WorkflowResponse(capturePaymentStep(input)));
  const refund = createWorkflow("probe-native-payment-refund-step", (input: WorkflowData<typeof PaymentRefund.Type>) =>
    new WorkflowResponse(refundPaymentStep(input)));
  const options = { execution: base.execution, modules, revision: base.options.revision, subscribers: base.options.subscribers,
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
  /** Import existing rows through the actual storage owner, one setup command
   * at a time. This capability is never installed in a workflow participant.
   * The guard witness concerns existing state, not atomic dataset publication. */
  const seedStoredCaptures = async (rows: readonly JsonObject[]) => {
    const seed = defineCommerceCommand("fixtureStoredPaymentCapture", "write", (ctx, input) => Effect.gen(function* () {
      if (!isJsonObject(input)) return yield* ctx.refuse(commerceError("invalidInput"));
      yield* (yield* ctx.table("capture")).write(ctx.manager, "insert", [input]);
      return null;
    }));
    const host = await Effect.runPromise(makeCommerceHost({ ...base.fixture.hostInput, commands: [seed],
      logicalStorage: modules.payment.logicalStorage, identityAndAccessPolicy: { profile: "fixture-existing-payment-captures" } }));
    close(() => Effect.runPromise(host.close));
    for (const row of rows) await Effect.runPromise(host.run(host.newRequestKey(), seed, row));
  };
  return { ...base, payment, modules, options, resources, prepareAuthorize, prepareCapture, prepareRefund,
    prepareRetainedAuthorization, prepareLateAuthorization, lateFailure, seedStoredCaptures };
}
