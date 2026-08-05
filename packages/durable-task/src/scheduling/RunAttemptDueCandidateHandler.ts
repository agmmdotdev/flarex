import { Effect, Result } from "effect";
import type { RunAttemptLifecycleErrorV1 } from "../runAttempt/Errors.js";
import type {
  HandleLeaseExpiryOutcomeV1,
  RunAttemptServiceReceiptV1,
  StartAttemptOutcomeV1,
} from "../runAttempt/Model.js";
import type { RunAttemptLifecycleShape } from "../runAttempt/Services/RunAttemptLifecycle.js";
import type { TaskDueDiscoveryCandidateV1 } from "../runRead/Model.js";
import { TaskDueCandidateLifecycleContractError } from "./Errors.js";
import type { TaskDueCandidateHandlingReceiptV1 } from "./Model.js";
import type {
  TaskDueCandidateHandlerV1,
  TaskRetryJitterSourceV1,
} from "./Ports.js";

/**
 * Constructs one scope-bound handler. Multiple scopes may coexist, so this is
 * an explicit immutable capability rather than a process-global service.
 */
export function makeRunAttemptDueCandidateHandlerV1(
  lifecycle: Pick<
    RunAttemptLifecycleShape,
    "startAttempt" | "handleLeaseExpiry"
  >,
  jitter: TaskRetryJitterSourceV1,
): TaskDueCandidateHandlerV1<
  RunAttemptLifecycleErrorV1 | TaskDueCandidateLifecycleContractError
> {
  const handle: TaskDueCandidateHandlerV1<
    RunAttemptLifecycleErrorV1 | TaskDueCandidateLifecycleContractError
  >["handle"] =
    Effect.fn("TaskDueCandidateHandler.handle")(function* (candidate) {
      switch (candidate.kind) {
        case "start_attempt": {
          const retryJitter = yield* jitter.nextRetryJitter(candidate.runId);
          const receipt = yield* lifecycle.startAttempt({
            type: "start_attempt",
            runId: candidate.runId,
            expectedRunVersion: candidate.expectedRunVersion,
            retryJitter,
          });
          return yield* Effect.fromResult(startHandlingReceipt(candidate, receipt));
        }
        case "handle_lease_expiry": {
          const receipt = yield* lifecycle.handleLeaseExpiry({
            type: "handle_lease_expiry",
            runId: candidate.runId,
            attemptId: candidate.attemptId,
            executionFence: candidate.executionFence,
            expectedLeaseVersion: candidate.expectedLeaseVersion,
          });
          return yield* Effect.fromResult(expiryHandlingReceipt(candidate, receipt));
        }
      }
    });

  return Object.freeze({ handle });
}

type StartAttemptDueCandidateV1 = Extract<
  TaskDueDiscoveryCandidateV1,
  { readonly kind: "start_attempt" }
>;

type LeaseExpiryDueCandidateV1 = Extract<
  TaskDueDiscoveryCandidateV1,
  { readonly kind: "handle_lease_expiry" }
>;

function startHandlingReceipt(
  candidate: StartAttemptDueCandidateV1,
  receipt: RunAttemptServiceReceiptV1<StartAttemptOutcomeV1>,
): Result.Result<
  TaskDueCandidateHandlingReceiptV1,
  TaskDueCandidateLifecycleContractError
> {
  if (receipt.outcome.kind === "current") {
    return receipt.disposition === "current"
      ? Result.succeed(Object.freeze({
          version: "flarex.task-due-candidate-handling-receipt.v1",
          kind: "start_attempt",
          dueAtMs: candidate.dueAtMs,
          runId: candidate.runId,
          disposition: "current",
          observedAtMs: receipt.observedAtMs,
          runVersion: receipt.runVersion,
          outcomeKind: "current",
        }))
      : lifecycleContractError(candidate);
  }
  return receipt.disposition === "current"
    ? lifecycleContractError(candidate)
    : Result.succeed(Object.freeze({
        version: "flarex.task-due-candidate-handling-receipt.v1",
        kind: "start_attempt",
        dueAtMs: candidate.dueAtMs,
        runId: candidate.runId,
        disposition: receipt.disposition,
        observedAtMs: receipt.observedAtMs,
        runVersion: receipt.runVersion,
        outcomeKind: "attempt_granted",
      }));
}

function expiryHandlingReceipt(
  candidate: LeaseExpiryDueCandidateV1,
  receipt: RunAttemptServiceReceiptV1<HandleLeaseExpiryOutcomeV1>,
): Result.Result<
  TaskDueCandidateHandlingReceiptV1,
  TaskDueCandidateLifecycleContractError
> {
  if (receipt.outcome.kind === "current") {
    return receipt.disposition === "current"
      ? Result.succeed(Object.freeze({
          version: "flarex.task-due-candidate-handling-receipt.v1",
          kind: "handle_lease_expiry",
          dueAtMs: candidate.dueAtMs,
          runId: candidate.runId,
          disposition: "current",
          observedAtMs: receipt.observedAtMs,
          runVersion: receipt.runVersion,
          outcomeKind: "current",
        }))
      : lifecycleContractError(candidate);
  }
  return receipt.disposition === "current"
    ? lifecycleContractError(candidate)
    : Result.succeed(Object.freeze({
        version: "flarex.task-due-candidate-handling-receipt.v1",
        kind: "handle_lease_expiry",
        dueAtMs: candidate.dueAtMs,
        runId: candidate.runId,
        disposition: receipt.disposition,
        observedAtMs: receipt.observedAtMs,
        runVersion: receipt.runVersion,
        outcomeKind: receipt.outcome.kind,
      }));
}

function lifecycleContractError(
  candidate: TaskDueDiscoveryCandidateV1,
): Result.Result<never, TaskDueCandidateLifecycleContractError> {
  return Result.fail(new TaskDueCandidateLifecycleContractError({
    dueKind: candidate.kind,
    runId: candidate.runId,
    reason: "disposition_outcome_mismatch",
  }));
}
