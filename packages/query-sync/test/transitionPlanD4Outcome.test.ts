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
  planRecordPublicationAttemptOutcome,
  resumeClaimPublicationPending,
  startClaimPublication,
} from "@flarex/query-sync/internal/transition-plan";
import type {
  PublicationAttempt,
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
    publicationArtifact("d4-outcome"),
  ));
  if (completed._tag !== "completed") throw new Error("Expected completion");
  return completed.state;
}

function claimedFixture() {
  const state = stateWithPendingPublication();
  const publication = state.publicationWork.pending[0];
  const query = state.queries[0];
  if (publication === undefined || query === undefined) {
    throw new Error("Expected pending publication");
  }
  const started = getSuccess(startClaimPublication({
    scope: scopeFacts(state),
    lifecycle: state.publicationWork,
    capturedNow: instant(0),
  }));
  if (started.stage !== "pending") {
    throw new Error("Expected pending read");
  }
  const claimed = getSuccess(resumeClaimPublicationPending(started.resume, {
    publication,
    owner: ownerFacts(query),
  }));
  if (claimed._tag !== "write" || claimed.receipt._tag !== "claimed") {
    throw new Error("Expected claimed publication");
  }
  return Object.freeze({
    state,
    query,
    owner: ownerFacts(query),
    scope: claimed.nextScope,
    lifecycle: Object.freeze({
      ...state.publicationWork,
      inFlight: claimed.change.inFlight,
    }) satisfies PublicationLifecycleFacts,
    attempt: claimed.receipt.attempt,
  });
}

describe("QSYNC01-D4 publication-attempt outcome transition plans", () => {
  it("authenticates before any attempt field read", () => {
    const empty = getSuccess(createEmptyQuerySyncState(cursor()));
    let reads = 0;
    const rawForgery = new Proxy({}, {
      get: () => {
        reads += 1;
        throw new Error("Unauthenticated attempt field read");
      },
    });
    // SAFETY: The forged nominal value is intentional adversarial test input;
    // the planner must reject it before dispatching any proxy field access.
    const forgery = rawForgery as PublicationAttempt;
    expect(getFailure(planRecordPublicationAttemptOutcome({
      scope: scopeFacts(empty),
      lifecycle: empty.publicationWork,
      owner: null,
      attempt: forgery,
      outcome: "knownNotAppended",
      capturedNow: instant(0),
    }))).toMatchObject({
      _tag: "InvalidPublicationAttemptError",
      reason: "notStateIssued",
      queryKey: "",
      generation: 0n,
      ordinal: 0,
    });
    expect(reads).toBe(0);
  });

  it("advances once and replays the retained outcome without another write", () => {
    const fixture = claimedFixture();
    const recorded = getSuccess(planRecordPublicationAttemptOutcome({
      scope: fixture.scope,
      lifecycle: fixture.lifecycle,
      owner: fixture.owner,
      attempt: fixture.attempt,
      outcome: "outcomeUnknown",
      capturedNow: instant(5),
    }));
    expect(recorded).toMatchObject({
      _tag: "write",
      receipt: {
        _tag: "recorded",
        attemptOrdinal: 1,
        nextAttemptOrdinal: 2,
        nextDisposition: "uncertain",
      },
      change: {
        _tag: "replacePublicationAttemptLifecycle",
        inFlight: {
          attemptOrdinal: 2,
          lastAttemptAt: 5,
          disposition: { _tag: "uncertain" },
        },
        precedingAttemptOutcome: {
          attemptOrdinal: 1,
          outcome: "outcomeUnknown",
        },
      },
    });
    if (recorded._tag !== "write") throw new Error("Expected outcome write");
    const nextLifecycle: PublicationLifecycleFacts = {
      ...fixture.lifecycle,
      inFlight: recorded.change.inFlight,
      precedingAttemptOutcome: recorded.change.precedingAttemptOutcome,
    };
    const replay = getSuccess(planRecordPublicationAttemptOutcome({
      scope: recorded.nextScope,
      lifecycle: nextLifecycle,
      owner: fixture.owner,
      attempt: fixture.attempt,
      outcome: "outcomeUnknown",
      capturedNow: instant(999),
    }));
    expect(replay).toEqual({
      _tag: "noWrite",
      receipt: recorded.receipt,
    });
    expect(Object.isFrozen(recorded.change.precedingAttemptOutcome)).toBe(true);
  });

  it("preserves terminal refusal precedence and stale authentic recovery", () => {
    const fixture = claimedFixture();
    const blocked = getSuccess(planRecordPublicationAttemptOutcome({
      scope: fixture.scope,
      lifecycle: fixture.lifecycle,
      owner: fixture.owner,
      attempt: fixture.attempt,
      outcome: "terminalRefusal",
      capturedNow: instant(999),
    }));
    expect(blocked).toMatchObject({
      _tag: "write",
      receipt: {
        _tag: "blocked",
        reason: "terminalPublisherRefusal",
      },
    });

    const empty = getSuccess(createEmptyQuerySyncState(cursor()));
    const stale = getSuccess(planRecordPublicationAttemptOutcome({
      scope: scopeFacts(empty),
      lifecycle: empty.publicationWork,
      owner: null,
      attempt: fixture.attempt,
      outcome: "knownNotAppended",
      capturedNow: instant(0),
    }));
    expect(stale).toMatchObject({
      _tag: "noWrite",
      receipt: {
        _tag: "recoveryEvidenceExpired",
        attemptOrdinal: 1,
      },
    });
  });
});
