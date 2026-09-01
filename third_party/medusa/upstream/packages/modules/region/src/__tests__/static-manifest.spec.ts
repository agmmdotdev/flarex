import regionModule from "../index"
import { ModulesDefinition } from "@medusajs/modules-sdk"
import type { IModuleService } from "@medusajs/types"
import { Modules } from "@medusajs/utils/modules-sdk/definition"
import loadDefaults from "../loaders/defaults"
import { Country, Region } from "../models"
import {
  regionModuleDefinition,
  regionModuleExports,
  regionStaticResources,
} from "../static-manifest"

describe("Region static manifest", () => {
  it("matches the normal Region module export and joiner config", () => {
    expect(regionModuleDefinition).toEqual(ModulesDefinition[Modules.REGION])
    expect(regionModuleExports.service).toBe(regionModule.service)
    expect(regionModuleExports.loaders).toEqual([loadDefaults])
    expect(regionStaticResources.moduleService).toBe(regionModule.service)
    expect(regionStaticResources.loaders).toEqual([loadDefaults])
    expect(regionStaticResources.models).toEqual([Region, Country])

    const {
      schema: portableSchema,
      ...portableJoinerConfig
    } = regionStaticResources.joinerConfig!
    const { schema: nodeSchema, ...nodeJoinerConfig } = (
      regionModule.service.prototype as IModuleService
    ).__joinerConfig!()
    const normalizeSchema = (schema?: string) =>
      schema?.replace(/\s+/g, " ").trim()

    expect(portableJoinerConfig).toEqual(nodeJoinerConfig)
    expect(normalizeSchema(portableSchema)).toEqual(
      expect.stringContaining("type Region")
    )
    expect(normalizeSchema(portableSchema)).toEqual(
      expect.stringContaining("type Country")
    )
    expect(normalizeSchema(nodeSchema)).toEqual(
      expect.stringContaining("type Region")
    )
  })
})
