import { asFunction, asValue, Lifetime } from "@medusajs/deps/awilix"
import type {
  ICachingProviderService,
  LoaderOptions,
  MedusaContainer,
  ModuleProvider,
  ModulesSdkTypes,
} from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { CachingProviderService } from "../services"
import {
  CachingDefaultProvider,
  CachingIdentifiersRegistrationName,
  CachingModuleOptions,
  CachingProviderRegistrationPrefix,
} from "../types"
import { DefaultCacheStrategy } from "../utils/strategy"

type CachingProviderConstructor = {
  new (
    cradle: unknown,
    options?: Record<string, unknown>
  ): ICachingProviderService
  identifier?: string
  validateOptions?: (
    options?: Record<string, unknown>
  ) => Promise<void> | void
}

type CachingProviderModule = {
  default?: CachingProviderModule
  services?: CachingProviderConstructor[]
}

const registrationFn = async (
  klass: CachingProviderConstructor,
  container: MedusaContainer,
  pluginOptions: {
    id: string
    options?: Record<string, unknown>
  }
) => {
  const key = CachingProviderService.getRegistrationIdentifier(klass)

  container.register({
    [CachingProviderRegistrationPrefix + pluginOptions.id]: asFunction(
      (cradle) => new klass(cradle, pluginOptions.options ?? {}),
      {
        lifetime: Lifetime.SINGLETON,
      }
    ),
  })

  container.registerAdd(CachingIdentifiersRegistrationName, asValue(key))
}

export default async function loadStaticProviders({
  container,
  options,
}: LoaderOptions<
  (
    | ModulesSdkTypes.ModuleServiceInitializeOptions
    | ModulesSdkTypes.ModuleServiceInitializeCustomDataLayerOptions
  ) &
    CachingModuleOptions
>): Promise<void> {
  container.registerAdd(CachingIdentifiersRegistrationName, asValue(undefined))
  container.register("strategy", asValue(DefaultCacheStrategy))

  const providers = options?.providers ?? []
  for (const provider of providers) {
    if (!provider.id) {
      throw new Error("Static Caching provider loading requires a provider id")
    }

    const loadedProvider = resolveStaticProvider(provider)
    if (!loadedProvider.services?.length) {
      throw new Error(
        "Static Caching provider must export at least one provider service"
      )
    }

    for (const service of loadedProvider.services) {
      await service.validateOptions?.(provider.options)
      await registrationFn(service, container, {
        id: provider.id,
        options: provider.options,
      })
    }
  }

  const isSingleProvider = providers.length === 1
  for (const provider of providers) {
    if (provider.is_default || isSingleProvider) {
      container.register(CachingDefaultProvider, asValue(provider.id))
      return
    }
  }

  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  logger.error("[caching-module]: Static Caching requires a default provider.")
  throw new Error(
    "[caching-module]: Static Caching requires at least one imported provider."
  )
}

function resolveStaticProvider(provider: ModuleProvider): CachingProviderModule {
  if (typeof provider.resolve === "string") {
    throw new Error(
      "Static Caching provider loading requires an imported provider export, not a filesystem path"
    )
  }

  const moduleExport = provider.resolve as CachingProviderModule
  return moduleExport.default ?? moduleExport
}
