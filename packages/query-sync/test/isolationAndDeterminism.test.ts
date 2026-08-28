import { Result } from "effect";
import { describe, expect, it } from "vitest";

import {
  applyAdmittedInvalidations,
  canonicalPublicationContentDecodedLength,
  captureQueryGeneration,
  captureQueryDescriptor,
  MAX_AGGREGATE_DEPENDENCY_MEMBERSHIPS,
  MAX_CANONICAL_DEPENDENCY_KEY_BYTES,
  MAX_CANONICAL_QUERY_IDENTITY_BYTES,
  MAX_COUNTED_CANONICAL_BYTES,
  MAX_INVALIDATION_BATCH_BYTES,
  MAX_INVALIDATION_KEYS,
  MAX_QUERY_DEPENDENCY_KEYS,
  MAX_REFERENCE_QUERIES,
  MAX_REFRESH_CANONICAL_BYTES,
  MAX_REFRESH_KEY_EXAMINATIONS,
  MAX_RETAINED_QUERY_IDENTITY_BYTES,
  makeQueryPublicationIdentity,
  QuerySyncStateLimitError,
  QuerySyncWorkLimitError,
  unchangedPublicationDisposition,
} from "@flarex/query-sync/internal/kernel";
import type {
  ActiveQueryState,
  AdmittedInvalidationBatch,
  QueryCompletionFingerprint,
  QueryEvaluationAttempt,
  QueryEvaluationEvidence,
  QuerySyncKernelError,
  QueryState,
} from "@flarex/query-sync/internal/kernel";
import {
  createReferenceModel,
  deriveGenerationRefreshEvidence,
  reduceReferenceModel,
} from "@flarex/query-sync/testing/reference-model";
import type {
  QuerySyncReferenceModel,
  ReferenceModelDecision,
} from "@flarex/query-sync/testing/reference-model";

import {
  batch,
  buildTestReferenceModel,
  buildTestQuerySyncState,
  canonicalBytes,
  canonicalKey,
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

function proveWorkLimitDimensionsAreOperationIndexed(): void {
  void new QuerySyncWorkLimitError<"applyAdmittedInvalidations">({
    operation: "applyAdmittedInvalidations",
    // @ts-expect-error Refresh dimensions do not belong to invalidation.
    dimension: "refreshBatches",
    maximum: 1,
    observed: 2,
  });
  void new QuerySyncWorkLimitError<"deriveGenerationRefreshEvidence">({
    operation: "deriveGenerationRefreshEvidence",
    // @ts-expect-error Invalidation dimensions do not belong to refresh.
    dimension: "affectedQueries",
    maximum: 1,
    observed: 2,
  });
}

void proveWorkLimitDimensionsAreOperationIndexed;

function proveKernelWorkLimitNarrowing(error: QuerySyncKernelError): void {
  if (
    error._tag === "QuerySyncWorkLimitError"
    && error.operation === "applyAdmittedInvalidations"
  ) {
    const dimension: "dependencyLookups" | "affectedQueries" =
      error.dimension;
    void dimension;
  }
}

void proveKernelWorkLimitNarrowing;

function provisionalQuery(index: number, identity = ""): QueryState {
  return queryWithProvisional(descriptor({ keySeed: index, identity }));
}

function queryWithProvisional(
  queryDescriptor: QueryState["descriptor"],
): QueryState {
  return {
    descriptor: queryDescriptor,
    active: null,
    provisional: {
      generation: getSuccess(captureQueryGeneration(1n)),
      expectedActiveGeneration: null,
      registrationCursor: cursor(),
      requestedDirtyThroughSequence: null,
      evaluationDisposition: { _tag: "ready" },
    },
    currentCompletion: null,
    precedingCompletionIdentity: null,
  };
}

function activeFromDependencies(
  dependencies: readonly string[],
): ActiveQueryState {
  const captured = evaluation({
    generation: 1n,
    snapshot: 0n,
    dependencies,
  });
  return {
    generation: captured.generation,
    evaluationSnapshotSequence: captured.snapshotSequence,
    freshThroughSequence: cursor().appliedThroughSequence,
    dirtyThroughSequence: null,
    resultDigest: captured.resultDigest,
    authorityWitness: captured.authorityWitness,
    dependencyKeys: captured.dependencyKeys,
  };
}

function queryWithActive(
  index: number,
  active: ActiveQueryState,
): QueryState {
  const queryDescriptor = descriptor({ keySeed: index, identity: "" });
  const registrationCursor = cursor();
  const currentCompletion: QueryCompletionFingerprint = {
    identity: makeQueryPublicationIdentity({
      namespaceId: registrationCursor.namespaceId,
      syncModelId: registrationCursor.syncModelId,
      sourceEpoch: registrationCursor.sourceEpoch,
      queryKey: queryDescriptor.queryKey,
      generation: active.generation,
    }),
    queryIdentity: queryDescriptor.queryIdentity,
    expectedActiveGeneration: null,
    registrationCursor,
    requestedDirtyThroughSequence: null,
    evaluationSnapshotSequence: active.evaluationSnapshotSequence,
    evaluationDependencyKeys: active.dependencyKeys,
    evaluationAuthorityWitness: active.authorityWitness,
    refreshedThroughSequence: active.freshThroughSequence,
    relevantThroughSequence: null,
    refreshAuthorityWitness: active.authorityWitness,
    resultDigest: active.resultDigest,
    publicationDisposition: unchangedPublicationDisposition(),
  };
  return {
    descriptor: queryDescriptor,
    active,
    provisional: null,
    currentCompletion,
    precedingCompletionIdentity: null,
  };
}

function expectStateLimit(
  result: ReturnType<typeof buildTestQuerySyncState>,
  dimension: QuerySyncStateLimitError["dimension"],
): void {
  expect(Result.isFailure(result)).toBe(true);
  if (Result.isFailure(result)) {
    expect(result.failure).toBeInstanceOf(QuerySyncStateLimitError);
    expect(result.failure).toMatchObject({ dimension });
  }
}

function expectReferenceInvariants(model: QuerySyncReferenceModel): void {
  const { state } = model;
  expect(state.metrics.queryCount).toBe(state.queries.length);
  expect(state.metrics.pendingPublicationCount).toBe(
    state.publicationWork.pending.length,
  );
  expect(state.metrics.retainedPublicationContentBytes).toBe(
    state.publicationWork.pending.reduce(
      (total, publication) => total
        + canonicalPublicationContentDecodedLength(publication.content),
      0,
    ),
  );
  const orderedKeys = state.queries.map((query) => query.descriptor.queryKey);
  const independentlySortedKeys = [...orderedKeys];
  independentlySortedKeys.sort();
  expect(orderedKeys).toEqual(independentlySortedKeys);
  expect(new Set(orderedKeys).size).toBe(orderedKeys.length);

  const expectedDirectory = new Map<string, string[]>();
  let memberships = 0;
  for (const query of state.queries) {
    expect(query.active !== null || query.provisional !== null).toBe(true);
    if (query.provisional !== null) {
      expect(query.provisional.registrationCursor.namespaceId).toBe(
        state.cursor.namespaceId,
      );
      expect(
        query.provisional.registrationCursor.appliedThroughSequence,
      ).toBeLessThanOrEqual(state.cursor.appliedThroughSequence);
      if (query.active !== null) {
        expect(query.provisional.generation).toBeGreaterThan(
          query.active.generation,
        );
      }
    }
    if (query.active === null) {
      expect(query.currentCompletion).toBeNull();
      continue;
    }
    expect(query.currentCompletion).toMatchObject({
      identity: {
        queryKey: query.descriptor.queryKey,
        generation: query.active.generation,
      },
      queryIdentity: query.descriptor.queryIdentity,
      resultDigest: query.active.resultDigest,
    });
    expect(query.active.freshThroughSequence).toBeLessThanOrEqual(
      state.cursor.appliedThroughSequence,
    );
    if (query.active.dirtyThroughSequence !== null) {
      expect(query.active.dirtyThroughSequence).toBeGreaterThan(
        query.active.freshThroughSequence,
      );
    }
    const sortedDependencies = [...query.active.dependencyKeys];
    sortedDependencies.sort();
    expect(query.active.dependencyKeys).toEqual(sortedDependencies);
    expect(new Set(query.active.dependencyKeys).size).toBe(
      query.active.dependencyKeys.length,
    );
    for (const dependencyKey of query.active.dependencyKeys) {
      memberships += 1;
      const queryKeys = expectedDirectory.get(dependencyKey) ?? [];
      queryKeys.push(query.descriptor.queryKey);
      expectedDirectory.set(dependencyKey, queryKeys);
    }
  }
  expect(state.metrics.dependencyMemberships).toBe(memberships);
  const orderedExpectedDirectory = [...expectedDirectory.entries()];
  orderedExpectedDirectory.sort(([left], [right]) => (
    left < right ? -1 : left > right ? 1 : 0
  ));
  expect(state.dependencyDirectory).toEqual(
    orderedExpectedDirectory.map(([dependencyKey, queryKeys]) => ({
      dependencyKey,
      queryKeys,
    })),
  );
  const pendingQueryKeys = state.publicationWork.pending.map(
    (publication) => publication.identity.queryKey,
  );
  const sortedPendingQueryKeys = [...pendingQueryKeys].sort();
  expect(pendingQueryKeys).toEqual(sortedPendingQueryKeys);
  expect(new Set(pendingQueryKeys).size).toBe(pendingQueryKeys.length);
}

function installReferenceActive(
  model: QuerySyncReferenceModel,
  dependency: string,
): QuerySyncReferenceModel {
  const authority = model.state.cursor;
  const begun = getSuccess(reduceReferenceModel(model, {
    _tag: "beginQueryEvaluation",
    request: firstEvaluationRequest(target({
      namespaceId: authority.namespaceId,
      syncModelId: authority.syncModelId,
      sourceEpoch: authority.sourceEpoch,
    })),
  }));
  if (begun.decision._tag !== "created") {
    throw new Error("Expected a new reference query generation");
  }
  const capturedEvaluation = evaluation({
    namespaceId: authority.namespaceId,
    syncModelId: authority.syncModelId,
    sourceEpoch: authority.sourceEpoch,
    descriptor: begun.decision.attempt.descriptor,
    generation: begun.decision.attempt.generation,
    snapshot: authority.appliedThroughSequence,
    dependencies: [dependency],
  });
  const refresh = getSuccess(deriveGenerationRefreshEvidence(
    capturedEvaluation,
    begun.model.state.cursor,
    [],
    capturedEvaluation.authorityWitness,
  ));
  const completed = getSuccess(reduceReferenceModel(begun.model, {
    _tag: "completeQueryEvaluation",
    attempt: begun.decision.attempt,
    evaluation: capturedEvaluation,
    refresh,
    publication: publicationArtifact("initial-active"),
  }));
  if (completed.decision._tag !== "completed") {
    throw new Error("Expected a clean reference query installation");
  }
  return completed.model;
}

describe("isolation, limits, and determinism", () => {
  it("keeps identical query and dependency values isolated by namespace", () => {
    const dependency = canonicalText("shared");
    const tenantA = installReferenceActive(getSuccess(createReferenceModel(cursor({
      namespaceId: "tenant-a",
    }))), dependency);
    const tenantB = installReferenceActive(getSuccess(createReferenceModel(cursor({
      namespaceId: "tenant-b",
    }))), dependency);

    const changedA = getSuccess(reduceReferenceModel(tenantA, {
      _tag: "applyAdmittedInvalidations",
      batch: batch({
        namespaceId: "tenant-a",
        sequence: 1n,
        dependencies: [dependency],
      }),
    }));

    expect(changedA.model.state.cursor.appliedThroughSequence).toBe(1n);
    expect(changedA.decision).toMatchObject({
      _tag: "applied",
      affectedQueryKeys: [tenantA.state.queries[0]?.descriptor.queryKey],
    });
    expect(changedA.model.state.queries[0]?.active).toMatchObject({
      dependencyKeys: [dependency],
      dirtyThroughSequence: 1n,
    });
    expect(tenantB.state.cursor.appliedThroughSequence).toBe(0n);
    expect(tenantB.state.queries[0]?.descriptor).toEqual(
      tenantA.state.queries[0]?.descriptor,
    );
    expect(tenantB.state.queries[0]?.active).toMatchObject({
      dependencyKeys: [dependency],
      dirtyThroughSequence: null,
    });
  });

  it("refuses equal fragments routed to a different model", () => {
    const model = getSuccess(createReferenceModel(cursor({
      syncModelId: "key-value",
    })));
    const result = reduceReferenceModel(model, {
      _tag: "beginQueryEvaluation",
      request: firstEvaluationRequest(target({ syncModelId: "graph" })),
    });

    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure).toMatchObject({
        _tag: "QuerySyncModelMismatchError",
        expectedSyncModelId: "key-value",
        observedSyncModelId: "graph",
      });
    }
  });

  it("enforces the aggregate query-count boundary without partial output", () => {
    const atBoundary = Array.from(
      { length: MAX_REFERENCE_QUERIES },
      (_, index) => provisionalQuery(index),
    );
    const accepted = buildTestReferenceModel(cursor(), atBoundary);
    expect(accepted.state.queries).toHaveLength(MAX_REFERENCE_QUERIES);

    const refused = buildTestQuerySyncState(cursor(), [
      ...atBoundary,
      provisionalQuery(MAX_REFERENCE_QUERIES),
    ]);
    expectStateLimit(refused, "queryCount");
    expect(accepted.state.queries).toHaveLength(MAX_REFERENCE_QUERIES);
  }, 30_000);

  it("enforces retained canonical identity bytes at the exact boundary", () => {
    const identity = canonicalBytes(MAX_CANONICAL_QUERY_IDENTITY_BYTES, 7);
    const descriptorAt = (index: number) => getSuccess(captureQueryDescriptor({
      queryKey: canonicalKey(index),
      queryIdentity: identity,
    }));
    const queryCountAtBoundary = MAX_RETAINED_QUERY_IDENTITY_BYTES
      / MAX_CANONICAL_QUERY_IDENTITY_BYTES;
    const queries = Array.from(
      { length: queryCountAtBoundary },
      (_, index) => queryWithProvisional(descriptorAt(index)),
    );
    const accepted = buildTestReferenceModel(cursor(), queries);
    expect(accepted.state.metrics.retainedIdentityBytes).toBe(
      MAX_RETAINED_QUERY_IDENTITY_BYTES,
    );

    const refused = buildTestQuerySyncState(cursor(), [
      ...queries,
      queryWithProvisional(descriptorAt(queryCountAtBoundary)),
    ]);
    expectStateLimit(refused, "retainedIdentityBytes");
  }, 30_000);

  it("enforces dependency memberships at the exact aggregate boundary", () => {
    const dependencies = Array.from(
      { length: MAX_QUERY_DEPENDENCY_KEYS },
      (_, index) => canonicalText(`dependency:${index}`),
    );
    const active = activeFromDependencies(dependencies);
    const queryCountAtBoundary = MAX_AGGREGATE_DEPENDENCY_MEMBERSHIPS
      / MAX_QUERY_DEPENDENCY_KEYS;
    const queries = Array.from(
      { length: queryCountAtBoundary },
      (_, index) => queryWithActive(index, active),
    );
    const accepted = buildTestReferenceModel(cursor(), queries);
    expect(accepted.state.metrics.dependencyMemberships).toBe(
      MAX_AGGREGATE_DEPENDENCY_MEMBERSHIPS,
    );

    const refused = buildTestQuerySyncState(cursor(), [
      ...queries,
      queryWithActive(queryCountAtBoundary, active),
    ]);
    expectStateLimit(refused, "dependencyMemberships");
  }, 30_000);

  it("accounts the exact portable canonical-byte boundary", () => {
    const fullKeyCount = 127;
    const lowerFinalKeyBytes = 16_238;
    const sharedDependencies = [
      ...Array.from(
        { length: fullKeyCount },
        (_, index) => canonicalBytes(
          MAX_CANONICAL_DEPENDENCY_KEY_BYTES,
          index,
        ),
      ),
    ];
    const lowerActive = activeFromDependencies([
      ...sharedDependencies,
      canonicalBytes(lowerFinalKeyBytes, fullKeyCount),
    ]);
    const higherActive = activeFromDependencies([
      ...sharedDependencies,
      canonicalBytes(lowerFinalKeyBytes + 1, fullKeyCount),
    ]);
    const exactQueries = [
      ...Array.from(
        { length: 14 },
        (_, index) => queryWithActive(index, lowerActive),
      ),
      ...Array.from(
        { length: 2 },
        (_, offset) => queryWithActive(offset + 14, higherActive),
      ),
    ];
    const accepted = buildTestReferenceModel(cursor(), exactQueries);
    expect(accepted.state.metrics.countedCanonicalBytes).toBe(
      MAX_COUNTED_CANONICAL_BYTES,
    );

    const refused = buildTestQuerySyncState(cursor(), [
      queryWithActive(0, higherActive),
      ...exactQueries.slice(1),
    ]);
    expectStateLimit(refused, "countedCanonicalBytes");
  }, 60_000);

  it("permits the exact affected-query work ceiling deterministically", () => {
    const dependency = canonicalText("shared");
    const active = activeFromDependencies([dependency]);
    const queries = Array.from(
      { length: MAX_REFERENCE_QUERIES },
      (_, index) => queryWithActive(index, active),
    );
    const model = buildTestReferenceModel(cursor(), queries);
    const applied = getSuccess(applyAdmittedInvalidations(
      model.state,
      batch({ sequence: 1n, dependencies: [dependency] }),
    ));

    expect(applied._tag).toBe("applied");
    if (applied._tag === "applied") {
      expect(applied.affectedQueryKeys).toHaveLength(MAX_REFERENCE_QUERIES);
      const sortedAffectedQueryKeys = [...applied.affectedQueryKeys];
      sortedAffectedQueryKeys.sort();
      expect(applied.affectedQueryKeys).toEqual(
        sortedAffectedQueryKeys,
      );
    }
    expect(model.state.cursor.appliedThroughSequence).toBe(0n);
  }, 30_000);

  it("produces identical states and receipts for seeded mixed schedules", () => {
    function runSchedule(): {
      readonly model: QuerySyncReferenceModel;
      readonly decisions: readonly ReferenceModelDecision[];
      readonly crossedInvalidationCount: number;
    } {
      let model = getSuccess(createReferenceModel(cursor()));
      const decisions: ReferenceModelDecision[] = [];
      const admittedBatches: AdmittedInvalidationBatch[] = [];
      let pendingAttempt: QueryEvaluationAttempt | null = null;
      let pendingEvaluation: QueryEvaluationEvidence | null = null;
      let crossedInvalidationCount = 0;
      let seed = 0x5f37_59df;
      const dependency = canonicalText("scheduled");
      expectReferenceInvariants(model);

      for (let step = 0; step < 120; step += 1) {
        seed = ((seed * 1_664_525) + 1_013_904_223) >>> 0;
        const choice = seed % 5;
        const provisional = model.state.queries[0]?.provisional ?? null;

        if (choice === 0 || model.state.queries.length === 0) {
          const query = model.state.queries[0];
          const queryTarget = query === undefined
            ? target()
            : target({ descriptor: query.descriptor });
          const request = query === undefined || query.active === null
            ? firstEvaluationRequest(queryTarget)
            : provisional !== null
              ? Object.freeze({
                target: queryTarget,
                expectedActiveGeneration:
                  provisional.expectedActiveGeneration,
                requestedDirtyThroughSequence:
                  provisional.requestedDirtyThroughSequence,
              })
              : rerunEvaluationRequest({
                target: queryTarget,
                activeGeneration: query.active.generation,
                dirtyThroughSequence:
                  query.active.dirtyThroughSequence
                    ?? query.active.freshThroughSequence,
              });
          const transition = getSuccess(reduceReferenceModel(model, {
            _tag: "beginQueryEvaluation",
            request,
          }));
          model = transition.model;
          decisions.push(transition.decision);
          const beginDecision = transition.decision;
          if (
            (
              beginDecision._tag === "created"
              || beginDecision._tag === "replayed"
            )
            && "attempt" in beginDecision
            && "descriptor" in beginDecision.attempt
          ) {
            pendingAttempt = beginDecision.attempt;
            pendingEvaluation = null;
          }
          expectReferenceInvariants(model);
          continue;
        }
        if (choice === 1 && provisional !== null) {
          if (pendingEvaluation === null) {
            const query = model.state.queries[0];
            if (query === undefined) {
              throw new Error("Expected the provisional query to exist");
            }
            if (pendingAttempt === null) {
              throw new Error("Expected state-issued evaluation attempt");
            }
            pendingEvaluation = evaluation({
              descriptor: query.descriptor,
              generation: pendingAttempt.generation,
              snapshot: model.state.cursor.appliedThroughSequence,
              dependencies: [dependency],
            });
            expectReferenceInvariants(model);
            continue;
          }
          const evidence = pendingEvaluation;
          const interval = admittedBatches.filter((admitted) => (
            admitted.sourceSequence > evidence.snapshotSequence
            && admitted.sourceSequence
              <= model.state.cursor.appliedThroughSequence
          ));
          const refresh = getSuccess(deriveGenerationRefreshEvidence(
            evidence,
            model.state.cursor,
            interval,
            evidence.authorityWitness,
          ));
          if (pendingAttempt === null) {
            throw new Error("Expected state-issued evaluation attempt");
          }
          const transition = getSuccess(reduceReferenceModel(model, {
            _tag: "completeQueryEvaluation",
            attempt: pendingAttempt,
            evaluation: evidence,
            refresh,
            publication: publicationArtifact("scheduled"),
          }));
          model = transition.model;
          decisions.push(transition.decision);
          if (
            refresh.refreshedThroughSequence > evidence.snapshotSequence
          ) {
            crossedInvalidationCount += 1;
          }
          pendingAttempt = null;
          pendingEvaluation = null;
          expectReferenceInvariants(model);
          continue;
        }

        const current = model.state.cursor.appliedThroughSequence;
        const sequence = choice === 2
          ? current
          : choice === 3
            ? current + 2n
            : current + 1n;
        const scheduledBatch = batch({
          sequence,
          dependencies: seed % 2 === 0 ? [dependency] : [],
        });
        const transition = getSuccess(reduceReferenceModel(model, {
          _tag: "applyAdmittedInvalidations",
          batch: scheduledBatch,
        }));
        model = transition.model;
        decisions.push(transition.decision);
        if (transition.decision._tag === "applied") {
          admittedBatches.push(scheduledBatch);
        }
        expectReferenceInvariants(model);
      }
      return Object.freeze({
        model,
        decisions: Object.freeze(decisions),
        crossedInvalidationCount,
      });
    }

    const first = runSchedule();
    const second = runSchedule();
    expect(first).toEqual(second);
    expect(first.crossedInvalidationCount).toBeGreaterThan(0);
    expect(Object.isFrozen(first.model.state)).toBe(true);
    expect(Object.isFrozen(first.decisions)).toBe(true);
  });

  it("refuses refresh work above the batch ceiling before traversal", () => {
    const evidence = evaluation({ generation: 1n, snapshot: 0n });
    const admitted = batch({ sequence: 1n });
    const oversized = Array.from(
      { length: 65_537 },
      () => admitted,
    );
    const result = deriveGenerationRefreshEvidence(
      evidence,
      cursor({ sequence: 1n }),
      oversized,
      evidence.authorityWitness,
    );
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure).toMatchObject({
        _tag: "QuerySyncWorkLimitError",
        dimension: "refreshBatches",
        maximum: 65_536,
        observed: 65_537,
      });
    }
  });

  it("enforces invalidation and refresh key-examination work ceilings", () => {
    const dependencyKeys = Array.from(
      { length: MAX_INVALIDATION_KEYS },
      (_, index) => canonicalText(`work:${index}`),
    );
    const fullBatch = batch({
      sequence: 1n,
      dependencies: dependencyKeys,
    });
    const initial = getSuccess(createReferenceModel(cursor()));
    const applied = getSuccess(reduceReferenceModel(initial, {
      _tag: "applyAdmittedInvalidations",
      batch: fullBatch,
    }));
    expect(applied.decision).toMatchObject({
      _tag: "applied",
      affectedQueryKeys: [],
    });

    const evidence = evaluation({ generation: 1n, snapshot: 0n });
    const exactRefresh = getSuccess(deriveGenerationRefreshEvidence(
      evidence,
      cursor({ sequence: 1n }),
      [fullBatch],
      evidence.authorityWitness,
    ));
    expect(exactRefresh.refreshedThroughSequence).toBe(1n);

    const oneMoreBatch = batch({
      sequence: 2n,
      dependencies: [canonicalText("one-more")],
    });
    const refused = deriveGenerationRefreshEvidence(
      evidence,
      cursor({ sequence: 2n }),
      [fullBatch, oneMoreBatch],
      evidence.authorityWitness,
    );
    expect(Result.isFailure(refused)).toBe(true);
    if (Result.isFailure(refused)) {
      expect(refused.failure).toMatchObject({
        _tag: "QuerySyncWorkLimitError",
        dimension: "refreshKeyExaminations",
        maximum: MAX_REFRESH_KEY_EXAMINATIONS,
        observed: MAX_REFRESH_KEY_EXAMINATIONS + 1,
      });
    }
  }, 60_000);

  it("enforces the refresh canonical-byte work ceiling", () => {
    const dependencyKeys = Array.from(
      {
        length: MAX_INVALIDATION_BATCH_BYTES
          / MAX_CANONICAL_DEPENDENCY_KEY_BYTES,
      },
      (_, index) => canonicalBytes(
        MAX_CANONICAL_DEPENDENCY_KEY_BYTES,
        index,
      ),
    );
    const fullBatch = batch({ sequence: 1n, dependencies: dependencyKeys });
    const evidence = evaluation({ generation: 1n, snapshot: 0n });
    expect(getSuccess(deriveGenerationRefreshEvidence(
      evidence,
      cursor({ sequence: 1n }),
      [fullBatch],
      evidence.authorityWitness,
    )).refreshedThroughSequence).toBe(1n);

    const oneMoreBatch = batch({
      sequence: 2n,
      dependencies: [canonicalBytes(1, 100_000)],
    });
    const refused = deriveGenerationRefreshEvidence(
      evidence,
      cursor({ sequence: 2n }),
      [fullBatch, oneMoreBatch],
      evidence.authorityWitness,
    );
    expect(Result.isFailure(refused)).toBe(true);
    if (Result.isFailure(refused)) {
      expect(refused.failure).toMatchObject({
        _tag: "QuerySyncWorkLimitError",
        dimension: "refreshCanonicalBytes",
        maximum: MAX_REFRESH_CANONICAL_BYTES,
        observed: MAX_REFRESH_CANONICAL_BYTES + 1,
      });
    }
  }, 60_000);
});
