import { describe, expect, it } from "vitest";

import type {
  NamespaceCursor,
  QueryEvaluationAttempt,
  QueryOperationTarget,
  QuerySyncState,
} from "@flarex/query-sync/internal/kernel";
import {
  QuerySyncStateCommitOutcomeUnknownError,
  QuerySyncStateUnavailableError,
  QuerySyncStoredStateCorruptError,
} from "@flarex/query-sync/internal/state";
import {
  makeAcceptedQueryPublicationEvidenceForTesting,
  makeReferenceQuerySyncStateHarness,
  ReferenceStateSnapshotBindingError,
} from "@flarex/query-sync/testing/conformance";
import type {
  ReferenceQuerySyncTransitionState,
  ReferenceStateBinding,
} from "@flarex/query-sync/testing/conformance";
import {
  deriveGenerationRefreshEvidence,
} from "@flarex/query-sync/testing/reference-model";

import {
  batch,
  canonicalText,
  cursor,
  descriptor,
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

async function installPendingReferencePublication(
  transitionState: ReferenceQuerySyncTransitionState,
  queryTarget: QueryOperationTarget,
  dependency: string,
  label: string,
  resultSeed = 80,
) {
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
    resultSeed,
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
    publicationArtifact(label),
  ));
  if (completed._tag !== "completed") {
    throw new Error("Expected an active reference query.");
  }
  return Object.freeze({
    attempt: begun.attempt,
    evaluation: queryEvaluation,
    refresh,
  });
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
  await installPendingReferencePublication(
    transitionState,
    queryTarget,
    dependency,
    "reference-active-query",
  );
  return { transitionState, queryTarget };
}

async function prepareMaterialRerun(
  physicalNamespaceId: string,
  dependency: string,
  resultSeed: number,
) {
  const { transitionState, queryTarget } =
    await prepareActiveReferenceQuery(physicalNamespaceId, dependency);
  await runEffect(transitionState.applyAdmittedBatchAndAdvance(batch({
    sequence: 1n,
    dependencies: [dependency],
  })));
  const dirtyState = requireState(await runEffect(
    transitionState.snapshotForConformance(),
  ));
  const dirtyActive = dirtyState.queries.find((query) => (
    query.descriptor.queryKey === queryTarget.descriptor.queryKey
  ))?.active;
  if (
    dirtyActive === null
    || dirtyActive === undefined
    || dirtyActive.dirtyThroughSequence === null
  ) {
    throw new Error("Expected an active dirty query for completion.");
  }
  const begun = await runEffect(transitionState.beginQueryEvaluation(
    rerunEvaluationRequest({
      target: queryTarget,
      activeGeneration: dirtyActive.generation,
      dirtyThroughSequence: dirtyActive.dirtyThroughSequence,
    }),
  ));
  if (begun._tag !== "created") {
    throw new Error("Expected a rerun evaluation attempt to be created.");
  }
  const attempt = begun.attempt;
  const queryEvaluation = evaluation({
    descriptor: attempt.descriptor,
    generation: attempt.generation,
    snapshot: attempt.registrationCursor.appliedThroughSequence,
    resultSeed,
    dependencies: [dependency],
  });
  const refresh = getSuccess(deriveGenerationRefreshEvidence(
    queryEvaluation,
    attempt.registrationCursor,
    [],
    queryEvaluation.authorityWitness,
  ));
  const beforeCompletion = requireState(await runEffect(
    transitionState.snapshotForConformance(),
  ));
  const previousPending = beforeCompletion.publicationWork.pending.find(
    (candidate) => candidate.identity.queryKey
      === queryTarget.descriptor.queryKey,
  );
  if (previousPending === undefined) {
    throw new Error("Expected the prior generation publication to be pending.");
  }
  return {
    transitionState,
    queryTarget,
    attempt,
    queryEvaluation,
    refresh,
    publication: publicationArtifact(
      `completion-${resultSeed}-${physicalNamespaceId}`,
    ),
    beforeCompletion,
    previousPending,
  };
}

async function claimReferenceEvaluationAttempt(
  transitionState: ReferenceQuerySyncTransitionState,
): Promise<QueryEvaluationAttempt> {
  const receipt = await runEffect(transitionState.claimEvaluationWork({
    maximumQueryInspections: 1,
    continuation: null,
  }));
  if (receipt._tag !== "claimed") {
    throw new Error("Expected reference evaluation work to be claimed.");
  }
  return receipt.attempt;
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

  it("keeps ready and dirty evaluation claims atomic across both swap fault timings", async () => {
    for (const timing of ["beforeSwap", "afterSwap"] as const) {
      const bootstrapCursor = cursor();
      const readyHarness = await runEffect(
        makeReferenceQuerySyncStateHarness(),
      );
      const readyState = readyHarness.bind(bindingFor(
        `physical-ready-claim-${timing}`,
        bootstrapCursor,
      ));
      await runEffect(
        readyState.initializeOrInspectNamespace(bootstrapCursor),
      );
      const begun = await runEffect(
        readyState.beginQueryEvaluation(firstEvaluationRequest()),
      );
      if (begun._tag !== "created") {
        throw new Error("Expected ready evaluation work.");
      }
      const beforeReadyClaim = requireState(await runEffect(
        readyState.snapshotForConformance(),
      ));
      await runEffect(readyState.injectNextFault({
        operation: "claimEvaluationWork",
        timing,
      }));
      const readyFailure = await runEffectFailure(
        readyState.claimEvaluationWork({
          maximumQueryInspections: 1,
          continuation: null,
        }),
      );
      expect(readyFailure).toMatchObject({
        operation: "claimEvaluationWork",
        commitCertainty: timing === "beforeSwap" ? "notCommitted" : "unknown",
      });
      const afterReadyFailure = requireState(await runEffect(
        readyState.snapshotForConformance(),
      ));
      if (timing === "beforeSwap") {
        expect(afterReadyFailure).toBe(beforeReadyClaim);
      } else {
        expect(readyFailure).toBeInstanceOf(
          QuerySyncStateCommitOutcomeUnknownError,
        );
        expect(afterReadyFailure).not.toBe(beforeReadyClaim);
        expect(afterReadyFailure.evaluationWork).toEqual({
          revision: beforeReadyClaim.evaluationWork.revision,
          fairnessAnchor: begun.attempt.descriptor.queryKey,
        });
      }
      const recoveredReady = await runEffect(
        readyState.claimEvaluationWork({
          maximumQueryInspections: 1,
          continuation: null,
        }),
      );
      expect(recoveredReady).toMatchObject({
        _tag: "claimed",
        attempt: { generation: begun.attempt.generation },
      });

      const dependency = canonicalText(`fault:dirty-claim-${timing}`);
      const prepared = await prepareActiveReferenceQuery(
        `physical-dirty-claim-${timing}`,
        dependency,
      );
      await runEffect(
        prepared.transitionState.applyAdmittedBatchAndAdvance(batch({
          sequence: 1n,
          dependencies: [dependency],
        })),
      );
      const beforeDirtyClaim = requireState(await runEffect(
        prepared.transitionState.snapshotForConformance(),
      ));
      expect(beforeDirtyClaim.queries[0]?.provisional).toBeNull();
      await runEffect(prepared.transitionState.injectNextFault({
        operation: "claimEvaluationWork",
        timing,
      }));
      const dirtyFailure = await runEffectFailure(
        prepared.transitionState.claimEvaluationWork({
          maximumQueryInspections: 1,
          continuation: null,
        }),
      );
      expect(dirtyFailure).toMatchObject({
        operation: "claimEvaluationWork",
        commitCertainty: timing === "beforeSwap" ? "notCommitted" : "unknown",
      });
      const afterDirtyFailure = requireState(await runEffect(
        prepared.transitionState.snapshotForConformance(),
      ));
      if (timing === "beforeSwap") {
        expect(afterDirtyFailure).toBe(beforeDirtyClaim);
      } else {
        expect(afterDirtyFailure.queries[0]?.provisional).toMatchObject({
          generation: 2n,
          expectedActiveGeneration: 1n,
          requestedDirtyThroughSequence: 1n,
          evaluationDisposition: { _tag: "ready" },
        });
        expect(afterDirtyFailure.evaluationWork.revision).toBe(
          beforeDirtyClaim.evaluationWork.revision + 1n,
        );
      }
      const recoveredDirty = await runEffect(
        prepared.transitionState.claimEvaluationWork({
          maximumQueryInspections: 1,
          continuation: null,
        }),
      );
      expect(recoveredDirty).toMatchObject({
        _tag: "claimed",
        attempt: {
          generation: 2n,
          expectedActiveGeneration: 1n,
          requestedDirtyThroughSequence: 1n,
        },
      });
    }
  });

  it("keeps terminal outcome blocking atomic across both swap fault timings", async () => {
    for (const timing of ["beforeSwap", "afterSwap"] as const) {
      const bootstrapCursor = cursor();
      const harness = await runEffect(makeReferenceQuerySyncStateHarness());
      const transitionState = harness.bind(bindingFor(
        `physical-terminal-outcome-${timing}`,
        bootstrapCursor,
      ));
      await runEffect(
        transitionState.initializeOrInspectNamespace(bootstrapCursor),
      );
      await runEffect(
        transitionState.beginQueryEvaluation(firstEvaluationRequest()),
      );
      const attempt = await claimReferenceEvaluationAttempt(transitionState);
      const beforeOutcome = requireState(await runEffect(
        transitionState.snapshotForConformance(),
      ));
      await runEffect(transitionState.injectNextFault({
        operation: "recordEvaluationAttemptOutcome",
        timing,
      }));
      const failure = await runEffectFailure(
        transitionState.recordEvaluationAttemptOutcome(
          attempt,
          "terminalRefusal",
        ),
      );
      expect(failure).toMatchObject({
        operation: "recordEvaluationAttemptOutcome",
        commitCertainty: timing === "beforeSwap" ? "notCommitted" : "unknown",
      });
      const afterFailure = requireState(await runEffect(
        transitionState.snapshotForConformance(),
      ));
      if (timing === "beforeSwap") {
        expect(afterFailure).toBe(beforeOutcome);
      } else {
        expect(failure).toBeInstanceOf(
          QuerySyncStateCommitOutcomeUnknownError,
        );
        expect(afterFailure.queries[0]?.provisional
          ?.evaluationDisposition).toMatchObject({
          _tag: "blocked",
          reason: "terminalEvaluatorRefusal",
          resetRequired: true,
        });
        expect(afterFailure.evaluationWork.revision).toBe(
          beforeOutcome.evaluationWork.revision + 1n,
        );
        expect(afterFailure.metrics.countedCanonicalBytes).toBe(
          beforeOutcome.metrics.countedCanonicalBytes + 2,
        );
      }
      const recovered = await runEffect(
        transitionState.recordEvaluationAttemptOutcome(
          attempt,
          "terminalRefusal",
        ),
      );
      expect(recovered).toMatchObject({
        _tag: "blocked",
        blockedWork: {
          queryKey: attempt.descriptor.queryKey,
          generation: attempt.generation,
          reason: "terminalEvaluatorRefusal",
          resetRequired: true,
        },
      });
      const afterRecovery = requireState(await runEffect(
        transitionState.snapshotForConformance(),
      ));
      expect(afterRecovery.evaluationWork.revision).toBe(
        beforeOutcome.evaluationWork.revision + 1n,
      );
      expect(afterRecovery.metrics.countedCanonicalBytes).toBe(
        beforeOutcome.metrics.countedCanonicalBytes + 2,
      );
      if (timing === "afterSwap") expect(afterRecovery).toBe(afterFailure);
    }
  });

  it("retains an outcome fault across a no-write and an authenticated failure", async () => {
    for (const timing of ["beforeSwap", "afterSwap"] as const) {
      const bootstrapCursor = cursor();
      const harness = await runEffect(makeReferenceQuerySyncStateHarness());
      const transitionState = harness.bind(bindingFor(
        `physical-outcome-retained-fault-${timing}`,
        bootstrapCursor,
      ));
      await runEffect(
        transitionState.initializeOrInspectNamespace(bootstrapCursor),
      );
      await runEffect(
        transitionState.beginQueryEvaluation(firstEvaluationRequest()),
      );
      const attempt = await claimReferenceEvaluationAttempt(transitionState);
      const before = requireState(await runEffect(
        transitionState.snapshotForConformance(),
      ));
      await runEffect(transitionState.injectNextFault({
        operation: "recordEvaluationAttemptOutcome",
        timing,
      }));
      expect(await runEffect(
        transitionState.recordEvaluationAttemptOutcome(
          attempt,
          "transientExhausted",
        ),
      )).toMatchObject({ _tag: "eligible" });
      const forgery = {
        ...attempt,
        descriptor: { ...attempt.descriptor },
      } as unknown as QueryEvaluationAttempt;
      expect(await runEffectFailure(
        transitionState.recordEvaluationAttemptOutcome(
          forgery,
          "terminalRefusal",
        ),
      )).toMatchObject({
        _tag: "InvalidEvaluationAttemptError",
        reason: "notStateIssued",
      });
      expect(await runEffect(
        transitionState.snapshotForConformance(),
      )).toBe(before);

      const failure = await runEffectFailure(
        transitionState.recordEvaluationAttemptOutcome(
          attempt,
          "terminalRefusal",
        ),
      );
      expect(failure).toMatchObject({
        operation: "recordEvaluationAttemptOutcome",
        commitCertainty: timing === "beforeSwap" ? "notCommitted" : "unknown",
      });
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

  it("keeps pending replacement and unchanged completion writes atomic across both swap fault timings", async () => {
    const variants = [
      { name: "pending-replacement", resultSeed: 81, disposition: "pending" },
      { name: "unchanged-digest", resultSeed: 80, disposition: "unchanged" },
    ] as const;
    for (const variant of variants) {
      for (const timing of ["beforeSwap", "afterSwap"] as const) {
        const dependency = canonicalText(
          `fault:complete-${variant.name}-${timing}`,
        );
        const prepared = await prepareMaterialRerun(
          `physical-complete-${variant.name}-${timing}`,
          dependency,
          variant.resultSeed,
        );
        await runEffect(prepared.transitionState.injectNextFault({
          operation: "completeQueryEvaluation",
          timing,
        }));

        const failure = await runEffectFailure(
          prepared.transitionState.completeQueryEvaluation(
            prepared.attempt,
            prepared.queryEvaluation,
            prepared.refresh,
            prepared.publication,
          ),
        );
        expect(failure).toMatchObject({
          operation: "completeQueryEvaluation",
          commitCertainty:
            timing === "beforeSwap" ? "notCommitted" : "unknown",
        });
        const afterFailure = requireState(await runEffect(
          prepared.transitionState.snapshotForConformance(),
        ));
        if (timing === "beforeSwap") {
          expect(afterFailure).toBe(prepared.beforeCompletion);
        } else {
          expect(failure).toBeInstanceOf(
            QuerySyncStateCommitOutcomeUnknownError,
          );
          expect(afterFailure).not.toBe(prepared.beforeCompletion);
          expect(afterFailure.queries.find((query) => (
            query.descriptor.queryKey
              === prepared.queryTarget.descriptor.queryKey
          ))?.currentCompletion?.publicationDisposition._tag).toBe(
            variant.disposition,
          );
        }

        const recovered = await runEffect(
          prepared.transitionState.completeQueryEvaluation(
            prepared.attempt,
            prepared.queryEvaluation,
            prepared.refresh,
            prepared.publication,
          ),
        );
        expect(recovered).toMatchObject({
          _tag: timing === "beforeSwap" ? "completed" : "replayed",
          generation: prepared.attempt.generation,
          publicationDisposition: { _tag: variant.disposition },
        });
        const committed = requireState(await runEffect(
          prepared.transitionState.snapshotForConformance(),
        ));
        if (timing === "afterSwap") expect(committed).toBe(afterFailure);
        expect(committed.queries.find((query) => (
          query.descriptor.queryKey
            === prepared.queryTarget.descriptor.queryKey
        ))).toMatchObject({
          active: {
            generation: prepared.attempt.generation,
            resultDigest: prepared.queryEvaluation.resultDigest,
          },
          provisional: null,
          currentCompletion: {
            identity: { generation: prepared.attempt.generation },
            publicationDisposition: { _tag: variant.disposition },
          },
        });
        const pending = committed.publicationWork.pending.filter(
          (candidate) => candidate.identity.queryKey
            === prepared.queryTarget.descriptor.queryKey,
        );
        expect(pending).toHaveLength(1);
        if (variant.disposition === "pending") {
          expect(pending[0]).toMatchObject({
            identity: { generation: prepared.attempt.generation },
            resultDigest: prepared.queryEvaluation.resultDigest,
            content: prepared.publication.content,
          });
          expect(pending[0]?.identity).not.toEqual(
            prepared.previousPending.identity,
          );
        } else {
          expect(pending[0]).toEqual(prepared.previousPending);
          expect(pending[0]?.identity.generation).toBe(1n);
        }
      }
    }
  });

  it("does not consume completion faults on no-write or failure before a material write", async () => {
    for (const timing of ["beforeSwap", "afterSwap"] as const) {
      const bootstrapCursor = cursor();
      const harness = await runEffect(makeReferenceQuerySyncStateHarness());
      const transitionState = harness.bind(bindingFor(
        `physical-complete-fault-retention-${timing}`,
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
      const staleRefresh = getSuccess(deriveGenerationRefreshEvidence(
        queryEvaluation,
        attempt.registrationCursor,
        [],
        queryEvaluation.authorityWitness,
      ));
      const admitted = batch({ sequence: 1n });
      await runEffect(
        transitionState.applyAdmittedBatchAndAdvance(admitted),
      );
      const beforeCompletion = requireState(await runEffect(
        transitionState.snapshotForConformance(),
      ));
      await runEffect(transitionState.injectNextFault({
        operation: "completeQueryEvaluation",
        timing,
      }));

      expect(await runEffect(transitionState.completeQueryEvaluation(
        attempt,
        queryEvaluation,
        staleRefresh,
        publicationArtifact("fault-retention-stale"),
      ))).toMatchObject({
        _tag: "refreshRequired",
        refreshedThroughSequence: 0n,
        requiredThroughSequence: 1n,
      });
      expect(await runEffect(
        transitionState.snapshotForConformance(),
      )).toBe(beforeCompletion);

      const mismatchedEvaluation = evaluation({
        descriptor: attempt.descriptor,
        generation: attempt.generation + 1n,
        snapshot: attempt.registrationCursor.appliedThroughSequence,
      });
      const mismatchedRefresh = getSuccess(deriveGenerationRefreshEvidence(
        mismatchedEvaluation,
        beforeCompletion.cursor,
        [admitted],
        mismatchedEvaluation.authorityWitness,
      ));
      expect(await runEffectFailure(
        transitionState.completeQueryEvaluation(
          attempt,
          mismatchedEvaluation,
          mismatchedRefresh,
          publicationArtifact("fault-retention-invalid"),
        ),
      )).toMatchObject({
        _tag: "InvalidQueryEvidenceError",
        reason: "attemptEvaluationGenerationMismatch",
      });
      expect(await runEffect(
        transitionState.snapshotForConformance(),
      )).toBe(beforeCompletion);

      const currentRefresh = getSuccess(deriveGenerationRefreshEvidence(
        queryEvaluation,
        beforeCompletion.cursor,
        [admitted],
        queryEvaluation.authorityWitness,
      ));
      const materialFailure = await runEffectFailure(
        transitionState.completeQueryEvaluation(
          attempt,
          queryEvaluation,
          currentRefresh,
          publicationArtifact("fault-retention-material"),
        ),
      );
      expect(materialFailure).toMatchObject({
        operation: "completeQueryEvaluation",
        commitCertainty:
          timing === "beforeSwap" ? "notCommitted" : "unknown",
      });
      const afterMaterialFailure = requireState(await runEffect(
        transitionState.snapshotForConformance(),
      ));
      if (timing === "beforeSwap") {
        expect(afterMaterialFailure).toBe(beforeCompletion);
      } else {
        expect(materialFailure).toBeInstanceOf(
          QuerySyncStateCommitOutcomeUnknownError,
        );
        expect(afterMaterialFailure.queries[0]).toMatchObject({
          active: { generation: attempt.generation },
          provisional: null,
        });
      }
      expect(await runEffect(transitionState.completeQueryEvaluation(
        attempt,
        queryEvaluation,
        currentRefresh,
        publicationArtifact("fault-retention-material"),
      ))).toMatchObject({
        _tag: timing === "beforeSwap" ? "completed" : "replayed",
        publicationDisposition: { _tag: "pending" },
      });
    }
  });

  it("keeps a fresh publication claim atomic across both swap fault timings", async () => {
    for (const timing of ["beforeSwap", "afterSwap"] as const) {
      const prepared = await prepareActiveReferenceQuery(
        `physical-publication-claim-${timing}`,
        canonicalText(`publication-claim-${timing}`),
      );
      const beforeClaim = requireState(await runEffect(
        prepared.transitionState.snapshotForConformance(),
      ));
      expect(beforeClaim.publicationWork.pending).toHaveLength(1);
      expect(beforeClaim.publicationWork.inFlight).toBeNull();
      await runEffect(prepared.transitionState.injectNextFault({
        operation: "claimPublication",
        timing,
      }));

      const failure = await runEffectFailure(
        prepared.transitionState.claimPublication(),
      );
      expect(failure).toMatchObject({
        operation: "claimPublication",
        commitCertainty:
          timing === "beforeSwap" ? "notCommitted" : "unknown",
      });
      const afterFailure = requireState(await runEffect(
        prepared.transitionState.snapshotForConformance(),
      ));
      if (timing === "beforeSwap") {
        expect(afterFailure).toBe(beforeClaim);
        expect(afterFailure.publicationWork.pending).toHaveLength(1);
        expect(afterFailure.publicationWork.inFlight).toBeNull();
      } else {
        expect(failure).toBeInstanceOf(
          QuerySyncStateCommitOutcomeUnknownError,
        );
        expect(afterFailure).not.toBe(beforeClaim);
        expect(afterFailure.publicationWork.pending).toHaveLength(0);
        expect(afterFailure.publicationWork.inFlight).toMatchObject({
          attemptOrdinal: 1,
          disposition: { _tag: "ready" },
        });
      }

      const recovered = await runEffect(
        prepared.transitionState.claimPublication(),
      );
      expect(recovered).toMatchObject({
        _tag: timing === "beforeSwap" ? "claimed" : "replayed",
        attempt: { attemptOrdinal: 1 },
      });
      if (recovered._tag === "blocked" || recovered._tag === "none") {
        throw new Error("Expected a recovered publication attempt.");
      }
      const committed = requireState(await runEffect(
        prepared.transitionState.snapshotForConformance(),
      ));
      expect(committed.publicationWork.pending).toHaveLength(0);
      expect(committed.publicationWork.inFlight).toMatchObject({
        publication: recovered.attempt.publication,
        attemptOrdinal: 1,
      });
      if (timing === "afterSwap") expect(committed).toBe(afterFailure);
    }
  });

  it("keeps a publication outcome write atomic across both swap fault timings", async () => {
    for (const timing of ["beforeSwap", "afterSwap"] as const) {
      const prepared = await prepareActiveReferenceQuery(
        `physical-publication-outcome-${timing}`,
        canonicalText(`publication-outcome-${timing}`),
      );
      const claimed = await runEffect(
        prepared.transitionState.claimPublication(),
      );
      if (claimed._tag !== "claimed") {
        throw new Error("Expected a fresh publication attempt.");
      }
      const beforeOutcome = requireState(await runEffect(
        prepared.transitionState.snapshotForConformance(),
      ));
      await runEffect(prepared.transitionState.injectNextFault({
        operation: "recordPublicationAttemptOutcome",
        timing,
      }));

      const failure = await runEffectFailure(
        prepared.transitionState.recordPublicationAttemptOutcome(
          claimed.attempt,
          "knownNotAppended",
        ),
      );
      expect(failure).toMatchObject({
        operation: "recordPublicationAttemptOutcome",
        commitCertainty:
          timing === "beforeSwap" ? "notCommitted" : "unknown",
      });
      const afterFailure = requireState(await runEffect(
        prepared.transitionState.snapshotForConformance(),
      ));
      if (timing === "beforeSwap") {
        expect(afterFailure).toBe(beforeOutcome);
        expect(afterFailure.publicationWork.inFlight).toMatchObject({
          attemptOrdinal: 1,
        });
        expect(afterFailure.publicationWork.precedingAttemptOutcome).toBeNull();
      } else {
        expect(failure).toBeInstanceOf(
          QuerySyncStateCommitOutcomeUnknownError,
        );
        expect(afterFailure).not.toBe(beforeOutcome);
        expect(afterFailure.publicationWork.inFlight).toMatchObject({
          attemptOrdinal: 2,
          disposition: { _tag: "ready" },
        });
        expect(afterFailure.publicationWork.precedingAttemptOutcome)
          .toMatchObject({
            attemptOrdinal: 1,
            outcome: "knownNotAppended",
          });
      }

      expect(await runEffect(
        prepared.transitionState.recordPublicationAttemptOutcome(
          claimed.attempt,
          "knownNotAppended",
        ),
      )).toMatchObject({
        _tag: "recorded",
        attemptOrdinal: 1,
        nextAttemptOrdinal: 2,
        nextDisposition: "ready",
      });
      const committed = requireState(await runEffect(
        prepared.transitionState.snapshotForConformance(),
      ));
      expect(committed.publicationWork.inFlight).toMatchObject({
        attemptOrdinal: 2,
        disposition: { _tag: "ready" },
      });
      if (timing === "afterSwap") expect(committed).toBe(afterFailure);
    }
  });

  it("keeps a publication completion write atomic across both swap fault timings", async () => {
    for (const timing of ["beforeSwap", "afterSwap"] as const) {
      const prepared = await prepareActiveReferenceQuery(
        `physical-publication-completion-${timing}`,
        canonicalText(`publication-completion-${timing}`),
      );
      const claimed = await runEffect(
        prepared.transitionState.claimPublication(),
      );
      if (claimed._tag !== "claimed") {
        throw new Error("Expected a fresh publication attempt.");
      }
      const evidence = makeAcceptedQueryPublicationEvidenceForTesting({
        identity: claimed.attempt.publication.identity,
        resultDigest: claimed.attempt.publication.resultDigest,
      });
      const beforeCompletion = requireState(await runEffect(
        prepared.transitionState.snapshotForConformance(),
      ));
      await runEffect(prepared.transitionState.injectNextFault({
        operation: "completePublication",
        timing,
      }));

      const failure = await runEffectFailure(
        prepared.transitionState.completePublication(evidence),
      );
      expect(failure).toMatchObject({
        operation: "completePublication",
        commitCertainty:
          timing === "beforeSwap" ? "notCommitted" : "unknown",
      });
      const afterFailure = requireState(await runEffect(
        prepared.transitionState.snapshotForConformance(),
      ));
      if (timing === "beforeSwap") {
        expect(afterFailure).toBe(beforeCompletion);
        expect(afterFailure.publicationWork.inFlight).not.toBeNull();
        expect(afterFailure.publicationWork.latestDelivered).toBeNull();
      } else {
        expect(failure).toBeInstanceOf(
          QuerySyncStateCommitOutcomeUnknownError,
        );
        expect(afterFailure).not.toBe(beforeCompletion);
        expect(afterFailure.publicationWork.inFlight).toBeNull();
        expect(afterFailure.publicationWork.latestDelivered).toMatchObject({
          identity: evidence.identity,
          resultDigest: evidence.resultDigest,
        });
      }

      expect(await runEffect(
        prepared.transitionState.completePublication(evidence),
      )).toMatchObject({
        _tag: timing === "beforeSwap" ? "completed" : "replayed",
        identity: evidence.identity,
      });
      const committed = requireState(await runEffect(
        prepared.transitionState.snapshotForConformance(),
      ));
      expect(committed.publicationWork.inFlight).toBeNull();
      expect(committed.publicationWork.latestDelivered).toMatchObject({
        identity: evidence.identity,
      });
      if (timing === "afterSwap") expect(committed).toBe(afterFailure);
    }
  });

  it("retains publication claim faults across an empty no-write", async () => {
    for (const timing of ["beforeSwap", "afterSwap"] as const) {
      const bootstrapCursor = cursor();
      const harness = await runEffect(makeReferenceQuerySyncStateHarness());
      const transitionState = harness.bind(bindingFor(
        `physical-publication-claim-retention-${timing}`,
        bootstrapCursor,
      ));
      await runEffect(
        transitionState.initializeOrInspectNamespace(bootstrapCursor),
      );
      await runEffect(transitionState.injectNextFault({
        operation: "claimPublication",
        timing,
      }));

      expect(await runEffect(transitionState.claimPublication()))
        .toEqual({ _tag: "none" });
      await installPendingReferencePublication(
        transitionState,
        target(),
        canonicalText(`publication-claim-retention-${timing}`),
        `publication-claim-retention-${timing}`,
      );
      expect(await runEffectFailure(transitionState.claimPublication()))
        .toMatchObject({
          operation: "claimPublication",
          commitCertainty:
            timing === "beforeSwap" ? "notCommitted" : "unknown",
        });
    }
  });

  it("retains publication outcome faults across replay and failure", async () => {
    for (const timing of ["beforeSwap", "afterSwap"] as const) {
      const prepared = await prepareActiveReferenceQuery(
        `physical-publication-outcome-retention-${timing}`,
        canonicalText(`publication-outcome-retention-${timing}`),
      );
      const firstClaim = await runEffect(
        prepared.transitionState.claimPublication(),
      );
      if (firstClaim._tag !== "claimed") {
        throw new Error("Expected the first publication attempt.");
      }
      await runEffect(prepared.transitionState.recordPublicationAttemptOutcome(
        firstClaim.attempt,
        "knownNotAppended",
      ));
      const secondClaim = await runEffect(
        prepared.transitionState.claimPublication(),
      );
      if (secondClaim._tag !== "replayed") {
        throw new Error("Expected the second publication attempt.");
      }
      const before = requireState(await runEffect(
        prepared.transitionState.snapshotForConformance(),
      ));
      await runEffect(prepared.transitionState.injectNextFault({
        operation: "recordPublicationAttemptOutcome",
        timing,
      }));

      expect(await runEffect(
        prepared.transitionState.recordPublicationAttemptOutcome(
          firstClaim.attempt,
          "knownNotAppended",
        ),
      )).toMatchObject({
        _tag: "recorded",
        attemptOrdinal: 1,
        nextAttemptOrdinal: 2,
      });
      expect(await runEffectFailure(
        prepared.transitionState.recordPublicationAttemptOutcome(
          firstClaim.attempt,
          "outcomeUnknown",
        ),
      )).toMatchObject({
        _tag: "InvalidPublicationAttemptOutcomeReplayError",
        reason: "outcomeMismatch",
      });
      expect(await runEffect(
        prepared.transitionState.snapshotForConformance(),
      )).toBe(before);

      expect(await runEffectFailure(
        prepared.transitionState.recordPublicationAttemptOutcome(
          secondClaim.attempt,
          "knownNotAppended",
        ),
      )).toMatchObject({
        operation: "recordPublicationAttemptOutcome",
        commitCertainty:
          timing === "beforeSwap" ? "notCommitted" : "unknown",
      });
    }
  });

  it("retains publication completion faults across failure and supersession", async () => {
    for (const timing of ["beforeSwap", "afterSwap"] as const) {
      const prepared = await prepareActiveReferenceQuery(
        `physical-publication-completion-retention-${timing}`,
        canonicalText(`publication-completion-retention-${timing}`),
      );
      const claimed = await runEffect(
        prepared.transitionState.claimPublication(),
      );
      if (claimed._tag !== "claimed") {
        throw new Error("Expected a fresh publication attempt.");
      }
      const correctEvidence = makeAcceptedQueryPublicationEvidenceForTesting({
        identity: claimed.attempt.publication.identity,
        resultDigest: claimed.attempt.publication.resultDigest,
      });
      const mismatchedDigestEvidence =
        makeAcceptedQueryPublicationEvidenceForTesting({
          identity: claimed.attempt.publication.identity,
          resultDigest: evaluation({
            generation: 1n,
            snapshot: 0n,
            resultSeed: 999,
          }).resultDigest,
        });
      const unrelatedQueryKey = descriptor({
        keySeed: 9_999,
        identity: `completion-retention-unrelated-${timing}`,
      }).queryKey;
      const supersededEvidence = makeAcceptedQueryPublicationEvidenceForTesting({
        identity: {
          ...claimed.attempt.publication.identity,
          queryKey: unrelatedQueryKey,
        },
        resultDigest: claimed.attempt.publication.resultDigest,
      });
      const before = requireState(await runEffect(
        prepared.transitionState.snapshotForConformance(),
      ));
      await runEffect(prepared.transitionState.injectNextFault({
        operation: "completePublication",
        timing,
      }));

      expect(await runEffectFailure(
        prepared.transitionState.completePublication(mismatchedDigestEvidence),
      )).toMatchObject({
        _tag: "InvalidAcceptedPublicationEvidenceError",
        reason: "resultDigestMismatch",
      });
      expect(await runEffect(
        prepared.transitionState.completePublication(supersededEvidence),
      )).toMatchObject({
        _tag: "superseded",
        identity: supersededEvidence.identity,
      });
      expect(await runEffect(
        prepared.transitionState.snapshotForConformance(),
      )).toBe(before);

      expect(await runEffectFailure(
        prepared.transitionState.completePublication(correctEvidence),
      )).toMatchObject({
        operation: "completePublication",
        commitCertainty:
          timing === "beforeSwap" ? "notCommitted" : "unknown",
      });
    }
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
