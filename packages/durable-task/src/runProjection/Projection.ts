import { Encoding } from "effect";

import type { TaskRunListStoreItem } from "./ListSchema.js";
import type {
  ApplicationTaskRunAttemptAggregateV1,
  ApplicationTaskSystemRunAttemptInspectionSnapshotV1,
  TaskAcceptedRetryV1,
  TaskCancellationStateV1,
  TaskCurrentAttemptV1,
  TaskExecutionFailureV1,
  TaskResultCommitmentV1,
} from "../runAttempt/Model.js";
import type {
  TaskRunActiveCancellationProjection,
  TaskRunAttemptProjection,
  TaskRunCancellationResolvedProjection,
  TaskRunCompletionCancellationProjection,
  TaskRunFailureProjection,
  TaskRunProjection,
  TaskRunResultMetadata,
  TaskRunRetryProjection,
  TaskRunStateProjection,
} from "./Model.js";

function frozen<RecordType extends object>(value: RecordType): Readonly<RecordType> {
  return Object.freeze(value);
}

function projectFailure(
  failure: TaskExecutionFailureV1,
): TaskRunFailureProjection {
  switch (failure.kind) {
    case "task_failure":
      return frozen({ kind: "task_failure", code: failure.code });
    case "system_failure":
      return frozen({ kind: "system_failure", code: failure.code });
    case "resource_exhaustion":
      return frozen({ kind: "resource_exhaustion", code: failure.code });
    case "timed_out":
      return frozen({ kind: "timed_out", code: failure.code });
  }
}

function projectAttempt(
  attempt: TaskCurrentAttemptV1,
): TaskRunAttemptProjection {
  return frozen({
    attemptNumber: attempt.attemptNumber,
    computeProfile: attempt.computeProfile,
    grantedAtMs: attempt.grantedAtMs,
    leaseExpiresAtMs: attempt.lease.expiresAtMs,
  });
}

function projectRetry(retry: TaskAcceptedRetryV1): TaskRunRetryProjection {
  return frozen({
    previousAttemptNumber: retry.previousAttempt.attemptNumber,
    acceptedAtMs: retry.acceptedAtMs,
    eligibleAtMs: retry.notBeforeMs,
    nextComputeProfile: retry.nextComputeProfile,
    cause: frozen({
      kind: retry.cause.kind,
      failure: projectFailure(retry.cause.failure),
    }),
  });
}

function projectResult(
  result: TaskResultCommitmentV1,
): TaskRunResultMetadata {
  return frozen({
    codec: result.codec,
    byteLength: result.byteLength,
    sha256Hex: Encoding.encodeHex(result.sha256),
  });
}

function projectActiveCancellation(
  cancellation: Extract<TaskCancellationStateV1, {
    readonly kind: "not_requested" | "requested";
  }>,
): TaskRunActiveCancellationProjection {
  if (cancellation.kind === "not_requested") {
    return frozen({ kind: "not_requested" });
  }
  return frozen({
    kind: "requested",
    code: cancellation.reason.code,
    requestedAtMs: cancellation.requestedAtMs,
  });
}

function projectResolvedCancellation<
  Resolution extends Extract<
    TaskCancellationStateV1,
    { readonly kind: "resolved" }
  >["resolution"],
>(
  cancellation: Extract<TaskCancellationStateV1, {
    readonly kind: "resolved";
  }> & { readonly resolution: Resolution },
): TaskRunCancellationResolvedProjection<Resolution> {
  return frozen({
    kind: "resolved",
    code: cancellation.reason.code,
    requestedAtMs: cancellation.requestedAtMs,
    resolvedAtMs: cancellation.resolvedAtMs,
    resolution: cancellation.resolution,
  });
}

function projectCompletionCancellation(
  cancellation: ApplicationTaskRunAttemptAggregateV1["cancellation"],
): TaskRunCompletionCancellationProjection {
  if (cancellation.kind === "not_requested") {
    return frozen({ kind: "not_requested" });
  }
  if (
    cancellation.kind !== "resolved" ||
    cancellation.resolution !== "superseded_by_completion"
  ) {
    throw new Error("Invalid terminal completion cancellation state");
  }
  return projectResolvedCancellation(cancellation);
}

function projectState(
  aggregate: ApplicationTaskRunAttemptAggregateV1,
): TaskRunStateProjection {
  switch (aggregate.phase) {
    case "ready":
      return frozen({
        kind: "ready",
        eligibleAtMs: aggregate.ready.eligibleAtMs,
        retry: aggregate.ready.kind === "immediate_retry"
          ? projectRetry(aggregate.ready.acceptedRetry)
          : null,
        cancellation: frozen({ kind: "not_requested" }),
      });
    case "attempt_granted":
      return frozen({
        kind: "attempt_granted",
        attempt: projectAttempt(aggregate.currentAttempt),
        cancellation: projectActiveCancellation(aggregate.cancellation),
      });
    case "executing":
      return frozen({
        kind: "executing",
        attempt: projectAttempt(aggregate.currentAttempt),
        cancellation: projectActiveCancellation(aggregate.cancellation),
      });
    case "retry_waiting":
      return frozen({
        kind: "retry_waiting",
        retry: projectRetry(aggregate.retry),
        cancellation: frozen({ kind: "not_requested" }),
      });
    case "terminal": {
      const { cancellation, terminal } = aggregate;
      switch (terminal.kind) {
        case "succeeded":
          return frozen({
            kind: "succeeded",
            completedAtMs: terminal.completedAtMs,
            attemptNumber: terminal.attempt.attemptNumber,
            executionDurationMs: terminal.executionDurationMs,
            result: terminal.result === null ? null : projectResult(terminal.result),
            cancellation: projectCompletionCancellation(cancellation),
          });
        case "failed":
          return frozen({
            kind: "failed",
            completedAtMs: terminal.completedAtMs,
            attemptNumber: terminal.attempt?.attemptNumber ?? null,
            executionDurationMs: terminal.executionDurationMs,
            failure: projectFailure(terminal.failure),
            cancellation: projectCompletionCancellation(cancellation),
          });
        case "cancelled": {
          if (
            cancellation.kind !== "resolved" ||
            cancellation.resolution !== terminal.resolution
          ) {
            throw new Error("Invalid terminal cancellation resolution state");
          }
          switch (terminal.resolution) {
            case "without_active_attempt":
              if (cancellation.resolution !== "without_active_attempt") {
                throw new Error("Invalid cancellation resolution");
              }
              return frozen({
                kind: "cancelled",
                completedAtMs: terminal.completedAtMs,
                attemptNumber: null,
                executionDurationMs: null,
                cancellation: projectResolvedCancellation(cancellation),
              });
            case "acknowledged":
              if (cancellation.resolution !== "acknowledged") {
                throw new Error("Invalid cancellation resolution");
              }
              return frozen({
                kind: "cancelled",
                completedAtMs: terminal.completedAtMs,
                attemptNumber: terminal.attempt.attemptNumber,
                executionDurationMs: terminal.executionDurationMs,
                cancellation: projectResolvedCancellation(cancellation),
              });
            case "lease_expired":
              if (cancellation.resolution !== "lease_expired") {
                throw new Error("Invalid cancellation resolution");
              }
              return frozen({
                kind: "cancelled",
                completedAtMs: terminal.completedAtMs,
                attemptNumber: terminal.attempt.attemptNumber,
                executionDurationMs: null,
                cancellation: projectResolvedCancellation(cancellation),
              });
          }
        }
      }
    }
  }
}

/**
 * Projects one already scope-authorized and decoded Application Task snapshot.
 * This pure boundary exposes no lifecycle command authority or result body.
 */
export function projectTaskRun(
  snapshot: ApplicationTaskSystemRunAttemptInspectionSnapshotV1,
): TaskRunProjection {
  return projectTaskRunListItem(snapshot.observedAtMs, {
    runId: snapshot.current.runId,
    createdAtMs: snapshot.current.createdAtMs,
    runVersion: snapshot.current.runVersion,
    state: projectState(snapshot.current),
  });
}

/** Projects one decoded, bounded list row through the point-view owner. */
export function projectTaskRunListItem(
  observedAtMs: TaskRunProjection["observedAtMs"],
  current: TaskRunListStoreItem,
): TaskRunProjection {
  return frozen({
    runId: current.runId,
    createdAtMs: current.createdAtMs,
    observedAtMs,
    runVersion: current.runVersion,
    state: ownProjectionState(current.state),
  });
}

function ownProjectionState(
  state: TaskRunStateProjection,
): TaskRunStateProjection {
  switch (state.kind) {
    case "ready":
      return frozen({
        kind: "ready",
        eligibleAtMs: state.eligibleAtMs,
        retry: state.retry === null ? null : ownRetry(state.retry),
        cancellation: frozen({ kind: "not_requested" }),
      });
    case "attempt_granted":
    case "executing":
      return frozen({
        kind: state.kind,
        attempt: ownAttempt(state.attempt),
        cancellation: ownActiveCancellation(state.cancellation),
      });
    case "retry_waiting":
      return frozen({
        kind: "retry_waiting",
        retry: ownRetry(state.retry),
        cancellation: frozen({ kind: "not_requested" }),
      });
    case "succeeded":
      return frozen({
        kind: "succeeded",
        completedAtMs: state.completedAtMs,
        attemptNumber: state.attemptNumber,
        executionDurationMs: state.executionDurationMs,
        result: state.result === null ? null : frozen({ ...state.result }),
        cancellation: ownCompletionCancellation(state.cancellation),
      });
    case "failed":
      return frozen({
        kind: "failed",
        completedAtMs: state.completedAtMs,
        attemptNumber: state.attemptNumber,
        executionDurationMs: state.executionDurationMs,
        failure: frozen({ ...state.failure }),
        cancellation: ownCompletionCancellation(state.cancellation),
      });
    case "cancelled":
      return ownCancelledState(state);
  }
}

function ownCancelledState(
  state: Extract<TaskRunStateProjection, { readonly kind: "cancelled" }>,
): Extract<TaskRunStateProjection, { readonly kind: "cancelled" }> {
  if (state.attemptNumber === null) {
    if (state.cancellation.resolution !== "without_active_attempt") {
      throw new Error("Invalid projected cancellation without attempt");
    }
    return frozen({
      kind: "cancelled",
      completedAtMs: state.completedAtMs,
      attemptNumber: null,
      executionDurationMs: null,
      cancellation: frozen({ ...state.cancellation }),
    });
  }
  switch (state.cancellation.resolution) {
    case "acknowledged":
      return frozen({
        kind: "cancelled",
        completedAtMs: state.completedAtMs,
        attemptNumber: state.attemptNumber,
        executionDurationMs: state.executionDurationMs,
        cancellation: frozen({ ...state.cancellation }),
      });
    case "lease_expired":
      return frozen({
        kind: "cancelled",
        completedAtMs: state.completedAtMs,
        attemptNumber: state.attemptNumber,
        executionDurationMs: null,
        cancellation: frozen({ ...state.cancellation }),
      });
  }
}

function ownAttempt(
  attempt: TaskRunAttemptProjection,
): TaskRunAttemptProjection {
  return frozen({ ...attempt });
}

function ownRetry(retry: TaskRunRetryProjection): TaskRunRetryProjection {
  return frozen({
    ...retry,
    cause: frozen({
      ...retry.cause,
      failure: frozen({ ...retry.cause.failure }),
    }),
  });
}

function ownActiveCancellation(
  cancellation: TaskRunActiveCancellationProjection,
): TaskRunActiveCancellationProjection {
  return frozen({ ...cancellation });
}

function ownCompletionCancellation(
  cancellation: TaskRunCompletionCancellationProjection,
): TaskRunCompletionCancellationProjection {
  return frozen({ ...cancellation });
}
