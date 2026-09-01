import type { ModuleExports, StaticModuleResources } from "@medusajs/types"
import { ModulesDefinition } from "@medusajs/modules-sdk/definitions"
import { Modules } from "@medusajs/utils/modules-sdk/definition"
import loadHash from "./loaders/hash"
import loadStaticProviders from "./loaders/static-providers"
import CachingModuleService from "./services/cache-module"
import CachingProviderService from "./services/cache-provider"

export const cachingModuleDefinition = ModulesDefinition[Modules.CACHING]

export const cachingModuleExports: ModuleExports = {
  service: CachingModuleService,
  loaders: [],
}

export const cachingStaticResources: StaticModuleResources = {
  models: [],
  services: [CachingProviderService],
  repositories: [],
  loaders: [loadHash, loadStaticProviders],
  moduleService: CachingModuleService,
}
