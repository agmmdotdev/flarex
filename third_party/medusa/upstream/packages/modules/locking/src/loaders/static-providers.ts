import { asFunction, asValue, Lifetime } from "@medusajs/deps/awilix"
import type {
  ILockingProvider,
  LoaderOptions,
  MedusaContainer,
  ModuleProvider,
  ModulesSdkTypes,
} from "@medusajs/framework/types"
import { InMemoryLockingProvider } from "../providers/in-memory"
import { LockingProviderService } from "../services"
import {
  LockingDefaultProvider,
  LockingIdentifiersRegistrationName,
  LockingModuleOptions,
  LockingProviderRegistrationPrefix,
} from "../types"

type LockingProviderConstructor = {
  new (
    cradle?: unknown,
    options?: Record<string, unknown>
  ): ILockingProvider
  identifier?: string
  validateOptions?: (
    options?: Record<string, unknown>
  ) => Promise<void> | void
}

type LockingProviderModule = {
  default?: LockingProviderModule
  services?: LockingProviderConstructor[]
}

async function registerStaticProvider(
  klass: LockingProviderConstructor,
  container: MedusaContainer,
  pluginOptions: {
    id: string
    options?: Record<string, unknown>
  }
): Promise<void> {
  const key = LockingProviderService.getRegistrationIdentifier(klass)
  await klass.validateOptions?.(pluginOptions.options)

  container.register({
    [LockingProviderRegistrationPrefix + pluginOptions.id]: asFunction(
      (cradle) => new klass(cradle, pluginOptions.options ?? {}),
      {
        lifetime: Lifetime.SINGLETON,
      }
    ),
  })

  container.registerAdd(LockingIdentifiersRegistrationName, asValue(key))
}

export default async function loadStaticProviders({
  container,
  options,
}: LoaderOptions<
  (
    | ModulesSdkTypes.ModuleServiceInitializeOptions
    | ModulesSdkTypes.ModuleServiceInitializeCustomDataLayerOptions
  ) &
    LockingModuleOptions
>): Promise<void> {
  container.registerAdd(LockingIdentifiersRegistrationName, asValue(undefined))

  container.register({
    [LockingProviderRegistrationPrefix + InMemoryLockingProvider.identifier]:
      asFunction(() => new InMemoryLockingProvider(), {
        lifetime: Lifetime.SINGLETON,
      }),
  })
  container.registerAdd(
    LockingIdentifiersRegistrationName,
    asValue(InMemoryLockingProvider.identifier)
  )
  container.register(
    LockingDefaultProvider,
    asValue(InMemoryLockingProvider.identifier)
  )

  const providers = options?.providers ?? []
  for (const provider of providers) {
    if (!provider.id) {
      throw new Error("Static Locking provider loading requires a provider id")
    }

    const loadedProvider = resolveStaticProvider(provider)
    if (!loadedProvider.services?.length) {
      throw new Error(
        "Static Locking provider must export at least one provider service"
      )
    }

    for (const service of loadedProvider.services) {
      await registerStaticProvider(service, container, {
        id: provider.id,
        options: provider.options,
      })
    }
  }

  const isSingleProvider = providers.length === 1
  for (const provider of providers) {
    if (provider.is_default || isSingleProvider) {
      container.register(LockingDefaultProvider, asValue(provider.id))
      return
    }
  }
}

function resolveStaticProvider(provider: ModuleProvider): LockingProviderModule {
  if (typeof provider.resolve === "string") {
    throw new Error(
      "Static Locking provider loading requires an imported provider export, not a filesystem path"
    )
  }

  const moduleExport = provider.resolve as LockingProviderModule
  return moduleExport.default ?? moduleExport
}
