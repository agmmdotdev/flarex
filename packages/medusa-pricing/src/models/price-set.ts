import { model } from "@medusajs/framework/utils/portable"
import Price from "./price"

const PriceSet = model
  .define("PriceSet", {
    id: model.id({ prefix: "pset" }).primaryKey(),
    prices: model.hasMany((): typeof Price => Price, {
      mappedBy: "price_set",
    }),
  })
  .cascades({
    delete: ["prices"],
  })

export default PriceSet
