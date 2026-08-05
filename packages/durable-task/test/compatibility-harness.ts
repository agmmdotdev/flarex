import { Brand, Result } from "effect";
import {
  ConflictingTaskAttemptCompletionError,
  InvalidTaskCancellationAcknowledgementError,
  TaskRunAttemptCounterExhaustedError,
  TaskSystemRunAttemptCorruptionError,
  TaskSystemRunAttemptTerminalStoreError,
  TaskSystemRunAttemptTransientStoreError,
  TaskSystemRunAttemptUnavailableError,
  type RunAttemptDecisionErrorV1,
  type RunAttemptLifecycleErrorV1,
} from "../src/runAttempt/Errors.js";
import {
  decideCompleteAttemptV1,
  decideHandleLeaseExpiryV1,
  decideHeartbeatAttemptV1,
  decideRequestCancellationV1,
  decideStartAttemptV1,
} from "../src/runAttempt/Layers/RunAttemptLifecycleLive.js";
import type {
  TaskAttemptCompletionV1,
  TaskAttemptGrantCandidateV1,
  TaskDatabaseTimeMsV1,
  TaskExecutionFailureV1,
  PersistedTaskRequestedEffectV1,
  RunAttemptCommandV1,
  TaskRunAttemptAggregateV1,
  TaskRunAttemptDecisionV1,
  TaskRunAttemptEvidenceV1,
  TaskRunAttemptBoundPolicyV1,
  RunAttemptStateV1,
} from "../src/runAttempt/Model.js";
import { projectRunAttemptInspectionV1 } from "../src/runAttempt/Model.js";
import {
  decodeRunAttemptCommandV1,
  decodeTaskRunAttemptAggregateV1,
  encodeTaskRunAttemptAggregateV1,
} from "../src/runAttempt/Schema.js";
import {
  ATTEMPT_ID,
  ATTEMPT_NUMBER_1,
  COMPUTE_LARGE,
  COMPUTE_SMALL,
  DEFINITION_ID,
  FENCE_1,
  JITTER,
  LEASE_VERSION_1,
  NOW,
  POLICY,
  RUN_ID,
  activeAggregate,
  aggregateBase,
  attemptId,
  attemptNumber,
  cancellationGeneration,
  databaseTime,
  duration,
  effectSequence,
  fence,
  heartbeatSequence,
  leaseVersion,
  readyAggregate,
  runId,
  runVersion,
  committedDecision,
} from "./support.js";

export interface CompatibilityExpectedV1 {
  readonly kind: "receipt" | "error";
  readonly disposition?: "accepted" | "current" | "idempotent";
  readonly outcomeKind?: string;
  readonly currentReason?: string | null;
  readonly transition: string | null;
  readonly acceptedRunVersion: number | null;
  readonly recordedAtMs: number | null;
  readonly evidenceKinds: readonly string[];
  readonly effects: ReadonlyArray<{ readonly sequence: number; readonly kind: string }>;
  readonly policy?: Readonly<Record<string, unknown>> | null;
  readonly errorTag?: string;
  readonly safeReason?: string;
}

export interface CompatibilityVectorV1 {
  readonly id: string;
  readonly input: {
    readonly databaseNowMs: number;
    readonly retryRandomize: boolean;
  };
  readonly initial: {
    readonly phase: string;
    readonly cancellation: string;
    readonly runVersion: number;
    readonly stateVariant?: string;
  };
  readonly command: { readonly operation: string; readonly identity: string };
  readonly expected: CompatibilityExpectedV1;
}

export interface CompatibilityEffectCursorCaseV1 {
  readonly scenarioId: string;
  readonly priorEffectCursor: number;
  readonly resultingEffectCursor: number;
}

export interface CompatibilityInspectionProjectionV1 {
  readonly version: string;
  readonly observedAtMs: number;
  readonly stateVersion: string;
  readonly runId: string;
  readonly taskDefinitionRevisionId: string;
  readonly runVersion: number;
  readonly phase: string;
  readonly stateVariant: string;
  readonly cancellationKind: string;
  readonly cancellationGeneration: number;
  readonly attemptNumber: number | null;
  readonly leaseVersion: number | null;
  readonly heartbeatSequence: number | null;
  readonly eligibleAtMs: number | null;
  readonly retryNotBeforeMs: number | null;
  readonly retryCause: string | null;
  readonly terminalKind: string | null;
  readonly cancellationResolution: string | null;
  readonly resultCommitment: string | null;
  readonly failureClass: string | null;
}

export interface CompatibilityInspectionCaseV1 {
  readonly id: string;
  readonly projection: CompatibilityInspectionProjectionV1;
}

export interface CompatibilityActualV1 {
  readonly kind: "receipt" | "error";
  readonly disposition?: "accepted" | "current" | "idempotent";
  readonly outcomeKind?: string;
  readonly currentReason?: string | null;
  readonly transition: string | null;
  readonly acceptedRunVersion: number | null;
  readonly recordedAtMs: number | null;
  readonly evidenceKinds: readonly string[];
  readonly effects: ReadonlyArray<{ readonly sequence: number; readonly kind: string }>;
  readonly policy?: Readonly<Record<string, unknown>> | null;
  readonly errorTag?: string;
  readonly safeReason?: string;
}

export interface ExecutedVectorV1 {
  readonly actual: CompatibilityActualV1;
  readonly next: TaskRunAttemptAggregateV1 | null;
}

export type CompatibilityLifecycleCommandV1 = Exclude<
  RunAttemptCommandV1,
  { readonly type: "inspect_current_attempt" }
>;

export interface PreparedCompatibilityVectorV1 {
  readonly vector: CompatibilityVectorV1;
  readonly current: TaskRunAttemptAggregateV1;
  readonly command: CompatibilityLifecycleCommandV1 | null;
  readonly execution: ExecutedVectorV1;
  readonly boundary: "task_system_store" | "command_decoder";
  readonly persistence: CompatibilityPersistenceStateV1 | null;
}

export interface CompatibilityLifecycleCommitV1 {
  readonly operation: CompatibilityLifecycleCommandV1["type"];
  readonly next: TaskRunAttemptAggregateV1;
  readonly requestedEffects: readonly PersistedTaskRequestedEffectV1[];
}

export interface CompatibilityPersistenceStateV1 {
  readonly current: TaskRunAttemptAggregateV1;
  readonly history: readonly CompatibilityLifecycleCommitV1[];
}

const ATTEMPT_ID_2 = attemptId("attempt_00000000-0000-4000-8000-000000000002");
const ATTEMPT_ID_3 = attemptId("attempt_00000000-0000-4000-8000-000000000003");
const FENCE_2 = fence(2n);
const FENCE_3 = fence(3n);
const MAX_COUNTER = 9_223_372_036_854_775_807n;

interface MutableCompatibilityHistoryV1 {
  readonly current: TaskRunAttemptAggregateV1;
  readonly history: readonly CompatibilityLifecycleCommitV1[];
}

function observedAt(vector: CompatibilityVectorV1): TaskDatabaseTimeMsV1 {
  return databaseTime(vector.input.databaseNowMs);
}

function policyFor(vector: CompatibilityVectorV1): TaskRunAttemptBoundPolicyV1 {
  const threshold = vector.id === "retry-delay-at-durable-threshold";
  const oomDisabled = vector.id === "oom-escalation-disabled";
  return {
    runAttempt: {
      ...POLICY,
      retry: {
        ...POLICY.retry,
        minTimeoutInMs: threshold ? duration(5_000) : POLICY.retry.minTimeoutInMs,
        randomize: vector.input.retryRandomize,
      },
      outOfMemory: oomDisabled ? { kind: "disabled" } : POLICY.outOfMemory,
    },
    maximumDurationMs: duration(300_000),
    initialComputeProfile: COMPUTE_SMALL,
    leaseDurationMs: duration(30_000),
    immediateRetryThresholdMs: duration(5_000),
  };
}

function retryWaitingAggregate(vector: CompatibilityVectorV1, priorEffectCursor: bigint): TaskRunAttemptAggregateV1 {
  const now = observedAt(vector);
  const due = vector.id !== "start-before-eligibility";
  const acceptedAtMs = databaseTime(now - (due ? 6_000 : 5_999));
  const current = {
    ...activeAggregate({
    phase: "executing",
    runVersion: runVersion(BigInt(vector.initial.runVersion) - 1n),
    lease: leaseVersion(2n),
    leaseExpiresAt: databaseTime(acceptedAtMs + 30_000),
    leaseRenewedAt: acceptedAtMs,
    grantedAt: acceptedAtMs,
    effectCursor: priorEffectCursor - 5n,
    boundPolicy: policyFor(vector),
    heartbeat: heartbeatSequence(1),
    }),
    createdAtMs: acceptedAtMs,
  };
  const decision = committedDecision(decideCompleteAttemptV1({
    type: "complete_attempt",
    runId: RUN_ID,
    attemptId: ATTEMPT_ID,
    executionFence: FENCE_1,
    completion: {
      kind: "failed",
      failure: { kind: "task_failure", code: "handler_failed", message: null },
      retry: { kind: "override_delay", delayMs: duration(6_000) },
      executionDurationMs: null,
    },
  }, { databaseNowMs: acceptedAtMs, current, attemptGrantCandidate: null }));
  return {
    ...decision.next,
    createdAtMs: databaseTime(Math.min(Number(decision.next.createdAtMs), Number(acceptedAtMs))),
  };
}

function simpleTerminalAggregate(vector: CompatibilityVectorV1, priorEffectCursor: bigint): TaskRunAttemptAggregateV1 {
  const now = observedAt(vector);
  const current = activeAggregate({
    phase: "executing",
    runVersion: runVersion(BigInt(vector.initial.runVersion) - 1n),
    lease: leaseVersion(2n),
    leaseExpiresAt: databaseTime(now + 30_000),
    leaseRenewedAt: now,
    grantedAt: now,
    effectCursor: priorEffectCursor - 4n,
    boundPolicy: policyFor(vector),
    heartbeat: heartbeatSequence(1),
  });
  return committedDecision(decideCompleteAttemptV1({
    type: "complete_attempt",
    runId: RUN_ID,
    attemptId: ATTEMPT_ID,
    executionFence: FENCE_1,
    completion: { kind: "succeeded", result: null, executionDurationMs: null },
  }, { databaseNowMs: now, current, attemptGrantCandidate: null })).next;
}

function activeFor(vector: CompatibilityVectorV1, priorEffectCursor: bigint): TaskRunAttemptAggregateV1 {
  const now = observedAt(vector);
  const maximumAttempt = vector.id.includes("attempt-limit") || vector.id.includes("maximum-attempt");
  const staleAttempt = vector.id.includes("stale-attempt");
  const secondAttempt = vector.id === "immediate-retry-followup-success"
    || staleAttempt
    || vector.command.identity.startsWith("attempt-2");
  const number = maximumAttempt ? attemptNumber(3) : secondAttempt ? attemptNumber(2) : ATTEMPT_NUMBER_1;
  const id = maximumAttempt ? ATTEMPT_ID_3 : secondAttempt ? ATTEMPT_ID_2 : ATTEMPT_ID;
  const executionFence = maximumAttempt ? FENCE_3 : vector.id.includes("stale-fence") ? FENCE_2 : secondAttempt ? FENCE_2 : FENCE_1;
  const expiryOperation = vector.command.operation === "handleLeaseExpiry";
  const expired = expiryOperation && !vector.id.includes("before-deadline") && !vector.id.includes("stale-") && !vector.id.includes("inactive");
  const atDeadline = vector.id.includes("at-lease-deadline");
  const leaseExpiresAt = atDeadline
    ? now
    : expired
      ? databaseTime(now - 1)
      : databaseTime(now + 30_000);
  const targetLease = maximumAttempt
    ? leaseVersion(4n)
    : vector.id === "pending-cancellation-lease-expiry"
      ? leaseVersion(3n)
      : vector.initial.phase === "attempt_granted"
        ? LEASE_VERSION_1
        : leaseVersion(2n);
  const targetVersion = runVersion(BigInt(vector.initial.runVersion));
  const boundPolicy = policyFor(vector);
  const computeProfile = vector.id === "oom-target-not-different" ? COMPUTE_LARGE : COMPUTE_SMALL;
  const lifecycleAtMs = databaseTime(leaseExpiresAt - 30_000);

  if (vector.initial.phase === "attempt_granted") {
    const previousAttemptNumber = Number(number) - 1;
    const predecessor = previousAttemptNumber === 0
      ? {
          ...aggregateBase(runVersion(targetVersion - 1n), {
            effectCursor: priorEffectCursor - 4n,
            boundPolicy,
          }),
          phase: "ready" as const,
          ready: { kind: "initial" as const, eligibleAtMs: lifecycleAtMs },
          cancellation: { kind: "not_requested" as const, generation: cancellationGeneration(0n) },
        }
      : {
          ...aggregateBase(runVersion(targetVersion - 1n), {
            attemptNo: attemptNumber(previousAttemptNumber),
            lease: leaseVersion(BigInt(targetLease) - 1n),
            effectCursor: priorEffectCursor - 4n,
            boundPolicy,
          }),
          phase: "ready" as const,
          ready: {
            kind: "immediate_retry" as const,
            eligibleAtMs: lifecycleAtMs,
            acceptedRetry: {
              previousAttempt: {
                attemptId: previousAttemptNumber === 1 ? ATTEMPT_ID : ATTEMPT_ID_2,
                attemptNumber: attemptNumber(previousAttemptNumber),
                executionFence: previousAttemptNumber === 1 ? FENCE_1 : FENCE_2,
              },
              acceptedAtMs: lifecycleAtMs,
              notBeforeMs: lifecycleAtMs,
              nextComputeProfile: computeProfile,
              cause: {
                kind: "failed_completion" as const,
                failure: { kind: "task_failure" as const, code: "handler_failed" as const, message: null },
              },
            },
          },
          cancellation: { kind: "not_requested" as const, generation: cancellationGeneration(0n) },
        };
    const startCurrent = {
      ...predecessor,
      createdAtMs: databaseTime(Math.min(Number(predecessor.createdAtMs), Number(lifecycleAtMs))),
    };
    const started = committedDecision(decideStartAttemptV1({
      type: "start_attempt",
      runId: RUN_ID,
      expectedRunVersion: predecessor.runVersion,
      retryJitter: JITTER,
    }, {
      databaseNowMs: lifecycleAtMs,
      current: startCurrent,
      attemptGrantCandidate: { attemptId: id, attemptNumber: number, executionFence },
    }));
    return {
      ...started.next,
      createdAtMs: databaseTime(Math.min(Number(started.next.createdAtMs), Number(lifecycleAtMs))),
    };
  }

  if (vector.initial.cancellation === "requested") {
    const predecessor = {
      ...activeAggregate({
      phase: "executing",
      attempt: id,
      attemptNo: number,
      executionFence,
      runVersion: runVersion(targetVersion - 1n),
      lease: targetLease,
      leaseExpiresAt,
      leaseRenewedAt: lifecycleAtMs,
      grantedAt: lifecycleAtMs,
      effectCursor: priorEffectCursor - 3n,
      computeProfile,
      boundPolicy,
      heartbeat: heartbeatSequence(1),
      }),
      createdAtMs: databaseTime(Math.min(Number(NOW), Number(lifecycleAtMs))),
    };
    const requested = committedDecision(decideRequestCancellationV1({
      type: "request_cancellation",
      runId: RUN_ID,
      reason: { code: "requested", message: null },
    }, { databaseNowMs: now, current: predecessor, attemptGrantCandidate: null }));
    return {
      ...requested.next,
      createdAtMs: databaseTime(Math.min(Number(requested.next.createdAtMs), Number(lifecycleAtMs))),
    };
  }

  const heartbeatPredecessor = {
    ...activeAggregate({
    phase: "attempt_granted",
    attempt: id,
    attemptNo: number,
    executionFence,
    runVersion: runVersion(targetVersion - 1n),
    lease: leaseVersion(BigInt(targetLease) - 1n),
    leaseExpiresAt: databaseTime(lifecycleAtMs + 1),
    leaseRenewedAt: databaseTime(lifecycleAtMs - 29_999),
    grantedAt: databaseTime(lifecycleAtMs - 29_999),
    effectCursor: priorEffectCursor - 4n,
    computeProfile,
    boundPolicy,
    }),
    createdAtMs: databaseTime(Math.min(Number(NOW), Number(lifecycleAtMs - 29_999))),
  };
  const heartbeat = committedDecision(decideHeartbeatAttemptV1({
    type: "heartbeat_attempt",
    runId: RUN_ID,
    attemptId: id,
    executionFence,
    heartbeatSequence: heartbeatSequence(vector.id === "heartbeat-sequence-not-advanced" ? 2 : 1),
  }, { databaseNowMs: lifecycleAtMs, current: heartbeatPredecessor, attemptGrantCandidate: null }));
  return {
    ...heartbeat.next,
    createdAtMs: databaseTime(Math.min(Number(heartbeat.next.createdAtMs), Number(lifecycleAtMs - 29_999))),
  };
}

function defaultPriorEffectCursor(vector: CompatibilityVectorV1): bigint {
  if (vector.initial.phase === "ready") return 0n;
  if (vector.initial.phase === "attempt_granted") return 4n;
  if (vector.initial.phase === "retry_waiting") return 13n;
  if (vector.initial.phase === "terminal") return 12n;
  return vector.initial.cancellation === "requested" ? 14n : 8n;
}

function ordinaryInitial(vector: CompatibilityVectorV1, priorEffectCursor: bigint): TaskRunAttemptAggregateV1 {
  switch (vector.initial.phase) {
    case "ready": {
      const aggregate = readyAggregate(runVersion(BigInt(vector.initial.runVersion)));
      const cursor = vector.id === "effect-sequence-overflow-rejected"
        ? MAX_COUNTER - 2n
        : priorEffectCursor;
      return {
        ...aggregate,
        boundPolicy: policyFor(vector),
        requestedEffectCursor: cursor === 0n
          ? { kind: "none" }
          : { kind: "issued", lastSequence: effectSequence(cursor) },
      };
    }
    case "retry_waiting":
      return retryWaitingAggregate(vector, priorEffectCursor);
    case "attempt_granted":
    case "executing":
      return activeFor(vector, priorEffectCursor);
    case "terminal":
      return simpleTerminalAggregate(vector, priorEffectCursor);
    default:
      throw new Error(`unsupported admitted phase for ${vector.id}`);
  }
}

function appendCompatibilityCommit<Outcome>(
  state: MutableCompatibilityHistoryV1,
  operation: CompatibilityLifecycleCommandV1["type"],
  result: Result.Result<
    TaskRunAttemptDecisionV1<Outcome>,
    RunAttemptDecisionErrorV1
  >,
): MutableCompatibilityHistoryV1 {
  const decision = committedDecision(result);
  return appendCompatibilityDecision(state, operation, decision);
}

function appendCompatibilityDecision<Outcome>(
  state: MutableCompatibilityHistoryV1,
  operation: CompatibilityLifecycleCommandV1["type"],
  decision: Extract<
    TaskRunAttemptDecisionV1<Outcome>,
    { readonly kind: "commit" }
  >,
): MutableCompatibilityHistoryV1 {
  return {
    current: decision.next,
    history: Object.freeze([
      ...state.history,
      Object.freeze({
        operation,
        next: decision.next,
        requestedEffects: decision.requestedEffects,
      }),
    ]),
  };
}

function transitionReadyState(
  vector: CompatibilityVectorV1,
  eligibleAtMs: TaskDatabaseTimeMsV1,
): MutableCompatibilityHistoryV1 {
  const ready = readyAggregate();
  if (ready.phase !== "ready") {
    throw new Error("compatibility initial aggregate is not ready");
  }
  return {
    current: {
      ...ready,
      createdAtMs: eligibleAtMs,
      boundPolicy: policyFor(vector),
      ready: { kind: "initial", eligibleAtMs },
    },
    history: Object.freeze([]),
  };
}

function appendStartTransition(
  state: MutableCompatibilityHistoryV1,
  databaseNowMs: TaskDatabaseTimeMsV1,
): MutableCompatibilityHistoryV1 {
  return appendCompatibilityCommit(
    state,
    "start_attempt",
    decideStartAttemptV1({
      type: "start_attempt",
      runId: RUN_ID,
      expectedRunVersion: state.current.runVersion,
      retryJitter: JITTER,
    }, {
      databaseNowMs,
      current: state.current,
      attemptGrantCandidate: candidateFor(state.current),
    }),
  );
}

function appendHeartbeatTransition(
  state: MutableCompatibilityHistoryV1,
  databaseNowMs: TaskDatabaseTimeMsV1,
  sequence: number,
): MutableCompatibilityHistoryV1 {
  if (
    state.current.phase !== "attempt_granted"
    && state.current.phase !== "executing"
  ) {
    throw new Error("compatibility heartbeat history is not active");
  }
  return appendCompatibilityCommit(
    state,
    "heartbeat_attempt",
    decideHeartbeatAttemptV1({
      type: "heartbeat_attempt",
      runId: RUN_ID,
      attemptId: state.current.currentAttempt.attemptId,
      executionFence: state.current.currentAttempt.executionFence,
      heartbeatSequence: heartbeatSequence(sequence),
    }, {
      databaseNowMs,
      current: state.current,
      attemptGrantCandidate: null,
    }),
  );
}

function appendCompletionTransition(
  state: MutableCompatibilityHistoryV1,
  databaseNowMs: TaskDatabaseTimeMsV1,
  completion: TaskAttemptCompletionV1,
): MutableCompatibilityHistoryV1 {
  if (
    state.current.phase !== "attempt_granted"
    && state.current.phase !== "executing"
  ) {
    throw new Error("compatibility completion history is not active");
  }
  return appendCompatibilityCommit(
    state,
    "complete_attempt",
    decideCompleteAttemptV1({
      type: "complete_attempt",
      runId: RUN_ID,
      attemptId: state.current.currentAttempt.attemptId,
      executionFence: state.current.currentAttempt.executionFence,
      completion,
    }, {
      databaseNowMs,
      current: state.current,
      attemptGrantCandidate: null,
    }),
  );
}

function appendCancellationTransition(
  state: MutableCompatibilityHistoryV1,
  databaseNowMs: TaskDatabaseTimeMsV1,
): MutableCompatibilityHistoryV1 {
  return appendCompatibilityCommit(
    state,
    "request_cancellation",
    decideRequestCancellationV1({
      type: "request_cancellation",
      runId: RUN_ID,
      reason: { code: "requested", message: null },
    }, {
      databaseNowMs,
      current: state.current,
      attemptGrantCandidate: null,
    }),
  );
}

function activeHistoryFinalHeartbeatAt(
  vector: CompatibilityVectorV1,
): TaskDatabaseTimeMsV1 {
  const now = observedAt(vector);
  if (vector.id.includes("at-lease-deadline")) {
    return databaseTime(now - 30_000);
  }
  if (
    vector.command.operation !== "handleLeaseExpiry"
    || vector.id.includes("inactive")
    || vector.id.includes("stale-")
  ) {
    return databaseTime(now - 1_000);
  }
  if (vector.id.includes("before-deadline")) return databaseTime(now);
  return databaseTime(now - 30_001);
}

function transitionDerivedOrdinaryState(
  vector: CompatibilityVectorV1,
  priorEffectCursor: bigint,
): CompatibilityPersistenceStateV1 | null {
  if (vector.id === "effect-sequence-overflow-rejected") return null;
  const targetRunVersion = BigInt(vector.initial.runVersion);
  const now = observedAt(vector);
  let state: MutableCompatibilityHistoryV1;

  if (vector.initial.phase === "ready") {
    state = transitionReadyState(vector, databaseTime(now - 1));
  } else if (vector.initial.phase === "attempt_granted") {
    const startAt = databaseTime(
      vector.command.operation === "handleLeaseExpiry"
        && !vector.id.includes("before-deadline")
        ? now - 30_001
        : now - 2_000,
    );
    state = appendStartTransition(transitionReadyState(vector, startAt), startAt);
    if (targetRunVersion === 5n) {
      state = appendHeartbeatTransition(state, databaseTime(now - 1_500), 1);
      state = appendCompletionTransition(state, databaseTime(now - 1_000), {
        kind: "failed",
        failure: {
          kind: "task_failure",
          code: "handler_failed",
          message: null,
        },
        retry: { kind: "use_bound_policy" },
        executionDurationMs: null,
      });
      if (
        state.current.phase !== "ready"
        || state.current.ready.kind !== "immediate_retry"
      ) return null;
      state = appendStartTransition(state, state.current.ready.eligibleAtMs);
    }
  } else if (vector.initial.phase === "executing") {
    const requested = vector.initial.cancellation === "requested";
    const heartbeatCount = Number(targetRunVersion - (requested ? 3n : 2n));
    if (heartbeatCount < 1 || heartbeatCount > 8) return null;
    const finalHeartbeatAt = activeHistoryFinalHeartbeatAt(vector);
    const startAt = databaseTime(finalHeartbeatAt - heartbeatCount - 1);
    state = appendStartTransition(transitionReadyState(vector, startAt), startAt);
    for (let index = 1; index <= heartbeatCount; index += 1) {
      state = appendHeartbeatTransition(
        state,
        databaseTime(finalHeartbeatAt - heartbeatCount + index),
        vector.id === "heartbeat-sequence-not-advanced" ? index + 1 : index,
      );
    }
    if (requested) state = appendCancellationTransition(state, databaseTime(now - 1));
  } else if (vector.initial.phase === "retry_waiting") {
    const completeAt = databaseTime(
      now - (vector.id === "start-before-eligibility" ? 5_999 : 6_000),
    );
    const heartbeatAt = databaseTime(completeAt - 1);
    const startAt = databaseTime(heartbeatAt - 1);
    state = appendStartTransition(transitionReadyState(vector, startAt), startAt);
    state = appendHeartbeatTransition(state, heartbeatAt, 1);
    state = appendCompletionTransition(state, completeAt, {
      kind: "failed",
      failure: { kind: "task_failure", code: "handler_failed", message: null },
      retry: { kind: "override_delay", delayMs: duration(6_000) },
      executionDurationMs: null,
    });
  } else if (vector.initial.phase === "terminal") {
    const completeAt = databaseTime(now - 1);
    const heartbeatAt = databaseTime(completeAt - 1);
    const startAt = databaseTime(heartbeatAt - 1);
    state = appendStartTransition(transitionReadyState(vector, startAt), startAt);
    state = appendHeartbeatTransition(state, heartbeatAt, 1);
    state = appendCompletionTransition(state, completeAt, {
      kind: "succeeded",
      result: null,
      executionDurationMs: null,
    });
  } else {
    return null;
  }

  const cursor = state.current.requestedEffectCursor.kind === "none"
    ? 0n
    : state.current.requestedEffectCursor.lastSequence;
  if (
    state.current.phase !== vector.initial.phase
    || state.current.runVersion !== targetRunVersion
    || cursor !== priorEffectCursor
    || state.current.cancellation.kind !== vector.initial.cancellation
  ) return null;
  return Object.freeze({
    current: state.current,
    history: Object.freeze([...state.history]),
  });
}

function candidateFor(current: TaskRunAttemptAggregateV1): TaskAttemptGrantCandidateV1 {
  const next = current.attemptHistory.kind === "none"
    ? 1
    : Number(current.attemptHistory.lastAttemptNumber) + 1;
  return {
    attemptId: next === 1 ? ATTEMPT_ID : next === 2 ? ATTEMPT_ID_2 : ATTEMPT_ID_3,
    attemptNumber: attemptNumber(next),
    executionFence: next === 1 ? FENCE_1 : next === 2 ? FENCE_2 : FENCE_3,
  };
}

function failureFor(identity: string): TaskExecutionFailureV1 {
  if (identity.includes("oom")) return { kind: "resource_exhaustion", code: "out_of_memory", message: null };
  if (identity.includes("platform-failure")) return { kind: "system_failure", code: "provider_failure", message: null };
  if (identity.includes("nonretryable") || identity.includes("same-identity")) {
    return {
      kind: "system_failure",
      code: "configuration_invalid",
      message: identity.includes("same-identity")
        ? Brand.nominal<import("../src/runAttempt/Model.js").TaskFailureMessageV1>()("redelivered diagnostic")
        : null,
    };
  }
  return { kind: "task_failure", code: "handler_failed", message: null };
}

function completionFor(vector: CompatibilityVectorV1): TaskAttemptCompletionV1 {
  const identity = vector.command.identity;
  if (identity.includes("cancel-generation")) {
    return {
      kind: "cancellation_acknowledged",
      cancellationGeneration: cancellationGeneration(identity.endsWith("2") ? 2n : 1n),
      executionDurationMs: null,
    };
  }
  if (identity.includes("success")) return { kind: "succeeded", result: null, executionDurationMs: null };
  const override = identity.includes("override") || vector.id.startsWith("completion-replay");
  return {
    kind: "failed",
    failure: failureFor(identity),
    retry: identity.includes("do-not-retry")
      ? { kind: "do_not_retry" }
      : override
        ? { kind: "override_delay", delayMs: duration(6_000) }
        : { kind: "use_bound_policy" },
    executionDurationMs: null,
  };
}

function commandAttemptId(vector: CompatibilityVectorV1) {
  if (vector.command.identity.startsWith("unknown-attempt")) return ATTEMPT_ID_2;
  if (vector.command.identity.startsWith("attempt-2")) return ATTEMPT_ID_2;
  if (vector.command.identity.startsWith("attempt-3")) return ATTEMPT_ID_3;
  return ATTEMPT_ID;
}

function commandFence(vector: CompatibilityVectorV1) {
  if (vector.command.identity.includes("old-fence")) return FENCE_1;
  if (vector.command.identity.startsWith("attempt-2")) return FENCE_2;
  if (vector.command.identity.startsWith("attempt-3")) return FENCE_3;
  return FENCE_1;
}

export function compatibilityCommandV1(
  vector: CompatibilityVectorV1,
): CompatibilityLifecycleCommandV1 | null {
  if (
    vector.id === "invalid-command-is-redacted"
    || vector.id === "waitpoint-completion-outside-v1"
  ) return null;

  switch (vector.command.operation) {
    case "startAttempt":
      return {
        type: "start_attempt",
        runId: vector.id === "missing-run-is-unavailable"
          ? runId("run_00000000-0000-4000-8000-000000000098")
          : vector.id === "cross-scope-run-is-unavailable"
            ? runId("run_00000000-0000-4000-8000-000000000099")
            : RUN_ID,
        expectedRunVersion: vector.command.identity.includes("run-v4")
          ? runVersion(4n)
          : runVersion(1n),
        retryJitter: JITTER,
      };
    case "heartbeatAttempt":
      return {
        type: "heartbeat_attempt",
        runId: RUN_ID,
        attemptId: commandAttemptId(vector),
        executionFence: commandFence(vector),
        heartbeatSequence: heartbeatSequence(
          vector.command.identity.includes("sequence-3")
            ? 3
            : vector.command.identity.includes("sequence-1") ? 1 : 2,
        ),
      };
    case "completeAttempt":
      return {
        type: "complete_attempt",
        runId: RUN_ID,
        attemptId: commandAttemptId(vector),
        executionFence: commandFence(vector),
        completion: vector.id === "conflicting-completion"
          ? {
              kind: "failed",
              failure: {
                kind: "task_failure",
                code: "handler_failed",
                message: null,
              },
              retry: { kind: "do_not_retry" },
              executionDurationMs: null,
            }
          : completionFor(vector),
      };
    case "requestCancellation":
      return {
        type: "request_cancellation",
        runId: RUN_ID,
        reason: vector.command.identity === "user-request"
          ? { code: "requested", message: null }
          : { code: "policy_cancelled", message: null },
      };
    case "handleLeaseExpiry":
      return {
        type: "handle_lease_expiry",
        runId: RUN_ID,
        attemptId: commandAttemptId(vector),
        executionFence: commandFence(vector),
        expectedLeaseVersion: vector.command.identity.includes("lease-4")
          ? leaseVersion(4n)
          : vector.command.identity.includes("lease-3")
            ? leaseVersion(3n)
          : vector.command.identity.includes("lease-2")
            ? leaseVersion(2n)
            : LEASE_VERSION_1,
      };
    default:
      throw new Error(
        `unsupported admitted operation ${vector.command.operation}`,
      );
  }
}

function transition(evidence: readonly TaskRunAttemptEvidenceV1[], outcomeKind: string): string | null {
  const first = evidence[0];
  if (first === undefined) return null;
  switch (first.kind) {
    case "attempt_granted": return "start_grant";
    case "heartbeat_accepted": return first.enteredExecuting ? "first_heartbeat" : "later_heartbeat";
    case "completion_succeeded": return "completion_succeeded";
    case "completion_failed": return outcomeKind === "retry_scheduled"
      ? first.outcome.kind === "retry_scheduled" && first.outcome.delivery === "immediate"
        ? "completion_retry_immediate"
        : "completion_retry_durable"
      : "completion_terminal_failed";
    case "completion_cancellation_acknowledged": return "completion_cancellation_acknowledged";
    case "cancellation_requested": return "active_cancellation_request";
    case "cancellation_resolved_without_attempt": return "cancellation_without_attempt";
    case "lease_expiry_recovered": return outcomeKind === "retry_scheduled" ? "lease_expiry_retry" : "lease_expiry_terminal_failed";
    case "lease_expiry_cancelled": return "lease_expiry_cancelled";
  }
}

function normalizedPolicy(evidence: readonly TaskRunAttemptEvidenceV1[]): Readonly<Record<string, unknown>> | null {
  const item = evidence.find((entry) => entry.kind === "completion_failed" || entry.kind === "lease_expiry_recovered");
  if (item === undefined || (item.kind !== "completion_failed" && item.kind !== "lease_expiry_recovered")) return null;
  const decision = item.policy.decision;
  if (decision.kind === "retry_accepted") {
    return {
      decision: decision.kind,
      eligibility: decision.eligibility,
      delivery: decision.delivery.kind,
      delaySource: decision.delaySource,
      jitterUsed: item.policy.jitterUsed,
      computeEscalated: decision.computeEscalation !== null,
    };
  }
  const reason = decision.reason === "failure_not_retryable"
    ? "failure_never_retry"
    : decision.reason === "oom_escalation_already_applied"
      ? "oom_target_not_different"
      : decision.reason;
  return { decision: decision.kind, reason, terminalClassification: decision.terminalClassification };
}

function receiptActual(input: {
  readonly disposition: "accepted" | "current" | "idempotent";
  readonly observedAtMs: TaskDatabaseTimeMsV1 | null;
  readonly acceptedRunVersion: bigint | null;
  readonly outcome: { readonly kind: string; readonly reason?: string };
  readonly evidence: readonly TaskRunAttemptEvidenceV1[];
  readonly effects: ReadonlyArray<{ readonly sequence: bigint; readonly effect: { readonly kind: string } }>;
}): CompatibilityActualV1 {
  return {
    kind: "receipt",
    disposition: input.disposition,
    outcomeKind: input.outcome.kind,
    currentReason: input.outcome.reason ?? null,
    transition: transition(input.evidence, input.outcome.kind),
    acceptedRunVersion: input.acceptedRunVersion === null ? null : Number(input.acceptedRunVersion),
    recordedAtMs: input.observedAtMs === null ? null : Number(input.observedAtMs),
    evidenceKinds: input.evidence.map((entry) => entry.kind),
    effects: input.effects.map((entry) => ({ sequence: Number(entry.sequence), kind: entry.effect.kind })),
    policy: normalizedPolicy(input.evidence),
  };
}

function safeDecisionError(error: RunAttemptDecisionErrorV1): string {
  switch (error._tag) {
    case "ConflictingTaskAttemptCompletionError": return "completion_identity_conflict";
    case "InvalidTaskCancellationAcknowledgementError": return error.requestedGeneration === null
      ? "cancellation_not_requested"
      : "generation_mismatch";
    case "TaskRunAttemptCounterExhaustedError": return `${error.counter}_exhausted`;
    case "InvalidRunAttemptTransitionError": return error.reason;
    case "StaleTaskExecutionFenceError": return error.reason;
    case "StaleTaskRunVersionError": return error.reason;
    case "TaskRunAttemptPolicyError": return error.reason;
  }
}

function errorActual(tag: string, safeReason: string): CompatibilityActualV1 {
  return {
    kind: "error",
    errorTag: tag,
    safeReason,
    transition: null,
    acceptedRunVersion: null,
    recordedAtMs: null,
    evidenceKinds: [],
    effects: [],
  };
}

export function normalizeCompatibilityLifecycleFailureV1(
  error: RunAttemptLifecycleErrorV1,
): CompatibilityActualV1 {
  switch (error._tag) {
    case "ConflictingTaskAttemptCompletionError":
    case "InvalidTaskCancellationAcknowledgementError":
    case "TaskRunAttemptCounterExhaustedError":
    case "InvalidRunAttemptTransitionError":
    case "StaleTaskExecutionFenceError":
    case "StaleTaskRunVersionError":
    case "TaskRunAttemptPolicyError":
      return errorActual(error._tag, safeDecisionError(error));
    case "TaskSystemRunAttemptUnavailableError":
      return errorActual(error._tag, error.reason);
    case "TaskSystemRunAttemptCorruptionError":
      return errorActual(
        error._tag,
        error.reason === "aggregate_invalid" ? "invalid_aggregate" : error.reason,
      );
    case "TaskSystemRunAttemptTransientStoreError":
      return errorActual(error._tag, "serialization_or_connection");
    case "TaskSystemRunAttemptTerminalStoreError":
      return errorActual(error._tag, "constraint_or_configuration");
    case "TaskSystemRunAttemptStaleScopeAuthorityError":
      return errorActual(error._tag, error.authority);
    case "InvalidRunAttemptCommandError":
      return errorActual(error._tag, "invalid_command_without_raw_input");
  }
  return absurdCompatibilityFailure(error);
}

function absurdCompatibilityFailure(value: never): never {
  throw new Error(`unsupported compatibility lifecycle failure: ${String(value)}`);
}

function isMutableRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeDecision<Outcome extends { readonly kind: string; readonly reason?: string }>(
  result: Result.Result<TaskRunAttemptDecisionV1<Outcome>, RunAttemptDecisionErrorV1>,
): ExecutedVectorV1 {
  return Result.match(result, {
    onFailure: error => ({
      actual: errorActual(error._tag, safeDecisionError(error)),
      next: null,
    }),
    onSuccess: decision => {
      if (decision.kind === "commit") {
        return {
          actual: receiptActual({
            disposition: "accepted",
            observedAtMs: decision.evidence[0]?.recordedAtMs ?? null,
            acceptedRunVersion: decision.next.runVersion,
            outcome: decision.outcome,
            evidence: decision.evidence,
            effects: decision.requestedEffects,
          }),
          next: decision.next,
        };
      }
      if (decision.disposition === "idempotent") {
        return {
          actual: receiptActual({
            disposition: "idempotent",
            observedAtMs: decision.replay.observedAtMs,
            acceptedRunVersion: decision.replay.acceptedRunVersion,
            outcome: decision.replay.outcome,
            evidence: decision.replay.evidence,
            effects: decision.replay.requestedEffects,
          }),
          next: null,
        };
      }
      return {
        actual: receiptActual({
          disposition: "current",
          observedAtMs: null,
          acceptedRunVersion: null,
          outcome: decision.outcome,
          evidence: [],
          effects: [],
        }),
        next: null,
      };
    },
  });
}

function replaySourceId(vector: CompatibilityVectorV1): string | null {
  return vector.id === "duplicate-start-replays-grant" || vector.id === "delivery-resume-returns-stored-receipt"
    ? "start-initial-due"
    : vector.id === "duplicate-heartbeat-replays-renewal"
      ? "first-heartbeat-enters-executing"
      : vector.id === "duplicate-cancellation-replays-request"
        ? "active-cancellation-request"
        : vector.id === "duplicate-expiry-replays-recovery"
          ? "executing-worker-loss-retries"
          : vector.id.startsWith("completion-replay")
            ? "durable-retry-override-delay"
            : vector.id === "failure-message-only-redelivery"
              ? "never-retry-failure-terminalizes"
              : vector.id === "conflicting-completion"
              ? "successful-first-attempt"
              : null;
}

function replayState(
  vector: CompatibilityVectorV1,
  committed: ReadonlyMap<string, TaskRunAttemptAggregateV1>,
): TaskRunAttemptAggregateV1 | null {
  const source = replaySourceId(vector);
  if (source === null) return null;
  const state = committed.get(source);
  if (state === undefined) throw new Error(`compatibility source ${source} was not executed before ${vector.id}`);
  if (vector.id !== "completion-replay-after-later-attempt") return state;
  if (state.phase !== "retry_waiting") throw new Error("later-attempt replay source is not retry waiting");
  const start = Result.getOrThrow(decideStartAttemptV1({
    type: "start_attempt",
    runId: RUN_ID,
    expectedRunVersion: state.runVersion,
    retryJitter: JITTER,
  }, {
    databaseNowMs: state.retry.notBeforeMs,
    current: state,
    attemptGrantCandidate: {
      attemptId: ATTEMPT_ID_2,
      attemptNumber: attemptNumber(2),
      executionFence: FENCE_2,
    },
  }));
  if (start.kind !== "commit") throw new Error("later-attempt replay start did not commit");
  const completed = Result.getOrThrow(decideCompleteAttemptV1({
    type: "complete_attempt",
    runId: RUN_ID,
    attemptId: ATTEMPT_ID_2,
    executionFence: FENCE_2,
    completion: { kind: "succeeded", result: null, executionDurationMs: null },
  }, {
    databaseNowMs: observedAt(vector),
    current: start.next,
    attemptGrantCandidate: null,
  }));
  if (completed.kind !== "commit") throw new Error("later-attempt replay completion did not commit");
  return completed.next;
}

function replayPersistenceState(
  vector: CompatibilityVectorV1,
  committed: ReadonlyMap<string, CompatibilityPersistenceStateV1>,
): CompatibilityPersistenceStateV1 | null {
  const source = replaySourceId(vector);
  if (source === null) return null;
  const state = committed.get(source);
  if (state === undefined) return null;
  if (vector.id !== "completion-replay-after-later-attempt") return state;
  if (state.current.phase !== "retry_waiting") return null;
  let later: MutableCompatibilityHistoryV1 = state;
  later = appendStartTransition(later, state.current.retry.notBeforeMs);
  later = appendCompletionTransition(later, observedAt(vector), {
    kind: "succeeded",
    result: null,
    executionDurationMs: null,
  });
  return Object.freeze({
    current: later.current,
    history: Object.freeze([...later.history]),
  });
}

function executeSchemaOrStoreError(vector: CompatibilityVectorV1): ExecutedVectorV1 | null {
  switch (vector.id) {
    case "malformed-aggregate-decodes-as-corruption":
    case "malformed-completion-replay-decodes-as-corruption":
    case "malformed-evidence-decodes-as-corruption":
    case "malformed-effect-sequence-decodes-as-corruption": {
      const started = normalizeDecision(decideStartAttemptV1({
        type: "start_attempt", runId: RUN_ID, expectedRunVersion: runVersion(1n), retryJitter: JITTER,
      }, {
        databaseNowMs: NOW,
        current: readyAggregate(),
        attemptGrantCandidate: { attemptId: ATTEMPT_ID, attemptNumber: ATTEMPT_NUMBER_1, executionFence: FENCE_1 },
      }));
      const valid = started.next ?? readyAggregate();
      const encoded = Result.getOrThrow(encodeTaskRunAttemptAggregateV1(valid));
      if (!isMutableRecord(encoded)) throw new Error("encoded aggregate fixture invalid");
      const malformed = structuredClone(encoded);
      if (vector.id === "malformed-aggregate-decodes-as-corruption") {
        malformed.version = "not-an-aggregate-version";
      } else if (vector.id === "malformed-completion-replay-decodes-as-corruption") {
        malformed.completionReplays = [{ invalid: true }];
      } else if (vector.id === "malformed-evidence-decodes-as-corruption") {
        const acceptance = malformed.lastLifecycleAcceptance;
        if (!isMutableRecord(acceptance) || !isMutableRecord(acceptance.accepted)) {
          throw new Error("accepted receipt fixture missing");
        }
        acceptance.accepted.evidence = [{ invalid: true }];
      } else {
        malformed.requestedEffectCursor = { kind: "issued", lastSequence: "not-a-counter" };
      }
      if (Result.isSuccess(decodeTaskRunAttemptAggregateV1(malformed))) throw new Error("malformed aggregate unexpectedly decoded");
      const reason = vector.id === "malformed-aggregate-decodes-as-corruption"
        ? "aggregate_invalid"
        : vector.id === "malformed-completion-replay-decodes-as-corruption"
          ? "completion_replay_invalid"
          : vector.id === "malformed-evidence-decodes-as-corruption"
            ? "evidence_invalid"
            : "effect_sequence_invalid";
      const error = new TaskSystemRunAttemptCorruptionError({ operation: "start_attempt", runId: RUN_ID, reason });
      const safeReason = reason === "aggregate_invalid" ? "invalid_aggregate" : reason;
      return { actual: errorActual(error._tag, safeReason), next: null };
    }
    case "missing-run-is-unavailable":
    case "cross-scope-run-is-unavailable": {
      const error = new TaskSystemRunAttemptUnavailableError({ operation: "start_attempt", runId: RUN_ID, reason: "unavailable" });
      return { actual: errorActual(error._tag, error.reason), next: null };
    }
    case "transient-store-failure": {
      const error = new TaskSystemRunAttemptTransientStoreError({ operation: "start_attempt", runId: RUN_ID, reason: "transaction_conflict", cause: "fixture" });
      return { actual: errorActual(error._tag, "serialization_or_connection"), next: null };
    }
    case "terminal-store-failure": {
      const error = new TaskSystemRunAttemptTerminalStoreError({ operation: "start_attempt", runId: RUN_ID, reason: "wrong_placement", cause: null });
      return { actual: errorActual(error._tag, "constraint_or_configuration"), next: null };
    }
    case "invalid-command-is-redacted": {
      const result = decodeRunAttemptCommandV1("start_attempt", {
        type: "start_attempt", runId: RUN_ID, expectedRunVersion: "1", retryJitter: 0.25,
        environmentId: "removed-trigger-authority",
      });
      if (Result.isSuccess(result)) throw new Error("invalid command unexpectedly decoded");
      return { actual: errorActual(result.failure._tag, "invalid_command_without_raw_input"), next: null };
    }
    case "waitpoint-completion-outside-v1": {
      const result = decodeRunAttemptCommandV1("complete_attempt", {
        type: "complete_attempt", runId: RUN_ID, attemptId: ATTEMPT_ID, executionFence: "1",
        completion: { kind: "waitpoint_completed" },
      });
      if (Result.isSuccess(result)) throw new Error("unsupported waitpoint unexpectedly decoded");
      return { actual: errorActual(result.failure._tag, "outside_run_attempt_lifecycle_v1"), next: null };
    }
    default:
      return null;
  }
}

function executeDecision(
  vector: CompatibilityVectorV1,
  current: TaskRunAttemptAggregateV1,
  command: CompatibilityLifecycleCommandV1,
): ExecutedVectorV1 {
  const now = observedAt(vector);
  switch (command.type) {
    case "start_attempt": {
      return normalizeDecision(decideStartAttemptV1(command, {
        databaseNowMs: now,
        current,
        attemptGrantCandidate: candidateFor(current),
      }));
    }
    case "heartbeat_attempt": {
      return normalizeDecision(decideHeartbeatAttemptV1(command, { databaseNowMs: now, current, attemptGrantCandidate: null }));
    }
    case "complete_attempt": {
      return normalizeDecision(decideCompleteAttemptV1(command, { databaseNowMs: now, current, attemptGrantCandidate: null }));
    }
    case "request_cancellation": {
      return normalizeDecision(decideRequestCancellationV1(command, { databaseNowMs: now, current, attemptGrantCandidate: null }));
    }
    case "handle_lease_expiry": {
      return normalizeDecision(decideHandleLeaseExpiryV1(command, { databaseNowMs: now, current, attemptGrantCandidate: null }));
    }
  }
}

function executeAndRecordCompatibilityDecision<
  Outcome extends { readonly kind: string; readonly reason?: string },
>(
  state: CompatibilityPersistenceStateV1,
  operation: CompatibilityLifecycleCommandV1["type"],
  result: Result.Result<
    TaskRunAttemptDecisionV1<Outcome>,
    RunAttemptDecisionErrorV1
  >,
): Readonly<{
  readonly execution: ExecutedVectorV1;
  readonly committed: CompatibilityPersistenceStateV1 | null;
}> {
  const execution = normalizeDecision(result);
  const committed = Result.match(result, {
    onFailure: () => null,
    onSuccess: decision => decision.kind !== "commit"
      ? null
      : appendCompatibilityDecision(state, operation, decision),
  });
  return Object.freeze({ execution, committed });
}

function executePersistenceDecision(
  vector: CompatibilityVectorV1,
  state: CompatibilityPersistenceStateV1,
  command: CompatibilityLifecycleCommandV1,
) {
  const now = observedAt(vector);
  switch (command.type) {
    case "start_attempt":
      return executeAndRecordCompatibilityDecision(
        state,
        command.type,
        decideStartAttemptV1(command, {
          databaseNowMs: now,
          current: state.current,
          attemptGrantCandidate: candidateFor(state.current),
        }),
      );
    case "heartbeat_attempt":
      return executeAndRecordCompatibilityDecision(
        state,
        command.type,
        decideHeartbeatAttemptV1(command, {
          databaseNowMs: now,
          current: state.current,
          attemptGrantCandidate: null,
        }),
      );
    case "complete_attempt":
      return executeAndRecordCompatibilityDecision(
        state,
        command.type,
        decideCompleteAttemptV1(command, {
          databaseNowMs: now,
          current: state.current,
          attemptGrantCandidate: null,
        }),
      );
    case "request_cancellation":
      return executeAndRecordCompatibilityDecision(
        state,
        command.type,
        decideRequestCancellationV1(command, {
          databaseNowMs: now,
          current: state.current,
          attemptGrantCandidate: null,
        }),
      );
    case "handle_lease_expiry":
      return executeAndRecordCompatibilityDecision(
        state,
        command.type,
        decideHandleLeaseExpiryV1(command, {
          databaseNowMs: now,
          current: state.current,
          attemptGrantCandidate: null,
        }),
      );
  }
}

function compatibilityActualEqual(
  left: CompatibilityActualV1,
  right: CompatibilityActualV1,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function prepareCompatibilityVectorsV1(
  vectors: readonly CompatibilityVectorV1[],
  effectCursorCases: readonly CompatibilityEffectCursorCaseV1[],
): ReadonlyMap<string, PreparedCompatibilityVectorV1> {
  const results = new Map<string, PreparedCompatibilityVectorV1>();
  const committed = new Map<string, TaskRunAttemptAggregateV1>();
  const committedPersistence = new Map<
    string,
    CompatibilityPersistenceStateV1
  >();
  const priorEffectCursors = new Map(effectCursorCases.map((entry) => [entry.scenarioId, entry.priorEffectCursor]));
  if (priorEffectCursors.size !== effectCursorCases.length) throw new Error("duplicate compatibility effect cursor case");
  for (const vector of vectors) {
    const boundary = executeSchemaOrStoreError(vector);
    const replay = replayState(vector, committed);
    const current = replay ?? ordinaryInitial(
      vector,
      BigInt(priorEffectCursors.get(vector.id) ?? defaultPriorEffectCursor(vector)),
    );
    const decodedCurrent = Result.getOrThrow(
      decodeTaskRunAttemptAggregateV1(Result.getOrThrow(encodeTaskRunAttemptAggregateV1(current))),
    );
    const command = compatibilityCommandV1(vector);
    if (boundary === null && command === null) {
      throw new Error(`compatibility vector ${vector.id} has no executable boundary`);
    }
    const persistenceCandidate = command === null
      ? null
      : replayPersistenceState(vector, committedPersistence)
        ?? transitionDerivedOrdinaryState(
          vector,
          BigInt(
            priorEffectCursors.get(vector.id)
              ?? defaultPriorEffectCursor(vector),
          ),
        );
    let persistence = persistenceCandidate;
    let committedPersistenceState: CompatibilityPersistenceStateV1 | null = null;
    if (
      persistenceCandidate !== null
      && boundary === null
      && command !== null
    ) {
      const persistenceDecision = executePersistenceDecision(
        vector,
        persistenceCandidate,
        command,
      );
      if (!compatibilityActualEqual(
        persistenceDecision.execution.actual,
        normalizeExpectedV1(vector.expected),
      )) {
        persistence = null;
      } else {
        committedPersistenceState = persistenceDecision.committed;
      }
    }
    let executed: ExecutedVectorV1;
    if (boundary !== null) {
      executed = boundary;
    } else if (command !== null) {
      executed = executeDecision(vector, decodedCurrent, command);
    } else {
      throw new Error(`compatibility vector ${vector.id} has no executable command`);
    }
    results.set(vector.id, Object.freeze({
      vector,
      current: decodedCurrent,
      command,
      execution: executed,
      boundary: command === null ? "command_decoder" : "task_system_store",
      persistence,
    }));
    if (executed.next !== null) committed.set(vector.id, executed.next);
    if (committedPersistenceState !== null) {
      committedPersistence.set(vector.id, committedPersistenceState);
    }
  }
  return results;
}

export function executeCompatibilityVectorsV1(
  vectors: readonly CompatibilityVectorV1[],
  effectCursorCases: readonly CompatibilityEffectCursorCaseV1[],
): ReadonlyMap<string, ExecutedVectorV1> {
  return new Map(
    [...prepareCompatibilityVectorsV1(vectors, effectCursorCases)]
      .map(([id, prepared]) => [id, prepared.execution]),
  );
}

export function normalizeCompatibilityReceiptV1(input: {
  readonly disposition: "accepted" | "current" | "idempotent";
  readonly observedAtMs: TaskDatabaseTimeMsV1;
  readonly runVersion: bigint;
  readonly outcome: { readonly kind: string; readonly reason?: string };
  readonly evidence: readonly TaskRunAttemptEvidenceV1[];
  readonly requestedEffects: ReadonlyArray<{
    readonly sequence: bigint;
    readonly effect: { readonly kind: string };
  }>;
}): CompatibilityActualV1 {
  return receiptActual({
    disposition: input.disposition,
    observedAtMs: input.disposition === "current" ? null : input.observedAtMs,
    acceptedRunVersion: input.disposition === "current" ? null : input.runVersion,
    outcome: input.outcome,
    evidence: input.evidence,
    effects: input.requestedEffects,
  });
}

export function normalizeExpectedV1(expected: CompatibilityExpectedV1): CompatibilityActualV1 {
  if (expected.kind === "error") {
    return errorActual(expected.errorTag ?? "missing-error-tag", expected.safeReason ?? "missing-safe-reason");
  }
  return {
    kind: "receipt",
    disposition: expected.disposition ?? "current",
    outcomeKind: expected.outcomeKind ?? "missing-outcome-kind",
    currentReason: expected.currentReason ?? null,
    transition: expected.transition,
    acceptedRunVersion: expected.acceptedRunVersion,
    recordedAtMs: expected.recordedAtMs,
    evidenceKinds: expected.evidenceKinds,
    effects: expected.effects,
    policy: expected.policy ?? null,
  };
}

function inspectionCancellation(
  projection: CompatibilityInspectionProjectionV1,
) {
  const generation = cancellationGeneration(BigInt(projection.cancellationGeneration));
  if (projection.cancellationKind === "not_requested") return { kind: "not_requested" as const, generation };
  if (projection.cancellationKind === "requested") {
    return {
      kind: "requested" as const,
      generation,
      reason: { code: "requested" as const, message: null },
      requestedAtMs: databaseTime(projection.observedAtMs - 1),
    };
  }
  return {
    kind: "resolved" as const,
    generation,
    reason: { code: "requested" as const, message: null },
    requestedAtMs: databaseTime(projection.observedAtMs - 2),
    resolvedAtMs: databaseTime(projection.observedAtMs - 1),
    resolution: projection.cancellationResolution === "acknowledged"
      ? "acknowledged" as const
      : projection.cancellationResolution === "lease_expired"
        ? "lease_expired" as const
        : projection.cancellationResolution === "superseded_by_completion"
          ? "superseded_by_completion" as const
          : "without_active_attempt" as const,
  };
}

function retryForInspection(projection: CompatibilityInspectionProjectionV1) {
  const notBeforeMs = databaseTime(projection.retryNotBeforeMs ?? projection.eligibleAtMs ?? projection.observedAtMs);
  return {
    previousAttempt: { attemptId: ATTEMPT_ID, attemptNumber: ATTEMPT_NUMBER_1, executionFence: FENCE_1 },
    acceptedAtMs: databaseTime(notBeforeMs - 1),
    notBeforeMs,
    nextComputeProfile: COMPUTE_SMALL,
    cause: { kind: "failed_completion" as const, failure: { kind: "task_failure" as const, code: "handler_failed" as const, message: null } },
  };
}

function inspectionAggregate(projection: CompatibilityInspectionProjectionV1): TaskRunAttemptAggregateV1 {
  const version = runVersion(BigInt(projection.runVersion));
  const cancellation = inspectionCancellation(projection);
  if (projection.phase === "ready") {
    return {
      ...aggregateBase(version, projection.stateVariant === "immediate_retry"
        ? { attemptNo: ATTEMPT_NUMBER_1, lease: LEASE_VERSION_1 }
        : {}),
      phase: "ready",
      ready: projection.stateVariant === "immediate_retry"
        ? {
            kind: "immediate_retry",
            eligibleAtMs: databaseTime(projection.eligibleAtMs ?? projection.observedAtMs),
            acceptedRetry: retryForInspection(projection),
          }
        : { kind: "initial", eligibleAtMs: databaseTime(projection.eligibleAtMs ?? projection.observedAtMs) },
      cancellation: { kind: "not_requested", generation: cancellationGeneration(0n) },
    };
  }
  if (projection.phase === "attempt_granted" || projection.phase === "executing") {
    return activeAggregate({
      phase: projection.phase,
      runVersion: version,
      lease: leaseVersion(BigInt(projection.leaseVersion ?? 1)),
      leaseExpiresAt: databaseTime(projection.observedAtMs + 30_000),
      cancellation: projection.cancellationKind === "requested" ? "requested" : "not_requested",
      heartbeat: heartbeatSequence(projection.heartbeatSequence ?? 1),
    });
  }
  if (projection.phase === "retry_waiting") {
    return {
      ...aggregateBase(version, { attemptNo: ATTEMPT_NUMBER_1, lease: LEASE_VERSION_1 }),
      phase: "retry_waiting",
      retry: retryForInspection(projection),
      cancellation: { kind: "not_requested", generation: cancellationGeneration(0n) },
    };
  }
  if (projection.phase !== "terminal") throw new Error(`unsupported inspection phase ${projection.phase}`);
  if (cancellation.kind === "requested") throw new Error("terminal inspection retained unresolved cancellation");
  const attempt = projection.attemptNumber === null
    ? null
    : { attemptId: ATTEMPT_ID, attemptNumber: attemptNumber(projection.attemptNumber), executionFence: FENCE_1 };
  const common = aggregateBase(version, attempt === null ? {} : { attemptNo: attempt.attemptNumber, lease: LEASE_VERSION_1 });
  if (projection.terminalKind === "succeeded" && attempt !== null) {
    if (cancellation.kind === "resolved" && cancellation.resolution !== "superseded_by_completion") {
      throw new Error("successful inspection has incompatible cancellation state");
    }
    const completionCancellation = cancellation.kind === "not_requested"
      ? cancellation
      : { ...cancellation, resolution: "superseded_by_completion" as const };
    return {
      ...common,
      phase: "terminal",
      terminal: {
        kind: "succeeded",
        completedAtMs: databaseTime(projection.observedAtMs - 1),
        attempt,
        result: projection.resultCommitment === null
          ? null
          : { codec: "flarex.task-result.v1", byteLength: 1, sha256: new Uint8Array(32).fill(7) },
        executionDurationMs: null,
      },
      cancellation: completionCancellation,
    };
  }
  if (projection.terminalKind === "failed" && attempt !== null) {
    if (cancellation.kind === "resolved" && cancellation.resolution !== "superseded_by_completion") {
      throw new Error("failed inspection has incompatible cancellation state");
    }
    const completionCancellation = cancellation.kind === "not_requested"
      ? cancellation
      : { ...cancellation, resolution: "superseded_by_completion" as const };
    return {
      ...common,
      phase: "terminal",
      terminal: {
        kind: "failed",
        completedAtMs: databaseTime(projection.observedAtMs - 1),
        attempt,
        classification: "task_failure",
        failure: { kind: "task_failure", code: "handler_failed", message: null },
        executionDurationMs: null,
      },
      cancellation: completionCancellation,
    };
  }
  if (projection.terminalKind !== "cancelled") throw new Error(`unsupported inspection terminal ${projection.terminalKind}`);
  if (projection.cancellationResolution === "without_active_attempt") {
    if (cancellation.kind !== "resolved" || cancellation.resolution !== "without_active_attempt") {
      throw new Error("without-attempt cancellation inspection has incompatible resolution");
    }
    return {
      ...common,
      phase: "terminal",
      terminal: {
        kind: "cancelled", completedAtMs: cancellation.resolvedAtMs, attempt: null,
        cancellationGeneration: cancellation.generation, reason: cancellation.reason,
        resolution: "without_active_attempt", executionDurationMs: null,
      },
      cancellation: { ...cancellation, resolution: "without_active_attempt" as const },
    };
  }
  if (attempt === null) throw new Error("active cancellation inspection omitted attempt");
  if (projection.cancellationResolution === "acknowledged") {
    if (cancellation.kind !== "resolved" || cancellation.resolution !== "acknowledged") {
      throw new Error("acknowledged cancellation inspection has incompatible resolution");
    }
    return {
      ...common,
      phase: "terminal",
      terminal: {
        kind: "cancelled", completedAtMs: cancellation.resolvedAtMs, attempt,
        cancellationGeneration: cancellation.generation, reason: cancellation.reason,
        resolution: "acknowledged", executionDurationMs: null,
      },
      cancellation: { ...cancellation, resolution: "acknowledged" as const },
    };
  }
  if (cancellation.kind !== "resolved" || cancellation.resolution !== "lease_expired") {
    throw new Error("lease-expired cancellation inspection has incompatible resolution");
  }
  return {
    ...common,
    phase: "terminal",
    terminal: {
      kind: "cancelled", completedAtMs: cancellation.resolvedAtMs, attempt,
      cancellationGeneration: cancellation.generation, reason: cancellation.reason,
      resolution: "lease_expired", executionDurationMs: null,
    },
    cancellation: { ...cancellation, resolution: "lease_expired" as const },
  };
}

function retryCause(state: RunAttemptStateV1): string | null {
  if (state.phase === "retry_waiting") return state.retry.cause.kind;
  if (state.phase === "ready" && state.ready.kind === "immediate_retry") return state.ready.acceptedRetry.cause.kind;
  return null;
}

function normalizeInspection(
  projection: CompatibilityInspectionProjectionV1,
): CompatibilityInspectionProjectionV1 {
  const inspection = projectRunAttemptInspectionV1(
    databaseTime(projection.observedAtMs),
    inspectionAggregate(projection),
  );
  const state = inspection.state;
  const active = state.phase === "attempt_granted" || state.phase === "executing" ? state.currentAttempt : null;
  const retry = state.phase === "retry_waiting" ? state.retry
    : state.phase === "ready" && state.ready.kind === "immediate_retry" ? state.ready.acceptedRetry : null;
  const terminal = state.phase === "terminal" ? state.terminal : null;
  const stateCancellation = state.cancellation;
  return {
    version: inspection.version,
    observedAtMs: Number(inspection.observedAtMs),
    stateVersion: state.version,
    runId: "run-1",
    taskDefinitionRevisionId: "definition-revision-1",
    runVersion: Number(state.runVersion),
    phase: state.phase,
    stateVariant: state.phase === "ready" ? state.ready.kind
      : state.phase === "attempt_granted" ? "active_pre_heartbeat"
      : state.phase === "executing" ? "active_executing"
      : state.phase === "retry_waiting" ? "durable_retry"
      : terminal?.kind === "succeeded" ? "terminal_succeeded"
      : terminal?.kind === "failed" ? "terminal_failed" : "terminal_cancelled",
    cancellationKind: stateCancellation.kind,
    cancellationGeneration: Number(stateCancellation.generation),
    attemptNumber: active === null
      ? retry?.previousAttempt.attemptNumber === undefined
        ? terminal?.attempt?.attemptNumber === undefined ? null : Number(terminal.attempt.attemptNumber)
        : Number(retry.previousAttempt.attemptNumber)
      : Number(active.attempt.attemptNumber),
    leaseVersion: active === null ? null : Number(active.lease.version),
    heartbeatSequence: state.phase === "executing" ? Number(state.heartbeat.highestSequence) : null,
    eligibleAtMs: state.phase === "ready" ? Number(state.ready.eligibleAtMs) : null,
    retryNotBeforeMs: retry === null ? null : Number(retry.notBeforeMs),
    retryCause: retryCause(state),
    terminalKind: terminal?.kind ?? null,
    cancellationResolution: stateCancellation.kind === "resolved" ? stateCancellation.resolution : null,
    resultCommitment: terminal?.kind === "succeeded" && terminal.result !== null ? "sha256-result-1" : null,
    failureClass: terminal?.kind === "failed" ? terminal.classification : null,
  };
}

export function executeCompatibilityInspectionsV1(
  cases: readonly CompatibilityInspectionCaseV1[],
): ReadonlyMap<string, CompatibilityInspectionProjectionV1> {
  return new Map(cases.map((entry) => [entry.id, normalizeInspection(entry.projection)]));
}
