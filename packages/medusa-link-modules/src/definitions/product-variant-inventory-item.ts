import { ModuleJoinerConfig } from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils/portable"
import { composeLinkName } from "@medusajs/utils/link/compose-link-name"

export const ProductVariantInventoryItem: ModuleJoinerConfig = {
  serviceName: composeLinkName(Modules.PRODUCT, "variant_id", Modules.INVENTORY, "inventory_item_id"),
  isLink: true,
  databaseConfig: {
    tableName: "product_variant_inventory_item",
    idPrefix: "pvitem",
    extraFields: {
      required_quantity: {
        type: "integer",
        defaultValue: "1",
      },
    },
  },
  alias: [
    {
      name: [
        "product_variant_inventory_item",
        "product_variant_inventory_items",
      ],
      entity: "LinkProductVariantInventoryItem",
    },
  ],
  primaryKeys: ["id", "variant_id", "inventory_item_id"],
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
      hasMany: true,
    },
    {
      serviceName: Modules.INVENTORY,
      entity: "InventoryItem",
      primaryKey: "id",
      foreignKey: "inventory_item_id",
      alias: "inventory",
      args: {
        methodSuffix: "InventoryItems",
      },
      hasMany: true,
    },
  ],
  extends: [
    {
      serviceName: Modules.PRODUCT,
      entity: "ProductVariant",
      fieldAlias: {
        inventory: "inventory_items.inventory",
      },
      relationship: {
        serviceName: composeLinkName(Modules.PRODUCT, "variant_id", Modules.INVENTORY, "inventory_item_id"),
        primaryKey: "variant_id",
        foreignKey: "id",
        alias: "inventory_items",
        isList: true,
      },
    },
    {
      serviceName: Modules.INVENTORY,
      entity: "InventoryItem",
      fieldAlias: {
        variants: {
          path: "variant_link.variant",
          isList: true,
        },
      },
      relationship: {
        serviceName: composeLinkName(Modules.PRODUCT, "variant_id", Modules.INVENTORY, "inventory_item_id"),
        primaryKey: "inventory_item_id",
        foreignKey: "id",
        alias: "variant_link",
        isList: true,
      },
    },
  ],
}
