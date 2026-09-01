import type {
  DatabaseCheck,
  DatabaseColumn,
  DatabaseForeignKey,
  DatabaseIndex,
  DatabaseSchema,
  DatabaseTable,
} from "./schema"

export function renderD1MigrationSql(schema: DatabaseSchema): string {
  return schema.tables.map(renderTable).join("\n\n") + "\n"
}

function renderTable(table: DatabaseTable): string {
  const primaryKeyColumns = table.columns.filter((column) => column.primaryKey)
  const columns = [
    ...table.columns.map((column) =>
      renderColumn(column, primaryKeyColumns.length)
    ),
    ...(primaryKeyColumns.length > 1
      ? [renderPrimaryKeyConstraint(table, primaryKeyColumns)]
      : []),
    ...table.checks.map(renderCheck),
    ...table.foreignKeys.map(renderForeignKey),
  ].join(",\n")
  const statements = [
    `CREATE TABLE IF NOT EXISTS ${quoteIdentifier(
      table.name
    )} (\n${columns}\n);`,
    ...table.indexes.map((index) => renderIndex(table, index)),
  ]

  return statements.join("\n\n")
}

function renderPrimaryKeyConstraint(
  table: DatabaseTable,
  columns: DatabaseColumn[]
): string {
  return `  CONSTRAINT ${quoteIdentifier(
    `${table.name}_primary_key`
  )} PRIMARY KEY (${columns
    .map((column) => quoteIdentifier(column.name))
    .join(", ")})`
}

function renderCheck(check: DatabaseCheck): string {
  return `  CONSTRAINT ${quoteIdentifier(check.name)} CHECK (${check.expression})`
}

function renderForeignKey(foreignKey: DatabaseForeignKey): string {
  const columns = foreignKey.columns.map(quoteIdentifier).join(", ")
  const referencedColumns = foreignKey.referencedColumns
    .map(quoteIdentifier)
    .join(", ")
  const onDelete = foreignKey.onDelete
    ? ` ON DELETE ${foreignKey.onDelete.toUpperCase()}`
    : ""

  return `  CONSTRAINT ${quoteIdentifier(
    foreignKey.name
  )} FOREIGN KEY (${columns}) REFERENCES ${quoteIdentifier(
    foreignKey.referencedTable
  )} (${referencedColumns})${onDelete}`
}

function renderColumn(
  column: DatabaseColumn,
  primaryKeyColumnCount: number
): string {
  const parts = [`  ${quoteIdentifier(column.name)}`, sqliteType(column.type)]

  if (column.primaryKey && primaryKeyColumnCount === 1) {
    parts.push("PRIMARY KEY")
    if (column.type === "serial") {
      parts.push("AUTOINCREMENT")
    }
  }
  if (
    column.primaryKey &&
    primaryKeyColumnCount > 1 &&
    column.type === "serial"
  ) {
    throw new Error(
      "Composite D1 primary keys cannot use autoincrement columns"
    )
  }
  if (!column.nullable) {
    parts.push("NOT NULL")
  }
  if (column.defaultValue !== undefined) {
    parts.push(`DEFAULT ${renderDefaultValue(column.defaultValue)}`)
  }

  return parts.join(" ")
}

function renderIndex(table: DatabaseTable, index: DatabaseIndex): string {
  const unique = index.unique ? "UNIQUE " : ""
  const columns = index.columns.map(quoteIdentifier).join(", ")
  const where = index.where ? ` WHERE ${index.where}` : ""

  return `CREATE ${unique}INDEX IF NOT EXISTS ${quoteIdentifier(
    index.name
  )} ON ${quoteIdentifier(table.name)} (${columns})${where};`
}

function sqliteType(type: DatabaseColumn["type"]): string {
  switch (type) {
    case "boolean":
    case "dateTime":
    case "number":
    case "serial":
      return "INTEGER"
    case "bigNumber":
    case "float":
      return "REAL"
    default:
      return "TEXT"
  }
}

function renderDefaultValue(value: unknown): string {
  if (typeof value === "string") {
    return quoteString(value)
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("D1 migration defaults must be finite numbers")
    }
    return String(value)
  }
  if (typeof value === "boolean") {
    return value ? "1" : "0"
  }
  if (value === null) {
    return "NULL"
  }
  if (typeof value === "object") {
    return quoteString(JSON.stringify(value))
  }

  throw new Error(`Unsupported D1 migration default type: ${typeof value}`)
}

function quoteIdentifier(value: string): string {
  return `"${value.replace(/"/g, '""')}"`
}

function quoteString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}
