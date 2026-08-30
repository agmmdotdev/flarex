import { Result } from "effect";

import type {
  PublicationAttemptInstant,
  PublicationAttemptOrdinal,
} from "./CanonicalValue.js";
import type {
  InvalidAcceptedPublicationEvidenceError,
  InvalidPublicationAttemptError,
  InvalidPublicationAttemptOutcomeReplayError,
  QuerySyncAuthorityError,
} from "./Errors.js";
import type {
  BuildQuerySyncStateError,
  PublicationBlockReason,
  QuerySyncState,
} from "./Model.js";
import type { QueryPublicationIdentity } from "./Publication.js";
import {
  applyClaimPublicationTransition,
  applyCompletePublicationTransition,
  applyRecordPublicationAttemptOutcomeTransition,
} from "./TransitionPlanAggregate.js";
export {
  admitAcceptedQueryPublicationAttempt,
  makeAcceptedQueryPublicationEvidenceForTesting,
  MAX_PUBLICATION_ATTEMPT_AGE_MILLISECONDS,
} from "../transition-plan/PublicationWork.js";
import type {
  AcceptedQueryPublicationEvidence,
  PublicationAttempt,
  PublicationAttemptOutcome,
} from "../transition-plan/PublicationWork.js";
export type {
  AcceptedQueryPublicationEvidence,
  PublicationAttempt,
  PublicationAttemptOutcome,
} from "../transition-plan/PublicationWork.js";

export type ClaimPublicationDecision =
  | Readonly<{
      readonly _tag: "claimed";
      readonly state: QuerySyncState;
      readonly attempt: PublicationAttempt;
    }>
  | Readonly<{
      readonly _tag: "replayed";
      readonly state: QuerySyncState;
      readonly attempt: PublicationAttempt;
    }>
  | Readonly<{
      readonly _tag: "blocked";
      readonly state: QuerySyncState;
      readonly identity: QueryPublicationIdentity;
      readonly attemptOrdinal: PublicationAttemptOrdinal;
      readonly reason: PublicationBlockReason;
      readonly resetRequired: true;
    }>
  | Readonly<{
      readonly _tag: "none";
      readonly state: QuerySyncState;
    }>;

export type RecordPublicationAttemptOutcomeDecision =
  | Readonly<{
      readonly _tag: "recorded";
      readonly state: QuerySyncState;
      readonly identity: QueryPublicationIdentity;
      readonly attemptOrdinal: PublicationAttemptOrdinal;
      readonly nextAttemptOrdinal: PublicationAttemptOrdinal;
      readonly nextDisposition: "ready" | "uncertain";
    }>
  | Readonly<{
      readonly _tag: "blocked";
      readonly state: QuerySyncState;
      readonly identity: QueryPublicationIdentity;
      readonly attemptOrdinal: PublicationAttemptOrdinal;
      readonly reason: PublicationBlockReason;
      readonly resetRequired: true;
    }>
  | Readonly<{
      readonly _tag: "superseded";
      readonly state: QuerySyncState;
      readonly identity: QueryPublicationIdentity;
      readonly attemptOrdinal: PublicationAttemptOrdinal;
    }>
  | Readonly<{
      readonly _tag: "recoveryEvidenceExpired";
      readonly state: QuerySyncState;
      readonly identity: QueryPublicationIdentity;
      readonly attemptOrdinal: PublicationAttemptOrdinal;
    }>;

export type CompletePublicationDecision =
  | Readonly<{
      readonly _tag: "completed";
      readonly state: QuerySyncState;
      readonly identity: QueryPublicationIdentity;
    }>
  | Readonly<{
      readonly _tag: "replayed";
      readonly state: QuerySyncState;
      readonly identity: QueryPublicationIdentity;
    }>
  | Readonly<{
      readonly _tag: "superseded";
      readonly state: QuerySyncState;
      readonly identity: QueryPublicationIdentity;
    }>;

export type ClaimPublicationError = BuildQuerySyncStateError;

export type RecordPublicationAttemptOutcomeError =
  | QuerySyncAuthorityError<"recordPublicationAttemptOutcome">
  | InvalidPublicationAttemptError
  | InvalidPublicationAttemptOutcomeReplayError
  | BuildQuerySyncStateError;

export type CompletePublicationError =
  | QuerySyncAuthorityError<"completePublication">
  | InvalidAcceptedPublicationEvidenceError
  | BuildQuerySyncStateError;

export function claimPublication(
  state: QuerySyncState,
  capturedNow: PublicationAttemptInstant,
): Result.Result<ClaimPublicationDecision, ClaimPublicationError> {
  return applyClaimPublicationTransition(state, capturedNow).pipe(
    Result.map((transition) => transition.decision),
  );
}

export function recordPublicationAttemptOutcome(
  state: QuerySyncState,
  attempt: PublicationAttempt,
  outcome: PublicationAttemptOutcome,
  capturedNow: PublicationAttemptInstant,
): Result.Result<
  RecordPublicationAttemptOutcomeDecision,
  RecordPublicationAttemptOutcomeError
> {
  return applyRecordPublicationAttemptOutcomeTransition(
    state,
    attempt,
    outcome,
    capturedNow,
  ).pipe(Result.map((transition) => transition.decision));
}

export function completePublication(
  state: QuerySyncState,
  evidence: AcceptedQueryPublicationEvidence,
): Result.Result<CompletePublicationDecision, CompletePublicationError> {
  return applyCompletePublicationTransition(state, evidence).pipe(
    Result.map((transition) => transition.decision),
  );
}
