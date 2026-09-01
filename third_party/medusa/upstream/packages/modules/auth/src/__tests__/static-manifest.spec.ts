import authModule from "../index"
import { ModulesDefinition } from "@medusajs/modules-sdk"
import { Modules } from "@medusajs/utils/modules-sdk/definition"
import { AuthIdentity, ProviderIdentity } from "../models"
import { AuthModuleService, AuthProviderService } from "../services"
import {
  authModuleDefinition,
  authModuleExports,
  authStaticResources,
} from "../static-manifest"

describe("Auth static manifest", () => {
  it("matches the normal Auth module export and explicit static resources", () => {
    expect(authModuleDefinition).toEqual(ModulesDefinition[Modules.AUTH])
    expect(authModuleExports.service).toBe(authModule.service)
    expect(authModuleExports.loaders).toEqual([])
    expect(authStaticResources.moduleService).toBe(AuthModuleService)
    expect(authStaticResources.models).toEqual([
      AuthIdentity,
      ProviderIdentity,
    ])
    expect(authStaticResources.services).toEqual([AuthProviderService])
    expect(authStaticResources.repositories).toEqual([])
    expect(authStaticResources.loaders).toEqual([])

    const normalizedSchema = authStaticResources.joinerConfig?.schema
      ?.replace(/\s+/g, " ")
      .trim()

    expect(normalizedSchema).toEqual(
      expect.stringContaining("type AuthIdentity")
    )
    expect(normalizedSchema).toEqual(
      expect.stringContaining("type ProviderIdentity")
    )
  })
})
