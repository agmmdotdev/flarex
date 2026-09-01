import {
  drizzleModulePersistenceAdapter,
  type DrizzleMedusaManager,
} from "@medusajs/drizzle/medusa"
import {
  loadStaticModule,
  type StaticModuleManifest,
} from "@medusajs/modules-sdk/static-app"

export interface StaticModuleRuntime<Service> {
  service: Service
  transactionMode: DrizzleMedusaManager["transactionMode"]
}

interface CreateStaticModuleRuntimeOptions {
  manifest: StaticModuleManifest
  manager: DrizzleMedusaManager
}

export async function createStaticModuleRuntime<Service>({
  manifest,
  manager,
}: CreateStaticModuleRuntimeOptions): Promise<StaticModuleRuntime<Service>> {
  const persistenceAdapter = drizzleModulePersistenceAdapter

  const loaded = await loadStaticModule<Service>({
    manifest,
    moduleOptions: {
      manager,
    },
    persistenceAdapter,
  })

  return {
    service: loaded.service,
    transactionMode: manager.transactionMode,
  }
}
