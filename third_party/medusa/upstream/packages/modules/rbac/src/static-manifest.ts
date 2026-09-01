import type {
  Constructor,
  ModuleExports,
  RepositoryService,
  StaticModuleResources,
} from "@medusajs/types"
import { ModulesDefinition } from "@medusajs/modules-sdk/definitions"
import { Modules } from "@medusajs/utils/modules-sdk/definition"
import { defineJoinerConfigFromModels } from "@medusajs/utils/modules-sdk/portable-joiner-config-builder"
import initialDataLoader from "./loaders/initial-data"
import { RbacPolicy, RbacRole, RbacRoleParent, RbacRolePolicy } from "./models"
import { RbacModuleService } from "./services"

class RbacRepository {}

export const rbacModuleDefinition = ModulesDefinition[Modules.RBAC]

export const rbacModuleModels = [
  RbacRole,
  RbacPolicy,
  RbacRoleParent,
  RbacRolePolicy,
]

export const rbacModuleExports: ModuleExports = {
  service: RbacModuleService,
  loaders: [],
}

export const rbacStaticResources: StaticModuleResources = {
  models: rbacModuleModels,
  services: [],
  // Placeholder only: the Drizzle adapter replaces this by repository name.
  repositories: [
    RbacRepository as unknown as Constructor<RepositoryService>,
  ],
  loaders: [initialDataLoader],
  moduleService: RbacModuleService,
  joinerConfig: defineJoinerConfigFromModels(Modules.RBAC, {
    models: rbacModuleModels,
  }),
}
