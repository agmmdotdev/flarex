import type { SchedulerOptions } from "@medusajs/orchestration/transaction"

type TimerHandle = ReturnType<typeof setTimeout>

type WorkflowCronExpression = {
  next(): {
    getTime(): number
  }
}

export interface WorkerScheduledWorkflow {
  timer: TimerHandle
  expression: WorkflowCronExpression | number
  numberOfExecutions: number
  config: SchedulerOptions
}

export interface PersistedWorkflowSchedule {
  jobId: string
  expressionType: "interval" | "cron"
  expressionValue: string | number
  numberOfExecutions: number
  nextExecutionAt: number
  config: SchedulerOptions
}

export interface WorkflowScheduleAlarmRecoveryResult {
  dueCount: number
  recoveredJobIds: string[]
  skippedRuntimeJobIds: string[]
  deletedJobIds: string[]
}

interface WorkflowScheduleRecord {
  job_id: string
  expression_type: string
  expression_value: string | number
  number_of_executions: number
  next_execution_at: number
  config_json: string
}

interface WorkflowScheduleSqlCursor {
  raw(): IterableIterator<SqlStorageValue[]>
}

interface WorkflowScheduleSqlStorage {
  exec(
    statement: string,
    ...bindings: SqlStorageValue[]
  ): WorkflowScheduleSqlCursor
}

export interface WorkflowScheduleDurableObjectStorage {
  sql: WorkflowScheduleSqlStorage
  deleteAlarm(): Promise<void>
  getAlarm(): Promise<number | null>
  setAlarm(scheduledTime: number): Promise<void>
}

const workflowScheduleStoreSchemaSql = `
CREATE TABLE IF NOT EXISTS medusa_workflow_schedule_store (
  job_id TEXT PRIMARY KEY,
  expression_type TEXT NOT NULL,
  expression_value TEXT NOT NULL,
  number_of_executions INTEGER NOT NULL,
  next_execution_at INTEGER NOT NULL,
  config_json TEXT NOT NULL
);
`

export class DurableObjectWorkflowScheduleStore {
  private readonly runtimeSchedules = new Map<string, WorkerScheduledWorkflow>()

  constructor(private readonly storage: WorkflowScheduleDurableObjectStorage) {
    this.storage.sql.exec(workflowScheduleStoreSchemaSql)
  }

  async get(jobId: string): Promise<WorkerScheduledWorkflow | undefined> {
    return this.runtimeSchedules.get(jobId)
  }

  async set(jobId: string, job: WorkerScheduledWorkflow): Promise<void> {
    const persisted = serializeSchedule(jobId, job)

    this.runtimeSchedules.set(jobId, job)
    this.storage.sql.exec(
      `INSERT INTO medusa_workflow_schedule_store (
        job_id,
        expression_type,
        expression_value,
        number_of_executions,
        next_execution_at,
        config_json
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(job_id) DO UPDATE SET
        expression_type = excluded.expression_type,
        expression_value = excluded.expression_value,
        number_of_executions = excluded.number_of_executions,
        next_execution_at = excluded.next_execution_at,
        config_json = excluded.config_json`,
      persisted.job_id,
      persisted.expression_type,
      persisted.expression_value,
      persisted.number_of_executions,
      persisted.next_execution_at,
      persisted.config_json
    )
    await this.rescheduleAlarm()
  }

  async delete(jobId: string): Promise<void> {
    this.runtimeSchedules.delete(jobId)
    this.storage.sql.exec(
      "DELETE FROM medusa_workflow_schedule_store WHERE job_id = ?",
      jobId
    )
    await this.rescheduleAlarm()
  }

  async clear(): Promise<void> {
    this.runtimeSchedules.clear()
    this.storage.sql.exec("DELETE FROM medusa_workflow_schedule_store")
    await this.storage.deleteAlarm()
  }

  async entries(): Promise<Iterable<[string, WorkerScheduledWorkflow]>> {
    return [...this.runtimeSchedules.entries()]
  }

  clearRuntimeSchedules(): void {
    this.runtimeSchedules.clear()
  }

  async getScheduledAlarm(): Promise<number | null> {
    return await this.storage.getAlarm()
  }

  async getPersistedSchedule(
    jobId: string
  ): Promise<PersistedWorkflowSchedule | undefined> {
    const cursor = this.storage.sql.exec(
      `SELECT
        job_id,
        expression_type,
        expression_value,
        number_of_executions,
        next_execution_at,
        config_json
      FROM medusa_workflow_schedule_store
      WHERE job_id = ?`,
      jobId
    )
    const row = parseScheduleRow(Array.from(cursor.raw())[0])

    if (!row) {
      return undefined
    }

    return deserializeSchedule(row)
  }

  async recoverDueSchedules(
    runWorkflow: (jobId: string) => Promise<void>,
    now = Date.now()
  ): Promise<WorkflowScheduleAlarmRecoveryResult> {
    const dueSchedules = await this.listDuePersistedSchedules(now)
    const recoveredJobIds: string[] = []
    const skippedRuntimeJobIds: string[] = []
    const deletedJobIds: string[] = []

    for (const schedule of dueSchedules) {
      if (this.runtimeSchedules.has(schedule.jobId)) {
        skippedRuntimeJobIds.push(schedule.jobId)
        continue
      }

      if (
        schedule.config.numberOfExecutions !== undefined &&
        schedule.config.numberOfExecutions <= schedule.numberOfExecutions
      ) {
        await this.delete(schedule.jobId)
        deletedJobIds.push(schedule.jobId)
        continue
      }

      await runWorkflow(schedule.jobId)
      recoveredJobIds.push(schedule.jobId)
      await this.recordRecoveredExecution(schedule, now)
    }

    await this.rescheduleAlarm()

    return {
      dueCount: dueSchedules.length,
      recoveredJobIds,
      skippedRuntimeJobIds,
      deletedJobIds,
    }
  }

  private async listDuePersistedSchedules(
    now: number
  ): Promise<PersistedWorkflowSchedule[]> {
    const cursor = this.storage.sql.exec(
      `SELECT
        job_id,
        expression_type,
        expression_value,
        number_of_executions,
        next_execution_at,
        config_json
      FROM medusa_workflow_schedule_store
      WHERE next_execution_at <= ?
      ORDER BY next_execution_at ASC`,
      now
    )

    return Array.from(cursor.raw())
      .map(parseScheduleRow)
      .filter(isDefined)
      .map(deserializeSchedule)
  }

  private async recordRecoveredExecution(
    schedule: PersistedWorkflowSchedule,
    now: number
  ): Promise<void> {
    const numberOfExecutions = schedule.numberOfExecutions + 1
    const nextExecutionAt = calculateNextExecutionAt(schedule, now)

    this.storage.sql.exec(
      `UPDATE medusa_workflow_schedule_store
      SET number_of_executions = ?, next_execution_at = ?
      WHERE job_id = ?`,
      numberOfExecutions,
      nextExecutionAt,
      schedule.jobId
    )
  }

  private async rescheduleAlarm(): Promise<void> {
    const cursor = this.storage.sql.exec(
      `SELECT next_execution_at
      FROM medusa_workflow_schedule_store
      ORDER BY next_execution_at ASC
      LIMIT 1`
    )
    const row = Array.from(cursor.raw())[0]
    const nextExecutionAt = parseAlarmRow(row)

    if (nextExecutionAt === undefined) {
      await this.storage.deleteAlarm()
      return
    }

    await this.storage.setAlarm(nextExecutionAt)
  }
}

function serializeSchedule(
  jobId: string,
  job: WorkerScheduledWorkflow
): WorkflowScheduleRecord {
  if (typeof job.expression === "number") {
    return {
      job_id: jobId,
      expression_type: "interval",
      expression_value: job.expression,
      number_of_executions: job.numberOfExecutions,
      next_execution_at: Date.now() + job.expression,
      config_json: JSON.stringify(job.config),
    }
  }

  throw new Error(
    "Cloudflare workflow schedule store only supports interval schedules; cron schedules require a DO-alarm-native schedule adapter"
  )
}

function deserializeSchedule(
  row: WorkflowScheduleRecord
): PersistedWorkflowSchedule {
  const config = parseSchedulerOptions(row.config_json)

  return {
    jobId: row.job_id,
    expressionType: row.expression_type === "cron" ? "cron" : "interval",
    expressionValue:
      row.expression_type === "interval"
        ? Number(row.expression_value)
        : row.expression_value,
    numberOfExecutions: Number(row.number_of_executions),
    nextExecutionAt: Number(row.next_execution_at),
    config,
  }
}

function parseScheduleRow(
  row: SqlStorageValue[] | undefined
): WorkflowScheduleRecord | undefined {
  if (!row) {
    return undefined
  }

  const [
    jobId,
    expressionType,
    expressionValue,
    numberOfExecutions,
    nextExecutionAt,
    configJson,
  ] = row

  if (
    typeof jobId !== "string" ||
    typeof expressionType !== "string" ||
    (typeof expressionValue !== "string" &&
      typeof expressionValue !== "number") ||
    typeof numberOfExecutions !== "number" ||
    typeof nextExecutionAt !== "number" ||
    typeof configJson !== "string"
  ) {
    throw new Error("Persisted workflow schedule row has an invalid shape")
  }

  return {
    job_id: jobId,
    expression_type: expressionType,
    expression_value: expressionValue,
    number_of_executions: numberOfExecutions,
    next_execution_at: nextExecutionAt,
    config_json: configJson,
  }
}

function parseAlarmRow(row: SqlStorageValue[] | undefined): number | undefined {
  const nextExecutionAt = row?.[0]
  if (nextExecutionAt === undefined) {
    return undefined
  }

  if (typeof nextExecutionAt !== "number") {
    throw new Error("Persisted workflow schedule alarm row is invalid")
  }

  return nextExecutionAt
}

function calculateNextExecutionAt(
  schedule: PersistedWorkflowSchedule,
  now: number
): number {
  if (schedule.expressionType === "interval") {
    const interval =
      typeof schedule.expressionValue === "number"
        ? schedule.expressionValue
        : Number(schedule.expressionValue)

    return now + interval
  }

  throw new Error("Cron alarm recovery requires a DO-alarm-native schedule")
}

function parseSchedulerOptions(value: string): SchedulerOptions {
  const parsed: unknown = JSON.parse(value)

  if (!isRecord(parsed)) {
    throw new Error("Persisted workflow schedule config must be an object")
  }

  const concurrency = parsed.concurrency
  if (
    concurrency !== undefined &&
    concurrency !== "allow" &&
    concurrency !== "forbid"
  ) {
    throw new Error("Persisted workflow schedule concurrency is invalid")
  }

  const numberOfExecutions = parsed.numberOfExecutions
  if (
    numberOfExecutions !== undefined &&
    typeof numberOfExecutions !== "number"
  ) {
    throw new Error("Persisted workflow schedule execution limit is invalid")
  }

  if (typeof parsed.interval === "number") {
    return {
      interval: parsed.interval,
      concurrency,
      numberOfExecutions,
    }
  }

  if (typeof parsed.cron === "string") {
    return {
      cron: parsed.cron,
      concurrency,
      numberOfExecutions,
    }
  }

  throw new Error("Persisted workflow schedule must define interval or cron")
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value))
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined
}
