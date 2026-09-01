import { Modules } from "@medusajs/utils/modules-sdk/definition"
import { defineJoinerConfigFromModels } from "@medusajs/utils/modules-sdk/portable-joiner-config-builder"
import { default as schema } from "./schema"
import { InventoryItem, InventoryLevel, ReservationItem } from "./models"

export const inventoryJoinerModels = [
  InventoryItem,
  InventoryLevel,
  ReservationItem,
]

export const joinerConfig = defineJoinerConfigFromModels(Modules.INVENTORY, {
  schema,
  models: inventoryJoinerModels,
  alias: [
    {
      name: ["inventory_items", "inventory_item", "inventory"],
      entity: "InventoryItem",
      args: {
        methodSuffix: "InventoryItems",
      },
    },
    {
      name: [
        "reservation",
        "reservations",
        "reservation_item",
        "reservation_items",
      ],
      entity: "ReservationItem",
      args: {
        methodSuffix: "ReservationItems",
      },
    },
  ],
})
