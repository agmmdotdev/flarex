import { TransactionCheckpoint } from "./distributed-transaction"
import { SkipCancelledExecutionError, SkipExecutionError, SkipStepAlreadyFinishedError } from "./errors"
import { TransactionState, type TransactionOptions } from "./types"
import { TransactionStepState } from "@medusajs/utils/orchestration/types"

const doneStates = new Set([
  TransactionStepState.DONE, TransactionStepState.REVERTED, TransactionStepState.FAILED,
  TransactionStepState.SKIPPED, TransactionStepState.SKIPPED_FAILURE, TransactionStepState.TIMEOUT,
])

/** Native JSON storage boundary extracted from workflow-engine-redis's
 * workflow-orchestrator-storage.get (pinned 48d5cc675e4e8bc821e22c20c88a751acc66fb5f).
 * The admitted framework profile validates the decoded wire value before the
 * genuine checkpoint constructor; no application value normalization occurs. */
export function decodeNativeWorkflowCheckpointJson(json: string, validate: (value: unknown) => void): TransactionCheckpoint {
  const data = JSON.parse(json)
  validate(data)
  return new TransactionCheckpoint(data.flow, data.context, data.errors)
}

/** Pure native save merge/race checks from the same pinned Redis storage
 * owner. The caller supplies its already locked current checkpoint; Redis,
 * retention and lifecycle are outside this explicit storage profile. */
export function mergeNativeWorkflowCheckpointForSave(data: TransactionCheckpoint, storedData: TransactionCheckpoint | undefined, options?: TransactionOptions): void {
  if (data.flow._v) TransactionCheckpoint.mergeCheckpoints(data, storedData)
  const isInitialCheckpoint = [TransactionState.NOT_STARTED].includes(data.flow.state)
  const currentFlow = data.flow
  const latestUpdatedFlow = storedData?.flow
  if (options?.stepId) {
    const stepId = options.stepId
    const currentStep = data.flow.steps[stepId]
    const latestStep = latestUpdatedFlow?.steps?.[stepId]
    if (latestStep && currentStep) {
      const isCompensating = data.flow.state === TransactionState.COMPENSATING
      const latestState = isCompensating ? latestStep.compensate?.state : latestStep.invoke?.state
      if (doneStates.has(latestState)) {
        throw new SkipStepAlreadyFinishedError(`Step ${stepId} already finished by another execution`)
      }
    }
  }
  if (!isInitialCheckpoint && !latestUpdatedFlow && !data.flow.metadata?.parentStepIdempotencyKey) {
    throw new SkipExecutionError("Already finished by another execution")
  }
  const latestTransactionCancelledAt = latestUpdatedFlow?.cancelledAt
  const currentTransactionCancelledAt = currentFlow.cancelledAt
  if (!!latestTransactionCancelledAt && currentTransactionCancelledAt == null) {
    throw new SkipCancelledExecutionError("Workflow execution has been cancelled during the execution")
  }
}
