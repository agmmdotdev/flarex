import { Result } from "effect";
import { describe, expect, it } from "vitest";

import {
  applyAdmittedInvalidations,
  beginQueryEvaluation,
  buildQuerySyncState,
  captureQueryGeneration,
  captureQuerySnapshot,
  captureQuerySyncWorkRevision,
  captureSyncSequence,
  claimEvaluationWork,
  completeQueryEvaluation,
  createEmptyQuerySyncState,
  InvalidEvaluationWorkContinuationError,
  InvalidEvaluationWorkScanRequestError,
  MAX_QUERY_GENERATION,
  MAX_QUERY_SYNC_WORK_REVISION,
  QueryGenerationExhaustedError,
  QuerySyncNamespaceMismatchError,
  QuerySyncWorkRevisionExhaustedError,
  recordEvaluationAttemptOutcome,
} from "@flarex/query-sync/internal/kernel";
import type {
  QueryDescriptor,
  QueryEvaluationAttempt,
  QueryState,
  QuerySyncState,
} from "@flarex/query-sync/internal/kernel";
import {
  deriveGenerationRefreshEvidence,
} from "@flarex/query-sync/testing/reference-model";

import {
  MAX_EVALUATION_WORK_QUERY_INSPECTIONS,
  MAX_EVALUATION_WORK_QUERY_SENTINEL,
  resumeClaimEvaluationWorkScan,
  resumeClaimEvaluationWorkSelectedQuery,
  startClaimEvaluationWork,
} from "../src/transition-plan/ClaimEvaluationWork.js";
import type {
  ClaimEvaluationWorkScanResume,
  ClaimEvaluationWorkSelectedQueryResume,
  EvaluationSelectedQueryFacts,
  EvaluationWorkScanFacts,
  EvaluationWorkScanFactsRead,
  ReadEvaluationWorkScanFactsIntent,
} from "../src/transition-plan/ClaimEvaluationWork.js";
import { QuerySyncTransitionResumeDefect } from
  "../src/transition-plan/Errors.js";
import { issueEvaluationWorkScanContinuation } from
  "../src/transition-plan/EvaluationWork.js";
import type { EvaluationWorkScanContinuation } from
  "../src/transition-plan/EvaluationWork.js";
import type { QuerySyncScopeFacts } from
  "../src/transition-plan/Model.js";

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
  target,
} from "./fixtures.js";

function getFailure<A, E>(result: Result.Result<A, E>): E {
  if (Result.isSuccess(result)) throw new Error("Expected a failed Result");
  return result.failure;
}

function emptyState(namespaceId = "tenant-a"): QuerySyncState {
  return getSuccess(createEmptyQuerySyncState(cursor({ namespaceId })));
}

function scopeFacts(state: QuerySyncState): QuerySyncScopeFacts {
  return {
    cursor: state.cursor,
    evaluationWork: state.evaluationWork,
    metrics: state.metrics,
  };
}

function selectedQueryFacts(query: QueryState): EvaluationSelectedQueryFacts {
  return {
    descriptor: query.descriptor,
    active: query.active === null
      ? null
      : {
        generation: query.active.generation,
        evaluationSnapshotSequence: query.active.evaluationSnapshotSequence,
        freshThroughSequence: query.active.freshThroughSequence,
        dirtyThroughSequence: query.active.dirtyThroughSequence,
        resultDigest: query.active.resultDigest,
        authorityWitness: query.active.authorityWitness,
      },
    provisional: query.provisional,
  };
}

function scanFacts(query: QueryState): EvaluationWorkScanFacts {
  return {
    queryKey: query.descriptor.queryKey,
    active: query.active === null
      ? null
      : {
        generation: query.active.generation,
        dirtyThroughSequence: query.active.dirtyThroughSequence,
      },
    provisional: query.provisional === null
      ? null
      : {
        generation: query.provisional.generation,
        evaluationDisposition: query.provisional.evaluationDisposition,
      },
  };
}

function cyclicQueries(
  state: QuerySyncState,
  anchor: QueryDescriptor["queryKey"] | null,
): readonly QueryState[] {
  if (anchor === null) return state.queries;
  const anchorIndex = state.queries.findIndex(
    (query) => query.descriptor.queryKey === anchor,
  );
  if (anchorIndex < 0) throw new Error("Expected a retained fairness anchor");
  return [
    ...state.queries.slice(anchorIndex + 1),
    ...state.queries.slice(0, anchorIndex + 1),
  ];
}

function scanRead(
  state: QuerySyncState,
  intent: ReadEvaluationWorkScanFactsIntent,
): EvaluationWorkScanFactsRead {
  const order = cyclicQueries(state, intent.scanStartFairnessAnchor);
  const lastIndex = intent.lastInspectedQueryKey === null
    ? -1
    : order.findIndex((query) => (
      query.descriptor.queryKey === intent.lastInspectedQueryKey
    ));
  if (intent.lastInspectedQueryKey !== null && lastIndex < 0) {
    throw new Error("Expected the prior scan prefix");
  }
  const nextIndex = lastIndex + 1;
  const stopIndex = Math.min(
    order.length,
    nextIndex + intent.maximumPageQueryInspections,
  );
  return Object.freeze({
    _tag: "complete",
    fairnessAnchorPresent: intent.scanStartFairnessAnchor !== null,
    revalidationPrefix: Object.freeze(
      order.slice(0, nextIndex).map(scanFacts),
    ),
    page: Object.freeze(order.slice(nextIndex, stopIndex).map(scanFacts)),
    hasMore: stopIndex < order.length,
  });
}

function beginFor(
  state: QuerySyncState,
  queryDescriptor: QueryDescriptor,
): Readonly<{
  readonly state: QuerySyncState;
  readonly attempt: QueryEvaluationAttempt;
}> {
  const decision = getSuccess(beginQueryEvaluation(
    state,
    firstEvaluationRequest(target({ descriptor: queryDescriptor })),
  ));
  return Object.freeze({
    state: decision.state,
    attempt: getEvaluationAttempt(decision),
  });
}

function completeAttempt(input: {
  readonly state: QuerySyncState;
  readonly attempt: QueryEvaluationAttempt;
  readonly dependencies?: readonly string[];
}): QuerySyncState {
  const evidence = evaluation({
    descriptor: input.attempt.descriptor,
    generation: input.attempt.generation,
    snapshot: input.state.cursor.appliedThroughSequence,
    dependencies: input.dependencies ?? [],
  });
  const refresh = getSuccess(deriveGenerationRefreshEvidence(
    evidence,
    input.state.cursor,
    [],
    evidence.authorityWitness,
  ));
  const completed = getSuccess(completeQueryEvaluation(
    input.state,
    input.attempt,
    evidence,
    refresh,
    publicationArtifact(`d3-${String(input.attempt.generation)}`),
  ));
  if (completed._tag !== "completed") {
    throw new Error("Expected completed evaluation fixture");
  }
  return completed.state;
}

function stateWithCleanQueries(
  descriptors: readonly QueryDescriptor[],
): QuerySyncState {
  let state = emptyState();
  for (const queryDescriptor of descriptors) {
    const begun = beginFor(state, queryDescriptor);
    state = completeAttempt({ state: begun.state, attempt: begun.attempt });
  }
  return state;
}

function startScan(
  state: QuerySyncState,
  maximumQueryInspections: number,
  continuation: EvaluationWorkScanContinuation | null = null,
) {
  const started = getSuccess(startClaimEvaluationWork({
    scope: scopeFacts(state),
    request: { maximumQueryInspections, continuation },
  }));
  if (started._tag !== "read") throw new Error("Expected a scan read step");
  return started;
}

function startSelectedPoint(
  state: QuerySyncState,
  maximumQueryInspections = MAX_EVALUATION_WORK_QUERY_INSPECTIONS,
) {
  const started = startScan(state, maximumQueryInspections);
  const selected = getSuccess(resumeClaimEvaluationWorkScan(
    started.resume,
    scanRead(state, started.intent),
  ));
  if (selected._tag !== "read") {
    throw new Error("Expected a selected-query read step");
  }
  const query = state.queries.find((candidate) => (
    candidate.descriptor.queryKey === selected.intent.queryKey
  ));
  if (query === undefined) throw new Error("Expected selected query facts");
  return Object.freeze({ selected, query });
}

describe("QSYNC01-D3 claim transition plans", () => {
  it("stages a ready provisional point read and emits a fairness-only write", () => {
    const begun = beginFor(
      emptyState(),
      descriptor({ keySeed: 11, identity: "d3-ready" }),
    );
    const started = startScan(begun.state, 1);
    expect(started.intent).toEqual({
      _tag: "readEvaluationWorkScanFacts",
      scanStartFairnessAnchor: null,
      lastInspectedQueryKey: null,
      maximumPageQueryInspections: 1,
      maximumCombinedQueryFacts: MAX_EVALUATION_WORK_QUERY_SENTINEL,
    });
    const selected = getSuccess(resumeClaimEvaluationWorkScan(
      started.resume,
      scanRead(begun.state, started.intent),
    ));
    expect(selected).toMatchObject({
      _tag: "read",
      intent: {
        _tag: "readEvaluationSelectedQueryFacts",
        queryKey: begun.attempt.descriptor.queryKey,
      },
    });
    if (selected._tag !== "read") throw new Error("Expected point read");

    const plan = getSuccess(resumeClaimEvaluationWorkSelectedQuery(
      selected.resume,
      selectedQueryFacts(begun.state.queries[0]!),
    ));
    const oracle = getSuccess(claimEvaluationWork(begun.state, {
      maximumQueryInspections: 1,
      continuation: null,
    }));
    expect(plan).toMatchObject({
      _tag: "write",
      receipt: {
        _tag: "claimed",
        attempt: begun.attempt,
      },
      nextScope: {
        evaluationWork: {
          revision: begun.state.evaluationWork.revision,
          fairnessAnchor: begun.attempt.descriptor.queryKey,
        },
      },
      change: {
        _tag: "claimReadyEvaluationWork",
        queryKey: begun.attempt.descriptor.queryKey,
      },
    });
    if (
      plan._tag !== "write"
      || plan.receipt._tag !== "claimed"
      || oracle._tag !== "claimed"
    ) {
      throw new Error("Expected write and aggregate claim");
    }
    expect(plan.nextScope.metrics).toEqual(oracle.state.metrics);
    expect(Object.keys(plan.receipt).sort()).toEqual([
      "_tag",
      "attempt",
      "continuation",
    ]);
    expect(Object.isFrozen(plan)).toBe(true);
    expect(Object.isFrozen(plan.expected)).toBe(true);
    expect(Object.isFrozen(plan.expected.query)).toBe(true);
    expect(Object.isFrozen(plan.change)).toBe(true);
    expect(Object.isFrozen(plan.receipt)).toBe(true);
    expect(Object.isFrozen(plan.receipt.attempt)).toBe(true);
    expect(Object.isFrozen(plan.receipt.continuation)).toBe(true);
    expect(plan.receipt.continuation).toMatchObject({
      scanStartFairnessAnchor: begun.attempt.descriptor.queryKey,
      lastInspectedQueryKey: null,
      wrapped: false,
      lowestBlockedWork: null,
    });
  });

  it("creates the exact successor provisional and accounts a dirty claim", () => {
    const dependency = canonicalText("d3:dirty");
    const begun = beginFor(emptyState(), descriptor({ keySeed: 21 }));
    const clean = completeAttempt({
      state: begun.state,
      attempt: begun.attempt,
      dependencies: [dependency],
    });
    const applied = getSuccess(applyAdmittedInvalidations(
      clean,
      batch({ sequence: 1n, dependencies: [dependency] }),
    ));
    const state = applied.state;
    const { selected, query } = startSelectedPoint(state);
    const plan = getSuccess(resumeClaimEvaluationWorkSelectedQuery(
      selected.resume,
      selectedQueryFacts(query),
    ));
    const oracle = getSuccess(claimEvaluationWork(state, {
      maximumQueryInspections: MAX_EVALUATION_WORK_QUERY_INSPECTIONS,
      continuation: null,
    }));
    expect(plan).toMatchObject({
      _tag: "write",
      receipt: {
        _tag: "claimed",
        attempt: {
          generation: 2n,
          expectedActiveGeneration: 1n,
          requestedDirtyThroughSequence: 1n,
        },
      },
      nextScope: {
        evaluationWork: {
          revision: state.evaluationWork.revision + 1n,
          fairnessAnchor: query.descriptor.queryKey,
        },
      },
      change: {
        _tag: "claimDirtyEvaluationWork",
        provisional: {
          generation: 2n,
          expectedActiveGeneration: 1n,
          requestedDirtyThroughSequence: 1n,
          evaluationDisposition: { _tag: "ready" },
        },
      },
    });
    if (plan._tag !== "write" || oracle._tag !== "claimed") {
      throw new Error("Expected dirty write and aggregate claim");
    }
    expect(plan.nextScope.metrics).toEqual(oracle.state.metrics);
    expect(plan.change._tag).toBe("claimDirtyEvaluationWork");
    if (plan.change._tag === "claimDirtyEvaluationWork") {
      expect(Object.isFrozen(plan.change.provisional)).toBe(true);
      expect(Object.isFrozen(
        plan.change.provisional.registrationCursor,
      )).toBe(true);
      expect(Object.isFrozen(
        plan.change.provisional.evaluationDisposition,
      )).toBe(true);
    }
  });

  it("revalidates the cyclic prefix, records wrap, and finishes with none", () => {
    const descriptors = [10, 20, 30].map((seed) => descriptor({
      keySeed: seed,
      identity: `d3-clean-${seed}`,
    }));
    const clean = stateWithCleanQueries(descriptors);
    const anchored = getSuccess(buildQuerySyncState({
      cursor: clean.cursor,
      queries: clean.queries,
      evaluationWork: {
        revision: clean.evaluationWork.revision,
        fairnessAnchor: descriptors[1]!.queryKey,
      },
      publicationWork: clean.publicationWork,
    }));

    const firstStart = startScan(anchored, 1);
    const first = getSuccess(resumeClaimEvaluationWorkScan(
      firstStart.resume,
      scanRead(anchored, firstStart.intent),
    ));
    expect(first).toMatchObject({
      _tag: "planned",
      plan: {
        _tag: "noWrite",
        receipt: { _tag: "continued", continuation: { wrapped: false } },
      },
    });
    if (first._tag !== "planned" || first.plan.receipt._tag !== "continued") {
      throw new Error("Expected first continuation");
    }

    const secondStart = startScan(
      anchored,
      1,
      first.plan.receipt.continuation,
    );
    expect(secondStart.intent.lastInspectedQueryKey).toBe(
      descriptors[2]!.queryKey,
    );
    const secondRead = scanRead(anchored, secondStart.intent);
    expect(secondRead._tag).toBe("complete");
    if (secondRead._tag !== "complete") throw new Error("Expected read");
    expect(secondRead.revalidationPrefix.map((row) => row.queryKey)).toEqual([
      descriptors[2]!.queryKey,
    ]);
    const second = getSuccess(resumeClaimEvaluationWorkScan(
      secondStart.resume,
      secondRead,
    ));
    if (second._tag !== "planned" || second.plan.receipt._tag !== "continued") {
      throw new Error("Expected wrapped continuation");
    }
    expect(second.plan.receipt.continuation.wrapped).toBe(true);

    const finalStart = startScan(
      anchored,
      1,
      second.plan.receipt.continuation,
    );
    const final = getSuccess(resumeClaimEvaluationWorkScan(
      finalStart.resume,
      scanRead(anchored, finalStart.intent),
    ));
    expect(final).toEqual({
      _tag: "planned",
      plan: { _tag: "noWrite", receipt: { _tag: "none" } },
    });
  });

  it("returns only the lowest blocked evidence after a stable full wrap", () => {
    const descriptors = [31, 11, 21].map((seed) => descriptor({
      keySeed: seed,
      identity: `d3-blocked-${seed}`,
    }));
    let state = emptyState();
    for (const queryDescriptor of descriptors) {
      state = beginFor(state, queryDescriptor).state;
    }
    for (let index = 0; index < descriptors.length; index += 1) {
      const claim = getSuccess(claimEvaluationWork(state, {
        maximumQueryInspections: MAX_EVALUATION_WORK_QUERY_INSPECTIONS,
        continuation: null,
      }));
      if (claim._tag !== "claimed") throw new Error("Expected claim");
      const blocked = getSuccess(recordEvaluationAttemptOutcome(
        claim.state,
        claim.attempt,
        "terminalRefusal",
      ));
      if (blocked._tag !== "blocked") throw new Error("Expected block");
      state = blocked.state;
    }
    const started = startScan(state, MAX_EVALUATION_WORK_QUERY_INSPECTIONS);
    const planned = getSuccess(resumeClaimEvaluationWorkScan(
      started.resume,
      scanRead(state, started.intent),
    ));
    const lowest = state.queries[0]!;
    expect(planned).toEqual({
      _tag: "planned",
      plan: {
        _tag: "noWrite",
        receipt: {
          _tag: "blocked",
          blockedWork: {
            queryKey: lowest.descriptor.queryKey,
            generation: lowest.provisional!.generation,
            reason: "terminalEvaluatorRefusal",
            resetRequired: true,
          },
        },
      },
    });
  });

  it("preserves request, continuation-authentication, authority, and fence order", () => {
    const clean = stateWithCleanQueries([
      descriptor({ keySeed: 41 }),
      descriptor({ keySeed: 42 }),
    ]);
    const started = startScan(clean, 1);
    const first = getSuccess(resumeClaimEvaluationWorkScan(
      started.resume,
      scanRead(clean, started.intent),
    ));
    if (first._tag !== "planned" || first.plan.receipt._tag !== "continued") {
      throw new Error("Expected continuation fixture");
    }
    const continuation = first.plan.receipt.continuation;

    let forgedFieldReads = 0;
    const forged = Object.defineProperty({}, "namespaceId", {
      enumerable: true,
      get: () => {
        forgedFieldReads += 1;
        throw new Error("Unauthenticated continuation field read");
      },
    }) as unknown as EvaluationWorkScanContinuation;
    expect(getFailure(startClaimEvaluationWork({
      scope: scopeFacts(clean),
      request: { maximumQueryInspections: 0, continuation: forged },
    }))).toBeInstanceOf(InvalidEvaluationWorkScanRequestError);
    expect(getFailure(startClaimEvaluationWork({
      scope: scopeFacts(clean),
      request: { maximumQueryInspections: 1, continuation: forged },
    }))).toBeInstanceOf(InvalidEvaluationWorkContinuationError);
    expect(forgedFieldReads).toBe(0);

    const foreign = emptyState("tenant-b");
    expect(getFailure(startClaimEvaluationWork({
      scope: scopeFacts(foreign),
      request: { maximumQueryInspections: 1, continuation },
    }))).toBeInstanceOf(QuerySyncNamespaceMismatchError);

    const stale = beginFor(
      clean,
      descriptor({ keySeed: 40, identity: "d3-new-lowest" }),
    ).state;
    const restarted = getSuccess(startClaimEvaluationWork({
      scope: scopeFacts(stale),
      request: { maximumQueryInspections: 1, continuation },
    }));
    expect(restarted).toMatchObject({
      _tag: "planned",
      plan: {
        _tag: "noWrite",
        receipt: { _tag: "scanRestarted" },
      },
    });

    const resumed = startScan(clean, 1, continuation);
    const resumedRead = scanRead(clean, resumed.intent);
    if (resumedRead._tag !== "complete") throw new Error("Expected read");
    const wrongPrefix = resumeClaimEvaluationWorkScan(resumed.resume, {
      ...resumedRead,
      revalidationPrefix: resumedRead.page,
    });
    expect(getFailure(wrongPrefix)).toBeInstanceOf(
      InvalidEvaluationWorkContinuationError,
    );

    const malformed = issueEvaluationWorkScanContinuation(
      scopeFacts(clean),
      {
        scanStartFairnessAnchor: null,
        lastInspectedQueryKey: null,
        wrapped: true,
        lowestBlockedWork: null,
      },
    );
    expect(getFailure(startClaimEvaluationWork({
      scope: scopeFacts(clean),
      request: { maximumQueryInspections: 1, continuation: malformed },
    }))).toBeInstanceOf(InvalidEvaluationWorkContinuationError);
  });

  it("refuses the limit-plus-one before copying and rejects crossed resumes", () => {
    const begun = beginFor(emptyState(), descriptor({ keySeed: 51 }));
    const started = startScan(begun.state, 1);
    let rowReads = 0;
    const oversized = Array.from(
      { length: MAX_EVALUATION_WORK_QUERY_SENTINEL },
      () => Object.defineProperty({}, "queryKey", {
        enumerable: true,
        get: () => {
          rowReads += 1;
          throw new Error("Copied an over-limit row");
        },
      }) as EvaluationWorkScanFacts,
    );
    const overLimit = resumeClaimEvaluationWorkScan(started.resume, {
      _tag: "complete",
      fairnessAnchorPresent: false,
      revalidationPrefix: [],
      page: oversized,
      hasMore: false,
    });
    expect(Result.isFailure(overLimit)).toBe(true);
    expect(rowReads).toBe(0);
    expect(getFailure(resumeClaimEvaluationWorkScan(started.resume, {
      _tag: "limitExceeded",
      observed: MAX_EVALUATION_WORK_QUERY_SENTINEL,
    }))).toMatchObject({
      _tag: "QuerySyncTransitionFactError",
      reason: "evaluationScanFactsInvalid",
    });

    const point = startSelectedPoint(begun.state).selected;
    expect(() => Reflect.apply(
      resumeClaimEvaluationWorkScan,
      undefined,
      [Object.freeze({}), scanRead(begun.state, started.intent)],
    )).toThrowError(QuerySyncTransitionResumeDefect);
    expect(() => Reflect.apply(
      resumeClaimEvaluationWorkScan,
      undefined,
      [point.resume, scanRead(begun.state, started.intent)],
    )).toThrowError(QuerySyncTransitionResumeDefect);
    expect(() => Reflect.apply(
      resumeClaimEvaluationWorkSelectedQuery,
      undefined,
      [started.resume, selectedQueryFacts(begun.state.queries[0]!)],
    )).toThrowError(QuerySyncTransitionResumeDefect);
  });

  it("rejects incoherent slim active and provisional generations", () => {
    const begun = beginFor(emptyState(), descriptor({ keySeed: 55 }));
    const started = startScan(begun.state, 1);
    const validRead = scanRead(begun.state, started.intent);
    if (validRead._tag !== "complete" || validRead.page[0] === undefined) {
      throw new Error("Expected one initial-provisional scan row.");
    }
    const source = validRead.page[0];
    const invalidGeneration = getSuccess(captureQueryGeneration(2n));
    const failure = getFailure(resumeClaimEvaluationWorkScan(
      started.resume,
      Object.freeze({
        ...validRead,
        page: Object.freeze([Object.freeze({
          ...source,
          provisional: Object.freeze({
            generation: invalidGeneration,
            evaluationDisposition: Object.freeze({ _tag: "ready" }),
          }),
        })]),
      }),
    ));
    expect(failure).toMatchObject({
      _tag: "QuerySyncTransitionFactError",
      reason: "evaluationScanFactsInvalid",
    });
  });

  it("rejects a crossed point fingerprint without retaining caller inputs", () => {
    const begun = beginFor(emptyState(), descriptor({ keySeed: 61 }));
    const { selected, query } = startSelectedPoint(begun.state);
    const mutable = selectedQueryFacts(query) as {
      descriptor: QueryDescriptor;
      active: EvaluationSelectedQueryFacts["active"];
      provisional: EvaluationSelectedQueryFacts["provisional"];
    };
    const crossed = {
      ...mutable,
      descriptor: descriptor({ keySeed: 62, identity: "d3-crossed" }),
    };
    expect(getFailure(resumeClaimEvaluationWorkSelectedQuery(
      selected.resume,
      crossed,
    ))).toMatchObject({
      _tag: "QuerySyncTransitionFactError",
      reason: "evaluationSelectedQueryFactsInvalid",
    });
    expect(getFailure(resumeClaimEvaluationWorkSelectedQuery(
      selected.resume,
      null,
    ))).toMatchObject({
      _tag: "QuerySyncTransitionFactError",
      reason: "evaluationSelectedQueryFactsInvalid",
    });
    expect(mutable.descriptor).toBe(query.descriptor);
    expect(mutable.provisional).toBe(query.provisional);
  });

  it("reports generation exhaustion before revision exhaustion", () => {
    const base = beginFor(emptyState(), descriptor({ keySeed: 71 }));
    const maximumGeneration = getSuccess(captureQueryGeneration(
      MAX_QUERY_GENERATION,
    ));
    const maximumRevision = getSuccess(captureQuerySyncWorkRevision(
      MAX_QUERY_SYNC_WORK_REVISION,
    ));
    const query = selectedQueryFacts(base.state.queries[0]!);
    if (query.provisional === null) throw new Error("Expected provisional");
    const evidence = evaluation({ generation: 1n, snapshot: 0n });
    const snapshot = getSuccess(captureQuerySnapshot(0n));
    const freshThrough = getSuccess(captureSyncSequence(0n));
    const dirtyThrough = getSuccess(captureSyncSequence(1n));
    const active = {
      generation: maximumGeneration,
      evaluationSnapshotSequence: snapshot,
      freshThroughSequence: freshThrough,
      dirtyThroughSequence: dirtyThrough,
      resultDigest: evidence.resultDigest,
      authorityWitness: evidence.authorityWitness,
    };
    const scope: QuerySyncScopeFacts = {
      ...scopeFacts(base.state),
      cursor: cursor({ sequence: 1n }),
      evaluationWork: {
        revision: maximumRevision,
        fairnessAnchor: null,
      },
    };
    const started = getSuccess(startClaimEvaluationWork({
      scope,
      request: { maximumQueryInspections: 1, continuation: null },
    }));
    if (started._tag !== "read") throw new Error("Expected scan");
    const selected = getSuccess(resumeClaimEvaluationWorkScan(
      started.resume,
      {
        _tag: "complete",
        fairnessAnchorPresent: false,
        revalidationPrefix: [],
        page: [{
          queryKey: query.descriptor.queryKey,
          active: {
            generation: maximumGeneration,
            dirtyThroughSequence: dirtyThrough,
          },
          provisional: null,
        }],
        hasMore: false,
      },
    ));
    if (selected._tag !== "read") throw new Error("Expected point read");
    const failure = getFailure(resumeClaimEvaluationWorkSelectedQuery(
      selected.resume,
      {
        descriptor: query.descriptor,
        active,
        provisional: null,
      },
    ));
    expect(failure).toBeInstanceOf(QueryGenerationExhaustedError);
    expect(failure).not.toBeInstanceOf(QuerySyncWorkRevisionExhaustedError);
  });

  it("uses the exact 4096 request boundary", () => {
    const state = emptyState();
    const accepted = getSuccess(startClaimEvaluationWork({
      scope: scopeFacts(state),
      request: {
        maximumQueryInspections: MAX_EVALUATION_WORK_QUERY_INSPECTIONS,
        continuation: null,
      },
    }));
    expect(accepted).toEqual({
      _tag: "planned",
      plan: { _tag: "noWrite", receipt: { _tag: "none" } },
    });
    for (const observed of [
      0,
      MAX_EVALUATION_WORK_QUERY_INSPECTIONS + 1,
      1.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.MAX_SAFE_INTEGER + 1,
      "1",
      null,
    ]) {
      expect(getFailure(startClaimEvaluationWork({
        scope: scopeFacts(state),
        request: {
          maximumQueryInspections: observed,
          continuation: null,
        },
      }))).toMatchObject({
        _tag: "InvalidEvaluationWorkScanRequestError",
        maximum: MAX_EVALUATION_WORK_QUERY_INSPECTIONS,
        observed,
      });
    }
  });
});
