import { asFunction, asValue, Lifetime } from "@medusajs/deps/awilix"
import type {
  LoaderOptions,
  MedusaContainer,
  ModuleProvider,
  ModulesSdkTypes,
  NotificationTypes,
} from "@medusajs/framework/types"
import {
  ContainerRegistrationKeys,
  lowerCaseFirst,
  promiseAll,
} from "@medusajs/framework/utils"
import { NotificationProvider } from "../models"
import { NotificationProviderService } from "../services"
import {
  NotificationIdentifiersRegistrationName,
  NotificationModuleOptions,
  NotificationProviderRegistrationPrefix,
} from "../types"

type NotificationProviderConstructor = {
  new (
    cradle: unknown,
    options?: Record<string, unknown>
  ): NotificationTypes.INotificationProvider
  validateOptions?: (
    options?: Record<string, unknown>
  ) => Promise<void> | void
}

type NotificationProviderModule = {
  default?: NotificationProviderModule
  services?: NotificationProviderConstructor[]
}

const registrationFn = async (
  klass: NotificationProviderConstructor,
  container: MedusaContainer,
  pluginOptions: {
    id: string
    options?: Record<string, unknown>
  }
) => {
  container.register({
    [NotificationProviderRegistrationPrefix + pluginOptions.id]: asFunction(
      (cradle) => new klass(cradle, pluginOptions.options ?? {}),
      {
        lifetime: Lifetime.SINGLETON,
      }
    ),
  })

  container.registerAdd(
    NotificationIdentifiersRegistrationName,
    asValue(pluginOptions.id)
  )
}

export default async function loadStaticProviders({
  container,
  options,
}: LoaderOptions<
  (
    | ModulesSdkTypes.ModuleServiceInitializeOptions
    | ModulesSdkTypes.ModuleServiceInitializeCustomDataLayerOptions
  ) &
    NotificationModuleOptions
>): Promise<void> {
  const providers = options?.providers ?? []

  for (const provider of providers) {
    if (!provider.id) {
      throw new Error(
        "Static Notification provider loading requires a provider id"
      )
    }

    const loadedProvider = resolveStaticProvider(provider)
    if (!loadedProvider.services?.length) {
      throw new Error(
        "Static Notification provider must export at least one provider service"
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

  await syncDatabaseProviders({ container, providers })
}

function resolveStaticProvider(
  provider: ModuleProvider
): NotificationProviderModule {
  if (typeof provider.resolve === "string") {
    throw new Error(
      "Static Notification provider loading requires an imported provider export, not a filesystem path"
    )
  }

  const moduleExport = provider.resolve as NotificationProviderModule
  return moduleExport.default ?? moduleExport
}

async function syncDatabaseProviders({
  container,
  providers,
}: {
  container: MedusaContainer
  providers: Exclude<NotificationModuleOptions["providers"], undefined>
}) {
  const providerServiceRegistrationKey = lowerCaseFirst(
    NotificationProviderService.name
  )
  const providerService = container.resolve<
    ModulesSdkTypes.IMedusaInternalService<typeof NotificationProvider>
  >(providerServiceRegistrationKey)

  const logger = container.resolve(ContainerRegistrationKeys.LOGGER) ?? console
  const normalizedProviders = providers.map((provider) => {
    if (!provider.id) {
      throw new Error(
        "An entry in the provider config is required to initialize notification providers"
      )
    }

    return {
      id: provider.id,
      handle: provider.id,
      name: provider.id,
      is_enabled: true,
      channels: provider.options?.channels ?? [],
    }
  })

  validateProviders(normalizedProviders)

  try {
    const providersInDb = await providerService.list({})
    const providersToDisable = providersInDb.filter(
      (dbProvider) =>
        !normalizedProviders.some(
          (normalizedProvider) => normalizedProvider.id === dbProvider.id
        )
    )

    const promises: Promise<unknown>[] = []

    if (normalizedProviders.length) {
      promises.push(providerService.upsert(normalizedProviders))
    }

    if (providersToDisable.length) {
      promises.push(
        providerService.update(
          providersToDisable.map((provider) => ({
            id: provider.id,
            is_enabled: false,
          }))
        )
      )
    }

    await promiseAll(promises)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logger.error(`Error syncing the notification providers: ${message}`)
  }
}

function validateProviders(providers: { channels: string[] }[]) {
  const hasForChannel: Record<string, true> = {}
  providers.forEach((provider) => {
    provider.channels.forEach((channel) => {
      if (hasForChannel[channel]) {
        throw new Error(
          `Multiple providers are configured for the same channel: ${channel}`
        )
      }
      hasForChannel[channel] = true
    })
  })
}
