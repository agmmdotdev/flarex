import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import TestService from "../__fixtures__/test-module/service"
import InternalService from "../__fixtures__/test-module/services/internal"
import { runApplicationShutdownHooks } from "../init-modules"
import { mikroOrmModuleTestPersistenceAdapter } from "../module-test-persistence-adapter"
import { moduleIntegrationTestRunner } from "../module-test-runner"

const selectedPersistenceAdapter = {
  ...mikroOrmModuleTestPersistenceAdapter,
  name: "selected-mikroorm",
}

describe("application shutdown lifecycle", () => {
  it("finishes prepare-shutdown before starting shutdown", async () => {
    const events: string[] = []

    await runApplicationShutdownHooks({
      async onApplicationPrepareShutdown(): Promise<void> {
        events.push("prepare:start")
        await Promise.resolve()
        events.push("prepare:end")
      },
      async onApplicationShutdown(): Promise<void> {
        events.push("shutdown")
      },
    })

    expect(events).toEqual(["prepare:start", "prepare:end", "shutdown"])
  })

  it("attempts shutdown after prepare-shutdown fails", async () => {
    const events: string[] = []

    await expect(
      runApplicationShutdownHooks({
        async onApplicationPrepareShutdown(): Promise<void> {
          events.push("prepare")
          throw new Error("prepare failed")
        },
        async onApplicationShutdown(): Promise<void> {
          events.push("shutdown")
        },
      })
    ).rejects.toThrow("Application shutdown hooks failed")

    expect(events).toEqual(["prepare", "shutdown"])
  })
})

moduleIntegrationTestRunner<TestService>({
  moduleName: "test",
  resolve: "./__fixtures__/test-module",
  persistenceAdapter: selectedPersistenceAdapter,
  moduleOptions: {
    option1: "value1",
  },
  testSuite: ({ database, MikroOrmWrapper, persistenceAdapter, service }) => {
    describe("Module Test Runner", () => {
      it("should expose the selected persistence adapter", () => {
        expect(persistenceAdapter.name).toBe("selected-mikroorm")
        expect(database).toBe(MikroOrmWrapper)
      })

      it("should inject all basic dependencies on the main service", async () => {
        const dependencies = await service.getDependencies()
        expect(dependencies[ContainerRegistrationKeys.LOGGER]).toBeDefined()
        expect(
          dependencies[ContainerRegistrationKeys.PG_CONNECTION]
        ).toBeDefined()
        expect(dependencies[Modules.EVENT_BUS]).toBeDefined()
        expect(dependencies["baseRepository"]).toBeDefined()

        const configModule =
          dependencies[ContainerRegistrationKeys.CONFIG_MODULE]
        expect(configModule).toBeDefined()
        expect(configModule.modules["test"]?.options?.option1).toBe("value1")
      })

      it("should inject internal services on the main service", async () => {
        const dependencies = await service.getDependencies()
        expect(dependencies["internalService"]).toBeInstanceOf(InternalService)
      })

      it("should inject basic dependencies on internal services", async () => {
        const internalService = (await service.getDependencies())[
          "internalService"
        ]

        if (!(internalService instanceof InternalService)) {
          throw new Error("Expected the internal service to be injected")
        }

        const dependencies = await internalService.getDependencies()
        expect(dependencies[ContainerRegistrationKeys.LOGGER]).toBeDefined()
        expect(
          dependencies[ContainerRegistrationKeys.PG_CONNECTION]
        ).toBeDefined()
        expect(dependencies[Modules.EVENT_BUS]).toBeDefined()
        expect(dependencies["baseRepository"]).toBeDefined()

        const configModule =
          dependencies[ContainerRegistrationKeys.CONFIG_MODULE]
        expect(configModule).toBeDefined()
        expect(configModule.modules["test"]?.options?.option1).toBe("value1")
      })
    })
  },
})
