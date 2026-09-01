import type { ModuleExports, StaticModuleResources } from "@medusajs/types"
import { ModulesDefinition } from "@medusajs/modules-sdk/definitions"
import { Modules } from "@medusajs/utils/modules-sdk/definition"
import { defineJoinerConfigFromModels } from "@medusajs/utils/modules-sdk/portable-joiner-config-builder"
import { TaxProvider, TaxRate, TaxRateRule, TaxRegion } from "./models"
import TaxModuleService from "./services/tax-module-service"
import TaxProviderService from "./services/tax-provider"

export const taxModuleDefinition = ModulesDefinition[Modules.TAX]

export const taxModuleModels = [TaxProvider, TaxRate, TaxRateRule, TaxRegion]

export const taxModuleExports: ModuleExports = {
  service: TaxModuleService,
  loaders: [],
}

export const taxStaticResources: StaticModuleResources = {
  models: taxModuleModels,
  services: [TaxProviderService],
  repositories: [],
  loaders: [],
  moduleService: TaxModuleService,
  joinerConfig: defineJoinerConfigFromModels(Modules.TAX, {
    models: taxModuleModels,
  }),
}
