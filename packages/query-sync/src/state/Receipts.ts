import type {
  PublicationAttemptOrdinal,
} from "../kernel/CanonicalValue.js";
import type {
  ClaimEvaluationWorkDecision,
  RecordEvaluationAttemptOutcomeDecision,
} from "../kernel/EvaluationWork.js";
import type {
  ApplyInvalidationsDecision,
  BeginQueryEvaluationDecision,
  CompleteQueryEvaluationDecision,
  PublicationBlockReason,
} from "../kernel/Model.js";
import {
  alreadyAdvancedBeginReceipt,
  appliedBatchReceipt,
  attemptedBeginReceipt,
  completedCompleteReceipt,
  duplicateApplyReceipt,
  gapApplyReceipt,
  notDirtyBeginReceipt,
  recoveryEvidenceExpiredCompleteReceipt,
  refreshRequiredCompleteReceipt,
  resetRequiredApplyReceipt,
  rerunRequiredCompleteReceipt,
  resnapshotRequiredCompleteReceipt,
  supersededCompleteReceipt,
} from "../transition-plan/Receipts.js";
import type {
  ApplyAdmittedBatchReceipt,
  BeginQueryEvaluationReceipt,
  CompleteQueryEvaluationReceipt,
} from "../transition-plan/Receipts.js";
import {
  blockedEvaluationWorkReceipt,
  claimedEvaluationWorkReceipt,
  continuedEvaluationWorkReceipt,
  eligibleEvaluationAttemptOutcomeReceipt,
  historicalEvaluationAttemptOutcomeReceipt,
  noneEvaluationWorkReceipt,
} from "../transition-plan/EvaluationWork.js";
export type {
  ClaimEvaluationWorkReceipt,
  RecordEvaluationAttemptOutcomeReceipt,
} from "../transition-plan/EvaluationWork.js";
import type {
  ClaimEvaluationWorkReceipt,
  RecordEvaluationAttemptOutcomeReceipt,
} from "../transition-plan/EvaluationWork.js";

export {
  epochReplacedReceipt,
  initializedNamespaceReceipt,
  modelReplacedReceipt,
} from "../transition-plan/Receipts.js";
export type {
  ApplyAdmittedBatchReceipt,
  BeginQueryEvaluationReceipt,
  CompleteQueryEvaluationReceipt,
  InitializeNamespaceReceipt,
} from "../transition-plan/Receipts.js";
import {
  freezeQueryPublicationIdentity,
} from "../kernel/Publication.js";
import type {
  QueryPublicationIdentity,
} from "../kernel/Publication.js";
import type {
  ClaimPublicationDecision,
  CompletePublicationDecision,
  PublicationAttempt,
  RecordPublicationAttemptOutcomeDecision,
} from "../kernel/PublicationWork.js";

export type ClaimPublicationReceipt =
  | Readonly<{
    readonly _tag: "claimed";
    readonly attempt: PublicationAttempt;
  }>
  | Readonly<{
    readonly _tag: "replayed";
    readonly attempt: PublicationAttempt;
  }>
  | Readonly<{
    readonly _tag: "blocked";
    readonly identity: QueryPublicationIdentity;
    readonly attemptOrdinal: PublicationAttemptOrdinal;
    readonly reason: PublicationBlockReason;
    readonly resetRequired: true;
  }>
  | Readonly<{
    readonly _tag: "none";
  }>;

export type RecordPublicationAttemptOutcomeReceipt =
  | Readonly<{
    readonly _tag: "recorded";
    readonly identity: QueryPublicationIdentity;
    readonly attemptOrdinal: PublicationAttemptOrdinal;
    readonly nextAttemptOrdinal: PublicationAttemptOrdinal;
    readonly nextDisposition: "ready" | "uncertain";
  }>
  | Readonly<{
    readonly _tag: "blocked";
    readonly identity: QueryPublicationIdentity;
    readonly attemptOrdinal: PublicationAttemptOrdinal;
    readonly reason: PublicationBlockReason;
    readonly resetRequired: true;
  }>
  | Readonly<{
    readonly _tag: "superseded";
    readonly identity: QueryPublicationIdentity;
    readonly attemptOrdinal: PublicationAttemptOrdinal;
  }>
  | Readonly<{
    readonly _tag: "recoveryEvidenceExpired";
    readonly identity: QueryPublicationIdentity;
    readonly attemptOrdinal: PublicationAttemptOrdinal;
  }>;

export type CompletePublicationReceipt =
  | Readonly<{
    readonly _tag: "completed";
    readonly identity: QueryPublicationIdentity;
  }>
  | Readonly<{
    readonly _tag: "replayed";
    readonly identity: QueryPublicationIdentity;
  }>
  | Readonly<{
    readonly _tag: "superseded";
    readonly identity: QueryPublicationIdentity;
  }>;

export function projectBeginReceipt(
  decision: BeginQueryEvaluationDecision,
): BeginQueryEvaluationReceipt {
  switch (decision._tag) {
    case "created":
    case "replayed":
      return attemptedBeginReceipt(decision._tag, decision.attempt);
    case "alreadyAdvanced":
      return alreadyAdvancedBeginReceipt({
        descriptor: decision.descriptor,
        requestedExpectedActiveGeneration:
          decision.requestedExpectedActiveGeneration,
        activeGeneration: decision.activeGeneration,
        freshThroughSequence: decision.freshThroughSequence,
      });
    case "notDirty":
      return notDirtyBeginReceipt({
        descriptor: decision.descriptor,
        activeGeneration: decision.activeGeneration,
        requestedDirtyThroughSequence:
          decision.requestedDirtyThroughSequence,
        freshThroughSequence: decision.freshThroughSequence,
      });
  }
}

export function projectApplyReceipt(
  decision: ApplyInvalidationsDecision,
): ApplyAdmittedBatchReceipt {
  switch (decision._tag) {
    case "duplicate":
      return duplicateApplyReceipt(decision.observedSequence);
    case "gap":
      return gapApplyReceipt(
        decision.expectedSequence,
        decision.observedSequence,
      );
    case "resetRequired":
      return resetRequiredApplyReceipt(
        decision.expectedSourceEpoch,
        decision.observedSourceEpoch,
      );
    case "applied":
      return appliedBatchReceipt(
        decision.appliedSequence,
        decision.affectedQueryKeys,
      );
  }
}

export function projectCompleteReceipt(
  decision: CompleteQueryEvaluationDecision,
): CompleteQueryEvaluationReceipt {
  switch (decision._tag) {
    case "refreshRequired":
      return refreshRequiredCompleteReceipt(
        decision.refreshedThroughSequence,
        decision.requiredThroughSequence,
      );
    case "resnapshotRequired":
      return resnapshotRequiredCompleteReceipt(decision.generation);
    case "rerunRequired":
      return rerunRequiredCompleteReceipt(
        decision.generation,
        decision.relevantThroughSequence,
      );
    case "completed":
    case "replayed":
      return completedCompleteReceipt(
        decision._tag,
        decision.generation,
        decision.publicationDisposition,
      );
    case "superseded":
      return supersededCompleteReceipt(
        decision.generation,
        decision.activeGeneration,
      );
    case "recoveryEvidenceExpired":
      return recoveryEvidenceExpiredCompleteReceipt(
        decision.generation,
        decision.activeGeneration,
      );
  }
}

export function projectClaimEvaluationWorkReceipt(
  decision: ClaimEvaluationWorkDecision,
): ClaimEvaluationWorkReceipt {
  switch (decision._tag) {
    case "claimed":
      // These are process-local state-issued capabilities. Preserve their
      // exact identities so their private runtime authenticity remains valid.
      return claimedEvaluationWorkReceipt(
        decision.attempt,
        decision.continuation,
      );
    case "continued":
    case "scanRestarted":
      return continuedEvaluationWorkReceipt(
        decision._tag,
        decision.continuation,
      );
    case "blocked":
      return blockedEvaluationWorkReceipt(decision.blockedWork);
    case "none":
      return noneEvaluationWorkReceipt();
  }
}

export function projectRecordEvaluationAttemptOutcomeReceipt(
  decision: RecordEvaluationAttemptOutcomeDecision,
): RecordEvaluationAttemptOutcomeReceipt {
  switch (decision._tag) {
    case "eligible":
      return eligibleEvaluationAttemptOutcomeReceipt(
        decision.queryKey,
        decision.generation,
      );
    case "blocked":
      return blockedEvaluationWorkReceipt(decision.blockedWork);
    case "superseded":
    case "recoveryEvidenceExpired":
      return historicalEvaluationAttemptOutcomeReceipt(
        decision._tag,
        decision.queryKey,
        decision.generation,
        decision.activeGeneration,
      );
  }
}

export function projectClaimPublicationReceipt(
  decision: ClaimPublicationDecision,
): ClaimPublicationReceipt {
  switch (decision._tag) {
    case "claimed":
    case "replayed":
      return Object.freeze({
        _tag: decision._tag,
        // Publication attempts are nominal state-issued capabilities. Keep the
        // exact frozen value instead of manufacturing a structural copy.
        attempt: decision.attempt,
      });
    case "blocked":
      return Object.freeze({
        _tag: "blocked",
        identity: freezeQueryPublicationIdentity(decision.identity),
        attemptOrdinal: decision.attemptOrdinal,
        reason: decision.reason,
        resetRequired: true,
      });
    case "none":
      return Object.freeze({ _tag: "none" });
  }
}

export function projectRecordPublicationAttemptOutcomeReceipt(
  decision: RecordPublicationAttemptOutcomeDecision,
): RecordPublicationAttemptOutcomeReceipt {
  switch (decision._tag) {
    case "recorded":
      return Object.freeze({
        _tag: "recorded",
        identity: freezeQueryPublicationIdentity(decision.identity),
        attemptOrdinal: decision.attemptOrdinal,
        nextAttemptOrdinal: decision.nextAttemptOrdinal,
        nextDisposition: decision.nextDisposition,
      });
    case "blocked":
      return Object.freeze({
        _tag: "blocked",
        identity: freezeQueryPublicationIdentity(decision.identity),
        attemptOrdinal: decision.attemptOrdinal,
        reason: decision.reason,
        resetRequired: true,
      });
    case "superseded":
    case "recoveryEvidenceExpired":
      return Object.freeze({
        _tag: decision._tag,
        identity: freezeQueryPublicationIdentity(decision.identity),
        attemptOrdinal: decision.attemptOrdinal,
      });
  }
}

export function projectCompletePublicationReceipt(
  decision: CompletePublicationDecision,
): CompletePublicationReceipt {
  return Object.freeze({
    _tag: decision._tag,
    identity: freezeQueryPublicationIdentity(decision.identity),
  });
}
