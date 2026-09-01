import { asFunction, asValue, Lifetime } from "@medusajs/deps/awilix"
import type {
  FileTypes,
  LoaderOptions,
  MedusaContainer,
  ModuleProvider,
  ModulesSdkTypes,
} from "@medusajs/framework/types"
import { FileProviderService } from "../services"
import {
  FileProviderIdentifierRegistrationName,
  FileProviderRegistrationPrefix,
} from "../types"

type FileProviderConstructor = {
  new (
    cradle: unknown,
    options?: Record<string, unknown>
  ): FileTypes.IFileProvider
  identifier?: string
  validateOptions?: (
    options?: Record<string, unknown>
  ) => Promise<void> | void
}

type FileProviderModule = {
  default?: FileProviderModule
  services?: FileProviderConstructor[]
}

const registrationFn = async (
  klass: FileProviderConstructor,
  container: MedusaContainer,
  pluginOptions: {
    id: string
    options?: Record<string, unknown>
  }
) => {
  const key = FileProviderService.getRegistrationIdentifier(
    klass,
    pluginOptions.id
  )

  container.register({
    [FileProviderRegistrationPrefix + key]: asFunction(
      (cradle) => new klass(cradle, pluginOptions.options ?? {}),
      {
        lifetime: Lifetime.SINGLETON,
      }
    ),
  })

  container.registerAdd(FileProviderIdentifierRegistrationName, asValue(key))
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
    if (!provider.id) {
      throw new Error("Static File provider loading requires a provider id")
    }

    if (!loadedProvider.services?.length) {
      throw new Error(
        "Static File provider must export at least one provider service"
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

function resolveStaticProvider(provider: ModuleProvider): FileProviderModule {
  if (typeof provider.resolve === "string") {
    throw new Error(
      "Static File provider loading requires an imported provider export, not a filesystem path"
    )
  }

  const moduleExport = provider.resolve as FileProviderModule
  return moduleExport.default ?? moduleExport
}
