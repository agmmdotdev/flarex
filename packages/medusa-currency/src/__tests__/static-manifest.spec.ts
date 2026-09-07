import currencyModule from "../index"
import { ModulesDefinition } from "@medusajs/modules-sdk"
import type { IModuleService } from "@medusajs/types"
import {
  currencyModuleDefinition,
  currencyModuleExports,
  currencyStaticResources,
} from "../static-manifest"
import { Currency } from "../models"

describe("Currency static manifest", () => {
  it("matches the normal Currency module export and joiner config", () => {
    expect(currencyModuleDefinition).toEqual(ModulesDefinition.currency)
    expect(currencyModuleExports.service).toBe(currencyModule.service)
    expect(currencyStaticResources.moduleService).toBe(currencyModule.service)
    expect(currencyStaticResources.models).toEqual([Currency])
    const nodeJoinerConfig = (
      currencyModule.service.prototype as IModuleService
    ).__joinerConfig?.()
    const normalizeSchema = (schema?: string) =>
      schema?.replace(/\s+/g, " ").trim()

    expect({
      ...currencyStaticResources.joinerConfig,
      schema: normalizeSchema(currencyStaticResources.joinerConfig?.schema),
    }).toEqual({
      ...nodeJoinerConfig,
      schema: normalizeSchema(nodeJoinerConfig?.schema),
    })
  })
})
