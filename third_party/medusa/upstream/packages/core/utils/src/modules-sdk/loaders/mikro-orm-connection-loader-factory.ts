import {
  InternalModuleDeclaration,
  LoaderOptions,
  ModuleLoaderFunction,
  ModulePersistenceModel,
} from "@medusajs/types"
import { mikroOrmConnectionLoader } from "./mikro-orm-connection-loader"

/**
 * Factory for creating a MikroORM connection loader for the modules
 *
 * @param moduleName
 * @param moduleModels
 * @param migrationsPath
 */
export function mikroOrmConnectionLoaderFactory({
  moduleName,
  moduleModels,
  migrationsPath,
}: {
  moduleName: string
  moduleModels: ModulePersistenceModel[]
  migrationsPath?: string
}): ModuleLoaderFunction {
  return async function connectionLoader(
    { options, container, logger }: LoaderOptions,
    moduleDeclaration?: InternalModuleDeclaration
  ): Promise<void> {
    await mikroOrmConnectionLoader({
      moduleName,
      entities: moduleModels,
      container,
      options,
      moduleDeclaration,
      logger,
      pathToMigrations: migrationsPath ?? "",
    })
  }
}
