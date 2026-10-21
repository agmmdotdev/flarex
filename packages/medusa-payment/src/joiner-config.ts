import { Modules } from "@medusajs/framework/utils/portable"
import { defineJoinerConfigFromModels } from "@medusajs/utils/modules-sdk/portable-joiner-config-builder"
import {
  AccountHolder,
  Payment,
  PaymentCollection,
  PaymentProvider,
  PaymentSession,
  Capture,
  Refund,
  RefundReason,
} from "./models"

export const joinerConfig = defineJoinerConfigFromModels(Modules.PAYMENT, {
  models: [
    PaymentCollection,
    PaymentSession,
    Payment,
    Capture,
    Refund,
    RefundReason,
    AccountHolder,
    PaymentProvider,
  ],
  linkableKeys: {
    payment_id: Payment.name,
    payment_collection_id: PaymentCollection.name,
    payment_provider_id: PaymentProvider.name,
    refund_reason_id: RefundReason.name,
    account_holder_id: AccountHolder.name,
  },
  alias: [
    {
      name: ["payment_method", "payment_methods"],
      entity: "PaymentMethod",
      args: {
        methodSuffix: "PaymentMethods",
      },
    },
  ],
})
