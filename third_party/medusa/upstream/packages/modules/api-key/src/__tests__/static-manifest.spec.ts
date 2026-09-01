import apiKeyModule from "../index"
import { ModulesDefinition } from "@medusajs/modules-sdk"
import { Modules } from "@medusajs/utils/modules-sdk/definition"
import { ApiKey } from "../models"
import {
  apiKeyModuleDefinition,
  apiKeyModuleExports,
  apiKeyStaticResources,
} from "../static-manifest"

describe("API Key static manifest", () => {
  it("matches the normal API Key module export and joiner config", () => {
    expect(apiKeyModuleDefinition).toEqual(ModulesDefinition[Modules.API_KEY])
    expect(apiKeyModuleExports.service).toBe(apiKeyModule.service)
    expect(apiKeyStaticResources.moduleService).toBe(apiKeyModule.service)
    expect(apiKeyStaticResources.models).toEqual([ApiKey])

    const nodeJoinerConfig = apiKeyModule.service.prototype.__joinerConfig?.()
    const normalizeSchema = (schema?: string) =>
      schema?.replace(/\s+/g, " ").trim()

    expect({
      ...apiKeyStaticResources.joinerConfig,
      schema: normalizeSchema(apiKeyStaticResources.joinerConfig?.schema),
    }).toEqual({
      ...nodeJoinerConfig,
      schema: normalizeSchema(nodeJoinerConfig?.schema),
    })
  })
})
