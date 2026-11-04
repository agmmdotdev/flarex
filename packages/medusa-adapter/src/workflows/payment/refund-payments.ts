import { Effect, Schema } from "effect";
import { refundPaymentsWorkflow } from "@medusajs/core-flows/payment/refund-payments";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { PaymentAmount } from "../../modules/payment/input";
import { PaymentRefund } from "../../modules/payment/lifecycle-input";
import { internalModuleWorkflowEvents } from "../../workflow/events";
import { prepareAtomicWorkflowHost } from "../../workflow/host";
import { prepareWorkflowResources } from "../../workflow/resources";
import { capturePaymentFinanceConfiguration, paymentFinanceCallLimit, type NativePaymentFinanceWorkflowInput } from "./finance-configuration";

const Batch = Schema.Array(Schema.Struct({ payment_id: PaymentRefund.fields.payment_id, amount: PaymentAmount,
  created_by: PaymentRefund.fields.created_by, note: PaymentRefund.fields.note })).check(Schema.isMaxLength(4));

/** Execute the genuine batch root with real stored Order associations. This
 * bounded System-provider profile borrows one atomic settlement; network
 * providers and native independently committed best-effort calls remain gated. */
export const preparePaymentRefundsWorkflow = Effect.fn("Payment.prepareRefunds")(function* (input: NativePaymentFinanceWorkflowInput) {
  const { options, modules } = yield* capturePaymentFinanceConfiguration(input, "native");
  const resources = yield* Effect.fromResult(prepareWorkflowResources({
    payment: { module: modules.payment.module, methods: ["refundPayment"], graph: true },
    order: { module: modules.order.module, methods: ["listOrderTransactions", "addOrderTransactions", "deleteOrderTransactions"], graph: true },
    order_payment_collection_links: { module: modules.order_payment_collection_links.module, methods: [], graph: true, expose: false },
  }, true, { logger: options.logger }));
  const prepared = yield* Effect.fromResult(refundPaymentsWorkflow.prepare()).pipe(Effect.mapError(cause => commerceError("unsupportedProfile", cause)));
  return yield* prepareAtomicWorkflowHost({ execution: options.execution, modules, revision: options.revision, subscribers: options.subscribers,
    requestCallLimit: paymentFinanceCallLimit, operationScheduling: "queued", borrowedOperationScheduling: "queued",
    workflow: { name: "refundPaymentsWorkflow", resources, prepared, input: Batch, output: Schema.Array(Schema.JsonObject), events: internalModuleWorkflowEvents } });
});
