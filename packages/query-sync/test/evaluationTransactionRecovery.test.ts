import { Result } from "effect";
import { describe, expect, it } from "vitest";

import {
  applyAdmittedInvalidations,
  beginQueryEvaluation,
  completeQueryEvaluation,
  createEmptyQuerySyncState,
  InvalidQueryCompletionReplayError,
} from "@flarex/query-sync/internal/kernel";
import type {
  BeginQueryEvaluationRequest,
  CompleteQueryEvaluationDecision,
  GenerationRefreshEvidence,
  QueryEvaluationAttempt,
  QueryEvaluationEvidence,
  QueryPublicationArtifact,
  QuerySyncState,
} from "@flarex/query-sync/internal/kernel";
import {
  deriveGenerationRefreshEvidence,
} from "@flarex/query-sync/testing/reference-model";

import {
  batch,
  canonicalText,
  cursor,
  evaluation,
  firstEvaluationRequest,
  getEvaluationAttempt,
  getSuccess,
  publicationArtifact,
  rerunEvaluationRequest,
} from "./fixtures.js";

interface CompletedEvaluationFixture {
  readonly state: QuerySyncState;
  readonly request: BeginQueryEvaluationRequest;
  readonly attempt: QueryEvaluationAttempt;
  readonly evaluation: QueryEvaluationEvidence;
  readonly refresh: GenerationRefreshEvidence;
  readonly publication: QueryPublicationArtifact;
  readonly decision: Extract<
    CompleteQueryEvaluationDecision,
    { readonly _tag: "completed" }
  >;
}

function requireCompleted(
  decision: CompleteQueryEvaluationDecision,
): Extract<CompleteQueryEvaluationDecision, { readonly _tag: "completed" }> {
  if (decision._tag !== "completed") {
    throw new Error(`Expected completion, received ${decision._tag}`);
  }
  return decision;
}

function completeFirstEvaluation(input: {
  readonly dependency: string;
  readonly resultSeed?: number;
  readonly publicationContent?: string;
}): CompletedEvaluationFixture {
  const initial = getSuccess(createEmptyQuerySyncState(cursor()));
  const request = firstEvaluationRequest();
  const begun = getSuccess(beginQueryEvaluation(initial, request));
  const attempt = getEvaluationAttempt(begun);
  const capturedEvaluation = evaluation({
    descriptor: attempt.descriptor,
    generation: attempt.generation,
    snapshot: begun.state.cursor.appliedThroughSequence,
    resultSeed: input.resultSeed ?? 80,
    dependencies: [input.dependency],
  });
  const refresh = getSuccess(deriveGenerationRefreshEvidence(
    capturedEvaluation,
    begun.state.cursor,
    [],
    capturedEvaluation.authorityWitness,
  ));
  const publication = publicationArtifact(
    input.publicationContent ?? "generation-one",
  );
  const decision = requireCompleted(getSuccess(completeQueryEvaluation(
    begun.state,
    attempt,
    capturedEvaluation,
    refresh,
    publication,
  )));
  return Object.freeze({
    state: decision.state,
    request,
    attempt,
    evaluation: capturedEvaluation,
    refresh,
    publication,
    decision,
  });
}

function completeNextEvaluation(input: {
  readonly previous: CompletedEvaluationFixture;
  readonly dependency: string;
  readonly sequence: bigint;
  readonly resultSeed: number;
  readonly publicationContent: string;
}): CompletedEvaluationFixture {
  const invalidated = getSuccess(applyAdmittedInvalidations(
    input.previous.state,
    batch({
      sequence: input.sequence,
      dependencies: [input.dependency],
    }),
  ));
  if (invalidated._tag !== "applied") {
    throw new Error(`Expected invalidation, received ${invalidated._tag}`);
  }
  const active = invalidated.state.queries[0]?.active;
  if (active === null || active === undefined) {
    throw new Error("Expected an active query");
  }
  if (active.dirtyThroughSequence === null) {
    throw new Error("Expected a durable dirty frontier");
  }
  const request = rerunEvaluationRequest({
    activeGeneration: active.generation,
    dirtyThroughSequence: active.dirtyThroughSequence,
  });
  const begun = getSuccess(beginQueryEvaluation(invalidated.state, request));
  const attempt = getEvaluationAttempt(begun);
  const capturedEvaluation = evaluation({
    descriptor: attempt.descriptor,
    generation: attempt.generation,
    snapshot: begun.state.cursor.appliedThroughSequence,
    resultSeed: input.resultSeed,
    dependencies: [input.dependency],
  });
  const refresh = getSuccess(deriveGenerationRefreshEvidence(
    capturedEvaluation,
    begun.state.cursor,
    [],
    capturedEvaluation.authorityWitness,
  ));
  const publication = publicationArtifact(input.publicationContent);
  const decision = requireCompleted(getSuccess(completeQueryEvaluation(
    begun.state,
    attempt,
    capturedEvaluation,
    refresh,
    publication,
  )));
  return Object.freeze({
    state: decision.state,
    request,
    attempt,
    evaluation: capturedEvaluation,
    refresh,
    publication,
    decision,
  });
}

describe("evaluation transaction recovery", () => {
  it("replays an exact lost begin with the current coalesced dirty frontier", () => {
    const dependency = canonicalText("record:1");
    const first = completeFirstEvaluation({ dependency });
    const initiallyDirty = getSuccess(applyAdmittedInvalidations(
      first.state,
      batch({ sequence: 1n, dependencies: [dependency] }),
    ));
    if (initiallyDirty._tag !== "applied") {
      throw new Error("Expected first invalidation");
    }
    const active = initiallyDirty.state.queries[0]?.active;
    if (
      active === null
      || active === undefined
      || active.dirtyThroughSequence === null
    ) {
      throw new Error("Expected a durably dirty active query");
    }
    const request = rerunEvaluationRequest({
      activeGeneration: active.generation,
      dirtyThroughSequence: active.dirtyThroughSequence,
    });
    const created = getSuccess(beginQueryEvaluation(
      initiallyDirty.state,
      request,
    ));
    const createdAttempt = getEvaluationAttempt(created);
    const laterDirty = getSuccess(applyAdmittedInvalidations(
      created.state,
      batch({ sequence: 2n, dependencies: [dependency] }),
    ));
    if (laterDirty._tag !== "applied") {
      throw new Error("Expected second invalidation");
    }

    const replayed = getSuccess(beginQueryEvaluation(
      laterDirty.state,
      request,
    ));
    const replayedAttempt = getEvaluationAttempt(replayed);

    expect(replayed._tag).toBe("replayed");
    expect(replayedAttempt.generation).toBe(createdAttempt.generation);
    expect(replayedAttempt.registrationCursor).toEqual(
      createdAttempt.registrationCursor,
    );
    expect(replayedAttempt.expectedActiveGeneration).toBe(
      createdAttempt.expectedActiveGeneration,
    );
    expect(createdAttempt.requestedDirtyThroughSequence).toBe(1n);
    expect(replayedAttempt.requestedDirtyThroughSequence).toBe(2n);
    expect(replayed.state.queries[0]?.provisional).toMatchObject({
      generation: createdAttempt.generation,
      registrationCursor: createdAttempt.registrationCursor,
      expectedActiveGeneration: createdAttempt.expectedActiveGeneration,
      requestedDirtyThroughSequence: 2n,
    });
  });

  it("returns alreadyAdvanced for a stale begin without allocating a successor", () => {
    const first = completeFirstEvaluation({
      dependency: canonicalText("record:1"),
    });

    const replayed = getSuccess(beginQueryEvaluation(
      first.state,
      first.request,
    ));

    expect(replayed).toMatchObject({
      _tag: "alreadyAdvanced",
      requestedExpectedActiveGeneration: null,
      activeGeneration: first.attempt.generation,
    });
    expect(replayed.state).toBe(first.state);
    expect(replayed.state.queries[0]?.active?.generation).toBe(
      first.attempt.generation,
    );
    expect(replayed.state.queries[0]?.provisional).toBeNull();
  });

  it("replays exact current completion with its durable disposition", () => {
    const first = completeFirstEvaluation({
      dependency: canonicalText("record:1"),
    });

    const replayed = getSuccess(completeQueryEvaluation(
      first.state,
      first.attempt,
      first.evaluation,
      first.refresh,
      first.publication,
    ));
    if (replayed._tag !== "replayed") {
      throw new Error(`Expected completion replay, received ${replayed._tag}`);
    }

    expect(replayed).toMatchObject({
      _tag: "replayed",
      generation: first.attempt.generation,
      publicationDisposition: first.decision.publicationDisposition,
    });
    expect(replayed.state).toBe(first.state);
    expect(replayed.publicationDisposition).toEqual(
      first.state.queries[0]?.currentCompletion?.publicationDisposition,
    );
    expect(replayed.state.pendingPublications).toBe(
      first.state.pendingPublications,
    );
  });

  it("rejects altered completion fingerprints and pending content", () => {
    const dependency = canonicalText("record:1");
    const first = completeFirstEvaluation({ dependency });
    const alteredEvaluation = evaluation({
      descriptor: first.attempt.descriptor,
      generation: first.attempt.generation,
      snapshot: first.evaluation.snapshotSequence,
      resultSeed: 81,
      dependencies: [dependency],
    });
    const alteredRefresh = getSuccess(deriveGenerationRefreshEvidence(
      alteredEvaluation,
      first.state.cursor,
      [],
      alteredEvaluation.authorityWitness,
    ));

    const alteredFingerprint = completeQueryEvaluation(
      first.state,
      first.attempt,
      alteredEvaluation,
      alteredRefresh,
      first.publication,
    );
    expect(Result.isFailure(alteredFingerprint)).toBe(true);
    if (Result.isFailure(alteredFingerprint)) {
      expect(alteredFingerprint.failure).toBeInstanceOf(
        InvalidQueryCompletionReplayError,
      );
      expect(alteredFingerprint.failure).toMatchObject({
        reason: "fingerprintMismatch",
        generation: first.attempt.generation,
      });
    }

    const alteredContent = completeQueryEvaluation(
      first.state,
      first.attempt,
      first.evaluation,
      first.refresh,
      publicationArtifact("altered-content"),
    );
    expect(Result.isFailure(alteredContent)).toBe(true);
    if (Result.isFailure(alteredContent)) {
      expect(alteredContent.failure).toBeInstanceOf(
        InvalidQueryCompletionReplayError,
      );
      expect(alteredContent.failure).toMatchObject({
        reason: "publicationContentMismatch",
        generation: first.attempt.generation,
      });
    }
    expect(first.state.queries[0]?.active?.generation).toBe(
      first.attempt.generation,
    );
    expect(first.state.pendingPublications).toHaveLength(1);
  });

  it("classifies the immediately preceding generation as superseded", () => {
    const dependency = canonicalText("record:1");
    const first = completeFirstEvaluation({ dependency });
    const second = completeNextEvaluation({
      previous: first,
      dependency,
      sequence: 1n,
      resultSeed: 81,
      publicationContent: "generation-two",
    });

    const stale = getSuccess(completeQueryEvaluation(
      second.state,
      first.attempt,
      first.evaluation,
      first.refresh,
      first.publication,
    ));

    expect(stale).toMatchObject({
      _tag: "superseded",
      generation: first.attempt.generation,
      activeGeneration: second.attempt.generation,
    });
    expect(stale.state).toBe(second.state);
    expect(second.state.queries[0]?.precedingCompletionIdentity?.generation)
      .toBe(first.attempt.generation);
  });

  it("expires completion evidence older than the retained recovery window", () => {
    const dependency = canonicalText("record:1");
    const first = completeFirstEvaluation({ dependency });
    const second = completeNextEvaluation({
      previous: first,
      dependency,
      sequence: 1n,
      resultSeed: 81,
      publicationContent: "generation-two",
    });
    const third = completeNextEvaluation({
      previous: second,
      dependency,
      sequence: 2n,
      resultSeed: 82,
      publicationContent: "generation-three",
    });

    const expired = getSuccess(completeQueryEvaluation(
      third.state,
      first.attempt,
      first.evaluation,
      first.refresh,
      first.publication,
    ));

    expect(expired).toMatchObject({
      _tag: "recoveryEvidenceExpired",
      generation: first.attempt.generation,
      activeGeneration: third.attempt.generation,
    });
    expect(expired.state).toBe(third.state);
    expect(third.state.queries[0]?.precedingCompletionIdentity?.generation)
      .toBe(second.attempt.generation);
  });
});
