import { asValue } from "@medusajs/deps/awilix"
import type {
  Logger,
  ModuleDefinition,
  ModuleExports,
  ModulePersistenceAdapter,
  StaticModuleResources,
} from "@medusajs/types"
import { ContainerRegistrationKeys } from "@medusajs/utils/common/container"
import { MedusaModule } from "../medusa-module"
import {
  loadStaticModule,
  loadStaticModules,
  type StaticModuleManifest,
} from "../static-app"
import { staticModuleLoader } from "../loaders/static-module-loader"
import { registerStaticMedusaModule } from "../loaders/static-module-registration"

class TestModuleService {}

class UnusedRepositoryService {
  async transaction(): Promise<never> {
    throw new Error("Unused test repository")
  }

  getFreshManager(): never {
    throw new Error("Unused test repository")
  }

  getActiveManager(): never {
    throw new Error("Unused test repository")
  }

  async serialize(): Promise<never> {
    throw new Error("Unused test repository")
  }

  async find(): Promise<never[]> {
    throw new Error("Unused test repository")
  }

  async findAndCount(): Promise<[never[], number]> {
    throw new Error("Unused test repository")
  }

  async create(): Promise<never[]> {
    throw new Error("Unused test repository")
  }

  async update(): Promise<never[]> {
    throw new Error("Unused test repository")
  }

  async delete(): Promise<string[]> {
    throw new Error("Unused test repository")
  }

  async softDelete(): Promise<[never[], Record<string, unknown[]>]> {
    throw new Error("Unused test repository")
  }

  async restore(): Promise<[never[], Record<string, unknown[]>]> {
    throw new Error("Unused test repository")
  }

  async upsert(): Promise<never[]> {
    throw new Error("Unused test repository")
  }

  async upsertWithReplace(): Promise<never> {
    throw new Error("Unused test repository")
  }
}

const moduleDefinition: ModuleDefinition = {
  key: "testModule",
  defaultPackage: false,
  label: "Test Module",
  defaultModuleDeclaration: {
    scope: "internal",
  },
}

const secondModuleDefinition: ModuleDefinition = {
  key: "secondModule",
  defaultPackage: false,
  label: "Second Module",
  defaultModuleDeclaration: {
    scope: "internal",
  },
}

const moduleExports: ModuleExports<typeof TestModuleService> = {
  service: TestModuleService,
}

const resources: StaticModuleResources = {
  models: [],
  services: [],
  repositories: [],
  loaders: [],
  moduleService: TestModuleService,
}

const manifest: StaticModuleManifest = {
  moduleDefinition,
  moduleExports,
  resources,
}

const secondManifest: StaticModuleManifest = {
  moduleDefinition: secondModuleDefinition,
  moduleExports,
  resources,
}

const persistenceAdapter: ModulePersistenceAdapter = {
  name: "test",
  prepareModels: (models) => models,
  createConnectionLoader: () => async () => {},
  createBaseRepository: () => UnusedRepositoryService,
  createRepository: () => UnusedRepositoryService,
}

const logger: Logger = {
  panic: jest.fn(),
  shouldLog: () => true,
  setLogLevel: jest.fn(),
  unsetLogLevel: jest.fn(),
  activity: (message) => message,
  progress: jest.fn(),
  error: jest.fn(),
  failure: (_, message) => message,
  success: (_, message) => ({ message }),
  silly: jest.fn(),
  debug: jest.fn(),
  verbose: jest.fn(),
  http: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  log: jest.fn(),
}

describe("loadStaticModule", () => {
  afterEach(() => {
    MedusaModule.clearInstances()
    MedusaModule.setDefaultInfrastructure({
      moduleLoader: staticModuleLoader,
      moduleRegistration: registerStaticMedusaModule,
    })
    jest.clearAllMocks()
  })

  it("loads a static manifest through MedusaModule and shared container setup", async () => {
    const loadedService = { id: "loaded-service" }
    const moduleRegistration = jest.fn(registerStaticMedusaModule)
    const moduleLoader = jest.fn(
      async ({
        container,
      }: Parameters<typeof staticModuleLoader>[0]): Promise<void> => {
        container.register({
          [moduleDefinition.key]: asValue(loadedService),
        })
      }
    )

    MedusaModule.setDefaultInfrastructure({
      moduleLoader,
      moduleRegistration,
    })

    const loaded = await loadStaticModule<typeof loadedService>({
      logger,
      manifest,
      moduleDeclaration: {
        alias: "testAlias",
      },
      moduleOptions: {
        manager: "test-manager",
      },
      persistenceAdapter,
    })

    expect(loaded.service).toBe(loadedService)
    expect(loaded.container.resolve(moduleDefinition.key)).toBe(loadedService)
    expect(loaded.container.resolve(ContainerRegistrationKeys.LOGGER)).toBe(
      logger
    )
    expect(moduleRegistration).toHaveBeenCalledWith(
      expect.objectContaining({
        definition: moduleDefinition,
        moduleExports,
        moduleKey: moduleDefinition.key,
        resources,
      })
    )
    expect(moduleRegistration).toHaveBeenCalledWith(
      expect.objectContaining({
        moduleDeclaration: expect.objectContaining({
          alias: "testAlias",
          options: {
            manager: "test-manager",
            persistenceAdapter,
          },
          scope: "internal",
        }),
      })
    )
    expect(moduleLoader).toHaveBeenCalledWith(
      expect.objectContaining({
        persistenceAdapter,
      })
    )
  })

  it("loads multiple static manifests through one shared container", async () => {
    const firstService = { id: "first-service" }
    const secondService = { id: "second-service" }
    const servicesByModuleKey: Record<string, object> = {
      [moduleDefinition.key]: firstService,
      [secondModuleDefinition.key]: secondService,
    }
    const moduleRegistration = jest.fn(registerStaticMedusaModule)
    const moduleLoader = jest.fn(
      async ({
        container,
        moduleResolutions,
      }: Parameters<typeof staticModuleLoader>[0]): Promise<void> => {
        const [moduleKey] = Object.keys(moduleResolutions)
        container.register({
          [moduleKey]: asValue(servicesByModuleKey[moduleKey]),
        })
      }
    )

    MedusaModule.setDefaultInfrastructure({
      moduleLoader,
      moduleRegistration,
    })

    const loaded = await loadStaticModules({
      logger,
      modules: [
        {
          manifest,
          moduleOptions: {
            manager: "first-manager",
          },
        },
        {
          manifest: secondManifest,
          moduleDeclaration: {
            dependencies: [moduleDefinition.key],
          },
          moduleOptions: {
            manager: "second-manager",
          },
        },
      ],
      persistenceAdapter,
    })

    expect(loaded.services).toEqual({
      [moduleDefinition.key]: firstService,
      [secondModuleDefinition.key]: secondService,
    })
    expect(loaded.container.resolve(moduleDefinition.key)).toBe(firstService)
    expect(loaded.container.resolve(secondModuleDefinition.key)).toBe(
      secondService
    )
    expect(loaded.container.resolve(ContainerRegistrationKeys.LOGGER)).toBe(
      logger
    )
    expect(moduleLoader).toHaveBeenCalledTimes(2)
    expect(moduleRegistration).toHaveBeenCalledWith(
      expect.objectContaining({
        definition: moduleDefinition,
        moduleKey: moduleDefinition.key,
      })
    )
    expect(moduleRegistration).toHaveBeenCalledWith(
      expect.objectContaining({
        definition: secondModuleDefinition,
        moduleDeclaration: expect.objectContaining({
          dependencies: [moduleDefinition.key],
          options: {
            manager: "second-manager",
            persistenceAdapter,
          },
        }),
        moduleKey: secondModuleDefinition.key,
      })
    )
  })
})
