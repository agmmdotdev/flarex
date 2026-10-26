import { Effect, Result, Schema } from "effect";
import { createStep, createWorkflow, StepResponse, WorkflowResponse, type WorkflowData } from "@medusajs/workflows-sdk";
import { compensatePaymentIfNeededStep, compensatePaymentIfNeededStepId } from "@medusajs/core-flows/cart/compensate-payment-if-needed-step";
import { refundPaymentAndRecreatePaymentSessionWorkflow } from "@medusajs/core-flows/cart/refund-payment-recreate-payment-session";
import { preparePaymentRecreationResources } from "../../src/workflows/payment/recreation-resources";
import { paymentFinanceCallLimit } from "../../src/workflows/payment/finance-configuration";
import { prepareAtomicWorkflowHost } from "../../src/workflow/host";
import { internalModuleWorkflowEvents } from "../../src/workflow/events";
import { NativePaymentAmount, PaymentId, PaymentSessionRootInput } from "../../src/modules/payment/input";
import type { prepareLogicalPaymentFinance } from "./logical-payment-finance-fixture";

/** Isolated native child probe only. Production invokes this child through
 * the retained marker's authenticated matching graph, not arbitrary root IDs. */
export async function prepareNativePaymentRecreation(local: Awaited<ReturnType<typeof prepareLogicalPaymentFinance>>,
  close: (cleanup: () => Promise<void>) => void) {
  const resources = Result.getOrThrow(preparePaymentRecreationResources(local.options.modules, local.options.logger));
  const input = Schema.Struct({ payment_collection_id: PaymentId, payment_id: PaymentId,
    provider_id: PaymentSessionRootInput.fields.provider_id, amount: NativePaymentAmount,
    data: PaymentSessionRootInput.fields.data, note: Schema.optionalKey(Schema.String) });
  const host = await Effect.runPromise(prepareAtomicWorkflowHost({ ...local.options,
    requestCallLimit: paymentFinanceCallLimit, operationScheduling: "queued", borrowedOperationScheduling: "queued",
    workflow: { name: "probeNativeCheckoutPaymentRecreation", resources,
      prepared: Result.getOrThrow(refundPaymentAndRecreatePaymentSessionWorkflow.prepare()), input,
      output: Schema.JsonObject, events: internalModuleWorkflowEvents } }));
  close(() => Effect.runPromise(host.close)); return host;
}

/** Invoke the genuine retained callbacks under the same declared child closure
 * as their native step. The production root retains transaction-covered undo;
 * these isolated roots independently prove what its saved inverse executes. */
export async function prepareRetainedCheckoutPayment(local: Awaited<ReturnType<typeof prepareLogicalPaymentFinance>>,
  kind: "forward" | "inverse" | "late", close: (cleanup: () => Promise<void>) => void) {
  const resources = Result.getOrThrow(preparePaymentRecreationResources(local.options.modules, local.options.logger));
  const native = createWorkflow("select-native-checkout-payment-marker", (input: WorkflowData<{ payment_session_id: string }>) =>
    new WorkflowResponse(compensatePaymentIfNeededStep(input)));
  const node = Result.getOrThrow(native.prepare()).nodes.find(node => node.name === compensatePaymentIfNeededStepId);
  if (node?.kind !== "step" || node.compensate === undefined) throw new Error("Missing native checkout Payment inverse");
  const callbacks = { invoke: node.invoke, compensate: node.compensate };
  const step = createStep({ name: "retained-checkout-payment-" + kind, invokedWorkflows: [refundPaymentAndRecreatePaymentSessionWorkflow] },
    resources.callback(async (input: string, context) => {
      if (kind === "forward") {
        const response = await callbacks.invoke({ payment_session_id: input }, context);
        if (!(response instanceof StepResponse)) throw new Error("Missing native checkout Payment StepResponse");
        return new StepResponse({ output: response.output, retained: response.compensateInput });
      }
      await callbacks.compensate(input, context);
      if (kind === "late") throw new Error("Late failure after native checkout Payment inverse");
      return new StepResponse(null);
    }));
  const flow = createWorkflow("retained-checkout-payment-root-" + kind, (input: WorkflowData<string>) => new WorkflowResponse(step(input)));
  const host = await Effect.runPromise(prepareAtomicWorkflowHost({ ...local.options,
    requestCallLimit: paymentFinanceCallLimit, operationScheduling: "queued", borrowedOperationScheduling: "queued",
    workflow: { name: "retainedCheckoutPayment-" + kind, resources, prepared: Result.getOrThrow(flow.prepare()),
      input: PaymentId, output: Schema.Json, events: internalModuleWorkflowEvents } }));
  close(() => Effect.runPromise(host.close)); return host;
}
