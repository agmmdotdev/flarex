import { model } from "@medusajs/framework/utils/portable"
import ProductVariant from "./product-variant"
import ProductImage from "./product-image"

/**
 * @since 2.11.2
 */
const ProductVariantProductImage = model.define("ProductVariantProductImage", {
  id: model.id({ prefix: "pvpi" }).primaryKey(),
  variant: model.belongsTo((): typeof ProductVariant => ProductVariant, {
    mappedBy: "images",
  }),
  image: model.belongsTo((): typeof ProductImage => ProductImage, {
    mappedBy: "variants",
  }),
})

export default ProductVariantProductImage
