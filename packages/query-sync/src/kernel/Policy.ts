import { Result } from "effect";

import {
  successorQuerySyncWorkRevision,
  successorSyncSequence,
} from "./CanonicalValue.js";
import type {
  CanonicalDependencyKey,
  SyncEpoch,
  SyncModelId,
  SyncNamespaceId,
  SyncSequence,
} from "./CanonicalValue.js";
import {
  InvalidQueryCompletionReplayError,
  InvalidQueryEvidenceError,
  QueryEvaluationWorkBlockedError,
  QueryGenerationMismatchError,
  QueryKeyCollisionError,
  QueryStateNotFoundError,
  QuerySyncInvariantDefect,
  QuerySyncSequenceExhaustedError,
} from "./Errors.js";
import type {
  InvalidQueryEvaluationRequestError,
  QueryGenerationExhaustedError,
  QuerySyncAuthorityError,
  QuerySyncCanonicalValueError,
  QuerySyncModelMismatchError,
  QuerySyncNamespaceMismatchError,
  QuerySyncWorkLimitError,
  QuerySyncWorkRevisionExhaustedError,
} from "./Errors.js";
import {
  findQueryState,
  findRetainedQueryPublication,
  rebuildQuerySyncState,
} from "./Model.js";
import type {
  ActiveQueryState,
  AdmittedInvalidationBatch,
  ApplyInvalidationsDecision,
  BeginQueryEvaluationDecision,
  BeginQueryEvaluationRequest,
  BuildQuerySyncStateError,
  CompleteQueryEvaluationDecision,
  GenerationRefreshEvidence,
  NamespaceCursor,
  QueryCompletionFingerprint,
  QueryEvaluationAttempt,
  QueryEvaluationEvidence,
  QueryState,
  QuerySyncState,
  SequenceDecision,
} from "./Model.js";
import { validateQuerySyncAuthority } from "./Authority.js";
import { classifySequenceForOperation } from "./Sequence.js";
import {
  applyAdmittedInvalidationsTransition,
  applyBeginQueryEvaluationTransition,
} from "./TransitionPlanAggregate.js";
import {
  captureQueryPublicationArtifact,
  makePendingQueryPublication,
  makeQueryPublicationIdentity,
  pendingPublicationDisposition,
  unchangedPublicationDisposition,
} from "./Publication.js";
import type {
  PendingQueryPublication,
  QueryCompletionPublicationDisposition,
  QueryPublicationArtifact,
} from "./Publication.js";

export type ClassifySequenceError =
  | QuerySyncNamespaceMismatchError<"classifySequence">
  | QuerySyncModelMismatchError<"classifySequence">;

export type BeginQueryEvaluationError =
  | QuerySyncAuthorityError<"beginQueryEvaluation">
  | QueryGenerationExhaustedError<"beginQueryEvaluation">
  | QueryGenerationMismatchError<"beginQueryEvaluation">
  | QueryKeyCollisionError<"beginQueryEvaluation">
  | InvalidQueryEvaluationRequestError
  | QuerySyncWorkRevisionExhaustedError<"beginQueryEvaluation">
  | QueryEvaluationWorkBlockedError<"beginQueryEvaluation">
  | BuildQuerySyncStateError;

export type ApplyInvalidationsError =
  | QuerySyncNamespaceMismatchError<"applyAdmittedInvalidations">
  | QuerySyncModelMismatchError<"applyAdmittedInvalidations">
  | QuerySyncWorkLimitError<"applyAdmittedInvalidations">
  | QuerySyncWorkRevisionExhaustedError<"applyAdmittedInvalidations">
  | BuildQuerySyncStateError;

export type CompleteQueryEvaluationError =
  | QuerySyncAuthorityError<"completeQueryEvaluation">
  | QueryKeyCollisionError<"completeQueryEvaluation">
  | QueryStateNotFoundError<"completeQueryEvaluation">
  | QueryGenerationMismatchError<"completeQueryEvaluation">
  | InvalidQueryEvidenceError
  | InvalidQueryCompletionReplayError
  | QuerySyncCanonicalValueError
  | QuerySyncWorkRevisionExhaustedError<"completeQueryEvaluation">
  | QueryEvaluationWorkBlockedError<"completeQueryEvaluation">
  | BuildQuerySyncStateError;

export { validateQuerySyncAuthority } from "./Authority.js";

function invalidQueryEvidence(
  reason: InvalidQueryEvidenceError["reason"],
): InvalidQueryEvidenceError {
  return new InvalidQueryEvidenceError({
    operation: "completeQueryEvaluation",
    reason,
  });
}

function dependencyKeysEqual(
  left: readonly CanonicalDependencyKey[],
  right: readonly CanonicalDependencyKey[],
): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function freezeCompleteDecision(
  decision: CompleteQueryEvaluationDecision,
): CompleteQueryEvaluationDecision {
  return Object.freeze(decision);
}

function replaceQueryInArray(
  queries: readonly QueryState[],
  replacement: QueryState,
): readonly QueryState[] {
  const nextQueries = queries.map((query) => (
    query.descriptor.queryKey === replacement.descriptor.queryKey
      ? replacement
      : query
  ));
  return nextQueries.some((query) => (
      query.descriptor.queryKey === replacement.descriptor.queryKey
    ))
    ? nextQueries
    : [...nextQueries, replacement];
}

export function nextSyncSequence(
  cursor: NamespaceCursor,
): Result.Result<SyncSequence, QuerySyncSequenceExhaustedError> {
  const successor = successorSyncSequence(cursor.appliedThroughSequence);
  if (successor === null) {
    return Result.fail(new QuerySyncSequenceExhaustedError({
      operation: "nextSyncSequence",
      appliedThroughSequence: cursor.appliedThroughSequence,
    }));
  }
  return Result.succeed(successor);
}

export function classifySequence(
  cursor: NamespaceCursor,
  position: {
    readonly namespaceId: SyncNamespaceId;
    readonly syncModelId: SyncModelId;
    readonly sourceEpoch: SyncEpoch;
    readonly sourceSequence: SyncSequence;
  },
): Result.Result<SequenceDecision, ClassifySequenceError> {
  return classifySequenceForOperation("classifySequence", cursor, position);
}


export function beginQueryEvaluation(
  state: QuerySyncState,
  request: BeginQueryEvaluationRequest,
): Result.Result<BeginQueryEvaluationDecision, BeginQueryEvaluationError> {
  return applyBeginQueryEvaluationTransition(state, request).pipe(
    Result.map((transition) => transition.decision),
  );
}


export function applyAdmittedInvalidations(
  state: QuerySyncState,
  batch: AdmittedInvalidationBatch,
): Result.Result<ApplyInvalidationsDecision, ApplyInvalidationsError> {
  return applyAdmittedInvalidationsTransition(state, batch).pipe(
    Result.map((transition) => transition.decision),
  );
}


function laterRelevantSequence(
  evaluation: QueryEvaluationEvidence,
  refresh: GenerationRefreshEvidence,
  active: ActiveQueryState | null,
): SyncSequence | null {
  let relevant = refresh.relevantThroughSequence;
  const dirty = active?.dirtyThroughSequence ?? null;
  if (
    dirty !== null
    && dirty > evaluation.snapshotSequence
    && (relevant === null || dirty > relevant)
  ) {
    relevant = dirty;
  }
  return relevant;
}

function namespaceCursorsEqual(
  left: NamespaceCursor,
  right: NamespaceCursor,
): boolean {
  return left.namespaceId === right.namespaceId
    && left.syncModelId === right.syncModelId
    && left.sourceEpoch === right.sourceEpoch
    && left.appliedThroughSequence === right.appliedThroughSequence;
}

function completionFingerprintMatches(
  fingerprint: QueryCompletionFingerprint,
  attempt: QueryEvaluationAttempt,
  evaluation: QueryEvaluationEvidence,
  refresh: GenerationRefreshEvidence,
): boolean {
  return fingerprint.identity.namespaceId === attempt.namespaceId
    && fingerprint.identity.syncModelId === attempt.syncModelId
    && fingerprint.identity.sourceEpoch === attempt.sourceEpoch
    && fingerprint.identity.queryKey === attempt.descriptor.queryKey
    && fingerprint.identity.generation === attempt.generation
    && fingerprint.queryIdentity === attempt.descriptor.queryIdentity
    && fingerprint.expectedActiveGeneration
      === attempt.expectedActiveGeneration
    && namespaceCursorsEqual(
      fingerprint.registrationCursor,
      attempt.registrationCursor,
    )
    && fingerprint.requestedDirtyThroughSequence
      === attempt.requestedDirtyThroughSequence
    && fingerprint.evaluationSnapshotSequence === evaluation.snapshotSequence
    && dependencyKeysEqual(
      fingerprint.evaluationDependencyKeys,
      evaluation.dependencyKeys,
    )
    && fingerprint.evaluationAuthorityWitness
      === evaluation.authorityWitness
    && fingerprint.refreshedThroughSequence
      === refresh.refreshedThroughSequence
    && fingerprint.relevantThroughSequence
      === refresh.relevantThroughSequence
    && fingerprint.refreshAuthorityWitness === refresh.authorityWitness
    && fingerprint.resultDigest === evaluation.resultDigest;
}

function invalidCompletionReplay(
  attempt: QueryEvaluationAttempt,
  reason: InvalidQueryCompletionReplayError["reason"],
): InvalidQueryCompletionReplayError {
  return new InvalidQueryCompletionReplayError({
    operation: "completeQueryEvaluation",
    reason,
    queryKey: attempt.descriptor.queryKey,
    generation: attempt.generation,
  });
}

export function completeQueryEvaluation(
  state: QuerySyncState,
  attempt: QueryEvaluationAttempt,
  evaluation: QueryEvaluationEvidence,
  refresh: GenerationRefreshEvidence,
  publication: QueryPublicationArtifact,
): Result.Result<
  CompleteQueryEvaluationDecision,
  CompleteQueryEvaluationError
> {
  return Result.gen(function* () {
    yield* validateQuerySyncAuthority(
      "completeQueryEvaluation",
      state.cursor,
      attempt,
    );
    yield* validateQuerySyncAuthority(
      "completeQueryEvaluation",
      state.cursor,
      evaluation,
    );
    yield* validateQuerySyncAuthority(
      "completeQueryEvaluation",
      state.cursor,
      refresh,
    );
    if (
      attempt.descriptor.queryKey !== evaluation.descriptor.queryKey
      || attempt.descriptor.queryIdentity
        !== evaluation.descriptor.queryIdentity
    ) {
      return yield* Result.fail(invalidQueryEvidence(
        "attemptEvaluationDescriptorMismatch",
      ));
    }
    if (attempt.generation !== evaluation.generation) {
      return yield* Result.fail(invalidQueryEvidence(
        "attemptEvaluationGenerationMismatch",
      ));
    }
    if (
      evaluation.descriptor.queryKey !== refresh.descriptor.queryKey
      || evaluation.descriptor.queryIdentity
        !== refresh.descriptor.queryIdentity
    ) {
      return yield* Result.fail(invalidQueryEvidence(
        "evaluationRefreshDescriptorMismatch",
      ));
    }
    if (evaluation.generation !== refresh.generation) {
      return yield* Result.fail(invalidQueryEvidence(
        "evaluationRefreshGenerationMismatch",
      ));
    }
    if (
      evaluation.snapshotSequence !== refresh.evaluationSnapshotSequence
    ) {
      return yield* Result.fail(invalidQueryEvidence(
        "evaluationRefreshSnapshotMismatch",
      ));
    }
    if (!dependencyKeysEqual(
      evaluation.dependencyKeys,
      refresh.evaluationDependencyKeys,
    )) {
      return yield* Result.fail(invalidQueryEvidence(
        "evaluationRefreshDependenciesMismatch",
      ));
    }
    const capturedPublication = yield* captureQueryPublicationArtifact(
      publication,
    );

    const query = findQueryState(state, attempt.descriptor.queryKey);
    if (query === undefined) {
      return yield* Result.fail(new QueryStateNotFoundError({
        operation: "completeQueryEvaluation",
        queryKey: attempt.descriptor.queryKey,
      }));
    }
    if (
      query.descriptor.queryIdentity
      !== attempt.descriptor.queryIdentity
    ) {
      return yield* Result.fail(new QueryKeyCollisionError<
        "completeQueryEvaluation"
      >({
        operation: "completeQueryEvaluation",
        queryKey: attempt.descriptor.queryKey,
      }));
    }

    const currentCompletion = query.currentCompletion;
    if (
      currentCompletion !== null
      && currentCompletion.identity.generation === attempt.generation
    ) {
      if (!completionFingerprintMatches(
        currentCompletion,
        attempt,
        evaluation,
        refresh,
      )) {
        return yield* Result.fail(invalidCompletionReplay(
          attempt,
          "fingerprintMismatch",
        ));
      }
      if (currentCompletion.publicationDisposition._tag === "pending") {
        const retainedPublication = findRetainedQueryPublication(
          state,
          currentCompletion.publicationDisposition.identity,
        );
        if (
          retainedPublication !== undefined
          && retainedPublication.content !== capturedPublication.content
        ) {
          return yield* Result.fail(invalidCompletionReplay(
            attempt,
            "publicationContentMismatch",
          ));
        }
      }
      return freezeCompleteDecision({
        _tag: "replayed",
        state,
        generation: attempt.generation,
        publicationDisposition:
          currentCompletion.publicationDisposition,
      });
    }

    if (
      query.active !== null
      && attempt.generation < query.active.generation
    ) {
      if (
        query.precedingCompletionIdentity?.generation === attempt.generation
      ) {
        return freezeCompleteDecision({
          _tag: "superseded",
          state,
          generation: attempt.generation,
          activeGeneration: query.active.generation,
        });
      }
      return freezeCompleteDecision({
        _tag: "recoveryEvidenceExpired",
        state,
        generation: attempt.generation,
        activeGeneration: query.active.generation,
      });
    }

    if (query.provisional?.generation !== evaluation.generation) {
      return yield* Result.fail(new QueryGenerationMismatchError<
        "completeQueryEvaluation"
      >({
        operation: "completeQueryEvaluation",
        queryKey: evaluation.descriptor.queryKey,
        expectedGeneration: query.provisional?.generation ?? null,
        observedGeneration: evaluation.generation,
      }));
    }
    if (query.provisional.evaluationDisposition._tag === "blocked") {
      return yield* Result.fail(new QueryEvaluationWorkBlockedError<
        "completeQueryEvaluation"
      >({
        operation: "completeQueryEvaluation",
        queryKey: query.descriptor.queryKey,
        generation: query.provisional.generation,
        reason: query.provisional.evaluationDisposition.reason,
        resetRequired: true,
      }));
    }
    if (
      query.provisional.expectedActiveGeneration
      !== attempt.expectedActiveGeneration
    ) {
      return yield* Result.fail(invalidQueryEvidence(
        "attemptExpectedActiveMismatch",
      ));
    }
    if (!namespaceCursorsEqual(
      query.provisional.registrationCursor,
      attempt.registrationCursor,
    )) {
      return yield* Result.fail(invalidQueryEvidence(
        "attemptRegistrationCursorMismatch",
      ));
    }
    if (
      query.provisional.requestedDirtyThroughSequence
      !== attempt.requestedDirtyThroughSequence
    ) {
      return yield* Result.fail(invalidQueryEvidence(
        "attemptDirtyFrontierMismatch",
      ));
    }
    if (
      evaluation.snapshotSequence
      < query.provisional.registrationCursor.appliedThroughSequence
    ) {
      return yield* Result.fail(invalidQueryEvidence(
        "snapshotBeforeRegistration",
      ));
    }
    if (
      query.provisional.requestedDirtyThroughSequence !== null
      && evaluation.snapshotSequence
        < query.provisional.requestedDirtyThroughSequence
    ) {
      return yield* Result.fail(invalidQueryEvidence(
        "snapshotBeforeRequestedDirtyFrontier",
      ));
    }
    if (
      evaluation.snapshotSequence > refresh.refreshedThroughSequence
    ) {
      return yield* Result.fail(invalidQueryEvidence("snapshotAfterRefresh"));
    }
    if (
      refresh.refreshedThroughSequence > state.cursor.appliedThroughSequence
    ) {
      return yield* Result.fail(invalidQueryEvidence("refreshAheadOfCursor"));
    }
    if (
      refresh.relevantThroughSequence !== null
      && refresh.relevantThroughSequence <= evaluation.snapshotSequence
    ) {
      return yield* Result.fail(invalidQueryEvidence(
        "relevantNotAfterSnapshot",
      ));
    }
    if (
      refresh.relevantThroughSequence !== null
      && refresh.relevantThroughSequence > refresh.refreshedThroughSequence
    ) {
      return yield* Result.fail(invalidQueryEvidence("relevantAfterRefresh"));
    }

    if (
      refresh.refreshedThroughSequence < state.cursor.appliedThroughSequence
    ) {
      return freezeCompleteDecision({
        _tag: "refreshRequired",
        state,
        refreshedThroughSequence: refresh.refreshedThroughSequence,
        requiredThroughSequence: state.cursor.appliedThroughSequence,
      });
    }
    if (evaluation.authorityWitness !== refresh.authorityWitness) {
      return freezeCompleteDecision({
        _tag: "resnapshotRequired",
        state,
        generation: evaluation.generation,
      });
    }

    const relevantThroughSequence = laterRelevantSequence(
      evaluation,
      refresh,
      query.active,
    );
    if (relevantThroughSequence !== null) {
      return freezeCompleteDecision({
        _tag: "rerunRequired",
        state,
        generation: evaluation.generation,
        relevantThroughSequence,
      });
    }

    const nextActive: ActiveQueryState = {
      generation: evaluation.generation,
      evaluationSnapshotSequence: evaluation.snapshotSequence,
      freshThroughSequence: refresh.refreshedThroughSequence,
      dirtyThroughSequence: null,
      resultDigest: evaluation.resultDigest,
      authorityWitness: refresh.authorityWitness,
      dependencyKeys: evaluation.dependencyKeys,
    };
    const shouldPublish = query.active === null
      || query.active.resultDigest !== evaluation.resultDigest;
    const identity = makeQueryPublicationIdentity({
      namespaceId: state.cursor.namespaceId,
      syncModelId: state.cursor.syncModelId,
      sourceEpoch: state.cursor.sourceEpoch,
      queryKey: query.descriptor.queryKey,
      generation: evaluation.generation,
    });
    const publicationDisposition: QueryCompletionPublicationDisposition =
      shouldPublish
        ? pendingPublicationDisposition(identity)
        : unchangedPublicationDisposition();
    const completion: QueryCompletionFingerprint = {
      identity,
      queryIdentity: query.descriptor.queryIdentity,
      expectedActiveGeneration: attempt.expectedActiveGeneration,
      registrationCursor: attempt.registrationCursor,
      requestedDirtyThroughSequence:
        attempt.requestedDirtyThroughSequence,
      evaluationSnapshotSequence: evaluation.snapshotSequence,
      evaluationDependencyKeys: evaluation.dependencyKeys,
      evaluationAuthorityWitness: evaluation.authorityWitness,
      refreshedThroughSequence: refresh.refreshedThroughSequence,
      relevantThroughSequence: refresh.relevantThroughSequence,
      refreshAuthorityWitness: refresh.authorityWitness,
      resultDigest: evaluation.resultDigest,
      publicationDisposition,
    };

    const nextPendingPublications: PendingQueryPublication[] =
      shouldPublish
        ? state.publicationWork.pending.filter((candidate) => (
          candidate.identity.queryKey !== query.descriptor.queryKey
        ))
        : [...state.publicationWork.pending];
    if (shouldPublish) {
      nextPendingPublications.push(makePendingQueryPublication({
        identity,
        queryIdentity: query.descriptor.queryIdentity,
        completedThroughSequence: refresh.refreshedThroughSequence,
        resultDigest: evaluation.resultDigest,
        content: capturedPublication.content,
      }));
    }

    const revision = yield* successorQuerySyncWorkRevision(
      "completeQueryEvaluation",
      state.evaluationWork.revision,
    );
    const nextState = yield* rebuildQuerySyncState(state, {
      queries: replaceQueryInArray(state.queries, {
        descriptor: query.descriptor,
        active: nextActive,
        provisional: null,
        currentCompletion: completion,
        precedingCompletionIdentity:
          query.currentCompletion?.identity ?? null,
      }),
      evaluationWork: {
        revision,
        fairnessAnchor: state.evaluationWork.fairnessAnchor,
      },
      publicationWork: {
        ...state.publicationWork,
        pending: nextPendingPublications,
      },
    });
    return freezeCompleteDecision({
      _tag: "completed",
      state: nextState,
      generation: evaluation.generation,
      publicationDisposition,
    });
  });
}
