/** Selected storage-independent parts of the pinned Drizzle Medusa repository.
 * Source: packages/database/drizzle/src/medusa.ts at 48d5cc675e4e8bc821e22c20c88a751acc66fb5f.
 * toPopulateTree, projectRowFields and the grouping portions of
 * loadHasManyRelation/loadManyToManyRelation retain their source algorithms.
 * Reads, mutation of parent rows and SQL descriptors are left to the caller.
 */
import type { DatabaseColumn, DatabaseRelationship } from "./schema"

export type PopulateTree = Map<string, PopulateTree>

type RelationMetadata = Pick<DatabaseRelationship, "name" | "type" | "targetTable" | "mappedBy" | "pivotTable"> & {
  readonly foreignKeyNames?: readonly string[]
}
export interface RelationTable {
  readonly name: string
  readonly columns: readonly Pick<DatabaseColumn, "name" | "primaryKey">[]
  readonly relationships: readonly RelationMetadata[]
  readonly foreignKeys: readonly {
    readonly columns: readonly string[]
    readonly referencedTable: string
    readonly referencedColumns: readonly string[]
  }[]
}

export interface ToManyRelation {
  readonly name: string
  readonly sourcePrimaryKeys: readonly string[]
  readonly targetTable: string
  readonly targetPrimaryKeys: readonly string[]
  readonly join:
    | { readonly type: "hasMany"; readonly foreignKeys: readonly string[] }
    | {
        readonly type: "manyToMany"
        readonly pivotTable: string
        readonly sourceColumns: readonly string[]
        readonly targetColumns: readonly string[]
      }
}

/** Selected createRelationDescriptors metadata resolution, without SQL tables.
 * Unsupported or incomplete descriptors are returned to the caller for refusal.
 */
export function describeToManyRelation(
  source: RelationTable, name: string, tables: readonly RelationTable[]
): ToManyRelation | undefined {
  const relationship = source.relationships.find((entry) => entry.name === name)
  if (!relationship) return undefined
  const target = tables.find((entry) => entry.name === relationship.targetTable)
  if (!target) return undefined
  const primaryKeys = source.columns.filter((column) => column.primaryKey).map((column) => column.name)
  const targetPrimaryKeys = target.columns.filter((column) => column.primaryKey).map((column) => column.name)
  if (!primaryKeys.length || !targetPrimaryKeys.length) return undefined
  const reference = (table: RelationTable, referencedTable: string, keys: readonly string[]) =>
    table.foreignKeys.find((key) => key.referencedTable === referencedTable &&
      key.referencedColumns.length === keys.length && key.referencedColumns.every((column, index) => column === keys[index]))
  const base = { name, sourcePrimaryKeys: primaryKeys, targetTable: target.name, targetPrimaryKeys }
  if (relationship.type === "hasMany") {
    const inverse = target.relationships.find((entry) => entry.name === relationship.mappedBy && entry.targetTable === source.name)
    const foreignKeys = inverse?.foreignKeyNames ?? reference(target, source.name, primaryKeys)?.columns
    if (!foreignKeys || foreignKeys.length !== primaryKeys.length) return undefined
    return { ...base, join: { type: "hasMany", foreignKeys } }
  }
  if (relationship.type === "manyToMany") {
    const pivot = tables.find((entry) => entry.name === relationship.pivotTable)
    if (!pivot) return undefined
    const sourceColumns = reference(pivot, source.name, primaryKeys)?.columns
    const targetColumns = reference(pivot, target.name, targetPrimaryKeys)?.columns
    if (!sourceColumns || !targetColumns) return undefined
    return { ...base, join: { type: "manyToMany", pivotTable: pivot.name, sourceColumns, targetColumns } }
  }
  return undefined
}

export function toPopulateTree(populate: readonly string[]): PopulateTree {
  const tree: PopulateTree = new Map()
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

export function tupleKey(row: Readonly<Record<string, unknown>>, keys: readonly string[]): string {
  return JSON.stringify(keys.map((key) => row[key]))
}

export function groupHasManyRows<Row extends Readonly<Record<string, unknown>>>(
  relatedRows: readonly Row[],
  foreignKeys: readonly string[]
): Map<string, Row[]> {
  const relatedByForeignKey = new Map<string, Row[]>()
  for (const relatedRow of relatedRows) {
    const key = tupleKey(relatedRow, foreignKeys)
    const existing = relatedByForeignKey.get(key) ?? []
    existing.push(relatedRow)
    relatedByForeignKey.set(key, existing)
  }
  return relatedByForeignKey
}

export function groupManyToManyRows<Row extends Readonly<Record<string, unknown>>>(
  relatedRows: readonly Row[],
  pivotRows: readonly Readonly<Record<string, unknown>>[],
  targetPrimaryKeys: readonly string[],
  sourcePivotColumns: readonly string[],
  targetPivotColumns: readonly string[]
): Map<string, Row[]> {
  const relatedByPrimaryKey = new Map(
    relatedRows.map((row) => [tupleKey(row, targetPrimaryKeys), row])
  )
  const relatedBySource = new Map<string, Row[]>()
  for (const pivotRow of pivotRows) {
    const sourceValue = tupleKey(pivotRow, sourcePivotColumns)
    const targetValue = tupleKey(pivotRow, targetPivotColumns)
    const relatedRow = relatedByPrimaryKey.get(targetValue)
    if (!relatedRow) continue
    const existing = relatedBySource.get(sourceValue) ?? []
    existing.push(relatedRow)
    relatedBySource.set(sourceValue, existing)
  }
  return relatedBySource
}

export function projectRowFields<Value>(
  row: Readonly<Record<string, Value>>,
  fields: ReadonlySet<string>
): Record<string, Value> {
  const projected: Record<string, Value> = {}
  for (const [field, value] of Object.entries(row)) {
    if (fields.has(field)) projected[field] = value
  }
  return projected
}
