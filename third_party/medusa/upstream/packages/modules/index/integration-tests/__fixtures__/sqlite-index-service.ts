import type {
  IEventBusModuleService,
  ILockingModule,
  IndexTypes,
  Logger,
  ModulesSdkTypes,
  RemoteQueryFunction,
} from "@medusajs/framework/types"
import {
  ContainerRegistrationKeys,
  Modules,
} from "@medusajs/framework/utils/portable"
import {
  indexRelationQueryProofSchema,
  registerIndexRelationQueryProofJoinerConfigs,
  resetIndexTables,
  seedProductVariantPriceIndex,
} from "../../src/relation-query-proof-fixture"
import { DataSynchronizer } from "../../src/services/data-synchronizer"
import type {
  IndexBaseRepository,
  IndexResetHandler,
  IndexTransactionManager,
} from "../../src/services/index-module-service"
import {
  type SqliteIndexExecutor,
  type SqliteIndexValue,
} from "../../src/services/sqlite-index-storage-provider"
import {
  createSqliteIndexService,
  type CreateSqliteIndexServiceOptions,
} from "../../src/sqlite-index-service-composition"
import { EventBusServiceMock } from "./event-bus"

type NodeSqliteStatement = {
  all(...params: SqliteIndexValue[]): unknown[]
  run(...params: SqliteIndexValue[]): unknown
}

type NodeSqliteDatabase = {
  prepare(sql: string): NodeSqliteStatement
  close(): void
}

type NodeSqliteConstructor = new (path: string) => NodeSqliteDatabase

type SqliteDataSynchronizerManager = {
  execute(
    sql: string,
    params?: readonly SqliteIndexValue[]
  ): Promise<readonly Record<string, SqliteIndexValue>[]>
}

export type SqliteLockingModule = ILockingModule & {
  acquiredKeys: readonly string[]
  releasedKeys: readonly string[]
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

export type SqliteIndexServiceHarness = {
  service: IndexTypes.IIndexService
  dataSynchronizer?: DataSynchronizer
  executor: SqliteIndexExecutor
  indexMetadataService: SqliteMutableInternalService<SqliteIndexMetadataRecord>
  indexSyncService: SqliteMutableInternalService<SqliteIndexSyncRecord>
  lockingModule: SqliteLockingModule
  seedProductVariantPriceIndex(): Promise<void>
  close(): void
}

export type SqliteIndexServiceHarnessStartContext = {
  dataSynchronizer: DataSynchronizer
  executor: SqliteIndexExecutor
  indexMetadataService: ModulesSdkTypes.IMedusaInternalService<SqliteIndexMetadataRecord>
  indexSyncService: ModulesSdkTypes.IMedusaInternalService<SqliteIndexSyncRecord>
  lockingModule: SqliteLockingModule
}

export type CreateSqliteIndexServiceHarnessOptions = {
  baseRepository?: IndexBaseRepository
  dataSynchronizer?: DataSynchronizer
  eventBus?: IEventBusModuleService
  indexConfigurationCheckerFactory?: CreateSqliteIndexServiceOptions[
    "indexConfigurationCheckerFactory"
  ]
  indexMetadata?: readonly SqliteIndexMetadataRecord[]
  indexResetHandler?: IndexResetHandler
  indexSync?: readonly SqliteIndexSyncRecord[]
  lockingModule?: SqliteLockingModule
  onBeforeServiceStart?: (
    context: SqliteIndexServiceHarnessStartContext
  ) => void
  query?: RemoteQueryFunction
  schema?: CreateSqliteIndexServiceOptions["schema"]
  workerMode?: "server" | "worker" | "shared"
}

export type SqliteIndexMetadataRecord = {
  id: string
  entity: string
  status: IndexTypes.IndexInfo["status"]
  fields: string
  fields_hash: string
  updated_at: Date
}

export type SqliteIndexSyncRecord = {
  id: string
  entity: string
  last_key: string | null
}

export type SqliteMutableInternalService<TEntity extends object> = {
  clear(): Promise<void>
  list(selector?: Record<string, unknown>): Promise<TEntity[]>
}

export function createPassthroughIndexBaseRepository(
  transactionManager: IndexTransactionManager = {}
): IndexBaseRepository {
  return {
    async transaction<TResult>(
      task: (
        transactionManager: IndexTransactionManager
      ) => Promise<TResult> | TResult
    ): Promise<TResult> {
      return await task(transactionManager)
    },
  }
}

export async function createSqliteIndexServiceHarness(
  options: CreateSqliteIndexServiceHarnessOptions = {}
): Promise<SqliteIndexServiceHarness> {
  const sqlite = createNodeSqliteDatabase()
  const executor = new NodeSqliteExecutor(sqlite)
  const indexMetadataService = createMutableInternalService(
    options.indexMetadata ?? []
  )
  const indexSyncService = createMutableInternalService(options.indexSync ?? [])
  const indexResetHandler =
    options.indexResetHandler ??
    createSqliteIndexResetHandler({
      executor,
      indexMetadataService,
      indexSyncService,
    })
  const lockingModule = options.lockingModule ?? createSqliteLockingModule()
  const dataSynchronizer =
    options.dataSynchronizer ??
    createDataSynchronizer({
      executor,
      indexMetadataService,
      indexSyncService,
      lockingModule,
      query: options.query,
    })
  options.onBeforeServiceStart?.({
    dataSynchronizer,
    executor,
    indexMetadataService,
    indexSyncService,
    lockingModule,
  })
  const service = await createSqliteIndexService({
    baseRepository: options.baseRepository,
    dataSynchronizer,
    executor,
    eventBus: options.eventBus ?? new EventBusServiceMock(),
    indexConfigurationCheckerFactory: options.indexConfigurationCheckerFactory,
    indexMetadataService,
    indexResetHandler,
    indexSyncService,
    query: options.query,
    registerJoinerConfigs: registerIndexRelationQueryProofJoinerConfigs,
    schema: options.schema ?? indexRelationQueryProofSchema,
    transactionErrorMessage:
      "SQLite Index query integration should not open transactions",
    workerMode: options.workerMode,
  })

  return {
    service,
    dataSynchronizer,
    executor,
    indexMetadataService,
    indexSyncService,
    lockingModule,
    async seedProductVariantPriceIndex() {
      await seedProductVariantPriceIndex(executor)
    },
    close() {
      sqlite.close()
    },
  }
}

function createDataSynchronizer({
  executor,
  indexMetadataService,
  indexSyncService,
  lockingModule,
  query,
}: {
  executor: SqliteIndexExecutor
  indexMetadataService: ModulesSdkTypes.IMedusaInternalService<SqliteIndexMetadataRecord>
  indexSyncService: ModulesSdkTypes.IMedusaInternalService<SqliteIndexSyncRecord>
  lockingModule: SqliteLockingModule
  query: RemoteQueryFunction | undefined
}): DataSynchronizer {
  return new DataSynchronizer({
    [ContainerRegistrationKeys.QUERY]: query ?? createEmptyRemoteQuery(),
    [Modules.LOCKING]: lockingModule,
    indexMetadataService,
    indexSyncService,
    logger: sqliteHarnessLogger,
    manager: createSqliteDataSynchronizerManager(executor),
  })
}

function createSqliteIndexResetHandler({
  executor,
  indexMetadataService,
  indexSyncService,
}: {
  executor: SqliteIndexExecutor
  indexMetadataService: SqliteMutableInternalService<SqliteIndexMetadataRecord>
  indexSyncService: SqliteMutableInternalService<SqliteIndexSyncRecord>
}): IndexResetHandler {
  return {
    async reset(): Promise<void> {
      await resetIndexTables(executor)
      await Promise.all([
        indexMetadataService.clear(),
        indexSyncService.clear(),
      ])
    },
  }
}

export function createSqliteLockingModule(): SqliteLockingModule {
  const locks = new Set<string>()
  const acquiredKeys: string[] = []
  const releasedKeys: string[] = []
  const lockingModule = {
    acquiredKeys,
    releasedKeys,
    async execute<TResult>(
      keys: string | string[],
      job: () => Promise<TResult>
    ): Promise<TResult> {
      await this.acquire(keys)
      try {
        return await job()
      } finally {
        await this.release(keys)
      }
    },
    async acquire(keys: string | string[]): Promise<void> {
      for (const key of toStringArray(keys)) {
        if (locks.has(key)) {
          throw new Error(`Lock already exists for ${key}`)
        }

        locks.add(key)
        acquiredKeys.push(key)
      }
    },
    async release(keys: string | string[]): Promise<boolean> {
      let released = true

      for (const key of toStringArray(keys)) {
        released = locks.delete(key) && released
        releasedKeys.push(key)
      }

      return released
    },
    async releaseAll(): Promise<void> {
      for (const key of locks) {
        releasedKeys.push(key)
      }

      locks.clear()
    },
  } satisfies SqliteLockingModule

  return lockingModule
}

function createSqliteDataSynchronizerManager(
  executor: SqliteIndexExecutor
): SqliteDataSynchronizerManager {
  return {
    async execute(
      sql: string,
      params: readonly SqliteIndexValue[] = []
    ): Promise<readonly Record<string, SqliteIndexValue>[]> {
      const normalizedSql = normalizeSql(sql)

      if (
        normalizedSql ===
        'UPDATE "index_data" SET "staled_at" = NOW() WHERE "name" = ?'
      ) {
        return await executor.execute(
          "UPDATE index_data SET staled_at = ? WHERE name = ?",
          [new Date("2026-01-06T00:00:00.000Z").toISOString(), readParam(params, 0)]
        )
      }

      if (normalizedSql.startsWith("WITH deleted_data AS")) {
        return await removeIndexEntities(executor, normalizedSql, params)
      }

      return await executor.execute(sql, params)
    },
  }
}

async function removeIndexEntities(
  executor: SqliteIndexExecutor,
  normalizedSql: string,
  params: readonly SqliteIndexValue[]
): Promise<readonly Record<string, SqliteIndexValue>[]> {
  const entity = readParam(params, 0)
  const staleOnly = normalizedSql.includes("staled_at IS NOT NULL")
  const staleCondition = staleOnly ? "AND staled_at IS NOT NULL" : ""
  const deletedRows = await executor.execute(
    `SELECT id FROM index_data WHERE name = ? ${staleCondition}`,
    [entity]
  )
  const deletedIds = deletedRows.map((row) => readStringColumn(row, "id"))

  if (!deletedIds.length) {
    return []
  }

  const placeholders = deletedIds.map(() => "?").join(", ")
  await executor.execute(
    `DELETE FROM index_data WHERE name = ? AND id IN (${placeholders})`,
    [entity, ...deletedIds]
  )
  await executor.execute(
    `
      DELETE FROM index_relation
      WHERE (parent_name = ? AND parent_id IN (${placeholders}))
         OR (child_name = ? AND child_id IN (${placeholders}))
    `,
    [entity, ...deletedIds, entity, ...deletedIds]
  )

  return []
}

const sqliteHarnessLogger: Logger = {
  panic: console.error,
  shouldLog: () => true,
  setLogLevel: () => {},
  unsetLogLevel: () => {},
  activity: (message) => message,
  progress: () => {},
  error: console.error,
  failure: (_activityId, message) => message,
  success: (_activityId, message) => ({ message }),
  silly: console.debug,
  debug: console.debug,
  verbose: console.debug,
  http: console.info,
  info: console.info,
  warn: console.warn,
  log: console.log,
}

function createEmptyRemoteQuery(): RemoteQueryFunction {
  const remoteQuery = Object.assign(async () => [], {
    graph: async () => ({ data: [] }),
    index: async () => ({ data: [] }),
    gql: async () => ({ data: [] }),
  })

  // The production remote query type is an overloaded callable object. This
  // fixture implements only the members used by DataSynchronizer and SQLite.
  return remoteQuery as unknown as RemoteQueryFunction
}

function createMutableInternalService<TEntity extends { id: string }>(
  rows: readonly TEntity[]
): ModulesSdkTypes.IMedusaInternalService<TEntity> &
  SqliteMutableInternalService<TEntity> {
  const mutableRows = rows.map((row) => ({ ...row }))
  const service = {
    __container__: {},
    async clear(): Promise<void> {
      mutableRows.splice(0, mutableRows.length)
    },
    async list(selector: Record<string, unknown> = {}): Promise<TEntity[]> {
      return mutableRows
        .filter((row) => matchesSelector(row, selector))
        .map((row) => ({ ...row }))
    },
    async create(input: Partial<TEntity> | readonly Partial<TEntity>[]) {
      const createdRows = toArray(input).map((row, offset) =>
        createInternalServiceRow(row, mutableRows.length + offset)
      )

      mutableRows.push(...createdRows)

      return createdRows.map((row) => ({ ...row }))
    },
    async update(input: {
      selector?: Record<string, unknown>
      data?: Partial<TEntity>
    } | readonly Partial<TEntity>[]): Promise<TEntity[]> {
      if (Array.isArray(input)) {
        const updatedRows: TEntity[] = []

        for (const entry of input) {
          const entity = getEntity(entry)
          if (!entity) {
            continue
          }

          for (const row of mutableRows) {
            if (getEntity(row) !== entity) {
              continue
            }

            Object.assign(row, entry)
            updatedRows.push({ ...row })
          }
        }

        return updatedRows
      }

      const selector = input.selector ?? {}
      const data = input.data ?? {}
      const updatedRows: TEntity[] = []

      for (const row of mutableRows) {
        if (!matchesSelector(row, selector)) {
          continue
        }

        Object.assign(row, data)
        updatedRows.push({ ...row })
      }

      return updatedRows
    },
    async delete(input: readonly { entity: string }[]) {
      const entitiesToDelete = new Set(input.map((entry) => entry.entity))
      const deletedRows: TEntity[] = []

      for (let index = mutableRows.length - 1; index >= 0; index--) {
        const row = mutableRows[index]
        if (!row || !entitiesToDelete.has(getEntity(row) ?? "")) {
          continue
        }

        deletedRows.push({ ...row })
        mutableRows.splice(index, 1)
      }

      return deletedRows
    },
    async upsert(input: readonly Partial<TEntity>[]) {
      const upsertedRows: TEntity[] = []

      for (const entry of input) {
        const entity = getEntity(entry)
        const existingRow = entity
          ? mutableRows.find((row) => getEntity(row) === entity)
          : undefined

        if (existingRow) {
          Object.assign(existingRow, entry)
          upsertedRows.push({ ...existingRow })
          continue
        }

        const row = createInternalServiceRow(entry, mutableRows.length)
        mutableRows.push(row)
        upsertedRows.push({ ...row })
      }

      return upsertedRows
    },
  }

  // IMedusaInternalService is broad; this SQLite fixture intentionally provides
  // only the clear/list/create/update/delete/upsert methods touched by Index
  // metadata, reset, and configuration-checker paths.
  return service as unknown as ModulesSdkTypes.IMedusaInternalService<TEntity> &
    SqliteMutableInternalService<TEntity>
}

function createInternalServiceRow<TEntity extends { id: string }>(
  input: Partial<TEntity>,
  index: number
): TEntity {
  const entity = getEntity(input)
  const base = {
    id: getId(input) ?? `sqlite_internal_${index + 1}`,
    status: "pending",
    updated_at: new Date("2026-01-05T00:00:00.000Z"),
    ...input,
  }

  if (entity) {
    return {
      ...base,
      entity,
    } as TEntity
  }

  return base as TEntity
}

function toArray<TEntity>(
  input: TEntity | readonly TEntity[]
): readonly TEntity[] {
  return Array.isArray(input) ? input : [input]
}

function toStringArray(value: string | string[]): string[] {
  return Array.isArray(value) ? value : [value]
}

function getId(value: object): string | undefined {
  return readStringProperty(value, "id")
}

function getEntity(value: object): string | undefined {
  return readStringProperty(value, "entity")
}

function readStringProperty(
  value: object,
  property: string
): string | undefined {
  if (!Object.prototype.hasOwnProperty.call(value, property)) {
    return undefined
  }

  const record = value as Record<string, unknown>
  return typeof record[property] === "string" ? record[property] : undefined
}

function readParam(
  params: readonly SqliteIndexValue[],
  index: number
): string {
  const value = params[index]

  if (typeof value !== "string") {
    throw new Error(`Expected SQLite parameter ${index} to be a string`)
  }

  return value
}

function normalizeSql(sql: string): string {
  return sql.replace(/\s+/g, " ").trim()
}

function matchesSelector<TEntity extends object>(
  row: TEntity,
  selector: Record<string, unknown>
): boolean {
  return Object.entries(selector).every(([key, condition]) => {
    const rowValue = row[key as keyof TEntity]

    if (Array.isArray(condition)) {
      return condition.some((entry) => Object.is(entry, rowValue))
    }

    if (isRecord(condition) && "$ne" in condition) {
      return !Object.is(rowValue, condition.$ne)
    }

    return Object.is(rowValue, condition)
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value))
}

function createNodeSqliteDatabase(): NodeSqliteDatabase {
  const { DatabaseSync } = require("node:sqlite") as {
    DatabaseSync: NodeSqliteConstructor
  }

  return new DatabaseSync(":memory:")
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

function readStringColumn(
  row: Record<string, SqliteIndexValue>,
  column: string
): string {
  const value = row[column]

  if (typeof value !== "string") {
    throw new Error(`Expected SQLite column ${column} to be a string`)
  }

  return value
}
