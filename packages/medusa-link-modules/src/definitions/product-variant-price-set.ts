import { ModuleJoinerConfig } from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils/portable"
import { composeLinkName } from "@medusajs/utils/link/compose-link-name"

export const ProductVariantPriceSet: ModuleJoinerConfig = {
  serviceName: composeLinkName(Modules.PRODUCT, "variant_id", Modules.PRICING, "price_set_id"),
  isLink: true,
  databaseConfig: {
    tableName: "product_variant_price_set",
    idPrefix: "pvps",
  },
  alias: [
    {
      name: ["product_variant_price_set", "product_variant_price_sets"],
      entity: "LinkProductVariantPriceSet",
    },
  ],
  primaryKeys: ["id", "variant_id", "price_set_id"],
  relationships: [
    {
      serviceName: Modules.PRODUCT,
      entity: "ProductVariant",
      primaryKey: "id",
      foreignKey: "variant_id",
      alias: "variant",
      args: {
        methodSuffix: "ProductVariants",
      },
    },
    {
      serviceName: Modules.PRICING,
      entity: "PriceSet",
      primaryKey: "id",
      foreignKey: "price_set_id",
      alias: "price_set",
      args: {
        methodSuffix: "PriceSets",
      },
      deleteCascade: true,
    },
  ],
  extends: [
    {
      serviceName: Modules.PRODUCT,
      entity: "ProductVariant",
      fieldAlias: {
        price_set: "price_set_link.price_set",
        prices: {
          path: "price_set_link.price_set.prices",
          isList: true,
          forwardArgumentsOnPath: ["price_set_link.price_set"],
        },
        calculated_price: {
          path: "price_set_link.price_set.calculated_price",
          forwardArgumentsOnPath: ["price_set_link.price_set"],
        },
      },
      relationship: {
        serviceName: composeLinkName(Modules.PRODUCT, "variant_id", Modules.PRICING, "price_set_id"),
        primaryKey: "variant_id",
        foreignKey: "id",
        alias: "price_set_link",
      },
    },
    {
      serviceName: Modules.PRICING,
      entity: "PriceSet",
      relationship: {
        serviceName: composeLinkName(Modules.PRODUCT, "variant_id", Modules.PRICING, "price_set_id"),
        primaryKey: "price_set_id",
        foreignKey: "id",
        alias: "variant_link",
      },
      fieldAlias: {
        variant: "variant_link.variant",
      },
    },
  ],
}
