import { Result } from "effect";
import { describe, expect, it } from "vitest";

import {
  applyAdmittedInvalidations,
  beginQueryEvaluation,
  captureCanonicalDependencyKey,
  captureQueryGeneration,
  completeQueryEvaluation,
  createEmptyQuerySyncState,
  InvalidQueryEvaluationRequestError,
  makeQueryPublicationIdentity,
  MAX_QUERY_GENERATION,
  QueryGenerationExhaustedError,
  QueryKeyCollisionError,
  QuerySyncEpochMismatchError,
  QuerySyncNamespaceMismatchError,
  unchangedPublicationDisposition,
} from "@flarex/query-sync/internal/kernel";
import type {
  ActiveQueryState,
  GenerationRefreshEvidence,
  QueryCompletionFingerprint,
  QueryEvaluationAttempt,
  QueryEvaluationEvidence,
  QueryPublicationArtifact,
  QueryState,
  QuerySyncState,
} from "@flarex/query-sync/internal/kernel";
import {
  deriveGenerationRefreshEvidence,
} from "@flarex/query-sync/testing/reference-model";

import {
  batch,
  buildTestReferenceModel,
  canonicalText,
  cursor,
  descriptor,
  evaluation,
  firstEvaluationRequest,
  getEvaluationAttempt,
  getSuccess,
  publicationArtifact,
  rerunEvaluationRequest,
  target,
  witness,
} from "./fixtures.js";

interface CompletedInitialQueryFixture {
  readonly state: QuerySyncState;
  readonly attempt: QueryEvaluationAttempt;
  readonly evaluation: QueryEvaluationEvidence;
  readonly refresh: GenerationRefreshEvidence;
  readonly publication: QueryPublicationArtifact;
}

function emptyState(sequence = 0n): QuerySyncState {
  return getSuccess(createEmptyQuerySyncState(cursor({ sequence })));
}

function completeInitialQueryFixture(input: {
  readonly sequence?: bigint;
  readonly dependencies?: readonly string[];
  readonly resultSeed?: number;
  readonly publicationContent?: string;
} = {}): CompletedInitialQueryFixture {
  const initial = emptyState(input.sequence ?? 0n);
  const begun = getSuccess(beginQueryEvaluation(
    initial,
    firstEvaluationRequest(),
  ));
  const attempt = getEvaluationAttempt(begun);
  const evidence = evaluation({
    descriptor: attempt.descriptor,
    generation: attempt.generation,
    snapshot: input.sequence ?? 0n,
    ...(input.resultSeed === undefined
      ? {}
      : { resultSeed: input.resultSeed }),
    ...(input.dependencies === undefined
      ? {}
      : { dependencies: input.dependencies }),
  });
  const refresh = getSuccess(deriveGenerationRefreshEvidence(
    evidence,
    begun.state.cursor,
    [],
    evidence.authorityWitness,
  ));
  const publication = publicationArtifact(
    input.publicationContent ?? "initial-publication",
  );
  const completed = getSuccess(completeQueryEvaluation(
    begun.state,
    attempt,
    evidence,
    refresh,
    publication,
  ));
  if (completed._tag !== "completed") {
    throw new Error("Expected initial evaluation to complete");
  }
  return Object.freeze({
    state: completed.state,
    attempt,
    evaluation: evidence,
    refresh,
    publication,
  });
}

function completeInitialQuery(input: {
  readonly sequence?: bigint;
  readonly dependencies?: readonly string[];
  readonly resultSeed?: number;
} = {}): QuerySyncState {
  return completeInitialQueryFixture(input).state;
}

function dirtyActiveQuery(
  state: QuerySyncState,
  dependency: string,
  sequence: bigint,
): QuerySyncState {
  const applied = getSuccess(applyAdmittedInvalidations(
    state,
    batch({ sequence, dependencies: [dependency] }),
  ));
  if (applied._tag !== "applied") {
    throw new Error("Expected exact-next invalidation");
  }
  return applied.state;
}

function rerunRequestFor(state: QuerySyncState) {
  const active = state.queries[0]?.active;
  if (active === null || active === undefined) {
    throw new Error("Expected active query state");
  }
  if (active.dirtyThroughSequence === null) {
    throw new Error("Expected a durable dirty frontier");
  }
  return rerunEvaluationRequest({
    activeGeneration: active.generation,
    dirtyThroughSequence: active.dirtyThroughSequence,
  });
}

function buildCompletedStateAtGeneration(
  generationValue: bigint,
): QuerySyncState {
  const stateCursor = cursor({ sequence: 2n });
  const registrationCursor = cursor({ sequence: 1n });
  const queryDescriptor = descriptor();
  const captured = evaluation({
    descriptor: queryDescriptor,
    generation: generationValue,
    snapshot: 1n,
  });
  const precedingGeneration = getSuccess(captureQueryGeneration(
    generationValue - 1n,
  ));
  const identity = makeQueryPublicationIdentity({
    namespaceId: stateCursor.namespaceId,
    syncModelId: stateCursor.syncModelId,
    sourceEpoch: stateCursor.sourceEpoch,
    queryKey: queryDescriptor.queryKey,
    generation: captured.generation,
  });
  const precedingIdentity = makeQueryPublicationIdentity({
    namespaceId: stateCursor.namespaceId,
    syncModelId: stateCursor.syncModelId,
    sourceEpoch: stateCursor.sourceEpoch,
    queryKey: queryDescriptor.queryKey,
    generation: precedingGeneration,
  });
  const active: ActiveQueryState = {
    generation: captured.generation,
    evaluationSnapshotSequence: captured.snapshotSequence,
    freshThroughSequence: registrationCursor.appliedThroughSequence,
    dirtyThroughSequence: stateCursor.appliedThroughSequence,
    resultDigest: captured.resultDigest,
    authorityWitness: captured.authorityWitness,
    dependencyKeys: captured.dependencyKeys,
  };
  const completion: QueryCompletionFingerprint = {
    identity,
    queryIdentity: queryDescriptor.queryIdentity,
    expectedActiveGeneration: precedingGeneration,
    registrationCursor,
    requestedDirtyThroughSequence:
      registrationCursor.appliedThroughSequence,
    evaluationSnapshotSequence: captured.snapshotSequence,
    evaluationDependencyKeys: captured.dependencyKeys,
    evaluationAuthorityWitness: captured.authorityWitness,
    refreshedThroughSequence: registrationCursor.appliedThroughSequence,
    relevantThroughSequence: null,
    refreshAuthorityWitness: captured.authorityWitness,
    resultDigest: captured.resultDigest,
    publicationDisposition: unchangedPublicationDisposition(),
  };
  const query: QueryState = {
    descriptor: queryDescriptor,
    active,
    provisional: null,
    currentCompletion: completion,
    precedingCompletionIdentity: precedingIdentity,
  };
  return buildTestReferenceModel(stateCursor, [query]).state;
}

describe("query generation policy", () => {
  it("allocates generation one and exactly replays a provisional begin", () => {
    const initial = emptyState();
    const request = firstEvaluationRequest();
    const first = getSuccess(beginQueryEvaluation(initial, request));
    const firstAttempt = getEvaluationAttempt(first);
    expect(first).toMatchObject({
      _tag: "created",
      attempt: {
        generation: 1n,
        expectedActiveGeneration: null,
        requestedDirtyThroughSequence: null,
      },
    });
    expect(first.state).not.toBe(initial);
    expect(initial.queries).toEqual([]);

    const replay = getSuccess(beginQueryEvaluation(first.state, request));
    const replayedAttempt = getEvaluationAttempt(replay);
    expect(replay).toMatchObject({
      _tag: "replayed",
      attempt: { generation: 1n },
    });
    expect(replay.state).toBe(first.state);
    expect(replayedAttempt).toEqual(firstAttempt);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(firstAttempt)).toBe(true);
    expect(Object.isFrozen(first.state)).toBe(true);
  });

  it("retains active state while allocating a durably requested rerun", () => {
    const dependency = canonicalText("kv:key-a");
    const activeState = completeInitialQuery({ dependencies: [dependency] });
    const dirtyState = dirtyActiveQuery(activeState, dependency, 1n);
    const activeBefore = dirtyState.queries[0]?.active;
    const begun = getSuccess(beginQueryEvaluation(
      dirtyState,
      rerunRequestFor(dirtyState),
    ));
    const attempt = getEvaluationAttempt(begun);

    expect(begun).toMatchObject({ _tag: "created" });
    expect(attempt).toMatchObject({
      generation: 2n,
      expectedActiveGeneration: 1n,
      requestedDirtyThroughSequence: 1n,
    });
    expect(begun.state.queries[0]?.active).toEqual(activeBefore);
    expect(begun.state.queries[0]?.provisional).toMatchObject({
      generation: 2n,
      expectedActiveGeneration: 1n,
      requestedDirtyThroughSequence: 1n,
      registrationCursor: dirtyState.cursor,
    });
    expect(activeState.queries[0]?.provisional).toBeNull();
  });

  it("requires a dependency invalidation before admitting a rerun", () => {
    const dependency = canonicalText("kv:key-a");
    const activeState = completeInitialQuery({ dependencies: [dependency] });
    const activeGeneration = activeState.queries[0]?.active?.generation;
    if (activeGeneration === undefined) {
      throw new Error("Expected active query state");
    }
    const missingFrontier = beginQueryEvaluation(activeState, {
      target: target(),
      expectedActiveGeneration: activeGeneration,
      requestedDirtyThroughSequence: null,
    });
    expect(Result.isFailure(missingFrontier)).toBe(true);
    if (Result.isFailure(missingFrontier)) {
      expect(missingFrontier.failure).toBeInstanceOf(
        InvalidQueryEvaluationRequestError,
      );
      expect(missingFrontier.failure).toMatchObject({
        reason: "rerunMissingDirtyFrontier",
      });
    }

    const cursorOnly = getSuccess(applyAdmittedInvalidations(
      activeState,
      batch({
        sequence: 1n,
        dependencies: [canonicalText("unrelated")],
      }),
    ));
    const unobservedFrontier = beginQueryEvaluation(
      cursorOnly.state,
      rerunEvaluationRequest({
        activeGeneration,
        dirtyThroughSequence: cursorOnly.state.cursor.appliedThroughSequence,
      }),
    );
    expect(Result.isFailure(unobservedFrontier)).toBe(true);
    if (Result.isFailure(unobservedFrontier)) {
      expect(unobservedFrontier.failure).toMatchObject({
        _tag: "InvalidQueryEvaluationRequestError",
        reason: "dirtyFrontierNotObserved",
      });
    }
    expect(activeState.queries[0]?.provisional).toBeNull();
    expect(cursorOnly.state.queries[0]?.provisional).toBeNull();
  });

  it("replays a provisional rerun from its latest durable dirty frontier", () => {
    const dependency = canonicalText("kv:key-a");
    const activeState = completeInitialQuery({
      sequence: 1n,
      dependencies: [dependency],
    });
    const firstDirty = dirtyActiveQuery(activeState, dependency, 2n);
    const firstBegin = getSuccess(beginQueryEvaluation(
      firstDirty,
      rerunRequestFor(firstDirty),
    ));
    const firstAttempt = getEvaluationAttempt(firstBegin);
    const laterDirty = dirtyActiveQuery(firstBegin.state, dependency, 3n);
    const active = laterDirty.queries[0]?.active;
    if (active === null || active === undefined) {
      throw new Error("Expected active query state");
    }
    const replay = getSuccess(beginQueryEvaluation(
      laterDirty,
      rerunEvaluationRequest({
        activeGeneration: active.generation,
        dirtyThroughSequence: active.freshThroughSequence,
      }),
    ));
    const replayedAttempt = getEvaluationAttempt(replay);

    expect(firstAttempt.requestedDirtyThroughSequence).toBe(2n);
    expect(active.freshThroughSequence).toBe(1n);
    expect(active.dirtyThroughSequence).toBe(3n);
    expect(replay._tag).toBe("replayed");
    expect(replayedAttempt.generation).toBe(firstAttempt.generation);
    expect(replayedAttempt.requestedDirtyThroughSequence).toBe(3n);
  });

  it("refuses the same lookup key with a different full identity", () => {
    const initial = emptyState();
    const firstTarget = target();
    const begun = getSuccess(beginQueryEvaluation(
      initial,
      firstEvaluationRequest(firstTarget),
    ));
    const collisionTarget = target({
      descriptor: descriptor({
        keySeed: 1,
        identity: "different-query",
      }),
    });
    const collision = beginQueryEvaluation(
      begun.state,
      firstEvaluationRequest(collisionTarget),
    );

    expect(Result.isFailure(collision)).toBe(true);
    if (Result.isFailure(collision)) {
      expect(collision.failure).toBeInstanceOf(QueryKeyCollisionError);
    }
    expect(begun.state.queries[0]?.descriptor).toEqual(firstTarget.descriptor);
  });

  it("refuses wrong namespace and epoch before changing state", () => {
    const initial = emptyState();
    const wrongNamespace = beginQueryEvaluation(
      initial,
      firstEvaluationRequest(target({ namespaceId: "tenant-b" })),
    );
    expect(Result.isFailure(wrongNamespace)).toBe(true);
    if (Result.isFailure(wrongNamespace)) {
      expect(wrongNamespace.failure).toBeInstanceOf(
        QuerySyncNamespaceMismatchError,
      );
    }

    const wrongEpoch = beginQueryEvaluation(
      initial,
      firstEvaluationRequest(target({ sourceEpoch: "epoch-b" })),
    );
    expect(Result.isFailure(wrongEpoch)).toBe(true);
    if (Result.isFailure(wrongEpoch)) {
      expect(wrongEpoch.failure).toBeInstanceOf(QuerySyncEpochMismatchError);
    }
    expect(initial.queries).toEqual([]);
  });

  it("refuses an evaluation snapshot older than registration", () => {
    const initial = emptyState(5n);
    const begun = getSuccess(beginQueryEvaluation(
      initial,
      firstEvaluationRequest(),
    ));
    const attempt = getEvaluationAttempt(begun);
    const staleEvaluation = evaluation({
      descriptor: attempt.descriptor,
      generation: attempt.generation,
      snapshot: 4n,
    });
    const refresh = getSuccess(deriveGenerationRefreshEvidence(
      staleEvaluation,
      begun.state.cursor,
      [batch({ sequence: 5n })],
      staleEvaluation.authorityWitness,
    ));
    const result = completeQueryEvaluation(
      begun.state,
      attempt,
      staleEvaluation,
      refresh,
      publicationArtifact(),
    );

    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure).toMatchObject({
        _tag: "InvalidQueryEvidenceError",
        reason: "snapshotBeforeRegistration",
      });
    }
    expect(begun.state.queries[0]?.provisional?.generation).toBe(1n);
  });

  it("classifies exact stale completion evidence as superseded", () => {
    const dependency = canonicalText("kv:key-a");
    const first = completeInitialQueryFixture({ dependencies: [dependency] });
    const dirty = dirtyActiveQuery(first.state, dependency, 1n);
    const secondBegin = getSuccess(beginQueryEvaluation(
      dirty,
      rerunRequestFor(dirty),
    ));
    const secondAttempt = getEvaluationAttempt(secondBegin);
    const secondEvaluation = evaluation({
      descriptor: secondAttempt.descriptor,
      generation: secondAttempt.generation,
      snapshot: 1n,
      resultSeed: 81,
      dependencies: [dependency],
    });
    const secondRefresh = getSuccess(deriveGenerationRefreshEvidence(
      secondEvaluation,
      secondBegin.state.cursor,
      [],
      secondEvaluation.authorityWitness,
    ));
    const secondCompleted = getSuccess(completeQueryEvaluation(
      secondBegin.state,
      secondAttempt,
      secondEvaluation,
      secondRefresh,
      publicationArtifact("second-publication"),
    ));
    expect(secondCompleted._tag).toBe("completed");

    const stale = getSuccess(completeQueryEvaluation(
      secondCompleted.state,
      first.attempt,
      first.evaluation,
      first.refresh,
      first.publication,
    ));

    expect(stale).toMatchObject({
      _tag: "superseded",
      generation: 1n,
      activeGeneration: 2n,
    });
    expect(stale.state).toBe(secondCompleted.state);
  });

  it("refuses generation overflow while retaining the installed active value", () => {
    const nearMaxState = buildCompletedStateAtGeneration(
      MAX_QUERY_GENERATION - 1n,
    );
    const maximumBegin = getSuccess(beginQueryEvaluation(
      nearMaxState,
      rerunRequestFor(nearMaxState),
    ));
    const maximumAttempt = getEvaluationAttempt(maximumBegin);
    expect(maximumBegin._tag).toBe("created");
    expect(maximumAttempt.generation).toBe(MAX_QUERY_GENERATION);

    const maximumState = buildCompletedStateAtGeneration(
      MAX_QUERY_GENERATION,
    );
    const result = beginQueryEvaluation(
      maximumState,
      rerunRequestFor(maximumState),
    );

    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure).toBeInstanceOf(QueryGenerationExhaustedError);
      expect(result.failure).toMatchObject({
        currentGeneration: MAX_QUERY_GENERATION,
      });
    }
    expect(maximumState.queries[0]?.active?.generation).toBe(
      MAX_QUERY_GENERATION,
    );
  });

  it("keeps a provisional generation after resnapshot is required", () => {
    const initial = emptyState();
    const begun = getSuccess(beginQueryEvaluation(
      initial,
      firstEvaluationRequest(),
    ));
    const attempt = getEvaluationAttempt(begun);
    const evidence = evaluation({
      descriptor: attempt.descriptor,
      generation: attempt.generation,
      snapshot: 0n,
      witnessSeed: 10,
    });
    const refresh = getSuccess(deriveGenerationRefreshEvidence(
      evidence,
      begun.state.cursor,
      [],
      witness(11),
    ));
    const decision = getSuccess(completeQueryEvaluation(
      begun.state,
      attempt,
      evidence,
      refresh,
      publicationArtifact(),
    ));

    expect(decision._tag).toBe("resnapshotRequired");
    expect(decision.state).toBe(begun.state);
    expect(decision.state.queries[0]?.provisional?.generation).toBe(1n);
  });

  it("does not alias caller-owned active dependency arrays in test models", () => {
    const dependencyKeys = [canonicalText("a")];
    const completed = completeInitialQueryFixture({
      dependencies: dependencyKeys,
    });
    const installed = completed.state.queries[0];
    if (installed?.active === null || installed?.active === undefined) {
      throw new Error("Expected active query state");
    }
    if (installed.currentCompletion === null) {
      throw new Error("Expected completion recovery evidence");
    }
    const callerOwnedActiveDependencies = [
      ...installed.active.dependencyKeys,
    ];
    const callerOwnedCompletionDependencies = [
      ...installed.currentCompletion.evaluationDependencyKeys,
    ];
    const callerQueries: QueryState[] = [{
      descriptor: installed.descriptor,
      active: {
        ...installed.active,
        dependencyKeys: callerOwnedActiveDependencies,
      },
      provisional: installed.provisional,
      currentCompletion: {
        ...installed.currentCompletion,
        evaluationDependencyKeys: callerOwnedCompletionDependencies,
      },
      precedingCompletionIdentity: installed.precedingCompletionIdentity,
    }];
    const model = buildTestReferenceModel(
      completed.state.cursor,
      callerQueries,
      completed.state.publicationWork.pending,
    );

    callerQueries.push({
      descriptor: descriptor({ keySeed: 8 }),
      active: null,
      provisional: null,
      currentCompletion: null,
      precedingCompletionIdentity: null,
    });
    callerOwnedActiveDependencies[0] = getSuccess(
      captureCanonicalDependencyKey(canonicalText("active-mutation")),
    );
    callerOwnedCompletionDependencies[0] = getSuccess(
      captureCanonicalDependencyKey(canonicalText("completion-mutation")),
    );
    dependencyKeys[0] = canonicalText("input-mutation");

    expect(model.state.queries).toHaveLength(1);
    expect(model.state.queries[0]?.active?.dependencyKeys).toEqual([
      canonicalText("a"),
    ]);
    expect(
      model.state.queries[0]?.currentCompletion?.evaluationDependencyKeys,
    ).toEqual([canonicalText("a")]);
    expect(Object.isFrozen(model.state.queries)).toBe(true);
  });
});
