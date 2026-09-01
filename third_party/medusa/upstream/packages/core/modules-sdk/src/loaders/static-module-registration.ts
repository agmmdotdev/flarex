import type {
  ExternalModuleDeclaration,
  InternalModuleDeclaration,
  ModuleDefinition,
  ModuleExports,
  ModuleResolution,
  StaticModuleResources,
} from "@medusajs/types"
import { MODULE_SCOPE } from "../types"

export function registerStaticMedusaModule({
  moduleKey,
  moduleDeclaration,
  moduleExports,
  resources,
  definition,
}: {
  moduleKey: string
  moduleDeclaration?:
    | Partial<InternalModuleDeclaration | ExternalModuleDeclaration>
    | string
    | false
  moduleExports?: ModuleExports
  resources?: StaticModuleResources
  definition?: ModuleDefinition
  cwd?: string
}): Record<string, ModuleResolution> {
  if (!definition) {
    throw new Error(`Static module ${moduleKey} requires a module definition`)
  }
  if (!moduleExports || !resources) {
    throw new Error(
      `Static module ${moduleKey} requires module exports and resources`
    )
  }
  if (
    typeof moduleDeclaration === "string" ||
    typeof moduleDeclaration === "boolean"
  ) {
    throw new Error(
      `Static module ${moduleKey} requires an internal module declaration`
    )
  }

  const declaration = {
    ...definition.defaultModuleDeclaration,
    ...moduleDeclaration,
    scope: moduleDeclaration?.scope ?? MODULE_SCOPE.INTERNAL,
  } as InternalModuleDeclaration

  return {
    [moduleKey]: {
      resolutionPath: false,
      definition,
      dependencies: [
        ...new Set(
          (definition.dependencies ?? []).concat(
            declaration.dependencies ?? []
          )
        ),
      ],
      moduleDeclaration: declaration,
      moduleExports,
      resources,
      options: declaration.options ?? {},
    },
  }
}
