import { describe, expect, it } from "vitest";

import type {
  NamespaceCursor,
  QuerySyncState,
} from "@flarex/query-sync/internal/kernel";
import {
  QuerySyncStateCommitOutcomeUnknownError,
  QuerySyncStateUnavailableError,
  QuerySyncStoredStateCorruptError,
} from "@flarex/query-sync/internal/state";
import {
  makeReferenceQuerySyncStateHarness,
  ReferenceStateSnapshotBindingError,
} from "@flarex/query-sync/testing/conformance";
import type {
  ReferenceStateBinding,
} from "@flarex/query-sync/testing/conformance";
import {
  deriveGenerationRefreshEvidence,
} from "@flarex/query-sync/testing/reference-model";

import {
  batch,
  canonicalText,
  cursor,
  evaluation,
  firstEvaluationRequest,
  getSuccess,
  publicationArtifact,
  rerunEvaluationRequest,
  target,
} from "./fixtures.js";
import { runEffect, runEffectFailure } from "./effectBoundary.js";

function bindingFor(
  physicalNamespaceId: string,
  namespaceCursor: NamespaceCursor,
): ReferenceStateBinding {
  return Object.freeze({
    physicalNamespaceId,
    namespaceId: namespaceCursor.namespaceId,
    syncModelId: namespaceCursor.syncModelId,
    sourceEpoch: namespaceCursor.sourceEpoch,
  });
}

function requireState(state: QuerySyncState | null): QuerySyncState {
  if (state === null) {
    throw new Error("Expected an initialized reference state");
  }
  return state;
}

async function prepareActiveReferenceQuery(
  physicalNamespaceId: string,
  dependency: string,
) {
  const bootstrapCursor = cursor();
  const queryTarget = target();
  const harness = await runEffect(makeReferenceQuerySyncStateHarness());
  const transitionState = harness.bind(bindingFor(
    physicalNamespaceId,
    bootstrapCursor,
  ));
  await runEffect(
    transitionState.initializeOrInspectNamespace(bootstrapCursor),
  );
  const begun = await runEffect(
    transitionState.beginQueryEvaluation(firstEvaluationRequest(queryTarget)),
  );
  if (begun._tag !== "created") {
    throw new Error("Expected an evaluation attempt to be created.");
  }
  const queryEvaluation = evaluation({
    descriptor: begun.attempt.descriptor,
    generation: begun.attempt.generation,
    snapshot: begun.attempt.registrationCursor.appliedThroughSequence,
    dependencies: [dependency],
  });
  const refresh = getSuccess(deriveGenerationRefreshEvidence(
    queryEvaluation,
    begun.attempt.registrationCursor,
    [],
    queryEvaluation.authorityWitness,
  ));
  const completed = await runEffect(transitionState.completeQueryEvaluation(
    begun.attempt,
    queryEvaluation,
    refresh,
    publicationArtifact("reference-active-query"),
  ));
  if (completed._tag !== "completed") {
    throw new Error("Expected an active reference query.");
  }
  return { transitionState, queryTarget };
}

describe("reference transition-state atomicity", () => {
  it("treats cursor-only apply as a write and leaves armed faults untouched on duplicate no-write", async () => {
    const bootstrapCursor = cursor();
    const harness = await runEffect(makeReferenceQuerySyncStateHarness());
    const transitionState = harness.bind(bindingFor(
      "physical-namespace-apply-disposition",
      bootstrapCursor,
    ));
    await runEffect(
      transitionState.initializeOrInspectNamespace(bootstrapCursor),
    );
    await runEffect(transitionState.injectNextFault({
      operation: "applyAdmittedBatchAndAdvance",
      timing: "beforeSwap",
    }));

    const duplicate = await runEffect(
      transitionState.applyAdmittedBatchAndAdvance(batch({ sequence: 0n })),
    );
    expect(duplicate).toMatchObject({ _tag: "duplicate" });

    const failure = await runEffectFailure(
      transitionState.applyAdmittedBatchAndAdvance(batch({ sequence: 1n })),
    );
    expect(failure).toMatchObject({
      _tag: "QuerySyncStateUnavailableError",
      operation: "applyAdmittedBatchAndAdvance",
      commitCertainty: "notCommitted",
    });
    expect(requireState(await runEffect(
      transitionState.snapshotForConformance(),
    )).cursor.appliedThroughSequence).toBe(0n);

    const applied = await runEffect(
      transitionState.applyAdmittedBatchAndAdvance(batch({ sequence: 1n })),
    );
    expect(applied).toMatchObject({
      _tag: "applied",
      affectedQueryKeys: [],
    });
    expect(requireState(await runEffect(
      transitionState.snapshotForConformance(),
    )).cursor.appliedThroughSequence).toBe(1n);
  });

  it("keeps affected-query apply atomic across both swap fault timings", async () => {
    const dependency = canonicalText("fault:affected-apply");
    for (const timing of ["beforeSwap", "afterSwap"] as const) {
      const { transitionState, queryTarget } =
        await prepareActiveReferenceQuery(
          `physical-affected-apply-${timing}`,
          dependency,
        );
      const before = requireState(await runEffect(
        transitionState.snapshotForConformance(),
      ));
      await runEffect(transitionState.injectNextFault({
        operation: "applyAdmittedBatchAndAdvance",
        timing,
      }));
      const admitted = batch({ sequence: 1n, dependencies: [dependency] });

      const failure = await runEffectFailure(
        transitionState.applyAdmittedBatchAndAdvance(admitted),
      );
      expect(failure).toMatchObject({
        operation: "applyAdmittedBatchAndAdvance",
        commitCertainty: timing === "beforeSwap" ? "notCommitted" : "unknown",
      });
      const afterFailure = requireState(await runEffect(
        transitionState.snapshotForConformance(),
      ));
      const afterFailureQuery = afterFailure.queries.find(
        (query) => query.descriptor.queryKey
          === queryTarget.descriptor.queryKey,
      );
      if (timing === "beforeSwap") {
        expect(afterFailure).toBe(before);
        expect(afterFailureQuery?.active?.dirtyThroughSequence).toBeNull();
        const retried = await runEffect(
          transitionState.applyAdmittedBatchAndAdvance(admitted),
        );
        expect(retried).toMatchObject({
          _tag: "applied",
          affectedQueryKeys: [queryTarget.descriptor.queryKey],
        });
        const committed = requireState(await runEffect(
          transitionState.snapshotForConformance(),
        ));
        expect(committed.cursor.appliedThroughSequence).toBe(1n);
        expect(committed.queries.find(
          (query) => query.descriptor.queryKey
            === queryTarget.descriptor.queryKey,
        )?.active?.dirtyThroughSequence).toBe(1n);
      } else {
        expect(failure).toBeInstanceOf(
          QuerySyncStateCommitOutcomeUnknownError,
        );
        expect(afterFailure.cursor.appliedThroughSequence).toBe(1n);
        expect(afterFailureQuery?.active?.dirtyThroughSequence).toBe(1n);
        const replayed = await runEffect(
          transitionState.applyAdmittedBatchAndAdvance(admitted),
        );
        expect(replayed).toMatchObject({ _tag: "duplicate" });
        expect(await runEffect(
          transitionState.snapshotForConformance(),
        )).toBe(afterFailure);
      }
    }
  });

  it("keeps write-bearing begin replay atomic across both swap fault timings", async () => {
    const dependency = canonicalText("fault:coalescing-begin");
    for (const timing of ["beforeSwap", "afterSwap"] as const) {
      const { transitionState, queryTarget } =
        await prepareActiveReferenceQuery(
          `physical-coalescing-begin-${timing}`,
          dependency,
        );
      await runEffect(transitionState.applyAdmittedBatchAndAdvance(batch({
        sequence: 1n,
        dependencies: [dependency],
      })));
      const dirtyAtOne = requireState(await runEffect(
        transitionState.snapshotForConformance(),
      )).queries.find(
        (query) => query.descriptor.queryKey === queryTarget.descriptor.queryKey,
      )?.active;
      if (
        dirtyAtOne === null
        || dirtyAtOne === undefined
        || dirtyAtOne.dirtyThroughSequence === null
      ) {
        throw new Error("Expected the active query to be dirty.");
      }
      const rerun = rerunEvaluationRequest({
        target: queryTarget,
        activeGeneration: dirtyAtOne.generation,
        dirtyThroughSequence: dirtyAtOne.dirtyThroughSequence,
      });
      expect(await runEffect(
        transitionState.beginQueryEvaluation(rerun),
      )).toMatchObject({
        _tag: "created",
        attempt: { requestedDirtyThroughSequence: 1n },
      });
      await runEffect(transitionState.applyAdmittedBatchAndAdvance(batch({
        sequence: 2n,
        dependencies: [dependency],
      })));
      const beforeCoalescing = requireState(await runEffect(
        transitionState.snapshotForConformance(),
      ));
      expect(beforeCoalescing.queries.find(
        (query) => query.descriptor.queryKey === queryTarget.descriptor.queryKey,
      )).toMatchObject({
        active: { dirtyThroughSequence: 2n },
        provisional: { requestedDirtyThroughSequence: 1n },
      });
      await runEffect(transitionState.injectNextFault({
        operation: "beginQueryEvaluation",
        timing,
      }));

      const failure = await runEffectFailure(
        transitionState.beginQueryEvaluation(rerun),
      );
      expect(failure).toMatchObject({
        operation: "beginQueryEvaluation",
        commitCertainty: timing === "beforeSwap" ? "notCommitted" : "unknown",
      });
      const afterFailure = requireState(await runEffect(
        transitionState.snapshotForConformance(),
      ));
      if (timing === "beforeSwap") {
        expect(afterFailure).toBe(beforeCoalescing);
      } else {
        expect(failure).toBeInstanceOf(
          QuerySyncStateCommitOutcomeUnknownError,
        );
        expect(afterFailure).not.toBe(beforeCoalescing);
        expect(afterFailure.queries.find(
          (query) => query.descriptor.queryKey
            === queryTarget.descriptor.queryKey,
        )?.provisional?.requestedDirtyThroughSequence).toBe(2n);
      }

      const replayed = await runEffect(
        transitionState.beginQueryEvaluation(rerun),
      );
      expect(replayed).toMatchObject({
        _tag: "replayed",
        attempt: { requestedDirtyThroughSequence: 2n },
      });
      const afterReplay = requireState(await runEffect(
        transitionState.snapshotForConformance(),
      ));
      expect(afterReplay.queries.find(
        (query) => query.descriptor.queryKey
          === queryTarget.descriptor.queryKey,
      )?.provisional?.requestedDirtyThroughSequence).toBe(2n);
      if (timing === "afterSwap") expect(afterReplay).toBe(afterFailure);
    }
  });

  it("captures only declared binding and fault fields", async () => {
    const bootstrapCursor = cursor();
    let extraGetterReads = 0;
    const poison = <A extends object>(value: A): A => Object.defineProperty(
      value,
      "unmeasured",
      {
        enumerable: true,
        get: () => {
          extraGetterReads += 1;
          throw new Error("Undeclared reference-state field was traversed.");
        },
      },
    );
    const harness = await runEffect(makeReferenceQuerySyncStateHarness());
    const transitionState = harness.bind(poison({
      physicalNamespaceId: "physical-exact-fields",
      namespaceId: bootstrapCursor.namespaceId,
      syncModelId: bootstrapCursor.syncModelId,
      sourceEpoch: bootstrapCursor.sourceEpoch,
    }));
    await runEffect(
      transitionState.initializeOrInspectNamespace(bootstrapCursor),
    );
    await runEffect(transitionState.injectNextFault(poison({
      operation: "beginQueryEvaluation" as const,
      timing: "beforeSwap" as const,
    })));

    expect(extraGetterReads).toBe(0);
    const failure = await runEffectFailure(
      transitionState.beginQueryEvaluation(firstEvaluationRequest()),
    );
    expect(failure).toBeInstanceOf(QuerySyncStateUnavailableError);
    expect(failure).toMatchObject({
      operation: "beginQueryEvaluation",
      commitCertainty: "notCommitted",
    });
    expect(extraGetterReads).toBe(0);
  });

  it("leaves state unchanged on a before-swap failure and classifies a safe retry", async () => {
    const bootstrapCursor = cursor();
    const harness = await runEffect(
      makeReferenceQuerySyncStateHarness(),
    );
    const transitionState = harness.bind(bindingFor(
      "physical-namespace-before-swap",
      bootstrapCursor,
    ));
    await runEffect(
      transitionState.initializeOrInspectNamespace(bootstrapCursor),
    );
    const before = requireState(await runEffect(
      transitionState.snapshotForConformance(),
    ));
    const beginRequest = firstEvaluationRequest();

    await runEffect(transitionState.injectNextFault({
      operation: "beginQueryEvaluation",
      timing: "beforeSwap",
    }));
    const failure = await runEffectFailure(
      transitionState.beginQueryEvaluation(beginRequest),
    );
    expect(failure).toBeInstanceOf(QuerySyncStateUnavailableError);
    expect(failure).toMatchObject({
      operation: "beginQueryEvaluation",
      commitCertainty: "notCommitted",
      reason: "temporarilyUnavailable",
    });
    expect(await runEffect(
      transitionState.snapshotForConformance(),
    )).toBe(before);

    expect(await runEffect(
      transitionState.beginQueryEvaluation(beginRequest),
    )).toMatchObject({
      _tag: "created",
      attempt: { generation: 1n },
    });
  });

  it("recovers a lost begin response without allocating another generation", async () => {
    const bootstrapCursor = cursor();
    const queryTarget = target();
    const beginRequest = firstEvaluationRequest(queryTarget);
    const harness = await runEffect(
      makeReferenceQuerySyncStateHarness(),
    );
    const transitionState = harness.bind(bindingFor(
      "physical-namespace-unknown-begin",
      bootstrapCursor,
    ));
    await runEffect(
      transitionState.initializeOrInspectNamespace(bootstrapCursor),
    );
    await runEffect(transitionState.injectNextFault({
      operation: "beginQueryEvaluation",
      timing: "afterSwap",
    }));

    const failure = await runEffectFailure(
      transitionState.beginQueryEvaluation(beginRequest),
    );
    expect(failure).toBeInstanceOf(
      QuerySyncStateCommitOutcomeUnknownError,
    );
    expect(failure).toMatchObject({
      operation: "beginQueryEvaluation",
      commitCertainty: "unknown",
      reason: "responseLostAfterCommit",
    });

    const committedBegin = requireState(await runEffect(
      transitionState.snapshotForConformance(),
    ));
    expect(committedBegin.queries[0]?.provisional).toMatchObject({
      generation: 1n,
      registrationCursor: bootstrapCursor,
    });

    const recoveredBegin = await runEffect(
      transitionState.beginQueryEvaluation(beginRequest),
    );
    expect(recoveredBegin).toMatchObject({
      _tag: "replayed",
      attempt: {
        descriptor: queryTarget.descriptor,
        generation: 1n,
        expectedActiveGeneration: null,
        registrationCursor: bootstrapCursor,
        requestedDirtyThroughSequence: null,
      },
    });
    if (recoveredBegin._tag !== "replayed") {
      throw new Error("Expected the committed begin attempt to replay.");
    }
    const attempt = recoveredBegin.attempt;
    const queryEvaluation = evaluation({
      descriptor: attempt.descriptor,
      generation: attempt.generation,
      snapshot: attempt.registrationCursor.appliedThroughSequence,
    });
    const refresh = getSuccess(deriveGenerationRefreshEvidence(
      queryEvaluation,
      attempt.registrationCursor,
      [],
      queryEvaluation.authorityWitness,
    ));
    expect(await runEffect(transitionState.completeQueryEvaluation(
      attempt,
      queryEvaluation,
      refresh,
      publicationArtifact("recovered-begin"),
    ))).toMatchObject({
      _tag: "completed",
      generation: 1n,
    });

    expect(await runEffect(
      transitionState.beginQueryEvaluation(beginRequest),
    )).toMatchObject({
      _tag: "alreadyAdvanced",
      descriptor: queryTarget.descriptor,
      requestedExpectedActiveGeneration: null,
      activeGeneration: 1n,
      freshThroughSequence: bootstrapCursor.appliedThroughSequence,
    });
    const afterOldRetry = requireState(await runEffect(
      transitionState.snapshotForConformance(),
    ));
    expect(afterOldRetry.queries[0]).toMatchObject({
      active: { generation: 1n },
      provisional: null,
    });
  });

  it("keeps completion atomic when a before-swap failure is known not committed", async () => {
    const bootstrapCursor = cursor();
    const harness = await runEffect(
      makeReferenceQuerySyncStateHarness(),
    );
    const transitionState = harness.bind(bindingFor(
      "physical-namespace-complete-before-swap",
      bootstrapCursor,
    ));
    await runEffect(
      transitionState.initializeOrInspectNamespace(bootstrapCursor),
    );
    const begun = await runEffect(
      transitionState.beginQueryEvaluation(firstEvaluationRequest()),
    );
    if (begun._tag !== "created") {
      throw new Error("Expected an evaluation attempt to be created.");
    }
    const attempt = begun.attempt;
    const queryEvaluation = evaluation({
      descriptor: attempt.descriptor,
      generation: attempt.generation,
      snapshot: attempt.registrationCursor.appliedThroughSequence,
    });
    const refresh = getSuccess(deriveGenerationRefreshEvidence(
      queryEvaluation,
      attempt.registrationCursor,
      [],
      queryEvaluation.authorityWitness,
    ));
    const publication = publicationArtifact("complete-before-swap");
    const beforeCompletion = requireState(await runEffect(
      transitionState.snapshotForConformance(),
    ));
    const provisionalBefore = beforeCompletion.queries[0]?.provisional;
    expect(beforeCompletion.queries[0]).toMatchObject({
      active: null,
      provisional: { generation: attempt.generation },
    });
    expect(beforeCompletion.publicationWork.pending).toEqual([]);

    await runEffect(transitionState.injectNextFault({
      operation: "completeQueryEvaluation",
      timing: "beforeSwap",
    }));
    const failure = await runEffectFailure(
      transitionState.completeQueryEvaluation(
        attempt,
        queryEvaluation,
        refresh,
        publication,
      ),
    );
    expect(failure).toBeInstanceOf(QuerySyncStateUnavailableError);
    expect(failure).toMatchObject({
      operation: "completeQueryEvaluation",
      commitCertainty: "notCommitted",
      reason: "temporarilyUnavailable",
    });

    const afterFailure = requireState(await runEffect(
      transitionState.snapshotForConformance(),
    ));
    expect(afterFailure).toBe(beforeCompletion);
    expect(afterFailure.queries[0]?.provisional).toBe(provisionalBefore);
    expect(afterFailure.queries[0]?.active).toBeNull();
    expect(afterFailure.publicationWork.pending).toBe(
      beforeCompletion.publicationWork.pending,
    );
    expect(afterFailure.publicationWork.pending).toHaveLength(0);

    const completed = await runEffect(
      transitionState.completeQueryEvaluation(
        attempt,
        queryEvaluation,
        refresh,
        publication,
      ),
    );
    expect(completed).toMatchObject({
      _tag: "completed",
      generation: attempt.generation,
      publicationDisposition: {
        _tag: "pending",
        identity: { generation: attempt.generation },
      },
    });
    const afterRetry = requireState(await runEffect(
      transitionState.snapshotForConformance(),
    ));
    expect(afterRetry.queries[0]).toMatchObject({
      active: { generation: attempt.generation },
      provisional: null,
    });
    expect(afterRetry.publicationWork.pending).toHaveLength(1);
    expect(afterRetry.publicationWork.pending[0]).toMatchObject({
      identity: { generation: attempt.generation },
      resultDigest: queryEvaluation.resultDigest,
      content: publication.content,
    });
  });

  it("replays a lost completion response with one identical pending publication", async () => {
    const bootstrapCursor = cursor();
    const harness = await runEffect(
      makeReferenceQuerySyncStateHarness(),
    );
    const transitionState = harness.bind(bindingFor(
      "physical-namespace-unknown-complete",
      bootstrapCursor,
    ));
    await runEffect(
      transitionState.initializeOrInspectNamespace(bootstrapCursor),
    );
    const begun = await runEffect(
      transitionState.beginQueryEvaluation(firstEvaluationRequest()),
    );
    expect(begun._tag).toBe("created");
    if (begun._tag !== "created") {
      throw new Error("Expected an evaluation attempt to be created.");
    }
    const attempt = begun.attempt;
    const queryEvaluation = evaluation({
      descriptor: attempt.descriptor,
      generation: attempt.generation,
      snapshot: attempt.registrationCursor.appliedThroughSequence,
    });
    const refresh = getSuccess(deriveGenerationRefreshEvidence(
      queryEvaluation,
      attempt.registrationCursor,
      [],
      queryEvaluation.authorityWitness,
    ));
    const publication = publicationArtifact("unknown-completion");
    await runEffect(transitionState.injectNextFault({
      operation: "completeQueryEvaluation",
      timing: "afterSwap",
    }));

    const failure = await runEffectFailure(
      transitionState.completeQueryEvaluation(
        attempt,
        queryEvaluation,
        refresh,
        publication,
      ),
    );
    expect(failure).toBeInstanceOf(
      QuerySyncStateCommitOutcomeUnknownError,
    );
    expect(failure).toMatchObject({
      operation: "completeQueryEvaluation",
      commitCertainty: "unknown",
      reason: "responseLostAfterCommit",
    });

    const committedCompletion = requireState(await runEffect(
      transitionState.snapshotForConformance(),
    ));
    expect(committedCompletion.queries[0]?.active).toMatchObject({
      generation: 1n,
      dirtyThroughSequence: null,
    });
    expect(committedCompletion.queries[0]?.provisional).toBeNull();
    expect(committedCompletion.publicationWork.pending).toHaveLength(1);
    const pendingPublication = committedCompletion.publicationWork.pending[0];
    if (pendingPublication === undefined) {
      throw new Error("Expected one pending publication after completion.");
    }
    expect(pendingPublication).toMatchObject({
      identity: {
        namespaceId: attempt.namespaceId,
        syncModelId: attempt.syncModelId,
        sourceEpoch: attempt.sourceEpoch,
        queryKey: attempt.descriptor.queryKey,
        generation: attempt.generation,
      },
      queryIdentity: attempt.descriptor.queryIdentity,
      completedThroughSequence: refresh.refreshedThroughSequence,
      resultDigest: queryEvaluation.resultDigest,
      content: publication.content,
    });

    const replayed = await runEffect(
      transitionState.completeQueryEvaluation(
        attempt,
        queryEvaluation,
        refresh,
        publication,
      ),
    );
    expect(replayed).toMatchObject({
      _tag: "replayed",
      generation: 1n,
      publicationDisposition: {
        _tag: "pending",
        identity: pendingPublication.identity,
      },
    });
    const afterReplay = requireState(await runEffect(
      transitionState.snapshotForConformance(),
    ));
    expect(afterReplay).toBe(committedCompletion);
    expect(afterReplay.publicationWork.pending).toEqual([pendingPublication]);
    expect(afterReplay.publicationWork.pending[0]).toBe(pendingPublication);
  });

  it("refuses a different logical namespace bound to the same physical store entry", async () => {
    const victimCursor = cursor({ namespaceId: "tenant-a" });
    const attackerCursor = cursor({ namespaceId: "tenant-b" });
    const harness = await runEffect(
      makeReferenceQuerySyncStateHarness(),
    );
    const victim = harness.bind(bindingFor(
      "shared-physical-namespace",
      victimCursor,
    ));
    const attacker = harness.bind(bindingFor(
      "shared-physical-namespace",
      attackerCursor,
    ));
    await runEffect(victim.initializeOrInspectNamespace(victimCursor));
    await runEffect(victim.beginQueryEvaluation(firstEvaluationRequest(
      target({ namespaceId: "tenant-a" }),
    )));
    const victimBeforeAttack = requireState(await runEffect(
      victim.snapshotForConformance(),
    ));

    const snapshotFailure = await runEffectFailure(
      attacker.snapshotForConformance(),
    );
    expect(snapshotFailure).toBeInstanceOf(
      ReferenceStateSnapshotBindingError,
    );
    expect(snapshotFailure).toMatchObject({
      operation: "snapshotForConformance",
      reason: "boundAuthorityMismatch",
    });

    const initializationFailure = await runEffectFailure(
      attacker.initializeOrInspectNamespace(attackerCursor),
    );
    expect(initializationFailure).toBeInstanceOf(
      QuerySyncStoredStateCorruptError,
    );
    expect(initializationFailure).toMatchObject({
      operation: "initializeOrInspectNamespace",
      commitCertainty: "notCommitted",
      reason: "namespaceBindingMismatch",
    });

    const beginFailure = await runEffectFailure(
      attacker.beginQueryEvaluation(firstEvaluationRequest(
        target({ namespaceId: "tenant-b" }),
      )),
    );
    expect(beginFailure).toBeInstanceOf(
      QuerySyncStoredStateCorruptError,
    );
    expect(beginFailure).toMatchObject({
      operation: "beginQueryEvaluation",
      commitCertainty: "notCommitted",
      reason: "namespaceBindingMismatch",
    });
    expect(await runEffect(victim.snapshotForConformance())).toBe(
      victimBeforeAttack,
    );

    const isolatedAttacker = harness.bind(bindingFor(
      "separate-physical-namespace",
      attackerCursor,
    ));
    expect(await runEffect(
      isolatedAttacker.initializeOrInspectNamespace(attackerCursor),
    )).toMatchObject({
      _tag: "initialized",
      cursor: attackerCursor,
    });
  });

  it("reports a previously initialized aggregate that disappears as corruption", async () => {
    const bootstrapCursor = cursor();
    const harness = await runEffect(
      makeReferenceQuerySyncStateHarness(),
    );
    const transitionState = harness.bind(bindingFor(
      "physical-namespace-lost-state",
      bootstrapCursor,
    ));
    await runEffect(
      transitionState.initializeOrInspectNamespace(bootstrapCursor),
    );
    await runEffect(transitionState.simulateAggregateLossForConformance());

    const failure = await runEffectFailure(
      transitionState.initializeOrInspectNamespace(bootstrapCursor),
    );
    expect(failure).toBeInstanceOf(QuerySyncStoredStateCorruptError);
    expect(failure).toMatchObject({
      operation: "initializeOrInspectNamespace",
      commitCertainty: "notCommitted",
      reason: "aggregateMissing",
    });
    expect(await runEffect(
      transitionState.snapshotForConformance(),
    )).toBeNull();
  });
});
