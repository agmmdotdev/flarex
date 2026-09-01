import { Modules } from "@medusajs/framework/utils"
import { UserPreference, ViewConfiguration } from "../models"
import { SettingsModuleService } from "../services"
import {
  settingsModuleDefinition,
  settingsModuleExports,
  settingsModuleModels,
  settingsStaticResources,
} from "../static-manifest"

describe("Settings static manifest", () => {
  it("matches the normal Settings module export and explicit static resources", () => {
    expect(settingsModuleDefinition.key).toBe(Modules.SETTINGS)
    expect(settingsModuleExports.service).toBe(SettingsModuleService)
    expect(settingsModuleModels).toEqual([ViewConfiguration, UserPreference])
    expect(settingsStaticResources.models).toBe(settingsModuleModels)
    expect(settingsStaticResources.services).toEqual([])
    expect(settingsStaticResources.repositories).toEqual([])
    expect(settingsStaticResources.loaders).toEqual([])
    expect(settingsStaticResources.moduleService).toBe(SettingsModuleService)
    expect(settingsStaticResources.joinerConfig?.serviceName).toBe(
      Modules.SETTINGS
    )
    expect(settingsStaticResources.joinerConfig?.linkableKeys).toMatchObject({
      view_configuration_id: "ViewConfiguration",
      user_preference_id: "UserPreference",
    })
  })
})
