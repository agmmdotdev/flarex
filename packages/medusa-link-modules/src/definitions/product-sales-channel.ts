import type { ModuleJoinerConfig } from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils/portable"
import { composeLinkName } from "@medusajs/utils/link/compose-link-name"

export const ProductSalesChannel: ModuleJoinerConfig = {
  serviceName: composeLinkName(Modules.PRODUCT, "product_id", Modules.SALES_CHANNEL, "sales_channel_id"),
  isLink: true,
  databaseConfig: {
    tableName: "product_sales_channel",
    idPrefix: "prodsc",
  },
  alias: [
    {
      name: ["product_sales_channel", "product_sales_channels"],
      entity: "LinkProductSalesChannel",
    },
  ],
  primaryKeys: ["id", "product_id", "sales_channel_id"],
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
      serviceName: Modules.SALES_CHANNEL,
      entity: "SalesChannel",
      primaryKey: "id",
      foreignKey: "sales_channel_id",
      alias: "sales_channel",
      args: {
        methodSuffix: "SalesChannels",
      },
      hasMany: true,
    },
  ],
  extends: [
    {
      serviceName: Modules.PRODUCT,
      entity: "Product",
      fieldAlias: {
        sales_channels: {
          path: "sales_channels_link.sales_channel",
          isList: true,
        },
      },
      relationship: {
        serviceName: composeLinkName(Modules.PRODUCT, "product_id", Modules.SALES_CHANNEL, "sales_channel_id"),
        primaryKey: "product_id",
        foreignKey: "id",
        alias: "sales_channels_link",
        isList: true,
      },
    },
    {
      serviceName: Modules.SALES_CHANNEL,
      entity: "SalesChannel",
      relationship: {
        serviceName: composeLinkName(Modules.PRODUCT, "product_id", Modules.SALES_CHANNEL, "sales_channel_id"),
        primaryKey: "sales_channel_id",
        foreignKey: "id",
        alias: "products_link",
        isList: true,
      },
    },
  ],
}
