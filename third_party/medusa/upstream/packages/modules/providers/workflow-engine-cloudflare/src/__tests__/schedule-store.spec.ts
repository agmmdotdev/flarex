import { DurableObjectWorkflowScheduleStore } from "../schedule-store"
import type {
  WorkflowScheduleDurableObjectStorage,
  WorkerScheduledWorkflow,
} from "../schedule-store"

describe("DurableObjectWorkflowScheduleStore", () => {
  beforeEach(() => {
    jest.spyOn(Date, "now").mockReturnValue(1000)
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  it("persists interval schedules and schedules the next Durable Object alarm", async () => {
    const storage = new FakeWorkflowScheduleStorage()
    const store = new DurableObjectWorkflowScheduleStore(storage)

    await store.set("interval-workflow", {
      timer: 1 as ReturnType<typeof setTimeout>,
      expression: 5000,
      numberOfExecutions: 0,
      config: {
        interval: 5000,
        numberOfExecutions: 1,
      },
    })

    const persisted = await store.getPersistedSchedule("interval-workflow")

    expect(persisted).toMatchObject({
      jobId: "interval-workflow",
      expressionType: "interval",
      expressionValue: 5000,
      numberOfExecutions: 0,
      nextExecutionAt: 6000,
      config: {
        interval: 5000,
        numberOfExecutions: 1,
      },
    })
    await expect(store.getScheduledAlarm()).resolves.toBe(6000)
  })

  it("rejects cron schedules before persisting runtime or Durable Object state", async () => {
    const storage = new FakeWorkflowScheduleStorage()
    const store = new DurableObjectWorkflowScheduleStore(storage)
    const cronSchedule: WorkerScheduledWorkflow = {
      timer: 1 as ReturnType<typeof setTimeout>,
      expression: {
        next: () => ({
          getTime: () => 6000,
        }),
      },
      numberOfExecutions: 0,
      config: {
        cron: "* * * * *",
      },
    }

    await expect(store.set("cron-workflow", cronSchedule)).rejects.toThrow(
      "Cloudflare workflow schedule store only supports interval schedules"
    )

    await expect(store.get("cron-workflow")).resolves.toBeUndefined()
    await expect(
      store.getPersistedSchedule("cron-workflow")
    ).resolves.toBeUndefined()
    await expect(store.getScheduledAlarm()).resolves.toBeNull()
  })
})

type SqlRow = [string, string, string | number, number, number, string]
type AlarmRow = [number]
type EmptyRow = never
type QueryRow = SqlRow | AlarmRow | EmptyRow

class FakeSqlCursor implements ReturnType<WorkflowScheduleDurableObjectStorage["sql"]["exec"]> {
  constructor(private readonly rows: QueryRow[]) {}

  *raw(): IterableIterator<SqlStorageValue[]> {
    for (const row of this.rows) {
      yield row
    }
  }
}

class FakeWorkflowScheduleStorage
  implements WorkflowScheduleDurableObjectStorage
{
  readonly rows = new Map<string, SqlRow>()
  alarm: number | null = null

  readonly sql = {
    exec: (
      statement: string,
      ...bindings: SqlStorageValue[]
    ): FakeSqlCursor => {
      const normalized = statement.trim()

      if (normalized.startsWith("CREATE TABLE")) {
        return new FakeSqlCursor([])
      }

      if (normalized.startsWith("INSERT INTO medusa_workflow_schedule_store")) {
        const row = toScheduleRow(bindings)
        this.rows.set(row[0], row)
        return new FakeSqlCursor([])
      }

      if (
        normalized.startsWith("SELECT") &&
        normalized.includes("WHERE job_id = ?")
      ) {
        const jobId = bindings[0]
        if (typeof jobId !== "string") {
          throw new Error("Expected workflow schedule job id binding")
        }

        const row = this.rows.get(jobId)
        return new FakeSqlCursor(row ? [row] : [])
      }

      if (
        normalized.startsWith("SELECT next_execution_at") &&
        normalized.includes("LIMIT 1")
      ) {
        const nextExecutionAt = [...this.rows.values()]
          .map((row) => row[4])
          .sort((first, second) => first - second)[0]

        return new FakeSqlCursor(
          nextExecutionAt === undefined ? [] : [[nextExecutionAt]]
        )
      }

      if (normalized.startsWith("DELETE FROM medusa_workflow_schedule_store")) {
        const jobId = bindings[0]
        if (typeof jobId === "string") {
          this.rows.delete(jobId)
        } else {
          this.rows.clear()
        }

        return new FakeSqlCursor([])
      }

      throw new Error(`Unexpected SQL statement: ${normalized}`)
    },
  }

  async deleteAlarm(): Promise<void> {
    this.alarm = null
  }

  async getAlarm(): Promise<number | null> {
    return this.alarm
  }

  async setAlarm(scheduledTime: number): Promise<void> {
    this.alarm = scheduledTime
  }
}

function toScheduleRow(bindings: SqlStorageValue[]): SqlRow {
  const [
    jobId,
    expressionType,
    expressionValue,
    numberOfExecutions,
    nextExecutionAt,
    configJson,
  ] = bindings

  if (
    typeof jobId !== "string" ||
    typeof expressionType !== "string" ||
    (typeof expressionValue !== "string" &&
      typeof expressionValue !== "number") ||
    typeof numberOfExecutions !== "number" ||
    typeof nextExecutionAt !== "number" ||
    typeof configJson !== "string"
  ) {
    throw new Error("Invalid workflow schedule SQL bindings")
  }

  return [
    jobId,
    expressionType,
    expressionValue,
    numberOfExecutions,
    nextExecutionAt,
    configJson,
  ]
}
