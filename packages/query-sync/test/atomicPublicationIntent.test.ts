import { Result } from "effect";
import { describe, expect, it } from "vitest";

import {
  applyAdmittedInvalidations,
  beginQueryEvaluation,
  captureQueryPublicationArtifact,
  completeQueryEvaluation,
  createEmptyQuerySyncState,
  MAX_CANONICAL_DEPENDENCY_KEY_BYTES,
  MAX_COUNTED_CANONICAL_BYTES,
  MAX_INLINE_PUBLICATION_CONTENT_BYTES,
  MAX_PENDING_PUBLICATIONS,
  MAX_QUERY_DEPENDENCY_BYTES,
  MAX_RETAINED_PUBLICATION_CONTENT_BYTES,
  QuerySyncStateLimitError,
} from "@flarex/query-sync/internal/kernel";
import type {
  CompleteQueryEvaluationDecision,
  QueryEvaluationAttempt,
  QueryEvaluationEvidence,
  PendingQueryPublication,
  QueryPublicationArtifact,
  QueryState,
  QuerySyncState,
} from "@flarex/query-sync/internal/kernel";
import {
  deriveGenerationRefreshEvidence,
} from "@flarex/query-sync/testing/reference-model";

import { QuerySyncInvariantDefect } from "../src/kernel/Errors.js";

import {
  batch,
  buildTestQuerySyncState,
  canonicalBytes,
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
} from "./fixtures.js";

type CompletedDecision = Extract<
  CompleteQueryEvaluationDecision,
  { readonly _tag: "completed" }
>;

interface CompletedQueryFixture {
  readonly stateBeforeCompletion: QuerySyncState;
  readonly attempt: QueryEvaluationAttempt;
  readonly evaluation: QueryEvaluationEvidence;
  readonly publication: QueryPublicationArtifact;
  readonly decision: CompletedDecision;
}

function installNewChangedQuery(input: {
  readonly state?: QuerySyncState;
  readonly keySeed: number;
  readonly resultSeed?: number;
  readonly dependencies?: readonly string[];
  readonly publication?: QueryPublicationArtifact;
}): CompletedQueryFixture {
  const state = input.state
    ?? getSuccess(createEmptyQuerySyncState(cursor()));
  const queryDescriptor = descriptor({
    keySeed: input.keySeed,
    identity: `query-${input.keySeed}`,
  });
  const begun = getSuccess(beginQueryEvaluation(
    state,
    firstEvaluationRequest(target({ descriptor: queryDescriptor })),
  ));
  const attempt = getEvaluationAttempt(begun);
  const queryEvaluation = evaluation({
    descriptor: attempt.descriptor,
    generation: attempt.generation,
    snapshot: attempt.registrationCursor.appliedThroughSequence,
    resultSeed: input.resultSeed ?? 100 + input.keySeed,
    dependencies: input.dependencies ?? [],
  });
  const refresh = getSuccess(deriveGenerationRefreshEvidence(
    queryEvaluation,
    begun.state.cursor,
    [],
    queryEvaluation.authorityWitness,
  ));
  const publication = input.publication
    ?? publicationArtifact(`publication-${input.keySeed}`);
  const decision = getSuccess(completeQueryEvaluation(
    begun.state,
    attempt,
    queryEvaluation,
    refresh,
    publication,
  ));
  if (decision._tag !== "completed") {
    throw new Error(`Expected completion, received ${decision._tag}`);
  }
  return Object.freeze({
    stateBeforeCompletion: begun.state,
    attempt,
    evaluation: queryEvaluation,
    publication,
    decision,
  });
}

function beginDirtyRerun(
  completed: CompletedQueryFixture,
  dependency: string,
): Readonly<{
  state: QuerySyncState;
  attempt: QueryEvaluationAttempt;
}> {
  const activeGeneration = completed.decision.state.queries.find(
    (query) => query.descriptor.queryKey
      === completed.attempt.descriptor.queryKey,
  )?.active?.generation;
  if (activeGeneration === undefined) {
    throw new Error("Expected an installed active generation");
  }
  const invalidation = batch({
    sequence: 1n,
    dependencies: [dependency],
  });
  const dirty = getSuccess(applyAdmittedInvalidations(
    completed.decision.state,
    invalidation,
  ));
  const begun = getSuccess(beginQueryEvaluation(
    dirty.state,
    rerunEvaluationRequest({
      target: target({ descriptor: completed.attempt.descriptor }),
      activeGeneration,
      dirtyThroughSequence: invalidation.sourceSequence,
    }),
  ));
  return Object.freeze({
    state: begun.state,
    attempt: getEvaluationAttempt(begun),
  });
}

function expectStateLimit(
  result: Result.Result<unknown, unknown>,
  dimension: QuerySyncStateLimitError["dimension"],
): void {
  expect(Result.isFailure(result)).toBe(true);
  if (Result.isSuccess(result)) return;
  expect(result.failure).toBeInstanceOf(QuerySyncStateLimitError);
  expect(result.failure).toMatchObject({
    operation: "buildQuerySyncState",
    dimension,
  });
}

function mergeCompletedQueries(
  completions: readonly CompletedQueryFixture[],
): QuerySyncState {
  const queries: QueryState[] = [];
  const pendingPublications = [];
  for (const completion of completions) {
    const query = completion.decision.state.queries[0];
    const pending = completion.decision.state.publicationWork.pending[0];
    if (query === undefined || pending === undefined) {
      throw new Error("Expected one completed query and pending publication");
    }
    queries.push(query);
    pendingPublications.push(pending);
  }
  return getSuccess(buildTestQuerySyncState(
    cursor(),
    queries,
    pendingPublications,
  ));
}

describe("atomic query publication intent", () => {
  it("captures only bounded canonical publication artifacts as owned frozen values", () => {
    const input = {
      content: canonicalText("owned-publication"),
    };
    const captured = getSuccess(captureQueryPublicationArtifact(input));

    expect(captured).not.toBe(input);
    expect(captured.content).toBe(input.content);
    expect(Object.isFrozen(captured)).toBe(true);
    expect(Object.isFrozen(input)).toBe(false);

    const malformed = captureQueryPublicationArtifact({ content: "***" });
    expect(Result.isFailure(malformed)).toBe(true);
    if (Result.isFailure(malformed)) {
      expect(malformed.failure).toMatchObject({
        field: "publicationContent",
        reason: "invalidSyntax",
      });
    }

    const nonCanonical = captureQueryPublicationArtifact({ content: "AB" });
    expect(Result.isFailure(nonCanonical)).toBe(true);
    if (Result.isFailure(nonCanonical)) {
      expect(nonCanonical.failure).toMatchObject({
        field: "publicationContent",
        reason: "nonCanonical",
      });
    }

    const oversized = captureQueryPublicationArtifact({
      content: canonicalBytes(MAX_INLINE_PUBLICATION_CONTENT_BYTES + 1),
    });
    expect(Result.isFailure(oversized)).toBe(true);
    if (Result.isFailure(oversized)) {
      expect(oversized.failure).toMatchObject({
        field: "publicationContent",
        reason: "tooLarge",
        maximum: MAX_INLINE_PUBLICATION_CONTENT_BYTES,
        observed: MAX_INLINE_PUBLICATION_CONTENT_BYTES + 1,
      });
    }
  });

  it("atomically installs a changed generation and exactly one natural pending intent", () => {
    const dependency = canonicalText("changed-dependency");
    const publication = publicationArtifact("changed-content");
    const completed = installNewChangedQuery({
      keySeed: 7,
      resultSeed: 71,
      dependencies: [dependency],
      publication,
    });
    const state = completed.decision.state;
    const active = state.queries[0]?.active;
    const pending = state.publicationWork.pending[0];
    if (active === null || active === undefined || pending === undefined) {
      throw new Error("Expected an active query and pending publication");
    }

    expect(completed.stateBeforeCompletion.queries[0]?.active).toBeNull();
    expect(completed.stateBeforeCompletion.publicationWork.pending).toEqual([]);
    expect(completed.decision.publicationDisposition).toEqual({
      _tag: "pending",
      identity: pending.identity,
    });
    expect(state.publicationWork.pending).toHaveLength(1);
    expect(pending).toMatchObject({
      identity: {
        namespaceId: state.cursor.namespaceId,
        syncModelId: state.cursor.syncModelId,
        sourceEpoch: state.cursor.sourceEpoch,
        queryKey: completed.attempt.descriptor.queryKey,
        generation: completed.attempt.generation,
      },
      queryIdentity: completed.attempt.descriptor.queryIdentity,
      completedThroughSequence: active.freshThroughSequence,
      resultDigest: completed.evaluation.resultDigest,
      content: publication.content,
    });
    expect(active).toMatchObject({
      generation: completed.attempt.generation,
      resultDigest: completed.evaluation.resultDigest,
      dependencyKeys: [dependency],
    });
    expect(Object.isFrozen(pending)).toBe(true);
    expect(Object.isFrozen(pending.identity)).toBe(true);
  });

  it("suppresses an equal digest while retaining an older pending intent", () => {
    const dependency = canonicalText("equal-digest-dependency");
    const initial = installNewChangedQuery({
      keySeed: 8,
      resultSeed: 80,
      dependencies: [dependency],
      publication: publicationArtifact("older-pending"),
    });
    const olderPending = initial.decision.state.publicationWork.pending[0];
    if (olderPending === undefined) {
      throw new Error("Expected the older pending publication");
    }
    const rerun = beginDirtyRerun(initial, dependency);
    const nextDependency = canonicalText("equal-digest-next-dependency");
    const queryEvaluation = evaluation({
      descriptor: rerun.attempt.descriptor,
      generation: rerun.attempt.generation,
      snapshot: rerun.attempt.registrationCursor.appliedThroughSequence,
      resultSeed: 80,
      dependencies: [nextDependency],
    });
    const refresh = getSuccess(deriveGenerationRefreshEvidence(
      queryEvaluation,
      rerun.state.cursor,
      [],
      queryEvaluation.authorityWitness,
    ));
    const completed = getSuccess(completeQueryEvaluation(
      rerun.state,
      rerun.attempt,
      queryEvaluation,
      refresh,
      publicationArtifact("unused-equal-digest-content"),
    ));

    expect(completed).toMatchObject({
      _tag: "completed",
      generation: 2n,
      publicationDisposition: { _tag: "unchanged" },
    });
    expect(completed.state.publicationWork.pending).toEqual([olderPending]);
    expect(completed.state.queries[0]?.active).toMatchObject({
      generation: 2n,
      resultDigest: queryEvaluation.resultDigest,
      dependencyKeys: [nextDependency],
      dirtyThroughSequence: null,
    });
  });

  it("rejects corrupted metadata on an older retained pending intent", () => {
    const dependency = canonicalText("retained-pending-dependency");
    const initial = installNewChangedQuery({
      keySeed: 81,
      resultSeed: 80,
      dependencies: [dependency],
      publication: publicationArtifact("retained-pending"),
    });
    const rerun = beginDirtyRerun(initial, dependency);
    const queryEvaluation = evaluation({
      descriptor: rerun.attempt.descriptor,
      generation: rerun.attempt.generation,
      snapshot: rerun.attempt.registrationCursor.appliedThroughSequence,
      resultSeed: 80,
      dependencies: [dependency],
    });
    const refresh = getSuccess(deriveGenerationRefreshEvidence(
      queryEvaluation,
      rerun.state.cursor,
      [],
      queryEvaluation.authorityWitness,
    ));
    const completed = getSuccess(completeQueryEvaluation(
      rerun.state,
      rerun.attempt,
      queryEvaluation,
      refresh,
      publicationArtifact("unused-retained-content"),
    ));
    const retained = completed.state.publicationWork.pending[0];
    if (retained === undefined) {
      throw new Error("Expected an older retained pending publication");
    }
    const differentDigest = evaluation({
      descriptor: rerun.attempt.descriptor,
      generation: rerun.attempt.generation,
      snapshot: rerun.attempt.registrationCursor.appliedThroughSequence,
      resultSeed: 82,
      dependencies: [dependency],
    }).resultDigest;
    const corrupted: PendingQueryPublication = Object.freeze({
      identity: retained.identity,
      queryIdentity: retained.queryIdentity,
      completedThroughSequence: retained.completedThroughSequence,
      resultDigest: differentDigest,
      content: retained.content,
    });
    const captureBuildFailure = (
      state: QuerySyncState,
      pending: PendingQueryPublication,
    ): unknown => {
      try {
        buildTestQuerySyncState(state.cursor, state.queries, [pending]);
        return null;
      } catch (cause) {
        return cause;
      }
    };

    const digestFailure = captureBuildFailure(completed.state, corrupted);
    expect(digestFailure).toBeInstanceOf(QuerySyncInvariantDefect);
    expect(digestFailure).toMatchObject({
      operation: "buildQuerySyncState",
      invariant: "publicationWorkIdentityMismatch",
    });

    const advanced = getSuccess(applyAdmittedInvalidations(
      completed.state,
      batch({ sequence: 2n }),
    ));
    if (advanced._tag !== "applied") {
      throw new Error("Expected an exact-next cursor advance");
    }
    const futureCompletion: PendingQueryPublication = Object.freeze({
      identity: retained.identity,
      queryIdentity: retained.queryIdentity,
      completedThroughSequence: advanced.state.cursor.appliedThroughSequence,
      resultDigest: retained.resultDigest,
      content: retained.content,
    });
    const sequenceFailure = captureBuildFailure(
      advanced.state,
      futureCompletion,
    );
    expect(sequenceFailure).toBeInstanceOf(QuerySyncInvariantDefect);
    expect(sequenceFailure).toMatchObject({
      operation: "buildQuerySyncState",
      invariant: "publicationWorkIdentityMismatch",
    });
  });

  it("replaces an older pending record with a newer changed generation", () => {
    const dependency = canonicalText("replacement-dependency");
    const initial = installNewChangedQuery({
      keySeed: 9,
      resultSeed: 90,
      dependencies: [dependency],
      publication: publicationArtifact("older-content"),
    });
    const olderPending = initial.decision.state.publicationWork.pending[0];
    if (olderPending === undefined) {
      throw new Error("Expected the older pending publication");
    }
    const rerun = beginDirtyRerun(initial, dependency);
    const queryEvaluation = evaluation({
      descriptor: rerun.attempt.descriptor,
      generation: rerun.attempt.generation,
      snapshot: rerun.attempt.registrationCursor.appliedThroughSequence,
      resultSeed: 91,
      dependencies: [dependency],
    });
    const refresh = getSuccess(deriveGenerationRefreshEvidence(
      queryEvaluation,
      rerun.state.cursor,
      [],
      queryEvaluation.authorityWitness,
    ));
    const newerArtifact = publicationArtifact("newer-content");
    const completed = getSuccess(completeQueryEvaluation(
      rerun.state,
      rerun.attempt,
      queryEvaluation,
      refresh,
      newerArtifact,
    ));

    expect(completed._tag).toBe("completed");
    expect(completed.state.publicationWork.pending).toHaveLength(1);
    expect(completed.state.publicationWork.pending[0]).toMatchObject({
      identity: {
        queryKey: olderPending.identity.queryKey,
        generation: 2n,
      },
      resultDigest: queryEvaluation.resultDigest,
      content: newerArtifact.content,
    });
    expect(completed.state.publicationWork.pending[0]?.identity).not.toEqual(
      olderPending.identity,
    );
  });

  it("orders pending records deterministically across query insertion histories", () => {
    const buildHistory = (keySeeds: readonly number[]): QuerySyncState => {
      let state = getSuccess(createEmptyQuerySyncState(cursor()));
      for (const keySeed of keySeeds) {
        state = installNewChangedQuery({
          state,
          keySeed,
          resultSeed: 200 + keySeed,
          publication: publicationArtifact(`ordered-${keySeed}`),
        }).decision.state;
      }
      return state;
    };

    const first = buildHistory([3, 1, 2]);
    const second = buildHistory([2, 3, 1]);
    const firstIdentities = first.publicationWork.pending.map(
      (pending) => pending.identity,
    );
    const secondIdentities = second.publicationWork.pending.map(
      (pending) => pending.identity,
    );

    expect(firstIdentities).toEqual(secondIdentities);
    expect(first.publicationWork.pending.map(
      (pending) => pending.identity.queryKey,
    )).toEqual([
      descriptor({ keySeed: 1, identity: "query-1" }).queryKey,
      descriptor({ keySeed: 2, identity: "query-2" }).queryKey,
      descriptor({ keySeed: 3, identity: "query-3" }).queryKey,
    ].sort());
  });

  it("refuses pending-count overflow without producing replacement state", () => {
    const completed = installNewChangedQuery({ keySeed: 30 });
    const pending = completed.decision.state.publicationWork.pending[0];
    if (pending === undefined) {
      throw new Error("Expected one pending publication");
    }
    const excessivePending = Array.from(
      { length: MAX_PENDING_PUBLICATIONS + 1 },
      () => pending,
    );
    const result = buildTestQuerySyncState(
      cursor(),
      completed.decision.state.queries,
      excessivePending,
    );

    expectStateLimit(result, "pendingPublicationCount");
    if (Result.isFailure(result)) {
      expect(result.failure).toMatchObject({
        maximum: MAX_PENDING_PUBLICATIONS,
        observed: MAX_PENDING_PUBLICATIONS + 1,
      });
    }
    expect(completed.decision.state.publicationWork.pending).toEqual([pending]);
  });

  it("rolls back generation installation when pending content is full", () => {
    const fullArtifact = getSuccess(captureQueryPublicationArtifact({
      content: canonicalBytes(MAX_INLINE_PUBLICATION_CONTENT_BYTES),
    }));
    const completions = Array.from(
      { length: MAX_RETAINED_PUBLICATION_CONTENT_BYTES
        / MAX_INLINE_PUBLICATION_CONTENT_BYTES },
      (_, index) => installNewChangedQuery({
        keySeed: 100 + index,
        publication: fullArtifact,
      }),
    );
    const fullState = mergeCompletedQueries(completions);
    expect(fullState.metrics.retainedPublicationContentBytes).toBe(
      MAX_RETAINED_PUBLICATION_CONTENT_BYTES,
    );

    const queryDescriptor = descriptor({
      keySeed: 500,
      identity: "content-capacity-target",
    });
    const begun = getSuccess(beginQueryEvaluation(
      fullState,
      firstEvaluationRequest(target({ descriptor: queryDescriptor })),
    ));
    const attempt = getEvaluationAttempt(begun);
    const queryEvaluation = evaluation({
      descriptor: attempt.descriptor,
      generation: attempt.generation,
      snapshot: attempt.registrationCursor.appliedThroughSequence,
    });
    const refresh = getSuccess(deriveGenerationRefreshEvidence(
      queryEvaluation,
      begun.state.cursor,
      [],
      queryEvaluation.authorityWitness,
    ));
    const result = completeQueryEvaluation(
      begun.state,
      attempt,
      queryEvaluation,
      refresh,
      publicationArtifact("x"),
    );

    expectStateLimit(result, "retainedPublicationContentBytes");
    if (Result.isFailure(result)) {
      expect(result.failure).toMatchObject({
        maximum: MAX_RETAINED_PUBLICATION_CONTENT_BYTES,
        observed: MAX_RETAINED_PUBLICATION_CONTENT_BYTES + 1,
      });
    }
    expect(begun.state.publicationWork.pending).toHaveLength(
      completions.length,
    );
    expect(begun.state.queries.find(
      (query) => query.descriptor.queryKey === queryDescriptor.queryKey,
    )).toMatchObject({
      active: null,
      provisional: { generation: 1n },
    });
  });

  it("rolls back generation installation at the aggregate byte ceiling", () => {
    const maximumDependencies = Array.from(
      { length: MAX_QUERY_DEPENDENCY_BYTES
        / MAX_CANONICAL_DEPENDENCY_KEY_BYTES },
      (_, index) => canonicalBytes(
        MAX_CANONICAL_DEPENDENCY_KEY_BYTES,
        index,
      ),
    );
    const completions = Array.from(
      { length: 7 },
      (_, index) => installNewChangedQuery({
        keySeed: 700 + index,
        dependencies: maximumDependencies,
        publication: publicationArtifact(""),
      }),
    );
    const nearLimit = mergeCompletedQueries(completions);
    expect(nearLimit.metrics.countedCanonicalBytes).toBeLessThan(
      MAX_COUNTED_CANONICAL_BYTES,
    );

    const queryDescriptor = descriptor({
      keySeed: 800,
      identity: "aggregate-capacity-target",
    });
    const begun = getSuccess(beginQueryEvaluation(
      nearLimit,
      firstEvaluationRequest(target({ descriptor: queryDescriptor })),
    ));
    const attempt = getEvaluationAttempt(begun);
    const queryEvaluation = evaluation({
      descriptor: attempt.descriptor,
      generation: attempt.generation,
      snapshot: attempt.registrationCursor.appliedThroughSequence,
      dependencies: maximumDependencies,
    });
    const refresh = getSuccess(deriveGenerationRefreshEvidence(
      queryEvaluation,
      begun.state.cursor,
      [],
      queryEvaluation.authorityWitness,
    ));
    const result = completeQueryEvaluation(
      begun.state,
      attempt,
      queryEvaluation,
      refresh,
      publicationArtifact("aggregate-overflow"),
    );

    expectStateLimit(result, "countedCanonicalBytes");
    if (Result.isFailure(result)) {
      expect(result.failure).toMatchObject({
        maximum: MAX_COUNTED_CANONICAL_BYTES,
      });
    }
    expect(begun.state.metrics.countedCanonicalBytes).toBeLessThan(
      MAX_COUNTED_CANONICAL_BYTES,
    );
    expect(begun.state.publicationWork.pending).toHaveLength(
      completions.length,
    );
    expect(begun.state.queries.find(
      (query) => query.descriptor.queryKey === queryDescriptor.queryKey,
    )).toMatchObject({
      active: null,
      provisional: { generation: 1n },
    });
  });
});
