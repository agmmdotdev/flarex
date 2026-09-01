import type { IndexTypes } from "@medusajs/framework/types"
import {
  createSqliteIndexService,
  type CreateSqliteIndexServiceOptions,
} from "./sqlite-index-service-composition"

type SqliteIndexWorkerRuntimeDependencyKey =
  | "eventBus"
  | "executor"
  | "joinerConfigs"
  | "query"
  | "schema"

export type SqliteIndexWorkerRuntimeDependencies = {
  [TKey in SqliteIndexWorkerRuntimeDependencyKey]-?: NonNullable<
    CreateSqliteIndexServiceOptions[TKey]
  >
}

export type SqliteIndexWorkerRuntimeOptions =
  SqliteIndexWorkerRuntimeDependencies &
    Omit<
      CreateSqliteIndexServiceOptions,
      SqliteIndexWorkerRuntimeDependencyKey
    >

export class SqliteIndexWorkerRuntime {
  private serviceInitializationCount = 0
  private servicePromise: Promise<IndexTypes.IIndexService> | undefined

  constructor(private readonly options: SqliteIndexWorkerRuntimeOptions) {}

  get serviceInitializations(): number {
    return this.serviceInitializationCount
  }

  getService(): Promise<IndexTypes.IIndexService> {
    if (!this.servicePromise) {
      this.serviceInitializationCount += 1
      this.servicePromise = createSqliteIndexService(this.options)
    }

    return this.servicePromise
  }

  async query<const TEntry extends string>(
    config: IndexTypes.IndexQueryConfig<TEntry>
  ): Promise<IndexTypes.QueryResultSet<TEntry>> {
    const service = await this.getService()

    return await service.query(config)
  }
}

export function createSqliteIndexWorkerRuntime(
  options: SqliteIndexWorkerRuntimeOptions
): SqliteIndexWorkerRuntime {
  return new SqliteIndexWorkerRuntime(options)
}
