import eventBusLocalModule from "../index"
import Loader from "../loaders"
import LocalEventBus from "../services/event-bus-local"
import {
  eventBusLocalModuleDefinition,
  eventBusLocalModuleExports,
  eventBusLocalStaticResources,
} from "../static-manifest"
import { ModulesDefinition } from "@medusajs/modules-sdk/definitions"
import { Modules } from "@medusajs/utils/modules-sdk/definition"

describe("Event Bus Local static manifest", () => {
  it("matches the normal Event Bus Local service and explicit static resources", () => {
    expect(eventBusLocalModuleDefinition).toEqual(
      ModulesDefinition[Modules.EVENT_BUS]
    )
    expect(eventBusLocalModuleExports.service).toBe(eventBusLocalModule.service)
    expect(eventBusLocalModuleExports.loaders).toEqual([])
    expect(eventBusLocalStaticResources.moduleService).toBe(LocalEventBus)
    expect(eventBusLocalStaticResources.models).toEqual([])
    expect(eventBusLocalStaticResources.services).toEqual([])
    expect(eventBusLocalStaticResources.repositories).toEqual([])
    expect(eventBusLocalStaticResources.loaders).toEqual([Loader])
  })
})
