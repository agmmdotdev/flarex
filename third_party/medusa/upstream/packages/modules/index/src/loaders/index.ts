import { asClass, asValue } from "@medusajs/framework/awilix"
import { PostgresProvider } from "../services/postgres-provider"
import { MikroOrmBaseRepository as BaseRepository } from "@medusajs/framework/utils"
import { IndexModuleService } from "../services"
import { LoaderOptions } from "@medusajs/framework/types"
import { PostgresIndexResetHandler } from "../services/postgres-index-reset-handler"
import { gqlSchemaToTypes } from "../utils/gql-to-types"
import { Configuration } from "../utils/sync/configuration"

export default async ({ container, options }: LoaderOptions): Promise<void> => {
  container.register({
    baseRepository: asClass(BaseRepository).singleton(),
    indexConfigurationCheckerFactory: asValue(
      (input: ConstructorParameters<typeof Configuration>[0]) =>
        new Configuration(input)
    ),
    indexResetHandler: asClass(PostgresIndexResetHandler).singleton(),
    indexTypeGenerator: asValue(gqlSchemaToTypes),
    searchModuleService: asClass(IndexModuleService).singleton(),
  })

  container.register("storageProviderCtrOptions", asValue(undefined))

  container.register("storageProviderCtr", asValue(PostgresProvider))

  /*if (!options?.customAdapter) {
    container.register("storageProviderCtr", asValue(PostgresProvider))
  }  else {
    container.register(
      "storageProviderCtr",
      asValue(options.customAdapter.constructor)
    )
    container.register(
      "storageProviderCtrOptions",
      asValue(options.customAdapter.options)
    )
  }*/
}
