import stockLocationModule from "../index"
import { ModulesDefinition } from "@medusajs/modules-sdk"
import type { IModuleService } from "@medusajs/types"
import { Modules } from "@medusajs/utils/modules-sdk/definition"
import { StockLocation, StockLocationAddress } from "../models"
import {
  stockLocationModuleDefinition,
  stockLocationModuleExports,
  stockLocationStaticResources,
} from "../static-manifest"

describe("Stock Location static manifest", () => {
  it("matches the normal Stock Location module export and joiner config", () => {
    expect(stockLocationModuleDefinition).toEqual(
      ModulesDefinition[Modules.STOCK_LOCATION]
    )
    expect(stockLocationModuleExports.service).toBe(
      stockLocationModule.service
    )
    expect(stockLocationStaticResources.moduleService).toBe(
      stockLocationModule.service
    )
    expect(stockLocationStaticResources.models).toEqual([
      StockLocationAddress,
      StockLocation,
    ])

    const {
      schema: portableSchema,
      ...portableJoinerConfig
    } = stockLocationStaticResources.joinerConfig!
    const { schema: nodeSchema, ...nodeJoinerConfig } = (
      stockLocationModule.service.prototype as IModuleService
    ).__joinerConfig!()
    const normalizeSchema = (schema?: string) =>
      schema?.replace(/\s+/g, " ").trim()

    expect(portableJoinerConfig).toEqual(nodeJoinerConfig)
    expect(normalizeSchema(portableSchema)).toEqual(
      expect.stringContaining("type StockLocation")
    )
    expect(normalizeSchema(portableSchema)).toEqual(
      expect.stringContaining("type StockLocationAddress")
    )
    expect(normalizeSchema(nodeSchema)).toEqual(
      expect.stringContaining("type StockLocation")
    )
  })
})
