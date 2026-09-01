import type { ModuleExports, StaticModuleResources } from "@medusajs/types"
import { ModulesDefinition } from "@medusajs/modules-sdk/definitions"
import { Modules } from "@medusajs/utils/modules-sdk/definition"
import { defineJoinerConfigFromModels } from "@medusajs/utils/modules-sdk/portable-joiner-config-builder"
import {
  Product,
  ProductCategory,
  ProductCollection,
  ProductImage,
  ProductOption,
  ProductOptionValue,
  ProductTag,
  ProductType,
  ProductVariant,
  ProductVariantProductImage,
} from "./models"
import schema from "./schema"
import ProductModuleService from "./services/product-module-service"

export const productModuleDefinition = ModulesDefinition[Modules.PRODUCT]

const productJoinerModels = [
  Product,
  ProductVariant,
  ProductOption,
  ProductOptionValue,
  ProductType,
  ProductTag,
  ProductCollection,
  ProductCategory,
  ProductImage,
]

export const productModuleModels = [
  ...productJoinerModels,
  ProductVariantProductImage,
]

export const productModuleExports: ModuleExports = {
  service: ProductModuleService,
  loaders: [],
}

export const productStaticResources: StaticModuleResources = {
  models: productModuleModels,
  services: [],
  repositories: [],
  loaders: [],
  moduleService: ProductModuleService,
  joinerConfig: defineJoinerConfigFromModels(Modules.PRODUCT, {
    schema,
    models: productJoinerModels,
    linkableKeys: {
      variant_id: "ProductVariant",
    },
    primaryKeys: ["id", "handle"],
    alias: [
      {
        name: ["product_variant", "product_variants", "variant", "variants"],
        entity: "ProductVariant",
        args: {
          methodSuffix: "ProductVariants",
        },
      },
    ],
  }),
}
