import { Effect, Schema } from "effect";
import { capturePaymentWorkflow } from "@medusajs/core-flows/payment/capture-payment";
import { PaymentEvents } from "@medusajs/framework/utils/portable";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { PaymentCapture, decodePaymentCapture } from "../../modules/payment/lifecycle-input";
import { orderedWorkflowIdEvents } from "../../workflow/events";
import { prepareAtomicWorkflowHost } from "../../workflow/host";
import { prepareWorkflowResources } from "../../workflow/resources";
import { capturePaymentFinanceConfiguration, paymentFinanceCallLimit, type PaymentFinanceWorkflowInput } from "./finance-configuration";


/** The unchanged native root, including optional Order association, existing
 * transaction deduplication and captured event, borrows one outer settlement. */
export const preparePaymentCaptureWorkflow = Effect.fn("Payment.prepareCapture")(function* (input: PaymentFinanceWorkflowInput) {
  const { options, modules } = yield* capturePaymentFinanceConfiguration(input, "installed");
  const resources = yield* Effect.fromResult(prepareWorkflowResources({
    payment: { module: modules.payment.module, methods: ["capturePayment"], graph: true },
    order: { module: modules.order.module, methods: ["listOrderTransactions", "addOrderTransactions", "deleteOrderTransactions"], graph: true },
    order_payment_collection_links: { module: modules.order_payment_collection_links.module, methods: [], graph: true, expose: false },
  }, true, { logger: options.logger }));
  const prepared = yield* Effect.fromResult(capturePaymentWorkflow.prepare()).pipe(Effect.mapError(cause => commerceError("unsupportedProfile", cause)));
  const events = orderedWorkflowIdEvents(PaymentEvents.CAPTURED, Effect.fn("Payment.captureEventIds")(function* (calls) {
    const captured = calls.calls(modules.payment.module.methods.capturePayment);
    if (captured.length !== 1) return yield* Effect.fail(commerceError("receiptMismatch"));
    const args = yield* Effect.fromResult(decodePaymentCapture(captured[0]?.input));
    return [args.payment_id];
  }));
  return yield* prepareAtomicWorkflowHost({ execution: options.execution, modules, revision: options.revision, subscribers: options.subscribers,
    requestCallLimit: paymentFinanceCallLimit, operationScheduling: "queued", borrowedOperationScheduling: "queued",
    workflow: { name: "capturePaymentWorkflow", resources, prepared, input: PaymentCapture, output: Schema.JsonObject, events } });
});
