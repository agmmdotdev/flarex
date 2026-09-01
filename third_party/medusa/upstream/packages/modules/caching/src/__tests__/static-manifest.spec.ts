import cachingModule from "../index"
import loadHash from "../loaders/hash"
import loadStaticProviders from "../loaders/static-providers"
import CachingModuleService from "../services/cache-module"
import CachingProviderService from "../services/cache-provider"
import {
  cachingModuleDefinition,
  cachingModuleExports,
  cachingStaticResources,
} from "../static-manifest"
import { ModulesDefinition } from "@medusajs/modules-sdk/definitions"
import { Modules } from "@medusajs/utils/modules-sdk/definition"

describe("Caching static manifest", () => {
  it("matches the normal Caching module service and explicit static resources", () => {
    expect(cachingModuleDefinition).toEqual(
      ModulesDefinition[Modules.CACHING]
    )
    expect(cachingModuleExports.service).toBe(cachingModule.service)
    expect(cachingModuleExports.loaders).toEqual([])
    expect(cachingStaticResources.moduleService).toBe(CachingModuleService)
    expect(cachingStaticResources.models).toEqual([])
    expect(cachingStaticResources.services).toEqual([CachingProviderService])
    expect(cachingStaticResources.repositories).toEqual([])
    expect(cachingStaticResources.loaders).toEqual([
      loadHash,
      loadStaticProviders,
    ])
  })
})
