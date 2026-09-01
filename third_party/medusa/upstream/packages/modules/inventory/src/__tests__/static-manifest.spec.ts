import inventoryModule from "../index"
import { ModulesDefinition } from "@medusajs/modules-sdk"
import type { IModuleService } from "@medusajs/types"
import { Modules } from "@medusajs/utils/modules-sdk/definition"
import { InventoryItem, InventoryLevel, ReservationItem } from "../models"
import {
  inventoryModuleDefinition,
  inventoryModuleExports,
  inventoryStaticResources,
} from "../static-manifest"

describe("Inventory static manifest", () => {
  it("matches the normal Inventory module export and joiner config", () => {
    expect(inventoryModuleDefinition).toEqual(
      ModulesDefinition[Modules.INVENTORY]
    )
    expect(inventoryModuleExports.service).toBe(inventoryModule.service)
    expect(inventoryStaticResources.moduleService).toBe(
      inventoryModule.service
    )
    expect(inventoryStaticResources.models).toEqual([
      InventoryItem,
      InventoryLevel,
      ReservationItem,
    ])

    const {
      schema: portableSchema,
      ...portableJoinerConfig
    } = inventoryStaticResources.joinerConfig!
    const { schema: nodeSchema, ...nodeJoinerConfig } = (
      inventoryModule.service.prototype as IModuleService
    ).__joinerConfig!()
    const normalizeSchema = (schema?: string) =>
      schema?.replace(/\s+/g, " ").trim()

    expect(portableJoinerConfig).toEqual(nodeJoinerConfig)
    expect(normalizeSchema(portableSchema)).toEqual(
      expect.stringContaining("type InventoryItem")
    )
    expect(normalizeSchema(portableSchema)).toEqual(
      expect.stringContaining("type InventoryLevel")
    )
    expect(normalizeSchema(portableSchema)).toEqual(
      expect.stringContaining("type ReservationItem")
    )
    expect(normalizeSchema(nodeSchema)).toEqual(
      expect.stringContaining("type InventoryItem")
    )
  })
})
