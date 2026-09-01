import { ModulesDefinition } from "@medusajs/modules-sdk/definitions"
import { Modules } from "@medusajs/utils/modules-sdk/definition"
import { defineJoinerConfigFromModels } from "@medusajs/utils/modules-sdk/portable-joiner-config-builder"
import { SalesChannel } from "./models"

export const salesChannelIndexWorkerStaticManifest = {
  moduleDefinition: ModulesDefinition[Modules.SALES_CHANNEL],
  resources: {
    indexEntities: [
      {
        entity: "SalesChannel",
        fields: [
          "id",
          "name",
          "description",
          "is_disabled",
          "created_at",
          "updated_at",
          "deleted_at",
          "metadata",
        ],
      },
    ],
    joinerConfig: defineJoinerConfigFromModels(Modules.SALES_CHANNEL, {
      models: [SalesChannel],
    }),
  },
} as const
