import storeModule from "../index"
import { ModulesDefinition } from "@medusajs/modules-sdk"
import type { IModuleService } from "@medusajs/types"
import { Store, StoreCurrency, StoreLocale } from "../models"
import {
  storeModuleDefinition,
  storeModuleExports,
  storeStaticResources,
} from "../static-manifest"

describe("Store static manifest", () => {
  it("matches the normal Store module export and joiner config", () => {
    expect(storeModuleDefinition).toEqual(ModulesDefinition.store)
    expect(storeModuleExports.service).toBe(storeModule.service)
    expect(storeStaticResources.moduleService).toBe(storeModule.service)
    expect(storeStaticResources.models).toEqual([
      Store,
      StoreCurrency,
      StoreLocale,
    ])

    const nodeJoinerConfig = (
      storeModule.service.prototype as IModuleService
    ).__joinerConfig?.()
    const normalizeSchema = (schema?: string) =>
      schema?.replace(/\s+/g, " ").trim()

    expect({
      ...storeStaticResources.joinerConfig,
      schema: normalizeSchema(storeStaticResources.joinerConfig?.schema),
    }).toEqual({
      ...nodeJoinerConfig,
      schema: normalizeSchema(nodeJoinerConfig?.schema),
    })
  })
})
