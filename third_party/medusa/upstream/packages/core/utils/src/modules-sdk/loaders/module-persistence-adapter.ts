import {
  ModuleMigrationAdapter,
  ModulePersistenceAdapter,
} from "@medusajs/types"
import {
  MikroOrmBaseRepository,
  mikroOrmBaseRepositoryFactory,
} from "../../dal"
import { toMikroOrmEntities } from "../../dml"
import { mikroOrmConnectionLoaderFactory } from "./mikro-orm-connection-loader-factory"
import {
  createMedusaMikroOrmEventSubscriber,
  dispatchMedusaMikroOrmMutationEvent,
  registerMedusaMikroOrmEventSubscriber,
} from "../create-medusa-mikro-orm-event-subscriber"
import { buildRevertMigrationScript } from "../migration-scripts/migration-down"
import { buildGenerateMigrationScript } from "../migration-scripts/migration-generate"
import { buildMigrationScript } from "../migration-scripts/migration-up"

export const mikroOrmModulePersistenceAdapter: ModulePersistenceAdapter = {
  name: "mikroorm",

  prepareModels(models) {
    return toMikroOrmEntities(models)
  },

  createConnectionLoader(options) {
    return mikroOrmConnectionLoaderFactory(options)
  },

  createBaseRepository() {
    return MikroOrmBaseRepository
  },

  createRepository(model) {
    return mikroOrmBaseRepositoryFactory(model)
  },

  createEventSubscriber(keys, service) {
    return createMedusaMikroOrmEventSubscriber(keys, service)
  },

  registerEventSubscriber(context, subscriber) {
    registerMedusaMikroOrmEventSubscriber(context, subscriber)
  },

  async dispatchMutationEvent(event, args, context) {
    await dispatchMedusaMikroOrmMutationEvent(event, args, context)
  },
}

export const mikroOrmModuleMigrationAdapter: ModuleMigrationAdapter = {
  name: "mikroorm",

  createMigrationScripts(options) {
    const runMigrations = buildMigrationScript(options)
    const revertMigration = buildRevertMigrationScript(options)
    const generateMigration = buildGenerateMigrationScript(options)

    return {
      runMigrations: async (runtimeOptions) =>
        (
          await runMigrations(
            runtimeOptions as Parameters<typeof runMigrations>[0]
          )
        ).map((migration) => ({
          name: migration.name,
          path: migration.path ?? options.pathToMigrations,
        })),
      revertMigration: async (runtimeOptions) =>
        await revertMigration(
          runtimeOptions as Parameters<typeof revertMigration>[0]
        ),
      generateMigration: async (runtimeOptions) =>
        await generateMigration(
          runtimeOptions as Parameters<typeof generateMigration>[0]
        ),
    }
  },
}
