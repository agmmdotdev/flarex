import type { ModuleExports, StaticModuleResources } from "@medusajs/types"
import { ModulesDefinition } from "@medusajs/modules-sdk/definitions"
import { Modules } from "@medusajs/utils/modules-sdk/definition"
import { defineJoinerConfigFromModels } from "@medusajs/utils/modules-sdk/portable-joiner-config-builder"
import {
  Order,
  OrderAddress,
  OrderChange,
  OrderChangeAction,
  OrderClaim,
  OrderClaimItem,
  OrderClaimItemImage,
  OrderCreditLine,
  OrderExchange,
  OrderExchangeItem,
  OrderItem,
  OrderLineItem,
  OrderLineItemAdjustment,
  OrderLineItemTaxLine,
  OrderShipping,
  OrderShippingMethod,
  OrderShippingMethodAdjustment,
  OrderShippingMethodTaxLine,
  OrderSummary,
  OrderTransaction,
  Return,
  ReturnItem,
  ReturnReason,
} from "./models"
import schema from "./schema"
import OrderModuleService from "./services/order-module-service"
import OrderService from "./services/order-service"

export const orderModuleDefinition = ModulesDefinition[Modules.ORDER]

const orderJoinerModels = [
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
]

export const orderModuleModels = [
  ...orderJoinerModels,
  OrderChangeAction,
  OrderClaimItem,
  OrderClaimItemImage,
  OrderCreditLine,
  OrderExchangeItem,
  OrderLineItemAdjustment,
  OrderLineItemTaxLine,
  OrderShipping,
  OrderShippingMethodAdjustment,
  OrderShippingMethodTaxLine,
  OrderSummary,
  ReturnItem,
]

export const orderModuleExports: ModuleExports = {
  service: OrderModuleService,
  loaders: [],
}

export const orderStaticResources: StaticModuleResources = {
  models: orderModuleModels,
  services: [OrderService],
  repositories: [],
  loaders: [],
  moduleService: OrderModuleService,
  joinerConfig: defineJoinerConfigFromModels(Modules.ORDER, {
    schema,
    linkableKeys: {
      claim_id: "OrderClaim",
      exchange_id: "OrderExchange",
    },
    models: orderJoinerModels,
  }),
}
