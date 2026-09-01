import { moduleProviderLoader } from "@medusajs/framework/modules-sdk"
import type {
  Constructor,
  IAnalyticsProvider,
  LoaderOptions,
  MedusaContainer,
  ModuleProvider,
  ModulesSdkTypes,
} from "@medusajs/framework/types"
import { asFunction, asValue, Lifetime } from "@medusajs/framework/awilix"
import type { LifetimeType } from "@medusajs/framework/awilix"
import ProviderService, {
  AnalyticsProviderIdentifierRegistrationName,
  AnalyticsProviderRegistrationPrefix,
} from "../services/provider-service"

type AnalyticsProviderConstructor = Constructor<IAnalyticsProvider> & {
  LIFE_TIME?: LifetimeType
  identifier?: string
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

export default async ({
  container,
  options,
}: LoaderOptions<
  (
    | ModulesSdkTypes.ModuleServiceInitializeOptions
    | ModulesSdkTypes.ModuleServiceInitializeCustomDataLayerOptions
  ) & { providers: ModuleProvider[] }
>): Promise<void> => {
  await moduleProviderLoader({
    container,
    providers: options?.providers || [],
    registerServiceFn: registrationFn,
  })
}
