import { asValue } from "@medusajs/deps/awilix"
import type {
  Constructor,
  Context,
  BigNumberInput,
  DAL,
  ModulePersistenceAdapter,
  ModulePersistenceModel,
  PerformedActions,
  RepositoryService,
  UpsertWithReplaceConfig,
} from "@medusajs/types"
import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNull,
  like,
  or,
  sql,
} from "drizzle-orm"
import type { BaseSQLiteDatabase, SQLiteColumn } from "drizzle-orm/sqlite-core"
import { applyModelDefaults, getPrimaryKeys } from "@medusajs/dal"
import { trimZeros } from "@medusajs/utils/common/trim-zeros"
import { BigNumber } from "@medusajs/utils/totals/big-number"
import type { PortableEntity, PortableRelationshipMetadata } from "@medusajs/dml"
import {
  compileDmlSchema,
  type DatabaseRelationship,
  type DatabaseTable,
} from "./schema"
import { toDrizzleSqliteTable } from "./sqlite"
import { toDrizzleWhere } from "./repository"
import {
  mapDrizzleMutationError,
  validateUniqueIndexes,
} from "./constraints"
import {
  addPerformedAction,
  createDrizzleEventSubscriber,
  dispatchCascadedUpdateMutations,
  dispatchCreatedMutations,
  dispatchDrizzleMutationEvent,
  dispatchDrizzleMutationRows,
  dispatchPerformedActions,
  emptyPerformedActions,
  registerDrizzleEventSubscriber,
  suppressMutationEventDispatch,
  type CreatedEntityMutation,
} from "./mutation-events"
import {
  isRelationshipMetadata,
  relationshipTargets,
  resolveOptionalRelationshipTarget,
  resolveRelationshipTarget,
} from "./relation-metadata"
import {
  applyInventoryComputedFields,
  createDrizzleInventoryLevelRepository,
} from "./inventory"
import { createDrizzlePricingRepository } from "./pricing"
import { createDrizzleRbacRepository } from "./rbac"
import { prepareDateTimeValue } from "./date-values"

export interface DrizzleMedusaManager {
  database: BaseSQLiteDatabase<"async", unknown>
  transactionMode: "atomic" | "statement"
  transaction<TResult>(
    task: (transactionManager: DrizzleMedusaManager) => Promise<TResult>
  ): Promise<TResult>
  destroy(): Promise<void>
}

type DmlModel = PortableEntity & ModulePersistenceModel
type PopulateTree = Map<string, PopulateTree>
type RelationPopulateWhere = Map<string, Record<string, unknown>>
type RelationPopulateOrder = Map<string, Array<[string, "ASC" | "DESC"]>>
type FieldProjectionTree = {
  fields: Set<string>
  relations: Map<string, FieldProjectionTree>
}
type CreateGraphContext = {
  relationDescriptorsByModel: Map<string, Map<string, RelationDescriptor>>
  tableMetadataByModel: Map<string, DatabaseTable>
  createdMutations: CreatedEntityMutation[]
}
let preparedModuleModels: ModulePersistenceModel[] = []

interface RelationDescriptor {
  relationship: DatabaseRelationship
  sourceModel: PortableEntity
  sourceTable: ReturnType<typeof toDrizzleSqliteTable>
  sourceColumns: Record<string, SQLiteColumn>
  targetModel: PortableEntity
  targetTable: ReturnType<typeof toDrizzleSqliteTable>
  targetColumns: Record<string, SQLiteColumn>
  targetPrimaryKeys: string[]
  sourcePrimaryKeys: string[]
  ownerForeignKeys: string[]
  pivotModel?: PortableEntity
  pivotPrimaryKeys: string[]
  pivotTable?: ReturnType<typeof toDrizzleSqliteTable>
  pivotColumns?: Record<string, SQLiteColumn>
  sourcePivotColumns: string[]
  targetPivotColumns: string[]
  implicitPivot: boolean
}

export const drizzleModulePersistenceAdapter: ModulePersistenceAdapter = {
  name: "drizzle",

  prepareModels(models) {
    preparedModuleModels = models
    return models
  },

  createConnectionLoader() {
    return async function connectionLoader({ container, options }) {
      const manager =
        options && "manager" in options ? options.manager : undefined
      if (!isDrizzleManager(manager)) {
        throw new Error(
          "The Drizzle persistence adapter requires a Drizzle manager"
        )
      }

      container.register({
        manager: asValue(manager),
      })
    }
  },

  createBaseRepository() {
    return asRepositoryConstructor(DrizzleMedusaBaseRepository)
  },

  createRepository(model) {
    if (!isDmlModel(model)) {
      throw new Error("The Drizzle persistence adapter requires DML models")
    }

    if (model.name === "InventoryLevel") {
      return asRepositoryConstructor(
        createDrizzleInventoryLevelRepository(
          model,
          createDrizzleMedusaRepository(model)
        )
      )
    }

    return asRepositoryConstructor(createDrizzleMedusaRepository(model))
  },

  createCustomRepository({ model, moduleModels, repositoryName }) {
    if (repositoryName === "pricingRepository" && moduleModels) {
      return asRepositoryConstructor(
        createDrizzlePricingRepository(moduleModels, DrizzleMedusaBaseRepository)
      )
    }

    if (repositoryName === "rbacRepository" && moduleModels) {
      return asRepositoryConstructor(
        createDrizzleRbacRepository(moduleModels, DrizzleMedusaBaseRepository)
      )
    }

    if (isDmlModel(model) && model.name === "InventoryLevel") {
      return asRepositoryConstructor(
        createDrizzleInventoryLevelRepository(
          model,
          createDrizzleMedusaRepository(model)
        )
      )
    }

    if (model) {
      return this.createRepository(model)
    }

    return undefined
  },

  createEventSubscriber(keys, service) {
    return createDrizzleEventSubscriber(keys, service)
  },

  registerEventSubscriber(context, subscriber) {
    registerDrizzleEventSubscriber(context, subscriber)
  },

  async dispatchMutationEvent(event, args, context, subscriber) {
    await dispatchDrizzleMutationEvent(event, args, context, subscriber)
  },
}

class DrizzleMedusaBaseRepository {
  protected readonly manager_: DrizzleMedusaManager

  constructor({ manager }: { manager: DrizzleMedusaManager }) {
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
    task: (transactionManager: DrizzleMedusaManager) => Promise<TResult>
  ): Promise<TResult> {
    return await this.manager_.transaction(task)
  }

  async serialize<TOutput extends object | object[]>(
    data: TOutput
  ): Promise<TOutput> {
    return data
  }
}

function createDrizzleMedusaRepository(model: DmlModel) {
  const preparedDmlModels = preparedModuleModels.filter(isDmlModel)
  const seedModels = preparedDmlModels.some((entry) => entry.name === model.name)
    ? preparedDmlModels
    : [model]
  const graphModels = uniqueModels([
    model,
    ...seedModels,
    ...seedModels.flatMap((entry) => relationshipTargets(entry)),
  ])
  const compiledSchema = compileDmlSchema(graphModels)
  const compiledTable = compiledSchema.tables[0]
  const tableMetadataByModel = new Map(
    graphModels.map((graphModel, index) => [
      graphModel.name,
      compiledSchema.tables[index],
    ])
  )
  const table = toDrizzleSqliteTable(compiledTable)
  const columns = table as unknown as Record<string, SQLiteColumn>
  const primaryKeys = getPrimaryKeys(model)
  const relationDescriptorsByModel = createRelationDescriptorsByModel(
    graphModels,
    compiledSchema.tables
  )
  const relationDescriptors =
    relationDescriptorsByModel.get(model.name) ?? new Map()

  return class DrizzleMedusaRepository extends DrizzleMedusaBaseRepository {
    async find(
      findOptions: DAL.FindOptions<Record<string, unknown>> = { where: {} },
      contextOrTransformOptions: Context = {},
      maybeContext?: Context
    ) {
      const context = maybeContext ?? contextOrTransformOptions
      const database =
        this.getActiveManager<DrizzleMedusaManager>(context).database
      const options = findOptions.options ?? {}
      const hasExplicitFields = Array.isArray(options.fields)
      const populate = mergePopulatePaths(
        options.populate,
        relationPopulatePathsFromFields(
          options.fields ?? [],
          relationDescriptors,
          relationDescriptorsByModel
        )
      )
      const requestedFields = hasExplicitFields
        ? [
            ...(options.fields ?? []),
            ...foreignKeysRequiredForPopulate(
              populate,
              relationDescriptors
            ),
            ...versionFieldsRequiredForPopulate(populate, relationDescriptors),
          ]
        : []
      const fields = hasExplicitFields
        ? expandSelectedFields(requestedFields, model, primaryKeys).filter(
            (field) => field in columns
          )
        : []
      const selectedFields =
        hasExplicitFields && !fields.length ? primaryKeys : fields
      const selection = selectedFields.length
        ? Object.fromEntries(
            selectedFields.map((field) => [field, columns[field]])
          )
        : undefined
      let query = (selection ? database.select(selection) : database.select())
        .from(table)
        .$dynamic()
      const where = toMedusaDrizzleWhere(
        database,
        columns,
        findOptions.where,
        relationDescriptors,
        relationDescriptorsByModel
      )
      const filterWhere = freeTextSearchWhere(options.filters, model, columns)
      const withDeleted = Boolean(
        options.filters &&
          typeof options.filters === "object" &&
          Object.values(options.filters).some(
            (filter) =>
              filter &&
              typeof filter === "object" &&
              "withDeleted" in filter &&
              filter.withDeleted
          )
      )

      query = query.where(
        "deleted_at" in table && !withDeleted
          ? and(where, filterWhere, isNull(table.deleted_at))
          : and(where, filterWhere)
      )

      const orderingEntries = medusaOrderingEntries(
        model.name,
        columns,
        normalizeOrdering(options.orderBy)
          .filter(([field]) => field in columns)
      )
      const effectiveOrderingEntries = orderingEntries.length
        ? orderingEntries
        : defaultOrderingEntries(model.name, columns)
      const ordering = orderingEntries
        .map(([field, direction]) =>
          direction === "DESC" ? desc(columns[field]) : asc(columns[field])
        )
      if (ordering.length) {
        query = query.orderBy(...ordering)
      } else {
        query = query.orderBy(...defaultOrdering(model.name, columns))
      }
      if (options.limit !== undefined) {
        query = query.limit(options.limit)
      }
      if (options.offset !== undefined) {
        query = query.offset(options.offset)
      }

      const rows = preservePrimaryKeyOrFilterOrder(
        await query,
        findOptions.where,
        primaryKeys,
        effectiveOrderingEntries
      )
      const loadedRows = await loadRelations(
        database,
        rows,
        populate ?? [],
        relationDescriptors,
        relationDescriptorsByModel,
        withDeleted,
        relationPopulateWhere(options),
        relationPopulateOrder(options)
      )
      fillNullToOneRelations(loadedRows, relationDescriptors)
      if (hasExplicitFields) {
        projectLoadedRelations(
          loadedRows,
          options.fields ?? [],
          populate,
          relationDescriptors,
          relationDescriptorsByModel
        )
      }
      await applyInventoryComputedFields(
        database,
        loadedRows,
        model,
        relationDescriptors,
        hasExplicitFields,
        options.fields
      )

      return loadedRows
    }

    async findAndCount(
      findOptions: DAL.FindOptions<Record<string, unknown>> = { where: {} },
      contextOrTransformOptions: Context = {},
      maybeContext?: Context
    ) {
      const context = maybeContext ?? contextOrTransformOptions
      const records = await this.find(findOptions, context)
      const database =
        this.getActiveManager<DrizzleMedusaManager>(context).database
      const where = toMedusaDrizzleWhere(
        database,
        columns,
        findOptions.where,
        relationDescriptors,
        relationDescriptorsByModel
      )
      const result = await database
        .select({ count: sql<number>`count(*)` })
        .from(table)
        .where(and(where, isNull(table.deleted_at)))

      return [records, Number(result[0]?.count ?? 0)] as [
        typeof records,
        number
      ]
    }

    async create(data: object[], context: Context = {}) {
      const manager = this.getActiveManager<DrizzleMedusaManager>(context)
      const records: Record<string, unknown>[] = []
      const createdMutations: CreatedEntityMutation[] = []
      for (const entry of data) {
        records.push(
          await createEntityGraph(
            manager.database,
            entry,
            model,
            compiledTable,
            table,
            columns,
            primaryKeys,
            relationDescriptors,
            relationDescriptorsByModel,
            tableMetadataByModel,
            createdMutations
          )
        )
      }

      await loadRelations(
        manager.database,
        records,
        createPopulatePaths(data, relationDescriptors, relationDescriptorsByModel),
        relationDescriptors,
        relationDescriptorsByModel,
        false
      )
      fillNullToOneRelations(records, relationDescriptors)
      fillEmptyToManyRelations(records, relationDescriptors)
      await applyInventoryComputedFields(
        manager.database,
        records,
        model,
        relationDescriptors,
        false
      )

      await dispatchCreatedMutations(createdMutations, context)

      return records
    }

    async update(
      data: Array<
        | {
            entity: Record<string, unknown>
            update: Record<string, unknown>
          }
        | Record<string, unknown>
      >,
      context: Context = {}
    ) {
      const output: object[] = []
      const populateSources: Record<string, unknown>[] = []
      for (const entry of data) {
        const { entity, update } = normalizeUpdateEntry(entry, primaryKeys)
        const database =
          this.getActiveManager<DrizzleMedusaManager>(context).database
        const whereClause = primaryKeyWhere(columns, primaryKeys, entity)
        const [existing] = await database
          .select()
          .from(table)
          .where(whereClause)
          .limit(1)
        if (!existing) {
          throw new Error(`${model.name} with id: ${entity.id} was not found`)
        }
        const performedActions = emptyPerformedActions()
        const updateData = scalarEntityData(update, model)
        for (const key of primaryKeys) {
          delete updateData[key]
        }
        for (const [relationName, descriptor] of relationDescriptors) {
          if (
            (descriptor.relationship.type !== "belongsTo" &&
              descriptor.relationship.type !== "hasOneWithFK") ||
            !descriptor.ownerForeignKeys.every((key) => key in columns) ||
            update[relationName] === undefined
          ) {
            continue
          }

          await replaceOwnedToOneRelation(
            database,
            updateData,
            update[relationName],
            descriptor,
            performedActions
          )
        }
        const shouldUpdateRoot = Object.keys(updateData).length > 0
        const value = shouldUpdateRoot
          ? preparePersistenceRecord(model, {
              ...existing,
              ...entity,
              ...updateData,
            })
          : existing
        if (shouldUpdateRoot) {
          await validateOwnedForeignKeys(database, value, relationDescriptors)
          await validateUniqueIndexes(
            database,
            compiledTable,
            table,
            columns,
            model,
            [value],
            primaryKeys
          )
        }
        const updatedRows = shouldUpdateRoot
          ? await mapDrizzleMutationError(() =>
            database
              .update(table)
              .set(value)
              .where(whereClause)
              .returning()
          )
          : [existing]
        for (const updatedRow of updatedRows) {
          await replaceCollectionRelationValues(
            database,
            updatedRow,
            update,
            model.name,
            relationDescriptorsByModel,
            performedActions
          )
        }
        output.push(...updatedRows)
        if (shouldUpdateRoot) {
          await dispatchDrizzleMutationRows(
            "afterUpdate",
            model.name,
            updatedRows,
            context,
            (row) => ({
              entity: row,
              originalEntity: existing,
            })
          )
        }
        await dispatchPerformedActions(performedActions, context)
        populateSources.push(update)
      }
      await loadRelations(
        this.getActiveManager<DrizzleMedusaManager>(context).database,
        output as Record<string, unknown>[],
        createPopulatePaths(
          populateSources,
          relationDescriptors,
          relationDescriptorsByModel
        ),
        relationDescriptors,
        relationDescriptorsByModel,
        false
      )
      fillNullToOneRelations(
        output as Record<string, unknown>[],
        relationDescriptors
      )
      await applyInventoryComputedFields(
        this.getActiveManager<DrizzleMedusaManager>(context).database,
        output as Record<string, unknown>[],
        model,
        relationDescriptors,
        false
      )
      return output
    }

    async delete(
      where:
        | DAL.FindOptions<Record<string, unknown>>["where"]
        | string
        | string[],
      context: Context = {}
    ) {
      const database =
        this.getActiveManager<DrizzleMedusaManager>(context).database
      const normalizedWhere =
        typeof where === "string" || Array.isArray(where)
          ? { id: where }
          : where
      const whereClause = toMedusaDrizzleWhere(
        database,
        columns,
        normalizedWhere,
        relationDescriptors,
        relationDescriptorsByModel
      )
      const rowsToDelete = await database.select().from(table).where(whereClause)

      await detachDeletedRelations(database, rowsToDelete, relationDescriptors)
      await detachInboundOwnedToOneRelations(
        database,
        rowsToDelete,
        model.name,
        relationDescriptorsByModel
      )

      const rows = await mapDrizzleMutationError(() =>
        database.delete(table).where(whereClause).returning()
      )
      await dispatchDrizzleMutationRows(
        "afterDelete",
        model.name,
        rows,
        context
      )
      return rows.map((row) => String(row[primaryKeys[0]]))
    }

    async upsert(data: object[], context: Context = {}) {
      const database =
        this.getActiveManager<DrizzleMedusaManager>(context).database
      const output: object[] = []
      for (const entry of data) {
        if (!isRecord(entry)) {
          throw new Error(`Drizzle upsert requires ${model.name} objects`)
        }
        const existing = hasCompletePrimaryKey(entry, primaryKeys)
          ? await database
              .select()
              .from(table)
              .where(primaryKeyWhere(columns, primaryKeys, entry))
              .limit(1)
          : []
        const value = preparePersistenceRecord(model, {
          ...existing[0],
          ...entry,
        })
        const update = Object.fromEntries(
          Object.entries(value).filter(([key]) => !primaryKeys.includes(key))
        )
        const mutatedRows = await mapDrizzleMutationError(() =>
            database
              .insert(table)
              .values(value)
              .onConflictDoUpdate({
                target:
                  primaryKeys.length === 1
                    ? columns[primaryKeys[0]]
                    : primaryKeys.map((key) => columns[key]),
                set: update,
              })
              .returning()
          )
        output.push(...mutatedRows)
        await dispatchDrizzleMutationRows(
          existing.length ? "afterUpdate" : "afterCreate",
          model.name,
          mutatedRows,
          context,
          existing.length
            ? (row) => ({
                entity: row,
                originalEntity: existing[0],
              })
            : undefined
        )
      }
      return output
    }

    async softDelete(
      filters:
        | string
        | string[]
        | DAL.FindOptions<Record<string, unknown>>["where"]
        | DAL.FindOptions<Record<string, unknown>>["where"][],
      context: Context = {}
    ): Promise<[object[], Record<string, unknown[]>]> {
      const where = normalizeMutationFilters(filters, primaryKeys)
      if (!where) {
        return [[], {}]
      }

      const manager = this.getActiveManager<DrizzleMedusaManager>(context)
      const deletedAt = new Date()
      const rows = await mapDrizzleMutationError(() =>
        manager.database
          .update(table)
          .set({ deleted_at: deletedAt, updated_at: deletedAt })
          .where(
            and(
              toMedusaDrizzleWhere(
                manager.database,
                columns,
                where,
                relationDescriptors,
                relationDescriptorsByModel
              ),
              isNull(table.deleted_at)
            )
          )
          .returning()
      )

      const cascadedMap = new Map<string, Record<string, unknown>[]>()
      const visited = new Set<string>()
      addRowsToCascadeMap(cascadedMap, model.name, rows, primaryKeys, visited)
      await updateDeletedAtRecursively(
        manager.database,
        rows,
        relationDescriptors,
        relationDescriptorsByModel,
        deletedAt,
        deletedAt,
        cascadedMap,
        visited
      )

      await dispatchCascadedUpdateMutations(
        Object.fromEntries(cascadedMap),
        context,
        (row) => ({
          entity: row,
          originalEntity: { deleted_at: null },
        })
      )

      return [rows, Object.fromEntries(cascadedMap)]
    }

    async restore(
      filters: string[] | DAL.FindOptions<Record<string, unknown>>["where"],
      context: Context = {}
    ): Promise<[object[], Record<string, unknown[]>]> {
      const where = normalizeMutationFilters(filters, primaryKeys)
      if (!where) {
        return [[], {}]
      }

      const manager = this.getActiveManager<DrizzleMedusaManager>(context)
      const updatedAt = new Date()
      const restoreWhere = toMedusaDrizzleWhere(
        manager.database,
        columns,
        where,
        relationDescriptors,
        relationDescriptorsByModel
      )
      const rowsToRestore = await manager.database
        .select()
        .from(table)
        .where(restoreWhere)
      await validateUniqueIndexes(
        manager.database,
        compiledTable,
        table,
        columns,
        model,
        rowsToRestore.map((row) => ({
          ...row,
          deleted_at: null,
          updated_at: updatedAt,
        })),
        primaryKeys
      )
      const rows = await mapDrizzleMutationError(() =>
        manager.database
          .update(table)
          .set({ deleted_at: null, updated_at: updatedAt })
          .where(restoreWhere)
          .returning()
      )

      const cascadedMap = new Map<string, Record<string, unknown>[]>()
      const visited = new Set<string>()
      addRowsToCascadeMap(cascadedMap, model.name, rows, primaryKeys, visited)
      await updateDeletedAtRecursively(
        manager.database,
        rows,
        relationDescriptors,
        relationDescriptorsByModel,
        null,
        updatedAt,
        cascadedMap,
        visited
      )

      await dispatchCascadedUpdateMutations(
        Object.fromEntries(cascadedMap),
        context,
        (row) => ({
          entity: row,
          originalEntity: { deleted_at: row.deleted_at ?? updatedAt },
        })
      )

      return [rows, Object.fromEntries(cascadedMap)]
    }

    async upsertWithReplace(
      data: Record<string, unknown>[],
      config: UpsertWithReplaceConfig<Record<string, unknown>> = {
        relations: [],
      },
      context: Context = {}
    ): Promise<{
      entities: object[]
      performedActions: PerformedActions
    }> {
      const performedActions = emptyPerformedActions()
      if (!data.length) {
        return { entities: [], performedActions }
      }

      const relationNames = (config.relations ?? []).map(String)
      const selectedRelations = relationNames.map((name) => {
        const descriptor = relationDescriptors.get(name)
        if (!descriptor) {
          throw new Error(
            `Nonexistent relations were passed during upsert: ${name}`
          )
        }
        const supportedManyToMany =
          descriptor.relationship.type === "manyToMany" &&
          descriptor.pivotTable &&
          descriptor.pivotColumns
        const supportedOwnedToOne =
          (descriptor.relationship.type === "belongsTo" ||
            descriptor.relationship.type === "hasOneWithFK") &&
          descriptor.ownerForeignKeys.length ===
            descriptor.targetPrimaryKeys.length &&
          descriptor.ownerForeignKeys.every((key) => key in columns)
        if (
          descriptor.relationship.type !== "hasMany" &&
          !supportedManyToMany &&
          !supportedOwnedToOne
        ) {
          throw new Error(
            `Drizzle upsertWithReplace does not support relation: ${name}`
          )
        }
        return [name, descriptor] as const
      })
      const manager = this.getActiveManager<DrizzleMedusaManager>(context)
      const entities: Record<string, unknown>[] = []

      for (const entry of data) {
        const scalarEntry = scalarEntityData(entry, model)
        for (const [relationName, descriptor] of selectedRelations) {
          if (
            descriptor.relationship.type !== "belongsTo" &&
            descriptor.relationship.type !== "hasOneWithFK"
          ) {
            continue
          }
          const relationValue = entry[relationName]
          if (relationValue === undefined) {
            continue
          }

          await replaceOwnedToOneRelation(
            manager.database,
            scalarEntry,
            relationValue,
            descriptor,
            performedActions
          )
        }
        await validateOwnedForeignKeys(
          manager.database,
          scalarEntry,
          relationDescriptors
        )
        const existing = hasCompletePrimaryKey(scalarEntry, primaryKeys)
          ? await manager.database
              .select()
              .from(table)
              .where(primaryKeyWhere(columns, primaryKeys, scalarEntry))
              .limit(1)
          : []
        const [entityValue] = existing.length
          ? await this.update(
              [{ entity: existing[0], update: scalarEntry }],
              suppressMutationEventDispatch(context)
            )
          : await this.create(
              [scalarEntry],
              suppressMutationEventDispatch(context)
            )
        if (!isRecord(entityValue)) {
          continue
        }
        const entity = entityValue
        entities.push(entity)
        addPerformedAction(
          performedActions,
          existing.length ? "updated" : "created",
          model.name,
          entity,
          primaryKeys
        )

        for (const [relationName, descriptor] of selectedRelations) {
          const relationValue = entry[relationName]
          if (relationValue === undefined) {
            continue
          }
          if (
            descriptor.relationship.type === "belongsTo" ||
            descriptor.relationship.type === "hasOneWithFK"
          ) {
            continue
          }
          if (!Array.isArray(relationValue)) {
            throw new Error(
              `Drizzle upsertWithReplace relation "${relationName}" must be an array`
            )
          }

          if (descriptor.relationship.type === "hasMany") {
            await replaceHasManyRelation(
              manager.database,
              entity,
              relationValue,
              descriptor,
              performedActions,
              relationDescriptorsByModel
            )
          } else if (descriptor.implicitPivot) {
            await replaceImplicitManyToManyRelation(
              manager.database,
              entity,
              relationValue,
              descriptor
            )
          } else {
            await replaceExplicitManyToManyRelation(
              manager.database,
              entity,
              relationValue,
              descriptor
            )
          }
        }
      }

      await loadRelations(
        manager.database,
        entities,
        relationNames,
        relationDescriptors,
        relationDescriptorsByModel,
        false
      )
      fillNullToOneRelations(entities, relationDescriptors)

      await dispatchPerformedActions(performedActions, context)
      await applyInventoryComputedFields(
        manager.database,
        entities,
        model,
        relationDescriptors,
        false
      )

      return { entities, performedActions }
    }
  }
}

async function createEntityGraph(
  database: BaseSQLiteDatabase<"async", unknown>,
  entry: object,
  model: DmlModel,
  tableMetadata: DatabaseTable,
  table: ReturnType<typeof toDrizzleSqliteTable>,
  columns: Record<string, SQLiteColumn>,
  primaryKeys: string[],
  relationDescriptors: Map<string, RelationDescriptor>,
  relationDescriptorsByModel: Map<string, Map<string, RelationDescriptor>>,
  tableMetadataByModel: Map<string, DatabaseTable>,
  createdMutations: CreatedEntityMutation[] = []
): Promise<Record<string, unknown>> {
  if (!isRecord(entry)) {
    throw new Error(`Drizzle create requires ${model.name} objects`)
  }

  const scalarEntry = scalarEntityData(entry, model)
  for (const [relationName, descriptor] of relationDescriptors) {
    if (
      (descriptor.relationship.type !== "belongsTo" &&
        descriptor.relationship.type !== "hasOneWithFK") ||
      !descriptor.ownerForeignKeys.every((key) => key in columns) ||
      entry[relationName] === undefined
    ) {
      continue
    }

    await replaceOwnedToOneRelation(
      database,
      scalarEntry,
      entry[relationName],
      descriptor,
      emptyPerformedActions(),
      {
        relationDescriptorsByModel,
        tableMetadataByModel,
        createdMutations,
      }
    )
  }

  const value = preparePersistenceRecord(model, scalarEntry)
  await applyGeneratedSerialValues(
    database,
    model,
    table,
    columns,
    primaryKeys,
    value
  )
  await validateUniqueIndexes(
    database,
    tableMetadata,
    table,
    columns,
    model,
    [value],
    primaryKeys
  )
  const [created] = await mapDrizzleMutationError(() =>
    database.insert(table).values(value).returning()
  )
  createdMutations.push({
    modelName: model.name,
    entity: created,
  })

  await createNestedRelations(
    database,
    created,
    entry,
    relationDescriptors,
    relationDescriptorsByModel,
    tableMetadataByModel,
    createdMutations
  )

  return created
}

async function createNestedRelations(
  database: BaseSQLiteDatabase<"async", unknown>,
  source: Record<string, unknown>,
  entry: Record<string, unknown>,
  relationDescriptors: Map<string, RelationDescriptor>,
  relationDescriptorsByModel: Map<string, Map<string, RelationDescriptor>>,
  tableMetadataByModel: Map<string, DatabaseTable>,
  createdMutations: CreatedEntityMutation[]
): Promise<void> {
  for (const [relationName, descriptor] of relationDescriptors) {
    const relationValue = entry[relationName]
    if (relationValue === undefined) {
      continue
    }

    if (descriptor.relationship.type === "hasMany") {
      const relationTargets = Array.isArray(relationValue)
        ? relationValue
        : isRecord(relationValue)
          ? [relationValue]
          : undefined

      if (!relationTargets) {
        throw new Error(
          `Drizzle create relation "${relationName}" must be an array or object`
        )
      }

      if (
        relationTargets.every((target) =>
          isRecordWithCompletePrimaryKey(target, descriptor.targetPrimaryKeys)
        )
      ) {
        const targetWhere = tupleWhere(
          relationTargets,
          descriptor.targetPrimaryKeys,
          descriptor.targetColumns,
          descriptor.targetPrimaryKeys
        )
        const existingTargets = targetWhere
          ? await database
              .select()
              .from(descriptor.targetTable)
              .where(targetWhere)
          : []

        if (existingTargets.length === relationTargets.length) {
          await replaceHasManyRelation(
            database,
            source,
            relationTargets.map((target) =>
              scalarEntityData(target, descriptor.targetModel)
            ),
            descriptor,
            emptyPerformedActions(),
            relationDescriptorsByModel
          )
          continue
        }
      }

      for (const target of relationTargets) {
        if (!isRecord(target)) {
          throw new Error(
            `Drizzle create relation "${relationName}" requires child objects`
          )
        }

        const targetMetadata = tableMetadataByModel.get(
          descriptor.targetModel.name
        )
        if (!targetMetadata) {
          throw new Error(
            `Drizzle create is missing table metadata for "${descriptor.targetModel.name}"`
          )
        }

        await createEntityGraph(
          database,
          {
            ...withInheritedContextFields(
              target,
              source,
              descriptor.targetModel,
              descriptor.targetPrimaryKeys
            ),
            ...Object.fromEntries(
              descriptor.ownerForeignKeys.map((key, index) => [
                key,
                source[descriptor.sourcePrimaryKeys[index]],
              ])
            ),
          },
          descriptor.targetModel,
          targetMetadata,
          descriptor.targetTable,
          descriptor.targetColumns,
          descriptor.targetPrimaryKeys,
          relationDescriptorsByModel.get(descriptor.targetModel.name) ??
            new Map(),
          relationDescriptorsByModel,
          tableMetadataByModel,
          createdMutations
        )
      }
    } else if (descriptor.relationship.type === "manyToMany") {
      if (!Array.isArray(relationValue)) {
        throw new Error(
          `Drizzle create relation "${relationName}" must be an array`
        )
      }

      const normalizedTargets = normalizeManyToManyTargets(
        relationValue,
        descriptor.targetPrimaryKeys
      )

      if (descriptor.implicitPivot) {
        await replaceImplicitManyToManyRelation(
          database,
          source,
          normalizedTargets,
          descriptor
        )
      } else {
        await replaceExplicitManyToManyRelation(
          database,
          source,
          normalizedTargets,
          descriptor
        )
      }
    }
  }
}

function normalizeManyToManyTargets(
  targets: unknown[],
  targetPrimaryKeys: string[]
): Record<string, unknown>[] {
  if (targetPrimaryKeys.length !== 1) {
    return targets.map((target) => {
      if (!isRecord(target)) {
        throw new Error(
          "Drizzle many-to-many relation requires target objects for composite primary keys"
        )
      }

      return target
    })
  }

  return targets.map((target) => {
    if (isRecord(target)) {
      return target
    }

    return {
      [targetPrimaryKeys[0]]: target,
    }
  })
}

function createPopulatePaths(
  entries: object[],
  relationDescriptors: Map<string, RelationDescriptor>,
  relationDescriptorsByModel: Map<string, Map<string, RelationDescriptor>>
): string[] {
  const paths = new Set<string>()

  for (const entry of entries) {
    if (!isRecord(entry)) {
      continue
    }

    collectPopulatePaths(
      entry,
      relationDescriptors,
      relationDescriptorsByModel,
      "",
      paths
    )
  }

  return [...paths]
}

function collectPopulatePaths(
  entry: Record<string, unknown>,
  relationDescriptors: Map<string, RelationDescriptor>,
  relationDescriptorsByModel: Map<string, Map<string, RelationDescriptor>>,
  prefix: string,
  paths: Set<string>
): void {
  for (const [relationName, descriptor] of relationDescriptors) {
    const relationValue = entry[relationName]
    if (relationValue === undefined) {
      continue
    }

    const path = prefix ? `${prefix}.${relationName}` : relationName
    paths.add(path)

    const nestedDescriptors =
      relationDescriptorsByModel.get(descriptor.targetModel.name) ?? new Map()
    if (!nestedDescriptors.size) {
      continue
    }

    for (const target of Array.isArray(relationValue)
      ? relationValue
      : [relationValue]) {
      if (isRecord(target)) {
        collectPopulatePaths(
          target,
          nestedDescriptors,
          relationDescriptorsByModel,
          path,
          paths
        )
      }
    }
  }
}

function normalizeUpdateEntry(
  entry:
    | {
        entity: Record<string, unknown>
        update: Record<string, unknown>
      }
    | Record<string, unknown>,
  primaryKeys: string[]
): {
  entity: Record<string, unknown>
  update: Record<string, unknown>
} {
  if (
    "entity" in entry &&
    isRecord(entry.entity) &&
    "update" in entry &&
    isRecord(entry.update)
  ) {
    return {
      entity: entry.entity,
      update: entry.update,
    }
  }

  const entity = Object.fromEntries(
    primaryKeys.map((key) => [key, entry[key]])
  )
  const update = { ...entry }
  for (const key of primaryKeys) {
    delete update[key]
  }

  return {
    entity,
    update,
  }
}

function isDmlModel(
  model: ModulePersistenceModel | undefined
): model is DmlModel {
  return Boolean(
    model &&
      typeof model === "object" &&
      "parse" in model &&
      typeof model.parse === "function" &&
      "schema" in model
  )
}

function uniqueModels(models: DmlModel[]): DmlModel[] {
  const seen = new Set<string>()
  return models.filter((model) => {
    if (seen.has(model.name)) {
      return false
    }

    seen.add(model.name)
    return true
  })
}

function preparePersistenceRecord(
  entity: PortableEntity,
  input: object
): Record<string, unknown> {
  const output = applyModelDefaults(entity, input) as Record<string, unknown>

  for (const [fieldName, member] of Object.entries(entity.parse().schema)) {
    const metadata = member.parse(fieldName)
    if (!("dataType" in metadata)) {
      continue
    }

    const value = output[fieldName]
    if (
      !metadata.nullable &&
      !metadata.computed &&
      metadata.dataType.name !== "serial" &&
      (value === undefined || value === null)
    ) {
      throw new Error(
        `Value for ${entity.name}.${fieldName} is required, '${String(value)}' found`
      )
    }

    if (metadata.dataType.name === "dateTime" && value !== undefined) {
      output[fieldName] = prepareDateTimeValue(entity.name, fieldName, value)
      continue
    }

    if (metadata.dataType.name !== "bigNumber" || value === undefined) {
      continue
    }

    const rawFieldName = `raw_${fieldName}`
    if (value === null) {
      output[rawFieldName] = null
      continue
    }
    if (!isBigNumberInput(value)) {
      throw new Error(`Cannot set value ${String(value)} for ${fieldName}.`)
    }

    const precision = rawPrecision(output[rawFieldName])
    const bigNumber = new BigNumber(value, { precision })
    const raw = bigNumber.raw
    if (!raw) {
      throw new Error(`Cannot derive raw value for ${fieldName}.`)
    }

    output[fieldName] = bigNumber.numeric
    output[rawFieldName] = {
      ...raw,
      value: trimZeros(String(raw.value)),
    }
  }

  return output
}

function withInheritedContextFields(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
  targetModel: PortableEntity,
  targetPrimaryKeys: string[]
): Record<string, unknown> {
  const output = { ...target }
  const targetFields = new Set(Object.keys(targetModel.parse().schema))

  for (const [field, value] of Object.entries(source)) {
    if (
      targetPrimaryKeys.includes(field) ||
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

async function applyGeneratedSerialValues(
  database: BaseSQLiteDatabase<"async", unknown>,
  entity: PortableEntity,
  table: ReturnType<typeof toDrizzleSqliteTable>,
  columns: Record<string, SQLiteColumn>,
  primaryKeys: string[],
  output: Record<string, unknown>
): Promise<void> {
  for (const [fieldName, member] of Object.entries(entity.parse().schema)) {
    const metadata = member.parse(fieldName)
    if (
      !("dataType" in metadata) ||
      metadata.dataType.name !== "serial" ||
      primaryKeys.includes(fieldName) ||
      (output[fieldName] !== undefined && output[fieldName] !== null)
    ) {
      continue
    }

    const column = columns[fieldName]
    if (!column) {
      continue
    }

    const [row] = await database
      .select({ next: sql<number>`coalesce(max(${column}), 0) + 1` })
      .from(table)

    output[fieldName] = Number(row?.next ?? 1)
  }
}

function rawPrecision(value: unknown): number | undefined {
  return isRecord(value) && typeof value.precision === "number"
    ? value.precision
    : undefined
}

function isBigNumberInput(value: unknown): value is BigNumberInput {
  if (typeof value === "string" || typeof value === "number") {
    return true
  }
  if (!isRecord(value)) {
    return false
  }

  return (
    (("value" in value &&
      (typeof value.value === "string" || typeof value.value === "number")) ||
      ("numeric" in value &&
        typeof value.numeric === "number" &&
        typeof value.toJSON === "function" &&
        typeof value.valueOf === "function") ||
      (typeof value.toNumber === "function" &&
        typeof value.toPrecision === "function"))
  )
}

function isDrizzleManager(value: unknown): value is DrizzleMedusaManager {
  return Boolean(
    value &&
      typeof value === "object" &&
      "database" in value &&
      "destroy" in value
  )
}

function normalizeOrdering(
  orderBy: DAL.OptionsQuery<Record<string, unknown>>["orderBy"]
): Array<[string, "ASC" | "DESC"]> {
  if (!orderBy) {
    return []
  }

  return (Array.isArray(orderBy) ? orderBy : [orderBy]).flatMap(
    (order) =>
      Object.entries(order).map(([field, direction]) => [
        field,
        String(direction).toUpperCase() === "DESC" ? "DESC" : "ASC",
      ] as [string, "ASC" | "DESC"])
  )
}

function medusaOrderingEntries(
  modelName: string,
  columns: Record<string, SQLiteColumn>,
  ordering: Array<[string, "ASC" | "DESC"]>
): Array<[string, "ASC" | "DESC"]> {
  if (
    modelName === "Order" &&
    "display_id" in columns &&
    ordering.length === 1 &&
    ordering[0][0] === "id" &&
    ordering[0][1] === "ASC"
  ) {
    return [["display_id", "ASC"]]
  }

  return ordering
}

function preservePrimaryKeyOrFilterOrder(
  rows: Record<string, unknown>[],
  where: unknown,
  primaryKeys: string[],
  ordering: Array<[string, "ASC" | "DESC"]>
): Record<string, unknown>[] {
  if (
    primaryKeys.length !== 1 ||
    !canPreservePrimaryKeyOrFilterOrder(ordering, primaryKeys[0])
  ) {
    return rows
  }

  const orderedPrimaryKeys = primaryKeyOrderFromFilter(where, primaryKeys[0])
  if (!orderedPrimaryKeys.length) {
    return rows
  }

  const orderByPrimaryKey = new Map(
    orderedPrimaryKeys.map((primaryKey, index) => [primaryKey, index])
  )

  return rows.sort((left, right) => {
    const leftOrder = orderByPrimaryKey.get(String(left[primaryKeys[0]]))
    const rightOrder = orderByPrimaryKey.get(String(right[primaryKeys[0]]))
    if (leftOrder === undefined && rightOrder === undefined) {
      return 0
    }
    if (leftOrder === undefined) {
      return 1
    }
    if (rightOrder === undefined) {
      return -1
    }

    return leftOrder - rightOrder
  })
}

function canPreservePrimaryKeyOrFilterOrder(
  ordering: Array<[string, "ASC" | "DESC"]>,
  primaryKey: string
): boolean {
  return (
    !ordering.length ||
    (ordering.length === 1 &&
      ordering[0][0] === primaryKey &&
      ordering[0][1] === "ASC")
  )
}

function primaryKeyOrderFromFilter(
  where: unknown,
  primaryKey: string
): string[] {
  if (!isRecord(where)) {
    return []
  }

  const orFilter = where.$or
  if (Array.isArray(orFilter)) {
    return orFilter.flatMap((entry) =>
      primaryKeyOrderFromFilter(entry, primaryKey)
    )
  }

  const value = where[primaryKey]
  if (Array.isArray(value)) {
    return value
      .filter((entry) => typeof entry === "string" || typeof entry === "number")
      .map(String)
  }
  if (typeof value === "string" || typeof value === "number") {
    return [String(value)]
  }

  return []
}

function freeTextSearchWhere(
  filters: DAL.OptionsQuery<Record<string, unknown>>["filters"],
  model: PortableEntity,
  columns: Record<string, SQLiteColumn>
) {
  if (!filters || typeof filters !== "object") {
    return undefined
  }

  const search = Object.entries(filters).find(
    ([key, value]) =>
      key.startsWith("freeTextSearch_") &&
      isRecord(value) &&
      value.fromEntity === model.name &&
      typeof value.value === "string"
  )?.[1]

  if (!isRecord(search) || typeof search.value !== "string") {
    return undefined
  }

  const searchable = searchableColumns(model, columns)
  if (!searchable.length) {
    return undefined
  }

  const pattern = `%${search.value}%`
  return or(...searchable.map((column) => like(column, pattern)))
}

function searchableColumns(
  model: PortableEntity,
  columns: Record<string, SQLiteColumn>
): SQLiteColumn[] {
  return Object.entries(model.parse().schema).flatMap(([fieldName, member]) => {
    const metadata = member.parse(fieldName)
    if (
      "dataType" in metadata &&
      metadata.dataType.options?.searchable &&
      fieldName in columns
    ) {
      return [columns[fieldName]]
    }

    return []
  })
}

function foreignKeysRequiredForPopulate(
  populate: string[] | boolean | undefined,
  descriptors: Map<string, RelationDescriptor>
): string[] {
  return [...toPopulateTree(expandPopulateWildcards(populate, descriptors)).keys()].flatMap((relationName) => {
    const descriptor = descriptors.get(relationName)
    if (
      !descriptor ||
      (descriptor.relationship.type !== "belongsTo" &&
        descriptor.relationship.type !== "hasOneWithFK")
    ) {
      return []
    }

    return descriptor.ownerForeignKeys
  })
}

function versionFieldsRequiredForPopulate(
  populate: string[] | boolean | undefined,
  descriptors: Map<string, RelationDescriptor>
): string[] {
  return [...toPopulateTree(expandPopulateWildcards(populate, descriptors)).keys()]
    .flatMap((relationName) => {
      const descriptor = descriptors.get(relationName)
      if (!descriptor) {
        return []
      }

      const requiredVersion = versionedRelationSourceField(
        relationName,
        descriptor
      )

      return requiredVersion ? [requiredVersion] : []
    })
}

function expandSelectedFields(
  fields: string[],
  model: DmlModel,
  primaryKeys: string[]
): string[] {
  const schema = model.parse().schema
  return Array.from(
    new Set(
      [...primaryKeys, ...fields].flatMap((field) => {
        if (`raw_${field}` in schema) {
          return [field, `raw_${field}`]
        }
        if (field.startsWith("raw_") && field.slice(4) in schema) {
          return [field.slice(4), field]
        }

        return [field]
      })
    )
  )
}

function createRelationDescriptorsByModel(
  models: PortableEntity[],
  tables: DatabaseTable[]
): Map<string, Map<string, RelationDescriptor>> {
  return new Map(
    models.map((entity, index) => [
      entity.name,
      createRelationDescriptors(
        entity,
        getPrimaryKeys(entity),
        tables[index],
        tables
      ),
    ])
  )
}

function createRelationDescriptors(
  model: PortableEntity,
  primaryKeys: string[],
  currentTable: DatabaseTable,
  tables: DatabaseTable[]
): Map<string, RelationDescriptor> {
  const descriptors = new Map<string, RelationDescriptor>()
  const sourceTable = toDrizzleSqliteTable(currentTable)
  const sourceColumns = sourceTable as unknown as Record<string, SQLiteColumn>
  const relationshipMetadataByName = new Map(
    Object.entries(model.parse().schema)
      .map(
        ([fieldName, member]) => [fieldName, member.parse(fieldName)] as const
      )
      .filter(
        (entry): entry is readonly [string, PortableRelationshipMetadata] =>
          isRelationshipMetadata(entry[1])
      )
  )

  for (const relationship of currentTable.relationships) {
    const metadata = relationshipMetadataByName.get(relationship.name)
    if (!metadata) {
      continue
    }

    const targetModel = resolveRelationshipTarget(metadata.entity)
    const targetTableMetadata = tables.find(
      (candidate) => candidate.name === relationship.targetTable
    )
    if (!targetTableMetadata) {
      continue
    }

    const targetTable = toDrizzleSqliteTable(targetTableMetadata)
    const targetColumns = targetTable as unknown as Record<string, SQLiteColumn>
    const pivotModel = resolveOptionalRelationshipTarget(
      metadata.options.pivotEntity
    )
    const pivotPrimaryKeys = pivotModel ? getPrimaryKeys(pivotModel) : []
    const pivotTableMetadata = relationship.pivotTable
      ? tables.find((candidate) => candidate.name === relationship.pivotTable)
      : undefined
    const pivotTable = pivotTableMetadata
      ? toDrizzleSqliteTable(pivotTableMetadata)
      : undefined
    const pivotColumns = pivotTable
      ? (pivotTable as unknown as Record<string, SQLiteColumn>)
      : undefined
    const sourcePivotForeignKey = pivotTableMetadata?.foreignKeys.find(
      (foreignKey) =>
        foreignKey.referencedTable === currentTable.name &&
        foreignKey.referencedColumns.length === primaryKeys.length &&
        foreignKey.referencedColumns.every(
          (key, index) => primaryKeys[index] === key
        )
    )
    const targetPrimaryKeys = getPrimaryKeys(targetModel)
    const targetPivotForeignKey = pivotTableMetadata?.foreignKeys.find(
      (foreignKey) =>
        foreignKey.referencedTable === targetTableMetadata.name &&
        foreignKey.referencedColumns.length === targetPrimaryKeys.length &&
        foreignKey.referencedColumns.every(
          (key, index) => targetPrimaryKeys[index] === key
        )
    )
    const inverseRelationship = relationship.mappedBy
      ? targetTableMetadata.relationships.find(
          (candidate) =>
            candidate.name === relationship.mappedBy &&
            candidate.targetTable === currentTable.name
        )
      : undefined

    descriptors.set(relationship.name, {
      relationship,
      sourceModel: model,
      sourceTable,
      sourceColumns,
      targetModel,
      targetTable,
      targetColumns,
      targetPrimaryKeys,
      sourcePrimaryKeys: primaryKeys,
      ownerForeignKeys:
        relationship.foreignKeyNames ??
        currentTable.foreignKeys.find(
          (foreignKey) =>
            foreignKey.referencedTable === relationship.targetTable &&
            foreignKey.referencedColumns.length === targetPrimaryKeys.length &&
            foreignKey.referencedColumns.every(
              (key, index) => targetPrimaryKeys[index] === key
            )
        )?.columns ??
        inverseRelationship?.foreignKeyNames ??
        targetTableMetadata.foreignKeys.find(
          (foreignKey) =>
            foreignKey.referencedTable === currentTable.name &&
            foreignKey.referencedColumns.length === primaryKeys.length &&
            foreignKey.referencedColumns.every(
              (key, index) => primaryKeys[index] === key
            )
        )?.columns ??
        [],
      ...(pivotModel
        ? {
            pivotModel,
          }
        : {}),
      pivotPrimaryKeys,
      ...(pivotTable && pivotColumns
        ? {
            pivotTable,
            pivotColumns,
          }
        : {}),
      sourcePivotColumns: sourcePivotForeignKey?.columns ?? [],
      targetPivotColumns: targetPivotForeignKey?.columns ?? [],
      implicitPivot: Boolean(
        pivotTableMetadata && !pivotTableMetadata.relationships.length
      ),
    })
  }

  return descriptors
}

async function updateDeletedAtRecursively(
  database: BaseSQLiteDatabase<"async", unknown>,
  rows: Record<string, unknown>[],
  descriptors: Map<string, RelationDescriptor>,
  descriptorsByModel: Map<string, Map<string, RelationDescriptor>>,
  deletedAt: Date | null,
  updatedAt: Date,
  cascadedMap: Map<string, Record<string, unknown>[]>,
  visited: Set<string>
): Promise<void> {
  if (!rows.length) {
    return
  }

  for (const descriptor of descriptors.values()) {
    if (
      !descriptor.relationship.cascadeDelete ||
      !descriptor.ownerForeignKeys.length
    ) {
      continue
    }

    const cascadedRows = await updateRelationDeletedAt(
      database,
      rows,
      descriptor,
      deletedAt,
      updatedAt
    )
    const newRows = addRowsToCascadeMap(
      cascadedMap,
      descriptor.relationship.targetModel,
      cascadedRows,
      descriptor.targetPrimaryKeys,
      visited
    )
    const targetDescriptors =
      descriptorsByModel.get(descriptor.relationship.targetModel) ?? new Map()

    await updateDeletedAtRecursively(
      database,
      newRows,
      targetDescriptors,
      descriptorsByModel,
      deletedAt,
      updatedAt,
      cascadedMap,
      visited
    )
  }
}

async function updateRelationDeletedAt(
  database: BaseSQLiteDatabase<"async", unknown>,
  rows: Record<string, unknown>[],
  descriptor: RelationDescriptor,
  deletedAt: Date | null,
  updatedAt: Date
): Promise<Record<string, unknown>[]> {
  if (!("deleted_at" in descriptor.targetTable)) {
    return []
  }

  const where = cascadeRelationWhere(rows, descriptor)
  if (!where) {
    return []
  }

  return await mapDrizzleMutationError(() =>
    database
      .update(descriptor.targetTable)
      .set({ deleted_at: deletedAt, updated_at: updatedAt })
      .where(where)
      .returning()
  )
}

function cascadeRelationWhere(
  rows: Record<string, unknown>[],
  descriptor: RelationDescriptor
) {
  if (!descriptor.ownerForeignKeys.length) {
    return undefined
  }

  if (descriptor.relationship.type === "hasMany") {
    return tupleWhere(
      rows,
      descriptor.sourcePrimaryKeys,
      descriptor.targetColumns,
      descriptor.ownerForeignKeys
    )
  }

  if (
    descriptor.relationship.type === "belongsTo" ||
    descriptor.relationship.type === "hasOneWithFK"
  ) {
    return tupleWhere(
      rows,
      descriptor.ownerForeignKeys,
      descriptor.targetColumns,
      descriptor.targetPrimaryKeys
    )
  }

  return undefined
}

async function detachDeletedRelations(
  database: BaseSQLiteDatabase<"async", unknown>,
  rows: Record<string, unknown>[],
  descriptors: Map<string, RelationDescriptor>
): Promise<void> {
  if (!rows.length) {
    return
  }

  for (const descriptor of descriptors.values()) {
    if (
      descriptor.relationship.type === "hasMany" &&
      !descriptor.relationship.cascadeDelete &&
      descriptor.ownerForeignKeys.length === descriptor.sourcePrimaryKeys.length
    ) {
      const where = tupleWhere(
        rows,
        descriptor.sourcePrimaryKeys,
        descriptor.targetColumns,
        descriptor.ownerForeignKeys
      )
      if (where) {
        await mapDrizzleMutationError(() =>
          database
            .update(descriptor.targetTable)
            .set(
              Object.fromEntries(
                descriptor.ownerForeignKeys.map((key) => [key, null])
              )
            )
            .where(where)
        )
      }
      continue
    }

    if (
      !descriptor.relationship.cascadeDetach ||
      descriptor.relationship.type !== "manyToMany" ||
      !descriptor.pivotTable ||
      !descriptor.pivotColumns ||
      descriptor.sourcePivotColumns.length !==
        descriptor.sourcePrimaryKeys.length
    ) {
      continue
    }

    const where = tupleWhere(
      rows,
      descriptor.sourcePrimaryKeys,
      descriptor.pivotColumns,
      descriptor.sourcePivotColumns
    )
    if (!where) {
      continue
    }

    const pivotTable = descriptor.pivotTable
    await mapDrizzleMutationError(() =>
      database.delete(pivotTable).where(where)
    )
  }
}

async function detachInboundOwnedToOneRelations(
  database: BaseSQLiteDatabase<"async", unknown>,
  rows: Record<string, unknown>[],
  targetModelName: string,
  descriptorsByModel: Map<string, Map<string, RelationDescriptor>>
): Promise<void> {
  if (!rows.length) {
    return
  }

  for (const descriptors of descriptorsByModel.values()) {
    for (const descriptor of descriptors.values()) {
      if (
        descriptor.targetModel.name !== targetModelName ||
        descriptor.relationship.type !== "hasOneWithFK" ||
        descriptor.ownerForeignKeys.length !==
          descriptor.targetPrimaryKeys.length
      ) {
        continue
      }

      const where = tupleWhere(
        rows,
        descriptor.targetPrimaryKeys,
        descriptor.sourceColumns,
        descriptor.ownerForeignKeys
      )
      if (!where) {
        continue
      }

      if (descriptor.relationship.nullable) {
        await mapDrizzleMutationError(() =>
          database
            .update(descriptor.sourceTable)
            .set(
              Object.fromEntries(
                descriptor.ownerForeignKeys.map((key) => [key, null])
              )
            )
            .where(where)
        )
      } else {
        await mapDrizzleMutationError(() =>
          database.delete(descriptor.sourceTable).where(where)
        )
      }
    }
  }
}

function addRowsToCascadeMap(
  cascadedMap: Map<string, Record<string, unknown>[]>,
  modelName: string,
  rows: Record<string, unknown>[],
  primaryKeys: string[],
  visited: Set<string>
): Record<string, unknown>[] {
  const newRows: Record<string, unknown>[] = []
  const existing = cascadedMap.get(modelName) ?? []

  for (const row of rows) {
    const rowKey = cascadeRowKey(modelName, row, primaryKeys)
    if (visited.has(rowKey)) {
      continue
    }

    visited.add(rowKey)
    existing.push(row)
    newRows.push(row)
  }

  if (existing.length) {
    cascadedMap.set(modelName, existing)
  }

  return newRows
}

function cascadeRowKey(
  modelName: string,
  row: Record<string, unknown>,
  primaryKeys: string[]
): string {
  return `${modelName}:${primaryKeys.map((key) => String(row[key])).join(":")}`
}

async function loadRelations(
  database: BaseSQLiteDatabase<"async", unknown>,
  rows: Record<string, unknown>[],
  populate: string[] | boolean | undefined,
  descriptors: Map<string, RelationDescriptor>,
  descriptorsByModel: Map<string, Map<string, RelationDescriptor>>,
  withDeleted: boolean,
  populateWhere: RelationPopulateWhere = new Map(),
  populateOrder: RelationPopulateOrder = new Map()
): Promise<Record<string, unknown>[]> {
  const populateTree = toPopulateTree(
    expandOwnedToOnePopulate(
      expandPopulateWildcards(populate, descriptors),
      descriptors,
      descriptorsByModel
    )
  )
  if (!rows.length || !populateTree.size) {
    return rows
  }

  await loadRelationsFromTree(
    database,
    rows,
    populateTree,
    descriptors,
    descriptorsByModel,
    withDeleted,
    populateWhere,
    populateOrder
  )

  return rows
}

function fillNullToOneRelations(
  rows: Record<string, unknown>[],
  descriptors: Map<string, RelationDescriptor>
): void {
  for (const row of rows) {
    for (const [relationName, descriptor] of descriptors) {
      if (
        relationName in row ||
        (descriptor.relationship.type !== "belongsTo" &&
          descriptor.relationship.type !== "hasOneWithFK") ||
        !descriptor.relationship.nullable ||
        !descriptor.ownerForeignKeys.length
      ) {
        continue
      }

      if (
        descriptor.ownerForeignKeys.every(
          (foreignKey) => row[foreignKey] === null
        )
      ) {
        row[relationName] = null
      }
    }
  }
}

function fillEmptyToManyRelations(
  rows: Record<string, unknown>[],
  descriptors: Map<string, RelationDescriptor>
): void {
  for (const row of rows) {
    for (const [relationName, descriptor] of descriptors) {
      if (
        relationName in row ||
        (descriptor.relationship.type !== "hasMany" &&
          descriptor.relationship.type !== "manyToMany")
      ) {
        continue
      }

      row[relationName] = []
    }
  }
}

async function loadRelationsFromTree(
  database: BaseSQLiteDatabase<"async", unknown>,
  rows: Record<string, unknown>[],
  populateTree: PopulateTree,
  descriptors: Map<string, RelationDescriptor>,
  descriptorsByModel: Map<string, Map<string, RelationDescriptor>>,
  withDeleted: boolean,
  populateWhere: RelationPopulateWhere,
  populateOrder: RelationPopulateOrder
): Promise<void> {
  for (const [relationName, nestedPopulate] of populateTree) {
    const descriptor = descriptors.get(relationName)
    if (!descriptor) {
      continue
    }

    let relatedRows: Record<string, unknown>[] = []
    if (
      descriptor.relationship.type === "belongsTo" ||
      descriptor.relationship.type === "hasOneWithFK"
    ) {
      relatedRows = await loadToOneRelation(
        database,
        rows,
        relationName,
        descriptor,
        withDeleted,
        populateWhere.get(relationName),
        populateOrder.get(relationName)
      )
    } else if (descriptor.relationship.type === "hasOne") {
      relatedRows = await loadReverseToOneRelation(
        database,
        rows,
        relationName,
        descriptor,
        withDeleted,
        populateWhere.get(relationName),
        populateOrder.get(relationName)
      )
    } else if (descriptor.relationship.type === "hasMany") {
      relatedRows = await loadHasManyRelation(
        database,
        rows,
        relationName,
        descriptor,
        withDeleted,
        populateWhere.get(relationName),
        populateOrder.get(relationName)
      )
    } else if (descriptor.relationship.type === "manyToMany") {
      relatedRows = await loadManyToManyRelation(
        database,
        rows,
        relationName,
        descriptor,
        withDeleted,
        populateWhere.get(relationName)
      )
    }

    const nestedDescriptors =
      descriptorsByModel.get(descriptor.relationship.targetModel) ?? new Map()
    if (relatedRows.length && nestedPopulate.size && nestedDescriptors.size) {
      await loadRelationsFromTree(
        database,
        relatedRows,
        nestedPopulate,
        nestedDescriptors,
        descriptorsByModel,
        withDeleted,
        populateWhere,
        populateOrder
      )
    }
  }
}

function projectLoadedRelations(
  rows: Record<string, unknown>[],
  fields: string[],
  populate: string[] | boolean | undefined,
  descriptors: Map<string, RelationDescriptor>,
  descriptorsByModel: Map<string, Map<string, RelationDescriptor>>
): void {
  if (!rows.length) {
    return
  }

  const expandedPopulate = expandOwnedToOnePopulate(
    expandPopulateWildcards(populate, descriptors),
    descriptors,
    descriptorsByModel
  )
  const fieldTree = toFieldProjectionTree([
    ...fields,
    ...relationScalarFieldPaths(fields, descriptors, descriptorsByModel),
    ...relationScalarFieldPaths(
      expandedPopulate,
      descriptors,
      descriptorsByModel
    ),
  ])
  const populateTree = toPopulateTree(expandedPopulate)
  projectLoadedRelationsFromTree(
    rows,
    fieldTree,
    populateTree,
    descriptors,
    descriptorsByModel
  )
}

function projectLoadedRelationsFromTree(
  rows: Record<string, unknown>[],
  fieldTree: FieldProjectionTree,
  populateTree: PopulateTree,
  descriptors: Map<string, RelationDescriptor>,
  descriptorsByModel: Map<string, Map<string, RelationDescriptor>>
): void {
  for (const [relationName, nestedPopulate] of populateTree) {
    const descriptor = descriptors.get(relationName)
    if (!descriptor) {
      continue
    }

    const relationProjection = fieldTree.relations.get(relationName) ?? {
      fields: new Set<string>(),
      relations: new Map<string, FieldProjectionTree>(),
    }
    const shouldSelectWholeRelation =
      fieldTree.fields.has(relationName) ||
      (!relationProjection.fields.size && !relationProjection.relations.size)
    const selectedFields = new Set(
      shouldSelectWholeRelation
        ? Object.keys(descriptor.targetColumns)
        : [...descriptor.targetPrimaryKeys, ...relationProjection.fields]
    )
    const nestedDescriptors =
      descriptorsByModel.get(descriptor.relationship.targetModel) ?? new Map()
    const targetSchema = descriptor.targetModel.parse().schema
    if (
      [...relationProjection.fields].some(
        (field) => !(field in targetSchema) && !nestedDescriptors.has(field)
      )
    ) {
      Object.keys(descriptor.targetColumns).forEach((field) =>
        selectedFields.add(field)
      )
    }
    for (const nestedRelationName of nestedPopulate.keys()) {
      const nestedDescriptor = nestedDescriptors.get(nestedRelationName)
      if (!nestedDescriptor) {
        const virtualProjection =
          relationProjection.relations.get(nestedRelationName)
        for (const field of virtualProjection?.fields ?? []) {
          if (field in targetSchema) {
            selectedFields.add(field)
          }
        }
        continue
      }

      selectedFields.add(nestedRelationName)
      if (
        nestedDescriptor.relationship.type === "belongsTo" ||
        nestedDescriptor.relationship.type === "hasOneWithFK"
      ) {
        nestedDescriptor.ownerForeignKeys.forEach((key) =>
          selectedFields.add(key)
        )
      }
    }
    const shouldIncludeRelationValue = nestedPopulate.size > 0
    if (
      shouldIncludeRelationValue &&
      (descriptor.relationship.type === "belongsTo" ||
        descriptor.relationship.type === "hasOneWithFK")
    ) {
      descriptor.ownerForeignKeys.forEach((key) => selectedFields.add(key))
    }
    if (descriptor.relationship.type === "hasMany") {
      descriptor.ownerForeignKeys.forEach((key) => selectedFields.add(key))
    }

    const relatedRows: Record<string, unknown>[] = []
    for (const row of rows) {
      const relationValue = row[relationName]
      if (Array.isArray(relationValue)) {
        const projected = relationValue
          .filter(isRecord)
          .map((relatedRow) => {
            const projectedRow = projectRowFields(relatedRow, selectedFields)
            relatedRows.push(projectedRow)
            return projectedRow
          })
        row[relationName] = projected
        continue
      }

      if (isRecord(relationValue)) {
        const projectedRow = projectRowFields(relationValue, selectedFields)
        relatedRows.push(projectedRow)
        row[relationName] = projectedRow
      } else if (shouldIncludeRelationValue) {
        row[relationName] = null
      }
    }

    if (relatedRows.length && nestedPopulate.size && nestedDescriptors.size) {
      projectLoadedRelationsFromTree(
        relatedRows,
        relationProjection,
        nestedPopulate,
        nestedDescriptors,
        descriptorsByModel
      )
    }
  }
}

function projectRowFields(
  row: Record<string, unknown>,
  fields: Set<string>
): Record<string, unknown> {
  const projected: Record<string, unknown> = {}
  for (const field of fields) {
    if (field in row) {
      projected[field] = row[field]
    }
  }

  return projected
}

async function loadManyToManyRelation(
  database: BaseSQLiteDatabase<"async", unknown>,
  rows: Record<string, unknown>[],
  relationName: string,
  descriptor: RelationDescriptor,
  withDeleted: boolean,
  populateWhere?: Record<string, unknown>,
  populateOrder?: Array<[string, "ASC" | "DESC"]>
): Promise<Record<string, unknown>[]> {
  if (
    !descriptor.sourcePrimaryKeys.length ||
    !descriptor.targetPrimaryKeys.length ||
    !descriptor.pivotTable ||
    !descriptor.pivotColumns ||
    descriptor.sourcePivotColumns.length !==
      descriptor.sourcePrimaryKeys.length ||
    descriptor.targetPivotColumns.length !== descriptor.targetPrimaryKeys.length
  ) {
    for (const row of rows) {
      row[relationName] = []
    }
    return []
  }

  const pivotWhere = tupleWhere(
    rows,
    descriptor.sourcePrimaryKeys,
    descriptor.pivotColumns,
    descriptor.sourcePivotColumns
  )
  if (!pivotWhere) {
    for (const row of rows) {
      row[relationName] = []
    }
    return []
  }

  const pivotRows = await database
    .select()
    .from(descriptor.pivotTable)
    .where(pivotWhere)
  const targetWhere = tupleWhere(
    pivotRows,
    descriptor.targetPivotColumns,
    descriptor.targetColumns,
    descriptor.targetPrimaryKeys
  )
  if (!targetWhere) {
    for (const row of rows) {
      row[relationName] = []
    }
    return []
  }

  const relatedRows = await selectRelatedRows(
    database,
    descriptor,
    targetWhere,
    withDeleted,
    populateWhere
  )
  const relatedByPrimaryKey = new Map(
    relatedRows.map((row) => [tupleKey(row, descriptor.targetPrimaryKeys), row])
  )
  const relatedBySource = new Map<string, Record<string, unknown>[]>()
  for (const pivotRow of pivotRows) {
    const sourceValue = tupleKey(pivotRow, descriptor.sourcePivotColumns)
    const targetValue = tupleKey(pivotRow, descriptor.targetPivotColumns)
    const relatedRow = relatedByPrimaryKey.get(targetValue)
    if (!relatedRow) {
      continue
    }

    const existing = relatedBySource.get(sourceValue) ?? []
    existing.push(relatedRow)
    relatedBySource.set(sourceValue, existing)
  }

  for (const row of rows) {
    row[relationName] =
      relatedBySource.get(tupleKey(row, descriptor.sourcePrimaryKeys)) ?? []
  }

  return relatedRows
}

async function replaceOwnedToOneRelation(
  database: BaseSQLiteDatabase<"async", unknown>,
  source: Record<string, unknown>,
  target: unknown,
  descriptor: RelationDescriptor,
  performedActions: PerformedActions,
  createGraphContext?: CreateGraphContext
): Promise<void> {
  if (
    descriptor.ownerForeignKeys.length !== descriptor.targetPrimaryKeys.length
  ) {
    throw new Error(
      `Drizzle upsertWithReplace requires complete ownership metadata for "${descriptor.relationship.name}"`
    )
  }

  if (target === null) {
    for (const foreignKey of descriptor.ownerForeignKeys) {
      source[foreignKey] = null
    }
    return
  }
  if (
    isScalarRelationKey(target) &&
    descriptor.ownerForeignKeys.length === 1 &&
    descriptor.targetPrimaryKeys.length === 1
  ) {
    source[descriptor.ownerForeignKeys[0]] = target
    return
  }
  if (!isRecord(target)) {
    throw new Error(
      `Drizzle upsertWithReplace relation "${descriptor.relationship.name}" requires an object or null`
    )
  }

  const scalarTarget = scalarEntityData(target, descriptor.targetModel)
  const hasCompletePrimaryKey = descriptor.targetPrimaryKeys.every(
    (key) => scalarTarget[key] !== null && scalarTarget[key] !== undefined
  )
  const existing = hasCompletePrimaryKey
    ? await database
        .select()
        .from(descriptor.targetTable)
        .where(
          primaryKeyWhere(
            descriptor.targetColumns,
            descriptor.targetPrimaryKeys,
            scalarTarget
          )
        )
        .limit(1)
    : []
  if (hasRelationValues(target, descriptor.targetModel)) {
    if (
      !hasCompletePrimaryKey &&
      !createGraphContext &&
      descriptor.ownerForeignKeys.every(
        (foreignKey) =>
          source[foreignKey] !== null && source[foreignKey] !== undefined
      )
    ) {
      return
    }

    if (existing.length || !createGraphContext) {
      if (!hasCompletePrimaryKey) {
        assertNoRelationValues(target, descriptor.targetModel)
      }
    } else {
      const targetTableMetadata =
        createGraphContext.tableMetadataByModel.get(descriptor.targetModel.name)
      if (!targetTableMetadata) {
        throw new Error(
          `Drizzle create is missing table metadata for "${descriptor.targetModel.name}"`
        )
      }

      const mutated = await createEntityGraph(
        database,
        target,
        descriptor.targetModel,
        targetTableMetadata,
        descriptor.targetTable,
        descriptor.targetColumns,
        descriptor.targetPrimaryKeys,
        createGraphContext.relationDescriptorsByModel.get(
          descriptor.targetModel.name
        ) ?? new Map(),
        createGraphContext.relationDescriptorsByModel,
        createGraphContext.tableMetadataByModel,
        createGraphContext.createdMutations
      )
      for (const [index, foreignKey] of descriptor.ownerForeignKeys.entries()) {
        source[foreignKey] = mutated[descriptor.targetPrimaryKeys[index]]
      }
      return
    }
  }
  const value = preparePersistenceRecord(descriptor.targetModel, {
    ...existing[0],
    ...scalarTarget,
  })
  const [mutated] = existing.length
    ? await mapDrizzleMutationError(() =>
        database
          .update(descriptor.targetTable)
          .set(value)
          .where(
            primaryKeyWhere(
              descriptor.targetColumns,
              descriptor.targetPrimaryKeys,
              value
            )
          )
          .returning()
      )
    : await mapDrizzleMutationError(() =>
        database.insert(descriptor.targetTable).values(value).returning()
      )
  if (!mutated) {
    return
  }

  for (const [index, foreignKey] of descriptor.ownerForeignKeys.entries()) {
    source[foreignKey] = mutated[descriptor.targetPrimaryKeys[index]]
  }
  if (!existing.length && createGraphContext) {
    createGraphContext.createdMutations.push({
      modelName: descriptor.targetModel.name,
      entity: mutated,
    })
  }
  addPerformedAction(
    performedActions,
    existing.length ? "updated" : "created",
    descriptor.relationship.targetModel,
    mutated,
    descriptor.targetPrimaryKeys
  )
}

async function validateOwnedForeignKeys(
  database: BaseSQLiteDatabase<"async", unknown>,
  source: Record<string, unknown>,
  descriptors: Map<string, RelationDescriptor>
): Promise<void> {
  for (const descriptor of descriptors.values()) {
    if (
      descriptor.ownerForeignKeys.length !==
        descriptor.targetPrimaryKeys.length ||
      !descriptor.ownerForeignKeys.every((key) => key in source)
    ) {
      continue
    }

    const values = descriptor.ownerForeignKeys.map((key) => source[key])
    if (values.every((value) => value === null || value === undefined)) {
      continue
    }

    const where = and(
      ...descriptor.targetPrimaryKeys.map((key, index) =>
        eq(descriptor.targetColumns[key], values[index])
      )
    )
    const [target] = await database
      .select()
      .from(descriptor.targetTable)
      .where(where)
      .limit(1)
    if (!target) {
      throw new Error(
        relationshipNotFoundMessage(
          descriptor.ownerForeignKeys[0],
          String(values[0])
        )
      )
    }
  }
}

async function replaceHasManyRelation(
  database: BaseSQLiteDatabase<"async", unknown>,
  source: Record<string, unknown>,
  targets: unknown[],
  descriptor: RelationDescriptor,
  performedActions: PerformedActions,
  relationDescriptorsByModel: Map<string, Map<string, RelationDescriptor>>
): Promise<void> {
  if (
    descriptor.ownerForeignKeys.length !== descriptor.sourcePrimaryKeys.length
  ) {
    throw new Error(
      `Drizzle upsertWithReplace requires complete ownership metadata for "${descriptor.relationship.name}"`
    )
  }

  const currentWhere = tupleWhere(
    [source],
    descriptor.sourcePrimaryKeys,
    descriptor.targetColumns,
    descriptor.ownerForeignKeys
  )
  if (!currentWhere) {
    throw new Error(
      `Drizzle upsertWithReplace requires complete source keys for "${descriptor.relationship.name}"`
    )
  }
  const currentRows = await database
    .select()
    .from(descriptor.targetTable)
    .where(currentWhere)
  const normalizedTargets = targets.map((target) => {
    if (!isRecord(target)) {
      throw new Error(
        `Drizzle upsertWithReplace relation "${descriptor.relationship.name}" requires child objects`
      )
    }
    assertNoUnsupportedNestedRelationValues(
      target,
      descriptor.targetModel,
      relationDescriptorsByModel
    )

    const normalized = {
      ...scalarEntityData(target, descriptor.targetModel),
      ...Object.fromEntries(
        descriptor.ownerForeignKeys.map((key, index) => [
          key,
          source[descriptor.sourcePrimaryKeys[index]],
        ])
      ),
    }
    const hasCompletePrimaryKey = descriptor.targetPrimaryKeys.every(
      (key) => normalized[key] !== null && normalized[key] !== undefined
    )
    const identified = hasCompletePrimaryKey
      ? normalized
      : (preparePersistenceRecord(
          descriptor.targetModel,
          normalized
        ) as Record<string, unknown>)
    if (
      descriptor.targetPrimaryKeys.some(
        (key) => identified[key] === null || identified[key] === undefined
      )
    ) {
      throw new Error(
        `Drizzle upsertWithReplace relation "${descriptor.relationship.name}" requires complete child primary keys`
      )
    }
    return identified
  })
  const targetKeys = normalizedTargets.map((target) =>
    tupleKey(target, descriptor.targetPrimaryKeys)
  )
  if (new Set(targetKeys).size !== targetKeys.length) {
    throw new Error(
      `Drizzle upsertWithReplace relation "${descriptor.relationship.name}" requires unique child primary keys`
    )
  }
  const existingWhere = tupleWhere(
    normalizedTargets,
    descriptor.targetPrimaryKeys,
    descriptor.targetColumns,
    descriptor.targetPrimaryKeys
  )
  const existingRows = existingWhere
    ? await database.select().from(descriptor.targetTable).where(existingWhere)
    : []
  const existingByPrimaryKey = new Map(
    existingRows.map((row) => [
      tupleKey(row, descriptor.targetPrimaryKeys),
      row,
    ])
  )
  const retainedKeys = new Set(
    normalizedTargets.map((target) =>
      tupleKey(target, descriptor.targetPrimaryKeys)
    )
  )
  const deletedRows = currentRows.filter(
    (row) => !retainedKeys.has(tupleKey(row, descriptor.targetPrimaryKeys))
  )
  if (deletedRows.length) {
    await deleteNestedOwnedRows(
      database,
      deletedRows,
      descriptor.targetModel.name,
      relationDescriptorsByModel,
      performedActions,
      new Set()
    )

    const deleteWhere = tupleWhere(
      deletedRows,
      descriptor.targetPrimaryKeys,
      descriptor.targetColumns,
      descriptor.targetPrimaryKeys
    )
    if (deleteWhere) {
      await mapDrizzleMutationError(() =>
        database.delete(descriptor.targetTable).where(deleteWhere)
      )
    }
    for (const row of deletedRows) {
      addPerformedAction(
        performedActions,
        "deleted",
        descriptor.relationship.targetModel,
        row,
        descriptor.targetPrimaryKeys
      )
    }
  }

  for (const [index, target] of normalizedTargets.entries()) {
    const key = tupleKey(target, descriptor.targetPrimaryKeys)
    const current = existingByPrimaryKey.get(key)
    const value = preparePersistenceRecord(descriptor.targetModel, {
      ...current,
      ...target,
    }) as Record<string, unknown>
    const changed =
      !current || hasChangedFields(current, target, descriptor.targetPrimaryKeys)
    const [mutated] = current
      ? changed
        ? await mapDrizzleMutationError(() =>
            database
              .update(descriptor.targetTable)
              .set(value)
              .where(
                primaryKeyWhere(
                  descriptor.targetColumns,
                  descriptor.targetPrimaryKeys,
                  value
                )
              )
              .returning()
          )
        : [current]
      : await mapDrizzleMutationError(() =>
          database.insert(descriptor.targetTable).values(value).returning()
        )
    if (!mutated) {
      continue
    }
    if (changed) {
      addPerformedAction(
        performedActions,
        current ? "updated" : "created",
        descriptor.relationship.targetModel,
        mutated,
        descriptor.targetPrimaryKeys
      )
    }

    await replaceNestedRelationValues(
      database,
      mutated,
      targets[index],
      descriptor.targetModel.name,
      relationDescriptorsByModel,
      performedActions
    )
  }
}

async function replaceImplicitManyToManyRelation(
  database: BaseSQLiteDatabase<"async", unknown>,
  source: Record<string, unknown>,
  targets: unknown[],
  descriptor: RelationDescriptor
): Promise<void> {
  if (!descriptor.pivotTable || !descriptor.pivotColumns) {
    return
  }
  const pivotTable = descriptor.pivotTable

  const where = tupleWhere(
    [source],
    descriptor.sourcePrimaryKeys,
    descriptor.pivotColumns,
    descriptor.sourcePivotColumns
  )
  if (!where) {
    throw new Error(
      `Drizzle upsertWithReplace requires complete source keys for "${descriptor.relationship.name}"`
    )
  }
  const pivotRows = targets.map((target) => {
    if (!isRecord(target)) {
      throw new Error(
        `Drizzle upsertWithReplace relation "${descriptor.relationship.name}" requires existing target objects`
      )
    }

    const targetValues = descriptor.targetPrimaryKeys.map((key) => target[key])
    if (targetValues.some((value) => value === null || value === undefined)) {
      throw new Error(
        `Drizzle upsertWithReplace relation "${descriptor.relationship.name}" requires complete target primary keys`
      )
    }

    return Object.fromEntries([
      ...descriptor.sourcePivotColumns.map((key, index) => [
        key,
        source[descriptor.sourcePrimaryKeys[index]],
      ]),
      ...descriptor.targetPivotColumns.map((key, index) => [
        key,
        targetValues[index],
      ]),
    ])
  })

  if (pivotRows.length) {
    const targetWhere = tupleWhere(
      pivotRows,
      descriptor.targetPivotColumns,
      descriptor.targetColumns,
      descriptor.targetPrimaryKeys
    )
    const existingTargets = targetWhere
      ? await database.select().from(descriptor.targetTable).where(targetWhere)
      : []
    const expectedTargetKeys = new Set(
      pivotRows.map((row) => tupleKey(row, descriptor.targetPivotColumns))
    )
    const existingTargetKeys = new Set(
      existingTargets.map((row) => tupleKey(row, descriptor.targetPrimaryKeys))
    )
    if (
      expectedTargetKeys.size !== existingTargetKeys.size ||
      Array.from(expectedTargetKeys).some(
        (targetKey) => !existingTargetKeys.has(targetKey)
      )
    ) {
      throw new Error(
        relationshipNotFoundMessage(
          relationshipLinkableKey(descriptor),
          firstMissingTargetValue(
            pivotRows,
            descriptor.targetPivotColumns,
            existingTargetKeys
          )
        )
      )
    }
  }

  await mapDrizzleMutationError(() =>
    database.delete(pivotTable).where(where)
  )

  if (pivotRows.length) {
    await mapDrizzleMutationError(() =>
      database.insert(pivotTable).values(pivotRows).onConflictDoNothing()
    )
  }
}

async function replaceNestedRelationValues(
  database: BaseSQLiteDatabase<"async", unknown>,
  source: Record<string, unknown>,
  entry: unknown,
  modelName: string,
  relationDescriptorsByModel: Map<string, Map<string, RelationDescriptor>>,
  performedActions: PerformedActions
): Promise<void> {
  if (!isRecord(entry)) {
    return
  }

  const nestedDescriptors = relationDescriptorsByModel.get(modelName)
  if (!nestedDescriptors) {
    return
  }

  for (const [relationName, descriptor] of nestedDescriptors) {
    const relationValue = entry[relationName]
    if (relationValue === undefined) {
      continue
    }

    if (
      descriptor.relationship.type === "belongsTo" ||
      descriptor.relationship.type === "hasOneWithFK"
    ) {
      await replaceOwnedToOneRelation(
        database,
        source,
        relationValue,
        descriptor,
        performedActions
      )
      continue
    }

    if (!Array.isArray(relationValue)) {
      throw new Error(
        `Drizzle upsertWithReplace relation "${relationName}" must be an array`
      )
    }

    if (descriptor.relationship.type === "hasMany") {
      await replaceHasManyRelation(
        database,
        source,
        relationValue,
        descriptor,
        performedActions,
        relationDescriptorsByModel
      )
    } else if (descriptor.implicitPivot) {
      await replaceImplicitManyToManyRelation(
        database,
        source,
        relationValue,
        descriptor
      )
    } else {
      await replaceExplicitManyToManyRelation(
        database,
        source,
        relationValue,
        descriptor
      )
    }
  }
}

async function replaceCollectionRelationValues(
  database: BaseSQLiteDatabase<"async", unknown>,
  source: Record<string, unknown>,
  entry: unknown,
  modelName: string,
  relationDescriptorsByModel: Map<string, Map<string, RelationDescriptor>>,
  performedActions: PerformedActions
): Promise<void> {
  if (!isRecord(entry)) {
    return
  }

  const nestedDescriptors = relationDescriptorsByModel.get(modelName)
  if (!nestedDescriptors) {
    return
  }

  for (const [relationName, descriptor] of nestedDescriptors) {
    const relationValue = entry[relationName]
    if (relationValue === undefined) {
      continue
    }

    if (
      descriptor.relationship.type === "belongsTo" ||
      descriptor.relationship.type === "hasOneWithFK"
    ) {
      continue
    }

    if (!Array.isArray(relationValue)) {
      throw new Error(
        `Drizzle update relation "${relationName}" must be an array`
      )
    }
    if (!relationValue.length) {
      continue
    }

    if (descriptor.relationship.type === "hasMany") {
      await replaceHasManyRelation(
        database,
        source,
        relationValue,
        descriptor,
        performedActions,
        relationDescriptorsByModel
      )
    } else if (descriptor.implicitPivot) {
      await replaceImplicitManyToManyRelation(
        database,
        source,
        relationValue,
        descriptor
      )
    } else {
      await replaceExplicitManyToManyRelation(
        database,
        source,
        relationValue,
        descriptor
      )
    }
  }
}

async function deleteNestedOwnedRows(
  database: BaseSQLiteDatabase<"async", unknown>,
  rows: Record<string, unknown>[],
  modelName: string,
  relationDescriptorsByModel: Map<string, Map<string, RelationDescriptor>>,
  performedActions: PerformedActions,
  visited: Set<string>
): Promise<void> {
  if (!rows.length || visited.has(modelName)) {
    return
  }

  const nestedDescriptors = relationDescriptorsByModel.get(modelName)
  if (!nestedDescriptors) {
    return
  }

  visited.add(modelName)
  for (const descriptor of nestedDescriptors.values()) {
    if (
      descriptor.relationship.type !== "hasMany" ||
      descriptor.ownerForeignKeys.length !== descriptor.sourcePrimaryKeys.length
    ) {
      continue
    }

    const nestedWhere = tupleWhere(
      rows,
      descriptor.sourcePrimaryKeys,
      descriptor.targetColumns,
      descriptor.ownerForeignKeys
    )
    if (!nestedWhere) {
      continue
    }

    const nestedRows = await database
      .select()
      .from(descriptor.targetTable)
      .where(nestedWhere)

    await deleteNestedOwnedRows(
      database,
      nestedRows,
      descriptor.targetModel.name,
      relationDescriptorsByModel,
      performedActions,
      new Set(visited)
    )

    await mapDrizzleMutationError(() =>
      database.delete(descriptor.targetTable).where(nestedWhere)
    )

    for (const row of nestedRows) {
      addPerformedAction(
        performedActions,
        "deleted",
        descriptor.relationship.targetModel,
        row,
        descriptor.targetPrimaryKeys
      )
    }
  }
}

async function replaceExplicitManyToManyRelation(
  database: BaseSQLiteDatabase<"async", unknown>,
  source: Record<string, unknown>,
  targets: unknown[],
  descriptor: RelationDescriptor
): Promise<void> {
  if (
    !descriptor.pivotModel ||
    !descriptor.pivotTable ||
    !descriptor.pivotColumns ||
    descriptor.sourcePivotColumns.length !==
      descriptor.sourcePrimaryKeys.length ||
    descriptor.targetPivotColumns.length !== descriptor.targetPrimaryKeys.length
  ) {
    throw new Error(
      `Drizzle upsertWithReplace requires complete pivot metadata for "${descriptor.relationship.name}"`
    )
  }
  const pivotTable = descriptor.pivotTable
  const pivotModel = descriptor.pivotModel

  const sourceWhere = tupleWhere(
    [source],
    descriptor.sourcePrimaryKeys,
    descriptor.pivotColumns,
    descriptor.sourcePivotColumns
  )
  if (!sourceWhere) {
    throw new Error(
      `Drizzle upsertWithReplace requires complete source keys for "${descriptor.relationship.name}"`
    )
  }

  const targetRows = targets.map((target) => {
    if (!isRecord(target)) {
      throw new Error(
        `Drizzle upsertWithReplace relation "${descriptor.relationship.name}" requires existing target objects`
      )
    }
    assertNoRelationValues(target, descriptor.targetModel)

    const targetValues = descriptor.targetPrimaryKeys.map((key) => target[key])
    if (targetValues.some((value) => value === null || value === undefined)) {
      throw new Error(
        `Drizzle upsertWithReplace relation "${descriptor.relationship.name}" requires complete target primary keys`
      )
    }

    return Object.fromEntries(
      descriptor.targetPrimaryKeys.map((key, index) => [key, targetValues[index]])
    )
  })
  const targetKeys = targetRows.map((target) =>
    tupleKey(target, descriptor.targetPrimaryKeys)
  )
  if (new Set(targetKeys).size !== targetKeys.length) {
    throw new Error(
      `Drizzle upsertWithReplace relation "${descriptor.relationship.name}" requires unique target primary keys`
    )
  }

  const currentPivotRows = await database
    .select()
    .from(pivotTable)
    .where(sourceWhere)

  if (!targetRows.length) {
    await mapDrizzleMutationError(() =>
      database.delete(pivotTable).where(sourceWhere)
    )
    return
  }

  const targetWhere = tupleWhere(
    targetRows,
    descriptor.targetPrimaryKeys,
    descriptor.targetColumns,
    descriptor.targetPrimaryKeys
  )
  const existingTargets = targetWhere
    ? await database.select().from(descriptor.targetTable).where(targetWhere)
    : []
  const expectedTargetKeys = new Set(targetKeys)
  const existingTargetKeys = new Set(
    existingTargets.map((row) => tupleKey(row, descriptor.targetPrimaryKeys))
  )
  if (
    expectedTargetKeys.size !== existingTargetKeys.size ||
    Array.from(expectedTargetKeys).some(
      (targetKey) => !existingTargetKeys.has(targetKey)
    )
  ) {
    throw new Error(
      relationshipNotFoundMessage(
        relationshipLinkableKey(descriptor),
        firstMissingTargetValue(
          targetRows,
          descriptor.targetPrimaryKeys,
          existingTargetKeys
        )
      )
    )
  }

  const retainedTargetKeys = new Set(targetKeys)
  const pivotRowsToDelete = currentPivotRows.filter(
    (row) => !retainedTargetKeys.has(tupleKey(row, descriptor.targetPivotColumns))
  )
  if (pivotRowsToDelete.length) {
    const deleteWhere = tupleWhere(
      pivotRowsToDelete,
      descriptor.pivotPrimaryKeys,
      descriptor.pivotColumns,
      descriptor.pivotPrimaryKeys
    )
    if (deleteWhere) {
      await mapDrizzleMutationError(() =>
        database.delete(pivotTable).where(deleteWhere)
      )
    }
  }

  const currentTargetKeys = new Set(
    currentPivotRows.map((row) => tupleKey(row, descriptor.targetPivotColumns))
  )
  const pivotRowsToCreate = targetRows
    .filter(
      (target) =>
        !currentTargetKeys.has(tupleKey(target, descriptor.targetPrimaryKeys))
    )
    .map((target) =>
      preparePersistenceRecord(pivotModel, {
        ...Object.fromEntries(
          descriptor.sourcePivotColumns.map((key, index) => [
            key,
            source[descriptor.sourcePrimaryKeys[index]],
          ])
        ),
        ...Object.fromEntries(
          descriptor.targetPivotColumns.map((key, index) => [
            key,
            target[descriptor.targetPrimaryKeys[index]],
          ])
        ),
      }) as Record<string, unknown>
    )

  if (pivotRowsToCreate.length) {
    await mapDrizzleMutationError(() =>
      database.insert(pivotTable).values(pivotRowsToCreate)
    )
  }
}

async function loadToOneRelation(
  database: BaseSQLiteDatabase<"async", unknown>,
  rows: Record<string, unknown>[],
  relationName: string,
  descriptor: RelationDescriptor,
  withDeleted: boolean,
  populateWhere?: Record<string, unknown>,
  populateOrder?: Array<[string, "ASC" | "DESC"]>
): Promise<Record<string, unknown>[]> {
  if (
    !descriptor.targetPrimaryKeys.length ||
    descriptor.ownerForeignKeys.length !== descriptor.targetPrimaryKeys.length
  ) {
    for (const row of rows) {
      row[relationName] = null
    }
    return []
  }

  const where = tupleWhere(
    rows,
    descriptor.ownerForeignKeys,
    descriptor.targetColumns,
    descriptor.targetPrimaryKeys
  )
  if (!where) {
    for (const row of rows) {
      row[relationName] = null
    }
    return []
  }

  const relatedRows = await selectRelatedRows(
    database,
    descriptor,
    where,
    withDeleted,
    populateWhere,
    populateOrder
  )
  const relatedByPrimaryKey = new Map(
    relatedRows.map((row) => [tupleKey(row, descriptor.targetPrimaryKeys), row])
  )

  for (const row of rows) {
    row[relationName] =
      relatedByPrimaryKey.get(tupleKey(row, descriptor.ownerForeignKeys)) ??
      null
  }

  return relatedRows
}

async function loadHasManyRelation(
  database: BaseSQLiteDatabase<"async", unknown>,
  rows: Record<string, unknown>[],
  relationName: string,
  descriptor: RelationDescriptor,
  withDeleted: boolean,
  populateWhere?: Record<string, unknown>,
  populateOrder?: Array<[string, "ASC" | "DESC"]>
): Promise<Record<string, unknown>[]> {
  if (
    !descriptor.sourcePrimaryKeys.length ||
    descriptor.ownerForeignKeys.length !== descriptor.sourcePrimaryKeys.length
  ) {
    for (const row of rows) {
      row[relationName] = []
    }
    return []
  }

  const where = tupleWhere(
    rows,
    descriptor.sourcePrimaryKeys,
    descriptor.targetColumns,
    descriptor.ownerForeignKeys
  )
  if (!where) {
    for (const row of rows) {
      row[relationName] = []
    }
    return []
  }

  const relatedRows = await selectRelatedRows(
    database,
    descriptor,
    where,
    withDeleted,
    populateWhere,
    populateOrder
  )
  const relatedByForeignKey = new Map<string, Record<string, unknown>[]>()
  for (const relatedRow of relatedRows) {
    const key = tupleKey(relatedRow, descriptor.ownerForeignKeys)
    const existing = relatedByForeignKey.get(key) ?? []
    existing.push(relatedRow)
    relatedByForeignKey.set(key, existing)
  }

  for (const row of rows) {
    const related =
      relatedByForeignKey.get(tupleKey(row, descriptor.sourcePrimaryKeys)) ?? []
    const relationVersion = versionedRelationValue(
      relationName,
      descriptor,
      row
    )
    row[relationName] =
      relationVersion !== undefined
      ? related.filter((relatedRow) => relatedRow.version === relationVersion)
      : related
  }

  return relatedRows
}

async function loadReverseToOneRelation(
  database: BaseSQLiteDatabase<"async", unknown>,
  rows: Record<string, unknown>[],
  relationName: string,
  descriptor: RelationDescriptor,
  withDeleted: boolean,
  populateWhere?: Record<string, unknown>,
  populateOrder?: Array<[string, "ASC" | "DESC"]>
): Promise<Record<string, unknown>[]> {
  if (
    !descriptor.sourcePrimaryKeys.length ||
    descriptor.ownerForeignKeys.length !== descriptor.sourcePrimaryKeys.length
  ) {
    for (const row of rows) {
      row[relationName] = null
    }
    return []
  }

  const where = tupleWhere(
    rows,
    descriptor.sourcePrimaryKeys,
    descriptor.targetColumns,
    descriptor.ownerForeignKeys
  )
  if (!where) {
    for (const row of rows) {
      row[relationName] = null
    }
    return []
  }

  const relatedRows = await selectRelatedRows(
    database,
    descriptor,
    where,
    withDeleted,
    populateWhere,
    populateOrder
  )
  const relatedByForeignKey = new Map<string, Record<string, unknown>>()
  for (const relatedRow of relatedRows) {
    const key = tupleKey(relatedRow, descriptor.ownerForeignKeys)
    if (!relatedByForeignKey.has(key)) {
      relatedByForeignKey.set(key, relatedRow)
    }
  }

  for (const row of rows) {
    row[relationName] =
      relatedByForeignKey.get(tupleKey(row, descriptor.sourcePrimaryKeys)) ??
      null
  }

  return relatedRows
}

function versionedRelationValue(
  relationName: string,
  descriptor: RelationDescriptor,
  row: Record<string, unknown>
): unknown {
  if (!("version" in descriptor.targetColumns)) {
    return undefined
  }

  const sourceField = versionedRelationSourceField(relationName, descriptor)
  if (sourceField && row[sourceField] !== undefined) {
    return row[sourceField]
  }

  return undefined
}

function versionedRelationSourceField(
  relationName: string,
  descriptor: RelationDescriptor
): "version" | "order_version" | undefined {
  if (!("version" in descriptor.targetColumns)) {
    return undefined
  }

  if (
    descriptor.sourceModel.name === "Order" &&
    ["items", "shipping_methods", "summary", "credit_lines"].includes(
      relationName
    )
  ) {
    return "version"
  }

  if (
    ["OrderExchange", "Return", "OrderClaim"].includes(
      descriptor.sourceModel.name
    ) &&
    relationName === "shipping_methods"
  ) {
    return "order_version"
  }

  return undefined
}

function toPopulateTree(
  populate: string[] | boolean | undefined
): PopulateTree {
  const tree: PopulateTree = new Map()
  if (!Array.isArray(populate)) {
    return tree
  }

  for (const path of populate) {
    const parts = path.split(".").filter(Boolean)
    let current = tree
    for (const part of parts) {
      const next = current.get(part) ?? new Map<string, PopulateTree>()
      current.set(part, next)
      current = next
    }
  }

  return tree
}

function relationPopulateWhere(options: unknown): RelationPopulateWhere {
  const filterMap: RelationPopulateWhere = new Map()

  if (!isRecord(options)) {
    return filterMap
  }

  const rawPopulateWhere = options.populateWhere

  if (!isRecord(rawPopulateWhere)) {
    return filterMap
  }

  for (const [relationName, filter] of Object.entries(rawPopulateWhere)) {
    if (isRecord(filter)) {
      filterMap.set(relationName, filter)
    }
  }

  return filterMap
}

function relationPopulateOrder(options: unknown): RelationPopulateOrder {
  const orderMap: RelationPopulateOrder = new Map()

  if (!isRecord(options) || !isRecord(options.orderBy)) {
    return orderMap
  }

  for (const [relationName, order] of Object.entries(options.orderBy)) {
    if (isRecord(order)) {
      orderMap.set(
        relationName,
        normalizeOrdering(
          order as DAL.OptionsQuery<Record<string, unknown>>["orderBy"]
        )
      )
    }
  }

  return orderMap
}

function expandPopulateWildcards(
  populate: string[] | boolean | undefined,
  descriptors: Map<string, RelationDescriptor>
): string[] | boolean | undefined {
  if (populate === true) {
    return [...descriptors.keys()]
  }
  if (!Array.isArray(populate) || !populate.includes("*")) {
    return populate
  }

  return [...new Set(populate.flatMap((path) => (path === "*" ? [...descriptors.keys()] : path)))]
}

function expandOwnedToOnePopulate(
  populate: string[] | boolean | undefined,
  descriptors: Map<string, RelationDescriptor>,
  descriptorsByModel: Map<string, Map<string, RelationDescriptor>>
): string[] | boolean | undefined {
  if (!Array.isArray(populate)) {
    return populate
  }

  const expanded = new Set(populate)
  for (const path of populate) {
    expandOwnedToOnePopulatePath(
      path.split(".").filter(Boolean),
      [],
      descriptors,
      descriptorsByModel,
      expanded
    )
  }

  return [...expanded]
}

function expandOwnedToOnePopulatePath(
  parts: string[],
  prefix: string[],
  descriptors: Map<string, RelationDescriptor>,
  descriptorsByModel: Map<string, Map<string, RelationDescriptor>>,
  expanded: Set<string>
): void {
  const [relationName, ...nestedParts] = parts
  if (!relationName) {
    return
  }

  const descriptor = descriptors.get(relationName)
  if (!descriptor) {
    return
  }

  const nextPrefix = [...prefix, relationName]
  const targetDescriptors =
    descriptorsByModel.get(descriptor.relationship.targetModel) ?? new Map()
  const ownedToOne = singularOwnedToOneDescriptor(targetDescriptors)
  if (ownedToOne) {
    const [ownedRelationName, ownedDescriptor] = ownedToOne
    const ownedDescriptors =
      descriptorsByModel.get(ownedDescriptor.relationship.targetModel) ??
      new Map()
    const [nestedRelationName] = nestedParts

    if (!nestedRelationName) {
      expanded.add([...nextPrefix, ownedRelationName].join("."))
    } else if (nestedRelationName === "detail") {
      expanded.add([...nextPrefix, ownedRelationName].join("."))
    } else if (
      !targetDescriptors.has(nestedRelationName) &&
      ownedDescriptors.has(nestedRelationName)
    ) {
      expanded.add([...nextPrefix, ownedRelationName, ...nestedParts].join("."))
    }
  }

  if (nestedParts.length) {
    expandOwnedToOnePopulatePath(
      nestedParts,
      nextPrefix,
      targetDescriptors,
      descriptorsByModel,
      expanded
    )
  }
}

function singularOwnedToOneDescriptor(
  descriptors: Map<string, RelationDescriptor>
): [string, RelationDescriptor] | undefined {
  const ownedToOne = [...descriptors.entries()].filter(
    ([, descriptor]) =>
      descriptor.relationship.type === "hasOneWithFK" &&
      descriptor.ownerForeignKeys.length === descriptor.targetPrimaryKeys.length
  )

  return ownedToOne.length === 1 ? ownedToOne[0] : undefined
}

function toFieldProjectionTree(fields: string[]): FieldProjectionTree {
  const tree: FieldProjectionTree = {
    fields: new Set<string>(),
    relations: new Map<string, FieldProjectionTree>(),
  }

  for (const field of fields) {
    const parts = field.split(".").filter(Boolean)
    if (!parts.length) {
      continue
    }

    let current = tree
    for (let index = 0; index < parts.length; index++) {
      const part = parts[index]
      if (index === parts.length - 1) {
        current.fields.add(part)
        continue
      }

      const next = current.relations.get(part) ?? {
        fields: new Set<string>(),
        relations: new Map<string, FieldProjectionTree>(),
      }
      current.relations.set(part, next)
      current = next
    }
  }

  return tree
}

function relationScalarFieldPaths(
  populate: string[] | boolean | undefined,
  descriptors: Map<string, RelationDescriptor>,
  descriptorsByModel: Map<string, Map<string, RelationDescriptor>>
): string[] {
  if (!Array.isArray(populate)) {
    return []
  }

  const fields: string[] = []
  for (const path of populate) {
    const parts = path.split(".").filter(Boolean)
    let currentDescriptors = descriptors
    const relationParts: string[] = []
    let currentModel: PortableEntity | undefined

    for (let index = 0; index < parts.length; index++) {
      const part = parts[index]
      const descriptor = currentDescriptors.get(part)
      if (!descriptor) {
        if (relationParts.length) {
          fields.push([...relationParts, part].join("."))
          if (
            currentModel &&
            part.startsWith("raw_") &&
            part.slice(4) in currentModel.parse().schema
          ) {
            fields.push([...relationParts, part.slice(4)].join("."))
          }

          const virtualField = parts[parts.length - 1]
          if (
            currentModel &&
            index < parts.length - 1 &&
            virtualField in currentModel.parse().schema
          ) {
            fields.push([...relationParts, virtualField].join("."))
          }
        }
        break
      }

      relationParts.push(part)
      currentModel = descriptor.targetModel
      currentDescriptors =
        descriptorsByModel.get(descriptor.relationship.targetModel) ??
        new Map()
    }
  }

  return fields
}

function mergePopulatePaths(
  populate: string[] | boolean | undefined,
  paths: string[]
): string[] | boolean | undefined {
  if (populate === true || !paths.length) {
    return populate
  }

  return [...new Set([...(Array.isArray(populate) ? populate : []), ...paths])]
}

function relationPopulatePathsFromFields(
  fields: string[],
  descriptors: Map<string, RelationDescriptor>,
  descriptorsByModel: Map<string, Map<string, RelationDescriptor>>
): string[] {
  const populate = new Set<string>()

  for (const field of fields) {
    const parts = field.split(".").filter(Boolean)
    let currentDescriptors = descriptors
    const relationParts: string[] = []

    for (const part of parts) {
      const descriptor = currentDescriptors.get(part)
      if (!descriptor) {
        break
      }

      relationParts.push(part)
      populate.add(relationParts.join("."))
      currentDescriptors =
        descriptorsByModel.get(descriptor.relationship.targetModel) ??
        new Map()
    }
  }

  return [...populate]
}

async function selectRelatedRows(
  database: BaseSQLiteDatabase<"async", unknown>,
  descriptor: RelationDescriptor,
  where: ReturnType<typeof and> | ReturnType<typeof or>,
  withDeleted: boolean,
  populateWhere?: Record<string, unknown>,
  populateOrder?: Array<[string, "ASC" | "DESC"]>
): Promise<Record<string, unknown>[]> {
  let query = database.select().from(descriptor.targetTable).$dynamic()
  const relationWhere = populateWhere
    ? toDrizzleWhere(descriptor.targetTable, populateWhere)
    : undefined

  query = query.where(
    "deleted_at" in descriptor.targetTable && !withDeleted
      ? and(where, relationWhere, isNull(descriptor.targetTable.deleted_at))
      : and(where, relationWhere)
  )

  const relationOrdering = populateOrder
    ?.filter(([field]) => field in descriptor.targetColumns)
    .map(([field, direction]) =>
      direction === "DESC"
        ? desc(descriptor.targetColumns[field])
        : asc(descriptor.targetColumns[field])
    )
  const ordering = relationOrdering?.length
    ? relationOrdering
    : defaultOrdering(descriptor.targetModel.name, descriptor.targetColumns)
  if (ordering.length) {
    query = query.orderBy(...ordering)
  }

  return await query
}

function defaultOrdering(
  modelName: string,
  columns: Record<string, SQLiteColumn>
) {
  const entries = defaultOrderingEntries(modelName, columns)
  if (entries.length) {
    return entries.map(([field, direction]) =>
      direction === "DESC" ? desc(columns[field]) : asc(columns[field])
    )
  }

  return [sql`rowid`]
}

function defaultOrderingEntries(
  modelName: string,
  columns: Record<string, SQLiteColumn>
): Array<[string, "ASC" | "DESC"]> {
  if (modelName === "PriceRule" && "priority" in columns) {
    return [["priority", "ASC"]]
  }

  if ("rank" in columns) {
    return [["rank", "ASC"]]
  }

  if ("display_id" in columns) {
    return [["display_id", "ASC"]]
  }

  return []
}

function tupleWhere(
  rows: Record<string, unknown>[],
  sourceKeys: string[],
  targetColumns: Record<string, SQLiteColumn>,
  targetKeys: string[]
) {
  if (!sourceKeys.length || sourceKeys.length !== targetKeys.length) {
    return undefined
  }

  const tuples = new Map<string, unknown[]>()
  for (const row of rows) {
    const values = sourceKeys.map((key) => row[key])
    if (values.some((value) => value === null || value === undefined)) {
      continue
    }
    tuples.set(JSON.stringify(values), values)
  }

  const conditions = Array.from(tuples.values()).map((values) =>
    and(
      ...targetKeys.map((key, index) => eq(targetColumns[key], values[index]))
    )
  )

  return conditions.length ? or(...conditions) : undefined
}

function tupleKey(row: Record<string, unknown>, keys: string[]): string {
  return JSON.stringify(keys.map((key) => row[key]))
}

function hasCompletePrimaryKey(
  row: Record<string, unknown>,
  primaryKeys: string[]
): boolean {
  return primaryKeys.every((key) => row[key] !== null && row[key] !== undefined)
}

function hasChangedFields(
  current: Record<string, unknown>,
  next: Record<string, unknown>,
  ignoredKeys: string[] = []
): boolean {
  const ignored = new Set([
    ...ignoredKeys,
    "created_at",
    "updated_at",
    "deleted_at",
  ])

  return Object.entries(next).some(([key, value]) => {
    if (ignored.has(key)) {
      return false
    }

    return normalizeComparableValue(current[key]) !==
      normalizeComparableValue(value)
  })
}

function normalizeComparableValue(value: unknown): unknown {
  if (value instanceof Date) {
    return value.toISOString()
  }

  return value
}

function scalarEntityData(
  entry: Record<string, unknown>,
  entity: PortableEntity
): Record<string, unknown> {
  const relationshipNames = new Set(
    Object.entries(entity.parse().schema)
      .filter(([, member]) => isRelationshipMetadata(member.parse("")))
      .map(([name]) => name)
  )

  return Object.fromEntries(
    Object.entries(entry).filter(
      ([key, value]) => !relationshipNames.has(key) && value !== undefined
    )
  )
}

function assertNoUnsupportedNestedRelationValues(
  entry: Record<string, unknown>,
  entity: PortableEntity,
  relationDescriptorsByModel: Map<string, Map<string, RelationDescriptor>>
): void {
  const descriptors = relationDescriptorsByModel.get(entity.name)
  for (const [name, member] of Object.entries(entity.parse().schema)) {
    if (
      isRelationshipMetadata(member.parse(name)) &&
      entry[name] !== undefined &&
      !descriptors?.has(name)
    ) {
      throw new Error(
        `Drizzle upsertWithReplace does not support nested relation "${entity.name}.${name}"`
      )
    }
  }
}

function assertNoRelationValues(
  entry: Record<string, unknown>,
  entity: PortableEntity
): void {
  for (const [name, member] of Object.entries(entity.parse().schema)) {
    if (
      isRelationshipMetadata(member.parse(name)) &&
      entry[name] !== undefined
    ) {
      throw new Error(
        `Drizzle upsertWithReplace does not support nested relation "${entity.name}.${name}"`
      )
    }
  }
}

function hasRelationValues(
  entry: Record<string, unknown>,
  entity: PortableEntity
): boolean {
  return Object.entries(entity.parse().schema).some(([name, member]) => {
    return isRelationshipMetadata(member.parse(name)) && entry[name] !== undefined
  })
}

function isRecordWithCompletePrimaryKey(
  value: unknown,
  primaryKeys: string[]
): value is Record<string, unknown> {
  return (
    isRecord(value) &&
    primaryKeys.every((key) => value[key] !== null && value[key] !== undefined)
  )
}

function isRawFilterField(field: string): boolean {
  return field.startsWith("[raw]:")
}

function rawFilterSql(field: string): string {
  return field
    .replace(/^\[raw\]:\s*/, "")
    .replace(/\s+\(#\d+\)$/, "")
    .replace(/\[::alias::\]\./g, "")
    .replace(/\[::alias::\]/g, "")
}

function relationshipNotFoundMessage(field: string, value: string): string {
  return `You tried to set relationship ${field}: ${value}, but such entity does not exist`
}

function relationshipLinkableKey(descriptor: RelationDescriptor): string {
  return `${toSnakeCase(descriptor.relationship.targetModel)}_${targetIdentityKey(
    descriptor.targetPrimaryKeys
  )}`
}

function firstMissingTargetValue(
  rows: Record<string, unknown>[],
  keys: string[],
  existingKeys: Set<string>
): string {
  const missing = rows.find((row) => !existingKeys.has(tupleKey(row, keys)))
  const value = missing ? missing[targetIdentityKey(keys)] : undefined
  return String(value)
}

function targetIdentityKey(keys: string[]): string {
  return keys.includes("id") ? "id" : keys[keys.length - 1]
}

function toSnakeCase(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[\s.-]+/g, "_")
    .toLowerCase()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value))
}

function isScalarRelationKey(value: unknown): boolean {
  return value !== undefined && typeof value !== "object"
}

function primaryKeyWhere(
  table: Record<string, SQLiteColumn>,
  primaryKeys: string[],
  record: Record<string, unknown>
) {
  return and(...primaryKeys.map((key) => eq(table[key], record[key])))
}

function normalizeMutationFilters(
  filters:
    | string
    | string[]
    | DAL.FindOptions<Record<string, unknown>>["where"]
    | DAL.FindOptions<Record<string, unknown>>["where"][],
  primaryKeys: string[]
): { $or: Record<string, unknown>[] } | undefined {
  const filterArray = Array.isArray(filters) ? filters : [filters]
  if (!filterArray.length) {
    return undefined
  }

  return {
    $or: filterArray.map((filter) =>
      typeof filter === "string" ? { [primaryKeys[0]]: filter } : { ...filter }
    ),
  }
}

function toMedusaDrizzleWhere(
  database: BaseSQLiteDatabase<"async", unknown>,
  table: Record<string, SQLiteColumn>,
  where: unknown,
  relationDescriptors: Map<string, RelationDescriptor>,
  relationDescriptorsByModel: Map<string, Map<string, RelationDescriptor>>
) {
  if (!isRecord(where)) {
    return toDrizzleWhere(
      table,
      where as Parameters<typeof toDrizzleWhere>[1]
    )
  }

  const conditions = Object.entries(where).flatMap(([field, value]) => {
    if ((field === "$and" || field === "$or") && Array.isArray(value)) {
      const nested = value.map((entry) =>
        toMedusaDrizzleWhere(
          database,
          table,
          entry,
          relationDescriptors,
          relationDescriptorsByModel
        )
      )
      return [field === "$and" ? and(...nested) : or(...nested)]
    }

    if (isRawFilterField(field)) {
      if (value === false || value === null || value === undefined) {
        return []
      }

      return [sql.raw(rawFilterSql(field))]
    }

    const descriptor = relationDescriptors.get(field)
    if (field === "detail" && isRecord(value) && !(field in table)) {
      return [
        toMedusaDrizzleWhere(
          database,
          table,
          value,
          relationDescriptors,
          relationDescriptorsByModel
        ),
      ]
    }

    if (
      descriptor &&
      descriptor.relationship.type === "manyToMany" &&
      descriptor.pivotTable &&
      descriptor.pivotColumns &&
      descriptor.sourcePrimaryKeys.length === 1 &&
      descriptor.targetPrimaryKeys.length === 1 &&
      descriptor.sourcePivotColumns.length === 1 &&
      descriptor.targetPivotColumns.length === 1 &&
      !isRecord(value)
    ) {
      const pivotSubquery = database
        .select({
          value: descriptor.pivotColumns[descriptor.sourcePivotColumns[0]],
        })
        .from(descriptor.pivotTable)
        .where(
          toDrizzleWhere(descriptor.pivotColumns, {
            [descriptor.targetPivotColumns[0]]: value,
          })
        )

      return [inArray(table[descriptor.sourcePrimaryKeys[0]], pivotSubquery)]
    }

    if (
      descriptor &&
      isRecord(value) &&
      descriptor.relationship.type === "manyToMany" &&
      descriptor.pivotTable &&
      descriptor.pivotColumns &&
      descriptor.sourcePrimaryKeys.length === 1 &&
      descriptor.targetPrimaryKeys.length === 1 &&
      descriptor.sourcePivotColumns.length === 1 &&
      descriptor.targetPivotColumns.length === 1
    ) {
      const targetDescriptors =
        relationDescriptorsByModel.get(descriptor.targetModel.name) ?? new Map()
      const targetWhere = toMedusaDrizzleWhere(
        database,
        descriptor.targetColumns,
        value,
        targetDescriptors,
        relationDescriptorsByModel
      )
      const targetPrimaryKey =
        descriptor.targetColumns[descriptor.targetPrimaryKeys[0]]
      const targetSubquery = database
        .select({ value: targetPrimaryKey })
        .from(descriptor.targetTable)
        .where(targetWhere)
      const pivotSubquery = database
        .select({
          value: descriptor.pivotColumns[descriptor.sourcePivotColumns[0]],
        })
        .from(descriptor.pivotTable)
        .where(
          inArray(
            descriptor.pivotColumns[descriptor.targetPivotColumns[0]],
            targetSubquery
          )
        )

      return [inArray(table[descriptor.sourcePrimaryKeys[0]], pivotSubquery)]
    }

    if (
      descriptor &&
      isRecord(value) &&
      descriptor.relationship.type === "hasMany" &&
      descriptor.sourcePrimaryKeys.length === 1 &&
      descriptor.ownerForeignKeys.length === 1
    ) {
      const targetDescriptors =
        relationDescriptorsByModel.get(descriptor.targetModel.name) ?? new Map()
      const targetWhere = toMedusaDrizzleWhere(
        database,
        descriptor.targetColumns,
        value,
        targetDescriptors,
        relationDescriptorsByModel
      )
      const subquery = database
        .select({ value: descriptor.targetColumns[descriptor.ownerForeignKeys[0]] })
        .from(descriptor.targetTable)
        .where(targetWhere)

      return [inArray(table[descriptor.sourcePrimaryKeys[0]], subquery)]
    }

    if (
      descriptor &&
      isRecord(value) &&
      descriptor.ownerForeignKeys.length === descriptor.targetPrimaryKeys.length &&
      descriptor.ownerForeignKeys.every((foreignKey) => foreignKey in table)
    ) {
      const directValues = descriptor.targetPrimaryKeys.map(
        (primaryKey) => value[primaryKey]
      )
      if (directValues.every((entry) => entry !== undefined)) {
        return [
          and(
            ...descriptor.ownerForeignKeys.map((foreignKey, index) =>
              toDrizzleWhere(table, {
                [foreignKey]: directValues[index],
              })
            )
          ),
        ]
      }

      if (
        descriptor.ownerForeignKeys.length === 1 &&
        descriptor.targetPrimaryKeys.length === 1
      ) {
        const targetDescriptors =
          relationDescriptorsByModel.get(descriptor.targetModel.name) ??
          new Map()
        const targetWhere = toMedusaDrizzleWhere(
          database,
          descriptor.targetColumns,
          value,
          targetDescriptors,
          relationDescriptorsByModel
        )
        const targetPrimaryKey =
          descriptor.targetColumns[descriptor.targetPrimaryKeys[0]]
        const subquery = database
          .select({ value: targetPrimaryKey })
          .from(descriptor.targetTable)
          .where(targetWhere)

        return [inArray(table[descriptor.ownerForeignKeys[0]], subquery)]
      }
    }

    return [
      toDrizzleWhere(table, {
        [field]: value,
      }),
    ]
  })

  return conditions.length ? and(...conditions) : undefined
}

function asRepositoryConstructor(
  repository: new (...args: never[]) => object
): Constructor<RepositoryService> {
  // Repository constructors cross Medusa's legacy broad DAL contract here.
  return repository as unknown as Constructor<RepositoryService>
}
