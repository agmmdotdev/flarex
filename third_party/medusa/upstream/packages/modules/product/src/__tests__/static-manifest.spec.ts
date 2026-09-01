import productModule from "../index"
import { ModulesDefinition } from "@medusajs/modules-sdk"
import type { IModuleService } from "@medusajs/types"
import { Modules } from "@medusajs/utils/modules-sdk/definition"
import {
  Kind,
  parse,
  type DocumentNode,
  type ObjectTypeDefinitionNode,
} from "graphql"
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
} from "../models"
import {
  productModuleDefinition,
  productModuleExports,
  productStaticResources,
} from "../static-manifest"
import { productIndexWorkerStaticManifest } from "../index-worker-static-manifest"

describe("Product static manifest", () => {
  it("matches the normal Product module export and joiner config", () => {
    expect(productModuleDefinition).toEqual(ModulesDefinition[Modules.PRODUCT])
    expect(productModuleExports.service).toBe(productModule.service)
    expect(productStaticResources.moduleService).toBe(productModule.service)
    expect(productStaticResources.models).toEqual([
      Product,
      ProductVariant,
      ProductOption,
      ProductOptionValue,
      ProductType,
      ProductTag,
      ProductCollection,
      ProductCategory,
      ProductImage,
      ProductVariantProductImage,
    ])

    const {
      schema: portableSchema,
      ...portableJoinerConfig
    } = productStaticResources.joinerConfig!
    const { schema: nodeSchema, ...nodeJoinerConfig } = (
      productModule.service.prototype as IModuleService
    ).__joinerConfig!()
    const normalizeSchema = (schema?: string) =>
      schema?.replace(/\s+/g, " ").trim()

    expect(portableJoinerConfig).toEqual(nodeJoinerConfig)
    expect(normalizeSchema(portableSchema)).toEqual(
      expect.stringContaining("type Product")
    )
    expect(normalizeSchema(portableSchema)).toEqual(
      expect.stringContaining("type ProductVariant")
    )
    expect(normalizeSchema(nodeSchema)).toEqual(
      expect.stringContaining("type Product")
    )
  })

  it("keeps the Index Worker manifest aligned with the Product joiner schema", () => {
    expect(productIndexWorkerStaticManifest.moduleDefinition).toEqual(
      ModulesDefinition[Modules.PRODUCT]
    )

    const joinerSchema =
      productIndexWorkerStaticManifest.resources.joinerConfig.schema

    expect(joinerSchema).toBeDefined()
    if (!joinerSchema) {
      throw new Error("Product Index Worker manifest requires a joiner schema")
    }

    const schemaDocument = parse(joinerSchema)

    for (const indexEntity of productIndexWorkerStaticManifest.resources
      .indexEntities) {
      const entityType = findObjectType(schemaDocument, indexEntity.entity)

      expect(entityType).toBeDefined()
      if (!entityType) {
        throw new Error(
          `Product Index Worker entity ${indexEntity.entity} is missing from the Product joiner schema`
        )
      }

      const schemaFields = new Set(
        (entityType.fields ?? []).map((field) => field.name.value)
      )

      for (const field of indexEntity.fields) {
        if (
          isLinkExtendedIndexField({
            entity: indexEntity.entity,
            field,
          })
        ) {
          continue
        }

        expect(schemaFields.has(field)).toBe(true)
      }
    }

    const productVariantIndexEntity =
      productIndexWorkerStaticManifest.resources.indexEntities.find(
        (entity) => entity.entity === "ProductVariant"
      )
    const productIndexEntity =
      productIndexWorkerStaticManifest.resources.indexEntities.find(
        (entity) => entity.entity === "Product"
      )
    expect(productIndexEntity?.fields).toContain("sales_channels")
    expect(productVariantIndexEntity?.fields).toContain("prices")
  })

  it("covers Store/Admin product scalar and first-level relation defaults in the Index Worker manifest", () => {
    const productIndexEntity =
      productIndexWorkerStaticManifest.resources.indexEntities.find(
        (entity) => entity.entity === "Product"
      )
    const productVariantIndexEntity =
      productIndexWorkerStaticManifest.resources.indexEntities.find(
        (entity) => entity.entity === "ProductVariant"
      )
    const productCollectionIndexEntity =
      productIndexWorkerStaticManifest.resources.indexEntities.find(
        (entity) => entity.entity === "ProductCollection"
      )
    const productCategoryIndexEntity =
      productIndexWorkerStaticManifest.resources.indexEntities.find(
        (entity) => entity.entity === "ProductCategory"
      )
    const productTypeIndexEntity =
      productIndexWorkerStaticManifest.resources.indexEntities.find(
        (entity) => entity.entity === "ProductType"
      )
    const productOptionIndexEntity =
      productIndexWorkerStaticManifest.resources.indexEntities.find(
        (entity) => entity.entity === "ProductOption"
      )
    const productOptionValueIndexEntity =
      productIndexWorkerStaticManifest.resources.indexEntities.find(
        (entity) => entity.entity === "ProductOptionValue"
      )
    const productTagIndexEntity =
      productIndexWorkerStaticManifest.resources.indexEntities.find(
        (entity) => entity.entity === "ProductTag"
      )
    const productImageIndexEntity =
      productIndexWorkerStaticManifest.resources.indexEntities.find(
        (entity) => entity.entity === "ProductImage"
      )

    expect(productIndexEntity?.fields).toEqual(
      expect.arrayContaining([
        "id",
        "title",
        "subtitle",
        "description",
        "handle",
        "is_giftcard",
        "status",
        "thumbnail",
        "width",
        "weight",
        "length",
        "height",
        "origin_country",
        "hs_code",
        "mid_code",
        "material",
        "collection_id",
        "type_id",
        "discountable",
        "external_id",
        "created_at",
        "updated_at",
        "deleted_at",
        "metadata",
        "collection",
        "categories",
        "images",
        "options",
        "sales_channels",
        "tags",
        "type",
      ])
    )
    expect(productVariantIndexEntity?.fields).toEqual(
      expect.arrayContaining([
        "id",
        "title",
        "sku",
        "barcode",
        "ean",
        "upc",
        "allow_backorder",
        "manage_inventory",
        "requires_shipping",
        "hs_code",
        "origin_country",
        "mid_code",
        "material",
        "weight",
        "length",
        "height",
        "width",
        "thumbnail",
        "metadata",
        "product_id",
        "variant_rank",
        "created_at",
        "updated_at",
        "deleted_at",
        "images",
        "options",
      ])
    )
    expect(productCollectionIndexEntity?.fields).toEqual(
      expect.arrayContaining(["id", "title", "handle"])
    )
    expect(productCategoryIndexEntity?.fields).toEqual(
      expect.arrayContaining([
        "id",
        "name",
        "handle",
        "is_active",
        "is_internal",
      ])
    )
    expect(productTypeIndexEntity?.fields).toEqual(
      expect.arrayContaining(["id", "value"])
    )
    expect(productOptionIndexEntity?.fields).toEqual(
      expect.arrayContaining(["id", "title", "product_id", "values"])
    )
    expect(productOptionValueIndexEntity?.fields).toEqual(
      expect.arrayContaining(["id", "value", "option_id"])
    )
    expect(productTagIndexEntity?.fields).toEqual(
      expect.arrayContaining(["id", "value"])
    )
    expect(productImageIndexEntity?.fields).toEqual(
      expect.arrayContaining(["id", "url", "rank"])
    )
  })
})

function findObjectType(
  schemaDocument: DocumentNode,
  typeName: string
): ObjectTypeDefinitionNode | undefined {
  return schemaDocument.definitions.find(
    (definition): definition is ObjectTypeDefinitionNode =>
      definition.kind === Kind.OBJECT_TYPE_DEFINITION &&
      definition.name.value === typeName
  )
}

function isLinkExtendedIndexField({
  entity,
  field,
}: {
  entity: string
  field: string
}): boolean {
  return (
    (entity === "Product" && field === "sales_channels") ||
    (entity === "ProductVariant" && field === "prices")
  )
}
