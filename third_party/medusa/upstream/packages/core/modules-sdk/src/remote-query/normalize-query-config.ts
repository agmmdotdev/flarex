import type {
  RemoteJoinerQuery,
  RemoteQueryInput,
  RemoteQueryObjectConfig,
  RemoteQueryObjectFromStringResult,
} from "@medusajs/types"
import { remoteQueryObjectFromString } from "@medusajs/utils"
import { toRemoteQuery } from "./to-remote-query"

export type QueryConfigInput =
  | RemoteQueryInput<string>
  | RemoteQueryObjectConfig<string>
  | RemoteQueryObjectFromStringResult<RemoteQueryObjectConfig<string>>
  | RemoteQueryServiceObjectConfig
  | RemoteJoinerQuery

type RemoteQueryEntityMap = Parameters<typeof toRemoteQuery>[1]
type RemoteQueryServiceObjectConfig = {
  service: string
  variables?: unknown
  fields: string[]
}

export function normalizeQueryConfig({
  config,
  entitiesMap,
}: {
  config: QueryConfigInput
  entitiesMap: RemoteQueryEntityMap
}): object {
  if (hasRemoteQueryValue(config)) {
    return config.__value
  }

  if (hasEntity(config)) {
    return toRemoteQuery(config, entitiesMap)
  }

  if (hasEntryPoint(config)) {
    return remoteQueryObjectFromString(config).__value
  }

  if (hasService(config)) {
    return remoteQueryObjectFromString(
      config as unknown as RemoteQueryObjectConfig<string>
    ).__value
  }

  return config
}

function hasRemoteQueryValue(
  config: QueryConfigInput
): config is RemoteQueryObjectFromStringResult<RemoteQueryObjectConfig<string>> {
  return "__value" in config
}

function hasEntity(
  config: QueryConfigInput
): config is RemoteQueryInput<string> {
  return "entity" in config
}

function hasEntryPoint(
  config: QueryConfigInput
): config is RemoteQueryObjectConfig<string> {
  return "entryPoint" in config
}

function hasService(
  config: QueryConfigInput
): config is RemoteQueryServiceObjectConfig {
  return "service" in config && typeof config.service === "string"
}
