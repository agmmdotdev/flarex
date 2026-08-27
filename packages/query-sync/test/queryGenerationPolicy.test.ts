import { Result } from "effect";
import { describe, expect, it } from "vitest";

import {
  beginQueryGeneration,
  captureCanonicalDependencyKey,
  completeQueryGeneration,
  createEmptyQuerySyncState,
  MAX_QUERY_GENERATION,
  QueryGenerationExhaustedError,
  QueryGenerationMismatchError,
  QueryKeyCollisionError,
  QuerySyncEpochMismatchError,
  QuerySyncNamespaceMismatchError,
} from "@flarex/query-sync/internal/kernel";
import type {
  ActiveQueryState,
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
  getSuccess,
  target,
  witness,
} from "./fixtures.js";

function emptyState(sequence = 0n): QuerySyncState {
  return getSuccess(createEmptyQuerySyncState(cursor({ sequence })));
}

function completeInitialQuery(input: {
  readonly sequence?: bigint;
  readonly dependencies?: readonly string[];
  readonly resultSeed?: number;
} = {}): QuerySyncState {
  const initial = emptyState(input.sequence ?? 0n);
  const begun = getSuccess(beginQueryGeneration(initial, target()));
  const evidence = evaluation({
    descriptor: begun.descriptor,
    generation: begun.generation,
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
  const completed = getSuccess(completeQueryGeneration(
    begun.state,
    evidence,
    refresh,
  ));
  expect(completed._tag).toBe("completed");
  return completed.state;
}

describe("query generation policy", () => {
  it("allocates generation one and exactly replays a provisional begin", () => {
    const initial = emptyState();
    const first = getSuccess(beginQueryGeneration(initial, target()));
    expect(first).toMatchObject({ _tag: "created", generation: 1n });
    expect(first.state).not.toBe(initial);
    expect(initial.queries).toEqual([]);

    const replay = getSuccess(beginQueryGeneration(first.state, target()));
    expect(replay).toMatchObject({ _tag: "replayed", generation: 1n });
    expect(replay.state).toBe(first.state);
    expect(replay.registrationCursor).toEqual(first.registrationCursor);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.state)).toBe(true);
  });

  it("retains active state while allocating the next provisional generation", () => {
    const dependency = canonicalText("kv:key-a");
    const activeState = completeInitialQuery({ dependencies: [dependency] });
    const activeBefore = activeState.queries[0]?.active;
    const begun = getSuccess(beginQueryGeneration(activeState, target()));

    expect(begun).toMatchObject({ _tag: "created", generation: 2n });
    expect(begun.state.queries[0]?.active).toEqual(activeBefore);
    expect(begun.state.queries[0]?.provisional).toMatchObject({
      generation: 2n,
      registrationCursor: activeState.cursor,
    });
    expect(activeState.queries[0]?.provisional).toBeNull();
  });

  it("refuses the same lookup key with a different full identity", () => {
    const initial = emptyState();
    const firstTarget = target();
    const begun = getSuccess(beginQueryGeneration(initial, firstTarget));
    const collisionTarget = target({
      descriptor: descriptor({
        keySeed: 1,
        identity: "different-query",
      }),
    });
    const collision = beginQueryGeneration(begun.state, collisionTarget);

    expect(Result.isFailure(collision)).toBe(true);
    if (Result.isFailure(collision)) {
      expect(collision.failure).toBeInstanceOf(QueryKeyCollisionError);
    }
    expect(begun.state.queries[0]?.descriptor).toEqual(firstTarget.descriptor);
  });

  it("refuses wrong namespace and epoch before changing state", () => {
    const initial = emptyState();
    const wrongNamespace = beginQueryGeneration(
      initial,
      target({ namespaceId: "tenant-b" }),
    );
    expect(Result.isFailure(wrongNamespace)).toBe(true);
    if (Result.isFailure(wrongNamespace)) {
      expect(wrongNamespace.failure).toBeInstanceOf(
        QuerySyncNamespaceMismatchError,
      );
    }

    const wrongEpoch = beginQueryGeneration(
      initial,
      target({ sourceEpoch: "epoch-b" }),
    );
    expect(Result.isFailure(wrongEpoch)).toBe(true);
    if (Result.isFailure(wrongEpoch)) {
      expect(wrongEpoch.failure).toBeInstanceOf(QuerySyncEpochMismatchError);
    }
    expect(initial.queries).toEqual([]);
  });

  it("refuses an evaluation snapshot older than registration", () => {
    const initial = emptyState(5n);
    const begun = getSuccess(beginQueryGeneration(initial, target()));
    const staleEvaluation = evaluation({
      descriptor: begun.descriptor,
      generation: begun.generation,
      snapshot: 4n,
    });
    const refresh = getSuccess(deriveGenerationRefreshEvidence(
      staleEvaluation,
      begun.state.cursor,
      [batch({ sequence: 5n })],
      staleEvaluation.authorityWitness,
    ));
    const result = completeQueryGeneration(
      begun.state,
      staleEvaluation,
      refresh,
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

  it("refuses stale completion after a later generation exists", () => {
    const firstActive = completeInitialQuery();
    const secondBegin = getSuccess(beginQueryGeneration(firstActive, target()));
    const staleEvaluation = evaluation({ generation: 1n, snapshot: 0n });
    const staleRefresh = getSuccess(deriveGenerationRefreshEvidence(
      staleEvaluation,
      secondBegin.state.cursor,
      [],
      staleEvaluation.authorityWitness,
    ));
    const stale = completeQueryGeneration(
      secondBegin.state,
      staleEvaluation,
      staleRefresh,
    );

    expect(Result.isFailure(stale)).toBe(true);
    if (Result.isFailure(stale)) {
      expect(stale.failure).toBeInstanceOf(QueryGenerationMismatchError);
      expect(stale.failure).toMatchObject({
        expectedGeneration: 2n,
        observedGeneration: 1n,
      });
    }
    expect(secondBegin.state.queries[0]?.provisional?.generation).toBe(2n);
  });

  it("refuses generation overflow while retaining the installed active value", () => {
    const queryDescriptor = descriptor();
    const nearMaxEvidence = evaluation({
      descriptor: queryDescriptor,
      generation: MAX_QUERY_GENERATION - 1n,
      snapshot: 0n,
    });
    const nearMaxActive: ActiveQueryState = {
      generation: nearMaxEvidence.generation,
      evaluationSnapshotSequence: nearMaxEvidence.snapshotSequence,
      freshThroughSequence: cursor().appliedThroughSequence,
      dirtyThroughSequence: null,
      resultDigest: nearMaxEvidence.resultDigest,
      authorityWitness: nearMaxEvidence.authorityWitness,
      dependencyKeys: nearMaxEvidence.dependencyKeys,
    };
    const nearMaxModel = buildTestReferenceModel(cursor(), [{
      descriptor: queryDescriptor,
      active: nearMaxActive,
      provisional: null,
    }]);
    const maximumBegin = getSuccess(beginQueryGeneration(
      nearMaxModel.state,
      target(),
    ));
    expect(maximumBegin).toMatchObject({
      _tag: "created",
      generation: MAX_QUERY_GENERATION,
    });

    const maxEvidence = evaluation({
      descriptor: queryDescriptor,
      generation: MAX_QUERY_GENERATION,
      snapshot: 0n,
    });
    const active: ActiveQueryState = {
      generation: maxEvidence.generation,
      evaluationSnapshotSequence: maxEvidence.snapshotSequence,
      freshThroughSequence: cursor().appliedThroughSequence,
      dirtyThroughSequence: null,
      resultDigest: maxEvidence.resultDigest,
      authorityWitness: maxEvidence.authorityWitness,
      dependencyKeys: maxEvidence.dependencyKeys,
    };
    const query: QueryState = {
      descriptor: queryDescriptor,
      active,
      provisional: null,
    };
    const model = buildTestReferenceModel(cursor(), [query]);
    const result = beginQueryGeneration(model.state, target());

    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure).toBeInstanceOf(QueryGenerationExhaustedError);
      expect(result.failure).toMatchObject({
        currentGeneration: MAX_QUERY_GENERATION,
      });
    }
    expect(model.state.queries[0]?.active?.generation).toBe(
      MAX_QUERY_GENERATION,
    );
  });

  it("keeps a provisional generation after resnapshot is required", () => {
    const initial = emptyState();
    const begun = getSuccess(beginQueryGeneration(initial, target()));
    const evidence = evaluation({
      descriptor: begun.descriptor,
      generation: begun.generation,
      snapshot: 0n,
      witnessSeed: 10,
    });
    const refresh = getSuccess(deriveGenerationRefreshEvidence(
      evidence,
      begun.state.cursor,
      [],
      witness(11),
    ));
    const decision = getSuccess(completeQueryGeneration(
      begun.state,
      evidence,
      refresh,
    ));

    expect(decision._tag).toBe("resnapshotRequired");
    expect(decision.state).toBe(begun.state);
    expect(decision.state.queries[0]?.provisional?.generation).toBe(1n);
  });

  it("does not alias caller-owned active dependency arrays in test models", () => {
    const queryDescriptor = descriptor({ keySeed: 7 });
    const dependencyKeys = [canonicalText("a")];
    const captured = evaluation({
      descriptor: queryDescriptor,
      generation: 1n,
      snapshot: 0n,
      dependencies: dependencyKeys,
    });
    const callerOwnedCapturedDependencies = [...captured.dependencyKeys];
    const active: ActiveQueryState = {
      generation: captured.generation,
      evaluationSnapshotSequence: captured.snapshotSequence,
      freshThroughSequence: cursor().appliedThroughSequence,
      dirtyThroughSequence: null,
      resultDigest: captured.resultDigest,
      authorityWitness: captured.authorityWitness,
      dependencyKeys: callerOwnedCapturedDependencies,
    };
    const callerQueries: QueryState[] = [{
      descriptor: queryDescriptor,
      active,
      provisional: null,
    }];
    const model = buildTestReferenceModel(cursor(), callerQueries);

    callerQueries.push({
      descriptor: descriptor({ keySeed: 8 }),
      active: null,
      provisional: null,
    });
    callerOwnedCapturedDependencies[0] = getSuccess(
      captureCanonicalDependencyKey(canonicalText("rebuilt-mutation")),
    );
    dependencyKeys[0] = canonicalText("mutated");

    expect(model.state.queries).toHaveLength(1);
    expect(model.state.queries[0]?.active?.dependencyKeys).toEqual([
      canonicalText("a"),
    ]);
    expect(Object.isFrozen(model.state.queries)).toBe(true);
  });
});
