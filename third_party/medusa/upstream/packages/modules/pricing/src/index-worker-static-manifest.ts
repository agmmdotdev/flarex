import { ModulesDefinition } from "@medusajs/modules-sdk/definitions"
import { Modules } from "@medusajs/utils/modules-sdk/definition"
import { joinerConfig } from "./joiner-config"

export const pricingIndexWorkerStaticManifest = {
  moduleDefinition: ModulesDefinition[Modules.PRICING],
  resources: {
    indexEntities: [
      {
        entity: "Price",
        fields: [
          "id",
          "title",
          "amount",
          "currency_code",
          "min_quantity",
          "max_quantity",
          "price_set_id",
          "created_at",
          "updated_at",
          "deleted_at",
          "price_rules",
        ],
      },
      {
        entity: "PriceRule",
        fields: ["id", "attribute", "value", "price_id"],
      },
    ],
    joinerConfig,
  },
} as const
