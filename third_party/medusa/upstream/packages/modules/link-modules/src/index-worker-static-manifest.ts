import { LINKS } from "@medusajs/framework/utils/portable"
import { ProductSalesChannel } from "./definitions/product-sales-channel"
import { ProductVariantPriceSet } from "./definitions/product-variant-price-set"

export const productVariantPriceSetIndexWorkerStaticManifest = {
  moduleDefinition: {
    key: LINKS.ProductVariantPriceSet,
  },
  resources: {
    joinerConfig: ProductVariantPriceSet,
  },
} as const

export const productSalesChannelIndexWorkerStaticManifest = {
  moduleDefinition: {
    key: LINKS.ProductSalesChannel,
  },
  resources: {
    joinerConfig: ProductSalesChannel,
  },
} as const

export const linkModulesIndexWorkerStaticManifest =
  productVariantPriceSetIndexWorkerStaticManifest
