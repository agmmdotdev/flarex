import { logger } from "@medusajs/framework/logger"
import {
  ExternalModuleDeclaration,
  InternalModuleDeclaration,
  ModuleJoinerConfig,
} from "@medusajs/framework/types"
import {
  ContainerRegistrationKeys,
  createPgConnection,
} from "@medusajs/framework/utils"
import type {
  ModuleTestConnection,
  ModuleTestDatabaseConfig,
  ModuleTestPersistenceAdapter,
} from "./module-test-persistence-adapter"

export interface InitModulesOptions {
  injectedDependencies?: Record<string, unknown>
  databaseConfig: {
    clientUrl: string
    schema?: string
  }
  modulesConfig: {
    [key: string]:
      | string
      | boolean
      | Partial<InternalModuleDeclaration | ExternalModuleDeclaration>
  }
  joinerConfig?: ModuleJoinerConfig[]
  preventConnectionDestroyWarning?: boolean
  cwd?: string
}

type ObjectModuleConfig = Partial<
  InternalModuleDeclaration | ExternalModuleDeclaration
> & {
  options?: Record<string | symbol, unknown>
  resolve?: string
}

type PGliteInitModulesConnection = {
  connection: ModuleTestConnection
  setupKeys: Set<string>
}

type ApplicationShutdownLifecycle = {
  onApplicationPrepareShutdown: () => Promise<void>
  onApplicationShutdown: () => Promise<void>
}

export async function runApplicationShutdownHooks(
  application: ApplicationShutdownLifecycle
): Promise<void> {
  const failures: unknown[] = []

  try {
    await application.onApplicationPrepareShutdown()
  } catch (error) {
    failures.push(error)
  }

  try {
    await application.onApplicationShutdown()
  } catch (error) {
    failures.push(error)
  }

  if (failures.length > 0) {
    throw new AggregateError(failures, "Application shutdown hooks failed")
  }
}

const pgliteInitModulesConnections = new Map<
  string,
  PGliteInitModulesConnection
>()

export async function initModules({
  injectedDependencies,
  databaseConfig,
  modulesConfig,
  joinerConfig,
  preventConnectionDestroyWarning = false,
  cwd,
}: InitModulesOptions) {
  if (process.env.MEDUSA_MODULE_TEST_PERSISTENCE === "pglite") {
    return await initModulesWithPGlite({
      injectedDependencies,
      databaseConfig,
      modulesConfig,
      joinerConfig,
      cwd,
    })
  }

  const moduleSdkImports = require("@medusajs/framework/modules-sdk")

  injectedDependencies ??= {}

  let sharedPgConnection =
    injectedDependencies?.[ContainerRegistrationKeys.PG_CONNECTION]

  let shouldDestroyConnectionAutomatically = !sharedPgConnection
  if (!sharedPgConnection) {
    sharedPgConnection = createPgConnection({
      clientUrl: databaseConfig.clientUrl,
      schema: databaseConfig.schema,
    })

    injectedDependencies[ContainerRegistrationKeys.PG_CONNECTION] =
      sharedPgConnection
  }

  const medusaApp = await moduleSdkImports.MedusaApp({
    modulesConfig,
    servicesConfig: joinerConfig,
    injectedDependencies,
    cwd,
  })

  await medusaApp.onApplicationStart()

  async function shutdown() {
    const failures: unknown[] = []

    try {
      await runApplicationShutdownHooks(medusaApp)
    } catch (error) {
      failures.push(error)
    }

    if (shouldDestroyConnectionAutomatically) {
      const connectionResults = await Promise.allSettled([
        (sharedPgConnection as any).context?.destroy(),
        (sharedPgConnection as any).destroy(),
      ])
      for (const result of connectionResults) {
        if (result.status === "rejected") {
          failures.push(result.reason)
        }
      }
    } else {
      if (!preventConnectionDestroyWarning) {
        logger.info(
          `You are using a custom shared connection. The connection won't be destroyed automatically.`
        )
      }
    }

    try {
      moduleSdkImports.MedusaModule.clearInstances()
    } catch (error) {
      failures.push(error)
    }

    if (failures.length > 0) {
      throw new AggregateError(failures, "Module test shutdown failed")
    }
  }

  return {
    medusaApp,
    shutdown,
  }
}

async function initModulesWithPGlite({
  injectedDependencies,
  databaseConfig,
  modulesConfig,
  joinerConfig,
  cwd,
}: InitModulesOptions) {
  const moduleSdkImports = require("@medusajs/framework/modules-sdk")
  const { isPGliteModuleTestConnection, pgliteModuleTestPersistenceAdapter } =
    require("./pglite-module-test-persistence-adapter") as {
      isPGliteModuleTestConnection: (
        value: unknown
      ) => value is ModuleTestConnection
      pgliteModuleTestPersistenceAdapter: ModuleTestPersistenceAdapter
    }

  const rewrittenModulesConfig: InitModulesOptions["modulesConfig"] = {}
  const adapterDependencies: Record<string, unknown> = {}

  for (const [moduleName, moduleConfig] of Object.entries(modulesConfig)) {
    if (!isObjectModuleConfig(moduleConfig)) {
      rewrittenModulesConfig[moduleName] = moduleConfig
      continue
    }

    const moduleDatabaseConfig = databaseConfigFromModuleConfig(
      moduleConfig,
      databaseConfig
    )
    const configuredManager = moduleConfig.options?.manager
    const cacheEntry = isPGliteModuleTestConnection(configuredManager)
      ? setPGliteInitModulesConnection(moduleDatabaseConfig, configuredManager)
      : getPGliteInitModulesConnection(
          pgliteModuleTestPersistenceAdapter,
          moduleDatabaseConfig
        )
    const connection = cacheEntry.connection
    const prepareKey = modulePrepareKey(moduleName, moduleDatabaseConfig)
    if (!cacheEntry.setupKeys.has(prepareKey)) {
      const preparedDatabase =
        pgliteModuleTestPersistenceAdapter.prepareDatabase({
          connection,
          resolve: moduleConfig.resolve,
          cwd,
          dbConfig: moduleDatabaseConfig,
        })
      await preparedDatabase.database.setupDatabase()
      cacheEntry.setupKeys.add(prepareKey)
    }

    Object.assign(
      adapterDependencies,
      pgliteModuleTestPersistenceAdapter.getInjectedDependencies(connection)
    )

    rewrittenModulesConfig[moduleName] = {
      ...moduleConfig,
      options: pgliteModuleTestPersistenceAdapter.getModuleOptions(
        moduleDatabaseConfig,
        moduleConfig.options ?? {},
        connection
      ),
    }
  }

  const medusaApp = await moduleSdkImports.MedusaApp({
    modulesConfig: rewrittenModulesConfig,
    servicesConfig: joinerConfig,
    injectedDependencies: {
      ...adapterDependencies,
      ...(injectedDependencies ?? {}),
    },
    cwd,
  })

  await medusaApp.onApplicationStart()

  async function shutdown() {
    const failures: unknown[] = []

    try {
      await runApplicationShutdownHooks(medusaApp)
    } catch (error) {
      failures.push(error)
    }

    try {
      moduleSdkImports.MedusaModule.clearInstances()
    } catch (error) {
      failures.push(error)
    }

    if (failures.length > 0) {
      throw new AggregateError(failures, "Module test shutdown failed")
    }
  }

  return {
    medusaApp,
    shutdown,
  }
}

function isObjectModuleConfig(
  moduleConfig:
    | string
    | boolean
    | Partial<InternalModuleDeclaration | ExternalModuleDeclaration>
): moduleConfig is ObjectModuleConfig {
  return Boolean(moduleConfig && typeof moduleConfig === "object")
}

function databaseConfigFromModuleConfig(
  moduleConfig: ObjectModuleConfig,
  fallback: InitModulesOptions["databaseConfig"]
): ModuleTestDatabaseConfig {
  const database = moduleConfig.options?.database

  if (
    database &&
    typeof database === "object" &&
    "clientUrl" in database &&
    typeof database.clientUrl === "string"
  ) {
    return {
      clientUrl: database.clientUrl,
      schema:
        "schema" in database && typeof database.schema === "string"
          ? database.schema
          : fallback.schema ?? "public",
      debug:
        "debug" in database && typeof database.debug === "boolean"
          ? database.debug
          : false,
    }
  }

  return {
    clientUrl: fallback.clientUrl,
    schema: fallback.schema ?? "public",
    debug: false,
  }
}

function getPGliteInitModulesConnection(
  adapter: ModuleTestPersistenceAdapter,
  dbConfig: ModuleTestDatabaseConfig
): PGliteInitModulesConnection {
  const cacheKey = `${dbConfig.clientUrl}:${dbConfig.schema}`
  const existing = pgliteInitModulesConnections.get(cacheKey)
  if (existing) {
    return existing
  }

  const connection = adapter.createConnection(dbConfig)
  const cacheEntry = {
    connection,
    setupKeys: new Set<string>(),
  }
  pgliteInitModulesConnections.set(cacheKey, cacheEntry)

  return cacheEntry
}

function setPGliteInitModulesConnection(
  dbConfig: ModuleTestDatabaseConfig,
  connection: ModuleTestConnection
): PGliteInitModulesConnection {
  const cacheKey = `${dbConfig.clientUrl}:${dbConfig.schema}`
  const existing = pgliteInitModulesConnections.get(cacheKey)
  if (existing?.connection === connection) {
    return existing
  }

  const cacheEntry = {
    connection,
    setupKeys: new Set<string>(),
  }
  pgliteInitModulesConnections.set(cacheKey, cacheEntry)

  return cacheEntry
}

function modulePrepareKey(
  moduleName: string,
  dbConfig: ModuleTestDatabaseConfig
): string {
  return `${moduleName}:${dbConfig.clientUrl}:${dbConfig.schema}`
}
