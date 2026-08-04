import { Brand, Effect, Layer, Result } from "effect";
import type { TaskSystemRunAttemptStoreErrorV1 } from "../src/runAttempt/Errors.js";
import { snapshotTaskRunAttemptAggregateV1 } from "../src/runAttempt/Model.js";
import type {
  RunAttemptPolicyV1,
  TaskAttemptIdV1,
  TaskAttemptNumberV1,
  TaskCancellationGenerationV1,
  TaskComputeProfileRefV1,
  TaskDatabaseTimeMsV1,
  TaskDurationMsV1,
  TaskExecutionFenceV1,
  TaskHeartbeatSequenceV1,
  TaskLeaseVersionV1,
  TaskRequestedEffectSequenceV1,
  TaskRetryJitterV1,
  TaskRunAttemptBoundPolicyV1,
  TaskRunAttemptAggregateV1,
  TaskRunAttemptDecisionV1,
  TaskRunIdV1,
  TaskRunVersionV1,
} from "../src/runAttempt/Model.js";
import {
  decodeTaskAttemptIdV1,
  decodeTaskAttemptNumberV1,
  decodeTaskDatabaseTimeMsV1,
  decodeTaskDurationMsV1,
  decodeTaskExecutionFenceV1,
  decodeTaskLeaseVersionV1,
  decodeTaskRetryJitterV1,
  decodeTaskRunIdV1,
  decodeTaskRunVersionV1,
  decodeTaskDefinitionRevisionIdV1,
} from "../src/runAttempt/Schema.js";
import { TaskSystemRunAttemptStore } from "../src/runAttempt/Services/TaskSystemRunAttemptStore.js";

export const RUN_ID = Result.getOrThrow(decodeTaskRunIdV1("run_00000000-0000-4000-8000-000000000001"));
export const DEFINITION_ID = Result.getOrThrow(decodeTaskDefinitionRevisionIdV1("taskdef_00000000-0000-4000-8000-000000000001"));
export const ATTEMPT_ID = Result.getOrThrow(decodeTaskAttemptIdV1("attempt_00000000-0000-4000-8000-000000000001"));
export const RUN_VERSION_1 = Result.getOrThrow(decodeTaskRunVersionV1("1"));
export const RUN_VERSION_2 = Result.getOrThrow(decodeTaskRunVersionV1("2"));
export const FENCE_1 = Result.getOrThrow(decodeTaskExecutionFenceV1("1"));
export const LEASE_VERSION_1 = Result.getOrThrow(decodeTaskLeaseVersionV1("1"));
export const ATTEMPT_NUMBER_1 = Result.getOrThrow(decodeTaskAttemptNumberV1(1));
export const NOW = Result.getOrThrow(decodeTaskDatabaseTimeMsV1(2_000_000_000_000));
export const LEASE_DURATION = Result.getOrThrow(decodeTaskDurationMsV1(30_000));
export const JITTER = Result.getOrThrow(decodeTaskRetryJitterV1(0.25));
export const COMPUTE_SMALL = Brand.nominal<TaskComputeProfileRefV1>()("compute-small");
export const COMPUTE_LARGE = Brand.nominal<TaskComputeProfileRefV1>()("compute-large");
export const cancellationGeneration = Brand.nominal<TaskCancellationGenerationV1>();
export const heartbeatSequence = Brand.nominal<TaskHeartbeatSequenceV1>();
export const effectSequence = Brand.nominal<TaskRequestedEffectSequenceV1>();
export const databaseTime = Brand.nominal<TaskDatabaseTimeMsV1>();
export const duration = Brand.nominal<TaskDurationMsV1>();
export const attemptNumber = Brand.nominal<TaskAttemptNumberV1>();
export const runVersion = Brand.nominal<TaskRunVersionV1>();
export const leaseVersion = Brand.nominal<TaskLeaseVersionV1>();
export const fence = Brand.nominal<TaskExecutionFenceV1>();
export const runId = Brand.nominal<TaskRunIdV1>();
export const attemptId = Brand.nominal<TaskAttemptIdV1>();
export const retryJitter = Brand.nominal<TaskRetryJitterV1>();

export function committedDecision<Outcome, Error>(
  result: Result.Result<TaskRunAttemptDecisionV1<Outcome>, Error>,
): Extract<TaskRunAttemptDecisionV1<Outcome>, { readonly kind: "commit" }> {
  const decision = Result.getOrThrow(result);
  if (decision.kind !== "commit") throw new Error("expected committed decision");
  return decision;
}

export const POLICY: RunAttemptPolicyV1 = {
  version: 1,
  retry: {
    maxAttempts: Brand.nominal<import("../src/runAttempt/Model.js").TaskMaximumAttemptsV1>()(3),
    factor: Brand.nominal<import("../src/runAttempt/Model.js").TaskRetryFactorV1>()(2),
    minTimeoutInMs: duration(1_000),
    maxTimeoutInMs: duration(60_000),
    randomize: true,
  },
  outOfMemory: { kind: "escalate_once", computeProfile: COMPUTE_LARGE },
};

export function aggregateBase(
  version: TaskRunVersionV1,
  options: {
    readonly effectCursor?: bigint | undefined;
    readonly boundPolicy?: TaskRunAttemptBoundPolicyV1 | undefined;
    readonly attemptNo?: TaskAttemptNumberV1;
    readonly lease?: TaskLeaseVersionV1;
  } = {},
) {
  return {
    version: "flarex.task-run-attempt-aggregate.v1" as const,
    runId: RUN_ID,
    taskDefinitionRevisionId: DEFINITION_ID,
    createdAtMs: NOW,
    runVersion: version,
    boundPolicy: options.boundPolicy ?? {
      runAttempt: POLICY,
      maximumDurationMs: duration(300_000),
      initialComputeProfile: COMPUTE_SMALL,
      leaseDurationMs: LEASE_DURATION,
      immediateRetryThresholdMs: duration(5_000),
    },
    attemptHistory: options.attemptNo === undefined
      ? { kind: "none" as const }
      : { kind: "issued" as const, lastAttemptNumber: options.attemptNo },
    leaseHistory: options.lease === undefined
      ? { kind: "none" as const }
      : { kind: "issued" as const, lastLeaseVersion: options.lease },
    lastLifecycleAcceptance: null,
    completionReplays: [],
    requestedEffectCursor: options.effectCursor === undefined || options.effectCursor === 0n
      ? { kind: "none" as const }
      : { kind: "issued" as const, lastSequence: effectSequence(options.effectCursor) },
  };
}

export function readyAggregate(version: TaskRunVersionV1 = RUN_VERSION_1): TaskRunAttemptAggregateV1 {
  return {
    ...aggregateBase(version),
    phase: "ready",
    ready: { kind: "initial", eligibleAtMs: NOW },
    cancellation: { kind: "not_requested", generation: cancellationGeneration(0n) },
  };
}

export function executingAggregate(options: {
  readonly attempt?: TaskAttemptIdV1;
  readonly attemptNo?: TaskAttemptNumberV1;
  readonly runVersion?: TaskRunVersionV1;
  readonly leaseExpiresAt?: TaskDatabaseTimeMsV1;
  readonly effectCursor?: bigint;
  readonly cancellation?: "not_requested" | "requested";
} = {}): TaskRunAttemptAggregateV1 {
  const attempt = options.attempt ?? ATTEMPT_ID;
  const attemptNo = options.attemptNo ?? ATTEMPT_NUMBER_1;
  const version = options.runVersion ?? Brand.nominal<TaskRunVersionV1>()(3n);
  const generation = cancellationGeneration(options.cancellation === "requested" ? 1n : 0n);
  const cancellation = options.cancellation === "requested"
    ? { kind: "requested" as const, generation, reason: { code: "requested" as const, message: null }, requestedAtMs: NOW }
    : { kind: "not_requested" as const, generation };
  return {
    ...aggregateBase(version, {
      attemptNo,
      lease: LEASE_VERSION_1,
      effectCursor: options.effectCursor,
    }),
    phase: "executing",
    currentAttempt: {
      attemptId: attempt,
      attemptNumber: attemptNo,
      executionFence: FENCE_1,
      grantBasisRunVersion: RUN_VERSION_1,
      computeProfile: COMPUTE_SMALL,
      retryJitter: JITTER,
      grantedAtMs: NOW,
      lease: {
        version: LEASE_VERSION_1,
        renewedAtMs: NOW,
        expiresAtMs: options.leaseExpiresAt ?? databaseTime(NOW + LEASE_DURATION),
      },
    },
    heartbeat: { kind: "accepted", highestSequence: heartbeatSequence(1) },
    cancellation,
  };
}

export function activeAggregate(options: {
  readonly phase: "attempt_granted" | "executing";
  readonly attempt?: TaskAttemptIdV1;
  readonly attemptNo?: TaskAttemptNumberV1;
  readonly executionFence?: TaskExecutionFenceV1;
  readonly runVersion?: TaskRunVersionV1;
  readonly lease?: TaskLeaseVersionV1;
  readonly leaseExpiresAt?: TaskDatabaseTimeMsV1;
    readonly leaseRenewedAt?: TaskDatabaseTimeMsV1;
    readonly grantedAt?: TaskDatabaseTimeMsV1;
  readonly effectCursor?: bigint;
  readonly cancellation?: "not_requested" | "requested";
  readonly computeProfile?: TaskComputeProfileRefV1;
  readonly boundPolicy?: TaskRunAttemptBoundPolicyV1;
  readonly heartbeat?: TaskHeartbeatSequenceV1;
}): TaskRunAttemptAggregateV1 {
  const attemptNo = options.attemptNo ?? ATTEMPT_NUMBER_1;
  const lease = options.lease ?? LEASE_VERSION_1;
  const generation = cancellationGeneration(options.cancellation === "requested" ? 1n : 0n);
  const cancellation = options.cancellation === "requested"
    ? { kind: "requested" as const, generation, reason: { code: "requested" as const, message: null }, requestedAtMs: NOW }
    : { kind: "not_requested" as const, generation };
  const currentAttempt = {
    attemptId: options.attempt ?? ATTEMPT_ID,
    attemptNumber: attemptNo,
    executionFence: options.executionFence ?? FENCE_1,
    grantBasisRunVersion: runVersion((options.runVersion ?? RUN_VERSION_2) - 1n),
    computeProfile: options.computeProfile ?? COMPUTE_SMALL,
    retryJitter: JITTER,
    grantedAtMs: options.grantedAt ?? NOW,
    lease: {
      version: lease,
      renewedAtMs: options.leaseRenewedAt ?? NOW,
      expiresAtMs: options.leaseExpiresAt ?? databaseTime(NOW + LEASE_DURATION),
    },
  };
  const common = {
    ...aggregateBase(options.runVersion ?? RUN_VERSION_2, {
      attemptNo,
      lease,
      effectCursor: options.effectCursor,
      boundPolicy: options.boundPolicy,
    }),
    currentAttempt,
    cancellation,
  };
  return options.phase === "attempt_granted"
    ? { ...common, phase: "attempt_granted", heartbeat: { kind: "none_accepted" } }
    : {
        ...common,
        phase: "executing",
        heartbeat: { kind: "accepted", highestSequence: options.heartbeat ?? heartbeatSequence(1) },
      };
}

export function createDeterministicRunAttemptStore(options: {
  readonly initial: TaskRunAttemptAggregateV1;
  readonly now?: TaskDatabaseTimeMsV1;
  readonly transactionFailure?: TaskSystemRunAttemptStoreErrorV1;
  readonly inspectionFailure?: TaskSystemRunAttemptStoreErrorV1;
}) {
  let state = snapshotTaskRunAttemptAggregateV1(options.initial);
  let writes = 0;
  const now = options.now ?? NOW;
  const store = TaskSystemRunAttemptStore.of({
    transactRunAttempt: (request) => options.transactionFailure === undefined
      ? Effect.gen(function* () {
          const nextAttempt = state.attemptHistory.kind === "none"
            ? 1
            : Number(state.attemptHistory.lastAttemptNumber) + 1;
          const decision = yield* Effect.fromResult(request.decide({
            databaseNowMs: now,
            current: state,
            attemptGrantCandidate: request.operation === "start_attempt"
              ? {
                  attemptId: nextAttempt === 1 ? ATTEMPT_ID : attemptId(`attempt_00000000-0000-4000-8000-${String(nextAttempt).padStart(12, "0")}`),
                  attemptNumber: attemptNumber(nextAttempt),
                  executionFence: fence(BigInt(nextAttempt)),
                }
              : null,
          }));
          if (decision.kind === "commit") {
            state = decision.next;
            writes += 1;
            return {
              disposition: "accepted" as const,
              observedAtMs: now,
              runVersion: decision.next.runVersion,
              outcome: decision.outcome,
              evidence: decision.evidence,
              requestedEffects: decision.requestedEffects,
            };
          }
          if (decision.disposition === "idempotent") {
            return {
              disposition: "idempotent" as const,
              observedAtMs: decision.replay.observedAtMs,
              runVersion: decision.replay.acceptedRunVersion,
              outcome: decision.replay.outcome,
              evidence: decision.replay.evidence,
              requestedEffects: decision.replay.requestedEffects,
            };
          }
          return {
            disposition: "current" as const,
            observedAtMs: now,
            runVersion: state.runVersion,
            outcome: decision.outcome,
            evidence: [],
            requestedEffects: [],
          };
        })
      : Effect.fail(options.transactionFailure),
    inspectRunAttempt: () => options.inspectionFailure === undefined
      ? Effect.succeed({ observedAtMs: now, current: state })
      : Effect.fail(options.inspectionFailure),
  });
  return {
    layer: Layer.succeed(TaskSystemRunAttemptStore, store),
    current: (): TaskRunAttemptAggregateV1 => state,
    writeCount: (): number => writes,
  };
}
