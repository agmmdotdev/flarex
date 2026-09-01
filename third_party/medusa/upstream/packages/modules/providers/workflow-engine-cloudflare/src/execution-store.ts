export interface CloudflareWorkflowExecutionStoreRecord {
  id?: string
  workflow_id: string
  transaction_id: string
  run_id: string
  execution: Record<string, unknown>
  context: {
    data: Record<string, unknown>
    errors: unknown[]
  }
  state: string
  retention_time?: number | null
  updated_at?: Date | string | number
}

export interface CloudflareExpirableWorkflowExecution {
  workflow_id: string
  transaction_id: string
  run_id: string
  updated_at: Date | string | number
  retention_time: number | null
}

export interface PersistedCloudflareWorkflowExecution {
  id: string
  workflowId: string
  transactionId: string
  runId: string
  execution: Record<string, unknown>
  context: {
    data: Record<string, unknown>
    errors: unknown[]
  }
  state: string
  retentionTime: number | null
  createdAt: number
  updatedAt: number
  deletedAt: number | null
}

interface WorkflowExecutionSqlCursor {
  raw(): IterableIterator<SqlStorageValue[]>
}

interface WorkflowExecutionSqlStorage {
  exec(
    statement: string,
    ...bindings: SqlStorageValue[]
  ): WorkflowExecutionSqlCursor
}

export interface WorkflowExecutionDurableObjectStorage {
  sql: WorkflowExecutionSqlStorage
}

interface WorkflowExecutionRow {
  id: string
  workflow_id: string
  transaction_id: string
  run_id: string
  execution_json: string
  context_json: string
  state: string
  retention_time: number | null
  created_at: number
  updated_at: number
  deleted_at: number | null
}

const workflowExecutionSchemaSql = `
CREATE TABLE IF NOT EXISTS workflow_execution (
  id TEXT NOT NULL,
  workflow_id TEXT NOT NULL,
  transaction_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  execution TEXT NULL,
  context TEXT NULL,
  state TEXT NOT NULL,
  retention_time INTEGER NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER NULL,
  PRIMARY KEY (workflow_id, transaction_id, run_id)
);
`

const workflowExecutionIndexesSql = [
  `CREATE UNIQUE INDEX IF NOT EXISTS IDX_workflow_execution_id
    ON workflow_execution (id)`,
  `CREATE INDEX IF NOT EXISTS IDX_workflow_execution_workflow_id
    ON workflow_execution (workflow_id)
    WHERE deleted_at IS NULL`,
  `CREATE INDEX IF NOT EXISTS IDX_workflow_execution_transaction_id
    ON workflow_execution (transaction_id)
    WHERE deleted_at IS NULL`,
  `CREATE INDEX IF NOT EXISTS IDX_workflow_execution_run_id
    ON workflow_execution (run_id)
    WHERE deleted_at IS NULL`,
  `CREATE INDEX IF NOT EXISTS IDX_workflow_execution_state_updated_at
    ON workflow_execution (state, updated_at)
    WHERE deleted_at IS NULL`,
  `CREATE INDEX IF NOT EXISTS IDX_workflow_execution_retention_time_updated_at_state
    ON workflow_execution (retention_time, updated_at, state)
    WHERE deleted_at IS NULL AND retention_time IS NOT NULL`,
]

export class DurableObjectWorkflowExecutionStore {
  constructor(private readonly storage: WorkflowExecutionDurableObjectStorage) {
    this.storage.sql.exec(workflowExecutionSchemaSql)
    for (const statement of workflowExecutionIndexesSql) {
      this.storage.sql.exec(statement)
    }
  }

  async save(record: CloudflareWorkflowExecutionStoreRecord): Promise<void> {
    const now = Date.now()
    const updatedAt = toTimestamp(record.updated_at) ?? now
    const id =
      record.id ??
      createWorkflowExecutionId(
        record.workflow_id,
        record.transaction_id,
        record.run_id
      )

    this.storage.sql.exec(
      `INSERT INTO workflow_execution (
        id,
        workflow_id,
        transaction_id,
        run_id,
        execution,
        context,
        state,
        retention_time,
        created_at,
        updated_at,
        deleted_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
      ON CONFLICT(workflow_id, transaction_id, run_id) DO UPDATE SET
        id = excluded.id,
        execution = excluded.execution,
        context = excluded.context,
        state = excluded.state,
        retention_time = excluded.retention_time,
        updated_at = excluded.updated_at,
        deleted_at = NULL`,
      id,
      record.workflow_id,
      record.transaction_id,
      record.run_id,
      JSON.stringify(record.execution),
      JSON.stringify(record.context),
      record.state,
      record.retention_time ?? null,
      now,
      updatedAt
    )
  }

  async deleteByRunId(runId: string): Promise<void> {
    const deletedAt = Date.now()

    this.storage.sql.exec(
      `UPDATE workflow_execution
      SET deleted_at = ?, updated_at = ?
      WHERE run_id = ? AND deleted_at IS NULL`,
      deletedAt,
      deletedAt,
      runId
    )
  }

  async findLatest(
    workflowId: string,
    transactionId: string
  ): Promise<CloudflareWorkflowExecutionStoreRecord | undefined> {
    const cursor = this.storage.sql.exec(
      `SELECT
        id,
        workflow_id,
        transaction_id,
        run_id,
        execution,
        context,
        state,
        retention_time,
        created_at,
        updated_at,
        deleted_at
      FROM workflow_execution
      WHERE workflow_id = ?
        AND transaction_id = ?
        AND deleted_at IS NULL
      ORDER BY updated_at DESC, id DESC
      LIMIT 1`,
      workflowId,
      transactionId
    )
    const row = parseWorkflowExecutionRow(Array.from(cursor.raw())[0])

    return row ? toStoreRecord(row) : undefined
  }

  async listExpirableFinished(): Promise<CloudflareExpirableWorkflowExecution[]> {
    const cursor = this.storage.sql.exec(
      `SELECT
        workflow_id,
        transaction_id,
        run_id,
        updated_at,
        retention_time
      FROM workflow_execution
      WHERE deleted_at IS NULL
        AND retention_time IS NOT NULL
        AND state IN ('done', 'failed', 'reverted')`
    )

    return Array.from(cursor.raw()).map(parseExpirableWorkflowExecutionRow)
  }

  async delete(executions: CloudflareExpirableWorkflowExecution[]): Promise<void> {
    if (!executions.length) {
      return
    }

    const deletedAt = Date.now()
    for (const execution of executions) {
      this.storage.sql.exec(
        `UPDATE workflow_execution
        SET deleted_at = ?, updated_at = ?
        WHERE workflow_id = ?
          AND transaction_id = ?
          AND run_id = ?
          AND deleted_at IS NULL`,
        deletedAt,
        deletedAt,
        execution.workflow_id,
        execution.transaction_id,
        execution.run_id
      )
    }
  }

  async getPersistedExecution(
    workflowId: string,
    transactionId: string
  ): Promise<PersistedCloudflareWorkflowExecution | undefined> {
    const cursor = this.storage.sql.exec(
      `SELECT
        id,
        workflow_id,
        transaction_id,
        run_id,
        execution,
        context,
        state,
        retention_time,
        created_at,
        updated_at,
        deleted_at
      FROM workflow_execution
      WHERE workflow_id = ? AND transaction_id = ?
      ORDER BY updated_at DESC, id DESC
      LIMIT 1`,
      workflowId,
      transactionId
    )
    const row = parseWorkflowExecutionRow(Array.from(cursor.raw())[0])

    return row ? toPersistedExecution(row) : undefined
  }
}

function toStoreRecord(
  row: WorkflowExecutionRow
): CloudflareWorkflowExecutionStoreRecord {
  return {
    id: row.id,
    workflow_id: row.workflow_id,
    transaction_id: row.transaction_id,
    run_id: row.run_id,
    execution: parseJsonRecord(row.execution_json, "execution"),
    context: parseWorkflowExecutionContext(row.context_json),
    state: row.state,
    retention_time: row.retention_time,
    updated_at: row.updated_at,
  }
}

function toPersistedExecution(
  row: WorkflowExecutionRow
): PersistedCloudflareWorkflowExecution {
  return {
    id: row.id,
    workflowId: row.workflow_id,
    transactionId: row.transaction_id,
    runId: row.run_id,
    execution: parseJsonRecord(row.execution_json, "execution"),
    context: parseWorkflowExecutionContext(row.context_json),
    state: row.state,
    retentionTime: row.retention_time,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  }
}

function parseWorkflowExecutionRow(
  row: SqlStorageValue[] | undefined
): WorkflowExecutionRow | undefined {
  if (!row) {
    return undefined
  }

  const [
    id,
    workflowId,
    transactionId,
    runId,
    executionJson,
    contextJson,
    state,
    retentionTime,
    createdAt,
    updatedAt,
    deletedAt,
  ] = row

  if (
    typeof id !== "string" ||
    typeof workflowId !== "string" ||
    typeof transactionId !== "string" ||
    typeof runId !== "string" ||
    typeof executionJson !== "string" ||
    typeof contextJson !== "string" ||
    typeof state !== "string" ||
    !isNullableNumber(retentionTime) ||
    typeof createdAt !== "number" ||
    typeof updatedAt !== "number" ||
    !isNullableNumber(deletedAt)
  ) {
    throw new Error("Persisted workflow execution row has an invalid shape")
  }

  return {
    id,
    workflow_id: workflowId,
    transaction_id: transactionId,
    run_id: runId,
    execution_json: executionJson,
    context_json: contextJson,
    state,
    retention_time: retentionTime,
    created_at: createdAt,
    updated_at: updatedAt,
    deleted_at: deletedAt,
  }
}

function parseExpirableWorkflowExecutionRow(
  row: SqlStorageValue[]
): CloudflareExpirableWorkflowExecution {
  const [workflowId, transactionId, runId, updatedAt, retentionTime] = row

  if (
    typeof workflowId !== "string" ||
    typeof transactionId !== "string" ||
    typeof runId !== "string" ||
    typeof updatedAt !== "number" ||
    typeof retentionTime !== "number"
  ) {
    throw new Error("Persisted expirable workflow execution row is invalid")
  }

  return {
    workflow_id: workflowId,
    transaction_id: transactionId,
    run_id: runId,
    updated_at: updatedAt,
    retention_time: retentionTime,
  }
}

function parseWorkflowExecutionContext(value: string): {
  data: Record<string, unknown>
  errors: unknown[]
} {
  const parsed = parseJsonRecord(value, "context")
  const data = parsed.data
  const errors = parsed.errors

  return {
    data: isRecord(data) ? data : {},
    errors: Array.isArray(errors) ? errors : [],
  }
}

function parseJsonRecord(
  value: string,
  label: "context" | "execution"
): Record<string, unknown> {
  const parsed: unknown = JSON.parse(value)
  if (!isRecord(parsed)) {
    throw new Error(`Persisted workflow execution ${label} must be an object`)
  }

  return parsed
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value))
}

function isNullableNumber(value: SqlStorageValue): value is number | null {
  return value === null || typeof value === "number"
}

function toTimestamp(value: Date | string | number | undefined): number | undefined {
  if (value === undefined) {
    return undefined
  }

  if (typeof value === "number") {
    return value
  }

  const timestamp = new Date(value).getTime()
  if (Number.isNaN(timestamp)) {
    throw new Error("Workflow execution timestamp is invalid")
  }

  return timestamp
}

function createWorkflowExecutionId(
  workflowId: string,
  transactionId: string,
  runId: string
): string {
  return `wf_exec_${hashText(`${workflowId}:${transactionId}:${runId}`)}`
}

function hashText(value: string): string {
  let hash = 0
  for (let index = 0; index < value.length; index++) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0
  }

  return hash.toString(36)
}
