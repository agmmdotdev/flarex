import { Data } from "effect";
import type { TransactionAttemptFence } from "flarex-protocol/transaction-session";
import type {
  CommitSeq,
  ReplacementScopeIdV1,
} from "flarex-protocol/storage-authority";
import type {
  CommittedPointOutcomeMismatchV1,
  CommittedPointOutcomeSqlErrorV1,
  CommittedPointOutcomeInputErrorV1,
  CommittedPointOutcomeRequestKeyReuseErrorV1,
  CommittedPointOutcomeCorruptionErrorV1,
  ResolveCommittedPointOutcomeErrorV1,
} from "../committedPointOutcomeErrors";
import type {
  LoadAppUniqueConstraintSetEligibilityV1Error,
  AppUniqueConstraintSetEligibilityV1Error,
  AppUniqueConstraintSetBuildStaleAuthorityV1Error,
  AppUniqueConstraintSetBuildIntegrationV1Error,
  AppUniqueConstraintSetBuildStateV1Error,
} from "../../storage/unique/appUniqueConstraintSetBuildV1";
import type { FiniteMetadataConflict } from "flarex-protocol/commit-protocol";
import type { LogicalDocumentConflictObservation } from "../../storage/documents/logicalDocuments/contribution";
import type {
  AppDocumentIdV1,
  AppRowIdHexV1,
} from "flarex-protocol/app-document-id";
import type {
  CatalogTableId,
  CatalogIndexDefinitionId,
  CatalogEdgeDefinitionId,
} from "flarex-protocol/catalog";
import type {
  OrderedIndexKeyBytesHexV1,
  OrderedIndexRowIdHexV1,
} from "flarex-protocol/ordered-index";
import type { TransactionGrantDeploymentIdV1 } from "flarex-protocol/transaction-grant";
import type {
  ScopePublicationReferenceConstraintError,
  ScopePublicationReferenceCapacityError,
} from "../publication/scopePublicationModel";
import type { AppSchemaCandidateWriteGuardError } from "../../storage/catalog/appSchemaCandidateWriteGuardErrors";
import type {
  ApplicationRelationCommitUnavailableError,
  ApplicationRelationConstraintError,
  ApplicationRelationCommitResourceExhaustionError,
  ApplicationRelationTargetNotLiveError,
  ApplicationRelationTargetDeleteRestrictedError,
} from "../../application/relations/commit/Model";
import type { ReadApplicationRelationBindingError } from "../../application/relations/binding/Model";
import type { LocateAppDeveloperIndexDefinitionsV1Error } from "../../storage/indexes/appDeveloperIndexCommitV1";
import type { ReadAppUniqueConstraintSetClosureV1Error } from "../../storage/unique/appUniqueConstraintSetClosureV1";
import type { ReadAppIndexDefinitionError } from "../../storage/indexes/appIndexDefinitions";
import type { AppendAppIndexEntryRevisionV1Error } from "../../storage/indexes/appIndexEntryErrors";
import type {
  AppUniqueKeyConflictError,
  AppUniqueKeyHashError,
  CanonicalAppUniqueKeyHashCollisionError,
} from "../../storage/unique/appUniqueKeyErrors";

export type PointFiniteTerminalRefusal =
   PointCommitPublicationV1Error
  | PointMutationAttemptReplacementFiniteEntryError;

export class PointFiniteAttemptRetryBudgetExhaustedError extends Data.TaggedError(
  "PointFiniteAttemptRetryBudgetExhaustedError"
)<{
  readonly attemptFence: TransactionAttemptFence;
  readonly maximumAttempts: bigint;
}> {}

export class PointMutationAttemptReplacementCommittedOutcomeV1Error extends Data.TaggedError(
  "PointMutationAttemptReplacementCommittedOutcomeV1Error",
)<{
  readonly reason:  | "committedOutcomeAvailable" | "committedOutcomeExpired";
  readonly commitSeq: CommitSeq;
}> {}

export class PointMutationAttemptReplacementConflictNoLongerPresentV1Error extends Data.TaggedError(
  "PointMutationAttemptReplacementConflictNoLongerPresentV1Error",
)<{
  readonly reason: "conflictNoLongerPresent";
}> {}

export class PointMutationAttemptReplacementRequestKeyReuseV1Error extends Data.TaggedError(
  "PointMutationAttemptReplacementRequestKeyReuseV1Error",
)<{
  readonly mismatches: ReadonlyArray<CommittedPointOutcomeMismatchV1>;
}> {}

export type PointMutationAttemptReplacementCorruptionReasonV1 =
  | PointCommitCorruptionReasonV1
  | "committedOutcomeInvalid"
  | "attemptFenceUpdateInvalid"
  | "freshLeaseInvalid"
  | "freshJournalRootInvalid"
  | "finishingExecutionClaimPresent"
  | "replacementConvergenceInvalid"
  | "replacementMutationInvalid";

export class PointMutationAttemptReplacementCorruptionV1Error extends Data.TaggedError(
  "PointMutationAttemptReplacementCorruptionV1Error",
)<{
  readonly reason: PointMutationAttemptReplacementCorruptionReasonV1;
}> {}

export class PointMutationAttemptReplacementStaleAuthorityV1Error extends Data.TaggedError(
  "PointMutationAttemptReplacementStaleAuthorityV1Error",
)<{
  readonly reason: PointCommitStaleAuthorityReasonV1;
}> {}

export class PointMutationAttemptReplacementResourceExhaustionV1Error extends Data.TaggedError(
  "PointMutationAttemptReplacementResourceExhaustionV1Error",
)<{
  readonly dimension: "attemptFence";
  readonly maximum: bigint;
}> {}

export type PointMutationAttemptReplacementSqlOperationV1 =
  | PointCommitSqlOperationV1
  | "enterRetrying"
  | "deleteRetryJournal"
  | "deleteRetryLease"
  | "advanceAttemptFence"
  | "insertRetryLease"
  | "insertRetryJournalRoot"
  | "insertRetryExecutionClaim"
  | "enterRetryRunning"
  | "validateFinishingClaimAbsence"
  | "validatePristineAttempt";

export class PointMutationAttemptReplacementSqlErrorV1 extends Data.TaggedError(
  "PointMutationAttemptReplacementSqlErrorV1"
)<{
  readonly operation: PointMutationAttemptReplacementSqlOperationV1;
  readonly cause: unknown;
  readonly sqlState?: string;
}> {}

export type PointMutationAttemptReplacementV1Error =
  | PointFiniteAttemptRetryBudgetExhaustedError
  | PointMutationAttemptReplacementFiniteEntryError
  | PointMutationAttemptReplacementConfigurationV1Error
  | PointMutationAttemptReplacementCommittedOutcomeV1Error
  | PointMutationAttemptReplacementConflictNoLongerPresentV1Error
  | PointMutationAttemptReplacementRequestKeyReuseV1Error
  | PointMutationAttemptReplacementCorruptionV1Error
  | PointMutationAttemptReplacementStaleAuthorityV1Error
  | PointMutationAttemptReplacementResourceExhaustionV1Error
  | PointMutationAttemptReplacementSqlErrorV1;

export class PointMutationAttemptReplacementFiniteEntryError extends Data.TaggedError(
  "PointMutationAttemptReplacementFiniteEntryError",
)<{ readonly cause: unknown }> {}

export class PointMutationAttemptReplacementConfigurationV1Error extends Error {
  readonly name = "PointMutationAttemptReplacementConfigurationV1Error";

  constructor(
    readonly reason:
      | "leaseDurationInvalid"
      | "executionClaimDurationInvalid"
      | "executionClaimOwnerGenerationFailed"
      | "executionClaimOwnerInvalid",
  ) {
    super(`O08-A configuration is invalid: ${reason}.`);
  }
}

export type PointCommitConfirmedPreDecisionSqlStateV1 = "40001" | "40P01";

export class PointCommitConfirmedPreDecisionRollbackV1Error extends Data.TaggedError(
  "PointCommitConfirmedPreDecisionRollbackV1Error",
)<{
  readonly operation: PointCommitSqlOperationV1;
  readonly sqlState: PointCommitConfirmedPreDecisionSqlStateV1;
  readonly cause: unknown;
}> {}

export type PointCommitDecisionUncertainOutcomeCheckV1 =
  | Readonly<{ readonly kind: "missing" }>
  | Readonly<{
      readonly kind: "lookupFailed";
      readonly error: CommittedPointOutcomeSqlErrorV1;
    }>;

export class PointCommitDecisionUncertainV1Error extends Data.TaggedError(
  "PointCommitDecisionUncertainV1Error",
)<{
  readonly phase: "commitOrRelease";
  readonly cause: unknown;
  readonly outcomeCheck: PointCommitDecisionUncertainOutcomeCheckV1;
}> {}

export type PointCommitFinishingTransitionV1Error =
  | PointCommitStaleAuthorityV1Error
  | PointCommitCorruptionV1Error
  | PointCommitSqlErrorV1;

export class PointCommitUniqueConstraintEligibilityUnavailableV1Error extends Data.TaggedError(
  "PointCommitUniqueConstraintEligibilityUnavailableV1Error",
)<{
  readonly reason: "notSameFactory" | "compositionMismatch";
}> {}

export type LoadPointCommitUniqueConstraintEligibilityV1Error =
  | PointCommitUniqueConstraintEligibilityUnavailableV1Error
  | LoadAppUniqueConstraintSetEligibilityV1Error;

export type ValidatePointCommitUniqueConstraintEligibilityV1Error =
  | PointCommitUniqueConstraintEligibilityUnavailableV1Error
  | AppUniqueConstraintSetEligibilityV1Error
  | AppUniqueConstraintSetBuildStaleAuthorityV1Error
  | AppUniqueConstraintSetBuildIntegrationV1Error
  | AppUniqueConstraintSetBuildStateV1Error;

export type PointCommitPublicationV1Error =
  | PointFiniteAttemptRetryBudgetExhaustedError
  | PointCommitRollbackProofV1Error
  | PointCommitConfirmedPreDecisionRollbackV1Error
  | PointCommitDecisionUncertainV1Error
  | CommittedPointOutcomeInputErrorV1
  | CommittedPointOutcomeRequestKeyReuseErrorV1
  | CommittedPointOutcomeCorruptionErrorV1
  | CommittedPointOutcomeSqlErrorV1;

export type PointCommitOutcomeResolutionV1Error =
   | PointCommitFinishingTransitionV1Error | ResolveCommittedPointOutcomeErrorV1;

export type PointCommitConflictCauseV1 =
  | Readonly<FiniteMetadataConflict>
  | Readonly<{
      kind: "finiteRootGraph";
      observation: LogicalDocumentConflictObservation
    }>
  | Readonly<{
      readonly kind: "logicalParticipant";
      readonly participant: string;
      readonly syscallSequence: bigint;
    }>
  | Readonly<{
      readonly kind: "appRowPoint";
      readonly documentId: AppDocumentIdV1;
    }>
  | Readonly<{
      readonly kind: "appIndexRange";
      readonly reason: "overlap" | "validationWindowExceeded";
      readonly dependencyOrdinal: number;
      readonly tableId: CatalogTableId;
      readonly indexDefinitionId: CatalogIndexDefinitionId;
      readonly encodedKey?: OrderedIndexKeyBytesHexV1;
      readonly rowId?: OrderedIndexRowIdHexV1;
    }>
  | Readonly<{
      readonly kind: "appRelationIncoming";
      readonly edgeDefinitionId: CatalogEdgeDefinitionId;
      readonly targetRowId: AppRowIdHexV1;
    }>;

export interface PointCommitConflictEvidenceV1 {
  readonly conflict: PointCommitConflictCauseV1;
  readonly snapshotCommitSeq: CommitSeq;
  readonly currentCommitSeq: CommitSeq;
}

export class PointCommitConflictV1Error extends Data.TaggedError(
  "PointCommitConflictV1Error",
)<PointCommitConflictEvidenceV1> {}

export class AppDocumentInsertionConflictError extends Data.TaggedError(
  "AppDocumentInsertionConflictError"
)<{
  readonly documentId: AppDocumentIdV1;
}> {}

export type PointCommitStaleAuthorityReasonV1 =
  | "placementChanged"
  | "scopeChanged"
  | "generationChanged"
  | "epochChanged"
  | "revocationEpochChanged"
  | "activeSchemaChanged"
  | "activeRelationSelectionChanged"
  | "attemptMissing"
  | "attemptReplaced"
  | "lifecycleChanged"
  | "snapshotChanged"
  | "leaseMissing"
  | "leaseReplaced"
  | "expired";

export class PointCommitStaleAuthorityV1Error extends Data.TaggedError(
  "PointCommitStaleAuthorityV1Error",
)<{
  readonly reason: PointCommitStaleAuthorityReasonV1;
}> {}

export type PointCommitCorruptionReasonV1 =
  | "commandInvalid"
  | "finishingTransitionInvalid"
  | "readCommittedCapabilityMissing"
  | "orderedIndexCompositionInvalid"
  | "scopeClockInvalid"
  | "activeApplicationHeadInvalid"
  | "applicationWritePolicyDenied"
  | "applicationWritePolicyEvidenceInvalid"
  | "sessionDuplicate"
  | "sessionInvalid"
  | "leaseDuplicate"
  | "leaseInvalid"
  | "journalRootMissingOrDuplicate"
  | "journalRootInvalid"
  | "dependencySetInvalid"
  | "rowHeadInvalid"
  | "priorDocumentInvalid"
  | "occEvidenceInvalid"
  | "rowTransitionInvalid"
  | "rowWriteInvalid"
  | "intrinsicIndexBuildInvalid"
  | "intrinsicIndexTransitionInvalid"
  | "developerIndexBuildInvalid"
  | "developerIndexTransitionInvalid"
  | "uniqueConstraintDefinitionInvalid"
  | "uniqueConstraintBuildInvalid"
  | "uniqueKeyTransitionInvalid"
  | "relationBindingInvalid"
  | "relationTransitionInvalid"
  | "relationTargetEvidenceInvalid"
  | "relationEdgeInvalid"
  | "candidateSchemaValidationInvalid"
  | "successfulResultInvalid"
  | "committedOutcomeMissing"
  | "publishedOutcomeInvalid"
  | "publicationInvariantInvalid"
  | "rollbackSentinelMissing";

export class PointCommitCorruptionV1Error extends Data.TaggedError(
  "PointCommitCorruptionV1Error",
)<{
  readonly reason: PointCommitCorruptionReasonV1;
}> {}

export class PointCommitResourceExhaustionV1Error extends Data.TaggedError(
  "PointCommitResourceExhaustionV1Error",
)<{
  readonly dimension: "commitSequence";
  readonly maximum: bigint;
}> {}

export class PointCommitIntrinsicIndexDefinitionUnavailableV1Error extends Data.TaggedError(
  "PointCommitIntrinsicIndexDefinitionUnavailableV1Error",
)<{
  readonly deploymentId: TransactionGrantDeploymentIdV1;
  readonly scopeId: ReplacementScopeIdV1;
  readonly tableId: CatalogTableId;
}> {}

export class PointCommitDeveloperIndexMaintenanceUnavailableV1Error extends Data.TaggedError(
  "PointCommitDeveloperIndexMaintenanceUnavailableV1Error",
)<{
  readonly reason:
    | "definitionSetUnavailable"
    | "entryRevisionLimitExceeded"
    | "entryValueInvalid"
    | "entryKeyLimitExceeded";
  readonly observed?: number;
  readonly maximum?: number;
}> {}

export class PointCommitUniqueConstraintMaintenanceUnavailableV1Error extends Data.TaggedError(
  "PointCommitUniqueConstraintMaintenanceUnavailableV1Error",
)<{
  readonly reason:
    | "definitionPortInvalid"
    | "definitionSetUnavailable"
    | "mutationLimitExceeded"
    | "keyInvalid";
  readonly observed?: number;
  readonly maximum?: number;
  readonly cause?: unknown;
}> {}

export type PointCommitSqlOperationV1 =
  | "acceptPublication"
  | "applyPublication"
  | "resolveAuthority"
  | "beginOrRollback"
  | "lockScopeClock"
  | "validateActiveApplicationSchema"
  | "validateActiveRelationSelection"
  | "lockSession"
  | "lockLease"
  | "lockJournalRoot"
  | "lockExecutionClaim"
  | "readDatabaseTime"
  | "readBindingHead"
  | "readStrongReferenceFacts"
  | "readStrongReferenceFullFacts"
  | "readStrongReferenceProjection"
  | "enterFinishing"
  | "deleteExecutionClaim"
  | "loadRowHeads"
  | "validateIndexRanges"
  | "validateParticipantEvidence"
  | "validateRelationDependencies"
  | "lockIntrinsicIndexBuild"
  | "lockDeveloperIndexBuilds"
  | "loadPriorDocuments"
  | "loadRelationTargets"
  | "loadDeveloperIndexEntryHeads"
  | "loadUniqueKeyOwners"
  | "resetIntrinsicIndexValidation"
  | "resetDeveloperIndexValidation"
  | "maintainUniqueConstraintCoverage"
  | "validateCandidateSchema"
  | "writeTentativeRow"
  | "applyApplicationMaterialization"
  | "loadIntrinsicIndexEntryHeads"
  | "writeIndexEntries"
  | "writeUniqueKey"
  | "writeRelationEdges"
  | "validateRelationRestrict"
  | "recheckOutcome"
  | "writeCommitHeader"
  | "writeCommitChange"
  | "writeCommitRelationAdjacencyChange"
  | "writeOutcome"
  | "writeWake"
  | "deleteJournal"
  | "deleteLease"
  | "commitSession"
  | "advanceScopeClock";

export class PointCommitSqlErrorV1 extends Data.TaggedError(
  "PointCommitSqlErrorV1",
)<{
  readonly operation: PointCommitSqlOperationV1;
  readonly sqlState?: string;
  readonly cause: unknown;
}> {}

export type PointCommitRollbackProofV1Error =
  | PointCommitConflictV1Error
  | PointCommitStaleAuthorityV1Error
  | PointCommitCorruptionV1Error
  | PointCommitResourceExhaustionV1Error
  | PointCommitSqlErrorV1
  | PointCommitUnsupportedProfileV1Error
  | ScopePublicationReferenceConstraintError
  | ScopePublicationReferenceCapacityError
  | PointCommitIntrinsicIndexDefinitionUnavailableV1Error
  | PointCommitDeveloperIndexMaintenanceUnavailableV1Error
  | PointCommitUniqueConstraintMaintenanceUnavailableV1Error
  | AppSchemaCandidateWriteGuardError
  | ApplicationRelationCommitUnavailableError
  | ApplicationRelationConstraintError
  | ApplicationRelationCommitResourceExhaustionError
  | ApplicationRelationTargetNotLiveError
  | ApplicationRelationTargetDeleteRestrictedError
  | ReadApplicationRelationBindingError
  | LocateAppDeveloperIndexDefinitionsV1Error
  | ReadAppUniqueConstraintSetClosureV1Error
  | ReadAppIndexDefinitionError
  | AppendAppIndexEntryRevisionV1Error
  | AppDocumentInsertionConflictError
  | AppUniqueKeyConflictError
  | AppUniqueKeyHashError
  | CanonicalAppUniqueKeyHashCollisionError;

export class PointCommitUnsupportedProfileV1Error extends Data.TaggedError(
  "PointCommitUnsupportedProfileV1Error"
)<{
  readonly reason: "strongReferenceUnenforced";
}> {}

export function corruption(
  reason: PointCommitCorruptionReasonV1,
): PointCommitCorruptionV1Error {
  return new PointCommitCorruptionV1Error({ reason });
}
