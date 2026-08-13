// Adapted from Trigger.dev commit f10bc23785e569e5d917318cf2033aabdbe96a0b,
// multiple mapped upstream paths. See trigger-source-map.json and THIRD_PARTY_NOTICES.md.
import { Brand, Effect, Layer, Result } from "effect";
import {
  fromCurrentTaskRunAttemptAggregate,
  fromCurrentTaskRunAttemptDecisionToApplication,
  fromCurrentTaskRunAttemptDecisionToLegacy,
  toCurrentTaskRunAttemptAggregate,
  type ApplicationTaskLifecycleOutcomeByOperation,
  type CurrentTaskLifecycleOutcomeByOperation,
  type LegacyTaskLifecycleOutcomeByOperation,
  type TaskLifecycleDecisionOperation,
} from "../DefinitionReference.js";
import type {
  ApplicationCompleteAttemptOutcomeV1,
  ApplicationHandleLeaseExpiryOutcomeV1,
  ApplicationHeartbeatAttemptOutcomeV1,
  ApplicationRequestCancellationOutcomeV1,
  ApplicationStartAttemptOutcomeV1,
  ApplicationTaskRunAttemptDecisionV1,
  ApplicationTaskSystemRunAttemptDecisionInputV1,
  CompleteAttemptOutcomeV1,
  HandleLeaseExpiryOutcomeV1,
  HeartbeatAttemptOutcomeV1,
  RequestCancellationOutcomeV1,
  StartAttemptOutcomeV1,
  TaskRunAttemptDecisionV1,
  TaskSystemRunAttemptDecisionInputV1,
} from "../Model.js";
import {
  ConflictingTaskAttemptCompletionError,
  InvalidRunAttemptTransitionError,
  InvalidTaskCancellationAcknowledgementError,
  TaskRunAttemptCounterExhaustedError,
  TaskRunAttemptPolicyError,
  type RunAttemptDecisionErrorV1,
} from "../Errors.js";
import {
  areTaskAttemptCompletionsReplayEqualV1,
  projectRunAttemptInspectionV1,
  projectCurrentRunAttemptState,
  type CurrentAcceptedCompleteAttemptOutcome,
  type CurrentAcceptedHandleLeaseExpiryOutcome,
  type CurrentAcceptedHeartbeatAttemptOutcome,
  type CurrentAcceptedRequestCancellationOutcome,
  type CurrentAcceptedStartAttemptOutcome,
  type CompleteAttemptCommandV1,
  type CurrentCompleteAttemptOutcome,
  type HandleLeaseExpiryCommandV1,
  type CurrentHandleLeaseExpiryOutcome,
  type HeartbeatAttemptCommandV1,
  type CurrentHeartbeatAttemptOutcome,
  type CurrentPersistedTaskRequestedEffect,
  type RequestCancellationCommandV1,
  type CurrentRequestCancellationOutcome,
  type RunAttemptMutationOperationV1,
  type StartAttemptCommandV1,
  type CurrentStartAttemptOutcome,
  type CurrentTaskAttemptCompletionReplay,
  type TaskAttemptCompletionV1,
  type TaskCancellationResolvedV1,
  type TaskCurrentAttemptV1,
  type TaskDatabaseTimeMsV1,
  type TaskExecutionFailureV1,
  type TaskLeaseVersionV1,
  type TaskLifecycleEventProjectionV1,
  type TaskRequestedEffectCursorV1,
  type TaskRequestedEffectSequenceV1,
  type CurrentTaskRequestedEffect,
  type CurrentTaskRunAttemptAcceptedReceipt,
  type CurrentTaskRunAttemptAggregateBase,
  type CurrentTaskRunAttemptAggregate,
  type CurrentTaskRunAttemptDecision,
  type CurrentTaskRunAttemptEvidence,
  type CurrentTaskRunAttemptMutationAcceptance,
  type TaskRunVersionV1,
  type CurrentTaskSystemRunAttemptDecisionInput,
  type TaskTerminalAttemptRefV1,
} from "../Model.js";
import { decideFailurePolicyV1, validateBoundPolicyV1 } from "../Policy.js";
import {
  decodeApplicationTaskRunAttemptAggregateV1,
  decodeTaskRunAttemptAggregateV1,
  encodeApplicationTaskRunAttemptAggregateV1,
  encodeTaskRunAttemptAggregateV1,
} from "../Schema.js";
import {
  RunAttemptLifecycle,
  type RunAttemptLifecycleShape,
} from "../Services/RunAttemptLifecycle.js";
import {
  TaskSystemRunAttemptStore,
  type TaskSystemRunAttemptStoreShape,
} from "../Services/TaskSystemRunAttemptStore.js";

const MAX_COUNTER = 9_223_372_036_854_775_807n;
const runVersion = Brand.nominal<TaskRunVersionV1>();
const leaseVersion = Brand.nominal<TaskLeaseVersionV1>();
const effectSequence = Brand.nominal<TaskRequestedEffectSequenceV1>();
const databaseTime = Brand.nominal<TaskDatabaseTimeMsV1>();

function activeAttempt(attempt: TaskCurrentAttemptV1): TaskTerminalAttemptRefV1 {
  return {
    attemptId: attempt.attemptId,
    attemptNumber: attempt.attemptNumber,
    executionFence: attempt.executionFence,
  };
}

function projectFailureForLifecycleEvent(
  failure: TaskExecutionFailureV1,
): Extract<TaskLifecycleEventProjectionV1, { readonly kind: "run_failed" }>["failure"] {
  switch (failure.kind) {
    case "task_failure":
      return { kind: failure.kind, code: failure.code };
    case "system_failure":
      return { kind: failure.kind, code: failure.code };
    case "resource_exhaustion":
      return { kind: failure.kind, code: failure.code };
    case "timed_out":
      return { kind: failure.kind, code: failure.code };
  }
}

function incrementRunVersion(
  operation: RunAttemptMutationOperationV1,
  current: CurrentTaskRunAttemptAggregate,
): Result.Result<TaskRunVersionV1, TaskRunAttemptCounterExhaustedError> {
  return current.runVersion >= MAX_COUNTER
    ? Result.fail(new TaskRunAttemptCounterExhaustedError({
        operation,
        runId: current.runId,
        counter: "run_version",
      }))
    : Result.succeed(runVersion(current.runVersion + 1n));
}

function incrementLeaseVersion(
  operation: Exclude<RunAttemptMutationOperationV1, "request_cancellation">,
  current: CurrentTaskRunAttemptAggregate,
): Result.Result<TaskLeaseVersionV1, TaskRunAttemptCounterExhaustedError> {
  const cursor = current.leaseHistory;
  if (cursor.kind === "issued" && cursor.lastLeaseVersion >= MAX_COUNTER) {
    return Result.fail(new TaskRunAttemptCounterExhaustedError({
      operation,
      runId: current.runId,
      counter: "lease_version",
    }));
  }
  return Result.succeed(leaseVersion(cursor.kind === "none" ? 1n : cursor.lastLeaseVersion + 1n));
}

function addDatabaseDuration(
  operation: Exclude<RunAttemptMutationOperationV1, "request_cancellation">,
  current: CurrentTaskRunAttemptAggregate,
  now: TaskDatabaseTimeMsV1,
  duration: number,
): Result.Result<TaskDatabaseTimeMsV1, RunAttemptDecisionErrorV1> {
  const value = now + duration;
  return Number.isSafeInteger(value) && value >= 0
    ? Result.succeed(databaseTime(value))
    : Result.fail(new TaskRunAttemptPolicyError({
        operation,
        runId: current.runId,
        reason: "lease_expiry_time_overflow",
      }));
}

function commonBase(
  current: CurrentTaskRunAttemptAggregate,
  nextVersion: TaskRunVersionV1,
  cursor: TaskRequestedEffectCursorV1,
): CurrentTaskRunAttemptAggregateBase {
  return {
    version: "flarex.task-run-attempt-aggregate.v1",
    runId: current.runId,
    definitionReference: current.definitionReference,
    createdAtMs: current.createdAtMs,
    runVersion: nextVersion,
    boundPolicy: current.boundPolicy,
    attemptHistory: current.attemptHistory,
    leaseHistory: current.leaseHistory,
    lastLifecycleAcceptance: null,
    completionReplays: current.completionReplays,
    requestedEffectCursor: cursor,
  };
}

function currentDecision<Outcome>(outcome: Outcome): CurrentTaskRunAttemptDecision<Outcome> {
  return { kind: "no_change", disposition: "current", outcome };
}

/**
 * Detach and recursively freeze one lifecycle success produced from decoded
 * run-attempt data. Digest byte views are detached by structuredClone and are
 * deliberately skipped by Object.freeze because JavaScript rejects freezing a
 * non-empty typed array.
 */
function snapshotLifecycleDecisionV1<Outcome>(
  decision: CurrentTaskRunAttemptDecision<Outcome>,
): CurrentTaskRunAttemptDecision<Outcome> {
  const snapshot = structuredClone(decision);
  freezeLifecycleDecisionV1(snapshot);
  return snapshot;
}

function freezeLifecycleDecisionV1(value: unknown): void {
  if (value === null || typeof value !== "object" || ArrayBuffer.isView(value)) return;
  const children = Array.isArray(value) ? value : Object.values(value);
  for (const child of children) freezeLifecycleDecisionV1(child);
  Object.freeze(value);
}

function idempotentDecision<Outcome>(
  replay: CurrentTaskRunAttemptAcceptedReceipt<Outcome>,
): CurrentTaskRunAttemptDecision<Outcome> {
  return snapshotLifecycleDecisionV1({ kind: "no_change", disposition: "idempotent", replay });
}

function assignEffects(
  operation: RunAttemptMutationOperationV1,
  current: CurrentTaskRunAttemptAggregate,
  effects: readonly CurrentTaskRequestedEffect[],
): Result.Result<{
  readonly persisted: readonly CurrentPersistedTaskRequestedEffect[];
  readonly cursor: TaskRequestedEffectCursorV1;
}, TaskRunAttemptCounterExhaustedError> {
  const first = current.requestedEffectCursor.kind === "none"
    ? 1n
    : current.requestedEffectCursor.lastSequence + 1n;
  const last = first + BigInt(effects.length) - 1n;
  if (effects.length === 0 || first > MAX_COUNTER || last > MAX_COUNTER) {
    return Result.fail(new TaskRunAttemptCounterExhaustedError({
      operation,
      runId: current.runId,
      counter: "requested_effect_sequence",
    }));
  }
  const persisted = effects.map((effect, index): CurrentPersistedTaskRequestedEffect => ({
    sequence: effectSequence(first + BigInt(index)),
    effect,
  }));
  return Result.succeed({
    persisted,
    cursor: { kind: "issued", lastSequence: effectSequence(last) },
  });
}

type AcceptanceFactory<Outcome> = (
  receipt: CurrentTaskRunAttemptAcceptedReceipt<Outcome>,
) => CurrentTaskRunAttemptMutationAcceptance;

type CurrentAggregateCandidateValidator = (
  candidate: CurrentTaskRunAttemptAggregate,
) => Result.Result<CurrentTaskRunAttemptAggregate, InvalidRunAttemptTransitionError>;
type CurrentDecisionInput = CurrentTaskSystemRunAttemptDecisionInput & Readonly<{
  readonly validateCandidate: CurrentAggregateCandidateValidator;
}>;

function finalizeCommit<Outcome>(input: {
  readonly operation: RunAttemptMutationOperationV1;
  readonly current: CurrentTaskRunAttemptAggregate;
  readonly nextVersion: TaskRunVersionV1;
  readonly observedAtMs: TaskDatabaseTimeMsV1;
  readonly draft: (cursor: TaskRequestedEffectCursorV1) => CurrentTaskRunAttemptAggregate;
  readonly evidence: readonly CurrentTaskRunAttemptEvidence[];
  readonly effects: readonly CurrentTaskRequestedEffect[];
  readonly outcome: Outcome;
  readonly acceptance: AcceptanceFactory<Outcome>;
  readonly completionReplay?: (
    receipt: CurrentTaskRunAttemptAcceptedReceipt<Outcome>,
  ) => CurrentTaskAttemptCompletionReplay;
  readonly validateCandidate: CurrentAggregateCandidateValidator;
}): Result.Result<CurrentTaskRunAttemptDecision<Outcome>, RunAttemptDecisionErrorV1> {
  if (input.completionReplay !== undefined && input.current.completionReplays.length >= 250) {
    return Result.fail(new InvalidRunAttemptTransitionError({
      operation: input.operation,
      runId: input.current.runId,
      phase: input.current.phase,
      reason: "completion_replay_invalid",
    }));
  }
  return Result.flatMap(assignEffects(input.operation, input.current, input.effects), ({ persisted, cursor }) => {
    const initial = input.draft(cursor);
    const receipt: CurrentTaskRunAttemptAcceptedReceipt<Outcome> = {
      observedAtMs: input.observedAtMs,
      acceptedRunVersion: input.nextVersion,
      resultingPhase: initial.phase,
      outcome: input.outcome,
      evidence: input.evidence,
      requestedEffects: persisted,
    };
    const acceptance = input.acceptance(receipt);
    const replay = input.completionReplay?.(receipt) ?? null;
    const next: CurrentTaskRunAttemptAggregate = {
      ...initial,
      lastLifecycleAcceptance: acceptance,
      completionReplays: replay === null
        ? initial.completionReplays
        : [...initial.completionReplays, replay],
    };
    return input.validateCandidate(next).pipe(
      Result.map((ownedNext) => snapshotLifecycleDecisionV1({
        kind: "commit",
        expectedRunVersion: input.current.runVersion,
        next: ownedNext,
        evidence: input.evidence,
        requestedEffects: persisted,
        outcome: input.outcome,
      })),
    );
  });
}

function effectBase(current: CurrentTaskRunAttemptAggregate, acceptedRunVersion: TaskRunVersionV1) {
  return {
    version: "flarex.task-requested-effect.v1" as const,
    runId: current.runId,
    acceptedRunVersion,
  };
}

function evidenceBase(
  current: CurrentTaskRunAttemptAggregate,
  acceptedRunVersion: TaskRunVersionV1,
  recordedAtMs: TaskDatabaseTimeMsV1,
  resultingPhase: CurrentTaskRunAttemptAggregate["phase"],
) {
  return {
    version: "flarex.task-run-attempt-evidence.v1" as const,
    runId: current.runId,
    acceptedRunVersion,
    recordedAtMs,
    resultingPhase,
  };
}

function directStartReplay(
  current: CurrentTaskRunAttemptAggregate,
  command: StartAttemptCommandV1,
): CurrentTaskRunAttemptAcceptedReceipt<CurrentAcceptedStartAttemptOutcome> | null {
  const acceptance = current.lastLifecycleAcceptance;
  return acceptance?.kind === "start_attempt" &&
    acceptance.command.expectedRunVersion === command.expectedRunVersion
    ? acceptance.accepted
    : null;
}

function decideStartAttemptCore(
  command: StartAttemptCommandV1,
  input: CurrentDecisionInput,
): Result.Result<CurrentTaskRunAttemptDecision<CurrentStartAttemptOutcome>, RunAttemptDecisionErrorV1> {
  const current = input.current;
  const replay = directStartReplay(current, command);
  if (replay !== null) return Result.succeed(idempotentDecision(replay));
  if (command.expectedRunVersion !== current.runVersion) {
    return Result.succeed(currentDecision({ kind: "current", reason: "stale_run_version", state: projectCurrentRunAttemptState(current) }));
  }
  if (current.phase !== "ready" && current.phase !== "retry_waiting") {
    return Result.succeed(currentDecision({ kind: "current", reason: "phase_not_startable", state: projectCurrentRunAttemptState(current) }));
  }
  const eligibleAtMs = current.phase === "ready" ? current.ready.eligibleAtMs : current.retry.notBeforeMs;
  if (input.databaseNowMs < eligibleAtMs) {
    return Result.succeed(currentDecision({ kind: "current", reason: "not_yet_eligible", state: projectCurrentRunAttemptState(current) }));
  }
  const candidate = input.attemptGrantCandidate;
  if (candidate === null) {
    return Result.fail(new InvalidRunAttemptTransitionError({
      operation: "start_attempt", runId: current.runId, phase: current.phase, reason: "candidate_missing",
    }));
  }
  return Result.gen(function* () {
    yield* validateBoundPolicyV1("start_attempt", current.runId, current.boundPolicy);
    const expectedAttempt = current.attemptHistory.kind === "none"
      ? 1
      : current.attemptHistory.lastAttemptNumber + 1;
    if (candidate.attemptNumber !== expectedAttempt || candidate.attemptNumber > current.boundPolicy.runAttempt.retry.maxAttempts) {
      return yield* Result.fail(new InvalidRunAttemptTransitionError({
        operation: "start_attempt", runId: current.runId, phase: current.phase, reason: "candidate_unexpected",
      }));
    }
    const nextVersion = yield* incrementRunVersion("start_attempt", current);
    const nextLeaseVersion = yield* incrementLeaseVersion("start_attempt", current);
    const expiresAtMs = yield* addDatabaseDuration(
      "start_attempt", current, input.databaseNowMs, current.boundPolicy.leaseDurationMs,
    );
    const computeProfile = current.phase === "retry_waiting"
      ? current.retry.nextComputeProfile
      : current.boundPolicy.initialComputeProfile;
    const attempt: TaskCurrentAttemptV1 = {
      attemptId: candidate.attemptId,
      attemptNumber: candidate.attemptNumber,
      executionFence: candidate.executionFence,
      grantBasisRunVersion: current.runVersion,
      computeProfile,
      retryJitter: command.retryJitter,
      grantedAtMs: input.databaseNowMs,
      lease: { version: nextLeaseVersion, renewedAtMs: input.databaseNowMs, expiresAtMs },
    };
    const attemptRef = activeAttempt(attempt);
    const grant = {
      runId: current.runId,
      definitionReference: current.definitionReference,
      acceptedRunVersion: nextVersion,
      attempt: attemptRef,
      computeProfile,
      grantedAtMs: input.databaseNowMs,
      lease: { ...attempt.lease },
    };
    const outcome: CurrentAcceptedStartAttemptOutcome = { kind: "attempt_granted", grant };
    const baseEffect = effectBase(current, nextVersion);
    const effects: readonly CurrentTaskRequestedEffect[] = [
      { ...baseEffect, kind: "dispatch_attempt", definitionReference: current.definitionReference, attempt: attemptRef, leaseVersion: nextLeaseVersion, computeProfile },
      { ...baseEffect, kind: "wake_lease_expiry", attemptId: attempt.attemptId, executionFence: attempt.executionFence, expectedLeaseVersion: nextLeaseVersion, notBeforeMs: expiresAtMs },
      { ...baseEffect, kind: "publish_lifecycle_event", observedAtMs: input.databaseNowMs, event: { kind: "attempt_granted", attemptNumber: attempt.attemptNumber } },
      { ...baseEffect, kind: "notify_current_state" },
    ];
    const evidence: readonly CurrentTaskRunAttemptEvidence[] = [{
      ...evidenceBase(current, nextVersion, input.databaseNowMs, "attempt_granted"),
      kind: "attempt_granted",
      fromPhase: current.phase,
      grant,
    }];
    return yield* finalizeCommit({
      operation: "start_attempt",
      current,
      nextVersion,
      observedAtMs: input.databaseNowMs,
      draft: (cursor) => ({
        ...commonBase(current, nextVersion, cursor),
        phase: "attempt_granted",
        attemptHistory: { kind: "issued", lastAttemptNumber: candidate.attemptNumber },
        leaseHistory: { kind: "issued", lastLeaseVersion: nextLeaseVersion },
        currentAttempt: attempt,
        heartbeat: { kind: "none_accepted" },
        cancellation: current.cancellation,
      }),
      evidence,
      effects,
      outcome,
      validateCandidate: input.validateCandidate,
      acceptance: (accepted) => ({
        kind: "start_attempt",
        command: { kind: "start_attempt", expectedRunVersion: command.expectedRunVersion },
        accepted,
      }),
    });
  });
}

function activePhase(current: CurrentTaskRunAttemptAggregate): current is Extract<
  CurrentTaskRunAttemptAggregate,
  { readonly phase: "attempt_granted" | "executing" }
> {
  return current.phase === "attempt_granted" || current.phase === "executing";
}

function decideHeartbeatAttemptCore(
  command: HeartbeatAttemptCommandV1,
  input: CurrentDecisionInput,
): Result.Result<CurrentTaskRunAttemptDecision<CurrentHeartbeatAttemptOutcome>, RunAttemptDecisionErrorV1> {
  const current = input.current;
  if (input.attemptGrantCandidate !== null) {
    return Result.fail(new InvalidRunAttemptTransitionError({
      operation: "heartbeat_attempt", runId: current.runId, phase: current.phase, reason: "candidate_unexpected",
    }));
  }
  const latest = current.lastLifecycleAcceptance;
  if (latest?.kind === "heartbeat_attempt" &&
    latest.command.attemptId === command.attemptId &&
    latest.command.executionFence === command.executionFence &&
    latest.command.heartbeatSequence === command.heartbeatSequence) {
    return Result.succeed(idempotentDecision(latest.accepted));
  }
  const currentOutcome = (reason: Extract<CurrentHeartbeatAttemptOutcome, { readonly kind: "current" }>["reason"]): CurrentTaskRunAttemptDecision<CurrentHeartbeatAttemptOutcome> =>
    currentDecision({ kind: "current", reason, state: projectCurrentRunAttemptState(current) });
  if (!activePhase(current)) return Result.succeed(currentOutcome("phase_not_active"));
  if (current.currentAttempt.attemptId !== command.attemptId) return Result.succeed(currentOutcome("stale_attempt"));
  if (current.currentAttempt.executionFence !== command.executionFence) return Result.succeed(currentOutcome("stale_fence"));
  if (input.databaseNowMs >= current.currentAttempt.lease.expiresAtMs) return Result.succeed(currentOutcome("lease_expired"));
  if (current.phase === "executing" && command.heartbeatSequence <= current.heartbeat.highestSequence) {
    return Result.succeed(currentOutcome("heartbeat_not_advanced"));
  }
  return Result.gen(function* () {
    yield* validateBoundPolicyV1("heartbeat_attempt", current.runId, current.boundPolicy);
    const nextVersion = yield* incrementRunVersion("heartbeat_attempt", current);
    const nextLeaseVersion = yield* incrementLeaseVersion("heartbeat_attempt", current);
    const expiresAtMs = yield* addDatabaseDuration(
      "heartbeat_attempt", current, input.databaseNowMs, current.boundPolicy.leaseDurationMs,
    );
    const previousLease = current.currentAttempt.lease;
    const renewedAttempt: TaskCurrentAttemptV1 = {
      ...current.currentAttempt,
      lease: { version: nextLeaseVersion, renewedAtMs: input.databaseNowMs, expiresAtMs },
    };
    const attempt = activeAttempt(renewedAttempt);
    const enteredExecuting = current.phase === "attempt_granted";
    const outcome: CurrentAcceptedHeartbeatAttemptOutcome = {
      kind: "lease_renewed",
      attempt,
      heartbeatSequence: command.heartbeatSequence,
      enteredExecuting,
      lease: { ...renewedAttempt.lease },
    };
    const baseEffect = effectBase(current, nextVersion);
    const effects: readonly CurrentTaskRequestedEffect[] = [
      { ...baseEffect, kind: "cancel_obsolete_lease_wake", attemptId: attempt.attemptId, executionFence: attempt.executionFence, obsoleteLeaseVersion: previousLease.version },
      { ...baseEffect, kind: "wake_lease_expiry", attemptId: attempt.attemptId, executionFence: attempt.executionFence, expectedLeaseVersion: nextLeaseVersion, notBeforeMs: expiresAtMs },
      ...(enteredExecuting ? [{
        ...baseEffect,
        kind: "publish_lifecycle_event" as const,
        observedAtMs: input.databaseNowMs,
        event: { kind: "execution_observed" as const, attemptNumber: attempt.attemptNumber },
      }] : []),
      { ...baseEffect, kind: "notify_current_state" },
    ];
    const evidence: readonly CurrentTaskRunAttemptEvidence[] = [{
      ...evidenceBase(current, nextVersion, input.databaseNowMs, "executing"),
      kind: "heartbeat_accepted",
      attempt,
      heartbeatSequence: command.heartbeatSequence,
      previousLeaseVersion: previousLease.version,
      renewedLease: { ...renewedAttempt.lease },
      enteredExecuting,
    }];
    return yield* finalizeCommit({
      operation: "heartbeat_attempt", current, nextVersion, observedAtMs: input.databaseNowMs,
      draft: (cursor) => ({
        ...commonBase(current, nextVersion, cursor),
        phase: "executing",
        leaseHistory: { kind: "issued", lastLeaseVersion: nextLeaseVersion },
        currentAttempt: renewedAttempt,
        heartbeat: { kind: "accepted", highestSequence: command.heartbeatSequence },
        cancellation: current.cancellation,
      }),
      evidence,
      effects,
      outcome,
      validateCandidate: input.validateCandidate,
      acceptance: (accepted) => ({
        kind: "heartbeat_attempt",
        command: { kind: "heartbeat_attempt", attemptId: command.attemptId, executionFence: command.executionFence, heartbeatSequence: command.heartbeatSequence },
        accepted,
      }),
    });
  });
}

function completionReplay(
  current: CurrentTaskRunAttemptAggregate,
  command: CompleteAttemptCommandV1,
): Result.Result<CurrentTaskRunAttemptAcceptedReceipt<CurrentAcceptedCompleteAttemptOutcome> | null, ConflictingTaskAttemptCompletionError> {
  const replay = current.completionReplays.find((candidate) =>
    candidate.attempt.attemptId === command.attemptId &&
    candidate.attempt.executionFence === command.executionFence);
  if (replay === undefined) return Result.succeed(null);
  return areTaskAttemptCompletionsReplayEqualV1(replay.completion, command.completion)
    ? Result.succeed(replay.accepted)
    : Result.fail(new ConflictingTaskAttemptCompletionError({
        operation: "complete_attempt",
        runId: current.runId,
        attemptId: command.attemptId,
        acceptedKind: replay.completion.kind,
        receivedKind: command.completion.kind,
      }));
}

function resolvedCancellation<Resolution extends "acknowledged" | "lease_expired" | "superseded_by_completion">(
  current: Extract<CurrentTaskRunAttemptAggregate, { readonly phase: "attempt_granted" | "executing" }>,
  now: TaskDatabaseTimeMsV1,
  resolution: Resolution,
): TaskCancellationResolvedV1 & { readonly resolution: Resolution } {
  const requested = current.cancellation;
  if (requested.kind !== "requested") {
    return {
      kind: "resolved",
      generation: requested.generation,
      reason: { code: "requested", message: null },
      requestedAtMs: now,
      resolvedAtMs: now,
      resolution,
    };
  }
  return { ...requested, kind: "resolved", resolvedAtMs: now, resolution };
}

function completionCommonEffects(
  current: Extract<CurrentTaskRunAttemptAggregate, { readonly phase: "attempt_granted" | "executing" }>,
  nextVersion: TaskRunVersionV1,
  releaseCause: Extract<CurrentTaskRequestedEffect, { readonly kind: "release_queue_ownership" }>["cause"],
  tail: readonly CurrentTaskRequestedEffect[],
): readonly CurrentTaskRequestedEffect[] {
  const base = effectBase(current, nextVersion);
  return [
    { ...base, kind: "cancel_obsolete_lease_wake", attemptId: current.currentAttempt.attemptId, executionFence: current.currentAttempt.executionFence, obsoleteLeaseVersion: current.currentAttempt.lease.version },
    { ...base, kind: "release_queue_ownership", cause: releaseCause },
    ...tail,
    { ...base, kind: "notify_current_state" },
  ];
}

function decideCompleteAttemptCore(
  command: CompleteAttemptCommandV1,
  input: CurrentDecisionInput,
): Result.Result<CurrentTaskRunAttemptDecision<CurrentCompleteAttemptOutcome>, RunAttemptDecisionErrorV1> {
  const current = input.current;
  if (input.attemptGrantCandidate !== null) {
    return Result.fail(new InvalidRunAttemptTransitionError({
      operation: "complete_attempt", runId: current.runId, phase: current.phase, reason: "candidate_unexpected",
    }));
  }
  return Result.gen(function* () {
    const replay = yield* completionReplay(current, command);
    if (replay !== null) return idempotentDecision(replay);
    const currentOutcome = (reason: Extract<CurrentCompleteAttemptOutcome, { readonly kind: "current" }>["reason"]): CurrentTaskRunAttemptDecision<CurrentCompleteAttemptOutcome> =>
      currentDecision({ kind: "current", reason, state: projectCurrentRunAttemptState(current) });
    if (!activePhase(current)) return currentOutcome("phase_not_active");
    if (current.currentAttempt.attemptId !== command.attemptId) return currentOutcome("stale_attempt");
    if (current.currentAttempt.executionFence !== command.executionFence) return currentOutcome("stale_fence");
    if (input.databaseNowMs >= current.currentAttempt.lease.expiresAtMs) return currentOutcome("lease_expired");
    if (command.completion.kind === "cancellation_acknowledged") {
      const requestedGeneration = current.cancellation.kind === "requested"
        ? current.cancellation.generation
        : null;
      if (requestedGeneration === null || requestedGeneration !== command.completion.cancellationGeneration) {
        return yield* Result.fail(new InvalidTaskCancellationAcknowledgementError({
          operation: "complete_attempt", runId: current.runId, attemptId: command.attemptId,
          requestedGeneration, receivedGeneration: command.completion.cancellationGeneration,
        }));
      }
    }
    yield* validateBoundPolicyV1("complete_attempt", current.runId, current.boundPolicy);
    const nextVersion = yield* incrementRunVersion("complete_attempt", current);
    const attempt = activeAttempt(current.currentAttempt);
    const cancellation = current.cancellation.kind === "requested"
      ? resolvedCancellation(current, input.databaseNowMs, "superseded_by_completion")
      : current.cancellation;
    const base = effectBase(current, nextVersion);

    if (command.completion.kind === "succeeded") {
      const terminal = {
        kind: "succeeded" as const,
        completedAtMs: input.databaseNowMs,
        attempt,
        result: command.completion.result,
        executionDurationMs: command.completion.executionDurationMs,
      };
      const outcome: Extract<CurrentAcceptedCompleteAttemptOutcome, { readonly kind: "terminal_succeeded" }> = { kind: "terminal_succeeded", terminal, cancellation };
      const effects = completionCommonEffects(current, nextVersion, "succeeded_completion", [{
        ...base, kind: "publish_lifecycle_event", observedAtMs: input.databaseNowMs,
        event: { kind: "run_succeeded", attemptNumber: attempt.attemptNumber, hasResult: terminal.result !== null },
      }]);
      const evidence: readonly CurrentTaskRunAttemptEvidence[] = [{
        ...evidenceBase(current, nextVersion, input.databaseNowMs, "terminal"),
        kind: "completion_succeeded", attempt, completion: command.completion, outcome,
      }];
      return yield* finalizeCommit({
        operation: "complete_attempt", current, nextVersion, observedAtMs: input.databaseNowMs,
        draft: (cursor) => ({ ...commonBase(current, nextVersion, cursor), phase: "terminal", terminal, cancellation }),
        evidence, effects, outcome,
        validateCandidate: input.validateCandidate,
        acceptance: (accepted) => ({ kind: "complete_attempt", attemptId: command.attemptId, executionFence: command.executionFence, accepted }),
        completionReplay: (accepted) => ({ attempt, completion: command.completion, accepted }),
      });
    }

    if (command.completion.kind === "cancellation_acknowledged") {
      const resolved = resolvedCancellation(current, input.databaseNowMs, "acknowledged");
      const terminal = {
        kind: "cancelled" as const,
        completedAtMs: input.databaseNowMs,
        attempt,
        cancellationGeneration: command.completion.cancellationGeneration,
        reason: resolved.reason,
        resolution: "acknowledged" as const,
        executionDurationMs: command.completion.executionDurationMs,
      };
      const outcome: Extract<CurrentAcceptedCompleteAttemptOutcome, { readonly kind: "terminal_cancelled" }> = { kind: "terminal_cancelled", terminal };
      const effects = completionCommonEffects(current, nextVersion, "cancellation_acknowledged", [{
        ...base, kind: "publish_lifecycle_event", observedAtMs: input.databaseNowMs,
        event: { kind: "run_cancelled", generation: resolved.generation, reasonCode: resolved.reason.code, cancellation: { attemptNumber: attempt.attemptNumber, resolution: "acknowledged" } },
      }]);
      const evidence: readonly CurrentTaskRunAttemptEvidence[] = [{
        ...evidenceBase(current, nextVersion, input.databaseNowMs, "terminal"),
        kind: "completion_cancellation_acknowledged", attempt, completion: command.completion, outcome,
      }];
      return yield* finalizeCommit({
        operation: "complete_attempt", current, nextVersion, observedAtMs: input.databaseNowMs,
        draft: (cursor) => ({ ...commonBase(current, nextVersion, cursor), phase: "terminal", terminal, cancellation: resolved }),
        evidence, effects, outcome,
        validateCandidate: input.validateCandidate,
        acceptance: (accepted) => ({ kind: "complete_attempt", attemptId: command.attemptId, executionFence: command.executionFence, accepted }),
        completionReplay: (accepted) => ({ attempt, completion: command.completion, accepted }),
      });
    }

    const policy = yield* decideFailurePolicyV1({
      operation: "complete_attempt", runId: current.runId, databaseNowMs: input.databaseNowMs,
      boundPolicy: current.boundPolicy, currentAttempt: current.currentAttempt,
      failure: command.completion.failure, directive: command.completion.retry,
      directiveSource: "completion", cancellationRequested: current.cancellation.kind === "requested", leaseExpiry: false,
    });
    if (policy.kind === "retry") {
      const retry = {
        previousAttempt: attempt,
        acceptedAtMs: input.databaseNowMs,
        notBeforeMs: policy.notBeforeMs,
        nextComputeProfile: policy.nextComputeProfile,
        cause: { kind: "failed_completion" as const, failure: command.completion.failure },
      };
      const outcome: Extract<CurrentAcceptedCompleteAttemptOutcome, { readonly kind: "retry_scheduled" }> = { kind: "retry_scheduled", delivery: policy.delivery, retry };
      const retryEffect: CurrentTaskRequestedEffect = policy.delivery === "immediate"
        ? { ...base, kind: "continue_retry", expectedRunVersion: nextVersion, notBeforeMs: policy.notBeforeMs }
        : { ...base, kind: "wake_retry", expectedRunVersion: nextVersion, notBeforeMs: policy.notBeforeMs };
      const effects = completionCommonEffects(current, nextVersion, "failed_completion", [
        retryEffect,
        { ...base, kind: "publish_lifecycle_event", observedAtMs: input.databaseNowMs, event: { kind: "retry_scheduled", previousAttemptNumber: attempt.attemptNumber, retry: { source: "failed_completion", delivery: policy.delivery }, notBeforeMs: policy.notBeforeMs } },
      ]);
      const nextPhase = policy.delivery === "immediate" ? "ready" : "retry_waiting";
      const evidence: readonly CurrentTaskRunAttemptEvidence[] = [{
        ...evidenceBase(current, nextVersion, input.databaseNowMs, nextPhase),
        kind: "completion_failed", attempt, completion: command.completion, policy: policy.evidence, outcome,
      }];
      return yield* finalizeCommit({
        operation: "complete_attempt", current, nextVersion, observedAtMs: input.databaseNowMs,
        draft: (cursor) => policy.delivery === "immediate"
          ? { ...commonBase(current, nextVersion, cursor), phase: "ready", ready: { kind: "immediate_retry", eligibleAtMs: policy.notBeforeMs, acceptedRetry: retry }, cancellation: { kind: "not_requested", generation: current.cancellation.generation } }
          : { ...commonBase(current, nextVersion, cursor), phase: "retry_waiting", retry, cancellation: { kind: "not_requested", generation: current.cancellation.generation } },
        evidence, effects, outcome,
        validateCandidate: input.validateCandidate,
        acceptance: (accepted) => ({ kind: "complete_attempt", attemptId: command.attemptId, executionFence: command.executionFence, accepted }),
        completionReplay: (accepted) => ({ attempt, completion: command.completion, accepted }),
      });
    }
    const terminal = {
      kind: "failed" as const,
      completedAtMs: input.databaseNowMs,
      attempt,
      classification: policy.classification,
      failure: command.completion.failure,
      executionDurationMs: command.completion.executionDurationMs,
    };
    const outcome: Extract<CurrentAcceptedCompleteAttemptOutcome, { readonly kind: "terminal_failed" }> = { kind: "terminal_failed", terminal, cancellation };
    const effects = completionCommonEffects(current, nextVersion, "failed_completion", [{
      ...base, kind: "publish_lifecycle_event", observedAtMs: input.databaseNowMs,
      event: { kind: "run_failed", attemptNumber: attempt.attemptNumber, failure: projectFailureForLifecycleEvent(terminal.failure) },
    }]);
    const evidence: readonly CurrentTaskRunAttemptEvidence[] = [{
      ...evidenceBase(current, nextVersion, input.databaseNowMs, "terminal"),
      kind: "completion_failed", attempt, completion: command.completion, policy: policy.evidence, outcome,
    }];
    return yield* finalizeCommit({
      operation: "complete_attempt", current, nextVersion, observedAtMs: input.databaseNowMs,
      draft: (cursor) => ({ ...commonBase(current, nextVersion, cursor), phase: "terminal", terminal, cancellation }),
      evidence, effects, outcome,
      validateCandidate: input.validateCandidate,
      acceptance: (accepted) => ({ kind: "complete_attempt", attemptId: command.attemptId, executionFence: command.executionFence, accepted }),
      completionReplay: (accepted) => ({ attempt, completion: command.completion, accepted }),
    });
  });
}

function cancellationReasonEqual(left: RequestCancellationCommandV1["reason"], right: RequestCancellationCommandV1["reason"]): boolean {
  return left.code === right.code && left.message === right.message;
}

function decideRequestCancellationCore(
  command: RequestCancellationCommandV1,
  input: CurrentDecisionInput,
): Result.Result<CurrentTaskRunAttemptDecision<CurrentRequestCancellationOutcome>, RunAttemptDecisionErrorV1> {
  const current = input.current;
  if (input.attemptGrantCandidate !== null) {
    return Result.fail(new InvalidRunAttemptTransitionError({
      operation: "request_cancellation", runId: current.runId, phase: current.phase, reason: "candidate_unexpected",
    }));
  }
  const latest = current.lastLifecycleAcceptance;
  if (latest?.kind === "request_cancellation" && cancellationReasonEqual(latest.command.reason, command.reason)) {
    return Result.succeed(idempotentDecision(latest.accepted));
  }
  if (current.phase === "terminal") {
    return Result.succeed(currentDecision({ kind: "current", reason: "already_terminal", state: projectCurrentRunAttemptState(current) }));
  }
  if (activePhase(current) && current.cancellation.kind === "requested") {
    return Result.succeed(currentDecision({ kind: "current", reason: "already_requested", state: projectCurrentRunAttemptState(current) }));
  }
  return Result.gen(function* () {
    const nextVersion = yield* incrementRunVersion("request_cancellation", current);
    if (current.cancellation.generation >= MAX_COUNTER) {
      return yield* Result.fail(new TaskRunAttemptCounterExhaustedError({
        operation: "request_cancellation", runId: current.runId, counter: "cancellation_generation",
      }));
    }
    const generation = Brand.nominal<import("../Model.js").TaskCancellationGenerationV1>()(current.cancellation.generation + 1n);
    const base = effectBase(current, nextVersion);
    if (activePhase(current)) {
      const cancellation = { kind: "requested" as const, generation, reason: command.reason, requestedAtMs: input.databaseNowMs };
      const attempt = activeAttempt(current.currentAttempt);
      const outcome: CurrentAcceptedRequestCancellationOutcome = { kind: "cancellation_requested", attempt, cancellation };
      const effects: readonly CurrentTaskRequestedEffect[] = [
        { ...base, kind: "request_execution_cancellation", attemptId: attempt.attemptId, executionFence: attempt.executionFence, cancellationGeneration: generation },
        { ...base, kind: "publish_lifecycle_event", observedAtMs: input.databaseNowMs, event: { kind: "cancellation_requested", attemptNumber: attempt.attemptNumber, generation, reasonCode: command.reason.code } },
        { ...base, kind: "notify_current_state" },
      ];
      const evidence: readonly CurrentTaskRunAttemptEvidence[] = [{
        ...evidenceBase(current, nextVersion, input.databaseNowMs, current.phase),
        kind: "cancellation_requested", attempt, cancellation, outcome,
      }];
      return yield* finalizeCommit({
        operation: "request_cancellation", current, nextVersion, observedAtMs: input.databaseNowMs,
        draft: (cursor) => current.phase === "attempt_granted"
          ? { ...commonBase(current, nextVersion, cursor), phase: "attempt_granted", currentAttempt: current.currentAttempt, heartbeat: current.heartbeat, cancellation }
          : { ...commonBase(current, nextVersion, cursor), phase: "executing", currentAttempt: current.currentAttempt, heartbeat: current.heartbeat, cancellation },
        evidence, effects, outcome,
        validateCandidate: input.validateCandidate,
        acceptance: (accepted) => ({ kind: "request_cancellation", command: { kind: "request_cancellation", reason: command.reason }, accepted }),
      });
    }
    const resolved = {
      kind: "resolved" as const,
      generation,
      reason: command.reason,
      requestedAtMs: input.databaseNowMs,
      resolvedAtMs: input.databaseNowMs,
      resolution: "without_active_attempt" as const,
    };
    const terminal = {
      kind: "cancelled" as const,
      completedAtMs: input.databaseNowMs,
      attempt: null,
      cancellationGeneration: generation,
      reason: command.reason,
      resolution: "without_active_attempt" as const,
      executionDurationMs: null,
    };
    const outcome: CurrentAcceptedRequestCancellationOutcome = { kind: "terminal_cancelled", terminal };
    const effects: readonly CurrentTaskRequestedEffect[] = [
      { ...base, kind: "publish_lifecycle_event", observedAtMs: input.databaseNowMs, event: { kind: "run_cancelled", generation, reasonCode: command.reason.code, cancellation: { attemptNumber: null, resolution: "without_active_attempt" } } },
      { ...base, kind: "notify_current_state" },
    ];
    const evidence: readonly CurrentTaskRunAttemptEvidence[] = [{
      ...evidenceBase(current, nextVersion, input.databaseNowMs, "terminal"),
      kind: "cancellation_resolved_without_attempt", attempt: null, cancellation: resolved, outcome,
    }];
    return yield* finalizeCommit({
      operation: "request_cancellation", current, nextVersion, observedAtMs: input.databaseNowMs,
      draft: (cursor) => ({ ...commonBase(current, nextVersion, cursor), phase: "terminal", terminal, cancellation: resolved }),
      evidence, effects, outcome,
      validateCandidate: input.validateCandidate,
      acceptance: (accepted) => ({ kind: "request_cancellation", command: { kind: "request_cancellation", reason: command.reason }, accepted }),
    });
  });
}

function leaseFailure(phase: "attempt_granted" | "executing"): TaskExecutionFailureV1 {
  return {
    kind: "system_failure",
    code: phase === "attempt_granted" ? "attempt_dispatch_failed" : "execution_lost",
    message: null,
  };
}

function decideHandleLeaseExpiryCore(
  command: HandleLeaseExpiryCommandV1,
  input: CurrentDecisionInput,
): Result.Result<CurrentTaskRunAttemptDecision<CurrentHandleLeaseExpiryOutcome>, RunAttemptDecisionErrorV1> {
  const current = input.current;
  if (input.attemptGrantCandidate !== null) {
    return Result.fail(new InvalidRunAttemptTransitionError({
      operation: "handle_lease_expiry", runId: current.runId, phase: current.phase, reason: "candidate_unexpected",
    }));
  }
  const latest = current.lastLifecycleAcceptance;
  if (latest?.kind === "handle_lease_expiry" && latest.command.attemptId === command.attemptId &&
    latest.command.executionFence === command.executionFence && latest.command.expectedLeaseVersion === command.expectedLeaseVersion) {
    return Result.succeed(idempotentDecision(latest.accepted));
  }
  const currentOutcome = (reason: Extract<CurrentHandleLeaseExpiryOutcome, { readonly kind: "current" }>["reason"]): CurrentTaskRunAttemptDecision<CurrentHandleLeaseExpiryOutcome> =>
    currentDecision({ kind: "current", reason, state: projectCurrentRunAttemptState(current) });
  if (!activePhase(current)) return Result.succeed(currentOutcome("phase_not_active"));
  if (current.currentAttempt.attemptId !== command.attemptId) return Result.succeed(currentOutcome("stale_attempt"));
  if (current.currentAttempt.executionFence !== command.executionFence) return Result.succeed(currentOutcome("stale_fence"));
  if (current.currentAttempt.lease.version !== command.expectedLeaseVersion) return Result.succeed(currentOutcome("stale_lease_version"));
  if (input.databaseNowMs < current.currentAttempt.lease.expiresAtMs) return Result.succeed(currentOutcome("lease_not_expired"));
  return Result.gen(function* () {
    yield* validateBoundPolicyV1("handle_lease_expiry", current.runId, current.boundPolicy);
    const nextVersion = yield* incrementRunVersion("handle_lease_expiry", current);
    const attempt = activeAttempt(current.currentAttempt);
    const base = effectBase(current, nextVersion);
    if (current.cancellation.kind === "requested") {
      const resolved = resolvedCancellation(current, input.databaseNowMs, "lease_expired");
      const terminal = {
        kind: "cancelled" as const,
        completedAtMs: input.databaseNowMs,
        attempt,
        cancellationGeneration: resolved.generation,
        reason: resolved.reason,
        resolution: "lease_expired" as const,
        executionDurationMs: null,
      };
      const outcome: CurrentAcceptedHandleLeaseExpiryOutcome = { kind: "terminal_cancelled", terminal };
      const effects: readonly CurrentTaskRequestedEffect[] = [
        { ...base, kind: "release_queue_ownership", cause: "cancellation_lease_expired" },
        { ...base, kind: "publish_lifecycle_event", observedAtMs: input.databaseNowMs, event: { kind: "run_cancelled", generation: resolved.generation, reasonCode: resolved.reason.code, cancellation: { attemptNumber: attempt.attemptNumber, resolution: "lease_expired" } } },
        { ...base, kind: "notify_current_state" },
      ];
      const evidence: readonly CurrentTaskRunAttemptEvidence[] = [{
        ...evidenceBase(current, nextVersion, input.databaseNowMs, "terminal"),
        kind: "lease_expiry_cancelled", attempt, expiredLeaseVersion: command.expectedLeaseVersion,
        sourcePhase: current.phase, outcome,
      }];
      return yield* finalizeCommit({
        operation: "handle_lease_expiry", current, nextVersion, observedAtMs: input.databaseNowMs,
        draft: (cursor) => ({ ...commonBase(current, nextVersion, cursor), phase: "terminal", terminal, cancellation: resolved }),
        evidence, effects, outcome,
        validateCandidate: input.validateCandidate,
        acceptance: (accepted) => ({ kind: "handle_lease_expiry", command: { kind: "handle_lease_expiry", attemptId: command.attemptId, executionFence: command.executionFence, expectedLeaseVersion: command.expectedLeaseVersion }, accepted }),
      });
    }
    const failure = leaseFailure(current.phase);
    const policy = yield* decideFailurePolicyV1({
      operation: "handle_lease_expiry", runId: current.runId, databaseNowMs: input.databaseNowMs,
      boundPolicy: current.boundPolicy, currentAttempt: current.currentAttempt, failure,
      directive: { kind: "use_bound_policy" }, directiveSource: "synthesized_bound_policy",
      cancellationRequested: false, leaseExpiry: true,
    });
    if (policy.kind === "retry") {
      const causeKind = current.phase === "attempt_granted"
        ? "lease_expired_before_heartbeat" as const
        : "lease_expired_after_heartbeat" as const;
      const retry = {
        previousAttempt: attempt,
        acceptedAtMs: input.databaseNowMs,
        notBeforeMs: policy.notBeforeMs,
        nextComputeProfile: policy.nextComputeProfile,
        cause: { kind: causeKind, failure },
      };
      const outcome: CurrentAcceptedHandleLeaseExpiryOutcome = { kind: "retry_scheduled", delivery: "durable", retry };
      const effects: readonly CurrentTaskRequestedEffect[] = [
        { ...base, kind: "release_queue_ownership", cause: causeKind },
        { ...base, kind: "wake_retry", expectedRunVersion: nextVersion, notBeforeMs: policy.notBeforeMs },
        { ...base, kind: "publish_lifecycle_event", observedAtMs: input.databaseNowMs, event: { kind: "retry_scheduled", previousAttemptNumber: attempt.attemptNumber, retry: { source: "lease_expiry", delivery: "durable" }, notBeforeMs: policy.notBeforeMs } },
        { ...base, kind: "notify_current_state" },
      ];
      const evidence: readonly CurrentTaskRunAttemptEvidence[] = [{
        ...evidenceBase(current, nextVersion, input.databaseNowMs, "retry_waiting"),
        kind: "lease_expiry_recovered", attempt, expiredLeaseVersion: command.expectedLeaseVersion,
        sourcePhase: current.phase, policy: policy.evidence, outcome,
      }];
      return yield* finalizeCommit({
        operation: "handle_lease_expiry", current, nextVersion, observedAtMs: input.databaseNowMs,
        draft: (cursor) => ({ ...commonBase(current, nextVersion, cursor), phase: "retry_waiting", retry, cancellation: { kind: "not_requested", generation: current.cancellation.generation } }),
        evidence, effects, outcome,
        validateCandidate: input.validateCandidate,
        acceptance: (accepted) => ({ kind: "handle_lease_expiry", command: { kind: "handle_lease_expiry", attemptId: command.attemptId, executionFence: command.executionFence, expectedLeaseVersion: command.expectedLeaseVersion }, accepted }),
      });
    }
    const terminal = {
      kind: "failed" as const,
      completedAtMs: input.databaseNowMs,
      attempt,
      classification: policy.classification,
      failure,
      executionDurationMs: null,
    };
    const outcome: CurrentAcceptedHandleLeaseExpiryOutcome = { kind: "terminal_failed", terminal };
    const effects: readonly CurrentTaskRequestedEffect[] = [
      { ...base, kind: "release_queue_ownership", cause: current.phase === "attempt_granted" ? "lease_expired_before_heartbeat" : "lease_expired_after_heartbeat" },
      { ...base, kind: "publish_lifecycle_event", observedAtMs: input.databaseNowMs, event: { kind: "run_failed", attemptNumber: attempt.attemptNumber, failure: projectFailureForLifecycleEvent(failure) } },
      { ...base, kind: "notify_current_state" },
    ];
    const evidence: readonly CurrentTaskRunAttemptEvidence[] = [{
      ...evidenceBase(current, nextVersion, input.databaseNowMs, "terminal"),
      kind: "lease_expiry_recovered", attempt, expiredLeaseVersion: command.expectedLeaseVersion,
      sourcePhase: current.phase, policy: policy.evidence, outcome,
    }];
    return yield* finalizeCommit({
      operation: "handle_lease_expiry", current, nextVersion, observedAtMs: input.databaseNowMs,
      draft: (cursor) => ({ ...commonBase(current, nextVersion, cursor), phase: "terminal", terminal, cancellation: { kind: "not_requested", generation: current.cancellation.generation } }),
      evidence, effects, outcome,
      validateCandidate: input.validateCandidate,
      acceptance: (accepted) => ({ kind: "handle_lease_expiry", command: { kind: "handle_lease_expiry", attemptId: command.attemptId, executionFence: command.executionFence, expectedLeaseVersion: command.expectedLeaseVersion }, accepted }),
    });
  });
}

function legacyDecisionInput(
  input: TaskSystemRunAttemptDecisionInputV1,
  operation: RunAttemptMutationOperationV1,
): CurrentDecisionInput {
  return {
    databaseNowMs: input.databaseNowMs,
    get attemptGrantCandidate() {
      return input.attemptGrantCandidate;
    },
    current: toCurrentTaskRunAttemptAggregate({
      generation: "legacy_definition_v1",
      aggregate: input.current,
    }),
    validateCandidate: makeLegacyCandidateValidator(operation),
  };
}

const makeLegacyCandidateValidator = (
  operation: RunAttemptMutationOperationV1,
): CurrentAggregateCandidateValidator => (candidate) =>
  fromCurrentTaskRunAttemptAggregate(candidate, "legacy_definition_v1").pipe(
    Result.flatMap((persisted) => encodeTaskRunAttemptAggregateV1(
      persisted.aggregate,
    )),
    Result.flatMap(decodeTaskRunAttemptAggregateV1),
    Result.map((aggregate) => toCurrentTaskRunAttemptAggregate({
      generation: "legacy_definition_v1",
      aggregate,
    })),
    Result.mapError(() => new InvalidRunAttemptTransitionError({
      operation,
      runId: candidate.runId,
      phase: candidate.phase,
      reason: "next_state_invalid",
    })),
  );

function applicationDecisionInput(
  input: ApplicationTaskSystemRunAttemptDecisionInputV1,
  operation: RunAttemptMutationOperationV1,
): Result.Result<CurrentDecisionInput, InvalidRunAttemptTransitionError> {
  const validateCandidate = makeApplicationCandidateValidator(operation);
  const current = toCurrentTaskRunAttemptAggregate({
    generation: "application_v1",
    aggregate: input.current,
  });
  return fromCurrentTaskRunAttemptAggregate(current, "application_v1").pipe(
    Result.map((persisted) => toCurrentTaskRunAttemptAggregate(persisted)),
    Result.mapError(() => new InvalidRunAttemptTransitionError({
      operation,
      runId: current.runId,
      phase: current.phase,
      reason: "next_state_invalid",
    })),
    Result.map((ownedCurrent) => ({
      databaseNowMs: input.databaseNowMs,
      get attemptGrantCandidate() {
        return input.attemptGrantCandidate;
      },
      current: ownedCurrent,
      validateCandidate,
    })),
  );
}

const makeApplicationCandidateValidator = (
  operation: RunAttemptMutationOperationV1,
): CurrentAggregateCandidateValidator => (candidate) => fromCurrentTaskRunAttemptAggregate(
    candidate,
    "application_v1",
  ).pipe(
    Result.flatMap((persisted) => encodeApplicationTaskRunAttemptAggregateV1(
      persisted.aggregate,
    )),
    Result.flatMap(decodeApplicationTaskRunAttemptAggregateV1),
    Result.map((aggregate) => toCurrentTaskRunAttemptAggregate({
      generation: "application_v1",
      aggregate,
    })),
    Result.mapError(() => new InvalidRunAttemptTransitionError({
      operation,
      runId: candidate.runId,
      phase: candidate.phase,
      reason: "next_state_invalid",
    })),
  );

function persistLegacyDecision<
  Operation extends TaskLifecycleDecisionOperation,
>(
  operation: Operation,
  result: Result.Result<
    CurrentTaskRunAttemptDecision<
      CurrentTaskLifecycleOutcomeByOperation[Operation]
    >,
    RunAttemptDecisionErrorV1
  >,
): Result.Result<
  TaskRunAttemptDecisionV1<LegacyTaskLifecycleOutcomeByOperation[Operation]>,
  RunAttemptDecisionErrorV1
> {
  return result.pipe(Result.map((decision) =>
    Result.getOrThrow(fromCurrentTaskRunAttemptDecisionToLegacy(
      operation,
      decision,
    ))));
}

function persistApplicationDecision<
  Operation extends TaskLifecycleDecisionOperation,
>(
  operation: Operation,
  result: Result.Result<
    CurrentTaskRunAttemptDecision<
      CurrentTaskLifecycleOutcomeByOperation[Operation]
    >,
    RunAttemptDecisionErrorV1
  >,
): Result.Result<
  ApplicationTaskRunAttemptDecisionV1<
    ApplicationTaskLifecycleOutcomeByOperation[Operation]
  >,
  RunAttemptDecisionErrorV1
> {
  return result.pipe(Result.map((decision) =>
    Result.getOrThrow(fromCurrentTaskRunAttemptDecisionToApplication(
      operation,
      decision,
    ))));
}

export function decideStartAttemptV1(
  command: StartAttemptCommandV1,
  input: TaskSystemRunAttemptDecisionInputV1,
): Result.Result<TaskRunAttemptDecisionV1<StartAttemptOutcomeV1>, RunAttemptDecisionErrorV1> {
  return persistLegacyDecision(
    "start_attempt",
    decideStartAttemptCore(command, legacyDecisionInput(input, "start_attempt")),
  );
}

export function decideApplicationStartAttemptV1(
  command: StartAttemptCommandV1,
  input: ApplicationTaskSystemRunAttemptDecisionInputV1,
): Result.Result<
  ApplicationTaskRunAttemptDecisionV1<ApplicationStartAttemptOutcomeV1>,
  RunAttemptDecisionErrorV1
> {
  return persistApplicationDecision(
    "start_attempt",
    applicationDecisionInput(input, "start_attempt").pipe(
      Result.flatMap((admitted) => decideStartAttemptCore(command, admitted)),
    ),
  );
}

export function decideHeartbeatAttemptV1(
  command: HeartbeatAttemptCommandV1,
  input: TaskSystemRunAttemptDecisionInputV1,
): Result.Result<TaskRunAttemptDecisionV1<HeartbeatAttemptOutcomeV1>, RunAttemptDecisionErrorV1> {
  return persistLegacyDecision("heartbeat_attempt", decideHeartbeatAttemptCore(
    command,
    legacyDecisionInput(input, "heartbeat_attempt"),
  ));
}

export function decideApplicationHeartbeatAttemptV1(
  command: HeartbeatAttemptCommandV1,
  input: ApplicationTaskSystemRunAttemptDecisionInputV1,
): Result.Result<
  ApplicationTaskRunAttemptDecisionV1<ApplicationHeartbeatAttemptOutcomeV1>,
  RunAttemptDecisionErrorV1
> {
  return persistApplicationDecision(
    "heartbeat_attempt",
    applicationDecisionInput(input, "heartbeat_attempt").pipe(
      Result.flatMap((admitted) => decideHeartbeatAttemptCore(command, admitted)),
    ),
  );
}

export function decideCompleteAttemptV1(
  command: CompleteAttemptCommandV1,
  input: TaskSystemRunAttemptDecisionInputV1,
): Result.Result<TaskRunAttemptDecisionV1<CompleteAttemptOutcomeV1>, RunAttemptDecisionErrorV1> {
  return persistLegacyDecision("complete_attempt", decideCompleteAttemptCore(
    command,
    legacyDecisionInput(input, "complete_attempt"),
  ));
}

export function decideApplicationCompleteAttemptV1(
  command: CompleteAttemptCommandV1,
  input: ApplicationTaskSystemRunAttemptDecisionInputV1,
): Result.Result<
  ApplicationTaskRunAttemptDecisionV1<ApplicationCompleteAttemptOutcomeV1>,
  RunAttemptDecisionErrorV1
> {
  return persistApplicationDecision(
    "complete_attempt",
    applicationDecisionInput(input, "complete_attempt").pipe(
      Result.flatMap((admitted) => decideCompleteAttemptCore(command, admitted)),
    ),
  );
}

export function decideRequestCancellationV1(
  command: RequestCancellationCommandV1,
  input: TaskSystemRunAttemptDecisionInputV1,
): Result.Result<TaskRunAttemptDecisionV1<RequestCancellationOutcomeV1>, RunAttemptDecisionErrorV1> {
  return persistLegacyDecision("request_cancellation", decideRequestCancellationCore(
    command,
    legacyDecisionInput(input, "request_cancellation"),
  ));
}

export function decideApplicationRequestCancellationV1(
  command: RequestCancellationCommandV1,
  input: ApplicationTaskSystemRunAttemptDecisionInputV1,
): Result.Result<
  ApplicationTaskRunAttemptDecisionV1<ApplicationRequestCancellationOutcomeV1>,
  RunAttemptDecisionErrorV1
> {
  return persistApplicationDecision(
    "request_cancellation",
    applicationDecisionInput(input, "request_cancellation").pipe(
      Result.flatMap((admitted) => decideRequestCancellationCore(command, admitted)),
    ),
  );
}

export function decideHandleLeaseExpiryV1(
  command: HandleLeaseExpiryCommandV1,
  input: TaskSystemRunAttemptDecisionInputV1,
): Result.Result<TaskRunAttemptDecisionV1<HandleLeaseExpiryOutcomeV1>, RunAttemptDecisionErrorV1> {
  return persistLegacyDecision("handle_lease_expiry", decideHandleLeaseExpiryCore(
    command,
    legacyDecisionInput(input, "handle_lease_expiry"),
  ));
}

export function decideApplicationHandleLeaseExpiryV1(
  command: HandleLeaseExpiryCommandV1,
  input: ApplicationTaskSystemRunAttemptDecisionInputV1,
): Result.Result<
  ApplicationTaskRunAttemptDecisionV1<ApplicationHandleLeaseExpiryOutcomeV1>,
  RunAttemptDecisionErrorV1
> {
  return persistApplicationDecision(
    "handle_lease_expiry",
    applicationDecisionInput(input, "handle_lease_expiry").pipe(
      Result.flatMap((admitted) => decideHandleLeaseExpiryCore(command, admitted)),
    ),
  );
}

/**
 * Constructs one lifecycle-free, scope-bound lifecycle value. Several scope
 * instances may coexist, so persistence composition may use this factory
 * without installing a process-global store service.
 */
export function makeRunAttemptLifecycleV1(
  store: TaskSystemRunAttemptStoreShape,
): RunAttemptLifecycleShape {
  const transactRunAttempt = store.transactRunAttempt;
  const inspectRunAttempt = store.inspectRunAttempt;
  return RunAttemptLifecycle.of({
    startAttempt: Effect.fn("RunAttemptLifecycle.startAttempt")(
      (command) => transactRunAttempt({
        operation: "start_attempt", runId: command.runId,
        decide: (input) => decideStartAttemptV1(command, input),
      }),
    ),
    heartbeatAttempt: Effect.fn("RunAttemptLifecycle.heartbeatAttempt")(
      (command) => transactRunAttempt({
        operation: "heartbeat_attempt", runId: command.runId,
        decide: (input) => decideHeartbeatAttemptV1(command, input),
      }),
    ),
    completeAttempt: Effect.fn("RunAttemptLifecycle.completeAttempt")(
      (command) => transactRunAttempt({
        operation: "complete_attempt", runId: command.runId,
        decide: (input) => decideCompleteAttemptV1(command, input),
      }),
    ),
    requestCancellation: Effect.fn("RunAttemptLifecycle.requestCancellation")(
      (command) => transactRunAttempt({
        operation: "request_cancellation", runId: command.runId,
        decide: (input) => decideRequestCancellationV1(command, input),
      }),
    ),
    handleLeaseExpiry: Effect.fn("RunAttemptLifecycle.handleLeaseExpiry")(
      (command) => transactRunAttempt({
        operation: "handle_lease_expiry", runId: command.runId,
        decide: (input) => decideHandleLeaseExpiryV1(command, input),
      }),
    ),
    inspectCurrentAttempt: Effect.fn("RunAttemptLifecycle.inspectCurrentAttempt")(
      function* (command) {
        const snapshot = yield* inspectRunAttempt({
          operation: "inspect_current_attempt", runId: command.runId,
        });
        return projectRunAttemptInspectionV1(snapshot.observedAtMs, snapshot.current);
      },
    ),
  });
}

export const RunAttemptLifecycleLive = Layer.effect(
  RunAttemptLifecycle,
  Effect.gen(function* () {
    return makeRunAttemptLifecycleV1(yield* TaskSystemRunAttemptStore);
  }),
);
