import fileModule from "../index"
import { ModulesDefinition } from "@medusajs/modules-sdk"
import { Modules } from "@medusajs/utils/modules-sdk/definition"
import { joinerConfig } from "../joiner-config"
import loadStaticProviders from "../loaders/static-providers"
import { FileModuleService, FileProviderService } from "../services"
import {
  fileModuleDefinition,
  fileModuleExports,
  fileStaticResources,
} from "../static-manifest"

describe("File static manifest", () => {
  it("matches the normal File module export and explicit static resources", () => {
    expect(fileModuleDefinition).toEqual(ModulesDefinition[Modules.FILE])
    expect(fileModuleExports.service).toBe(fileModule.service)
    expect(fileModuleExports.loaders).toEqual([])
    expect(fileStaticResources.moduleService).toBe(FileModuleService)
    expect(fileStaticResources.models).toEqual([])
    expect(fileStaticResources.services).toEqual([FileProviderService])
    expect(fileStaticResources.repositories).toEqual([])
    expect(fileStaticResources.loaders).toEqual([loadStaticProviders])
    expect(fileStaticResources.joinerConfig).toBe(joinerConfig)
    expect(fileStaticResources.joinerConfig?.linkableKeys?.file_id).toBe(
      "File"
    )
  })
})
