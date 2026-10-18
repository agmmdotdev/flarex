import type { ModuleJoinerConfig } from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils/portable"
import { composeLinkName } from "@medusajs/utils/link/compose-link-name"

export const LocationFulfillmentSet: ModuleJoinerConfig = {
  serviceName: composeLinkName(Modules.STOCK_LOCATION, "stock_location_id", Modules.FULFILLMENT, "fulfillment_set_id"),
  isLink: true,
  databaseConfig: {
    tableName: "location_fulfillment_set",
    idPrefix: "locfs",
  },
  alias: [
    {
      name: ["location_fulfillment_set", "location_fulfillment_sets"],
      entity: "LinkLocationFulfillmentSet",
    },
  ],
  primaryKeys: ["id", "stock_location_id", "fulfillment_set_id"],
  relationships: [
    {
      serviceName: Modules.STOCK_LOCATION,
      entity: "StockLocation",
      primaryKey: "id",
      foreignKey: "stock_location_id",
      alias: "location",
      args: {
        methodSuffix: "StockLocations",
      },
    },
    {
      serviceName: Modules.FULFILLMENT,
      entity: "FulfillmentSet",
      primaryKey: "id",
      foreignKey: "fulfillment_set_id",
      alias: "fulfillment_set",
      args: {
        methodSuffix: "FulfillmentSets",
      },
      deleteCascade: true,
      hasMany: true,
    },
  ],
  extends: [
    {
      serviceName: Modules.STOCK_LOCATION,
      relationship: {
        serviceName: composeLinkName(Modules.STOCK_LOCATION, "stock_location_id", Modules.FULFILLMENT, "fulfillment_set_id"),
        primaryKey: "stock_location_id",
        foreignKey: "id",
        alias: "fulfillment_set_link",
        isList: true,
      },
      fieldAlias: {
        fulfillment_sets: {
          path: "fulfillment_set_link.fulfillment_set",
          isList: true,
        },
      },
    },
    {
      serviceName: Modules.FULFILLMENT,
      entity: "FulfillmentSet",
      fieldAlias: {
        location: "locations_link.location",
      },
      relationship: {
        serviceName: composeLinkName(Modules.STOCK_LOCATION, "stock_location_id", Modules.FULFILLMENT, "fulfillment_set_id"),
        primaryKey: "fulfillment_set_id",
        foreignKey: "id",
        alias: "locations_link",
      },
    },
  ],
}
