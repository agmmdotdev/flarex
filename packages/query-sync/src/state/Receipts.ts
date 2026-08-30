import type {
  ClaimEvaluationWorkDecision,
  RecordEvaluationAttemptOutcomeDecision,
} from "../kernel/EvaluationWork.js";
import type {
  ApplyInvalidationsDecision,
  BeginQueryEvaluationDecision,
  CompleteQueryEvaluationDecision,
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
import type {
  ClaimPublicationDecision,
  CompletePublicationDecision,
  RecordPublicationAttemptOutcomeDecision,
} from "../kernel/PublicationWork.js";
import {
  attemptedPublicationReceipt,
  blockedClaimPublicationReceipt,
  blockedPublicationAttemptOutcomeReceipt,
  historicalPublicationAttemptOutcomeReceipt,
  nonePublicationReceipt,
  publicationCompletionReceipt,
  recordedPublicationAttemptOutcomeReceipt,
} from "../transition-plan/PublicationWork.js";
export type {
  ClaimPublicationReceipt,
  CompletePublicationReceipt,
  RecordPublicationAttemptOutcomeReceipt,
} from "../transition-plan/PublicationWork.js";
import type {
  ClaimPublicationReceipt,
  CompletePublicationReceipt,
  RecordPublicationAttemptOutcomeReceipt,
} from "../transition-plan/PublicationWork.js";

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
      // Publication attempts are nominal state-issued capabilities. Keep the
      // exact frozen value instead of manufacturing a structural copy.
      return attemptedPublicationReceipt(decision._tag, decision.attempt);
    case "blocked":
      return blockedClaimPublicationReceipt(
        decision.identity,
        decision.attemptOrdinal,
        decision.reason,
      );
    case "none":
      return nonePublicationReceipt();
  }
}

export function projectRecordPublicationAttemptOutcomeReceipt(
  decision: RecordPublicationAttemptOutcomeDecision,
): RecordPublicationAttemptOutcomeReceipt {
  switch (decision._tag) {
    case "recorded":
      return recordedPublicationAttemptOutcomeReceipt({
        identity: decision.identity,
        attemptOrdinal: decision.attemptOrdinal,
        nextAttemptOrdinal: decision.nextAttemptOrdinal,
        nextDisposition: decision.nextDisposition,
      });
    case "blocked":
      return blockedPublicationAttemptOutcomeReceipt(
        decision.identity,
        decision.attemptOrdinal,
        decision.reason,
      );
    case "superseded":
    case "recoveryEvidenceExpired":
      return historicalPublicationAttemptOutcomeReceipt(
        decision._tag,
        decision.identity,
        decision.attemptOrdinal,
      );
  }
}

export function projectCompletePublicationReceipt(
  decision: CompletePublicationDecision,
): CompletePublicationReceipt {
  return publicationCompletionReceipt(decision._tag, decision.identity);
}
