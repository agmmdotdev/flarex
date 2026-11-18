import type { ModuleJoinerConfig } from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils/portable"
import { composeLinkName } from "@medusajs/utils/link/compose-link-name"

export const SalesChannelLocation: ModuleJoinerConfig = {
  serviceName: composeLinkName(Modules.SALES_CHANNEL, "sales_channel_id", Modules.STOCK_LOCATION, "location_id"),
  isLink: true,
  databaseConfig: {
    tableName: "sales_channel_stock_location",
    idPrefix: "scloc",
  },
  alias: [
    {
      name: ["sales_channel_location", "sales_channel_locations"],
      entity: "LinkSalesChannelLocation",
    },
  ],
  primaryKeys: ["id", "sales_channel_id", "stock_location_id"],
  relationships: [
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
    {
      serviceName: Modules.STOCK_LOCATION,
      entity: "StockLocation",
      primaryKey: "id",
      foreignKey: "stock_location_id",
      alias: "location",
      args: {
        methodSuffix: "StockLocations",
      },
      hasMany: true,
    },
  ],
  extends: [
    {
      serviceName: Modules.SALES_CHANNEL,
      entity: "SalesChannel",
      fieldAlias: {
        stock_locations: {
          path: "locations_link.location",
          isList: true,
        },
      },
      relationship: {
        serviceName: composeLinkName(Modules.SALES_CHANNEL, "sales_channel_id", Modules.STOCK_LOCATION, "location_id"),
        primaryKey: "sales_channel_id",
        foreignKey: "id",
        alias: "locations_link",
        isList: true,
      },
    },
    {
      serviceName: Modules.STOCK_LOCATION,
      entity: "StockLocation",
      fieldAlias: {
        sales_channels: {
          path: "sales_channels_link.sales_channel",
          isList: true,
        },
      },
      relationship: {
        serviceName: composeLinkName(Modules.SALES_CHANNEL, "sales_channel_id", Modules.STOCK_LOCATION, "location_id"),
        primaryKey: "stock_location_id",
        foreignKey: "id",
        alias: "sales_channels_link",
        isList: true,
      },
    },
  ],
}
