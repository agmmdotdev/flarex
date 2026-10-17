/** Selected storage-independent parts of the pinned Drizzle Medusa repository.
 * Source: packages/database/drizzle/src/medusa.ts at 48d5cc675e4e8bc821e22c20c88a751acc66fb5f.
 * toPopulateTree, projectRowFields and the grouping portions of
 * loadHasManyRelation/loadManyToManyRelation retain their source algorithms.
 * The native fillEmptyToManyRelations initialization mutates detached creation
 * results; reads and SQL descriptors remain with the caller.
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

/** Pinned preservePrimaryKeyOrFilterOrder and its two selector helpers from
 * medusa.ts. Only the row generic and explicit key guard adapt their types;
 * default/id-ASC filter ordering retains the native in-place algorithm. */
export function preservePrimaryKeyOrFilterOrder<Row extends Record<string, unknown>>(
  rows: Row[],
  where: unknown,
  primaryKeys: readonly string[],
  ordering: ReadonlyArray<readonly [string, "ASC" | "DESC"]>
): Row[] {
  const primaryKey = primaryKeys[0]
  if (primaryKeys.length !== 1 || primaryKey === undefined ||
    !canPreservePrimaryKeyOrFilterOrder(ordering, primaryKey)) {
    return rows
  }
  const orderedPrimaryKeys = primaryKeyOrderFromFilter(where, primaryKey)
  if (!orderedPrimaryKeys.length) return rows
  const orderByPrimaryKey = new Map(
    orderedPrimaryKeys.map((key, index) => [key, index])
  )
  return rows.sort((left, right) => {
    const leftOrder = orderByPrimaryKey.get(String(left[primaryKey]))
    const rightOrder = orderByPrimaryKey.get(String(right[primaryKey]))
    if (leftOrder === undefined && rightOrder === undefined) return 0
    if (leftOrder === undefined) return 1
    if (rightOrder === undefined) return -1
    return leftOrder - rightOrder
  })
}

function canPreservePrimaryKeyOrFilterOrder(
  ordering: ReadonlyArray<readonly [string, "ASC" | "DESC"]>, primaryKey: string
): boolean {
  return !ordering.length || (ordering.length === 1 &&
    ordering[0]?.[0] === primaryKey && ordering[0][1] === "ASC")
}

function primaryKeyOrderFromFilter(where: unknown, primaryKey: string): string[] {
  if (!where || typeof where !== "object" || Array.isArray(where)) return []
  const orFilter = Reflect.get(where, "$or")
  if (Array.isArray(orFilter)) return orFilter.flatMap(entry => primaryKeyOrderFromFilter(entry, primaryKey))
  const value = Reflect.get(where, primaryKey)
  if (Array.isArray(value)) return value.filter(entry => typeof entry === "string" || typeof entry === "number").map(String)
  if (typeof value === "string" || typeof value === "number") return [String(value)]
  return []
}

/** Native zero-to-many initialization for detached creation results. This does
 * not load or validate relation members and grants no relationship capability. */
export function fillEmptyToManyRelations(
  rows: Record<string, unknown>[],
  descriptors: ReadonlyMap<string, { readonly relationship: Pick<DatabaseRelationship, "type"> }>
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

/** Metadata-only native descriptor seam; SQL tables/managers are not required
 * to resolve relation paths to real scalar projection fields. */
export interface ScalarFieldRelationDescriptor {
  readonly targetModel: { parse(): { schema: Readonly<Record<string, unknown>> } }
  readonly relationship: { readonly targetModel: string }
}

/** Exact native relationScalarFieldPaths algorithm from medusa.ts. Only its
 * SQL-bearing descriptor types are replaced by the metadata-only seam above. */
export function relationScalarFieldPaths(
  populate: string[] | boolean | undefined,
  descriptors: ReadonlyMap<string, ScalarFieldRelationDescriptor>,
  descriptorsByModel: ReadonlyMap<string, ReadonlyMap<string, ScalarFieldRelationDescriptor>>
): string[] {
  if (!Array.isArray(populate)) {
    return []
  }

  const fields: string[] = []
  for (const path of populate) {
    const parts = path.split(".").filter(Boolean)
    let currentDescriptors = descriptors
    const relationParts: string[] = []
    let currentModel: ScalarFieldRelationDescriptor["targetModel"] | undefined

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
