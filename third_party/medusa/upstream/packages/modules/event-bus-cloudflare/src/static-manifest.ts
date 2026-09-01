import type { ModuleExports, StaticModuleResources } from "@medusajs/types"
import { ModulesDefinition } from "@medusajs/modules-sdk/definitions"
import { Modules } from "@medusajs/utils/modules-sdk/definition"
import CloudflareEventBus from "./services/event-bus-cloudflare"

export const eventBusCloudflareModuleDefinition =
  ModulesDefinition[Modules.EVENT_BUS]

export const eventBusCloudflareModuleExports: ModuleExports = {
  service: CloudflareEventBus,
  loaders: [],
}

export const eventBusCloudflareStaticResources: StaticModuleResources = {
  models: [],
  services: [],
  repositories: [],
  loaders: [],
  moduleService: CloudflareEventBus,
}
