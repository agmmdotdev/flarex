import { model, ShippingOptionPriceType } from "@medusajs/framework/utils/portable"

import { Fulfillment } from "./fulfillment"
import { FulfillmentProvider } from "./fulfillment-provider"
import { ServiceZone } from "./service-zone"
import { ShippingOptionRule } from "./shipping-option-rule"
import { ShippingOptionType } from "./shipping-option-type"
import { ShippingProfile } from "./shipping-profile"

export const ShippingOption = model
  .define("shipping_option", {
    id: model.id({ prefix: "so" }).primaryKey(),
    name: model.text().searchable().translatable(),
    price_type: model
      .enum(ShippingOptionPriceType)
      .default(ShippingOptionPriceType.FLAT),
    data: model.json().nullable(),
    metadata: model.json().nullable(),
    service_zone: model.belongsTo((): typeof ServiceZone => ServiceZone, {
      mappedBy: "shipping_options",
    }),
    shipping_profile: model
      .belongsTo((): typeof ShippingProfile => ShippingProfile, {
        mappedBy: "shipping_options",
      })
      .nullable(),
    provider: model.belongsTo((): typeof FulfillmentProvider => FulfillmentProvider).nullable(),
    type: model.belongsTo((): typeof ShippingOptionType => ShippingOptionType, {
      foreignKey: true,
      foreignKeyName: "shipping_option_type_id",
      mappedBy: "shipping_options",
    }),
    rules: model.hasMany((): typeof ShippingOptionRule => ShippingOptionRule, {
      mappedBy: "shipping_option",
    }),
    fulfillments: model.hasMany((): typeof Fulfillment => Fulfillment, {
      mappedBy: "shipping_option",
    }),
  })
  .cascades({
    delete: ["rules"],
  })
