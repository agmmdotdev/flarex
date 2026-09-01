import type {
  PortableDataType,
  PortableEntity,
  PortablePropertyMetadata,
  PortableRelationshipMetadata,
  PortableSchemaMember,
} from "@medusajs/dml"

export interface DatabaseColumn {
  name: string
  type: PortableDataType
  nullable: boolean
  primaryKey: boolean
  defaultValue?: unknown
  options?: Record<string, unknown>
  generated?: boolean
}

export interface DatabaseIndex {
  name: string
  columns: string[]
  unique: boolean
  where?: string
}

export interface DatabaseCheck {
  name: string
  expression: string
}

export interface DatabaseTable {
  name: string
  columns: DatabaseColumn[]
  indexes: DatabaseIndex[]
  checks: DatabaseCheck[]
  foreignKeys: DatabaseForeignKey[]
  relationships: DatabaseRelationship[]
  cascades: {
    delete: string[]
    detach: string[]
  }
}

export interface DatabaseForeignKey {
  name: string
  columns: string[]
  referencedTable: string
  referencedColumns: string[]
  onDelete?: "cascade"
}

export interface DatabaseRelationship {
  name: string
  type: PortableRelationshipMetadata["type"]
  targetModel: string
  targetTable: string
  mappedBy?: string
  nullable: boolean
  cascadeDelete: boolean
  cascadeDetach: boolean
  foreignKeyName?: string
  foreignKeyNames?: string[]
  pivotModel?: string
  pivotTable?: string
  joinColumns?: string[]
  inverseJoinColumns?: string[]
}

export interface DatabaseSchema {
  tables: DatabaseTable[]
}

export function compileDmlSchema(entities: PortableEntity[]): DatabaseSchema {
  const compiled = entities.map(compileEntity)
  const tables = compiled.map((entry) => entry.table)
  applyRelationshipForeignKeys(tables)
  applyManyToManyPivotTables(tables)
  for (const entry of compiled) {
    applyCheckConstraints(entry.table, entry.checks)
  }

  return {
    tables,
  }
}

function compileEntity(entity: PortableEntity): {
  table: DatabaseTable
  checks: unknown[]
} {
  const parsed = entity.parse()
  const columns: DatabaseColumn[] = []
  const indexes: DatabaseIndex[] = []
  const relationships: DatabaseRelationship[] = []
  const schemaFieldNames = new Set(Object.keys(parsed.schema))

  for (const [fieldName, member] of Object.entries(parsed.schema)) {
    const metadata = member.parse(fieldName)
    if (isRelationshipMetadata(metadata)) {
      relationships.push(
        toRelationship(
          parsed.name,
          metadata,
          parsed.cascades.delete?.includes(fieldName),
          parsed.cascades.detach?.includes(fieldName)
        )
      )
      continue
    }
    if (metadata.computed) {
      continue
    }

    columns.push(toColumn(metadata))
    const rawColumnName = `raw_${metadata.fieldName}`
    if (
      metadata.dataType.name === "bigNumber" &&
      !schemaFieldNames.has(rawColumnName)
    ) {
      columns.push({
        name: rawColumnName,
        type: "json",
        nullable: true,
        primaryKey: false,
        generated: true,
      })
    }
    indexes.push(
      ...metadata.indexes.map((entry) => ({
        name: entry.name ?? `${parsed.tableName}_${fieldName}_${entry.type}`,
        columns: [fieldName],
        unique: entry.type === "unique",
      }))
    )
  }

  indexes.push(
    ...parsed.indexes.map((entry, index) => ({
      name: entry.name ?? `${parsed.tableName}_${entry.on.join("_")}_${index}`,
      columns: entry.on,
      unique: entry.unique ?? false,
      where: typeof entry.where === "string" ? entry.where : undefined,
    }))
  )

  return {
    table: {
      name: toSnakeCase(parsed.tableName),
      columns,
      indexes,
      checks: [],
      foreignKeys: [],
      relationships,
      cascades: {
        delete: [...(parsed.cascades.delete ?? [])],
        detach: [...(parsed.cascades.detach ?? [])],
      },
    },
    checks: parsed.checks,
  }
}

function applyCheckConstraints(table: DatabaseTable, checks: unknown[]): void {
  table.checks = checks.map((check, index) => {
    const name =
      isCheckObject(check) && typeof check.name === "string"
        ? check.name
        : `${table.name}_check_${index}`
    const expression = isCheckObject(check) ? check.expression : check

    if (typeof expression === "string") {
      return { name, expression }
    }
    if (typeof expression === "function") {
      return { name, expression: expression(checkColumns(table)) }
    }

    throw new Error(`Unsupported check constraint on table "${table.name}"`)
  })
}

function checkColumns(table: DatabaseTable): Record<string, string> {
  return Object.fromEntries(
    table.columns.map((column) => [column.name, quoteIdentifier(column.name)])
  )
}

function isCheckObject(
  value: unknown
): value is { name?: unknown; expression?: unknown } {
  return Boolean(value && typeof value === "object" && !Array.isArray(value))
}

function applyRelationshipForeignKeys(tables: DatabaseTable[]): void {
  for (const table of tables) {
    for (const relationship of table.relationships) {
      if (!ownsForeignKey(relationship)) {
        continue
      }

      const targetTable = tables.find(
        (candidate) => candidate.name === relationship.targetTable
      )
      if (!targetTable) {
        throw new Error(
          `Could not find target table "${relationship.targetTable}" for relationship "${table.name}.${relationship.name}"`
        )
      }

      const referencedColumns = primaryKeyColumns(targetTable)
      if (!referencedColumns.length) {
        throw new Error(
          `Relationship "${table.name}.${relationship.name}" requires a target primary key`
        )
      }

      if (referencedColumns.length > 1 && relationship.foreignKeyName) {
        throw new Error(
          `Relationship "${table.name}.${relationship.name}" cannot map composite target primary key columns with the singular foreignKeyName option`
        )
      }

      const columnNames =
        referencedColumns.length === 1
          ? [relationship.foreignKeyName ?? foreignKeyName(relationship)]
          : referencedColumns.map((column) =>
              toSnakeCase(`${relationship.name}_${column}`)
            )
      relationship.foreignKeyNames = columnNames

      for (const [index, columnName] of columnNames.entries()) {
        const referencedColumn = targetTable.columns.find(
          (column) => column.name === referencedColumns[index]
        )
        if (!referencedColumn) {
          throw new Error(
            `Could not find referenced primary key "${relationship.targetTable}.${referencedColumns[index]}"`
          )
        }

        if (!table.columns.some((column) => column.name === columnName)) {
          table.columns.push({
            name: columnName,
            type: referencedColumn.type,
            nullable: relationship.nullable,
            primaryKey: false,
            generated: true,
          })
        }
      }

      if (
        !table.indexes.some(
          (index) =>
            index.columns.length === columnNames.length &&
            index.columns.every(
              (column, columnIndex) => column === columnNames[columnIndex]
            )
        )
      ) {
        table.indexes.push({
          name: `${table.name}_${columnNames.join("_")}_index`,
          columns: columnNames,
          unique: false,
        })
      }

      table.foreignKeys.push({
        name: `${table.name}_${columnNames.join("_")}_foreign`,
        columns: columnNames,
        referencedTable: targetTable.name,
        referencedColumns,
        ...(hasInverseCascadeDelete(tables, table, relationship)
          ? { onDelete: "cascade" }
          : {}),
      })
    }
  }
}

function ownsForeignKey(relationship: DatabaseRelationship): boolean {
  return (
    relationship.type === "belongsTo" || relationship.type === "hasOneWithFK"
  )
}

function primaryKeyColumns(table: DatabaseTable): string[] {
  return table.columns
    .filter((column) => column.primaryKey)
    .map((column) => column.name)
}

function foreignKeyName(relationship: DatabaseRelationship): string {
  return toSnakeCase(`${relationship.name}Id`)
}

function hasInverseCascadeDelete(
  tables: DatabaseTable[],
  ownerTable: DatabaseTable,
  relationship: DatabaseRelationship
): boolean {
  if (!relationship.mappedBy) {
    return false
  }

  const targetTable = tables.find(
    (candidate) => candidate.name === relationship.targetTable
  )

  return Boolean(
    targetTable?.relationships.some(
      (candidate) =>
        candidate.name === relationship.mappedBy &&
        candidate.targetTable === ownerTable.name &&
        candidate.cascadeDelete
    )
  )
}

function applyManyToManyPivotTables(tables: DatabaseTable[]): void {
  const processedRelationships = new Set<string>()

  for (const table of [...tables]) {
    for (const relationship of table.relationships) {
      if (relationship.type !== "manyToMany" || relationship.pivotModel) {
        continue
      }

      const targetTable = tables.find(
        (candidate) => candidate.name === relationship.targetTable
      )
      if (!targetTable) {
        throw new Error(
          `Could not find target table "${relationship.targetTable}" for relationship "${table.name}.${relationship.name}"`
        )
      }

      const inverseRelationship = findInverseManyToManyRelationship(
        targetTable,
        table,
        relationship
      )
      const relationshipKey = manyToManyRelationshipKey(
        table,
        relationship,
        targetTable,
        inverseRelationship
      )
      if (processedRelationships.has(relationshipKey)) {
        continue
      }
      processedRelationships.add(relationshipKey)

      if (
        relationshipConfiguresPivot(relationship) &&
        inverseRelationship &&
        relationshipConfiguresPivot(inverseRelationship)
      ) {
        throw new Error(
          `Relationship "${table.name}.${relationship.name}" must define pivotTable, joinColumn, or inverseJoinColumn on only one side`
        )
      }

      const owner = resolveManyToManyOwner(
        table,
        relationship,
        targetTable,
        inverseRelationship
      )
      const pivotTableName =
        owner.relationship.pivotTable ??
        (owner.inverseRelationship?.pivotTable ||
          defaultPivotTableName(owner.sourceTable, owner.targetTable))
      const sourceColumns = resolveImplicitPivotColumns(
        owner.relationship.joinColumns,
        owner.sourceTable,
        table,
        relationship
      )
      const targetColumns = resolveImplicitPivotColumns(
        owner.relationship.inverseJoinColumns,
        owner.targetTable,
        table,
        relationship
      )

      if (
        new Set([...sourceColumns, ...targetColumns]).size !==
        sourceColumns.length + targetColumns.length
      ) {
        throw new Error(
          `Relationship "${table.name}.${relationship.name}" requires distinct implicit pivot columns`
        )
      }

      applyPivotMetadata(
        owner.sourceRelationship,
        pivotTableName,
        sourceColumns,
        targetColumns
      )
      if (owner.targetRelationship) {
        applyPivotMetadata(
          owner.targetRelationship,
          pivotTableName,
          targetColumns,
          sourceColumns
        )
      }

      if (!tables.some((candidate) => candidate.name === pivotTableName)) {
        tables.push(
          createImplicitPivotTable(
            pivotTableName,
            owner.sourceTable,
            sourceColumns,
            owner.targetTable,
            targetColumns
          )
        )
      }
    }
  }
}

function manyToManyRelationshipKey(
  table: DatabaseTable,
  relationship: DatabaseRelationship,
  targetTable: DatabaseTable,
  inverseRelationship: DatabaseRelationship | undefined
): string {
  return [
    `${table.name}.${relationship.name}`,
    inverseRelationship
      ? `${targetTable.name}.${inverseRelationship.name}`
      : `${targetTable.name}.${relationship.targetTable}`,
  ]
    .sort()
    .join("|")
}

function findInverseManyToManyRelationship(
  targetTable: DatabaseTable,
  sourceTable: DatabaseTable,
  relationship: DatabaseRelationship
): DatabaseRelationship | undefined {
  if (relationship.mappedBy) {
    return targetTable.relationships.find(
      (candidate) =>
        candidate.name === relationship.mappedBy &&
        candidate.type === "manyToMany" &&
        candidate.targetTable === sourceTable.name
    )
  }

  return targetTable.relationships.find(
    (candidate) =>
      candidate.type === "manyToMany" &&
      candidate.targetTable === sourceTable.name &&
      candidate.mappedBy === relationship.name
  )
}

function relationshipConfiguresPivot(
  relationship: DatabaseRelationship
): boolean {
  return Boolean(
    relationship.pivotTable ||
      relationship.joinColumns?.length ||
      relationship.inverseJoinColumns?.length
  )
}

function resolveManyToManyOwner(
  table: DatabaseTable,
  relationship: DatabaseRelationship,
  targetTable: DatabaseTable,
  inverseRelationship: DatabaseRelationship | undefined
): {
  sourceTable: DatabaseTable
  sourceRelationship: DatabaseRelationship
  targetTable: DatabaseTable
  targetRelationship?: DatabaseRelationship
  relationship: DatabaseRelationship
  inverseRelationship?: DatabaseRelationship
} {
  const currentConfiguresPivot = relationshipConfiguresPivot(relationship)
  const inverseConfiguresPivot =
    inverseRelationship && relationshipConfiguresPivot(inverseRelationship)

  if (currentConfiguresPivot || !inverseRelationship) {
    return {
      sourceTable: table,
      sourceRelationship: relationship,
      targetTable,
      targetRelationship: inverseRelationship,
      relationship,
      ...(inverseRelationship ? { inverseRelationship } : {}),
    }
  }

  if (inverseConfiguresPivot) {
    return {
      sourceTable: targetTable,
      sourceRelationship: inverseRelationship,
      targetTable: table,
      targetRelationship: relationship,
      relationship: inverseRelationship,
      inverseRelationship: relationship,
    }
  }

  if (table.name <= targetTable.name) {
    return {
      sourceTable: table,
      sourceRelationship: relationship,
      targetTable,
      targetRelationship: inverseRelationship,
      relationship,
      inverseRelationship,
    }
  }

  return {
    sourceTable: targetTable,
    sourceRelationship: inverseRelationship,
    targetTable: table,
    targetRelationship: relationship,
    relationship: inverseRelationship,
    inverseRelationship: relationship,
  }
}

function applyPivotMetadata(
  relationship: DatabaseRelationship,
  pivotTableName: string,
  sourceColumns: string[],
  targetColumns: string[]
): void {
  relationship.pivotTable = pivotTableName
  relationship.joinColumns = sourceColumns
  relationship.inverseJoinColumns = targetColumns
}

function createImplicitPivotTable(
  name: string,
  sourceTable: DatabaseTable,
  sourceColumns: string[],
  targetTable: DatabaseTable,
  targetColumns: string[]
): DatabaseTable {
  const sourcePrimaryKeys = primaryKeyColumnDefinitions(sourceTable)
  const targetPrimaryKeys = primaryKeyColumnDefinitions(targetTable)
  const columns = [
    ...sourceColumns.map((column, index) =>
      pivotColumn(column, sourcePrimaryKeys[index])
    ),
    ...targetColumns.map((column, index) =>
      pivotColumn(column, targetPrimaryKeys[index])
    ),
  ]

  return {
    name,
    columns,
    indexes: [
      {
        name: `${name}_${sourceColumns.join("_")}_index`,
        columns: sourceColumns,
        unique: false,
      },
      {
        name: `${name}_${targetColumns.join("_")}_index`,
        columns: targetColumns,
        unique: false,
      },
      {
        name: `${name}_${[...sourceColumns, ...targetColumns].join(
          "_"
        )}_unique`,
        columns: [...sourceColumns, ...targetColumns],
        unique: true,
      },
    ],
    checks: [],
    foreignKeys: [
      {
        name: `${name}_${sourceColumns.join("_")}_foreign`,
        columns: sourceColumns,
        referencedTable: sourceTable.name,
        referencedColumns: sourcePrimaryKeys.map((column) => column.name),
        onDelete: "cascade",
      },
      {
        name: `${name}_${targetColumns.join("_")}_foreign`,
        columns: targetColumns,
        referencedTable: targetTable.name,
        referencedColumns: targetPrimaryKeys.map((column) => column.name),
        onDelete: "cascade",
      },
    ],
    relationships: [],
    cascades: {
      delete: [],
      detach: [],
    },
  }
}

function resolveImplicitPivotColumns(
  configuredColumns: string[] | undefined,
  referencedTable: DatabaseTable,
  sourceTable: DatabaseTable,
  relationship: DatabaseRelationship
): string[] {
  const primaryKeys = primaryKeyColumnDefinitions(referencedTable)
  if (configuredColumns) {
    if (configuredColumns.length !== primaryKeys.length) {
      throw new Error(
        `Relationship "${sourceTable.name}.${relationship.name}" requires ${primaryKeys.length} pivot columns for "${referencedTable.name}"`
      )
    }
    return configuredColumns
  }

  return primaryKeys.length === 1
    ? [`${referencedTable.name}_id`]
    : primaryKeys.map((column) => `${referencedTable.name}_${column.name}`)
}

function primaryKeyColumnDefinitions(table: DatabaseTable): DatabaseColumn[] {
  const columns = table.columns.filter((column) => column.primaryKey)
  if (!columns.length) {
    throw new Error(
      `Implicit pivot table "${table.name}" requires a primary key`
    )
  }

  return columns
}

function pivotColumn(
  name: string,
  referencedColumn: DatabaseColumn | undefined
): DatabaseColumn {
  if (!referencedColumn) {
    throw new Error(
      `Could not resolve referenced column for pivot column "${name}"`
    )
  }

  return {
    name,
    type: referencedColumn.type,
    nullable: false,
    primaryKey: false,
    generated: true,
  }
}

function defaultPivotTableName(
  table: DatabaseTable,
  targetTable: DatabaseTable
): string {
  return [table.name, targetTable.name]
    .sort()
    .map((token, index) => (index === 1 ? pluralizeToken(token) : token))
    .join("_")
}

function pluralizeToken(value: string): string {
  if (value.endsWith("s")) {
    return value
  }
  if (/[bcdfghjklmnpqrstvwxyz]y$/i.test(value)) {
    return `${value.slice(0, -1)}ies`
  }

  return `${value}s`
}

function isRelationshipMetadata(
  metadata: ReturnType<PortableSchemaMember["parse"]>
): metadata is PortableRelationshipMetadata {
  return "type" in metadata && "entity" in metadata && !("dataType" in metadata)
}

function toRelationship(
  ownerName: string,
  metadata: PortableRelationshipMetadata,
  cascadeDelete = false,
  cascadeDetach = false
): DatabaseRelationship {
  const target = resolveRelationshipTarget(metadata.entity, {
    ownerName,
    relationshipName: metadata.name,
  })
  const pivot = metadata.options.pivotEntity
    ? resolveRelationshipTarget(metadata.options.pivotEntity, {
        ownerName,
        relationshipName: `${metadata.name}.pivotEntity`,
      })
    : undefined
  const joinColumns = toStringArray(metadata.options.joinColumn)
  const inverseJoinColumns = toStringArray(metadata.options.inverseJoinColumn)

  return {
    name: metadata.name,
    type: metadata.type,
    targetModel: target.name,
    targetTable: toSnakeCase(target.parse().tableName),
    ...(metadata.mappedBy ? { mappedBy: metadata.mappedBy } : {}),
    nullable: metadata.nullable ?? false,
    cascadeDelete,
    cascadeDetach,
    ...(typeof metadata.options.foreignKeyName === "string"
      ? { foreignKeyName: metadata.options.foreignKeyName }
      : {}),
    ...(pivot
      ? {
          pivotModel: pivot.name,
          pivotTable: toSnakeCase(pivot.parse().tableName),
        }
      : typeof metadata.options.pivotTable === "string"
      ? { pivotTable: toSnakeCase(metadata.options.pivotTable) }
      : {}),
    ...(joinColumns ? { joinColumns } : {}),
    ...(inverseJoinColumns ? { inverseJoinColumns } : {}),
  }
}

function resolveRelationshipTarget(
  value: unknown,
  context: {
    ownerName: string
    relationshipName: string
  }
): PortableEntity {
  const target = typeof value === "function" ? value() : value
  if (!isPortableEntity(target)) {
    throw new Error(
      `Drizzle DML relationship "${context.ownerName}.${context.relationshipName}" must reference a DML entity`
    )
  }

  return target
}

function isPortableEntity(value: unknown): value is PortableEntity {
  return Boolean(
    value &&
      typeof value === "object" &&
      "name" in value &&
      typeof value.name === "string" &&
      "parse" in value &&
      typeof value.parse === "function"
  )
}

function toStringArray(value: unknown): string[] | undefined {
  if (typeof value === "string") {
    return [value]
  }
  if (
    Array.isArray(value) &&
    value.every((entry) => typeof entry === "string")
  ) {
    return [...value]
  }
  return undefined
}

function toSnakeCase(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[\s.-]+/g, "_")
    .toLowerCase()
}

function quoteIdentifier(value: string): string {
  return `"${value.replace(/"/g, '""')}"`
}

function toColumn(metadata: PortablePropertyMetadata): DatabaseColumn {
  return {
    name: metadata.fieldName,
    type: metadata.dataType.name,
    nullable: metadata.nullable,
    primaryKey: metadata.primaryKey ?? false,
    defaultValue: metadata.defaultValue,
    options: metadata.dataType.options,
  }
}
