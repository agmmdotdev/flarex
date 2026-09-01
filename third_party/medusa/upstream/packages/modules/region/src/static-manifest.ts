import type { ModuleExports, StaticModuleResources } from "@medusajs/types"
import { ModulesDefinition } from "@medusajs/modules-sdk/definitions"
import { Modules } from "@medusajs/utils/modules-sdk/definition"
import { defineJoinerConfigFromModels } from "@medusajs/utils/modules-sdk/portable-joiner-config-builder"
import loadDefaults from "./loaders/defaults"
import { Country, Region } from "./models"
import { RegionModuleService } from "./services"

export const regionModuleDefinition = ModulesDefinition[Modules.REGION]

export const regionModuleModels = [Region, Country]

export const regionModuleExports: ModuleExports = {
  service: RegionModuleService,
  loaders: [loadDefaults],
}

export const regionStaticResources: StaticModuleResources = {
  models: regionModuleModels,
  services: [],
  repositories: [],
  loaders: [loadDefaults],
  moduleService: RegionModuleService,
  joinerConfig: defineJoinerConfigFromModels(Modules.REGION, {
    models: regionModuleModels,
  }),
}
