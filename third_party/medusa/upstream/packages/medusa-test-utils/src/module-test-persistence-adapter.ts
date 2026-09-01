import {
  ContainerRegistrationKeys,
  isSharedConnectionSymbol,
  loadModels,
  ModulesSdkUtils,
  normalizeImportPathWithSource,
  toMikroOrmEntities,
} from "@medusajs/framework/utils"
import * as fs from "fs"
import { getDatabaseURL, getMikroOrmWrapper, TestDatabase } from "./database"

export interface ModuleTestDatabaseConfig {
  clientUrl: string
  schema: string
  debug: boolean
}

export interface CreateModuleTestDatabaseConfigOptions {
  dbName: string
  schema: string
  debug: boolean
}

export interface ModuleTestDatabase {
  setupDatabase(): Promise<void>
  clearDatabase(): Promise<void>
}

export interface ModuleTestConnection {
  context?: {
    destroy(): Promise<void>
  }
  destroy(): Promise<void>
}

export interface PrepareModuleTestDatabaseOptions {
  connection: ModuleTestConnection
  moduleModels?: object[]
  resolve?: string
  cwd?: string
  dbConfig: ModuleTestDatabaseConfig
}

export interface PreparedModuleTestDatabase {
  database: ModuleTestDatabase
  models: object[]
  /**
   * Compatibility field for existing integration suites that access MikroORM
   * directly. New backend-neutral suites should use `database`.
   */
  MikroOrmWrapper?: TestDatabase
}

export interface ModuleTestPersistenceAdapter {
  readonly name: string
  createDatabaseConfig(
    options: CreateModuleTestDatabaseConfigOptions
  ): ModuleTestDatabaseConfig
  createConnection(dbConfig: ModuleTestDatabaseConfig): ModuleTestConnection
  prepareDatabase(
    options: PrepareModuleTestDatabaseOptions
  ): PreparedModuleTestDatabase
  getInjectedDependencies(
    connection: ModuleTestConnection
  ): Record<string, unknown>
  getModuleOptions(
    dbConfig: ModuleTestDatabaseConfig,
    moduleOptions: Record<string, unknown>,
    connection: ModuleTestConnection
  ): Record<string | symbol, unknown>
  cleanupConnection(connection: ModuleTestConnection): Promise<void>
}

function discoverModuleModels({
  moduleModels,
  resolve,
  cwd,
}: PrepareModuleTestDatabaseOptions): object[] {
  if (moduleModels) {
    return moduleModels
  }

  const basePath = normalizeImportPathWithSource(
    resolve ?? cwd ?? process.cwd()
  )
  const modelsPath = fs.existsSync(`${basePath}/dist/models`)
    ? "/dist/models"
    : fs.existsSync(`${basePath}/models`)
    ? "/models"
    : ""

  return modelsPath ? loadModels(`${basePath}${modelsPath}`) : []
}

export const mikroOrmModuleTestPersistenceAdapter: ModuleTestPersistenceAdapter =
  {
    name: "mikroorm",

    createDatabaseConfig({ dbName, schema, debug }) {
      return {
        clientUrl: getDatabaseURL(dbName),
        schema,
        debug,
      }
    },

    createConnection(dbConfig) {
      return ModulesSdkUtils.createPgConnection(dbConfig)
    },

    prepareDatabase(options) {
      const models = toMikroOrmEntities(discoverModuleModels(options))
      const MikroOrmWrapper = getMikroOrmWrapper({
        mikroOrmEntities: models,
        clientUrl: options.dbConfig.clientUrl,
        schema: options.dbConfig.schema,
      })

      return {
        database: MikroOrmWrapper,
        models,
        MikroOrmWrapper,
      }
    },

    getInjectedDependencies(connection) {
      return {
        [ContainerRegistrationKeys.PG_CONNECTION]: connection,
      }
    },

    getModuleOptions(dbConfig, moduleOptions) {
      return {
        database: dbConfig,
        ...moduleOptions,
        [isSharedConnectionSymbol]: true,
      }
    },

    async cleanupConnection(connection) {
      await connection.context?.destroy()
      await connection.destroy()
    },
  }
