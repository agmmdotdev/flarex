import type { ModuleExports, StaticModuleResources } from "@medusajs/types"
import { ModulesDefinition } from "@medusajs/modules-sdk/definitions"
import { Modules } from "@medusajs/utils/modules-sdk/definition"
import loadStaticProviders from "./loaders/static-providers"
import { joinerConfig } from "./joiner-config"
import { FileModuleService, FileProviderService } from "./services"

export const fileModuleDefinition = ModulesDefinition[Modules.FILE]

export const fileModuleModels: StaticModuleResources["models"] = []

export const fileModuleExports: ModuleExports = {
  service: FileModuleService,
  loaders: [],
}

export const fileStaticResources: StaticModuleResources = {
  models: fileModuleModels,
  services: [FileProviderService],
  repositories: [],
  loaders: [loadStaticProviders],
  moduleService: FileModuleService,
  joinerConfig,
}
