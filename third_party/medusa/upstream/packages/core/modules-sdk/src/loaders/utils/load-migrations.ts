import type {
  LoaderOptions,
  MedusaContainer,
  ModuleExports,
  ModuleMigrationAdapter,
  ModuleMigrationScripts,
  ModuleProvider,
  ModuleProviderExports,
  ModuleResolution,
} from "@medusajs/types"
import { dynamicImport } from "@medusajs/utils"
import { isString } from "@medusajs/utils/common/is-string"
import {
  mikroOrmModuleMigrationAdapter,
  mikroOrmModulePersistenceAdapter,
} from "@medusajs/utils/modules-sdk/persistence/mikro-orm"
import { join } from "path"
import { resolveModuleExports } from "./load-internal"
import { resolveResources } from "./load-resources"

type MigrationFunction = (
  options: LoaderOptions<unknown>
) => Promise<{ name: string; path: string }[]>
type RevertMigrationFunction = (
  options: LoaderOptions<unknown> & { migrationNames?: string[] }
) => Promise<void>
type GenerateMigrationFunction = (
  options: LoaderOptions<unknown>
) => Promise<void>

type ResolvedMigrationModule = (ModuleExports | ModuleProviderExports) & {
  discoveryPath: string
}

function getError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}

function isMigrationAdapter(value: unknown): value is ModuleMigrationAdapter {
  return Boolean(
    value &&
      typeof value === "object" &&
      "createMigrationScripts" in value &&
      typeof value.createMigrationScripts === "function"
  )
}

function getMigrationAdapter(
  resolution: ModuleResolution
): ModuleMigrationAdapter {
  const adapter: unknown = resolution.options?.migrationAdapter
  if (!isMigrationAdapter(adapter)) {
    throw new Error(
      `Module ${resolution.definition.key} requires a migration adapter`
    )
  }

  return adapter
}

export async function loadModuleMigrations(
  container: MedusaContainer,
  resolution: ModuleResolution,
  moduleExports?: ModuleExports
): Promise<{
  runMigrations?: MigrationFunction
  revertMigration?: RevertMigrationFunction
  generateMigration?: GenerateMigrationFunction
}> {
  const runMigrations: MigrationFunction[] = []
  const revertMigrations: RevertMigrationFunction[] = []
  const generateMigrations: GenerateMigrationFunction[] = []

  try {
    const nodeResolution: ModuleResolution = {
      ...resolution,
      options: {
        ...resolution.options,
        persistenceAdapter:
          resolution.options?.persistenceAdapter ??
          mikroOrmModulePersistenceAdapter,
        migrationAdapter:
          resolution.options?.migrationAdapter ??
          mikroOrmModuleMigrationAdapter,
      },
    }
    const mainLoadedModule = await resolveModuleExports({
      resolution: { ...nodeResolution, moduleExports },
      moduleExportsLoader: dynamicImport,
    })
    if ("error" in mainLoadedModule) {
      throw mainLoadedModule.error
    }

    const loadedModules: ResolvedMigrationModule[] = [mainLoadedModule]
    const providers = Array.isArray(nodeResolution.options?.providers)
      ? (nodeResolution.options.providers as ModuleProvider[])
      : []

    for (const provider of providers) {
      const providerExports = provider.resolve
      if (
        !providerExports ||
        (!isString(providerExports) && providerExports.services)
      ) {
        continue
      }

      const loadedProvider = await resolveModuleExports({
        resolution: {
          ...nodeResolution,
          moduleExports: !isString(providerExports)
            ? providerExports
            : undefined,
          resources: undefined,
          definition: {
            ...nodeResolution.definition,
            key: provider.id!,
          },
          resolutionPath: isString(providerExports)
            ? require.resolve(providerExports, { paths: [process.cwd()] })
            : false,
        },
        moduleExportsLoader: dynamicImport,
      })

      if ("error" in loadedProvider) {
        throw loadedProvider.error
      }
      loadedModules.push(loadedProvider)
    }

    const migrationAdapter = getMigrationAdapter(nodeResolution)
    for (const loadedModule of loadedModules) {
      const runCustom = loadedModule.runMigrations as
        | MigrationFunction
        | undefined
      const revertCustom = loadedModule.revertMigration as
        | RevertMigrationFunction
        | undefined
      const generateCustom = loadedModule.generateMigration as
        | GenerateMigrationFunction
        | undefined

      if (runCustom) {
        runMigrations.push(runCustom)
      }
      if (revertCustom) {
        revertMigrations.push(revertCustom)
      }
      if (generateCustom) {
        generateMigrations.push(generateCustom)
      }

      let adapterScripts: ModuleMigrationScripts = {}
      if (!runCustom || !revertCustom || !generateCustom) {
        const resources =
          nodeResolution.resources ??
          (await resolveResources({
            container,
            moduleResolution: nodeResolution,
            discoveryPath: loadedModule.discoveryPath,
          }))
        adapterScripts = migrationAdapter.createMigrationScripts({
          moduleName: nodeResolution.definition.key,
          models: resources.models,
          pathToMigrations:
            resources.migrationPath ??
            join(loadedModule.discoveryPath, "migrations"),
        })
      }

      if (!runCustom && adapterScripts.runMigrations) {
        runMigrations.push(adapterScripts.runMigrations)
      }
      if (!revertCustom && adapterScripts.revertMigration) {
        revertMigrations.push(adapterScripts.revertMigration)
      }
      if (!generateCustom && adapterScripts.generateMigration) {
        generateMigrations.push(adapterScripts.generateMigration)
      }
    }

    return {
      runMigrations: async (...args) => {
        const result: { name: string; path: string }[] = []
        for (const migration of runMigrations) {
          result.push(...(await migration.apply(migration, args)))
        }
        return result
      },
      revertMigration: async (...args) => {
        for (const migration of revertMigrations) {
          await migration.apply(migration, args)
        }
      },
      generateMigration: async (...args) => {
        for (const migration of generateMigrations) {
          await migration.apply(migration, args)
        }
      },
    }
  } catch (error) {
    const cause = getError(error)
    throw new Error(
      `Unable to resolve the migration scripts for the module ${resolution.definition.key}\n${cause.message}\n${cause.stack}`
    )
  }
}
