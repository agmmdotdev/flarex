import { prepareWorkflowResources } from "../../workflow/resources";
import type { PaymentFinanceWorkflowInput } from "./finance-configuration";

/** The genuine retained checkout marker supplies matching Payment/Collection
 * identities from its authenticated Session graph. This selects its complete
 * customerless System-provider child closure; it exposes no standalone root. */
export function preparePaymentRecreationResources(modules: PaymentFinanceWorkflowInput["modules"], logger: PaymentFinanceWorkflowInput["logger"]) {
  return prepareWorkflowResources({
    payment: { module: modules.payment.module,
      methods: ["refundPayment", "createPaymentSession", "deletePaymentSession", "listPaymentSessions"], graph: true },
    order: { module: modules.order.module, methods: ["listOrderTransactions", "addOrderTransactions", "deleteOrderTransactions"], graph: true },
    order_payment_collection_links: { module: modules.order_payment_collection_links.module, methods: [], graph: true, expose: false },
  }, true, { logger });
}
