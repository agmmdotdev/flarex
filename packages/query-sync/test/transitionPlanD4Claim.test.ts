import { Result } from "effect";
import { describe, expect, it } from "vitest";

import {
  beginQueryEvaluation,
  capturePublicationAttemptInstant,
  completeQueryEvaluation,
  createEmptyQuerySyncState,
} from "@flarex/query-sync/internal/kernel";
import type {
  QueryState,
  QuerySyncState,
} from "@flarex/query-sync/internal/kernel";
import {
  MAX_PUBLICATION_ATTEMPT_AGE_MILLISECONDS,
  QuerySyncTransitionResumeDefect,
  resumeClaimPublicationInFlightOwner,
  resumeClaimPublicationPending,
  startClaimPublication,
} from "@flarex/query-sync/internal/transition-plan";
import type {
  ClaimPublicationInFlightOwnerResume,
  PublicationLifecycleFacts,
  PublicationOwnerQueryFacts,
} from "@flarex/query-sync/internal/transition-plan";
import {
  deriveGenerationRefreshEvidence,
} from "@flarex/query-sync/testing/reference-model";

import {
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
  return Result.match(result, {
    onFailure: (failure) => failure,
    onSuccess: () => {
      throw new Error("Expected a failed Result");
    },
  });
}

function instant(value: number) {
  return getSuccess(capturePublicationAttemptInstant(value));
}

function scopeFacts(state: QuerySyncState) {
  return {
    cursor: state.cursor,
    evaluationWork: state.evaluationWork,
    metrics: state.metrics,
  };
}

function lifecycleFacts(state: QuerySyncState): PublicationLifecycleFacts {
  return state.publicationWork;
}

function ownerFacts(query: QueryState): PublicationOwnerQueryFacts {
  return {
    descriptor: query.descriptor,
    active: query.active === null
      ? null
      : {
        generation: query.active.generation,
        freshThroughSequence: query.active.freshThroughSequence,
        resultDigest: query.active.resultDigest,
      },
    currentCompletion: query.currentCompletion === null
      ? null
      : {
        identity: query.currentCompletion.identity,
        refreshedThroughSequence:
          query.currentCompletion.refreshedThroughSequence,
        resultDigest: query.currentCompletion.resultDigest,
        publicationDisposition:
          query.currentCompletion.publicationDisposition,
      },
  };
}

function stateWithPendingPublication(): QuerySyncState {
  const empty = getSuccess(createEmptyQuerySyncState(cursor()));
  const begun = getSuccess(beginQueryEvaluation(
    empty,
    firstEvaluationRequest(target({ descriptor: descriptor() })),
  ));
  const attempt = getEvaluationAttempt(begun);
  const evidence = evaluation({
    descriptor: attempt.descriptor,
    generation: attempt.generation,
    snapshot: begun.state.cursor.appliedThroughSequence,
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
    publicationArtifact("d4-claim"),
  ));
  if (completed._tag !== "completed") {
    throw new Error("Expected a pending publication fixture");
  }
  return completed.state;
}

describe("QSYNC01-D4 claim-publication transition plans", () => {
  it("stages the lowest pending read and atomically plans pending-to-in-flight", () => {
    const state = stateWithPendingPublication();
    const publication = state.publicationWork.pending[0];
    const query = state.queries[0];
    if (publication === undefined || query === undefined) {
      throw new Error("Expected publication owner fixture");
    }
    const started = getSuccess(startClaimPublication({
      scope: scopeFacts(state),
      lifecycle: lifecycleFacts(state),
      capturedNow: instant(10),
    }));
    expect(started.intent).toEqual({
      _tag: "readLowestPendingPublicationFacts",
    });
    if (started.stage !== "pending") throw new Error("Expected pending read");
    const plan = getSuccess(resumeClaimPublicationPending(started.resume, {
      publication,
      owner: ownerFacts(query),
    }));
    expect(plan).toMatchObject({
      _tag: "write",
      receipt: {
        _tag: "claimed",
        attempt: {
          publication,
          attemptOrdinal: 1,
          firstAttemptAt: 10,
          lastAttemptAt: 10,
        },
      },
      nextScope: {
        metrics: {
          pendingPublicationCount: 0,
          inFlightPublicationCount: 1,
        },
      },
      change: {
        _tag: "claimPendingPublication",
        publication,
        inFlight: {
          publication,
          attemptOrdinal: 1,
          disposition: { _tag: "ready" },
        },
      },
    });
    if (plan._tag !== "write" || plan.receipt._tag !== "claimed") {
      throw new Error("Expected a fresh publication claim");
    }
    expect(plan.nextScope.metrics.settlementEnvelopeBytes).toBeGreaterThan(0);
    expect(Object.keys(plan.receipt)).toEqual(["_tag", "attempt"]);
    expect(Object.isFrozen(plan.receipt.attempt)).toBe(true);
    expect(Object.isFrozen(plan.change)).toBe(true);
    expect(Object.isFrozen(plan.expected)).toBe(true);
  });

  it("replays with a fresh nominal attempt and applies the inclusive age block", () => {
    const state = stateWithPendingPublication();
    const query = state.queries[0];
    const publication = state.publicationWork.pending[0];
    if (query === undefined || publication === undefined) {
      throw new Error("Expected publication fixture");
    }
    const freshStart = getSuccess(startClaimPublication({
      scope: scopeFacts(state),
      lifecycle: lifecycleFacts(state),
      capturedNow: instant(0),
    }));
    if (freshStart.stage !== "pending") throw new Error("Expected pending read");
    const fresh = getSuccess(resumeClaimPublicationPending(
      freshStart.resume,
      { publication, owner: ownerFacts(query) },
    ));
    if (fresh._tag !== "write" || fresh.receipt._tag !== "claimed") {
      throw new Error("Expected fresh claim fixture");
    }
    const lifecycle: PublicationLifecycleFacts = {
      ...state.publicationWork,
      inFlight: fresh.change.inFlight,
    };

    const replayStart = getSuccess(startClaimPublication({
      scope: fresh.nextScope,
      lifecycle,
      capturedNow: instant(MAX_PUBLICATION_ATTEMPT_AGE_MILLISECONDS - 1),
    }));
    expect(replayStart.intent._tag).toBe(
      "readClaimPublicationInFlightOwnerFacts",
    );
    if (replayStart.stage !== "inFlightOwner") {
      throw new Error("Expected in-flight owner read");
    }
    const replay = getSuccess(resumeClaimPublicationInFlightOwner(
      replayStart.resume,
      ownerFacts(query),
    ));
    if (replay.receipt._tag !== "replayed") {
      throw new Error("Expected exact in-flight replay");
    }
    expect(replay.receipt.attempt).not.toBe(fresh.receipt.attempt);
    expect(replay.receipt.attempt).toEqual(fresh.receipt.attempt);

    const blockStart = getSuccess(startClaimPublication({
      scope: fresh.nextScope,
      lifecycle,
      capturedNow: instant(MAX_PUBLICATION_ATTEMPT_AGE_MILLISECONDS),
    }));
    if (blockStart.stage !== "inFlightOwner") {
      throw new Error("Expected in-flight owner read");
    }
    const blocked = getSuccess(resumeClaimPublicationInFlightOwner(
      blockStart.resume,
      ownerFacts(query),
    ));
    expect(blocked).toMatchObject({
      _tag: "write",
      receipt: { _tag: "blocked", reason: "ageLimitReached" },
      change: {
        _tag: "blockInFlightPublicationByAge",
        inFlight: {
          attemptOrdinal: 1,
          disposition: { _tag: "blocked", reason: "ageLimitReached" },
        },
      },
    });
  });

  it("checks pending-count coherence and rejects crossed stage resumes", () => {
    const state = stateWithPendingPublication();
    const started = getSuccess(startClaimPublication({
      scope: scopeFacts(state),
      lifecycle: lifecycleFacts(state),
      capturedNow: instant(0),
    }));
    if (started.stage !== "pending") throw new Error("Expected pending read");
    expect(getFailure(resumeClaimPublicationPending(
      started.resume,
      null,
    ))).toMatchObject({
      _tag: "QuerySyncTransitionFactError",
      reason: "publicationSelectionFactsInvalid",
    });
    const crossedResume: object = started.resume;
    // SAFETY: This deliberately violates the nominal stage type to prove that
    // the private WeakMap rejects a genuine resume issued for another stage.
    const inFlightResume = crossedResume as ClaimPublicationInFlightOwnerResume;
    expect(() => resumeClaimPublicationInFlightOwner(
      inFlightResume,
      null,
    )).toThrowError(QuerySyncTransitionResumeDefect);

    const empty = getSuccess(createEmptyQuerySyncState(cursor()));
    const emptyStart = getSuccess(startClaimPublication({
      scope: scopeFacts(empty),
      lifecycle: lifecycleFacts(empty),
      capturedNow: instant(0),
    }));
    if (emptyStart.stage !== "pending") throw new Error("Expected pending read");
    const none = getSuccess(resumeClaimPublicationPending(
      emptyStart.resume,
      null,
    ));
    expect(none).toEqual({ _tag: "noWrite", receipt: { _tag: "none" } });
  });
});
