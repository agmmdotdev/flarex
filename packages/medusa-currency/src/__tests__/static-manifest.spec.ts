import { describe, expect, it } from "vitest"
import currencyModule from "@medusajs/currency/index"
import { ModulesDefinition } from "@medusajs/modules-sdk"
import type { IModuleService } from "@medusajs/types"
import {
  currencyModuleDefinition,
  currencyModuleExports,
  currencyStaticResources,
} from "@medusajs/currency/static-manifest"
import { Currency } from "@medusajs/currency/models"

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
