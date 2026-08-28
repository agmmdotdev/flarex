import {
  Cause,
  Clock,
  Deferred,
  Duration,
  Effect,
  Exit,
  Fiber,
  Result,
} from "effect";
import { TestClock } from "effect/testing";
import { describe, expect, it } from "vitest";

import {
  makeAdmittedChangeSource,
  MAX_MODEL_SEMANTIC_BYTES,
  MAX_MODEL_SEMANTIC_WORK_UNITS,
  MAX_PROJECTED_CANONICAL_BYTES,
  MAX_PROJECTED_DEPENDENCY_EXAMINATIONS,
  MAX_SOURCE_PAGE_BATCHES,
  MAX_SOURCE_TRANSPORT_BYTES,
} from "@flarex/query-sync/internal/change";
import type {
  AdmittedChangeSource,
  CaughtUpChangeAuthority,
  ChangeReadBudget,
  ChangeSourceReadRequest,
} from "@flarex/query-sync/internal/change";
import {
  captureQueryEvaluationEvidence,
  captureQueryGeneration,
  InvalidQueryCompletionReplayError,
} from "@flarex/query-sync/internal/kernel";
import type {
  NamespaceCursor,
  CanonicalDependencyKey,
  QueryAuthorityWitness,
  QueryDescriptor,
  QueryEvaluationAttempt,
  QueryPublicationArtifact,
  SyncSequence,
} from "@flarex/query-sync/internal/kernel";
import {
  EvaluationOutcomeSettlementDeadlineError,
  InvalidQueryEvaluationArtifactError,
  makeNamespaceQuerySync,
  QueryEvaluatorRefusedError,
  QueryEvaluatorUnavailableError,
} from "@flarex/query-sync/internal/orchestration";
import type {
  EvaluationTurnBudget,
  NamespaceQuerySync,
  NamespaceQuerySyncPolicy,
  QueryEvaluationArtifact,
} from "@flarex/query-sync/internal/orchestration";
import { QuerySyncStateUnavailableError } from "@flarex/query-sync/internal/state";
import type { QuerySyncTransitionState } from "@flarex/query-sync/internal/state";
import {
  captureKeyValueAuthorityObservation,
  captureKeyValueCommittedPayload,
  makeKeyValueInvalidationProjector,
  makeReferenceQueryEvaluator,
  makeReferenceQuerySyncStateHarness,
  makeReferenceReplayableChangeSource,
} from "@flarex/query-sync/testing/conformance";
import type {
  ReferenceQueryEvaluator,
  ReferenceQueryEvaluatorCall,
  ReferenceQueryEvaluatorStep,
  ReferenceQuerySyncTransitionState,
  ReferenceReplayableChangeSource,
  KeyValueAuthorityObservation,
  KeyValueCommittedPayload,
} from "@flarex/query-sync/testing/conformance";

import {
  canonicalKey,
  cursor,
  descriptor,
  firstEvaluationRequest,
  getSuccess,
  publicationArtifact,
  target,
} from "./fixtures.js";
import { runEffect, runEffectFailure } from "./effectBoundary.js";

const RETRY_DELAYS: readonly [number, number] = Object.freeze([0, 0]);

const POLICY: NamespaceQuerySyncPolicy = Object.freeze({
  stateAttemptsPerOperation: 3,
  sourceAttemptsPerRead: 3,
  retryDelayMilliseconds: RETRY_DELAYS,
  settlementReserveMilliseconds: 10,
});

const BUDGET: EvaluationTurnBudget = Object.freeze({
  sourceReads: 32,
  admittedBatches: 4_096,
  sourceTransportBytes: 16 * 1_024 * 1_024,
  modelSemanticWorkUnits: 65_536,
  modelSemanticBytes: 16 * 1_024 * 1_024,
  dependencyKeyExaminations: 65_536,
  canonicalDependencyBytes: 16 * 1_024 * 1_024,
  newWorkWindowMilliseconds: 1_000,
  evaluatedQueries: 32,
  evaluatorCallsPerQuery: 2,
});

const HARD_READ_BUDGET: ChangeReadBudget = Object.freeze({
  committedBatches: MAX_SOURCE_PAGE_BATCHES,
  sourceTransportBytes: MAX_SOURCE_TRANSPORT_BYTES,
  modelSemanticWorkUnits: MAX_MODEL_SEMANTIC_WORK_UNITS,
  modelSemanticBytes: MAX_MODEL_SEMANTIC_BYTES,
  dependencyKeyExaminations: MAX_PROJECTED_DEPENDENCY_EXAMINATIONS,
  canonicalDependencyBytes: MAX_PROJECTED_CANONICAL_BYTES,
});

interface EvaluationSource {
  readonly admitted: AdmittedChangeSource;
  readonly reference: ReferenceReplayableChangeSource<
    KeyValueCommittedPayload,
    KeyValueAuthorityObservation
  >;
  readonly initialAuthority: CaughtUpChangeAuthority;
}

interface EvaluationSystem {
  readonly binding: NamespaceCursor;
  readonly state: ReferenceQuerySyncTransitionState;
  readonly evaluator: ReferenceQueryEvaluator;
  readonly sync: NamespaceQuerySync;
  readonly source: EvaluationSource;
}

function sequence(value: bigint): SyncSequence {
  return cursor({ sequence: value }).appliedThroughSequence;
}

function steppingClock(
  timestamps: ReadonlyArray<bigint>,
  onStep?: (timestamp: bigint) => void,
): Clock.Clock {
  let index = 0;
  let current = timestamps[0] ?? 0n;
  const next = (): bigint => {
    current = timestamps[index] ?? current;
    index += 1;
    onStep?.(current);
    return current;
  };
  return Object.freeze({
    currentTimeMillisUnsafe: () => Number(current / 1_000_000n),
    currentTimeMillis: Effect.sync(() => Number(next() / 1_000_000n)),
    currentTimeNanosUnsafe: () => current,
    currentTimeNanos: Effect.sync(next),
    sleep: () => Effect.void,
  });
}

async function authorityAfter(
  source: AdmittedChangeSource,
  binding: NamespaceCursor,
  after: SyncSequence,
): Promise<CaughtUpChangeAuthority> {
  const read = await runEffect(source.readAfter({
    namespaceId: binding.namespaceId,
    syncModelId: binding.syncModelId,
    sourceEpoch: binding.sourceEpoch,
    requestedAfterSequenceExclusive: after,
  }, HARD_READ_BUDGET));
  if (read._tag !== "page" || read.caughtUpAuthority === null) {
    throw new Error("Expected a final admitted page in the test fixture");
  }
  return read.caughtUpAuthority;
}

async function buildSource(
  binding: NamespaceCursor,
): Promise<EvaluationSource> {
  const reference = await runEffect(makeReferenceReplayableChangeSource({
    namespaceId: binding.namespaceId,
    syncModelId: binding.syncModelId,
    sourceEpoch: binding.sourceEpoch,
    replayableAfterSequenceExclusive: sequence(0n),
    observedLatestSequence: sequence(0n),
    batches: [],
    authorityObservation: { revision: 0, partitions: ["primary"] },
    authorityTransportBytes: 1,
  }, {
    capturePayload: captureKeyValueCommittedPayload,
    captureAuthorityObservation: captureKeyValueAuthorityObservation,
  }));
  const admitted = makeAdmittedChangeSource(
    reference,
    makeKeyValueInvalidationProjector(binding.syncModelId),
  );
  return Object.freeze({
    admitted,
    reference,
    initialAuthority: await authorityAfter(
      admitted,
      binding,
      sequence(0n),
    ),
  });
}

async function buildState(
  binding: NamespaceCursor,
  physicalNamespaceId = `physical-${binding.namespaceId}`,
): Promise<ReferenceQuerySyncTransitionState> {
  const harness = await runEffect(makeReferenceQuerySyncStateHarness());
  return harness.bind({
    physicalNamespaceId,
    namespaceId: binding.namespaceId,
    syncModelId: binding.syncModelId,
    sourceEpoch: binding.sourceEpoch,
  });
}

function artifactFor(
  call: ReferenceQueryEvaluatorCall,
  authorityWitness: QueryAuthorityWitness,
  input: Readonly<{
    readonly snapshot?: bigint;
    readonly namespaceId?: string;
    readonly resultSeed?: number;
    readonly publication?: QueryPublicationArtifact;
    readonly dependencyKeys?: readonly CanonicalDependencyKey[];
  }> = {},
): QueryEvaluationArtifact {
  const evaluation = getSuccess(captureQueryEvaluationEvidence({
    namespaceId: input.namespaceId ?? call.attempt.namespaceId,
    syncModelId: call.attempt.syncModelId,
    sourceEpoch: call.attempt.sourceEpoch,
    descriptor: call.attempt.descriptor,
    generation: call.attempt.generation,
    snapshotSequence: input.snapshot
      ?? call.attempt.registrationCursor.appliedThroughSequence,
    resultDigest: canonicalKey(input.resultSeed ?? 80),
    authorityWitness,
    dependencyKeys: input.dependencyKeys ?? [],
  }));
  return Object.freeze({
    evaluation,
    publication: input.publication ?? publicationArtifact(),
  });
}

function successfulStep(
  authorityWitness: QueryAuthorityWitness,
  input: Parameters<typeof artifactFor>[2] = {},
): ReferenceQueryEvaluatorStep {
  return (call) => Effect.succeed(artifactFor(
    call,
    authorityWitness,
    input,
  ));
}

async function buildSystem(
  steps: readonly ReferenceQueryEvaluatorStep[],
  options: Readonly<{
    readonly state?: ReferenceQuerySyncTransitionState;
    readonly source?: EvaluationSource;
    readonly stateForCoordinator?: QuerySyncTransitionState;
    readonly policy?: NamespaceQuerySyncPolicy;
  }> = {},
): Promise<EvaluationSystem> {
  const binding = cursor();
  const source = options.source ?? await buildSource(binding);
  const state = options.state ?? await buildState(binding);
  const evaluator = await runEffect(makeReferenceQueryEvaluator(steps));
  const sync = getSuccess(makeNamespaceQuerySync({
    bootstrapCursor: binding,
    source: source.admitted,
    state: options.stateForCoordinator ?? state,
    evaluator,
    policy: options.policy ?? POLICY,
  }));
  return Object.freeze({ binding, state, evaluator, sync, source });
}

async function systemWithSuccessfulEvaluation(): Promise<EvaluationSystem> {
  const binding = cursor();
  const source = await buildSource(binding);
  return buildSystem([
    successfulStep(source.initialAuthority.authorityWitness),
  ], { source });
}

describe("bounded query evaluation orchestration", () => {
  it("registers from the bound authority and atomically creates publication intent", async () => {
    const system = await systemWithSuccessfulEvaluation();
    const query = descriptor();

    const outcome = await runEffect(system.sync.beginQuery(query, BUDGET));
    expect(outcome).toMatchObject({
      _tag: "completed",
      generation: 1n,
      publicationDisposition: { _tag: "pending" },
      progress: {
        evaluatorCalls: 1,
        completedEvaluations: 1,
      },
    });
    const calls = await runEffect(
      system.evaluator.snapshotForConformance(),
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]?.attempt).toMatchObject({
      namespaceId: system.binding.namespaceId,
      syncModelId: system.binding.syncModelId,
      sourceEpoch: system.binding.sourceEpoch,
      descriptor: query,
      expectedActiveGeneration: null,
      requestedDirtyThroughSequence: null,
    });
    const snapshot = await runEffect(system.state.snapshotForConformance());
    expect(snapshot?.queries[0]?.active?.generation).toBe(1n);
    expect(snapshot?.publicationWork.pending).toHaveLength(1);
  });

  it.each(["beforeSwap", "afterSwap"] as const)(
    "recovers a %s registration fault with the exact same request object",
    async (timing) => {
      const binding = cursor();
      const source = await buildSource(binding);
      const state = await buildState(binding);
      const requests: Array<Parameters<
        QuerySyncTransitionState["beginQueryEvaluation"]
      >[0]> = [];
      const countedState: QuerySyncTransitionState = Object.freeze({
        ...state,
        beginQueryEvaluation: (
          request: Parameters<
            QuerySyncTransitionState["beginQueryEvaluation"]
          >[0],
        ) => {
          requests.push(request);
          return state.beginQueryEvaluation(request);
        },
      });
      await runEffect(state.injectNextFault({
        operation: "beginQueryEvaluation",
        timing,
      }));
      const system = await buildSystem([
        successfulStep(source.initialAuthority.authorityWitness),
      ], { source, state, stateForCoordinator: countedState });

      const outcome = await runEffect(system.sync.beginQuery(
        descriptor(),
        BUDGET,
      ));
      expect(outcome._tag).toBe("completed");
      expect(requests).toHaveLength(2);
      expect(requests[0]).toBe(requests[1]);
    },
  );

  it("does not invoke any publication-delivery state operation", async () => {
    const binding = cursor();
    const source = await buildSource(binding);
    const state = await buildState(binding);
    let publicationCalls = 0;
    const guardedState: QuerySyncTransitionState = Object.freeze({
      ...state,
      claimPublication: () => {
        publicationCalls += 1;
        return Effect.die("C3 called claimPublication");
      },
      recordPublicationAttemptOutcome: () => {
        publicationCalls += 1;
        return Effect.die("C3 called recordPublicationAttemptOutcome");
      },
      completePublication: () => {
        publicationCalls += 1;
        return Effect.die("C3 called completePublication");
      },
    });
    const system = await buildSystem([
      successfulStep(source.initialAuthority.authorityWitness),
    ], { source, state, stateForCoordinator: guardedState });

    const outcome = await runEffect(system.sync.beginQuery(
      descriptor(),
      BUDGET,
    ));
    expect(outcome._tag).toBe("completed");
    expect(publicationCalls).toBe(0);
  });

  it("rejects crossed evaluator evidence before any refresh source read", async () => {
    const binding = cursor();
    const source = await buildSource(binding);
    let sourceCalls = 0;
    const countedSource: EvaluationSource = Object.freeze({
      ...source,
      admitted: Object.freeze({
        readAfter: (
          request: ChangeSourceReadRequest,
          budget: ChangeReadBudget,
        ) => {
          sourceCalls += 1;
          return source.admitted.readAfter(request, budget);
        },
      }),
    });
    const system = await buildSystem([
      successfulStep(source.initialAuthority.authorityWitness, {
        namespaceId: "other-tenant",
      }),
    ], { source: countedSource });

    const failure = await runEffectFailure(system.sync.beginQuery(
      descriptor(),
      BUDGET,
    ));
    expect(failure).toEqual(new InvalidQueryEvaluationArtifactError({
      operation: "captureQueryEvaluationArtifact",
      reason: "namespaceMismatch",
      queryKey: descriptor().queryKey,
      generation: getSuccess(captureQueryGeneration(1n)),
    }));
    expect(sourceCalls).toBe(1);
    const snapshot = await runEffect(system.state.snapshotForConformance());
    expect(snapshot?.queries[0]?.provisional?.generation).toBe(1n);
  });

  it("retries a transient evaluator failure with the same nominal attempt", async () => {
    const binding = cursor();
    const source = await buildSource(binding);
    const system = await buildSystem([
      () => Effect.fail(new QueryEvaluatorUnavailableError({
        operation: "evaluate",
        reason: "temporarilyUnavailable",
        cause: "injected",
      })),
      successfulStep(source.initialAuthority.authorityWitness),
    ], { source });

    const outcome = await runEffect(system.sync.beginQuery(
      descriptor(),
      BUDGET,
    ));
    expect(outcome).toMatchObject({
      _tag: "completed",
      progress: { evaluatorCalls: 2, completedEvaluations: 1 },
    });
    const calls = await runEffect(
      system.evaluator.snapshotForConformance(),
    );
    expect(calls).toHaveLength(2);
    expect(calls[0]?.attempt).toBe(calls[1]?.attempt);
    expect(calls.map((call) => (
      call.budget.remainingEvaluatorCallsIncludingThisCall
    ))).toEqual([2, 1]);
  });

  it("shares one source ledger across catch-up and refresh", async () => {
    const system = await systemWithSuccessfulEvaluation();

    const outcome = await runEffect(system.sync.beginQuery(descriptor(), {
      ...BUDGET,
      sourceReads: 2,
    }));
    expect(outcome).toMatchObject({
      _tag: "continuationRequired",
      continuation: {
        phase: "refreshReplay",
        reason: "sourceReadLimitReached",
      },
      progress: { sourceCalls: 2, completedEvaluations: 0 },
    });
    const snapshot = await runEffect(system.state.snapshotForConformance());
    expect(snapshot?.queries[0]?.active).toBeNull();
    expect(snapshot?.queries[0]?.provisional?.generation).toBe(1n);
  });

  it("resnapshots after refresh authority drifts within the two-call cap", async () => {
    const binding = cursor();
    const source = await buildSource(binding);
    const firstStep: ReferenceQueryEvaluatorStep = (call) =>
      source.reference.appendCommittedBatch({
        sourceSequence: sequence(1n),
        payload: { changes: [] },
        transportBytes: 1,
      }, {
        revision: 1,
        partitions: ["primary"],
      }, 1).pipe(
        Effect.orDie,
        Effect.as(artifactFor(
          call,
          source.initialAuthority.authorityWitness,
          { snapshot: 0n, resultSeed: 80 },
        )),
      );
    const secondStep: ReferenceQueryEvaluatorStep = (call) =>
      source.admitted.readAfter({
        namespaceId: binding.namespaceId,
        syncModelId: binding.syncModelId,
        sourceEpoch: binding.sourceEpoch,
        requestedAfterSequenceExclusive: sequence(1n),
      }, HARD_READ_BUDGET).pipe(
        Effect.orDie,
        Effect.flatMap((read) => (
          read._tag === "page" && read.caughtUpAuthority !== null
            ? Effect.succeed(artifactFor(
              call,
              read.caughtUpAuthority.authorityWitness,
              { snapshot: 1n, resultSeed: 81 },
            ))
            : Effect.die("Expected current source authority")
        )),
      );
    const system = await buildSystem([firstStep, secondStep], { source });

    const outcome = await runEffect(system.sync.beginQuery(
      descriptor(),
      BUDGET,
    ));
    expect(outcome).toMatchObject({
      _tag: "completed",
      progress: { evaluatorCalls: 2, completedEvaluations: 1 },
    });
    const snapshot = await runEffect(system.state.snapshotForConformance());
    expect(snapshot?.queries[0]?.active?.evaluationSnapshotSequence).toBe(1n);
    expect(snapshot?.cursor.appliedThroughSequence).toBe(1n);
  });

  it("extends refresh after a completion-time durable cursor race", async () => {
    const binding = cursor();
    const source = await buildSource(binding);
    const state = await buildState(binding);
    let completionCalls = 0;
    const racedState: QuerySyncTransitionState = Object.freeze({
      ...state,
      completeQueryEvaluation: (
        attempt: Parameters<
          QuerySyncTransitionState["completeQueryEvaluation"]
        >[0],
        evaluation: Parameters<
          QuerySyncTransitionState["completeQueryEvaluation"]
        >[1],
        refresh: Parameters<
          QuerySyncTransitionState["completeQueryEvaluation"]
        >[2],
        publication: Parameters<
          QuerySyncTransitionState["completeQueryEvaluation"]
        >[3],
      ) => {
        completionCalls += 1;
        if (completionCalls !== 1) {
          return state.completeQueryEvaluation(
            attempt,
            evaluation,
            refresh,
            publication,
          );
        }
        return source.reference.appendCommittedBatch({
          sourceSequence: sequence(1n),
          payload: { changes: [] },
          transportBytes: 1,
        }, {
          revision: 1,
          partitions: ["primary"],
        }, 1).pipe(
          Effect.orDie,
          Effect.andThen(source.admitted.readAfter({
            namespaceId: binding.namespaceId,
            syncModelId: binding.syncModelId,
            sourceEpoch: binding.sourceEpoch,
            requestedAfterSequenceExclusive: sequence(0n),
          }, HARD_READ_BUDGET)),
          Effect.orDie,
          Effect.flatMap((read) => {
            const batch = read._tag === "page" ? read.batches[0] : undefined;
            return batch === undefined
              ? Effect.die("Expected the raced durable suffix")
              : state.applyAdmittedBatchAndAdvance(batch).pipe(
                Effect.orDie,
                Effect.andThen(state.completeQueryEvaluation(
                  attempt,
                  evaluation,
                  refresh,
                  publication,
                )),
              );
          }),
        );
      },
    });
    const secondStep: ReferenceQueryEvaluatorStep = (call) =>
      source.admitted.readAfter({
        namespaceId: binding.namespaceId,
        syncModelId: binding.syncModelId,
        sourceEpoch: binding.sourceEpoch,
        requestedAfterSequenceExclusive: sequence(1n),
      }, HARD_READ_BUDGET).pipe(
        Effect.orDie,
        Effect.flatMap((read) => (
          read._tag === "page" && read.caughtUpAuthority !== null
            ? Effect.succeed(artifactFor(
              call,
              read.caughtUpAuthority.authorityWitness,
              { snapshot: 1n, resultSeed: 83 },
            ))
            : Effect.die("Expected current source authority")
        )),
      );
    const system = await buildSystem([
      successfulStep(source.initialAuthority.authorityWitness),
      secondStep,
    ], { source, state, stateForCoordinator: racedState });

    const outcome = await runEffect(system.sync.beginQuery(
      descriptor(),
      BUDGET,
    ));
    expect(outcome).toMatchObject({
      _tag: "completed",
      progress: {
        evaluatorCalls: 2,
        admittedBatches: 1,
        settledBatchTransitions: 1,
      },
    });
    expect(completionCalls).toBe(3);
    const snapshot = await runEffect(state.snapshotForConformance());
    expect(snapshot?.cursor.appliedThroughSequence).toBe(1n);
    expect(snapshot?.queries[0]?.active?.freshThroughSequence).toBe(1n);
  });

  it("reruns when a post-snapshot batch changes an evaluated dependency", async () => {
    const binding = cursor();
    const source = await buildSource(binding);
    const readArtifact = (
      call: ReferenceQueryEvaluatorCall,
      snapshot: bigint,
      resultSeed: number,
    ) => source.admitted.readAfter({
      namespaceId: binding.namespaceId,
      syncModelId: binding.syncModelId,
      sourceEpoch: binding.sourceEpoch,
      requestedAfterSequenceExclusive: sequence(0n),
    }, HARD_READ_BUDGET).pipe(
      Effect.orDie,
      Effect.flatMap((read) => {
        const batch = read._tag === "page" ? read.batches[0] : undefined;
        const dependencyKey = batch?.dependencyKeys[0];
        return read._tag !== "page"
          || read.caughtUpAuthority === null
          || dependencyKey === undefined
          ? Effect.die("Expected a relevant caught-up batch")
          : Effect.succeed(artifactFor(
            call,
            read.caughtUpAuthority.authorityWitness,
            { snapshot, resultSeed, dependencyKeys: [dependencyKey] },
          ));
      }),
    );
    const firstStep: ReferenceQueryEvaluatorStep = (call) =>
      source.reference.appendCommittedBatch({
        sourceSequence: sequence(1n),
        payload: { changes: [{ key: "relevant", kind: "set" }] },
        transportBytes: 1,
      }, {
        revision: 1,
        partitions: ["primary"],
      }, 1).pipe(
        Effect.orDie,
        Effect.andThen(readArtifact(call, 0n, 84)),
      );
    const secondStep: ReferenceQueryEvaluatorStep = (call) =>
      readArtifact(call, 1n, 85);
    const system = await buildSystem([firstStep, secondStep], { source });

    const outcome = await runEffect(system.sync.beginQuery(
      descriptor(),
      BUDGET,
    ));
    expect(outcome).toMatchObject({
      _tag: "completed",
      progress: { evaluatorCalls: 2, completedEvaluations: 1 },
    });
    const calls = await runEffect(system.evaluator.snapshotForConformance());
    expect(calls.map((call) => (
      call.budget.remainingEvaluatorCallsIncludingThisCall
    ))).toEqual([2, 1]);
    const snapshot = await runEffect(system.state.snapshotForConformance());
    expect(snapshot?.queries[0]?.active?.evaluationSnapshotSequence).toBe(1n);
    expect(snapshot?.queries[0]?.active?.freshThroughSequence).toBe(1n);
  });

  it("stops a required rerun after a transient call consumes the cap", async () => {
    const binding = cursor();
    const source = await buildSource(binding);
    const transient: ReferenceQueryEvaluatorStep = () => Effect.fail(
      new QueryEvaluatorUnavailableError({
        operation: "evaluate",
        reason: "temporarilyUnavailable",
        cause: "injected",
      }),
    );
    const relevantArtifact: ReferenceQueryEvaluatorStep = (call) =>
      source.reference.appendCommittedBatch({
        sourceSequence: sequence(1n),
        payload: { changes: [{ key: "relevant", kind: "set" }] },
        transportBytes: 1,
      }, {
        revision: 1,
        partitions: ["primary"],
      }, 1).pipe(
        Effect.orDie,
        Effect.andThen(source.admitted.readAfter({
          namespaceId: binding.namespaceId,
          syncModelId: binding.syncModelId,
          sourceEpoch: binding.sourceEpoch,
          requestedAfterSequenceExclusive: sequence(0n),
        }, HARD_READ_BUDGET)),
        Effect.orDie,
        Effect.flatMap((read) => {
          const batch = read._tag === "page" ? read.batches[0] : undefined;
          const dependencyKey = batch?.dependencyKeys[0];
          return read._tag !== "page"
            || read.caughtUpAuthority === null
            || dependencyKey === undefined
            ? Effect.die("Expected a relevant caught-up batch")
            : Effect.succeed(artifactFor(
              call,
              read.caughtUpAuthority.authorityWitness,
              { snapshot: 0n, dependencyKeys: [dependencyKey] },
            ));
        }),
      );
    const system = await buildSystem([transient, relevantArtifact], { source });

    const outcome = await runEffect(system.sync.beginQuery(
      descriptor(),
      BUDGET,
    ));
    expect(outcome).toMatchObject({
      _tag: "continuationRequired",
      continuation: { reason: "rerunRequired", scan: null },
      progress: { evaluatorCalls: 2, completedEvaluations: 0 },
    });
    const snapshot = await runEffect(system.state.snapshotForConformance());
    expect(snapshot?.queries[0]?.active).toBeNull();
    expect(snapshot?.queries[0]?.provisional?.generation).toBe(1n);
  });

  it("floors evaluator settlement allowance to whole milliseconds", async () => {
    const binding = cursor();
    const source = await buildSource(binding);
    const state = await buildState(binding);
    const advancedState: QuerySyncTransitionState = Object.freeze({
      ...state,
      beginQueryEvaluation: (
        request: Parameters<
          QuerySyncTransitionState["beginQueryEvaluation"]
        >[0],
      ) =>
        state.beginQueryEvaluation(request).pipe(
          Effect.tap(() => TestClock.adjust(Duration.nanos(8_500_000n))),
        ),
    });
    const system = await buildSystem([
      successfulStep(source.initialAuthority.authorityWitness),
    ], { source, state, stateForCoordinator: advancedState });

    const outcome = await runEffect(Effect.gen(function* () {
      yield* TestClock.setTime(0);
      return yield* system.sync.beginQuery(descriptor(), {
        ...BUDGET,
        newWorkWindowMilliseconds: 20,
      });
    }).pipe(Effect.provide(TestClock.layer())));
    expect(outcome._tag).toBe("completed");
    const calls = await runEffect(
      system.evaluator.snapshotForConformance(),
    );
    expect(calls[0]?.budget.maximumSettlementMilliseconds).toBe(1);
  });

  it("admits no evaluator call with less than one whole millisecond", async () => {
    const binding = cursor();
    const source = await buildSource(binding);
    const state = await buildState(binding);
    const advancedState: QuerySyncTransitionState = Object.freeze({
      ...state,
      beginQueryEvaluation: (
        request: Parameters<
          QuerySyncTransitionState["beginQueryEvaluation"]
        >[0],
      ) =>
        state.beginQueryEvaluation(request).pipe(
          Effect.tap(() => TestClock.adjust(Duration.nanos(9_000_001n))),
        ),
    });
    const system = await buildSystem([
      successfulStep(source.initialAuthority.authorityWitness),
    ], { source, state, stateForCoordinator: advancedState });

    const outcome = await runEffect(Effect.gen(function* () {
      yield* TestClock.setTime(0);
      return yield* system.sync.beginQuery(descriptor(), {
        ...BUDGET,
        newWorkWindowMilliseconds: 20,
      });
    }).pipe(Effect.provide(TestClock.layer())));
    expect(outcome).toMatchObject({
      _tag: "continuationRequired",
      continuation: { reason: "deadlineReached" },
      progress: { evaluatorCalls: 0 },
    });
    const calls = await runEffect(
      system.evaluator.snapshotForConformance(),
    );
    expect(calls).toHaveLength(0);
  });

  it("does not begin completion when the cutoff arrives after refresh capture", async () => {
    const binding = cursor();
    const source = await buildSource(binding);
    const state = await buildState(binding);
    let completionCalls = 0;
    const countedState: QuerySyncTransitionState = Object.freeze({
      ...state,
      completeQueryEvaluation: (
        attempt: Parameters<
          QuerySyncTransitionState["completeQueryEvaluation"]
        >[0],
        evaluation: Parameters<
          QuerySyncTransitionState["completeQueryEvaluation"]
        >[1],
        refresh: Parameters<
          QuerySyncTransitionState["completeQueryEvaluation"]
        >[2],
        publication: Parameters<
          QuerySyncTransitionState["completeQueryEvaluation"]
        >[3],
      ) => {
        completionCalls += 1;
        return state.completeQueryEvaluation(
          attempt,
          evaluation,
          refresh,
          publication,
        );
      },
    });
    const system = await buildSystem([
      successfulStep(source.initialAuthority.authorityWitness),
    ], { source, state, stateForCoordinator: countedState });
    let clockSteps = 0;
    const clock = steppingClock([
      ...Array.from({ length: 12 }, () => 0n),
      10_000_000n,
    ], () => {
      clockSteps += 1;
    });

    const outcome = await runEffect(system.sync.beginQuery(
      descriptor(),
      { ...BUDGET, newWorkWindowMilliseconds: 20 },
    ).pipe(Effect.provideService(Clock.Clock, clock)));

    expect(outcome).toMatchObject({
      _tag: "continuationRequired",
      continuation: {
        phase: "evaluation",
        reason: "deadlineReached",
        scan: null,
      },
      progress: { evaluatorCalls: 1, completedEvaluations: 0 },
    });
    expect(clockSteps).toBe(13);
    expect(completionCalls).toBe(0);
    const snapshot = await runEffect(state.snapshotForConformance());
    expect(snapshot?.queries[0]?.active).toBeNull();
    expect(snapshot?.queries[0]?.provisional?.generation).toBe(1n);
  });

  it("settles a transient failure when less than one millisecond remains", async () => {
    const system = await buildSystem([
      () => TestClock.adjust(Duration.nanos(9_500_000n)).pipe(
        Effect.andThen(Effect.fail(new QueryEvaluatorUnavailableError({
          operation: "evaluate",
          reason: "temporarilyUnavailable",
          cause: "late-transient",
        }))),
      ),
    ]);

    const outcome = await runEffect(Effect.gen(function* () {
      yield* TestClock.setTime(0);
      return yield* system.sync.beginQuery(descriptor(), {
        ...BUDGET,
        newWorkWindowMilliseconds: 20,
      });
    }).pipe(Effect.provide(TestClock.layer())));
    expect(outcome).toMatchObject({
      _tag: "continuationRequired",
      continuation: { reason: "transientEvaluatorExhausted", scan: null },
      progress: { evaluatorCalls: 1 },
    });
    const snapshot = await runEffect(system.state.snapshotForConformance());
    expect(snapshot?.queries[0]?.provisional?.evaluationDisposition).toEqual({
      _tag: "ready",
    });
  });

  it("fails settlement if the evaluator returns at the turn cutoff", async () => {
    const system = await buildSystem([
      () => TestClock.adjust("20 millis").pipe(
        Effect.andThen(Effect.fail(new QueryEvaluatorUnavailableError({
          operation: "evaluate",
          reason: "temporarilyUnavailable",
          cause: "late",
        }))),
      ),
    ]);

    const failure = await runEffect(Effect.gen(function* () {
      yield* TestClock.setTime(0);
      return yield* Effect.flip(system.sync.beginQuery(descriptor(), {
        ...BUDGET,
        newWorkWindowMilliseconds: 20,
      }));
    }).pipe(Effect.provide(TestClock.layer())));
    expect(failure).toEqual(new EvaluationOutcomeSettlementDeadlineError({
      operation: "recordEvaluationAttemptOutcome",
      reason: "settlementWindowElapsed",
      queryKey: descriptor().queryKey,
      generation: getSuccess(captureQueryGeneration(1n)),
      outcome: "transientExhausted",
    }));
  });

  it("retries outcome settlement inside the reserved window", async () => {
    const binding = cursor();
    const source = await buildSource(binding);
    const state = await buildState(binding);
    const entered = await runEffect(Deferred.make<void>());
    let outcomeCalls = 0;
    const retryingState: QuerySyncTransitionState = Object.freeze({
      ...state,
      recordEvaluationAttemptOutcome: (
        attempt: Parameters<
          QuerySyncTransitionState["recordEvaluationAttemptOutcome"]
        >[0],
        outcome: Parameters<
          QuerySyncTransitionState["recordEvaluationAttemptOutcome"]
        >[1],
      ) => {
        outcomeCalls += 1;
        return outcomeCalls === 1
          ? Deferred.succeed(entered, undefined).pipe(
            Effect.andThen(Effect.fail(new QuerySyncStateUnavailableError({
              operation: "recordEvaluationAttemptOutcome",
              commitCertainty: "notCommitted",
              reason: "temporarilyUnavailable",
              cause: null,
            }))),
          )
          : state.recordEvaluationAttemptOutcome(attempt, outcome);
      },
    });
    const retryDelays: readonly [number, number] = Object.freeze([9, 0]);
    const system = await buildSystem([
      () => TestClock.adjust("10 millis").pipe(
        Effect.andThen(Effect.fail(new QueryEvaluatorUnavailableError({
          operation: "evaluate",
          reason: "temporarilyUnavailable",
          cause: "injected",
        }))),
      ),
    ], {
      source,
      state,
      stateForCoordinator: retryingState,
      policy: { ...POLICY, retryDelayMilliseconds: retryDelays },
    });

    const outcome = await runEffect(Effect.gen(function* () {
      yield* TestClock.setTime(0);
      const fiber = yield* Effect.forkChild(system.sync.beginQuery(
        descriptor(),
        { ...BUDGET, evaluatorCallsPerQuery: 1, newWorkWindowMilliseconds: 20 },
      ));
      yield* Deferred.await(entered);
      yield* TestClock.adjust("9 millis");
      return yield* Fiber.join(fiber);
    }).pipe(Effect.provide(TestClock.layer())));
    expect(outcome).toMatchObject({
      _tag: "continuationRequired",
      continuation: { reason: "transientEvaluatorExhausted" },
    });
    expect(outcomeCalls).toBe(2);
  });

  it("refuses an outcome-settlement retry ending at the turn cutoff", async () => {
    const binding = cursor();
    const source = await buildSource(binding);
    const state = await buildState(binding);
    let outcomeCalls = 0;
    const unavailableState: QuerySyncTransitionState = Object.freeze({
      ...state,
      recordEvaluationAttemptOutcome: () => {
        outcomeCalls += 1;
        return Effect.fail(new QuerySyncStateUnavailableError({
          operation: "recordEvaluationAttemptOutcome",
          commitCertainty: "notCommitted",
          reason: "temporarilyUnavailable",
          cause: null,
        }));
      },
    });
    const retryDelays: readonly [number, number] = Object.freeze([10, 0]);
    const system = await buildSystem([
      () => TestClock.adjust("10 millis").pipe(
        Effect.andThen(Effect.fail(new QueryEvaluatorUnavailableError({
          operation: "evaluate",
          reason: "temporarilyUnavailable",
          cause: "injected",
        }))),
      ),
    ], {
      source,
      state,
      stateForCoordinator: unavailableState,
      policy: { ...POLICY, retryDelayMilliseconds: retryDelays },
    });

    const failure = await runEffect(Effect.gen(function* () {
      yield* TestClock.setTime(0);
      return yield* Effect.flip(system.sync.beginQuery(
        descriptor(),
        { ...BUDGET, evaluatorCallsPerQuery: 1, newWorkWindowMilliseconds: 20 },
      ));
    }).pipe(Effect.provide(TestClock.layer())));
    expect(failure).toMatchObject({
      _tag: "QuerySyncStateUnavailableError",
      operation: "recordEvaluationAttemptOutcome",
    });
    expect(outcomeCalls).toBe(1);
  });

  it("records terminal refusal before returning durable blocked evidence", async () => {
    const system = await buildSystem([
      () => Effect.fail(new QueryEvaluatorRefusedError({
        operation: "evaluate",
        reason: "terminalRefusal",
        cause: "injected",
      })),
    ]);

    const outcome = await runEffect(system.sync.beginQuery(
      descriptor(),
      BUDGET,
    ));
    expect(outcome).toMatchObject({
      _tag: "evaluationBlocked",
      blockedWork: {
        generation: 1n,
        reason: "terminalEvaluatorRefusal",
        resetRequired: true,
      },
      progress: { evaluatorCalls: 1, blockedEvaluations: 1 },
    });
    const snapshot = await runEffect(system.state.snapshotForConformance());
    expect(snapshot?.queries[0]?.provisional?.evaluationDisposition).toEqual({
      _tag: "blocked",
      reason: "terminalEvaluatorRefusal",
      resetRequired: true,
    });
  });

  it("maps a competing durable block over a transient evaluator outcome", async () => {
    const binding = cursor();
    const source = await buildSource(binding);
    const state = await buildState(binding);
    const entered = await runEffect(Deferred.make<void>());
    const release = await runEffect(Deferred.make<void>());
    const system = await buildSystem([
      () => Deferred.succeed(entered, undefined).pipe(
        Effect.andThen(Deferred.await(release)),
        Effect.andThen(Effect.fail(new QueryEvaluatorUnavailableError({
          operation: "evaluate",
          reason: "temporarilyUnavailable",
          cause: "injected",
        }))),
      ),
    ], { source, state });

    const outcome = await runEffect(Effect.gen(function* () {
      const fiber = yield* Effect.forkChild(system.sync.beginQuery(
        descriptor(),
        { ...BUDGET, evaluatorCallsPerQuery: 1 },
      ));
      yield* Deferred.await(entered);
      const claim = yield* state.claimEvaluationWork({
        maximumQueryInspections: 4_096,
        continuation: null,
      });
      if (claim._tag !== "claimed") {
        return yield* Effect.die("Expected the pending evaluation attempt");
      }
      const blocked = yield* state.recordEvaluationAttemptOutcome(
        claim.attempt,
        "terminalRefusal",
      );
      if (blocked._tag !== "blocked") {
        return yield* Effect.die("Expected the competing durable block");
      }
      yield* Deferred.succeed(release, undefined);
      return yield* Fiber.join(fiber);
    }));
    expect(outcome).toMatchObject({
      _tag: "evaluationBlocked",
      blockedWork: {
        generation: 1n,
        reason: "terminalEvaluatorRefusal",
        resetRequired: true,
      },
      progress: { evaluatorCalls: 1, blockedEvaluations: 1 },
    });
  });

  it.each(["beforeSwap", "afterSwap"] as const)(
    "recovers a %s terminal-outcome fault with exact call arguments",
    async (timing) => {
      const binding = cursor();
      const source = await buildSource(binding);
      const state = await buildState(binding);
      const outcomeCalls: Array<Parameters<
        QuerySyncTransitionState["recordEvaluationAttemptOutcome"]
      >> = [];
      const countedState: QuerySyncTransitionState = Object.freeze({
        ...state,
        recordEvaluationAttemptOutcome: (
          attempt: Parameters<
            QuerySyncTransitionState["recordEvaluationAttemptOutcome"]
          >[0],
          outcome: Parameters<
            QuerySyncTransitionState["recordEvaluationAttemptOutcome"]
          >[1],
        ) => {
          outcomeCalls.push([attempt, outcome]);
          return state.recordEvaluationAttemptOutcome(attempt, outcome);
        },
      });
      await runEffect(state.injectNextFault({
        operation: "recordEvaluationAttemptOutcome",
        timing,
      }));
      const system = await buildSystem([
        () => Effect.fail(new QueryEvaluatorRefusedError({
          operation: "evaluate",
          reason: "terminalRefusal",
          cause: "injected",
        })),
      ], { source, state, stateForCoordinator: countedState });

      const outcome = await runEffect(system.sync.beginQuery(
        descriptor(),
        BUDGET,
      ));
      expect(outcome._tag).toBe("evaluationBlocked");
      expect(outcomeCalls).toHaveLength(2);
      expect(outcomeCalls[0]?.[0]).toBe(outcomeCalls[1]?.[0]);
      expect(outcomeCalls[0]?.[1]).toBe(outcomeCalls[1]?.[1]);
    },
  );

  it("treats terminal eligible settlement as an invariant defect", async () => {
    const binding = cursor();
    const source = await buildSource(binding);
    const state = await buildState(binding);
    const invalidState: QuerySyncTransitionState = Object.freeze({
      ...state,
      recordEvaluationAttemptOutcome: (
        attempt: Parameters<
          QuerySyncTransitionState["recordEvaluationAttemptOutcome"]
        >[0],
      ) => Effect.succeed(
        Object.freeze({
          _tag: "eligible",
          queryKey: attempt.descriptor.queryKey,
          generation: attempt.generation,
        }),
      ),
    });
    const system = await buildSystem([
      () => Effect.fail(new QueryEvaluatorRefusedError({
        operation: "evaluate",
        reason: "terminalRefusal",
        cause: "injected",
      })),
    ], { source, state, stateForCoordinator: invalidState });

    const exit = await runEffect(Effect.exit(system.sync.beginQuery(
      descriptor(),
      BUDGET,
    )));
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(Cause.hasDies(exit.cause)).toBe(true);
    }
  });

  it("records transient exhaustion and lets a new coordinator reclaim with null", async () => {
    const binding = cursor();
    const source = await buildSource(binding);
    const state = await buildState(binding);
    const transient = () => Effect.fail(new QueryEvaluatorUnavailableError({
      operation: "evaluate",
      reason: "temporarilyUnavailable",
      cause: "injected",
    }));
    const first = await buildSystem([transient, transient], { source, state });

    const exhausted = await runEffect(first.sync.beginQuery(
      descriptor(),
      BUDGET,
    ));
    expect(exhausted).toMatchObject({
      _tag: "continuationRequired",
      continuation: { reason: "transientEvaluatorExhausted", scan: null },
      progress: { evaluatorCalls: 2 },
    });

    const second = await buildSystem([
      successfulStep(source.initialAuthority.authorityWitness),
    ], { source, state });
    const recovered = await runEffect(second.sync.runEvaluationWork(
      { continuation: null },
      BUDGET,
    ));
    expect(recovered).toMatchObject({
      _tag: "idle",
      progress: {
        claimedEvaluationAttempts: 1,
        completedEvaluations: 1,
      },
    });
  });

  it("preserves evaluator defects and records no ordinary outcome", async () => {
    const binding = cursor();
    const source = await buildSource(binding);
    const state = await buildState(binding);
    let outcomeRecords = 0;
    const countedState: QuerySyncTransitionState = Object.freeze({
      ...state,
      recordEvaluationAttemptOutcome: (
        attempt: Parameters<
          QuerySyncTransitionState["recordEvaluationAttemptOutcome"]
        >[0],
        outcome: Parameters<
          QuerySyncTransitionState["recordEvaluationAttemptOutcome"]
        >[1],
      ) => {
        outcomeRecords += 1;
        return state.recordEvaluationAttemptOutcome(attempt, outcome);
      },
    });
    const defect = Object.freeze({ defect: "evaluator-bug" });
    const system = await buildSystem([
      () => Effect.die(defect),
    ], { source, state, stateForCoordinator: countedState });

    const exit = await runEffect(Effect.exit(system.sync.beginQuery(
      descriptor(),
      BUDGET,
    )));
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(Cause.hasDies(exit.cause)).toBe(true);
    }
    expect(outcomeRecords).toBe(0);
    const snapshot = await runEffect(state.snapshotForConformance());
    expect(snapshot?.queries[0]?.provisional?.generation).toBe(1n);
  });

  it("preserves evaluator interruption and records no ordinary outcome", async () => {
    const entered = await runEffect(Deferred.make<void>());
    const binding = cursor();
    const source = await buildSource(binding);
    const state = await buildState(binding);
    let outcomeRecords = 0;
    const countedState: QuerySyncTransitionState = Object.freeze({
      ...state,
      recordEvaluationAttemptOutcome: (
        attempt: Parameters<
          QuerySyncTransitionState["recordEvaluationAttemptOutcome"]
        >[0],
        outcome: Parameters<
          QuerySyncTransitionState["recordEvaluationAttemptOutcome"]
        >[1],
      ) => {
        outcomeRecords += 1;
        return state.recordEvaluationAttemptOutcome(attempt, outcome);
      },
    });
    const system = await buildSystem([
      () => Deferred.succeed(entered, undefined).pipe(
        Effect.andThen(Effect.never),
      ),
    ], { source, state, stateForCoordinator: countedState });

    const exit = await runEffect(Effect.gen(function* () {
      const fiber = yield* Effect.forkChild(system.sync.beginQuery(
        descriptor(),
        BUDGET,
      ));
      yield* Deferred.await(entered);
      yield* Fiber.interrupt(fiber);
      return yield* Fiber.await(fiber);
    }));
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(Cause.hasInterruptsOnly(exit.cause)).toBe(true);
    }
    expect(outcomeRecords).toBe(0);
  });

  it("returns already-active without a second evaluator call", async () => {
    const system = await systemWithSuccessfulEvaluation();
    const query = descriptor();
    const first = await runEffect(system.sync.beginQuery(query, BUDGET));
    expect(first._tag).toBe("completed");

    const second = await runEffect(system.sync.beginQuery(query, BUDGET));
    expect(second).toMatchObject({
      _tag: "alreadyActive",
      descriptor: query,
      requestedExpectedActiveGeneration: null,
      activeGeneration: 1n,
    });
    const calls = await runEffect(
      system.evaluator.snapshotForConformance(),
    );
    expect(calls).toHaveLength(1);
  });

  it.each([
    { timing: "beforeSwap", expectedTag: "completed" },
    { timing: "afterSwap", expectedTag: "replayed" },
  ] as const)(
    "recovers a $timing completion fault as $expectedTag with exact call arguments",
    async ({ timing, expectedTag }) => {
      const binding = cursor();
      const source = await buildSource(binding);
      const state = await buildState(binding);
      const completionCalls: Array<Parameters<
        QuerySyncTransitionState["completeQueryEvaluation"]
      >> = [];
      const countedState: QuerySyncTransitionState = Object.freeze({
        ...state,
        completeQueryEvaluation: (
          attempt: Parameters<
            QuerySyncTransitionState["completeQueryEvaluation"]
          >[0],
          evaluation: Parameters<
            QuerySyncTransitionState["completeQueryEvaluation"]
          >[1],
          refresh: Parameters<
            QuerySyncTransitionState["completeQueryEvaluation"]
          >[2],
          publication: Parameters<
            QuerySyncTransitionState["completeQueryEvaluation"]
          >[3],
        ) => {
          completionCalls.push([attempt, evaluation, refresh, publication]);
          return state.completeQueryEvaluation(
            attempt,
            evaluation,
            refresh,
            publication,
          );
        },
      });
      await runEffect(state.injectNextFault({
        operation: "completeQueryEvaluation",
        timing,
      }));
      const system = await buildSystem([
        successfulStep(source.initialAuthority.authorityWitness),
      ], { source, state, stateForCoordinator: countedState });

      const outcome = await runEffect(system.sync.beginQuery(
        descriptor(),
        BUDGET,
      ));
      expect(outcome).toMatchObject({
        _tag: expectedTag,
        progress: timing === "beforeSwap"
          ? { completedEvaluations: 1, replayedEvaluations: 0 }
          : { completedEvaluations: 0, replayedEvaluations: 1 },
      });
      expect(completionCalls).toHaveLength(2);
      for (const argumentIndex of [0, 1, 2, 3] as const) {
        expect(completionCalls[0]?.[argumentIndex]).toBe(
          completionCalls[1]?.[argumentIndex],
        );
      }
    },
  );

  it("completes and replays identical concurrent coordinator candidates", async () => {
    const binding = cursor();
    const source = await buildSource(binding);
    const state = await buildState(binding);
    await runEffect(state.initializeOrInspectNamespace(binding));
    await runEffect(state.beginQueryEvaluation(firstEvaluationRequest()));
    const enteredFirst = await runEffect(Deferred.make<void>());
    const enteredSecond = await runEffect(Deferred.make<void>());
    const release = await runEffect(Deferred.make<void>());
    const coordinatedStep = (
      entered: Deferred.Deferred<void>,
    ): ReferenceQueryEvaluatorStep => (call) =>
      Deferred.succeed(entered, undefined).pipe(
        Effect.andThen(Deferred.await(release)),
        Effect.as(artifactFor(
          call,
          source.initialAuthority.authorityWitness,
          { resultSeed: 86 },
        )),
      );
    const first = await buildSystem([coordinatedStep(enteredFirst)], {
      source,
      state,
    });
    const second = await buildSystem([coordinatedStep(enteredSecond)], {
      source,
      state,
    });

    const outcomes = await runEffect(Effect.gen(function* () {
      const firstFiber = yield* Effect.forkChild(first.sync.runEvaluationWork(
        { continuation: null },
        { ...BUDGET, evaluatedQueries: 1 },
      ));
      const secondFiber = yield* Effect.forkChild(second.sync.runEvaluationWork(
        { continuation: null },
        { ...BUDGET, evaluatedQueries: 1 },
      ));
      yield* Deferred.await(enteredFirst);
      yield* Deferred.await(enteredSecond);
      yield* Deferred.succeed(release, undefined);
      return yield* Effect.all([
        Fiber.join(firstFiber),
        Fiber.join(secondFiber),
      ]);
    }));
    expect(outcomes.map((outcome) => outcome._tag)).toEqual(["idle", "idle"]);
    expect(outcomes.reduce(
      (total, outcome) => total + outcome.progress.completedEvaluations,
      0,
    )).toBe(1);
    expect(outcomes.reduce(
      (total, outcome) => total + outcome.progress.replayedEvaluations,
      0,
    )).toBe(1);
  });

  it("preserves the winner when concurrent candidates have different fingerprints", async () => {
    const binding = cursor();
    const source = await buildSource(binding);
    const state = await buildState(binding);
    await runEffect(state.initializeOrInspectNamespace(binding));
    await runEffect(state.beginQueryEvaluation(firstEvaluationRequest()));
    const enteredFirst = await runEffect(Deferred.make<void>());
    const enteredSecond = await runEffect(Deferred.make<void>());
    const release = await runEffect(Deferred.make<void>());
    const coordinatedStep = (
      entered: Deferred.Deferred<void>,
      resultSeed: number,
    ): ReferenceQueryEvaluatorStep => (call) =>
      Deferred.succeed(entered, undefined).pipe(
        Effect.andThen(Deferred.await(release)),
        Effect.as(artifactFor(
          call,
          source.initialAuthority.authorityWitness,
          { resultSeed },
        )),
      );
    const first = await buildSystem([coordinatedStep(enteredFirst, 87)], {
      source,
      state,
    });
    const second = await buildSystem([coordinatedStep(enteredSecond, 88)], {
      source,
      state,
    });

    const results = await runEffect(Effect.gen(function* () {
      const firstFiber = yield* Effect.forkChild(Effect.result(
        first.sync.runEvaluationWork(
          { continuation: null },
          { ...BUDGET, evaluatedQueries: 1 },
        ),
      ));
      const secondFiber = yield* Effect.forkChild(Effect.result(
        second.sync.runEvaluationWork(
          { continuation: null },
          { ...BUDGET, evaluatedQueries: 1 },
        ),
      ));
      yield* Deferred.await(enteredFirst);
      yield* Deferred.await(enteredSecond);
      yield* Deferred.succeed(release, undefined);
      return yield* Effect.all([
        Fiber.join(firstFiber),
        Fiber.join(secondFiber),
      ]);
    }));
    const successes = results.filter(Result.isSuccess);
    const failures = results.filter(Result.isFailure);
    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(1);
    expect(failures[0]?.failure).toBeInstanceOf(
      InvalidQueryCompletionReplayError,
    );
    const snapshot = await runEffect(state.snapshotForConformance());
    expect([
      canonicalKey(87),
      canonicalKey(88),
    ]).toContain(snapshot?.queries[0]?.active?.resultDigest);
    expect(snapshot?.publicationWork.pending).toHaveLength(1);
  });

  it("completes two durable provisional queries in one bounded work turn", async () => {
    const binding = cursor();
    const source = await buildSource(binding);
    const state = await buildState(binding);
    await runEffect(state.initializeOrInspectNamespace(binding));
    const firstDescriptor = descriptor({ keySeed: 1, identity: "first" });
    const secondDescriptor = descriptor({ keySeed: 2, identity: "second" });
    await runEffect(state.beginQueryEvaluation(firstEvaluationRequest(target({
      descriptor: firstDescriptor,
    }))));
    await runEffect(state.beginQueryEvaluation(firstEvaluationRequest(target({
      descriptor: secondDescriptor,
    }))));
    let claimCalls = 0;
    const countedState: QuerySyncTransitionState = Object.freeze({
      ...state,
      claimEvaluationWork: (
        request: Parameters<
          QuerySyncTransitionState["claimEvaluationWork"]
        >[0],
      ) => {
        claimCalls += 1;
        return state.claimEvaluationWork(request);
      },
    });
    const system = await buildSystem([
      successfulStep(source.initialAuthority.authorityWitness, {
        resultSeed: 81,
        publication: publicationArtifact("first"),
      }),
      successfulStep(source.initialAuthority.authorityWitness, {
        resultSeed: 82,
        publication: publicationArtifact("second"),
      }),
    ], { source, state, stateForCoordinator: countedState });

    const outcome = await runEffect(system.sync.runEvaluationWork(
      { continuation: null },
      { ...BUDGET, evaluatedQueries: 2 },
    ));
    expect(outcome).toMatchObject({
      _tag: "idle",
      progress: {
        claimedEvaluationAttempts: 2,
        evaluatorCalls: 2,
        completedEvaluations: 2,
      },
    });
    const snapshot = await runEffect(state.snapshotForConformance());
    expect(snapshot?.queries.every((query) => query.active !== null)).toBe(
      true,
    );
    expect(claimCalls).toBe(3);
  });

  it("shares the evaluator-call cap across repeated claims of one attempt", async () => {
    const binding = cursor();
    const source = await buildSource(binding);
    const state = await buildState(binding);
    await runEffect(state.initializeOrInspectNamespace(binding));
    await runEffect(state.beginQueryEvaluation(firstEvaluationRequest()));
    const issuedClaim = await runEffect(state.claimEvaluationWork({
      maximumQueryInspections: 4_096,
      continuation: null,
    }));
    if (issuedClaim._tag !== "claimed") {
      throw new Error("Expected a claimed provisional in the test fixture");
    }
    let claimCalls = 0;
    const repeatedState: QuerySyncTransitionState = Object.freeze({
      ...state,
      claimEvaluationWork: () => {
        claimCalls += 1;
        return Effect.succeed(
          claimCalls <= 2 ? issuedClaim : Object.freeze({ _tag: "none" }),
        );
      },
      completeQueryEvaluation: () => Effect.succeed(Object.freeze({
        _tag: "superseded",
        generation: issuedClaim.attempt.generation,
        activeGeneration: issuedClaim.attempt.generation,
      })),
    });
    const system = await buildSystem([
      successfulStep(source.initialAuthority.authorityWitness, {
        resultSeed: 88,
      }),
      successfulStep(source.initialAuthority.authorityWitness, {
        resultSeed: 89,
      }),
    ], { source, state, stateForCoordinator: repeatedState });

    const outcome = await runEffect(system.sync.runEvaluationWork(
      { continuation: null },
      { ...BUDGET, evaluatedQueries: 2 },
    ));
    expect(outcome).toMatchObject({
      _tag: "idle",
      progress: {
        claimedEvaluationAttempts: 2,
        evaluatorCalls: 2,
        supersededEvaluations: 2,
      },
    });
    const calls = await runEffect(system.evaluator.snapshotForConformance());
    expect(calls.map((call) => (
      call.budget.remainingEvaluatorCallsIncludingThisCall
    ))).toEqual([2, 1]);
  });

  it("does not evaluate the terminal claim beyond the query budget", async () => {
    const binding = cursor();
    const source = await buildSource(binding);
    const state = await buildState(binding);
    await runEffect(state.initializeOrInspectNamespace(binding));
    for (const [keySeed, identity] of [
      [1, "first"],
      [2, "second"],
      [3, "third"],
    ] as const) {
      await runEffect(state.beginQueryEvaluation(firstEvaluationRequest(target({
        descriptor: descriptor({ keySeed, identity }),
      }))));
    }
    let claimCalls = 0;
    const countedState: QuerySyncTransitionState = Object.freeze({
      ...state,
      claimEvaluationWork: (
        request: Parameters<
          QuerySyncTransitionState["claimEvaluationWork"]
        >[0],
      ) => {
        claimCalls += 1;
        return state.claimEvaluationWork(request);
      },
    });
    const system = await buildSystem([
      successfulStep(source.initialAuthority.authorityWitness, {
        resultSeed: 91,
      }),
      successfulStep(source.initialAuthority.authorityWitness, {
        resultSeed: 92,
      }),
    ], { source, state, stateForCoordinator: countedState });

    const outcome = await runEffect(system.sync.runEvaluationWork(
      { continuation: null },
      { ...BUDGET, evaluatedQueries: 2 },
    ));
    expect(outcome).toMatchObject({
      _tag: "continuationRequired",
      continuation: { reason: "evaluatedQueryLimitReached", scan: null },
      progress: {
        claimedEvaluationAttempts: 3,
        evaluatorCalls: 2,
        completedEvaluations: 2,
      },
    });
    expect(claimCalls).toBe(3);
    const snapshot = await runEffect(state.snapshotForConformance());
    expect(snapshot?.queries.filter((query) => query.active !== null)).toHaveLength(
      2,
    );
  });

  it.each(["beforeSwap", "afterSwap"] as const)(
    "applies the %s claim recovery contract",
    async (timing) => {
      const binding = cursor();
      const source = await buildSource(binding);
      const state = await buildState(binding);
      await runEffect(state.initializeOrInspectNamespace(binding));
      await runEffect(state.beginQueryEvaluation(firstEvaluationRequest()));
      await runEffect(state.injectNextFault({
        operation: "claimEvaluationWork",
        timing,
      }));
      const requests: Array<Parameters<
        QuerySyncTransitionState["claimEvaluationWork"]
      >[0]> = [];
      const countedState: QuerySyncTransitionState = Object.freeze({
        ...state,
        claimEvaluationWork: (
          request: Parameters<
            QuerySyncTransitionState["claimEvaluationWork"]
          >[0],
        ) => {
          requests.push(request);
          return state.claimEvaluationWork(request);
        },
      });
      const system = await buildSystem([
        successfulStep(source.initialAuthority.authorityWitness),
      ], { source, state, stateForCoordinator: countedState });

      if (timing === "afterSwap") {
        const failure = await runEffectFailure(system.sync.runEvaluationWork(
          { continuation: null },
          { ...BUDGET, evaluatedQueries: 1 },
        ));
        expect(failure).toMatchObject({
          _tag: "QuerySyncStateCommitOutcomeUnknownError",
          operation: "claimEvaluationWork",
          commitCertainty: "unknown",
        });
        expect(requests).toHaveLength(1);

        const recovered = await runEffect(system.sync.runEvaluationWork(
          { continuation: null },
          { ...BUDGET, evaluatedQueries: 1 },
        ));
        expect(recovered).toMatchObject({
          _tag: "idle",
          progress: { completedEvaluations: 1 },
        });
        expect(requests[1]).not.toBe(requests[0]);
        return;
      }

      const outcome = await runEffect(system.sync.runEvaluationWork(
        { continuation: null },
        { ...BUDGET, evaluatedQueries: 1 },
      ));
      expect(outcome._tag).toBe("idle");
      expect(requests).toHaveLength(3);
      expect(requests[0]).toBe(requests[1]);
      expect(requests[2]).not.toBe(requests[1]);
    },
  );

  it("returns the exact restarted scan capability after revision churn", async () => {
    const binding = cursor();
    const source = await buildSource(binding);
    const state = await buildState(binding);
    await runEffect(state.initializeOrInspectNamespace(binding));
    await runEffect(state.beginQueryEvaluation(firstEvaluationRequest()));
    const claim = await runEffect(state.claimEvaluationWork({
      maximumQueryInspections: 4_096,
      continuation: null,
    }));
    if (claim._tag !== "claimed") {
      throw new Error("Expected a claimed provisional in the test fixture");
    }
    const changed = await runEffect(state.beginQueryEvaluation(
      firstEvaluationRequest(target({
        descriptor: descriptor({ keySeed: 2, identity: "revision-change" }),
      })),
    ));
    expect(changed._tag).toBe("created");
    const system = await buildSystem([], { source, state });

    const outcome = await runEffect(system.sync.runEvaluationWork({
      continuation: claim.continuation,
    }, BUDGET));
    expect(outcome).toMatchObject({
      _tag: "continuationRequired",
      continuation: { reason: "scanRestarted" },
      progress: { evaluatorCalls: 0 },
    });
    if (outcome._tag === "continuationRequired") {
      expect(outcome.continuation.scan).not.toBe(claim.continuation);
    }
  });

  it("keeps the exact attempt identity in the scripted evaluator", async () => {
    const binding = cursor();
    const source = await buildSource(binding);
    let observedAttempt: QueryEvaluationAttempt | null = null;
    const system = await buildSystem([
      (call) => {
        observedAttempt = call.attempt;
        return Effect.succeed(artifactFor(
          call,
          source.initialAuthority.authorityWitness,
        ));
      },
    ], { source });
    await runEffect(system.sync.beginQuery(descriptor(), BUDGET));
    const calls = await runEffect(
      system.evaluator.snapshotForConformance(),
    );
    expect(observedAttempt).toBe(calls[0]?.attempt);
    expect(Object.isFrozen(calls)).toBe(true);
    expect(Object.isFrozen(calls[0]?.budget)).toBe(true);
  });
});
