import { Modules } from "@medusajs/framework/utils/portable"
import { defineJoinerConfigFromModels } from "@medusajs/utils/modules-sdk/portable-joiner-config-builder"
import {
  Order,
  OrderAddress,
  OrderChange,
  OrderClaim,
  OrderExchange,
  OrderItem,
  OrderLineItem,
  OrderShippingMethod,
  OrderTransaction,
  Return,
  ReturnReason,
} from "./models"
import { default as schema } from "./schema"

export const joinerConfig = defineJoinerConfigFromModels(Modules.ORDER, {
  schema,
  linkableKeys: {
    claim_id: "OrderClaim",
    exchange_id: "OrderExchange",
  },
  models: [
    Order,
    OrderAddress,
    OrderChange,
    OrderClaim,
    OrderExchange,
    OrderItem,
    OrderLineItem,
    OrderShippingMethod,
    OrderTransaction,
    Return,
    ReturnReason,
  ],
})
