import {
  ExternalModuleDeclaration,
  IModuleService,
  InternalModuleDeclaration,
  LinkModuleDefinition,
  LoaderOptions,
  LoadedModule,
  MedusaContainer,
  ModuleBootstrapDeclaration,
  ModuleDefinition,
  ModuleExports,
  ModuleJoinerConfig,
  ModulePersistenceAdapter,
  ModuleResolution,
  StaticModuleResources,
} from "@medusajs/types"
import { asValue } from "@medusajs/deps/awilix"
import { ContainerRegistrationKeys } from "@medusajs/utils/common/container"
import { createMedusaContainer } from "@medusajs/utils/common/medusa-container"
import { promiseAll } from "@medusajs/utils/common/promise-all"
import { simpleHash } from "@medusajs/utils/common/simple-hash"
import { stringifyCircular } from "@medusajs/utils/common/stringify-circular"
import { staticModuleLoader } from "./loaders/static-module-loader"
import { registerStaticMedusaModule } from "./loaders/static-module-registration"
import {
  type ModuleExportsLoader,
  type ModuleResourceLoader,
} from "./loaders/utils/load-internal"
import { MODULE_SCOPE } from "./types"

const logger: any = {
  log: (a) => console.log(a),
  info: (a) => console.log(a),
  warn: (a) => console.warn(a),
  error: (a) => console.error(a),
}

declare global {
  interface MedusaModule {
    getLoadedModules(
      aliases?: Map<string, string>
    ): { [key: string]: LoadedModule }[]
    getModuleInstance(moduleKey: string, alias?: string): LoadedModule
  }
}

type ModuleAlias = {
  key: string
  hash: string
  isLink: boolean
  alias?: string
  main?: boolean
}

export type MigrationOptions = {
  moduleKey: string
  modulePath: string
  container?: MedusaContainer
  options?: Record<string, any>
  moduleExports?: ModuleExports
  cwd?: string
}

type ModuleLoader = typeof staticModuleLoader
type ModuleRegistration = typeof registerStaticMedusaModule
type ModuleMigrationLoader = (
  container: MedusaContainer,
  resolution: ModuleResolution,
  moduleExports?: ModuleExports
) => Promise<{
  runMigrations?: (
    options: LoaderOptions<unknown>
  ) => Promise<{ name: string; path: string }[]>
  revertMigration?: (
    options: LoaderOptions<unknown> & { migrationNames?: string[] }
  ) => Promise<void>
  generateMigration?: (options: LoaderOptions<unknown>) => Promise<void>
}>

export type ModuleInfrastructure = {
  moduleLoader?: ModuleLoader
  moduleRegistration?: ModuleRegistration
  moduleExportsLoader?: ModuleExportsLoader
  persistenceAdapter?: ModulePersistenceAdapter
  resourceLoader?: ModuleResourceLoader
  migrationLoader?: ModuleMigrationLoader
}

export type ModuleBootstrapOptions = {
  moduleKey: string
  defaultPath: string
  declaration?: ModuleBootstrapDeclaration
  moduleExports?: ModuleExports
  resources?: StaticModuleResources
  persistenceAdapter?: ModulePersistenceAdapter
  resourceLoader?: ModuleResourceLoader
  moduleExportsLoader?: ModuleExportsLoader
  moduleLoader?: ModuleLoader
  moduleRegistration?: ModuleRegistration
  sharedContainer?: MedusaContainer
  moduleDefinition?: ModuleDefinition
  injectedDependencies?: Record<string, any>
  /**
   * In this mode, all instances are partially loaded, meaning that the module will not be fully loaded and the services will not be available.
   * Don't forget to clear the instances (MedusaModule.clearInstances()) after the migration are done.
   */
  migrationOnly?: boolean
  /**
   * Forces the modules bootstrapper to only run the modules loaders and return prematurely. This
   * is meant for modules that have data loader. In a test env, in order to clear all data
   * and load them back, we need to run those loader again
   */
  loaderOnly?: boolean
  workerMode?: "shared" | "worker" | "server"
  cwd?: string
}

export type LinkModuleBootstrapOptions = {
  definition: LinkModuleDefinition
  declaration?: InternalModuleDeclaration
  moduleExports?: ModuleExports
  injectedDependencies?: Record<string, any>
  cwd?: string
  migrationOnly?: boolean
  schemaOnly?: boolean
}

export type RegisterModuleJoinerConfig =
  | ModuleJoinerConfig
  | ((modules: ModuleJoinerConfig[]) => ModuleJoinerConfig)

class MedusaModule {
  private static defaultInfrastructure_: Required<
    Pick<ModuleInfrastructure, "moduleLoader" | "moduleRegistration">
  > &
    ModuleInfrastructure = {
    moduleLoader: staticModuleLoader,
    moduleRegistration: registerStaticMedusaModule,
  }
  private static instances_: Map<string, { [key: string]: IModuleService }> =
    new Map()
  private static modules_: Map<string, ModuleAlias[]> = new Map()
  private static customLinks_: RegisterModuleJoinerConfig[] = []
  private static loading_: Map<string, Promise<any>> = new Map()
  private static joinerConfig_: Map<string, ModuleJoinerConfig> = new Map()
  private static moduleResolutions_: Map<string, ModuleResolution> = new Map()

  public static setDefaultInfrastructure(
    infrastructure: ModuleInfrastructure
  ): void {
    MedusaModule.defaultInfrastructure_ = {
      ...MedusaModule.defaultInfrastructure_,
      ...infrastructure,
    }
  }

  public static getLoadedModules(
    aliases?: Map<string, string>
  ): { [key: string]: LoadedModule }[] {
    return [...MedusaModule.modules_.entries()].map(([key]) => {
      if (aliases?.has(key)) {
        return MedusaModule.getModuleInstance(key, aliases.get(key))
      }

      return MedusaModule.getModuleInstance(key)
    })
  }

  public static async onApplicationStart(
    onApplicationStartCb?: () => void
  ): Promise<void> {
    await promiseAll(
      [...MedusaModule.instances_.values()]
        .map((instances) => {
          return Object.values(instances).map((instance: IModuleService) => {
            return instance.__hooks?.onApplicationStart
              ?.bind(instance)()
              .then(() => {
                onApplicationStartCb?.()
              })
              .catch(() => {
                // The module should handle this and log it
                return void 0
              })
          })
        })
        .flat()
    )
  }
  public static async onApplicationShutdown(): Promise<void> {
    await promiseAll(
      [...MedusaModule.instances_.values()]
        .map((instances) => {
          return Object.values(instances).map((instance: IModuleService) => {
            return instance.__hooks?.onApplicationShutdown
              ?.bind(instance)()
              .catch(() => {
                // The module should handle this and log it
                return void 0
              })
          })
        })
        .flat()
    )
  }

  public static async onApplicationPrepareShutdown(): Promise<void> {
    await promiseAll(
      [...MedusaModule.instances_.values()]
        .map((instances) => {
          return Object.values(instances).map((instance: IModuleService) => {
            return instance.__hooks?.onApplicationPrepareShutdown
              ?.bind(instance)()
              .catch(() => {
                // The module should handle this and log it
                return void 0
              })
          })
        })
        .flat()
    )
  }

  public static clearInstances(): void {
    MedusaModule.instances_.clear()
    MedusaModule.modules_.clear()
    MedusaModule.joinerConfig_.clear()
    MedusaModule.moduleResolutions_.clear()
    MedusaModule.customLinks_.length = 0
  }

  public static isInstalled(moduleKey: string, alias?: string): boolean {
    if (alias) {
      return (
        MedusaModule.modules_.has(moduleKey) &&
        MedusaModule.modules_.get(moduleKey)!.some((m) => m.alias === alias)
      )
    }

    return MedusaModule.modules_.has(moduleKey)
  }

  public static getJoinerConfig(moduleKey: string): ModuleJoinerConfig {
    return MedusaModule.joinerConfig_.get(moduleKey)!
  }

  public static getAllJoinerConfigs(): ModuleJoinerConfig[] {
    return [...MedusaModule.joinerConfig_.values()]
  }

  public static getModuleResolutions(moduleKey: string): ModuleResolution {
    return MedusaModule.moduleResolutions_.get(moduleKey)!
  }

  public static getAllModuleResolutions(): ModuleResolution[] {
    return [...MedusaModule.moduleResolutions_.values()]
  }

  public static unregisterModuleResolution(moduleKey: string): void {
    MedusaModule.moduleResolutions_.delete(moduleKey)
    MedusaModule.joinerConfig_.delete(moduleKey)
    const moduleAliases = MedusaModule.modules_
      .get(moduleKey)
      ?.map((m) => m.alias || m.hash)
    if (moduleAliases) {
      for (const alias of moduleAliases) {
        MedusaModule.instances_.delete(alias)
      }
    }
    MedusaModule.modules_.delete(moduleKey)
  }

  public static setModuleResolution(
    moduleKey: string,
    resolution: ModuleResolution
  ): ModuleResolution {
    MedusaModule.moduleResolutions_.set(moduleKey, resolution)

    return resolution
  }

  public static setJoinerConfig(
    moduleKey: string,
    config: ModuleJoinerConfig
  ): ModuleJoinerConfig {
    MedusaModule.joinerConfig_.set(moduleKey, config)

    return config
  }

  public static setCustomLink(config: RegisterModuleJoinerConfig): void {
    MedusaModule.customLinks_.push(config)
  }

  public static getCustomLinks(): RegisterModuleJoinerConfig[] {
    return MedusaModule.customLinks_
  }

  public static getModuleInstance(
    moduleKey: string,
    alias?: string
  ): any | undefined {
    if (!MedusaModule.modules_.has(moduleKey)) {
      return
    }

    let mod
    const modules = MedusaModule.modules_.get(moduleKey)!
    if (alias) {
      mod = modules.find((m) => m.alias === alias)

      return MedusaModule.instances_.get(mod?.hash)
    }

    mod = modules.find((m) => m.main) ?? modules[0]

    return MedusaModule.instances_.get(mod?.hash)
  }

  private static registerModule(
    moduleKey: string,
    loadedModule: ModuleAlias
  ): void {
    if (!MedusaModule.modules_.has(moduleKey)) {
      MedusaModule.modules_.set(moduleKey, [])
    }

    const modules = MedusaModule.modules_.get(moduleKey)!

    if (modules.some((m) => m.alias === loadedModule.alias)) {
      throw new Error(
        `Module ${moduleKey} already registed as '${loadedModule.alias}'. Please choose a different alias.`
      )
    }

    if (loadedModule.main) {
      if (modules.some((m) => m.main)) {
        throw new Error(`Module ${moduleKey} already have a 'main' registered.`)
      }
    }

    modules.push(loadedModule)
    MedusaModule.modules_.set(moduleKey, modules!)
  }

  /**
   * Load all modules and resolve them once they are loaded
   * @param modulesOptions
   * @param migrationOnly
   * @param loaderOnly
   * @param workerMode
   */
  public static async bootstrapAll(
    modulesOptions: Omit<
      ModuleBootstrapOptions,
      "migrationOnly" | "loaderOnly" | "workerMode" | "schemaOnly"
    >[],
    {
      migrationOnly,
      loaderOnly,
      workerMode,
      schemaOnly,
      cwd,
      persistenceAdapter,
      resourceLoader,
      moduleExportsLoader,
      moduleLoader,
      moduleRegistration,
    }: {
      migrationOnly?: boolean
      loaderOnly?: boolean
      workerMode?: ModuleBootstrapOptions["workerMode"]
      cwd?: string
      schemaOnly?: boolean
      persistenceAdapter?: ModulePersistenceAdapter
      resourceLoader?: ModuleResourceLoader
      moduleExportsLoader?: ModuleExportsLoader
      moduleLoader?: ModuleLoader
      moduleRegistration?: ModuleRegistration
    }
  ): Promise<
    {
      [key: string]: any
    }[]
  > {
    return await MedusaModule.bootstrap_(modulesOptions, {
      migrationOnly,
      loaderOnly,
      workerMode,
      cwd,
      schemaOnly,
      persistenceAdapter,
      resourceLoader,
      moduleExportsLoader,
      moduleLoader,
      moduleRegistration,
    })
  }

  /**
   * Load a single module and resolve it once it is loaded
   * @param moduleKey
   * @param defaultPath
   * @param declaration
   * @param moduleExports
   * @param sharedContainer
   * @param moduleDefinition
   * @param injectedDependencies
   * @param migrationOnly
   * @param loaderOnly
   * @param workerMode
   */
  public static async bootstrap<T>({
    moduleKey,
    defaultPath,
    declaration,
    moduleExports,
    resources,
    persistenceAdapter,
    resourceLoader,
    moduleExportsLoader,
    moduleLoader,
    moduleRegistration,
    sharedContainer,
    moduleDefinition,
    injectedDependencies,
    migrationOnly,
    loaderOnly,
    workerMode,
    cwd,
  }: ModuleBootstrapOptions): Promise<{
    [key: string]: T
  }> {
    const [service] = await MedusaModule.bootstrap_(
      [
        {
          moduleKey,
          defaultPath,
          declaration,
          moduleExports,
          resources,
          sharedContainer,
          moduleDefinition,
          injectedDependencies,
        },
      ],
      {
        migrationOnly,
        loaderOnly,
        workerMode,
        cwd,
        persistenceAdapter,
        resourceLoader,
        moduleExportsLoader,
        moduleLoader,
        moduleRegistration,
      }
    )

    return service as {
      [key: string]: T
    }
  }

  /**
   * Load all modules and then resolve them once they are loaded
   *
   * @param modulesOptions
   * @param migrationOnly
   * @param loaderOnly
   * @param workerMode
   * @protected
   */
  protected static async bootstrap_<T>(
    modulesOptions: Omit<
      ModuleBootstrapOptions,
      "migrationOnly" | "loaderOnly" | "workerMode" | "cwd" | "schemaOnly"
    >[],
    {
      migrationOnly,
      loaderOnly,
      workerMode,
      cwd,
      schemaOnly,
      persistenceAdapter,
      resourceLoader,
      moduleExportsLoader,
      moduleLoader,
      moduleRegistration,
    }: {
      migrationOnly?: boolean
      loaderOnly?: boolean
      workerMode?: "shared" | "worker" | "server"
      cwd?: string
      schemaOnly?: boolean
      persistenceAdapter?: ModulePersistenceAdapter
      resourceLoader?: ModuleResourceLoader
      moduleExportsLoader?: ModuleExportsLoader
      moduleLoader?: ModuleLoader
      moduleRegistration?: ModuleRegistration
    }
  ): Promise<
    {
      [key: string]: T
    }[]
  > {
    let loadedModules: {
      hashKey: string
      modDeclaration: InternalModuleDeclaration | ExternalModuleDeclaration
      moduleResolutions: Record<string, ModuleResolution>
      container: MedusaContainer
      finishLoading: (arg: { [Key: string]: any }) => void
    }[] = []

    const services: { [Key: string]: any }[] = []

    await promiseAll(
      modulesOptions.map(async (moduleOptions) => {
        const {
          moduleKey,
          defaultPath,
          declaration,
          moduleExports,
          resources,
          sharedContainer,
          moduleDefinition,
          injectedDependencies,
        } = moduleOptions

        const hashKey = simpleHash(
          stringifyCircular({ moduleKey, defaultPath, declaration })
        )

        let finishLoading: any
        let errorLoading: any

        const loadingPromise = new Promise((resolve, reject) => {
          finishLoading = resolve
          errorLoading = reject
        })

        if (!loaderOnly && MedusaModule.instances_.has(hashKey)) {
          services.push(MedusaModule.instances_.get(hashKey)!)
          return
        }

        if (!loaderOnly && MedusaModule.loading_.has(hashKey)) {
          services.push(await MedusaModule.loading_.get(hashKey))
          return
        }

        if (!loaderOnly) {
          MedusaModule.loading_.set(hashKey, loadingPromise)
        }

        let modDeclaration =
          declaration ??
          ({} as InternalModuleDeclaration | ExternalModuleDeclaration)

        if (declaration?.scope !== MODULE_SCOPE.EXTERNAL) {
          modDeclaration = {
            scope: declaration?.scope || MODULE_SCOPE.INTERNAL,
            resolve: defaultPath,
            options: declaration?.options ?? declaration,
            dependencies:
              (declaration as InternalModuleDeclaration)?.dependencies ?? [],
            alias: declaration?.alias,
            main: declaration?.main,
            worker_mode: workerMode,
          } as InternalModuleDeclaration
        }

        const container = sharedContainer ?? createMedusaContainer()

        if (injectedDependencies) {
          for (const service in injectedDependencies) {
            container.register(service, asValue(injectedDependencies[service]))
            if (!container.hasRegistration(service)) {
              container.register(
                service,
                asValue(injectedDependencies[service])
              )
            }
          }
        }

        const registerModule =
          moduleRegistration ??
          MedusaModule.defaultInfrastructure_.moduleRegistration
        const moduleResolutions = registerModule({
          moduleKey,
          moduleDeclaration: modDeclaration!,
          moduleExports,
          resources,
          definition: moduleDefinition,
          cwd,
        })

        const logger_ =
          container.resolve(ContainerRegistrationKeys.LOGGER, {
            allowUnregistered: true,
          }) ?? logger

        try {
          const loadModule =
            moduleLoader ?? MedusaModule.defaultInfrastructure_.moduleLoader
          await loadModule({
            container,
            moduleResolutions,
            logger: logger_,
            migrationOnly,
            schemaOnly,
            loaderOnly,
            persistenceAdapter:
              persistenceAdapter ??
              MedusaModule.defaultInfrastructure_.persistenceAdapter,
            resourceLoader:
              resourceLoader ??
              MedusaModule.defaultInfrastructure_.resourceLoader,
            moduleExportsLoader:
              moduleExportsLoader ??
              MedusaModule.defaultInfrastructure_.moduleExportsLoader,
          })
        } catch (err) {
          errorLoading(err)
          throw err
        }

        loadedModules.push({
          hashKey,
          modDeclaration,
          moduleResolutions,
          container,
          finishLoading,
        })
      })
    )

    if (loaderOnly) {
      loadedModules.forEach(({ finishLoading }) => finishLoading({}))
      return [{}]
    }

    const resolvedServices = await promiseAll(
      loadedModules.map(
        async ({
          hashKey,
          modDeclaration,
          moduleResolutions,
          container,
          finishLoading,
        }) => {
          const service = await MedusaModule.resolveLoadedModule({
            hashKey,
            modDeclaration,
            moduleResolutions,
            container,
          })

          MedusaModule.instances_.set(hashKey, service)
          finishLoading(service)
          MedusaModule.loading_.delete(hashKey)
          return service
        }
      )
    )

    services.push(...resolvedServices)

    return services
  }

  /**
   * Resolve all the modules once they all have been loaded through the bootstrap
   * and store their references in the instances_ map and return them
   *
   * @param hashKey
   * @param modDeclaration
   * @param moduleResolutions
   * @param container
   * @private
   */
  private static async resolveLoadedModule({
    hashKey,
    modDeclaration,
    moduleResolutions,
    container,
  }: {
    hashKey: string
    modDeclaration: InternalModuleDeclaration | ExternalModuleDeclaration
    moduleResolutions: Record<string, ModuleResolution>
    container: MedusaContainer
  }): Promise<{
    [key: string]: any
  }> {
    const logger_ =
      container.resolve(ContainerRegistrationKeys.LOGGER, {
        allowUnregistered: true,
      }) ?? logger

    const services: { [key: string]: any } = {}

    for (const resolution of Object.values(
      moduleResolutions
    ) as ModuleResolution[]) {
      const keyName = resolution.definition.key

      services[keyName] = container.resolve(keyName)
      services[keyName].__definition = resolution.definition
      services[keyName].__definition.resolvePath =
        "resolve" in modDeclaration &&
        typeof modDeclaration.resolve === "string"
          ? modDeclaration.resolve
          : undefined

      if (resolution.definition.isQueryable) {
        let joinerConfig!: ModuleJoinerConfig

        try {
          // TODO: rework that to store on a separate property
          joinerConfig =
            resolution.resources?.joinerConfig ??
            (typeof services[keyName].__joinerConfig === "function"
              ? await services[keyName].__joinerConfig?.()
              : services[keyName].__joinerConfig)
        } catch {
          // noop
        }

        if (!joinerConfig) {
          throw new Error(
            `Your module is missing a joiner config: ${keyName}. If this module is not queryable, please set { definition: { isQueryable: false } } in your module configuration.`
          )
        }

        if (!joinerConfig.primaryKeys) {
          logger_.warn(
            `Primary keys are not defined by the module ${keyName}. Setting default primary key to 'id'\n`
          )

          joinerConfig.primaryKeys = ["id"]
        }

        services[keyName].__joinerConfig = joinerConfig
        MedusaModule.setJoinerConfig(keyName, joinerConfig)
      }

      MedusaModule.setModuleResolution(keyName, resolution)

      MedusaModule.registerModule(keyName, {
        key: keyName,
        hash: hashKey,
        alias: modDeclaration.alias ?? hashKey,
        main: !!modDeclaration.main,
        isLink: false,
      })
    }

    return services
  }

  public static async bootstrapLink({
    definition,
    declaration,
    moduleExports,
    injectedDependencies,
    cwd,
    migrationOnly,
    schemaOnly,
  }: LinkModuleBootstrapOptions): Promise<{
    [key: string]: unknown
  }> {
    const moduleKey = definition.key
    const hashKey = simpleHash(stringifyCircular({ moduleKey, declaration }))

    if (MedusaModule.instances_.has(hashKey)) {
      return { [moduleKey]: MedusaModule.instances_.get(hashKey) }
    }

    if (MedusaModule.loading_.has(hashKey)) {
      return await MedusaModule.loading_.get(hashKey)
    }

    let finishLoading: any
    let errorLoading: any
    MedusaModule.loading_.set(
      hashKey,
      new Promise((resolve, reject) => {
        finishLoading = resolve
        errorLoading = reject
      })
    )

    let modDeclaration =
      declaration ?? ({} as Partial<InternalModuleDeclaration>)

    const moduleDefinition: ModuleDefinition = {
      key: definition.key,
      dependencies: definition.dependencies,
      defaultPackage: "",
      label: definition.label,
      isRequired: false,
      isQueryable: true,
      defaultModuleDeclaration: definition.defaultModuleDeclaration,
    }

    modDeclaration = {
      resolve: "",
      options: declaration,
      alias: declaration?.alias,
      main: declaration?.main,
    }

    const container = createMedusaContainer()

    if (injectedDependencies) {
      for (const service in injectedDependencies) {
        container.register(service, asValue(injectedDependencies[service]))
      }
    }

    const moduleResolutions =
      MedusaModule.defaultInfrastructure_.moduleRegistration({
        moduleKey,
        moduleDeclaration: modDeclaration as InternalModuleDeclaration,
        moduleExports,
        definition: moduleDefinition,
        cwd,
      })

    const logger_ =
      container.resolve(ContainerRegistrationKeys.LOGGER, {
        allowUnregistered: true,
      }) ?? logger

    try {
      await MedusaModule.defaultInfrastructure_.moduleLoader({
        container,
        moduleResolutions,
        migrationOnly,
        schemaOnly,
        logger: logger_,
        persistenceAdapter:
          MedusaModule.defaultInfrastructure_.persistenceAdapter,
        resourceLoader: MedusaModule.defaultInfrastructure_.resourceLoader,
        moduleExportsLoader:
          MedusaModule.defaultInfrastructure_.moduleExportsLoader,
      })
    } catch (err) {
      errorLoading(err)
      throw err
    }

    const services = {}

    for (const resolution of Object.values(
      moduleResolutions
    ) as ModuleResolution[]) {
      const keyName = resolution.definition.key

      services[keyName] = container.resolve(keyName)
      services[keyName].__definition = resolution.definition

      if (resolution.definition.isQueryable) {
        let joinerConfig!: ModuleJoinerConfig

        try {
          joinerConfig = await services[keyName].__joinerConfig?.()
        } catch {
          // noop
        }

        if (!joinerConfig) {
          throw new Error(
            `Your module is missing a joiner config: ${keyName}. If this module is not queryable, please set { definition: { isQueryable: false } } in your module configuration.`
          )
        }

        services[keyName].__joinerConfig = joinerConfig
        MedusaModule.setJoinerConfig(keyName, joinerConfig)

        if (!joinerConfig.isLink) {
          throw new Error(
            "MedusaModule.bootstrapLink must be used only for Link Modules"
          )
        }
      }

      MedusaModule.setModuleResolution(keyName, resolution)
      MedusaModule.registerModule(keyName, {
        key: keyName,
        hash: hashKey,
        alias: modDeclaration.alias ?? hashKey,
        main: !!modDeclaration.main,
        isLink: true,
      })
    }

    MedusaModule.instances_.set(hashKey, services)
    finishLoading(services)
    MedusaModule.loading_.delete(hashKey)

    return services
  }

  public static async migrateGenerate({
    options,
    container,
    moduleExports,
    moduleKey,
    modulePath,
    cwd,
  }: MigrationOptions): Promise<void> {
    const moduleResolutions =
      MedusaModule.defaultInfrastructure_.moduleRegistration({
        moduleKey,
        moduleDeclaration: {
          scope: MODULE_SCOPE.INTERNAL,
          resolve: modulePath,
          options,
        },
        cwd,
      })

    const logger_ =
      container?.resolve(ContainerRegistrationKeys.LOGGER, {
        allowUnregistered: true,
      }) ?? logger

    container ??= createMedusaContainer()

    for (const mod in moduleResolutions) {
      const migrationLoader =
        MedusaModule.defaultInfrastructure_.migrationLoader
      if (!migrationLoader) {
        throw new Error("Module migration infrastructure is not configured")
      }
      const { generateMigration } = await migrationLoader(
        container,
        moduleResolutions[mod],
        moduleExports
      )

      if (typeof generateMigration === "function") {
        await generateMigration({
          options,
          container: container!,
          logger: logger_,
        })
      }
    }
  }

  public static async migrateUp({
    options,
    container,
    moduleExports,
    moduleKey,
    modulePath,
    cwd,
  }: MigrationOptions): Promise<{ name: string; path: string }[]> {
    const moduleResolutions =
      MedusaModule.defaultInfrastructure_.moduleRegistration({
        moduleKey,
        moduleDeclaration: {
          scope: MODULE_SCOPE.INTERNAL,
          resolve: modulePath,
          options,
        },
        cwd,
      })

    const logger_ =
      container?.resolve(ContainerRegistrationKeys.LOGGER, {
        allowUnregistered: true,
      }) ?? logger

    container ??= createMedusaContainer()

    let result: { name: string; path: string }[] = []
    for (const mod in moduleResolutions) {
      const migrationLoader =
        MedusaModule.defaultInfrastructure_.migrationLoader
      if (!migrationLoader) {
        throw new Error("Module migration infrastructure is not configured")
      }
      const { runMigrations } = await migrationLoader(
        container,
        moduleResolutions[mod],
        moduleExports
      )

      if (typeof runMigrations === "function") {
        const res = await runMigrations({
          options,
          container: container!,
          logger: logger_,
        })
        result.push(...res)
      }
    }

    return result
  }

  public static async migrateDown(
    {
      options,
      container,
      moduleExports,
      moduleKey,
      modulePath,
      cwd,
    }: MigrationOptions,
    migrationNames?: string[]
  ): Promise<void> {
    const moduleResolutions =
      MedusaModule.defaultInfrastructure_.moduleRegistration({
        moduleKey,
        moduleDeclaration: {
          scope: MODULE_SCOPE.INTERNAL,
          resolve: modulePath,
          options,
        },
        cwd,
      })

    const logger_ =
      container?.resolve(ContainerRegistrationKeys.LOGGER, {
        allowUnregistered: true,
      }) ?? logger

    container ??= createMedusaContainer()

    for (const mod in moduleResolutions) {
      const migrationLoader =
        MedusaModule.defaultInfrastructure_.migrationLoader
      if (!migrationLoader) {
        throw new Error("Module migration infrastructure is not configured")
      }
      const { revertMigration } = await migrationLoader(
        container,
        moduleResolutions[mod],
        moduleExports
      )

      if (typeof revertMigration === "function") {
        await revertMigration({
          options,
          container: container!,
          logger: logger_,
          migrationNames,
        })
      }
    }
  }
}

globalThis.MedusaModule ??= MedusaModule
const GlobalMedusaModule = globalThis.MedusaModule as typeof MedusaModule

export { GlobalMedusaModule as MedusaModule }
