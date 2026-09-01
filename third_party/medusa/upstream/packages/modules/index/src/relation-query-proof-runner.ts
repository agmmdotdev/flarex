import {
  indexRelationQueryProofSchema,
  registerIndexRelationQueryProofJoinerConfigs,
  resetIndexTables,
  seedProductCategoryIndex,
  seedProductImageIndex,
  seedProductOptionValueIndex,
  seedProductRouteDirectFieldsIndex,
  seedProductSalesChannelIndex,
  seedProductStatusIndex,
  seedProductTagIndex,
  seedProductTypeCollectionIndex,
  seedProductVariantRouteFieldsIndex,
  seedProductVariantPriceIndex,
} from "./relation-query-proof-fixture"
import {
  createSqliteIndexService as createComposedSqliteIndexService,
} from "./worker-composition"
import type { SqliteIndexExecutor } from "./services/sqlite-index-storage-provider"

export {
  resetIndexTables,
  seedProductVariantPriceAttachSupportIndex,
} from "./relation-query-proof-fixture"

export type IndexRelationQueryProof = {
  matched: boolean
  categoryFilterMatched: boolean
  firstCategoryHandle: string | undefined
  firstCategoryName: string | undefined
  productSearchMatched: boolean
  unfilteredProductListMatched: boolean
  unfilteredProductCount: number | undefined
  productIdFilterMatched: boolean
  productStatusFilterMatched: boolean
  productDirectScalarFiltersMatched: boolean
  productTypeCollectionFilterMatched: boolean
  productRouteRelationFiltersMatched: boolean
  variantIdFilterMatched: boolean
  variantRouteFiltersMatched: boolean
  count: number | undefined
  collectionHandle: string | undefined
  collectionTitle: string | undefined
  firstImageRank: number | undefined
  firstImageUrl: string | undefined
  firstOptionTitle: string | undefined
  firstOptionValue: string | undefined
  firstSalesChannelName: string | undefined
  firstTagValue: string | undefined
  tagFilterMatched: boolean
  productId: string | undefined
  productTypeValue: string | undefined
  firstVariantImageUrl: string | undefined
  firstVariantOptionValue: string | undefined
  firstVariantSku: string | undefined
  firstPriceAmount: number | undefined
  firstPriceRuleAttribute: string | undefined
  firstPriceRuleValue: string | undefined
}

export async function runIndexRelationQueryProof(
  executor: SqliteIndexExecutor
): Promise<IndexRelationQueryProof> {
  const service = await createRelationQueryProofSqliteService(executor)

  await resetIndexTables(executor)
  await seedProductVariantPriceIndex(executor)
  await seedProductStatusIndex(executor)
  await seedProductTypeCollectionIndex(executor)
  await seedProductRouteDirectFieldsIndex(executor)
  await seedProductVariantRouteFieldsIndex(executor)
  await seedProductCategoryIndex(executor)
  await seedProductOptionValueIndex(executor)
  await seedProductTagIndex(executor)
  await seedProductImageIndex(executor)
  await seedProductSalesChannelIndex(executor)

  const { data, metadata } = await service.query({
    fields: [
      "product.*",
      "product.categories.*",
      "product.collection.*",
      "product.images.*",
      "product.options.*",
      "product.options.values.*",
      "product.sales_channels.*",
      "product.tags.*",
      "product.type.*",
      "product.variants.*",
      "product.variants.images.*",
      "product.variants.options.*",
      "product.variants.prices.*",
      "product.variants.prices.price_rules.*",
    ],
    filters: {
      product: {
        variants: {
          sku: { $ne: null },
        },
      },
    },
    pagination: {
      take: 1,
      order: {
        product: {
          variants: {
            prices: {
              amount: "DESC",
            },
          },
        },
      },
    },
  })

  const { data: categoryFilterData } = await service.query({
    fields: ["product.id", "product.categories.id"],
    filters: {
      product: {
        categories: {
          id: "pcat_1",
          is_active: true,
          is_internal: false,
        },
      },
    },
  })

  const { data: tagFilterData } = await service.query({
    fields: ["product.id", "product.tags.id"],
    filters: {
      product: {
        tags: {
          id: "ptag_1",
        },
      },
    },
  })

  const { data: productSearchData } = await service.query({
    fields: ["product.id", "product.title"],
    filters: {
      product: {
        q: "Product 1",
      },
    },
  })

  const { data: unfilteredProductListData, metadata: unfilteredMetadata } =
    await service.query({
      fields: ["product.id", "product.title"],
      pagination: {
        take: 10,
        order: {
          product: {
            id: "ASC",
          },
        },
      },
    })

  const { data: variantIdFilterData } = await service.query({
    fields: ["product.id", "product.variants.id"],
    filters: {
      product: {
        variants: {
          id: ["var_1"],
        },
      },
    },
  })

  const { data: variantRouteFilterData } = await service.query({
    fields: [
      "product.id",
      "product.variants.id",
      "product.variants.created_at",
      "product.variants.options.id",
    ],
    filters: {
      product: {
        variants: {
          created_at: {
            $gte: "2026-03-01T00:00:00.000Z",
            $lt: "2026-03-02T00:00:00.001Z",
          },
          options: {
            option_id: "opt_1",
            value: "Red",
          },
        },
      },
    },
  })

  const { data: productIdFilterData } = await service.query({
    fields: ["product.id", "product.title"],
    filters: {
      product: {
        id: ["prod_1"],
      },
    },
  })

  const { data: productStatusFilterData } = await service.query({
    fields: ["product.id", "product.status"],
    filters: {
      product: {
        status: ["published"],
      },
    },
  })

  const { data: productDirectScalarFilterData } = await service.query({
    fields: [
      "product.id",
      "product.created_at",
      "product.external_id",
      "product.handle",
      "product.is_giftcard",
    ],
    filters: {
      product: {
        created_at: {
          $gte: "2026-01-01T00:00:00.000Z",
          $lt: "2026-01-02T00:00:00.001Z",
        },
        external_id: ["external_prod_1"],
        handle: ["product-1"],
        is_giftcard: false,
      },
    },
  })

  const { data: productTypeCollectionFilterData } = await service.query({
    fields: ["product.id", "product.collection_id", "product.type_id"],
    filters: {
      product: {
        collection_id: ["pcol_1"],
        type_id: ["ptyp_1"],
      },
    },
  })

  const { data: productRouteRelationFilterData } = await service.query({
    fields: [
      "product.id",
      "product.categories.id",
      "product.sales_channels.id",
      "product.tags.id",
    ],
    filters: {
      product: {
        categories: {
          id: ["pcat_1"],
        },
        sales_channels: {
          id: ["sc_1"],
        },
        tags: {
          id: ["ptag_1"],
        },
      },
    },
  })

  const firstProduct = data[0]
  const categories = getArrayField(firstProduct, "categories")
  const firstCategory = categories[0]
  const collection = getRecordField(firstProduct, "collection")
  const productType = getRecordField(firstProduct, "type")
  const images = getArrayField(firstProduct, "images")
  const firstImage = images[0]
  const options = getArrayField(firstProduct, "options")
  const firstOption = options[0]
  const optionValues = getArrayField(firstOption, "values")
  const firstOptionValue = optionValues[0]
  const salesChannels = getArrayField(firstProduct, "sales_channels")
  const firstSalesChannel = salesChannels[0]
  const tags = getArrayField(firstProduct, "tags")
  const firstTag = tags[0]
  const variants = getArrayField(firstProduct, "variants")
  const firstVariant = variants[0]
  const variantImages = getArrayField(firstVariant, "images")
  const firstVariantImage = variantImages[0]
  const variantOptions = getArrayField(firstVariant, "options")
  const firstVariantOption = variantOptions[0]
  const prices = getArrayField(firstVariant, "prices")
  const firstPrice = prices[0]
  const priceRules = getArrayField(firstPrice, "price_rules")
  const firstPriceRule = priceRules[0]

  return {
    categoryFilterMatched:
      categoryFilterData.length === 1 &&
      getStringField(categoryFilterData[0], "id") === "prod_1",
    firstCategoryHandle: getStringField(firstCategory, "handle"),
    firstCategoryName: getStringField(firstCategory, "name"),
    productSearchMatched:
      productSearchData.length === 1 &&
      getStringField(productSearchData[0], "id") === "prod_1",
    unfilteredProductListMatched:
      unfilteredProductListData.length === 2 &&
      getStringField(unfilteredProductListData[0], "id") === "prod_1" &&
      getStringField(unfilteredProductListData[1], "id") === "prod_2",
    unfilteredProductCount: unfilteredMetadata?.estimate_count,
    productIdFilterMatched:
      productIdFilterData.length === 1 &&
      getStringField(productIdFilterData[0], "id") === "prod_1",
    productStatusFilterMatched:
      productStatusFilterData.length === 1 &&
      getStringField(productStatusFilterData[0], "id") === "prod_1" &&
      getStringField(productStatusFilterData[0], "status") === "published",
    productDirectScalarFiltersMatched:
      productDirectScalarFilterData.length === 1 &&
      getStringField(productDirectScalarFilterData[0], "id") === "prod_1" &&
      getStringField(productDirectScalarFilterData[0], "handle") ===
        "product-1" &&
      getStringField(productDirectScalarFilterData[0], "external_id") ===
        "external_prod_1" &&
      getBooleanField(productDirectScalarFilterData[0], "is_giftcard") ===
        false &&
      getStringField(productDirectScalarFilterData[0], "created_at") ===
        "2026-01-01T00:00:00.000Z",
    productTypeCollectionFilterMatched:
      productTypeCollectionFilterData.length === 1 &&
      getStringField(productTypeCollectionFilterData[0], "id") === "prod_1" &&
      getStringField(productTypeCollectionFilterData[0], "collection_id") ===
        "pcol_1" &&
      getStringField(productTypeCollectionFilterData[0], "type_id") ===
        "ptyp_1",
    productRouteRelationFiltersMatched:
      productRouteRelationFilterData.length === 1 &&
      getStringField(productRouteRelationFilterData[0], "id") === "prod_1" &&
      hasOnlyRelatedId(
        getArrayField(productRouteRelationFilterData[0], "categories"),
        "pcat_1"
      ) &&
      hasOnlyRelatedId(
        getArrayField(productRouteRelationFilterData[0], "sales_channels"),
        "sc_1"
      ) &&
      hasOnlyRelatedId(
        getArrayField(productRouteRelationFilterData[0], "tags"),
        "ptag_1"
      ),
    variantIdFilterMatched:
      variantIdFilterData.length === 1 &&
      getStringField(variantIdFilterData[0], "id") === "prod_1" &&
      getArrayField(variantIdFilterData[0], "variants").length === 1 &&
      getStringField(
        getArrayField(variantIdFilterData[0], "variants")[0],
        "id"
      ) === "var_1",
    variantRouteFiltersMatched:
      variantRouteFilterData.length === 1 &&
      getStringField(variantRouteFilterData[0], "id") === "prod_1" &&
      getArrayField(variantRouteFilterData[0], "variants").length === 1 &&
      getStringField(
        getArrayField(variantRouteFilterData[0], "variants")[0],
        "id"
      ) === "var_1" &&
      getStringField(
        getArrayField(variantRouteFilterData[0], "variants")[0],
        "created_at"
      ) === "2026-03-01T00:00:00.000Z" &&
      hasOnlyRelatedId(
        getArrayField(
          getArrayField(variantRouteFilterData[0], "variants")[0],
          "options"
        ),
        "optval_1"
      ),
    matched: data.length === 1,
    count: metadata?.estimate_count,
    collectionHandle: getStringField(collection, "handle"),
    collectionTitle: getStringField(collection, "title"),
    firstImageRank: getNumberField(firstImage, "rank"),
    firstImageUrl: getStringField(firstImage, "url"),
    firstOptionTitle: getStringField(firstOption, "title"),
    firstOptionValue: getStringField(firstOptionValue, "value"),
    firstSalesChannelName: getStringField(firstSalesChannel, "name"),
    firstTagValue: getStringField(firstTag, "value"),
    tagFilterMatched:
      tagFilterData.length === 1 &&
      getStringField(tagFilterData[0], "id") === "prod_1",
    productId: getStringField(firstProduct, "id"),
    productTypeValue: getStringField(productType, "value"),
    firstVariantImageUrl: getStringField(firstVariantImage, "url"),
    firstVariantOptionValue: getStringField(firstVariantOption, "value"),
    firstVariantSku: getStringField(firstVariant, "sku"),
    firstPriceAmount: getNumberField(firstPrice, "amount"),
    firstPriceRuleAttribute: getStringField(firstPriceRule, "attribute"),
    firstPriceRuleValue: getStringField(firstPriceRule, "value"),
  }
}

export async function createRelationQueryProofSqliteService(
  executor: SqliteIndexExecutor
): ReturnType<typeof createComposedSqliteIndexService> {
  return createComposedSqliteIndexService({
    executor,
    registerJoinerConfigs: registerIndexRelationQueryProofJoinerConfigs,
    schema: indexRelationQueryProofSchema,
    transactionErrorMessage:
      "Index relation query proof should not open transactions",
  })
}

function getRecordField(
  value: unknown,
  key: string
): Record<string, unknown> | undefined {
  if (!isRecord(value)) {
    return undefined
  }

  const field = value[key]
  return isRecord(field) ? field : undefined
}

function getArrayField(
  value: unknown,
  key: string
): readonly Record<string, unknown>[] {
  if (!isRecord(value)) {
    return []
  }

  const field = value[key]
  return Array.isArray(field) && field.every(isRecord) ? field : []
}

function getStringField(value: unknown, key: string): string | undefined {
  if (!isRecord(value)) {
    return undefined
  }

  const field = value[key]
  return typeof field === "string" ? field : undefined
}

function getNumberField(value: unknown, key: string): number | undefined {
  if (!isRecord(value)) {
    return undefined
  }

  const field = value[key]
  return typeof field === "number" ? field : undefined
}

function getBooleanField(value: unknown, key: string): boolean | undefined {
  if (!isRecord(value)) {
    return undefined
  }

  const field = value[key]
  return typeof field === "boolean" ? field : undefined
}

function hasOnlyRelatedId(
  values: readonly Record<string, unknown>[],
  id: string
): boolean {
  return values.length === 1 && getStringField(values[0], "id") === id
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value))
}
