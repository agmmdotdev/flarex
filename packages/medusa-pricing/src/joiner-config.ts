import { Modules } from "@medusajs/utils/modules-sdk/definition"
import { defineJoinerConfigFromModels } from "@medusajs/utils/modules-sdk/portable-joiner-config-builder"
import { Price, PriceList, PricePreference, PriceRule, PriceSet } from "./models"

export const joinerConfig = defineJoinerConfigFromModels(Modules.PRICING, {
  models: [PriceSet, PriceList, Price, PricePreference, PriceRule],
})
