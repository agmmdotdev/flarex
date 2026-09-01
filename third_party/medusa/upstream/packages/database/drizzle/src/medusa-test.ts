import { loadModels, normalizeImportPathWithSource } from "@medusajs/utils"
import { drizzle } from "drizzle-orm/sqlite-proxy"
import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core"
import type { PortableEntity } from "@medusajs/dml"
import { drizzleModulePersistenceAdapter, DrizzleMedusaManager } from "./medusa"
import { compileDmlSchema } from "./schema"
import { renderD1MigrationSql } from "./d1"
import * as fs from "fs"

interface ModuleTestDatabaseConfig {
  clientUrl: string
  schema: string
  debug: boolean
}

interface PrepareOptions {
  connection: DrizzleTestConnection
  moduleModels?: object[]
  resolve?: string
  cwd?: string
}

interface DrizzleTestConnection extends DrizzleMedusaManager {
  sqlite: NodeSqliteDatabase
  models: PortableEntity[]
}

export const drizzleModuleTestPersistenceAdapter = {
  name: "drizzle",

  createDatabaseConfig({
    schema,
    debug,
  }: {
    schema: string
    debug: boolean
  }): ModuleTestDatabaseConfig {
    return {
      clientUrl: ":memory:",
      schema,
      debug,
    }
  },

  createConnection(): DrizzleTestConnection {
    const { DatabaseSync } = require("node:sqlite") as {
      DatabaseSync: new (path: string) => NodeSqliteDatabase
    }
    const sqlite = new DatabaseSync(":memory:")
    const database = drizzle(async (query, params, method) => {
      const statement = sqlite.prepare(query)
      if (method === "run") {
        return { rows: [statement.run(...params)] }
      }
      if (method === "get") {
        const row = statement.get(...params)
        return { rows: row ? [Object.values(row)] : [] }
      }
      return { rows: statement.all(...params).map((row) => Object.values(row)) }
    })
    let transactionQueue = Promise.resolve()

    const connection: DrizzleTestConnection = {
      sqlite,
      database,
      models: [],
      transactionMode: "atomic",
      transaction: createAtomicTransaction(database, (task) => {
        const queued = transactionQueue.then(task, task)
        transactionQueue = queued.then(
          () => undefined,
          () => undefined
        )
        return queued
      }),
      async destroy() {
        sqlite.close()
      },
    }
    return connection
  },

  prepareDatabase(
    options: PrepareOptions & { dbConfig: ModuleTestDatabaseConfig }
  ) {
    const connection = options.connection
    const models = discoverModuleModels(options)
    connection.models = models

    return {
      models,
      database: {
        async setupDatabase() {
          connection.sqlite.exec(renderD1MigrationSql(compileDmlSchema(models)))
        },
        async clearDatabase() {
          connection.sqlite.exec("PRAGMA foreign_keys = OFF")
          try {
            for (const table of compileDmlSchema(models).tables) {
              connection.sqlite.exec(`DELETE FROM "${table.name}"`)
            }
          } finally {
            connection.sqlite.exec("PRAGMA foreign_keys = ON")
          }
        },
      },
    }
  },

  getInjectedDependencies(connection: DrizzleTestConnection) {
    return {
      __pg_connection__: connection,
    }
  },

  getModuleOptions(
    _dbConfig: ModuleTestDatabaseConfig,
    moduleOptions: Record<string, unknown>,
    connection: DrizzleTestConnection
  ) {
    return {
      ...moduleOptions,
      manager: connection,
      persistenceAdapter: drizzleModulePersistenceAdapter,
    }
  },

  async cleanupConnection(connection: DrizzleTestConnection) {
    await connection.destroy()
  },
}

function discoverModuleModels({
  moduleModels,
  resolve,
  cwd,
}: PrepareOptions): PortableEntity[] {
  if (moduleModels) {
    return moduleModels.filter(isPortableEntity)
  }

  const basePath = normalizeImportPathWithSource(
    resolve ?? cwd ?? process.cwd()
  )
  const modelsPath = fs.existsSync(`${basePath}/dist/models`)
    ? "/dist/models"
    : fs.existsSync(`${basePath}/models`)
    ? "/models"
    : ""

  return modelsPath
    ? loadModels(`${basePath}${modelsPath}`).filter(isPortableEntity)
    : []
}

function isPortableEntity(value: unknown): value is PortableEntity {
  return Boolean(
    value &&
      typeof value === "object" &&
      "parse" in value &&
      typeof value.parse === "function" &&
      "schema" in value
  )
}

interface NodeSqliteStatement {
  run(...params: unknown[]): unknown
  get(...params: unknown[]): Record<string, unknown> | undefined
  all(...params: unknown[]): Record<string, unknown>[]
}

interface NodeSqliteDatabase {
  prepare(query: string): NodeSqliteStatement
  exec(query: string): void
  close(): void
}

function createAtomicTransaction(
  database: BaseSQLiteDatabase<"async", unknown>,
  schedule: <TResult>(task: () => Promise<TResult>) => Promise<TResult> = (
    task
  ) => task()
): DrizzleMedusaManager["transaction"] {
  return async (task) => {
    return await schedule(() =>
      database.transaction(async (transactionDatabase) => {
        const transactionManager: DrizzleMedusaManager = {
          database: transactionDatabase,
          transactionMode: "atomic",
          transaction: createAtomicTransaction(transactionDatabase),
          async destroy() {},
        }
        return await task(transactionManager)
      })
    )
  }
}
