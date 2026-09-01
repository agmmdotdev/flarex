import type { PortableEntity } from "@medusajs/dml"
import type { BaseSQLiteDatabase, SQLiteColumn } from "drizzle-orm/sqlite-core"
import { and, eq, isNull, not } from "drizzle-orm"
import type { DatabaseIndex, DatabaseTable } from "./schema"
import type { toDrizzleSqliteTable } from "./sqlite"

export async function validateUniqueIndexes(
  database: BaseSQLiteDatabase<"async", unknown>,
  tableMetadata: DatabaseTable,
  table: ReturnType<typeof toDrizzleSqliteTable>,
  columns: Record<string, SQLiteColumn>,
  model: PortableEntity,
  records: Record<string, unknown>[],
  primaryKeys: string[]
): Promise<void> {
  const uniqueIndexes = tableMetadata.indexes.filter((index) => index.unique)

  for (const index of uniqueIndexes) {
    const seen = new Map<string, Record<string, unknown>>()

    for (const record of records) {
      const key = uniqueIndexRecordKey(index, record)
      if (!key || !partialIndexMatchesRecord(index, record)) {
        continue
      }

      if (seen.has(key)) {
        throw uniqueIndexError(model, index, record)
      }
      seen.set(key, record)

      const where = uniqueIndexWhere(index, columns, record)
      if (!where) {
        continue
      }

      const primaryKeyFilter = hasCompletePrimaryKey(record, primaryKeys)
        ? primaryKeyWhere(columns, primaryKeys, record)
        : undefined
      const exclusion = primaryKeyFilter ? not(primaryKeyFilter) : undefined
      const existingWhere = exclusion ? and(where, exclusion) : where
      const existing = await database
        .select({ id: columns[primaryKeys[0]] })
        .from(table)
        .where(existingWhere)
        .limit(1)

      if (existing.length) {
        throw uniqueIndexError(model, index, record)
      }
    }
  }
}

export async function mapDrizzleMutationError<TResult>(
  operation: () => Promise<TResult>
): Promise<TResult> {
  try {
    return await operation()
  } catch (error) {
    throw mapDrizzleError(error)
  }
}

function uniqueIndexWhere(
  index: DatabaseIndex,
  columns: Record<string, SQLiteColumn>,
  record: Record<string, unknown>
) {
  const columnConditions = index.columns.map((column) =>
    eq(columns[column], record[column])
  )
  const partialCondition = partialIndexWhere(index, columns)
  if (index.where && !partialCondition) {
    return undefined
  }

  return and(...columnConditions, partialCondition)
}

function partialIndexWhere(
  index: DatabaseIndex,
  columns: Record<string, SQLiteColumn>
) {
  if (!index.where) {
    return undefined
  }

  const conditions = index.where
    .split(/\s+AND\s+/i)
    .map((predicate) => partialIndexPredicateWhere(predicate, columns))

  if (conditions.some((condition) => !condition)) {
    return undefined
  }

  return and(...conditions)
}

function partialIndexPredicateWhere(
  predicate: string,
  columns: Record<string, SQLiteColumn>
) {
  const isNullMatch = predicate.match(/^"?([^"]+)"?\s+IS\s+NULL$/i)
  if (isNullMatch) {
    return isNull(columns[isNullMatch[1]])
  }

  const equalsBooleanMatch = predicate.match(
    /^"?([^"\s]+)"?\s*=\s*(true|false|1|0)$/i
  )
  if (equalsBooleanMatch) {
    return eq(
      columns[equalsBooleanMatch[1]],
      parseSqliteBoolean(equalsBooleanMatch[2])
    )
  }

  return undefined
}

function partialIndexMatchesRecord(
  index: DatabaseIndex,
  record: Record<string, unknown>
): boolean {
  if (!index.where) {
    return true
  }

  return index.where
    .split(/\s+AND\s+/i)
    .every((predicate) => partialIndexPredicateMatchesRecord(predicate, record))
}

function partialIndexPredicateMatchesRecord(
  predicate: string,
  record: Record<string, unknown>
): boolean {
  const isNullMatch = predicate.match(/^"?([^"]+)"?\s+IS\s+NULL$/i)
  if (isNullMatch) {
    const value = record[isNullMatch[1]]
    return value === undefined || value === null
  }

  const equalsBooleanMatch = predicate.match(
    /^"?([^"\s]+)"?\s*=\s*(true|false|1|0)$/i
  )
  if (equalsBooleanMatch) {
    return (
      booleanLikeValue(record[equalsBooleanMatch[1]]) ===
      parseSqliteBoolean(equalsBooleanMatch[2])
    )
  }

  return false
}

function uniqueIndexRecordKey(
  index: DatabaseIndex,
  record: Record<string, unknown>
): string | undefined {
  const values = index.columns.map((column) => record[column])
  if (values.some((value) => value === undefined || value === null)) {
    return undefined
  }

  return values.map((value) => String(value)).join("\u0000")
}

function uniqueIndexError(
  model: PortableEntity,
  index: DatabaseIndex,
  record: Record<string, unknown>
): Error {
  return new Error(
    `${displayEntityName(model)} with ${index.columns
      .map((column) => `${column}: ${formatConstraintValue(record[column])}`)
      .join(", ")}, already exists.`
  )
}

function displayEntityName(model: PortableEntity): string {
  const tableName = model
    .parse()
    .tableName.replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split("_")
    .join(" ")
    .toLowerCase()
  return `${tableName.charAt(0).toUpperCase()}${tableName.slice(1)}`
}

function parseSqliteBoolean(value: string): boolean {
  return value.toLowerCase() === "true" || value === "1"
}

function booleanLikeValue(value: unknown): boolean | undefined {
  if (typeof value === "boolean") {
    return value
  }
  if (typeof value === "number") {
    return value === 1
  }

  return undefined
}

function formatConstraintValue(value: unknown): string {
  if (typeof value === "boolean") {
    return value ? "true" : "false"
  }

  return String(value)
}

function mapDrizzleError(error: unknown): unknown {
  if (isSqliteCheckConstraintError(error)) {
    const mapped = new Error(errorMessage(error) ?? "CHECK constraint failed")
    mapped.name = "CheckConstraintViolationException"
    return mapped
  }

  return error
}

function isSqliteCheckConstraintError(error: unknown): boolean {
  const message = errorMessage(error)
  if (message && /CHECK constraint failed/.test(message)) {
    return true
  }

  const cause = isRecord(error) ? error.cause : undefined
  const causeMessage = errorMessage(cause)
  return Boolean(causeMessage && /CHECK constraint failed/.test(causeMessage))
}

function errorMessage(error: unknown): string | undefined {
  if (error instanceof Error) {
    return error.message
  }
  return isRecord(error) && typeof error.message === "string"
    ? error.message
    : undefined
}

function primaryKeyWhere(
  table: Record<string, SQLiteColumn>,
  primaryKeys: string[],
  record: Record<string, unknown>
) {
  return and(...primaryKeys.map((key) => eq(table[key], record[key])))
}

function hasCompletePrimaryKey(
  record: Record<string, unknown>,
  primaryKeys: string[]
): boolean {
  return primaryKeys.every((key) => record[key] !== undefined)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value))
}
