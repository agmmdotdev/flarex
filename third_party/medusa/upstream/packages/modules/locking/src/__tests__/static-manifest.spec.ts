import type { ILockingProvider } from "@medusajs/types"
import LockingModule from "../index"
import {
  lockingModuleDefinition,
  lockingModuleExports,
  lockingStaticResources,
} from "../static-manifest"
import loadStaticProviders from "../loaders/static-providers"
import LockingModuleService, {
  runLockingProviderLifecycleHooks,
} from "../services/locking-module"
import LockingProviderService from "../services/locking-provider"

type LifecycleTestProvider = ILockingProvider & {
  id: string
  __hooks: {
    onApplicationPrepareShutdown?: (
      this: LifecycleTestProvider
    ) => Promise<void>
    onApplicationShutdown(this: LifecycleTestProvider): Promise<void>
  }
}

function lifecycleTestProvider(
  id: string,
  hook: (this: LifecycleTestProvider) => Promise<void>
): LifecycleTestProvider {
  return {
    id,
    __hooks: {
      onApplicationPrepareShutdown: undefined,
      onApplicationShutdown: hook,
    },
    async execute<T>(
      _keys: string | string[],
      job: () => Promise<T>
    ): Promise<T> {
      return await job()
    },
    async acquire(): Promise<void> {},
    async release(): Promise<boolean> {
      return true
    },
    async releaseAll(): Promise<void> {},
  }
}

describe("locking static manifest", () => {
  it("matches the module service and explicit static resources", () => {
    expect(lockingModuleDefinition.key).toBe("locking")
    expect(lockingModuleExports.service).toBe(LockingModule.service)
    expect(lockingStaticResources.moduleService).toBe(LockingModuleService)
    expect(lockingStaticResources.services).toEqual([LockingProviderService])
    expect(lockingStaticResources.loaders).toEqual([loadStaticProviders])
    expect(lockingStaticResources.models).toEqual([])
    expect(lockingStaticResources.repositories).toEqual([])
  })
})

describe("locking provider lifecycle", () => {
  it("binds each provider and attempts every hook before aggregating failures", async () => {
    const events: string[] = []
    const failingProvider = lifecycleTestProvider(
      "failing",
      async function (): Promise<void> {
        events.push(this.id)
        throw new Error("first provider failed")
      }
    )
    const succeedingProvider = lifecycleTestProvider(
      "succeeding",
      async function (): Promise<void> {
        events.push(this.id)
      }
    )

    await expect(
      runLockingProviderLifecycleHooks(
        [failingProvider, succeedingProvider],
        "onApplicationShutdown"
      )
    ).rejects.toThrow(
      "One or more Locking providers failed onApplicationShutdown"
    )
    expect(events).toEqual(["failing", "succeeding"])
  })
})
