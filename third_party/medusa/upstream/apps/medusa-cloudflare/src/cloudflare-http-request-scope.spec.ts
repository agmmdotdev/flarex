import { asValue } from "@medusajs/deps/awilix"
import type { DrizzleMedusaManager } from "@medusajs/drizzle/medusa"
import type { ConfigModule } from "@medusajs/types"
import { ContainerRegistrationKeys } from "@medusajs/utils/common/container"
import { createMedusaContainer } from "@medusajs/utils/common/medusa-container"
import { describe, expect, it } from "vitest"
import { createMedusaCloudflareHttpModuleRuntimeSource } from "./cloudflare-http-module-runtime-source"
import { createMedusaCloudflareHttpRuntimeOptionsFromModuleRuntime } from "./cloudflare-http-options"
import { createMedusaCloudflareRequestScopeFactory } from "./cloudflare-http-request-scope"

describe("createMedusaCloudflareRequestScopeFactory", () => {
  it("creates isolated request scopes from a shared Medusa container", () => {
    const container = createMedusaContainer()
    container.register({
      runtimeValue: asValue("cloudflare-runtime"),
    })

    const createRequestScope =
      createMedusaCloudflareRequestScopeFactory(container)

    const firstScope = createRequestScope(
      new Request("https://worker.test/admin/plugins")
    )
    const secondScope = createRequestScope(
      new Request("https://worker.test/store/products")
    )

    expect(firstScope).not.toBe(container)
    expect(secondScope).not.toBe(container)
    expect(firstScope).not.toBe(secondScope)
    expect(firstScope.resolve<string>("runtimeValue")).toBe(
      "cloudflare-runtime"
    )
    expect(secondScope.resolve<string>("runtimeValue")).toBe(
      "cloudflare-runtime"
    )
    expect(
      firstScope.resolve<ConfigModule>(ContainerRegistrationKeys.CONFIG_MODULE)
        .projectConfig.http.authMethodsPerActor?.user
    ).toEqual(["emailpass"])
  })

  it("builds production HTTP options from a module runtime container", () => {
    const container = createMedusaContainer()
    container.register({
      runtimeValue: asValue("module-runtime"),
    })

    const options =
      createMedusaCloudflareHttpRuntimeOptionsFromModuleRuntime({
        runtime: { container },
      })

    if (!options.createRequestScope) {
      throw new Error("Production HTTP options did not include request scope")
    }

    const scope = options.createRequestScope(
      new Request("https://worker.test/admin/plugins")
    )

    expect(scope).not.toBe(container)
    expect(scope.resolve<string>("runtimeValue")).toBe("module-runtime")
  })

  it("lazily creates production HTTP options from a Worker module runtime source", async () => {
    const container = createMedusaContainer()
    container.register({
      runtimeValue: asValue("worker-module-runtime"),
    })
    const manager = createTestDrizzleManager()
    let createRuntimeCalls = 0

    const source = createMedusaCloudflareHttpModuleRuntimeSource({
      manager,
      createRuntime: async ({ manager: runtimeManager }) => {
        createRuntimeCalls += 1
        expect(runtimeManager).toBe(manager)

        return { container }
      },
    })

    const firstRuntime = await source.getRuntime()
    const secondRuntime = await source.getRuntime()
    const options = await source.getHttpRuntimeOptions()

    if (!options.createRequestScope) {
      throw new Error("Production HTTP options did not include request scope")
    }

    const scope = options.createRequestScope(
      new Request("https://worker.test/admin/plugins")
    )

    expect(firstRuntime).toBe(secondRuntime)
    expect(createRuntimeCalls).toBe(1)
    expect(scope).not.toBe(container)
    expect(scope.resolve<string>("runtimeValue")).toBe("worker-module-runtime")
  })
})

function createTestDrizzleManager(): DrizzleMedusaManager {
  const manager: DrizzleMedusaManager = {
    database: {} as DrizzleMedusaManager["database"],
    transactionMode: "statement",
    async transaction(task) {
      return await task(manager)
    },
    async destroy() {},
  }

  return manager
}
