import { Result } from "effect";
import { describe, expect, it } from "vitest";

import {
  applyAdmittedInvalidations,
  beginQueryEvaluation,
  buildQuerySyncState,
  captureQuerySyncWorkRevision,
  claimEvaluationWork,
  completeQueryEvaluation,
  createEmptyQuerySyncState,
  InvalidEvaluationWorkContinuationError,
  InvalidEvaluationWorkScanRequestError,
  MAX_EVALUATION_WORK_QUERY_INSPECTIONS,
  MAX_QUERY_SYNC_WORK_REVISION,
  QueryEvaluationWorkBlockedError,
  QuerySyncNamespaceMismatchError,
  QuerySyncWorkRevisionExhaustedError,
  recordEvaluationAttemptOutcome,
} from "@flarex/query-sync/internal/kernel";
import type {
  EvaluationWorkScanContinuation,
  QueryDescriptor,
  QueryEvaluationAttempt,
  QueryState,
  QuerySyncState,
  QuerySyncWorkRevision,
} from "@flarex/query-sync/internal/kernel";
import {
  deriveGenerationRefreshEvidence,
} from "@flarex/query-sync/testing/reference-model";
import {
  makeQueryEvaluationAttemptForTesting,
} from "@flarex/query-sync/testing/conformance";

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

function getFailure<A, E>(result: Result.Result<A, E>): E {
  if (Result.isSuccess(result)) {
    throw new Error("Expected a failed Result");
  }
  return result.failure;
}

function cloneWithPlatformStructuredClone(value: unknown): unknown {
  const clone = Reflect.get(globalThis, "structuredClone");
  if (typeof clone !== "function") {
    throw new Error("Expected the platform structured-clone capability");
  }
  return Reflect.apply(clone, globalThis, [value]);
}

function emptyState(): QuerySyncState {
  return getSuccess(createEmptyQuerySyncState(cursor()));
}

function beginFor(
  state: QuerySyncState,
  queryDescriptor: QueryDescriptor,
): { readonly state: QuerySyncState; readonly attempt: QueryEvaluationAttempt } {
  const decision = getSuccess(beginQueryEvaluation(
    state,
    firstEvaluationRequest(target({ descriptor: queryDescriptor })),
  ));
  return {
    state: decision.state,
    attempt: getEvaluationAttempt(decision),
  };
}

function claim(
  state: QuerySyncState,
  maximumQueryInspections = MAX_EVALUATION_WORK_QUERY_INSPECTIONS,
  continuation: EvaluationWorkScanContinuation | null = null,
) {
  return getSuccess(claimEvaluationWork(state, {
    maximumQueryInspections,
    continuation,
  }));
}

function requireClaimed(
  state: QuerySyncState,
  maximumQueryInspections = MAX_EVALUATION_WORK_QUERY_INSPECTIONS,
  continuation: EvaluationWorkScanContinuation | null = null,
) {
  const decision = claim(state, maximumQueryInspections, continuation);
  if (decision._tag !== "claimed") {
    throw new Error(`Expected claimed evaluation work, received ${decision._tag}`);
  }
  return decision;
}

function completeAttempt(input: {
  readonly state: QuerySyncState;
  readonly attempt: QueryEvaluationAttempt;
  readonly dependencies?: readonly string[];
  readonly resultSeed?: number;
}): QuerySyncState {
  const evidence = evaluation({
    descriptor: input.attempt.descriptor,
    generation: input.attempt.generation,
    snapshot: input.state.cursor.appliedThroughSequence,
    resultSeed: input.resultSeed ?? Number(input.attempt.generation) + 80,
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
    publicationArtifact(`publication-${String(input.attempt.generation)}`),
  ));
  if (completed._tag !== "completed") {
    throw new Error(`Expected completed evaluation, received ${completed._tag}`);
  }
  return completed.state;
}

function stateWithReadyProvisionals(
  descriptors: readonly QueryDescriptor[],
): QuerySyncState {
  let state = emptyState();
  for (const queryDescriptor of descriptors) {
    state = beginFor(state, queryDescriptor).state;
  }
  return state;
}

function stateWithCleanQueries(
  descriptors: readonly QueryDescriptor[],
  dependencies: readonly (readonly string[])[] = [],
): QuerySyncState {
  let state = emptyState();
  for (const [index, queryDescriptor] of descriptors.entries()) {
    const begun = beginFor(state, queryDescriptor);
    state = completeAttempt({
      state: begun.state,
      attempt: begun.attempt,
      dependencies: dependencies[index] ?? [],
      resultSeed: 100 + index,
    });
  }
  return state;
}

function rebuild(
  state: QuerySyncState,
  input: {
    readonly queries?: readonly QueryState[];
    readonly revision?: QuerySyncWorkRevision;
    readonly fairnessAnchor?: QueryDescriptor["queryKey"] | null;
  },
): QuerySyncState {
  return getSuccess(buildQuerySyncState({
    cursor: state.cursor,
    queries: input.queries ?? state.queries,
    evaluationWork: {
      revision: input.revision ?? state.evaluationWork.revision,
      fairnessAnchor: input.fairnessAnchor === undefined
        ? state.evaluationWork.fairnessAnchor
        : input.fairnessAnchor,
    },
    publicationWork: state.publicationWork,
  }));
}

function invalidate(
  state: QuerySyncState,
  dependency: string,
  sequence: bigint,
): QuerySyncState {
  const decision = getSuccess(applyAdmittedInvalidations(
    state,
    batch({ sequence, dependencies: [dependency] }),
  ));
  if (decision._tag !== "applied") {
    throw new Error(`Expected applied invalidation, received ${decision._tag}`);
  }
  return decision.state;
}

function rerunRequestFor(state: QuerySyncState, queryIndex = 0) {
  const query = state.queries[queryIndex];
  const active = query?.active;
  if (query === undefined || active === null || active === undefined) {
    throw new Error("Expected an active query");
  }
  if (active.dirtyThroughSequence === null) {
    throw new Error("Expected a dirty active query");
  }
  return rerunEvaluationRequest({
    target: target({ descriptor: query.descriptor }),
    activeGeneration: active.generation,
    dirtyThroughSequence: active.dirtyThroughSequence,
  });
}

describe("evaluation work selection", () => {
  it("reports an empty stable wrap and recovers provisional and dirty-active work", () => {
    const initial = emptyState();
    const none = claim(initial);
    expect(none).toEqual({ _tag: "none", state: initial });

    const queryDescriptor = descriptor({ keySeed: 10, identity: "query-10" });
    const begun = beginFor(initial, queryDescriptor);
    const provisional = requireClaimed(begun.state);
    expect(provisional.attempt).toEqual(begun.attempt);
    expect(provisional.state.evaluationWork.revision).toBe(
      begun.state.evaluationWork.revision,
    );

    const dependency = canonicalText("kv:dirty");
    const completed = completeAttempt({
      state: provisional.state,
      attempt: provisional.attempt,
      dependencies: [dependency],
    });
    const dirty = invalidate(completed, dependency, 1n);
    const dirtyClaim = requireClaimed(dirty);
    expect(dirtyClaim.attempt).toMatchObject({
      descriptor: queryDescriptor,
      generation: 2n,
      expectedActiveGeneration: 1n,
      requestedDirtyThroughSequence: 1n,
    });
    expect(dirtyClaim.state.evaluationWork.revision).toBe(
      dirty.evaluationWork.revision + 1n,
    );
  });

  it("uses canonical round-robin order independent of insertion history", () => {
    const descriptors = [
      descriptor({ keySeed: 30, identity: "query-30" }),
      descriptor({ keySeed: 10, identity: "query-10" }),
      descriptor({ keySeed: 20, identity: "query-20" }),
    ];
    const expected = stateWithReadyProvisionals(descriptors).queries.map(
      (query) => query.descriptor.queryKey,
    );

    for (const insertion of [descriptors, [...descriptors].reverse()]) {
      let state = stateWithReadyProvisionals(insertion);
      const observed: string[] = [];
      for (let index = 0; index < 4; index += 1) {
        const decision = requireClaimed(state);
        observed.push(decision.attempt.descriptor.queryKey);
        state = decision.state;
      }
      expect(observed).toEqual([...expected, expected[0]]);
    }
  });

  it("continues within a small budget, records wrap, and returns stable none", () => {
    const descriptors = [10, 20, 30].map((seed) => descriptor({
      keySeed: seed,
      identity: `query-${seed}`,
    }));
    const clean = stateWithCleanQueries(descriptors);
    const anchored = rebuild(clean, {
      fairnessAnchor: descriptors[1]?.queryKey ?? null,
    });

    const first = claim(anchored, 1);
    expect(first._tag).toBe("continued");
    if (first._tag !== "continued") return;
    expect(first.continuation.wrapped).toBe(false);

    const second = claim(anchored, 1, first.continuation);
    expect(second._tag).toBe("continued");
    if (second._tag !== "continued") return;
    expect(second.continuation.wrapped).toBe(true);

    const final = claim(anchored, 1, second.continuation);
    expect(final).toEqual({ _tag: "none", state: anchored });
    expect(claim(anchored)).toEqual({ _tag: "none", state: anchored });
    expect(claim(anchored)).toEqual({ _tag: "none", state: anchored });
  });

  it("prefers runnable work to blocked evidence and reports the lowest block only after a full wrap", () => {
    const descriptors = [10, 20, 30].map((seed) => descriptor({
      keySeed: seed,
      identity: `query-${seed}`,
    }));
    let state = stateWithReadyProvisionals(descriptors);

    const firstClaim = requireClaimed(state);
    const firstBlock = getSuccess(recordEvaluationAttemptOutcome(
      firstClaim.state,
      firstClaim.attempt,
      "terminalRefusal",
    ));
    if (firstBlock._tag !== "blocked") throw new Error("Expected first block");
    state = firstBlock.state;

    const runnable = claim(state, MAX_EVALUATION_WORK_QUERY_INSPECTIONS);
    expect(runnable._tag).toBe("claimed");
    if (runnable._tag !== "claimed") return;
    expect(runnable.attempt.descriptor.queryKey).not.toBe(
      firstBlock.blockedWork.queryKey,
    );

    let allBlocked = runnable.state;
    for (let index = 0; index < 2; index += 1) {
      const selected = requireClaimed(allBlocked);
      const blocked = getSuccess(recordEvaluationAttemptOutcome(
        selected.state,
        selected.attempt,
        "terminalRefusal",
      ));
      if (blocked._tag !== "blocked") throw new Error("Expected block");
      allBlocked = blocked.state;
    }
    const blockedScanOne = claim(allBlocked, 1);
    expect(blockedScanOne._tag).toBe("continued");
    if (blockedScanOne._tag !== "continued") return;
    const blockedScanTwo = claim(
      allBlocked,
      1,
      blockedScanOne.continuation,
    );
    expect(blockedScanTwo._tag).toBe("continued");
    if (blockedScanTwo._tag !== "continued") return;
    const stableBlock = claim(
      allBlocked,
      1,
      blockedScanTwo.continuation,
    );
    expect(stableBlock._tag).toBe("blocked");
    if (stableBlock._tag !== "blocked") return;
    const lowestKey = allBlocked.queries[0]?.descriptor.queryKey;
    expect(stableBlock.blockedWork.queryKey).toBe(lowestKey);
    expect(claim(allBlocked)).toEqual(stableBlock);
  });

  it("restarts revision- and anchor-stale continuations without skipping newly lowest work", () => {
    const cleanDescriptors = [20, 30].map((seed) => descriptor({
      keySeed: seed,
      identity: `query-${seed}`,
    }));
    const clean = stateWithCleanQueries(cleanDescriptors);
    const partial = claim(clean, 1);
    if (partial._tag !== "continued") throw new Error("Expected continuation");

    const newlyLowest = descriptor({ keySeed: 10, identity: "query-10" });
    const changed = beginFor(clean, newlyLowest).state;
    const revisionRestart = claim(changed, 1, partial.continuation);
    expect(revisionRestart._tag).toBe("scanRestarted");
    if (revisionRestart._tag !== "scanRestarted") return;
    const selected = requireClaimed(
      changed,
      MAX_EVALUATION_WORK_QUERY_INSPECTIONS,
      revisionRestart.continuation,
    );
    expect(selected.attempt.descriptor.queryKey).toBe(newlyLowest.queryKey);

    const anchorChanged = rebuild(clean, {
      fairnessAnchor: clean.queries[0]?.descriptor.queryKey ?? null,
    });
    const anchorRestart = claim(anchorChanged, 1, partial.continuation);
    expect(anchorRestart._tag).toBe("scanRestarted");
    if (anchorRestart._tag !== "scanRestarted") return;
    expect(anchorRestart.continuation.observedWorkRevision).toBe(
      clean.evaluationWork.revision,
    );
    expect(anchorRestart.continuation.scanStartFairnessAnchor).toBe(
      anchorChanged.evaluationWork.fairnessAnchor,
    );
  });

  it("restarts after invalidation before or ahead of a continuation", () => {
    const dependencies = [10, 20, 30].map((seed) => canonicalText(`dep-${seed}`));
    const descriptors = [10, 20, 30].map((seed) => descriptor({
      keySeed: seed,
      identity: `query-${seed}`,
    }));
    const clean = stateWithCleanQueries(
      descriptors,
      dependencies.map((dependency) => [dependency]),
    );
    const partial = claim(clean, 1);
    if (partial._tag !== "continued") throw new Error("Expected continuation");

    const behind = invalidate(clean, dependencies[0]!, 1n);
    const behindRestart = claim(behind, 1, partial.continuation);
    expect(behindRestart._tag).toBe("scanRestarted");
    if (behindRestart._tag !== "scanRestarted") return;
    const behindClaim = requireClaimed(
      behind,
      MAX_EVALUATION_WORK_QUERY_INSPECTIONS,
      behindRestart.continuation,
    );
    expect(behindClaim.attempt.descriptor.queryKey).toBe(
      descriptors[0]?.queryKey,
    );

    const ahead = invalidate(clean, dependencies[2]!, 1n);
    const aheadRestart = claim(ahead, 1, partial.continuation);
    expect(aheadRestart._tag).toBe("scanRestarted");
    if (aheadRestart._tag !== "scanRestarted") return;
    const aheadClaim = requireClaimed(
      ahead,
      MAX_EVALUATION_WORK_QUERY_INSPECTIONS,
      aheadRestart.continuation,
    );
    expect(aheadClaim.attempt.descriptor.queryKey).toBe(
      descriptors[2]?.queryKey,
    );
  });

  it("advances durable dirty state during evaluation without rewriting the issued attempt", () => {
    const dependency = canonicalText("dep-during-evaluation");
    const queryDescriptor = descriptor({ keySeed: 10 });
    const clean = stateWithCleanQueries([queryDescriptor], [[dependency]]);
    const firstDirty = invalidate(clean, dependency, 1n);
    const firstAttempt = requireClaimed(firstDirty);
    expect(firstAttempt.attempt.requestedDirtyThroughSequence).toBe(1n);

    const dirtier = invalidate(firstAttempt.state, dependency, 2n);
    expect(dirtier.queries[0]?.active?.dirtyThroughSequence).toBe(2n);
    expect(dirtier.queries[0]?.provisional?.requestedDirtyThroughSequence).toBe(
      1n,
    );
    const transient = getSuccess(recordEvaluationAttemptOutcome(
      dirtier,
      firstAttempt.attempt,
      "transientExhausted",
    ));
    expect(transient).toMatchObject({
      _tag: "eligible",
      state: dirtier,
      generation: 2n,
    });

    const current = requireClaimed(dirtier);
    expect(current.attempt).toMatchObject({
      generation: 2n,
      requestedDirtyThroughSequence: 1n,
    });
  });

  it("keeps transient work eligible, terminally blocks once, and exactly replays the block", () => {
    const begun = beginFor(emptyState(), descriptor());
    const selected = requireClaimed(begun.state);
    const revision = selected.state.evaluationWork.revision;

    const transient = getSuccess(recordEvaluationAttemptOutcome(
      selected.state,
      selected.attempt,
      "transientExhausted",
    ));
    expect(transient).toMatchObject({
      _tag: "eligible",
      state: selected.state,
      generation: 1n,
    });
    expect(transient.state.evaluationWork.revision).toBe(revision);

    const terminal = getSuccess(recordEvaluationAttemptOutcome(
      transient.state,
      selected.attempt,
      "terminalRefusal",
    ));
    expect(terminal._tag).toBe("blocked");
    if (terminal._tag !== "blocked") return;
    expect(terminal.state.evaluationWork.revision).toBe(revision + 1n);

    for (const outcome of ["terminalRefusal", "transientExhausted"] as const) {
      const replay = getSuccess(recordEvaluationAttemptOutcome(
        terminal.state,
        selected.attempt,
        outcome,
      ));
      expect(replay).toEqual({
        _tag: "blocked",
        state: terminal.state,
        blockedWork: terminal.blockedWork,
      });
    }
    expect(claim(terminal.state)).toEqual({
      _tag: "blocked",
      state: terminal.state,
      blockedWork: terminal.blockedWork,
    });
  });

  it("accepts begin-issued attempts and rejects structural lookalikes", () => {
    const begun = beginFor(emptyState(), descriptor());
    expect(getSuccess(recordEvaluationAttemptOutcome(
      begun.state,
      begun.attempt,
      "transientExhausted",
    ))).toMatchObject({
      _tag: "eligible",
      state: begun.state,
      generation: begun.attempt.generation,
    });

    const lookalike = {
      ...begun.attempt,
      descriptor: { ...begun.attempt.descriptor },
      registrationCursor: { ...begun.attempt.registrationCursor },
    } as unknown as QueryEvaluationAttempt;
    expect(getFailure(recordEvaluationAttemptOutcome(
      begun.state,
      lookalike,
      "transientExhausted",
    ))).toMatchObject({
      _tag: "InvalidEvaluationAttemptError",
      reason: "notStateIssued",
    });

    const decoded = cloneWithPlatformStructuredClone(
      begun.attempt,
    ) as unknown as QueryEvaluationAttempt;
    expect(getFailure(recordEvaluationAttemptOutcome(
      begun.state,
      decoded,
      "transientExhausted",
    ))).toMatchObject({
      _tag: "InvalidEvaluationAttemptError",
      reason: "notStateIssued",
    });

    let forgedFieldReads = 0;
    const throwingForgery = Object.defineProperty({}, "descriptor", {
      enumerable: true,
      get: () => {
        forgedFieldReads += 1;
        throw new Error("Unauthenticated attempt field was read");
      },
    }) as unknown as QueryEvaluationAttempt;
    expect(getFailure(recordEvaluationAttemptOutcome(
      begun.state,
      throwingForgery,
      "transientExhausted",
    ))).toMatchObject({
      _tag: "InvalidEvaluationAttemptError",
      reason: "notStateIssued",
      queryKey: "",
      generation: 0n,
    });
    expect(forgedFieldReads).toBe(0);
  });

  it("classifies current and preceding completions as superseded and older outcomes as expired", () => {
    const dependency = canonicalText("dep-stale-window");
    const begun = beginFor(emptyState(), descriptor());
    const generationOne = requireClaimed(begun.state);
    let state = completeAttempt({
      state: generationOne.state,
      attempt: generationOne.attempt,
      dependencies: [dependency],
    });
    const current = getSuccess(recordEvaluationAttemptOutcome(
      state,
      generationOne.attempt,
      "terminalRefusal",
    ));
    expect(current._tag).toBe("superseded");

    const registrationMismatch = makeQueryEvaluationAttemptForTesting({
      ...generationOne.attempt,
      registrationCursor: cursor({ sequence: 1n }),
    });
    expect(getFailure(recordEvaluationAttemptOutcome(
      state,
      registrationMismatch,
      "terminalRefusal",
    ))).toMatchObject({
      _tag: "InvalidEvaluationAttemptError",
      reason: "registrationCursorMismatch",
    });

    const dirtyFrontierMismatch = makeQueryEvaluationAttemptForTesting({
      ...generationOne.attempt,
      requestedDirtyThroughSequence:
        cursor({ sequence: 1n }).appliedThroughSequence,
    });
    expect(getFailure(recordEvaluationAttemptOutcome(
      state,
      dirtyFrontierMismatch,
      "terminalRefusal",
    ))).toMatchObject({
      _tag: "InvalidEvaluationAttemptError",
      reason: "requestedDirtyFrontierMismatch",
    });

    state = invalidate(state, dependency, 1n);
    const generationTwo = requireClaimed(state);
    state = completeAttempt({
      state: generationTwo.state,
      attempt: generationTwo.attempt,
      dependencies: [dependency],
    });
    state = invalidate(state, dependency, 2n);
    const generationThree = requireClaimed(state);
    state = completeAttempt({
      state: generationThree.state,
      attempt: generationThree.attempt,
      dependencies: [dependency],
    });

    expect(getSuccess(recordEvaluationAttemptOutcome(
      state,
      generationTwo.attempt,
      "terminalRefusal",
    ))._tag).toBe("superseded");
    expect(getSuccess(recordEvaluationAttemptOutcome(
      state,
      generationOne.attempt,
      "terminalRefusal",
    ))._tag).toBe("recoveryEvidenceExpired");
  });

  it("retains an exact block across invalidation and refuses blocked begin and completion atomically", () => {
    const dependency = canonicalText("dep-blocked");
    const queryDescriptor = descriptor();
    let state = stateWithCleanQueries([queryDescriptor], [[dependency]]);
    state = invalidate(state, dependency, 1n);
    const selected = requireClaimed(state);
    const blocked = getSuccess(recordEvaluationAttemptOutcome(
      selected.state,
      selected.attempt,
      "terminalRefusal",
    ));
    if (blocked._tag !== "blocked") throw new Error("Expected blocked work");
    const blockRevision = blocked.state.evaluationWork.revision;

    const dirtier = invalidate(blocked.state, dependency, 2n);
    expect(dirtier.queries[0]?.active?.dirtyThroughSequence).toBe(2n);
    expect(dirtier.queries[0]?.provisional).toMatchObject({
      generation: selected.attempt.generation,
      requestedDirtyThroughSequence: 1n,
      evaluationDisposition: blocked.state.queries[0]?.provisional
        ?.evaluationDisposition,
    });
    expect(dirtier.evaluationWork.revision).toBe(blockRevision + 1n);

    const beforeBeginProvisional = dirtier.queries[0]?.provisional;
    const higherBegin = beginQueryEvaluation(dirtier, rerunRequestFor(dirtier));
    const beginFailure = getFailure(higherBegin);
    expect(beginFailure).toBeInstanceOf(QueryEvaluationWorkBlockedError);
    expect(beginFailure).toMatchObject(blocked.blockedWork);
    expect(dirtier.queries[0]?.provisional).toBe(
      beforeBeginProvisional,
    );

    const evidence = evaluation({
      descriptor: selected.attempt.descriptor,
      generation: selected.attempt.generation,
      snapshot: dirtier.cursor.appliedThroughSequence,
    });
    const refresh = getSuccess(deriveGenerationRefreshEvidence(
      evidence,
      dirtier.cursor,
      [],
      evidence.authorityWitness,
    ));
    const completionFailure = getFailure(completeQueryEvaluation(
      dirtier,
      selected.attempt,
      evidence,
      refresh,
      publicationArtifact("must-not-publish"),
    ));
    expect(completionFailure).toBeInstanceOf(QueryEvaluationWorkBlockedError);
    expect(dirtier.publicationWork.pending).toHaveLength(
      blocked.state.publicationWork.pending.length,
    );

    const transient = getSuccess(recordEvaluationAttemptOutcome(
      dirtier,
      selected.attempt,
      "transientExhausted",
    ));
    expect(transient._tag).toBe("blocked");
    expect(transient.state).toBe(dirtier);
    expect(claim(dirtier)._tag).toBe("blocked");
  });

  it("refuses revision-requiring claims and terminal outcomes at maximum revision", () => {
    const maximumRevision = getSuccess(captureQuerySyncWorkRevision(
      MAX_QUERY_SYNC_WORK_REVISION,
    ));
    const begun = beginFor(emptyState(), descriptor());
    const readyAtMaximum = rebuild(begun.state, {
      revision: maximumRevision,
    });
    const readyClaim = requireClaimed(readyAtMaximum);
    expect(readyClaim.state.evaluationWork.revision).toBe(
      MAX_QUERY_SYNC_WORK_REVISION,
    );
    const blockFailure = getFailure(recordEvaluationAttemptOutcome(
      readyClaim.state,
      readyClaim.attempt,
      "terminalRefusal",
    ));
    expect(blockFailure).toBeInstanceOf(QuerySyncWorkRevisionExhaustedError);
    expect(readyClaim.state.queries[0]?.provisional?.evaluationDisposition._tag)
      .toBe("ready");

    const dependency = canonicalText("dep-revision-maximum");
    const clean = stateWithCleanQueries([descriptor()], [[dependency]]);
    const dirty = invalidate(clean, dependency, 1n);
    const dirtyAtMaximum = rebuild(dirty, {
      revision: maximumRevision,
    });
    const claimFailure = getFailure(claimEvaluationWork(dirtyAtMaximum, {
      maximumQueryInspections: 1,
      continuation: null,
    }));
    expect(claimFailure).toBeInstanceOf(QuerySyncWorkRevisionExhaustedError);
    expect(dirtyAtMaximum.queries[0]?.provisional).toBeNull();
  });

  it("validates exact scan-budget boundaries", () => {
    const state = emptyState();
    for (const value of [
      0,
      MAX_EVALUATION_WORK_QUERY_INSPECTIONS + 1,
      1.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.MAX_SAFE_INTEGER + 1,
      "1",
      null,
    ]) {
      const failure = getFailure(claimEvaluationWork(state, {
        maximumQueryInspections: value,
        continuation: null,
      }));
      expect(failure).toBeInstanceOf(InvalidEvaluationWorkScanRequestError);
      expect(failure).toMatchObject({
        reason: "maximumQueryInspectionsOutOfRange",
        maximum: MAX_EVALUATION_WORK_QUERY_INSPECTIONS,
        observed: value,
      });
    }
    expect(claim(state, 1)._tag).toBe("none");
    expect(claim(state, MAX_EVALUATION_WORK_QUERY_INSPECTIONS)._tag).toBe(
      "none",
    );
  });

  it("rejects crossed, forged, and malformed state-crossing continuations", () => {
    const descriptors = [10, 20].map((seed) => descriptor({
      keySeed: seed,
      identity: `query-${seed}`,
    }));
    const clean = stateWithCleanQueries(descriptors);
    const partial = claim(clean, 1);
    if (partial._tag !== "continued") throw new Error("Expected continuation");

    const crossedAuthority = getFailure(claimEvaluationWork(
      getSuccess(createEmptyQuerySyncState(cursor({ namespaceId: "tenant-b" }))),
      { maximumQueryInspections: 1, continuation: partial.continuation },
    ));
    expect(crossedAuthority).toBeInstanceOf(QuerySyncNamespaceMismatchError);

    const forgedShapes = [
      { ...partial.continuation },
      {
        ...partial.continuation,
        lastInspectedQueryKey: null,
        wrapped: true,
      },
      {
        ...partial.continuation,
        lowestBlockedWork: {
          queryKey: descriptors[0]!.queryKey,
          generation: clean.queries[0]!.active!.generation,
          reason: "terminalEvaluatorRefusal",
          resetRequired: true,
        },
      },
    ] as unknown as readonly EvaluationWorkScanContinuation[];
    for (const continuation of forgedShapes) {
      const failure = getFailure(claimEvaluationWork(clean, {
        maximumQueryInspections: 1,
        continuation,
      }));
      expect(failure).toBeInstanceOf(InvalidEvaluationWorkContinuationError);
      expect(failure).toMatchObject({ reason: "notStateIssued" });
    }

    let blockedState = stateWithReadyProvisionals(descriptors);
    for (let index = 0; index < descriptors.length; index += 1) {
      const selected = requireClaimed(blockedState);
      const blocked = getSuccess(recordEvaluationAttemptOutcome(
        selected.state,
        selected.attempt,
        "terminalRefusal",
      ));
      if (blocked._tag !== "blocked") throw new Error("Expected block");
      blockedState = blocked.state;
    }
    blockedState = rebuild(blockedState, { fairnessAnchor: null });
    const blockedPartial = claim(blockedState, 1);
    if (blockedPartial._tag !== "continued") {
      throw new Error("Expected blocked continuation");
    }
    const retainedQueries = blockedState.queries.slice(1);
    const malformedCrossing = rebuild(blockedState, {
      queries: retainedQueries,
      fairnessAnchor: null,
    });
    const invalidCrossing = getFailure(claimEvaluationWork(
      malformedCrossing,
      {
        maximumQueryInspections: 1,
        continuation: blockedPartial.continuation,
      },
    ));
    expect(invalidCrossing).toBeInstanceOf(InvalidEvaluationWorkContinuationError);
  });

  it("exposes only progress and attempt identity, never lease authority", () => {
    const selected = requireClaimed(beginFor(emptyState(), descriptor()).state);
    const forbiddenFields = new Set([
      "ownerToken",
      "leaseExpiresAt",
      "expiresAt",
      "renewal",
      "reclaim",
    ]);
    for (const value of [selected.attempt, selected.continuation]) {
      expect(Object.isFrozen(value)).toBe(true);
      for (const key of Object.keys(value)) {
        expect(forbiddenFields.has(key)).toBe(false);
      }
    }
    expect(Object.keys(selected.attempt).sort()).toEqual([
      "descriptor",
      "expectedActiveGeneration",
      "generation",
      "namespaceId",
      "registrationCursor",
      "requestedDirtyThroughSequence",
      "sourceEpoch",
      "syncModelId",
    ]);
    expect(Object.keys(selected.continuation).sort()).toEqual([
      "lastInspectedQueryKey",
      "lowestBlockedWork",
      "namespaceId",
      "observedWorkRevision",
      "scanStartFairnessAnchor",
      "sourceEpoch",
      "syncModelId",
      "wrapped",
    ]);
    expect(Object.keys(selected.state.evaluationWork).sort()).toEqual([
      "fairnessAnchor",
      "revision",
    ]);
  });
});
