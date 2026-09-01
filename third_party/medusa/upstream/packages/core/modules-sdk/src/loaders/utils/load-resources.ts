import type {
  ConfigModule,
  Logger,
  MedusaContainer,
  ModuleLoaderFunction,
  ModulePersistenceAdapter,
  ModulePersistenceModel,
  ModuleResolution,
  RepositoryService,
  StaticModuleResources,
  Constructor,
} from "@medusajs/types"
import {
  ContainerRegistrationKeys,
  discoverAndRegisterFeatureFlags,
  DmlEntity,
  dynamicImport,
  FeatureFlag,
  isFileSkipped,
  defineJoinerConfig,
} from "@medusajs/utils"
import { moduleContainerLoaderFactory } from "@medusajs/utils/modules-sdk/container-loader"
import { statSync } from "fs"
import { readdir } from "fs/promises"
import { dirname, join, resolve } from "path"

async function importAllFromDir(path: string): Promise<unknown[]> {
  const filesToLoad: string[] = []
  const excludedExtensions = [".ts.map", ".js.map", ".d.ts"]

  await readdir(path).then((files) => {
    files.forEach((file) => {
      if (
        file.startsWith("index.") ||
        excludedExtensions.some((ext) => file.endsWith(ext))
      ) {
        return
      }

      const filePath = join(path, file)
      if (statSync(filePath).isFile()) {
        filesToLoad.push(filePath)
      }
    })
  })

  return (
    await Promise.all(filesToLoad.map((filePath) => dynamicImport(filePath)))
  )
    .filter((value) => !isFileSkipped(value))
    .flatMap((value) => Object.values(value))
}

function cleanupResources(resources: unknown[]): ModulePersistenceModel[] {
  return resources.filter((resource): resource is ModulePersistenceModel => {
    return DmlEntity.isDmlEntity(resource) || typeof resource === "function"
  })
}

function cleanupConstructors<T extends object>(
  resources: unknown[]
): Constructor<T>[] {
  // Filesystem discovery is the validation boundary for module constructors.
  return resources.filter(
    (resource): resource is Function => typeof resource === "function"
  ) as Constructor<T>[]
}

export async function resolveResources({
  container,
  discoveryPath,
  logger = console as unknown as Logger,
}: {
  container: MedusaContainer
  moduleResolution: ModuleResolution
  discoveryPath: string
  logger?: Logger
}): Promise<StaticModuleResources> {
  const normalizedPath = resolve(
    dirname(require.resolve(discoveryPath, { paths: [process.cwd()] }))
  )
  const configModule = container.resolve(ContainerRegistrationKeys.CONFIG_MODULE, {
    allowUnregistered: true,
  }) as ConfigModule

  await discoverAndRegisterFeatureFlags({
    flagDir: normalizedPath,
    projectConfigFlags: configModule?.featureFlags ?? {},
    router: FeatureFlag,
    logger,
    maxDepth: 1,
  })

  const defaultOnFail = () => [] as unknown[]
  const [module, services, models, repositories] = await Promise.all([
    dynamicImport(discoveryPath),
    importAllFromDir(resolve(normalizedPath, "services")).catch(defaultOnFail),
    importAllFromDir(resolve(normalizedPath, "models")).catch(defaultOnFail),
    importAllFromDir(resolve(normalizedPath, "repositories")).catch(
      defaultOnFail
    ),
  ])

  const moduleExports = module.default ?? module
  return {
    services: cleanupConstructors<object>(services),
    models: cleanupResources(models),
    repositories: cleanupConstructors<RepositoryService>(repositories),
    loaders: moduleExports.loaders ?? [],
    moduleService: moduleExports.service,
    migrationPath: join(normalizedPath, "migrations"),
  }
}

export async function loadResources({
  moduleResolution,
  loadedModuleLoaders,
  ...options
}: Parameters<typeof resolveResources>[0] & {
  loadedModuleLoaders?: ModuleLoaderFunction[]
}) {
  const persistenceAdapter = moduleResolution.options
    ?.persistenceAdapter as ModulePersistenceAdapter | undefined
  if (!persistenceAdapter) {
    throw new Error(
      `Module ${moduleResolution.definition.key} requires a persistence adapter`
    )
  }

  const resources = await resolveResources({ moduleResolution, ...options })
  const models = persistenceAdapter.prepareModels(resources.models)
  const loaders: ModuleLoaderFunction[] = []
  const suppliedLoaders = loadedModuleLoaders ?? resources.loaders

  if (
    models.length &&
    !suppliedLoaders.some((loader) => loader.name === "connectionLoader")
  ) {
    loaders.push(
      persistenceAdapter.createConnectionLoader({
        moduleName: moduleResolution.definition.key,
        moduleModels: models,
        migrationsPath: resources.migrationPath,
      })
    )
  }

  if (!suppliedLoaders.some((loader) => loader.name === "containerLoader")) {
    const toObject = <T extends object>(items: Constructor<T>[]) =>
      Object.fromEntries(items.map((item) => [item.name, item]))
    loaders.push(
      moduleContainerLoaderFactory({
        moduleModels: Object.fromEntries(
          models.map((model) => [model.name, model])
        ),
        moduleRepositories: toObject(resources.repositories),
        moduleServices: toObject(resources.services),
        persistenceAdapter,
      })
    )
  }
  loaders.push(...suppliedLoaders)

  const originalJoinerConfig = resources.moduleService.prototype.__joinerConfig
  resources.moduleService.prototype.__joinerConfig = function () {
    return originalJoinerConfig
      ? {
          serviceName: moduleResolution.definition.key,
          ...originalJoinerConfig(),
        }
      : defineJoinerConfig(moduleResolution.definition.key, {
          models: resources.models,
        })
  }

  return {
    ...resources,
    models,
    loaders,
  }
}
