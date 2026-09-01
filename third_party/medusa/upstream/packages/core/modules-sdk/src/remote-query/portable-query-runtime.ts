import type {
  JoinerServiceConfig,
  JoinerServiceConfigAlias,
  ModuleJoinerConfig,
} from "@medusajs/types"
import type {
  DirectEntrypointQueryEntry,
  DirectEntrypointQueryPaginatedResult,
  DirectEntrypointQuerySelection,
} from "./direct-entrypoint-query"
import { executeDirectEntrypointQuery } from "./direct-entrypoint-query"

export interface PortableQueryRuntimeOptions {
  entries: Map<string, DirectEntrypointQueryEntry>
  index?: PortableQueryIndexHandler
  services: Record<string, unknown>
}

export interface PortableQueryRuntimeFromJoinerConfigOptions {
  index?: PortableQueryIndexHandler
  joinerConfigs: PortableQueryJoinerConfigInput[]
  services: Record<string, unknown>
}

export type PortableQueryJoinerConfigInput =
  | JoinerServiceConfig
  | ModuleJoinerConfig
  | undefined

export interface PortableQueryGraphInput {
  entity: string
  fields?: string[]
  filters?: Record<string, unknown>
  pagination?: {
    skip?: number
    take?: number
  }
}

export interface PortableQueryGraphResult {
  data: unknown[]
  metadata?: {
    skip: number
    take: number
    count: number
  }
}

export type PortableQueryIndexHandler = (
  queryConfig: unknown,
  options?: unknown
) => Promise<PortableQueryGraphResult>

export type PortableRemoteQueryFunction = (
  queryConfig: unknown
) => Promise<DirectEntrypointQueryPaginatedResult | unknown[]>

export interface PortableQueryService {
  graph(
    queryConfig: unknown,
    options?: unknown
  ): Promise<PortableQueryGraphResult>
  index(
    queryConfig: unknown,
    options?: unknown
  ): Promise<PortableQueryGraphResult>
}

export interface PortableQueryRuntime {
  remoteQuery: PortableRemoteQueryFunction
  query: PortableQueryService
}

export function createPortableQueryRuntime({
  entries,
  index,
  services,
}: PortableQueryRuntimeOptions): PortableQueryRuntime {
  return {
    remoteQuery: createPortableRemoteQuery({ entries, services }),
    query: createPortableQuery({ entries, index, services }),
  }
}

export function createPortableQueryRuntimeFromJoinerConfigs({
  index,
  joinerConfigs,
  services,
}: PortableQueryRuntimeFromJoinerConfigOptions): PortableQueryRuntime {
  return createPortableQueryRuntime({
    entries: createDirectEntrypointQueryEntriesFromJoinerConfigs(joinerConfigs),
    index,
    services,
  })
}

export function createDirectEntrypointQueryEntriesFromJoinerConfigs(
  joinerConfigs: PortableQueryJoinerConfigInput[]
): Map<string, DirectEntrypointQueryEntry> {
  const entries = new Map<string, DirectEntrypointQueryEntry>()

  for (const joinerConfig of joinerConfigs) {
    const serviceName = readServiceName(joinerConfig)
    if (!joinerConfig || !serviceName) {
      continue
    }

    const aliases = Array.isArray(joinerConfig.alias)
      ? joinerConfig.alias
      : joinerConfig.alias
      ? [joinerConfig.alias]
      : []

    for (const alias of aliases) {
      const methodSuffix = readMethodSuffix(alias)
      if (!methodSuffix) {
        continue
      }

      const aliasNames = Array.isArray(alias.name) ? alias.name : [alias.name]
      for (const aliasName of aliasNames) {
        entries.set(aliasName, {
          serviceName,
          methodSuffix,
        })
      }
    }
  }

  return entries
}

function readServiceName(
  joinerConfig: PortableQueryJoinerConfigInput
): string | undefined {
  return typeof joinerConfig?.serviceName === "string"
    ? joinerConfig.serviceName
    : undefined
}

function createPortableRemoteQuery({
  entries,
  services,
}: PortableQueryRuntimeOptions): PortableRemoteQueryFunction {
  return async function portableRemoteQuery(
    queryConfig: unknown
  ): Promise<DirectEntrypointQueryPaginatedResult | unknown[]> {
    const queryValue = readRecord(queryConfig)?.__value
    const queryEntries = readRecord(queryValue)
    if (!queryEntries) {
      throw new Error("Portable remote query expected a query object.")
    }

    const queryEntryNames = Object.keys(queryEntries)
    if (queryEntryNames.length !== 1) {
      throw new Error(
        "Portable remote query currently supports exactly one direct entrypoint."
      )
    }

    const entryPoint = queryEntryNames[0]
    return await executeDirectEntrypointQuery({
      entries,
      services,
      entryPoint,
      selection: readDirectEntrypointQuerySelection(queryEntries[entryPoint]),
    })
  }
}

function createPortableQuery({
  entries,
  index,
  services,
}: PortableQueryRuntimeOptions): PortableQueryService {
  return {
    graph: async (
      queryConfig: unknown,
      _options?: unknown
    ): Promise<PortableQueryGraphResult> => {
      const graphInput = readPortableQueryGraphInput(queryConfig)
      const result = await executeDirectEntrypointQuery({
        entries,
        services,
        entryPoint: graphInput.entity,
        selection: {
          fields: graphInput.fields,
          __args: {
            filters: graphInput.filters,
            skip: graphInput.pagination?.skip,
            take: graphInput.pagination?.take,
          },
        },
      })

      if (Array.isArray(result)) {
        return {
          data: result,
        }
      }

      return {
        data: result.rows,
        metadata: result.metadata,
      }
    },
    index: async (
      queryConfig: unknown,
      options?: unknown
    ): Promise<PortableQueryGraphResult> => {
      if (index) {
        return await index(queryConfig, options)
      }

      throw new Error(
        "Portable query.index requires a Worker-safe Index adapter. Keep the Index Engine feature flag disabled for this runtime or register a portable Index adapter."
      )
    },
  }
}

function readDirectEntrypointQuerySelection(
  selection: unknown
): DirectEntrypointQuerySelection {
  const selectionRecord = readRecord(selection)
  if (!selectionRecord) {
    throw new Error("Portable remote query expected an entrypoint selection.")
  }

  const fields = readStringArray(selectionRecord.fields)
  const args = readRecord(selectionRecord.__args)
  const filters = readRecord(args?.filters)
  const skip = readOptionalNumber(args?.skip, "skip")
  const take = readOptionalNumber(args?.take, "take")

  return {
    fields,
    __args: {
      filters,
      skip,
      take,
    },
  }
}

function readPortableQueryGraphInput(value: unknown): PortableQueryGraphInput {
  const input = readRecord(value)
  if (!input || typeof input.entity !== "string") {
    throw new Error("Portable query.graph expected an entity string.")
  }

  const fields = readStringArray(input.fields)
  const filters = readRecord(input.filters)
  const pagination = readRecord(input.pagination)
  const skip = readOptionalNumber(pagination?.skip, "pagination.skip")
  const take = readOptionalNumber(pagination?.take, "pagination.take")

  return {
    entity: input.entity,
    fields,
    filters,
    pagination: pagination
      ? {
          skip,
          take,
        }
      : undefined,
  }
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined
  }

  return value as Record<string, unknown>
}

function readMethodSuffix(
  alias: JoinerServiceConfigAlias
): string | undefined {
  const args = readRecord(alias.args)
  const methodSuffix = args?.methodSuffix
  return typeof methodSuffix === "string" ? methodSuffix : undefined
}

function readStringArray(value: unknown): string[] | undefined {
  if (value === undefined) {
    return undefined
  }

  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error("Portable remote query expected fields to be a string array.")
  }

  return value
}

function readOptionalNumber(
  value: unknown,
  fieldName: string
): number | undefined {
  if (value === undefined) {
    return undefined
  }

  if (typeof value !== "number") {
    throw new Error(
      `Portable remote query expected ${fieldName} to be a number.`
    )
  }

  return value
}
