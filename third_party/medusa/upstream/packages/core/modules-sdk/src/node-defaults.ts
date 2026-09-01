import { dynamicImport } from "@medusajs/utils"
import { mikroOrmModulePersistenceAdapter } from "@medusajs/utils/modules-sdk/persistence/mikro-orm"
import { moduleLoader, registerMedusaModule } from "./loaders"
import { resolveResources } from "./loaders/utils/load-resources"
import { loadModuleMigrations } from "./loaders/utils/load-migrations"
import { MedusaModule } from "./medusa-module"

MedusaModule.setDefaultInfrastructure({
  moduleLoader,
  moduleRegistration: registerMedusaModule,
  moduleExportsLoader: dynamicImport,
  persistenceAdapter: mikroOrmModulePersistenceAdapter,
  resourceLoader: resolveResources,
  migrationLoader: loadModuleMigrations,
})
