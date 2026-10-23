import {
  Order, OrderAddress, OrderChange, OrderChangeAction, OrderClaim, OrderClaimItem, OrderClaimItemImage,
  OrderCreditLine, OrderExchange, OrderExchangeItem, OrderItem, OrderLineItem, OrderLineItemAdjustment,
  OrderLineItemTaxLine, OrderShipping, OrderShippingMethod, OrderShippingMethodAdjustment,
  OrderShippingMethodTaxLine, OrderSummary, OrderTransaction, Return, ReturnItem, ReturnReason,
} from "@medusajs/order/models";
import { OrderModuleService, OrderService } from "@medusajs/order/services";
import { Module } from "@medusajs/utils/modules-sdk/module";
import { ContainerRegistrationKeys, DmlEntity, Modules } from "@medusajs/framework/utils/portable";
import type { ModulePersistenceModel } from "@medusajs/framework/types";
import type { CommerceCommandContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { defineCommerceModule, type CommerceModuleRepositories } from "../../module/definition";
import type { CommercePromiseOwner } from "../../module/promise-owner";
import type { commerceModuleEventBus } from "../../module/events";

Module(Modules.ORDER, { service: OrderModuleService });
function hasOrderModelName<const Name extends string>(model: unknown, name: Name): model is ModulePersistenceModel & { readonly name: Name } {
  return DmlEntity.isDmlEntity(model) && model.name === name;
}
/** Native cyclic model declarations lose their name literals during emission.
 * Recover only the conventional name after checking the genuine DML object. */
function orderModel<const Name extends string>(model: unknown, name: Name) {
  if (!hasOrderModelName(model, name)) throw new Error("Unexpected native Order model " + name);
  return model;
}
const orderModels = [Order, OrderAddress,
  orderModel(OrderChange, "OrderChange"), orderModel(OrderChangeAction, "OrderChangeAction"),
  orderModel(OrderClaim, "OrderClaim"), orderModel(OrderClaimItem, "OrderClaimItem"), orderModel(OrderClaimItemImage, "OrderClaimItemImage"),
  OrderCreditLine, orderModel(OrderExchange, "OrderExchange"), orderModel(OrderExchangeItem, "OrderExchangeItem"), OrderItem,
  orderModel(OrderLineItem, "OrderLineItem"), orderModel(OrderLineItemAdjustment, "OrderLineItemAdjustment"),
  orderModel(OrderLineItemTaxLine, "OrderLineItemTaxLine"), orderModel(OrderShipping, "OrderShipping"),
  orderModel(OrderShippingMethod, "OrderShippingMethod"), orderModel(OrderShippingMethodAdjustment, "OrderShippingMethodAdjustment"),
  orderModel(OrderShippingMethodTaxLine, "OrderShippingMethodTaxLine"), OrderSummary,
  orderModel(OrderTransaction, "OrderTransaction"), orderModel(Return, "Return"), orderModel(ReturnItem, "ReturnItem"), ReturnReason] as const;
export type OrderPersistenceModel = typeof orderModels[number];

/** Full native construction; the selected repositories and public facade own
 * admission. OrderService retains its native version retrieval implementation. */
export function defineOrderPersistenceModule<
  Binding extends CommerceModuleRepositories<OrderPersistenceModel> & {
    readonly eventBus: ReturnType<typeof commerceModuleEventBus>;
  },
  Service,
>(configuration: {
  readonly name: string;
  readonly profile: string;
  readonly bind: (ctx: CommerceCommandContext, owner: CommercePromiseOwner) => Binding;
  readonly service: (native: OrderModuleService) => Service;
}) {
  return defineCommerceModule({ name: configuration.name, models: orderModels,
    profile: { name: configuration.profile, capabilities: [], bind: configuration.bind },
    extensions: { orderService: { mode: "replace", create: ({ binding, persistence }) => {
      const container = { orderRepository: binding.repository(Order),
        [ContainerRegistrationKeys.MODULE_PERSISTENCE_ADAPTER]: persistence };
      return new OrderService(container);
    } } },
    service: ({ binding, dependencies, context }) => {
      const container = { ...dependencies, [Modules.EVENT_BUS]: binding.eventBus };
      const native = new OrderModuleService(container);
      return { service: configuration.service(native), context };
    },
  });
}
