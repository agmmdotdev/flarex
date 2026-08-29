import { Result } from "effect";

import type {
  CanonicalQueryKey,
  QueryGeneration,
} from "./CanonicalValue.js";
import type {
  InvalidEvaluationAttemptError,
  InvalidEvaluationWorkContinuationError,
  InvalidEvaluationWorkScanRequestError,
  QueryGenerationExhaustedError,
  QueryGenerationMismatchError,
  QueryKeyCollisionError,
  QueryStateNotFoundError,
  QuerySyncAuthorityError,
  QuerySyncWorkRevisionExhaustedError,
} from "./Errors.js";
import type {
  BuildQuerySyncStateError,
  QueryEvaluationAttempt,
  QuerySyncState,
} from "./Model.js";
import {
  applyClaimEvaluationWorkTransition,
  applyRecordEvaluationAttemptOutcomeTransition,
} from "./TransitionPlanAggregate.js";
import type {
  BlockedEvaluationWorkEvidence,
  EvaluationAttemptOutcome,
  EvaluationWorkScanContinuation,
  EvaluationWorkScanRequest,
} from "../transition-plan/EvaluationWork.js";

export { MAX_EVALUATION_WORK_QUERY_INSPECTIONS } from
  "../transition-plan/Limits.js";

export type {
  BlockedEvaluationWorkEvidence,
  EvaluationAttemptOutcome,
  EvaluationWorkScanContinuation,
  EvaluationWorkScanRequest,
} from "../transition-plan/EvaluationWork.js";

export type ClaimEvaluationWorkDecision =
  | Readonly<{
      readonly _tag: "claimed";
      readonly state: QuerySyncState;
      readonly attempt: QueryEvaluationAttempt;
      readonly continuation: EvaluationWorkScanContinuation;
    }>
  | Readonly<{
      readonly _tag: "continued";
      readonly state: QuerySyncState;
      readonly continuation: EvaluationWorkScanContinuation;
    }>
  | Readonly<{
      readonly _tag: "scanRestarted";
      readonly state: QuerySyncState;
      readonly continuation: EvaluationWorkScanContinuation;
    }>
  | Readonly<{
      readonly _tag: "blocked";
      readonly state: QuerySyncState;
      readonly blockedWork: BlockedEvaluationWorkEvidence;
    }>
  | Readonly<{ readonly _tag: "none"; readonly state: QuerySyncState }>;

export type RecordEvaluationAttemptOutcomeDecision =
  | Readonly<{
      readonly _tag: "eligible";
      readonly state: QuerySyncState;
      readonly queryKey: CanonicalQueryKey;
      readonly generation: QueryGeneration;
    }>
  | Readonly<{
      readonly _tag: "blocked";
      readonly state: QuerySyncState;
      readonly blockedWork: BlockedEvaluationWorkEvidence;
    }>
  | Readonly<{
      readonly _tag: "superseded";
      readonly state: QuerySyncState;
      readonly queryKey: CanonicalQueryKey;
      readonly generation: QueryGeneration;
      readonly activeGeneration: QueryGeneration;
    }>
  | Readonly<{
      readonly _tag: "recoveryEvidenceExpired";
      readonly state: QuerySyncState;
      readonly queryKey: CanonicalQueryKey;
      readonly generation: QueryGeneration;
      readonly activeGeneration: QueryGeneration;
    }>;

export type ClaimEvaluationWorkError =
  | InvalidEvaluationWorkScanRequestError
  | QuerySyncAuthorityError<"claimEvaluationWork">
  | InvalidEvaluationWorkContinuationError
  | QueryGenerationExhaustedError<"claimEvaluationWork">
  | QuerySyncWorkRevisionExhaustedError<"claimEvaluationWork">
  | BuildQuerySyncStateError;

export type RecordEvaluationAttemptOutcomeError =
  | QuerySyncAuthorityError<"recordEvaluationAttemptOutcome">
  | QueryKeyCollisionError<"recordEvaluationAttemptOutcome">
  | QueryStateNotFoundError<"recordEvaluationAttemptOutcome">
  | QueryGenerationMismatchError<"recordEvaluationAttemptOutcome">
  | InvalidEvaluationAttemptError
  | QuerySyncWorkRevisionExhaustedError<"recordEvaluationAttemptOutcome">
  | BuildQuerySyncStateError;

export function claimEvaluationWork(
  state: QuerySyncState,
  request: EvaluationWorkScanRequest,
): Result.Result<ClaimEvaluationWorkDecision, ClaimEvaluationWorkError> {
  return applyClaimEvaluationWorkTransition(state, request).pipe(
    Result.map((transition) => transition.decision),
  );
}

export function recordEvaluationAttemptOutcome(
  state: QuerySyncState,
  attempt: QueryEvaluationAttempt,
  outcome: EvaluationAttemptOutcome,
): Result.Result<
  RecordEvaluationAttemptOutcomeDecision,
  RecordEvaluationAttemptOutcomeError
> {
  return applyRecordEvaluationAttemptOutcomeTransition(
    state,
    attempt,
    outcome,
  ).pipe(Result.map((transition) => transition.decision));
}
