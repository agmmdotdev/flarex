import pricingModule from "../index"
import { ModulesDefinition } from "@medusajs/modules-sdk"
import type { IModuleService } from "@medusajs/types"
import { Modules } from "@medusajs/utils/modules-sdk/definition"
import {
  Price,
  PriceList,
  PriceListRule,
  PricePreference,
  PriceRule,
  PriceSet,
} from "../models"
import {
  Kind,
  parse,
  type DocumentNode,
  type ObjectTypeDefinitionNode,
} from "graphql"
import { pricingIndexWorkerStaticManifest } from "../index-worker-static-manifest"
import {
  pricingModuleDefinition,
  pricingModuleExports,
  pricingStaticResources,
} from "../static-manifest"

describe("Pricing static manifest", () => {
  it("matches the normal Pricing module export and joiner config", () => {
    expect(pricingModuleDefinition).toEqual(ModulesDefinition[Modules.PRICING])
    expect(pricingModuleExports.service).toBe(pricingModule.service)
    expect(pricingStaticResources.moduleService).toBe(pricingModule.service)
    expect(pricingStaticResources.models).toEqual([
      PriceSet,
      PriceList,
      Price,
      PricePreference,
      PriceRule,
      PriceListRule,
    ])
    expect(pricingStaticResources.repositories).toHaveLength(1)
    expect(pricingStaticResources.repositories[0].name).toBe(
      "PricingRepository"
    )

    const {
      schema: portableSchema,
      ...portableJoinerConfig
    } = pricingStaticResources.joinerConfig!
    const { schema: nodeSchema, ...nodeJoinerConfig } = (
      pricingModule.service.prototype as IModuleService
    ).__joinerConfig!()
    const normalizeSchema = (schema?: string) =>
      schema?.replace(/\s+/g, " ").trim()

    expect(portableJoinerConfig).toEqual(nodeJoinerConfig)
    expect(normalizeSchema(portableSchema)).toEqual(
      expect.stringContaining("type PriceSet")
    )
    expect(normalizeSchema(portableSchema)).toEqual(
      expect.stringContaining("type PriceList")
    )
    expect(normalizeSchema(nodeSchema)).toEqual(
      expect.stringContaining("type PriceSet")
    )
  })

  it("keeps the Index Worker manifest aligned with the Pricing joiner schema", () => {
    expect(pricingIndexWorkerStaticManifest.moduleDefinition).toEqual(
      ModulesDefinition[Modules.PRICING]
    )

    const joinerSchema =
      pricingIndexWorkerStaticManifest.resources.joinerConfig.schema

    expect(joinerSchema).toBeDefined()
    if (!joinerSchema) {
      throw new Error("Pricing Index Worker manifest requires a joiner schema")
    }

    const schemaDocument = parse(joinerSchema)

    for (const indexEntity of pricingIndexWorkerStaticManifest.resources
      .indexEntities) {
      const entityType = findObjectType(schemaDocument, indexEntity.entity)

      expect(entityType).toBeDefined()
      if (!entityType) {
        throw new Error(
          `Pricing Index Worker entity ${indexEntity.entity} is missing from the Pricing joiner schema`
        )
      }

      const schemaFields = new Set(
        (entityType.fields ?? []).map((field) => field.name.value)
      )

      for (const field of indexEntity.fields) {
        expect(schemaFields.has(field)).toBe(true)
      }
    }
  })
})

function findObjectType(
  schemaDocument: DocumentNode,
  typeName: string
): ObjectTypeDefinitionNode | undefined {
  return schemaDocument.definitions.find(
    (definition): definition is ObjectTypeDefinitionNode =>
      definition.kind === Kind.OBJECT_TYPE_DEFINITION &&
      definition.name.value === typeName
  )
}
