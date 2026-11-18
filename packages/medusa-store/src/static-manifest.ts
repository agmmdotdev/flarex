import type { ModuleExports, StaticModuleResources } from "@medusajs/types"
import { ModulesDefinition } from "@medusajs/modules-sdk/definitions"
import { Modules } from "@medusajs/utils/modules-sdk/definition"
import { defineJoinerConfigFromModels } from "@medusajs/utils/modules-sdk/portable-joiner-config-builder"
import { Store, StoreCurrency, StoreLocale } from "./models"
import { StoreModuleService } from "./services"

export const storeModuleDefinition = ModulesDefinition[Modules.STORE]

export const storeModuleModels = [Store, StoreCurrency, StoreLocale]

export const storeModuleExports: ModuleExports = {
  service: StoreModuleService,
  loaders: [],
}

export const storeStaticResources: StaticModuleResources = {
  models: storeModuleModels,
  services: [],
  repositories: [],
  loaders: [],
  moduleService: StoreModuleService,
  joinerConfig: defineJoinerConfigFromModels(Modules.STORE, {
    models: storeModuleModels,
  }),
}
