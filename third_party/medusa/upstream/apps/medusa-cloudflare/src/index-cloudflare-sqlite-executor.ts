import type {
  SqliteIndexExecutor,
  SqliteIndexValue,
} from "@medusajs/index/worker-composition"

type D1ResultRow = Record<string, unknown>

export class DurableObjectSqliteIndexExecutor implements SqliteIndexExecutor {
  constructor(private readonly storage: DurableObjectStorage) {}

  async execute(
    sql: string,
    params: readonly SqliteIndexValue[] = []
  ): Promise<readonly Record<string, SqliteIndexValue>[]> {
    const cursor = this.storage.sql.exec(
      sql,
      ...params.map(toSqlStorageBinding)
    )

    if (!isSelectStatement(sql)) {
      return []
    }

    return cursor.toArray().map(normalizeSqliteRow)
  }
}

export class D1SqliteIndexExecutor implements SqliteIndexExecutor {
  constructor(private readonly database: D1Database) {}

  async execute(
    sql: string,
    params: readonly SqliteIndexValue[] = []
  ): Promise<readonly Record<string, SqliteIndexValue>[]> {
    const statement = this.database.prepare(sql).bind(...params)

    if (!isSelectStatement(sql)) {
      await statement.run()
      return []
    }

    const result = await statement.all<D1ResultRow>()
    return result.results.map(normalizeSqliteRow)
  }
}

function isSelectStatement(sql: string): boolean {
  return sql.trimStart().toUpperCase().startsWith("SELECT")
}

function normalizeSqliteRow(
  value: Record<string, SqlStorageValue | unknown>
): Record<string, SqliteIndexValue> {
  const row: Record<string, SqliteIndexValue> = {}

  for (const [key, entry] of Object.entries(value)) {
    if (
      typeof entry === "string" ||
      typeof entry === "number" ||
      entry === null
    ) {
      row[key] = entry
      continue
    }

    throw new Error(`Unexpected Cloudflare SQLite value for column ${key}`)
  }

  return row
}

function toSqlStorageBinding(value: SqliteIndexValue): SqlStorageValue {
  return value
}
