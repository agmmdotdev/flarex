import {
  InMemoryWorkflowDelayedActionStore,
  InternalServiceWorkflowExecutionStore,
  InMemoryDistributedTransactionStorage,
  InMemoryWorkflowScheduleStore,
} from "../utils"
import type { Logger, ModulesSdkTypes } from "@medusajs/types"
import {
  type DistributedTransactionType,
  TransactionCheckpoint,
  type TransactionContext,
  type TransactionFlow,
  type TransactionStep,
  type TransactionStepError,
} from "@medusajs/orchestration/transaction"
import { TransactionState } from "@medusajs/framework/utils"
import type {
  RecoverableWorkflowDelayedActionStore,
  RecoverableWorkflowScheduleStore,
  ScheduledWorkflow,
  WorkflowExecutionStore,
  WorkflowExecutionStoreRecord,
  WorkflowDelayedAction,
  WorkflowDelayedActionHandler,
  WorkflowDelayedActionRecoveryResult,
  WorkflowDelayedActionStore,
  WorkflowScheduleRecoveryResult,
  WorkflowSchedulerAdapter,
} from "../utils"

describe("InMemoryDistributedTransactionStorage", () => {
  afterEach(() => {
    jest.restoreAllMocks()
  })

  it("schedules interval workflows when timer handles do not expose Node unref", async () => {
    const timerHandle = 1 as unknown as ReturnType<typeof setTimeout>
    const setTimeoutMock = jest
      .spyOn(globalThis, "setTimeout")
      .mockImplementation((() => timerHandle) as unknown as typeof setTimeout)
    const clearTimeoutMock = jest
      .spyOn(globalThis, "clearTimeout")
      .mockImplementation((() => undefined) as typeof clearTimeout)

    const storage = new InMemoryDistributedTransactionStorage({
      workflowExecutionService: createWorkflowExecutionService(),
      logger: console as unknown as Logger,
    })

    await expect(
      storage.schedule("worker-scheduled-workflow", {
        interval: 1000,
      })
    ).resolves.toBeUndefined()

    await storage.remove("worker-scheduled-workflow")

    expect(setTimeoutMock).toHaveBeenCalledWith(
      expect.any(Function),
      1000
    )
    expect(clearTimeoutMock).toHaveBeenCalledWith(timerHandle)
  })

  it("fails cron schedules when no cron parser adapter is configured", async () => {
    const storage = new InMemoryDistributedTransactionStorage({
      workflowExecutionService: createWorkflowExecutionService(),
      logger: console as unknown as Logger,
    })

    await expect(
      storage.schedule("worker-cron-workflow", {
        cron: "* * * * *",
      })
    ).rejects.toThrow("Cron schedules require a cron parser adapter")
  })

  it("uses the injected cron parser adapter for cron schedules", async () => {
    jest.spyOn(Date, "now").mockReturnValue(1000)

    const timerHandle = 1 as unknown as ReturnType<typeof setTimeout>
    const schedulerAdapter: WorkflowSchedulerAdapter = {
      setTimeout: jest.fn(() => timerHandle),
      clearTimeout: jest.fn(),
      setInterval: jest.fn(
        () => 2 as unknown as ReturnType<typeof setInterval>
      ),
      clearInterval: jest.fn(),
      parseCron: jest.fn(() => ({
        next: () => ({
          getTime: () => 1500,
        }),
      })),
    }
    const storage = new InMemoryDistributedTransactionStorage({
      workflowExecutionService: createWorkflowExecutionService(),
      logger: console as unknown as Logger,
      workflowSchedulerAdapter: schedulerAdapter,
    })

    await expect(
      storage.schedule("worker-cron-workflow", {
        cron: "* * * * *",
      })
    ).resolves.toBeUndefined()

    expect(schedulerAdapter.parseCron).toHaveBeenCalledWith("* * * * *")
    expect(schedulerAdapter.setTimeout).toHaveBeenCalledWith(
      expect.any(Function),
      500
    )
  })

  it("removes all scheduled workflows through the schedule store", async () => {
    const scheduleStore = new InMemoryWorkflowScheduleStore()
    const schedulerAdapter = createSchedulerAdapter()
    const storage = new InMemoryDistributedTransactionStorage({
      workflowExecutionService: createWorkflowExecutionService(),
      logger: console as unknown as Logger,
      workflowSchedulerAdapter: schedulerAdapter,
      workflowScheduleStore: scheduleStore,
    })

    await storage.schedule("first-scheduled-workflow", { interval: 1000 })
    await storage.schedule("second-scheduled-workflow", { interval: 2000 })

    expect([...(await scheduleStore.entries())]).toHaveLength(2)

    await storage.removeAll()

    expect([...(await scheduleStore.entries())]).toHaveLength(0)
    expect(schedulerAdapter.clearTimeout).toHaveBeenCalledTimes(2)
  })

  it("reschedules interval workflows through the schedule store after handling a job", async () => {
    const scheduleStore = new InMemoryWorkflowScheduleStore()
    const schedulerAdapter = createSchedulerAdapter()
    const runWorkflow = jest.fn().mockResolvedValue(undefined)
    const storage = new InMemoryDistributedTransactionStorage({
      workflowExecutionService: createWorkflowExecutionService(),
      logger: console as unknown as Logger,
      workflowSchedulerAdapter: schedulerAdapter,
      workflowScheduleStore: scheduleStore,
    })
    storage.setWorkflowOrchestratorService({
      run: runWorkflow,
    })

    await storage.schedule("rescheduled-workflow", {
      interval: 1000,
      numberOfExecutions: 2,
    })
    schedulerAdapter.setTimeout.mockClear()

    await storage.jobHandler("rescheduled-workflow")

    const scheduled = await scheduleStore.get("rescheduled-workflow")
    expect(runWorkflow).toHaveBeenCalledWith("rescheduled-workflow", {
      logOnError: true,
      throwOnError: false,
    })
    expect(schedulerAdapter.setTimeout).toHaveBeenCalledWith(
      expect.any(Function),
      1000
    )
    expect(scheduled?.numberOfExecutions).toBe(1)
  })

  it("returns an empty recovery result when the schedule store cannot recover persisted jobs", async () => {
    const storage = new InMemoryDistributedTransactionStorage({
      workflowExecutionService: createWorkflowExecutionService(),
      logger: console as unknown as Logger,
    })

    await expect(storage.recoverDueSchedules(1000)).resolves.toEqual({
      dueCount: 0,
      recoveredJobIds: [],
      skippedRuntimeJobIds: [],
      deletedJobIds: [],
    })
  })

  it("recovers due persisted schedules through the injected schedule store", async () => {
    const runWorkflow = jest.fn().mockResolvedValue(undefined)
    const scheduleStore: RecoverableWorkflowScheduleStore = {
      get: jest.fn(),
      set: jest.fn(),
      delete: jest.fn(),
      clear: jest.fn(),
      entries: jest.fn((): Iterable<[string, ScheduledWorkflow]> => []),
      recoverDueSchedules: jest.fn(
        async (
          recoverWorkflow: (jobId: string) => Promise<void>,
          now?: number
        ): Promise<WorkflowScheduleRecoveryResult> => {
          await recoverWorkflow("recovered-workflow")

          return {
            dueCount: now === 1000 ? 1 : 0,
            recoveredJobIds: ["recovered-workflow"],
            skippedRuntimeJobIds: [],
            deletedJobIds: [],
          }
        }
      ),
    }
    const storage = new InMemoryDistributedTransactionStorage({
      workflowExecutionService: createWorkflowExecutionService(),
      logger: console as unknown as Logger,
      workflowScheduleStore: scheduleStore,
    })
    storage.setWorkflowOrchestratorService({
      run: runWorkflow,
    })

    await expect(storage.recoverDueSchedules(1000)).resolves.toEqual({
      dueCount: 1,
      recoveredJobIds: ["recovered-workflow"],
      skippedRuntimeJobIds: [],
      deletedJobIds: [],
    })
    expect(runWorkflow).toHaveBeenCalledWith("recovered-workflow", {
      logOnError: true,
      throwOnError: false,
    })
  })

  it("schedules delayed actions through the injected scheduler adapter", async () => {
    jest.spyOn(Date, "now").mockReturnValue(1000)

    const schedulerAdapter = createCapturingSchedulerAdapter()
    const store = new InMemoryWorkflowDelayedActionStore({
      workflowSchedulerAdapter: schedulerAdapter,
    })
    const action = createWorkflowDelayedAction({
      id: "retry:delayed-workflow:delayed-transaction:delayed-step",
      kind: "retry-step",
      stepId: "delayed-step",
      dueAt: 1500,
    })
    const handler = jest.fn<Promise<void>, [WorkflowDelayedAction]>(
      async () => undefined
    )

    await store.set(action, handler)

    expect(schedulerAdapter.setTimeout).toHaveBeenCalledWith(
      expect.any(Function),
      500
    )
    expect([...(await store.entries())]).toHaveLength(1)

    await schedulerAdapter.runCapturedTimeout()

    expect(handler).toHaveBeenCalledWith(action)
    expect(store.get(action.id)).toBeUndefined()
  })

  it("clears the injected delayed action store on application shutdown", async () => {
    const delayedActionStore = createWorkflowDelayedActionStore()
    const storage = new InMemoryDistributedTransactionStorage({
      workflowExecutionService: createWorkflowExecutionService(),
      logger: console as unknown as Logger,
      workflowDelayedActionStore: delayedActionStore,
    })

    await storage.onApplicationShutdown()

    expect(delayedActionStore.clear).toHaveBeenCalledTimes(1)
  })

  it("returns an empty delayed-action recovery result when the store cannot recover persisted actions", async () => {
    const storage = new InMemoryDistributedTransactionStorage({
      workflowExecutionService: createWorkflowExecutionService(),
      logger: console as unknown as Logger,
    })

    await expect(storage.recoverDueDelayedActions(1000)).resolves.toEqual({
      dueCount: 0,
      recoveredActionIds: [],
      failedActionIds: [],
    })
  })

  it("recovers due delayed actions through the injected delayed action store", async () => {
    const delayedAction = createWorkflowDelayedAction({
      id: "retry-step:delayed-workflow:delayed-transaction:delayed-step",
      kind: "retry-step",
      stepId: "delayed-step",
      dueAt: 1000,
    })
    const runWorkflow = jest.fn().mockResolvedValue(undefined)
    const delayedActionStore: RecoverableWorkflowDelayedActionStore = {
      get: jest.fn(),
      set: jest.fn(),
      delete: jest.fn(),
      clear: jest.fn(),
      entries: jest.fn((): Iterable<[string, WorkflowDelayedAction]> => []),
      recoverDueActions: jest.fn(
        async (
          recoverAction: (action: WorkflowDelayedAction) => Promise<void>,
          now?: number
        ): Promise<WorkflowDelayedActionRecoveryResult> => {
          await recoverAction(delayedAction)

          return {
            dueCount: now === 1000 ? 1 : 0,
            recoveredActionIds: [delayedAction.id],
            failedActionIds: [],
          }
        }
      ),
    }
    const storage = new InMemoryDistributedTransactionStorage({
      workflowExecutionService: createWorkflowExecutionService(),
      logger: console as unknown as Logger,
      workflowDelayedActionStore: delayedActionStore,
    })
    storage.setWorkflowOrchestratorService({
      run: runWorkflow,
    })

    await expect(storage.recoverDueDelayedActions(1000)).resolves.toEqual({
      dueCount: 1,
      recoveredActionIds: [delayedAction.id],
      failedActionIds: [],
    })
    expect(runWorkflow).toHaveBeenCalledWith("delayed-workflow", {
      transactionId: "delayed-transaction",
      logOnError: true,
      throwOnError: false,
      context: {
        eventGroupId: "event-group",
      },
    })
  })

  it("routes retry and timeout scheduling through the delayed action store", async () => {
    jest.spyOn(Date, "now").mockReturnValue(10_000)

    const delayedActionStore = createRecordingWorkflowDelayedActionStore()
    const runWorkflow = jest.fn().mockResolvedValue(undefined)
    const storage = new InMemoryDistributedTransactionStorage({
      workflowExecutionService: createWorkflowExecutionService(),
      logger: console as unknown as Logger,
      workflowDelayedActionStore: delayedActionStore,
    })
    storage.setWorkflowOrchestratorService({
      run: runWorkflow,
    })

    const transaction = createDistributedTransaction()
    const step = createTransactionStep("delayed-step")

    await storage.scheduleRetry(transaction, step, 0, 2)
    await storage.scheduleStepTimeout(transaction, step, 0, 3)
    await storage.scheduleTransactionTimeout(transaction, 0, 4)

    expect(delayedActionStore.set).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "retry-step:delayed-workflow:delayed-transaction:delayed-step",
        kind: "retry-step",
        workflowId: "delayed-workflow",
        transactionId: "delayed-transaction",
        stepId: "delayed-step",
        dueAt: 12_000,
        context: {
          eventGroupId: "event-group",
          parentStepIdempotencyKey: "parent-step",
          preventReleaseEvents: true,
        },
      }),
      expect.any(Function)
    )
    expect(delayedActionStore.set).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "step-timeout:delayed-workflow:delayed-transaction:delayed-step",
        kind: "step-timeout",
        dueAt: 13_000,
      }),
      expect.any(Function)
    )
    expect(delayedActionStore.set).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "transaction-timeout:delayed-workflow:delayed-transaction",
        kind: "transaction-timeout",
        dueAt: 14_000,
      }),
      expect.any(Function)
    )

    const retryAction = delayedActionStore.getRecorded(
      "retry-step:delayed-workflow:delayed-transaction:delayed-step"
    )
    await retryAction.handler(retryAction.action)

    expect(runWorkflow).toHaveBeenCalledWith("delayed-workflow", {
      transactionId: "delayed-transaction",
      logOnError: true,
      throwOnError: false,
      context: {
        eventGroupId: "event-group",
        parentStepIdempotencyKey: "parent-step",
        preventReleaseEvents: true,
      },
    })

    await storage.clearRetry(transaction, step)
    await storage.clearStepTimeout(transaction, step)
    await storage.clearTransactionTimeout(transaction)

    expect(delayedActionStore.delete).toHaveBeenCalledWith(
      "retry-step:delayed-workflow:delayed-transaction:delayed-step"
    )
    expect(delayedActionStore.delete).toHaveBeenCalledWith(
      "step-timeout:delayed-workflow:delayed-transaction:delayed-step"
    )
    expect(delayedActionStore.delete).toHaveBeenCalledWith(
      "transaction-timeout:delayed-workflow:delayed-transaction"
    )
  })

  it("wraps the internal workflow execution service behind the execution store boundary", async () => {
    const workflowExecutionService = createWorkflowExecutionService()
    const store = new InternalServiceWorkflowExecutionStore({
      workflowExecutionService,
    })
    const record = createWorkflowExecutionRecord(TransactionState.NOT_STARTED)

    await store.save(record)
    await store.deleteByRunId(record.run_id)
    await store.findLatest(record.workflow_id, record.transaction_id)
    await store.listExpirableFinished()
    await store.delete([
      {
        workflow_id: "delete-workflow",
        transaction_id: "delete-transaction",
        run_id: "delete-run",
        updated_at: new Date(),
        retention_time: 1,
      },
    ])

    expect(workflowExecutionService.upsert).toHaveBeenCalledWith([record])
    expect(workflowExecutionService.delete).toHaveBeenCalledWith([
      { run_id: record.run_id },
    ])
    expect(workflowExecutionService.list).toHaveBeenCalledWith(
      {
        workflow_id: record.workflow_id,
        transaction_id: record.transaction_id,
      },
      {
        select: ["execution", "context"],
        order: {
          id: "desc",
        },
        take: 1,
      }
    )
    expect(workflowExecutionService.list).toHaveBeenCalledWith(
      {
        retention_time: {
          $ne: null,
        },
        state: {
          $in: [
            TransactionState.DONE,
            TransactionState.FAILED,
            TransactionState.REVERTED,
          ],
        },
      },
      {
        select: [
          "workflow_id",
          "transaction_id",
          "run_id",
          "updated_at",
          "retention_time",
        ],
      }
    )
    expect(workflowExecutionService.delete).toHaveBeenCalledWith([
      {
        workflow_id: "delete-workflow",
        transaction_id: "delete-transaction",
        run_id: "delete-run",
      },
    ])
  })

  it("uses an injected workflow execution store for checkpoint persistence", async () => {
    jest.spyOn(Date, "now").mockReturnValue(10_000)

    const workflowExecutionStore = createWorkflowExecutionStore()
    const storage = new InMemoryDistributedTransactionStorage({
      workflowExecutionService: createWorkflowExecutionService(),
      logger: console as unknown as Logger,
      workflowExecutionStore,
    })
    const key = "workflow:store-workflow:store-transaction"
    const initialCheckpoint = createCheckpoint(TransactionState.NOT_STARTED)

    await storage.save(key, initialCheckpoint)
    await storage.get(key)
    await storage.save(key, createCheckpoint(TransactionState.DONE))
    await storage.clearExpiredExecutions()

    expect(workflowExecutionStore.save).toHaveBeenCalledWith(
      expect.objectContaining({
        workflow_id: "store-workflow",
        transaction_id: "store-transaction",
        run_id: "store-run",
        state: TransactionState.NOT_STARTED,
      })
    )
    expect(workflowExecutionStore.findLatest).toHaveBeenCalledWith(
      "store-workflow",
      "store-transaction"
    )
    expect(workflowExecutionStore.deleteByRunId).toHaveBeenCalledWith(
      "store-run"
    )
    expect(workflowExecutionStore.delete).toHaveBeenCalledWith([
      {
        workflow_id: "expired-workflow",
        transaction_id: "expired-transaction",
        run_id: "expired-run",
        updated_at: new Date(0),
        retention_time: 1,
      },
    ])
  })
})

function createSchedulerAdapter(): WorkflowSchedulerAdapter & {
  setTimeout: jest.Mock
  clearTimeout: jest.Mock
} {
  let nextTimerHandle = 0

  return {
    setTimeout: jest.fn(() => {
      nextTimerHandle++
      return nextTimerHandle as unknown as ReturnType<typeof setTimeout>
    }),
    clearTimeout: jest.fn(),
    setInterval: jest.fn(
      () => 1 as unknown as ReturnType<typeof setInterval>
    ),
    clearInterval: jest.fn(),
  }
}

function createCapturingSchedulerAdapter(): WorkflowSchedulerAdapter & {
  setTimeout: jest.Mock
  clearTimeout: jest.Mock
  runCapturedTimeout(): Promise<void>
} {
  let capturedTimeout: (() => void | Promise<void>) | undefined

  return {
    setTimeout: jest.fn((callback: () => void | Promise<void>) => {
      capturedTimeout = callback
      return 1 as unknown as ReturnType<typeof setTimeout>
    }),
    clearTimeout: jest.fn(),
    setInterval: jest.fn(
      () => 1 as unknown as ReturnType<typeof setInterval>
    ),
    clearInterval: jest.fn(),
    async runCapturedTimeout(): Promise<void> {
      if (!capturedTimeout) {
        throw new Error("Expected delayed action timeout to be scheduled")
      }

      await capturedTimeout()
    },
  }
}

function createWorkflowExecutionService(): ModulesSdkTypes.IMedusaInternalService<WorkflowExecutionStoreRecord> & {
  list: jest.Mock
  upsert: jest.Mock
  delete: jest.Mock
} {
  return {
    list: jest.fn().mockResolvedValue([]),
    upsert: jest.fn().mockResolvedValue([]),
    delete: jest.fn().mockResolvedValue(undefined),
  } as unknown as ModulesSdkTypes.IMedusaInternalService<WorkflowExecutionStoreRecord> & {
    list: jest.Mock
    upsert: jest.Mock
    delete: jest.Mock
  }
}

function createWorkflowExecutionStore(): jest.Mocked<WorkflowExecutionStore> {
  return {
    save: jest.fn().mockResolvedValue(undefined),
    deleteByRunId: jest.fn().mockResolvedValue(undefined),
    findLatest: jest.fn().mockResolvedValue(
      createWorkflowExecutionRecord(TransactionState.NOT_STARTED)
    ),
    listExpirableFinished: jest.fn().mockResolvedValue([
      {
        workflow_id: "expired-workflow",
        transaction_id: "expired-transaction",
        run_id: "expired-run",
        updated_at: new Date(0),
        retention_time: 1,
      },
      {
        workflow_id: "fresh-workflow",
        transaction_id: "fresh-transaction",
        run_id: "fresh-run",
        updated_at: new Date(9_500),
        retention_time: 1,
      },
    ]),
    delete: jest.fn().mockResolvedValue(undefined),
  }
}

function createWorkflowDelayedActionStore(): jest.Mocked<WorkflowDelayedActionStore> {
  return {
    get: jest.fn().mockResolvedValue(undefined),
    set: jest.fn().mockResolvedValue(undefined),
    delete: jest.fn().mockResolvedValue(undefined),
    clear: jest.fn().mockResolvedValue(undefined),
    entries: jest.fn((): Iterable<[string, WorkflowDelayedAction]> => []),
  }
}

function createRecordingWorkflowDelayedActionStore(): jest.Mocked<WorkflowDelayedActionStore> & {
  getRecorded(actionId: string): {
    action: WorkflowDelayedAction
    handler: WorkflowDelayedActionHandler
  }
} {
  const actions = new Map<
    string,
    {
      action: WorkflowDelayedAction
      handler: WorkflowDelayedActionHandler
    }
  >()

  const store: jest.Mocked<WorkflowDelayedActionStore> = {
    get: jest.fn((actionId: string) => actions.get(actionId)?.action),
    set: jest.fn(
      (
        action: WorkflowDelayedAction,
        handler: WorkflowDelayedActionHandler
      ): void => {
        actions.set(action.id, {
          action,
          handler,
        })
      }
    ),
    delete: jest.fn((actionId: string): void => {
      actions.delete(actionId)
    }),
    clear: jest.fn((): void => {
      actions.clear()
    }),
    entries: jest.fn((): Iterable<[string, WorkflowDelayedAction]> => {
      return [...actions.entries()].map(([actionId, scheduled]) => [
        actionId,
        scheduled.action,
      ])
    }),
  }

  return {
    ...store,
    getRecorded(actionId: string) {
      const action = actions.get(actionId)
      if (!action) {
        throw new Error(`Expected delayed action ${actionId} to be recorded`)
      }

      return action
    },
  }
}

function createWorkflowDelayedAction(
  input: Pick<
    WorkflowDelayedAction,
    "id" | "kind" | "stepId" | "dueAt"
  >
): WorkflowDelayedAction {
  return {
    id: input.id,
    kind: input.kind,
    workflowId: "delayed-workflow",
    transactionId: "delayed-transaction",
    stepId: input.stepId,
    dueAt: input.dueAt,
    context: {
      eventGroupId: "event-group",
      parentStepIdempotencyKey: undefined,
      preventReleaseEvents: undefined,
    },
  }
}

function createDistributedTransaction(): DistributedTransactionType {
  return {
    modelId: "delayed-workflow",
    transactionId: "delayed-transaction",
    getFlow: () => ({
      metadata: {
        eventGroupId: "event-group",
        parentStepIdempotencyKey: "parent-step",
        preventReleaseEvents: true,
      },
    }),
  } as unknown as DistributedTransactionType
}

function createTransactionStep(id: string): TransactionStep {
  return {
    id,
  } as unknown as TransactionStep
}

function createCheckpoint(state: TransactionState): TransactionCheckpoint {
  const record = createWorkflowExecutionRecord(state)

  return new TransactionCheckpoint(
    record.execution,
    record.context.data,
    record.context.errors
  )
}

function createWorkflowExecutionRecord(
  state: TransactionState
): WorkflowExecutionStoreRecord {
  return {
    workflow_id: "store-workflow",
    transaction_id: "store-transaction",
    run_id: "store-run",
    execution: {
      modelId: "store-workflow",
      transactionId: "store-transaction",
      runId: "store-run",
      state,
      steps: {
        _root: {
          id: "_root",
        },
      },
      metadata: {},
    } as unknown as TransactionFlow,
    context: {
      data: {} as TransactionContext,
      errors: [] as TransactionStepError[],
    },
    state,
    retention_time: null,
  }
}
