import type {
  Context,
  ILockingModule,
  ILockingProvider,
  Logger,
} from "@medusajs/types"
import type { EntityManager } from "@medusajs/framework/mikro-orm/core"
import { LockingDefaultProvider, type LockingModuleOptions } from "../types"
import LockingProviderService from "./locking-provider"

type LockingProviderLifecycleHooks = {
  onApplicationPrepareShutdown?: (this: ILockingProvider) => Promise<void>
  onApplicationShutdown?: (this: ILockingProvider) => Promise<void>
}

type LockingProviderLifecycleHookName = keyof LockingProviderLifecycleHooks

function hasLifecycleHook(
  provider: ILockingProvider,
  hookName: LockingProviderLifecycleHookName
): provider is ILockingProvider & { __hooks: LockingProviderLifecycleHooks } {
  if (!("__hooks" in provider)) {
    return false
  }

  const hooks = provider.__hooks
  if (!hooks || typeof hooks !== "object") {
    return false
  }

  if (hookName === "onApplicationPrepareShutdown") {
    return (
      "onApplicationPrepareShutdown" in hooks &&
      typeof hooks.onApplicationPrepareShutdown === "function"
    )
  }

  return (
    "onApplicationShutdown" in hooks &&
    typeof hooks.onApplicationShutdown === "function"
  )
}

export async function runLockingProviderLifecycleHooks(
  providers: ILockingProvider[],
  hookName: LockingProviderLifecycleHookName
): Promise<void> {
  const pendingHooks: Promise<void>[] = []

  for (const provider of providers) {
    if (!hasLifecycleHook(provider, hookName)) {
      continue
    }

    const hook = provider.__hooks[hookName]
    if (hook) {
      pendingHooks.push(Promise.resolve().then(() => hook.call(provider)))
    }
  }

  const results = await Promise.allSettled(pendingHooks)
  const failures = results.flatMap((result) =>
    result.status === "rejected" ? [result.reason] : []
  )

  if (failures.length > 0) {
    throw new AggregateError(
      failures,
      `One or more Locking providers failed ${hookName}`
    )
  }
}

type InjectedDependencies = {
  manager: EntityManager
  lockingProviderService: LockingProviderService
  logger?: Logger
  [LockingDefaultProvider]: string
}

export default class LockingModuleService implements ILockingModule {
  protected manager: EntityManager
  protected providerService_: LockingProviderService
  protected defaultProviderId: string

  constructor(
    container: InjectedDependencies,
    protected readonly moduleOptions: LockingModuleOptions = {}
  ) {
    this.manager = container.manager
    this.providerService_ = container.lockingProviderService
    this.defaultProviderId = container[LockingDefaultProvider]
  }

  __hooks = {
    onApplicationPrepareShutdown: async (): Promise<void> => {
      await runLockingProviderLifecycleHooks(
        this.configuredProviders(),
        "onApplicationPrepareShutdown"
      )
    },
    onApplicationShutdown: async (): Promise<void> => {
      await runLockingProviderLifecycleHooks(
        this.configuredProviders(),
        "onApplicationShutdown"
      )
    },
  }

  private configuredProviders(): ILockingProvider[] {
    return (this.moduleOptions.providers ?? []).map(({ id }) =>
      this.providerService_.retrieveProviderRegistration(id)
    )
  }

  async execute<T>(
    keys: string | string[],
    job: () => Promise<T>,
    args?: {
      timeout?: number
      provider?: string
    },
    sharedContext: Context = {}
  ): Promise<T> {
    const providerId = args?.provider ?? this.defaultProviderId
    const provider =
      this.providerService_.retrieveProviderRegistration(providerId)

    return provider.execute(keys, job, args, sharedContext)
  }

  async acquire(
    keys: string | string[],
    args?: {
      ownerId?: string | null
      expire?: number
      provider?: string
    },
    sharedContext: Context = {}
  ): Promise<void> {
    const providerId = args?.provider ?? this.defaultProviderId
    const provider =
      this.providerService_.retrieveProviderRegistration(providerId)

    await provider.acquire(keys, args, sharedContext)
  }

  async release(
    keys: string | string[],
    args?: {
      ownerId?: string | null
      provider?: string
    },
    sharedContext: Context = {}
  ): Promise<boolean> {
    const providerId = args?.provider ?? this.defaultProviderId
    const provider =
      this.providerService_.retrieveProviderRegistration(providerId)

    return await provider.release(keys, args, sharedContext)
  }

  async releaseAll(
    args?: {
      ownerId?: string | null
      provider?: string
    },
    sharedContext: Context = {}
  ): Promise<void> {
    const providerId = args?.provider ?? this.defaultProviderId
    const provider =
      this.providerService_.retrieveProviderRegistration(providerId)

    return await provider.releaseAll(args, sharedContext)
  }
}
