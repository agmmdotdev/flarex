import { Effect, Result } from "effect";

import {
  TaskComputeCancellationContractError,
  TaskComputeDispatchContractError,
} from "./Errors.js";
import type {
  TaskComputeDispatchIdentityV1,
  TaskComputeExecutionRefV1,
} from "./Model.js";
import {
  validateTaskComputeCancellationReceiptV1,
  validateTaskComputeCancellationRequestV1,
  validateTaskComputeDispatchAcceptanceV1,
  validateCurrentTaskComputeDispatchRequestV1,
} from "./Schema.js";
import type { TaskComputeProviderShape } from "./Services/TaskComputeProvider.js";

export function makeTaskComputeProviderV1(
  implementation: TaskComputeProviderShape,
): TaskComputeProviderShape {
  const owner = implementation;
  const dispatchMethod = implementation.dispatch;
  const cancellationMethod = implementation.requestCancellation;

  return Object.freeze({
    dispatch: Effect.fn("TaskComputeProvider.dispatch")(function* (suppliedRequest) {
      const request = yield* Effect.fromResult(
        validateCurrentTaskComputeDispatchRequestV1(suppliedRequest),
      );
      const suppliedAcceptance = yield* dispatchMethod.call(owner, request);
      const acceptance = yield* Effect.fromResult(
        validateTaskComputeDispatchAcceptanceV1(suppliedAcceptance).pipe(
          Result.mapError(() => new TaskComputeDispatchContractError({
            operation: "dispatch",
            reason: "malformed_receipt",
            execution: null,
          })),
        ),
      );
      if (!identitiesEqual(request.identity, acceptance.identity)) {
        return yield* new TaskComputeDispatchContractError({
          operation: "dispatch",
          reason: "receipt_correlation_mismatch",
          execution: acceptance.execution,
        });
      }
      return acceptance;
    }),
    requestCancellation: Effect.fn("TaskComputeProvider.requestCancellation")(
      function* (suppliedRequest) {
        const request = yield* Effect.fromResult(
          validateTaskComputeCancellationRequestV1(suppliedRequest),
        );
        const suppliedReceipt = yield* cancellationMethod.call(owner, request);
        const receipt = yield* Effect.fromResult(
          validateTaskComputeCancellationReceiptV1(suppliedReceipt).pipe(
            Result.mapError(() => new TaskComputeCancellationContractError({
              operation: "request_cancellation",
              reason: "malformed_receipt",
              execution: null,
            })),
          ),
        );
        if (
          !identitiesEqual(request.identity, receipt.identity) ||
          !executionRefsEqual(request.execution, receipt.execution) ||
          request.cancellationGeneration !== receipt.cancellationGeneration
        ) {
          return yield* new TaskComputeCancellationContractError({
            operation: "request_cancellation",
            reason: "receipt_correlation_mismatch",
            execution: receipt.execution,
          });
        }
        return receipt;
      },
    ),
  });
}

function identitiesEqual(
  left: TaskComputeDispatchIdentityV1,
  right: TaskComputeDispatchIdentityV1,
): boolean {
  return left.version === right.version &&
    left.scopeId === right.scopeId &&
    left.runId === right.runId &&
    left.requestedEffectSequence === right.requestedEffectSequence &&
    left.attemptId === right.attemptId &&
    left.executionFence === right.executionFence;
}

function executionRefsEqual(
  left: TaskComputeExecutionRefV1,
  right: TaskComputeExecutionRefV1,
): boolean {
  return left.provider === right.provider &&
    left.providerVersion === right.providerVersion &&
    left.executionId === right.executionId;
}
