import type { ResolveCommittedPointOutcomeErrorV1 } from "../../commit/committedPointOutcomeErrors";
import type {
  PointMutationExecutionClaimLivenessV1Error,
} from "./transactionExecutionClaimLiveness";
import type { ProjectExecutionClaimRenewalIssueV1 } from "./renewalProjection";
import type {
  TransactionExecutionClaimCorruptionReasonV1,
} from "./transactionExecutionClaimPersistence";
import { Data } from "effect";
import type { ScopeId } from "flarex-protocol/storage-authority";

export class PointMutationExecutionClaimAcquisitionInputV1Error
  extends Data.TaggedError(
    "PointMutationExecutionClaimAcquisitionInputV1Error",
  )<{
    readonly reason: "invalidSelector";
    readonly cause?: unknown;
  }> {}

export class PointMutationExecutionClaimAcquisitionConfigurationV1Error
  extends Data.TaggedError(
    "PointMutationExecutionClaimAcquisitionConfigurationV1Error",
  )<{
    readonly reason:
      | "invalidClaimDuration"
      | "claimOwnerGenerationFailed"
      | "claimOwnerInvalid";
    readonly cause?: unknown;
  }> {}

export class PointMutationExecutionClaimAcquisitionStaleV1Error
  extends Data.TaggedError(
    "PointMutationExecutionClaimAcquisitionStaleV1Error",
  )<{
    readonly reason:
      | "scopeChanged"
      | "deploymentChanged"
      | "attemptMissing"
      | "attemptReplaced"
      | "lifecycle"
      | "generationChanged"
      | "epochChanged"
      | "revocationEpochChanged"
      | "leaseExpired"
      | "authorizationExpired";
  }> {}

export class PointMutationExecutionClaimAcquisitionCorruptionV1Error
  extends Data.TaggedError(
    "PointMutationExecutionClaimAcquisitionCorruptionV1Error",
  )<{
    readonly reason:
      | "preludeInvalid"
      | "committedOutcomeInvalid"
      | "committedOutcomeMissing"
      | "sessionInvalid"
      | "leaseInvalid"
      | "journalRootInvalid"
      | "claimInvalid"
      | "claimMutationInvalid";
    readonly cause?: unknown;
  }> {}

export class PointMutationExecutionClaimAcquisitionResourceV1Error
  extends Data.TaggedError(
    "PointMutationExecutionClaimAcquisitionResourceV1Error",
  )<{
    readonly dimension: "claimFence";
    readonly maximum: bigint;
  }> {}

export class PointMutationExecutionClaimAcquisitionPersistenceV1Error
  extends Data.TaggedError(
    "PointMutationExecutionClaimAcquisitionPersistenceV1Error",
  )<{
    readonly operation: "prelude" | "transaction";
    readonly cause: unknown;
  }> {}

export type PointMutationExecutionClaimAcquisitionV1Error =
  | PointMutationExecutionClaimAcquisitionInputV1Error
  | PointMutationExecutionClaimAcquisitionConfigurationV1Error
  | PointMutationExecutionClaimAcquisitionStaleV1Error
  | PointMutationExecutionClaimAcquisitionCorruptionV1Error
  | PointMutationExecutionClaimAcquisitionResourceV1Error
  | PointMutationExecutionClaimAcquisitionPersistenceV1Error
  | ResolveCommittedPointOutcomeErrorV1;

export function mapExecutionClaimRenewalIssue(
  issue: ProjectExecutionClaimRenewalIssueV1,
): PointMutationExecutionClaimLivenessV1Error {
  switch (issue) {
    case "authorityExpired":
      return new PointMutationExecutionClaimLivenessStaleV1Error({
        reason: "authorizationExpired",
      });
    case "leaseExpired":
      return new PointMutationExecutionClaimLivenessStaleV1Error({
        reason: "leaseExpired",
      });
    case "claimExpired":
      return new PointMutationExecutionClaimLivenessStaleV1Error({
        reason: "claimExpired",
      });
    case "claimAfterLease":
    case "leaseAfterAuthorityTarget":
    case "leaseRetentionBudgetExceeded":
    case "sealedLeaseMismatch":
      return executionClaimLivenessCorruption("claimLeaseOrderingInvalid");
    case "invalidEvidence":
      return executionClaimLivenessCorruption("clockInvalid");
  }
}

export function executionClaimLivenessCorruption(
  reason: PointMutationExecutionClaimLivenessCorruptionV1Error["reason"],
  cause?: unknown,
): PointMutationExecutionClaimLivenessCorruptionV1Error {
  return new PointMutationExecutionClaimLivenessCorruptionV1Error({
    reason,
    ...(cause === undefined ? {} : { cause }),
  });
}

export class TransactionExecutionClaimCorruptionV1Error extends Data.TaggedError(
  "TransactionExecutionClaimCorruptionV1Error"
)<{
  readonly scopeId: ScopeId;
  readonly reason: TransactionExecutionClaimCorruptionReasonV1;
  readonly cause?: unknown;
}> {}

export class TransactionExecutionClaimStaleV1Error extends Data.TaggedError(
  "TransactionExecutionClaimStaleV1Error"
)<{
  readonly scopeId: ScopeId;
  readonly reason:  | "claimOwnerMismatch" | "claimFenceMismatch" | "claimExpired";
}> {}

export class PointMutationExecutionClaimLivenessInputV1Error
  extends Data.TaggedError("PointMutationExecutionClaimLivenessInputV1Error")<{
    readonly reason: "invalidInput";
    readonly cause?: unknown;
  }> {}

export class PointMutationExecutionClaimLivenessConfigurationV1Error
  extends Data.TaggedError(
    "PointMutationExecutionClaimLivenessConfigurationV1Error",
  )<{
    readonly reason:
      | "invalidClaimDuration"
      | "invalidLeaseRenewalDuration"
      | "claimDurationExceedsLeaseRenewalDuration"
      | "leaseRenewalDurationExceedsRetentionBudget";
  }> {}

export class PointMutationExecutionClaimLivenessStaleV1Error
  extends Data.TaggedError("PointMutationExecutionClaimLivenessStaleV1Error")<{
    readonly reason:
      | "scopeChanged"
      | "deploymentChanged"
      | "attemptMissing"
      | "attemptReplaced"
      | "lifecycleChanged"
      | "generationChanged"
      | "epochChanged"
      | "revocationEpochChanged"
      | "leaseExpired"
      | "authorizationExpired"
      | "claimOwnerChanged"
      | "claimFenceChanged"
      | "claimExpired";
  }> {}

export class PointMutationExecutionClaimLivenessCorruptionV1Error
  extends Data.TaggedError(
    "PointMutationExecutionClaimLivenessCorruptionV1Error",
  )<{
    readonly reason:
      | "clockInvalid"
      | "sessionInvalid"
      | "leaseInvalid"
      | "journalRootInvalid"
      | "claimInvalid"
      | "claimLeaseOrderingInvalid"
      | "mutationInvalid";
    readonly cause?: unknown;
  }> {}

export class PointMutationExecutionClaimLivenessPersistenceV1Error
  extends Data.TaggedError(
    "PointMutationExecutionClaimLivenessPersistenceV1Error",
  )<{
    readonly operation: "prelude" | "transaction";
    readonly cause: unknown;
  }> {}

export class PointMutationExecutionClaimLivenessUncertainV1Error
  extends Data.TaggedError(
    "PointMutationExecutionClaimLivenessUncertainV1Error",
  )<{
    readonly cause: unknown;
  }> {}
