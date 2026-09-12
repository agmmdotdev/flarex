import type {
  ModuleJoinerConfig,
} from "@medusajs/framework/types"
import { isDefined } from "@medusajs/framework/utils/portable"
import LinkModuleService from "./link-module-service"

export function getModuleService(
  joinerConfig: ModuleJoinerConfig
): typeof LinkModuleService {
  const joinerConfig_ = JSON.parse(JSON.stringify(joinerConfig))
  const databaseConfig = joinerConfig_.databaseConfig

  delete joinerConfig_.databaseConfig

  // If extraDataFields is not defined, pick the fields to populate and validate from the
  // database config if any fields are provided.
  if (!isDefined(joinerConfig_.extraDataFields)) {
    joinerConfig_.extraDataFields = Object.keys(
      databaseConfig?.extraFields || {}
    )
  }

  return class LinkService extends LinkModuleService {
    override __joinerConfig(): ModuleJoinerConfig {
      return joinerConfig_ as ModuleJoinerConfig
    }
  }
}
