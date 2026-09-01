import type { ModuleExports, StaticModuleResources } from "@medusajs/types"
import { ModulesDefinition } from "@medusajs/modules-sdk/definitions"
import { Modules } from "@medusajs/utils/modules-sdk/definition"
import loadStaticProviders from "./loaders/static-providers"
import LockingModuleService from "./services/locking-module"
import LockingProviderService from "./services/locking-provider"

export const lockingModuleDefinition = ModulesDefinition[Modules.LOCKING]

export const lockingModuleExports: ModuleExports = {
  service: LockingModuleService,
  loaders: [],
}

export const lockingStaticResources: StaticModuleResources = {
  models: [],
  services: [LockingProviderService],
  repositories: [],
  loaders: [loadStaticProviders],
  moduleService: LockingModuleService,
}
