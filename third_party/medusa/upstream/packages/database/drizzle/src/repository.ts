import {
  and,
  asc,
  desc,
  eq,
  gt,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  ne,
  notInArray,
  or,
  sql,
} from "drizzle-orm"
import type {
  DatabaseSession,
  FilterOperator,
  FilterQuery,
  RepositoryContext,
  RepositoryService,
} from "@medusajs/dal"
import { applyModelDefaults, getPrimaryKeys } from "@medusajs/dal"
import type { PortableEntity } from "@medusajs/dml"
import { prepareDateTimeValue } from "./date-values"

export function createDrizzleRepository<T extends object>({
  database,
  table,
  entity,
}: {
  database: any
  table: any
  entity: PortableEntity
}): RepositoryService<T> {
  const primaryKeys = getPrimaryKeys(entity)
  const session = createSession(database)

  return {
    entity,
    session,

    async find(options = {}, context) {
      const executor = getDatabase(context)
      let query = executor.select().from(table).$dynamic()
      const where = toDrizzleWhere(table, options.where ?? {})

      if ("deleted_at" in table && !options.withDeleted) {
        query = query.where(and(where, isNull(table.deleted_at)))
      } else if (where) {
        query = query.where(where)
      }

      const ordering = Object.entries(options.orderBy ?? {}).map(
        ([field, direction]) =>
          direction === "DESC" ? desc(table[field]) : asc(table[field])
      )
      if (ordering.length) {
        query = query.orderBy(...ordering)
      }
      if (options.take !== undefined) {
        query = query.limit(options.take)
      }
      if (options.skip !== undefined) {
        query = query.offset(options.skip)
      }

      return await query
    },

    async findAndCount(options = {}, context) {
      const executor = getDatabase(context)
      const records = await this.find(options, context)
      let countQuery = executor
        .select({ count: sql<number>`count(*)` })
        .from(table)
        .$dynamic()
      const where = toDrizzleWhere(table, options.where ?? {})
      countQuery = countQuery.where(
        "deleted_at" in table && !options.withDeleted
          ? and(where, isNull(table.deleted_at))
          : where
      )
      const result = await countQuery
      return [records, Number(result[0]?.count ?? 0)]
    },

    async create(data, context) {
      const executor = getDatabase(context)
      const records = data.map((entry) => prepareRepositoryRecord(entity, entry))
      return await executor.insert(table).values(records).returning()
    },

    async update(data, context) {
      const executor = getDatabase(context)
      const output: T[] = []
      for (const { entity: current, update } of data) {
        const value = prepareRepositoryRecord(entity, {
          ...current,
          ...update,
        })
        const updated = await executor
          .update(table)
          .set(value)
          .where(
            primaryKeyWhere(
              table,
              primaryKeys,
              current as Record<string, unknown>
            )
          )
          .returning()
        output.push(...updated)
      }
      return output
    },

    async delete(where, context) {
      return await getDatabase(context)
        .delete(table)
        .where(toDrizzleWhere(table, where))
        .returning()
    },

    async softDelete(where, context) {
      return await getDatabase(context)
        .update(table)
        .set({ deleted_at: new Date(), updated_at: new Date() })
        .where(toDrizzleWhere(table, where))
        .returning()
    },

    async restore(where, context) {
      return await getDatabase(context)
        .update(table)
        .set({ deleted_at: null, updated_at: new Date() })
        .where(toDrizzleWhere(table, where))
        .returning()
    },

    async upsert(data, context) {
      const executor = getDatabase(context)
      const output: T[] = []
      const target = primaryKeys.map((key) => table[key])

      for (const input of data) {
        const value = prepareRepositoryRecord(entity, input)
        const update = Object.fromEntries(
          Object.entries(value).filter(([key]) => !primaryKeys.includes(key))
        )
        const result = await executor
          .insert(table)
          .values(value)
          .onConflictDoUpdate({
            target: target.length === 1 ? target[0] : target,
            set: update,
          })
          .returning()
        output.push(...result)
      }

      return output
    },

    async serialize(data) {
      return data
    },
  }

  function getDatabase(context?: RepositoryContext): any {
    return (context?.session as DrizzleSession | undefined)?.database ?? database
  }
}

interface DrizzleSession extends DatabaseSession {
  database: any
}

function createSession(database: any): DrizzleSession {
  const session: DrizzleSession = {
    dialect: "sqlite",
    database,
    async transaction(operation) {
      if (typeof database.transaction === "function") {
        return await database.transaction((transaction: any) =>
          operation(createSession(transaction))
        )
      }

      return await operation(session)
    },
  }

  return session
}

function prepareRepositoryRecord(
  entity: PortableEntity,
  input: object
): Record<string, unknown> {
  const output = applyModelDefaults(entity, input) as Record<string, unknown>

  for (const [fieldName, member] of Object.entries(entity.parse().schema)) {
    const metadata = member.parse(fieldName)
    if (!("dataType" in metadata) || metadata.dataType.name !== "dateTime") {
      continue
    }

    const value = output[fieldName]
    if (value !== undefined) {
      output[fieldName] = prepareDateTimeValue(entity.name, fieldName, value)
    }
  }

  return output
}

export function toDrizzleWhere<T extends object>(
  table: Record<string, any>,
  where: FilterQuery<T>
): any {
  const conditions = Object.entries(where).flatMap(([field, value]) => {
    if (field === "$and") {
      return [
        and(
          ...(value as FilterQuery<T>[]).map((entry) =>
            toDrizzleWhere(table, entry)
          )
        ),
      ]
    }
    if (field === "$or") {
      return [
        or(
          ...(value as FilterQuery<T>[]).map((entry) =>
            toDrizzleWhere(table, entry)
          )
        ),
      ]
    }
    if (isRawFilterField(field)) {
      const rawValue: unknown = value
      if (rawValue === false || rawValue === null || rawValue === undefined) {
        return []
      }

      return [sql.raw(rawFilterSql(field))]
    }
    if (!(field in table)) {
      throw new Error(`Unknown filter field "${field}"`)
    }
    if (Array.isArray(value)) {
      return [inArray(table[field], value.map((entry) => coerceFilterValue(field, entry)))]
    }
    if (isOperator(value)) {
      return operatorConditions(field, table[field], value)
    }
    if (value === null) {
      return [isNull(table[field])]
    }
    return [eq(table[field], coerceFilterValue(field, value))]
  })

  return conditions.length ? and(...conditions) : undefined
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

function operatorConditions(
  field: string,
  column: any,
  operator: FilterOperator
): any[] {
  return Object.entries(operator).map(([name, value]) => {
    const coercedValue = coerceFilterValue(field, value)
    switch (name) {
      case "$eq":
        if (value === null) {
          return isNull(column)
        }
        return eq(column, coercedValue)
      case "$ne":
        if (value === null) {
          return isNotNull(column)
        }
        return ne(column, coercedValue)
      case "$gt":
        return gt(column, coercedValue)
      case "$gte":
        return gte(column, coercedValue)
      case "$lt":
        return lt(column, coercedValue)
      case "$lte":
        return lte(column, coercedValue)
      case "$in":
        return inArray(
          column,
          Array.isArray(value)
            ? value.map((entry) => coerceFilterValue(field, entry))
            : []
        )
      case "$nin":
        return notInArray(
          column,
          Array.isArray(value)
            ? value.map((entry) => coerceFilterValue(field, entry))
            : []
        )
      default:
        throw new Error(`Unsupported filter operator "${name}"`)
    }
  })
}

function coerceFilterValue(field: string, value: unknown): unknown {
  if (value === undefined) {
    return ""
  }

  if (
    typeof value === "string" &&
    (field.endsWith("_at") || field.endsWith("_date"))
  ) {
    return new Date(value)
  }

  return value
}

function primaryKeyWhere(
  table: Record<string, any>,
  primaryKeys: string[],
  record: Record<string, unknown>
) {
  return and(...primaryKeys.map((key) => eq(table[key], record[key])))
}

function isOperator(value: unknown): value is FilterOperator {
  return Boolean(
    value &&
      typeof value === "object" &&
      Object.keys(value).some((key) => key.startsWith("$"))
  )
}
