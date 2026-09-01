import type { SqliteIndexWorkerRuntimeDependencies } from "./sqlite-index-worker-runtime"
import { createSqliteIndexWorkerEventBus } from "./sqlite-index-worker-event-bus"
import {
  createSqliteIndexWorkerRemoteQuery,
  type SqliteIndexWorkerRemoteQueryRecord,
} from "./sqlite-index-worker-remote-query"

export type SqliteIndexWorkerProofDependencyRecords<
  TRecord extends SqliteIndexWorkerRemoteQueryRecord
> = {
  records: readonly TRecord[]
}

export type SqliteIndexWorkerProofDependencies = Pick<
  SqliteIndexWorkerRuntimeDependencies,
  "eventBus" | "query"
>

export type SqliteIndexWorkerMutableProofRecordState<
  TRecord extends SqliteIndexWorkerRemoteQueryRecord
> = {
  getRecords(): readonly TRecord[]
  setRecords(records: readonly TRecord[]): void
}

export type SqliteIndexWorkerMutableProofDependencies<
  TRecord extends SqliteIndexWorkerRemoteQueryRecord
> = SqliteIndexWorkerProofDependencies & {
  records: SqliteIndexWorkerMutableProofRecordState<TRecord>
}

export function createSqliteIndexWorkerProofDependencies<
  TRecord extends SqliteIndexWorkerRemoteQueryRecord
>({
  records,
}: SqliteIndexWorkerProofDependencyRecords<TRecord>): SqliteIndexWorkerProofDependencies {
  return {
    eventBus: createSqliteIndexWorkerEventBus(),
    query: createSqliteIndexWorkerRemoteQuery({ records }),
  }
}

export function createSqliteIndexWorkerMutableProofDependencies<
  TRecord extends SqliteIndexWorkerRemoteQueryRecord
>({
  records,
}: SqliteIndexWorkerProofDependencyRecords<TRecord>): SqliteIndexWorkerMutableProofDependencies<TRecord> {
  let currentRecords = [...records]
  const recordState: SqliteIndexWorkerMutableProofRecordState<TRecord> = {
    getRecords() {
      return currentRecords
    },
    setRecords(nextRecords) {
      currentRecords = [...nextRecords]
    },
  }

  return {
    eventBus: createSqliteIndexWorkerEventBus(),
    query: createSqliteIndexWorkerRemoteQuery({
      records: () => recordState.getRecords(),
    }),
    records: recordState,
  }
}
