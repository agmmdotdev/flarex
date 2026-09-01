import { asFunction, asValue, Lifetime } from "@medusajs/deps/awilix"
import type { LifetimeType } from "@medusajs/deps/awilix"
import type {
  Constructor,
  IAnalyticsProvider,
  LoaderOptions,
  MedusaContainer,
  ModuleProvider,
  ModulesSdkTypes,
} from "@medusajs/framework/types"
import ProviderService, {
  AnalyticsProviderIdentifierRegistrationName,
  AnalyticsProviderRegistrationPrefix,
} from "../services/provider-service"

type AnalyticsProviderConstructor = Constructor<IAnalyticsProvider> & {
  LIFE_TIME?: LifetimeType
  identifier?: string
  validateOptions?: (
    options?: Record<string, unknown>
  ) => Promise<void> | void
}

type AnalyticsProviderModule = {
  default?: AnalyticsProviderModule
  services?: AnalyticsProviderConstructor[]
}

const registrationFn = async (
  klass: AnalyticsProviderConstructor,
  container: MedusaContainer,
  pluginOptions: {
    id?: string
    options?: Record<string, unknown>
  }
) => {
  const key = ProviderService.getRegistrationIdentifier(klass, pluginOptions.id)

  container.register({
    [AnalyticsProviderRegistrationPrefix + key]: asFunction(
      (cradle) => new klass(cradle, pluginOptions.options ?? {}),
      {
        lifetime: klass.LIFE_TIME || Lifetime.SINGLETON,
      }
    ),
  })

  container.registerAdd(
    AnalyticsProviderIdentifierRegistrationName,
    asValue(key)
  )
}

export default async function loadStaticProviders({
  container,
  options,
}: LoaderOptions<
  (
    | ModulesSdkTypes.ModuleServiceInitializeOptions
    | ModulesSdkTypes.ModuleServiceInitializeCustomDataLayerOptions
  ) & { providers?: ModuleProvider[] }
>): Promise<void> {
  for (const provider of options?.providers ?? []) {
    const loadedProvider = resolveStaticProvider(provider)
    if (!loadedProvider.services?.length) {
      throw new Error(
        "Static Analytics provider must export at least one provider service"
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
}

function resolveStaticProvider(
  provider: ModuleProvider
): AnalyticsProviderModule {
  if (typeof provider.resolve === "string") {
    throw new Error(
      "Static Analytics provider loading requires an imported provider export, not a filesystem path"
    )
  }

  const moduleExport = provider.resolve as AnalyticsProviderModule
  return moduleExport.default ?? moduleExport
}
