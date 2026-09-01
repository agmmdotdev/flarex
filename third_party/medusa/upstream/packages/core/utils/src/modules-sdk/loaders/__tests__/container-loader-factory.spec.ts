import { asValue } from "@medusajs/deps/awilix"
import { ModulePersistenceAdapter } from "@medusajs/types"
import { createMedusaContainer } from "../../../common"
import { ContainerRegistrationKeys } from "../../../common/container"
import { MikroOrmBaseRepository } from "../../../dal"
import { moduleContainerLoaderFactory } from "../container-loader-factory"

class SelectedBaseRepository extends MikroOrmBaseRepository {}
class SelectedModelRepository extends MikroOrmBaseRepository {}
class ModuleModelRepository extends MikroOrmBaseRepository {}
class AdapterModelRepository extends MikroOrmBaseRepository {}
class ModuleNamedRepository extends MikroOrmBaseRepository {}
class AdapterNamedRepository extends MikroOrmBaseRepository {}

describe("moduleContainerLoaderFactory", () => {
  it("fails when shared infrastructure is not given a persistence adapter", async () => {
    const loader = moduleContainerLoaderFactory({
      moduleModels: {
        TestModel: { name: "TestModel" },
      },
      moduleServices: {},
    })

    await expect(
      loader({
        container: createMedusaContainer(),
      })
    ).rejects.toThrow(
      "A persistence adapter is required to load module repositories"
    )
  })

  it("registers default repositories from the selected persistence adapter", async () => {
    const createBaseRepository = jest.fn(() => SelectedBaseRepository)
    const createRepository = jest.fn(() => SelectedModelRepository)
    const persistenceAdapter: ModulePersistenceAdapter = {
      name: "selected",
      prepareModels: jest.fn((models) => models),
      createConnectionLoader: jest.fn(),
      createBaseRepository,
      createRepository,
    }
    const container = createMedusaContainer()

    container.register({
      manager: asValue({}),
    })

    const loader = moduleContainerLoaderFactory({
      moduleModels: {
        TestModel: { name: "TestModel" },
      },
      moduleServices: {},
    })

    await loader({
      container,
      options: {
        persistenceAdapter,
      },
    })

    expect(createBaseRepository).toHaveBeenCalledTimes(1)
    expect(createRepository).toHaveBeenCalledWith({ name: "TestModel" })
    expect(container.resolve("baseRepository")).toBeInstanceOf(
      SelectedBaseRepository
    )
    expect(container.resolve("testModelRepository")).toBeInstanceOf(
      SelectedModelRepository
    )
    expect(
      container.resolve(ContainerRegistrationKeys.MODULE_PERSISTENCE_ADAPTER)
    ).toBe(persistenceAdapter)
  })

  it("lets the selected persistence adapter replace module repositories", async () => {
    const createBaseRepository = jest.fn(() => SelectedBaseRepository)
    const createRepository = jest.fn(() => SelectedModelRepository)
    const createCustomRepository = jest.fn(() => AdapterModelRepository)
    const persistenceAdapter: ModulePersistenceAdapter = {
      name: "selected",
      prepareModels: jest.fn((models) => models),
      createConnectionLoader: jest.fn(),
      createBaseRepository,
      createRepository,
      createCustomRepository,
    }
    const model = { name: "TestModel" }
    const container = createMedusaContainer()

    container.register({
      manager: asValue({}),
    })

    const loader = moduleContainerLoaderFactory({
      moduleModels: {
        TestModel: model,
      },
      moduleRepositories: {
        TestModelRepository: ModuleModelRepository,
      },
      moduleServices: {},
    })

    await loader({
      container,
      options: {
        persistenceAdapter,
      },
    })

    expect(createRepository).not.toHaveBeenCalled()
    expect(createCustomRepository).toHaveBeenCalledWith({
      model,
      repository: ModuleModelRepository,
    })
    expect(container.resolve("testModelRepository")).toBeInstanceOf(
      AdapterModelRepository
    )
  })

  it("lets the selected persistence adapter replace named module repositories", async () => {
    const createBaseRepository = jest.fn(() => SelectedBaseRepository)
    const createRepository = jest.fn(() => SelectedModelRepository)
    const createCustomRepository = jest.fn(({ repositoryName }) =>
      repositoryName === "namedRepository" ? AdapterNamedRepository : undefined
    )
    const persistenceAdapter: ModulePersistenceAdapter = {
      name: "selected",
      prepareModels: jest.fn((models) => models),
      createConnectionLoader: jest.fn(),
      createBaseRepository,
      createRepository,
      createCustomRepository,
    }
    const model = { name: "TestModel" }
    const container = createMedusaContainer()

    container.register({
      manager: asValue({}),
    })

    const loader = moduleContainerLoaderFactory({
      moduleModels: {
        TestModel: model,
      },
      moduleRepositories: {
        NamedRepository: ModuleNamedRepository,
      },
      moduleServices: {},
    })

    await loader({
      container,
      options: {
        persistenceAdapter,
      },
    })

    expect(createRepository).toHaveBeenCalledWith(model)
    expect(createCustomRepository).toHaveBeenCalledWith({
      repositoryName: "namedRepository",
      moduleModels: {
        TestModel: model,
      },
      repository: ModuleNamedRepository,
    })
    expect(container.resolve("namedRepository")).toBeInstanceOf(
      AdapterNamedRepository
    )
  })
})
