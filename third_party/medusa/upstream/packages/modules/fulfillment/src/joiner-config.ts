import { defineJoinerConfig, Modules } from "@medusajs/framework/utils"
import {
  Fulfillment,
  FulfillmentAddress,
  FulfillmentItem,
  FulfillmentLabel,
  FulfillmentProvider,
  FulfillmentSet,
  GeoZone,
  ServiceZone,
  ShippingOption,
  ShippingOptionRule,
  ShippingOptionType,
  ShippingProfile,
} from "./models"
import { default as schema } from "./schema"

export const joinerConfig = defineJoinerConfig(Modules.FULFILLMENT, {
  schema,
  models: [
    FulfillmentAddress,
    Fulfillment,
    FulfillmentItem,
    FulfillmentLabel,
    FulfillmentProvider,
    FulfillmentSet,
    GeoZone,
    ServiceZone,
    ShippingOption,
    ShippingOptionRule,
    ShippingOptionType,
    ShippingProfile,
  ],
  linkableKeys: {
    fulfillment_id: Fulfillment.name,
    fulfillment_set_id: FulfillmentSet.name,
    shipping_option_id: ShippingOption.name,
    shipping_option_rule_id: ShippingOptionRule.name,
    fulfillment_provider_id: FulfillmentProvider.name,
  },
})
