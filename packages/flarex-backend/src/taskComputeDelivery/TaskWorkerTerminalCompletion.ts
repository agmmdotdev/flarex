import type {
  TaskAttemptCompletionV1,
  TaskCancellationGenerationV1,
  TaskExecutionFailureV1,
  TaskRetryDirectiveV1,
} from "@flarex/durable-task/internal/run-attempt-v1";
import type {
  ApplicationTaskWorkerResultV1,
} from "flarex-protocol/internal/application-task-worker-v1";
import type {
  LegacyTaskWorkerResultV1,
} from "flarex-protocol/internal/legacy-task-worker-v1";
import type {
  TaskWorkerSessionFailureCodeV1,
  TaskWorkerSessionSettlementV1,
} from "flarex-protocol/internal/task-worker-session-v1";

export type TaskWorkerTerminalDisposition =
  | Readonly<{
      readonly kind: "publish_result";
      readonly result: ApplicationTaskWorkerResultV1 | LegacyTaskWorkerResultV1;
    }>
  | Readonly<{
      readonly kind: "complete";
      readonly completion: TaskAttemptCompletionV1;
    }>
  | Readonly<{
      readonly kind: "unconfirmed";
      readonly reason: "host_shutdown";
    }>;

/**
 * Maps an already decoded, correlated Worker settlement into the next durable
 * action. Success remains a publication request until E2 produces a verified
 * result commitment; this operation never claims that a process-local value is
 * durable.
 */
export function mapTaskWorkerTerminalDisposition(
  settlement: TaskWorkerSessionSettlementV1,
): TaskWorkerTerminalDisposition {
  switch (settlement.outcome.kind) {
    case "completed":
      return Object.freeze({
        kind: "publish_result",
        result: settlement.outcome.result,
      });
    case "failed":
      return Object.freeze({
        kind: "complete",
        completion: failureCompletion(settlement.outcome.failure.code),
      });
    case "interrupted": {
      const interruption = settlement.outcome.interruption;
      switch (interruption.reason) {
        case "cancellation_requested":
          return Object.freeze({
            kind: "complete",
            completion: Object.freeze({
              kind: "cancellation_acknowledged",
              cancellationGeneration: cancellationGeneration(
                interruption.cancellationGeneration,
              ),
              executionDurationMs: null,
            }),
          });
        case "maximum_duration":
          return Object.freeze({
            kind: "complete",
            completion: Object.freeze({
              kind: "failed",
              failure: Object.freeze({
                kind: "timed_out",
                code: "maximum_duration_exceeded",
                message: null,
              }),
              retry: USE_BOUND_POLICY,
              executionDurationMs: null,
            }),
          });
        case "host_shutdown":
          return Object.freeze({ kind: "unconfirmed", reason: "host_shutdown" });
        default:
          return assertNever(interruption.reason);
      }
    }
    default:
      return assertNever(settlement.outcome);
  }
}

const USE_BOUND_POLICY = Object.freeze({
  kind: "use_bound_policy" as const,
}) satisfies TaskRetryDirectiveV1;

const DO_NOT_RETRY = Object.freeze({
  kind: "do_not_retry" as const,
}) satisfies TaskRetryDirectiveV1;

function failureCompletion(
  code: TaskWorkerSessionFailureCodeV1,
): Extract<TaskAttemptCompletionV1, { readonly kind: "failed" }> {
  const failure = taskExecutionFailure(code);
  return Object.freeze({
    kind: "failed",
    failure,
    retry: code === "configuration_invalid" || code === "internal_invariant"
      ? DO_NOT_RETRY
      : USE_BOUND_POLICY,
    executionDurationMs: null,
  });
}

function taskExecutionFailure(
  code: TaskWorkerSessionFailureCodeV1,
): TaskExecutionFailureV1 {
  switch (code) {
    case "input_validation_failed":
    case "output_validation_failed":
    case "handler_failed":
      return Object.freeze({ kind: "task_failure", code, message: null });
    case "runtime_input_unavailable":
      return Object.freeze({
        kind: "system_failure",
        code: "task_binding_unavailable",
        message: null,
      });
    case "configuration_invalid":
    case "internal_invariant":
      return Object.freeze({ kind: "system_failure", code, message: null });
    default:
      return assertNever(code);
  }
}

function cancellationGeneration(value: bigint): TaskCancellationGenerationV1 {
  // SAFETY: the strict session decoder admits only positive signed 64-bit
  // generations, a subset of the durable Task cancellation-generation contract.
  return value as TaskCancellationGenerationV1;
}

function assertNever(value: never): never {
  throw new Error(`Unhandled Task Worker terminal evidence: ${String(value)}`);
}
