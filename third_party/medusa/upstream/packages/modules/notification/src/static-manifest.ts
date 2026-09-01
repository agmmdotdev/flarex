import type { ModuleExports, StaticModuleResources } from "@medusajs/types"
import { ModulesDefinition } from "@medusajs/modules-sdk/definitions"
import { Modules } from "@medusajs/utils/modules-sdk/definition"
import { defineJoinerConfigFromModels } from "@medusajs/utils/modules-sdk/portable-joiner-config-builder"
import loadStaticProviders from "./loaders/static-providers"
import { Notification, NotificationProvider } from "./models"
import {
  NotificationModuleService,
  NotificationProviderService,
} from "./services"

export const notificationModuleDefinition =
  ModulesDefinition[Modules.NOTIFICATION]

export const notificationModuleModels = [Notification, NotificationProvider]

export const notificationModuleExports: ModuleExports = {
  service: NotificationModuleService,
  loaders: [],
}

export const notificationStaticResources: StaticModuleResources = {
  models: notificationModuleModels,
  services: [NotificationProviderService],
  repositories: [],
  loaders: [loadStaticProviders],
  moduleService: NotificationModuleService,
  joinerConfig: defineJoinerConfigFromModels(Modules.NOTIFICATION, {
    models: [Notification],
  }),
}
