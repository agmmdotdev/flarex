import { Modules } from "@medusajs/utils/modules-sdk/definition"
import { defineJoinerConfigFromModels } from "@medusajs/utils/modules-sdk/portable-joiner-config-builder"
import { StockLocation, StockLocationAddress } from "./models"
import { default as schema } from "./schema"

export const joinerConfig = defineJoinerConfigFromModels(
  Modules.STOCK_LOCATION,
  {
    schema,
    models: [StockLocationAddress, StockLocation],
    linkableKeys: {
      stock_location_id: StockLocation.name,
      location_id: StockLocation.name,
    },
  }
)
