import type { ModuleExports, StaticModuleResources } from "@medusajs/types"
import { ModulesDefinition } from "@medusajs/modules-sdk/definitions"
import { Modules } from "@medusajs/utils/modules-sdk/definition"
import { defineJoinerConfigFromModels } from "@medusajs/utils/modules-sdk/portable-joiner-config-builder"
import { Currency } from "./models"
import { CurrencyModuleService } from "./services"

export const currencyModuleDefinition = ModulesDefinition[Modules.CURRENCY]

export const currencyModuleExports: ModuleExports = {
  service: CurrencyModuleService,
  loaders: [],
}

export const currencyStaticResources: StaticModuleResources = {
  models: [Currency],
  services: [],
  repositories: [],
  loaders: [],
  moduleService: CurrencyModuleService,
  joinerConfig: defineJoinerConfigFromModels(Modules.CURRENCY, {
    models: [Currency],
  }),
}
