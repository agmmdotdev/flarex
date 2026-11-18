import type { ModuleExports, StaticModuleResources } from "@medusajs/types"
import { ModulesDefinition } from "@medusajs/modules-sdk/definitions"
import { Modules } from "@medusajs/utils/modules-sdk/definition"
import { defineJoinerConfigFromModels } from "@medusajs/utils/modules-sdk/portable-joiner-config-builder"
import { StockLocation, StockLocationAddress } from "./models"
import schema from "./schema"
import { StockLocationModuleService } from "./services"

export const stockLocationModuleDefinition =
  ModulesDefinition[Modules.STOCK_LOCATION]

export const stockLocationModuleModels = [StockLocationAddress, StockLocation]

export const stockLocationModuleExports: ModuleExports = {
  service: StockLocationModuleService,
  loaders: [],
}

export const stockLocationStaticResources: StaticModuleResources = {
  models: stockLocationModuleModels,
  services: [],
  repositories: [],
  loaders: [],
  moduleService: StockLocationModuleService,
  joinerConfig: defineJoinerConfigFromModels(Modules.STOCK_LOCATION, {
    schema,
    models: stockLocationModuleModels,
    linkableKeys: {
      stock_location_id: StockLocation.name,
      location_id: StockLocation.name,
    },
  }),
}
