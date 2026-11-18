import { model } from "@medusajs/framework/utils/portable"
import { Product } from "./index"
import ProductOptionValue from "./product-option-value"

const ProductOption = model
  .define("ProductOption", {
    id: model.id({ prefix: "opt" }).primaryKey(),
    title: model.text().searchable().translatable(),
    metadata: model.json().nullable(),
    product: model.belongsTo((): typeof Product => Product, {
      mappedBy: "options",
    }),
    values: model.hasMany((): typeof ProductOptionValue => ProductOptionValue, {
      mappedBy: "option",
    }),
  })
  .cascades({
    delete: ["values"],
  })
  .indexes([
    {
      name: "IDX_option_product_id_title_unique",
      on: ["product_id", "title"],
      unique: true,
      where: "deleted_at IS NULL",
    },
  ])

export default ProductOption
