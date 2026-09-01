import type { IndexTypes, Message } from "@medusajs/framework/types"
import {
  createSqliteIndexWorkerRuntime,
  type SqliteIndexWorkerRuntime,
  type SqliteIndexWorkerRuntimeOptions,
} from "./sqlite-index-worker-runtime"

let nextRuntimeInstanceId = 1

export type SqliteIndexWorkerProofRuntimeQueryResult<
  TEntry extends string
> = IndexTypes.QueryResultSet<TEntry> & {
  runtimeInstanceId: number
  serviceInitializations: number
}

export type SqliteIndexWorkerProofRuntimeEventQueryOptions<
  TEntry extends string,
  TData
> = {
  event: Message<TData>
  query: IndexTypes.IndexQueryConfig<TEntry>
}

export class SqliteIndexWorkerProofRuntime {
  private readonly runtimeInstanceId = nextRuntimeInstanceId++
  private readonly runtime: SqliteIndexWorkerRuntime

  constructor(private readonly options: SqliteIndexWorkerRuntimeOptions) {
    this.runtime = createSqliteIndexWorkerRuntime(options)
  }

  get instanceId(): number {
    return this.runtimeInstanceId
  }

  get serviceInitializations(): number {
    return this.runtime.serviceInitializations
  }

  async queryWithRuntimeStats<const TEntry extends string>(
    config: IndexTypes.IndexQueryConfig<TEntry>
  ): Promise<SqliteIndexWorkerProofRuntimeQueryResult<TEntry>> {
    const result = await this.runtime.query(config)

    return {
      ...result,
      runtimeInstanceId: this.runtimeInstanceId,
      serviceInitializations: this.runtime.serviceInitializations,
    }
  }

  async emitAndQuery<const TEntry extends string, TData>({
    event,
    query,
  }: SqliteIndexWorkerProofRuntimeEventQueryOptions<TEntry, TData>): Promise<
    SqliteIndexWorkerProofRuntimeQueryResult<TEntry>
  > {
    await this.runtime.getService()
    await this.options.eventBus.emit(event)

    return await this.queryWithRuntimeStats(query)
  }
}

export function createSqliteIndexWorkerProofRuntime(
  options: SqliteIndexWorkerRuntimeOptions
): SqliteIndexWorkerProofRuntime {
  return new SqliteIndexWorkerProofRuntime(options)
}
