import type { JoinerArgument } from "@medusajs/types"

const BASE_PREFIX = ""
const MAX_BATCH_SIZE = 4000
const MAX_CONCURRENT_REQUESTS = 10

export interface RemoteFetchOptions extends Record<string, unknown> {
  select?: string[]
  relations: string[]
  args?: Record<string, unknown>
  skip?: number
  take?: number | null
  cursor?: unknown
}

export interface RemoteFetchExpand {
  fields?: string[]
  args?: JoinerArgument[]
  expands?: Record<string, RemoteFetchExpand>
}

export interface RemoteFetchPagination {
  skip?: number
  take?: number | null
  count: number
}

export interface RemoteFetchPaginatedRows {
  rows: unknown[]
  metadata: RemoteFetchPagination
}

export type RemoteFetchTrace = (
  fetcher: () => Promise<unknown>,
  serviceName: string,
  method: string,
  options: { select?: string[]; relations: string[] }
) => Promise<unknown>

export interface RemoteFetchServiceRequest {
  serviceName: string
  service: unknown
  keyField: string
  ids?: (unknown | unknown[])[] | object
  filters: Record<string, unknown>
  options: RemoteFetchOptions
  methodSuffix?: string
  traceFetchData?: RemoteFetchTrace
}

export interface RemoteFetchServiceResult {
  data: unknown[] | { [path: string]: unknown }
  path?: string
}

export interface RemoteFetchServiceMethodCall {
  serviceName: string
  service: unknown
  methodName: string
  filters?: Record<string, unknown>
  options: RemoteFetchOptions
  traceFetchData?: RemoteFetchTrace
}

export function getAllRemoteFetchFieldsAndRelations(
  expand: RemoteFetchExpand,
  prefix = BASE_PREFIX,
  args: Record<string, unknown> = {}
): {
  select?: string[]
  relations: string[]
  args: Record<string, unknown>
  take?: number | null
} {
  expand = JSON.parse(JSON.stringify(expand))

  const fields: Set<string> = new Set()
  let relations: string[] = []

  let shouldSelectAll = false

  for (const field of expand.fields ?? []) {
    if (field === "*") {
      shouldSelectAll = true
      break
    }
    fields.add(prefix ? `${prefix}.${field}` : field)
  }

  const filters =
    expand.args?.find((arg) => arg.name === "filters")?.value ?? {}

  if (isPresent(filters)) {
    args[prefix] = filters
  } else if (isPresent(expand.args)) {
    args[prefix] = expand.args
  } else {
    args[prefix] = undefined
  }

  for (const property in expand.expands ?? {}) {
    const newPrefix = prefix ? `${prefix}.${property}` : property

    relations.push(newPrefix)
    fields.delete(newPrefix)

    const nestedExpand = expand.expands?.[property]
    if (!nestedExpand) {
      continue
    }

    const result = getAllRemoteFetchFieldsAndRelations(
      nestedExpand,
      newPrefix,
      args
    )

    result.select?.forEach(fields.add, fields)
    relations = relations.concat(result.relations)
  }

  const allFields = Array.from(fields)
  const select =
    allFields.length && !shouldSelectAll
      ? allFields
      : shouldSelectAll
      ? undefined
      : []

  return {
    select,
    relations,
    args,
  }
}

export function hasRemoteFetchPagination(options: {
  [attr: string]: unknown
}): boolean {
  const attrs = ["skip", "cursor"]
  return Object.keys(options).some((key) => attrs.includes(key))
}

export function buildRemoteFetchPagination(
  options: RemoteFetchOptions,
  count: number
): RemoteFetchPagination {
  return {
    skip: options.skip,
    take: options.take,
    count,
  }
}

export function splitRemoteFetchFieldsAndRelations(fields?: string[]): {
  select?: string[]
  relations: string[]
} {
  if (!fields) {
    return {
      select: undefined,
      relations: [],
    }
  }

  const relations = new Set<string>()
  for (const field of fields) {
    const [relation] = field.split(".")
    if (relation && relation !== field) {
      relations.add(relation)
    }
  }

  return {
    select: fields,
    relations: Array.from(relations),
  }
}

export function resolveRemoteFetchMethodName({
  paginated,
  methodSuffix,
}: {
  paginated: boolean
  methodSuffix?: string
}): string {
  const baseName = paginated ? "listAndCount" : "list"
  return appendRemoteFetchMethodSuffix(baseName, methodSuffix)
}

export function appendRemoteFetchMethodSuffix(
  baseName: string,
  methodSuffix: string | undefined
): string {
  if (!methodSuffix) {
    return baseName
  }

  return `${baseName}${toPascalCase(methodSuffix)}`
}

export async function executeRemoteFetchServiceRequest({
  serviceName,
  service,
  keyField,
  ids,
  filters,
  options,
  methodSuffix,
  traceFetchData,
}: RemoteFetchServiceRequest): Promise<RemoteFetchServiceResult> {
  const hasPagination = hasRemoteFetchPagination(options)
  const isIdsArray = Array.isArray(ids)
  const idsLength = isIdsArray ? ids.length : 1

  if (ids !== undefined) {
    if (isIdsArray && !idsLength) {
      if (hasPagination) {
        return {
          data: {
            rows: [],
            metadata: buildRemoteFetchPagination(options, 0),
          },
          path: "rows",
        }
      }

      return {
        data: [],
      }
    }

    filters[keyField] = ids
  }

  const methodName = resolveRemoteFetchMethodName({
    paginated: hasPagination,
    methodSuffix,
  })

  if (isIdsArray && idsLength && !hasPagination) {
    options.take = null
  }

  if (isIdsArray && idsLength >= MAX_BATCH_SIZE && !hasPagination) {
    const data = await fetchRemoteDataBatched({
      serviceName,
      keyField,
      service,
      methodName,
      filters,
      options,
      ids,
      traceFetchData,
    })
    return { data }
  }

  const result = await callRemoteFetchServiceMethod({
    serviceName,
    service,
    methodName,
    filters,
    options,
    traceFetchData,
  })

  if (hasPagination) {
    if (!isListAndCountResult(result)) {
      throw new Error(
        `Method "${methodName}" on "${serviceName}" did not return a list-and-count tuple.`
      )
    }

    const [data, count] = result
    return {
      data: {
        rows: data,
        metadata: buildRemoteFetchPagination(options, count),
      },
      path: "rows",
    }
  }

  return {
    data: Array.isArray(result) ? result : [result],
  }
}

export async function callRemoteFetchServiceMethod({
  serviceName,
  service,
  methodName,
  filters = {},
  options,
  traceFetchData,
}: RemoteFetchServiceMethodCall): Promise<unknown> {
  const serviceRecord = readRecord(service)
  const method = serviceRecord?.[methodName]

  if (!isRemoteFetchMethod(method)) {
    throw new Error(`Method "${methodName}" does not exist on "${serviceName}"`)
  }

  const callable = async () => {
    return await method.call(serviceRecord, filters, options)
  }

  if (traceFetchData) {
    return await traceFetchData(callable, serviceName, methodName, {
      select: options.select,
      relations: options.relations,
    })
  }

  return await callable()
}

async function fetchRemoteDataBatched({
  serviceName,
  keyField,
  service,
  methodName,
  filters,
  options,
  ids,
  traceFetchData,
}: RemoteFetchServiceRequest & {
  methodName: string
  ids: (unknown | unknown[])[]
}): Promise<unknown[]> {
  const idsToFetch = getBatch(ids, MAX_BATCH_SIZE)
  const results: unknown[] = []
  let running = 0
  const fetchPromises: Promise<void>[] = []

  const processBatch = async (batch: (unknown | unknown[])[]) => {
    running++
    const batchFilters = { ...filters, [keyField]: batch }

    try {
      const result = await callRemoteFetchServiceMethod({
        serviceName,
        service,
        methodName,
        filters: batchFilters,
        options,
        traceFetchData,
      })
      results.push(result)
    } finally {
      running--
      processAllBatches()
    }
  }

  let batchesDone: (value: void) => void = () => {}
  const awaitBatches = new Promise<void>((ok) => {
    batchesDone = ok
  })
  const processAllBatches = async () => {
    let isDone = false
    while (running < MAX_CONCURRENT_REQUESTS) {
      const nextBatch = idsToFetch.next()
      if (nextBatch.done) {
        isDone = true
        break
      }

      fetchPromises.push(processBatch(nextBatch.value))
    }

    if (isDone) {
      await Promise.all(fetchPromises)
      batchesDone()
    }
  }

  processAllBatches()
  await awaitBatches

  return flattenRemoteFetchResults(results)
}

function* getBatch(
  idArray: (unknown | unknown[])[],
  batchSize: number
): Generator<(unknown | unknown[])[]> {
  for (let i = 0; i < idArray.length; i += batchSize) {
    yield idArray.slice(i, i + batchSize)
  }
}

function flattenRemoteFetchResults(results: unknown[]): unknown[] {
  const flattenedResults: unknown[] = []

  for (const result of results) {
    if (isListAndCountResult(result)) {
      flattenedResults.push(...result[0])
    } else if (Array.isArray(result)) {
      flattenedResults.push(...result)
    } else {
      flattenedResults.push(result)
    }
  }

  return flattenedResults
}

function isListAndCountResult(value: unknown): value is [unknown[], number] {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    Array.isArray(value[0]) &&
    typeof value[1] === "number"
  )
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined
  }

  return value as Record<string, unknown>
}

function isRemoteFetchMethod(
  value: unknown
): value is (
  filters: Record<string, unknown>,
  options: RemoteFetchOptions
) => Promise<unknown> {
  return typeof value === "function"
}

function toPascalCase(value: string): string {
  return value.replace(/(^\w|_\w)/g, (match) =>
    match.replace(/_/g, "").toUpperCase()
  )
}

function isPresent(value: unknown): boolean {
  if (value === undefined || value === null) {
    return false
  }

  if (typeof value === "string" || Array.isArray(value)) {
    return value.length > 0
  }

  if (value instanceof Map || value instanceof Set) {
    return value.size > 0
  }

  if (typeof value === "object") {
    return Object.keys(value).length > 0
  }

  return true
}
