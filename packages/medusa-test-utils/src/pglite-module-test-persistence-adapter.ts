import { PGlite } from "@electric-sql/pglite"
import { asValue } from "@medusajs/framework/awilix"
import {
  BigNumber,
  flattenObjectToKeyValuePairs,
  FreeTextSearchFilterKeyPrefix,
  isPresent,
  loadModels,
  MathBN,
  MedusaError,
  normalizeImportPathWithSource,
  SoftDeletableFilterKey,
} from "@medusajs/framework/utils"
import type {
  BigNumberInput,
  CalculatedPriceSetDTO,
  Constructor,
  Context,
  DAL,
  ModulePersistenceModel,
  ModulePersistenceAdapter,
  ModulePersistenceEventSubscriber,
  ModulePersistenceMutationEventArgs,
  ModulePersistenceMutationService,
  PerformedActions,
  PriceListRuleDTO,
  PriceListStatus as PriceListStatusValue,
  PriceListType as PriceListTypeValue,
  PricingContext,
  PricingFilters,
  PricingRepositoryService,
  PricingRuleOperatorValues,
  RepositoryService,
  UpsertWithReplaceConfig,
} from "@medusajs/framework/types"
import {
  ModuleTestConnection,
  ModuleTestPersistenceAdapter,
  PrepareModuleTestDatabaseOptions,
} from "./module-test-persistence-adapter"
import * as fs from "fs"
import { ulid } from "ulid"

type PortableEntityLike = {
  name: string
  parse(): {
    tableName: string
    schema: Record<string, { parse(fieldName: string): PortableMemberMetadata }>
    cascades?: PGliteCascadeConfig
    indexes?: Array<{
      name?: string
      on: string[]
      unique?: boolean
      where?: unknown
    }>
    checks?: PortableCheckMetadata[]
  }
}

type PortableCheckMetadata =
  | ((columns: Record<string, string>) => string)
  | {
      name?: string
      expression?: string | ((columns: Record<string, string>) => string)
      property?: string
    }

type PortableMemberMetadata = {
  fieldName?: string
  name?: string
  type?: string
  mappedBy?: string
  entity?: unknown
  dataType?: {
    name: string
    options?: {
      prefix?: string
      searchable?: boolean
    }
  }
  nullable?: boolean
  primaryKey?: boolean
  computed?: boolean
  defaultValue?: unknown
  indexes?: Array<{
    name?: string
    type: string
  }>
  options?: {
    foreignKey?: boolean
    foreignKeyName?: string
    pivotEntity?: unknown
    pivotTable?: string
    joinColumn?: string
    inverseJoinColumn?: string
  }
  relationships?: unknown[]
}

type PGliteTable = {
  modelName: string
  name: string
  columns: PGliteColumn[]
  indexes: PGliteIndex[]
  checks: PGliteCheck[]
  relationships: PGliteRelationship[]
  cascades: PGliteCascadeConfig
}

type PGliteCheck = {
  name: string
  expression: string
}

type PGliteColumn = {
  name: string
  type: string
  dataType: string
  dataTypeOptions?: {
    prefix?: string
  }
  nullable: boolean
  primaryKey: boolean
  searchable?: boolean
  defaultValue?: unknown
}

type PGliteIndex = {
  name: string
  tableName: string
  columns: string[]
  unique: boolean
  where?: string
}

type PGliteRelationship = {
  name: string
  type: string
  mappedBy?: string
  targetModel: PortableEntityLike
  sourceModel: PortableEntityLike
  pivotModel?: PortableEntityLike
  pivotTableName?: string
  pivotSourceForeignKey?: string
  pivotTargetForeignKey?: string
  targetModelName: string
  targetTableName: string
  foreignKeyName: string
  nullable: boolean
}

type PGliteCascadeConfig = {
  delete?: string[]
  detach?: string[]
}

type PGliteRelationReplacementOptions = {
  allowSingleHasManyObject?: boolean
  preserveExistingHasManyRows?: boolean
  reusePreparedBelongsToTargets?: boolean
  skipEmptyHasManyRelations?: boolean
}

type PGliteRepositoryFilter =
  | string
  | string[]
  | Record<string, unknown>
  | Record<string, unknown>[]

type PGliteInventoryQuantityField = "reserved_quantity" | "stocked_quantity"

type PGliteInventoryQuantityRow = Partial<
  Record<PGliteInventoryQuantityField, unknown>
>

type PGlitePricingPriceRow = {
  id: string
  price_set_id: string
  amount: string
  min_quantity: string | null
  max_quantity: string | null
  currency_code: string
  price_list_id: string | null
  price_list_type: PriceListTypeValue | null
  price_list_rules_count: number
  rules_count: number
}

type PGlitePricingRuleRow = {
  price_id: string
  attribute: string
  value: string
  operator: PricingRuleOperatorValues
}

type PGlitePricingPriceListRow = {
  id: string
  type: PriceListTypeValue
  rules_count: number
}

type PGlitePricingPriceListRuleRow = {
  price_list_id: string
  attribute: string
  value: PriceListRuleDTO["value"]
}

type PGlitePricingContextEntry = [string, unknown]

const pgliteActivePriceListStatus = "active" satisfies PriceListStatusValue

type PGliteWhereContext = {
  schemaName: string
  table: PGliteTable
}

type PGliteManyToManyMapping = {
  pivotTable: PGliteTable
  targetTable: PGliteTable
  sourceForeignKey: string
  targetForeignKey: string
  targetPrimaryKey: string
}

type PGliteMutationEvent =
  | "afterCreate"
  | "afterUpdate"
  | "afterUpsert"
  | "afterDelete"

type PGliteMutationEventContext = Context & {
  __medusa_pglite_event_subscriber__?: ModulePersistenceEventSubscriber
  __medusa_pglite_suppress_mutation_events__?: boolean
}

type PGliteRawQueryResult = {
  rows: Record<string, unknown>[]
}

type PGliteKnexRaw = {
  raw(query: string, params?: unknown[]): Promise<PGliteRawQueryResult>
}

export interface PGliteModuleTestConnection extends ModuleTestConnection {
  client: PGlite
  schema: string
  models: PortableEntityLike[]
  transactionMode: "atomic"
  getKnex(): PGliteKnexRaw
  transaction<TResult>(
    task: (transactionManager: PGliteModuleTestConnection) => Promise<TResult>
  ): Promise<TResult>
}

export const pgliteModuleTestPersistenceAdapter: ModuleTestPersistenceAdapter =
  {
    name: "pglite",

    createDatabaseConfig({ dbName, schema, debug }) {
      return {
        clientUrl: `memory://${dbName}`,
        schema,
        debug,
      }
    },

    createConnection(dbConfig) {
      const client = new PGlite(dbConfig.clientUrl)
      let transactionQueue = Promise.resolve()
      let inTransaction = false

      // The PGlite client is attached below as a non-enumerable field so
      // Medusa module hashing does not traverse PGlite runtime internals.
      const connection: PGliteModuleTestConnection = {
        client,
        models: [],
        schema: dbConfig.schema,
        transactionMode: "atomic",
        async transaction(task) {
          if (inTransaction) {
            return await task(connection)
          }

          const queued = transactionQueue.then(async () => {
            await client.waitReady
            await client.exec("BEGIN")
            inTransaction = true
            try {
              const result = await task(connection)
              await client.exec("COMMIT")
              return result
            } catch (error) {
              await client.exec("ROLLBACK")
              throw error
            } finally {
              inTransaction = false
            }
          })

          transactionQueue = queued.then(
            () => undefined,
            () => undefined
          )

          return await queued
        },
        async destroy() {
          if (!client.closed) {
            await client.close()
          }
        },
        getKnex() {
          return {
            async raw(query: string, params: unknown[] = []) {
              return await client.query(
                replaceQuestionPlaceholders(query),
                params
              )
            },
          }
        },
      }

      Object.defineProperties(connection, {
        client: {
          value: client,
          enumerable: false,
        },
        models: {
          value: [],
          writable: true,
          enumerable: false,
        },
      })

      return connection
    },

    prepareDatabase(options) {
      const connection = assertPGliteConnection(options.connection)
      const schema = quoteIdentifier(options.dbConfig.schema)
      const models = discoverModuleModels(options)
      connection.models = models
      const setupSql = renderPGliteMigrationSql(options.dbConfig.schema, models)

      return {
        models,
        database: {
          async setupDatabase() {
            await connection.client.waitReady
            await connection.client.exec(setupSql)
          },

          async clearDatabase() {
            await connection.client.waitReady
            await connection.client.exec(
              `DROP SCHEMA IF EXISTS ${schema} CASCADE; CREATE SCHEMA IF NOT EXISTS ${schema}`
            )
          },
        },
      }
    },

    getInjectedDependencies(connection) {
      return {
        __pglite_connection__: assertPGliteConnection(connection),
      }
    },

    getModuleOptions(_dbConfig, moduleOptions, connection) {
      return {
        ...moduleOptions,
        manager: assertPGliteConnection(connection),
        persistenceAdapter: pgliteModulePersistenceAdapter,
      }
    },

    async cleanupConnection(connection) {
      await assertPGliteConnection(connection).destroy()
    },
  }

export const pgliteModulePersistenceAdapter: ModulePersistenceAdapter = {
  name: "pglite",

  prepareModels(models) {
    return models.map(assertPortableEntity)
  },

  createConnectionLoader() {
    return async function connectionLoader({ container, options }) {
      const manager = options && "manager" in options ? options.manager : null
      if (!isPGliteModuleTestConnection(manager)) {
        throw new Error(
          "The PGlite persistence adapter requires a PGlite manager"
        )
      }

      container.register({
        manager: asValue(manager),
      })
    }
  },

  createBaseRepository() {
    return asRepositoryConstructor(PGliteMedusaBaseRepository)
  },

  createRepository(model) {
    return asRepositoryConstructor(
      createPGliteMedusaRepository(assertPortableEntity(model))
    )
  },

  createCustomRepository({ model, moduleModels, repositoryName }) {
    if (repositoryName === "pricingRepository" && moduleModels) {
      return asRepositoryConstructor(
        createPGlitePricingRepository(moduleModels)
      )
    }

    if (model) {
      const portableModel = assertPortableEntity(model)
      if (portableModel.name === "InventoryLevel") {
        return asRepositoryConstructor(
          createPGliteInventoryLevelRepository(
            portableModel,
            createPGliteMedusaRepository(portableModel)
          )
        )
      }

      return this.createRepository(portableModel)
    }

    return undefined
  },

  createEventSubscriber(keys, service) {
    return createPGliteEventSubscriber(keys, service)
  },

  registerEventSubscriber(context, subscriber) {
    pgliteEventContext(context).__medusa_pglite_event_subscriber__ = subscriber
  },

  async dispatchMutationEvent(event, args, context, subscriber) {
    await dispatchPGliteMutationEvent(event, args, context, subscriber)
  },
}

export function isPGliteModuleTestConnection(
  connection: unknown
): connection is PGliteModuleTestConnection {
  return Boolean(
    connection &&
      typeof connection === "object" &&
      "client" in connection &&
      connection.client instanceof PGlite
  )
}

function assertPGliteConnection(
  connection: ModuleTestConnection
): PGliteModuleTestConnection {
  if (!isPGliteModuleTestConnection(connection)) {
    throw new Error("Expected a PGlite module test connection")
  }

  return connection
}

function replaceQuestionPlaceholders(query: string): string {
  let index = 0
  return query.replace(/\?/g, () => `$${++index}`)
}

function createPGliteEventSubscriber(
  keys: string[],
  service: ModulePersistenceMutationService
): ModulePersistenceEventSubscriber {
  const Subscriber = class {
    constructor(private readonly context: Context) {}

    afterCreate(args: ModulePersistenceMutationEventArgs): void {
      service.interceptEntityMutationEvents("afterCreate", args, this.context)
    }

    afterUpdate(args: ModulePersistenceMutationEventArgs): void {
      service.interceptEntityMutationEvents("afterUpdate", args, this.context)
    }

    afterUpsert(args: ModulePersistenceMutationEventArgs): void {
      service.interceptEntityMutationEvents("afterUpsert", args, this.context)
    }

    afterDelete(args: ModulePersistenceMutationEventArgs): void {
      service.interceptEntityMutationEvents("afterDelete", args, this.context)
    }
  }

  Object.defineProperty(Subscriber, "name", {
    value: keys.join(","),
    writable: false,
  })

  return Subscriber
}

function suppressPGliteMutationEvents(context: Context): Context {
  return {
    ...context,
    __medusa_pglite_suppress_mutation_events__: true,
  } as PGliteMutationEventContext
}

async function dispatchPGliteMutationRows(
  event: PGliteMutationEvent,
  modelName: string,
  rows: Record<string, unknown>[],
  context: Context
): Promise<void> {
  await Promise.all(
    rows.map((row) =>
      dispatchPGliteMutationEvent(
        event,
        {
          entity: row,
          meta: {
            className: modelName,
          },
        },
        context
      )
    )
  )
}

async function dispatchPGlitePerformedActions(
  performedActions: PerformedActions,
  context: Context
): Promise<void> {
  await Promise.all([
    dispatchPGliteActionEntities(
      "afterCreate",
      performedActions.created,
      context
    ),
    dispatchPGliteActionEntities(
      "afterUpdate",
      performedActions.updated,
      context
    ),
    dispatchPGliteActionEntities(
      "afterDelete",
      performedActions.deleted,
      context
    ),
  ])
}

async function dispatchPGliteCascadedUpdateRows(
  modelName: string,
  rows: Record<string, unknown>[],
  cascadedRows: Record<string, unknown[]>,
  context: Context,
  deletedAt: unknown,
  originalDeletedAt: unknown
): Promise<void> {
  const rowsByModel: Array<[string, unknown[]]> = [
    [modelName, rows],
    ...Object.entries(cascadedRows),
  ]

  await Promise.all(
    rowsByModel.flatMap(([currentModelName, currentRows]) =>
      currentRows.map((row) =>
        dispatchPGliteMutationEvent(
          "afterUpdate",
          {
            entity: isRecord(row)
              ? row
              : {
                  id: row,
                  deleted_at: deletedAt,
                },
            meta: {
              className: currentModelName,
            },
            changeSet: {
              entity: {
                deleted_at: deletedAt,
              },
              originalEntity: {
                deleted_at: originalDeletedAt,
              },
            },
          },
          context
        )
      )
    )
  )
}

async function dispatchPGliteActionEntities(
  event: PGliteMutationEvent,
  actions: Record<string, { id: string }[]>,
  context: Context
): Promise<void> {
  await Promise.all(
    Object.entries(actions).flatMap(([modelName, entities]) =>
      entities.map((entity) =>
        dispatchPGliteMutationEvent(
          event,
          {
            entity,
            meta: {
              className: modelName,
            },
          },
          context
        )
      )
    )
  )
}

async function dispatchPGliteMutationEvent(
  event: PGliteMutationEvent,
  args: ModulePersistenceMutationEventArgs,
  context: Context,
  subscriber?: ModulePersistenceEventSubscriber
): Promise<void> {
  const eventContext = pgliteEventContext(context)
  if (eventContext.__medusa_pglite_suppress_mutation_events__) {
    return
  }

  const Subscriber =
    subscriber ?? eventContext.__medusa_pglite_event_subscriber__
  if (!Subscriber) {
    return
  }

  await new Subscriber(context)[event]?.(args)
}

function pgliteEventContext(context: Context): PGliteMutationEventContext {
  return context as PGliteMutationEventContext
}

class PGliteMedusaBaseRepository {
  protected readonly manager_: PGliteModuleTestConnection

  constructor({ manager }: { manager: PGliteModuleTestConnection }) {
    this.manager_ = manager
  }

  getFreshManager<TManager = unknown>(): TManager {
    return this.manager_ as TManager
  }

  getActiveManager<TManager = unknown>(context: Context = {}): TManager {
    return (context.transactionManager ??
      context.manager ??
      this.manager_) as TManager
  }

  async transaction<TResult>(
    task: (transactionManager: PGliteModuleTestConnection) => Promise<TResult>
  ): Promise<TResult> {
    return await this.manager_.transaction(task)
  }

  async serialize<TOutput extends object | object[]>(
    data: TOutput
  ): Promise<TOutput> {
    return data
  }
}

function createPGliteMedusaRepository(model: PortableEntityLike) {
  const table = compilePGliteTable(model)
  const primaryKeys = table.columns
    .filter((column) => column.primaryKey)
    .map((column) => column.name)
  const primaryKeySet = new Set(primaryKeys)

  if (!primaryKeys.length) {
    throw new Error(`The PGlite repository requires ${model.name} primary keys`)
  }

  return class PGliteMedusaRepository extends PGliteMedusaBaseRepository {
    async find(
      findOptions: DAL.FindOptions<Record<string, unknown>> = { where: {} },
      context: Context = {}
    ): Promise<Record<string, unknown>[]> {
      const manager = this.getActiveManager<PGliteModuleTestConnection>(context)
      const relationNames = expandOwnedToOneRelationNames(
        table,
        expandRelationWildcards(
          table,
          relationNamesFromFindOptions(table, findOptions)
        )
      )
      const selectedColumns = selectColumns(
        table,
        findOptions.options?.fields,
        true,
        relationNames
      )
      const query = buildSelectQuery(
        manager.schema,
        table,
        selectedColumns,
        findOptions
      )
      const result = await manager.client.query<Record<string, unknown>>(
        query.sql,
        query.params
      )

      const rows = result.rows.map((row) => normalizeRow(table, row))
      rows.forEach((row) => initializeNullSourceRelations(table, row))
      await applyPGliteInventoryComputedFields(
        table,
        manager,
        rows,
        findOptions.options?.fields
      )
      await hydrateRelations(
        table,
        manager,
        rows,
        relationNames,
        shouldIncludeDeleted(findOptions),
        findOptions.options?.fields,
        findOptions.options?.orderBy,
        populateWhereFromOptions(findOptions.options)
      )

      return rows
    }

    async findAndCount(
      findOptions: DAL.FindOptions<Record<string, unknown>> = { where: {} },
      context: Context = {}
    ): Promise<[Record<string, unknown>[], number]> {
      const manager = this.getActiveManager<PGliteModuleTestConnection>(context)
      const rows = await this.find(findOptions, context)
      const countQuery = buildCountQuery(manager.schema, table, findOptions)
      const countResult = await manager.client.query<{
        count: string | number
      }>(countQuery.sql, countQuery.params)
      const count = Number(countResult.rows[0]?.count ?? 0)

      return [rows, count]
    }

    async upsert(
      data: Record<string, unknown>[],
      context: Context = {}
    ): Promise<Record<string, unknown>[]> {
      const manager = this.getActiveManager<PGliteModuleTestConnection>(context)
      const rows: Record<string, unknown>[] = []

      for (const entry of data) {
        const preparedEntry = await prepareMutationEntry(table, manager, entry)
        const scalarEntry = stripRelationshipData(table, preparedEntry)
        const [existingRow] = hasPrimaryKeyValues(scalarEntry, primaryKeys)
          ? await selectRowsByPrimaryKey(
              table,
              manager,
              scalarEntry,
              primaryKeys
            )
          : []
        const prepared = prepareMutationData(
          table,
          existingRow
            ? preserveRequiredPGliteUpsertColumns(
                table,
                scalarEntry,
                existingRow
              )
            : scalarEntry
        )
        const existing = Boolean(existingRow)
        const columns = table.columns.filter(
          (column) => prepared[column.name] !== undefined
        )
        const params = columns.map((column) =>
          toDriverValue(column, prepared[column.name])
        )
        const updateColumns = columns.filter(
          (column) => !primaryKeySet.has(column.name)
        )
        const conflictTarget = primaryKeys.map(quoteIdentifier).join(", ")
        const updateClause = updateColumns.length
          ? `DO UPDATE SET ${updateColumns
              .map(
                (column) =>
                  `${quoteIdentifier(column.name)} = EXCLUDED.${quoteIdentifier(
                    column.name
                  )}`
              )
              .join(", ")}`
          : "DO NOTHING"
        const sql = `INSERT INTO ${qualifiedName(
          manager.schema,
          table.name
        )} (${columns
          .map((column) => quoteIdentifier(column.name))
          .join(", ")}) VALUES (${params
          .map((_value, index) => `$${index + 1}`)
          .join(
            ", "
          )}) ON CONFLICT (${conflictTarget}) ${updateClause} RETURNING *`
        const result = await queryPGliteRows(table, manager, sql, params)
        const returned = result.rows[0]
        if (returned) {
          const row = normalizeRow(table, returned)
          initializeEmptyArrayRelations(table, row)
          const performedActions = emptyPerformedActions()
          await replaceConfiguredRelations(
            table,
            manager,
            row,
            preparedEntry,
            presentRelationshipNames(table, preparedEntry),
            performedActions,
            {
              reusePreparedBelongsToTargets: true,
            }
          )
          await dispatchPGliteMutationRows(
            existing ? "afterUpdate" : "afterCreate",
            model.name,
            [row],
            context
          )
          await dispatchPGlitePerformedActions(performedActions, context)
          rows.push(row)
        }
      }

      return rows
    }

    async create(
      data: Record<string, unknown>[],
      context: Context = {}
    ): Promise<Record<string, unknown>[]> {
      const manager = this.getActiveManager<PGliteModuleTestConnection>(context)
      const rows: Record<string, unknown>[] = []

      for (const entry of data) {
        const preparedEntry = await prepareMutationEntry(table, manager, entry)
        const prepared = prepareMutationData(
          table,
          stripRelationshipData(table, preparedEntry)
        )
        const columns = table.columns.filter(
          (column) => prepared[column.name] !== undefined
        )
        const params = columns.map((column) =>
          toDriverValue(column, prepared[column.name])
        )
        const sql = `INSERT INTO ${qualifiedName(
          manager.schema,
          table.name
        )} (${columns
          .map((column) => quoteIdentifier(column.name))
          .join(", ")}) VALUES (${params
          .map((_value, index) => `$${index + 1}`)
          .join(", ")}) RETURNING *`
        const result = await queryPGliteRows(table, manager, sql, params)
        const returned = result.rows[0]
        if (returned) {
          const row = normalizeRow(table, returned)
          initializeEmptyArrayRelations(table, row)
          const performedActions = emptyPerformedActions()
          await replaceConfiguredRelations(
            table,
            manager,
            row,
            preparedEntry,
            presentRelationshipNames(table, preparedEntry),
            performedActions,
            {
              allowSingleHasManyObject: true,
              preserveExistingHasManyRows: true,
              reusePreparedBelongsToTargets: true,
            }
          )
          await dispatchPGliteMutationRows(
            "afterCreate",
            model.name,
            [row],
            context
          )
          await dispatchPGlitePerformedActions(performedActions, context)
          rows.push(row)
        }
      }

      return rows
    }

    async update(
      data: Array<{
        entity: Record<string, unknown>
        update: Record<string, unknown>
      }>,
      context: Context = {}
    ): Promise<Record<string, unknown>[]> {
      const manager = this.getActiveManager<PGliteModuleTestConnection>(context)
      const rows: Record<string, unknown>[] = []

      for (const entry of data) {
        await validateSourceForeignKeyReferences(table, manager, entry.update)
        const shouldTouchUpdatedAt = table.columns.some(
          (column) =>
            !primaryKeySet.has(column.name) &&
            column.name !== "updated_at" &&
            entry.update[column.name] !== undefined
        )
        const update = prepareUpdateData(table, entry.update, {
          touchUpdatedAt: shouldTouchUpdatedAt,
        })
        const columns = table.columns.filter(
          (column) =>
            !primaryKeySet.has(column.name) && update[column.name] !== undefined
        )

        if (!columns.length) {
          const row = { ...entry.entity }
          const performedActions = emptyPerformedActions()
          await replaceConfiguredRelations(
            table,
            manager,
            row,
            entry.update,
            presentRelationshipNames(table, entry.update),
            performedActions,
            {
              skipEmptyHasManyRelations: true,
            }
          )
          await dispatchPGlitePerformedActions(performedActions, context)
          rows.push(row)
          continue
        }

        const params = columns.map((column) =>
          toDriverValue(column, update[column.name])
        )
        const where = primaryKeys
          .map((primaryKey) => {
            params.push(entry.entity[primaryKey])
            return `${quoteIdentifier(primaryKey)} = $${params.length}`
          })
          .join(" AND ")
        const sql = `UPDATE ${qualifiedName(
          manager.schema,
          table.name
        )} SET ${columns
          .map(
            (column, index) => `${quoteIdentifier(column.name)} = $${index + 1}`
          )
          .join(", ")} WHERE ${where} RETURNING *`
        const result = await queryPGliteRows(table, manager, sql, params)
        const returned = result.rows[0]
        if (returned) {
          const row = normalizeRow(table, returned)
          const performedActions = emptyPerformedActions()
          await replaceConfiguredRelations(
            table,
            manager,
            row,
            entry.update,
            presentRelationshipNames(table, entry.update),
            performedActions,
            {
              skipEmptyHasManyRelations: true,
            }
          )
          await dispatchPGliteMutationRows(
            "afterUpdate",
            model.name,
            [row],
            context
          )
          await dispatchPGlitePerformedActions(performedActions, context)
          rows.push(row)
        }
      }

      return rows
    }

    async delete(
      idsOrPKs: PGliteRepositoryFilter,
      context: Context = {}
    ): Promise<string[]> {
      const manager = this.getActiveManager<PGliteModuleTestConnection>(context)
      const whereInput = normalizeRepositoryFilter(idsOrPKs, primaryKeys)
      if (!whereInput) {
        return []
      }

      const params: unknown[] = []
      const clauses = buildWhereConditions(table, whereInput, params)

      if (!clauses.length) {
        return []
      }

      if (table.columns.some((column) => column.name === "deleted_at")) {
        clauses.push(`${quoteIdentifier("deleted_at")} IS NULL`)
      }

      const result = await manager.client.query<Record<string, unknown>>(
        `DELETE FROM ${qualifiedName(
          manager.schema,
          table.name
        )} WHERE ${clauses.join(" AND ")} RETURNING ${primaryKeys
          .map(quoteIdentifier)
          .join(", ")}`,
        params
      )

      const deletedIds = result.rows
        .map((row) => row[primaryKeys[0]])
        .filter((id) => id !== undefined && id !== null)
      await cascadeDeleteReferences(table, manager, deletedIds)

      return result.rows.map((row) => formatPrimaryKey(row, primaryKeys))
    }

    async softDelete(
      idsOrFilter: PGliteRepositoryFilter,
      context: Context = {}
    ): Promise<[Record<string, unknown>[], Record<string, unknown[]>]> {
      const deletedAt = new Date().toISOString()
      const result = await updateDeletedAt(
        table,
        this.getActiveManager<PGliteModuleTestConnection>(context),
        idsOrFilter,
        primaryKeys,
        deletedAt,
        false
      )
      await dispatchPGliteCascadedUpdateRows(
        model.name,
        result[0],
        result[1],
        context,
        deletedAt,
        null
      )
      return result
    }

    async restore(
      idsOrFilter: PGliteRepositoryFilter,
      context: Context = {}
    ): Promise<[Record<string, unknown>[], Record<string, unknown[]>]> {
      const originalDeletedAt = new Date().toISOString()
      const result = await updateDeletedAt(
        table,
        this.getActiveManager<PGliteModuleTestConnection>(context),
        idsOrFilter,
        primaryKeys,
        null,
        true
      )
      await dispatchPGliteCascadedUpdateRows(
        model.name,
        result[0],
        result[1],
        context,
        null,
        originalDeletedAt
      )
      return result
    }

    async upsertWithReplace(
      data: Record<string, unknown>[],
      config: UpsertWithReplaceConfig<Record<string, unknown>> = {
        relations: [],
      },
      context: Context = {}
    ): Promise<{
      entities: Record<string, unknown>[]
      performedActions: PerformedActions
    }> {
      const manager = this.getActiveManager<PGliteModuleTestConnection>(context)
      const performedActions = emptyPerformedActions()
      const entities: Record<string, unknown>[] = []

      for (const entry of data) {
        const scalarEntry = stripRelationshipData(table, entry)
        const [existing] = hasPrimaryKeyValues(scalarEntry, primaryKeys)
          ? await selectRowsByPrimaryKey(
              table,
              manager,
              scalarEntry,
              primaryKeys
            )
          : []

        if (existing) {
          const [updated] = await this.update(
            [
              {
                entity: existing,
                update: scalarEntry,
              },
            ],
            suppressPGliteMutationEvents(context)
          )

          if (updated) {
            await replaceConfiguredRelations(
              table,
              manager,
              updated,
              entry,
              config.relations ?? [],
              performedActions
            )
            entities.push(updated)
            performedActions.updated[model.name] ??= []
            performedActions.updated[model.name].push({
              id: formatPrimaryKey(updated, primaryKeys),
            })
          }
          continue
        }

        const [created] = await this.create(
          [scalarEntry],
          suppressPGliteMutationEvents(context)
        )
        if (created) {
          performedActions.created[model.name] ??= []
          performedActions.created[model.name].push({
            id: formatPrimaryKey(created, primaryKeys),
          })
          await replaceConfiguredRelations(
            table,
            manager,
            created,
            entry,
            config.relations ?? [],
            performedActions
          )
          entities.push(created)
        }
      }

      return {
        entities,
        performedActions,
      }
    }
  }
}

function createPGliteInventoryLevelRepository(
  model: PortableEntityLike,
  BaseRepository: ReturnType<typeof createPGliteMedusaRepository>
) {
  const table = compilePGliteTable(model)

  return class PGliteInventoryLevelRepository extends BaseRepository {
    async getReservedQuantity(
      inventoryItemId: string,
      locationIds: string[],
      context: Context = {}
    ): Promise<BigNumber> {
      return await this.sumQuantity(
        inventoryItemId,
        locationIds,
        "reserved_quantity",
        context
      )
    }

    async getAvailableQuantity(
      inventoryItemId: string,
      locationIds: string[],
      context: Context = {}
    ): Promise<BigNumber> {
      const rows = await selectInventoryLevelQuantities(
        this.getActiveManager<PGliteModuleTestConnection>(context),
        table,
        inventoryItemId,
        locationIds,
        ["stocked_quantity", "reserved_quantity"]
      )

      return new BigNumber(
        MathBN.sum(
          ...rows.map((row) =>
            MathBN.sub(
              quantityInput(row, "stocked_quantity"),
              quantityInput(row, "reserved_quantity")
            )
          )
        )
      )
    }

    async getStockedQuantity(
      inventoryItemId: string,
      locationIds: string[],
      context: Context = {}
    ): Promise<BigNumber> {
      return await this.sumQuantity(
        inventoryItemId,
        locationIds,
        "stocked_quantity",
        context
      )
    }

    private async sumQuantity(
      inventoryItemId: string,
      locationIds: string[],
      field: "reserved_quantity" | "stocked_quantity",
      context: Context
    ): Promise<BigNumber> {
      const rows = await selectInventoryLevelQuantities(
        this.getActiveManager<PGliteModuleTestConnection>(context),
        table,
        inventoryItemId,
        locationIds,
        [field]
      )

      return new BigNumber(
        MathBN.sum(...rows.map((row) => quantityInput(row, field)))
      )
    }
  }
}

function createPGlitePricingRepository(
  moduleModels: Record<string, ModulePersistenceModel>
) {
  const priceModel = moduleModels.Price
  if (!priceModel) {
    throw new Error("The PGlite Pricing repository requires the Price model")
  }

  const priceRuleModel = moduleModels.PriceRule
  if (!priceRuleModel) {
    throw new Error(
      "The PGlite Pricing repository requires the PriceRule model"
    )
  }

  const priceListModel = moduleModels.PriceList
  if (!priceListModel) {
    throw new Error(
      "The PGlite Pricing repository requires the PriceList model"
    )
  }

  const priceListRuleModel = moduleModels.PriceListRule
  if (!priceListRuleModel) {
    throw new Error(
      "The PGlite Pricing repository requires the PriceListRule model"
    )
  }

  const priceTable = compilePGliteTable(assertPortableEntity(priceModel))
  const priceRuleTable = compilePGliteTable(
    assertPortableEntity(priceRuleModel)
  )
  const priceListTable = compilePGliteTable(
    assertPortableEntity(priceListModel)
  )
  const priceListRuleTable = compilePGliteTable(
    assertPortableEntity(priceListRuleModel)
  )

  return class PGlitePricingRepository
    extends PGliteMedusaBaseRepository
    implements PricingRepositoryService
  {
    clearAvailableAttributes(): void {}

    async calculatePrices(
      pricingFilters: PricingFilters,
      pricingContext: PricingContext = { context: {} },
      sharedContext: Context = {}
    ): Promise<CalculatedPriceSetDTO[]> {
      const context: Record<string, unknown> = {
        ...(pricingContext.context ?? {}),
      }
      const quantity = context.quantity
      delete context.quantity

      const currencyCode = context.currency_code
      delete context.currency_code

      if (!currencyCode) {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          "Method calculatePrices requires currency_code in the pricing context"
        )
      }

      if (!pricingFilters.id.length) {
        return []
      }

      const manager =
        this.getActiveManager<PGliteModuleTestConnection>(sharedContext)
      const params: unknown[] = []
      const priceSetColumn = requiredPGliteColumn(priceTable, "price_set_id")
      const priceSetFilter = renderInCondition(
        priceSetColumn,
        pricingFilters.id,
        params,
        false
      )
      params.push(String(currencyCode))
      const currencyPlaceholder = `$${params.length}`
      const quantityFilter = renderPricingQuantityFilter(quantity, params)
      const tableName = qualifiedName(manager.schema, priceTable.name)

      const result = await manager.client.query<Record<string, unknown>>(
        `SELECT
          ${quoteIdentifier("id")},
          ${quoteIdentifier("price_set_id")},
          ${quoteIdentifier("amount")}::text AS ${quoteIdentifier("amount")},
          ${quoteIdentifier("min_quantity")}::text AS ${quoteIdentifier(
          "min_quantity"
        )},
          ${quoteIdentifier("max_quantity")}::text AS ${quoteIdentifier(
          "max_quantity"
        )},
          ${quoteIdentifier("currency_code")},
          ${quoteIdentifier("price_list_id")},
          COALESCE(${quoteIdentifier("rules_count")}, 0) AS ${quoteIdentifier(
          "rules_count"
        )}
        FROM ${tableName}
        WHERE ${priceSetFilter}
          AND ${quoteIdentifier("currency_code")} = ${currencyPlaceholder}
          AND ${quoteIdentifier("deleted_at")} IS NULL
          AND ${quantityFilter}`,
        params
      )

      const rawPrices = result.rows.map(toPGlitePricingPriceRow)
      const activePriceLists = await selectPGliteActivePriceLists(
        manager,
        priceListTable,
        rawPrices.flatMap((price) =>
          price.price_list_id ? [price.price_list_id] : []
        )
      )
      const priceListsById = new Map(
        activePriceLists.map((priceList) => [priceList.id, priceList])
      )
      const prices = rawPrices.flatMap((price) => {
        if (!price.price_list_id) {
          return [price]
        }

        const priceList = priceListsById.get(price.price_list_id)
        return priceList ? [withPGlitePriceList(price, priceList)] : []
      })
      const priceRules = await selectPGlitePricingRules(
        manager,
        priceRuleTable,
        prices.map((price) => price.id)
      )
      const rulesByPriceId = groupPGlitePricingRules(priceRules)
      const priceListRules = await selectPGlitePricingPriceListRules(
        manager,
        priceListRuleTable,
        activePriceLists.map((priceList) => priceList.id)
      )
      const rulesByPriceListId =
        groupPGlitePricingPriceListRules(priceListRules)
      const flattenedContext = Object.entries(
        flattenObjectToKeyValuePairs(context)
      ).filter(([, value]) => {
        const isValuePresent = !Array.isArray(value) && isPresent(value)
        const isArrayPresent = Array.isArray(value) && value.flat(1).length

        return isValuePresent || isArrayPresent
      })
      const hasComplexContext = flattenedContext.length > 0

      return prices
        .filter((price) =>
          matchesPGlitePricingCandidate(
            price,
            rulesByPriceId.get(price.id) ?? [],
            price.price_list_id
              ? rulesByPriceListId.get(price.price_list_id) ?? []
              : [],
            flattenedContext,
            hasComplexContext
          )
        )
        .sort(comparePGlitePricingPrices)
        .map(toPGliteCalculatedPriceSet)
    }
  }
}

async function selectPGliteActivePriceLists(
  manager: PGliteModuleTestConnection,
  table: PGliteTable,
  priceListIds: string[]
): Promise<PGlitePricingPriceListRow[]> {
  const uniquePriceListIds = [...new Set(priceListIds)]
  if (!uniquePriceListIds.length) {
    return []
  }

  const params: unknown[] = []
  const priceListIdFilter = renderInCondition(
    requiredPGliteColumn(table, "id"),
    uniquePriceListIds,
    params,
    false
  )
  params.push(pgliteActivePriceListStatus)
  const statusPlaceholder = `$${params.length}`
  const result = await manager.client.query<Record<string, unknown>>(
    `SELECT
      ${quoteIdentifier("id")},
      ${quoteIdentifier("type")},
      COALESCE(${quoteIdentifier("rules_count")}, 0) AS ${quoteIdentifier(
      "rules_count"
    )}
    FROM ${qualifiedName(manager.schema, table.name)}
    WHERE ${priceListIdFilter}
      AND ${quoteIdentifier("status")} = ${statusPlaceholder}
      AND ${quoteIdentifier("deleted_at")} IS NULL
      AND (${quoteIdentifier("starts_at")} IS NULL OR ${quoteIdentifier(
      "starts_at"
    )} <= CURRENT_TIMESTAMP)
      AND (${quoteIdentifier("ends_at")} IS NULL OR ${quoteIdentifier(
      "ends_at"
    )} >= CURRENT_TIMESTAMP)`,
    params
  )

  return result.rows.map((row) => ({
    id: requiredPGliteString(row, "id"),
    type: requiredPGlitePriceListType(row, "type"),
    rules_count: requiredPGliteNumber(row, "rules_count"),
  }))
}

function withPGlitePriceList(
  price: PGlitePricingPriceRow,
  priceList: PGlitePricingPriceListRow
): PGlitePricingPriceRow {
  return {
    ...price,
    price_list_type: priceList.type,
    price_list_rules_count: priceList.rules_count,
  }
}

async function selectPGlitePricingPriceListRules(
  manager: PGliteModuleTestConnection,
  table: PGliteTable,
  priceListIds: string[]
): Promise<PGlitePricingPriceListRuleRow[]> {
  if (!priceListIds.length) {
    return []
  }

  const params: unknown[] = []
  const priceListIdFilter = renderInCondition(
    requiredPGliteColumn(table, "price_list_id"),
    priceListIds,
    params,
    false
  )
  const result = await manager.client.query<Record<string, unknown>>(
    `SELECT
      ${quoteIdentifier("price_list_id")},
      ${quoteIdentifier("attribute")},
      ${quoteIdentifier("value")}
    FROM ${qualifiedName(manager.schema, table.name)}
    WHERE ${priceListIdFilter}
      AND ${quoteIdentifier("deleted_at")} IS NULL`,
    params
  )

  return result.rows.map((row) => ({
    price_list_id: requiredPGliteString(row, "price_list_id"),
    attribute: requiredPGliteString(row, "attribute"),
    value: requiredPGlitePriceListRuleValue(row, "value"),
  }))
}

function groupPGlitePricingPriceListRules(
  rules: PGlitePricingPriceListRuleRow[]
): Map<string, PGlitePricingPriceListRuleRow[]> {
  const grouped = new Map<string, PGlitePricingPriceListRuleRow[]>()

  for (const rule of rules) {
    const priceListRules = grouped.get(rule.price_list_id) ?? []
    priceListRules.push(rule)
    grouped.set(rule.price_list_id, priceListRules)
  }

  return grouped
}

async function selectPGlitePricingRules(
  manager: PGliteModuleTestConnection,
  table: PGliteTable,
  priceIds: string[]
): Promise<PGlitePricingRuleRow[]> {
  if (!priceIds.length) {
    return []
  }

  const params: unknown[] = []
  const priceIdFilter = renderInCondition(
    requiredPGliteColumn(table, "price_id"),
    priceIds,
    params,
    false
  )
  const result = await manager.client.query<Record<string, unknown>>(
    `SELECT
      ${quoteIdentifier("price_id")},
      ${quoteIdentifier("attribute")},
      ${quoteIdentifier("value")},
      ${quoteIdentifier("operator")}
    FROM ${qualifiedName(manager.schema, table.name)}
    WHERE ${priceIdFilter}
      AND ${quoteIdentifier("deleted_at")} IS NULL`,
    params
  )

  return result.rows.map((row) => ({
    price_id: requiredPGliteString(row, "price_id"),
    attribute: requiredPGliteString(row, "attribute"),
    value: requiredPGliteString(row, "value"),
    operator: requiredPGlitePricingRuleOperator(row, "operator"),
  }))
}

function groupPGlitePricingRules(
  rules: PGlitePricingRuleRow[]
): Map<string, PGlitePricingRuleRow[]> {
  const grouped = new Map<string, PGlitePricingRuleRow[]>()

  for (const rule of rules) {
    const priceRules = grouped.get(rule.price_id) ?? []
    priceRules.push(rule)
    grouped.set(rule.price_id, priceRules)
  }

  return grouped
}

function matchesPGlitePricingCandidate(
  price: PGlitePricingPriceRow,
  priceRules: PGlitePricingRuleRow[],
  priceListRules: PGlitePricingPriceListRuleRow[],
  context: PGlitePricingContextEntry[],
  hasComplexContext: boolean
): boolean {
  if (!price.price_list_id) {
    return matchesPGlitePricingRules(
      price,
      priceRules,
      context,
      hasComplexContext
    )
  }

  if (!price.price_list_type) {
    return false
  }

  if (!hasComplexContext) {
    return price.rules_count === 0 || price.price_list_rules_count === 0
  }

  return (
    matchesPGlitePricingRules(price, priceRules, context, true) &&
    matchesPGlitePricingPriceListRules(price, priceListRules, context)
  )
}

function matchesPGlitePricingRules(
  price: PGlitePricingPriceRow,
  rules: PGlitePricingRuleRow[],
  context: PGlitePricingContextEntry[],
  hasComplexContext: boolean
): boolean {
  if (!hasComplexContext) {
    return price.rules_count === 0
  }

  const matchedRules = rules.filter((rule) =>
    matchesPGlitePricingRule(rule, context)
  ).length

  return price.rules_count === 0 || matchedRules === price.rules_count
}

function matchesPGlitePricingPriceListRules(
  price: PGlitePricingPriceRow,
  rules: PGlitePricingPriceListRuleRow[],
  context: PGlitePricingContextEntry[]
): boolean {
  if (price.price_list_rules_count === 0) {
    return true
  }

  const matchedRules = rules.filter((rule) =>
    matchesPGlitePricingPriceListRule(rule, context)
  ).length

  return matchedRules === price.price_list_rules_count
}

function matchesPGlitePricingPriceListRule(
  rule: PGlitePricingPriceListRuleRow,
  context: PGlitePricingContextEntry[]
): boolean {
  const ruleValues = Array.isArray(rule.value) ? rule.value : [rule.value]

  return context.some(([attribute, value]) => {
    if (attribute !== rule.attribute) {
      return false
    }

    const contextValues = Array.isArray(value) ? value.flat(1) : [value]
    return contextValues.some((contextValue) =>
      ruleValues.some((ruleValue) => String(contextValue) === ruleValue)
    )
  })
}

function matchesPGlitePricingRule(
  rule: PGlitePricingRuleRow,
  context: PGlitePricingContextEntry[]
): boolean {
  return context.some(([attribute, value]) => {
    if (attribute !== rule.attribute) {
      return false
    }

    if (typeof value === "number") {
      const ruleValue = Number(rule.value)
      if (Number.isNaN(ruleValue)) {
        return false
      }

      switch (rule.operator) {
        case "gt":
          return value > ruleValue
        case "gte":
          return value >= ruleValue
        case "lt":
          return value < ruleValue
        case "lte":
          return value <= ruleValue
        default:
          return String(value) === rule.value
      }
    }

    const values = Array.isArray(value) ? value.flat(1) : [value]
    return values.some((entry) => String(entry) === rule.value)
  })
}

function comparePGlitePricingPrices(
  left: PGlitePricingPriceRow,
  right: PGlitePricingPriceRow
): number {
  const leftIsPriceList = left.price_list_id ? 1 : 0
  const rightIsPriceList = right.price_list_id ? 1 : 0
  if (leftIsPriceList !== rightIsPriceList) {
    return rightIsPriceList - leftIsPriceList
  }

  const leftRulesCount = left.rules_count + left.price_list_rules_count
  const rightRulesCount = right.rules_count + right.price_list_rules_count
  if (leftRulesCount !== rightRulesCount) {
    return rightRulesCount - leftRulesCount
  }

  if (MathBN.lt(left.amount, right.amount)) {
    return -1
  }

  if (MathBN.gt(left.amount, right.amount)) {
    return 1
  }

  return 0
}

function renderPricingQuantityFilter(
  quantity: unknown,
  params: unknown[]
): string {
  const minQuantity = quoteIdentifier("min_quantity")
  const maxQuantity = quoteIdentifier("max_quantity")

  if (quantity === undefined) {
    return `(${minQuantity} <= 1 OR ${minQuantity} IS NULL)`
  }

  if (!isPGliteBigNumberInput(quantity)) {
    throw new Error("Pricing quantity must be a BigNumber input")
  }

  const normalizedQuantity = new BigNumber(quantity)
  params.push(normalizedQuantity.raw?.value ?? normalizedQuantity.numeric)
  const placeholder = `$${params.length}`

  return `(
    (${minQuantity} <= ${placeholder} AND ${maxQuantity} >= ${placeholder})
    OR (${minQuantity} <= ${placeholder} AND ${maxQuantity} IS NULL)
    OR (${minQuantity} IS NULL AND ${maxQuantity} IS NULL)
    OR (${minQuantity} IS NULL AND ${maxQuantity} >= ${placeholder})
  )`
}

function toPGlitePricingPriceRow(
  row: Record<string, unknown>
): PGlitePricingPriceRow {
  return {
    id: requiredPGliteString(row, "id"),
    price_set_id: requiredPGliteString(row, "price_set_id"),
    amount: requiredPGliteString(row, "amount"),
    currency_code: requiredPGliteString(row, "currency_code"),
    min_quantity: nullablePGliteString(row.min_quantity),
    max_quantity: nullablePGliteString(row.max_quantity),
    price_list_id: nullablePGliteString(row.price_list_id),
    price_list_type: null,
    price_list_rules_count: 0,
    rules_count: requiredPGliteNumber(row, "rules_count"),
  }
}

function toPGliteCalculatedPriceSet(
  row: PGlitePricingPriceRow
): CalculatedPriceSetDTO {
  const amount = row.amount

  return {
    id: row.id,
    price_set_id: row.price_set_id,
    amount,
    raw_amount: {
      value: trimPGliteNumericString(amount),
      precision: 20,
    },
    currency_code: row.currency_code,
    min_quantity: row.min_quantity,
    max_quantity: row.max_quantity,
    price_list_type: row.price_list_type,
    price_list_id: row.price_list_id,
  }
}

function requiredPGliteColumn(
  table: PGliteTable,
  columnName: string
): PGliteColumn {
  const column = table.columns.find(
    (candidate) => candidate.name === columnName
  )
  if (!column) {
    throw new Error(
      `The PGlite ${table.modelName} table requires ${columnName}`
    )
  }

  return column
}

function requiredPGliteString(
  row: Record<string, unknown>,
  field: string
): string {
  const value = row[field]
  if (typeof value !== "string" && typeof value !== "number") {
    throw new Error(`Expected PGlite result field ${field}`)
  }

  return String(value)
}

function nullablePGliteString(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null
  }

  if (typeof value !== "string" && typeof value !== "number") {
    throw new Error("Expected a nullable PGlite string result")
  }

  return String(value)
}

function requiredPGliteNumber(
  row: Record<string, unknown>,
  field: string
): number {
  const value = row[field]
  if (typeof value === "number") {
    return value
  }

  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value)
    if (!Number.isNaN(parsed)) {
      return parsed
    }
  }

  throw new Error(`Expected PGlite numeric result field ${field}`)
}

function requiredPGlitePricingRuleOperator(
  row: Record<string, unknown>,
  field: string
): PricingRuleOperatorValues {
  const value = requiredPGliteString(row, field)

  switch (value) {
    case "eq":
    case "gt":
    case "gte":
    case "lt":
    case "lte":
      return value
    default:
      throw new Error(`Expected PGlite pricing rule operator field ${field}`)
  }
}

function requiredPGlitePriceListType(
  row: Record<string, unknown>,
  field: string
): PriceListTypeValue {
  const value = requiredPGliteString(row, field)

  switch (value) {
    case "sale":
    case "override":
      return value
    default:
      throw new Error(`Expected PGlite price list type field ${field}`)
  }
}

function requiredPGlitePriceListRuleValue(
  row: Record<string, unknown>,
  field: string
): PriceListRuleDTO["value"] {
  const rawValue = row[field]
  let value: unknown = rawValue

  if (typeof rawValue === "string") {
    const trimmed = rawValue.trim()
    if (trimmed.startsWith("[") || trimmed.startsWith('"')) {
      value = JSON.parse(trimmed)
    }
  }

  if (typeof value === "string") {
    return value
  }

  if (
    Array.isArray(value) &&
    value.every((entry) => typeof entry === "string")
  ) {
    return value
  }

  throw new Error(`Expected PGlite price list rule value field ${field}`)
}

function trimPGliteNumericString(value: string): string {
  if (!value.includes(".")) {
    return value
  }

  return value.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "")
}

async function selectInventoryLevelQuantities(
  manager: PGliteModuleTestConnection,
  table: PGliteTable,
  inventoryItemId: string,
  locationIds: string[],
  fields: PGliteInventoryQuantityField[]
): Promise<PGliteInventoryQuantityRow[]> {
  const inventoryItemColumn = requirePGliteColumn(table, "inventory_item_id")
  const locationColumn = requirePGliteColumn(table, "location_id")
  const params: unknown[] = [
    toDriverValue(inventoryItemColumn, inventoryItemId),
  ]
  const locationCondition = renderInCondition(
    locationColumn,
    locationIds,
    params,
    false
  )
  const deletedAt = table.columns.some((column) => column.name === "deleted_at")
    ? ` AND ${quoteIdentifier("deleted_at")} IS NULL`
    : ""

  const result = await manager.client.query<PGliteInventoryQuantityRow>(
    `SELECT ${fields
      .map((field) => quoteIdentifier(field))
      .join(", ")} FROM ${qualifiedName(
      manager.schema,
      table.name
    )} WHERE ${quoteIdentifier(
      "inventory_item_id"
    )} = $1 AND ${locationCondition}${deletedAt}`,
    params
  )

  return result.rows
}

async function applyPGliteInventoryComputedFields(
  table: PGliteTable,
  manager: PGliteModuleTestConnection,
  rows: Record<string, unknown>[],
  fields: string[] | undefined
): Promise<void> {
  if (!rows.length) {
    return
  }

  const hasExplicitFields = Boolean(fields?.length)
  const selectedFields = new Set(fields ?? [])

  if (table.modelName === "InventoryLevel") {
    if (!hasExplicitFields || selectedFields.has("available_quantity")) {
      for (const row of rows) {
        row.available_quantity = new BigNumber(
          MathBN.sub(
            quantityInput(row, "stocked_quantity"),
            quantityInput(row, "reserved_quantity")
          )
        ).numeric
      }
    }

    return
  }

  if (
    table.modelName !== "InventoryItem" ||
    !hasExplicitFields ||
    (!selectedFields.has("stocked_quantity") &&
      !selectedFields.has("reserved_quantity"))
  ) {
    return
  }

  const locationLevels = table.relationships.find(
    (relationship) => relationship.name === "location_levels"
  )
  if (!locationLevels || locationLevels.type !== "hasMany") {
    return
  }

  const sourcePrimaryKey = requireSinglePrimaryKey(table)
  const itemIds = rows
    .map((row) => row[sourcePrimaryKey])
    .filter((value): value is string => typeof value === "string")

  if (!itemIds.length) {
    return
  }

  const levelRows = await selectInventoryLevelQuantitiesForItems(
    manager,
    compilePGliteTable(locationLevels.targetModel),
    locationLevels.foreignKeyName,
    itemIds
  )
  const totalsByItemId = new Map<
    string,
    { stockedQuantity: BigNumber; reservedQuantity: BigNumber }
  >()

  for (const levelRow of levelRows) {
    const itemId = levelRow[locationLevels.foreignKeyName]
    if (typeof itemId !== "string") {
      continue
    }

    const current = totalsByItemId.get(itemId) ?? {
      stockedQuantity: new BigNumber(0),
      reservedQuantity: new BigNumber(0),
    }

    totalsByItemId.set(itemId, {
      stockedQuantity: new BigNumber(
        MathBN.sum(
          current.stockedQuantity,
          quantityInput(levelRow, "stocked_quantity")
        )
      ),
      reservedQuantity: new BigNumber(
        MathBN.sum(
          current.reservedQuantity,
          quantityInput(levelRow, "reserved_quantity")
        )
      ),
    })
  }

  for (const row of rows) {
    const itemId = row[sourcePrimaryKey]
    if (typeof itemId !== "string") {
      continue
    }

    const totals = totalsByItemId.get(itemId) ?? {
      stockedQuantity: new BigNumber(0),
      reservedQuantity: new BigNumber(0),
    }

    if (selectedFields.has("stocked_quantity")) {
      row.stocked_quantity = totals.stockedQuantity.numeric
    }
    if (selectedFields.has("reserved_quantity")) {
      row.reserved_quantity = totals.reservedQuantity.numeric
    }
  }
}

async function selectInventoryLevelQuantitiesForItems(
  manager: PGliteModuleTestConnection,
  table: PGliteTable,
  inventoryItemColumnName: string,
  itemIds: string[]
): Promise<(PGliteInventoryQuantityRow & Record<string, unknown>)[]> {
  const inventoryItemColumn = requirePGliteColumn(
    table,
    inventoryItemColumnName
  )
  const params: unknown[] = []
  const itemCondition = renderInCondition(
    inventoryItemColumn,
    itemIds,
    params,
    false
  )
  const deletedAt = table.columns.some((column) => column.name === "deleted_at")
    ? ` AND ${quoteIdentifier("deleted_at")} IS NULL`
    : ""

  const result = await manager.client.query<
    PGliteInventoryQuantityRow & Record<string, unknown>
  >(
    `SELECT ${[inventoryItemColumnName, "stocked_quantity", "reserved_quantity"]
      .map((field) => quoteIdentifier(field))
      .join(", ")} FROM ${qualifiedName(
      manager.schema,
      table.name
    )} WHERE ${itemCondition}${deletedAt}`,
    params
  )

  return result.rows
}

function quantityInput(
  row: PGliteInventoryQuantityRow,
  field: PGliteInventoryQuantityField
): BigNumberInput {
  const value = row[field]

  if (
    typeof value === "number" ||
    typeof value === "string" ||
    value instanceof BigNumber ||
    isBigNumberRawValue(value)
  ) {
    return value
  }

  return 0
}

function isBigNumberRawValue(value: unknown): value is { value: string } {
  return Boolean(
    value &&
      typeof value === "object" &&
      "value" in value &&
      typeof value.value === "string"
  )
}

function asRepositoryConstructor(
  repository: new (...args: never[]) => object
): Constructor<RepositoryService> {
  // Repository constructors cross Medusa's legacy broad DAL contract here.
  return repository as unknown as Constructor<RepositoryService>
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`
}

function formatPrimaryKey(
  row: Record<string, unknown>,
  primaryKeys: string[]
): string {
  if (primaryKeys.length === 1) {
    return String(row[primaryKeys[0]])
  }

  return primaryKeys.map((primaryKey) => String(row[primaryKey])).join(":")
}

function isRelationshipMetadata(
  metadata: PortableMemberMetadata
): metadata is PortableMemberMetadata & {
  name: string
  type: string
  entity: unknown
} {
  return Boolean(
    metadata.type &&
      metadata.name &&
      !metadata.dataType &&
      metadata.entity !== undefined
  )
}

function toPGliteRelationship(
  metadata: PortableMemberMetadata & {
    name: string
    type: string
    entity: unknown
  },
  sourceModel: PortableEntityLike
): PGliteRelationship {
  const targetModel = resolveRelationshipTarget(metadata.entity)
  const pivotModel =
    metadata.options?.pivotEntity === undefined
      ? undefined
      : resolveRelationshipTarget(metadata.options.pivotEntity)
  const pivotTableName = metadata.options?.pivotTable
  const pivotSourceForeignKey = metadata.options?.joinColumn
  const pivotTargetForeignKey = metadata.options?.inverseJoinColumn

  return {
    name: metadata.name,
    type: metadata.type,
    mappedBy: metadata.mappedBy,
    targetModel,
    sourceModel,
    pivotModel,
    pivotTableName,
    pivotSourceForeignKey,
    pivotTargetForeignKey,
    targetModelName: targetModel.name,
    targetTableName: toSnakeCase(targetModel.parse().tableName),
    foreignKeyName: relationshipForeignKeyName(
      metadata,
      targetModel,
      sourceModel
    ),
    nullable: metadata.nullable ?? false,
  }
}

function resolveRelationshipTarget(target: unknown): PortableEntityLike {
  const resolved = typeof target === "function" ? target() : target
  if (!isPortableEntityLike(resolved)) {
    throw new Error("The PGlite repository cannot resolve relationship target")
  }

  return resolved
}

function relationshipForeignKeyName(
  metadata: {
    name: string
    type: string
    mappedBy?: string
    options?: {
      foreignKeyName?: string
    }
  },
  targetModel: PortableEntityLike,
  sourceModel: PortableEntityLike
): string {
  if (metadata.options?.foreignKeyName) {
    return metadata.options.foreignKeyName
  }

  const ownerName =
    (metadata.type === "hasMany" || metadata.type === "hasOne") &&
    metadata.mappedBy
      ? metadata.mappedBy
      : metadata.type === "hasMany"
      ? inferHasManyOwnerName(metadata.name, targetModel, sourceModel)
      : metadata.name

  return toSnakeCase(`${ownerName}Id`)
}

function inferHasManyOwnerName(
  relationshipName: string,
  targetModel: PortableEntityLike,
  sourceModel: PortableEntityLike
): string {
  const targetSchema = targetModel.parse().schema

  for (const [fieldName, member] of Object.entries(targetSchema)) {
    const metadata = member.parse(fieldName)

    if (
      !isRelationshipMetadata(metadata) ||
      metadata.type !== "belongsTo" ||
      metadata.mappedBy !== relationshipName
    ) {
      continue
    }

    const ownerTarget = resolveRelationshipTarget(metadata.entity)
    if (samePortableModel(ownerTarget, sourceModel)) {
      return metadata.name
    }
  }

  return relationshipName
}

function samePortableModel(
  left: PortableEntityLike,
  right: PortableEntityLike
): boolean {
  return (
    left.name === right.name &&
    left.parse().tableName === right.parse().tableName
  )
}

function emptyPerformedActions(): PerformedActions {
  return {
    created: {},
    updated: {},
    deleted: {},
  }
}

function hasPrimaryKeyValues(
  entry: Record<string, unknown>,
  primaryKeys: string[]
): boolean {
  return primaryKeys.every(
    (primaryKey) =>
      entry[primaryKey] !== undefined && entry[primaryKey] !== null
  )
}

async function primaryKeyExists(
  table: PGliteTable,
  manager: PGliteModuleTestConnection,
  entry: Record<string, unknown>,
  primaryKeys: string[]
): Promise<boolean> {
  const params: unknown[] = []
  const where = primaryKeys
    .map((primaryKey) => {
      const column = table.columns.find((entry) => entry.name === primaryKey)
      if (!column) {
        throw new Error(
          `The PGlite table ${table.name} is missing ${primaryKey}`
        )
      }

      params.push(toDriverValue(column, entry[primaryKey]))
      return `${quoteIdentifier(primaryKey)} = $${params.length}`
    })
    .join(" AND ")

  const result = await manager.client.query<{ exists: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM ${qualifiedName(
      manager.schema,
      table.name
    )} WHERE ${where}) AS "exists"`,
    params
  )

  return Boolean(result.rows[0]?.exists)
}

async function queryPGliteRows(
  table: PGliteTable,
  manager: PGliteModuleTestConnection,
  sql: string,
  params: unknown[]
): Promise<{ rows: Record<string, unknown>[] }> {
  try {
    return await manager.client.query<Record<string, unknown>>(sql, params)
  } catch (error) {
    throw mapPGliteDatabaseError(table, error)
  }
}

function mapPGliteDatabaseError(table: PGliteTable, error: unknown): Error {
  if (!isRecord(error)) {
    return new Error(String(error))
  }

  if (error.code === "23514") {
    const mapped = new Error(
      typeof error.message === "string"
        ? error.message
        : "Check constraint violation"
    )
    mapped.name = "CheckConstraintViolationException"
    return mapped
  }

  if (error.code === "23505") {
    const constraintInfo = getPGliteConstraintInfo(table, error)
    if (constraintInfo) {
      return new Error(
        `${upperCaseFirst(
          constraintInfo.tableName.split("_").join(" ")
        )} with ${constraintInfo.keys
          .map(
            (key, index) =>
              `${key}: ${parsePGliteConstraintValue(
                constraintInfo.values[index]
              )}`
          )
          .join(", ")}, already exists.`
      )
    }
  }

  return error instanceof Error ? error : new Error(String(error.message))
}

function getPGliteConstraintInfo(
  table: PGliteTable,
  error: Record<string, unknown>
): { tableName: string; keys: string[]; values: string[] } | undefined {
  if (typeof error.detail !== "string") {
    return undefined
  }

  const [keys, values] = error.detail.match(/\([^\(]*\)/g) ?? []
  if (!keys || !values) {
    return undefined
  }

  return {
    tableName: typeof error.table === "string" ? error.table : table.name,
    keys: keys
      .substring(1, keys.length - 1)
      .split(",")
      .map((key) => key.trim()),
    values: values
      .substring(1, values.length - 1)
      .split(",")
      .map((value) => value.trim()),
  }
}

function parsePGliteConstraintValue(value: string): string {
  switch (value) {
    case "t":
      return "true"
    case "f":
      return "false"
    default:
      return value
  }
}

function upperCaseFirst(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

function stripRelationshipData(
  table: PGliteTable,
  entry: Record<string, unknown>
): Record<string, unknown> {
  const output = { ...entry }

  for (const relationship of table.relationships) {
    delete output[relationship.name]
  }

  return output
}

function withInheritedContextFields(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
  targetTable: PGliteTable
): Record<string, unknown> {
  const output = { ...target }
  const targetFields = new Set(
    targetTable.columns.map((column) => column.name)
  )
  const targetPrimaryKeys = new Set(getPrimaryKeys(targetTable))

  for (const [field, value] of Object.entries(source)) {
    if (
      targetPrimaryKeys.has(field) ||
      !(field === "version" || field.endsWith("_id")) ||
      !targetFields.has(field) ||
      output[field] !== undefined
    ) {
      continue
    }

    output[field] = value
  }

  return output
}

async function prepareMutationEntry(
  table: PGliteTable,
  manager: PGliteModuleTestConnection,
  entry: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const output = { ...entry }

  for (const relationship of table.relationships) {
    if (!ownsSourceForeignKey(relationship)) {
      continue
    }

    const relationValue = output[relationship.name]
    if (relationValue === undefined) {
      continue
    }

    output[relationship.foreignKeyName] = await resolveBelongsToForeignKeyValue(
      manager,
      relationship,
      relationValue
    )
  }

  await validateSourceForeignKeyReferences(table, manager, output)

  return output
}

async function validateSourceForeignKeyReferences(
  table: PGliteTable,
  manager: PGliteModuleTestConnection,
  entry: Record<string, unknown>
): Promise<void> {
  for (const relationship of table.relationships) {
    if (!ownsSourceForeignKey(relationship)) {
      continue
    }

    const foreignKeyValue = entry[relationship.foreignKeyName]
    if (foreignKeyValue === undefined || foreignKeyValue === null) {
      continue
    }

    await requireExistingRelationshipTarget(
      compilePGliteTable(relationship.targetModel),
      manager,
      foreignKeyValue,
      relationship.foreignKeyName
    )
  }
}

async function resolveBelongsToForeignKeyValue(
  manager: PGliteModuleTestConnection,
  relationship: PGliteRelationship,
  relationValue: unknown
): Promise<unknown> {
  if (relationValue === null) {
    return null
  }

  const targetTable = compilePGliteTable(relationship.targetModel)
  const targetPrimaryKeys = getPrimaryKeys(targetTable)
  const targetPrimaryKey = requireSinglePrimaryKey(targetTable)

  if (typeof relationValue === "string") {
    const target = await requireExistingRelationshipTarget(
      targetTable,
      manager,
      relationValue,
      relationship.foreignKeyName
    )
    return target[targetPrimaryKey]
  }

  if (!isRecord(relationValue)) {
    throw new Error(
      `The PGlite repository relation ${relationship.name} requires an object or primary key`
    )
  }

  const targetEntry = stripRelationshipData(
    targetTable,
    await prepareMutationEntry(targetTable, manager, relationValue)
  )
  if (hasOnlyPrimaryKeyValues(targetTable, targetEntry)) {
    const target = await requireExistingRelationshipTarget(
      targetTable,
      manager,
      targetEntry[targetPrimaryKey],
      relationship.foreignKeyName
    )
    return target[targetPrimaryKey]
  }

  const targetResult = await upsertBelongsToTargetRow(
    targetTable,
    manager,
    targetEntry,
    targetPrimaryKeys
  )

  return targetResult.row[targetPrimaryKey]
}

function initializeEmptyArrayRelations(
  table: PGliteTable,
  row: Record<string, unknown>
): void {
  for (const relationship of table.relationships) {
    if (relationship.type === "hasMany" || relationship.type === "manyToMany") {
      row[relationship.name] ??= []
    }
  }
}

function initializeNullSourceRelations(
  table: PGliteTable,
  row: Record<string, unknown>
): void {
  for (const relationship of table.relationships) {
    if (
      ownsSourceForeignKey(relationship) &&
      row[relationship.foreignKeyName] === null
    ) {
      row[relationship.name] = null
    }
  }
}

function normalizeRelationNames(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value.filter((entry): entry is string => typeof entry === "string")
}

function presentRelationshipNames(
  table: PGliteTable,
  entry: Record<string, unknown>
): string[] {
  return table.relationships
    .filter((relationship) => entry[relationship.name] !== undefined)
    .map((relationship) => relationship.name)
}

function relationNamesFromFindOptions(
  table: PGliteTable,
  findOptions: DAL.FindOptions<Record<string, unknown>>
): string[] {
  return relationNamesFromOptions(table, findOptions.options)
}

function relationNamesFromOptions(
  table: PGliteTable,
  options: DAL.FindOptions<Record<string, unknown>>["options"]
): string[] {
  if (!options) {
    return []
  }

  const relationOptions = options as DAL.FindOptions<
    Record<string, unknown>
  >["options"] & {
    relations?: unknown
  }

  return [
    ...normalizeRelationNames(relationOptions.populate),
    ...normalizeRelationNames(relationOptions.relations),
    ...relationNamesFromFieldPaths(table, options.fields),
  ].filter((entry, index, entries) => entries.indexOf(entry) === index)
}

function populateWhereFromOptions(
  options: DAL.FindOptions<Record<string, unknown>>["options"]
): unknown {
  const runtimeOptions = options as
    | (DAL.FindOptions<Record<string, unknown>>["options"] & {
        populateWhere?: unknown
      })
    | undefined

  return runtimeOptions?.populateWhere
}

function relationNamesFromFieldPaths(
  table: PGliteTable,
  fields: string[] | undefined
): string[] {
  if (!fields?.length) {
    return []
  }

  const relationNames = new Set<string>()
  for (const field of fields) {
    let currentTable = table
    const relationParts: string[] = []

    for (const part of field.split(".").filter(Boolean)) {
      const relationship = currentTable.relationships.find(
        (candidate) => candidate.name === part
      )
      if (!relationship) {
        break
      }

      relationParts.push(part)
      relationNames.add(relationParts.join("."))
      currentTable = compilePGliteTable(relationship.targetModel)
    }
  }

  return [...relationNames]
}

async function hydrateRelations(
  table: PGliteTable,
  manager: PGliteModuleTestConnection,
  rows: Record<string, unknown>[],
  relationNames: string[],
  includeDeleted: boolean,
  fields?: string[],
  orderBy?: unknown,
  populateWhere?: unknown
): Promise<void> {
  if (!rows.length || !relationNames.length) {
    return
  }

  const nestedRelationsByName = groupNestedRelations(
    expandRelationWildcards(table, relationNames)
  )

  for (const [relationName, nestedRelations] of nestedRelationsByName) {
    const relationship = table.relationships.find(
      (candidate) => candidate.name === relationName
    )
    if (!relationship) {
      continue
    }
    const relationFields = fieldsForRelation(fields, relationName)
    const relationOrderBy = orderByForRelation(orderBy, relationName)
    const relationPopulateWhere = populateWhereForRelation(
      populateWhere,
      relationName
    )

    if (relationship.type !== "hasMany") {
      if (ownsSourceForeignKey(relationship)) {
        await hydrateBelongsToRelation(
          table,
          manager,
          rows,
          relationship,
          includeDeleted
        )
      } else if (relationship.type === "hasOne") {
        await hydrateHasOneRelation(
          table,
          manager,
          rows,
          relationship,
          includeDeleted
        )
      } else if (relationship.type === "manyToMany") {
        await hydrateManyToManyRelation(
          table,
          manager,
          rows,
          relationship,
          includeDeleted
        )
      } else {
        throw new Error(
          `The PGlite repository only supports belongsTo, hasOne, hasMany, and manyToMany relation hydration for now`
        )
      }
    } else {
      await hydrateHasManyRelation(
        table,
        manager,
        rows,
        relationship,
        includeDeleted,
        relationOrderBy,
        relationPopulateWhere
      )
    }

    if (nestedRelations.length) {
      const targetRows = collectHydratedRelationRows(rows, relationName)
      await hydrateRelations(
        compilePGliteTable(relationship.targetModel),
        manager,
        targetRows,
        nestedRelations,
        includeDeleted,
        relationFields,
        relationOrderBy,
        relationPopulateWhere
      )
    }

    if (relationFields?.length) {
      projectHydratedRelationRows(
        rows,
        relationName,
        compilePGliteTable(relationship.targetModel),
        relationFields,
        nestedRelations
      )
    }
  }
}

function fieldsForRelation(
  fields: string[] | undefined,
  relationName: string
): string[] | undefined {
  if (!fields?.length) {
    return undefined
  }

  const prefix = `${relationName}.`
  const relationFields = fields
    .filter((field) => field.startsWith(prefix))
    .map((field) => field.slice(prefix.length))

  return relationFields.length ? relationFields : undefined
}

function populateWhereForRelation(
  populateWhere: unknown,
  relationName: string
): Record<string, unknown> | undefined {
  if (!isRecord(populateWhere)) {
    return undefined
  }

  const relationWhere = populateWhere[relationName]
  return isRecord(relationWhere) ? relationWhere : undefined
}

function orderByForRelation(
  orderBy: unknown,
  relationName: string
): Record<string, unknown>[] {
  return orderByEntries(orderBy).flatMap(([field, direction]) =>
    field === relationName && isRecord(direction) ? [direction] : []
  )
}

function projectHydratedRelationRows(
  rows: Record<string, unknown>[],
  relationName: string,
  targetTable: PGliteTable,
  fields: string[],
  nestedRelations: string[]
): void {
  if (fields.includes("*")) {
    return
  }

  const selectedFields = new Set(getPrimaryKeys(targetTable))
  const targetColumnNames = new Set(
    targetTable.columns.map((column) => column.name)
  )
  let selectWholeRelation = false

  for (const field of fields) {
    const parts = field.split(".").filter(Boolean)
    const [head] = parts
    if (!head) {
      continue
    }

    const relationship = targetTable.relationships.find(
      (candidate) => candidate.name === head
    )
    if (parts.length === 1) {
      selectedFields.add(head)
      selectWholeRelation ||= !targetColumnNames.has(head) && !relationship
      continue
    }

    if (relationship) {
      selectedFields.add(head)
      continue
    }

    const virtualField = parts[parts.length - 1]
    const scalarField =
      virtualField?.startsWith("raw_") &&
      targetColumnNames.has(virtualField.slice(4))
        ? virtualField.slice(4)
        : virtualField
    if (scalarField && targetColumnNames.has(scalarField)) {
      selectedFields.add(scalarField)
      if (virtualField) {
        selectedFields.add(virtualField)
      }
    }
  }
  if (selectWholeRelation) {
    targetColumnNames.forEach((field) => selectedFields.add(field))
  }
  for (const nestedRelation of nestedRelations) {
    const [head] = nestedRelation.split(".")
    const relationship = targetTable.relationships.find(
      (candidate) => candidate.name === head
    )
    if (!head || !relationship) {
      continue
    }

    selectedFields.add(head)
    if (ownsSourceForeignKey(relationship)) {
      selectedFields.add(relationship.foreignKeyName)
    }
  }

  for (const targetRow of collectHydratedRelationRows(rows, relationName)) {
    for (const key of Object.keys(targetRow)) {
      if (!selectedFields.has(key)) {
        delete targetRow[key]
      }
    }
  }
}

function groupNestedRelations(relationNames: string[]): Map<string, string[]> {
  const grouped = new Map<string, string[]>()

  for (const relationName of relationNames) {
    const [head, ...tail] = relationName.split(".")
    if (!head) {
      continue
    }

    const nested = grouped.get(head) ?? []
    if (tail.length) {
      nested.push(tail.join("."))
    }
    grouped.set(head, nested)
  }

  return grouped
}

function expandRelationWildcards(
  table: PGliteTable,
  relationNames: string[]
): string[] {
  return relationNames
    .flatMap((relationName) =>
      relationName === "*"
        ? table.relationships.map((relationship) => relationship.name)
        : [relationName]
    )
    .filter((entry, index, entries) => entries.indexOf(entry) === index)
}

function expandOwnedToOneRelationNames(
  table: PGliteTable,
  relationNames: string[]
): string[] {
  const expanded = new Set(relationNames)
  for (const relationName of relationNames) {
    expandOwnedToOneRelationPath(
      table,
      relationName.split(".").filter(Boolean),
      [],
      expanded
    )
  }

  return [...expanded]
}

function expandOwnedToOneRelationPath(
  table: PGliteTable,
  parts: string[],
  prefix: string[],
  expanded: Set<string>
): void {
  const [relationName, ...nestedParts] = parts
  if (!relationName) {
    return
  }

  const relationship = table.relationships.find(
    (candidate) => candidate.name === relationName
  )
  if (!relationship) {
    return
  }

  const nextPrefix = [...prefix, relationName]
  const targetTable = compilePGliteTable(relationship.targetModel)
  const ownedToOne = singularOwnedToOneRelationship(targetTable)
  if (ownedToOne) {
    const ownedTargetTable = compilePGliteTable(ownedToOne.targetModel)
    const [nestedRelationName] = nestedParts

    if (!nestedRelationName || nestedRelationName === "detail") {
      expanded.add([...nextPrefix, ownedToOne.name].join("."))
    } else if (
      !targetTable.relationships.some(
        (candidate) => candidate.name === nestedRelationName
      ) &&
      ownedTargetTable.relationships.some(
        (candidate) => candidate.name === nestedRelationName
      )
    ) {
      expanded.add(
        [...nextPrefix, ownedToOne.name, ...nestedParts].join(".")
      )
    }
  }

  if (nestedParts.length) {
    expandOwnedToOneRelationPath(
      targetTable,
      nestedParts,
      nextPrefix,
      expanded
    )
  }
}

function singularOwnedToOneRelationship(
  table: PGliteTable
): PGliteRelationship | undefined {
  const ownedToOne = table.relationships.filter(
    (relationship) => relationship.type === "hasOneWithFK"
  )

  return ownedToOne.length === 1 ? ownedToOne[0] : undefined
}

function versionedRelationSourceField(
  table: PGliteTable,
  relationship: PGliteRelationship
): "version" | "order_version" | undefined {
  const targetTable = compilePGliteTable(relationship.targetModel)
  if (!targetTable.columns.some((column) => column.name === "version")) {
    return undefined
  }

  if (
    table.modelName === "Order" &&
    ["items", "shipping_methods", "summary", "credit_lines"].includes(
      relationship.name
    )
  ) {
    return "version"
  }

  if (
    ["OrderExchange", "Return", "OrderClaim"].includes(table.modelName) &&
    relationship.name === "shipping_methods"
  ) {
    return "order_version"
  }

  return undefined
}

function collectHydratedRelationRows(
  rows: Record<string, unknown>[],
  relationName: string
): Record<string, unknown>[] {
  return rows.flatMap((row) => {
    const value = row[relationName]
    if (Array.isArray(value)) {
      return value.filter(isRecord)
    }

    return isRecord(value) ? [value] : []
  })
}

async function hydrateBelongsToRelation(
  table: PGliteTable,
  manager: PGliteModuleTestConnection,
  rows: Record<string, unknown>[],
  relationship: PGliteRelationship,
  includeDeleted: boolean
): Promise<void> {
  const foreignKeyColumn = table.columns.find(
    (column) => column.name === relationship.foreignKeyName
  )
  if (!foreignKeyColumn) {
    throw new Error(
      `The PGlite relation ${relationship.name} requires ${relationship.foreignKeyName}`
    )
  }

  const targetTable = compilePGliteTable(relationship.targetModel)
  const targetPrimaryKey = requireSinglePrimaryKey(targetTable)
  const targetPrimaryKeyColumn = targetTable.columns.find(
    (column) => column.name === targetPrimaryKey
  )
  if (!targetPrimaryKeyColumn) {
    throw new Error(
      `The PGlite relation ${relationship.name} requires ${targetPrimaryKey}`
    )
  }

  const foreignKeyValues = rows
    .map((row) => row[relationship.foreignKeyName])
    .filter((entry) => entry !== undefined && entry !== null)

  if (!foreignKeyValues.length) {
    rows.forEach((row) => {
      row[relationship.name] = null
    })
    return
  }

  const params: unknown[] = []
  const inCondition = renderInCondition(
    targetPrimaryKeyColumn,
    foreignKeyValues,
    params,
    false
  )
  const deletedAt =
    targetTable.columns.some((column) => column.name === "deleted_at") &&
    !includeDeleted
      ? ` AND ${quoteIdentifier("deleted_at")} IS NULL`
      : ""
  const result = await manager.client.query<Record<string, unknown>>(
    `SELECT ${targetTable.columns
      .map((column) => quoteIdentifier(column.name))
      .join(", ")} FROM ${qualifiedName(
      manager.schema,
      targetTable.name
    )} WHERE ${inCondition}${deletedAt}`,
    params
  )
  const targetsById = new Map<string, Record<string, unknown>>()

  for (const target of result.rows.map((row) =>
    normalizeRow(targetTable, row)
  )) {
    targetsById.set(String(target[targetPrimaryKey]), target)
  }

  for (const row of rows) {
    const foreignKeyValue = row[relationship.foreignKeyName]
    row[relationship.name] =
      foreignKeyValue === undefined || foreignKeyValue === null
        ? null
        : targetsById.get(String(foreignKeyValue)) ?? null
  }
}

async function hydrateHasManyRelation(
  table: PGliteTable,
  manager: PGliteModuleTestConnection,
  rows: Record<string, unknown>[],
  relationship: PGliteRelationship,
  includeDeleted: boolean,
  orderBy: Record<string, unknown>[],
  populateWhere?: Record<string, unknown>
): Promise<void> {
  const sourcePrimaryKey = requireSinglePrimaryKey(table)
  const parentIds = rows
    .map((row) => row[sourcePrimaryKey])
    .filter((entry) => entry !== undefined && entry !== null)

  if (!parentIds.length) {
    rows.forEach((row) => {
      row[relationship.name] = []
    })
    return
  }

  const targetTable = compilePGliteTable(relationship.targetModel)
  const foreignKeyColumn = targetTable.columns.find(
    (column) => column.name === relationship.foreignKeyName
  )
  if (!foreignKeyColumn) {
    throw new Error(
      `The PGlite relation ${relationship.name} requires ${relationship.foreignKeyName}`
    )
  }

  const params: unknown[] = []
  const inCondition = renderInCondition(
    foreignKeyColumn,
    parentIds,
    params,
    false
  )
  const deletedAt =
    targetTable.columns.some((column) => column.name === "deleted_at") &&
    !includeDeleted
      ? ` AND ${quoteIdentifier("deleted_at")} IS NULL`
      : ""
  const populateConditions = populateWhere
    ? buildWhereConditions(targetTable, populateWhere, params, {
        schemaName: manager.schema,
        table: targetTable,
      })
    : []
  const populateClause = populateConditions.length
    ? ` AND ${populateConditions
        .map((condition) => `(${condition})`)
        .join(" AND ")}`
    : ""
  const relationOrderBy = renderHydratedRelationOrderBy(targetTable, orderBy)
  const result = await manager.client.query<Record<string, unknown>>(
    `SELECT ${targetTable.columns
      .map((column) => quoteIdentifier(column.name))
      .join(", ")} FROM ${qualifiedName(
      manager.schema,
      targetTable.name
    )} WHERE ${inCondition}${deletedAt}${populateClause}${relationOrderBy}`,
    params
  )
  const children = result.rows.map((row) => normalizeRow(targetTable, row))
  const childrenByParentId = new Map<string, Record<string, unknown>[]>()

  for (const child of children) {
    const parentId = String(child[relationship.foreignKeyName])
    const group = childrenByParentId.get(parentId) ?? []
    group.push(child)
    childrenByParentId.set(parentId, group)
  }

  const versionSourceField = versionedRelationSourceField(table, relationship)
  for (const row of rows) {
    const childrenForParent =
      childrenByParentId.get(String(row[sourcePrimaryKey])) ?? []
    const relationVersion = versionSourceField
      ? row[versionSourceField]
      : undefined
    row[relationship.name] =
      relationVersion === undefined
        ? childrenForParent
        : childrenForParent.filter(
            (child) => child.version === relationVersion
          )
  }
}

async function hydrateHasOneRelation(
  table: PGliteTable,
  manager: PGliteModuleTestConnection,
  rows: Record<string, unknown>[],
  relationship: PGliteRelationship,
  includeDeleted: boolean
): Promise<void> {
  const sourcePrimaryKey = requireSinglePrimaryKey(table)
  const parentIds = rows
    .map((row) => row[sourcePrimaryKey])
    .filter((entry) => entry !== undefined && entry !== null)

  if (!parentIds.length) {
    rows.forEach((row) => {
      row[relationship.name] = null
    })
    return
  }

  const targetTable = compilePGliteTable(relationship.targetModel)
  const foreignKeyColumn = requirePGliteColumn(
    targetTable,
    relationship.foreignKeyName
  )
  const params: unknown[] = []
  const inCondition = renderInCondition(
    foreignKeyColumn,
    parentIds,
    params,
    false
  )
  const deletedAt =
    targetTable.columns.some((column) => column.name === "deleted_at") &&
    !includeDeleted
      ? ` AND ${quoteIdentifier("deleted_at")} IS NULL`
      : ""
  const result = await manager.client.query<Record<string, unknown>>(
    `SELECT ${targetTable.columns
      .map((column) => quoteIdentifier(column.name))
      .join(", ")} FROM ${qualifiedName(
      manager.schema,
      targetTable.name
    )} WHERE ${inCondition}${deletedAt}`,
    params
  )
  const targets = result.rows.map((row) => normalizeRow(targetTable, row))
  const targetByParentId = new Map<string, Record<string, unknown>>()

  for (const target of targets) {
    const parentId = target[relationship.foreignKeyName]
    if (parentId !== undefined && parentId !== null) {
      targetByParentId.set(String(parentId), target)
    }
  }

  for (const row of rows) {
    row[relationship.name] =
      targetByParentId.get(String(row[sourcePrimaryKey])) ?? null
  }
}

async function hydrateManyToManyRelation(
  table: PGliteTable,
  manager: PGliteModuleTestConnection,
  rows: Record<string, unknown>[],
  relationship: PGliteRelationship,
  includeDeleted: boolean
): Promise<void> {
  const sourcePrimaryKey = requireSinglePrimaryKey(table)
  const sourceIds = rows
    .map((row) => row[sourcePrimaryKey])
    .filter((entry) => entry !== undefined && entry !== null)

  if (!sourceIds.length) {
    rows.forEach((row) => {
      row[relationship.name] = []
    })
    return
  }

  const mapping = resolveManyToManyMapping(relationship)
  const sourceForeignKeyColumn = mapping.pivotTable.columns.find(
    (column) => column.name === mapping.sourceForeignKey
  )
  if (!sourceForeignKeyColumn) {
    throw new Error(
      `The PGlite manyToMany relation ${relationship.name} requires ${mapping.sourceForeignKey}`
    )
  }

  const params: unknown[] = []
  const inCondition = renderInCondition(
    sourceForeignKeyColumn,
    sourceIds,
    params,
    false,
    "pivot"
  )
  const targetDeletedAt =
    mapping.targetTable.columns.some(
      (column) => column.name === "deleted_at"
    ) && !includeDeleted
      ? ` AND target.${quoteIdentifier("deleted_at")} IS NULL`
      : ""
  const targetColumns = mapping.targetTable.columns
    .map((column) => `target.${quoteIdentifier(column.name)}`)
    .join(", ")

  const result = await manager.client.query<Record<string, unknown>>(
    `SELECT pivot.${quoteIdentifier(
      mapping.sourceForeignKey
    )} AS "__source_id", ${targetColumns} FROM ${qualifiedName(
      manager.schema,
      mapping.pivotTable.name
    )} AS pivot JOIN ${qualifiedName(
      manager.schema,
      mapping.targetTable.name
    )} AS target ON target.${quoteIdentifier(
      mapping.targetPrimaryKey
    )} = pivot.${quoteIdentifier(
      mapping.targetForeignKey
    )} WHERE ${inCondition}${targetDeletedAt}`,
    params
  )
  const relatedBySourceId = new Map<string, Record<string, unknown>[]>()

  for (const resultRow of result.rows) {
    const sourceId = String(resultRow.__source_id)
    const targetRow = { ...resultRow }
    delete targetRow.__source_id
    const group = relatedBySourceId.get(sourceId) ?? []
    group.push(normalizeRow(mapping.targetTable, targetRow))
    relatedBySourceId.set(sourceId, group)
  }

  for (const row of rows) {
    row[relationship.name] =
      relatedBySourceId.get(String(row[sourcePrimaryKey])) ?? []
  }
}

function resolveManyToManyMapping(
  relationship: PGliteRelationship
): PGliteManyToManyMapping {
  if (relationship.pivotModel) {
    const pivotTable = compilePGliteTable(relationship.pivotModel)
    const targetTable = compilePGliteTable(relationship.targetModel)
    const sourceRelation = findBelongsToRelationToModel(
      pivotTable,
      relationship.sourceModel
    )
    const targetRelation = findBelongsToRelationToModel(
      pivotTable,
      relationship.targetModel
    )

    if (!sourceRelation || !targetRelation) {
      throw new Error(
        `The PGlite manyToMany relation ${relationship.name} cannot resolve pivot foreign keys`
      )
    }

    return {
      pivotTable,
      targetTable,
      sourceForeignKey: sourceRelation.foreignKeyName,
      targetForeignKey: targetRelation.foreignKeyName,
      targetPrimaryKey: requireSinglePrimaryKey(targetTable),
    }
  }

  if (relationship.pivotTableName) {
    const pivotTable = compileImplicitManyToManyPivotTable(relationship)
    const targetTable = compilePGliteTable(relationship.targetModel)
    const [sourceForeignKey, targetForeignKey] = pivotTable.columns.map(
      (column) => column.name
    )

    if (!sourceForeignKey || !targetForeignKey) {
      throw new Error(
        `The PGlite manyToMany relation ${relationship.name} cannot resolve pivot foreign keys`
      )
    }

    return {
      pivotTable,
      targetTable,
      sourceForeignKey,
      targetForeignKey,
      targetPrimaryKey: requireSinglePrimaryKey(targetTable),
    }
  }

  const ownerRelationship = compilePGliteTable(
    relationship.targetModel
  ).relationships.find(
    (candidate) =>
      candidate.name === relationship.mappedBy &&
      candidate.type === "manyToMany" &&
      candidate.pivotTableName
  )

  if (!ownerRelationship) {
    throw new Error(
      `The PGlite manyToMany relation ${relationship.name} requires a pivotEntity or pivotTable`
    )
  }

  const ownerMapping = resolveManyToManyMapping(ownerRelationship)

  return {
    pivotTable: ownerMapping.pivotTable,
    targetTable: compilePGliteTable(relationship.targetModel),
    sourceForeignKey: ownerMapping.targetForeignKey,
    targetForeignKey: ownerMapping.sourceForeignKey,
    targetPrimaryKey: requireSinglePrimaryKey(
      compilePGliteTable(relationship.targetModel)
    ),
  }
}

function findBelongsToRelationToModel(
  table: PGliteTable,
  model: PortableEntityLike
): PGliteRelationship | undefined {
  return table.relationships.find(
    (relationship) =>
      relationship.type === "belongsTo" &&
      samePortableModel(relationship.targetModel, model)
  )
}

async function replaceConfiguredRelations(
  table: PGliteTable,
  manager: PGliteModuleTestConnection,
  entity: Record<string, unknown>,
  source: Record<string, unknown>,
  relationNames: string[],
  performedActions: PerformedActions,
  options: PGliteRelationReplacementOptions = {}
): Promise<void> {
  for (const relationName of relationNames) {
    const relationValue = source[relationName]
    if (relationValue === undefined) {
      continue
    }

    const relationship = table.relationships.find(
      (candidate) => candidate.name === relationName
    )
    if (!relationship) {
      throw new Error(
        `The PGlite repository cannot replace unknown relation ${relationName}`
      )
    }

    if (ownsSourceForeignKey(relationship)) {
      await replaceBelongsToRelation(
        table,
        manager,
        entity,
        relationship,
        relationName,
        relationValue,
        performedActions,
        options
      )
      continue
    }

    if (relationship.type === "manyToMany") {
      await replaceManyToManyRelation(
        table,
        manager,
        entity,
        relationship,
        relationName,
        relationValue,
        performedActions,
        options
      )
      continue
    }

    if (relationship.type !== "hasMany") {
      throw new Error(
        `The PGlite repository only supports source-owned foreign key and hasMany upsertWithReplace relations for now`
      )
    }

    const relationTargets = Array.isArray(relationValue)
      ? relationValue
      : options.allowSingleHasManyObject && isRecord(relationValue)
        ? [relationValue]
        : undefined
    if (!relationTargets) {
      throw new Error(
        `The PGlite repository relation ${relationName} must be an array`
      )
    }

    if (
      relationTargets.length === 0 &&
      options.skipEmptyHasManyRelations === true
    ) {
      continue
    }

    const sourcePrimaryKey = requireSinglePrimaryKey(table)
    const sourcePrimaryKeyValue = entity[sourcePrimaryKey]
    if (sourcePrimaryKeyValue === undefined || sourcePrimaryKeyValue === null) {
      throw new Error(
        `The PGlite repository relation ${relationName} requires a parent primary key`
      )
    }

    const targetTable = compilePGliteTable(relationship.targetModel)
    if (
      !targetTable.columns.some(
        (column) => column.name === relationship.foreignKeyName
      )
    ) {
      throw new Error(
        `The PGlite repository relation ${relationName} requires ${relationship.foreignKeyName}`
      )
    }

    const targetPrimaryKey = requireSinglePrimaryKey(targetTable)
    const targetPrimaryKeys = getPrimaryKeys(targetTable)
    const existingRows = await selectRowsByForeignKey(
      targetTable,
      manager,
      relationship.foreignKeyName,
      sourcePrimaryKeyValue
    )
    const existingIds = new Set(
      existingRows.map((row) => formatPrimaryKey(row, targetPrimaryKeys))
    )
    const existingRowsById = new Map(
      existingRows.map((row) => [formatPrimaryKey(row, targetPrimaryKeys), row])
    )
    const retainedIds = new Set<string>()

    for (const child of relationTargets) {
      if (!isRecord(child)) {
        throw new Error(
          `The PGlite repository relation ${relationName} requires child objects`
        )
      }

      const childPrimaryKeyValue = child[targetPrimaryKey]
      if (childPrimaryKeyValue === undefined || childPrimaryKeyValue === null) {
        continue
      }

      const childId = formatPrimaryKey(
        { [targetPrimaryKey]: childPrimaryKeyValue },
        targetPrimaryKeys
      )
      if (existingIds.has(childId)) {
        retainedIds.add(childId)
      }
    }

    const rowsToDelete = options.preserveExistingHasManyRows
      ? []
      : existingRows.filter(
          (row) => !retainedIds.has(formatPrimaryKey(row, targetPrimaryKeys))
        )
    await deleteConfiguredCascadeRows(
      targetTable,
      manager,
      rowsToDelete,
      performedActions
    )
    const deleted = await deleteRowsByPrimaryKeyValues(
      targetTable,
      manager,
      rowsToDelete.map((row) => row[targetPrimaryKey])
    )
    if (deleted.length) {
      performedActions.deleted[targetTable.modelName] ??= []
      performedActions.deleted[targetTable.modelName].push(...deleted)
    }

    const createdRows: Record<string, unknown>[] = []
    for (const child of relationTargets) {
      if (!isRecord(child)) {
        throw new Error(
          `The PGlite repository relation ${relationName} requires child objects`
        )
      }

      const preparedChild = options.reusePreparedBelongsToTargets
        ? await prepareMutationEntry(targetTable, manager, child)
        : child
      const childEntry = {
        ...withInheritedContextFields(
          stripRelationshipData(targetTable, preparedChild),
          entity,
          targetTable
        ),
        [relationship.foreignKeyName]: sourcePrimaryKeyValue,
      }
      const childPrimaryKeyValue = childEntry[targetPrimaryKey]
      const childId =
        childPrimaryKeyValue === undefined || childPrimaryKeyValue === null
          ? undefined
          : formatPrimaryKey(
              { [targetPrimaryKey]: childPrimaryKeyValue },
              targetPrimaryKeys
            )

      if (childId && existingIds.has(childId)) {
        const existingRow = existingRowsById.get(childId)
        if (
          existingRow &&
          !hasPGliteRowChanges(targetTable, existingRow, childEntry)
        ) {
          await replaceNestedConfiguredRelations(
            targetTable,
            manager,
            existingRow,
            preparedChild,
            performedActions,
            options
          )
          createdRows.push(existingRow)
          continue
        }

        const updated = await updatePGliteRowByPrimaryKey(
          targetTable,
          manager,
          targetPrimaryKey,
          childPrimaryKeyValue,
          childEntry
        )
        createdRows.push(updated)
        performedActions.updated[targetTable.modelName] ??= []
        performedActions.updated[targetTable.modelName].push({
          id: formatPrimaryKey(updated, targetPrimaryKeys),
        })
        await replaceNestedConfiguredRelations(
          targetTable,
          manager,
          updated,
          preparedChild,
          performedActions,
          options
        )
        continue
      }

      if (childId) {
        const [existingTarget] = await selectRowsByPrimaryKey(
          targetTable,
          manager,
          { [targetPrimaryKey]: childPrimaryKeyValue },
          targetPrimaryKeys
        )
        if (existingTarget) {
          const reassigned = hasPGliteRowChanges(
            targetTable,
            existingTarget,
            childEntry
          )
            ? await updatePGliteRowByPrimaryKey(
                targetTable,
                manager,
                targetPrimaryKey,
                childPrimaryKeyValue,
                childEntry
              )
            : existingTarget
          createdRows.push(reassigned)
          if (reassigned !== existingTarget) {
            performedActions.updated[targetTable.modelName] ??= []
            performedActions.updated[targetTable.modelName].push({
              id: formatPrimaryKey(reassigned, targetPrimaryKeys),
            })
          }
          await replaceNestedConfiguredRelations(
            targetTable,
            manager,
            reassigned,
            preparedChild,
            performedActions,
            options
          )
          continue
        }
      }

      const created = await insertPGliteRow(targetTable, manager, childEntry)
      createdRows.push(created)
      performedActions.created[targetTable.modelName] ??= []
      performedActions.created[targetTable.modelName].push({
        id: formatPrimaryKey(created, targetPrimaryKeys),
      })
      await replaceNestedConfiguredRelations(
        targetTable,
        manager,
        created,
        preparedChild,
        performedActions,
        options
      )
    }

    entity[relationship.name] = createdRows
  }
}

async function replaceManyToManyRelation(
  table: PGliteTable,
  manager: PGliteModuleTestConnection,
  entity: Record<string, unknown>,
  relationship: PGliteRelationship,
  relationName: string,
  relationValue: unknown,
  performedActions: PerformedActions,
  options: PGliteRelationReplacementOptions
): Promise<void> {
  if (!Array.isArray(relationValue)) {
    throw new Error(
      `The PGlite repository relation ${relationName} must be an array`
    )
  }

  const sourcePrimaryKey = requireSinglePrimaryKey(table)
  const sourcePrimaryKeyValue = entity[sourcePrimaryKey]
  if (sourcePrimaryKeyValue === undefined || sourcePrimaryKeyValue === null) {
    throw new Error(
      `The PGlite repository relation ${relationName} requires a parent primary key`
    )
  }

  const mapping = resolveManyToManyMapping(relationship)
  const sourceForeignKeyColumn = requirePGliteColumn(
    mapping.pivotTable,
    mapping.sourceForeignKey
  )
  const targetForeignKeyColumn = requirePGliteColumn(
    mapping.pivotTable,
    mapping.targetForeignKey
  )
  const targetPrimaryKeys = getPrimaryKeys(mapping.targetTable)
  const relatedRows: Record<string, unknown>[] = []
  const relatedIds = new Set<string>()

  for (const relatedValue of relationValue) {
    const related = await resolveManyToManyTarget(
      mapping.targetTable,
      manager,
      relatedValue,
      performedActions,
      options
    )
    const relatedPrimaryKeyValue = related[mapping.targetPrimaryKey]
    if (
      relatedPrimaryKeyValue === undefined ||
      relatedPrimaryKeyValue === null
    ) {
      throw new Error(
        `The PGlite repository relation ${relationName} requires a target primary key`
      )
    }

    const relatedId = formatPrimaryKey(related, targetPrimaryKeys)
    if (relatedIds.has(relatedId)) {
      continue
    }

    relatedIds.add(relatedId)
    relatedRows.push(related)
  }

  await deleteRowsByForeignKey(
    mapping.pivotTable,
    manager,
    mapping.sourceForeignKey,
    sourcePrimaryKeyValue
  )

  for (const related of relatedRows) {
    await insertPGliteRow(mapping.pivotTable, manager, {
      [mapping.sourceForeignKey]: toDriverValue(
        sourceForeignKeyColumn,
        sourcePrimaryKeyValue
      ),
      [mapping.targetForeignKey]: toDriverValue(
        targetForeignKeyColumn,
        related[mapping.targetPrimaryKey]
      ),
    })
  }

  entity[relationship.name] = relatedRows
}

async function resolveManyToManyTarget(
  targetTable: PGliteTable,
  manager: PGliteModuleTestConnection,
  relationValue: unknown,
  performedActions: PerformedActions,
  options: PGliteRelationReplacementOptions
): Promise<Record<string, unknown>> {
  const targetPrimaryKeys = getPrimaryKeys(targetTable)
  const targetPrimaryKey = requireSinglePrimaryKey(targetTable)

  if (typeof relationValue === "string") {
    return await requireExistingRelationshipTarget(
      targetTable,
      manager,
      relationValue,
      relationshipLinkableKey(targetTable)
    )
  }

  if (!isRecord(relationValue)) {
    throw new Error(
      "The PGlite repository manyToMany relation requires objects or primary keys"
    )
  }

  const preparedEntry = await prepareMutationEntry(
    targetTable,
    manager,
    relationValue
  )
  const entry = stripRelationshipData(targetTable, preparedEntry)
  const hasPrimaryKey = hasPrimaryKeyValues(entry, targetPrimaryKeys)
  const existing = hasPrimaryKey
    ? (
        await selectRowsByPrimaryKey(
          targetTable,
          manager,
          entry,
          targetPrimaryKeys
        )
      )[0]
    : undefined
  if (!existing && hasOnlyPrimaryKeyValues(targetTable, entry)) {
    return await requireExistingRelationshipTarget(
      targetTable,
      manager,
      entry[targetPrimaryKey],
      relationshipLinkableKey(targetTable)
    )
  }
  let row: Record<string, unknown>

  if (!existing) {
    row = await insertPGliteRow(targetTable, manager, entry)
    performedActions.created[targetTable.modelName] ??= []
    performedActions.created[targetTable.modelName].push({
      id: formatPrimaryKey(row, targetPrimaryKeys),
    })
  } else if (hasPGliteRowChanges(targetTable, existing, entry)) {
    row = await updatePGliteRowByPrimaryKey(
      targetTable,
      manager,
      targetPrimaryKey,
      existing[targetPrimaryKey],
      entry
    )
    performedActions.updated[targetTable.modelName] ??= []
    performedActions.updated[targetTable.modelName].push({
      id: formatPrimaryKey(row, targetPrimaryKeys),
    })
  } else {
    row = existing
  }

  initializeEmptyArrayRelations(targetTable, row)
  await replaceNestedConfiguredRelations(
    targetTable,
    manager,
    row,
    preparedEntry,
    performedActions,
    options
  )

  return row
}

async function replaceNestedConfiguredRelations(
  table: PGliteTable,
  manager: PGliteModuleTestConnection,
  entity: Record<string, unknown>,
  source: Record<string, unknown>,
  performedActions: PerformedActions,
  options: PGliteRelationReplacementOptions = {}
): Promise<void> {
  const nestedRelationNames = presentRelationshipNames(table, source)
  if (!nestedRelationNames.length) {
    return
  }

  await replaceConfiguredRelations(
    table,
    manager,
    entity,
    source,
    nestedRelationNames,
    performedActions,
    options
  )
}

function hasPGliteRowChanges(
  table: PGliteTable,
  existingRow: Record<string, unknown>,
  update: Record<string, unknown>
): boolean {
  const primaryKeys = new Set(getPrimaryKeys(table))

  return table.columns.some((column) => {
    if (
      primaryKeys.has(column.name) ||
      column.name === "updated_at" ||
      update[column.name] === undefined
    ) {
      return false
    }

    return !pgliteValuesEqual(existingRow[column.name], update[column.name])
  })
}

function pgliteValuesEqual(left: unknown, right: unknown): boolean {
  if (left === right) {
    return true
  }

  if (left instanceof Date && right instanceof Date) {
    return left.getTime() === right.getTime()
  }

  if (left instanceof Date || right instanceof Date) {
    return (
      new Date(String(left)).getTime() === new Date(String(right)).getTime()
    )
  }

  if (Array.isArray(left) || Array.isArray(right)) {
    return JSON.stringify(left) === JSON.stringify(right)
  }

  if (isRecord(left) || isRecord(right)) {
    return JSON.stringify(left) === JSON.stringify(right)
  }

  return String(left) === String(right)
}

async function replaceBelongsToRelation(
  table: PGliteTable,
  manager: PGliteModuleTestConnection,
  entity: Record<string, unknown>,
  relationship: PGliteRelationship,
  relationName: string,
  relationValue: unknown,
  performedActions: PerformedActions,
  options: PGliteRelationReplacementOptions
): Promise<void> {
  const sourcePrimaryKey = requireSinglePrimaryKey(table)
  const sourcePrimaryKeyValue = entity[sourcePrimaryKey]
  if (sourcePrimaryKeyValue === undefined || sourcePrimaryKeyValue === null) {
    throw new Error(
      `The PGlite repository relation ${relationName} requires a source primary key`
    )
  }

  const foreignKeyColumn = table.columns.find(
    (column) => column.name === relationship.foreignKeyName
  )
  if (!foreignKeyColumn) {
    throw new Error(
      `The PGlite repository relation ${relationName} requires ${relationship.foreignKeyName}`
    )
  }

  if (relationValue === null) {
    await updatePGliteRowColumns(
      table,
      manager,
      sourcePrimaryKey,
      sourcePrimaryKeyValue,
      {
        [relationship.foreignKeyName]: null,
      }
    )
    entity[relationship.foreignKeyName] = null
    entity[relationship.name] = null
    return
  }

  const targetTable = compilePGliteTable(relationship.targetModel)
  const targetPrimaryKeys = getPrimaryKeys(targetTable)
  const targetPrimaryKey = requireSinglePrimaryKey(targetTable)

  if (typeof relationValue === "string") {
    const target = await requireExistingRelationshipTarget(
      targetTable,
      manager,
      relationValue,
      relationship.foreignKeyName
    )
    await updatePGliteRowColumns(
      table,
      manager,
      sourcePrimaryKey,
      sourcePrimaryKeyValue,
      {
        [relationship.foreignKeyName]: relationValue,
      }
    )
    entity[relationship.foreignKeyName] = relationValue
    entity[relationship.name] = target
    return
  }

  if (!isRecord(relationValue)) {
    throw new Error(
      `The PGlite repository relation ${relationName} requires an object`
    )
  }

  const relationEntry = stripRelationshipData(targetTable, relationValue)
  if (hasOnlyPrimaryKeyValues(targetTable, relationEntry)) {
    const target = await requireExistingRelationshipTarget(
      targetTable,
      manager,
      relationEntry[targetPrimaryKey],
      relationship.foreignKeyName
    )
    await updatePGliteRowColumns(
      table,
      manager,
      sourcePrimaryKey,
      sourcePrimaryKeyValue,
      {
        [relationship.foreignKeyName]: target[targetPrimaryKey],
      }
    )
    entity[relationship.foreignKeyName] = target[targetPrimaryKey]
    entity[relationship.name] = target
    return
  }
  const preparedTargetPrimaryKeyValue =
    entity[relationship.foreignKeyName] ?? relationEntry[targetPrimaryKey]
  const targetResult =
    options.reusePreparedBelongsToTargets &&
    !hasPrimaryKeyValues(relationEntry, targetPrimaryKeys) &&
    preparedTargetPrimaryKeyValue !== undefined &&
    preparedTargetPrimaryKeyValue !== null
      ? await updatePreparedBelongsToTargetRow(
          targetTable,
          manager,
          relationEntry,
          targetPrimaryKey,
          preparedTargetPrimaryKeyValue
        )
      : await upsertBelongsToTargetRow(
          targetTable,
          manager,
          relationEntry,
          targetPrimaryKeys
        )
  const target = targetResult.row
  const targetPrimaryKeyValue = target[targetPrimaryKey]

  await updatePGliteRowColumns(
    table,
    manager,
    sourcePrimaryKey,
    sourcePrimaryKeyValue,
    {
      [relationship.foreignKeyName]: targetPrimaryKeyValue,
    }
  )

  entity[relationship.foreignKeyName] = targetPrimaryKeyValue
  entity[relationship.name] = target
  if (targetResult.created) {
    performedActions.created[targetTable.modelName] ??= []
    performedActions.created[targetTable.modelName].push({
      id: formatPrimaryKey(target, targetPrimaryKeys),
    })
  }
  await replaceNestedConfiguredRelations(
    targetTable,
    manager,
    target,
    relationValue,
    performedActions,
    options
  )
}

async function updatePreparedBelongsToTargetRow(
  table: PGliteTable,
  manager: PGliteModuleTestConnection,
  entry: Record<string, unknown>,
  primaryKey: string,
  primaryKeyValue: unknown
): Promise<{ row: Record<string, unknown>; created: boolean }> {
  const [existing] = await selectRowsByPrimaryKey(
    table,
    manager,
    { [primaryKey]: primaryKeyValue },
    [primaryKey]
  )

  if (!existing) {
    return {
      row: await insertPGliteRow(table, manager, {
        ...entry,
        [primaryKey]: primaryKeyValue,
      }),
      created: true,
    }
  }

  if (!hasPGliteRowChanges(table, existing, entry)) {
    return {
      row: existing,
      created: true,
    }
  }

  return {
    row: await updatePGliteRowByPrimaryKey(
      table,
      manager,
      primaryKey,
      primaryKeyValue,
      entry
    ),
    created: true,
  }
}

async function upsertBelongsToTargetRow(
  table: PGliteTable,
  manager: PGliteModuleTestConnection,
  entry: Record<string, unknown>,
  primaryKeys: string[]
): Promise<{ row: Record<string, unknown>; created: boolean }> {
  if (
    hasPrimaryKeyValues(entry, primaryKeys) &&
    (await primaryKeyExists(table, manager, entry, primaryKeys))
  ) {
    const [existing] = await selectRowsByPrimaryKey(
      table,
      manager,
      entry,
      primaryKeys
    )
    if (existing) {
      return {
        row: existing,
        created: false,
      }
    }
  }

  return {
    row: await insertPGliteRow(table, manager, entry),
    created: true,
  }
}

async function selectRowsByPrimaryKey(
  table: PGliteTable,
  manager: PGliteModuleTestConnection,
  entry: Record<string, unknown>,
  primaryKeys: string[]
): Promise<Record<string, unknown>[]> {
  const params: unknown[] = []
  const where = primaryKeys
    .map((primaryKey) => {
      const column = table.columns.find(
        (candidate) => candidate.name === primaryKey
      )
      if (!column) {
        throw new Error(
          `The PGlite table ${table.name} is missing ${primaryKey}`
        )
      }

      params.push(toDriverValue(column, entry[primaryKey]))
      return `${quoteIdentifier(primaryKey)} = $${params.length}`
    })
    .join(" AND ")
  const result = await manager.client.query<Record<string, unknown>>(
    `SELECT ${table.columns
      .map((column) => quoteIdentifier(column.name))
      .join(", ")} FROM ${qualifiedName(
      manager.schema,
      table.name
    )} WHERE ${where}`,
    params
  )

  return result.rows.map((row) => normalizeRow(table, row))
}

function requireSinglePrimaryKey(table: PGliteTable): string {
  const primaryKeys = getPrimaryKeys(table)
  if (primaryKeys.length !== 1) {
    throw new Error(
      `The PGlite repository relation support requires one primary key for ${table.name}`
    )
  }

  return primaryKeys[0]
}

function getPrimaryKeys(table: PGliteTable): string[] {
  return table.columns
    .filter((column) => column.primaryKey)
    .map((column) => column.name)
}

function hasOnlyPrimaryKeyValues(
  table: PGliteTable,
  entry: Record<string, unknown>
): boolean {
  const primaryKeys = getPrimaryKeys(table)
  return (
    hasPrimaryKeyValues(entry, primaryKeys) &&
    table.columns.every(
      (column) => column.primaryKey || entry[column.name] === undefined
    )
  )
}

async function requireExistingRelationshipTarget(
  targetTable: PGliteTable,
  manager: PGliteModuleTestConnection,
  primaryKeyValue: unknown,
  field: string
): Promise<Record<string, unknown>> {
  const targetPrimaryKeys = getPrimaryKeys(targetTable)
  const targetPrimaryKey = requireSinglePrimaryKey(targetTable)
  const [target] = await selectRowsByPrimaryKey(
    targetTable,
    manager,
    { [targetPrimaryKey]: primaryKeyValue },
    targetPrimaryKeys
  )
  if (!target) {
    throw new Error(relationshipNotFoundMessage(field, primaryKeyValue))
  }

  return target
}

function relationshipLinkableKey(targetTable: PGliteTable): string {
  return `${targetTable.name}_${requireSinglePrimaryKey(targetTable)}`
}

function relationshipNotFoundMessage(field: string, value: unknown): string {
  return `You tried to set relationship ${field}: ${String(
    value
  )}, but such entity does not exist`
}

function requirePGliteColumn(
  table: PGliteTable,
  columnName: string
): PGliteColumn {
  const column = table.columns.find(
    (candidate) => candidate.name === columnName
  )
  if (!column) {
    throw new Error(`The PGlite table ${table.name} is missing ${columnName}`)
  }

  return column
}

async function deleteRowsByForeignKey(
  table: PGliteTable,
  manager: PGliteModuleTestConnection,
  foreignKeyName: string,
  foreignKeyValue: unknown
): Promise<{ id: string }[]> {
  const primaryKeys = getPrimaryKeys(table)
  const foreignKeyColumn = table.columns.find(
    (column) => column.name === foreignKeyName
  )
  if (!foreignKeyColumn) {
    throw new Error(
      `The PGlite table ${table.name} is missing ${foreignKeyName}`
    )
  }

  const result = await manager.client.query<Record<string, unknown>>(
    `DELETE FROM ${qualifiedName(
      manager.schema,
      table.name
    )} WHERE ${quoteIdentifier(foreignKeyName)} = $1 RETURNING ${primaryKeys
      .map(quoteIdentifier)
      .join(", ")}`,
    [toDriverValue(foreignKeyColumn, foreignKeyValue)]
  )

  return result.rows.map((row) => ({
    id: formatPrimaryKey(row, primaryKeys),
  }))
}

async function selectRowsByForeignKey(
  table: PGliteTable,
  manager: PGliteModuleTestConnection,
  foreignKeyName: string,
  foreignKeyValue: unknown
): Promise<Record<string, unknown>[]> {
  const foreignKeyColumn = requirePGliteColumn(table, foreignKeyName)
  const result = await manager.client.query<Record<string, unknown>>(
    `SELECT ${table.columns
      .map((column) => quoteIdentifier(column.name))
      .join(", ")} FROM ${qualifiedName(
      manager.schema,
      table.name
    )} WHERE ${quoteIdentifier(foreignKeyName)} = $1`,
    [toDriverValue(foreignKeyColumn, foreignKeyValue)]
  )

  return result.rows.map((row) => normalizeRow(table, row))
}

async function deleteRowsByPrimaryKeyValues(
  table: PGliteTable,
  manager: PGliteModuleTestConnection,
  primaryKeyValues: unknown[]
): Promise<{ id: string }[]> {
  if (!primaryKeyValues.length) {
    return []
  }

  const primaryKeys = getPrimaryKeys(table)
  const primaryKey = requireSinglePrimaryKey(table)
  const primaryKeyColumn = requirePGliteColumn(table, primaryKey)
  const params: unknown[] = []
  const inCondition = renderInCondition(
    primaryKeyColumn,
    primaryKeyValues,
    params,
    false
  )
  const result = await manager.client.query<Record<string, unknown>>(
    `DELETE FROM ${qualifiedName(
      manager.schema,
      table.name
    )} WHERE ${inCondition} RETURNING ${primaryKeys
      .map(quoteIdentifier)
      .join(", ")}`,
    params
  )

  return result.rows.map((row) => ({
    id: formatPrimaryKey(row, primaryKeys),
  }))
}

async function deleteConfiguredCascadeRows(
  sourceTable: PGliteTable,
  manager: PGliteModuleTestConnection,
  sourceRows: Record<string, unknown>[],
  performedActions: PerformedActions
): Promise<void> {
  const sourcePrimaryKey = requireSinglePrimaryKey(sourceTable)

  for (const relationName of sourceTable.cascades.delete ?? []) {
    const relationship = sourceTable.relationships.find(
      (candidate) => candidate.name === relationName
    )
    if (!relationship) {
      continue
    }
    if (relationship.type !== "hasMany" && relationship.type !== "hasOne") {
      throw new Error(
        `The PGlite repository can only delete cascade target-owned foreign key relations for now`
      )
    }

    const targetTable = compilePGliteTable(relationship.targetModel)
    const targetPrimaryKey = requireSinglePrimaryKey(targetTable)
    const targetRows: Record<string, unknown>[] = []

    for (const sourceRow of sourceRows) {
      const sourceId = sourceRow[sourcePrimaryKey]
      if (sourceId === undefined || sourceId === null) {
        continue
      }
      targetRows.push(
        ...(await selectRowsByForeignKey(
          targetTable,
          manager,
          relationship.foreignKeyName,
          sourceId
        ))
      )
    }

    await deleteConfiguredCascadeRows(
      targetTable,
      manager,
      targetRows,
      performedActions
    )
    const deleted = await deleteRowsByPrimaryKeyValues(
      targetTable,
      manager,
      targetRows.map((row) => row[targetPrimaryKey])
    )
    if (deleted.length) {
      performedActions.deleted[targetTable.modelName] ??= []
      performedActions.deleted[targetTable.modelName].push(...deleted)
    }
  }
}

async function updatePGliteRowByPrimaryKey(
  table: PGliteTable,
  manager: PGliteModuleTestConnection,
  primaryKey: string,
  primaryKeyValue: unknown,
  updates: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const primaryKeyColumn = requirePGliteColumn(table, primaryKey)
  const prepared = prepareUpdateData(table, updates)
  const columns = table.columns.filter(
    (column) =>
      column.name !== primaryKey && prepared[column.name] !== undefined
  )

  if (!columns.length) {
    const [row] = await selectRowsByPrimaryKey(
      table,
      manager,
      { [primaryKey]: primaryKeyValue },
      [primaryKey]
    )
    if (!row) {
      throw new Error(`The PGlite repository could not find ${table.name}`)
    }
    return row
  }

  const params: unknown[] = []
  const setClauses = columns.map((column) => {
    params.push(toDriverValue(column, prepared[column.name]))
    return `${quoteIdentifier(column.name)} = ${renderValuePlaceholder(
      column,
      params.length
    )}`
  })
  params.push(toDriverValue(primaryKeyColumn, primaryKeyValue))

  const result = await manager.client.query<Record<string, unknown>>(
    `UPDATE ${qualifiedName(manager.schema, table.name)} SET ${setClauses.join(
      ", "
    )} WHERE ${quoteIdentifier(primaryKey)} = $${params.length} RETURNING *`,
    params
  )
  const row = result.rows[0]
  if (!row) {
    throw new Error(`The PGlite repository failed to update ${table.name}`)
  }

  return normalizeRow(table, row)
}

async function updatePGliteRowColumns(
  table: PGliteTable,
  manager: PGliteModuleTestConnection,
  primaryKey: string,
  primaryKeyValue: unknown,
  updates: Record<string, unknown>
): Promise<void> {
  const primaryKeyColumn = table.columns.find(
    (column) => column.name === primaryKey
  )
  if (!primaryKeyColumn) {
    throw new Error(`The PGlite table ${table.name} is missing ${primaryKey}`)
  }

  const entries = Object.entries(updates)
  if (!entries.length) {
    return
  }

  const params: unknown[] = []
  const setClauses = entries.map(([field, value]) => {
    const column = table.columns.find((candidate) => candidate.name === field)
    if (!column) {
      throw new Error(`The PGlite table ${table.name} is missing ${field}`)
    }

    params.push(toDriverValue(column, value))
    return `${quoteIdentifier(field)} = $${params.length}`
  })

  params.push(toDriverValue(primaryKeyColumn, primaryKeyValue))
  await manager.client.query(
    `UPDATE ${qualifiedName(manager.schema, table.name)} SET ${setClauses.join(
      ", "
    )} WHERE ${quoteIdentifier(primaryKey)} = $${params.length}`,
    params
  )
}

async function cascadeDeleteReferences(
  sourceTable: PGliteTable,
  manager: PGliteModuleTestConnection,
  sourceIds: unknown[]
): Promise<void> {
  if (!sourceIds.length) {
    return
  }

  for (const model of manager.models) {
    const candidateTable = compilePGliteTable(model)

    for (const relationship of candidateTable.relationships) {
      if (
        (relationship.type !== "belongsTo" &&
          relationship.type !== "hasOneWithFK") ||
        !samePortableModel(
          relationship.targetModel,
          sourceTableToModel(sourceTable, manager)
        )
      ) {
        continue
      }

      for (const sourceId of sourceIds) {
        if (
          relationship.type === "hasOneWithFK" &&
          relationship.nullable
        ) {
          const foreignKeyColumn = requirePGliteColumn(
            candidateTable,
            relationship.foreignKeyName
          )
          await manager.client.query(
            `UPDATE ${qualifiedName(
              manager.schema,
              candidateTable.name
            )} SET ${quoteIdentifier(
              relationship.foreignKeyName
            )} = NULL WHERE ${quoteIdentifier(
              relationship.foreignKeyName
            )} = $1`,
            [toDriverValue(foreignKeyColumn, sourceId)]
          )
          continue
        }

        await deleteRowsByForeignKey(
          candidateTable,
          manager,
          relationship.foreignKeyName,
          sourceId
        )
      }
    }
  }
}

async function cascadeSoftDeleteReferences(
  sourceTable: PGliteTable,
  manager: PGliteModuleTestConnection,
  sourceRows: Record<string, unknown>[],
  sourcePrimaryKeys: string[],
  deletedAt: string | null,
  withDeleted: boolean
): Promise<Record<string, unknown[]>> {
  const cascadedEntities: Record<string, unknown[]> = {}
  const sourcePrimaryKey = sourcePrimaryKeys[0]
  if (!sourcePrimaryKey || !sourceRows.length) {
    return cascadedEntities
  }

  const sourceIds = sourceRows
    .map((row) => row[sourcePrimaryKey])
    .filter((value) => value !== undefined && value !== null)
  if (!sourceIds.length) {
    return cascadedEntities
  }

  for (const relationName of sourceTable.cascades.delete ?? []) {
    const relationship = sourceTable.relationships.find(
      (candidate) => candidate.name === relationName
    )
    if (!relationship) {
      continue
    }

    if (relationship.type !== "hasMany" && relationship.type !== "hasOne") {
      throw new Error(
        `The PGlite repository can only soft-delete cascade target-owned foreign key relations for now`
      )
    }

    const targetTable = compilePGliteTable(relationship.targetModel)
    const targetPrimaryKeys = getPrimaryKeys(targetTable)
    const targetPrimaryKey = targetPrimaryKeys[0]
    if (!targetPrimaryKey) {
      throw new Error(
        `The PGlite repository cascade requires a primary key for ${targetTable.name}`
      )
    }

    const targetDeletedAtColumn = targetTable.columns.find(
      (column) => column.name === "deleted_at"
    )
    if (!targetDeletedAtColumn) {
      continue
    }

    const targetUpdatedAtColumn = targetTable.columns.find(
      (column) => column.name === "updated_at"
    )
    const foreignKeyColumn = requirePGliteColumn(
      targetTable,
      relationship.foreignKeyName
    )
    const params: unknown[] = [toDriverValue(targetDeletedAtColumn, deletedAt)]
    const setClauses = [`${quoteIdentifier("deleted_at")} = $1`]

    if (targetUpdatedAtColumn) {
      params.push(
        toDriverValue(targetUpdatedAtColumn, new Date().toISOString())
      )
      setClauses.push(`${quoteIdentifier("updated_at")} = $${params.length}`)
    }

    const inCondition = renderInCondition(
      foreignKeyColumn,
      sourceIds,
      params,
      false
    )
    const clauses = [inCondition]
    if (!withDeleted) {
      clauses.push(`${quoteIdentifier("deleted_at")} IS NULL`)
    }

    const result = await manager.client.query<Record<string, unknown>>(
      `UPDATE ${qualifiedName(
        manager.schema,
        targetTable.name
      )} SET ${setClauses.join(", ")} WHERE ${clauses.join(
        " AND "
      )} RETURNING *`,
      params
    )
    const targetRows = result.rows.map((row) => normalizeRow(targetTable, row))

    cascadedEntities[targetTable.modelName] ??= []
    cascadedEntities[targetTable.modelName].push(
      ...targetRows.map((row) => formatPrimaryKey(row, targetPrimaryKeys))
    )

    const nestedCascades = await cascadeSoftDeleteReferences(
      targetTable,
      manager,
      targetRows,
      targetPrimaryKeys,
      deletedAt,
      withDeleted
    )

    for (const [modelName, ids] of Object.entries(nestedCascades)) {
      cascadedEntities[modelName] ??= []
      cascadedEntities[modelName].push(...ids)
    }
  }

  return cascadedEntities
}

function sourceTableToModel(
  sourceTable: PGliteTable,
  manager: PGliteModuleTestConnection
): PortableEntityLike {
  const model = manager.models.find(
    (candidate) => compilePGliteTable(candidate).name === sourceTable.name
  )
  if (!model) {
    throw new Error(`The PGlite table ${sourceTable.name} is not registered`)
  }

  return model
}

async function insertPGliteRow(
  table: PGliteTable,
  manager: PGliteModuleTestConnection,
  entry: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const prepared = prepareMutationData(table, entry)
  const columns = table.columns.filter(
    (column) => prepared[column.name] !== undefined
  )
  const params = columns.map((column) =>
    toDriverValue(column, prepared[column.name])
  )
  const result = await queryPGliteRows(
    table,
    manager,
    `INSERT INTO ${qualifiedName(manager.schema, table.name)} (${columns
      .map((column) => quoteIdentifier(column.name))
      .join(", ")}) VALUES (${params
      .map((_value, index) => `$${index + 1}`)
      .join(", ")}) RETURNING *`,
    params
  )
  const returned = result.rows[0]
  if (!returned) {
    throw new Error(`The PGlite repository failed to insert ${table.name}`)
  }

  return normalizeRow(table, returned)
}

function normalizeRepositoryFilter(
  filter: PGliteRepositoryFilter | null | undefined,
  primaryKeys: string[]
): Record<string, unknown> | undefined {
  if (!filter) {
    return undefined
  }

  if (Array.isArray(filter)) {
    const filters = filter
      .map((entry) => normalizeRepositoryFilterEntry(entry, primaryKeys))
      .filter((entry): entry is Record<string, unknown> => Boolean(entry))

    return filters.length ? { $or: filters } : undefined
  }

  return normalizeRepositoryFilterEntry(filter, primaryKeys)
}

function normalizeRepositoryFilterEntry(
  filter: string | Record<string, unknown>,
  primaryKeys: string[]
): Record<string, unknown> | undefined {
  if (typeof filter === "string") {
    if (!filter) {
      return undefined
    }

    const primaryKey = primaryKeys[0]
    if (!primaryKey) {
      throw new Error("The PGlite repository filter requires a primary key")
    }

    return { [primaryKey]: filter }
  }

  return filter
}

async function updateDeletedAt(
  table: PGliteTable,
  manager: PGliteModuleTestConnection,
  idsOrFilter: PGliteRepositoryFilter,
  primaryKeys: string[],
  deletedAt: string | null,
  withDeleted: boolean
): Promise<[Record<string, unknown>[], Record<string, unknown[]>]> {
  const deletedAtColumn = table.columns.find(
    (column) => column.name === "deleted_at"
  )

  if (!deletedAtColumn) {
    throw new Error(
      `The PGlite repository cannot soft delete ${table.name} without deleted_at`
    )
  }

  const whereInput = normalizeRepositoryFilter(idsOrFilter, primaryKeys)
  if (!whereInput) {
    return [[], {}]
  }

  const updatedAtColumn = table.columns.find(
    (column) => column.name === "updated_at"
  )
  const params: unknown[] = [toDriverValue(deletedAtColumn, deletedAt)]
  const setClauses = [`${quoteIdentifier("deleted_at")} = $1`]

  if (updatedAtColumn) {
    params.push(toDriverValue(updatedAtColumn, new Date().toISOString()))
    setClauses.push(`${quoteIdentifier("updated_at")} = $${params.length}`)
  }

  const clauses = buildWhereConditions(table, whereInput, params, {
    schemaName: manager.schema,
    table,
  })
  if (!withDeleted) {
    clauses.push(`${quoteIdentifier("deleted_at")} IS NULL`)
  }

  if (!clauses.length) {
    return [[], {}]
  }

  const result = await queryPGliteRows(
    table,
    manager,
    `UPDATE ${qualifiedName(manager.schema, table.name)} SET ${setClauses.join(
      ", "
    )} WHERE ${clauses.join(" AND ")} RETURNING *`,
    params
  )

  const rows = result.rows.map((row) => normalizeRow(table, row))
  const cascaded = await cascadeSoftDeleteReferences(
    table,
    manager,
    rows,
    primaryKeys,
    deletedAt,
    withDeleted
  )

  return [rows, cascaded]
}

function assertPortableEntity(value: object): PortableEntityLike {
  if (isPortableEntityLike(value)) {
    return value
  }

  throw new Error(
    "The PGlite module test adapter only supports DML portable entities."
  )
}

function isPortableEntityLike(value: unknown): value is PortableEntityLike {
  return Boolean(
    value &&
      typeof value === "object" &&
      "parse" in value &&
      typeof value.parse === "function" &&
      "name" in value &&
      typeof value.name === "string"
  )
}

function discoverModuleModels(
  options: PrepareModuleTestDatabaseOptions
): PortableEntityLike[] {
  if (options.moduleModels) {
    return options.moduleModels.map(assertPortableEntity)
  }

  const basePath = normalizeImportPathWithSource(
    options.resolve ?? options.cwd ?? process.cwd()
  )
  const modelsPath = fs.existsSync(`${basePath}/dist/models`)
    ? "/dist/models"
    : fs.existsSync(`${basePath}/models`)
    ? "/models"
    : ""

  return modelsPath
    ? loadModels(`${basePath}${modelsPath}`).map(assertPortableEntity)
    : []
}

function renderPGliteMigrationSql(
  schemaName: string,
  entities: PortableEntityLike[]
): string {
  const tables = entities.map(compilePGliteTable)
  const implicitPivotTables = tables.flatMap((table) =>
    table.relationships.flatMap((relationship) =>
      relationship.type === "manyToMany" && relationship.pivotTableName
        ? [compileImplicitManyToManyPivotTable(relationship)]
        : []
    )
  )
  const allTables = [...tables]
  const knownTableNames = new Set(tables.map((table) => table.name))

  for (const pivotTable of implicitPivotTables) {
    if (knownTableNames.has(pivotTable.name)) {
      continue
    }

    knownTableNames.add(pivotTable.name)
    allTables.push(pivotTable)
  }
  const schema = quoteIdentifier(schemaName)

  return [
    `CREATE SCHEMA IF NOT EXISTS ${schema};`,
    ...allTables.map((table) => renderCreateTable(schemaName, table)),
    ...allTables.flatMap((table) =>
      table.indexes.map((index) => renderCreateIndex(schemaName, index))
    ),
  ].join("\n")
}

function compileImplicitManyToManyPivotTable(
  relationship: PGliteRelationship
): PGliteTable {
  if (!relationship.pivotTableName) {
    throw new Error(
      `The PGlite manyToMany relation ${relationship.name} requires a pivot table`
    )
  }

  const sourceForeignKey =
    relationship.pivotSourceForeignKey ??
    toSnakeCase(`${relationship.sourceModel.name}Id`)
  const targetForeignKey =
    relationship.pivotTargetForeignKey ??
    toSnakeCase(`${relationship.targetModel.name}Id`)

  return {
    modelName: relationship.pivotTableName,
    name: toSnakeCase(relationship.pivotTableName),
    columns: [
      {
        name: sourceForeignKey,
        type: "text",
        dataType: "text",
        nullable: false,
        primaryKey: true,
      },
      {
        name: targetForeignKey,
        type: "text",
        dataType: "text",
        nullable: false,
        primaryKey: true,
      },
    ],
    indexes: [],
    checks: [],
    relationships: [],
    cascades: {},
  }
}

function compilePGliteTable(entity: PortableEntityLike): PGliteTable {
  const parsed = entity.parse()
  const tableName = toSnakeCase(parsed.tableName)
  const columns: PGliteColumn[] = []
  const indexes: PGliteIndex[] = []
  const relationships: PGliteRelationship[] = []

  for (const [fieldName, member] of Object.entries(parsed.schema)) {
    const metadata = member.parse(fieldName)

    if (metadata.computed) {
      continue
    }

    if (isRelationshipMetadata(metadata)) {
      const relationship = toPGliteRelationship(metadata, entity)
      relationships.push(relationship)

      if (ownsSourceForeignKey(relationship)) {
        columns.push({
          name: relationship.foreignKeyName,
          type: "text",
          dataType: "text",
          nullable: relationship.nullable,
          primaryKey: false,
        })

        indexes.push({
          name: `${tableName}_${relationship.foreignKeyName}_idx`,
          tableName,
          columns: [relationship.foreignKeyName],
          unique: false,
        })
      }

      continue
    }

    if (!metadata.dataType) {
      throw new Error(`DML field "${fieldName}" is missing data type metadata`)
    }

    columns.push({
      name: metadata.fieldName ?? fieldName,
      type: toPostgresType(metadata.dataType.name),
      dataType: metadata.dataType.name,
      dataTypeOptions: metadata.dataType.options,
      nullable: metadata.nullable ?? false,
      primaryKey: metadata.primaryKey ?? false,
      searchable: metadata.dataType.options?.searchable === true,
      defaultValue: metadata.defaultValue,
    })

    indexes.push(
      ...(metadata.indexes ?? []).map((index) => ({
        name: index.name ?? `${tableName}_${fieldName}_${index.type}`,
        tableName,
        columns: [fieldName],
        unique: index.type === "unique",
      }))
    )
  }

  indexes.push(
    ...(parsed.indexes ?? []).map((index, indexPosition) => ({
      name: index.name ?? `${tableName}_${index.on.join("_")}_${indexPosition}`,
      tableName,
      columns: index.on,
      unique: index.unique ?? false,
      where: typeof index.where === "string" ? index.where : undefined,
    }))
  )

  const checks = compilePGliteChecks(
    tableName,
    parsed.schema,
    columns,
    parsed.checks ?? []
  )

  return {
    modelName: entity.name,
    name: tableName,
    columns,
    indexes,
    checks,
    relationships,
    cascades: parsed.cascades ?? {},
  }
}

function compilePGliteChecks(
  tableName: string,
  schema: Record<string, { parse(fieldName: string): PortableMemberMetadata }>,
  columns: PGliteColumn[],
  checks: PortableCheckMetadata[]
): PGliteCheck[] {
  const physicalColumns = new Map(
    columns.map((column) => [column.name, quoteIdentifier(column.name)])
  )

  for (const [fieldName, member] of Object.entries(schema)) {
    const metadata = member.parse(fieldName)
    if (!metadata.computed && !isRelationshipMetadata(metadata)) {
      const columnName = metadata.fieldName ?? fieldName
      physicalColumns.set(fieldName, quoteIdentifier(columnName))
    }
  }

  const checkColumns = new Proxy<Record<string, string>>(
    {},
    {
      get: (_target, property) =>
        typeof property === "string"
          ? physicalColumns.get(property) ?? quoteIdentifier(property)
          : undefined,
    }
  )

  return checks.map((check, index) => {
    if (typeof check === "function") {
      return {
        name: `${tableName}_check_${index}`,
        expression: check(checkColumns),
      }
    }

    const expression =
      typeof check.expression === "function"
        ? check.expression(checkColumns)
        : check.expression ??
          (check.property
            ? physicalColumns.get(check.property) ??
              quoteIdentifier(check.property)
            : undefined)

    if (!expression) {
      throw new Error(`The PGlite ${tableName} check requires an expression`)
    }

    return {
      name: check.name ?? `${tableName}_check_${index}`,
      expression,
    }
  })
}

function ownsSourceForeignKey(relationship: PGliteRelationship): boolean {
  return (
    relationship.type === "belongsTo" || relationship.type === "hasOneWithFK"
  )
}

function renderCreateTable(schemaName: string, table: PGliteTable): string {
  const primaryKeys = table.columns.filter((column) => column.primaryKey)
  const columnDefinitions = table.columns.map((column) =>
    renderColumn(column, primaryKeys.length)
  )
  const constraints = [
    ...(primaryKeys.length > 1
      ? [
          `  CONSTRAINT ${quoteIdentifier(
            `${table.name}_primary_key`
          )} PRIMARY KEY (${primaryKeys
            .map((column) => quoteIdentifier(column.name))
            .join(", ")})`,
        ]
      : []),
    ...table.checks.map(
      (check) =>
        `  CONSTRAINT ${quoteIdentifier(check.name)} CHECK (${
          check.expression
        })`
    ),
  ]

  return `CREATE TABLE IF NOT EXISTS ${qualifiedName(
    schemaName,
    table.name
  )} (\n${[...columnDefinitions, ...constraints].join(",\n")}\n);`
}

function renderColumn(
  column: PGliteColumn,
  primaryKeyColumnCount: number
): string {
  const parts = [`  ${quoteIdentifier(column.name)}`, column.type]

  if (column.primaryKey && primaryKeyColumnCount === 1) {
    parts.push("PRIMARY KEY")
  }

  if (column.dataType === "serial") {
    parts.push("GENERATED BY DEFAULT AS IDENTITY")
  }

  if (!column.nullable) {
    parts.push("NOT NULL")
  }

  if (column.defaultValue !== undefined) {
    parts.push(`DEFAULT ${renderDefaultValue(column.defaultValue)}`)
  } else if (
    column.dataType === "dateTime" &&
    !column.nullable &&
    column.name !== "deleted_at"
  ) {
    parts.push("DEFAULT now()")
  }

  return parts.join(" ")
}

function renderCreateIndex(schemaName: string, index: PGliteIndex): string {
  const unique = index.unique ? "UNIQUE " : ""
  const where = index.where ? ` WHERE ${index.where}` : ""

  return `CREATE ${unique}INDEX IF NOT EXISTS ${quoteIdentifier(
    index.name
  )} ON ${qualifiedName(schemaName, index.tableName)} (${index.columns
    .map(quoteIdentifier)
    .join(", ")})${where};`
}

function selectColumns(
  table: PGliteTable,
  fields: string[] | undefined,
  includePrimaryKeys = false,
  relationNames: string[] = []
): PGliteColumn[] {
  if (!fields?.length) {
    return table.columns
  }

  const selected = new Set(
    fields.flatMap((field) => expandSelectedField(field))
  )
  if (includePrimaryKeys) {
    for (const primaryKey of getPrimaryKeys(table)) {
      selected.add(primaryKey)
    }
  }
  for (const relationName of relationNames) {
    const [head] = relationName.split(".")
    const relationship = table.relationships.find(
      (candidate) => candidate.name === head
    )
    const versionSourceField = relationship
      ? versionedRelationSourceField(table, relationship)
      : undefined
    if (versionSourceField) {
      selected.add(versionSourceField)
    }
    if (relationship && ownsSourceForeignKey(relationship)) {
      selected.add(relationship.foreignKeyName)
    }
  }

  return table.columns.filter((column) => selected.has(column.name))
}

function expandSelectedField(field: string): string[] {
  if (field.startsWith("raw_")) {
    return [field]
  }

  return [field, `raw_${field}`]
}

function buildSelectQuery(
  schemaName: string,
  table: PGliteTable,
  selectedColumns: PGliteColumn[],
  findOptions: DAL.FindOptions<Record<string, unknown>>
): { sql: string; params: unknown[] } {
  const params: unknown[] = []
  const where = buildWhereClause(
    table,
    findOptions.where ?? {},
    params,
    shouldIncludeDeleted(findOptions),
    {
      schemaName,
      table,
    },
    findOptions.options?.filters
  )
  const order = renderOrderBy(findOptions.options?.orderBy, {
    schemaName,
    table,
  })
  const limit =
    findOptions.options?.limit === undefined
      ? ""
      : ` LIMIT ${Number(findOptions.options.limit)}`
  const offset =
    findOptions.options?.offset === undefined
      ? ""
      : ` OFFSET ${Number(findOptions.options.offset)}`

  return {
    sql: `SELECT ${selectedColumns
      .map((column) => quoteIdentifier(column.name))
      .join(", ")} FROM ${qualifiedName(
      schemaName,
      table.name
    )}${where}${order}${limit}${offset}`,
    params,
  }
}

function buildCountQuery(
  schemaName: string,
  table: PGliteTable,
  findOptions: DAL.FindOptions<Record<string, unknown>>
): { sql: string; params: unknown[] } {
  const params: unknown[] = []
  const where = buildWhereClause(
    table,
    findOptions.where ?? {},
    params,
    shouldIncludeDeleted(findOptions),
    {
      schemaName,
      table,
    },
    findOptions.options?.filters
  )

  return {
    sql: `SELECT COUNT(*)::int AS count FROM ${qualifiedName(
      schemaName,
      table.name
    )}${where}`,
    params,
  }
}

function buildWhereClause(
  table: PGliteTable,
  whereInput: Record<string, unknown>,
  params: unknown[],
  includeDeleted: boolean,
  context?: PGliteWhereContext,
  filters?: unknown
): string {
  const clauses = buildWhereConditions(table, whereInput, params, context)
  const freeTextSearch = renderFreeTextSearchCondition(table, filters, params)
  if (freeTextSearch) {
    clauses.push(freeTextSearch)
  }

  if (
    !includeDeleted &&
    table.columns.some((column) => column.name === "deleted_at")
  ) {
    clauses.push(`${quoteIdentifier("deleted_at")} IS NULL`)
  }

  return clauses.length ? ` WHERE ${clauses.join(" AND ")}` : ""
}

function buildWhereConditions(
  table: PGliteTable,
  whereInput: Record<string, unknown>,
  params: unknown[],
  context?: PGliteWhereContext
): string[] {
  const clauses: string[] = []

  for (const [field, value] of Object.entries(whereInput)) {
    if (field === "$and" || field === "$or") {
      if (!Array.isArray(value)) {
        throw new Error(`PGlite ${field} filter expects an array`)
      }

      const nested = value
        .map((entry) => {
          if (!isRecord(entry)) {
            throw new Error(`PGlite ${field} filters must be objects`)
          }
          return buildWhereConditions(table, entry, params, context)
        })
        .filter((entry) => entry.length)
        .map((entry) => `(${entry.join(" AND ")})`)

      if (nested.length) {
        clauses.push(`(${nested.join(field === "$and" ? " AND " : " OR ")})`)
      }
      continue
    }

    if (isPGliteRawFilterField(field)) {
      if (value === false || value === null || value === undefined) {
        continue
      }
      if (value !== true) {
        throw new Error("The PGlite repository raw filter value must be true")
      }
      if (!context) {
        throw new Error(
          "The PGlite repository raw filter requires query context"
        )
      }

      clauses.push(renderPGliteRawFilter(field, context))
      continue
    }

    const column = table.columns.find((entry) => entry.name === field)
    if (!column) {
      const relationship = table.relationships.find(
        (entry) => entry.name === field
      )
      if (field === "detail" && isRecord(value) && !relationship) {
        clauses.push(...buildWhereConditions(table, value, params, context))
        continue
      }

      if (relationship && context) {
        clauses.push(
          renderRelationshipCondition(
            table,
            relationship,
            value,
            params,
            context
          )
        )
        continue
      }

      throw new Error(
        `The PGlite repository cannot filter unknown field ${field}`
      )
    }

    clauses.push(...buildFieldConditions(column, value, params))
  }

  return clauses
}

function isPGliteRawFilterField(field: string): boolean {
  return field.startsWith("[raw]:")
}

function renderPGliteRawFilter(
  field: string,
  context: PGliteWhereContext
): string {
  const sql = field.replace(/^\[raw\]:\s*/, "").replace(/\s+\(#\d+\)$/, "")

  if (sql.includes(";") || sql.includes("?") || /\$\d+/.test(sql)) {
    throw new Error(
      "The PGlite repository raw filter does not support multiple statements or unbound parameters"
    )
  }

  const alias = qualifiedName(context.schemaName, context.table.name)
  return `(${sql.replace(/\[::alias::\]/g, alias)})`
}

function buildFieldConditions(
  column: PGliteColumn,
  value: unknown,
  params: unknown[]
): string[] {
  if (Array.isArray(value)) {
    return [renderInCondition(column, value, params, false)]
  }

  if (isRecord(value)) {
    if (column.dataType === "json" && !isOperatorFilter(value)) {
      params.push(JSON.stringify(value))
      return [`${quoteIdentifier(column.name)} @> $${params.length}::jsonb`]
    }

    const clauses: string[] = []
    for (const [operator, operatorValue] of Object.entries(value)) {
      clauses.push(
        renderOperatorCondition(column, operator, operatorValue, params)
      )
    }
    return clauses
  }

  if (value === null) {
    return [`${quoteIdentifier(column.name)} IS NULL`]
  }

  params.push(toDriverValue(column, value))
  return [
    `${quoteIdentifier(column.name)} = ${renderValuePlaceholder(
      column,
      params.length
    )}`,
  ]
}

function isOperatorFilter(value: Record<string, unknown>): boolean {
  return Object.keys(value).some((key) => key.startsWith("$"))
}

function renderRelationshipCondition(
  sourceTable: PGliteTable,
  relationship: PGliteRelationship,
  value: unknown,
  params: unknown[],
  context: PGliteWhereContext
): string {
  if (relationship.type === "manyToMany") {
    return renderManyToManyRelationshipCondition(
      sourceTable,
      relationship,
      value,
      params,
      context
    )
  }

  if (ownsSourceForeignKey(relationship)) {
    return renderBelongsToRelationshipCondition(relationship, value, params, {
      schemaName: context.schemaName,
      table: compilePGliteTable(relationship.targetModel),
    })
  }

  if (relationship.type !== "hasMany") {
    throw new Error(
      `The PGlite repository only supports source-owned foreign key, hasMany, and manyToMany relation filters for now`
    )
  }

  if (!isRecord(value)) {
    throw new Error(
      `The PGlite repository relation filter ${relationship.name} expects an object`
    )
  }

  const sourcePrimaryKey = requireSinglePrimaryKey(sourceTable)
  const targetTable = compilePGliteTable(relationship.targetModel)
  const childClauses = buildWhereConditions(targetTable, value, params, {
    schemaName: context.schemaName,
    table: targetTable,
  })

  if (targetTable.columns.some((column) => column.name === "deleted_at")) {
    childClauses.push(`${quoteIdentifier("deleted_at")} IS NULL`)
  }

  const relationClause = `${quoteIdentifier(
    relationship.foreignKeyName
  )} = ${qualifiedName(context.schemaName, sourceTable.name)}.${quoteIdentifier(
    sourcePrimaryKey
  )}`
  const where = [relationClause, ...childClauses].join(" AND ")

  return `EXISTS (SELECT 1 FROM ${qualifiedName(
    context.schemaName,
    targetTable.name
  )} WHERE ${where})`
}

function renderBelongsToRelationshipCondition(
  relationship: PGliteRelationship,
  value: unknown,
  params: unknown[],
  context: PGliteWhereContext
): string {
  const targetTable = context.table
  const targetPrimaryKey = requireSinglePrimaryKey(targetTable)
  const targetPrimaryKeyColumn = requirePGliteColumn(
    targetTable,
    targetPrimaryKey
  )

  if (typeof value === "string") {
    params.push(toDriverValue(targetPrimaryKeyColumn, value))
    return `${quoteIdentifier(relationship.foreignKeyName)} = $${params.length}`
  }

  if (!isRecord(value)) {
    throw new Error(
      `The PGlite repository relation filter ${relationship.name} expects an object`
    )
  }

  const targetClauses = buildWhereConditions(
    targetTable,
    value,
    params,
    context
  )

  if (targetTable.columns.some((column) => column.name === "deleted_at")) {
    targetClauses.push(`${quoteIdentifier("deleted_at")} IS NULL`)
  }

  if (!targetClauses.length) {
    throw new Error(
      `The PGlite repository relation filter ${relationship.name} requires at least one condition`
    )
  }

  return `${quoteIdentifier(
    relationship.foreignKeyName
  )} IN (SELECT ${quoteIdentifier(targetPrimaryKey)} FROM ${qualifiedName(
    context.schemaName,
    targetTable.name
  )} WHERE ${targetClauses.join(" AND ")})`
}

function renderManyToManyRelationshipCondition(
  sourceTable: PGliteTable,
  relationship: PGliteRelationship,
  value: unknown,
  params: unknown[],
  context: PGliteWhereContext
): string {
  const sourcePrimaryKey = requireSinglePrimaryKey(sourceTable)
  const mapping = resolveManyToManyMapping(relationship)
  const targetClauses = buildManyToManyTargetClauses(mapping, value, params)

  if (
    mapping.targetTable.columns.some((column) => column.name === "deleted_at")
  ) {
    targetClauses.push(`target.${quoteIdentifier("deleted_at")} IS NULL`)
  }

  const relationClauses = [
    `pivot.${quoteIdentifier(mapping.sourceForeignKey)} = ${qualifiedName(
      context.schemaName,
      sourceTable.name
    )}.${quoteIdentifier(sourcePrimaryKey)}`,
    `target.${quoteIdentifier(
      mapping.targetPrimaryKey
    )} = pivot.${quoteIdentifier(mapping.targetForeignKey)}`,
    ...targetClauses,
  ]

  return `EXISTS (SELECT 1 FROM ${qualifiedName(
    context.schemaName,
    mapping.pivotTable.name
  )} AS pivot JOIN ${qualifiedName(
    context.schemaName,
    mapping.targetTable.name
  )} AS target ON target.${quoteIdentifier(
    mapping.targetPrimaryKey
  )} = pivot.${quoteIdentifier(
    mapping.targetForeignKey
  )} WHERE ${relationClauses.join(" AND ")})`
}

function buildManyToManyTargetClauses(
  mapping: PGliteManyToManyMapping,
  value: unknown,
  params: unknown[]
): string[] {
  const targetPrimaryColumn = mapping.targetTable.columns.find(
    (column) => column.name === mapping.targetPrimaryKey
  )
  if (!targetPrimaryColumn) {
    throw new Error(
      `The PGlite manyToMany filter requires ${mapping.targetPrimaryKey}`
    )
  }

  if (Array.isArray(value)) {
    return [
      renderInCondition(targetPrimaryColumn, value, params, false, "target"),
    ]
  }

  if (!isRecord(value)) {
    params.push(toDriverValue(targetPrimaryColumn, value))
    return [
      `target.${quoteIdentifier(mapping.targetPrimaryKey)} = $${params.length}`,
    ]
  }

  return buildWhereConditions(mapping.targetTable, value, params).map(
    (clause) => qualifyBareClause(clause, "target")
  )
}

function qualifyBareClause(clause: string, tableAlias: string): string {
  return clause.replace(
    /(^|[^\w.])"([^"]+)"/g,
    (_match: string, prefix: string, identifier: string) =>
      `${prefix}${tableAlias}.${quoteIdentifier(identifier)}`
  )
}

function shouldIncludeDeleted(
  findOptions: DAL.FindOptions<Record<string, unknown>>
): boolean {
  const filters = findOptions.options?.filters
  if (!isRecord(filters)) {
    return false
  }

  const softDeletableFilter = filters[SoftDeletableFilterKey]
  if (!isRecord(softDeletableFilter)) {
    return false
  }

  return softDeletableFilter.withDeleted === true
}

function renderFreeTextSearchCondition(
  table: PGliteTable,
  filters: unknown,
  params: unknown[]
): string | undefined {
  if (!isRecord(filters)) {
    return undefined
  }

  const filter = filters[`${FreeTextSearchFilterKeyPrefix}${table.modelName}`]
  if (!isRecord(filter)) {
    return undefined
  }

  if (
    filter.fromEntity !== undefined &&
    filter.fromEntity !== table.modelName
  ) {
    return undefined
  }

  const value = filter.value
  if (typeof value !== "string" || !value) {
    return undefined
  }

  const searchableColumns = table.columns.filter(
    (column) => column.searchable === true
  )
  if (!searchableColumns.length) {
    return undefined
  }

  params.push(`%${value}%`)
  const placeholder = `$${params.length}`
  return `(${searchableColumns
    .map(
      (column) =>
        `CAST(${quoteIdentifier(column.name)} AS TEXT) ILIKE ${placeholder}`
    )
    .join(" OR ")})`
}

function renderOperatorCondition(
  column: PGliteColumn,
  operator: string,
  value: unknown,
  params: unknown[]
): string {
  switch (operator) {
    case "$eq":
      if (value === null) {
        return `${quoteIdentifier(column.name)} IS NULL`
      }
      params.push(toDriverValue(column, value))
      return `${quoteIdentifier(column.name)} = ${renderValuePlaceholder(
        column,
        params.length
      )}`
    case "$ne":
      if (value === null) {
        return `${quoteIdentifier(column.name)} IS NOT NULL`
      }
      params.push(toDriverValue(column, value))
      return `${quoteIdentifier(column.name)} <> ${renderValuePlaceholder(
        column,
        params.length
      )}`
    case "$gt":
      params.push(toDriverValue(column, value))
      return `${quoteIdentifier(column.name)} > $${params.length}`
    case "$gte":
      params.push(toDriverValue(column, value))
      return `${quoteIdentifier(column.name)} >= $${params.length}`
    case "$lt":
      params.push(toDriverValue(column, value))
      return `${quoteIdentifier(column.name)} < $${params.length}`
    case "$lte":
      params.push(toDriverValue(column, value))
      return `${quoteIdentifier(column.name)} <= $${params.length}`
    case "$in":
      if (!Array.isArray(value)) {
        throw new Error("PGlite $in filter expects an array")
      }
      return renderInCondition(column, value, params, false)
    case "$nin":
      if (!Array.isArray(value)) {
        throw new Error("PGlite $nin filter expects an array")
      }
      return renderInCondition(column, value, params, true)
    case "$like":
      params.push(String(value))
      return `${quoteIdentifier(column.name)} LIKE $${params.length}`
    case "$ilike":
      params.push(String(value))
      return `${quoteIdentifier(column.name)} ILIKE $${params.length}`
    default:
      throw new Error(
        `The PGlite repository does not support ${operator} filters yet`
      )
  }
}

function renderInCondition(
  column: PGliteColumn,
  values: unknown[],
  params: unknown[],
  negated: boolean,
  tableAlias?: string
): string {
  if (!values.length) {
    return negated ? "TRUE" : "FALSE"
  }

  const placeholders = values.map((value) => {
    params.push(toDriverValue(column, value))
    return renderValuePlaceholder(column, params.length)
  })

  const columnName = tableAlias
    ? `${tableAlias}.${quoteIdentifier(column.name)}`
    : quoteIdentifier(column.name)

  return `${columnName} ${negated ? "NOT " : ""}IN (${placeholders.join(", ")})`
}

function renderValuePlaceholder(column: PGliteColumn, index: number): string {
  const placeholder = `$${index}`
  return column.dataType === "json" || column.dataType === "array"
    ? `${placeholder}::jsonb`
    : placeholder
}

function renderOrderBy(
  orderBy: DAL.OptionsQuery<Record<string, unknown>>["orderBy"] | undefined,
  context: PGliteWhereContext
): string {
  if (!orderBy) {
    return ""
  }

  const entries = orderByEntries(orderBy)

  if (!entries.length) {
    return ""
  }

  const clauses = entries.flatMap(([field, direction]) => {
    if (!isRecord(direction)) {
      requirePGliteColumn(context.table, field)
      return [`${quoteIdentifier(field)} ${normalizeOrderDirection(direction)}`]
    }

    const relationship = context.table.relationships.find(
      (candidate) => candidate.name === field
    )
    if (!relationship) {
      throw new Error(
        `The PGlite repository cannot order by unknown relation ${field}`
      )
    }

    return Object.entries(direction).map(([targetField, targetDirection]) =>
      renderRelationshipOrderBy(
        context,
        relationship,
        targetField,
        targetDirection
      )
    )
  })

  return clauses.length ? ` ORDER BY ${clauses.join(", ")}` : ""
}

function renderRelationshipOrderBy(
  context: PGliteWhereContext,
  relationship: PGliteRelationship,
  targetField: string,
  direction: unknown
): string {
  if (isRecord(direction)) {
    throw new Error(
      `The PGlite repository does not support ordering through nested relation ${relationship.name}.${targetField}`
    )
  }

  const targetTable = compilePGliteTable(relationship.targetModel)
  requirePGliteColumn(targetTable, targetField)
  const outerTable = qualifiedName(context.schemaName, context.table.name)
  let relationCondition: string

  if (ownsSourceForeignKey(relationship)) {
    const targetPrimaryKey = requireSinglePrimaryKey(targetTable)
    requirePGliteColumn(context.table, relationship.foreignKeyName)
    relationCondition = `${quoteIdentifier(
      targetPrimaryKey
    )} = ${outerTable}.${quoteIdentifier(relationship.foreignKeyName)}`
  } else if (
    relationship.type === "hasOne" ||
    relationship.type === "hasMany"
  ) {
    const sourcePrimaryKey = requireSinglePrimaryKey(context.table)
    requirePGliteColumn(targetTable, relationship.foreignKeyName)
    relationCondition = `${quoteIdentifier(
      relationship.foreignKeyName
    )} = ${outerTable}.${quoteIdentifier(sourcePrimaryKey)}`
  } else {
    throw new Error(
      `The PGlite repository does not support ordering through ${relationship.type} relation ${relationship.name}`
    )
  }

  const notDeleted = targetTable.columns.some(
    (column) => column.name === "deleted_at"
  )
    ? ` AND ${quoteIdentifier("deleted_at")} IS NULL`
    : ""
  const normalizedDirection = normalizeOrderDirection(direction)
  const collectionOrderBy =
    relationship.type === "hasMany"
      ? ` ORDER BY ${quoteIdentifier(targetField)} ${normalizedDirection}`
      : ""

  return `(SELECT ${quoteIdentifier(targetField)} FROM ${qualifiedName(
    context.schemaName,
    targetTable.name
  )} WHERE ${relationCondition}${notDeleted}${collectionOrderBy} LIMIT 1) ${normalizedDirection}`
}

function renderHydratedRelationOrderBy(
  targetTable: PGliteTable,
  orderBy: Record<string, unknown>[]
): string {
  const clauses = orderBy.flatMap((entry) =>
    Object.entries(entry).flatMap(([field, direction]) => {
      if (isRecord(direction)) {
        return []
      }

      requirePGliteColumn(targetTable, field)
      return [`${quoteIdentifier(field)} ${normalizeOrderDirection(direction)}`]
    })
  )

  return clauses.length ? ` ORDER BY ${clauses.join(", ")}` : ""
}

function orderByEntries(orderBy: unknown): Array<[string, unknown]> {
  if (Array.isArray(orderBy)) {
    return orderBy.filter(isRecord).flatMap((entry) => Object.entries(entry))
  }

  return isRecord(orderBy) ? Object.entries(orderBy) : []
}

function normalizeOrderDirection(direction: unknown): "ASC" | "DESC" {
  return String(direction).toUpperCase() === "DESC" ? "DESC" : "ASC"
}

function prepareMutationData(
  table: PGliteTable,
  entry: Record<string, unknown>
): Record<string, unknown> {
  const output = { ...entry }
  const now = new Date().toISOString()

  for (const column of table.columns) {
    if (output[column.name] === undefined && column.dataType === "id") {
      const prefix = column.dataTypeOptions?.prefix
      output[column.name] = prefix ? `${prefix}_${ulid()}` : ulid()
    }

    if (
      output[column.name] === undefined &&
      column.defaultValue !== undefined
    ) {
      output[column.name] = column.defaultValue
    }

    if (
      output[column.name] === undefined &&
      column.dataType === "dateTime" &&
      !column.nullable &&
      column.name !== "deleted_at"
    ) {
      output[column.name] = now
    }

    if (column.dataType === "bigNumber" && output[column.name] !== undefined) {
      const rawField = `raw_${column.name}`
      const value = output[column.name]
      if (isPGliteBigNumberInput(value)) {
        const bigNumber = new BigNumber(value)
        output[column.name] = bigNumber.raw?.value ?? bigNumber.numeric
        output[rawField] ??= normalizePGliteBigNumberRaw(bigNumber.raw)
      }

      if (output[rawField] === undefined) {
        output[rawField] = {
          value: String(output[column.name]),
          precision: 20,
        }
      }
    }

    if (
      !column.nullable &&
      column.dataType !== "serial" &&
      output[column.name] === undefined
    ) {
      throw new Error(
        `Value for ${table.modelName}.${column.name} is required, 'undefined' found`
      )
    }
  }

  return output
}

function preserveRequiredPGliteUpsertColumns(
  table: PGliteTable,
  entry: Record<string, unknown>,
  existing: Record<string, unknown>
): Record<string, unknown> {
  const output = { ...entry }

  for (const column of table.columns) {
    if (
      !column.nullable &&
      column.name !== "updated_at" &&
      output[column.name] === undefined &&
      existing[column.name] !== undefined
    ) {
      output[column.name] = existing[column.name]
    }
  }

  return output
}

function prepareUpdateData(
  table: PGliteTable,
  entry: Record<string, unknown>,
  options: {
    touchUpdatedAt?: boolean
  } = {}
): Record<string, unknown> {
  const output = { ...entry }

  if (
    options.touchUpdatedAt !== false &&
    table.columns.some((column) => column.name === "updated_at") &&
    output.updated_at === undefined
  ) {
    output.updated_at = new Date().toISOString()
  }

  for (const column of table.columns) {
    if (column.dataType === "bigNumber" && output[column.name] !== undefined) {
      const rawField = `raw_${column.name}`
      const value = output[column.name]
      if (isPGliteBigNumberInput(value)) {
        const bigNumber = new BigNumber(value)
        output[column.name] = bigNumber.raw?.value ?? bigNumber.numeric
        output[rawField] ??= normalizePGliteBigNumberRaw(bigNumber.raw)
      }

      if (output[rawField] === undefined) {
        output[rawField] = {
          value: String(output[column.name]),
          precision: 20,
        }
      }
    }
  }

  return output
}

function normalizeRow(
  table: PGliteTable,
  row: Record<string, unknown>
): Record<string, unknown> {
  const output = { ...row }

  for (const column of table.columns) {
    const value = output[column.name]

    if (value === null || value === undefined) {
      continue
    }

    if (
      column.dataType === "number" ||
      column.dataType === "bigNumber" ||
      column.dataType === "float"
    ) {
      output[column.name] = Number(value)
      continue
    }

    if (
      (column.dataType === "json" || column.dataType === "array") &&
      typeof value === "string"
    ) {
      output[column.name] = parsePGliteJsonValue(value)
    }
  }

  return output
}

function parsePGliteJsonValue(value: string): unknown {
  const trimmed = value.trim()
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
    return value
  }

  return JSON.parse(trimmed)
}

function normalizePGliteBigNumberRaw(
  raw: { value: string | number; precision?: number } | undefined
): { value: string; precision?: number } | undefined {
  if (!raw) {
    return undefined
  }

  return {
    ...raw,
    value: trimPGliteBigNumberValue(String(raw.value)),
  }
}

function trimPGliteBigNumberValue(value: string): string {
  if (!value.includes(".")) {
    return value
  }

  return value.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "")
}

function isPGliteBigNumberInput(value: unknown): value is BigNumberInput {
  if (
    typeof value === "number" ||
    typeof value === "string" ||
    value instanceof BigNumber ||
    isBigNumberRawValue(value)
  ) {
    return true
  }

  return Boolean(
    value &&
      typeof value === "object" &&
      "toNumber" in value &&
      "toPrecision" in value &&
      typeof value.toNumber === "function" &&
      typeof value.toPrecision === "function"
  )
}

function toDriverValue(column: PGliteColumn, value: unknown): unknown {
  if (value === undefined) {
    return null
  }

  if (
    (column.dataType === "json" || column.dataType === "array") &&
    value !== null
  ) {
    return JSON.stringify(value)
  }

  if (column.dataType === "dateTime" && value instanceof Date) {
    return value.toISOString()
  }

  return value
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value))
}

function toPostgresType(dataType: string): string {
  switch (dataType) {
    case "boolean":
      return "boolean"
    case "dateTime":
      return "timestamptz"
    case "number":
    case "serial":
      return "integer"
    case "bigNumber":
    case "float":
      return "numeric"
    case "array":
    case "json":
      return "jsonb"
    default:
      return "text"
  }
}

function renderDefaultValue(value: unknown): string {
  if (typeof value === "string") {
    return quoteString(value)
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("PGlite migration defaults must be finite numbers")
    }
    return String(value)
  }

  if (typeof value === "boolean") {
    return value ? "true" : "false"
  }

  if (value === null) {
    return "NULL"
  }

  if (typeof value === "object") {
    return quoteString(JSON.stringify(value))
  }

  throw new Error(`Unsupported PGlite migration default type: ${typeof value}`)
}

function qualifiedName(schemaName: string, tableName: string): string {
  return `${quoteIdentifier(schemaName)}.${quoteIdentifier(tableName)}`
}

function quoteString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

function toSnakeCase(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[-\s]+/g, "_")
    .toLowerCase()
}
