import {
  DistributedTransactionType,
  IDistributedSchedulerStorage,
  IDistributedTransactionStorage,
  SchedulerOptions,
  SkipCancelledExecutionError,
  SkipExecutionError,
  SkipStepAlreadyFinishedError,
  TransactionCheckpoint,
  TransactionContext,
  TransactionFlow,
  TransactionOptions,
  TransactionStep,
  TransactionStepError,
} from "@medusajs/orchestration/transaction"
import type {
  Context,
  Logger,
  ModulesSdkTypes,
} from "@medusajs/types"
import {
  isPresent,
  MedusaError,
  TransactionState,
  TransactionStepState,
} from "@medusajs/framework/utils"
import { WorkflowOrchestratorService } from "../services/workflow-orchestrator"

const THIRTY_MINUTES_IN_MS = 1000 * 60 * 30

type TimerHandle = ReturnType<typeof setTimeout>
type IntervalHandle = ReturnType<typeof setInterval>

export interface WorkflowExecutionStoreRecord {
  id?: string
  workflow_id: string
  transaction_id: string
  run_id: string
  execution: TransactionFlow
  context: {
    data: TransactionContext
    errors: TransactionStepError[]
  }
  state: TransactionState
  retention_time?: number | null
  updated_at?: Date | string
}

export interface ExpirableWorkflowExecution {
  workflow_id: string
  transaction_id: string
  run_id: string
  updated_at: Date | string
  retention_time: number | null
}

export interface WorkflowExecutionStore {
  save(record: WorkflowExecutionStoreRecord): Promise<void>
  deleteByRunId(runId: string): Promise<void>
  findLatest(
    workflowId: string,
    transactionId: string
  ): Promise<WorkflowExecutionStoreRecord | undefined>
  listExpirableFinished(): Promise<ExpirableWorkflowExecution[]>
  delete(executions: ExpirableWorkflowExecution[]): Promise<void>
}

export class InternalServiceWorkflowExecutionStore
  implements WorkflowExecutionStore
{
  private readonly workflowExecutionService: ModulesSdkTypes.IMedusaInternalService<WorkflowExecutionStoreRecord>

  constructor({
    workflowExecutionService,
  }: {
    workflowExecutionService: ModulesSdkTypes.IMedusaInternalService<WorkflowExecutionStoreRecord>
  }) {
    this.workflowExecutionService = workflowExecutionService
  }

  async save(record: WorkflowExecutionStoreRecord): Promise<void> {
    await this.workflowExecutionService.upsert([record])
  }

  async deleteByRunId(runId: string): Promise<void> {
    await this.workflowExecutionService.delete([
      {
        run_id: runId,
      },
    ])
  }

  async findLatest(
    workflowId: string,
    transactionId: string
  ): Promise<WorkflowExecutionStoreRecord | undefined> {
    return await this.workflowExecutionService
      .list(
        {
          workflow_id: workflowId,
          transaction_id: transactionId,
        },
        {
          select: ["execution", "context"],
          order: {
            id: "desc",
          },
          take: 1,
        }
      )
      .then((executions) => executions[0])
      .catch(() => undefined)
  }

  async listExpirableFinished(): Promise<ExpirableWorkflowExecution[]> {
    const executions = await this.workflowExecutionService.list(
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

    return executions.map(toExpirableWorkflowExecution)
  }

  async delete(executions: ExpirableWorkflowExecution[]): Promise<void> {
    await this.workflowExecutionService.delete(
      executions.map((execution) => ({
        workflow_id: execution.workflow_id,
        transaction_id: execution.transaction_id,
        run_id: execution.run_id,
      }))
    )
  }
}

export type WorkflowCronExpression = {
  next(): {
    getTime(): number
  }
}

export interface WorkflowSchedulerAdapter {
  setTimeout(callback: () => void | Promise<void>, delay: number): TimerHandle
  clearTimeout(timer: TimerHandle): void
  setInterval(callback: () => void | Promise<void>, delay: number): IntervalHandle
  clearInterval(timer: IntervalHandle): void
  unref?(timer: TimerHandle | IntervalHandle): void
  parseCron?(expression: string): WorkflowCronExpression
}

export const defaultWorkflowSchedulerAdapter: WorkflowSchedulerAdapter = {
  setTimeout: (callback, delay) =>
    setTimeout(async () => {
      await callback()
    }, delay),
  clearTimeout: (timer) => clearTimeout(timer),
  setInterval: (callback, delay) =>
    setInterval(async () => {
      await callback()
    }, delay),
  clearInterval: (timer) => clearInterval(timer),
  unref: (timer) => {
    const maybeTimer = timer as (TimerHandle | IntervalHandle) & {
      unref?: () => void
    }
    maybeTimer.unref?.()
  },
}

export interface ScheduledWorkflow {
  timer: TimerHandle
  expression: WorkflowCronExpression | number
  numberOfExecutions: number
  config: SchedulerOptions
}

export interface WorkflowScheduleRecoveryResult {
  dueCount: number
  recoveredJobIds: string[]
  skippedRuntimeJobIds: string[]
  deletedJobIds: string[]
}

export interface WorkflowScheduleStore {
  get(jobId: string): ScheduledWorkflow | undefined | Promise<ScheduledWorkflow | undefined>
  set(jobId: string, job: ScheduledWorkflow): void | Promise<void>
  delete(jobId: string): void | Promise<void>
  clear(): void | Promise<void>
  entries(): Iterable<[string, ScheduledWorkflow]> | Promise<Iterable<[string, ScheduledWorkflow]>>
}

export interface RecoverableWorkflowScheduleStore extends WorkflowScheduleStore {
  recoverDueSchedules(
    runWorkflow: (jobId: string) => Promise<void>,
    now?: number
  ): Promise<WorkflowScheduleRecoveryResult>
}

export type WorkflowDelayedActionKind =
  | "retry-step"
  | "step-timeout"
  | "transaction-timeout"

export type WorkflowDelayedActionContext = Pick<
  Context,
  "eventGroupId" | "parentStepIdempotencyKey" | "preventReleaseEvents"
>

export interface WorkflowDelayedAction {
  id: string
  kind: WorkflowDelayedActionKind
  workflowId: string
  transactionId: string
  stepId?: string
  dueAt: number
  context: WorkflowDelayedActionContext
}

export interface WorkflowDelayedActionRecoveryResult {
  dueCount: number
  recoveredActionIds: string[]
  failedActionIds: string[]
}

export type WorkflowDelayedActionHandler = (
  action: WorkflowDelayedAction
) => void | Promise<void>

type ScheduledWorkflowDelayedAction = {
  action: WorkflowDelayedAction
  timer: TimerHandle
}

export interface WorkflowDelayedActionStore {
  get(
    actionId: string
  ):
    | WorkflowDelayedAction
    | undefined
    | Promise<WorkflowDelayedAction | undefined>
  set(
    action: WorkflowDelayedAction,
    handler: WorkflowDelayedActionHandler
  ): void | Promise<void>
  delete(actionId: string): void | Promise<void>
  clear(): void | Promise<void>
  entries():
    | Iterable<[string, WorkflowDelayedAction]>
    | Promise<Iterable<[string, WorkflowDelayedAction]>>
}

export interface RecoverableWorkflowDelayedActionStore
  extends WorkflowDelayedActionStore {
  recoverDueActions(
    runAction: (action: WorkflowDelayedAction) => Promise<void>,
    now?: number
  ): Promise<WorkflowDelayedActionRecoveryResult>
}

export class InMemoryWorkflowScheduleStore implements WorkflowScheduleStore {
  readonly #schedules = new Map<string, ScheduledWorkflow>()

  get(jobId: string): ScheduledWorkflow | undefined {
    return this.#schedules.get(jobId)
  }

  set(jobId: string, job: ScheduledWorkflow): void {
    this.#schedules.set(jobId, job)
  }

  delete(jobId: string): void {
    this.#schedules.delete(jobId)
  }

  clear(): void {
    this.#schedules.clear()
  }

  entries(): Iterable<[string, ScheduledWorkflow]> {
    return [...this.#schedules.entries()]
  }
}

export class InMemoryWorkflowDelayedActionStore
  implements WorkflowDelayedActionStore
{
  readonly #actions = new Map<string, ScheduledWorkflowDelayedAction>()
  private readonly schedulerAdapter: WorkflowSchedulerAdapter

  constructor({
    workflowSchedulerAdapter,
  }: {
    workflowSchedulerAdapter?: WorkflowSchedulerAdapter
  } = {}) {
    this.schedulerAdapter =
      workflowSchedulerAdapter ?? defaultWorkflowSchedulerAdapter
  }

  get(actionId: string): WorkflowDelayedAction | undefined {
    return this.#actions.get(actionId)?.action
  }

  set(
    action: WorkflowDelayedAction,
    handler: WorkflowDelayedActionHandler
  ): void {
    this.delete(action.id)

    const delay = Math.max(0, action.dueAt - Date.now())
    const timer = this.schedulerAdapter.setTimeout(async () => {
      this.#actions.delete(action.id)
      await handler(action)
    }, delay)

    this.schedulerAdapter.unref?.(timer)
    this.#actions.set(action.id, {
      action,
      timer,
    })
  }

  delete(actionId: string): void {
    const scheduled = this.#actions.get(actionId)
    if (!scheduled) {
      return
    }

    this.schedulerAdapter.clearTimeout(scheduled.timer)
    this.#actions.delete(actionId)
  }

  clear(): void {
    for (const actionId of this.#actions.keys()) {
      this.delete(actionId)
    }
  }

  entries(): Iterable<[string, WorkflowDelayedAction]> {
    return [...this.#actions.entries()].map(([actionId, scheduled]) => [
      actionId,
      scheduled.action,
    ])
  }
}

const doneStates = new Set([
  TransactionStepState.DONE,
  TransactionStepState.REVERTED,
  TransactionStepState.FAILED,
  TransactionStepState.SKIPPED,
  TransactionStepState.SKIPPED_FAILURE,
  TransactionStepState.TIMEOUT,
])

const finishedStates = new Set([
  TransactionState.DONE,
  TransactionState.FAILED,
  TransactionState.REVERTED,
])

const failedStates = new Set([
  TransactionState.FAILED,
  TransactionState.REVERTED,
])

function calculateDelayFromExpression(expression: WorkflowCronExpression): number {
  const nextTime = expression.next().getTime()
  const now = Date.now()
  const delay = nextTime - now

  // If the calculated delay is negative or zero, get the next occurrence
  if (delay <= 0) {
    const nextNextTime = expression.next().getTime()
    return Math.max(1, nextNextTime - now)
  }

  return delay
}

export class InMemoryDistributedTransactionStorage
  implements IDistributedTransactionStorage, IDistributedSchedulerStorage
{
  private workflowExecutionStore_: WorkflowExecutionStore
  private logger_: Logger
  private workflowOrchestratorService_: WorkflowOrchestratorService
  private schedulerAdapter_: WorkflowSchedulerAdapter
  private scheduleStore_: WorkflowScheduleStore
  private delayedActionStore_: WorkflowDelayedActionStore

  private storage: Record<string, TransactionCheckpoint> = {}
  private pendingTimers: Set<TimerHandle> = new Set()

  private clearTimeout_: IntervalHandle
  private isLocked: Map<string, boolean> = new Map()

  constructor({
    workflowExecutionService,
    logger,
    workflowSchedulerAdapter,
    workflowScheduleStore,
    workflowExecutionStore,
    workflowDelayedActionStore,
  }: {
    workflowExecutionService: ModulesSdkTypes.IMedusaInternalService<WorkflowExecutionStoreRecord>
    logger: Logger
    workflowSchedulerAdapter?: WorkflowSchedulerAdapter
    workflowScheduleStore?: WorkflowScheduleStore
    workflowExecutionStore?: WorkflowExecutionStore
    workflowDelayedActionStore?: WorkflowDelayedActionStore
  }) {
    this.workflowExecutionStore_ =
      workflowExecutionStore ??
      new InternalServiceWorkflowExecutionStore({ workflowExecutionService })
    this.logger_ = logger
    this.schedulerAdapter_ =
      workflowSchedulerAdapter ?? defaultWorkflowSchedulerAdapter
    this.scheduleStore_ =
      workflowScheduleStore ?? new InMemoryWorkflowScheduleStore()
    this.delayedActionStore_ =
      workflowDelayedActionStore ??
      new InMemoryWorkflowDelayedActionStore({
        workflowSchedulerAdapter: this.schedulerAdapter_,
      })
  }

  async onApplicationStart() {
    this.clearTimeout_ = this.schedulerAdapter_.setInterval(async () => {
      try {
        await this.clearExpiredExecutions()
      } catch {}
    }, THIRTY_MINUTES_IN_MS)
  }

  async onApplicationShutdown() {
    this.schedulerAdapter_.clearInterval(this.clearTimeout_)

    for (const timer of this.pendingTimers) {
      this.schedulerAdapter_.clearTimeout(timer)
    }
    this.pendingTimers.clear()

    // Clean up scheduled job timers
    for (const [, job] of await this.scheduleStore_.entries()) {
      this.schedulerAdapter_.clearTimeout(job.timer)
    }
    await this.scheduleStore_.clear()
    await this.delayedActionStore_.clear()
  }

  setWorkflowOrchestratorService(workflowOrchestratorService) {
    this.workflowOrchestratorService_ = workflowOrchestratorService
  }

  private createManagedTimer(
    callback: () => void | Promise<void>,
    delay: number
  ): TimerHandle {
    const timer = this.schedulerAdapter_.setTimeout(async () => {
      this.pendingTimers.delete(timer)
      const res = callback()
      if (res instanceof Promise) {
        await res
      }
    }, delay)

    this.pendingTimers.add(timer)
    return timer
  }

  private parseCronExpression(expression: string): WorkflowCronExpression {
    if (!this.schedulerAdapter_.parseCron) {
      throw new MedusaError(
        MedusaError.Types.INVALID_ARGUMENT,
        "Cron schedules require a cron parser adapter and are not available in the Worker-compatible in-memory workflow engine"
      )
    }

    return this.schedulerAdapter_.parseCron(expression)
  }

  private parseNextExecution(
    optionsOrExpression:
      | SchedulerOptions
      | WorkflowCronExpression
      | string
      | number
  ): number {
    if (typeof optionsOrExpression === "object") {
      if ("cron" in optionsOrExpression) {
        const expression = this.parseCronExpression(optionsOrExpression.cron)
        return calculateDelayFromExpression(expression)
      }

      if ("interval" in optionsOrExpression) {
        return optionsOrExpression.interval
      }

      return calculateDelayFromExpression(optionsOrExpression)
    }

    const result = parseInt(`${optionsOrExpression}`)

    if (isNaN(result)) {
      const expression = this.parseCronExpression(`${optionsOrExpression}`)
      return calculateDelayFromExpression(expression)
    }

    return result
  }

  private async saveToDb(data: TransactionCheckpoint, retentionTime?: number) {
    const isNotStarted = data.flow.state === TransactionState.NOT_STARTED
    const asyncVersion = data.flow._v
    const isFinished = finishedStates.has(data.flow.state)
    const isWaitingToCompensate =
      data.flow.state === TransactionState.WAITING_TO_COMPENSATE

    const isFlowInvoking = data.flow.state === TransactionState.INVOKING

    const stepsArray = Object.values(data.flow.steps) as TransactionStep[]
    let currentStep!: TransactionStep

    const targetStates = isFlowInvoking
      ? new Set([
          TransactionStepState.INVOKING,
          TransactionStepState.DONE,
          TransactionStepState.FAILED,
        ])
      : new Set([TransactionStepState.COMPENSATING])

    for (let i = stepsArray.length - 1; i >= 0; i--) {
      const step = stepsArray[i]

      if (step.id === "_root") {
        break
      }

      const isTargetState = targetStates.has(step.invoke?.state)

      if (isTargetState && !currentStep) {
        currentStep = step
        break
      }
    }

    let shouldStoreCurrentSteps = false
    if (currentStep) {
      for (const step of stepsArray) {
        if (step.id === "_root") {
          continue
        }

        if (
          step.depth === currentStep.depth &&
          step?.definition?.store === true
        ) {
          shouldStoreCurrentSteps = true
          break
        }
      }
    }

    if (
      !(isNotStarted || isFinished || isWaitingToCompensate) &&
      !shouldStoreCurrentSteps &&
      !asyncVersion
    ) {
      return
    }

    await this.workflowExecutionStore_.save({
      workflow_id: data.flow.modelId,
      transaction_id: data.flow.transactionId,
      run_id: data.flow.runId,
      execution: data.flow,
      context: {
        data: data.context,
        errors: data.errors,
      },
      state: data.flow.state,
      retention_time: retentionTime,
    })
  }

  private async deleteFromDb(data: TransactionCheckpoint) {
    await this.workflowExecutionStore_.deleteByRunId(data.flow.runId)
  }

  async get(
    key: string,
    options?: TransactionOptions & {
      isCancelling?: boolean
    }
  ): Promise<TransactionCheckpoint | undefined> {
    const [_, workflowId, transactionId] = key.split(":")
    const trx = await this.workflowExecutionStore_.findLatest(
      workflowId,
      transactionId
    )

    if (trx) {
      const { flow, errors } = this.storage[key]
        ? JSON.parse(JSON.stringify(this.storage[key]))
        : {}
      const { idempotent } = options ?? {}
      const execution = trx.execution as TransactionFlow

      if (!idempotent) {
        const isFailedOrReverted = failedStates.has(execution.state)

        const isDone = execution.state === TransactionState.DONE

        const isCancellingAndFailedOrReverted =
          options?.isCancelling && isFailedOrReverted

        const isNotCancellingAndDoneOrFailedOrReverted =
          !options?.isCancelling && (isDone || isFailedOrReverted)

        if (
          isCancellingAndFailedOrReverted ||
          isNotCancellingAndDoneOrFailedOrReverted
        ) {
          return
        }
      }

      return new TransactionCheckpoint(
        flow ?? (trx?.execution as TransactionFlow),
        trx?.context?.data as TransactionContext,
        errors ?? (trx?.context?.errors as TransactionStepError[])
      )
    }

    return
  }

  async save(
    key: string,
    data: TransactionCheckpoint,
    ttl?: number,
    options?: TransactionOptions
  ): Promise<TransactionCheckpoint> {
    if (this.isLocked.has(key)) {
      throw new Error("Transaction storage is locked")
    }

    this.isLocked.set(key, true)

    try {
      /**
       * Store the retention time only if the transaction is done, failed or reverted.
       * From that moment, this tuple can be later on archived or deleted after the retention time.
       */
      const { retentionTime } = options ?? {}

      const hasFinished = finishedStates.has(data.flow.state)

      await this.#preventRaceConditionExecutionIfNecessary({
        data,
        key,
        options,
      })

      // Only store retention time if it's provided
      if (retentionTime) {
        Object.assign(data, {
          retention_time: retentionTime,
        })
      }

      // Store in memory
      const isNotStarted = data.flow.state === TransactionState.NOT_STARTED
      const isManualTransactionId = !data.flow.transactionId.startsWith("auto-")

      if (isNotStarted && isManualTransactionId) {
        const storedData = this.storage[key]
        if (storedData) {
          throw new SkipExecutionError(
            "Transaction already started for transactionId: " +
              data.flow.transactionId
          )
        }
      }

      if (data.flow._v) {
        const storedData = await this.get(key, {
          isCancelling: !!data.flow.cancelledAt,
        } as any)

        TransactionCheckpoint.mergeCheckpoints(data, storedData)
      }

      const { flow, context, errors } = data

      this.storage[key] = {
        flow: JSON.parse(JSON.stringify(flow)),
        context: JSON.parse(JSON.stringify(context)),
        errors: [...errors],
      } as TransactionCheckpoint

      // Optimize DB operations - only perform when necessary
      if (hasFinished) {
        if (!retentionTime) {
          if (!flow.metadata?.parentStepIdempotencyKey) {
            await this.deleteFromDb(data)
          } else {
            await this.saveToDb(data, retentionTime)
          }
        } else {
          await this.saveToDb(data, retentionTime)
        }

        delete this.storage[key]
      } else {
        await this.saveToDb(data, retentionTime)
      }

      return data
    } finally {
      this.isLocked.delete(key)
    }
  }

  async #preventRaceConditionExecutionIfNecessary({
    data,
    key,
    options,
  }: {
    data: TransactionCheckpoint
    key: string
    options?: TransactionOptions
  }) {
    const isInitialCheckpoint = [TransactionState.NOT_STARTED].includes(
      data.flow.state
    )
    /**
     * In case many execution can succeed simultaneously, we need to ensure that the latest
     * execution does continue if a previous execution is considered finished
     */
    const currentFlow = data.flow

    const rawData = this.storage[key]
    let data_ = {} as TransactionCheckpoint
    if (rawData) {
      data_ = rawData as TransactionCheckpoint
    } else {
      const getOptions = {
        ...options,
        isCancelling: !!data.flow.cancelledAt,
      } as Parameters<typeof this.get>[1]

      data_ =
        (await this.get(key, getOptions as TransactionOptions)) ??
        ({ flow: {} } as TransactionCheckpoint)
    }

    const { flow: latestUpdatedFlow } = data_
    if (options?.stepId) {
      const stepId = options.stepId
      const currentStep = data.flow.steps[stepId]
      const latestStep = latestUpdatedFlow.steps?.[stepId]
      if (latestStep && currentStep) {
        const isCompensating = data.flow.state === TransactionState.COMPENSATING

        const latestState = isCompensating
          ? latestStep.compensate?.state
          : latestStep.invoke?.state

        const shouldSkip = doneStates.has(latestState)

        if (shouldSkip) {
          throw new SkipStepAlreadyFinishedError(
            `Step ${stepId} already finished by another execution`
          )
        }
      }
    }

    if (
      !isInitialCheckpoint &&
      !isPresent(latestUpdatedFlow) &&
      !data.flow.metadata?.parentStepIdempotencyKey
    ) {
      /**
       * the initial checkpoint expect no other checkpoint to have been stored.
       * In case it is not the initial one and another checkpoint is trying to
       * find if a concurrent execution has finished, we skip the execution.
       * The already finished execution would have deleted the checkpoint already.
       */
      throw new SkipExecutionError("Already finished by another execution")
    }

    // Ensure that the latest execution was not cancelled, otherwise we skip the execution
    const latestTransactionCancelledAt = latestUpdatedFlow.cancelledAt
    const currentTransactionCancelledAt = currentFlow.cancelledAt

    if (
      !!latestTransactionCancelledAt &&
      currentTransactionCancelledAt == null
    ) {
      throw new SkipCancelledExecutionError(
        "Workflow execution has been cancelled during the execution"
      )
    }
  }

  private createDelayedActionId(
    kind: WorkflowDelayedActionKind,
    transaction: DistributedTransactionType,
    step?: TransactionStep
  ): string {
    const key = [kind, transaction.modelId, transaction.transactionId]

    if (step) {
      key.push(step.id)
    }

    return key.join(":")
  }

  private getWorkflowDelayedActionContext(
    transaction: DistributedTransactionType
  ): WorkflowDelayedActionContext {
    const metadata = transaction.getFlow().metadata ?? {}
    const eventGroupId = metadata.eventGroupId
    const parentStepIdempotencyKey = metadata.parentStepIdempotencyKey
    const preventReleaseEvents = metadata.preventReleaseEvents

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

  private async scheduleWorkflowDelayedAction({
    kind,
    transaction,
    step,
    interval,
  }: {
    kind: WorkflowDelayedActionKind
    transaction: DistributedTransactionType
    step?: TransactionStep
    interval: number
  }): Promise<void> {
    const workflowId = transaction.modelId
    const transactionId = transaction.transactionId
    const delay = interval * 1e3
    const action: WorkflowDelayedAction = {
      id: this.createDelayedActionId(kind, transaction, step),
      kind,
      workflowId,
      transactionId,
      stepId: step?.id,
      dueAt: Date.now() + delay,
      context: this.getWorkflowDelayedActionContext(transaction),
    }

    await this.delayedActionStore_.set(
      action,
      async (delayedAction) =>
        await this.runDelayedWorkflowAction(delayedAction)
    )
  }

  private async clearWorkflowDelayedAction(
    kind: WorkflowDelayedActionKind,
    transaction: DistributedTransactionType,
    step?: TransactionStep
  ): Promise<void> {
    await this.delayedActionStore_.delete(
      this.createDelayedActionId(kind, transaction, step)
    )
  }

  private async runDelayedWorkflowAction(
    action: WorkflowDelayedAction
  ): Promise<void> {
    await this.workflowOrchestratorService_.run(action.workflowId, {
      transactionId: action.transactionId,
      logOnError: true,
      throwOnError: false,
      context: action.context,
    })
  }

  async scheduleRetry(
    transaction: DistributedTransactionType,
    step: TransactionStep,
    timestamp: number,
    interval: number
  ): Promise<void> {
    await this.scheduleWorkflowDelayedAction({
      kind: "retry-step",
      transaction,
      step,
      interval,
    })
  }

  async clearRetry(
    transaction: DistributedTransactionType,
    step: TransactionStep
  ): Promise<void> {
    await this.clearWorkflowDelayedAction("retry-step", transaction, step)
  }

  async scheduleTransactionTimeout(
    transaction: DistributedTransactionType,
    timestamp: number,
    interval: number
  ): Promise<void> {
    await this.scheduleWorkflowDelayedAction({
      kind: "transaction-timeout",
      transaction,
      interval,
    })
  }

  async clearTransactionTimeout(
    transaction: DistributedTransactionType
  ): Promise<void> {
    await this.clearWorkflowDelayedAction("transaction-timeout", transaction)
  }

  async scheduleStepTimeout(
    transaction: DistributedTransactionType,
    step: TransactionStep,
    timestamp: number,
    interval: number
  ): Promise<void> {
    await this.scheduleWorkflowDelayedAction({
      kind: "step-timeout",
      transaction,
      step,
      interval,
    })
  }

  async clearStepTimeout(
    transaction: DistributedTransactionType,
    step: TransactionStep
  ): Promise<void> {
    await this.clearWorkflowDelayedAction("step-timeout", transaction, step)
  }

  /* Scheduler storage methods */
  async schedule(
    jobDefinition: string | { jobId: string },
    schedulerOptions: SchedulerOptions
  ): Promise<void> {
    const jobId =
      typeof jobDefinition === "string" ? jobDefinition : jobDefinition.jobId

    // In order to ensure that the schedule configuration is always up to date, we first cancel an existing job, if there was one
    await this.remove(jobId)

    let expression: WorkflowCronExpression | number
    let nextExecution: number

    if ("cron" in schedulerOptions) {
      // Cache the parsed expression to avoid repeated parsing
      expression = this.parseCronExpression(schedulerOptions.cron)
      nextExecution = calculateDelayFromExpression(expression)
    } else if ("interval" in schedulerOptions) {
      expression = schedulerOptions.interval
      nextExecution = schedulerOptions.interval
    } else {
      throw new MedusaError(
        MedusaError.Types.INVALID_ARGUMENT,
        "Schedule cron or interval definition is required for scheduled jobs."
      )
    }

    const timer = this.createManagedTimer(async () => {
      this.jobHandler(jobId)
    }, nextExecution)

    // Set the timer's unref when available to prevent it from keeping Node alive.
    this.schedulerAdapter_.unref?.(timer)

    await this.scheduleStore_.set(jobId, {
      timer,
      expression,
      numberOfExecutions: 0,
      config: schedulerOptions,
    })
  }

  async remove(jobId: string): Promise<void> {
    const job = await this.scheduleStore_.get(jobId)
    if (!job) {
      return
    }

    this.schedulerAdapter_.clearTimeout(job.timer)
    await this.scheduleStore_.delete(jobId)
  }

  async removeAll(): Promise<void> {
    for (const [key] of await this.scheduleStore_.entries()) {
      await this.remove(key)
    }
  }

  async recoverDueSchedules(
    now?: number
  ): Promise<WorkflowScheduleRecoveryResult> {
    const scheduleStore = this.scheduleStore_
    if (!isRecoverableWorkflowScheduleStore(scheduleStore)) {
      return {
        dueCount: 0,
        recoveredJobIds: [],
        skippedRuntimeJobIds: [],
        deletedJobIds: [],
      }
    }

    return await scheduleStore.recoverDueSchedules(
      async (jobId) => await this.runScheduledWorkflow(jobId),
      now
    )
  }

  async recoverDueDelayedActions(
    now?: number
  ): Promise<WorkflowDelayedActionRecoveryResult> {
    const delayedActionStore = this.delayedActionStore_
    if (!isRecoverableWorkflowDelayedActionStore(delayedActionStore)) {
      return {
        dueCount: 0,
        recoveredActionIds: [],
        failedActionIds: [],
      }
    }

    return await delayedActionStore.recoverDueActions(
      async (action) => await this.runDelayedWorkflowAction(action),
      now
    )
  }

  async jobHandler(jobId: string) {
    const job = await this.scheduleStore_.get(jobId)
    if (!job) {
      return
    }

    if (
      job.config?.numberOfExecutions !== undefined &&
      job.config.numberOfExecutions <= job.numberOfExecutions
    ) {
      await this.scheduleStore_.delete(jobId)
      return
    }

    const nextExecution = this.parseNextExecution(job.expression)

    try {
      await this.runScheduledWorkflow(jobId)

      const timer = this.createManagedTimer(() => {
        this.jobHandler(jobId)
      }, nextExecution)

      this.schedulerAdapter_.unref?.(timer)

      await this.scheduleStore_.set(jobId, {
        timer,
        expression: job.expression,
        numberOfExecutions: (job.numberOfExecutions ?? 0) + 1,
        config: job.config,
      })
    } catch (e) {
      if (e instanceof MedusaError && e.type === MedusaError.Types.NOT_FOUND) {
        this.logger_?.warn(
          `Tried to execute a scheduled workflow with ID ${jobId} that does not exist, removing it from the scheduler.`
        )

        await this.remove(jobId)
        return
      }

      throw e
    }
  }

  private async runScheduledWorkflow(jobId: string): Promise<void> {
    await this.workflowOrchestratorService_.run(jobId, {
      logOnError: true,
      throwOnError: false,
    })
  }

  async clearExpiredExecutions(): Promise<void> {
    const executions = await this.workflowExecutionStore_.listExpirableFinished()

    const now = Date.now()
    const expiredExecutions = executions
      .filter((execution) => {
        if (!execution.retention_time) {
          return false
        }

        const updatedAt = new Date(execution.updated_at).getTime()
        const expiresAt = updatedAt + execution.retention_time * 1000

        return expiresAt <= now
      })

    if (expiredExecutions.length) {
      await this.workflowExecutionStore_.delete(expiredExecutions)
    }
  }
}

function isRecoverableWorkflowScheduleStore(
  value: WorkflowScheduleStore
): value is RecoverableWorkflowScheduleStore {
  return (
    "recoverDueSchedules" in value &&
    typeof value.recoverDueSchedules === "function"
  )
}

function isRecoverableWorkflowDelayedActionStore(
  value: WorkflowDelayedActionStore
): value is RecoverableWorkflowDelayedActionStore {
  return (
    "recoverDueActions" in value &&
    typeof value.recoverDueActions === "function"
  )
}

function toExpirableWorkflowExecution(
  execution: WorkflowExecutionStoreRecord
): ExpirableWorkflowExecution {
  if (
    typeof execution.workflow_id !== "string" ||
    typeof execution.transaction_id !== "string" ||
    typeof execution.run_id !== "string" ||
    execution.updated_at === undefined ||
    execution.retention_time === undefined
  ) {
    throw new Error("Workflow execution expiry row has an invalid shape")
  }

  return {
    workflow_id: execution.workflow_id,
    transaction_id: execution.transaction_id,
    run_id: execution.run_id,
    updated_at: execution.updated_at,
    retention_time: execution.retention_time,
  }
}
