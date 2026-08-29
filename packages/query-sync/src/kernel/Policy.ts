import { Result } from "effect";

import {
  successorSyncSequence,
} from "./CanonicalValue.js";
import type {
  SyncEpoch,
  SyncModelId,
  SyncNamespaceId,
  SyncSequence,
} from "./CanonicalValue.js";
import {
  QuerySyncSequenceExhaustedError,
} from "./Errors.js";
import type {
  InvalidQueryCompletionReplayError,
  InvalidQueryEvidenceError,
  InvalidQueryEvaluationRequestError,
  QueryGenerationExhaustedError,
  QueryEvaluationWorkBlockedError,
  QueryGenerationMismatchError,
  QueryKeyCollisionError,
  QueryStateNotFoundError,
  QuerySyncAuthorityError,
  QuerySyncCanonicalValueError,
  QuerySyncModelMismatchError,
  QuerySyncNamespaceMismatchError,
  QuerySyncWorkLimitError,
  QuerySyncWorkRevisionExhaustedError,
} from "./Errors.js";
import type {
  AdmittedInvalidationBatch,
  ApplyInvalidationsDecision,
  BeginQueryEvaluationDecision,
  BeginQueryEvaluationRequest,
  BuildQuerySyncStateError,
  CompleteQueryEvaluationDecision,
  GenerationRefreshEvidence,
  NamespaceCursor,
  QueryEvaluationAttempt,
  QueryEvaluationEvidence,
  QuerySyncState,
  SequenceDecision,
} from "./Model.js";
import { validateQuerySyncAuthority } from "./Authority.js";
import { classifySequenceForOperation } from "./Sequence.js";
import {
  applyAdmittedInvalidationsTransition,
  applyBeginQueryEvaluationTransition,
  applyCompleteQueryEvaluationTransition,
} from "./TransitionPlanAggregate.js";
import type {
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
  return applyCompleteQueryEvaluationTransition(
    state,
    attempt,
    evaluation,
    refresh,
    publication,
  ).pipe(Result.map((transition) => transition.decision));
}
