import type { ModuleExports, StaticModuleResources } from "@medusajs/types"
import { ModulesDefinition } from "@medusajs/modules-sdk/definitions"
import { Modules } from "@medusajs/utils/modules-sdk/definition"
import { defineJoinerConfigFromModels } from "@medusajs/utils/modules-sdk/portable-joiner-config-builder"
import { ApiKey } from "./models"
import { ApiKeyModuleService } from "./services"

export const apiKeyModuleDefinition = ModulesDefinition[Modules.API_KEY]

export const apiKeyModuleModels = [ApiKey]

export const apiKeyModuleExports: ModuleExports = {
  service: ApiKeyModuleService,
  loaders: [],
}

export const apiKeyStaticResources: StaticModuleResources = {
  models: apiKeyModuleModels,
  services: [],
  repositories: [],
  loaders: [],
  moduleService: ApiKeyModuleService,
  joinerConfig: defineJoinerConfigFromModels(Modules.API_KEY, {
    models: apiKeyModuleModels,
    linkableKeys: {
      publishable_key_id: "ApiKey",
    },
  }),
}
