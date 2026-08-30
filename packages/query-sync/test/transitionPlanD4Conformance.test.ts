import { describe, expect, it } from "vitest";

import {
  beginQueryEvaluation,
  capturePublicationAttemptInstant,
  claimPublication,
  completeQueryEvaluation,
  completePublication,
  createEmptyQuerySyncState,
  MAX_PUBLICATION_ATTEMPT_AGE_MILLISECONDS,
  recordPublicationAttemptOutcome,
} from "@flarex/query-sync/internal/kernel";
import type {
  AcceptedQueryPublicationEvidence,
  PublicationAttempt,
  PublicationAttemptInstant,
  PublicationAttemptOutcome,
  QueryDescriptor,
  QuerySyncState,
} from "@flarex/query-sync/internal/kernel";
import {
  makeAcceptedQueryPublicationEvidenceForTesting,
} from "@flarex/query-sync/testing/conformance";
import {
  deriveGenerationRefreshEvidence,
} from "@flarex/query-sync/testing/reference-model";

import {
  applyClaimPublicationTransition,
  applyCompletePublicationTransition,
  applyRecordPublicationAttemptOutcomeTransition,
} from "../src/kernel/TransitionPlanAggregate.js";
import {
  executeNormalizedClaimPublication,
  executeNormalizedCompletePublication,
  executeNormalizedRecordPublicationAttemptOutcome,
  normalizeQuerySyncState,
} from "../src/testing/conformance/NormalizedTransitionPlan.js";
import {
  cursor,
  descriptor,
  evaluation,
  firstEvaluationRequest,
  getSuccess,
  publicationArtifact,
  target,
} from "./fixtures.js";

function emptyState(): QuerySyncState {
  return getSuccess(createEmptyQuerySyncState(cursor()));
}

function stateWithPendingPublication(
  queryDescriptor = descriptor(),
  label = "d4-conformance",
): QuerySyncState {
  const begun = getSuccess(beginQueryEvaluation(
    emptyState(),
    firstEvaluationRequest(target({ descriptor: queryDescriptor })),
  ));
  if (begun._tag !== "created") {
    throw new Error("Expected an initial query evaluation.");
  }
  const queryEvaluation = evaluation({
    descriptor: begun.attempt.descriptor,
    generation: begun.attempt.generation,
    snapshot: begun.attempt.registrationCursor.appliedThroughSequence,
  });
  const refresh = getSuccess(deriveGenerationRefreshEvidence(
    queryEvaluation,
    begun.attempt.registrationCursor,
    [],
    queryEvaluation.authorityWitness,
  ));
  const completed = getSuccess(completeQueryEvaluation(
    begun.state,
    begun.attempt,
    queryEvaluation,
    refresh,
    publicationArtifact(label),
  ));
  if (completed._tag !== "completed") {
    throw new Error("Expected a pending publication.");
  }
  return completed.state;
}

function acceptanceFor(
  attempt: PublicationAttempt,
): AcceptedQueryPublicationEvidence {
  return makeAcceptedQueryPublicationEvidenceForTesting({
    identity: attempt.publication.identity,
    resultDigest: attempt.publication.resultDigest,
  });
}

function expectClaimConformance(
  state: QuerySyncState,
  capturedNow: PublicationAttemptInstant,
) {
  const aggregate = getSuccess(applyClaimPublicationTransition(
    state,
    capturedNow,
  ));
  const normalized = getSuccess(executeNormalizedClaimPublication(
    normalizeQuerySyncState(state),
    capturedNow,
  ));
  const facade = getSuccess(claimPublication(state, capturedNow));

  expect(normalized.plan).toEqual(aggregate.plan);
  expect(normalized.receipt).toEqual(aggregate.plan.receipt);
  expect(normalized.receipt).toBe(normalized.plan.receipt);
  expect(normalized.disposition).toBe(aggregate.disposition);
  expect(normalized.state).toEqual(aggregate.decision.state);
  expect(facade).toEqual(aggregate.decision);
  return Object.freeze({ aggregate, normalized, facade });
}

function expectOutcomeConformance(
  state: QuerySyncState,
  attempt: PublicationAttempt,
  outcome: PublicationAttemptOutcome,
  capturedNow: PublicationAttemptInstant,
) {
  const aggregate = getSuccess(
    applyRecordPublicationAttemptOutcomeTransition(
      state,
      attempt,
      outcome,
      capturedNow,
    ),
  );
  const normalized = getSuccess(
    executeNormalizedRecordPublicationAttemptOutcome(
      normalizeQuerySyncState(state),
      attempt,
      outcome,
      capturedNow,
    ),
  );
  const facade = getSuccess(recordPublicationAttemptOutcome(
    state,
    attempt,
    outcome,
    capturedNow,
  ));

  expect(normalized.plan).toEqual(aggregate.plan);
  expect(normalized.receipt).toEqual(aggregate.plan.receipt);
  expect(normalized.receipt).toBe(normalized.plan.receipt);
  expect(normalized.disposition).toBe(aggregate.disposition);
  expect(normalized.state).toEqual(aggregate.decision.state);
  expect(facade).toEqual(aggregate.decision);
  return Object.freeze({ aggregate, normalized, facade });
}

function expectCompletionConformance(
  state: QuerySyncState,
  evidence: AcceptedQueryPublicationEvidence,
) {
  const aggregate = getSuccess(applyCompletePublicationTransition(
    state,
    evidence,
  ));
  const normalized = getSuccess(executeNormalizedCompletePublication(
    normalizeQuerySyncState(state),
    evidence,
  ));
  const facade = getSuccess(completePublication(state, evidence));

  expect(normalized.plan).toEqual(aggregate.plan);
  expect(normalized.receipt).toEqual(aggregate.plan.receipt);
  expect(normalized.receipt).toBe(normalized.plan.receipt);
  expect(normalized.disposition).toBe(aggregate.disposition);
  expect(normalized.state).toEqual(aggregate.decision.state);
  expect(facade).toEqual(aggregate.decision);
  return Object.freeze({ aggregate, normalized, facade });
}

describe("QSYNC01-D4 independent publication interpretation", () => {
  it("matches none, fresh claim, replay, and inclusive age blocking", () => {
    const firstInstant = getSuccess(capturePublicationAttemptInstant(1_000));
    const none = expectClaimConformance(emptyState(), firstInstant);
    expect(none.aggregate.disposition).toBe("noWrite");
    expect(none.aggregate.plan).toEqual({
      _tag: "noWrite",
      receipt: { _tag: "none" },
    });

    const state = stateWithPendingPublication(
      descriptor({ keySeed: 91, identity: "d4-claim" }),
      "d4-claim",
    );
    const claimed = expectClaimConformance(state, firstInstant);
    expect(claimed.aggregate.disposition).toBe("write");
    expect(claimed.aggregate.plan).toMatchObject({
      _tag: "write",
      receipt: { _tag: "claimed", attempt: { attemptOrdinal: 1 } },
    });

    const replayed = expectClaimConformance(
      claimed.aggregate.decision.state,
      firstInstant,
    );
    expect(replayed.aggregate.disposition).toBe("noWrite");
    expect(replayed.aggregate.plan).toMatchObject({
      _tag: "noWrite",
      receipt: { _tag: "replayed", attempt: { attemptOrdinal: 1 } },
    });

    const ageLimit = getSuccess(capturePublicationAttemptInstant(
      1_000 + MAX_PUBLICATION_ATTEMPT_AGE_MILLISECONDS,
    ));
    const blocked = expectClaimConformance(
      claimed.aggregate.decision.state,
      ageLimit,
    );
    expect(blocked.aggregate.disposition).toBe("write");
    expect(blocked.aggregate.plan).toMatchObject({
      _tag: "write",
      receipt: {
        _tag: "blocked",
        attemptOrdinal: 1,
        reason: "ageLimitReached",
        resetRequired: true,
      },
    });
  });

  it("matches ordinal advancement, exact replay, and terminal blocking", () => {
    const capturedNow = getSuccess(capturePublicationAttemptInstant(2_000));
    const pending = stateWithPendingPublication(
      descriptor({ keySeed: 92, identity: "d4-outcome" }),
      "d4-outcome",
    );
    const claim = getSuccess(claimPublication(pending, capturedNow));
    if (claim._tag !== "claimed") {
      throw new Error("Expected a publication attempt.");
    }

    const recorded = expectOutcomeConformance(
      claim.state,
      claim.attempt,
      "knownNotAppended",
      capturedNow,
    );
    expect(recorded.aggregate.disposition).toBe("write");
    expect(recorded.aggregate.plan).toMatchObject({
      _tag: "write",
      receipt: {
        _tag: "recorded",
        attemptOrdinal: 1,
        nextAttemptOrdinal: 2,
        nextDisposition: "ready",
      },
    });

    const replay = expectOutcomeConformance(
      recorded.aggregate.decision.state,
      claim.attempt,
      "knownNotAppended",
      capturedNow,
    );
    expect(replay.aggregate.disposition).toBe("noWrite");
    expect(replay.aggregate.plan.receipt).toEqual(
      recorded.aggregate.plan.receipt,
    );

    const terminalPending = stateWithPendingPublication(
      descriptor({ keySeed: 93, identity: "d4-terminal" }),
      "d4-terminal",
    );
    const terminalClaim = getSuccess(claimPublication(
      terminalPending,
      capturedNow,
    ));
    if (terminalClaim._tag !== "claimed") {
      throw new Error("Expected terminal publication work.");
    }
    const terminal = expectOutcomeConformance(
      terminalClaim.state,
      terminalClaim.attempt,
      "terminalRefusal",
      capturedNow,
    );
    expect(terminal.aggregate.disposition).toBe("write");
    expect(terminal.aggregate.plan).toMatchObject({
      _tag: "write",
      receipt: {
        _tag: "blocked",
        attemptOrdinal: 1,
        reason: "terminalPublisherRefusal",
        resetRequired: true,
      },
    });
  });

  it("matches completion, exact replay, and unrelated supersession", () => {
    const capturedNow = getSuccess(capturePublicationAttemptInstant(3_000));
    const pending = stateWithPendingPublication(
      descriptor({ keySeed: 94, identity: "d4-completion" }),
      "d4-completion",
    );
    const claim = getSuccess(claimPublication(pending, capturedNow));
    if (claim._tag !== "claimed") {
      throw new Error("Expected completion publication work.");
    }
    const evidence = acceptanceFor(claim.attempt);

    const completed = expectCompletionConformance(claim.state, evidence);
    expect(completed.aggregate.disposition).toBe("write");
    expect(completed.aggregate.plan).toMatchObject({
      _tag: "write",
      receipt: { _tag: "completed", identity: evidence.identity },
    });

    const replayed = expectCompletionConformance(
      completed.aggregate.decision.state,
      evidence,
    );
    expect(replayed.aggregate.disposition).toBe("noWrite");
    expect(replayed.aggregate.plan).toMatchObject({
      _tag: "noWrite",
      receipt: { _tag: "replayed", identity: evidence.identity },
    });

    const unrelated = makeAcceptedQueryPublicationEvidenceForTesting({
      identity: {
        ...evidence.identity,
        queryKey: descriptor({
          keySeed: 95,
          identity: "d4-superseded",
        }).queryKey,
      },
      resultDigest: evidence.resultDigest,
    });
    const superseded = expectCompletionConformance(
      completed.aggregate.decision.state,
      unrelated,
    );
    expect(superseded.aggregate.disposition).toBe("noWrite");
    expect(superseded.aggregate.plan).toMatchObject({
      _tag: "noWrite",
      receipt: { _tag: "superseded", identity: unrelated.identity },
    });
  });
});
