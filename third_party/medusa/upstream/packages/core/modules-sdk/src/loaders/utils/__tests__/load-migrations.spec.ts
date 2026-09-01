import type {
  ModuleExports,
  ModuleMigrationAdapter,
  ModulePersistenceAdapter,
  ModuleResolution,
} from "@medusajs/types"
import { createMedusaContainer } from "@medusajs/utils"
import { loadModuleMigrations } from "../load-migrations"
import { resolveResources } from "../load-resources"

jest.mock("../load-resources", () => ({
  resolveResources: jest.fn(),
}))

class TestModuleService {}

const moduleExports: ModuleExports = {
  service: TestModuleService,
}

const persistenceAdapter: ModulePersistenceAdapter = {
  name: "test-persistence",
  prepareModels: (models) => models,
  createConnectionLoader: jest.fn(),
  createBaseRepository: jest.fn(),
  createRepository: jest.fn(),
}

describe("loadModuleMigrations", () => {
  test("uses the migration adapter selected by module composition", async () => {
    const runMigrations = jest.fn(async () => [
      { name: "0001-test", path: "test/migrations" },
    ])
    const createMigrationScripts = jest.fn(() => ({ runMigrations }))
    const migrationAdapter: ModuleMigrationAdapter = {
      name: "test-migrations",
      createMigrationScripts,
    }
    const resolution: ModuleResolution = {
      resolutionPath: "test-module",
      moduleExports,
      resources: {
        services: [],
        models: [{ name: "StaticTestModel" }],
        repositories: [],
        loaders: [],
        moduleService: TestModuleService,
        migrationPath: "static/migrations",
      },
      definition: {
        key: "test-module",
        label: "Test module",
        defaultPackage: false,
        defaultModuleDeclaration: {
          scope: "internal",
        },
      },
      options: {
        persistenceAdapter,
        migrationAdapter,
      },
    }
    const models = [{ name: "StaticTestModel" }]
    jest.mocked(resolveResources).mockResolvedValue({
      services: [],
      models,
      repositories: [],
      loaders: [],
      moduleService: TestModuleService,
      migrationPath: "unused/filesystem/migrations",
    })

    const scripts = await loadModuleMigrations(
      createMedusaContainer(),
      resolution,
      moduleExports
    )
    const result = await scripts.runMigrations?.({
      container: createMedusaContainer(),
    })

    expect(createMigrationScripts).toHaveBeenCalledWith({
      moduleName: "test-module",
      models,
      pathToMigrations: "static/migrations",
    })
    expect(resolveResources).not.toHaveBeenCalled()
    expect(runMigrations).toHaveBeenCalledTimes(1)
    expect(result).toEqual([{ name: "0001-test", path: "test/migrations" }])
  })
})
