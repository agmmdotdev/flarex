import orderModule from "../index"
import { ModulesDefinition } from "@medusajs/modules-sdk"
import { Modules } from "@medusajs/utils/modules-sdk/definition"
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
} from "../models"
import OrderModuleService from "../services/order-module-service"
import OrderService from "../services/order-service"
import {
  orderModuleDefinition,
  orderModuleExports,
  orderStaticResources,
} from "../static-manifest"

describe("Order static manifest", () => {
  it("matches the normal Order service export and explicit static resources", () => {
    expect(orderModuleDefinition).toEqual(ModulesDefinition[Modules.ORDER])
    expect(orderModuleExports.service).toBe(orderModule.service)
    expect(orderModuleExports.loaders).toEqual([])
    expect(orderStaticResources.moduleService).toBe(OrderModuleService)
    expect(orderStaticResources.models).toEqual([
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
    ])
    expect(orderStaticResources.services).toEqual([OrderService])
    expect(orderStaticResources.repositories).toEqual([])
    expect(orderStaticResources.loaders).toEqual([])
    expect(orderStaticResources.joinerConfig?.serviceName).toBe(Modules.ORDER)
  })
})
