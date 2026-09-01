import type {
  IndexTypes,
  QueryGraphFunction,
  RemoteQueryFunction,
} from "@medusajs/framework/types"
import { simpleHash } from "@medusajs/framework/utils"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils/portable"
import { DataSynchronizer } from "../../src/services/data-synchronizer"
import { Configuration } from "../../src/utils/sync/configuration"
import { EventBusServiceMock } from "../__fixtures__"
import { updateRemovedSchema } from "../__fixtures__/update-removed-schema"
import { updatedSchema } from "../__fixtures__/updated-schema"
import {
  createPassthroughIndexBaseRepository,
  createSqliteIndexServiceHarness,
  type SqliteIndexServiceHarness,
  type SqliteIndexMetadataRecord,
  type SqliteIndexSyncRecord,
} from "../__fixtures__/sqlite-index-service"

type GraphCall = Parameters<QueryGraphFunction>[0]

const testProductId = "test_prod_1"
const testProductId2 = "test_prod_2"
const testVariantId = "test_var_1"
const testVariantId2 = "test_var_2"
const productRouteDirectFields =
  "collection_id,created_at,deleted_at,external_id,handle,id,is_giftcard,title,type_id,updated_at"
const productVariantRouteFields =
  "created_at,deleted_at,id,product.id,product_id,sku,updated_at"

describe("IndexModuleService sync metadata with SQLite provider", () => {
  let harness: SqliteIndexServiceHarness | undefined

  afterEach(() => {
    harness?.close()
  })

  it("returns detailed index metadata with last synced keys", async () => {
    const productUpdatedAt = new Date("2026-01-01T00:00:00.000Z")
    const variantUpdatedAt = new Date("2026-01-02T00:00:00.000Z")

    harness = await createSqliteIndexServiceHarness({
      indexMetadata: [
        {
          id: "metadata_1",
          entity: "product",
          status: "done",
          fields: ["id", "title"].sort().join(","),
          fields_hash: "hash_1",
          updated_at: productUpdatedAt,
        },
        {
          id: "metadata_2",
          entity: "product_variant",
          status: "pending",
          fields: ["id", "sku"].sort().join(","),
          fields_hash: "hash_2",
          updated_at: variantUpdatedAt,
        },
      ],
      indexSync: [
        {
          id: "sync_1",
          entity: "product",
          last_key: "prod_123",
        },
        {
          id: "sync_2",
          entity: "product_variant",
          last_key: null,
        },
      ],
    })

    await expect(harness.service.getInfo()).resolves.toEqual([
      {
        id: "metadata_1",
        entity: "product",
        status: "done",
        fields: ["id", "title"],
        updated_at: productUpdatedAt,
        last_synced_key: "prod_123",
      },
      {
        id: "metadata_2",
        entity: "product_variant",
        status: "pending",
        fields: ["id", "sku"],
        updated_at: variantUpdatedAt,
        last_synced_key: null,
      },
    ] satisfies IndexTypes.IndexInfo[])
  })

  it("returns empty metadata when no metadata exists", async () => {
    harness = await createSqliteIndexServiceHarness()

    await expect(harness.service.getInfo()).resolves.toEqual([])
  })

  it("returns null last synced key for metadata without a sync record", async () => {
    const updatedAt = new Date("2026-01-03T00:00:00.000Z")

    harness = await createSqliteIndexServiceHarness({
      indexMetadata: [
        {
          id: "metadata_test_1",
          entity: "test_product",
          status: "done",
          fields: "id",
          fields_hash: "hash_1",
          updated_at: updatedAt,
        },
      ],
    })

    await expect(harness.service.getInfo()).resolves.toEqual([
      {
        id: "metadata_test_1",
        entity: "test_product",
        status: "done",
        fields: ["id"],
        updated_at: updatedAt,
        last_synced_key: null,
      },
    ] satisfies IndexTypes.IndexInfo[])
  })

  it("marks completed metadata pending and emits continue sync in server mode", async () => {
    const eventBus = new EventBusServiceMock()
    const emitSpy = jest.spyOn(eventBus, "emit")

    harness = await createSqliteIndexServiceHarness({
      baseRepository: createPassthroughIndexBaseRepository(),
      eventBus,
      indexMetadata: [
        createMetadataRecord("metadata_done", "product", "done"),
        createMetadataRecord("metadata_error", "price", "error"),
        createMetadataRecord("metadata_processing", "price_set", "processing"),
        createMetadataRecord("metadata_pending", "variant", "pending"),
      ],
    })

    await harness.service.sync({})

    await expect(harness.indexMetadataService.list()).resolves.toEqual([
      expect.objectContaining({ id: "metadata_done", status: "pending" }),
      expect.objectContaining({ id: "metadata_error", status: "pending" }),
      expect.objectContaining({
        id: "metadata_processing",
        status: "pending",
      }),
      expect.objectContaining({ id: "metadata_pending", status: "pending" }),
    ])
    expect(emitSpy).toHaveBeenCalledWith({
      name: "index.continue-sync",
      data: {},
      options: { internal: true },
    })
  })

  it("treats undefined sync strategy as continue sync in server mode", async () => {
    const eventBus = new EventBusServiceMock()
    const emitSpy = jest.spyOn(eventBus, "emit")

    harness = await createSqliteIndexServiceHarness({
      baseRepository: createPassthroughIndexBaseRepository(),
      eventBus,
    })

    await harness.service.sync({ strategy: undefined })

    expect(emitSpy).toHaveBeenCalledWith({
      name: "index.continue-sync",
      data: {},
      options: { internal: true },
    })
  })

  it("resets completed metadata and sync cursors before emitting full sync", async () => {
    const eventBus = new EventBusServiceMock()
    const emitSpy = jest.spyOn(eventBus, "emit")

    harness = await createSqliteIndexServiceHarness({
      baseRepository: createPassthroughIndexBaseRepository(),
      eventBus,
      indexMetadata: [
        createMetadataRecord("metadata_done", "product", "done"),
        createMetadataRecord("metadata_error", "price", "error"),
        createMetadataRecord("metadata_processing", "price_set", "processing"),
        createMetadataRecord("metadata_pending", "variant", "pending"),
      ],
      indexSync: [
        {
          id: "sync_product",
          entity: "product",
          last_key: "prod_123",
        },
        {
          id: "sync_variant",
          entity: "variant",
          last_key: null,
        },
      ],
    })

    await harness.service.sync({ strategy: "full" })

    await expect(harness.indexMetadataService.list()).resolves.toEqual([
      expect.objectContaining({ id: "metadata_done", status: "pending" }),
      expect.objectContaining({ id: "metadata_error", status: "pending" }),
      expect.objectContaining({
        id: "metadata_processing",
        status: "pending",
      }),
      expect.objectContaining({ id: "metadata_pending", status: "pending" }),
    ])
    await expect(harness.indexSyncService.list()).resolves.toEqual([
      {
        id: "sync_product",
        entity: "product",
        last_key: null,
      },
      {
        id: "sync_variant",
        entity: "variant",
        last_key: null,
      },
    ])
    expect(emitSpy).toHaveBeenCalledWith({
      name: "index.full-sync",
      data: {},
      options: { internal: true },
    })
  })

  it("runs reset handler before emitting reset sync in server mode", async () => {
    const eventBus = new EventBusServiceMock()
    const emitSpy = jest.spyOn(eventBus, "emit")
    const transactionManager = { id: "sqlite-sync-reset-transaction" }
    const reset = jest.fn(async () => {})

    harness = await createSqliteIndexServiceHarness({
      baseRepository: createPassthroughIndexBaseRepository(transactionManager),
      eventBus,
      indexResetHandler: { reset },
    })

    await harness.service.sync({ strategy: "reset" })

    expect(reset).toHaveBeenCalledWith(transactionManager)
    expect(emitSpy).toHaveBeenCalledWith({
      name: "index.reset-sync",
      data: {},
      options: { internal: true },
    })
  })

  it("truncates SQLite index tables and metadata before emitting reset sync", async () => {
    const eventBus = new EventBusServiceMock()
    const emitSpy = jest.spyOn(eventBus, "emit")

    harness = await createSqliteIndexServiceHarness({
      baseRepository: createPassthroughIndexBaseRepository(),
      eventBus,
      indexMetadata: [
        createMetadataRecord("metadata_product", "Product", "done"),
      ],
      indexSync: [
        {
          id: "sync_product",
          entity: "Product",
          last_key: "prod_123",
        },
      ],
    })
    await harness.seedProductVariantPriceIndex()

    await harness.service.sync({ strategy: "reset" })

    await expect(
      harness.executor.execute("SELECT id FROM index_data")
    ).resolves.toEqual([])
    await expect(
      harness.executor.execute("SELECT id FROM index_relation")
    ).resolves.toEqual([])
    await expect(harness.indexMetadataService.list()).resolves.toEqual([])
    await expect(harness.indexSyncService.list()).resolves.toEqual([])
    expect(emitSpy).toHaveBeenCalledWith({
      name: "index.reset-sync",
      data: {},
      options: { internal: true },
    })
  })

  it("handles SQLite reset sync when index tables are empty", async () => {
    const eventBus = new EventBusServiceMock()
    const emitSpy = jest.spyOn(eventBus, "emit")

    harness = await createSqliteIndexServiceHarness({
      baseRepository: createPassthroughIndexBaseRepository(),
      eventBus,
    })

    await expect(
      harness.service.sync({ strategy: "reset" })
    ).resolves.toBeUndefined()
    await expect(
      harness.executor.execute("SELECT id FROM index_data")
    ).resolves.toEqual([])
    await expect(
      harness.executor.execute("SELECT id FROM index_relation")
    ).resolves.toEqual([])
    expect(emitSpy).toHaveBeenCalledWith({
      name: "index.reset-sync",
      data: {},
      options: { internal: true },
    })
  })

  it("syncs products and variants through DataSynchronizer into SQLite", async () => {
    const ack = jest.fn(async () => {})

    harness = await createSqliteIndexServiceHarness({
      query: createSyncRemoteQuery(),
      workerMode: "worker",
    })

    await getDataSynchronizer().syncEntity({
      entityName: "Product",
      ack,
    })

    ack.mockClear()

    const result = await getDataSynchronizer().syncEntity({
      entityName: "ProductVariant",
      pagination: {
        batchSize: 1,
      },
      ack,
    })

    expect(ack).toHaveBeenNthCalledWith(1, {
      lastCursor: testVariantId,
    })
    expect(ack).toHaveBeenNthCalledWith(2, {
      lastCursor: testVariantId2,
    })
    expect(ack).toHaveBeenNthCalledWith(3, {
      lastCursor: testVariantId2,
      done: true,
    })
    expect(result).toEqual({
      lastCursor: testVariantId2,
      done: true,
    })

    const indexRows = await getCurrentHarness().executor.execute(
      "SELECT id, name, data FROM index_data ORDER BY name, id"
    )
    const relationRows = await getCurrentHarness().executor.execute(
      "SELECT parent_name, parent_id, child_name, child_id, pivot FROM index_relation ORDER BY parent_id, child_id"
    )

    expect(
      indexRows.map((row) => ({
        id: row.id,
        name: row.name,
        data: parseJsonObject(row.data),
      }))
    ).toEqual([
      {
        id: testProductId,
        name: "Product",
        data: {
          created_at: "2026-01-01T00:00:00.000Z",
          id: testProductId,
          title: "Test Product",
        },
      },
      {
        id: testProductId2,
        name: "Product",
        data: {
          created_at: "2026-01-02T00:00:00.000Z",
          id: testProductId2,
          title: "Test Product 2",
        },
      },
      {
        id: testVariantId,
        name: "ProductVariant",
        data: {
          id: testVariantId,
          product_id: testProductId,
          sku: "test-variant-1",
        },
      },
      {
        id: testVariantId2,
        name: "ProductVariant",
        data: {
          id: testVariantId2,
          product_id: testProductId2,
          sku: "test-variant-2",
        },
      },
    ])

    expect(relationRows).toEqual([
      {
        parent_name: "Product",
        parent_id: testProductId,
        child_name: "ProductVariant",
        child_id: testVariantId,
        pivot: "Product-ProductVariant",
      },
      {
        parent_name: "Product",
        parent_id: testProductId2,
        child_name: "ProductVariant",
        child_id: testVariantId2,
        pivot: "Product-ProductVariant",
      },
    ])
  })

  it("checks configuration changes and starts worker sync in SQLite worker mode", async () => {
    const dataSynchronizer = createWorkerStartupDataSynchronizer()
    const syncEntities = jest
      .spyOn(dataSynchronizer, "syncEntities")
      .mockResolvedValue(undefined)

    harness = await createSqliteIndexServiceHarness({
      dataSynchronizer,
      indexConfigurationCheckerFactory: (input) => new Configuration(input),
      workerMode: "worker",
    })

    const metadataRows = await harness.indexMetadataService.list()
    const syncRows = await harness.indexSyncService.list()

    expect(syncEntities).toHaveBeenCalledTimes(1)
    expect(syncEntities).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          entity: "Product",
          fields: productRouteDirectFields,
          status: "pending",
        }),
        expect.objectContaining({
          entity: "ProductVariant",
          fields: productVariantRouteFields,
          status: "pending",
        }),
      ])
    )
    expect(metadataRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          entity: "Product",
          fields: productRouteDirectFields,
          status: "pending",
        }),
        expect.objectContaining({
          entity: "ProductVariant",
          fields: productVariantRouteFields,
          status: "pending",
        }),
      ])
    )
    expect(syncRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          entity: "Product",
          last_key: null,
        }),
        expect.objectContaining({
          entity: "ProductVariant",
          last_key: null,
        }),
      ])
    )
  })

  it("marks changed configuration metadata pending in SQLite worker mode", async () => {
    let syncEntitiesSpy:
      | jest.SpiedFunction<DataSynchronizer["syncEntities"]>
      | undefined

    harness = await createSqliteIndexServiceHarness({
      indexMetadata: createDefaultConfigurationMetadataRecords(),
      indexSync: createDefaultConfigurationSyncRecords("last_cursor"),
      indexConfigurationCheckerFactory: (input) => new Configuration(input),
      onBeforeServiceStart: ({ dataSynchronizer }) => {
        syncEntitiesSpy = jest
          .spyOn(dataSynchronizer, "syncEntities")
          .mockResolvedValue(undefined)
      },
      schema: updatedSchema,
      workerMode: "worker",
    })

    const metadataRows = await harness.indexMetadataService.list()
    const changedSyncRows = await harness.indexSyncService.list({
      entity: ["Product", "Price"],
    })

    expect(syncEntitiesSpy).toHaveBeenCalledTimes(1)
    expect(syncEntitiesSpy).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          entity: "Product",
          fields: "handle,id,title",
          status: "pending",
        }),
        expect.objectContaining({
          entity: "Price",
          fields: "amount,currency_code,price_set.id",
          status: "pending",
        }),
      ])
    )
    expect(metadataRows).toHaveLength(7)
    expect(metadataRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          entity: "InternalObject",
          fields: "b",
          status: "done",
        }),
        expect.objectContaining({
          entity: "Product",
          fields: "handle,id,title",
          status: "pending",
        }),
        expect.objectContaining({
          entity: "InternalNested",
          fields: "a",
          status: "done",
        }),
        expect.objectContaining({
          entity: "PriceSet",
          fields: "id",
          status: "done",
        }),
        expect.objectContaining({
          entity: "Price",
          fields: "amount,currency_code,price_set.id",
          status: "pending",
        }),
        expect.objectContaining({
          entity: "ProductVariant",
          fields: "id,product.id,product_id,sku",
          status: "done",
        }),
        expect.objectContaining({
          entity: "LinkProductVariantPriceSet",
          fields: "id,price_set_id,variant_id",
          status: "done",
        }),
      ])
    )
    expect(changedSyncRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          entity: "Product",
          last_key: null,
        }),
        expect.objectContaining({
          entity: "Price",
          last_key: null,
        }),
      ])
    )
  })

  it("removes deleted configuration metadata in SQLite worker mode", async () => {
    let removeEntitiesSpy:
      | jest.SpiedFunction<DataSynchronizer["removeEntities"]>
      | undefined
    let syncEntitiesSpy:
      | jest.SpiedFunction<DataSynchronizer["syncEntities"]>
      | undefined

    harness = await createSqliteIndexServiceHarness({
      indexMetadata: createUpdatedConfigurationMetadataRecords(),
      indexSync: createDefaultConfigurationSyncRecords(),
      indexConfigurationCheckerFactory: (input) => new Configuration(input),
      onBeforeServiceStart: ({ dataSynchronizer }) => {
        removeEntitiesSpy = jest.spyOn(dataSynchronizer, "removeEntities")
        syncEntitiesSpy = jest
          .spyOn(dataSynchronizer, "syncEntities")
          .mockResolvedValue(undefined)
      },
      schema: updateRemovedSchema,
      workerMode: "worker",
    })

    const metadataRows = await harness.indexMetadataService.list()
    const productVariantSyncRows = await harness.indexSyncService.list({
      entity: "ProductVariant",
    })

    expect(removeEntitiesSpy).toHaveBeenCalledTimes(1)
    expect(removeEntitiesSpy).toHaveBeenCalledWith(
      expect.arrayContaining([
        "InternalObject",
        "InternalNested",
        "PriceSet",
        "Price",
        "LinkProductVariantPriceSet",
      ])
    )
    expect(removeEntitiesSpy?.mock.calls[0]?.[0]).toHaveLength(5)
    expect(syncEntitiesSpy).toHaveBeenCalledTimes(1)
    expect(syncEntitiesSpy).toHaveBeenCalledWith([
      expect.objectContaining({
        entity: "ProductVariant",
        fields: "description,id,product.id,product_id,sku",
        status: "pending",
      }),
    ])
    expect(metadataRows).toHaveLength(2)
    expect(metadataRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          entity: "Product",
          fields: "handle,id,title",
          status: "done",
        }),
        expect.objectContaining({
          entity: "ProductVariant",
          fields: "description,id,product.id,product_id,sku",
          status: "pending",
        }),
      ])
    )
    expect(productVariantSyncRows).toEqual([
      expect.objectContaining({
        entity: "ProductVariant",
        last_key: null,
      }),
    ])
  })

  it("orchestrates SQLite syncEntities with locks, statuses, cursors, and stale cleanup", async () => {
    harness = await createSqliteIndexServiceHarness({
      indexMetadata: [
        createMetadataRecord("metadata_product", "Product", "pending"),
        createMetadataRecord(
          "metadata_product_variant",
          "ProductVariant",
          "pending"
        ),
      ],
      indexSync: [
        {
          id: "sync_product",
          entity: "Product",
          last_key: null,
        },
        {
          id: "sync_product_variant",
          entity: "ProductVariant",
          last_key: null,
        },
      ],
      query: createSyncRemoteQuery(),
      workerMode: "worker",
    })

    await harness.executor.execute(
      "INSERT INTO index_data (id, name, data, staled_at) VALUES (?, ?, ?, ?)",
      [
        "stale_prod",
        "Product",
        JSON.stringify({ id: "stale_prod", title: "Stale Product" }),
        null,
      ]
    )

    await getDataSynchronizer().syncEntities([
      {
        entity: "Product",
        fields: "created_at,id,title",
        fields_hash: "product_hash",
      },
      {
        entity: "ProductVariant",
        fields: "id,product.id,product_id,sku",
        fields_hash: "product_variant_hash",
      },
    ])

    await expect(harness.indexMetadataService.list()).resolves.toEqual([
      expect.objectContaining({
        entity: "Product",
        status: "done",
      }),
      expect.objectContaining({
        entity: "ProductVariant",
        status: "done",
      }),
    ])
    await expect(harness.indexSyncService.list()).resolves.toEqual([
      expect.objectContaining({
        entity: "Product",
        last_key: testProductId2,
      }),
      expect.objectContaining({
        entity: "ProductVariant",
        last_key: testVariantId2,
      }),
    ])

    expect(harness.lockingModule.acquiredKeys).toEqual([
      "Product",
      "ProductVariant",
    ])
    expect(harness.lockingModule.releasedKeys).toEqual([
      "Product",
      "ProductVariant",
    ])

    const indexRows = await harness.executor.execute(
      "SELECT id, name, data, staled_at FROM index_data ORDER BY name, id"
    )
    const relationRows = await harness.executor.execute(
      "SELECT parent_name, parent_id, child_name, child_id, pivot, staled_at FROM index_relation ORDER BY parent_id, child_id"
    )

    expect(
      indexRows.map((row) => ({
        id: row.id,
        name: row.name,
        data: parseJsonObject(row.data),
        staled_at: row.staled_at,
      }))
    ).toEqual([
      {
        id: testProductId,
        name: "Product",
        data: {
          created_at: "2026-01-01T00:00:00.000Z",
          id: testProductId,
          title: "Test Product",
        },
        staled_at: null,
      },
      {
        id: testProductId2,
        name: "Product",
        data: {
          created_at: "2026-01-02T00:00:00.000Z",
          id: testProductId2,
          title: "Test Product 2",
        },
        staled_at: null,
      },
      {
        id: testVariantId,
        name: "ProductVariant",
        data: {
          id: testVariantId,
          product_id: testProductId,
          sku: "test-variant-1",
        },
        staled_at: null,
      },
      {
        id: testVariantId2,
        name: "ProductVariant",
        data: {
          id: testVariantId2,
          product_id: testProductId2,
          sku: "test-variant-2",
        },
        staled_at: null,
      },
    ])
    expect(indexRows).toHaveLength(4)
    expect(relationRows).toEqual([
      {
        parent_name: "Product",
        parent_id: testProductId,
        child_name: "ProductVariant",
        child_id: testVariantId,
        pivot: "Product-ProductVariant",
        staled_at: null,
      },
      {
        parent_name: "Product",
        parent_id: testProductId2,
        child_name: "ProductVariant",
        child_id: testVariantId2,
        pivot: "Product-ProductVariant",
        staled_at: null,
      },
    ])
  })

  function getCurrentHarness(): SqliteIndexServiceHarness {
    if (!harness) {
      throw new Error("Expected SQLite Index service harness to be initialized")
    }

    return harness
  }

  function getDataSynchronizer(): DataSynchronizer {
    const dataSynchronizer = getCurrentHarness().dataSynchronizer

    if (!dataSynchronizer) {
      throw new Error("Expected DataSynchronizer to be initialized")
    }

    return dataSynchronizer
  }
})

function createWorkerStartupDataSynchronizer(): DataSynchronizer {
  return new DataSynchronizer({
    [ContainerRegistrationKeys.QUERY]: createSyncRemoteQuery(),
  })
}

function createMetadataRecord(
  id: string,
  entity: string,
  status: IndexTypes.IndexInfo["status"]
) {
  return {
    id,
    entity,
    status,
    fields: "id",
    fields_hash: `${id}_hash`,
    updated_at: new Date("2026-01-04T00:00:00.000Z"),
  }
}

function createDefaultConfigurationMetadataRecords(): SqliteIndexMetadataRecord[] {
  return [
    createConfigMetadataRecord("metadata_internal_object", "InternalObject", "b"),
    createConfigMetadataRecord(
      "metadata_product",
      "Product",
      "created_at,id,title"
    ),
    createConfigMetadataRecord("metadata_internal_nested", "InternalNested", "a"),
    createConfigMetadataRecord("metadata_price_set", "PriceSet", "id"),
    createConfigMetadataRecord("metadata_price", "Price", "amount,price_set.id"),
    createConfigMetadataRecord(
      "metadata_product_variant",
      "ProductVariant",
      "id,product.id,product_id,sku"
    ),
    createConfigMetadataRecord(
      "metadata_link_product_variant_price_set",
      "LinkProductVariantPriceSet",
      "id,price_set_id,variant_id"
    ),
  ]
}

function createUpdatedConfigurationMetadataRecords(): SqliteIndexMetadataRecord[] {
  return [
    createConfigMetadataRecord("metadata_internal_object", "InternalObject", "b"),
    createConfigMetadataRecord("metadata_product", "Product", "handle,id,title"),
    createConfigMetadataRecord("metadata_internal_nested", "InternalNested", "a"),
    createConfigMetadataRecord("metadata_price_set", "PriceSet", "id"),
    createConfigMetadataRecord(
      "metadata_price",
      "Price",
      "amount,currency_code,price_set.id"
    ),
    createConfigMetadataRecord(
      "metadata_product_variant",
      "ProductVariant",
      "id,product.id,product_id,sku"
    ),
    createConfigMetadataRecord(
      "metadata_link_product_variant_price_set",
      "LinkProductVariantPriceSet",
      "id,price_set_id,variant_id"
    ),
  ]
}

function createDefaultConfigurationSyncRecords(
  lastKey: string | null = null
): SqliteIndexSyncRecord[] {
  return createDefaultConfigurationMetadataRecords().map((metadata) => ({
    id: `sync_${metadata.entity}`,
    entity: metadata.entity,
    last_key: lastKey,
  }))
}

function createConfigMetadataRecord(
  id: string,
  entity: string,
  fields: string
): SqliteIndexMetadataRecord {
  return {
    id,
    entity,
    fields,
    fields_hash: simpleHash(fields),
    status: "done",
    updated_at: new Date("2026-01-07T00:00:00.000Z"),
  }
}

function createSyncRemoteQuery(): RemoteQueryFunction {
  const rowsByEntity = createSyncRowsByEntity()
  const remoteQuery = Object.assign(async () => [], {
    graph: async (config: GraphCall) => {
      const rows = rowsByEntity[config.entity] ?? []

      if (isIdArrayFilter(config.filters)) {
        return {
          data: rows.filter((row) => config.filters.id.includes(row.id)),
        }
      }

      const afterId = getGreaterThanId(config.filters)
      const page = rows
        .filter((row) => !afterId || row.id > afterId)
        .slice(0, config.pagination?.take ?? rows.length)

      return {
        data: page.map((row) => ({ id: row.id })),
      }
    },
    index: async () => ({ data: [] }),
    gql: async () => ({ data: [] }),
  })

  // The production remote query type is an overloaded callable object. This
  // test double implements the graph member used by DataSynchronizer/SQLite.
  return remoteQuery as unknown as RemoteQueryFunction
}

function createSyncRowsByEntity(): Record<string, Record<string, unknown>[]> {
  return {
    product: [
      {
        id: testProductId,
        title: "Test Product",
        created_at: "2026-01-01T00:00:00.000Z",
      },
      {
        id: testProductId2,
        title: "Test Product 2",
        created_at: "2026-01-02T00:00:00.000Z",
      },
    ],
    product_variant: [
      {
        id: testVariantId,
        product_id: testProductId,
        sku: "test-variant-1",
        product: { id: testProductId },
      },
      {
        id: testVariantId2,
        product_id: testProductId2,
        sku: "test-variant-2",
        product: { id: testProductId2 },
      },
    ],
  }
}

function isIdArrayFilter(
  filters: GraphCall["filters"]
): filters is { id: string[] } {
  return (
    isRecord(filters) &&
    Array.isArray(filters.id) &&
    filters.id.every((id) => typeof id === "string")
  )
}

function getGreaterThanId(filters: GraphCall["filters"]): string | undefined {
  if (!isRecord(filters) || !isRecord(filters.id)) {
    return undefined
  }

  return typeof filters.id.$gt === "string" ? filters.id.$gt : undefined
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
