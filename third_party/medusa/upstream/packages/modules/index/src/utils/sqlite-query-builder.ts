import type { IndexTypes } from "@medusajs/framework/types"
import type { SqliteIndexValue } from "../services/sqlite-index-storage-provider"

type JsonObject = Record<string, unknown>

type SqliteWhereOperator =
  | "$eq"
  | "$ne"
  | "$like"
  | "$ilike"
  | "$in"
  | "$nin"
  | "$gt"
  | "$gte"
  | "$lt"
  | "$lte"

type SqliteOrderDirection = "ASC" | "DESC"

export type SqliteIndexQueryPlan = {
  sql: string
  params: readonly SqliteIndexValue[]
  countSql?: string
  countParams?: readonly SqliteIndexValue[]
  rootKey: string
  rootEntity: string
  relationTree: readonly SqliteIndexRelationNode[]
  outputRelationTree: readonly SqliteIndexRelationNode[]
  rootFields?: readonly string[]
  searchQuery?: string
  deferredPagination?: {
    take: number
    skip: number
  }
}

export type SqliteIndexRelationNode = {
  path: string
  property: string
  entity: string
  isList: boolean
  children: readonly SqliteIndexRelationNode[]
}

export type SqliteIndexResultRow = {
  id: string
  data: string
}

const operatorSql = {
  $eq: "=",
  $ne: "!=",
  $like: "LIKE",
  $ilike: "LIKE",
  $in: "IN",
  $nin: "NOT IN",
  $gt: ">",
  $gte: ">=",
  $lt: "<",
  $lte: "<=",
} satisfies Record<SqliteWhereOperator, string>

export function buildSqliteIndexQueryPlan<const TEntry extends string>(
  config: IndexTypes.IndexQueryConfig<TEntry>,
  schemaObjectRepresentation: IndexTypes.SchemaObjectRepresentation
): SqliteIndexQueryPlan {
  const rootKey = resolveRootKey(config)
  const entity = resolveRootEntity(rootKey, schemaObjectRepresentation)
  const whereParts: string[] = ["name = ?"]
  const params: SqliteIndexValue[] = [entity]
  const rootFilter = getObjectProperty(config.filters, rootKey)
  const directFilters = collectDirectFieldValues(rootFilter)
  const searchQuery = readSearchQuery(rootFilter)

  for (const [field, value] of Object.entries(directFilters)) {
    appendWhereClause(whereParts, params, field, value)
  }

  const order = resolveDirectOrder(config.pagination?.order, rootKey)
  const orderSql = order
    ? `ORDER BY json_extract(data, '$.${order.field}') ${order.direction}`
    : "ORDER BY id ASC"
  const pagination = config.pagination
  const paginationTake = pagination?.take
  const paginationSkip = pagination?.skip ?? 0
  const shouldDeferPagination =
    paginationTake !== undefined &&
    (hasPostLoadFilter(rootFilter) ||
      hasPostLoadOrder(config.pagination?.order, rootKey))
  const limitSql =
    paginationTake === undefined || shouldDeferPagination
      ? ""
      : " LIMIT ? OFFSET ?"
  const limitParams: SqliteIndexValue[] =
    paginationTake === undefined || shouldDeferPagination
      ? []
      : [paginationTake, paginationSkip]
  const whereSql = whereParts.length ? `WHERE ${whereParts.join(" AND ")}` : ""
  const sql = [
    "SELECT id, data FROM index_data",
    whereSql,
    orderSql,
    limitSql,
  ]
    .filter(Boolean)
    .join(" ")

  return {
    sql,
    params: [...params, ...limitParams],
    countSql:
      paginationTake === undefined
        ? undefined
        : `SELECT COUNT(*) AS estimate_count FROM index_data ${whereSql}`,
    countParams: paginationTake === undefined ? undefined : params,
    rootKey,
    rootEntity: entity,
    relationTree: buildRelationTree(
      collectRelationPaths(config, rootKey),
      rootKey,
      schemaObjectRepresentation
    ),
    outputRelationTree: buildRelationTree(
      config.fields ?? [],
      rootKey,
      schemaObjectRepresentation
    ),
    rootFields: resolveRootFields(config.fields ?? [], rootKey),
    searchQuery,
    deferredPagination:
      shouldDeferPagination && paginationTake !== undefined
      ? {
          take: paginationTake,
          skip: paginationSkip,
        }
      : undefined,
  }
}

export function buildSqliteIndexResultSet(
  rows: readonly Record<string, SqliteIndexValue>[],
  idsOnly: boolean
): JsonObject[] {
  return rows.map((row) => {
    const id = readStringColumn(row, "id")

    if (idsOnly) {
      return { id }
    }

    return parseDataColumn(row, id)
  })
}

export function readSqliteCount(
  rows: readonly Record<string, SqliteIndexValue>[]
): number {
  const value = rows[0]?.estimate_count

  if (typeof value === "number") {
    return value
  }

  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10)
    return Number.isNaN(parsed) ? 0 : parsed
  }

  return 0
}

function resolveRootKey<const TEntry extends string>(
  config: IndexTypes.IndexQueryConfig<TEntry>
): string {
  const fieldRoot = config.fields?.[0]?.split(".")[0]

  if (fieldRoot) {
    return fieldRoot
  }

  const filterRoot = Object.keys(config.filters ?? {})[0]
  if (filterRoot) {
    return filterRoot
  }

  const orderRoot = Object.keys(config.pagination?.order ?? {})[0]
  if (orderRoot) {
    return orderRoot
  }

  throw new Error("SQLite Index query requires a root entry point")
}

function resolveRootEntity(
  rootKey: string,
  schemaObjectRepresentation: IndexTypes.SchemaObjectRepresentation
): string {
  const schemaPropertiesMap =
    schemaObjectRepresentation._schemaPropertiesMap ?? {}
  const entity = schemaPropertiesMap[rootKey]?.ref?.entity

  if (!entity) {
    throw new Error(
      `SQLite Index query could not resolve root entity for ${rootKey}`
    )
  }

  return entity
}

function buildRelationTree(
  fields: readonly string[],
  rootKey: string,
  schemaObjectRepresentation: IndexTypes.SchemaObjectRepresentation
): readonly SqliteIndexRelationNode[] {
  const schemaPropertiesMap =
    schemaObjectRepresentation._schemaPropertiesMap ?? {}
  const roots: SqliteIndexRelationNode[] = []

  for (const field of fields) {
    const normalizedField = field.replace(/\.\*/g, "")
    const parts = normalizedField.split(".").filter(Boolean)

    if (parts[0] !== rootKey || parts.length < 2) {
      continue
    }

    let nodes = roots
    let path = rootKey

    for (const property of parts.slice(1)) {
      const nextPath = `${path}.${property}`
      const schemaProperty = schemaPropertiesMap[nextPath]

      if (!schemaProperty?.ref?.entity || !schemaProperty.ref.moduleConfig) {
        break
      }

      let node = nodes.find((entry) => entry.path === nextPath)

      if (!node) {
        node = {
          path: nextPath,
          property,
          entity: schemaProperty.ref.entity,
          isList: schemaProperty.isList === true,
          children: [],
        }
        nodes.push(node)
      }

      nodes = node.children as SqliteIndexRelationNode[]
      path = nextPath
    }
  }

  return roots
}

function collectRelationPaths<const TEntry extends string>(
  config: IndexTypes.IndexQueryConfig<TEntry>,
  rootKey: string
): readonly string[] {
  return [
    ...(config.fields ?? []),
    ...collectNestedObjectPaths(config.filters, rootKey),
    ...collectNestedObjectPaths(config.pagination?.order, rootKey),
    ...collectJoinFilterPaths(config.joinFilters),
  ]
}

function resolveRootFields(
  fields: readonly string[],
  rootKey: string
): readonly string[] | undefined {
  const rootFields = new Set<string>(["id"])
  let hasExplicitRootScalarField = false

  for (const field of fields) {
    const parts = field.split(".").filter(Boolean)

    if (parts[0] !== rootKey) {
      continue
    }

    if (parts.length === 2 && parts[1] !== "*") {
      rootFields.add(parts[1])
      hasExplicitRootScalarField = true
    }

    if (parts.length === 2 && parts[1] === "*") {
      return undefined
    }
  }

  return hasExplicitRootScalarField ? [...rootFields] : undefined
}

function collectNestedObjectPaths(value: unknown, rootKey: string): string[] {
  const rootValue = getObjectProperty(value, rootKey)

  if (!isPlainObject(rootValue)) {
    return []
  }

  return collectPathsFromObject(rootValue, rootKey)
}

function collectJoinFilterPaths(value: unknown): string[] {
  if (!isPlainObject(value)) {
    return []
  }

  return Object.keys(value)
}

function collectPathsFromObject(value: Record<string, unknown>, path: string): string[] {
  const paths: string[] = []

  for (const [key, entry] of Object.entries(value)) {
    if (key.startsWith("$")) {
      continue
    }

    const nextPath = `${path}.${key}`
    paths.push(nextPath)

    if (isPlainObject(entry) && !isOperatorObject(entry)) {
      paths.push(...collectPathsFromObject(entry, nextPath))
    }
  }

  return paths
}

function collectDirectFieldValues(value: unknown): Record<string, unknown> {
  if (!isPlainObject(value)) {
    return {}
  }

  const result: Record<string, unknown> = {}

  for (const [key, entry] of Object.entries(value)) {
    if (key === "q" || key.startsWith("$")) {
      continue
    }

    if (isOperatorObject(entry) || !isPlainObject(entry)) {
      result[key] = entry
    }
  }

  return result
}

function hasPostLoadFilter(value: unknown): boolean {
  if (!isPlainObject(value)) {
    return false
  }

  for (const [key, entry] of Object.entries(value)) {
    if (key === "q" && typeof entry === "string" && entry.trim()) {
      return true
    }

    if (key.startsWith("$")) {
      return true
    }

    if (isPlainObject(entry) && !isOperatorObject(entry)) {
      return true
    }
  }

  return false
}

function readSearchQuery(value: unknown): string | undefined {
  if (!isPlainObject(value)) {
    return undefined
  }

  const query = value.q

  if (typeof query !== "string") {
    return undefined
  }

  const trimmedQuery = query.trim()
  return trimmedQuery ? trimmedQuery : undefined
}

function hasPostLoadOrder(order: unknown, rootKey: string): boolean {
  const rootOrder = getObjectProperty(order, rootKey)

  if (!isPlainObject(rootOrder)) {
    return false
  }

  return Object.values(rootOrder).some(isPlainObject)
}

function appendWhereClause(
  whereParts: string[],
  params: SqliteIndexValue[],
  field: string,
  value: unknown
): void {
  if (isOperatorObject(value)) {
    for (const [operator, operatorValue] of Object.entries(value)) {
      appendOperatorWhereClause(
        whereParts,
        params,
        field,
        operator as SqliteWhereOperator,
        operatorValue
      )
    }
    return
  }

  appendOperatorWhereClause(
    whereParts,
    params,
    field,
    Array.isArray(value) ? "$in" : "$eq",
    value
  )
}

function appendOperatorWhereClause(
  whereParts: string[],
  params: SqliteIndexValue[],
  field: string,
  operator: SqliteWhereOperator,
  value: unknown
): void {
  if (value === null) {
    whereParts.push(
      `json_extract(data, '$.${field}') ${operator === "$ne" ? "IS NOT" : "IS"} NULL`
    )
    return
  }

  const sqlOperator = operatorSql[operator]
  if (!sqlOperator) {
    throw new Error(`SQLite Index query does not support operator ${operator}`)
  }

  if (operator === "$in" || operator === "$nin") {
    if (!Array.isArray(value)) {
      throw new Error(`SQLite Index query operator ${operator} requires an array`)
    }

    if (!value.length) {
      whereParts.push(operator === "$in" ? "1 = 0" : "1 = 1")
      return
    }

    const values = value.map(normalizeSqliteValue)
    whereParts.push(
      `json_extract(data, '$.${field}') ${sqlOperator} (${values
        .map(() => "?")
        .join(", ")})`
    )
    params.push(...values)
    return
  }

  whereParts.push(`json_extract(data, '$.${field}') ${sqlOperator} ?`)
  params.push(normalizeSqliteValue(value))
}

function resolveDirectOrder(
  order: unknown,
  rootKey: string
): { field: string; direction: SqliteOrderDirection } | undefined {
  const rootOrder = getObjectProperty(order, rootKey)
  if (!isPlainObject(rootOrder)) {
    return
  }

  for (const [field, direction] of Object.entries(rootOrder)) {
    if (direction === "ASC" || direction === "DESC") {
      return { field, direction }
    }

    if (direction === 1) {
      return { field, direction: "ASC" }
    }

    if (direction === -1) {
      return { field, direction: "DESC" }
    }
  }

  return undefined
}

function normalizeSqliteValue(value: unknown): SqliteIndexValue {
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    value === null
  ) {
    return value
  }

  if (typeof value === "boolean") {
    return value ? 1 : 0
  }

  throw new Error("SQLite Index query only supports scalar filter values")
}

function parseDataColumn(
  row: Record<string, SqliteIndexValue>,
  fallbackId: string
): JsonObject {
  const data = row.data

  if (typeof data !== "string") {
    return { id: fallbackId }
  }

  const parsed = JSON.parse(data) as unknown
  if (!isPlainObject(parsed)) {
    return { id: fallbackId }
  }

  return parsed
}

function readStringColumn(
  row: Record<string, SqliteIndexValue>,
  column: string
): string {
  const value = row[column]

  if (typeof value !== "string") {
    throw new Error(`SQLite Index query expected string column ${column}`)
  }

  return value
}

function getObjectProperty(value: unknown, key: string): unknown {
  if (!isPlainObject(value)) {
    return undefined
  }

  return value[key]
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isOperatorObject(
  value: unknown
): value is Partial<Record<SqliteWhereOperator, unknown>> {
  if (!isPlainObject(value)) {
    return false
  }

  return Object.keys(value).some((key) => key in operatorSql)
}
