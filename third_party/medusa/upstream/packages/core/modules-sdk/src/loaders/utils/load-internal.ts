import {
  Constructor,
  IModuleService,
  InternalModuleDeclaration,
  Logger,
  MedusaContainer,
  ModuleExports,
  ModuleLoaderFunction,
  ModulePersistenceAdapter,
  ModulePersistenceModel,
  ModuleProvider,
  ModuleProviderExports,
  ModuleProviderLoaderFunction,
  ModuleResolution,
  StaticModuleResources,
} from "@medusajs/types"
import { ContainerRegistrationKeys } from "@medusajs/utils/common/container"
import { createMedusaContainer } from "@medusajs/utils/common/medusa-container"
import { isString } from "@medusajs/utils/common/is-string"
import { stringifyCircular } from "@medusajs/utils/common/stringify-circular"
import { Modules } from "@medusajs/utils/modules-sdk/definition"
import { moduleContainerLoaderFactory } from "@medusajs/utils/modules-sdk/container-loader"
import {
  MedusaModuleProviderType,
  MedusaModuleType,
} from "@medusajs/utils/modules-sdk/module-types"
import { getProviderRegistrationKey } from "@medusajs/utils/modules-sdk/module-provider-registration-key"
import { asFunction, asValue } from "@medusajs/deps/awilix"

type ModuleResource = {
  services: Function[]
  models: ModulePersistenceModel[]
  repositories: Function[]
  loaders: ModuleLoaderFunction[] | ModuleProviderLoaderFunction[]
  moduleService: Constructor<object>
  normalizedPath: string
}

type LoadInternalArgs = {
  container: MedusaContainer
  resolution: ModuleResolution
  logger: Logger
  migrationOnly?: boolean
  schemaOnly?: boolean
  resourceLoader?: ModuleResourceLoader
  moduleExportsLoader?: ModuleExportsLoader
  loaderOnly?: boolean
}

type ResolvedModule = ModuleExports & {
  discoveryPath: string
}

type ResolvedModuleProvider = ModuleProviderExports & {
  discoveryPath: string
}
export type ModuleResourceLoader = (options: {
  container: MedusaContainer
  moduleResolution: ModuleResolution
  discoveryPath: string
  logger?: Logger
}) => Promise<StaticModuleResources>

export type ModuleExportsLoader = (path: string) => Promise<Record<string, unknown>>

function isModulePersistenceAdapter(
  value: unknown
): value is ModulePersistenceAdapter {
  if (!value || typeof value !== "object") {
    return false
  }

  return (
    "prepareModels" in value &&
    typeof value.prepareModels === "function" &&
    "createConnectionLoader" in value &&
    typeof value.createConnectionLoader === "function" &&
    "createBaseRepository" in value &&
    typeof value.createBaseRepository === "function" &&
    "createRepository" in value &&
    typeof value.createRepository === "function"
  )
}
function getModulePersistenceAdapter(
  moduleResolution: ModuleResolution
): ModulePersistenceAdapter {
  const persistenceAdapter = moduleResolution.options?.persistenceAdapter
  if (!isModulePersistenceAdapter(persistenceAdapter)) {
    throw new Error(
      `Module ${moduleResolution.definition.key} requires a persistence adapter`
    )
  }

  return persistenceAdapter
}
export async function resolveModuleExports({
  resolution,
  moduleExportsLoader,
}: {
  resolution: ModuleResolution
  moduleExportsLoader?: ModuleExportsLoader
}): Promise<ResolvedModule | ResolvedModuleProvider | { error: Error }> {
  let resolvedModuleExports: ModuleExports
  try {
    if (resolution.moduleExports) {
      // TODO:
      // If we want to benefit from the auto load mechanism, even if the module exports is provided, we need to ask for the module path
      resolvedModuleExports = resolution.moduleExports as ModuleExports
      resolvedModuleExports.discoveryPath = resolution.resolutionPath as string
    } else {
      if (!moduleExportsLoader) {
        throw new Error(
          `Module ${resolution.definition.key} requires a module exports loader`
        )
      }
      const module = await moduleExportsLoader(resolution.resolutionPath as string)

      if ("discoveryPath" in module) {
        const reExportedLoadedModule = await moduleExportsLoader(
          module.discoveryPath as string
        )
        const discoveryPath = module.discoveryPath
        resolvedModuleExports = (reExportedLoadedModule.default ??
          reExportedLoadedModule) as ModuleExports
        resolvedModuleExports.discoveryPath = discoveryPath as string
      } else {
        resolvedModuleExports = ((module as { default?: ModuleExports })
          .default ?? module) as ModuleExports
        resolvedModuleExports.discoveryPath =
          resolution.resolutionPath as string
      }
    }

    return resolvedModuleExports as ModuleExports & {
      discoveryPath: string
    }
  } catch (error) {
    if (
      resolution.definition.isRequired &&
      resolution.definition.defaultPackage
    ) {
      return {
        error: new Error(
          `Make sure you have installed the default package: ${resolution.definition.defaultPackage}`
        ),
      }
    }

    return {
      error: error instanceof Error ? error : new Error(String(error)),
    }
  }
}

async function loadInternalProvider(
  args: LoadInternalArgs,
  providers: ModuleProvider[]
): Promise<{ error?: Error } | void> {
  const {
    container,
    resolution,
    logger,
    migrationOnly,
    schemaOnly,
    resourceLoader,
    moduleExportsLoader,
  } = args

  const errors: { error?: Error }[] = []
  for (const provider of providers) {
    const providerRes = provider.resolve as ModuleProviderExports

    const canLoadProvider =
      providerRes && (isString(providerRes) || !providerRes?.services)

    if (!canLoadProvider) {
      continue
    }

    const res = await loadInternalModule({
      container,
      resolution: {
        ...resolution,
        moduleExports: !isString(providerRes) ? providerRes : undefined,
        resources: undefined,
        definition: {
          ...resolution.definition,
          key: provider.id!,
        },
        resolutionPath: isString(provider.resolve)
          ? require.resolve(provider.resolve, {
              paths: [process.cwd()],
            })
          : false,
      },
      logger,
      migrationOnly,
      schemaOnly,
      loadingProviders: true,
      resourceLoader,
      moduleExportsLoader,
    })

    if (res) {
      errors.push(res)
    }
  }

  const errorMessages = errors.map((e) => e.error?.message).join("\n")
  return errors.length
    ? {
        error: {
          name: "ModuleProviderError",
          message: `Errors while loading module providers for module ${resolution.definition.key}:\n${errorMessages}`,
          stack: errors.map((e) => e.error?.stack).join("\n"),
        },
      }
    : undefined
}

export async function loadInternalModule(args: {
  container: MedusaContainer
  resolution: ModuleResolution
  logger: Logger
  migrationOnly?: boolean
  loaderOnly?: boolean
  loadingProviders?: boolean
  schemaOnly?: boolean
  resourceLoader?: ModuleResourceLoader
  moduleExportsLoader?: ModuleExportsLoader
}): Promise<{ error?: Error } | void> {
  const {
    container,
    resolution,
    logger,
    migrationOnly,
    loaderOnly,
    loadingProviders,
    schemaOnly,
    resourceLoader,
    moduleExportsLoader,
  } = args

  const keyName = !loaderOnly
    ? resolution.definition.key
    : resolution.definition.key + "__loaderOnly"

  const loadedModule = await resolveModuleExports({
    resolution,
    moduleExportsLoader,
  })

  if ("error" in loadedModule) {
    return loadedModule
  }

  let moduleResources = {} as ModuleResource

  if (resolution.resources) {
    moduleResources = prepareStaticResources({
      moduleResolution: resolution,
      moduleService: (
        loadedModule as ModuleExports<Constructor<object>>
      ).service,
    })
  } else if (loadedModule.discoveryPath) {
    if (!resourceLoader) {
      throw new Error(
        `Module ${resolution.definition.key} requires a resource loader`
      )
    }
    moduleResources = prepareStaticResources({
      moduleResolution: {
        ...resolution,
        resources: await resourceLoader({
          container,
          moduleResolution: resolution,
          discoveryPath: loadedModule.discoveryPath,
          logger,
        }),
      },
      moduleService: (
        loadedModule as ModuleExports<Constructor<object>>
      ).service,
    })
  }

  const loadedModule_ = loadedModule as ModuleExports
  if (
    !loadingProviders &&
    !loadedModule_?.service &&
    !moduleResources.moduleService
  ) {
    container.register({
      [keyName]: asValue(undefined),
    })

    return {
      error: new Error(
        `No service found in module ${resolution?.definition?.label}. Make sure your module exports a service.`
      ),
    }
  }

  const localContainer = createMedusaContainer()

  const dependencies = resolution?.dependencies ?? []

  dependencies.push(
    ContainerRegistrationKeys.MANAGER,
    ContainerRegistrationKeys.CONFIG_MODULE,
    ContainerRegistrationKeys.LOGGER,
    ContainerRegistrationKeys.PG_CONNECTION,
    Modules.EVENT_BUS,
    Modules.CACHING
  )

  for (const dependency of dependencies) {
    localContainer.register(
      dependency,
      asFunction(() => {
        return container.resolve(dependency, { allowUnregistered: true })
      })
    )
  }

  if (resolution.definition.__passSharedContainer) {
    localContainer.register(
      "sharedContainer",
      asFunction(() => {
        return container
      })
    )
  }

  // if module has providers, load them
  let providerOptions: any = undefined
  if (!loadingProviders) {
    const providers = (resolution?.options?.providers as any[]) ?? []

    const res = await loadInternalProvider(
      {
        ...args,
        container: localContainer,
      },
      providers
    )

    if (res?.error) {
      return res
    }
  } else {
    providerOptions = (resolution?.options?.providers as any[]).find(
      (p) => p.id === resolution.definition.key
    )?.options
  }

  // Partial module load: register only __joinerConfig
  // - migrationOnly: needed for migration planning + loader execution
  // - schemaOnly: needed for GraphQL schema + type generation
  if ((schemaOnly || migrationOnly) && !loadingProviders) {
    const moduleService_ =
      moduleResources.moduleService ?? loadedModule_.service

    // Partially loaded module, only register the service __joinerConfig function to be able to resolve it later
    const moduleService = {
      __joinerConfig: moduleService_.prototype.__joinerConfig,
    }

    container.register({
      [keyName]: asValue(moduleService),
    })

    return
  }

  if (schemaOnly) {
    // in schema only mode, we only need to register the service __joinerConfig function to be able to resolve it later
    // For providers in schema-only mode, skip without registration
    return
  }

  const loaders = moduleResources.loaders ?? loadedModule?.loaders ?? []
  const error = await runLoaders(loaders, {
    container,
    localContainer,
    logger,
    resolution,
    loaderOnly,
    keyName,
    providerOptions,
  })

  if (error) {
    return error
  }

  if (loadingProviders) {
    const loadedProvider_ = loadedModule as ModuleProviderExports

    let moduleProviderServices = moduleResources.moduleService
      ? [moduleResources.moduleService]
      : loadedProvider_.services ?? loadedProvider_

    if (!moduleProviderServices) {
      return
    }

    for (const moduleProviderService of moduleProviderServices) {
      const modProvider_ = moduleProviderService as any

      const originalIdentifier = modProvider_.identifier as string
      const providerId = keyName

      if (!originalIdentifier) {
        const providerResolutionName =
          modProvider_.DISPLAY_NAME ?? resolution.resolutionPath

        throw new Error(
          `Module provider ${providerResolutionName} does not have a static "identifier" property on its service class.`
        )
      }

      const alreadyRegisteredProvider = container.hasRegistration(
        getProviderRegistrationKey({
          providerId,
          providerIdentifier: originalIdentifier,
        })
      )
      if (alreadyRegisteredProvider) {
        throw new Error(
          `Module provider ${originalIdentifier} has already been registered. Please provide a different "id" in the provider options.`
        )
      }

      modProvider_.__type = MedusaModuleProviderType

      const registrationKey = getProviderRegistrationKey({
        providerId,
        providerIdentifier: originalIdentifier,
      })

      container.register({
        [registrationKey]: asFunction(() => {
          ;(moduleProviderService as any).__type = MedusaModuleType
          return new moduleProviderService(
            localContainer.cradle,
            resolution.options,
            resolution.moduleDeclaration
          )
        }).singleton(),
      })
    }
  } else {
    const moduleService = moduleResources.moduleService ?? loadedModule_.service
    container.register({
      [keyName]: asFunction((cradle) => {
        ;(moduleService as any).__type = MedusaModuleType
        return new moduleService(
          localContainer.cradle,
          resolution.options,
          resolution.moduleDeclaration
        )
      }).singleton(),
    })
  }

  if (loaderOnly) {
    // The expectation is only to run the loader as standalone, so we do not need to register the service and we need to cleanup all services
    const service = container.resolve<IModuleService>(keyName)
    await service.__hooks?.onApplicationPrepareShutdown?.()
    await service.__hooks?.onApplicationShutdown?.()
  }
}
function prepareStaticResources({
  moduleResolution,
  moduleService,
}: {
  moduleResolution: ModuleResolution
  moduleService: Constructor<object>
}): ModuleResource {
  const resources = moduleResolution.resources!
  const persistenceAdapter = getModulePersistenceAdapter(moduleResolution)
  const models = persistenceAdapter.prepareModels(resources.models ?? [])
  const services = resources.services ?? []
  const repositories = resources.repositories ?? []

  const loaders = prepareLoaders({
    loadedModuleLoaders: resources.loaders,
    models,
    repositories,
    services,
    moduleResolution,
    migrationPath: resources.migrationPath,
    persistenceAdapter,
  })

  return {
    services,
    models,
    repositories,
    loaders,
    moduleService: resources.moduleService ?? moduleService,
    normalizedPath: "",
  }
}

async function runLoaders(
  loaders: Function[] = [],
  {
    localContainer,
    container,
    logger,
    resolution,
    loaderOnly,
    keyName,
    providerOptions,
  }
): Promise<void | { error: Error }> {
  try {
    for (const loader of loaders) {
      await loader(
        {
          container: localContainer,
          logger,
          options: providerOptions ?? resolution.options,
          dataLoaderOnly: loaderOnly,
          moduleOptions: providerOptions ? resolution.options : undefined,
        },
        resolution.moduleDeclaration as InternalModuleDeclaration
      )
    }
  } catch (err) {
    container.register({
      [keyName]: asValue(undefined),
    })

    logger.error(
      `Loaders for module ${
        resolution.definition.label
      } failed with the following error: \n${stringifyCircular(err)}`
    )

    return {
      error: new Error(
        `Loaders for module ${resolution.definition.label} failed: ${err.message}`
      ),
    }
  }
}

function prepareLoaders({
  loadedModuleLoaders = [] as
    | ModuleLoaderFunction[]
    | ModuleProviderLoaderFunction[],
  models,
  repositories,
  services,
  moduleResolution,
  migrationPath,
  persistenceAdapter,
}: {
  loadedModuleLoaders?:
    | ModuleLoaderFunction[]
    | ModuleProviderLoaderFunction[]
  models: ModulePersistenceModel[]
  repositories: Function[]
  services: Function[]
  moduleResolution: ModuleResolution
  migrationPath?: string
  persistenceAdapter: ModulePersistenceAdapter
}) {
  const finalLoaders: (ModuleLoaderFunction | ModuleProviderLoaderFunction)[] =
    []

  const toObjectReducer = (acc, curr) => {
    acc[curr.name] = curr
    return acc
  }

  /*
   * If no connectionLoader function is provided, create a default connection loader.
   * TODO: Validate naming convention
   */
  const connectionLoaderName = "connectionLoader"
  const containerLoader = "containerLoader"

  const hasConnectionLoader = loadedModuleLoaders.some(
    (l) => l.name === connectionLoaderName
  )

  if (!hasConnectionLoader && models.length > 0) {
    const connectionLoader = persistenceAdapter.createConnectionLoader({
      moduleName: moduleResolution.definition.key,
      moduleModels: models,
      migrationsPath: migrationPath,
    })
    finalLoaders.push(connectionLoader)
  }

  const hasContainerLoader = loadedModuleLoaders.some(
    (l) => l.name === containerLoader
  )

  if (!hasContainerLoader) {
    const containerLoader = moduleContainerLoaderFactory({
      moduleModels: models.reduce(toObjectReducer, {}),
      moduleRepositories: repositories.reduce(toObjectReducer, {}),
      moduleServices: services.reduce(toObjectReducer, {}),
      persistenceAdapter,
    })
    finalLoaders.push(containerLoader)
  }

  finalLoaders.push(
    ...loadedModuleLoaders.filter((loader) => {
      if (
        loader.name !== connectionLoaderName &&
        loader.name !== containerLoader
      ) {
        return true
      }

      return (
        (loader.name === containerLoader && hasContainerLoader) ||
        (loader.name === connectionLoaderName && hasConnectionLoader)
      )
    })
  )

  return finalLoaders
}
