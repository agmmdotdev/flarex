import { PaymentModuleService } from "@medusajs/payment/services";
import { SystemPaymentProvider } from "@medusajs/payment/providers/system";
import { PaymentSessionStatus } from "@medusajs/framework/utils/portable";

/** Fault selection observes the genuine provider input and invokes both native
 * methods. The late fault follows successful native authorization, after Order,
 * Cart, Promotion, Inventory and stored Link operations have already returned. */
export function installStoreCartCompletionFailure() {
  const providerAuthorize = SystemPaymentProvider.prototype.authorizePayment;
  const sessionAuthorize = PaymentModuleService.prototype.authorizePaymentSession;
  const lateSessions = new Set<string>();
  let completedAuthorizations = 0;
  let refusedAuthorizations = 0;
  SystemPaymentProvider.prototype.authorizePayment = async function (input) {
    const result = await Reflect.apply(providerAuthorize, this, [input]);
    if (input.data?.refuse_completion_authorization === true) {
      refusedAuthorizations++;
      return { ...result, status: PaymentSessionStatus.ERROR };
    }
    const sessionId = input.context?.idempotency_key;
    if (input.data?.fail_completion_after_authorization === true && typeof sessionId === "string") lateSessions.add(sessionId);
    return result;
  };
  PaymentModuleService.prototype.authorizePaymentSession = async function (...args) {
    const result = await Reflect.apply(sessionAuthorize, this, args);
    if (lateSessions.delete(args[0])) {
      completedAuthorizations++;
      throw new Error("late-http-completion-after-native-authorization");
    }
    return result;
  };
  return {
    authorizations: () => completedAuthorizations,
    refusals: () => refusedAuthorizations,
    restore() {
      SystemPaymentProvider.prototype.authorizePayment = providerAuthorize;
      PaymentModuleService.prototype.authorizePaymentSession = sessionAuthorize;
      lateSessions.clear();
    },
  };
}
