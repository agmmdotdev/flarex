import { DurableObjectWorkflowExecutionStore } from "../execution-store"
import type {
  CloudflareWorkflowExecutionStoreRecord,
  WorkflowExecutionDurableObjectStorage,
} from "../execution-store"

describe("DurableObjectWorkflowExecutionStore", () => {
  beforeEach(() => {
    jest.spyOn(Date, "now").mockReturnValue(1000)
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  it("persists workflow execution checkpoints in the workflow_execution table", async () => {
    const storage = new FakeWorkflowExecutionStorage()
    const store = new DurableObjectWorkflowExecutionStore(storage)
    const record = createExecutionRecord("not_started")

    await store.save(record)

    const found = await store.findLatest(
      record.workflow_id,
      record.transaction_id
    )
    const persisted = await store.getPersistedExecution(
      record.workflow_id,
      record.transaction_id
    )

    expect(found).toMatchObject({
      workflow_id: record.workflow_id,
      transaction_id: record.transaction_id,
      run_id: record.run_id,
      state: "not_started",
      retention_time: 60,
      execution: record.execution,
      context: record.context,
    })
    expect(persisted).toMatchObject({
      workflowId: record.workflow_id,
      transactionId: record.transaction_id,
      runId: record.run_id,
      state: "not_started",
      retentionTime: 60,
      deletedAt: null,
    })
  })

  it("soft deletes by run id and hides deleted checkpoints from lookup", async () => {
    const storage = new FakeWorkflowExecutionStorage()
    const store = new DurableObjectWorkflowExecutionStore(storage)
    const record = createExecutionRecord("not_started")

    await store.save(record)
    await store.deleteByRunId(record.run_id)

    await expect(
      store.findLatest(record.workflow_id, record.transaction_id)
    ).resolves.toBeUndefined()

    const persisted = await store.getPersistedExecution(
      record.workflow_id,
      record.transaction_id
    )
    expect(persisted?.deletedAt).toBe(1000)
  })

  it("lists and deletes expirable finished executions", async () => {
    const storage = new FakeWorkflowExecutionStorage()
    const store = new DurableObjectWorkflowExecutionStore(storage)
    const retainedDone = createExecutionRecord("done")
    const retainedRunning = createExecutionRecord("invoking", "running-run")

    await store.save(retainedDone)
    await store.save(retainedRunning)

    const expirable = await store.listExpirableFinished()
    await store.delete(expirable)

    expect(expirable).toHaveLength(1)
    expect(expirable[0]).toMatchObject({
      workflow_id: retainedDone.workflow_id,
      transaction_id: retainedDone.transaction_id,
      run_id: retainedDone.run_id,
    })
    const deletedDone = await store.getPersistedExecution(
      retainedDone.workflow_id,
      retainedDone.transaction_id
    )
    expect(deletedDone?.deletedAt).toBe(1000)
    await expect(
      store.findLatest(
        retainedRunning.workflow_id,
        retainedRunning.transaction_id
      )
    ).resolves.toMatchObject({ run_id: "running-run" })
  })
})

type ExecutionRow = [
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  number | null,
  number,
  number,
  number | null
]
type ExpirableRow = [string, string, string, number, number]
type QueryRow = ExecutionRow | ExpirableRow

class FakeSqlCursor implements ReturnType<WorkflowExecutionDurableObjectStorage["sql"]["exec"]> {
  constructor(private readonly rows: QueryRow[]) {}

  *raw(): IterableIterator<SqlStorageValue[]> {
    for (const row of this.rows) {
      yield row
    }
  }
}

class FakeWorkflowExecutionStorage
  implements WorkflowExecutionDurableObjectStorage
{
  readonly rows = new Map<string, ExecutionRow>()

  readonly sql = {
    exec: (
      statement: string,
      ...bindings: SqlStorageValue[]
    ): FakeSqlCursor => {
      const normalized = statement.trim()

      if (
        normalized.startsWith("CREATE TABLE") ||
        normalized.startsWith("CREATE UNIQUE INDEX") ||
        normalized.startsWith("CREATE INDEX")
      ) {
        return new FakeSqlCursor([])
      }

      if (normalized.startsWith("INSERT INTO workflow_execution")) {
        const row = toExecutionRow(bindings)
        this.rows.set(rowKey(row[1], row[2], row[3]), row)
        return new FakeSqlCursor([])
      }

      if (
        normalized.startsWith("SELECT") &&
        normalized.includes("WHERE workflow_id = ?") &&
        normalized.includes("AND transaction_id = ?")
      ) {
        const workflowId = bindings[0]
        const transactionId = bindings[1]
        if (typeof workflowId !== "string" || typeof transactionId !== "string") {
          throw new Error("Expected workflow execution lookup bindings")
        }

        const rows = [...this.rows.values()]
          .filter(
            (row) =>
              row[1] === workflowId &&
              row[2] === transactionId &&
              (!normalized.includes("deleted_at IS NULL") || row[10] === null)
          )
          .sort((first, second) => second[9] - first[9])
        return new FakeSqlCursor(rows.slice(0, 1))
      }

      if (
        normalized.startsWith("SELECT") &&
        normalized.includes("retention_time IS NOT NULL")
      ) {
        return new FakeSqlCursor(
          [...this.rows.values()]
            .filter(
              (row) =>
                row[10] === null &&
                row[7] !== null &&
                ["done", "failed", "reverted"].includes(row[6])
            )
            .map((row) => [row[1], row[2], row[3], row[9], row[7] as number])
        )
      }

      if (
        normalized.startsWith("UPDATE workflow_execution") &&
        normalized.includes("WHERE run_id = ?")
      ) {
        const deletedAt = bindings[0]
        const runId = bindings[2]
        if (typeof deletedAt !== "number" || typeof runId !== "string") {
          throw new Error("Expected workflow execution run delete bindings")
        }

        for (const [key, row] of this.rows) {
          if (row[3] === runId && row[10] === null) {
            this.rows.set(key, withDeletedAt(row, deletedAt))
          }
        }
        return new FakeSqlCursor([])
      }

      if (
        normalized.startsWith("UPDATE workflow_execution") &&
        normalized.includes("WHERE workflow_id = ?")
      ) {
        const deletedAt = bindings[0]
        const workflowId = bindings[2]
        const transactionId = bindings[3]
        const runId = bindings[4]
        if (
          typeof deletedAt !== "number" ||
          typeof workflowId !== "string" ||
          typeof transactionId !== "string" ||
          typeof runId !== "string"
        ) {
          throw new Error(
            "Expected workflow execution composite delete bindings"
          )
        }

        for (const [key, row] of this.rows) {
          if (
            row[1] === workflowId &&
            row[2] === transactionId &&
            row[3] === runId &&
            row[10] === null
          ) {
            this.rows.set(key, withDeletedAt(row, deletedAt))
          }
        }
        return new FakeSqlCursor([])
      }

      throw new Error(`Unexpected SQL statement: ${normalized}`)
    },
  }
}

function createExecutionRecord(
  state: string,
  runId = "execution-run"
): CloudflareWorkflowExecutionStoreRecord {
  return {
    id: `wf_exec_execution-workflow_execution-transaction_${runId}`,
    workflow_id: "execution-workflow",
    transaction_id: "execution-transaction",
    run_id: runId,
    execution: {
      modelId: "execution-workflow",
      transactionId: "execution-transaction",
      runId,
      state,
      steps: {},
    },
    context: {
      data: {
        value: "proof",
      },
      errors: [],
    },
    state,
    retention_time: 60,
  }
}

function toExecutionRow(bindings: SqlStorageValue[]): ExecutionRow {
  const [
    id,
    workflowId,
    transactionId,
    runId,
    execution,
    context,
    state,
    retentionTime,
    createdAt,
    updatedAt,
  ] = bindings

  if (
    typeof id !== "string" ||
    typeof workflowId !== "string" ||
    typeof transactionId !== "string" ||
    typeof runId !== "string" ||
    typeof execution !== "string" ||
    typeof context !== "string" ||
    typeof state !== "string" ||
    (retentionTime !== null && typeof retentionTime !== "number") ||
    typeof createdAt !== "number" ||
    typeof updatedAt !== "number"
  ) {
    throw new Error("Invalid workflow execution SQL bindings")
  }

  return [
    id,
    workflowId,
    transactionId,
    runId,
    execution,
    context,
    state,
    retentionTime,
    createdAt,
    updatedAt,
    null,
  ]
}

function rowKey(
  workflowId: string,
  transactionId: string,
  runId: string
): string {
  return `${workflowId}:${transactionId}:${runId}`
}

function withDeletedAt(row: ExecutionRow, deletedAt: number): ExecutionRow {
  return [
    row[0],
    row[1],
    row[2],
    row[3],
    row[4],
    row[5],
    row[6],
    row[7],
    row[8],
    deletedAt,
    deletedAt,
  ]
}
