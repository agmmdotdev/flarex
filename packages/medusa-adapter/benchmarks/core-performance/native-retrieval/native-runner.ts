/** Benchmark-only port of the pinned Medusa module test runner. Native helpers
 * remain in the source island; this owned extension measures fresh module
 * init/work/shutdown while the runner retains its shared connection. */
import { logger } from "../../../../../third_party/medusa/upstream/packages/core/framework/dist/logger"
import { ModulesDefinition, type MedusaAppOutput } from "../../../../../third_party/medusa/upstream/packages/core/framework/dist/modules-sdk"
import { ContainerRegistrationKeys, Modules } from "../../../../../third_party/medusa/upstream/packages/core/framework/dist/utils"
import type { TestDatabase } from "../../../../../third_party/medusa/upstream/packages/medusa-test-utils/dist/database"
import { initModules, type InitModulesOptions } from "../../../../../third_party/medusa/upstream/packages/medusa-test-utils/dist/init-modules"
import { default as MockEventBusService } from "../../../../../third_party/medusa/upstream/packages/medusa-test-utils/dist/mock-event-bus-service"
import type {
  ModuleTestConnection,
  ModuleTestDatabase,
  ModuleTestDatabaseConfig,
  ModuleTestPersistenceAdapter,
} from "../../../../../third_party/medusa/upstream/packages/medusa-test-utils/dist/module-test-persistence-adapter"
import { getConfiguredPersistenceAdapter } from "../../../../../third_party/medusa/upstream/packages/medusa-test-utils/dist/module-test-runner"
import { resolveTestWorkerIdentity } from "../../../../../third_party/medusa/upstream/packages/medusa-test-utils/dist/test-worker-identity"
import { ulid } from "../../../../../third_party/medusa/upstream/node_modules/ulid"

type ModuleTestApp<TService> = Omit<MedusaAppOutput, "modules"> & {
  modules: Record<string, TService>
}

export type ModuleTestPersistenceAdapterName =
  | "mikroorm"
  | "drizzle"
  | "pglite"

export interface SuiteOptions<
  TService extends object = Record<string, unknown>
> {
  database: ModuleTestDatabase
  persistenceAdapter: Pick<ModuleTestPersistenceAdapter, "name">
  /** @deprecated Use `database` for backend-neutral integration tests. */
  MikroOrmWrapper: TestDatabase
  medusaApp: ModuleTestApp<TService>
  service: TService
  /** Reconstruct the module against the existing schema and shared connection. */
  withFreshModule: <T>(work: (service: TService) => Promise<T>) => Promise<T>
  dbConfig: {
    schema: string
    clientUrl: string
  }
}

interface ModuleTestRunnerConfig<
  TService extends object = Record<string, unknown>
> {
  moduleName: string
  moduleModels?: object[]
  moduleOptions?: Record<string, unknown>
  moduleDependencies?: string[]
  joinerConfig?: InitModulesOptions["joinerConfig"]
  schema?: string
  dbName?: string
  injectedDependencies?: Record<string, unknown>
  resolve?: string
  debug?: boolean
  cwd?: string
  persistenceAdapter?: ModuleTestPersistenceAdapter
  hooks?: {
    beforeModuleInit?: () => Promise<void>
    afterModuleInit?: (
      medusaApp: ModuleTestApp<TService>,
      service: TService
    ) => Promise<void>
  }
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}

function createDeferredProxy<T extends object>(getTarget: () => T | null): T {
  // The proxy forwards every property to a T once module initialization
  // completes. Its empty target is never read directly.
  return new Proxy({} as T, {
    get: (_target, property) => {
      const target = getTarget()
      return target ? Reflect.get(target, property) : undefined
    },
  })
}

class ModuleTestRunner<TService extends object = Record<string, unknown>> {
  private moduleName: string
  private schema: string
  private dbName: string
  private dbConfig: ModuleTestDatabaseConfig
  private debug: boolean
  private resolve: string | undefined
  private cwd: string | undefined
  private moduleOptions: Record<string, unknown>
  private moduleDependencies: string[] | undefined
  private joinerConfig: NonNullable<InitModulesOptions["joinerConfig"]>
  private injectedDependencies: Record<string, unknown>
  private hooks: ModuleTestRunnerConfig<TService>["hooks"] = {}
  private persistenceAdapter: ModuleTestPersistenceAdapter

  private connection: ModuleTestConnection | null = null
  private database!: ModuleTestDatabase
  private MikroOrmWrapper: TestDatabase | undefined
  private moduleModels: object[] = []
  private modulesConfig: InitModulesOptions["modulesConfig"] = {}
  private moduleOptionsConfig!: InitModulesOptions

  private shutdown: () => Promise<void> = async () => void 0
  private moduleService: TService | null = null
  private medusaApp: ModuleTestApp<TService> | null = null

  constructor(config: ModuleTestRunnerConfig<TService>) {
    this.moduleName = config.moduleName
    const moduleName = this.moduleName ?? ulid()
    this.dbName =
      config.dbName ??
      `medusa-${moduleName.toLowerCase()}-integration-${
        resolveTestWorkerIdentity().databaseSuffix
      }`
    this.schema = config.schema ?? "public"
    this.debug = config.debug ?? false
    this.resolve = config.resolve
    this.cwd = config.cwd
    this.moduleOptions = config.moduleOptions ?? {}
    this.moduleDependencies = config.moduleDependencies
    this.joinerConfig = config.joinerConfig ?? []
    this.injectedDependencies = config.injectedDependencies ?? {}
    this.hooks = config.hooks ?? {}
    this.persistenceAdapter =
      config.persistenceAdapter ?? getConfiguredPersistenceAdapter()

    this.dbConfig = this.persistenceAdapter.createDatabaseConfig({
      dbName: this.dbName,
      schema: this.schema,
      debug: this.debug,
    })

    this.setupProcessHandlers()
    this.initializeConfig(config.moduleModels)
  }

  private setupProcessHandlers(): void {
    process.on("SIGTERM", async () => {
      await this.cleanup()
      process.exit(0)
    })

    process.on("SIGINT", async () => {
      await this.cleanup()
      process.exit(0)
    })
  }

  private initializeConfig(moduleModels?: object[]): void {
    this.connection = this.persistenceAdapter.createConnection(this.dbConfig)

    const { database, MikroOrmWrapper, models } =
      this.persistenceAdapter.prepareDatabase({
        connection: this.connection,
        ...(moduleModels === undefined ? {} : { moduleModels }),
        ...(this.resolve === undefined ? {} : { resolve: this.resolve }),
        dbConfig: this.dbConfig,
        ...(this.cwd === undefined ? {} : { cwd: this.cwd }),
      })

    this.database = database
    this.MikroOrmWrapper = MikroOrmWrapper
    this.moduleModels = models

    this.modulesConfig = {
      [this.moduleName]: {
        definition: ModulesDefinition[this.moduleName],
        ...(this.resolve === undefined ? {} : { resolve: this.resolve }),
        ...(this.moduleDependencies === undefined ? {} : { dependencies: this.moduleDependencies }),
        options: this.persistenceAdapter.getModuleOptions(
          this.dbConfig,
          this.moduleOptions,
          this.connection
        ),
      },
    }

    this.moduleOptionsConfig = {
      injectedDependencies: {
        ...this.persistenceAdapter.getInjectedDependencies(this.connection),
        [Modules.EVENT_BUS]: new MockEventBusService(),
        [ContainerRegistrationKeys.LOGGER]: console,
        [ContainerRegistrationKeys.CONFIG_MODULE]: {
          modules: this.modulesConfig,
        },
        ...this.injectedDependencies,
      },
      modulesConfig: this.modulesConfig,
      databaseConfig: this.dbConfig,
      joinerConfig: this.joinerConfig,
      preventConnectionDestroyWarning: true,
      ...(this.cwd === undefined ? {} : { cwd: this.cwd }),
    }
  }

  private createMedusaAppProxy(): ModuleTestApp<TService> {
    return createDeferredProxy(() => this.medusaApp)
  }

  private createServiceProxy(): TService {
    return createDeferredProxy(() => this.moduleService)
  }

  public async beforeAll(): Promise<void> {
    try {
      this.setupProcessHandlers()
      process.env.LOG_LEVEL = "error"
    } catch (error) {
      await this.cleanup()
      throw error
    }
  }

  public async beforeEach(): Promise<void> {
    try {
      if (this.moduleModels.length) {
        await this.database.setupDatabase()
      }

      if (this.hooks?.beforeModuleInit) {
        await this.hooks.beforeModuleInit()
      }

      const output = await initModules(this.moduleOptionsConfig)
      const medusaApp: ModuleTestApp<TService> = output.medusaApp
      const moduleService = medusaApp.modules[this.moduleName]
      if (moduleService === undefined) {
        return await this.rejectMissingService(output.shutdown)
      }

      this.shutdown = output.shutdown
      this.medusaApp = medusaApp
      this.moduleService = moduleService

      if (this.hooks?.afterModuleInit) {
        await this.hooks.afterModuleInit(medusaApp, moduleService)
      }
    } catch (error) {
      logger.error("Error in beforeEach:", toError(error))
      await this.cleanup()
      throw error
    }
  }

  public async afterEach(): Promise<void> {
    try {
      if (this.moduleModels.length) {
        await this.database.clearDatabase()
      }
      await this.shutdown()
      this.moduleService = null
      this.medusaApp = null
    } catch (error) {
      logger.error("Error in afterEach:", toError(error))
      throw error
    }
  }

  /** Measurement owns the complete init/work/shutdown interval. The runner
   * retains the injected Knex connection and remains its sole final disposer. */
  public async withFreshModule<T>(
    work: (service: TService) => Promise<T>
  ): Promise<T> {
    const connection = this.connection
    const dependencies = this.moduleOptionsConfig.injectedDependencies
    if (
      !connection ||
      !dependencies ||
      dependencies[ContainerRegistrationKeys.PG_CONNECTION] !== connection
    ) {
      throw new Error("Fresh module requires the runner's shared connection")
    }
    const disposeModule = async () => {
      const shutdown = this.shutdown
      this.shutdown = async () => void 0
      try {
        await shutdown()
      } finally {
        this.moduleService = null
        this.medusaApp = null
      }
    }
    await disposeModule()
    const output = await initModules(this.moduleOptionsConfig)
    const medusaApp: ModuleTestApp<TService> = output.medusaApp
    const service = medusaApp.modules[this.moduleName]
    if (service === undefined) {
      return await this.rejectMissingService(output.shutdown)
    }
    this.shutdown = output.shutdown
    this.medusaApp = medusaApp
    this.moduleService = service
    let outcome:
      | { readonly status: "fulfilled"; readonly value: T }
      | { readonly status: "rejected"; readonly reason: unknown }
    try {
      if (
        this.connection !== connection ||
        dependencies[ContainerRegistrationKeys.PG_CONNECTION] !== connection
      ) {
        throw new Error("Fresh module changed the shared connection")
      }
      outcome = { status: "fulfilled", value: await work(service) }
    } catch (reason) {
      outcome = { status: "rejected", reason }
    }
    try {
      await disposeModule()
    } catch (cleanupError) {
      if (outcome.status === "rejected") {
        throw new AggregateError(
          [outcome.reason, cleanupError],
          "Fresh module work and cleanup failed"
        )
      }
      throw cleanupError
    }
    if (outcome.status === "rejected") throw outcome.reason
    return outcome.value
  }

  /** Refuse malformed initialization after releasing the acquired native app. */
  private async rejectMissingService(shutdown: () => Promise<void>): Promise<never> {
    const missing = new Error(`Native module did not provide service "${this.moduleName}"`)
    try {
      await shutdown()
    } catch (cleanupError) {
      throw new AggregateError([missing, cleanupError], "Missing native service and cleanup failed")
    }
    throw missing
  }

  public async cleanup(): Promise<void> {
    try {
      process.removeAllListeners("SIGTERM")
      process.removeAllListeners("SIGINT")

      if (this.connection) {
        await this.persistenceAdapter.cleanupConnection(this.connection)
      }

      this.moduleService = null
      this.medusaApp = null
      this.connection = null

      if (global.gc) {
        global.gc()
      }
    } catch (error) {
      logger.error("Error during cleanup:", toError(error))
    }
  }

  public getOptions(): SuiteOptions<TService> {
    const MikroOrmWrapper = this.MikroOrmWrapper

    return {
      database: this.database,
      persistenceAdapter: { name: this.persistenceAdapter.name },
      get MikroOrmWrapper() {
        if (!MikroOrmWrapper) {
          throw new Error(
            "The selected persistence adapter does not provide a MikroOrmWrapper. Use the backend-neutral database option instead."
          )
        }

        return MikroOrmWrapper
      },
      medusaApp: this.createMedusaAppProxy(),
      service: this.createServiceProxy(),
      withFreshModule: (work) => this.withFreshModule(work),
      dbConfig: {
        schema: this.schema,
        clientUrl: this.dbConfig.clientUrl,
      },
    }
  }
}

export function moduleIntegrationTestRunner<
  TService extends object = Record<string, unknown>
>({
  moduleName,
  moduleModels,
  moduleOptions = {},
  moduleDependencies,
  joinerConfig = [],
  schema = "public",
  dbName,
  debug = false,
  testSuite,
  resolve,
  injectedDependencies = {},
  cwd,
  persistenceAdapter,
  hooks,
}: {
  moduleName: string
  moduleModels?: object[]
  moduleOptions?: Record<string, unknown>
  moduleDependencies?: string[]
  joinerConfig?: InitModulesOptions["joinerConfig"]
  schema?: string
  dbName?: string
  injectedDependencies?: Record<string, unknown>
  resolve?: string
  debug?: boolean
  cwd?: string
  persistenceAdapter?: ModuleTestPersistenceAdapter
  hooks?: ModuleTestRunnerConfig<TService>["hooks"]
  testSuite: (options: SuiteOptions<TService>) => void
}) {
  const runner = new ModuleTestRunner<TService>({
    moduleName,
    ...(moduleModels === undefined ? {} : { moduleModels }),
    moduleOptions,
    ...(moduleDependencies === undefined ? {} : { moduleDependencies }),
    joinerConfig,
    schema,
    ...(dbName === undefined ? {} : { dbName }),
    debug,
    ...(resolve === undefined ? {} : { resolve }),
    injectedDependencies,
    ...(cwd === undefined ? {} : { cwd }),
    ...(persistenceAdapter === undefined ? {} : { persistenceAdapter }),
    ...(hooks === undefined ? {} : { hooks }),
  })

  return describe("", () => {
    beforeAll(async () => {
      await runner.beforeAll()
    })

    beforeEach(async () => {
      await runner.beforeEach()
    })

    afterEach(async () => {
      await runner.afterEach()
    })

    afterAll(async () => {
      await runner.cleanup()

      if (global.gc) {
        global.gc()
      }
    })

    // Run test suite with options
    testSuite(runner.getOptions())
  })
}
