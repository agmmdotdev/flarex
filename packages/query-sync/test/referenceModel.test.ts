import { Result } from "effect";
import { describe, expect, it } from "vitest";

import {
  applyAdmittedInvalidations,
  beginQueryEvaluation,
  completeQueryEvaluation,
  createEmptyQuerySyncState,
  InvalidRefreshEvidenceError,
  QuerySyncEpochMismatchError,
} from "@flarex/query-sync/internal/kernel";
import type {
  GenerationRefreshEvidence,
  NamespaceCursor,
  QueryEvaluationEvidence,
  QuerySyncState,
} from "@flarex/query-sync/internal/kernel";
import {
  createReferenceModel,
  deriveGenerationRefreshEvidence,
  GRAPH_REFERENCE_MODEL_FIXTURE,
  KEY_VALUE_REFERENCE_MODEL_FIXTURE,
  reduceReferenceModel,
} from "@flarex/query-sync/testing/reference-model";

import {
  batch,
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

function proveRefreshEvidenceIsNominal(
  evidence: QueryEvaluationEvidence,
  targetCursor: NamespaceCursor,
): void {
  // @ts-expect-error Refresh evidence must come from an admitted constructor.
  const forged: GenerationRefreshEvidence = {
    namespaceId: evidence.namespaceId,
    syncModelId: evidence.syncModelId,
    sourceEpoch: evidence.sourceEpoch,
    descriptor: evidence.descriptor,
    generation: evidence.generation,
    evaluationSnapshotSequence: evidence.snapshotSequence,
    evaluationDependencyKeys: evidence.dependencyKeys,
    refreshedThroughSequence: targetCursor.appliedThroughSequence,
    relevantThroughSequence: null,
    authorityWitness: evidence.authorityWitness,
  };
  void forged;
}

void proveRefreshEvidenceIsNominal;

function installInitialActive(
  dependency: string,
  resultSeed = 40,
): QuerySyncState {
  const initial = getSuccess(createEmptyQuerySyncState(cursor()));
  const begun = getSuccess(beginQueryEvaluation(
    initial,
    firstEvaluationRequest(),
  ));
  const attempt = getEvaluationAttempt(begun);
  const evidence = evaluation({
    descriptor: attempt.descriptor,
    generation: attempt.generation,
    snapshot: 0n,
    resultSeed,
    dependencies: [dependency],
  });
  const refresh = getSuccess(deriveGenerationRefreshEvidence(
    evidence,
    begun.state.cursor,
    [],
    evidence.authorityWitness,
  ));
  const completed = getSuccess(completeQueryEvaluation(
    begun.state,
    attempt,
    evidence,
    refresh,
    publicationArtifact(`initial-active-${resultSeed}`),
  ));
  if (completed._tag !== "completed") {
    throw new Error("Expected initial active fixture");
  }
  return completed.state;
}

describe("query-sync reference model", () => {
  it("derives relevant refresh evidence for the complete registration race", () => {
    const dependency = canonicalText("record:1");
    const model = getSuccess(createReferenceModel(cursor()));
    const begun = getSuccess(reduceReferenceModel(model, {
      _tag: "beginQueryEvaluation",
      request: firstEvaluationRequest(),
    }));
    expect(begun.decision._tag).toBe("created");
    if (begun.decision._tag !== "created") return;

    const evidence = evaluation({
      descriptor: begun.decision.attempt.descriptor,
      generation: begun.decision.attempt.generation,
      snapshot: 0n,
      dependencies: [dependency],
    });
    const admitted = batch({ sequence: 1n, dependencies: [dependency] });
    const advanced = getSuccess(reduceReferenceModel(begun.model, {
      _tag: "applyAdmittedInvalidations",
      batch: admitted,
    }));
    const refresh = getSuccess(deriveGenerationRefreshEvidence(
      evidence,
      advanced.model.state.cursor,
      [admitted],
      evidence.authorityWitness,
    ));
    expect(refresh.relevantThroughSequence).toBe(1n);
    expect(Object.isFrozen(refresh)).toBe(true);
    expect(Object.isFrozen(refresh.evaluationDependencyKeys)).toBe(true);
    expect(refresh.evaluationDependencyKeys).toEqual([dependency]);

    const completed = getSuccess(reduceReferenceModel(advanced.model, {
      _tag: "completeQueryEvaluation",
      attempt: begun.decision.attempt,
      evaluation: evidence,
      refresh,
      publication: publicationArtifact("registration-race"),
    }));
    expect(completed.decision).toMatchObject({
      _tag: "rerunRequired",
      relevantThroughSequence: 1n,
    });
    expect(completed.model.state).toBe(advanced.model.state);
    expect(completed.model.state.queries[0]?.provisional?.generation).toBe(1n);
  });

  it("uses the fixed refresh interval extent instead of caller iteration", () => {
    const dependency = canonicalText("record:iterator");
    const capturedEvaluation = evaluation({
      generation: 1n,
      snapshot: 0n,
      dependencies: [dependency],
    });
    const admittedBatches = [batch({
      sequence: 1n,
      dependencies: [dependency],
    })];
    Object.defineProperty(admittedBatches, Symbol.iterator, {
      value() {
        throw new Error("Refresh derivation invoked caller iteration");
      },
    });

    const refresh = getSuccess(deriveGenerationRefreshEvidence(
      capturedEvaluation,
      cursor({ sequence: 1n }),
      admittedBatches,
      capturedEvaluation.authorityWitness,
    ));
    expect(refresh).toMatchObject({
      refreshedThroughSequence: 1n,
      relevantThroughSequence: 1n,
    });
  });

  it("installs after an exact clean refresh through the current cursor", () => {
    const dependency = canonicalText("record:1");
    const unrelated = canonicalText("record:2");
    const initial = getSuccess(createEmptyQuerySyncState(cursor()));
    const begun = getSuccess(beginQueryEvaluation(
      initial,
      firstEvaluationRequest(),
    ));
    const attempt = getEvaluationAttempt(begun);
    const evidence = evaluation({
      descriptor: attempt.descriptor,
      generation: attempt.generation,
      snapshot: 0n,
      dependencies: [dependency],
    });
    const admitted = batch({ sequence: 1n, dependencies: [unrelated] });
    const advanced = getSuccess(applyAdmittedInvalidations(
      begun.state,
      admitted,
    ));
    const refresh = getSuccess(deriveGenerationRefreshEvidence(
      evidence,
      advanced.state.cursor,
      [admitted],
      evidence.authorityWitness,
    ));
    const completed = getSuccess(completeQueryEvaluation(
      advanced.state,
      attempt,
      evidence,
      refresh,
      publicationArtifact("clean-refresh"),
    ));

    expect(refresh.relevantThroughSequence).toBeNull();
    expect(completed).toMatchObject({
      _tag: "completed",
      generation: 1n,
      publicationDisposition: {
        _tag: "pending",
        identity: { generation: 1n },
      },
    });
    expect(completed.state.queries[0]?.active).toMatchObject({
      generation: 1n,
      freshThroughSequence: 1n,
      dirtyThroughSequence: null,
      dependencyKeys: [dependency],
    });
    expect(completed.state.queries[0]?.provisional).toBeNull();
    expect(completed.state.publicationWork.pending).toHaveLength(1);
    expect(completed.state.publicationWork.pending[0]).toMatchObject({
      identity: { generation: 1n },
      content: publicationArtifact("clean-refresh").content,
    });
  });

  it("requires another refresh when the cursor advances after proof", () => {
    const initial = getSuccess(createEmptyQuerySyncState(cursor()));
    const begun = getSuccess(beginQueryEvaluation(
      initial,
      firstEvaluationRequest(),
    ));
    const attempt = getEvaluationAttempt(begun);
    const evidence = evaluation({
      descriptor: attempt.descriptor,
      generation: attempt.generation,
      snapshot: 0n,
    });
    const staleRefresh = getSuccess(deriveGenerationRefreshEvidence(
      evidence,
      begun.state.cursor,
      [],
      evidence.authorityWitness,
    ));
    const advanced = getSuccess(applyAdmittedInvalidations(
      begun.state,
      batch({ sequence: 1n }),
    ));
    const decision = getSuccess(completeQueryEvaluation(
      advanced.state,
      attempt,
      evidence,
      staleRefresh,
      publicationArtifact("refresh-required"),
    ));

    expect(decision).toMatchObject({
      _tag: "refreshRequired",
      refreshedThroughSequence: 0n,
      requiredThroughSequence: 1n,
    });
    expect(decision.state).toBe(advanced.state);
    expect(decision.state.queries[0]?.provisional?.generation).toBe(1n);
  });

  it("requires resnapshot when authority changes at an exact cursor", () => {
    const initial = getSuccess(createEmptyQuerySyncState(cursor()));
    const begun = getSuccess(beginQueryEvaluation(
      initial,
      firstEvaluationRequest(),
    ));
    const attempt = getEvaluationAttempt(begun);
    const evidence = evaluation({
      descriptor: attempt.descriptor,
      generation: attempt.generation,
      snapshot: 0n,
      witnessSeed: 4,
    });
    const refresh = getSuccess(deriveGenerationRefreshEvidence(
      evidence,
      begun.state.cursor,
      [],
      witness(5),
    ));
    const decision = getSuccess(completeQueryEvaluation(
      begun.state,
      attempt,
      evidence,
      refresh,
      publicationArtifact("resnapshot-required"),
    ));

    expect(decision._tag).toBe("resnapshotRequired");
    expect(decision.state).toBe(begun.state);
  });

  it("applies completion precedence before installing or rerunning", () => {
    const dependency = canonicalText("relevant");
    const initial = getSuccess(createEmptyQuerySyncState(cursor()));
    const begun = getSuccess(beginQueryEvaluation(
      initial,
      firstEvaluationRequest(),
    ));
    const attempt = getEvaluationAttempt(begun);
    const evidence = evaluation({
      descriptor: attempt.descriptor,
      generation: attempt.generation,
      snapshot: 0n,
      witnessSeed: 20,
      dependencies: [dependency],
    });
    const staleDriftedRefresh = getSuccess(deriveGenerationRefreshEvidence(
      evidence,
      begun.state.cursor,
      [],
      witness(21),
    ));
    const admitted = batch({ sequence: 1n, dependencies: [dependency] });
    const advanced = getSuccess(applyAdmittedInvalidations(
      begun.state,
      admitted,
    ));
    const refreshFirst = getSuccess(completeQueryEvaluation(
      advanced.state,
      attempt,
      evidence,
      staleDriftedRefresh,
      publicationArtifact("precedence"),
    ));
    expect(refreshFirst._tag).toBe("refreshRequired");

    const relevantDriftedRefresh = getSuccess(
      deriveGenerationRefreshEvidence(
        evidence,
        advanced.state.cursor,
        [admitted],
        witness(21),
      ),
    );
    const resnapshotBeforeRerun = getSuccess(completeQueryEvaluation(
      advanced.state,
      attempt,
      evidence,
      relevantDriftedRefresh,
      publicationArtifact("precedence"),
    ));
    expect(resnapshotBeforeRerun._tag).toBe("resnapshotRequired");
    expect(resnapshotBeforeRerun.state).toBe(advanced.state);
  });

  it("refuses refresh evidence ahead of the current aggregate", () => {
    const initial = getSuccess(createEmptyQuerySyncState(cursor()));
    const begun = getSuccess(beginQueryEvaluation(
      initial,
      firstEvaluationRequest(),
    ));
    const attempt = getEvaluationAttempt(begun);
    const evidence = evaluation({
      descriptor: attempt.descriptor,
      generation: attempt.generation,
      snapshot: 0n,
    });
    const admitted = batch({ sequence: 1n });
    const futureRefresh = getSuccess(deriveGenerationRefreshEvidence(
      evidence,
      cursor({ sequence: 1n }),
      [admitted],
      evidence.authorityWitness,
    ));
    const result = completeQueryEvaluation(
      begun.state,
      attempt,
      evidence,
      futureRefresh,
      publicationArtifact("future-refresh"),
    );

    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure).toMatchObject({
        _tag: "InvalidQueryEvidenceError",
        reason: "refreshAheadOfCursor",
      });
    }
    expect(begun.state.queries[0]?.active).toBeNull();
  });

  it("binds refresh proof to the exact evaluation snapshot and dependencies", () => {
    const dependencyA = canonicalText("dependency-a");
    const dependencyB = canonicalText("dependency-b");
    const initial = getSuccess(createEmptyQuerySyncState(cursor()));
    const begun = getSuccess(beginQueryEvaluation(
      initial,
      firstEvaluationRequest(),
    ));
    const attempt = getEvaluationAttempt(begun);
    const admitted = batch({
      sequence: 1n,
      dependencies: [dependencyA],
    });
    const advanced = getSuccess(applyAdmittedInvalidations(
      begun.state,
      admitted,
    ));
    const intendedEvaluation = evaluation({
      descriptor: attempt.descriptor,
      generation: attempt.generation,
      snapshot: 0n,
      dependencies: [dependencyA],
    });
    const differentDependencies = evaluation({
      descriptor: attempt.descriptor,
      generation: attempt.generation,
      snapshot: 0n,
      dependencies: [dependencyB],
    });
    const dependencyRefresh = getSuccess(deriveGenerationRefreshEvidence(
      differentDependencies,
      advanced.state.cursor,
      [admitted],
      differentDependencies.authorityWitness,
    ));
    const dependencyMismatch = completeQueryEvaluation(
      advanced.state,
      attempt,
      intendedEvaluation,
      dependencyRefresh,
      publicationArtifact("dependency-mismatch"),
    );
    expect(Result.isFailure(dependencyMismatch)).toBe(true);
    if (Result.isFailure(dependencyMismatch)) {
      expect(dependencyMismatch.failure).toMatchObject({
        _tag: "InvalidQueryEvidenceError",
        reason: "evaluationRefreshDependenciesMismatch",
      });
    }

    const differentSnapshot = evaluation({
      descriptor: attempt.descriptor,
      generation: attempt.generation,
      snapshot: 1n,
      dependencies: [dependencyA],
    });
    const snapshotRefresh = getSuccess(deriveGenerationRefreshEvidence(
      differentSnapshot,
      advanced.state.cursor,
      [],
      differentSnapshot.authorityWitness,
    ));
    const snapshotMismatch = completeQueryEvaluation(
      advanced.state,
      attempt,
      intendedEvaluation,
      snapshotRefresh,
      publicationArtifact("snapshot-mismatch"),
    );
    expect(Result.isFailure(snapshotMismatch)).toBe(true);
    if (Result.isFailure(snapshotMismatch)) {
      expect(snapshotMismatch.failure).toMatchObject({
        _tag: "InvalidQueryEvidenceError",
        reason: "evaluationRefreshSnapshotMismatch",
      });
    }
    expect(advanced.state.queries[0]?.active).toBeNull();
    expect(advanced.state.queries[0]?.provisional?.generation).toBe(1n);
  });

  it("treats a dirty installed generation after snapshot as a rerun fence", () => {
    const oldDependency = canonicalText("old");
    const newDependency = canonicalText("new");
    const active = installInitialActive(oldDependency);
    const activeGeneration = active.queries[0]?.active?.generation;
    if (activeGeneration === undefined) {
      throw new Error("Expected an installed active generation");
    }
    const firstInvalidation = batch({
      sequence: 1n,
      dependencies: [oldDependency],
    });
    const dirty = getSuccess(applyAdmittedInvalidations(
      active,
      firstInvalidation,
    ));
    const begun = getSuccess(beginQueryEvaluation(
      dirty.state,
      rerunEvaluationRequest({
        activeGeneration,
        dirtyThroughSequence: firstInvalidation.sourceSequence,
      }),
    ));
    const attempt = getEvaluationAttempt(begun);
    const evidence = evaluation({
      descriptor: attempt.descriptor,
      generation: attempt.generation,
      snapshot: attempt.registrationCursor.appliedThroughSequence,
      dependencies: [newDependency],
    });
    const admitted = batch({ sequence: 2n, dependencies: [oldDependency] });
    const advanced = getSuccess(applyAdmittedInvalidations(
      begun.state,
      admitted,
    ));
    const refresh = getSuccess(deriveGenerationRefreshEvidence(
      evidence,
      advanced.state.cursor,
      [admitted],
      evidence.authorityWitness,
    ));
    expect(refresh.relevantThroughSequence).toBeNull();

    const decision = getSuccess(completeQueryEvaluation(
      advanced.state,
      attempt,
      evidence,
      refresh,
      publicationArtifact("rerun-fence"),
    ));
    expect(decision).toMatchObject({
      _tag: "rerunRequired",
      relevantThroughSequence: 2n,
    });
    expect(decision.state.queries[0]?.active?.dependencyKeys).toEqual([
      oldDependency,
    ]);
    expect(decision.state.queries[0]?.provisional?.generation).toBe(2n);
  });

  it("installs freshness and new dependencies even when the digest is equal", () => {
    const oldDependency = canonicalText("old");
    const newDependency = canonicalText("new");
    const active = installInitialActive(oldDependency, 42);
    const activeGeneration = active.queries[0]?.active?.generation;
    if (activeGeneration === undefined) {
      throw new Error("Expected an installed active generation");
    }
    const invalidation = batch({
      sequence: 1n,
      dependencies: [oldDependency],
    });
    const dirty = getSuccess(applyAdmittedInvalidations(
      active,
      invalidation,
    ));
    const begun = getSuccess(beginQueryEvaluation(
      dirty.state,
      rerunEvaluationRequest({
        activeGeneration,
        dirtyThroughSequence: invalidation.sourceSequence,
      }),
    ));
    const attempt = getEvaluationAttempt(begun);
    const evidence = evaluation({
      descriptor: attempt.descriptor,
      generation: attempt.generation,
      snapshot: attempt.registrationCursor.appliedThroughSequence,
      resultSeed: 42,
      dependencies: [newDependency],
    });
    const refresh = getSuccess(deriveGenerationRefreshEvidence(
      evidence,
      begun.state.cursor,
      [],
      evidence.authorityWitness,
    ));
    const completed = getSuccess(completeQueryEvaluation(
      begun.state,
      attempt,
      evidence,
      refresh,
      publicationArtifact("equal-digest-unused"),
    ));

    expect(completed).toMatchObject({
      _tag: "completed",
      publicationDisposition: { _tag: "unchanged" },
    });
    expect(completed.state.queries[0]?.active).toMatchObject({
      generation: 2n,
      dependencyKeys: [newDependency],
      dirtyThroughSequence: null,
    });
    expect(completed.state.queries[0]?.provisional).toBeNull();
    expect(completed.state.publicationWork.pending).toHaveLength(1);
    expect(completed.state.publicationWork.pending[0]).toMatchObject({
      identity: { generation: 1n },
      content: publicationArtifact("initial-active-42").content,
    });
  });

  it("refuses malformed and wrong-epoch refresh intervals", () => {
    const evidence = evaluation({ generation: 1n, snapshot: 0n });
    const targetCursor = cursor({ sequence: 2n });
    const first = batch({ sequence: 1n });
    const second = batch({ sequence: 2n });

    const missing = deriveGenerationRefreshEvidence(
      evidence,
      targetCursor,
      [first],
      evidence.authorityWitness,
    );
    expect(Result.isFailure(missing)).toBe(true);
    if (Result.isFailure(missing)) {
      expect(missing.failure).toBeInstanceOf(InvalidRefreshEvidenceError);
      expect(missing.failure).toMatchObject({ reason: "missingBatch" });
    }

    const extra = deriveGenerationRefreshEvidence(
      evidence,
      cursor({ sequence: 1n }),
      [first, second],
      evidence.authorityWitness,
    );
    expect(Result.isFailure(extra)).toBe(true);
    if (Result.isFailure(extra)) {
      expect(extra.failure).toMatchObject({ reason: "extraBatch" });
    }

    const noncontiguous = deriveGenerationRefreshEvidence(
      evidence,
      targetCursor,
      [first, batch({ sequence: 3n })],
      evidence.authorityWitness,
    );
    expect(Result.isFailure(noncontiguous)).toBe(true);
    if (Result.isFailure(noncontiguous)) {
      expect(noncontiguous.failure).toMatchObject({
        reason: "nonContiguousBatch",
        expectedSequence: 2n,
        observedSequence: 3n,
      });
    }

    const duplicate = deriveGenerationRefreshEvidence(
      evidence,
      targetCursor,
      [first, first],
      evidence.authorityWitness,
    );
    expect(Result.isFailure(duplicate)).toBe(true);
    if (Result.isFailure(duplicate)) {
      expect(duplicate.failure).toMatchObject({
        reason: "nonContiguousBatch",
        expectedSequence: 2n,
        observedSequence: 1n,
      });
    }

    const reversed = deriveGenerationRefreshEvidence(
      evidence,
      targetCursor,
      [second, first],
      evidence.authorityWitness,
    );
    expect(Result.isFailure(reversed)).toBe(true);
    if (Result.isFailure(reversed)) {
      expect(reversed.failure).toMatchObject({
        reason: "nonContiguousBatch",
        expectedSequence: 1n,
        observedSequence: 2n,
      });
    }

    const wrongEpoch = deriveGenerationRefreshEvidence(
      evidence,
      cursor({ sourceEpoch: "epoch-b", sequence: 0n }),
      [],
      evidence.authorityWitness,
    );
    expect(Result.isFailure(wrongEpoch)).toBe(true);
    if (Result.isFailure(wrongEpoch)) {
      expect(wrongEpoch.failure).toBeInstanceOf(QuerySyncEpochMismatchError);
    }
  });

  it("runs unrelated synthetic key/value and graph models through one kernel", () => {
    const keyValue = getSuccess(
      KEY_VALUE_REFERENCE_MODEL_FIXTURE.captureDependencyKey("same"),
    );
    const graph = getSuccess(
      GRAPH_REFERENCE_MODEL_FIXTURE.captureDependencyKey("same"),
    );
    expect(keyValue).not.toBe(graph);

    for (const [fixture, dependencyKey] of [
      [KEY_VALUE_REFERENCE_MODEL_FIXTURE, keyValue],
      [GRAPH_REFERENCE_MODEL_FIXTURE, graph],
    ] as const) {
      const model = getSuccess(createReferenceModel(cursor({
        syncModelId: fixture.syncModelId,
      })));
      const fixtureTarget = target({ syncModelId: fixture.syncModelId });
      const begun = getSuccess(reduceReferenceModel(model, {
        _tag: "beginQueryEvaluation",
        request: firstEvaluationRequest(fixtureTarget),
      }));
      expect(begun.decision._tag).toBe("created");
      if (begun.decision._tag !== "created") continue;
      const fixtureEvaluation = evaluation({
        syncModelId: fixture.syncModelId,
        descriptor: begun.decision.attempt.descriptor,
        generation: begun.decision.attempt.generation,
        snapshot: 0n,
        dependencies: [dependencyKey],
      });
      const admitted = batch({
        syncModelId: fixture.syncModelId,
        sequence: 1n,
        dependencies: [dependencyKey],
      });
      const advanced = getSuccess(reduceReferenceModel(begun.model, {
        _tag: "applyAdmittedInvalidations",
        batch: admitted,
      }));
      const refresh = getSuccess(deriveGenerationRefreshEvidence(
        fixtureEvaluation,
        advanced.model.state.cursor,
        [admitted],
        fixtureEvaluation.authorityWitness,
      ));
      const completed = getSuccess(reduceReferenceModel(advanced.model, {
        _tag: "completeQueryEvaluation",
        attempt: begun.decision.attempt,
        evaluation: fixtureEvaluation,
        refresh,
        publication: publicationArtifact(
          `${fixture.syncModelId}-publication`,
        ),
      }));
      expect(completed.decision._tag).toBe("rerunRequired");
    }

    const crossModelEvaluation = evaluation({
      syncModelId: "synthetic-key-value",
      generation: 1n,
      snapshot: 0n,
      dependencies: [keyValue],
    });
    const graphBatch = batch({
      syncModelId: "synthetic-key-value",
      sequence: 1n,
      dependencies: [graph],
    });
    expect(getSuccess(deriveGenerationRefreshEvidence(
      crossModelEvaluation,
      cursor({ syncModelId: "synthetic-key-value", sequence: 1n }),
      [graphBatch],
      crossModelEvaluation.authorityWitness,
    )).relevantThroughSequence).toBeNull();
  });
});
