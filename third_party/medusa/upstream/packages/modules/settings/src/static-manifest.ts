import type { ModuleExports, StaticModuleResources } from "@medusajs/types"
import { ModulesDefinition } from "@medusajs/modules-sdk/definitions"
import { Modules } from "@medusajs/utils/modules-sdk/definition"
import { defineJoinerConfigFromModels } from "@medusajs/utils/modules-sdk/portable-joiner-config-builder"
import { UserPreference, ViewConfiguration } from "./models"
import { SettingsModuleService } from "./services"

export const settingsModuleDefinition = ModulesDefinition[Modules.SETTINGS]

export const settingsModuleModels = [ViewConfiguration, UserPreference]

export const settingsModuleExports: ModuleExports = {
  service: SettingsModuleService,
  loaders: [],
}

export const settingsStaticResources: StaticModuleResources = {
  models: settingsModuleModels,
  services: [],
  repositories: [],
  loaders: [],
  moduleService: SettingsModuleService,
  joinerConfig: defineJoinerConfigFromModels(Modules.SETTINGS, {
    models: settingsModuleModels,
  }),
}
