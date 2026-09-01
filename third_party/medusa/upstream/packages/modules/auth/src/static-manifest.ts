import type { ModuleExports, StaticModuleResources } from "@medusajs/types"
import { ModulesDefinition } from "@medusajs/modules-sdk/definitions"
import { Modules } from "@medusajs/utils/modules-sdk/definition"
import { AuthIdentity, ProviderIdentity } from "./models"
import { joinerConfig } from "./joiner-config"
import { AuthModuleService, AuthProviderService } from "./services"

export const authModuleDefinition = ModulesDefinition[Modules.AUTH]

export const authModuleModels = [AuthIdentity, ProviderIdentity]

export const authModuleExports: ModuleExports = {
  service: AuthModuleService,
  loaders: [],
}

export const authStaticResources: StaticModuleResources = {
  models: authModuleModels,
  services: [AuthProviderService],
  repositories: [],
  loaders: [],
  moduleService: AuthModuleService,
  joinerConfig,
}
