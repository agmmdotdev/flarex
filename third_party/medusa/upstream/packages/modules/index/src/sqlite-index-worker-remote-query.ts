import type {
  QueryGraphFunction,
  RemoteQueryFunction,
} from "@medusajs/framework/types"

type GraphCall = Parameters<QueryGraphFunction>[0]

export type SqliteIndexWorkerRemoteQueryRecord = {
  readonly id: string
  readonly [key: string]: unknown
}

export type CreateSqliteIndexWorkerRemoteQueryOptions<
  TRecord extends SqliteIndexWorkerRemoteQueryRecord
> = {
  records: readonly TRecord[] | (() => readonly TRecord[])
}

export function createSqliteIndexWorkerRemoteQuery<
  TRecord extends SqliteIndexWorkerRemoteQueryRecord
>({
  records,
}: CreateSqliteIndexWorkerRemoteQueryOptions<TRecord>): RemoteQueryFunction {
  const remoteQuery = Object.assign(async () => [], {
    graph: async (config: GraphCall) => {
      const ids = readStringArrayFilter(config.filters?.id)
      const currentRecords = readRecords(records)

      return {
        data:
          ids.length === 0
            ? currentRecords.map((record) => ({ ...record }))
            : currentRecords
                .filter((record) => ids.includes(record.id))
                .map((record) => ({ ...record })),
      }
    },
    index: async () => ({ data: [] }),
    gql: async () => ({ data: [] }),
  })

  // RemoteQueryFunction is an overloaded callable object. The Worker Index
  // ingestion proof only needs graph/index/gql, so keep the assertion isolated
  // at this factory boundary.
  return remoteQuery as unknown as RemoteQueryFunction
}

function readRecords<TRecord extends SqliteIndexWorkerRemoteQueryRecord>(
  records: readonly TRecord[] | (() => readonly TRecord[])
): readonly TRecord[] {
  return typeof records === "function" ? records() : records
}

function readStringArrayFilter(value: unknown): readonly string[] {
  if (typeof value === "string") {
    return [value]
  }

  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : []
}
