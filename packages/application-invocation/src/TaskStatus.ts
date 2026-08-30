import type { StandardApplicationTaskRunStatus } from
  "@flarex/standard-application-invocation/internal/standard-application-task-run-query";

declare const TaskRunIdType: unique symbol;

/** Opaque durable run identity issued by the clean Application API. */
export type TaskRunId = string & { readonly [TaskRunIdType]: true };

export type TaskCancellationCode =
  | "requested"
  | "executionCancelled"
  | "policyCancelled";

export type TaskCancellationResolution =
  | "withoutActiveAttempt"
  | "acknowledged"
  | "leaseExpired"
  | "supersededByCompletion";

export interface TaskRunNotCancelled {
  readonly kind: "notRequested";
}

export interface TaskRunCancellationRequested {
  readonly kind: "requested";
  readonly code: TaskCancellationCode;
  readonly requestedAtMs: number;
}

export interface TaskRunCancellationResolved<
  Resolution extends TaskCancellationResolution = TaskCancellationResolution,
> {
  readonly kind: "resolved";
  readonly code: TaskCancellationCode;
  readonly requestedAtMs: number;
  readonly resolvedAtMs: number;
  readonly resolution: Resolution;
}

export interface TaskRunAttempt {
  readonly attemptNumber: number;
  readonly computeProfile: string;
  readonly grantedAtMs: number;
  readonly leaseExpiresAtMs: number;
}

export type TaskRunFailure =
  | {
      readonly kind: "taskFailure";
      readonly code:
        | "uncaughtException"
        | "inputValidationFailed"
        | "outputValidationFailed"
        | "middlewareFailed"
        | "handlerFailed";
    }
  | {
      readonly kind: "systemFailure";
      readonly code:
        | "attemptDispatchFailed"
        | "runtimeStartFailed"
        | "executionLost"
        | "executionAborted"
        | "providerEvicted"
        | "providerFailure"
        | "taskBindingUnavailable"
        | "configurationInvalid"
        | "internalInvariant";
    }
  | {
      readonly kind: "resourceExhaustion";
      readonly code:
        | "outOfMemory"
        | "possibleOutOfMemory"
        | "processCrashed"
        | "diskExhausted";
    }
  | {
      readonly kind: "timedOut";
      readonly code: "maximumDurationExceeded";
    };

export interface TaskRunRetry {
  readonly previousAttemptNumber: number;
  readonly acceptedAtMs: number;
  readonly eligibleAtMs: number;
  readonly nextComputeProfile: string;
  readonly cause: {
    readonly kind:
      | "failedCompletion"
      | "leaseExpiredBeforeHeartbeat"
      | "leaseExpiredAfterHeartbeat";
    readonly failure: TaskRunFailure;
  };
}

export interface TaskRunResultMetadata {
  readonly byteLength: number;
  readonly sha256Hex: string;
}

export type TaskRunState =
  | {
      readonly kind: "ready";
      readonly eligibleAtMs: number;
      readonly retry: TaskRunRetry | null;
      readonly cancellation: TaskRunNotCancelled;
    }
  | {
      readonly kind: "attemptGranted";
      readonly attempt: TaskRunAttempt;
      readonly cancellation:
        | TaskRunNotCancelled
        | TaskRunCancellationRequested;
    }
  | {
      readonly kind: "executing";
      readonly attempt: TaskRunAttempt;
      readonly cancellation:
        | TaskRunNotCancelled
        | TaskRunCancellationRequested;
    }
  | {
      readonly kind: "retryWaiting";
      readonly retry: TaskRunRetry;
      readonly cancellation: TaskRunNotCancelled;
    }
  | {
      readonly kind: "succeeded";
      readonly completedAtMs: number;
      readonly attemptNumber: number;
      readonly executionDurationMs: number | null;
      readonly result: TaskRunResultMetadata | null;
      readonly cancellation:
        | TaskRunNotCancelled
        | TaskRunCancellationResolved<"supersededByCompletion">;
    }
  | {
      readonly kind: "failed";
      readonly completedAtMs: number;
      readonly attemptNumber: number | null;
      readonly executionDurationMs: number | null;
      readonly failure: TaskRunFailure;
      readonly cancellation:
        | TaskRunNotCancelled
        | TaskRunCancellationResolved<"supersededByCompletion">;
    }
  | {
      readonly kind: "cancelled";
      readonly completedAtMs: number;
      readonly attemptNumber: null;
      readonly executionDurationMs: null;
      readonly cancellation: TaskRunCancellationResolved<"withoutActiveAttempt">;
    }
  | {
      readonly kind: "cancelled";
      readonly completedAtMs: number;
      readonly attemptNumber: number;
      readonly executionDurationMs: number | null;
      readonly cancellation: TaskRunCancellationResolved<"acknowledged">;
    }
  | {
      readonly kind: "cancelled";
      readonly completedAtMs: number;
      readonly attemptNumber: number;
      readonly executionDurationMs: null;
      readonly cancellation: TaskRunCancellationResolved<"leaseExpired">;
    };

export interface TaskRunStatus {
  readonly runId: TaskRunId;
  readonly createdAtMs: number;
  readonly observedAtMs: number;
  readonly runVersion: bigint;
  readonly state: TaskRunState;
}

type StandardTaskRunState = StandardApplicationTaskRunStatus["state"];
type StandardTaskRunFailure = Extract<
  StandardTaskRunState,
  { readonly kind: "failed" }
>["failure"];
type StandardActiveCancellation = Extract<
  StandardTaskRunState,
  { readonly kind: "attempt_granted" | "executing" }
>["cancellation"];
type StandardCompletionCancellation = Extract<
  StandardTaskRunState,
  { readonly kind: "succeeded" | "failed" }
>["cancellation"];

const TASK_FAILURE_CODES = {
  uncaught_exception: "uncaughtException",
  input_validation_failed: "inputValidationFailed",
  output_validation_failed: "outputValidationFailed",
  middleware_failed: "middlewareFailed",
  handler_failed: "handlerFailed",
} as const satisfies Record<
  Extract<StandardTaskRunFailure, { readonly kind: "task_failure" }>["code"],
  Extract<TaskRunFailure, { readonly kind: "taskFailure" }>["code"]
>;

const SYSTEM_FAILURE_CODES = {
  attempt_dispatch_failed: "attemptDispatchFailed",
  runtime_start_failed: "runtimeStartFailed",
  execution_lost: "executionLost",
  execution_aborted: "executionAborted",
  provider_evicted: "providerEvicted",
  provider_failure: "providerFailure",
  task_binding_unavailable: "taskBindingUnavailable",
  configuration_invalid: "configurationInvalid",
  internal_invariant: "internalInvariant",
} as const satisfies Record<
  Extract<StandardTaskRunFailure, { readonly kind: "system_failure" }>["code"],
  Extract<TaskRunFailure, { readonly kind: "systemFailure" }>["code"]
>;

const RESOURCE_EXHAUSTION_CODES = {
  out_of_memory: "outOfMemory",
  possible_out_of_memory: "possibleOutOfMemory",
  process_crashed: "processCrashed",
  disk_exhausted: "diskExhausted",
} as const satisfies Record<
  Extract<
    StandardTaskRunFailure,
    { readonly kind: "resource_exhaustion" }
  >["code"],
  Extract<TaskRunFailure, { readonly kind: "resourceExhaustion" }>["code"]
>;

const TIMED_OUT_CODES = {
  maximum_duration_exceeded: "maximumDurationExceeded",
} as const satisfies Record<
  Extract<StandardTaskRunFailure, { readonly kind: "timed_out" }>["code"],
  Extract<TaskRunFailure, { readonly kind: "timedOut" }>["code"]
>;

/** Projects one validated durable identity into the clean opaque identity. */
export function projectTaskRunId(
  runId: StandardApplicationTaskRunStatus["runId"],
): TaskRunId {
  // SAFETY: the Standard query has already validated the durable run ID. The
  // clean brand removes the versioned contract name without changing bytes.
  return runId as unknown as TaskRunId;
}

/** Copies one authoritative durable projection into the clean root contract. */
export function projectTaskRunStatus(
  status: StandardApplicationTaskRunStatus,
): TaskRunStatus {
  return Object.freeze({
    runId: projectTaskRunId(status.runId),
    createdAtMs: status.createdAtMs,
    observedAtMs: status.observedAtMs,
    runVersion: status.runVersion,
    state: projectTaskRunState(status.state),
  });
}

function projectTaskRunState(state: StandardTaskRunState): TaskRunState {
  switch (state.kind) {
    case "ready":
      return Object.freeze({
        kind: "ready",
        eligibleAtMs: state.eligibleAtMs,
        retry: state.retry === null ? null : projectRetry(state.retry),
        cancellation: Object.freeze({ kind: "notRequested" }),
      });
    case "attempt_granted":
      return Object.freeze({
        kind: "attemptGranted",
        attempt: projectAttempt(state.attempt),
        cancellation: projectActiveCancellation(state.cancellation),
      });
    case "executing":
      return Object.freeze({
        kind: "executing",
        attempt: projectAttempt(state.attempt),
        cancellation: projectActiveCancellation(state.cancellation),
      });
    case "retry_waiting":
      return Object.freeze({
        kind: "retryWaiting",
        retry: projectRetry(state.retry),
        cancellation: Object.freeze({ kind: "notRequested" }),
      });
    case "succeeded":
      return Object.freeze({
        kind: "succeeded",
        completedAtMs: state.completedAtMs,
        attemptNumber: state.attemptNumber,
        executionDurationMs: state.executionDurationMs,
        result: state.result === null
          ? null
          : Object.freeze({
            byteLength: state.result.byteLength,
            sha256Hex: state.result.sha256Hex,
          }),
        cancellation: projectCompletionCancellation(state.cancellation),
      });
    case "failed":
      return Object.freeze({
        kind: "failed",
        completedAtMs: state.completedAtMs,
        attemptNumber: state.attemptNumber,
        executionDurationMs: state.executionDurationMs,
        failure: projectFailure(state.failure),
        cancellation: projectCompletionCancellation(state.cancellation),
      });
    case "cancelled":
      return projectCancelledState(state);
    default: {
      const unhandledState: never = state;
      throw new TypeError(`Unhandled Task run state: ${String(unhandledState)}`);
    }
  }
}

function projectAttempt(
  attempt: Extract<
    StandardTaskRunState,
    { readonly kind: "attempt_granted" }
  >["attempt"],
): TaskRunAttempt {
  return Object.freeze({
    attemptNumber: attempt.attemptNumber,
    computeProfile: attempt.computeProfile,
    grantedAtMs: attempt.grantedAtMs,
    leaseExpiresAtMs: attempt.leaseExpiresAtMs,
  });
}

function projectRetry(
  retry: Extract<
    StandardTaskRunState,
    { readonly kind: "retry_waiting" }
  >["retry"],
): TaskRunRetry {
  return Object.freeze({
    previousAttemptNumber: retry.previousAttemptNumber,
    acceptedAtMs: retry.acceptedAtMs,
    eligibleAtMs: retry.eligibleAtMs,
    nextComputeProfile: retry.nextComputeProfile,
    cause: Object.freeze({
      kind: projectRetryCauseKind(retry.cause.kind),
      failure: projectFailure(retry.cause.failure),
    }),
  });
}

function projectRetryCauseKind(
  kind: Extract<
    StandardTaskRunState,
    { readonly kind: "retry_waiting" }
  >["retry"]["cause"]["kind"],
): TaskRunRetry["cause"]["kind"] {
  switch (kind) {
    case "failed_completion":
      return "failedCompletion";
    case "lease_expired_before_heartbeat":
      return "leaseExpiredBeforeHeartbeat";
    case "lease_expired_after_heartbeat":
      return "leaseExpiredAfterHeartbeat";
    default: {
      const unhandledKind: never = kind;
      throw new TypeError(
        `Unhandled Task retry cause: ${String(unhandledKind)}`,
      );
    }
  }
}

function projectFailure(failure: StandardTaskRunFailure): TaskRunFailure {
  switch (failure.kind) {
    case "task_failure":
      return Object.freeze({
        kind: "taskFailure",
        code: TASK_FAILURE_CODES[failure.code],
      });
    case "system_failure":
      return Object.freeze({
        kind: "systemFailure",
        code: SYSTEM_FAILURE_CODES[failure.code],
      });
    case "resource_exhaustion":
      return Object.freeze({
        kind: "resourceExhaustion",
        code: RESOURCE_EXHAUSTION_CODES[failure.code],
      });
    case "timed_out":
      return Object.freeze({
        kind: "timedOut",
        code: TIMED_OUT_CODES[failure.code],
      });
    default: {
      const unhandledFailure: never = failure;
      throw new TypeError(
        `Unhandled Task run failure: ${String(unhandledFailure)}`,
      );
    }
  }
}

function projectActiveCancellation(
  cancellation: StandardActiveCancellation,
): TaskRunNotCancelled | TaskRunCancellationRequested {
  switch (cancellation.kind) {
    case "not_requested":
      return Object.freeze({ kind: "notRequested" });
    case "requested":
      return Object.freeze({
        kind: "requested",
        code: projectCancellationCode(cancellation.code),
        requestedAtMs: cancellation.requestedAtMs,
      });
  }
}

function projectCompletionCancellation(
  cancellation: StandardCompletionCancellation,
): TaskRunNotCancelled |
  TaskRunCancellationResolved<"supersededByCompletion"> {
  switch (cancellation.kind) {
    case "not_requested":
      return Object.freeze({ kind: "notRequested" });
    case "resolved":
      return Object.freeze({
        kind: "resolved",
        code: projectCancellationCode(cancellation.code),
        requestedAtMs: cancellation.requestedAtMs,
        resolvedAtMs: cancellation.resolvedAtMs,
        resolution: "supersededByCompletion",
      });
  }
}

function projectCancelledState(
  state: Extract<StandardTaskRunState, { readonly kind: "cancelled" }>,
): Extract<TaskRunState, { readonly kind: "cancelled" }> {
  const cancellation = state.cancellation;
  const shared = {
    kind: "cancelled" as const,
    completedAtMs: state.completedAtMs,
    attemptNumber: state.attemptNumber,
    executionDurationMs: state.executionDurationMs,
  };
  switch (cancellation.resolution) {
    case "without_active_attempt":
      return Object.freeze({
        ...shared,
        attemptNumber: null,
        executionDurationMs: null,
        cancellation: projectResolvedCancellation(
          cancellation,
          "withoutActiveAttempt",
        ),
      });
    case "acknowledged":
      if (state.attemptNumber === null) {
        throw new TypeError(
          "Acknowledged Task cancellation is missing its attempt number.",
        );
      }
      return Object.freeze({
        ...shared,
        attemptNumber: state.attemptNumber,
        cancellation: projectResolvedCancellation(
          cancellation,
          "acknowledged",
        ),
      });
    case "lease_expired":
      if (state.attemptNumber === null) {
        throw new TypeError(
          "Expired Task cancellation is missing its attempt number.",
        );
      }
      return Object.freeze({
        ...shared,
        attemptNumber: state.attemptNumber,
        executionDurationMs: null,
        cancellation: projectResolvedCancellation(
          cancellation,
          "leaseExpired",
        ),
      });
  }
}

function projectResolvedCancellation<
  Resolution extends Exclude<
    TaskCancellationResolution,
    "supersededByCompletion"
  >,
>(
  cancellation: Extract<
    StandardTaskRunState,
    { readonly kind: "cancelled" }
  >["cancellation"],
  resolution: Resolution,
): TaskRunCancellationResolved<Resolution> {
  return Object.freeze({
    kind: "resolved",
    code: projectCancellationCode(cancellation.code),
    requestedAtMs: cancellation.requestedAtMs,
    resolvedAtMs: cancellation.resolvedAtMs,
    resolution,
  });
}

function projectCancellationCode(
  code: "requested" | "execution_cancelled" | "policy_cancelled",
): TaskCancellationCode {
  switch (code) {
    case "requested":
      return "requested";
    case "execution_cancelled":
      return "executionCancelled";
    case "policy_cancelled":
      return "policyCancelled";
  }
}
