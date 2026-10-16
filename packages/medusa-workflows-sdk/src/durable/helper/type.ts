import type { NativeWorkflowRuntime } from "@medusajs/orchestration/runtime"
import type { WorkflowContainer as MedusaContainer } from "@medusajs/orchestration/runtime"
import type {
  DistributedTransactionEvents,
  DistributedTransactionType,
  TransactionStepError,
  TransactionCheckpoint,
} from "@medusajs/orchestration/transaction"
import type { LocalWorkflow } from "@medusajs/orchestration/workflow/local-workflow"
import type { Context, LoadedModule } from "@medusajs/types"

type BaseFlowRunOptions = {
  runtime?: NativeWorkflowRuntime
  context?: Context
  resultFrom?: string | Symbol
  throwOnError?: boolean
  logOnError?: boolean
  events?: DistributedTransactionEvents
  container?: LoadedModule[] | MedusaContainer
}

export type FlowRunOptions<TData = unknown> = BaseFlowRunOptions & {
  input?: TData
}

export type FlowRegisterStepSuccessOptions<TData = unknown> =
  BaseFlowRunOptions & {
    idempotencyKey: string
    response?: TData
  }

export type FlowRetryStepOptions = Omit<BaseFlowRunOptions, "resultFrom"> & {
  idempotencyKey: string
}

export type FlowRegisterStepFailureOptions<TData = unknown> =
  BaseFlowRunOptions & {
    idempotencyKey: string
    response?: TData
    forcePermanentFailure?: boolean
  }

export type FlowCancelOptions = {
  transaction?: DistributedTransactionType
  transactionId?: string
  runtime?: NativeWorkflowRuntime
  context?: Context
  throwOnError?: boolean
  logOnError?: boolean
  events?: DistributedTransactionEvents
  container?: LoadedModule[] | MedusaContainer
}

/**
 * The details of a workflow's execution.
 */
export type WorkflowResult<TResult = unknown> = {
  /**
   * Any errors that occured in the workflow.
   */
  errors: TransactionStepError[]
  /**
   * The transaction details of the workflow's execution.
   */
  transaction: DistributedTransactionType
  /**
   * The result returned by the workflow.
   */
  result: TResult
}

export type ExportedWorkflow<
  TData = unknown,
  TResult = unknown,
  TDataOverride = undefined,
  TResultOverride = undefined
> = {
  /** Private execution-profile seam: evaluate the existing native return
   * reference against an actual recovered transaction without rescheduling. */
  resolveResult: (transaction: DistributedTransactionType | TransactionCheckpoint) => unknown | Promise<unknown>
  /** Private cold-terminal recovery: replay the existing native finish policy
   * against the actual recovered transaction and its current runtime. */
  recoverTerminalEvents: (transaction: DistributedTransactionType, options: {
    runtime: NativeWorkflowRuntime
    logOnError?: boolean
  }) => Promise<void>
  run: (
    args?: FlowRunOptions<
      TDataOverride extends undefined ? TData : TDataOverride
    >
  ) => Promise<
    WorkflowResult<
      TResultOverride extends undefined ? TResult : TResultOverride
    >
  >
  registerStepSuccess: (
    args?: FlowRegisterStepSuccessOptions<
      TDataOverride extends undefined ? TData : TDataOverride
    >
  ) => Promise<
    WorkflowResult<
      TResultOverride extends undefined ? TResult : TResultOverride
    >
  >
  registerStepFailure: (
    args?: FlowRegisterStepFailureOptions<
      TDataOverride extends undefined ? TData : TDataOverride
    >
  ) => Promise<
    WorkflowResult<
      TResultOverride extends undefined ? TResult : TResultOverride
    >
  >
  retryStep: (args?: FlowRetryStepOptions) => Promise<WorkflowResult>
  cancel: (args?: FlowCancelOptions) => Promise<WorkflowResult>
}

export type MainExportedWorkflow<TData = unknown, TResult = unknown> = {
  // Main function on the exported workflow
  <TDataOverride = undefined, TResultOverride = undefined>(
    container?: LoadedModule[] | MedusaContainer
  ): Omit<
    LocalWorkflow,
    "run" | "registerStepSuccess" | "registerStepFailure" | "cancel"
  > &
    ExportedWorkflow<TData, TResult, TDataOverride, TResultOverride>
} & {
  /**
   * You can also directly call run, registerStepSuccess, registerStepFailure and cancel on the exported workflow
   */

  run<TDataOverride = undefined, TResultOverride = undefined>(
    args?: FlowRunOptions<
      TDataOverride extends undefined ? TData : TDataOverride
    >
  ): Promise<
    WorkflowResult<
      TResultOverride extends undefined ? TResult : TResultOverride
    >
  >

  registerStepSuccess<TDataOverride = undefined, TResultOverride = undefined>(
    args?: FlowRegisterStepSuccessOptions<
      TDataOverride extends undefined ? TData : TDataOverride
    >
  ): Promise<
    WorkflowResult<
      TResultOverride extends undefined ? TResult : TResultOverride
    >
  >

  registerStepFailure<TDataOverride = undefined, TResultOverride = undefined>(
    args?: FlowRegisterStepFailureOptions<
      TDataOverride extends undefined ? TData : TDataOverride
    >
  ): Promise<
    WorkflowResult<
      TResultOverride extends undefined ? TResult : TResultOverride
    >
  >

  cancel(args?: FlowCancelOptions): Promise<WorkflowResult>
}
