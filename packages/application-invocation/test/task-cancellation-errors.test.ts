import {
  type StandardApplicationTaskCancellationApi,
  type StandardApplicationTaskCancellationError,
} from
  "@flarex/standard-application-invocation/internal/standard-application-task-cancellation";
import { Brand, Data } from "effect";
import { describe, expect, it } from "vitest";

import {
  projectTaskCancellationError,
  type TaskCancellationErrorReason,
} from "../src/TaskCancellationError.js";
import { projectTaskRunId } from "../src/TaskStatus.js";

type InternalRunId = Parameters<
  StandardApplicationTaskCancellationApi["request"]
>[0];
type ErrorByTag<Tag extends StandardApplicationTaskCancellationError["_tag"]> =
  Extract<StandardApplicationTaskCancellationError, { readonly _tag: Tag }>;

const internalRunId = Brand.nominal<InternalRunId>()(
  "run_00000000-0000-4000-8000-000000000073",
);
const cleanRunId = projectTaskRunId(internalRunId);
const attemptId = Brand.nominal<
  ErrorByTag<"StaleTaskExecutionFenceError">["attemptId"]
>()("attempt_00000000-0000-4000-8000-000000000073");
const cancellationGeneration = Brand.nominal<
  ErrorByTag<"InvalidTaskCancellationAcknowledgementError">[
    "receivedGeneration"
  ]
>()(1n);

class InvalidCommandFailure extends Data.TaggedError(
  "InvalidRunAttemptCommandError",
)<{
  readonly operation: "request_cancellation";
  readonly issue: "invalid_cancellation_reason";
}> {}

class InvalidTransitionFailure extends Data.TaggedError(
  "InvalidRunAttemptTransitionError",
)<{
  readonly operation: "request_cancellation";
  readonly runId: InternalRunId;
  readonly phase: "ready";
  readonly reason: "next_state_invalid";
}> {}

class StaleRunVersionFailure extends Data.TaggedError(
  "StaleTaskRunVersionError",
)<{
  readonly operation: "request_cancellation";
  readonly runId: InternalRunId;
  readonly reason: "commit_basis_disagrees_with_decoded_state";
}> {}

class StaleFenceFailure extends Data.TaggedError(
  "StaleTaskExecutionFenceError",
)<{
  readonly operation: "heartbeat_attempt";
  readonly runId: InternalRunId;
  readonly attemptId: typeof attemptId;
  readonly reason: "accepted_transition_uses_noncurrent_fence";
}> {}

class ConflictingCompletionFailure extends Data.TaggedError(
  "ConflictingTaskAttemptCompletionError",
)<{
  readonly operation: "complete_attempt";
  readonly runId: InternalRunId;
  readonly attemptId: typeof attemptId;
  readonly acceptedKind: "succeeded";
  readonly receivedKind: "failed";
}> {}

class InvalidAcknowledgementFailure extends Data.TaggedError(
  "InvalidTaskCancellationAcknowledgementError",
)<{
  readonly operation: "complete_attempt";
  readonly runId: InternalRunId;
  readonly attemptId: typeof attemptId;
  readonly requestedGeneration: null;
  readonly receivedGeneration: typeof cancellationGeneration;
}> {}

class PolicyFailure extends Data.TaggedError("TaskRunAttemptPolicyError")<{
  readonly operation: "start_attempt";
  readonly runId: InternalRunId;
  readonly reason: "invalid_bound_policy";
}> {}

class CounterExhaustedFailure extends Data.TaggedError(
  "TaskRunAttemptCounterExhaustedError",
)<{
  readonly operation: "request_cancellation";
  readonly runId: InternalRunId;
  readonly counter: "cancellation_generation";
}> {}

class UnavailableFailure extends Data.TaggedError(
  "TaskSystemRunAttemptUnavailableError",
)<{
  readonly operation: "request_cancellation";
  readonly runId: InternalRunId;
  readonly reason: "unavailable";
}> {}

class CorruptionFailure extends Data.TaggedError(
  "TaskSystemRunAttemptCorruptionError",
)<{
  readonly operation: "request_cancellation";
  readonly runId: InternalRunId;
  readonly reason: "aggregate_invalid";
}> {}

class StaleScopeFailure extends Data.TaggedError(
  "TaskSystemRunAttemptStaleScopeAuthorityError",
)<{
  readonly operation: "request_cancellation";
  readonly runId: InternalRunId;
  readonly authority: "epoch";
}> {}

class TransientFailure extends Data.TaggedError(
  "TaskSystemRunAttemptTransientStoreError",
)<{
  readonly operation: "request_cancellation";
  readonly runId: InternalRunId;
  readonly reason: "timeout";
  readonly cause: unknown;
}> {}

class TerminalFailure extends Data.TaggedError(
  "TaskSystemRunAttemptTerminalStoreError",
)<{
  readonly operation: "request_cancellation";
  readonly runId: InternalRunId;
  readonly reason: "unsupported_integration";
  readonly cause: unknown | null;
}> {}

describe("clean Task cancellation-error projection", () => {
  it.each([
    [new InvalidCommandFailure({
      operation: "request_cancellation",
      issue: "invalid_cancellation_reason",
    }), "invalidCommand"],
    [new InvalidTransitionFailure({
      operation: "request_cancellation",
      runId: internalRunId,
      phase: "ready",
      reason: "next_state_invalid",
    }), "invalidState"],
    [new StaleRunVersionFailure({
      operation: "request_cancellation",
      runId: internalRunId,
      reason: "commit_basis_disagrees_with_decoded_state",
    }), "transient"],
    [new StaleFenceFailure({
      operation: "heartbeat_attempt",
      runId: internalRunId,
      attemptId,
      reason: "accepted_transition_uses_noncurrent_fence",
    }), "transient"],
    [new ConflictingCompletionFailure({
      operation: "complete_attempt",
      runId: internalRunId,
      attemptId,
      acceptedKind: "succeeded",
      receivedKind: "failed",
    }), "invalidState"],
    [new InvalidAcknowledgementFailure({
      operation: "complete_attempt",
      runId: internalRunId,
      attemptId,
      requestedGeneration: null,
      receivedGeneration: cancellationGeneration,
    }), "invalidState"],
    [new PolicyFailure({
      operation: "start_attempt",
      runId: internalRunId,
      reason: "invalid_bound_policy",
    }), "invalidState"],
    [new CounterExhaustedFailure({
      operation: "request_cancellation",
      runId: internalRunId,
      counter: "cancellation_generation",
    }), "terminal"],
    [new UnavailableFailure({
      operation: "request_cancellation",
      runId: internalRunId,
      reason: "unavailable",
    }), "unavailable"],
    [new CorruptionFailure({
      operation: "request_cancellation",
      runId: internalRunId,
      reason: "aggregate_invalid",
    }), "corruptData"],
    [new StaleScopeFailure({
      operation: "request_cancellation",
      runId: internalRunId,
      authority: "epoch",
    }), "staleScopeAuthority"],
    [new TransientFailure({
      operation: "request_cancellation",
      runId: internalRunId,
      reason: "timeout",
      cause: null,
    }), "transient"],
    [new TerminalFailure({
      operation: "request_cancellation",
      runId: internalRunId,
      reason: "unsupported_integration",
      cause: null,
    }), "terminal"],
  ] as const satisfies readonly (readonly [
    StandardApplicationTaskCancellationError,
    TaskCancellationErrorReason,
  ])[])("maps $0._tag", (source, reason) => {
    const projected = projectTaskCancellationError(cleanRunId, source);
    expect(projected).toMatchObject({
      _tag: "TaskCancellationError",
      operation: "cancelTask",
      runId: cleanRunId,
      reason,
      cause: source,
    });
    expect(projected.cause).toBe(source);
  });
});
