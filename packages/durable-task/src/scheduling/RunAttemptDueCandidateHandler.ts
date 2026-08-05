import { Effect, Result } from "effect";
import type { RunAttemptLifecycleErrorV1 } from "../runAttempt/Errors.js";
import type {
  HandleLeaseExpiryOutcomeV1,
  PersistedTaskRequestedEffectV1,
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
  TaskWakeHintPublisherV1,
  TaskWakeRequestedEffectV1,
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
  return makeCandidateHandler(lifecycle, jitter, undefined);
}

/**
 * Adds only post-settlement wake publication to the standard lifecycle
 * adapter. The persisted due index remains the recovery authority.
 */
export function makeWakePublishingRunAttemptDueCandidateHandlerV1<
  PublishFailure,
>(
  lifecycle: Pick<
    RunAttemptLifecycleShape,
    "startAttempt" | "handleLeaseExpiry"
  >,
  jitter: TaskRetryJitterSourceV1,
  publisher: TaskWakeHintPublisherV1<PublishFailure>,
): TaskDueCandidateHandlerV1<
  | RunAttemptLifecycleErrorV1
  | TaskDueCandidateLifecycleContractError
  | PublishFailure
> {
  return makeCandidateHandler(lifecycle, jitter, publisher);
}

function makeCandidateHandler<PublishFailure>(
  lifecycle: Pick<
    RunAttemptLifecycleShape,
    "startAttempt" | "handleLeaseExpiry"
  >,
  jitter: TaskRetryJitterSourceV1,
  publisher: TaskWakeHintPublisherV1<PublishFailure> | undefined,
): TaskDueCandidateHandlerV1<
  | RunAttemptLifecycleErrorV1
  | TaskDueCandidateLifecycleContractError
  | PublishFailure
> {
  const lifecycleOwner = lifecycle;
  const startAttemptMethod = lifecycleOwner.startAttempt;
  const handleLeaseExpiryMethod = lifecycleOwner.handleLeaseExpiry;
  const startAttempt: RunAttemptLifecycleShape["startAttempt"] = (command) =>
    startAttemptMethod.call(lifecycleOwner, command);
  const handleLeaseExpiry: RunAttemptLifecycleShape["handleLeaseExpiry"] =
    (command) => handleLeaseExpiryMethod.call(lifecycleOwner, command);
  const jitterOwner = jitter;
  const nextRetryJitterMethod = jitterOwner.nextRetryJitter;
  const nextRetryJitter: TaskRetryJitterSourceV1["nextRetryJitter"] = (runId) =>
    nextRetryJitterMethod.call(jitterOwner, runId);
  const publisherOwner = publisher;
  const publishMethod = publisherOwner?.publish;
  const publish = publisherOwner === undefined || publishMethod === undefined
    ? undefined
    : (requested: TaskWakeRequestedEffectV1) =>
      publishMethod.call(publisherOwner, requested);
  const handle: TaskDueCandidateHandlerV1<
    | RunAttemptLifecycleErrorV1
    | TaskDueCandidateLifecycleContractError
    | PublishFailure
  >["handle"] =
    Effect.fn("TaskDueCandidateHandler.handle")(function* (candidate) {
      switch (candidate.kind) {
        case "start_attempt": {
          const retryJitter = yield* nextRetryJitter(candidate.runId);
          const receipt = yield* startAttempt({
            type: "start_attempt",
            runId: candidate.runId,
            expectedRunVersion: candidate.expectedRunVersion,
            retryJitter,
          });
          const handlingReceipt = yield* Effect.fromResult(
            startHandlingReceipt(candidate, receipt),
          );
          if (publish !== undefined) {
            yield* publishRequestedWakes(receipt.requestedEffects, publish);
          }
          return handlingReceipt;
        }
        case "handle_lease_expiry": {
          const receipt = yield* handleLeaseExpiry({
            type: "handle_lease_expiry",
            runId: candidate.runId,
            attemptId: candidate.attemptId,
            executionFence: candidate.executionFence,
            expectedLeaseVersion: candidate.expectedLeaseVersion,
          });
          const handlingReceipt = yield* Effect.fromResult(
            expiryHandlingReceipt(candidate, receipt),
          );
          if (publish !== undefined) {
            yield* publishRequestedWakes(receipt.requestedEffects, publish);
          }
          return handlingReceipt;
        }
      }
    });

  return Object.freeze({ handle });
}

const publishRequestedWakes = Effect.fn(
  "TaskDueCandidateHandler.publishWakeHints",
)(function* <PublishFailure>(
  requestedEffects: readonly PersistedTaskRequestedEffectV1[],
  publish: TaskWakeHintPublisherV1<PublishFailure>["publish"],
): Effect.fn.Return<void, PublishFailure> {
  for (const requested of requestedEffects) {
    if (!isWakeRequestedEffect(requested)) continue;
    yield* publish(requested);
  }
});

function isWakeRequestedEffect(
  requested: PersistedTaskRequestedEffectV1,
): requested is TaskWakeRequestedEffectV1 {
  return requested.effect.kind === "wake_retry"
    || requested.effect.kind === "wake_lease_expiry";
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
