import notificationModule from "../index"
import { ModulesDefinition } from "@medusajs/modules-sdk"
import { Modules } from "@medusajs/utils/modules-sdk/definition"
import loadStaticProviders from "../loaders/static-providers"
import { Notification, NotificationProvider } from "../models"
import {
  NotificationModuleService,
  NotificationProviderService,
} from "../services"
import {
  notificationModuleDefinition,
  notificationModuleExports,
  notificationStaticResources,
} from "../static-manifest"

describe("Notification static manifest", () => {
  it("matches the normal Notification module export and explicit static resources", () => {
    expect(notificationModuleDefinition).toEqual(
      ModulesDefinition[Modules.NOTIFICATION]
    )
    expect(notificationModuleExports.service).toBe(notificationModule.service)
    expect(notificationModuleExports.loaders).toEqual([])
    expect(notificationStaticResources.moduleService).toBe(
      NotificationModuleService
    )
    expect(notificationStaticResources.models).toEqual([
      Notification,
      NotificationProvider,
    ])
    expect(notificationStaticResources.services).toEqual([
      NotificationProviderService,
    ])
    expect(notificationStaticResources.repositories).toEqual([])
    expect(notificationStaticResources.loaders).toEqual([loadStaticProviders])
    expect(
      notificationStaticResources.joinerConfig?.linkableKeys?.notification_id
    ).toBe("Notification")
  })
})
