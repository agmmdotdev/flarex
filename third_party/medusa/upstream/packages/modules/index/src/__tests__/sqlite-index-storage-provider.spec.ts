import type {
  IndexTypes,
  QueryGraphFunction,
  RemoteQueryFunction,
} from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import {
  SqliteIndexStorageProvider,
  type SqliteIndexExecutor,
  type SqliteIndexValue,
} from "../services/sqlite-index-storage-provider"

type SqlCall = {
  sql: string
  params: readonly SqliteIndexValue[]
}

type NodeSqliteStatement = {
  all(...params: SqliteIndexValue[]): unknown[]
  run(...params: SqliteIndexValue[]): unknown
}

type NodeSqliteDatabase = {
  prepare(sql: string): NodeSqliteStatement
  close(): void
}

type NodeSqliteConstructor = new (path: string) => NodeSqliteDatabase

class RecordingExecutor implements SqliteIndexExecutor {
  readonly calls: SqlCall[] = []
  results: Record<string, SqliteIndexValue>[][] = []

  async execute(
    sql: string,
    params: readonly SqliteIndexValue[] = []
  ): Promise<readonly Record<string, SqliteIndexValue>[]> {
    this.calls.push({ sql: sql.replace(/\s+/g, " ").trim(), params })
    return this.results.shift() ?? []
  }
}

class NodeSqliteExecutor implements SqliteIndexExecutor {
  constructor(private readonly sqlite: NodeSqliteDatabase) {}

  async execute(
    sql: string,
    params: readonly SqliteIndexValue[] = []
  ): Promise<readonly Record<string, SqliteIndexValue>[]> {
    const statement = this.sqlite.prepare(sql)
    const mutableParams = [...params]

    if (sql.trim().toUpperCase().startsWith("SELECT")) {
      return statement.all(...mutableParams).map(normalizeSqliteRow)
    }

    statement.run(...mutableParams)
    return []
  }
}

function createNodeSqliteExecutor(): {
  executor: NodeSqliteExecutor
  close(): void
} {
  const { DatabaseSync } = require("node:sqlite") as {
    DatabaseSync: NodeSqliteConstructor
  }
  const sqlite = new DatabaseSync(":memory:")

  return {
    executor: new NodeSqliteExecutor(sqlite),
    close() {
      sqlite.close()
    },
  }
}

function normalizeSqliteRow(
  value: unknown
): Record<string, SqliteIndexValue> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Expected node:sqlite to return row objects")
  }

  const row: Record<string, SqliteIndexValue> = {}

  for (const [key, entry] of Object.entries(value)) {
    if (
      typeof entry === "string" ||
      typeof entry === "number" ||
      entry === null
    ) {
      row[key] = entry
      continue
    }

    throw new Error(`Unexpected SQLite value for column ${key}`)
  }

  return row
}

type GraphCall = Parameters<QueryGraphFunction>[0]

function createRemoteQuery(
  data: unknown,
  graphCalls: GraphCall[] = []
): RemoteQueryFunction {
  const rows = Array.isArray(data) ? data : [data]
  const remoteQuery = Object.assign(async () => [], {
    graph: async (config: GraphCall) => {
      graphCalls.push(config)
      return { data: rows }
    },
    index: async () => ({ data: [] }),
    gql: async () => ({ data: [] }),
  })

  // The production remote query type is an overloaded callable object. This
  // test double implements only the members used by the SQLite index provider.
  return remoteQuery as unknown as RemoteQueryFunction
}

function moduleConfig(
  serviceName: string,
  linkableKeys: Record<string, string> = {}
): IndexTypes.SchemaObjectEntityRepresentation["moduleConfig"] {
  return {
    serviceName,
    linkableKeys,
  }
}

const productSchema = {
  entity: "Product",
  fields: ["title"],
  listeners: ["product.created"],
  alias: "product",
  parents: [],
  moduleConfig: moduleConfig("product", { product_id: "Product" }),
} satisfies IndexTypes.SchemaObjectEntityRepresentation

const variantSchema = {
  entity: "ProductVariant",
  fields: ["sku", "product.id"],
  listeners: ["product_variant.created"],
  alias: "product_variant",
  parents: [
    {
      ref: productSchema,
      targetProp: "variants",
      inverseSideProp: "product",
    },
  ],
  moduleConfig: moduleConfig("product", { variant_id: "ProductVariant" }),
} satisfies IndexTypes.SchemaObjectEntityRepresentation

const priceSchema = {
  entity: "Price",
  fields: ["amount"],
  listeners: ["price.created"],
  alias: "price",
  parents: [],
  moduleConfig: moduleConfig("pricing", { price_id: "Price" }),
} satisfies IndexTypes.SchemaObjectEntityRepresentation

const collectionSchema = {
  entity: "ProductCollection",
  fields: ["title", "handle"],
  listeners: ["product_collection.created"],
  alias: "product_collection",
  parents: [
    {
      ref: productSchema,
      targetProp: "collection",
      inverseSideProp: "products",
      isList: false,
    },
  ],
  moduleConfig: moduleConfig("product", {
    collection_id: "ProductCollection",
  }),
} satisfies IndexTypes.SchemaObjectEntityRepresentation

const linkSchema = {
  entity: "ProductVariantPriceSet",
  fields: ["variant_id", "price_set_id"],
  listeners: ["product_variant_price_set.attached"],
  alias: "product_variant_price_set",
  parents: [],
  moduleConfig: {
    serviceName: "product-pricing-link",
    relationships: [
      {
        serviceName: "product",
        alias: "ProductVariant",
        primaryKey: "id",
        foreignKey: "variant_id",
      },
      {
        serviceName: "pricing",
        alias: "PriceSet",
        primaryKey: "id",
        foreignKey: "price_set_id",
      },
    ],
  },
} satisfies IndexTypes.SchemaObjectEntityRepresentation

const schemaObjectRepresentation = {
  _schemaPropertiesMap: {
    product: {
      ref: productSchema,
    },
    "product.variants": {
      ref: variantSchema,
      isList: true,
    },
    "product.variants.prices": {
      ref: priceSchema,
      isList: true,
    },
    "product.collection": {
      ref: collectionSchema,
      isList: false,
    },
  },
  _serviceNameModuleConfigMap: {
    product: moduleConfig("product", {
      product_id: "Product",
      variant_id: "ProductVariant",
    }),
    pricing: moduleConfig("pricing", {
      price_set_id: "PriceSet",
    }),
  },
} satisfies IndexTypes.SchemaObjectRepresentation

function createProvider({
  executor = new RecordingExecutor(),
  query = createRemoteQuery([]),
}: {
  executor?: RecordingExecutor
  query?: RemoteQueryFunction
} = {}): {
  provider: SqliteIndexStorageProvider
  executor: RecordingExecutor
} {
  return {
    provider: new SqliteIndexStorageProvider(
      {
        [ContainerRegistrationKeys.QUERY]: query,
      },
      {
        schemaObjectRepresentation,
        entityMap: {},
        executor,
      }
    ),
    executor,
  }
}

async function insertIndexData(
  executor: SqliteIndexExecutor,
  entity: string,
  id: string,
  data: Record<string, unknown>
): Promise<void> {
  await executor.execute(
    `
      INSERT INTO index_data (id, name, data, staled_at)
      VALUES (?, ?, ?, ?)
    `,
    [id, entity, JSON.stringify(data), null]
  )
}

async function insertIndexRelation(
  executor: SqliteIndexExecutor,
  parentName: string,
  parentId: string,
  childName: string,
  childId: string
): Promise<void> {
  await executor.execute(
    `
      INSERT INTO index_relation (
        pivot,
        parent_name,
        parent_id,
        child_name,
        child_id,
        staled_at
      )
      VALUES (?, ?, ?, ?, ?, ?)
    `,
    [`${parentName}-${childName}`, parentName, parentId, childName, childId, null]
  )
}

async function seedProductVariantPriceIndex(
  executor: SqliteIndexExecutor
): Promise<void> {
  await insertIndexData(executor, "Product", "prod_1", {
    id: "prod_1",
    title: "Product 1",
  })
  await insertIndexData(executor, "Product", "prod_2", {
    id: "prod_2",
    title: "Product 2 title",
    deep: {
      a: 1,
      obj: {
        b: 15,
      },
    },
  })
  await insertIndexData(executor, "ProductVariant", "var_1", {
    id: "var_1",
    sku: "aaa test aaa",
  })
  await insertIndexData(executor, "ProductVariant", "var_2", {
    id: "var_2",
    sku: "sku 123",
  })
  await insertIndexData(
    executor,
    "ProductVariantPriceSet",
    "link_id_1",
    {
      id: "link_id_1",
      variant_id: "var_1",
      price_set_id: "price_set_1",
    }
  )
  await insertIndexData(
    executor,
    "ProductVariantPriceSet",
    "link_id_2",
    {
      id: "link_id_2",
      variant_id: "var_2",
      price_set_id: "price_set_2",
    }
  )
  await insertIndexData(executor, "PriceSet", "price_set_1", {
    id: "price_set_1",
  })
  await insertIndexData(executor, "PriceSet", "price_set_2", {
    id: "price_set_2",
  })
  await insertIndexData(executor, "Price", "money_amount_1", {
    id: "money_amount_1",
    amount: 100,
  })
  await insertIndexData(executor, "Price", "money_amount_2", {
    id: "money_amount_2",
    amount: 10,
  })

  await insertIndexRelation(
    executor,
    "Product",
    "prod_1",
    "ProductVariant",
    "var_1"
  )
  await insertIndexRelation(
    executor,
    "Product",
    "prod_1",
    "ProductVariant",
    "var_2"
  )
  await insertIndexRelation(
    executor,
    "ProductVariant",
    "var_1",
    "ProductVariantPriceSet",
    "link_id_1"
  )
  await insertIndexRelation(
    executor,
    "ProductVariant",
    "var_2",
    "ProductVariantPriceSet",
    "link_id_2"
  )
  await insertIndexRelation(
    executor,
    "ProductVariantPriceSet",
    "link_id_1",
    "PriceSet",
    "price_set_1"
  )
  await insertIndexRelation(
    executor,
    "ProductVariantPriceSet",
    "link_id_2",
    "PriceSet",
    "price_set_2"
  )
  await insertIndexRelation(
    executor,
    "PriceSet",
    "price_set_1",
    "Price",
    "money_amount_1"
  )
  await insertIndexRelation(
    executor,
    "PriceSet",
    "price_set_2",
    "Price",
    "money_amount_2"
  )
}

describe("SqliteIndexStorageProvider", () => {
  it("creates SQLite index tables", async () => {
    const { provider, executor } = createProvider()

    await provider.onApplicationStart()

    expect(executor.calls.map((call) => call.sql)).toEqual([
      expect.stringContaining("CREATE TABLE IF NOT EXISTS index_data"),
      expect.stringContaining("CREATE TABLE IF NOT EXISTS index_relation"),
    ])
  })

  it("upserts entity rows and parent relations on create", async () => {
    const { provider, executor } = createProvider()

    await provider.onCreate({
      entity: variantSchema.entity,
      schemaEntityObjectRepresentation: variantSchema,
      data: {
        id: "variant_1",
        sku: "sku_1",
        product: { id: "product_1", title: "Product 1" },
        ignored: "not indexed",
      },
    })

    expect(executor.calls).toHaveLength(2)
    expect(executor.calls[0]?.sql).toContain("INSERT INTO index_data")
    expect(executor.calls[0]?.params).toEqual([
      "variant_1",
      "ProductVariant",
      JSON.stringify({ id: "variant_1", sku: "sku_1" }),
      null,
    ])
    expect(executor.calls[1]?.sql).toContain("INSERT INTO index_relation")
    expect(executor.calls[1]?.params).toEqual([
      "Product-ProductVariant",
      "Product",
      "product_1",
      "ProductVariant",
      "variant_1",
      null,
    ])
  })

  it("updates entity rows without rewriting relations", async () => {
    const { provider, executor } = createProvider()

    await provider.onUpdate({
      entity: productSchema.entity,
      schemaEntityObjectRepresentation: productSchema,
      data: {
        id: "product_1",
        title: "Updated Product",
        ignored: "not indexed",
      },
    })

    expect(executor.calls).toHaveLength(1)
    expect(executor.calls[0]?.params).toEqual([
      "product_1",
      "Product",
      JSON.stringify({ id: "product_1", title: "Updated Product" }),
      null,
    ])
  })

  it("deletes entity rows and relation rows", async () => {
    const { provider, executor } = createProvider()

    await provider.onDelete({
      entity: productSchema.entity,
      schemaEntityObjectRepresentation: productSchema,
      data: [{ id: "product_1" }, { id: "product_2" }],
    })

    expect(executor.calls).toHaveLength(2)
    expect(executor.calls[0]?.sql).toBe(
      "DELETE FROM index_data WHERE name = ? AND id IN (?, ?)"
    )
    expect(executor.calls[0]?.params).toEqual([
      "Product",
      "product_1",
      "product_2",
    ])
    expect(executor.calls[1]?.sql).toContain("DELETE FROM index_relation")
    expect(executor.calls[1]?.params).toEqual([
      "Product",
      "product_1",
      "product_2",
      "Product",
      "product_1",
      "product_2",
    ])
  })

  it("creates link entity relations on attach", async () => {
    const { provider, executor } = createProvider()

    await provider.onAttach({
      entity: linkSchema.entity,
      schemaEntityObjectRepresentation: linkSchema,
      data: {
        id: "link_1",
        variant_id: "variant_1",
        price_set_id: "price_set_1",
      },
    })

    expect(executor.calls).toHaveLength(3)
    expect(executor.calls[1]?.params).toEqual([
      "ProductVariant-ProductVariantPriceSet",
      "ProductVariant",
      "variant_1",
      "ProductVariantPriceSet",
      "link_1",
      null,
    ])
    expect(executor.calls[2]?.params).toEqual([
      "ProductVariantPriceSet-PriceSet",
      "ProductVariantPriceSet",
      "link_1",
      "PriceSet",
      "price_set_1",
      null,
    ])
  })

  it("rehydrates events through remote query before writing rows", async () => {
    const graphCalls: GraphCall[] = []
    const query = createRemoteQuery(
      {
        id: "variant_1",
        sku: "sku_1",
        product: { id: "product_1" },
      },
      graphCalls
    )
    const { provider, executor } = createProvider({ query })

    await provider.consumeEvent(variantSchema)({
      name: "product_variant.created",
      data: { id: "variant_1" },
    })

    expect(graphCalls).toEqual([
      {
        entity: "product_variant",
        filters: { id: ["variant_1"] },
        fields: ["id", "sku", "product.id"],
        withDeleted: undefined,
      },
    ])
    expect(executor.calls).toHaveLength(2)
    expect(executor.calls[0]?.params).toContain("variant_1")
  })

  it("queries root entity rows with direct filters, ordering, and pagination", async () => {
    const executor = new RecordingExecutor()
    executor.results = [
      [
        {
          id: "product_2",
          data: JSON.stringify({ id: "product_2", title: "Beta" }),
        },
      ],
      [{ estimate_count: 1 }],
    ]
    const { provider } = createProvider({ executor })

    const result = await provider.query({
      fields: ["product.*"],
      filters: {
        product: {
          title: { $like: "B%" },
        },
      },
      pagination: {
        order: {
          product: {
            title: "DESC",
          },
        },
        take: 10,
        skip: 0,
      },
    })

    expect(result).toEqual({
      data: [{ id: "product_2", title: "Beta" }],
      metadata: {
        estimate_count: 1,
        skip: 0,
        take: 10,
      },
    })
    expect(executor.calls[0]).toEqual({
      sql: "SELECT id, data FROM index_data WHERE name = ? AND json_extract(data, '$.title') LIKE ? ORDER BY json_extract(data, '$.title') DESC LIMIT ? OFFSET ?",
      params: ["Product", "B%", 10, 0],
    })
    expect(executor.calls[1]).toEqual({
      sql: "SELECT COUNT(*) AS estimate_count FROM index_data WHERE name = ? AND json_extract(data, '$.title') LIKE ?",
      params: ["Product", "B%"],
    })
  })

  it("supports root idsOnly queries and null filters", async () => {
    const executor = new RecordingExecutor()
    executor.results = [
      [
        {
          id: "product_1",
          data: JSON.stringify({ id: "product_1", title: null }),
        },
      ],
    ]
    const { provider } = createProvider({ executor })

    const result = await provider.query({
      fields: ["product.*"],
      idsOnly: true,
      filters: {
        product: {
          title: { $eq: null },
        },
      },
    })

    expect(result.data).toEqual([{ id: "product_1" }])
    expect(executor.calls[0]).toEqual({
      sql: "SELECT id, data FROM index_data WHERE name = ? AND json_extract(data, '$.title') IS NULL ORDER BY id ASC",
      params: ["Product"],
    })
  })

  it("hydrates requested relations through index_relation", async () => {
    const executor = new RecordingExecutor()
    executor.results = [
      [
        {
          id: "product_1",
          data: JSON.stringify({ id: "product_1", title: "Product 1" }),
        },
      ],
      [
        {
          parent_id: "product_1",
          child_id: "variant_1",
          child_name: "ProductVariant",
        },
      ],
      [
        {
          id: "variant_1",
          data: JSON.stringify({ id: "variant_1", sku: "sku_1" }),
        },
      ],
      [
        {
          parent_id: "variant_1",
          child_id: "link_1",
          child_name: "ProductVariantPriceSet",
        },
      ],
      [
        {
          parent_id: "link_1",
          child_id: "price_set_1",
          child_name: "PriceSet",
        },
      ],
      [
        {
          parent_id: "price_set_1",
          child_id: "money_amount_1",
          child_name: "Price",
        },
      ],
      [
        {
          id: "money_amount_1",
          data: JSON.stringify({ id: "money_amount_1", amount: 100 }),
        },
      ],
    ]
    const { provider } = createProvider({ executor })

    const result = await provider.query({
      fields: ["product.*", "product.variants.*", "product.variants.prices.*"],
    })

    expect(result.data).toEqual([
      {
        id: "product_1",
        title: "Product 1",
        variants: [
          {
            id: "variant_1",
            sku: "sku_1",
            prices: [
              {
                id: "money_amount_1",
                amount: 100,
              },
            ],
          },
        ],
      },
    ])
    expect(executor.calls.map((call) => call.sql)).toEqual([
      "SELECT id, data FROM index_data WHERE name = ? ORDER BY id ASC",
      "SELECT parent_id, child_id, child_name FROM index_relation WHERE parent_name = ? AND parent_id IN (?)",
      "SELECT id, data FROM index_data WHERE name = ? AND id IN (?)",
      "SELECT parent_id, child_id, child_name FROM index_relation WHERE parent_name = ? AND parent_id IN (?)",
      "SELECT parent_id, child_id, child_name FROM index_relation WHERE parent_name = ? AND parent_id IN (?)",
      "SELECT parent_id, child_id, child_name FROM index_relation WHERE parent_name = ? AND parent_id IN (?)",
      "SELECT id, data FROM index_data WHERE name = ? AND id IN (?)",
    ])
    expect(executor.calls[1]?.params).toEqual(["Product", "product_1"])
    expect(executor.calls[2]?.params).toEqual(["ProductVariant", "variant_1"])
    expect(executor.calls[6]?.params).toEqual(["Price", "money_amount_1"])
  })

  it("hydrates requested singular relations as objects", async () => {
    const executor = new RecordingExecutor()
    executor.results = [
      [
        {
          id: "product_1",
          data: JSON.stringify({ id: "product_1", title: "Product 1" }),
        },
      ],
      [
        {
          parent_id: "product_1",
          child_id: "collection_1",
          child_name: "ProductCollection",
        },
      ],
      [
        {
          id: "collection_1",
          data: JSON.stringify({
            handle: "collection-1",
            id: "collection_1",
            title: "Collection 1",
          }),
        },
      ],
    ]
    const { provider } = createProvider({ executor })

    const result = await provider.query({
      fields: ["product.*", "product.collection.*"],
    })

    expect(result.data).toEqual([
      {
        collection: {
          handle: "collection-1",
          id: "collection_1",
          title: "Collection 1",
        },
        id: "product_1",
        title: "Product 1",
      },
    ])
  })

  it("filters nested relation arrays and removes parents with no matches", async () => {
    const executor = new RecordingExecutor()
    executor.results = [
      [
        {
          id: "product_1",
          data: JSON.stringify({ id: "product_1", title: "Product 1" }),
        },
        {
          id: "product_2",
          data: JSON.stringify({ id: "product_2", title: "Product 2" }),
        },
      ],
      [
        {
          parent_id: "product_1",
          child_id: "variant_1",
          child_name: "ProductVariant",
        },
        {
          parent_id: "product_1",
          child_id: "variant_2",
          child_name: "ProductVariant",
        },
      ],
      [
        {
          id: "variant_1",
          data: JSON.stringify({ id: "variant_1", sku: "aaa test aaa" }),
        },
        {
          id: "variant_2",
          data: JSON.stringify({ id: "variant_2", sku: "sku 123" }),
        },
      ],
      [
        {
          parent_id: "variant_1",
          child_id: "link_1",
          child_name: "ProductVariantPriceSet",
        },
        {
          parent_id: "variant_2",
          child_id: "link_2",
          child_name: "ProductVariantPriceSet",
        },
      ],
      [
        {
          parent_id: "link_1",
          child_id: "price_set_1",
          child_name: "PriceSet",
        },
        {
          parent_id: "link_2",
          child_id: "price_set_2",
          child_name: "PriceSet",
        },
      ],
      [
        {
          parent_id: "price_set_1",
          child_id: "money_amount_1",
          child_name: "Price",
        },
        {
          parent_id: "price_set_2",
          child_id: "money_amount_2",
          child_name: "Price",
        },
      ],
      [
        {
          id: "money_amount_1",
          data: JSON.stringify({ id: "money_amount_1", amount: 100 }),
        },
        {
          id: "money_amount_2",
          data: JSON.stringify({ id: "money_amount_2", amount: 10 }),
        },
      ],
    ]
    const { provider } = createProvider({ executor })

    const result = await provider.query({
      fields: ["product.*", "product.variants.*", "product.variants.prices.*"],
      filters: {
        product: {
          variants: {
            sku: { $like: "aaa%" },
          },
        },
      },
    })

    expect(result.data).toEqual([
      {
        id: "product_1",
        title: "Product 1",
        variants: [
          {
            id: "variant_1",
            sku: "aaa test aaa",
            prices: [
              {
                id: "money_amount_1",
                amount: 100,
              },
            ],
          },
        ],
      },
    ])
  })

  it("orders nested relation arrays by descendant scalar values", async () => {
    const executor = new RecordingExecutor()
    executor.results = [
      [
        {
          id: "product_1",
          data: JSON.stringify({ id: "product_1", title: "Product 1" }),
        },
        {
          id: "product_2",
          data: JSON.stringify({ id: "product_2", title: "Product 2" }),
        },
      ],
      [
        {
          parent_id: "product_1",
          child_id: "variant_1",
          child_name: "ProductVariant",
        },
        {
          parent_id: "product_1",
          child_id: "variant_2",
          child_name: "ProductVariant",
        },
      ],
      [
        {
          id: "variant_1",
          data: JSON.stringify({ id: "variant_1", sku: "aaa test aaa" }),
        },
        {
          id: "variant_2",
          data: JSON.stringify({ id: "variant_2", sku: "sku 123" }),
        },
      ],
      [
        {
          parent_id: "variant_1",
          child_id: "link_1",
          child_name: "ProductVariantPriceSet",
        },
        {
          parent_id: "variant_2",
          child_id: "link_2",
          child_name: "ProductVariantPriceSet",
        },
      ],
      [
        {
          parent_id: "link_1",
          child_id: "price_set_1",
          child_name: "PriceSet",
        },
        {
          parent_id: "link_2",
          child_id: "price_set_2",
          child_name: "PriceSet",
        },
      ],
      [
        {
          parent_id: "price_set_1",
          child_id: "money_amount_1",
          child_name: "Price",
        },
        {
          parent_id: "price_set_2",
          child_id: "money_amount_2",
          child_name: "Price",
        },
      ],
      [
        {
          id: "money_amount_1",
          data: JSON.stringify({ id: "money_amount_1", amount: 100 }),
        },
        {
          id: "money_amount_2",
          data: JSON.stringify({ id: "money_amount_2", amount: 10 }),
        },
      ],
    ]
    const { provider } = createProvider({ executor })

    const result = await provider.query({
      fields: ["product.*", "product.variants.*", "product.variants.prices.*"],
      pagination: {
        order: {
          product: {
            variants: {
              prices: {
                amount: "ASC",
              },
            },
          },
        },
      },
    })

    expect(result.data).toEqual([
      {
        id: "product_1",
        title: "Product 1",
        variants: [
          {
            id: "variant_2",
            sku: "sku 123",
            prices: [
              {
                id: "money_amount_2",
                amount: 10,
              },
            ],
          },
          {
            id: "variant_1",
            sku: "aaa test aaa",
            prices: [
              {
                id: "money_amount_1",
                amount: 100,
              },
            ],
          },
        ],
      },
      {
        id: "product_2",
        title: "Product 2",
        variants: [],
      },
    ])
  })

  it("runs product variant price query assertions against real SQLite", async () => {
    const sqlite = createNodeSqliteExecutor()

    try {
      const provider = new SqliteIndexStorageProvider(
        {
          [ContainerRegistrationKeys.QUERY]: createRemoteQuery([]),
        },
        {
          schemaObjectRepresentation,
          entityMap: {},
          executor: sqlite.executor,
        }
      )
      await provider.onApplicationStart()
      await seedProductVariantPriceIndex(sqlite.executor)

      const { data, metadata } = await provider.query({
        fields: [
          "product.*",
          "product.variants.*",
          "product.variants.prices.*",
        ],
        filters: {
          product: {
            variants: {
              sku: { $like: "aaa%" },
            },
          },
        },
        pagination: {
          take: 100,
          skip: 0,
        },
      })

      expect(metadata).toEqual({
        estimate_count: 1,
        skip: 0,
        take: 100,
      })
      expect(data).toEqual([
        {
          id: "prod_1",
          title: "Product 1",
          variants: [
            {
              id: "var_1",
              sku: "aaa test aaa",
              prices: [
                {
                  id: "money_amount_1",
                  amount: 100,
                },
              ],
            },
          ],
        },
      ])

      const { data: joinFilteredData, metadata: joinFilteredMetadata } =
        await provider.query({
          fields: [
            "product.*",
            "product.variants.*",
            "product.variants.prices.*",
          ],
          joinFilters: {
            "product.variants.prices.amount": { $gt: 110 },
          },
          filters: {
            product: {
              variants: {
                sku: { $like: "aaa%" },
              },
            },
          },
          pagination: {
            take: 100,
            skip: 0,
            order: {
              product: {
                created_at: "ASC",
              },
            },
          },
        })

      expect(joinFilteredMetadata).toEqual({
        estimate_count: 1,
        skip: 0,
        take: 100,
      })
      expect(joinFilteredData).toEqual([
        {
          id: "prod_1",
          title: "Product 1",
          variants: [
            {
              id: "var_1",
              sku: "aaa test aaa",
              prices: [],
            },
          ],
        },
      ])
    } finally {
      sqlite.close()
    }
  })

  it("runs nested ordering query assertions against real SQLite", async () => {
    const sqlite = createNodeSqliteExecutor()

    try {
      const provider = new SqliteIndexStorageProvider(
        {
          [ContainerRegistrationKeys.QUERY]: createRemoteQuery([]),
        },
        {
          schemaObjectRepresentation,
          entityMap: {},
          executor: sqlite.executor,
        }
      )
      await provider.onApplicationStart()
      await seedProductVariantPriceIndex(sqlite.executor)

      const { data: skuDescData } = await provider.query({
        fields: [
          "product.*",
          "product.variants.*",
          "product.variants.prices.*",
        ],
        pagination: {
          order: {
            product: {
              variants: {
                sku: "DESC",
              },
            },
          },
        },
      })

      expect(skuDescData).toEqual([
        {
          id: "prod_2",
          title: "Product 2 title",
          deep: {
            a: 1,
            obj: {
              b: 15,
            },
          },
          variants: [],
        },
        {
          id: "prod_1",
          title: "Product 1",
          variants: [
            {
              id: "var_2",
              sku: "sku 123",
              prices: [
                {
                  id: "money_amount_2",
                  amount: 10,
                },
              ],
            },
            {
              id: "var_1",
              sku: "aaa test aaa",
              prices: [
                {
                  id: "money_amount_1",
                  amount: 100,
                },
              ],
            },
          ],
        },
      ])

      const { data: skuDescSpecificFieldsData } = await provider.query({
        fields: [
          "product.*",
          "product.variants.sku",
          "product.variants.prices.amount",
        ],
        pagination: {
          order: {
            product: {
              variants: {
                sku: "DESC",
              },
            },
          },
        },
      })

      expect(skuDescSpecificFieldsData).toEqual([
        {
          id: "prod_2",
          title: "Product 2 title",
          deep: {
            a: 1,
            obj: {
              b: 15,
            },
          },
          variants: [],
        },
        {
          id: "prod_1",
          title: "Product 1",
          variants: [
            {
              id: "var_2",
              sku: "sku 123",
              prices: [
                {
                  id: "money_amount_2",
                  amount: 10,
                },
              ],
            },
            {
              id: "var_1",
              sku: "aaa test aaa",
              prices: [
                {
                  id: "money_amount_1",
                  amount: 100,
                },
              ],
            },
          ],
        },
      ])

      const { data: priceDescData } = await provider.query({
        fields: [
          "product.*",
          "product.variants.*",
          "product.variants.prices.*",
        ],
        pagination: {
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

      expect(priceDescData).toEqual([
        {
          id: "prod_2",
          title: "Product 2 title",
          deep: {
            a: 1,
            obj: {
              b: 15,
            },
          },
          variants: [],
        },
        {
          id: "prod_1",
          title: "Product 1",
          variants: [
            {
              id: "var_1",
              sku: "aaa test aaa",
              prices: [
                {
                  id: "money_amount_1",
                  amount: 100,
                },
              ],
            },
            {
              id: "var_2",
              sku: "sku 123",
              prices: [
                {
                  id: "money_amount_2",
                  amount: 10,
                },
              ],
            },
          ],
        },
      ])

      const { data: priceAscData } = await provider.query({
        fields: [
          "product.*",
          "product.variants.*",
          "product.variants.prices.*",
        ],
        pagination: {
          order: {
            product: {
              variants: {
                prices: {
                  amount: "ASC",
                },
              },
            },
          },
        },
      })

      expect(priceAscData).toEqual([
        {
          id: "prod_1",
          title: "Product 1",
          variants: [
            {
              id: "var_2",
              sku: "sku 123",
              prices: [
                {
                  id: "money_amount_2",
                  amount: 10,
                },
              ],
            },
            {
              id: "var_1",
              sku: "aaa test aaa",
              prices: [
                {
                  id: "money_amount_1",
                  amount: 100,
                },
              ],
            },
          ],
        },
        {
          id: "prod_2",
          title: "Product 2 title",
          deep: {
            a: 1,
            obj: {
              b: 15,
            },
          },
          variants: [],
        },
      ])
    } finally {
      sqlite.close()
    }
  })

  it("runs idsOnly nested ordering assertion against real SQLite", async () => {
    const sqlite = createNodeSqliteExecutor()

    try {
      const provider = new SqliteIndexStorageProvider(
        {
          [ContainerRegistrationKeys.QUERY]: createRemoteQuery([]),
        },
        {
          schemaObjectRepresentation,
          entityMap: {},
          executor: sqlite.executor,
        }
      )
      await provider.onApplicationStart()
      await seedProductVariantPriceIndex(sqlite.executor)

      const { data } = await provider.query({
        fields: ["product.*", "product.variants.*"],
        idsOnly: true,
        pagination: {
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

      expect(data).toEqual([
        {
          id: "prod_2",
          variants: [],
        },
        {
          id: "prod_1",
          variants: [
            {
              id: "var_1",
            },
            {
              id: "var_2",
            },
          ],
        },
      ])
    } finally {
      sqlite.close()
    }
  })

  it("runs root logical filter assertions against real SQLite", async () => {
    const sqlite = createNodeSqliteExecutor()

    try {
      const provider = new SqliteIndexStorageProvider(
        {
          [ContainerRegistrationKeys.QUERY]: createRemoteQuery([]),
        },
        {
          schemaObjectRepresentation,
          entityMap: {},
          executor: sqlite.executor,
        }
      )
      await provider.onApplicationStart()
      await seedProductVariantPriceIndex(sqlite.executor)

      const { data: notInData } = await provider.query({
        fields: ["product.*"],
        filters: {
          product: {
            $not: [
              {
                id: {
                  $in: ["prod_1"],
                },
              },
            ],
          },
        },
      })

      expect(notInData).toEqual([
        {
          id: "prod_2",
          title: "Product 2 title",
          deep: {
            a: 1,
            obj: {
              b: 15,
            },
          },
        },
      ])

      const { data: ninData } = await provider.query({
        fields: ["product.*"],
        filters: {
          product: {
            id: {
              $nin: ["prod_1"],
            },
          },
        },
      })

      expect(ninData).toEqual([
        {
          id: "prod_2",
          title: "Product 2 title",
          deep: {
            a: 1,
            obj: {
              b: 15,
            },
          },
        },
      ])

      const { data: andNotData } = await provider.query({
        fields: ["product.*"],
        filters: {
          product: {
            $and: [
              {
                title: {
                  $like: "Product%",
                },
              },
              {
                $not: {
                  title: {
                    $eq: "Product 1",
                  },
                },
              },
            ],
          },
        },
      })

      expect(andNotData).toEqual([
        {
          id: "prod_2",
          title: "Product 2 title",
          deep: {
            a: 1,
            obj: {
              b: 15,
            },
          },
        },
      ])

      const { data: ilikeData } = await provider.query({
        fields: ["product.id", "product.title"],
        filters: {
          product: {
            title: {
              $ilike: "PROdUCt 2%",
            },
          },
        },
      })

      expect(ilikeData).toEqual([
        {
          id: "prod_2",
          title: "Product 2 title",
        },
      ])

      const { data: sensitiveLikeData } = await provider.query({
        fields: ["product.id", "product.title"],
        filters: {
          product: {
            title: {
              $like: "PROdUCt 2%",
            },
          },
        },
      })

      expect(sensitiveLikeData).toEqual([])

      const { data: searchData, metadata: searchMetadata } =
        await provider.query({
          fields: ["product.id", "product.title"],
          filters: {
            product: {
              q: "product 2",
            },
          },
          pagination: {
            take: 1,
            skip: 0,
          },
        })

      expect(searchMetadata).toEqual({
        estimate_count: 1,
        skip: 0,
        take: 1,
      })
      expect(searchData).toEqual([
        {
          id: "prod_2",
          title: "Product 2 title",
        },
      ])

      const { data: missingSearchData } = await provider.query({
        fields: ["product.id", "product.title"],
        filters: {
          product: {
            q: "missing",
          },
        },
      })

      expect(missingSearchData).toEqual([])
    } finally {
      sqlite.close()
    }
  })

  it("runs nested null and projection filter assertions against real SQLite", async () => {
    const sqlite = createNodeSqliteExecutor()

    try {
      const provider = new SqliteIndexStorageProvider(
        {
          [ContainerRegistrationKeys.QUERY]: createRemoteQuery([]),
        },
        {
          schemaObjectRepresentation,
          entityMap: {},
          executor: sqlite.executor,
        }
      )
      await provider.onApplicationStart()
      await seedProductVariantPriceIndex(sqlite.executor)

      const { data: skuNotNullData } = await provider.query({
        fields: [
          "product.*",
          "product.variants.*",
          "product.variants.prices.*",
        ],
        filters: {
          product: {
            variants: {
              sku: { $ne: null },
            },
          },
        },
      })

      const { data: skuNotEqNullData } = await provider.query({
        fields: [
          "product.*",
          "product.variants.*",
          "product.variants.prices.*",
        ],
        filters: {
          product: {
            variants: {
              sku: {
                $not: {
                  $eq: null,
                },
              },
            },
          },
        },
      })

      expect(skuNotNullData).toEqual([
        {
          id: "prod_1",
          title: "Product 1",
          variants: [
            {
              id: "var_1",
              sku: "aaa test aaa",
              prices: [
                {
                  id: "money_amount_1",
                  amount: 100,
                },
              ],
            },
            {
              id: "var_2",
              sku: "sku 123",
              prices: [
                {
                  id: "money_amount_2",
                  amount: 10,
                },
              ],
            },
          ],
        },
      ])
      expect(skuNotEqNullData).toEqual(skuNotNullData)

      const { data: skuNullData } = await provider.query({
        fields: [
          "product.*",
          "product.variants.*",
          "product.variants.prices.*",
        ],
        filters: {
          product: {
            variants: {
              sku: { $eq: null },
            },
          },
        },
      })

      expect(skuNullData).toEqual([])

      const { data: orderByUnselectedPriceData } = await provider.query({
        fields: ["product.id", "product.variants.*"],
        pagination: {
          order: {
            product: {
              variants: {
                prices: {
                  amount: "ASC",
                },
              },
            },
          },
        },
      })

      expect(orderByUnselectedPriceData).toEqual([
        {
          id: "prod_1",
          variants: [
            {
              id: "var_2",
              sku: "sku 123",
            },
            {
              id: "var_1",
              sku: "aaa test aaa",
            },
          ],
        },
        {
          id: "prod_2",
          variants: [],
        },
      ])

      const { data: skuInData } = await provider.query({
        fields: ["product.id", "product.variants.*"],
        filters: {
          product: {
            variants: {
              sku: { $in: ["sku 123", "aaa test aaa", "does-not-exist"] },
            },
          },
        },
        pagination: {
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

      expect(skuInData).toEqual([
        {
          id: "prod_1",
          variants: [
            {
              id: "var_1",
              sku: "aaa test aaa",
            },
            {
              id: "var_2",
              sku: "sku 123",
            },
          ],
        },
      ])
    } finally {
      sqlite.close()
    }
  })

  it("runs full result pagination and deep root filter assertions against real SQLite", async () => {
    const sqlite = createNodeSqliteExecutor()

    try {
      const provider = new SqliteIndexStorageProvider(
        {
          [ContainerRegistrationKeys.QUERY]: createRemoteQuery([]),
        },
        {
          schemaObjectRepresentation,
          entityMap: {},
          executor: sqlite.executor,
        }
      )
      await provider.onApplicationStart()
      await seedProductVariantPriceIndex(sqlite.executor)

      const { data: fullData } = await provider.query({
        fields: [
          "product.*",
          "product.variants.*",
          "product.variants.prices.*",
        ],
      })

      expect(fullData).toEqual([
        {
          id: "prod_1",
          title: "Product 1",
          variants: [
            {
              id: "var_1",
              sku: "aaa test aaa",
              prices: [
                {
                  id: "money_amount_1",
                  amount: 100,
                },
              ],
            },
            {
              id: "var_2",
              sku: "sku 123",
              prices: [
                {
                  id: "money_amount_2",
                  amount: 10,
                },
              ],
            },
          ],
        },
        {
          id: "prod_2",
          title: "Product 2 title",
          deep: {
            a: 1,
            obj: {
              b: 15,
            },
          },
          variants: [],
        },
      ])

      const { data: paginatedData, metadata: paginatedMetadata } =
        await provider.query({
          fields: [
            "product.*",
            "product.variants.*",
            "product.variants.prices.*",
          ],
          pagination: {
            take: 1,
            skip: 1,
            order: {
              product: {
                id: "ASC",
              },
            },
          },
        })

      expect(paginatedMetadata).toEqual({
        estimate_count: 2,
        skip: 1,
        take: 1,
      })
      expect(paginatedData).toEqual([
        {
          id: "prod_2",
          title: "Product 2 title",
          deep: {
            a: 1,
            obj: {
              b: 15,
            },
          },
          variants: [],
        },
      ])

      const { data: deepFilterData, metadata: deepFilterMetadata } =
        await provider.query({
          fields: ["product.*"],
          filters: {
            product: {
              deep: {
                obj: {
                  b: 15,
                },
              },
            },
          },
          pagination: {
            take: 1,
            skip: 0,
          },
        })

      expect(deepFilterMetadata).toEqual({
        estimate_count: 1,
        skip: 0,
        take: 1,
      })
      expect(deepFilterData).toEqual([
        {
          id: "prod_2",
          title: "Product 2 title",
          deep: {
            a: 1,
            obj: {
              b: 15,
            },
          },
        },
      ])
    } finally {
      sqlite.close()
    }
  })

  it("runs combined nested filter assertions against real SQLite", async () => {
    const sqlite = createNodeSqliteExecutor()

    try {
      const provider = new SqliteIndexStorageProvider(
        {
          [ContainerRegistrationKeys.QUERY]: createRemoteQuery([]),
        },
        {
          schemaObjectRepresentation,
          entityMap: {},
          executor: sqlite.executor,
        }
      )
      await provider.onApplicationStart()
      await seedProductVariantPriceIndex(sqlite.executor)

      const { data: priceFilterData, metadata } = await provider.query({
        fields: [
          "product.*",
          "product.variants.*",
          "product.variants.prices.*",
        ],
        filters: {
          product: {
            variants: {
              prices: {
                amount: { $gt: 20 },
              },
            },
          },
        },
        pagination: {
          take: 100,
          skip: 0,
          order: {
            product: {
              created_at: "ASC",
            },
          },
        },
      })

      expect(metadata).toEqual({
        estimate_count: 1,
        skip: 0,
        take: 100,
      })
      expect(priceFilterData).toEqual([
        {
          id: "prod_1",
          title: "Product 1",
          variants: [
            {
              id: "var_1",
              sku: "aaa test aaa",
              prices: [
                {
                  id: "money_amount_1",
                  amount: 100,
                },
              ],
            },
          ],
        },
      ])

      const { data: variantSkuAndTitleData } = await provider.query({
        fields: ["product.*", "variants.*"],
        filters: {
          product: {
            variants: {
              sku: {
                $nin: ["sku 123"],
              },
            },
            title: {
              $eq: "Product 2 title",
            },
          },
        },
      })

      expect(variantSkuAndTitleData).toEqual([
        {
          id: "prod_2",
          title: "Product 2 title",
          deep: {
            a: 1,
            obj: {
              b: 15,
            },
          },
        },
      ])
    } finally {
      sqlite.close()
    }
  })
})
