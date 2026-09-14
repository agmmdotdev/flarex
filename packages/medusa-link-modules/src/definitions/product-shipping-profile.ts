import type { ModuleJoinerConfig } from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils/portable"
import { composeLinkName } from "@medusajs/utils/link/compose-link-name"

export const ProductShippingProfile: ModuleJoinerConfig = {
  serviceName: composeLinkName(Modules.PRODUCT, "product_id", Modules.FULFILLMENT, "shipping_profile_id"),
  isLink: true,
  databaseConfig: {
    tableName: "product_shipping_profile",
    idPrefix: "prodsp",
  },
  alias: [
    {
      name: "product_shipping_profile",
      entity: "LinkProductShippingProfile",
    },
    {
      name: "product_shipping_profiles",
      entity: "LinkProductShippingProfile",
    },
  ],
  primaryKeys: ["id", "product_id", "shipping_profile_id"],
  relationships: [
    {
      serviceName: Modules.PRODUCT,
      entity: "Product",
      primaryKey: "id",
      foreignKey: "product_id",
      alias: "product",
      args: {
        methodSuffix: "Products",
      },
      hasMany: true,
    },
    {
      serviceName: Modules.FULFILLMENT,
      entity: "ShippingProfile",
      primaryKey: "id",
      foreignKey: "shipping_profile_id",
      alias: "shipping_profile",
      args: {
        methodSuffix: "ShippingProfiles",
      },
    },
  ],
  extends: [
    {
      serviceName: Modules.PRODUCT,
      entity: "Product",
      fieldAlias: {
        shipping_profile: {
          path: "shipping_profiles_link.shipping_profile",
          isList: false,
        },
      },
      relationship: {
        serviceName: composeLinkName(Modules.PRODUCT, "product_id", Modules.FULFILLMENT, "shipping_profile_id"),
        primaryKey: "product_id",
        foreignKey: "id",
        alias: "shipping_profiles_link",
        isList: false,
      },
    },
    {
      serviceName: Modules.FULFILLMENT,
      entity: "ShippingProfile",
      relationship: {
        serviceName: composeLinkName(Modules.PRODUCT, "product_id", Modules.FULFILLMENT, "shipping_profile_id"),
        primaryKey: "shipping_profile_id",
        foreignKey: "id",
        alias: "products_link",
        isList: true,
      },
    },
  ],
}
