import type { ModuleExports, StaticModuleResources } from "@medusajs/types"
import { ModulesDefinition } from "@medusajs/modules-sdk/definitions"
import { Modules } from "@medusajs/utils/modules-sdk/definition"
import { defineJoinerConfigFromModels } from "@medusajs/utils/modules-sdk/portable-joiner-config-builder"
import {
  Address,
  Cart,
  CreditLine,
  LineItem,
  LineItemAdjustment,
  LineItemTaxLine,
  ShippingMethod,
  ShippingMethodAdjustment,
  ShippingMethodTaxLine,
} from "./models"
import { CartModuleService } from "./services"

export const cartModuleDefinition = ModulesDefinition[Modules.CART]

export const cartModuleModels = [
  Address,
  Cart,
  CreditLine,
  LineItem,
  LineItemAdjustment,
  LineItemTaxLine,
  ShippingMethod,
  ShippingMethodAdjustment,
  ShippingMethodTaxLine,
]

export const cartModuleExports: ModuleExports = {
  service: CartModuleService,
  loaders: [],
}

export const cartStaticResources: StaticModuleResources = {
  models: cartModuleModels,
  services: [],
  repositories: [],
  loaders: [],
  moduleService: CartModuleService,
  joinerConfig: defineJoinerConfigFromModels(Modules.CART, {
    models: cartModuleModels,
  }),
}
