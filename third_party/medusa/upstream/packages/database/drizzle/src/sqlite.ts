import { sql } from "drizzle-orm"
import {
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core"
import type { DatabaseColumn, DatabaseTable } from "./schema"

export function toDrizzleSqliteTable(table: DatabaseTable) {
  const columns = Object.fromEntries(
    table.columns.map((column) => [column.name, createColumn(column)])
  )

  return sqliteTable(table.name, columns, (builtColumns) =>
    table.indexes.map((entry) => {
      const builder = entry.unique ? uniqueIndex(entry.name) : index(entry.name)
      const [firstColumn, ...remainingColumns] = entry.columns.map(
        (column) => builtColumns[column] as never
      )

      if (!firstColumn) {
        throw new Error(
          `Index "${entry.name}" must contain at least one column`
        )
      }

      const builtIndex = builder.on(firstColumn, ...remainingColumns)

      return entry.where ? builtIndex.where(sql.raw(entry.where)) : builtIndex
    })
  )
}

function createColumn(column: DatabaseColumn): any {
  let builder: any

  switch (column.type) {
    case "array":
    case "enum":
    case "id":
    case "json":
    case "text":
      builder = text(
        column.name,
        column.type === "json" || column.type === "array"
          ? { mode: "json" }
          : {}
      )
      break
    case "boolean":
      builder = integer(column.name, { mode: "boolean" })
      break
    case "dateTime":
      builder = integer(column.name, { mode: "timestamp_ms" })
      break
    case "bigNumber":
    case "float":
      builder = real(column.name)
      break
    case "number":
    case "serial":
      builder = integer(column.name)
      break
  }

  if (column.primaryKey) {
    builder = builder.primaryKey({
      autoIncrement: column.type === "serial",
    })
  }

  if (!column.nullable && !column.primaryKey) {
    builder = builder.notNull()
  }

  if (column.defaultValue !== undefined) {
    builder = builder.default(column.defaultValue)
  }

  return builder
}
