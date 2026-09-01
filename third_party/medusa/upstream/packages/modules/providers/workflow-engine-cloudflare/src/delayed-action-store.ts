export type CloudflareWorkflowDelayedActionKind =
  | "retry-step"
  | "step-timeout"
  | "transaction-timeout"

export interface CloudflareWorkflowDelayedActionContext {
  eventGroupId?: string
  parentStepIdempotencyKey?: string
  preventReleaseEvents?: boolean
}

export interface CloudflareWorkflowDelayedAction {
  id: string
  kind: CloudflareWorkflowDelayedActionKind
  workflowId: string
  transactionId: string
  stepId?: string
  dueAt: number
  context: CloudflareWorkflowDelayedActionContext
}

export type CloudflareWorkflowDelayedActionHandler = (
  action: CloudflareWorkflowDelayedAction
) => void | Promise<void>

export interface PersistedCloudflareWorkflowDelayedAction
  extends CloudflareWorkflowDelayedAction {
  createdAt: number
  updatedAt: number
  handledAt: number | null
  cancelledAt: number | null
}

export interface WorkflowDelayedActionRecoveryResult {
  dueCount: number
  recoveredActionIds: string[]
  failedActionIds: string[]
}

interface WorkflowDelayedActionRow {
  action_id: string
  kind: CloudflareWorkflowDelayedActionKind
  workflow_id: string
  transaction_id: string
  step_id: string | null
  due_at: number
  context_json: string
  created_at: number
  updated_at: number
  handled_at: number | null
  cancelled_at: number | null
}

interface WorkflowDelayedActionSqlCursor {
  raw(): IterableIterator<SqlStorageValue[]>
}

interface WorkflowDelayedActionSqlStorage {
  exec(
    statement: string,
    ...bindings: SqlStorageValue[]
  ): WorkflowDelayedActionSqlCursor
}

export interface WorkflowDelayedActionDurableObjectStorage {
  sql: WorkflowDelayedActionSqlStorage
  deleteAlarm(): Promise<void>
  getAlarm(): Promise<number | null>
  setAlarm(scheduledTime: number): Promise<void>
}

const workflowDelayedActionSchemaSql = `
CREATE TABLE IF NOT EXISTS medusa_workflow_delayed_action_store (
  action_id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  workflow_id TEXT NOT NULL,
  transaction_id TEXT NOT NULL,
  step_id TEXT NULL,
  due_at INTEGER NOT NULL,
  context_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  handled_at INTEGER NULL,
  cancelled_at INTEGER NULL
);
`

const workflowDelayedActionIndexesSql = [
  `CREATE INDEX IF NOT EXISTS IDX_workflow_delayed_action_due_pending
    ON medusa_workflow_delayed_action_store (due_at)
    WHERE handled_at IS NULL AND cancelled_at IS NULL`,
  `CREATE INDEX IF NOT EXISTS IDX_workflow_delayed_action_workflow_transaction
    ON medusa_workflow_delayed_action_store (workflow_id, transaction_id)
    WHERE handled_at IS NULL AND cancelled_at IS NULL`,
]

export class DurableObjectWorkflowDelayedActionStore {
  private readonly runtimeHandlers = new Map<
    string,
    CloudflareWorkflowDelayedActionHandler
  >()

  constructor(
    private readonly storage: WorkflowDelayedActionDurableObjectStorage
  ) {
    this.storage.sql.exec(workflowDelayedActionSchemaSql)
    for (const statement of workflowDelayedActionIndexesSql) {
      this.storage.sql.exec(statement)
    }
  }

  async get(
    actionId: string
  ): Promise<CloudflareWorkflowDelayedAction | undefined> {
    const action = await this.getPersistedDelayedAction(actionId)

    if (!action || action.handledAt !== null || action.cancelledAt !== null) {
      return undefined
    }

    return toDelayedAction(action)
  }

  async set(
    action: CloudflareWorkflowDelayedAction,
    handler: CloudflareWorkflowDelayedActionHandler
  ): Promise<void> {
    const now = Date.now()
    this.runtimeHandlers.set(action.id, handler)
    this.storage.sql.exec(
      `INSERT INTO medusa_workflow_delayed_action_store (
        action_id,
        kind,
        workflow_id,
        transaction_id,
        step_id,
        due_at,
        context_json,
        created_at,
        updated_at,
        handled_at,
        cancelled_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)
      ON CONFLICT(action_id) DO UPDATE SET
        kind = excluded.kind,
        workflow_id = excluded.workflow_id,
        transaction_id = excluded.transaction_id,
        step_id = excluded.step_id,
        due_at = excluded.due_at,
        context_json = excluded.context_json,
        updated_at = excluded.updated_at,
        handled_at = NULL,
        cancelled_at = NULL`,
      action.id,
      action.kind,
      action.workflowId,
      action.transactionId,
      action.stepId ?? null,
      action.dueAt,
      JSON.stringify(action.context),
      now,
      now
    )
    await this.rescheduleAlarm()
  }

  async delete(actionId: string): Promise<void> {
    this.runtimeHandlers.delete(actionId)
    const cancelledAt = Date.now()
    this.storage.sql.exec(
      `UPDATE medusa_workflow_delayed_action_store
      SET cancelled_at = ?, updated_at = ?
      WHERE action_id = ? AND handled_at IS NULL AND cancelled_at IS NULL`,
      cancelledAt,
      cancelledAt,
      actionId
    )
    await this.rescheduleAlarm()
  }

  async clear(): Promise<void> {
    this.runtimeHandlers.clear()
    this.storage.sql.exec("DELETE FROM medusa_workflow_delayed_action_store")
    await this.storage.deleteAlarm()
  }

  async entries(): Promise<
    Iterable<[string, CloudflareWorkflowDelayedAction]>
  > {
    const actions = await this.listPendingPersistedActions()

    return actions.map((action) => [action.id, action])
  }

  clearRuntimeHandlers(): void {
    this.runtimeHandlers.clear()
  }

  async getScheduledAlarm(): Promise<number | null> {
    return await this.storage.getAlarm()
  }

  async getPersistedDelayedAction(
    actionId: string
  ): Promise<PersistedCloudflareWorkflowDelayedAction | undefined> {
    const cursor = this.storage.sql.exec(
      `SELECT
        action_id,
        kind,
        workflow_id,
        transaction_id,
        step_id,
        due_at,
        context_json,
        created_at,
        updated_at,
        handled_at,
        cancelled_at
      FROM medusa_workflow_delayed_action_store
      WHERE action_id = ?`,
      actionId
    )
    const row = parseDelayedActionRow(Array.from(cursor.raw())[0])

    return row ? toPersistedDelayedAction(row) : undefined
  }

  async listDuePersistedActions(
    now = Date.now()
  ): Promise<CloudflareWorkflowDelayedAction[]> {
    const cursor = this.storage.sql.exec(
      `SELECT
        action_id,
        kind,
        workflow_id,
        transaction_id,
        step_id,
        due_at,
        context_json,
        created_at,
        updated_at,
        handled_at,
        cancelled_at
      FROM medusa_workflow_delayed_action_store
      WHERE due_at <= ?
        AND handled_at IS NULL
        AND cancelled_at IS NULL
      ORDER BY due_at ASC, action_id ASC`,
      now
    )

    return Array.from(cursor.raw())
      .map(parseDelayedActionRow)
      .filter(isDefined)
      .map(toPersistedDelayedAction)
      .map(toDelayedAction)
  }

  async recoverDueActions(
    runAction: (action: CloudflareWorkflowDelayedAction) => Promise<void>,
    now = Date.now()
  ): Promise<WorkflowDelayedActionRecoveryResult> {
    const dueActions = await this.listDuePersistedActions(now)
    const recoveredActionIds: string[] = []
    const failedActionIds: string[] = []

    for (const action of dueActions) {
      try {
        await runAction(action)
        await this.markHandled(action.id, now)
        this.runtimeHandlers.delete(action.id)
        recoveredActionIds.push(action.id)
      } catch {
        failedActionIds.push(action.id)
      }
    }

    await this.rescheduleAlarm()

    return {
      dueCount: dueActions.length,
      recoveredActionIds,
      failedActionIds,
    }
  }

  private async listPendingPersistedActions(): Promise<
    CloudflareWorkflowDelayedAction[]
  > {
    const cursor = this.storage.sql.exec(
      `SELECT
        action_id,
        kind,
        workflow_id,
        transaction_id,
        step_id,
        due_at,
        context_json,
        created_at,
        updated_at,
        handled_at,
        cancelled_at
      FROM medusa_workflow_delayed_action_store
      WHERE handled_at IS NULL
        AND cancelled_at IS NULL
      ORDER BY due_at ASC, action_id ASC`
    )

    return Array.from(cursor.raw())
      .map(parseDelayedActionRow)
      .filter(isDefined)
      .map(toPersistedDelayedAction)
      .map(toDelayedAction)
  }

  private async markHandled(actionId: string, handledAt: number): Promise<void> {
    this.storage.sql.exec(
      `UPDATE medusa_workflow_delayed_action_store
      SET handled_at = ?, updated_at = ?
      WHERE action_id = ? AND handled_at IS NULL`,
      handledAt,
      handledAt,
      actionId
    )
  }

  private async rescheduleAlarm(): Promise<void> {
    const cursor = this.storage.sql.exec(
      `SELECT due_at
      FROM medusa_workflow_delayed_action_store
      WHERE handled_at IS NULL AND cancelled_at IS NULL
      ORDER BY due_at ASC
      LIMIT 1`
    )
    const row = Array.from(cursor.raw())[0]
    const dueAt = parseAlarmRow(row)

    if (dueAt === undefined) {
      await this.storage.deleteAlarm()
      return
    }

    await this.storage.setAlarm(dueAt)
  }
}

function toPersistedDelayedAction(
  row: WorkflowDelayedActionRow
): PersistedCloudflareWorkflowDelayedAction {
  return {
    id: row.action_id,
    kind: row.kind,
    workflowId: row.workflow_id,
    transactionId: row.transaction_id,
    stepId: row.step_id ?? undefined,
    dueAt: row.due_at,
    context: parseDelayedActionContext(row.context_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    handledAt: row.handled_at,
    cancelledAt: row.cancelled_at,
  }
}

function toDelayedAction(
  action: PersistedCloudflareWorkflowDelayedAction
): CloudflareWorkflowDelayedAction {
  return {
    id: action.id,
    kind: action.kind,
    workflowId: action.workflowId,
    transactionId: action.transactionId,
    stepId: action.stepId,
    dueAt: action.dueAt,
    context: action.context,
  }
}

function parseDelayedActionRow(
  row: SqlStorageValue[] | undefined
): WorkflowDelayedActionRow | undefined {
  if (!row) {
    return undefined
  }

  const [
    actionId,
    kind,
    workflowId,
    transactionId,
    stepId,
    dueAt,
    contextJson,
    createdAt,
    updatedAt,
    handledAt,
    cancelledAt,
  ] = row

  if (
    typeof actionId !== "string" ||
    !isDelayedActionKind(kind) ||
    typeof workflowId !== "string" ||
    typeof transactionId !== "string" ||
    !isNullableString(stepId) ||
    typeof dueAt !== "number" ||
    typeof contextJson !== "string" ||
    typeof createdAt !== "number" ||
    typeof updatedAt !== "number" ||
    !isNullableNumber(handledAt) ||
    !isNullableNumber(cancelledAt)
  ) {
    throw new Error("Persisted workflow delayed action row has an invalid shape")
  }

  return {
    action_id: actionId,
    kind,
    workflow_id: workflowId,
    transaction_id: transactionId,
    step_id: stepId,
    due_at: dueAt,
    context_json: contextJson,
    created_at: createdAt,
    updated_at: updatedAt,
    handled_at: handledAt,
    cancelled_at: cancelledAt,
  }
}

function parseDelayedActionContext(
  value: string
): CloudflareWorkflowDelayedActionContext {
  const parsed: unknown = JSON.parse(value)

  if (!isRecord(parsed)) {
    throw new Error("Persisted workflow delayed action context must be an object")
  }

  const eventGroupId = parsed.eventGroupId
  const parentStepIdempotencyKey = parsed.parentStepIdempotencyKey
  const preventReleaseEvents = parsed.preventReleaseEvents

  return {
    eventGroupId:
      typeof eventGroupId === "string" ? eventGroupId : undefined,
    parentStepIdempotencyKey:
      typeof parentStepIdempotencyKey === "string"
        ? parentStepIdempotencyKey
        : undefined,
    preventReleaseEvents:
      typeof preventReleaseEvents === "boolean"
        ? preventReleaseEvents
        : undefined,
  }
}

function parseAlarmRow(row: SqlStorageValue[] | undefined): number | undefined {
  const dueAt = row?.[0]
  if (dueAt === undefined) {
    return undefined
  }

  if (typeof dueAt !== "number") {
    throw new Error("Persisted workflow delayed action alarm row is invalid")
  }

  return dueAt
}

function isDelayedActionKind(
  value: SqlStorageValue
): value is CloudflareWorkflowDelayedActionKind {
  return (
    value === "retry-step" ||
    value === "step-timeout" ||
    value === "transaction-timeout"
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value))
}

function isNullableNumber(value: SqlStorageValue): value is number | null {
  return value === null || typeof value === "number"
}

function isNullableString(value: SqlStorageValue): value is string | null {
  return value === null || typeof value === "string"
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined
}
