import type { ModuleExports, StaticModuleResources } from "@medusajs/types"
import { ModulesDefinition } from "@medusajs/modules-sdk/definitions"
import { Modules } from "@medusajs/utils/modules-sdk/definition"
import Loader from "./loaders"
import LocalEventBus from "./services/event-bus-local"

export const eventBusLocalModuleDefinition =
  ModulesDefinition[Modules.EVENT_BUS]

export const eventBusLocalModuleExports: ModuleExports = {
  service: LocalEventBus,
  loaders: [],
}

export const eventBusLocalStaticResources: StaticModuleResources = {
  models: [],
  services: [],
  repositories: [],
  loaders: [Loader],
  moduleService: LocalEventBus,
}
