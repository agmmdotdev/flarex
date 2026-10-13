import type { ModuleExports, StaticModuleResources } from "@medusajs/types"
import { ModulesDefinition } from "@medusajs/modules-sdk/definitions"
import { Modules } from "@medusajs/utils/modules-sdk/definition"
import { defineJoinerConfigFromModels } from "@medusajs/utils/modules-sdk/portable-joiner-config-builder"
import { InventoryItem, InventoryLevel, ReservationItem } from "./models"
import schema from "./schema"
import InventoryModuleService from "./services/inventory-module"
import { inventoryJoinerModels } from "./joiner-config"

export const inventoryModuleDefinition = ModulesDefinition[Modules.INVENTORY]

export const inventoryModuleModels = [
  InventoryItem,
  InventoryLevel,
  ReservationItem,
]

export const inventoryModuleExports: ModuleExports = {
  service: InventoryModuleService,
  loaders: [],
}

export const inventoryStaticResources: StaticModuleResources = {
  models: inventoryModuleModels,
  services: [],
  repositories: [],
  loaders: [],
  moduleService: InventoryModuleService,
  joinerConfig: defineJoinerConfigFromModels(Modules.INVENTORY, {
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
  }),
}
