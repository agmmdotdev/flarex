import type {
  TaskComputeDispatchIdentityV1,
  TaskComputeExecutionIdV1,
} from "@flarex/durable-task/internal/compute-provider-v1";
import type {
  TaskCancellationGenerationV1,
} from "@flarex/durable-task/internal/run-attempt-v1";
import { Brand, Effect } from "effect";
import {
  TASK_WORKER_SESSION_INTERRUPTION_FORMAT_V1,
  TASK_WORKER_SESSION_INTERRUPTION_VERSION_V1,
  type TaskWorkerSessionAcceptanceV1,
  type TaskWorkerSessionInterruptionRequestV1,
  type TaskWorkerSessionSettlementV1,
} from "flarex-protocol/internal/task-worker-session-v1";

import {
  type TaskWorkerSession,
  TaskWorkerSessionHostError,
} from "../artifactRuntime/TaskWorkerSessionHost.js";
import {
  type TaskExecutionInterruptionRequest,
  type TaskExecutionSession,
  type TaskExecutionSessionAcceptance,
  TaskExecutionSessionError,
  type TaskExecutionSessionSettlement,
} from "./TaskExecutionSession.js";

/** Projects the current Worker session ABI into the provider-neutral seam. */
export function adaptWorkerLoaderTaskExecutionSession(
  workerSession: TaskWorkerSession,
): TaskExecutionSession {
  const requestInterruption: TaskExecutionSession["requestInterruption"] =
    Effect.fn("WorkerLoaderTaskExecutionSession.requestInterruption")(
      request => workerSession.requestInterruption(
        projectInterruptionRequest(request),
      ).pipe(
        Effect.asVoid,
        Effect.mapError(cause => sessionFailure(
          "requestInterruption",
          cause,
        )),
      ),
    );
  return Object.freeze({
    acceptance: projectAcceptance(workerSession.acceptance),
    maximumCloseMilliseconds: workerSession.maximumCloseMilliseconds,
    requestInterruption,
    settlement: workerSession.settlement.pipe(
      Effect.map(projectSettlement),
      Effect.mapError(cause => sessionFailure("settlement", cause)),
    ),
    close: workerSession.close.pipe(
      Effect.mapError(cause => sessionFailure("close", cause)),
    ),
  });
}

function projectAcceptance(
  acceptance: TaskWorkerSessionAcceptanceV1,
): TaskExecutionSessionAcceptance {
  return Object.freeze({
    generation: acceptance.generation,
    identity: projectIdentity(acceptance.identity),
    executionId: projectExecutionId(acceptance.executionId),
    cancellationGeneration: projectCancellationGeneration(
      acceptance.cancellationGeneration,
    ),
  });
}

function projectInterruptionRequest(
  request: TaskExecutionInterruptionRequest,
): TaskWorkerSessionInterruptionRequestV1 {
  return Object.freeze({
    format: TASK_WORKER_SESSION_INTERRUPTION_FORMAT_V1,
    version: TASK_WORKER_SESSION_INTERRUPTION_VERSION_V1,
    generation: request.generation,
    identity: request.identity,
    executionId: request.executionId,
    cancellationGeneration: request.cancellationGeneration,
    reason: request.reason,
  });
}

function projectSettlement(
  settlement: TaskWorkerSessionSettlementV1,
): TaskExecutionSessionSettlement {
  return Object.freeze({
    generation: settlement.generation,
    identity: projectIdentity(settlement.identity),
    executionId: projectExecutionId(settlement.executionId),
    outcome: projectOutcome(settlement.outcome),
  });
}

function projectOutcome(
  outcome: TaskWorkerSessionSettlementV1["outcome"],
): TaskExecutionSessionSettlement["outcome"] {
  switch (outcome.kind) {
    case "completed":
      return Object.freeze({
        kind: "completed" as const,
        result: Object.freeze({
          value: outcome.result.value,
          valueSemanticBytes: outcome.result.valueSemanticBytes,
        }),
      });
    case "failed":
      return Object.freeze({
        kind: "failed" as const,
        failure: Object.freeze({ ...outcome.failure }),
      });
    case "interrupted":
      return Object.freeze({
        kind: "interrupted" as const,
        interruption: Object.freeze({
          cancellationGeneration: projectCancellationGeneration(
            outcome.interruption.cancellationGeneration,
          ),
          reason: outcome.interruption.reason,
        }),
      });
  }
}

function projectIdentity(
  identity: TaskWorkerSessionAcceptanceV1["identity"],
): TaskComputeDispatchIdentityV1 {
  // The strict Worker session decoder has already validated every field using
  // the same durable Task identity grammar. Brand that proof only here, at the
  // provider adapter boundary.
  return Object.freeze({
    version: identity.version,
    scopeId: identity.scopeId,
    runId: Brand.nominal<TaskComputeDispatchIdentityV1["runId"]>()(
      identity.runId,
    ),
    requestedEffectSequence: Brand.nominal<
      TaskComputeDispatchIdentityV1["requestedEffectSequence"]
    >()(identity.requestedEffectSequence),
    attemptId: Brand.nominal<TaskComputeDispatchIdentityV1["attemptId"]>()(
      identity.attemptId,
    ),
    executionFence: Brand.nominal<
      TaskComputeDispatchIdentityV1["executionFence"]
    >()(identity.executionFence),
  });
}

function projectExecutionId(value: string): TaskComputeExecutionIdV1 {
  // The strict Worker session decoder enforces the durable provider execution
  // ID's visible-ASCII spelling and byte ceiling before this adapter runs.
  return Brand.nominal<TaskComputeExecutionIdV1>()(value);
}

function projectCancellationGeneration(
  value: bigint,
): TaskCancellationGenerationV1 {
  // The strict Worker session decoder admits non-negative signed 64-bit values,
  // matching a subset of the durable cancellation-generation contract.
  return Brand.nominal<TaskCancellationGenerationV1>()(value);
}

function sessionFailure(
  operation: TaskExecutionSessionError["operation"],
  cause: TaskWorkerSessionHostError,
): TaskExecutionSessionError {
  return new TaskExecutionSessionError({
    operation,
    reason: providerNeutralReason(cause.reason),
    cause,
  });
}

function providerNeutralReason(
  reason: TaskWorkerSessionHostError["reason"],
): TaskExecutionSessionError["reason"] {
  switch (reason) {
    case "workerLoadFailed":
    case "workerStartFailed":
      return "providerUnavailable";
    case "workerDefinitionFailed":
      return "providerFailure";
    case "invalidRequest":
    case "invalidResponse":
    case "sessionLost":
    case "staleCancellation":
    case "inputBoundaryFailed":
    case "userCodeFailed":
    case "terminalFailed":
    case "timedOut":
    case "cleanupFailed":
      return reason;
  }
}
