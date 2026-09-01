import userModule from "../index"
import { ModulesDefinition } from "@medusajs/modules-sdk"
import { Modules } from "@medusajs/utils/modules-sdk/definition"
import { Invite, User } from "../models"
import {
  userModuleDefinition,
  userModuleExports,
  userStaticResources,
} from "../static-manifest"

type JoinerConfigProvider = {
  __joinerConfig?: () => typeof userStaticResources.joinerConfig
}

describe("User static manifest", () => {
  it("matches the normal User module export and joiner config", () => {
    expect(userModuleDefinition).toEqual(ModulesDefinition[Modules.USER])
    expect(userModuleExports.service).toBe(userModule.service)
    expect(userStaticResources.moduleService).toBe(userModule.service)
    expect(userStaticResources.models).toEqual([User, Invite])

    const servicePrototype = userModule.service.prototype as JoinerConfigProvider
    const nodeJoinerConfig = servicePrototype.__joinerConfig?.()
    const normalizeSchema = (schema?: string) =>
      schema?.replace(/\s+/g, " ").trim()

    expect({
      ...userStaticResources.joinerConfig,
      schema: normalizeSchema(userStaticResources.joinerConfig?.schema),
    }).toEqual({
      ...nodeJoinerConfig,
      schema: normalizeSchema(nodeJoinerConfig?.schema),
    })
  })
})
