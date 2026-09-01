import type {
  QueryGraphFunction,
  RemoteQueryFunction,
} from "@medusajs/framework/types"
import { EventBusServiceMock } from "../__fixtures__"
import {
  createSqliteIndexServiceHarness,
  type SqliteIndexServiceHarness,
} from "../__fixtures__/sqlite-index-service"

type GraphCall = Parameters<QueryGraphFunction>[0]

const productId = "prod_1"
const productId2 = "prod_2"
const variantId = "var_1"
const variantId2 = "var_2"
const priceSetId = "price_set_1"
const priceId = "money_amount_1"
const linkId = "link_id_1"

describe("IndexModuleService event ingestion with SQLite provider", () => {
  let harness: SqliteIndexServiceHarness | undefined

  afterEach(() => {
    harness?.close()
  })

  it("creates index rows and link relations from real registered listeners", async () => {
    const { eventBus } = await createHarnessWithIndexedEntities()

    await eventBus.emit([
      {
        name: "product.created",
        data: { id: productId },
      },
      {
        name: "product.created",
        data: { id: productId2 },
      },
      {
        name: "variant.created",
        data: { id: variantId },
      },
      {
        name: "variant.created",
        data: { id: variantId2 },
      },
      {
        name: "pricing.price-set.created",
        data: { id: priceSetId },
      },
      {
        name: "price.created",
        data: { id: priceId },
      },
      {
        name: "LinkProductVariantPriceSet.attached",
        data: {
          id: linkId,
          variant_id: variantId,
          price_set_id: priceSetId,
        },
      },
    ])

    const indexRows = await harness.executor.execute(
      "SELECT id, name, data FROM index_data ORDER BY name, id"
    )
    const relationRows = await harness.executor.execute(
      "SELECT parent_name, parent_id, child_name, child_id FROM index_relation ORDER BY parent_id, child_id"
    )

    expect(
      indexRows.map((row) => ({
        id: row.id,
        name: row.name,
        data: parseJsonObject(row.data),
      }))
    ).toEqual([
      {
        id: linkId,
        name: "LinkProductVariantPriceSet",
        data: {
          id: linkId,
          price_set_id: priceSetId,
          variant_id: variantId,
        },
      },
      {
        id: priceId,
        name: "Price",
        data: { amount: 100, id: priceId },
      },
      {
        id: priceSetId,
        name: "PriceSet",
        data: { id: priceSetId },
      },
      {
        id: productId,
        name: "Product",
        data: { id: productId, title: "Test Product 1" },
      },
      {
        id: productId2,
        name: "Product",
        data: { id: productId2, title: "Test Product 2" },
      },
      {
        id: variantId,
        name: "ProductVariant",
        data: { id: variantId, product_id: productId, sku: "aaa test aaa" },
      },
      {
        id: variantId2,
        name: "ProductVariant",
        data: { id: variantId2, product_id: productId2, sku: "sku 123" },
      },
    ])

    expect(relationRows).toEqual([
      {
        parent_name: "LinkProductVariantPriceSet",
        parent_id: linkId,
        child_name: "PriceSet",
        child_id: priceSetId,
      },
      {
        parent_name: "PriceSet",
        parent_id: priceSetId,
        child_name: "Price",
        child_id: priceId,
      },
      {
        parent_name: "Product",
        parent_id: productId,
        child_name: "ProductVariant",
        child_id: variantId,
      },
      {
        parent_name: "Product",
        parent_id: productId2,
        child_name: "ProductVariant",
        child_id: variantId2,
      },
      {
        parent_name: "ProductVariant",
        parent_id: variantId,
        child_name: "LinkProductVariantPriceSet",
        child_id: linkId,
      },
    ])

    await expect(
      harness.service.query({
        fields: [
          "product.*",
          "product.variants.*",
          "product.variants.prices.*",
        ],
        pagination: {
          order: {
            product: {
              id: "ASC",
            },
          },
        },
      })
    ).resolves.toEqual({
      data: [
        {
          id: productId,
          title: "Test Product 1",
          variants: [
            {
              id: variantId,
              product_id: productId,
              sku: "aaa test aaa",
              prices: [
                {
                  amount: 100,
                  id: priceId,
                },
              ],
            },
          ],
        },
        {
          id: productId2,
          title: "Test Product 2",
          variants: [
            {
              id: variantId2,
              product_id: productId2,
              sku: "sku 123",
              prices: [],
            },
          ],
        },
      ],
      metadata: undefined,
    })
  })

  it("creates index rows and link relations from unordered registered listeners", async () => {
    const { eventBus } = await createHarnessWithIndexedEntities()

    await eventBus.emit([
      {
        name: "variant.created",
        data: { id: variantId },
      },
      {
        name: "product.created",
        data: { id: productId },
      },
      {
        name: "product.created",
        data: { id: productId2 },
      },
      {
        name: "variant.created",
        data: { id: variantId2 },
      },
      {
        name: "pricing.price-set.created",
        data: { id: priceSetId },
      },
      {
        name: "price.created",
        data: { id: priceId },
      },
      {
        name: "LinkProductVariantPriceSet.attached",
        data: {
          id: linkId,
          variant_id: variantId,
          price_set_id: priceSetId,
        },
      },
    ])

    const indexRows = await harness.executor.execute(
      "SELECT id, name FROM index_data ORDER BY name, id"
    )
    const relationRows = await harness.executor.execute(
      "SELECT parent_name, parent_id, child_name, child_id FROM index_relation ORDER BY parent_id, child_id"
    )

    expect(indexRows).toEqual([
      {
        id: linkId,
        name: "LinkProductVariantPriceSet",
      },
      {
        id: priceId,
        name: "Price",
      },
      {
        id: priceSetId,
        name: "PriceSet",
      },
      {
        id: productId,
        name: "Product",
      },
      {
        id: productId2,
        name: "Product",
      },
      {
        id: variantId,
        name: "ProductVariant",
      },
      {
        id: variantId2,
        name: "ProductVariant",
      },
    ])
    expect(relationRows).toEqual([
      {
        parent_name: "LinkProductVariantPriceSet",
        parent_id: linkId,
        child_name: "PriceSet",
        child_id: priceSetId,
      },
      {
        parent_name: "PriceSet",
        parent_id: priceSetId,
        child_name: "Price",
        child_id: priceId,
      },
      {
        parent_name: "Product",
        parent_id: productId,
        child_name: "ProductVariant",
        child_id: variantId,
      },
      {
        parent_name: "Product",
        parent_id: productId2,
        child_name: "ProductVariant",
        child_id: variantId2,
      },
      {
        parent_name: "ProductVariant",
        parent_id: variantId,
        child_name: "LinkProductVariantPriceSet",
        child_id: linkId,
      },
    ])
  })

  it("updates index rows from real registered listeners", async () => {
    const indexedEntities = createIndexedEntities()
    const { eventBus } = await createHarnessWithIndexedEntities(indexedEntities)

    await eventBus.emit([
      {
        name: "product.created",
        data: { id: productId },
      },
      {
        name: "variant.created",
        data: { id: variantId },
      },
    ])

    getIndexedEntity(indexedEntities, "product", productId).title =
      "updated Title"
    getIndexedEntity(indexedEntities, "product_variant", variantId).sku =
      "updated sku"

    await eventBus.emit([
      {
        name: "product.updated",
        data: { id: productId },
      },
      {
        name: "variant.updated",
        data: { id: variantId },
      },
    ])

    const indexRows = await getCurrentHarness().executor.execute(
      "SELECT id, name, data FROM index_data ORDER BY name, id"
    )

    expect(
      indexRows.map((row) => ({
        id: row.id,
        name: row.name,
        data: parseJsonObject(row.data),
      }))
    ).toEqual([
      {
        id: productId,
        name: "Product",
        data: { id: productId, title: "updated Title" },
      },
      {
        id: variantId,
        name: "ProductVariant",
        data: { id: variantId, product_id: productId, sku: "updated sku" },
      },
    ])
  })

  it("deletes index rows and relation edges from real registered listeners", async () => {
    const { eventBus } = await createHarnessWithIndexedEntities()

    await eventBus.emit([
      {
        name: "product.created",
        data: { id: productId },
      },
      {
        name: "variant.created",
        data: { id: variantId },
      },
      {
        name: "pricing.price-set.created",
        data: { id: priceSetId },
      },
      {
        name: "price.created",
        data: { id: priceId },
      },
      {
        name: "LinkProductVariantPriceSet.attached",
        data: {
          id: linkId,
          variant_id: variantId,
          price_set_id: priceSetId,
        },
      },
    ])

    await eventBus.emit([
      {
        name: "product.deleted",
        data: { id: productId },
      },
      {
        name: "variant.deleted",
        data: { id: variantId },
      },
    ])

    const indexRows = await getCurrentHarness().executor.execute(
      "SELECT id, name FROM index_data ORDER BY name, id"
    )
    const relationRows = await getCurrentHarness().executor.execute(
      "SELECT parent_name, parent_id, child_name, child_id FROM index_relation ORDER BY parent_id, child_id"
    )

    expect(indexRows).toEqual([
      {
        id: linkId,
        name: "LinkProductVariantPriceSet",
      },
      {
        id: priceId,
        name: "Price",
      },
      {
        id: priceSetId,
        name: "PriceSet",
      },
    ])

    expect(relationRows).toEqual([
      {
        parent_name: "LinkProductVariantPriceSet",
        parent_id: linkId,
        child_name: "PriceSet",
        child_id: priceSetId,
      },
      {
        parent_name: "PriceSet",
        parent_id: priceSetId,
        child_name: "Price",
        child_id: priceId,
      },
    ])
  })

  it("detaches link index rows and relation edges from real registered listeners", async () => {
    const { eventBus } = await createHarnessWithIndexedEntities()

    await eventBus.emit([
      {
        name: "product.created",
        data: { id: productId },
      },
      {
        name: "variant.created",
        data: { id: variantId },
      },
      {
        name: "pricing.price-set.created",
        data: { id: priceSetId },
      },
      {
        name: "price.created",
        data: { id: priceId },
      },
      {
        name: "LinkProductVariantPriceSet.attached",
        data: {
          id: linkId,
          variant_id: variantId,
          price_set_id: priceSetId,
        },
      },
    ])

    await eventBus.emit({
      name: "LinkProductVariantPriceSet.detached",
      data: {
        id: linkId,
        variant_id: variantId,
        price_set_id: priceSetId,
      },
    })

    const indexRows = await getCurrentHarness().executor.execute(
      "SELECT id, name FROM index_data ORDER BY name, id"
    )
    const relationRows = await getCurrentHarness().executor.execute(
      "SELECT parent_name, parent_id, child_name, child_id FROM index_relation ORDER BY parent_id, child_id"
    )

    expect(indexRows).toEqual([
      {
        id: priceId,
        name: "Price",
      },
      {
        id: priceSetId,
        name: "PriceSet",
      },
      {
        id: productId,
        name: "Product",
      },
      {
        id: variantId,
        name: "ProductVariant",
      },
    ])

    expect(relationRows).toEqual([
      {
        parent_name: "PriceSet",
        parent_id: priceSetId,
        child_name: "Price",
        child_id: priceId,
      },
      {
        parent_name: "Product",
        parent_id: productId,
        child_name: "ProductVariant",
        child_id: variantId,
      },
    ])
  })

  async function createHarnessWithIndexedEntities(
    indexedEntities: IndexedEntities = createIndexedEntities()
  ): Promise<{ eventBus: EventBusServiceMock }> {
    const eventBus = new EventBusServiceMock()

    harness = await createSqliteIndexServiceHarness({
      eventBus,
      query: createRemoteQuery(indexedEntities),
      workerMode: "worker",
    })

    return { eventBus }
  }

  function getCurrentHarness(): SqliteIndexServiceHarness {
    if (!harness) {
      throw new Error("Expected SQLite Index service harness to be initialized")
    }

    return harness
  }
})

type IndexedEntities = Record<string, Map<string, Record<string, unknown>>>

function createIndexedEntities(): IndexedEntities {
  return {
    product: new Map([
      [
        productId,
        {
          id: productId,
          title: "Test Product 1",
        },
      ],
      [
        productId2,
        {
          id: productId2,
          title: "Test Product 2",
        },
      ],
    ]),
    product_variant: new Map([
      [
        variantId,
        {
          id: variantId,
          product_id: productId,
          sku: "aaa test aaa",
          product: { id: productId },
        },
      ],
      [
        variantId2,
        {
          id: variantId2,
          product_id: productId2,
          sku: "sku 123",
          product: { id: productId2 },
        },
      ],
    ]),
    product_variant_price_set: new Map([
      [
        linkId,
        {
          id: linkId,
          variant_id: variantId,
          price_set_id: priceSetId,
        },
      ],
    ]),
    price_set: new Map([
      [
        priceSetId,
        {
          id: priceSetId,
        },
      ],
    ]),
    price: new Map([
      [
        priceId,
        {
          id: priceId,
          amount: 100,
          price_set: { id: priceSetId },
        },
      ],
    ]),
  }
}

function getIndexedEntity(
  indexedEntities: IndexedEntities,
  entity: string,
  id: string
): Record<string, unknown> {
  const row = indexedEntities[entity]?.get(id)

  if (!row) {
    throw new Error(`Expected indexed entity ${entity}.${id} to exist`)
  }

  return row
}

function createRemoteQuery(
  rowsByEntity: IndexedEntities
): RemoteQueryFunction {
  const remoteQuery = Object.assign(async () => [], {
    graph: async (config: GraphCall) => {
      const entityRows = rowsByEntity[config.entity]?.values() ?? []
      const requestedIds = getRequestedIds(config.filters)

      return {
        data: [...entityRows].filter((row) => {
          const id = row.id
          return typeof id === "string" && requestedIds.includes(id)
        }),
      }
    },
    index: async () => ({ data: [] }),
    gql: async () => ({ data: [] }),
  })

  // The production remote query type is an overloaded callable object. This
  // test double implements only the members used by the SQLite index provider.
  return remoteQuery as unknown as RemoteQueryFunction
}

function getRequestedIds(filters: GraphCall["filters"]): string[] {
  if (!isRecord(filters)) {
    return []
  }

  const idFilter = filters.id

  if (Array.isArray(idFilter)) {
    return idFilter.filter((id): id is string => typeof id === "string")
  }

  return typeof idFilter === "string" ? [idFilter] : []
}

function parseJsonObject(value: unknown): Record<string, unknown> {
  if (typeof value !== "string") {
    throw new Error("Expected index_data.data to be stored as a JSON string")
  }

  const parsed: unknown = JSON.parse(value)

  if (!isRecord(parsed)) {
    throw new Error("Expected index_data.data JSON to decode to an object")
  }

  return parsed
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value))
}
