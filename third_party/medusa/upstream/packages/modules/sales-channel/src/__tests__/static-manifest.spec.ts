import salesChannelModule from "../index"
import { ModulesDefinition } from "@medusajs/modules-sdk"
import type { IModuleService } from "@medusajs/types"
import { Modules } from "@medusajs/utils/modules-sdk/definition"
import { SalesChannel } from "../models"
import {
  salesChannelModuleDefinition,
  salesChannelModuleExports,
  salesChannelStaticResources,
} from "../static-manifest"
import { salesChannelIndexWorkerStaticManifest } from "../index-worker-static-manifest"

describe("sales channel static manifest", () => {
  it("matches the normal Sales Channel module export and joiner config", () => {
    expect(salesChannelModuleDefinition).toEqual(
      ModulesDefinition[Modules.SALES_CHANNEL]
    )
    expect(salesChannelModuleExports.service).toBe(
      salesChannelModule.service
    )
    expect(salesChannelStaticResources.moduleService).toBe(
      salesChannelModule.service
    )
    expect(salesChannelStaticResources.models).toEqual([SalesChannel])

    const {
      schema: portableSchema,
      ...portableJoinerConfig
    } = salesChannelStaticResources.joinerConfig!
    const { schema: nodeSchema, ...nodeJoinerConfig } = (
      salesChannelModule.service.prototype as IModuleService
    ).__joinerConfig!()
    const normalizeSchema = (schema?: string) =>
      schema?.replace(/\s+/g, " ").trim()

    expect(portableJoinerConfig).toEqual(nodeJoinerConfig)
    expect(normalizeSchema(portableSchema)).toEqual(
      expect.stringContaining("type SalesChannel")
    )
    expect(normalizeSchema(portableSchema)).toEqual(
      expect.stringContaining("metadata: JSON")
    )
    expect(normalizeSchema(nodeSchema)).toEqual(
      expect.stringContaining("type SalesChannel")
    )
  })

  it("covers SalesChannel defaults in the Index Worker manifest", () => {
    expect(salesChannelIndexWorkerStaticManifest.moduleDefinition).toEqual(
      ModulesDefinition[Modules.SALES_CHANNEL]
    )

    const salesChannelIndexEntity =
      salesChannelIndexWorkerStaticManifest.resources.indexEntities.find(
        (entity) => entity.entity === "SalesChannel"
      )

    expect(salesChannelIndexEntity?.fields).toEqual(
      expect.arrayContaining([
        "id",
        "name",
        "description",
        "is_disabled",
        "created_at",
        "updated_at",
        "deleted_at",
        "metadata",
      ])
    )
    expect(
      salesChannelIndexWorkerStaticManifest.resources.joinerConfig.schema
    ).toEqual(expect.stringContaining("type SalesChannel"))
  })
})
