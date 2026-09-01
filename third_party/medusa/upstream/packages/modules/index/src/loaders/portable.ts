import { asClass, asValue } from "@medusajs/framework/awilix"
import type {
  Constructor,
  IndexTypes,
  LoaderOptions,
} from "@medusajs/framework/types"
import { IndexModuleService } from "../services"
import type {
  IndexBaseRepository,
  IndexResetHandler,
} from "../services/index-module-service"

type IndexStorageProviderAdapter = {
  constructor: Constructor<IndexTypes.StorageProvider>
  options?: unknown
}

export type PortableIndexLoaderOptions = {
  storageProvider?: IndexStorageProviderAdapter
  customAdapter?: IndexStorageProviderAdapter
  storageProviderCtr?: Constructor<IndexTypes.StorageProvider>
  storageProviderCtrOptions?: unknown
  baseRepository?: IndexBaseRepository
  indexResetHandler?: IndexResetHandler
}

class UnsupportedIndexBaseRepository implements IndexBaseRepository {
  async transaction<TResult>(): Promise<TResult> {
    throw new Error(
      "Index server-mode transactions require a base repository for the selected storage provider"
    )
  }
}

function resolveStorageProvider(
  options?: PortableIndexLoaderOptions
): IndexStorageProviderAdapter {
  if (options?.storageProvider) {
    return options.storageProvider
  }

  if (options?.customAdapter) {
    return options.customAdapter
  }

  if (options?.storageProviderCtr) {
    return {
      constructor: options.storageProviderCtr,
      options: options.storageProviderCtrOptions,
    }
  }

  throw new Error(
    "Portable Index loader requires an explicit storage provider adapter"
  )
}

export default async ({
  container,
  options,
}: LoaderOptions<PortableIndexLoaderOptions>): Promise<void> => {
  const storageProvider = resolveStorageProvider(options)

  container.register({
    baseRepository: options?.baseRepository
      ? asValue(options.baseRepository)
      : asClass(UnsupportedIndexBaseRepository).singleton(),
    searchModuleService: asClass(IndexModuleService).singleton(),
    storageProviderCtr: asValue(storageProvider.constructor),
    storageProviderCtrOptions: asValue(storageProvider.options),
  })

  if (options?.indexResetHandler) {
    container.register("indexResetHandler", asValue(options.indexResetHandler))
  }
}
