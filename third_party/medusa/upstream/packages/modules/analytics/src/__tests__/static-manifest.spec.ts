import analyticsModule from "../index"
import loadStaticProviders from "../loaders/static-providers"
import AnalyticsService from "../services/analytics-service"
import AnalyticsProviderService from "../services/provider-service"
import {
  analyticsModuleDefinition,
  analyticsModuleExports,
  analyticsStaticResources,
} from "../static-manifest"
import { ModulesDefinition } from "@medusajs/modules-sdk/definitions"
import { Modules } from "@medusajs/utils/modules-sdk/definition"

describe("Analytics static manifest", () => {
  it("matches the normal Analytics module export and explicit static resources", () => {
    expect(analyticsModuleDefinition).toEqual(
      ModulesDefinition[Modules.ANALYTICS]
    )
    expect(analyticsModuleExports.service).toBe(analyticsModule.service)
    expect(analyticsModuleExports.loaders).toEqual([])
    expect(analyticsStaticResources.moduleService).toBe(AnalyticsService)
    expect(analyticsStaticResources.models).toEqual([])
    expect(analyticsStaticResources.services).toEqual([
      AnalyticsProviderService,
    ])
    expect(analyticsStaticResources.repositories).toEqual([])
    expect(analyticsStaticResources.loaders).toEqual([loadStaticProviders])
  })
})
