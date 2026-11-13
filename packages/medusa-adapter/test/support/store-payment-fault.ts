import { SystemPaymentProvider } from "@medusajs/payment/providers/system";

/** The genuine module has inserted its pending Session before this provider
 * call. This fixture fault also follows any native account-holder creation. */
export function installStorePaymentFailure() {
  const initiate = SystemPaymentProvider.prototype.initiatePayment;
  SystemPaymentProvider.prototype.initiatePayment = async function (input) {
    const result = await Reflect.apply(initiate, this, [input]);
    if (input.data?.fail_workerd_payment === true) throw new Error("late-workerd-payment-session");
    return result;
  };
}
