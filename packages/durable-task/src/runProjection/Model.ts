import type {
  TaskAttemptNumberV1,
  TaskComputeProfileRefV1,
  TaskDatabaseTimeMsV1,
  TaskExecutionDurationMsV1,
  TaskExecutionFailureV1,
  TaskResultCommitmentV1,
  TaskRunIdV1,
  TaskRunVersionV1,
} from "../runAttempt/Model.js";

type WithoutDiagnosticMessage<Failure> = Failure extends {
  readonly kind: infer Kind;
  readonly code: infer Code;
}
  ? { readonly kind: Kind; readonly code: Code }
  : never;

export type TaskRunFailureProjection =
  WithoutDiagnosticMessage<TaskExecutionFailureV1>;

export interface TaskRunNotCancelledProjection {
  readonly kind: "not_requested";
}

export interface TaskRunCancellationRequestedProjection {
  readonly kind: "requested";
  readonly code: "requested" | "execution_cancelled" | "policy_cancelled";
  readonly requestedAtMs: TaskDatabaseTimeMsV1;
}

export interface TaskRunCancellationResolvedProjection<
  Resolution extends
    | "without_active_attempt"
    | "acknowledged"
    | "lease_expired"
    | "superseded_by_completion" =
      | "without_active_attempt"
      | "acknowledged"
      | "lease_expired"
      | "superseded_by_completion",
> {
  readonly kind: "resolved";
  readonly code: "requested" | "execution_cancelled" | "policy_cancelled";
  readonly requestedAtMs: TaskDatabaseTimeMsV1;
  readonly resolvedAtMs: TaskDatabaseTimeMsV1;
  readonly resolution: Resolution;
}

export type TaskRunActiveCancellationProjection =
  | TaskRunNotCancelledProjection
  | TaskRunCancellationRequestedProjection;

export type TaskRunCompletionCancellationProjection =
  | TaskRunNotCancelledProjection
  | TaskRunCancellationResolvedProjection<"superseded_by_completion">;

export interface TaskRunAttemptProjection {
  readonly attemptNumber: TaskAttemptNumberV1;
  readonly computeProfile: TaskComputeProfileRefV1;
  readonly grantedAtMs: TaskDatabaseTimeMsV1;
  readonly leaseExpiresAtMs: TaskDatabaseTimeMsV1;
}

export interface TaskRunRetryProjection {
  readonly previousAttemptNumber: TaskAttemptNumberV1;
  readonly acceptedAtMs: TaskDatabaseTimeMsV1;
  readonly eligibleAtMs: TaskDatabaseTimeMsV1;
  readonly nextComputeProfile: TaskComputeProfileRefV1;
  readonly cause: {
    readonly kind:
      | "failed_completion"
      | "lease_expired_before_heartbeat"
      | "lease_expired_after_heartbeat";
    readonly failure: TaskRunFailureProjection;
  };
}

export interface TaskRunResultMetadata {
  readonly codec: TaskResultCommitmentV1["codec"];
  readonly byteLength: number;
  readonly sha256Hex: string;
}

export type TaskRunStateProjection =
  | {
      readonly kind: "ready";
      readonly eligibleAtMs: TaskDatabaseTimeMsV1;
      readonly retry: TaskRunRetryProjection | null;
      readonly cancellation: TaskRunNotCancelledProjection;
    }
  | {
      readonly kind: "attempt_granted";
      readonly attempt: TaskRunAttemptProjection;
      readonly cancellation: TaskRunActiveCancellationProjection;
    }
  | {
      readonly kind: "executing";
      readonly attempt: TaskRunAttemptProjection;
      readonly cancellation: TaskRunActiveCancellationProjection;
    }
  | {
      readonly kind: "retry_waiting";
      readonly retry: TaskRunRetryProjection;
      readonly cancellation: TaskRunNotCancelledProjection;
    }
  | {
      readonly kind: "succeeded";
      readonly completedAtMs: TaskDatabaseTimeMsV1;
      readonly attemptNumber: TaskAttemptNumberV1;
      readonly executionDurationMs: TaskExecutionDurationMsV1 | null;
      readonly result: TaskRunResultMetadata | null;
      readonly cancellation: TaskRunCompletionCancellationProjection;
    }
  | {
      readonly kind: "failed";
      readonly completedAtMs: TaskDatabaseTimeMsV1;
      readonly attemptNumber: TaskAttemptNumberV1 | null;
      readonly executionDurationMs: TaskExecutionDurationMsV1 | null;
      readonly failure: TaskRunFailureProjection;
      readonly cancellation: TaskRunCompletionCancellationProjection;
    }
  | {
      readonly kind: "cancelled";
      readonly completedAtMs: TaskDatabaseTimeMsV1;
      readonly attemptNumber: null;
      readonly executionDurationMs: null;
      readonly cancellation:
        TaskRunCancellationResolvedProjection<"without_active_attempt">;
    }
  | {
      readonly kind: "cancelled";
      readonly completedAtMs: TaskDatabaseTimeMsV1;
      readonly attemptNumber: TaskAttemptNumberV1;
      readonly executionDurationMs: TaskExecutionDurationMsV1 | null;
      readonly cancellation:
        TaskRunCancellationResolvedProjection<"acknowledged">;
    }
  | {
      readonly kind: "cancelled";
      readonly completedAtMs: TaskDatabaseTimeMsV1;
      readonly attemptNumber: TaskAttemptNumberV1;
      readonly executionDurationMs: null;
      readonly cancellation:
        TaskRunCancellationResolvedProjection<"lease_expired">;
    };

export interface TaskRunProjection {
  readonly runId: TaskRunIdV1;
  readonly createdAtMs: TaskDatabaseTimeMsV1;
  readonly observedAtMs: TaskDatabaseTimeMsV1;
  readonly runVersion: TaskRunVersionV1;
  readonly state: TaskRunStateProjection;
}
