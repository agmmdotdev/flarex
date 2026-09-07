import type {
  JoinerServiceConfigAlias,
  ModuleJoinerConfig,
} from "@medusajs/types"
import { accessSync } from "fs"
import * as path from "path"
import { dirname, join, normalize } from "path"
import { getCallerFilePath } from "../common/get-caller-file-path"
import { DmlEntity } from "../dml/entity"
import { loadModels } from "./loaders/load-models"
import {
  defineJoinerConfigFromModels,
  type JoinerConfigModels,
} from "./portable-joiner-config-builder"

export * from "./portable-joiner-config-builder"

export type DefineJoinerConfigOptions = {
  alias?: JoinerServiceConfigAlias[]
  idPrefixToEntityName?: Record<string, string>
  schema?: string
  models?: JoinerConfigModels
  linkableKeys?: ModuleJoinerConfig["linkableKeys"]
  primaryKeys?: string[]
}

/**
 * Node-compatible joiner config builder. When models are omitted, preserve
 * Medusa's original filesystem discovery behavior.
 */
export function defineJoinerConfig(
  serviceName: string,
  options: DefineJoinerConfigOptions = {}
) {
  return defineJoinerConfigFromModels(serviceName, {
    ...options,
    models: options.models ?? discoverJoinerConfigModels(),
  })
}

function discoverJoinerConfigModels(): JoinerConfigModels {
  let index = 1

  while (true) {
    ++index
    let fullPath = getCallerFilePath(index)
    if (!fullPath) {
      return []
    }

    fullPath = normalize(fullPath)
    const integrationTestPotentialPath = normalize(
      "integration-tests/__tests__"
    )

    if (fullPath.includes(integrationTestPotentialPath)) {
      const sourcePath = fullPath.split(integrationTestPotentialPath)[0]
      fullPath = path.join(sourcePath, "src")
    }

    const srcDir = fullPath.includes("dist") ? "dist" : "src"
    const splitPath = fullPath.split(srcDir)
    let basePath = splitPath[0] + srcDir
    const potentialModulesDirPathSegment = normalize(`${srcDir}/modules/`)

    if (fullPath.includes(potentialModulesDirPathSegment)) {
      basePath = dirname(fullPath)
    }

    basePath = join(basePath, "models")

    try {
      accessSync(path.resolve(basePath))
    } catch {
      continue
    }

    const models = loadModels(basePath).filter(
      (model): model is DmlEntity<any, any> | { name: string } =>
        DmlEntity.isDmlEntity(model) ||
        (typeof model === "function" && !!model.name)
    )

    if (models.length) {
      return models
    }
  }
}
