import { isNonArrayRecord } from "@flarex/utils/records";
import {
  RESOLVE_POINT_COMMIT_OUTCOME_V1,
  type PointCommitFinishingTransitionPortV1,
  type PointCommitOutcomeResolutionPortV1,
  type PointCommitPublisherPortV1,
  type PointCommitRollbackProofPortV1,
  type PointMutationAttemptReplacementPortV1,
} from "@flarex/persistence-postgres/point-commit-transaction";
import type { StoredOccExecutionEvidenceLoaderV1 } from
  "@flarex/persistence-postgres/stored-occ-execution";
import type { PointMutationExecutionClaimLivenessV1 } from
  "@flarex/persistence-postgres/transaction-execution-claim-liveness";
import { Data } from "effect";

import type { PointMutationExecutionClaimDispatchAcquisitionV1 } from
  "../pointMutationExecutionClaimAcquisition";
import type { PointMutationJournalV1 } from "../pointMutationJournal";
import type {
  PointMutationSessionAttemptLoadingV1,
  PointMutationSessionAttemptTerminalizationV1,
} from "../pointMutationSessionActivation";
import type { PointMutationSessionAttemptDispositionV1 } from
  "../pointMutationSessionAttemptDisposition";

export type StoredPointMutationCapabilityStageV1 =
  | "authentication"
  | "planning"
  | "rollbackProof"
  | "publisher"
  | "finishingTransition"
  | "executor"
  | "attemptReplacement"
  | "occRerunAuthorization"
  | "occRerunExecution"
  | "crashRedispatch";

export type StoredPointMutationCapabilityRequirementV1 =
  | "commitAuthority"
  | "pointCommitRollbackProof"
  | "pointCommitPublisher"
  | "pointCommitFinishing"
  | "finishingEvidenceLoader"
  | "pointCommitOutcomeResolution"
  | "pointMutationAttemptReplacement"
  | "pointMutationOccAttemptLoading"
  | "pointMutationOccExecutionEvidence"
  | "pointMutationOccJournal"
  | "pointMutationOccTerminalization"
  | "pointMutationOccContextFactory"
  | "pointMutationOccRunner"
  | "pointMutationOccLiveness"
  | "pointMutationOccHeartbeatInterval"
  | "pointMutationRedispatchAcquisition"
  | "pointMutationRedispatchDisposition";

export class StoredPointMutationCapabilityConfigurationV1Defect
  extends Data.TaggedError(
    "StoredPointMutationCapabilityConfigurationV1Defect",
  )<{
    readonly stage: StoredPointMutationCapabilityStageV1;
    readonly missing: StoredPointMutationCapabilityRequirementV1;
  }> {}

export function requireStoredPointMutationCapabilityDependencyV1<Value>(
  stage: StoredPointMutationCapabilityStageV1,
  missing: StoredPointMutationCapabilityRequirementV1,
  value: Value | undefined,
): Value {
  if (value === undefined) {
    throw new StoredPointMutationCapabilityConfigurationV1Defect({
      stage,
      missing,
    });
  }
  return value;
}

export function isPointCommitRollbackProofPortV1(
  value: unknown,
): value is PointCommitRollbackProofPortV1 {
  return isNonArrayRecord(value) && typeof value.prove === "function";
}

export function isPointCommitPublisherPortV1(
  value: unknown,
): value is PointCommitPublisherPortV1 {
  return isPointCommitRollbackProofPortV1(value) &&
    typeof Reflect.get(value, "publish") === "function";
}

export function isPointCommitOutcomeResolutionPortV1(
  value: unknown,
): value is PointCommitOutcomeResolutionPortV1 {
  return isNonArrayRecord(value) && typeof Reflect.get(
    value,
    RESOLVE_POINT_COMMIT_OUTCOME_V1,
  ) === "function";
}

export function isPointCommitFinishingTransitionPortV1(
  value: unknown,
): value is PointCommitFinishingTransitionPortV1 {
  return isNonArrayRecord(value) &&
    typeof value.enterFinishing === "function";
}

export function isPointMutationAttemptReplacementPortV1(
  value: unknown,
): value is PointMutationAttemptReplacementPortV1 {
  return isNonArrayRecord(value) && typeof value.replace === "function";
}

export function isPointMutationSessionAttemptLoadingV1(
  value: unknown,
): value is PointMutationSessionAttemptLoadingV1 {
  return isNonArrayRecord(value) && typeof value.load === "function";
}

export function isStoredOccExecutionEvidenceLoaderV1(
  value: unknown,
): value is StoredOccExecutionEvidenceLoaderV1 {
  return isNonArrayRecord(value) && typeof value.loadEffect === "function";
}

export function isPointMutationJournalV1(
  value: unknown,
): value is PointMutationJournalV1 {
  return (
    isNonArrayRecord(value) &&
    typeof value.openAttempt === "function" &&
    typeof value.resolvePointTable === "function" &&
    typeof value.runPointOperation === "function" &&
    typeof value.sealSuccessfulResult === "function"
  );
}

export function isPointMutationSessionAttemptTerminalizationV1(
  value: unknown,
): value is PointMutationSessionAttemptTerminalizationV1 {
  return (
    isNonArrayRecord(value) &&
    typeof value.abort === "function" &&
    typeof value.expire === "function"
  );
}

export function isPointMutationExecutionClaimLivenessV1(
  value: unknown,
): value is PointMutationExecutionClaimLivenessV1 {
  return isNonArrayRecord(value) &&
    isNonArrayRecord(Reflect.get(value, "configuration")) &&
    typeof Reflect.get(value, "renewEffect") === "function";
}

export function isPointMutationExecutionClaimDispatchAcquisitionV1(
  value: unknown,
): value is PointMutationExecutionClaimDispatchAcquisitionV1 {
  return isNonArrayRecord(value) &&
    typeof Reflect.get(value, "acquireEffect") === "function";
}

export function isPointMutationSessionAttemptDispositionV1(
  value: unknown,
): value is PointMutationSessionAttemptDispositionV1 {
  return isNonArrayRecord(value) &&
    typeof Reflect.get(value, "disposeAbortOnly") === "function";
}
