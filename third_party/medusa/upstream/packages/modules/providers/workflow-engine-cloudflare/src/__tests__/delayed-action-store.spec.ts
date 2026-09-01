import { DurableObjectWorkflowDelayedActionStore } from "../delayed-action-store"
import type {
  CloudflareWorkflowDelayedAction,
  WorkflowDelayedActionDurableObjectStorage,
} from "../delayed-action-store"

describe("DurableObjectWorkflowDelayedActionStore", () => {
  beforeEach(() => {
    jest.spyOn(Date, "now").mockReturnValue(1000)
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  it("persists delayed actions and schedules the earliest Durable Object alarm", async () => {
    const storage = new FakeWorkflowDelayedActionStorage()
    const store = new DurableObjectWorkflowDelayedActionStore(storage)
    const retryAction = createDelayedAction({
      id: "retry-step:workflow:transaction:step",
      kind: "retry-step",
      dueAt: 5000,
    })
    const timeoutAction = createDelayedAction({
      id: "transaction-timeout:workflow:transaction",
      kind: "transaction-timeout",
      stepId: undefined,
      dueAt: 3000,
    })

    await store.set(retryAction, jest.fn())
    await store.set(timeoutAction, jest.fn())

    await expect(store.get(retryAction.id)).resolves.toMatchObject(
      retryAction
    )
    await expect(
      store.getPersistedDelayedAction(retryAction.id)
    ).resolves.toMatchObject({
      ...retryAction,
      createdAt: 1000,
      updatedAt: 1000,
      handledAt: null,
      cancelledAt: null,
    })
    await expect(store.getScheduledAlarm()).resolves.toBe(3000)
  })

  it("cancels pending actions and reschedules the Durable Object alarm", async () => {
    const storage = new FakeWorkflowDelayedActionStorage()
    const store = new DurableObjectWorkflowDelayedActionStore(storage)
    const first = createDelayedAction({
      id: "retry-step:workflow:transaction:first",
      dueAt: 3000,
    })
    const second = createDelayedAction({
      id: "retry-step:workflow:transaction:second",
      dueAt: 6000,
    })

    await store.set(first, jest.fn())
    await store.set(second, jest.fn())
    await store.delete(first.id)

    await expect(store.get(first.id)).resolves.toBeUndefined()
    await expect(
      store.getPersistedDelayedAction(first.id)
    ).resolves.toMatchObject({
      id: first.id,
      cancelledAt: 1000,
    })
    await expect(store.getScheduledAlarm()).resolves.toBe(6000)
  })

  it("lists due actions, records successful recovery, and keeps failed actions pending", async () => {
    const storage = new FakeWorkflowDelayedActionStorage()
    const store = new DurableObjectWorkflowDelayedActionStore(storage)
    const recovered = createDelayedAction({
      id: "retry-step:workflow:transaction:recovered",
      dueAt: 2000,
    })
    const failed = createDelayedAction({
      id: "step-timeout:workflow:transaction:failed",
      kind: "step-timeout",
      dueAt: 2500,
    })
    const future = createDelayedAction({
      id: "transaction-timeout:workflow:transaction",
      kind: "transaction-timeout",
      stepId: undefined,
      dueAt: 9000,
    })

    await store.set(recovered, jest.fn())
    await store.set(failed, jest.fn())
    await store.set(future, jest.fn())

    const due = await store.listDuePersistedActions(3000)
    expect(due.map((action) => action.id)).toEqual([recovered.id, failed.id])

    const result = await store.recoverDueActions(async (action) => {
      if (action.id === failed.id) {
        throw new Error("recovery failed")
      }
    }, 3000)

    expect(result).toEqual({
      dueCount: 2,
      recoveredActionIds: [recovered.id],
      failedActionIds: [failed.id],
    })
    await expect(
      store.getPersistedDelayedAction(recovered.id)
    ).resolves.toMatchObject({
      id: recovered.id,
      handledAt: 3000,
      cancelledAt: null,
    })
    await expect(store.get(failed.id)).resolves.toMatchObject({
      id: failed.id,
    })
    await expect(store.getScheduledAlarm()).resolves.toBe(2500)
  })

  it("clears all persisted delayed actions and deletes the Durable Object alarm", async () => {
    const storage = new FakeWorkflowDelayedActionStorage()
    const store = new DurableObjectWorkflowDelayedActionStore(storage)
    const action = createDelayedAction({
      id: "retry-step:workflow:transaction:clear",
      dueAt: 2000,
    })

    await store.set(action, jest.fn())
    await store.clear()

    await expect(store.get(action.id)).resolves.toBeUndefined()
    await expect(store.getScheduledAlarm()).resolves.toBeNull()
  })
})

type DelayedActionRow = [
  string,
  string,
  string,
  string,
  string | null,
  number,
  string,
  number,
  number,
  number | null,
  number | null
]
type AlarmRow = [number]
type QueryRow = DelayedActionRow | AlarmRow

class FakeSqlCursor implements ReturnType<WorkflowDelayedActionDurableObjectStorage["sql"]["exec"]> {
  constructor(private readonly rows: QueryRow[]) {}

  *raw(): IterableIterator<SqlStorageValue[]> {
    for (const row of this.rows) {
      yield row
    }
  }
}

class FakeWorkflowDelayedActionStorage
  implements WorkflowDelayedActionDurableObjectStorage
{
  readonly rows = new Map<string, DelayedActionRow>()
  alarm: number | null = null

  readonly sql = {
    exec: (
      statement: string,
      ...bindings: SqlStorageValue[]
    ): FakeSqlCursor => {
      const normalized = statement.trim()

      if (
        normalized.startsWith("CREATE TABLE") ||
        normalized.startsWith("CREATE INDEX")
      ) {
        return new FakeSqlCursor([])
      }

      if (
        normalized.startsWith(
          "INSERT INTO medusa_workflow_delayed_action_store"
        )
      ) {
        const row = toDelayedActionRow(bindings)
        this.rows.set(row[0], row)
        return new FakeSqlCursor([])
      }

      if (
        normalized.startsWith("SELECT due_at") &&
        normalized.includes("LIMIT 1")
      ) {
        const dueAt = this.pendingRows()
          .map((row) => row[5])
          .sort((first, second) => first - second)[0]

        return new FakeSqlCursor(dueAt === undefined ? [] : [[dueAt]])
      }

      if (
        normalized.startsWith("SELECT") &&
        normalized.includes("WHERE action_id = ?")
      ) {
        const actionId = bindings[0]
        if (typeof actionId !== "string") {
          throw new Error("Expected workflow delayed action id binding")
        }

        const row = this.rows.get(actionId)
        return new FakeSqlCursor(row ? [row] : [])
      }

      if (
        normalized.startsWith("SELECT") &&
        normalized.includes("WHERE due_at <= ?")
      ) {
        const now = bindings[0]
        if (typeof now !== "number") {
          throw new Error("Expected workflow delayed action due binding")
        }

        return new FakeSqlCursor(
          this.pendingRows()
            .filter((row) => row[5] <= now)
            .sort(sortByDueAtThenId)
        )
      }

      if (
        normalized.startsWith("SELECT") &&
        normalized.includes("WHERE handled_at IS NULL") &&
        normalized.includes("cancelled_at IS NULL")
      ) {
        return new FakeSqlCursor(this.pendingRows().sort(sortByDueAtThenId))
      }

      if (
        normalized.startsWith(
          "UPDATE medusa_workflow_delayed_action_store"
        ) &&
        normalized.includes("SET cancelled_at")
      ) {
        const cancelledAt = bindings[0]
        const actionId = bindings[2]
        if (typeof cancelledAt !== "number" || typeof actionId !== "string") {
          throw new Error("Expected workflow delayed action cancel bindings")
        }

        this.updatePendingRow(actionId, (row) =>
          withState(row, {
            updatedAt: cancelledAt,
            cancelledAt,
          })
        )
        return new FakeSqlCursor([])
      }

      if (
        normalized.startsWith(
          "UPDATE medusa_workflow_delayed_action_store"
        ) &&
        normalized.includes("SET handled_at")
      ) {
        const handledAt = bindings[0]
        const actionId = bindings[2]
        if (typeof handledAt !== "number" || typeof actionId !== "string") {
          throw new Error("Expected workflow delayed action handled bindings")
        }

        this.updatePendingRow(actionId, (row) =>
          withState(row, {
            updatedAt: handledAt,
            handledAt,
          })
        )
        return new FakeSqlCursor([])
      }

      if (
        normalized.startsWith("DELETE FROM medusa_workflow_delayed_action_store")
      ) {
        this.rows.clear()
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

  private pendingRows(): DelayedActionRow[] {
    return [...this.rows.values()].filter(
      (row) => row[9] === null && row[10] === null
    )
  }

  private updatePendingRow(
    actionId: string,
    update: (row: DelayedActionRow) => DelayedActionRow
  ): void {
    const row = this.rows.get(actionId)
    if (!row || row[9] !== null || row[10] !== null) {
      return
    }

    this.rows.set(actionId, update(row))
  }
}

function createDelayedAction(
  overrides: Partial<CloudflareWorkflowDelayedAction> = {}
): CloudflareWorkflowDelayedAction {
  return {
    id: "retry-step:workflow:transaction:step",
    kind: "retry-step",
    workflowId: "workflow",
    transactionId: "transaction",
    stepId: "step",
    dueAt: 5000,
    context: {
      eventGroupId: "event-group",
      parentStepIdempotencyKey: "parent-step",
      preventReleaseEvents: true,
    },
    ...overrides,
  }
}

function toDelayedActionRow(bindings: SqlStorageValue[]): DelayedActionRow {
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
  ] = bindings

  if (
    typeof actionId !== "string" ||
    typeof kind !== "string" ||
    typeof workflowId !== "string" ||
    typeof transactionId !== "string" ||
    (stepId !== null && typeof stepId !== "string") ||
    typeof dueAt !== "number" ||
    typeof contextJson !== "string" ||
    typeof createdAt !== "number" ||
    typeof updatedAt !== "number"
  ) {
    throw new Error("Invalid workflow delayed action SQL bindings")
  }

  return [
    actionId,
    kind,
    workflowId,
    transactionId,
    stepId,
    dueAt,
    contextJson,
    createdAt,
    updatedAt,
    null,
    null,
  ]
}

function withState(
  row: DelayedActionRow,
  state: {
    updatedAt: number
    handledAt?: number
    cancelledAt?: number
  }
): DelayedActionRow {
  return [
    row[0],
    row[1],
    row[2],
    row[3],
    row[4],
    row[5],
    row[6],
    row[7],
    state.updatedAt,
    state.handledAt ?? row[9],
    state.cancelledAt ?? row[10],
  ]
}

function sortByDueAtThenId(
  first: DelayedActionRow,
  second: DelayedActionRow
): number {
  if (first[5] !== second[5]) {
    return first[5] - second[5]
  }

  return first[0].localeCompare(second[0])
}
