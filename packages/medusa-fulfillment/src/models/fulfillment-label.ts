import { model } from "@medusajs/framework/utils/portable"

import { Fulfillment } from "./fulfillment"

export const FulfillmentLabel = model.define("fulfillment_label", {
  id: model.id({ prefix: "fulla" }).primaryKey(),
  tracking_number: model.text(),
  tracking_url: model.text(),
  label_url: model.text(),
  fulfillment: model.belongsTo((): typeof Fulfillment => Fulfillment, {
    mappedBy: "labels",
  }),
})
