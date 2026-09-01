import type { ModuleExports, StaticModuleResources } from "@medusajs/types"
import { ModulesDefinition } from "@medusajs/modules-sdk/definitions"
import { Modules } from "@medusajs/utils/modules-sdk/definition"
import { defineJoinerConfigFromModels } from "@medusajs/utils/modules-sdk/portable-joiner-config-builder"
import { Invite, User } from "./models"
import { UserModuleService } from "./services"

export const userModuleDefinition = ModulesDefinition[Modules.USER]

export const userModuleModels = [User, Invite]

export const userModuleExports: ModuleExports = {
  service: UserModuleService,
  loaders: [],
}

export const userStaticResources: StaticModuleResources = {
  models: userModuleModels,
  services: [],
  repositories: [],
  loaders: [],
  moduleService: UserModuleService,
  joinerConfig: defineJoinerConfigFromModels(Modules.USER, {
    models: userModuleModels,
  }),
}
