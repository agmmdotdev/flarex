import type { ModuleExports, StaticModuleResources } from "@medusajs/types"
import { ModulesDefinition } from "@medusajs/modules-sdk/definitions"
import { Modules } from "@medusajs/utils/modules-sdk/definition"
import { defineJoinerConfigFromModels } from "@medusajs/utils/modules-sdk/portable-joiner-config-builder"
import { SalesChannel } from "./models"
import { SalesChannelModuleService } from "./services"

export const salesChannelModuleDefinition =
  ModulesDefinition[Modules.SALES_CHANNEL]

export const salesChannelModuleModels = [SalesChannel]

export const salesChannelModuleExports: ModuleExports = {
  service: SalesChannelModuleService,
  loaders: [],
}

export const salesChannelStaticResources: StaticModuleResources = {
  models: salesChannelModuleModels,
  services: [],
  repositories: [],
  loaders: [],
  moduleService: SalesChannelModuleService,
  joinerConfig: defineJoinerConfigFromModels(Modules.SALES_CHANNEL, {
    models: salesChannelModuleModels,
  }),
}
