import type {
  Constructor,
  ModuleExports,
  RepositoryService,
  StaticModuleResources,
} from "@medusajs/types"
import { ModulesDefinition } from "@medusajs/modules-sdk/definitions"
import { Modules } from "@medusajs/utils/modules-sdk/definition"
import { defineJoinerConfigFromModels } from "@medusajs/utils/modules-sdk/portable-joiner-config-builder"
import {
  Price,
  PriceList,
  PriceListRule,
  PricePreference,
  PriceRule,
  PriceSet,
} from "./models"
import { PricingModuleService } from "./services"

export const pricingModuleDefinition = ModulesDefinition[Modules.PRICING]

class PricingRepository {
  constructor() {
    throw new Error(
      "PricingRepository is a static manifest placeholder and must be replaced by the selected persistence adapter"
    )
  }
}

const pricingJoinerModels = [
  PriceSet,
  PriceList,
  Price,
  PricePreference,
  PriceRule,
]

export const pricingModuleModels = [
  ...pricingJoinerModels,
  PriceListRule,
]

export const pricingModuleExports: ModuleExports = {
  service: PricingModuleService,
  loaders: [],
}

export const pricingStaticResources: StaticModuleResources = {
  models: pricingModuleModels,
  services: [],
  // Static composition must preserve the legacy custom repository registration
  // name. The selected persistence adapter replaces this placeholder before it
  // can be instantiated.
  repositories: [PricingRepository as Constructor<RepositoryService>],
  loaders: [],
  moduleService: PricingModuleService,
  joinerConfig: defineJoinerConfigFromModels(Modules.PRICING, {
    models: pricingJoinerModels,
  }),
}
