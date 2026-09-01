import { asValue } from "@medusajs/deps/awilix"
import type {
  InternalModuleDeclaration,
  Logger,
  MedusaContainer,
  ModuleDefinition,
  ModuleExports,
  ModulePersistenceAdapter,
  StaticModuleResources,
} from "@medusajs/types"
import { ContainerRegistrationKeys } from "@medusajs/utils/common/container"
import { createMedusaContainer } from "@medusajs/utils/common/medusa-container"
import { MedusaModule } from "./medusa-module"
import { createPortableQueryRuntimeFromJoinerConfigs } from "./remote-query/portable"

export interface StaticModuleManifest {
  moduleDefinition: ModuleDefinition
  moduleExports: ModuleExports
  resources: StaticModuleResources
}

export interface StaticModuleApplication<Service> {
  container: MedusaContainer
  service: Service
}

export interface StaticModulesApplication {
  container: MedusaContainer
  services: Record<string, unknown>
}

export interface RegisterStaticRemoteQueryOptions {
  container: MedusaContainer
  modules: StaticModuleLoadConfig[]
  services: Record<string, unknown>
}

export interface StaticModuleDeclarationOptions {
  [key: string]: unknown
  alias?: string
  dependencies?: string[]
  main?: boolean
}

export interface StaticModuleLoadConfig {
  manifest: StaticModuleManifest
  moduleDeclaration?: StaticModuleDeclarationOptions
  moduleOptions?: Record<string, unknown>
}

export interface LoadStaticModuleOptions extends StaticModuleLoadConfig {
  container?: MedusaContainer
  logger?: Logger
  persistenceAdapter: ModulePersistenceAdapter
}

export interface LoadStaticModulesOptions {
  container?: MedusaContainer
  logger?: Logger
  modules: StaticModuleLoadConfig[]
  persistenceAdapter: ModulePersistenceAdapter
}

const defaultLogger: Logger = {
  panic: console.error,
  shouldLog: () => true,
  setLogLevel: () => {},
  unsetLogLevel: () => {},
  activity: (message) => message,
  progress: () => {},
  error: console.error,
  failure: (_, message) => message,
  success: (_, message) => ({ message }),
  silly: console.debug,
  debug: console.debug,
  verbose: console.debug,
  http: console.info,
  info: console.info,
  warn: console.warn,
  log: console.log,
}

export async function loadStaticModule<Service>({
  container,
  logger = defaultLogger,
  manifest,
  moduleDeclaration,
  moduleOptions,
  persistenceAdapter,
}: LoadStaticModuleOptions): Promise<StaticModuleApplication<Service>> {
  const sharedContainer = prepareStaticModuleContainer(container, logger)

  const loaded = await MedusaModule.bootstrap<Service>({
    moduleKey: manifest.moduleDefinition.key,
    defaultPath: "",
    declaration: createInternalModuleDeclaration({
      moduleDeclaration,
      moduleOptions,
      persistenceAdapter,
    }),
    moduleDefinition: manifest.moduleDefinition,
    moduleExports: manifest.moduleExports,
    resources: manifest.resources,
    sharedContainer,
    persistenceAdapter,
  })

  const service = loaded[manifest.moduleDefinition.key]
  if (!service) {
    throw new Error(
      `Static module ${manifest.moduleDefinition.key} could not be loaded.`
    )
  }

  return {
    container: sharedContainer,
    service,
  }
}

export async function loadStaticModules({
  container,
  logger = defaultLogger,
  modules,
  persistenceAdapter,
}: LoadStaticModulesOptions): Promise<StaticModulesApplication> {
  const sharedContainer = prepareStaticModuleContainer(container, logger)

  const loadedModules = await MedusaModule.bootstrapAll(
    modules.map(({ manifest, moduleDeclaration, moduleOptions }) => {
      return {
        moduleKey: manifest.moduleDefinition.key,
        defaultPath: "",
        declaration: createInternalModuleDeclaration({
          moduleDeclaration,
          moduleOptions,
          persistenceAdapter,
        }),
        moduleDefinition: manifest.moduleDefinition,
        moduleExports: manifest.moduleExports,
        resources: manifest.resources,
        sharedContainer,
      }
    }),
    {
      persistenceAdapter,
    }
  )

  const services: Record<string, unknown> = {}
  for (const { manifest } of modules) {
    const moduleKey = manifest.moduleDefinition.key
    const loadedService = loadedModules.find((loadedModule) => {
      return Boolean(loadedModule[moduleKey])
    })?.[moduleKey]

    if (!loadedService) {
      throw new Error(`Static module ${moduleKey} could not be loaded.`)
    }

    services[moduleKey] = loadedService
  }

  return {
    container: sharedContainer,
    services,
  }
}

export function registerStaticRemoteQuery({
  container,
  modules,
  services,
}: RegisterStaticRemoteQueryOptions): void {
  const runtime = createPortableQueryRuntimeFromJoinerConfigs({
    joinerConfigs: modules.map(
      (module) => module.manifest.resources.joinerConfig
    ),
    services,
  })

  container.register({
    [ContainerRegistrationKeys.REMOTE_QUERY]: asValue(runtime.remoteQuery),
    [ContainerRegistrationKeys.QUERY]: asValue(runtime.query),
  })
}

function prepareStaticModuleContainer(
  container: MedusaContainer | undefined,
  logger: Logger
): MedusaContainer {
  const sharedContainer = container ?? createMedusaContainer()
  if (!sharedContainer.hasRegistration(ContainerRegistrationKeys.LOGGER)) {
    sharedContainer.register({
      [ContainerRegistrationKeys.LOGGER]: asValue(logger),
    })
  }

  return sharedContainer
}

function createInternalModuleDeclaration({
  moduleDeclaration,
  moduleOptions,
  persistenceAdapter,
}: {
  moduleDeclaration?: StaticModuleDeclarationOptions
  moduleOptions?: Record<string, unknown>
  persistenceAdapter: ModulePersistenceAdapter
}): InternalModuleDeclaration {
  return {
    scope: "internal",
    ...moduleDeclaration,
    options: {
      ...moduleOptions,
      persistenceAdapter,
    },
  }
}
