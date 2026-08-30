import { Result } from "effect";
import { describe, expect, it } from "vitest";

import {
  applyAdmittedInvalidations,
  beginQueryEvaluation,
  completeQueryEvaluation,
  createEmptyQuerySyncState,
} from "@flarex/query-sync/internal/kernel";
import type {
  AdmittedInvalidationBatch,
  NamespaceCursor,
  QueryDescriptor,
  QuerySyncState,
} from "@flarex/query-sync/internal/kernel";
import {
  makeEmptyQuerySyncScopeFacts,
  planInitializeOrInspectNamespace,
} from "@flarex/query-sync/internal/transition-plan";
import {
  projectApplyReceipt,
  projectBeginReceipt,
} from "../src/state/Receipts.js";
import {
  applyAdmittedInvalidationsTransition,
  applyBeginQueryEvaluationTransition,
} from "../src/kernel/TransitionPlanAggregate.js";
import {
  planBeginQueryEvaluation,
} from "../src/transition-plan/BeginQueryEvaluation.js";
import {
  resumeApplyAdmittedBatchActiveFacts,
  resumeApplyAdmittedBatchAffectedTargets,
  startApplyAdmittedBatchAndAdvance,
} from "../src/transition-plan/ApplyAdmittedBatch.js";
import type {
  AffectedActiveQueryFacts,
} from "../src/transition-plan/Facts.js";
import {
  QuerySyncTransitionFactError,
  QuerySyncTransitionResumeDefect,
} from "../src/transition-plan/Errors.js";
import {
  MAX_INVALIDATION_AFFECTED_QUERY_SENTINEL,
  MAX_INVALIDATION_DEPENDENCY_LOOKUPS,
} from "../src/transition-plan/Limits.js";
import {
  executeNormalizedApplyAdmittedBatch,
  executeNormalizedBeginQueryEvaluation,
  normalizeQuerySyncState,
} from "../src/testing/conformance/NormalizedTransitionPlan.js";
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
  getEvaluationAttempt,
  getSuccess,
  publicationArtifact,
  rerunEvaluationRequest,
  target,
} from "./fixtures.js";

function installActiveQuery(
  state: QuerySyncState,
  queryDescriptor: QueryDescriptor,
  dependencies: readonly string[],
): QuerySyncState {
  const begun = getSuccess(beginQueryEvaluation(
    state,
    firstEvaluationRequest(target({ descriptor: queryDescriptor })),
  ));
  const attempt = getEvaluationAttempt(begun);
  const evidence = evaluation({
    descriptor: queryDescriptor,
    generation: attempt.generation,
    snapshot: state.cursor.appliedThroughSequence,
    dependencies,
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
    publicationArtifact("d1-active"),
  ));
  if (completed._tag !== "completed") {
    throw new Error("Expected an active-query fixture.");
  }
  return completed.state;
}

describe("QSYNC01-D1 transition plans", () => {
  it("constructs exact owned empty scope facts reused by initialization", () => {
    const mutableCursor = {
      ...cursor({
        namespaceId: "empty-scope-owner",
        syncModelId: "empty-scope-model",
        sourceEpoch: "empty-scope-epoch",
        sequence: 17n,
      }),
    } satisfies NamespaceCursor;
    const facts = makeEmptyQuerySyncScopeFacts(mutableCursor);
    const secondFacts = makeEmptyQuerySyncScopeFacts(mutableCursor);
    const reference = getSuccess(createEmptyQuerySyncState(mutableCursor));

    expect(facts).toEqual({
      cursor: reference.cursor,
      evaluationWork: reference.evaluationWork,
      metrics: reference.metrics,
    });
    expect(secondFacts).toEqual(facts);
    expect(secondFacts).not.toBe(facts);
    expect(secondFacts.cursor).not.toBe(facts.cursor);
    expect(secondFacts.evaluationWork).not.toBe(facts.evaluationWork);
    expect(secondFacts.metrics).not.toBe(facts.metrics);
    expect(facts.cursor).not.toBe(mutableCursor);
    expect(Object.isFrozen(facts)).toBe(true);
    expect(Object.isFrozen(facts.cursor)).toBe(true);
    expect(Object.isFrozen(facts.evaluationWork)).toBe(true);
    expect(Object.isFrozen(facts.metrics)).toBe(true);

    const replacementCursor = cursor({ sequence: 18n });
    mutableCursor.appliedThroughSequence =
      replacementCursor.appliedThroughSequence;
    expect(facts.cursor.appliedThroughSequence).toBe(17n);

    const binding = Object.freeze({
      namespaceId: facts.cursor.namespaceId,
      syncModelId: facts.cursor.syncModelId,
      sourceEpoch: facts.cursor.sourceEpoch,
    });
    const initialized = getSuccess(planInitializeOrInspectNamespace({
      binding,
      bootstrapCursor: facts.cursor,
      presence: Object.freeze({ _tag: "authorizedFreshAbsence" }),
    }));
    if (initialized._tag !== "write") {
      throw new Error("Expected fresh initialization facts.");
    }
    expect(initialized.nextScope).toEqual(facts);
  });

  it("plans initialization from explicit presence without minting authority", () => {
    const bootstrapCursor = cursor();
    const binding = Object.freeze({
      namespaceId: bootstrapCursor.namespaceId,
      syncModelId: bootstrapCursor.syncModelId,
      sourceEpoch: bootstrapCursor.sourceEpoch,
    });
    const initialized = getSuccess(planInitializeOrInspectNamespace({
      binding,
      bootstrapCursor,
      presence: Object.freeze({ _tag: "authorizedFreshAbsence" }),
    }));
    expect(initialized).toMatchObject({
      _tag: "write",
      receipt: {
        _tag: "initialized",
        cursor: bootstrapCursor,
        metrics: {
          queryCount: 0,
          dependencyMemberships: 0,
          pendingPublicationCount: 0,
        },
      },
      change: {
        _tag: "initializeNamespace",
        durableInitializedHistory: true,
      },
    });
    expect(Object.isFrozen(initialized)).toBe(true);
    expect(Object.isFrozen(initialized.receipt)).toBe(true);

    const missing = planInitializeOrInspectNamespace({
      binding,
      bootstrapCursor,
      presence: Object.freeze({ _tag: "previouslyInitializedAbsence" }),
    });
    expect(Result.isFailure(missing)).toBe(true);
    if (Result.isFailure(missing)) {
      expect(missing.failure).toMatchObject({
        _tag: "QuerySyncInitializationPolicyError",
        reason: "aggregateMissing",
      });
    }
  });

  it("matches the aggregate begin wrapper through an independent normalized interpreter", () => {
    const initial = getSuccess(createEmptyQuerySyncState(cursor()));
    const request = firstEvaluationRequest();
    const normalized = getSuccess(executeNormalizedBeginQueryEvaluation(
      normalizeQuerySyncState(initial),
      request,
    ));
    const aggregate = getSuccess(beginQueryEvaluation(initial, request));

    expect(normalized.disposition).toBe("write");
    expect(normalized.receipt).toEqual(projectBeginReceipt(aggregate));
    expect(normalized.state).toEqual(aggregate.state);
    expect(normalized.plan).toMatchObject({
      _tag: "write",
      expected: {
        query: {
          _tag: "absent",
          queryKey: request.target.descriptor.queryKey,
        },
      },
      change: { _tag: "replaceBeginQueryEvaluation" },
    });
    if (normalized.plan._tag !== "write") {
      throw new Error("Expected a write-bearing begin plan.");
    }
    expect(Object.isFrozen(normalized.plan.expected.query)).toBe(true);

    const normalizedReplay = getSuccess(
      executeNormalizedBeginQueryEvaluation(
        normalizeQuerySyncState(aggregate.state),
        request,
      ),
    );
    const aggregateReplay = getSuccess(beginQueryEvaluation(
      aggregate.state,
      request,
    ));
    expect(normalizedReplay.disposition).toBe("noWrite");
    expect(normalizedReplay.receipt).toEqual(
      projectBeginReceipt(aggregateReplay),
    );
    expect(normalizedReplay.state).toEqual(aggregateReplay.state);
  });

  it("rejects same-identity facts for a different key and names keyed absence", () => {
    const existingDescriptor = descriptor({
      keySeed: 51,
      identity: "d1-key-bound-identity",
    });
    const state = installActiveQuery(
      getSuccess(createEmptyQuerySyncState(cursor())),
      existingDescriptor,
      [],
    );
    const normalized = normalizeQuerySyncState(state);
    const existing = normalized.queries[0];
    if (existing === undefined) throw new Error("Expected query facts.");
    const request = firstEvaluationRequest(target({
      descriptor: descriptor({
        keySeed: 52,
        identity: "d1-key-bound-identity",
      }),
    }));

    const result = planBeginQueryEvaluation({
      scope: normalized.scope,
      query: {
        descriptor: existing.descriptor,
        active: existing.active,
        provisional: existing.provisional,
      },
      request,
    });

    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure).toBeInstanceOf(QuerySyncTransitionFactError);
      expect(result.failure).toMatchObject({
        operation: "beginQueryEvaluation",
        reason: "queryFactsInvalid",
      });
    }
  });

  it("stops terminal batches before reads and owns staged read values", () => {
    const initial = getSuccess(createEmptyQuerySyncState(cursor({
      sequence: 3n,
    })));
    const scope = normalizeQuerySyncState(initial).scope;
    const dependency = batch({
      sequence: 3n,
      dependencies: [canonicalText("oversized-duplicate")],
    }).dependencyKeys[0];
    if (dependency === undefined) throw new Error("Expected dependency.");
    const oversizedDuplicate: AdmittedInvalidationBatch = Object.freeze({
      namespaceId: scope.cursor.namespaceId,
      syncModelId: scope.cursor.syncModelId,
      sourceEpoch: scope.cursor.sourceEpoch,
      sourceSequence: scope.cursor.appliedThroughSequence,
      dependencyKeys: Object.freeze(Array.from(
        { length: MAX_INVALIDATION_DEPENDENCY_LOOKUPS + 1 },
        () => dependency,
      )),
    });
    const terminal = getSuccess(startApplyAdmittedBatchAndAdvance({
      scope,
      batch: oversizedDuplicate,
    }));
    expect(terminal).toMatchObject({
      _tag: "planned",
      plan: { _tag: "noWrite", receipt: { _tag: "duplicate" } },
    });

    const exact = batch({
      sequence: 4n,
      dependencies: [canonicalText("read-owned")],
    });
    const staged = getSuccess(startApplyAdmittedBatchAndAdvance({
      scope,
      batch: exact,
    }));
    expect(staged._tag).toBe("read");
    if (staged._tag !== "read") throw new Error("Expected staged read.");
    expect(staged.intent).toMatchObject({
      _tag: "readAffectedActiveTargets",
      maximumDistinctTargets: MAX_INVALIDATION_AFFECTED_QUERY_SENTINEL,
    });
    expect(staged.intent.dependencyKeys).toEqual(exact.dependencyKeys);
    expect(staged.intent.dependencyKeys).not.toBe(exact.dependencyKeys);
    expect(Object.isFrozen(staged.intent.dependencyKeys)).toBe(true);

    const cursorOnly = getSuccess(
      resumeApplyAdmittedBatchAffectedTargets(
        staged.resume,
        Object.freeze({
          _tag: "complete",
          targets: Object.freeze([]),
        }),
      ),
    );
    expect(cursorOnly).toMatchObject({
      _tag: "planned",
      plan: {
        _tag: "write",
        receipt: { _tag: "applied", affectedQueryKeys: [] },
      },
    });
    expect(() => Reflect.apply(
      resumeApplyAdmittedBatchAffectedTargets,
      undefined,
      [Object.freeze({}), Object.freeze({
        _tag: "complete",
        targets: Object.freeze([]),
      })],
    )).toThrowError(QuerySyncTransitionResumeDefect);
    expect(() => Reflect.apply(
      resumeApplyAdmittedBatchActiveFacts,
      undefined,
      [staged.resume, Object.freeze([])],
    )).toThrowError(QuerySyncTransitionResumeDefect);
  });

  it("rejects active-fact cardinality before traversing undeclared rows", () => {
    const dependency = canonicalText("d1:active-fact-cardinality");
    const state = installActiveQuery(
      getSuccess(createEmptyQuerySyncState(cursor())),
      descriptor(),
      [dependency],
    );
    const query = state.queries[0];
    if (query?.active === null || query?.active === undefined) {
      throw new Error("Expected an active query.");
    }
    const started = getSuccess(startApplyAdmittedBatchAndAdvance({
      scope: normalizeQuerySyncState(state).scope,
      batch: batch({ sequence: 1n, dependencies: [dependency] }),
    }));
    if (started._tag !== "read") throw new Error("Expected target read.");
    const activeRead = getSuccess(resumeApplyAdmittedBatchAffectedTargets(
      started.resume,
      Object.freeze({
        _tag: "complete",
        targets: Object.freeze([Object.freeze({
          queryKey: query.descriptor.queryKey,
          activeGeneration: query.active.generation,
        })]),
      }),
    ));
    if (activeRead._tag !== "read") {
      throw new Error("Expected active-fact read.");
    }
    let undeclaredReads = 0;
    const poison: AffectedActiveQueryFacts = Object.defineProperty({
      queryKey: query.descriptor.queryKey,
      generation: query.active.generation,
      evaluationSnapshotSequence: query.active.evaluationSnapshotSequence,
      freshThroughSequence: query.active.freshThroughSequence,
      dirtyThroughSequence: query.active.dirtyThroughSequence,
      resultDigest: query.active.resultDigest,
      authorityWitness: query.active.authorityWitness,
    }, "queryKey", {
      enumerable: true,
      get: () => {
        undeclaredReads += 1;
        throw new Error("Undeclared active facts were traversed.");
      },
    });

    const result = resumeApplyAdmittedBatchActiveFacts(
      activeRead.resume,
      Object.freeze([poison, poison]),
    );
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure).toMatchObject({
        _tag: "QuerySyncTransitionFactError",
        reason: "affectedActiveFactsInvalid",
      });
    }
    expect(undeclaredReads).toBe(0);
  });

  it("matches staged apply independently and accounts only a newly dirty frontier", () => {
    const dependency = canonicalText("d1:shared");
    const initial = getSuccess(createEmptyQuerySyncState(cursor()));
    const active = installActiveQuery(
      initial,
      descriptor(),
      [dependency],
    );
    const admitted = batch({ sequence: 1n, dependencies: [dependency] });
    const normalized = getSuccess(executeNormalizedApplyAdmittedBatch(
      normalizeQuerySyncState(active),
      admitted,
    ));
    const aggregate = getSuccess(applyAdmittedInvalidations(
      active,
      admitted,
    ));

    expect(normalized.disposition).toBe("write");
    expect(normalized.receipt).toEqual(projectApplyReceipt(aggregate));
    expect(normalized.state).toEqual(aggregate.state);
    expect(normalized.plan).toMatchObject({
      _tag: "write",
      change: {
        _tag: "applyAdmittedBatchAndAdvance",
        active: [{
          expected: { dirtyThroughSequence: null },
          next: { dirtyThroughSequence: 1n },
        }],
      },
    });
    expect(
      normalized.state.metrics.countedCanonicalBytes
      - active.metrics.countedCanonicalBytes,
    ).toBe(8);

    const secondBatch = batch({
      sequence: 2n,
      dependencies: [dependency],
    });
    const second = getSuccess(executeNormalizedApplyAdmittedBatch(
      normalizeQuerySyncState(normalized.state),
      secondBatch,
    ));
    expect(
      second.state.metrics.countedCanonicalBytes
      - normalized.state.metrics.countedCanonicalBytes,
    ).toBe(0);
  });

  it("keeps begin and apply plans independent of equal-cost unrelated rows", () => {
    const affectedDependency = canonicalText("d1:noninterference:target");
    const targetDescriptor = descriptor({
      keySeed: 61,
      identity: "d1-noninterference-target",
    });
    const buildState = (
      unrelatedKeySeed: number,
      unrelatedIdentity: string,
      unrelatedDependency: string,
    ): QuerySyncState => {
      let state = getSuccess(createEmptyQuerySyncState(cursor()));
      state = installActiveQuery(
        state,
        targetDescriptor,
        [affectedDependency],
      );
      return installActiveQuery(
        state,
        descriptor({
          keySeed: unrelatedKeySeed,
          identity: unrelatedIdentity,
        }),
        [canonicalText(unrelatedDependency)],
      );
    };
    const left = buildState(
      62,
      "d1-unrelated-leftx",
      "d1:unrelated:leftx",
    );
    const right = buildState(
      63,
      "d1-unrelated-right",
      "d1:unrelated:right",
    );
    expect(left.metrics).toEqual(right.metrics);

    const admitted = batch({
      sequence: 1n,
      dependencies: [affectedDependency],
    });
    const leftApply = getSuccess(applyAdmittedInvalidationsTransition(
      left,
      admitted,
    ));
    const rightApply = getSuccess(applyAdmittedInvalidationsTransition(
      right,
      admitted,
    ));
    expect(leftApply.plan).toEqual(rightApply.plan);

    const leftTarget = leftApply.decision.state.queries.find(
      (query) => query.descriptor.queryKey === targetDescriptor.queryKey,
    );
    if (
      leftTarget?.active === null
      || leftTarget?.active === undefined
      || leftTarget.active.dirtyThroughSequence === null
    ) {
      throw new Error("Expected the affected active query.");
    }
    const rerun = rerunEvaluationRequest({
      target: target({ descriptor: targetDescriptor }),
      activeGeneration: leftTarget.active.generation,
      dirtyThroughSequence: leftTarget.active.dirtyThroughSequence,
    });
    const leftBegin = getSuccess(applyBeginQueryEvaluationTransition(
      leftApply.decision.state,
      rerun,
    ));
    const rightBegin = getSuccess(applyBeginQueryEvaluationTransition(
      rightApply.decision.state,
      rerun,
    ));
    expect(leftBegin.plan).toEqual(rightBegin.plan);
    expect(leftBegin.plan).toMatchObject({
      _tag: "write",
      expected: {
        query: {
          _tag: "present",
          queryKey: targetDescriptor.queryKey,
        },
      },
    });
  });

  it("matches deterministic mixed begin/apply histories after every command", () => {
    const shared = canonicalText("d1:generated:shared");
    const onlyFirst = canonicalText("d1:generated:first");
    let state = getSuccess(createEmptyQuerySyncState(cursor()));
    state = installActiveQuery(
      state,
      descriptor({ keySeed: 31, identity: "generated-first" }),
      [shared, onlyFirst],
    );
    state = installActiveQuery(
      state,
      descriptor({ keySeed: 32, identity: "generated-second" }),
      [shared],
    );

    for (let index = 1; index <= 8; index += 1) {
      const sequence = BigInt(index);
      const dependencies = index % 3 === 0 ? [onlyFirst] : [shared];
      const admitted = batch({ sequence, dependencies });
      const normalizedApply = getSuccess(
        executeNormalizedApplyAdmittedBatch(
          normalizeQuerySyncState(state),
          admitted,
        ),
      );
      const aggregateApply = getSuccess(applyAdmittedInvalidations(
        state,
        admitted,
      ));
      expect(normalizedApply.receipt).toEqual(
        projectApplyReceipt(aggregateApply),
      );
      expect(normalizedApply.state).toEqual(aggregateApply.state);
      state = aggregateApply.state;

      const query = state.queries[0];
      const active = query?.active;
      if (
        query === undefined
        || active === null
        || active === undefined
        || active.dirtyThroughSequence === null
      ) {
        throw new Error("Expected generated dirty active query.");
      }
      const request = rerunEvaluationRequest({
        target: target({ descriptor: query.descriptor }),
        activeGeneration: active.generation,
        dirtyThroughSequence: active.dirtyThroughSequence,
      });
      const normalizedBegin = getSuccess(
        executeNormalizedBeginQueryEvaluation(
          normalizeQuerySyncState(state),
          request,
        ),
      );
      const aggregateBegin = getSuccess(beginQueryEvaluation(state, request));
      expect(normalizedBegin.receipt).toEqual(
        projectBeginReceipt(aggregateBegin),
      );
      expect(normalizedBegin.state).toEqual(aggregateBegin.state);
      state = aggregateBegin.state;
    }
  });
});
