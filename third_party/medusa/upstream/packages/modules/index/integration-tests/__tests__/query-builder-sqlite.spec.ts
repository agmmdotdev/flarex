import type { IndexTypes } from "@medusajs/framework/types"
import {
  seedProductCategoryIndex,
  seedProductOptionValueIndex,
  seedProductRouteDirectFieldsIndex,
  seedProductSalesChannelIndex,
  seedProductStatusIndex,
  seedProductTagIndex,
  seedProductTypeCollectionIndex,
  seedProductVariantRouteFieldsIndex,
} from "../../src/relation-query-proof-fixture"
import {
  createSqliteIndexServiceHarness,
  type SqliteIndexServiceHarness,
} from "../__fixtures__/sqlite-index-service"
import { runIndexQueryBuilderSharedTests } from "./query-builder-shared"

describe("IndexModuleService query with SQLite provider", () => {
  let harness: SqliteIndexServiceHarness
  let module: IndexTypes.IIndexService

  beforeEach(async () => {
    harness = await createSqliteIndexServiceHarness()
    await harness.seedProductVariantPriceIndex()
    module = harness.service
  })

  afterEach(() => {
    harness.close()
  })

  runIndexQueryBuilderSharedTests(() => module)

  it("should query products filtering by admin product status", async () => {
    await seedProductStatusIndex(harness.executor)

    const { data } = await module.query({
      fields: ["product.id", "product.status"],
      filters: {
        product: {
          status: ["published"],
        },
      },
    })

    expect(data).toEqual([
      {
        id: "prod_1",
        status: "published",
      },
    ])
  })

  it("should query products filtering by direct route scalar fields", async () => {
    await seedProductRouteDirectFieldsIndex(harness.executor)

    const { data } = await module.query({
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

    expect(data).toEqual([
      {
        created_at: "2026-01-01T00:00:00.000Z",
        external_id: "external_prod_1",
        handle: "product-1",
        id: "prod_1",
        is_giftcard: false,
      },
    ])
  })

  it("should query products filtering by direct collection and type ids", async () => {
    await seedProductTypeCollectionIndex(harness.executor)

    const { data } = await module.query({
      fields: ["product.id", "product.collection_id", "product.type_id"],
      filters: {
        product: {
          collection_id: ["pcol_1"],
          type_id: ["ptyp_1"],
        },
      },
    })

    expect(data).toEqual([
      {
        collection_id: "pcol_1",
        id: "prod_1",
        type_id: "ptyp_1",
      },
    ])
  })

  it("should query products filtering by transformed relation ids", async () => {
    await seedProductCategoryIndex(harness.executor)
    await seedProductSalesChannelIndex(harness.executor)
    await seedProductTagIndex(harness.executor)

    const { data } = await module.query({
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

    expect(data).toEqual([
      {
        categories: [
          {
            handle: "category-1",
            id: "pcat_1",
            is_active: true,
            is_internal: false,
            name: "Category 1",
          },
        ],
        id: "prod_1",
        sales_channels: [
          {
            description: "Default sales channel",
            id: "sc_1",
            is_disabled: false,
            name: "Default Sales Channel",
          },
        ],
        tags: [
          {
            id: "ptag_1",
            value: "Featured",
          },
        ],
      },
    ])
  })

  it("should query products filtering by variant route fields", async () => {
    await seedProductOptionValueIndex(harness.executor)
    await seedProductVariantRouteFieldsIndex(harness.executor)

    const { data } = await module.query({
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

    expect(data).toEqual([
      {
        id: "prod_1",
        variants: [
          {
            created_at: "2026-03-01T00:00:00.000Z",
            deleted_at: null,
            id: "var_1",
            options: [
              {
                id: "optval_1",
                option_id: "opt_1",
                value: "Red",
              },
            ],
            product_id: "prod_1",
            sku: "aaa test aaa",
            updated_at: "2026-03-02T00:00:00.000Z",
          },
        ],
      },
    ])
  })
})
