import type { ModuleExports, StaticModuleResources } from "@medusajs/types"
import { ModulesDefinition } from "@medusajs/modules-sdk/definitions"
import { Modules } from "@medusajs/utils/modules-sdk/definition"
import { defineJoinerConfigFromModels } from "@medusajs/utils/modules-sdk/portable-joiner-config-builder"
import loadDefaults from "./loaders/defaults"
import { Locale, Settings, Translation } from "./models"
import TranslationModuleService from "./services/translation-module"

export const translationModuleDefinition =
  ModulesDefinition[Modules.TRANSLATION]

export const translationModuleModels = [Locale, Translation, Settings]

export const translationModuleExports: ModuleExports = {
  service: TranslationModuleService,
  loaders: [loadDefaults],
}

export const translationStaticResources: StaticModuleResources = {
  models: translationModuleModels,
  services: [],
  repositories: [],
  loaders: [loadDefaults],
  moduleService: TranslationModuleService,
  joinerConfig: defineJoinerConfigFromModels(Modules.TRANSLATION, {
    models: translationModuleModels,
  }),
}
