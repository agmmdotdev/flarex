import { Result } from "effect";
import { describe, expect, it } from "vitest";

import {
  applyAdmittedInvalidations,
  beginQueryEvaluation,
  buildQuerySyncState,
  capturePublicationAttemptInstant,
  captureQueryPublicationArtifact,
  claimPublication,
  completePublication,
  completeQueryEvaluation,
  createEmptyQuerySyncState,
  InvalidAcceptedPublicationEvidenceError,
  InvalidPublicationAttemptOutcomeReplayError,
  InvalidQueryCompletionReplayError,
  MAX_CANONICAL_DEPENDENCY_KEY_BYTES,
  MAX_COUNTED_CANONICAL_BYTES,
  MAX_INLINE_PUBLICATION_CONTENT_BYTES,
  MAX_PENDING_PUBLICATIONS,
  MAX_PUBLICATION_ATTEMPT_AGE_MILLISECONDS,
  MAX_RETAINED_PUBLICATION_CONTENT_BYTES,
  PUBLICATION_SETTLEMENT_LIFECYCLE_BYTES,
  QuerySyncNamespaceMismatchError,
  QuerySyncStateLimitError,
  recordPublicationAttemptOutcome,
} from "@flarex/query-sync/internal/kernel";
import type {
  AcceptedQueryPublicationEvidence,
  CompleteQueryEvaluationDecision,
  PendingQueryPublication,
  PublicationAttempt,
  PublicationAttemptInstant,
  QueryDescriptor,
  QueryEvaluationAttempt,
  QueryEvaluationEvidence,
  QueryPublicationArtifact,
  QueryState,
  QuerySyncState,
} from "@flarex/query-sync/internal/kernel";
import {
  makeAcceptedQueryPublicationEvidenceForTesting,
} from "@flarex/query-sync/testing/conformance";
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
  digest,
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
  readonly refresh: Parameters<typeof completeQueryEvaluation>[3];
  readonly publication: QueryPublicationArtifact;
  readonly decision: CompletedDecision;
}

function instant(value: number): PublicationAttemptInstant {
  return getSuccess(capturePublicationAttemptInstant(value));
}

function installChangedQuery(input: {
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
    resultSeed: input.resultSeed ?? 10_000 + input.keySeed,
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
    refresh,
    publication,
    decision,
  });
}

function completeNextGeneration(input: {
  readonly state: QuerySyncState;
  readonly descriptor: QueryDescriptor;
  readonly dependency: string;
  readonly sequence: bigint;
  readonly resultSeed: number;
  readonly content?: string;
  readonly publication?: QueryPublicationArtifact;
}): CompletedQueryFixture {
  const query = input.state.queries.find((candidate) => (
    candidate.descriptor.queryKey === input.descriptor.queryKey
  ));
  if (query?.active === null || query?.active === undefined) {
    throw new Error("Expected an active query before a rerun");
  }
  const invalidation = getSuccess(applyAdmittedInvalidations(
    input.state,
    batch({
      sequence: input.sequence,
      dependencies: [input.dependency],
    }),
  ));
  const begun = getSuccess(beginQueryEvaluation(
    invalidation.state,
    rerunEvaluationRequest({
      target: target({ descriptor: input.descriptor }),
      activeGeneration: query.active.generation,
      dirtyThroughSequence: invalidation.state.cursor.appliedThroughSequence,
    }),
  ));
  const attempt = getEvaluationAttempt(begun);
  const queryEvaluation = evaluation({
    descriptor: attempt.descriptor,
    generation: attempt.generation,
    snapshot: attempt.registrationCursor.appliedThroughSequence,
    resultSeed: input.resultSeed,
    dependencies: [input.dependency],
  });
  const refresh = getSuccess(deriveGenerationRefreshEvidence(
    queryEvaluation,
    begun.state.cursor,
    [],
    queryEvaluation.authorityWitness,
  ));
  const publication = input.publication
    ?? publicationArtifact(input.content ?? "next-generation");
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
    refresh,
    publication,
    decision,
  });
}

function accepted(
  attempt: PublicationAttempt,
): AcceptedQueryPublicationEvidence {
  return makeAcceptedQueryPublicationEvidenceForTesting({
    identity: attempt.publication.identity,
    resultDigest: attempt.publication.resultDigest,
  });
}

function claimed(
  state: QuerySyncState,
  now = 0,
): Extract<ReturnType<typeof getSuccess<
  ReturnType<typeof claimPublication> extends Result.Result<infer A, unknown>
    ? A
    : never,
  unknown
>>, { readonly _tag: "claimed" }> {
  const decision = getSuccess(claimPublication(state, instant(now)));
  if (decision._tag !== "claimed") {
    throw new Error(`Expected publication claim, received ${decision._tag}`);
  }
  return decision;
}

function mergeCompletedQueries(
  completions: readonly CompletedQueryFixture[],
): QuerySyncState {
  const queries: QueryState[] = [];
  const pending: PendingQueryPublication[] = [];
  for (const completion of completions) {
    const query = completion.decision.state.queries[0];
    const publication = completion.decision.state.publicationWork.pending[0];
    if (query === undefined || publication === undefined) {
      throw new Error("Expected a completed query with pending publication");
    }
    queries.push(query);
    pending.push(publication);
  }
  return getSuccess(buildTestQuerySyncState(cursor(), queries, pending));
}

function expectFailureTag(
  result: Result.Result<unknown, unknown>,
  expected: string,
): unknown {
  return Result.match(result, {
    onFailure: (failure) => {
      expect(failure).toMatchObject({ _tag: expected });
      return failure;
    },
    onSuccess: () => {
      throw new Error(`Expected ${expected}`);
    },
  });
}

function dependencyKeysForBytes(byteLength: number): readonly string[] {
  const keys: string[] = [];
  let remaining = byteLength;
  let seed = 1;
  while (remaining > 0) {
    const size = Math.min(remaining, MAX_CANONICAL_DEPENDENCY_KEY_BYTES);
    keys.push(canonicalBytes(size, seed));
    remaining -= size;
    seed += 1;
  }
  return keys;
}

let aggregateBase: readonly CompletedQueryFixture[] | undefined;

function getAggregateBase(): readonly CompletedQueryFixture[] {
  if (aggregateBase !== undefined) return aggregateBase;
  const maximumDependencies = dependencyKeysForBytes(
    4 * 1_024 * 1_024,
  );
  aggregateBase = Object.freeze(Array.from(
    { length: 7 },
    (_, index) => installChangedQuery({
      keySeed: 20_000 + index,
      dependencies: maximumDependencies,
      publication: publicationArtifact(""),
    }),
  ));
  return aggregateBase;
}

function aggregateStateAt(targetBytes: number): QuerySyncState {
  const base = getAggregateBase();
  const emptyFiller = installChangedQuery({
    keySeed: 21_000,
    dependencies: [],
    publication: publicationArtifact(""),
  });
  const emptyState = mergeCompletedQueries([...base, emptyFiller]);
  const adjustableBytes = targetBytes - emptyState.metrics.countedCanonicalBytes;
  const publicationBytes = adjustableBytes % 2;
  const dependencyBytes = (adjustableBytes - publicationBytes) / 2;
  if (
    adjustableBytes < 0
    || dependencyBytes > 4 * 1_024 * 1_024
  ) {
    throw new Error(`Cannot tune aggregate by ${adjustableBytes} bytes`);
  }
  const filler = installChangedQuery({
    keySeed: 21_000,
    dependencies: dependencyKeysForBytes(dependencyBytes),
    publication: getSuccess(captureQueryPublicationArtifact({
      content: canonicalBytes(publicationBytes),
    })),
  });
  const state = mergeCompletedQueries([...base, filler]);
  expect(state.metrics.countedCanonicalBytes).toBe(targetBytes);
  return state;
}

describe("durable publication attempt state", () => {
  it("claims the lowest canonical publication and serializes competing claims as exact replay", () => {
    const higher = installChangedQuery({ keySeed: 2 });
    const lower = installChangedQuery({ keySeed: 1 });
    const state = mergeCompletedQueries([higher, lower]);

    const first = claimed(state, 10);
    const second = getSuccess(claimPublication(first.state, instant(999)));

    expect(first.attempt.publication.identity.queryKey).toBe(
      descriptor({ keySeed: 1, identity: "query-1" }).queryKey,
    );
    expect(first.state.publicationWork.pending).toHaveLength(1);
    expect(second._tag).toBe("replayed");
    if (second._tag !== "replayed") return;
    expect(second.state).toBe(first.state);
    expect(second.attempt).toEqual(first.attempt);
    expect(second.attempt.firstAttemptAt).toBe(10);
    expect(second.attempt.lastAttemptAt).toBe(10);
  });

  it("advances known-not-appended to ready and unknown to uncertain without double advancement", () => {
    const initial = claimed(installChangedQuery({ keySeed: 3 }).decision.state, 100);
    const known = getSuccess(recordPublicationAttemptOutcome(
      initial.state,
      initial.attempt,
      "knownNotAppended",
      instant(110),
    ));
    expect(known).toMatchObject({
      _tag: "recorded",
      attemptOrdinal: 1,
      nextAttemptOrdinal: 2,
      nextDisposition: "ready",
    });
    const knownReplay = getSuccess(recordPublicationAttemptOutcome(
      known.state,
      initial.attempt,
      "knownNotAppended",
      instant(999),
    ));
    expect(knownReplay).toEqual({ ...known, state: known.state });
    expect(knownReplay.state).toBe(known.state);

    const secondClaim = getSuccess(claimPublication(known.state, instant(999)));
    expect(secondClaim._tag).toBe("replayed");
    if (secondClaim._tag !== "replayed") return;
    expect(secondClaim.attempt).toMatchObject({
      attemptOrdinal: 2,
      firstAttemptAt: 100,
      lastAttemptAt: 110,
    });
    const unknown = getSuccess(recordPublicationAttemptOutcome(
      secondClaim.state,
      secondClaim.attempt,
      "outcomeUnknown",
      instant(120),
    ));
    expect(unknown).toMatchObject({
      _tag: "recorded",
      attemptOrdinal: 2,
      nextAttemptOrdinal: 3,
      nextDisposition: "uncertain",
    });
    expect(unknown.state.publicationWork.inFlight?.disposition).toEqual({
      _tag: "uncertain",
    });
  });

  it("rejects forged attempt histories while admitting reachable ordinal and age states", () => {
    const pending = installChangedQuery({ keySeed: 3_001 }).decision.state;
    const first = claimed(pending, 0);
    const advanced = getSuccess(recordPublicationAttemptOutcome(
      first.state,
      first.attempt,
      "outcomeUnknown",
      instant(1),
    ));
    const ordinalTwo = advanced.state.publicationWork.inFlight;
    if (ordinalTwo === null) throw new Error("Expected ordinal-two work");

    expect(getSuccess(buildQuerySyncState({
      cursor: advanced.state.cursor,
      queries: advanced.state.queries,
      evaluationWork: advanced.state.evaluationWork,
      publicationWork: advanced.state.publicationWork,
    }))).toEqual(advanced.state);

    for (const disposition of [
      Object.freeze({ _tag: "ready" as const }),
      Object.freeze({ _tag: "uncertain" as const }),
    ]) {
      expect(() => buildQuerySyncState({
        cursor: advanced.state.cursor,
        queries: advanced.state.queries,
        evaluationWork: advanced.state.evaluationWork,
        publicationWork: {
          ...advanced.state.publicationWork,
          inFlight: { ...ordinalTwo, disposition },
          precedingAttemptOutcome: null,
        },
      })).toThrowError(QuerySyncInvariantDefect);
    }

    const ordinalOne = first.state.publicationWork.inFlight;
    if (ordinalOne === null) throw new Error("Expected ordinal-one work");
    expect(() => buildQuerySyncState({
      cursor: first.state.cursor,
      queries: first.state.queries,
      evaluationWork: first.state.evaluationWork,
      publicationWork: {
        ...first.state.publicationWork,
        inFlight: {
          ...ordinalOne,
          disposition: Object.freeze({
            _tag: "blocked" as const,
            reason: "attemptLimitReached" as const,
            resetRequired: true as const,
          }),
        },
      },
    })).toThrowError(QuerySyncInvariantDefect);

    const ageBlocked = getSuccess(claimPublication(
      first.state,
      instant(MAX_PUBLICATION_ATTEMPT_AGE_MILLISECONDS),
    ));
    expect(ageBlocked).toMatchObject({
      _tag: "blocked",
      attemptOrdinal: 1,
      reason: "ageLimitReached",
    });
    expect(getSuccess(buildQuerySyncState({
      cursor: ageBlocked.state.cursor,
      queries: ageBlocked.state.queries,
      evaluationWork: ageBlocked.state.evaluationWork,
      publicationWork: ageBlocked.state.publicationWork,
    }))).toEqual(ageBlocked.state);

    expect(() => buildQuerySyncState({
      cursor: advanced.state.cursor,
      queries: advanced.state.queries,
      evaluationWork: advanced.state.evaluationWork,
      publicationWork: {
        ...advanced.state.publicationWork,
        inFlight: null,
        latestDelivered: null,
      },
    })).toThrowError(QuerySyncInvariantDefect);
  });

  it("replays an outcome after response loss, delivery, and later exact recovery", () => {
    const initial = claimed(installChangedQuery({ keySeed: 4 }).decision.state, 1);
    const recorded = getSuccess(recordPublicationAttemptOutcome(
      initial.state,
      initial.attempt,
      "outcomeUnknown",
      instant(2),
    ));
    const current = recorded.state.publicationWork.inFlight;
    if (current === null) throw new Error("Expected retained in-flight work");
    const completed = getSuccess(completePublication(
      recorded.state,
      makeAcceptedQueryPublicationEvidenceForTesting({
        identity: current.publication.identity,
        resultDigest: current.publication.resultDigest,
      }),
    ));
    expect(completed._tag).toBe("completed");

    const replay = getSuccess(recordPublicationAttemptOutcome(
      completed.state,
      initial.attempt,
      "outcomeUnknown",
      instant(1_000),
    ));
    expect(replay).toMatchObject({
      _tag: "recorded",
      attemptOrdinal: 1,
      nextAttemptOrdinal: 2,
      nextDisposition: "uncertain",
    });
    expect(replay.state).toBe(completed.state);

    const crossedReplay = recordPublicationAttemptOutcome(
      completed.state,
      initial.attempt,
      "knownNotAppended",
      instant(1_000),
    );
    expect(expectFailureTag(
      crossedReplay,
      "InvalidPublicationAttemptOutcomeReplayError",
    )).toBeInstanceOf(InvalidPublicationAttemptOutcomeReplayError);
  });

  it("enforces terminal, ordinal, age, post-age, and clock-regression decisions at exact thresholds", () => {
    const seedState = installChangedQuery({ keySeed: 5 }).decision.state;
    const terminalClaim = claimed(seedState, 100);
    const terminal = getSuccess(recordPublicationAttemptOutcome(
      terminalClaim.state,
      terminalClaim.attempt,
      "terminalRefusal",
      instant(100),
    ));
    expect(terminal).toMatchObject({
      _tag: "blocked",
      attemptOrdinal: 1,
      reason: "terminalPublisherRefusal",
      resetRequired: true,
    });

    let ordinalClaim = claimed(seedState, 100);
    for (let ordinal = 1; ordinal < 128; ordinal += 1) {
      const recorded = getSuccess(recordPublicationAttemptOutcome(
        ordinalClaim.state,
        ordinalClaim.attempt,
        "knownNotAppended",
        instant(100),
      ));
      expect(recorded._tag).toBe("recorded");
      const replayed = getSuccess(claimPublication(recorded.state, instant(100)));
      if (replayed._tag !== "replayed") {
        throw new Error(`Expected ordinal replay, received ${replayed._tag}`);
      }
      ordinalClaim = {
        _tag: "claimed",
        state: replayed.state,
        attempt: replayed.attempt,
      };
    }
    expect(ordinalClaim.attempt.attemptOrdinal).toBe(128);
    const ordinalBlocked = getSuccess(recordPublicationAttemptOutcome(
      ordinalClaim.state,
      ordinalClaim.attempt,
      "knownNotAppended",
      instant(100),
    ));
    expect(ordinalBlocked).toMatchObject({
      _tag: "blocked",
      attemptOrdinal: 128,
      reason: "attemptLimitReached",
    });

    const ageClaim = claimed(seedState, 1_000);
    const beforeAge = getSuccess(claimPublication(
      ageClaim.state,
      instant(1_000 + MAX_PUBLICATION_ATTEMPT_AGE_MILLISECONDS - 1),
    ));
    expect(beforeAge._tag).toBe("replayed");
    const atAge = getSuccess(claimPublication(
      ageClaim.state,
      instant(1_000 + MAX_PUBLICATION_ATTEMPT_AGE_MILLISECONDS),
    ));
    expect(atAge).toMatchObject({ _tag: "blocked", reason: "ageLimitReached" });
    const postAgeOutcome = getSuccess(recordPublicationAttemptOutcome(
      atAge.state,
      ageClaim.attempt,
      "knownNotAppended",
      instant(1_000 + MAX_PUBLICATION_ATTEMPT_AGE_MILLISECONDS + 1),
    ));
    expect(postAgeOutcome).toMatchObject({
      _tag: "blocked",
      reason: "ageLimitReached",
    });
    expect(postAgeOutcome.state).toBe(atAge.state);

    const regressionClaim = claimed(seedState, 500);
    const regression = getSuccess(recordPublicationAttemptOutcome(
      regressionClaim.state,
      regressionClaim.attempt,
      "knownNotAppended",
      instant(100),
    ));
    expect(regression.state.publicationWork.inFlight).toMatchObject({
      firstAttemptAt: 500,
      lastAttemptAt: 500,
      attemptOrdinal: 2,
    });
  });

  it("keeps in-flight bytes immutable while retaining only the newest queued generation", () => {
    const dependency = canonicalText("queued-dependency");
    const first = installChangedQuery({
      keySeed: 6,
      resultSeed: 601,
      dependencies: [dependency],
      publication: publicationArtifact("generation-one"),
    });
    const firstClaim = claimed(first.decision.state, 10);
    const second = completeNextGeneration({
      state: firstClaim.state,
      descriptor: first.attempt.descriptor,
      dependency,
      sequence: 1n,
      resultSeed: 602,
      content: "generation-two",
    });
    const third = completeNextGeneration({
      state: second.decision.state,
      descriptor: first.attempt.descriptor,
      dependency,
      sequence: 2n,
      resultSeed: 603,
      content: "generation-three",
    });

    expect(third.decision.state.publicationWork.inFlight?.publication).toEqual(
      firstClaim.attempt.publication,
    );
    expect(third.decision.state.publicationWork.pending).toHaveLength(1);
    expect(third.decision.state.publicationWork.pending[0]).toMatchObject({
      identity: { generation: 3n },
      content: publicationArtifact("generation-three").content,
    });
    expect(third.decision.state.metrics.settlementEnvelopeBytes).toBe(
      firstClaim.state.metrics.settlementEnvelopeBytes,
    );
  });

  it("completes exact ready, uncertain, and blocked work and replays only the latest delivery", () => {
    const seedState = installChangedQuery({ keySeed: 7 }).decision.state;
    const ready = claimed(seedState, 0);
    const readyCompleted = getSuccess(completePublication(
      ready.state,
      accepted(ready.attempt),
    ));
    expect(readyCompleted._tag).toBe("completed");
    expect(getSuccess(completePublication(
      readyCompleted.state,
      accepted(ready.attempt),
    ))._tag).toBe("replayed");

    const uncertainClaim = claimed(seedState, 0);
    const uncertainOutcome = getSuccess(recordPublicationAttemptOutcome(
      uncertainClaim.state,
      uncertainClaim.attempt,
      "outcomeUnknown",
      instant(1),
    ));
    const uncertainCurrent = uncertainOutcome.state.publicationWork.inFlight;
    if (uncertainCurrent === null) throw new Error("Expected uncertain work");
    const uncertainCompleted = getSuccess(completePublication(
      uncertainOutcome.state,
      makeAcceptedQueryPublicationEvidenceForTesting({
        identity: uncertainCurrent.publication.identity,
        resultDigest: uncertainCurrent.publication.resultDigest,
      }),
    ));
    expect(uncertainCompleted._tag).toBe("completed");

    const blockedClaim = claimed(seedState, 0);
    const blocked = getSuccess(recordPublicationAttemptOutcome(
      blockedClaim.state,
      blockedClaim.attempt,
      "terminalRefusal",
      instant(0),
    ));
    expect(blocked._tag).toBe("blocked");
    expect(getSuccess(completePublication(
      blocked.state,
      accepted(blockedClaim.attempt),
    ))._tag).toBe("completed");
  });

  it("rejects stale, crossed, wrong-digest, structural, and decoded acceptance evidence", () => {
    const first = installChangedQuery({ keySeed: 8 });
    const second = installChangedQuery({ keySeed: 9 });
    const state = mergeCompletedQueries([first, second]);
    const current = claimed(state, 0);
    const other = current.state.publicationWork.pending[0];
    if (other === undefined) throw new Error("Expected another publication");

    const stale = makeAcceptedQueryPublicationEvidenceForTesting({
      identity: other.identity,
      resultDigest: other.resultDigest,
    });
    expect(getSuccess(completePublication(current.state, stale))._tag).toBe(
      "superseded",
    );

    const wrongDigest = makeAcceptedQueryPublicationEvidenceForTesting({
      identity: current.attempt.publication.identity,
      resultDigest: digest(90_001),
    });
    expect(expectFailureTag(
      completePublication(current.state, wrongDigest),
      "InvalidAcceptedPublicationEvidenceError",
    )).toBeInstanceOf(InvalidAcceptedPublicationEvidenceError);

    const crossedCursor = cursor({ namespaceId: "tenant-crossed" });
    const crossed = makeAcceptedQueryPublicationEvidenceForTesting({
      identity: {
        ...current.attempt.publication.identity,
        namespaceId: crossedCursor.namespaceId,
      },
      resultDigest: current.attempt.publication.resultDigest,
    });
    expect(expectFailureTag(
      completePublication(current.state, crossed),
      "QuerySyncNamespaceMismatchError",
    )).toBeInstanceOf(QuerySyncNamespaceMismatchError);

    const structural: AcceptedQueryPublicationEvidence = Object.assign(
      Object.create(null),
      {
      identity: current.attempt.publication.identity,
      resultDigest: current.attempt.publication.resultDigest,
      },
    );
    const decoded: AcceptedQueryPublicationEvidence = Object.assign(
      Object.create(null),
      {
        identity: Object.freeze({ ...structural.identity }),
        resultDigest: structural.resultDigest,
      },
    );
    for (const forgery of [structural, decoded]) {
      const failure = expectFailureTag(
        completePublication(current.state, forgery),
        "InvalidAcceptedPublicationEvidenceError",
      );
      expect(failure).toMatchObject({ reason: "notStateIssued" });
    }
  });

  it("keeps completion replay content-sensitive while bytes are retained and digest-only after delivery", () => {
    const completed = installChangedQuery({
      keySeed: 10,
      publication: publicationArtifact("original-content"),
    });
    const altered = publicationArtifact("altered-valid-content");
    const replay = (state: QuerySyncState, publication: QueryPublicationArtifact) => (
      completeQueryEvaluation(
        state,
        completed.attempt,
        completed.evaluation,
        completed.refresh,
        publication,
      )
    );

    const pendingMismatch = replay(completed.decision.state, altered);
    expect(expectFailureTag(
      pendingMismatch,
      "InvalidQueryCompletionReplayError",
    )).toBeInstanceOf(InvalidQueryCompletionReplayError);
    if (Result.isFailure(pendingMismatch)) {
      expect(pendingMismatch.failure).toMatchObject({
        reason: "publicationContentMismatch",
      });
    }

    const inFlight = claimed(completed.decision.state, 0);
    expect(Result.isFailure(replay(inFlight.state, altered))).toBe(true);
    const delivered = getSuccess(completePublication(
      inFlight.state,
      accepted(inFlight.attempt),
    ));
    const deliveredReplay = getSuccess(replay(delivered.state, altered));
    expect(deliveredReplay._tag).toBe("replayed");
    expect(deliveredReplay.state).toBe(delivered.state);
    expect(deliveredReplay.state.publicationWork.pending).toHaveLength(0);
    expect(deliveredReplay.state.publicationWork.inFlight).toBeNull();
  });

  it("retains exactly one latest-delivered and one preceding-outcome recovery window", () => {
    const first = installChangedQuery({ keySeed: 11 });
    const second = installChangedQuery({ keySeed: 12 });
    const state = mergeCompletedQueries([first, second]);
    const firstClaim = claimed(state, 0);
    const firstOutcome = getSuccess(recordPublicationAttemptOutcome(
      firstClaim.state,
      firstClaim.attempt,
      "knownNotAppended",
      instant(1),
    ));
    const firstDelivered = getSuccess(completePublication(
      firstOutcome.state,
      accepted(firstClaim.attempt),
    ));
    expect(getSuccess(recordPublicationAttemptOutcome(
      firstDelivered.state,
      firstClaim.attempt,
      "knownNotAppended",
      instant(2),
    ))._tag).toBe("recorded");

    const secondClaim = claimed(firstDelivered.state, 3);
    const secondOutcome = getSuccess(recordPublicationAttemptOutcome(
      secondClaim.state,
      secondClaim.attempt,
      "outcomeUnknown",
      instant(4),
    ));
    expect(getSuccess(recordPublicationAttemptOutcome(
      secondOutcome.state,
      firstClaim.attempt,
      "knownNotAppended",
      instant(5),
    ))._tag).toBe("recoveryEvidenceExpired");

    const secondDelivered = getSuccess(completePublication(
      secondOutcome.state,
      accepted(secondClaim.attempt),
    ));
    expect(getSuccess(completePublication(
      secondDelivered.state,
      accepted(firstClaim.attempt),
    ))._tag).toBe("superseded");
    expect(getSuccess(completePublication(
      secondDelivered.state,
      accepted(secondClaim.attempt),
    ))._tag).toBe("replayed");
  });

  it("admits exact pending-count and retained-content maxima and rejects the first byte or member above", () => {
    const countCompletions = Array.from(
      { length: MAX_PENDING_PUBLICATIONS },
      (_, index) => installChangedQuery({
        keySeed: 30_000 + index,
        publication: publicationArtifact(""),
      }),
    );
    const countState = mergeCompletedQueries(countCompletions);
    expect(countState.metrics.pendingPublicationCount).toBe(
      MAX_PENDING_PUBLICATIONS,
    );
    const onePending = countState.publicationWork.pending[0];
    if (onePending === undefined) throw new Error("Expected pending work");
    const countOverflow = buildQuerySyncState({
      cursor: countState.cursor,
      queries: countState.queries,
      evaluationWork: countState.evaluationWork,
      publicationWork: {
        ...countState.publicationWork,
        pending: [...countState.publicationWork.pending, onePending],
      },
    });
    const countFailure = expectFailureTag(
      countOverflow,
      "QuerySyncStateLimitError",
    );
    expect(countFailure).toMatchObject({
      dimension: "pendingPublicationCount",
      maximum: MAX_PENDING_PUBLICATIONS,
      observed: MAX_PENDING_PUBLICATIONS + 1,
    });

    const fullArtifact = getSuccess(captureQueryPublicationArtifact({
      content: canonicalBytes(MAX_INLINE_PUBLICATION_CONTENT_BYTES),
    }));
    const contentCompletions = Array.from(
      {
        length: MAX_RETAINED_PUBLICATION_CONTENT_BYTES
          / MAX_INLINE_PUBLICATION_CONTENT_BYTES,
      },
      (_, index) => installChangedQuery({
        keySeed: 40_000 + index,
        publication: fullArtifact,
      }),
    );
    const contentState = mergeCompletedQueries(contentCompletions);
    expect(contentState.metrics.retainedPublicationContentBytes).toBe(
      MAX_RETAINED_PUBLICATION_CONTENT_BYTES,
    );
    const queuedDependency = canonicalText("content-overflow-dependency");
    const queuedFirst = installChangedQuery({
      keySeed: 50_000,
      dependencies: [queuedDependency],
      publication: fullArtifact,
    });
    const queuedClaim = claimed(queuedFirst.decision.state, 0);
    const queuedSecond = completeNextGeneration({
      state: queuedClaim.state,
      descriptor: queuedFirst.attempt.descriptor,
      dependency: queuedDependency,
      sequence: 1n,
      resultSeed: 50_002,
      publication: fullArtifact,
    });
    const queuedQuery = queuedSecond.decision.state.queries[0];
    const queuedPending = queuedSecond.decision.state.publicationWork.pending[0];
    const queuedInFlight = queuedSecond.decision.state.publicationWork.inFlight;
    if (
      queuedQuery === undefined
      || queuedPending === undefined
      || queuedInFlight === null
    ) {
      throw new Error("Expected queued and in-flight content work");
    }
    const oneByte = installChangedQuery({
      keySeed: 50_001,
      publication: getSuccess(captureQueryPublicationArtifact({
        content: canonicalBytes(1),
      })),
    });
    const oneByteQuery = oneByte.decision.state.queries[0];
    const oneBytePending = oneByte.decision.state.publicationWork.pending[0];
    if (oneByteQuery === undefined || oneBytePending === undefined) {
      throw new Error("Expected one-byte pending content");
    }
    const contentOverflow = buildQuerySyncState({
      cursor: queuedSecond.decision.state.cursor,
      queries: [
        queuedQuery,
        ...contentCompletions.slice(0, 30).map((completion) => {
          const query = completion.decision.state.queries[0];
          if (query === undefined) throw new Error("Expected content query");
          return query;
        }),
        oneByteQuery,
      ],
      evaluationWork: queuedSecond.decision.state.evaluationWork,
      publicationWork: {
        pending: [
          queuedPending,
          ...contentCompletions.slice(0, 30).map((completion) => {
            const pending = completion.decision.state.publicationWork.pending[0];
            if (pending === undefined) throw new Error("Expected content work");
            return pending;
          }),
          oneBytePending,
        ],
        inFlight: queuedInFlight,
        latestDelivered: null,
        precedingAttemptOutcome: null,
      },
    });
    const contentFailure = expectFailureTag(
      contentOverflow,
      "QuerySyncStateLimitError",
    );
    expect(contentFailure).toMatchObject({
      dimension: "retainedPublicationContentBytes",
      maximum: MAX_RETAINED_PUBLICATION_CONTENT_BYTES,
      observed: MAX_RETAINED_PUBLICATION_CONTENT_BYTES + 1,
    });
  });

  it("refuses a claim before exposure when settlement space is absent and admits the exact envelope boundary", () => {
    const full = aggregateStateAt(MAX_COUNTED_CANONICAL_BYTES);
    const refusal = claimPublication(full, instant(0));
    const failure = expectFailureTag(refusal, "QuerySyncStateLimitError");
    expect(failure).toBeInstanceOf(QuerySyncStateLimitError);
    expect(failure).toMatchObject({
      dimension: "countedCanonicalBytes",
      maximum: MAX_COUNTED_CANONICAL_BYTES,
      observed: MAX_COUNTED_CANONICAL_BYTES
        + PUBLICATION_SETTLEMENT_LIFECYCLE_BYTES,
    });
    expect(full.publicationWork.inFlight).toBeNull();

    const exact = aggregateStateAt(
      MAX_COUNTED_CANONICAL_BYTES - PUBLICATION_SETTLEMENT_LIFECYCLE_BYTES,
    );
    const exactClaim = claimed(exact, 0);
    expect(exactClaim.state.metrics.countedCanonicalBytes).toBe(
      MAX_COUNTED_CANONICAL_BYTES,
    );
    expect(exactClaim.state.metrics.settlementEnvelopeBytes).toBeGreaterThan(0);
  });

  it("makes every settlement path capacity-infallible after an exact-boundary attempt is issued", () => {
    const exact = aggregateStateAt(
      MAX_COUNTED_CANONICAL_BYTES - PUBLICATION_SETTLEMENT_LIFECYCLE_BYTES,
    );
    const first = claimed(exact, 0);
    expect(first.state.metrics.countedCanonicalBytes).toBe(
      MAX_COUNTED_CANONICAL_BYTES,
    );

    for (const outcome of ["knownNotAppended", "outcomeUnknown"] as const) {
      const settled = getSuccess(recordPublicationAttemptOutcome(
        first.state,
        first.attempt,
        outcome,
        instant(1),
      ));
      expect(settled._tag).toBe("recorded");
      expect(settled.state.metrics.countedCanonicalBytes).toBe(
        MAX_COUNTED_CANONICAL_BYTES,
      );
    }

    const terminal = getSuccess(recordPublicationAttemptOutcome(
      first.state,
      first.attempt,
      "terminalRefusal",
      instant(1),
    ));
    expect(terminal).toMatchObject({
      _tag: "blocked",
      reason: "terminalPublisherRefusal",
    });
    expect(terminal.state.metrics.countedCanonicalBytes).toBe(
      MAX_COUNTED_CANONICAL_BYTES,
    );

    const aged = getSuccess(claimPublication(
      first.state,
      instant(MAX_PUBLICATION_ATTEMPT_AGE_MILLISECONDS),
    ));
    expect(aged).toMatchObject({ _tag: "blocked", reason: "ageLimitReached" });
    expect(aged.state.metrics.countedCanonicalBytes).toBe(
      MAX_COUNTED_CANONICAL_BYTES,
    );

    let ordinalState = first.state;
    let ordinalAttempt = first.attempt;
    for (let ordinal = 1; ordinal <= 128; ordinal += 1) {
      const decision = getSuccess(recordPublicationAttemptOutcome(
        ordinalState,
        ordinalAttempt,
        "knownNotAppended",
        instant(0),
      ));
      if (ordinal === 128) {
        expect(decision).toMatchObject({
          _tag: "blocked",
          reason: "attemptLimitReached",
        });
        expect(decision.state.metrics.countedCanonicalBytes).toBe(
          MAX_COUNTED_CANONICAL_BYTES,
        );
        break;
      }
      const replayed = getSuccess(claimPublication(decision.state, instant(0)));
      if (replayed._tag !== "replayed") {
        throw new Error(`Expected next attempt, received ${replayed._tag}`);
      }
      ordinalState = replayed.state;
      ordinalAttempt = replayed.attempt;
    }

    const delivered = getSuccess(completePublication(
      first.state,
      accepted(first.attempt),
    ));
    expect(delivered._tag).toBe("completed");
    expect(delivered.state.metrics.countedCanonicalBytes).toBeLessThanOrEqual(
      MAX_COUNTED_CANONICAL_BYTES,
    );
  });
});
