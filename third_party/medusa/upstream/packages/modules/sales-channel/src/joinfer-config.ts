import { Modules } from "@medusajs/framework/utils/portable"
import { defineJoinerConfigFromModels } from "@medusajs/utils/modules-sdk/portable-joiner-config-builder"
import { SalesChannel } from "./models"

export const joinerConfig = defineJoinerConfigFromModels(Modules.SALES_CHANNEL, {
  models: [SalesChannel],
})
