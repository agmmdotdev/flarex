import type {
  TaskAttemptCompletionV1,
  TaskCancellationGenerationV1,
  TaskExecutionFailureV1,
  TaskRetryDirectiveV1,
} from "@flarex/durable-task/internal/run-attempt-v1";
import { Brand } from "effect";
import type {
  ApplicationTaskWorkerResultV1,
} from "flarex-protocol/internal/application-task-worker-v1";
import type {
  LegacyTaskWorkerResultV1,
} from "flarex-protocol/internal/legacy-task-worker-v1";
import type {
  TaskWorkerSessionSettlementV1,
} from "flarex-protocol/internal/task-worker-session-v1";

import {
  type TaskExecutionFailureCode,
  type TaskExecutionInterruptionReason,
  type TaskExecutionResult,
  type TaskExecutionSessionSettlement,
} from "./TaskExecutionSession.js";

type TerminalDisposition<Result> =
  | Readonly<{
      readonly kind: "publish_result";
      readonly result: Result;
    }>
  | Readonly<{
      readonly kind: "complete";
      readonly completion: TaskAttemptCompletionV1;
    }>
  | Readonly<{
      readonly kind: "unconfirmed";
      readonly reason: "host_shutdown";
    }>;

type TerminalOutcome<Result, Generation extends bigint> =
  | Readonly<{ readonly kind: "completed"; readonly result: Result }>
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
        readonly cancellationGeneration: Generation;
        readonly reason: TaskExecutionInterruptionReason;
      }>;
    }>;

export type TaskExecutionTerminalDisposition =
  TerminalDisposition<TaskExecutionResult>;

/** Retained source-compatible name for the existing Worker wire adapter. */
export type TaskWorkerTerminalDisposition = TerminalDisposition<
  ApplicationTaskWorkerResultV1 | LegacyTaskWorkerResultV1
>;

/**
 * Maps an already correlated Task execution settlement into the next durable
 * action. Success remains a publication request until E2 produces a verified
 * result commitment; this operation never claims that a process-local value is
 * durable.
 */
export function mapTaskExecutionTerminalDisposition(
  settlement: TaskExecutionSessionSettlement,
): TaskExecutionTerminalDisposition {
  return mapTerminalOutcome(
    settlement.outcome,
    generation => generation,
  );
}

/** Retained adapter for callers that still own decoded Worker wire values. */
export function mapTaskWorkerTerminalDisposition(
  settlement: TaskWorkerSessionSettlementV1,
): TaskWorkerTerminalDisposition {
  return mapTerminalOutcome<
    ApplicationTaskWorkerResultV1 | LegacyTaskWorkerResultV1,
    bigint
  >(
    settlement.outcome,
    projectWorkerCancellationGeneration,
  );
}

function mapTerminalOutcome<Result, Generation extends bigint>(
  outcome: TerminalOutcome<Result, Generation>,
  projectCancellationGeneration: (
    value: Generation,
  ) => TaskCancellationGenerationV1,
): TerminalDisposition<Result> {
  switch (outcome.kind) {
    case "completed":
      return Object.freeze({
        kind: "publish_result",
        result: outcome.result,
      });
    case "failed":
      return Object.freeze({
        kind: "complete",
        completion: failureCompletion(outcome.failure.code),
      });
    case "interrupted": {
      const interruption = outcome.interruption;
      switch (interruption.reason) {
        case "cancellation_requested":
          return Object.freeze({
            kind: "complete",
            completion: Object.freeze({
              kind: "cancellation_acknowledged",
              cancellationGeneration: projectCancellationGeneration(
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
      return assertNever(outcome);
  }
}

const USE_BOUND_POLICY = Object.freeze({
  kind: "use_bound_policy" as const,
}) satisfies TaskRetryDirectiveV1;

const DO_NOT_RETRY = Object.freeze({
  kind: "do_not_retry" as const,
}) satisfies TaskRetryDirectiveV1;

function failureCompletion(
  code: TaskExecutionFailureCode,
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
  code: TaskExecutionFailureCode,
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

function projectWorkerCancellationGeneration(
  value: bigint,
): TaskCancellationGenerationV1 {
  // The strict Worker settlement decoder admits positive signed 64-bit values,
  // a subset of the durable cancellation-generation contract. Keep this proof
  // at the retained Worker wire adapter rather than the neutral mapper.
  return Brand.nominal<TaskCancellationGenerationV1>()(value);
}

function assertNever(value: never): never {
  throw new Error(`Unhandled Task execution terminal evidence: ${String(value)}`);
}
