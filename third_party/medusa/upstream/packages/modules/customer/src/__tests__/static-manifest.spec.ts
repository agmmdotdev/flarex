import customerModule from "../index"
import { ModulesDefinition } from "@medusajs/modules-sdk"
import type { IModuleService } from "@medusajs/types"
import { Modules } from "@medusajs/utils/modules-sdk/definition"
import {
  Customer,
  CustomerAddress,
  CustomerGroup,
  CustomerGroupCustomer,
} from "../models"
import {
  customerModuleDefinition,
  customerModuleExports,
  customerStaticResources,
} from "../static-manifest"

describe("Customer static manifest", () => {
  it("matches the normal Customer module export and joiner config", () => {
    expect(customerModuleDefinition).toEqual(
      ModulesDefinition[Modules.CUSTOMER]
    )
    expect(customerModuleExports.service).toBe(customerModule.service)
    expect(customerStaticResources.moduleService).toBe(customerModule.service)
    expect(customerStaticResources.models).toEqual([
      Customer,
      CustomerAddress,
      CustomerGroup,
      CustomerGroupCustomer,
    ])

    const {
      schema: portableSchema,
      ...portableJoinerConfig
    } = customerStaticResources.joinerConfig!
    const { schema: nodeSchema, ...nodeJoinerConfig } = (
      customerModule.service.prototype as IModuleService
    ).__joinerConfig!()
    const normalizeSchema = (schema?: string) =>
      schema?.replace(/\s+/g, " ").trim()

    expect(portableJoinerConfig).toEqual(nodeJoinerConfig)
    expect(normalizeSchema(portableSchema)).toEqual(
      expect.stringContaining("type Customer")
    )
    expect(normalizeSchema(portableSchema)).toEqual(
      expect.stringContaining("type CustomerGroup")
    )
    expect(normalizeSchema(nodeSchema)).toEqual(
      expect.stringContaining("type Customer")
    )
  })
})
