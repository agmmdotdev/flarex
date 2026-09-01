import type { ModuleExports, StaticModuleResources } from "@medusajs/types"
import { ModulesDefinition } from "@medusajs/modules-sdk/definitions"
import { Modules } from "@medusajs/utils/modules-sdk/definition"
import loadStaticProviders from "./loaders/static-providers"
import AnalyticsService from "./services/analytics-service"
import AnalyticsProviderService from "./services/provider-service"

export const analyticsModuleDefinition = ModulesDefinition[Modules.ANALYTICS]

export const analyticsModuleExports: ModuleExports = {
  service: AnalyticsService,
  loaders: [],
}

export const analyticsStaticResources: StaticModuleResources = {
  models: [],
  services: [AnalyticsProviderService],
  repositories: [],
  loaders: [loadStaticProviders],
  moduleService: AnalyticsService,
}
