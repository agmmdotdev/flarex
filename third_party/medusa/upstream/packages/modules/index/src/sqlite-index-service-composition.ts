import type {
  IndexTypes,
  ModuleJoinerConfig,
  QueryGraphFunction,
  RemoteQueryFunction,
} from "@medusajs/framework/types"
import { MedusaModule } from "@medusajs/framework/modules-sdk"
import {
  ContainerRegistrationKeys,
  Modules,
} from "@medusajs/framework/utils/portable"
import IndexModuleService, {
  type IndexBaseRepository,
} from "./services/index-module-service"
import {
  SqliteIndexStorageProvider,
  type SqliteIndexExecutor,
} from "./services/sqlite-index-storage-provider"

type IndexServiceDependencies = ConstructorParameters<
  typeof IndexModuleService
>[0]
type IndexServiceModuleOptions = ConstructorParameters<
  typeof IndexModuleService
>[1]
type IndexServiceModuleDeclaration = ConstructorParameters<
  typeof IndexModuleService
>[2]
type GraphCall = Parameters<QueryGraphFunction>[0]

export type CreateSqliteIndexServiceOptions = {
  baseRepository?: IndexServiceDependencies["baseRepository"]
  dataSynchronizer?: IndexServiceDependencies["dataSynchronizer"]
  executor: SqliteIndexExecutor
  eventBus?: IndexServiceDependencies[typeof Modules.EVENT_BUS]
  indexConfigurationCheckerFactory?: IndexServiceDependencies["indexConfigurationCheckerFactory"]
  indexMetadataService?: IndexServiceDependencies["indexMetadataService"]
  indexResetHandler?: IndexServiceDependencies["indexResetHandler"]
  indexSyncService?: IndexServiceDependencies["indexSyncService"]
  joinerConfigs?: readonly ModuleJoinerConfig[]
  logger?: IndexServiceDependencies["logger"]
  query?: RemoteQueryFunction
  registerJoinerConfigs?: () => void
  schema: IndexServiceModuleOptions["schema"]
  transactionErrorMessage?: string
  workerMode?: IndexServiceModuleDeclaration["worker_mode"]
}

export async function createSqliteIndexService(
  options: CreateSqliteIndexServiceOptions
): Promise<IndexTypes.IIndexService> {
  const moduleOptions = {
    schema: options.schema,
  } satisfies IndexServiceModuleOptions
  const moduleDeclaration: IndexServiceModuleDeclaration = {
    options: { ...moduleOptions },
    scope: "internal",
    worker_mode: options.workerMode ?? "server",
  }

  options.registerJoinerConfigs?.()
  registerModuleJoinerConfigs(options.joinerConfigs ?? [])

  const service = new IndexModuleService(
    {
      logger: options.logger ?? sqliteCompositionLogger,
      [Modules.EVENT_BUS]:
        options.eventBus ??
        createUnusedDependency<IndexServiceDependencies[typeof Modules.EVENT_BUS]>(
          "eventBus"
        ),
      storageProviderCtr: SqliteIndexStorageProvider,
      [ContainerRegistrationKeys.QUERY]: options.query ?? createRemoteQuery([]),
      storageProviderCtrOptions: { executor: options.executor },
      baseRepository:
        options.baseRepository ??
        createUnusedBaseRepository(
          options.transactionErrorMessage ??
            "SQLite Index composition should not open transactions"
        ),
      indexResetHandler: options.indexResetHandler,
      indexConfigurationCheckerFactory:
        options.indexConfigurationCheckerFactory ??
        createNoopConfigurationCheckerFactory(),
      indexMetadataService:
        options.indexMetadataService ??
        createUnusedDependency<IndexServiceDependencies["indexMetadataService"]>(
          "indexMetadataService"
        ),
      indexSyncService:
        options.indexSyncService ??
        createUnusedDependency<IndexServiceDependencies["indexSyncService"]>(
          "indexSyncService"
        ),
      dataSynchronizer:
        options.dataSynchronizer ?? createNoopDataSynchronizer(),
    },
    moduleOptions,
    moduleDeclaration
  )

  await service.__hooks.onApplicationStart.call(service)

  return service
}

function registerModuleJoinerConfigs(
  joinerConfigs: readonly ModuleJoinerConfig[]
): void {
  for (const joinerConfig of joinerConfigs) {
    const serviceName = joinerConfig.serviceName

    if (!serviceName) {
      throw new Error(
        "SQLite Index composition joiner configs require a service name"
      )
    }

    MedusaModule.setJoinerConfig(serviceName, joinerConfig)
  }
}

function createNoopConfigurationCheckerFactory(): NonNullable<
  IndexServiceDependencies["indexConfigurationCheckerFactory"]
> {
  return () => ({
    async checkChanges() {
      return []
    },
  })
}

function createNoopDataSynchronizer(): IndexServiceDependencies["dataSynchronizer"] {
  const dataSynchronizer = {
    onApplicationStart() {},
    async syncEntities() {},
  }

  // DataSynchronizer has private runtime state. The SQLite composition only
  // needs the two startup/sync methods touched by IndexModuleService here.
  return dataSynchronizer as unknown as IndexServiceDependencies[
    "dataSynchronizer"
  ]
}

function createUnusedBaseRepository(message: string): IndexBaseRepository {
  return {
    async transaction<TResult>(): Promise<TResult> {
      throw new Error(message)
    },
  }
}

const sqliteCompositionLogger: IndexServiceDependencies["logger"] = {
  panic: console.error,
  shouldLog: () => true,
  setLogLevel: () => {},
  unsetLogLevel: () => {},
  activity: (message) => message,
  progress: () => {},
  error: console.error,
  failure: (_activityId, message) => message,
  success: (_activityId, message) => ({ message }),
  silly: console.debug,
  debug: console.debug,
  verbose: console.debug,
  http: console.info,
  info: console.info,
  warn: console.warn,
  log: console.log,
}

function createUnusedDependency<TDependency extends object>(
  name: string
): TDependency {
  return new Proxy(
    {},
    {
      get(_target, property) {
        throw new Error(`${name}.${String(property)} should not be used`)
      },
    }
  ) as TDependency
}

function createRemoteQuery(
  data: unknown,
  graphCalls: GraphCall[] = []
): RemoteQueryFunction {
  const rows = Array.isArray(data) ? data : [data]
  const remoteQuery = Object.assign(async () => [], {
    graph: async (config: GraphCall) => {
      graphCalls.push(config)
      return { data: rows }
    },
    index: async () => ({ data: [] }),
    gql: async () => ({ data: [] }),
  })

  // The production remote query type is an overloaded callable object. This
  // composition implements only the members Index startup touches in server mode.
  return remoteQuery as unknown as RemoteQueryFunction
}
