import type {
  Constructor,
  LoaderOptions,
  MedusaContainer,
  ModulePersistenceAdapter,
  ModulePersistenceModel,
  ModuleServiceInitializeCustomDataLayerOptions,
  ModuleServiceInitializeOptions,
  RepositoryService,
} from "@medusajs/types"

import { asClass, asValue } from "@medusajs/deps/awilix"
import { MedusaInternalService } from "../medusa-internal-service"
import { ContainerRegistrationKeys } from "../../common/container"
import { lowerCaseFirst } from "../../common/lower-case-first"

type RepositoryLoaderOptions = {
  moduleModels: Record<string, ModulePersistenceModel>
  moduleRepositories?: Record<string, Constructor<RepositoryService>>
  customRepositories: Record<string, Constructor<RepositoryService>>
  container: MedusaContainer
  persistenceAdapter: ModulePersistenceAdapter
}

type ServiceLoaderOptions = {
  moduleModels: Record<string, ModulePersistenceModel>
  moduleServices: Record<string, Constructor<object>>
  container: MedusaContainer
}

/**
 * Factory for creating a container loader for a module.
 *
 * @param moduleModels
 * @param moduleServices
 * @param moduleRepositories
 * @param persistenceAdapter The persistence implementation used to create default repositories.
 * @param customRepositoryLoader Optional replacement for the standard repository registration flow.
 */
export function moduleContainerLoaderFactory({
  moduleModels,
  moduleServices,
  moduleRepositories = {},
  persistenceAdapter: configuredPersistenceAdapter,
  customRepositoryLoader = loadModuleRepositories,
}: {
  moduleModels: Record<string, ModulePersistenceModel>
  moduleServices: Record<string, Constructor<object>>
  moduleRepositories?: Record<string, Constructor<RepositoryService>>
  persistenceAdapter?: ModulePersistenceAdapter
  customRepositoryLoader?: (options: RepositoryLoaderOptions) => void
}): ({ container, options }: LoaderOptions) => Promise<void> {
  return async function containerLoader({
    container,
    options,
  }: LoaderOptions<
    | ModuleServiceInitializeOptions
    | ModuleServiceInitializeCustomDataLayerOptions
  >) {
    const customRepositories =
      options && "repositories" in options ? options.repositories : undefined
    const persistenceAdapter =
      options && "persistenceAdapter" in options
        ? options.persistenceAdapter ?? configuredPersistenceAdapter
        : configuredPersistenceAdapter
    if (!persistenceAdapter) {
      throw new Error(
        "A persistence adapter is required to load module repositories"
      )
    }
    container.register({
      [ContainerRegistrationKeys.MODULE_PERSISTENCE_ADAPTER]:
        asValue(persistenceAdapter),
    })

    loadModuleServices({
      moduleModels,
      moduleServices,
      container,
    })

    const repositoryLoader = customRepositoryLoader ?? loadModuleRepositories
    repositoryLoader({
      moduleModels,
      moduleRepositories,
      customRepositories: customRepositories ?? {},
      container,
      persistenceAdapter,
    })
  }
}

/**
 * Load the services from the module services object. If a service is not
 * present a default service will be created for the model.
 *
 * @param moduleModels
 * @param moduleServices
 * @param container
 */
export function loadModuleServices({
  moduleModels,
  moduleServices,
  container,
}: ServiceLoaderOptions) {
  const moduleServicesMap = new Map(
    Object.entries(moduleServices).map(([key, service]) => [
      lowerCaseFirst(key),
      service,
    ])
  )

  // Build default services for all models that are not present in the module services
  Object.values(moduleModels).forEach((Model) => {
    const mappedServiceName = lowerCaseFirst(Model.name) + "Service"
    const finalService = moduleServicesMap.get(mappedServiceName)

    if (!finalService) {
      moduleServicesMap.set(mappedServiceName, MedusaInternalService(Model))
    }
  })

  const allServices = [...moduleServicesMap]

  allServices.forEach(([key, service]) => {
    container.register({
      [lowerCaseFirst(key)]: asClass(service).singleton(),
    })
  })
}

/**
 * Load the repositories from the custom repositories object. If a repository is not
 * present in the custom repositories object, the default repository will be used from the module repository.
 * If none are present, a default repository will be created for the model.
 *
 * @param moduleModels
 * @param moduleRepositories
 * @param customRepositories
 * @param container
 */
export function loadModuleRepositories({
  moduleModels,
  moduleRepositories = {},
  customRepositories,
  container,
  persistenceAdapter,
}: RepositoryLoaderOptions) {
  const customRepositoriesMap = new Map(
    Object.entries(customRepositories).map(([key, repository]) => [
      lowerCaseFirst(key),
      repository,
    ])
  )
  const moduleRepositoriesMap = new Map(
    Object.entries(moduleRepositories).map(([key, repository]) => [
      lowerCaseFirst(key),
      repository,
    ])
  )

  // Build default repositories for all models that are not present in the custom repositories or module repositories
  Object.values(moduleModels).forEach((Model) => {
    const mappedRepositoryName = lowerCaseFirst(Model.name) + "Repository"
    let finalRepository = customRepositoriesMap.get(mappedRepositoryName)
    finalRepository ??= moduleRepositoriesMap.get(mappedRepositoryName)

    if (!finalRepository) {
      moduleRepositoriesMap.set(
        mappedRepositoryName,
        persistenceAdapter.createRepository(Model)
      )
      return
    }

    const adapterRepository = persistenceAdapter.createCustomRepository?.({
      model: Model,
      repository: finalRepository,
    })

    if (adapterRepository) {
      if (customRepositoriesMap.has(mappedRepositoryName)) {
        customRepositoriesMap.set(mappedRepositoryName, adapterRepository)
      } else {
        moduleRepositoriesMap.set(mappedRepositoryName, adapterRepository)
      }
    }
  })

  for (const [repositoryName, repository] of moduleRepositoriesMap) {
    if (
      Object.values(moduleModels).some(
        (Model) => lowerCaseFirst(Model.name) + "Repository" === repositoryName
      )
    ) {
      continue
    }

    const adapterRepository = persistenceAdapter.createCustomRepository?.({
      repositoryName,
      moduleModels,
      repository,
    })

    if (adapterRepository) {
      moduleRepositoriesMap.set(repositoryName, adapterRepository)
    }
  }

  const allRepositories = [...customRepositoriesMap, ...moduleRepositoriesMap]

  container.register({
    ["baseRepository"]: asClass(
      persistenceAdapter.createBaseRepository()
    ).singleton(),
    [ContainerRegistrationKeys.MODULE_PERSISTENCE_ADAPTER]:
      asValue(persistenceAdapter),
  })

  allRepositories.forEach(([key, repository]) => {
    let finalRepository = customRepositoriesMap.get(key)

    if (!finalRepository) {
      finalRepository = repository
    }

    container.register({
      [lowerCaseFirst(key)]: asClass(finalRepository).singleton(),
    })
  })
}
