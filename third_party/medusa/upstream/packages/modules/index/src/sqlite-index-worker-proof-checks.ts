import type { IndexTypes, Message } from "@medusajs/framework/types"

export type SqliteIndexWorkerProofRuntimeStats = {
  runtimeInstanceId: number
  serviceInitializations: number
}

type SqliteIndexWorkerProofQueryResult =
  IndexTypes.QueryResultSet<string> & SqliteIndexWorkerProofRuntimeStats

export type SqliteIndexWorkerProofRuntimeChecks = {
  emitAndQuery<TData>(options: {
    event: Message<TData>
    query: IndexTypes.IndexQueryConfig<string>
  }): Promise<SqliteIndexWorkerProofQueryResult>
  queryWithRuntimeStats(
    query: IndexTypes.IndexQueryConfig<string>
  ): Promise<SqliteIndexWorkerProofQueryResult>
}

export type SqliteIndexWorkerEmptyQueryCheck =
  SqliteIndexWorkerProofRuntimeStats & {
    dataCount: number
    estimateCount: number | undefined
    matched: boolean
    seeded: false
  }

export type SqliteIndexWorkerExpectedStringField = {
  field: string
  value: string
}

export type SqliteIndexWorkerObservedStringField = {
  actual: string | undefined
  expected: string
  field: string
  matched: boolean
}

export type SqliteIndexWorkerProofScalar =
  | boolean
  | number
  | string
  | null

export type SqliteIndexWorkerExpectedPathField = {
  path: readonly (number | string)[]
  value: SqliteIndexWorkerProofScalar
}

export type SqliteIndexWorkerObservedPathField = {
  actual: SqliteIndexWorkerProofScalar | undefined
  expected: SqliteIndexWorkerProofScalar
  matched: boolean
  path: readonly (number | string)[]
}

export type SqliteIndexWorkerEventIngestionStringCheck =
  SqliteIndexWorkerProofRuntimeStats & {
    fields: readonly SqliteIndexWorkerObservedStringField[]
    matched: boolean
    writePath: "event"
  }

export type SqliteIndexWorkerEventLifecycleStringCheck =
  SqliteIndexWorkerProofRuntimeStats & {
    createFields: readonly SqliteIndexWorkerObservedStringField[]
    createMatched: boolean
    deleteDataCount: number
    deleteEstimateCount: number | undefined
    deleteMatched: boolean
    matched: boolean
    updateFields: readonly SqliteIndexWorkerObservedStringField[]
    updateMatched: boolean
    writePath: "event"
  }

export type SqliteIndexWorkerEventAttachDetachPathCheck =
  SqliteIndexWorkerProofRuntimeStats & {
    attachDataCount: number
    attachFields: readonly SqliteIndexWorkerObservedPathField[]
    attachMatched: boolean
    detachDataCount: number
    detachEstimateCount: number | undefined
    detachMatched: boolean
    matched: boolean
    writePath: "event"
  }

export type RunSqliteIndexWorkerEmptyQueryCheckOptions<TEntry extends string> =
  {
    query: IndexTypes.IndexQueryConfig<TEntry>
    runtime: SqliteIndexWorkerProofRuntimeChecks
  }

export type RunSqliteIndexWorkerEventIngestionStringCheckOptions<
  TEntry extends string,
  TData
> = {
  event: Message<TData>
  expectedFields: readonly SqliteIndexWorkerExpectedStringField[]
  query: IndexTypes.IndexQueryConfig<TEntry>
  runtime: SqliteIndexWorkerProofRuntimeChecks
}

export type RunSqliteIndexWorkerEventLifecycleStringCheckOptions<
  TEntry extends string,
  TCreateData,
  TUpdateData,
  TDeleteData
> = {
  beforeCreate?: () => Promise<void> | void
  beforeDelete?: () => Promise<void> | void
  beforeUpdate?: () => Promise<void> | void
  createEvent: Message<TCreateData>
  createExpectedFields: readonly SqliteIndexWorkerExpectedStringField[]
  deleteEvent: Message<TDeleteData>
  query: IndexTypes.IndexQueryConfig<TEntry>
  runtime: SqliteIndexWorkerProofRuntimeChecks
  updateEvent: Message<TUpdateData>
  updateExpectedFields: readonly SqliteIndexWorkerExpectedStringField[]
}

export type RunSqliteIndexWorkerEventAttachDetachPathCheckOptions<
  TEntry extends string,
  TAttachData,
  TDetachData
> = {
  attachEvent: Message<TAttachData>
  beforeAttach?: () => Promise<void> | void
  beforeDetach?: () => Promise<void> | void
  detachEvent: Message<TDetachData>
  expectedAttachedFields: readonly SqliteIndexWorkerExpectedPathField[]
  query: IndexTypes.IndexQueryConfig<TEntry>
  runtime: SqliteIndexWorkerProofRuntimeChecks
}

export async function runSqliteIndexWorkerEmptyQueryCheck<
  const TEntry extends string
>({
  query,
  runtime,
}: RunSqliteIndexWorkerEmptyQueryCheckOptions<TEntry>): Promise<SqliteIndexWorkerEmptyQueryCheck> {
  const { data, metadata, runtimeInstanceId, serviceInitializations } =
    await runtime.queryWithRuntimeStats(query)
  const estimateCount = metadata?.estimate_count

  return {
    dataCount: data.length,
    estimateCount,
    matched: data.length === 0 && estimateCount === 0,
    runtimeInstanceId,
    seeded: false,
    serviceInitializations,
  }
}

export async function runSqliteIndexWorkerEventIngestionStringCheck<
  const TEntry extends string,
  TData
>({
  event,
  expectedFields,
  query,
  runtime,
}: RunSqliteIndexWorkerEventIngestionStringCheckOptions<
  TEntry,
  TData
>): Promise<SqliteIndexWorkerEventIngestionStringCheck> {
  const { data, runtimeInstanceId, serviceInitializations } =
    await runtime.emitAndQuery({
      event,
      query,
    })
  const firstRow = data[0]
  const fields = expectedFields.map(({ field, value }) => {
    const actual = readStringField(firstRow, field)

    return {
      actual,
      expected: value,
      field,
      matched: actual === value,
    }
  })

  return {
    fields,
    matched: fields.every((field) => field.matched),
    runtimeInstanceId,
    serviceInitializations,
    writePath: "event",
  }
}

export async function runSqliteIndexWorkerEventAttachDetachPathCheck<
  const TEntry extends string,
  TAttachData,
  TDetachData
>({
  attachEvent,
  beforeAttach,
  beforeDetach,
  detachEvent,
  expectedAttachedFields,
  query,
  runtime,
}: RunSqliteIndexWorkerEventAttachDetachPathCheckOptions<
  TEntry,
  TAttachData,
  TDetachData
>): Promise<SqliteIndexWorkerEventAttachDetachPathCheck> {
  await beforeAttach?.()
  const attachResult = await runtime.emitAndQuery({
    event: attachEvent,
    query,
  })
  const firstAttachedRow = attachResult.data[0]
  const attachFields = expectedAttachedFields.map(({ path, value }) => {
    const actual = readPathScalarField(firstAttachedRow, path)

    return {
      actual,
      expected: value,
      matched: actual === value,
      path,
    }
  })
  const attachMatched =
    attachResult.data.length === 1 &&
    attachFields.every((field) => field.matched)

  await beforeDetach?.()
  const detachResult = await runtime.emitAndQuery({
    event: detachEvent,
    query,
  })
  const detachEstimateCount = detachResult.metadata?.estimate_count
  const detachMatched =
    detachResult.data.length === 0 &&
    (detachEstimateCount === undefined || detachEstimateCount === 0)

  return {
    attachDataCount: attachResult.data.length,
    attachFields,
    attachMatched,
    detachDataCount: detachResult.data.length,
    detachEstimateCount,
    detachMatched,
    matched: attachMatched && detachMatched,
    runtimeInstanceId: detachResult.runtimeInstanceId,
    serviceInitializations: detachResult.serviceInitializations,
    writePath: "event",
  }
}

export async function runSqliteIndexWorkerEventLifecycleStringCheck<
  const TEntry extends string,
  TCreateData,
  TUpdateData,
  TDeleteData
>({
  beforeCreate,
  beforeDelete,
  beforeUpdate,
  createEvent,
  createExpectedFields,
  deleteEvent,
  query,
  runtime,
  updateEvent,
  updateExpectedFields,
}: RunSqliteIndexWorkerEventLifecycleStringCheckOptions<
  TEntry,
  TCreateData,
  TUpdateData,
  TDeleteData
>): Promise<SqliteIndexWorkerEventLifecycleStringCheck> {
  await beforeCreate?.()
  const createCheck = await runSqliteIndexWorkerEventIngestionStringCheck({
    event: createEvent,
    expectedFields: createExpectedFields,
    query,
    runtime,
  })

  await beforeUpdate?.()
  const updateCheck = await runSqliteIndexWorkerEventIngestionStringCheck({
    event: updateEvent,
    expectedFields: updateExpectedFields,
    query,
    runtime,
  })

  await beforeDelete?.()
  const {
    data,
    metadata,
    runtimeInstanceId,
    serviceInitializations,
  } = await runtime.emitAndQuery({
    event: deleteEvent,
    query,
  })
  const deleteEstimateCount = metadata?.estimate_count
  const deleteMatched =
    data.length === 0 &&
    (deleteEstimateCount === undefined || deleteEstimateCount === 0)

  return {
    createFields: createCheck.fields,
    createMatched: createCheck.matched,
    deleteDataCount: data.length,
    deleteEstimateCount,
    deleteMatched,
    matched: createCheck.matched && updateCheck.matched && deleteMatched,
    runtimeInstanceId,
    serviceInitializations,
    updateFields: updateCheck.fields,
    updateMatched: updateCheck.matched,
    writePath: "event",
  }
}

export function findSqliteIndexWorkerObservedStringField(
  fields: readonly SqliteIndexWorkerObservedStringField[],
  field: string
): SqliteIndexWorkerObservedStringField | undefined {
  return fields.find((entry) => entry.field === field)
}

function readStringField(value: unknown, key: string): string | undefined {
  if (!isRecord(value)) {
    return undefined
  }

  const field = value[key]
  return typeof field === "string" ? field : undefined
}

function readPathScalarField(
  value: unknown,
  path: readonly (number | string)[]
): SqliteIndexWorkerProofScalar | undefined {
  let current = value

  for (const segment of path) {
    if (typeof segment === "number") {
      if (!Array.isArray(current)) {
        return undefined
      }

      current = current[segment]
      continue
    }

    if (!isRecord(current)) {
      return undefined
    }

    current = current[segment]
  }

  return isProofScalar(current) ? current : undefined
}

function isProofScalar(value: unknown): value is SqliteIndexWorkerProofScalar {
  return (
    typeof value === "boolean" ||
    typeof value === "number" ||
    typeof value === "string" ||
    value === null
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value))
}
