import type { DrizzleMedusaManager } from "@medusajs/drizzle/medusa"
import { drizzle } from "drizzle-orm/sqlite-proxy"

type ProxyMethod = "run" | "all" | "values" | "get"

export function createDurableObjectSqliteManager(
  storage: DurableObjectStorage
): DrizzleMedusaManager {
  const execute = (query: string, params: unknown[], method: ProxyMethod) => {
    const cursor = storage.sql.exec(
      query,
      ...params.map(toSqlStorageBinding)
    )
    if (method === "run") {
      return { rows: [] }
    }

    const rows = Array.from(cursor.raw<SqlStorageValue[]>())
    return { rows: method === "get" ? rows.slice(0, 1) : rows }
  }
  const database = drizzle(
    async (query, params, method) => execute(query, params, method),
    async (batch) =>
      storage.transactionSync(() =>
        batch.map(({ sql, params, method }) => execute(sql, params, method))
      )
  )
  const transactionManager: DrizzleMedusaManager = {
    database,
    transactionMode: "atomic",
    async transaction(task) {
      return await task(transactionManager)
    },
    async destroy() {},
  }
  const manager: DrizzleMedusaManager = {
    database,
    transactionMode: "atomic",
    async transaction(task) {
      return await storage.transaction(
        async () => await task(transactionManager)
      )
    },
    async destroy() {},
  }

  return manager
}

function toSqlStorageBinding(value: unknown): SqlStorageValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    value instanceof ArrayBuffer
  ) {
    return value
  }

  throw new Error(
    `Unsupported Durable Object SQLite binding type: ${typeof value}`
  )
}
