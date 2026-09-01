import { dynamicImport } from "@medusajs/utils"
import { mikroOrmModulePersistenceAdapter } from "@medusajs/utils/modules-sdk/persistence/mikro-orm"
import { resolveResources } from "./utils/load-resources"
import { staticModuleLoader } from "./static-module-loader"

export async function moduleLoader(
  options: Parameters<typeof staticModuleLoader>[0]
) {
  return await staticModuleLoader({
    ...options,
    moduleExportsLoader: options.moduleExportsLoader ?? dynamicImport,
    persistenceAdapter:
      options.persistenceAdapter ?? mikroOrmModulePersistenceAdapter,
    resourceLoader: options.resourceLoader ?? resolveResources,
  })
}
