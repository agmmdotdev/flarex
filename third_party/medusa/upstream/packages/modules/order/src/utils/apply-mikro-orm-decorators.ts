import { BeforeCreate, OnInit } from "@medusajs/framework/mikro-orm/core"
import { toMikroORMEntity } from "@medusajs/framework/utils"
import { OrderChangeAction, OrderItem, OrderShipping } from "../models"

function applyOrderChangeActionHooks() {
  const MikroORMEntity = toMikroORMEntity(OrderChangeAction)

  MikroORMEntity.prototype["onInit_OrderChangeAction"] = function () {
    if (this.order_change) {
      this.version ??= this.order_change.version ?? null

      this.order_id ??= this.order_change.order_id ?? null
      this.claim_id ??= this.order_change.claim_id ?? null
      this.exchange_id ??= this.order_change.exchange_id ?? null
    }

    if (
      !this.claim_id &&
      !this.exchange_id &&
      (this.return || this.order_change)
    ) {
      this.return_id = this.return?.id ?? this.order_change?.return_id ?? null
    }
  }

  OnInit()(MikroORMEntity.prototype, "onInit_OrderChangeAction")
  BeforeCreate()(MikroORMEntity.prototype, "onInit_OrderChangeAction")
}

function applyOrderShippingHooks() {
  const MikroORMEntity = toMikroORMEntity(OrderShipping)

  MikroORMEntity.prototype["onInit_OrderShipping"] = function () {
    if (this.order) {
      this.version ??= this.order.version ?? null
    }
  }

  OnInit()(MikroORMEntity.prototype, "onInit_OrderShipping")
  BeforeCreate()(MikroORMEntity.prototype, "onInit_OrderShipping")
}

function applyOrderItemHooks() {
  const MikroORMEntity = toMikroORMEntity(OrderItem)

  MikroORMEntity.prototype["onInit_OrderItem"] = function () {
    if (this.order) {
      this.version ??= this.order.version ?? null
    }
  }

  OnInit()(MikroORMEntity.prototype, "onInit_OrderItem")
  BeforeCreate()(MikroORMEntity.prototype, "onInit_OrderItem")
}

export function applyMikroOrmEntityHooks() {
  applyOrderChangeActionHooks()
  applyOrderShippingHooks()
  applyOrderItemHooks()
}
