import type {
  Logger,
  MedusaContainer,
  ModulePersistenceAdapter,
  ModuleResolution,
} from "@medusajs/types"
import { asValue } from "@medusajs/deps/awilix"
import { MODULE_SCOPE } from "../types"
import {
  loadInternalModule,
  type ModuleExportsLoader,
  type ModuleResourceLoader,
} from "./utils/load-internal"

export async function staticModuleLoader({
  container,
  moduleResolutions,
  logger,
  migrationOnly,
  loaderOnly,
  schemaOnly,
  persistenceAdapter,
  resourceLoader,
  moduleExportsLoader,
}: {
  container: MedusaContainer
  moduleResolutions: Record<string, ModuleResolution>
  logger: Logger
  migrationOnly?: boolean
  loaderOnly?: boolean
  schemaOnly?: boolean
  persistenceAdapter?: ModulePersistenceAdapter
  resourceLoader?: ModuleResourceLoader
  moduleExportsLoader?: ModuleExportsLoader
}): Promise<void> {
  const resolutions = Object.values(moduleResolutions ?? {})
  const results = await Promise.all(
    resolutions.map(async (resolution) => {
      const definition = resolution.definition
      if (!definition.key) {
        throw new Error(`Module definition is missing property "key"`)
      }

      const { scope } = resolution.moduleDeclaration ?? {}
      const canSkip =
        !resolution.resolutionPath &&
        !resolution.moduleExports &&
        !resolution.resources &&
        !definition.isRequired &&
        !definition.defaultPackage

      if (scope === MODULE_SCOPE.EXTERNAL && !canSkip) {
        throw new Error("External Modules are not supported yet.")
      }

      if (!scope) {
        container.register(definition.key, asValue(undefined))
        return {
          error: new Error(
            `The module ${definition.label} has to define its scope (internal | external)`
          ),
        }
      }

      if (
        resolution.resolutionPath === false &&
        !resolution.moduleExports &&
        !resolution.resources
      ) {
        container.register(definition.key, asValue(undefined))
        return
      }

      return await loadInternalModule({
        container,
        resolution: {
          ...resolution,
          options: {
            ...resolution.options,
            persistenceAdapter:
              resolution.options?.persistenceAdapter ?? persistenceAdapter,
          },
        },
        logger,
        migrationOnly,
        loaderOnly,
        schemaOnly,
        resourceLoader,
        moduleExportsLoader,
      })
    })
  )

  results.forEach((result, index) => {
    if (result?.error) {
      logger.error(
        `Could not resolve module: ${resolutions[index].definition.label}. Error: ${result.error.message}\n`
      )
      throw result.error
    }
  })
}
