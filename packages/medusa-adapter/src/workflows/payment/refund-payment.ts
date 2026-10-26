import { Effect, Schema } from "effect";
import { refundPaymentWorkflow } from "@medusajs/core-flows/payment/refund-payment";
import { PaymentEvents } from "@medusajs/framework/utils/portable";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { PaymentRefund, decodePaymentRefund } from "../../modules/payment/lifecycle-input";
import { orderedWorkflowIdEvents } from "../../workflow/events";
import { prepareAtomicWorkflowHost } from "../../workflow/host";
import { prepareWorkflowResources } from "../../workflow/resources";
import { capturePaymentFinanceConfiguration, paymentFinanceCallLimit, type PaymentFinanceWorkflowInput } from "./finance-configuration";


/** Native single-refund root, including its Order credit-line child and
 * retained inverse, with one trusted settlement and the System provider. */
export const preparePaymentRefundWorkflow = Effect.fn("Payment.prepareRefund")(function* (input: PaymentFinanceWorkflowInput) {
  const { options, modules } = yield* capturePaymentFinanceConfiguration(input);
  const resources = yield* Effect.fromResult(prepareWorkflowResources({
    payment: { module: modules.payment.module, methods: ["refundPayment"], graph: true },
    order: { module: modules.order.module, methods: ["listOrderTransactions", "addOrderTransactions", "deleteOrderTransactions",
      "createOrderChange", "addOrderAction", "deleteOrderChanges", "deleteOrderChangeActions", "confirmOrderChange", "undoLastChange"], graph: true },
    order_payment_collection_links: { module: modules.order_payment_collection_links.module, methods: [], graph: true, expose: false },
  }, true, { logger: options.logger }));
  const prepared = yield* Effect.fromResult(refundPaymentWorkflow.prepare()).pipe(Effect.mapError(cause => commerceError("unsupportedProfile", cause)));
  const events = orderedWorkflowIdEvents(PaymentEvents.REFUNDED, Effect.fn("Payment.refundEventIds")(function* (calls) {
    const refunded = calls.calls(modules.payment.module.methods.refundPayment);
    if (refunded.length !== 1) return yield* Effect.fail(commerceError("receiptMismatch"));
    const args = yield* Effect.fromResult(decodePaymentRefund(refunded[0]?.input));
    return [args.payment_id];
  }));
  return yield* prepareAtomicWorkflowHost({ execution: options.execution, modules, revision: options.revision, subscribers: options.subscribers,
    requestCallLimit: paymentFinanceCallLimit, operationScheduling: "queued", borrowedOperationScheduling: "queued",
    workflow: { name: "refundPaymentWorkflow", resources, prepared, input: PaymentRefund, output: Schema.JsonObject, events } });
});
