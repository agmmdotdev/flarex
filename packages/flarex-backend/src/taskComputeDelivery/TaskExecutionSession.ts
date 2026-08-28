import type {
  TaskComputeDispatchIdentityV1,
  TaskComputeExecutionIdV1,
} from "@flarex/durable-task/internal/compute-provider-v1";
import type {
  TaskCancellationGenerationV1,
} from "@flarex/durable-task/internal/run-attempt-v1";
import { Data, type Effect } from "effect";
import type {
  CanonicalFlarexRuntimeValueV1,
} from "flarex-protocol/value";

export type TaskExecutionGeneration =
  | "legacy_dynamic_worker_v1"
  | "application_v1";

export type TaskExecutionInterruptionReason =
  | "cancellation_requested"
  | "maximum_duration"
  | "host_shutdown";

export type TaskExecutionFailureCode =
  | "input_validation_failed"
  | "output_validation_failed"
  | "handler_failed"
  | "runtime_input_unavailable"
  | "configuration_invalid"
  | "internal_invariant";

export type TaskExecutionSessionIdentity = TaskComputeDispatchIdentityV1;

export interface TaskExecutionSessionAcceptance {
  readonly generation: TaskExecutionGeneration;
  readonly identity: TaskExecutionSessionIdentity;
  readonly executionId: TaskComputeExecutionIdV1;
  readonly cancellationGeneration: TaskCancellationGenerationV1;
}

export interface TaskExecutionInterruptionRequest {
  readonly generation: TaskExecutionGeneration;
  readonly identity: TaskExecutionSessionIdentity;
  readonly executionId: TaskComputeExecutionIdV1;
  readonly cancellationGeneration: TaskCancellationGenerationV1;
  readonly reason: TaskExecutionInterruptionReason;
}

export interface TaskExecutionResult {
  readonly value: CanonicalFlarexRuntimeValueV1;
  readonly valueSemanticBytes: number;
}

export type TaskExecutionSessionOutcome =
  | Readonly<{
      readonly kind: "completed";
      readonly result: TaskExecutionResult;
    }>
  | Readonly<{
      readonly kind: "failed";
      readonly failure: Readonly<{
        readonly code: TaskExecutionFailureCode;
        readonly message: null;
      }>;
    }>
  | Readonly<{
      readonly kind: "interrupted";
      readonly interruption: Readonly<{
        readonly cancellationGeneration: TaskCancellationGenerationV1;
        readonly reason: TaskExecutionInterruptionReason;
      }>;
    }>;

export interface TaskExecutionSessionSettlement {
  readonly generation: TaskExecutionGeneration;
  readonly identity: TaskExecutionSessionIdentity;
  readonly executionId: TaskComputeExecutionIdV1;
  readonly outcome: TaskExecutionSessionOutcome;
}

export class TaskExecutionSessionError extends Data.TaggedError(
  "TaskExecutionSessionError",
)<{
  readonly operation: "requestInterruption" | "settlement" | "close";
  readonly reason:
    | "invalidRequest"
    | "providerUnavailable"
    | "providerFailure"
    | "invalidResponse"
    | "sessionLost"
    | "staleCancellation"
    | "inputBoundaryFailed"
    | "userCodeFailed"
    | "terminalFailed"
    | "timedOut"
    | "cleanupFailed";
  readonly cause?: unknown;
}> {}

/**
 * One accepted Task execution. Providers project their private versioned
 * protocols into this unversioned, transport-neutral scoped capability.
 */
export interface TaskExecutionSession {
  readonly acceptance: TaskExecutionSessionAcceptance;
  readonly maximumCloseMilliseconds: number;
  readonly requestInterruption: (
    request: TaskExecutionInterruptionRequest,
  ) => Effect.Effect<void, TaskExecutionSessionError>;
  readonly settlement: Effect.Effect<
    TaskExecutionSessionSettlement,
    TaskExecutionSessionError
  >;
  readonly close: Effect.Effect<void, TaskExecutionSessionError>;
}
