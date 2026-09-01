import {
  appendRemoteFetchMethodSuffix,
  callRemoteFetchServiceMethod,
  splitRemoteFetchFieldsAndRelations,
} from "./remote-fetch-data"

export interface DirectEntrypointQueryEntry {
  serviceName: string
  methodSuffix: string
}

export interface DirectEntrypointQuerySelection {
  fields?: string[]
  __args?: {
    filters?: Record<string, unknown>
    skip?: number
    take?: number
  }
}

export interface DirectEntrypointQueryPaginatedResult {
  rows: unknown[]
  metadata: {
    skip: number
    take: number
    count: number
  }
}

export async function executeDirectEntrypointQuery({
  entries,
  services,
  entryPoint,
  selection,
}: {
  entries: Map<string, DirectEntrypointQueryEntry>
  services: Record<string, unknown>
  entryPoint: string
  selection: DirectEntrypointQuerySelection
}): Promise<DirectEntrypointQueryPaginatedResult | unknown[]> {
  const entry = entries.get(entryPoint)
  if (!entry) {
    throw new Error(
      `Direct entrypoint query "${entryPoint}" is not registered.`
    )
  }

  const service = services[entry.serviceName]
  if (!service) {
    throw new Error(
      `Direct entrypoint query service "${entry.serviceName}" is not loaded.`
    )
  }

  const methodName = appendRemoteFetchMethodSuffix(
    "listAndCount",
    entry.methodSuffix
  )
  const { select, relations } = splitRemoteFetchFieldsAndRelations(
    selection.fields
  )
  const result = await callRemoteFetchServiceMethod({
    serviceName: entry.serviceName,
    service,
    methodName,
    filters: selection.__args?.filters,
    options: {
      select,
      relations,
      skip: selection.__args?.skip ?? 0,
      take: selection.__args?.take,
    },
  })

  if (!isListAndCountResult(result)) {
    throw new Error(
      `Direct entrypoint query service "${entry.serviceName}" did not return a list-and-count tuple from ${methodName}.`
    )
  }

  const skip = selection.__args?.skip ?? 0
  const take = selection.__args?.take
  const [rows, count] = result

  if (take === undefined) {
    return rows
  }

  return {
    rows,
    metadata: {
      skip,
      take,
      count,
    },
  }
}

function isListAndCountResult(value: unknown): value is [unknown[], number] {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    Array.isArray(value[0]) &&
    typeof value[1] === "number"
  )
}
