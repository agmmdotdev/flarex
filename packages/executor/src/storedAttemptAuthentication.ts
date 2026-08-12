import { isNonArrayRecord } from "@flarex/utils/records";
import { Effect } from "effect";

import type {
  PointCommitFinishingTransitionPortV1,
  PointCommitFinishingTransitionV1Error,
  PointCommitPublicationResultV1,
  PointCommitPublicationV1Error,
  PointCommitOutcomeResolutionV1Error,
  PointCommitOutcomeResolutionPortV1,
  PointCommitPublisherPortV1,
  PointCommitRollbackProofPortV1,
  PointCommitRollbackProofV1Error,
  PointCommitWouldCommitV1,
  PointCommitConflictEvidenceV1,
  PointMutationAttemptReplacementObservationV1,
  PointMutationAttemptReplacementPortV1,
  PointMutationAttemptReplacementV1Error,
  CommittedPointOutcomeResolutionV1,
} from "@flarex/persistence-postgres/point-commit-transaction";
import {
  PointCommitConfirmedPreDecisionRollbackV1Error,
  PointCommitDecisionUncertainV1Error,
} from "@flarex/persistence-postgres/point-commit-transaction";
import type {
  StoredOccExecutionEvidenceLoaderV1,
} from "@flarex/persistence-postgres/stored-occ-execution";
import type {
  AuthenticatedApplicationMutationCommitAuthorityGraph,
} from "@flarex/persistence-postgres/internal/application-mutation-commit-authority-graph";
import {
  type PointMutationExecutionClaimAcquisitionV1Error,
  type PointMutationSessionAttemptSelectorV1,
} from
  "@flarex/persistence-postgres/transaction-session-activation";
import type { TransactionExecutionClaimPinV1 } from "@flarex/persistence-postgres/transaction-execution-claim";
import type { PointMutationExecutionClaimLivenessV1 } from
  "@flarex/persistence-postgres/transaction-execution-claim-liveness";

import type { AppCreationTimeV1 } from "flarex-protocol/app-document";
import type { AppDocumentIdV1 } from "flarex-protocol/app-document-id";
import type { CatalogTableId } from "flarex-protocol/catalog";
import {
  type CommitFinalSyscallSequenceV1,
  type CommitMaterialWriteEventEvidenceBytesV1,
  type CanonicalSuccessfulResultV1,
  type SessionJournalV1,
} from "flarex-protocol/commit-protocol";
import {
  type Json,
  type JsonObject,
} from "flarex-protocol/json";
import {
  type CatalogSchemaVersionId,
  type SchemaManifestAppSchemaV1,
} from "flarex-protocol/schema-manifest";
import {
  PointMutationTargetSelectionV1Error,
  type PointMutationTargetFunctionMetadataV1,
} from "flarex-protocol/point-mutation-start";
import {
  type FlarexDbV1StorageGeneration,
  type ReplacementScopeIdV1,
  type ScopeUuidV1,
  type SnapshotToken,
  type StorageGenerationFence,
} from "flarex-protocol/storage-authority";
import type {
  TransactionGrantDeploymentIdV1,
} from "flarex-protocol/transaction-grant";
import {
  type StoredTransactionSessionScalarsV1,
  type TransactionAttemptFence,
  type TransactionSessionIdV1,
  type TransactionSessionLifecycleV1,
} from "flarex-protocol/transaction-session";
import {
  type CanonicalFlarexRuntimeValueV1,
  type FlarexValueCodecVersion,
} from "flarex-protocol/value";
import type {
  InertApplicationMutationGrantEvidenceV1,
} from "flarex-protocol/internal/application-mutation-grant-v1";

import {
  ActivatedPointMutationSessionBusyV1Error,
  InvalidActivatedPointMutationSessionV1Error,
  type ActivatedPointMutationSessionV1,
  type PointMutationSessionAttemptLoadingExecutionV1Error,
  type PointMutationSessionAttemptLoadingV1,
  type PointMutationSessionAttemptTerminalizationV1,
  type LoadedPointMutationSessionAttemptV1,
} from "./pointMutationSessionActivation";
import type {
  PointMutationSessionAttemptDispositionExecutionV1Error,
  PointMutationSessionAttemptDispositionV1,
} from "./pointMutationSessionAttemptDisposition";
import type {
  PointMutationJournalBoundaryV1Error,
  PointMutationJournalTableV1,
  PointMutationJournalV1,
} from "./pointMutationJournal";
import type {
  PointMutationJournalResultRejectedV1Error,
} from "./pointMutationJournalRpc";
import type {
  PointMutationExactRuntimeRunnerHostV1Error,
} from "./pointMutationExactRuntimeRunner";
import {
  type InvalidPointMutationSessionAttemptSelectorV1Error,
} from "./pointMutationSessionAttemptSelector";
import {
  InvalidPointMutationExecutionClaimV1Error,
  type PointMutationExecutionScopeV1,
  type PointMutationExecutionClaimVaultV1,
} from "./pointMutationExecutionClaim";
import {
  createPointMutationExecutionLivenessCoordinatorV1,
} from "./pointMutationExecutionClaimLiveness";
import type {
  PointMutationExecutionClaimDispatchAcquisitionV1,
} from "./pointMutationExecutionClaimAcquisition";
import {
  findTransactionGrantVerificationKernelV1,
  type TransactionGrantVerificationV1Error,
  type VerifiedTransactionGrantInspectionV1,
} from "./transactionGrantVerificationKernel";
import {
  InvalidAuthenticatedStoredAttemptV1Error,
  PinnedFunctionMetadataSourceV1Error,
  StoredCommitAuthorityConfigurationV1Error,
  StoredCommitAuthorityCorruptionV1Error,
  StoredCommitAuthorityMismatchV1Error,
  StoredCommitAuthorityNotPlannableV1Error,
  StoredCommitAuthorityPersistenceV1Error,
  type StoredCommitAuthorityAuthenticationConfigV1,
  type StoredCommitAuthoritySchemaEvidencePortV1,
} from "./storedAttemptAuthentication/commitAuthorityModel";
import {
  StoredPointMutationCapabilityConfigurationV1Defect,
  isPointCommitFinishingTransitionPortV1,
  isPointCommitOutcomeResolutionPortV1,
  isPointCommitPublisherPortV1,
  isPointCommitRollbackProofPortV1,
  isPointMutationAttemptReplacementPortV1,
  isPointMutationExecutionClaimDispatchAcquisitionV1,
  isPointMutationExecutionClaimLivenessV1,
  isPointMutationJournalV1,
  isPointMutationSessionAttemptDispositionV1,
  isPointMutationSessionAttemptLoadingV1,
  isPointMutationSessionAttemptTerminalizationV1,
  isStoredOccExecutionEvidenceLoaderV1,
  requireStoredPointMutationCapabilityDependencyV1,
  supportsPointCommitDeveloperIndexMaintenanceV1,
  supportsPointCommitUniqueConstraintEligibilityV1,
  supportsPointCommitUniqueConstraintMaintenanceV1,
  type StoredPointMutationCapabilityStageV1,
} from "./storedAttemptAuthentication/capabilityRuntimeConstruction";
import {
  makeStoredPointMutationCapabilityVaultV1,
} from "./storedAttemptAuthentication/capabilityState";
import {
  InvalidStoredAttemptAuthorityV1Error,
  StoredAttemptAlreadyCommittedV1Error,
  StoredAttemptAuthorityMismatchV1Error,
  StoredAttemptNotPlannableV1Error,
  StoredAttemptPersistenceV1Error,
  StoredAttemptStorageCorruptionV1Error,
  type StoredAttemptAuthenticationV1Error,
} from "./storedAttemptAuthentication/authenticationErrors";
import {
  makeStoredAttemptAuthenticationOperationsV1,
  type AuthenticatedStoredAttemptV1,
  type TrustedStoredAttemptAuthorityV1,
} from "./storedAttemptAuthentication/authenticationOperations";
import type {
  AuthenticatedStoredAttemptPointV1,
} from "./storedAttemptAuthentication/authenticationVerification";
import {
  verifyCommitAuthorityEvidenceEffect,
} from "./storedAttemptAuthentication/commitAuthorityVerification";
import type {
  CommitInputVerificationV1Error,
} from "./storedAttemptAuthentication/commitInputVerification";
import {
  InvalidVerifiedCommitInputV1Error,
  PointCommitUniqueConstraintEligibilityV1Error,
  UnsupportedPointCommitPlanV1Error,
} from "./storedAttemptAuthentication/pointCommitPlanning";
import {
  InvalidPreparedPointCommitV1Error,
  makeStoredPointCommitPlanningOperationsV1,
  type AuthenticatedCommitAuthorityV1,
  type FinishingPreparedPointCommitV1,
  type PreparedPointCommitV1,
  type VerifiedCommitInputV1,
} from "./storedAttemptAuthentication/planningOperations";
import {
  makeStoredPointCommitPublicationOperationsV1,
  makeStoredPointCommitRollbackProofOperationsV1,
} from "./storedAttemptAuthentication/pointCommitPersistenceOperations";
import {
  capturePointCommitFinishingTransitionCommand,
  capturePointCommitPublicationCommand,
  capturePointCommitTransactionCommand,
  capturePointMutationAttemptReplacementCommand,
  capturePointMutationSessionAttemptSelector,
  pointCommitPublicationCommandsEqual,
  rebaseFinishingPreparedPointCommitState,
} from "./storedAttemptAuthentication/pointCommitRuntimeModel";
import {
  PointCommitKnownSettledSqlRetryExhaustedV1Error,
  PointCommitUncertainOutcomeRecoveryCorruptionV1Error,
  PointCommitUncertainOutcomeUnresolvedV1Error,
  makeStoredPointCommitExecutionPublicationOperationsV1,
  makeStoredPointCommitKnownSettledPublicationOperationsV1,
  makeStoredPointCommitFinishingTransitionOperationsV1,
} from "./storedAttemptAuthentication/finishingOperations";
import {
  PointMutationOccRerunAuthorityCorruptionV1Error,
  PointMutationOccRerunFreshAttemptV1Error,
  makeStoredPointMutationAttemptReplacementOperationsV1,
  makeStoredPointMutationFreshAttemptHandoffOperationsV1,
  type AuthorizedPointMutationOccRerunV1,
  type PointMutationOccRerunOwnershipLostV1Error,
} from "./storedAttemptAuthentication/attemptReplacementOperations";
import {
  InvalidAuthorizedPointMutationOccRerunV1Error,
  InvalidPointMutationOccConflictV1Error,
  PointMutationOccRerunExhaustedV1Error,
  makePointCommitOutcomeTicketCaptureOperationsV1,
  makeStoredPointMutationOccRerunAuthorizationOperationsV1,
} from "./storedAttemptAuthentication/occRerunAuthorizationOperations";
import {
  makeStoredPointMutationOccRerunExecutionOperationsV1,
} from "./storedAttemptAuthentication/occRerunExecutionOperations";
import {
  PointMutationInitialExecutionAuthorityV1Error,
  makeInitialPointMutationExecutionOperationsV1,
} from "./storedAttemptAuthentication/initialPointMutationExecutionOperations";
import {
  makeStoredPointMutationCrashRedispatchOperationsV1,
} from "./storedAttemptAuthentication/crashRedispatchOperations";
import {
  PointMutationOccApplicationErrorV1,
  PointMutationOccUserCodeV1Error,
  makeExactPointMutationExecutionOperationsV1,
  type PointMutationAuthenticatedAttemptExecutionV1Error,
} from "./storedAttemptAuthentication/exactPointMutationExecutionOperations";

export {
  InvalidAuthenticatedStoredAttemptV1Error,
  PinnedFunctionMetadataSourceV1Error,
  StoredCommitAuthorityConfigurationV1Error,
  StoredCommitAuthorityCorruptionV1Error,
  StoredCommitAuthorityMismatchV1Error,
  StoredCommitAuthorityNotPlannableV1Error,
  StoredCommitAuthorityPersistenceV1Error,
} from "./storedAttemptAuthentication/commitAuthorityModel";

export {
  PointMutationInitialExecutionAuthorityV1Error,
} from "./storedAttemptAuthentication/initialPointMutationExecutionOperations";

export type {
  PinnedPointMutationFunctionMetadataReaderPortV1,
  PinnedPointMutationFunctionMetadataSelectorV1,
  StoredCommitAuthorityAuthenticationConfigV1,
  StoredCommitAuthorityCorruptionReasonV1,
  StoredCommitAuthorityEvidenceAuthorityPortV1,
  StoredCommitAuthorityEvidenceLoaderPortV1,
  StoredCommitAuthorityEvidenceLoadResultPortV1,
  StoredCommitAuthorityEvidencePersistencePortErrorV1,
  StoredCommitAuthorityEvidencePortV1,
  StoredCommitAuthoritySchemaEvidencePortV1,
  StoredCommitAuthoritySessionEvidencePortV1,
} from "./storedAttemptAuthentication/commitAuthorityModel";

export {
  InvalidStoredAttemptAuthorityV1Error,
  StoredAttemptAlreadyCommittedV1Error,
  StoredAttemptAuthorityMismatchV1Error,
  StoredAttemptEnvelopeMismatchV1Error,
  StoredAttemptNotPlannableV1Error,
  StoredAttemptPersistenceV1Error,
  StoredAttemptStorageCorruptionV1Error,
} from "./storedAttemptAuthentication/authenticationErrors";

export type {
  StoredAttemptAuthenticationV1Error,
} from "./storedAttemptAuthentication/authenticationErrors";

export type {
  AuthenticatedStoredAttemptV1,
  TrustedStoredAttemptAuthorityV1,
} from "./storedAttemptAuthentication/authenticationOperations";

export type {
  AuthenticatedStoredAttemptPointV1,
} from "./storedAttemptAuthentication/authenticationVerification";

export {
  CommitDocumentValidationV1Error,
  CommitInputAuthorityCorruptionV1Error,
  CommitSuccessfulResultValidationV1Error,
  InvalidAuthenticatedCommitAuthorityV1Error,
} from "./storedAttemptAuthentication/commitInputVerification";

export type {
  CommitDocumentValidationIssueV1,
  CommitInputAuthorityCorruptionReasonV1,
  CommitInputVerificationV1Error,
  VerifiedCommitPointV1,
  VerifiedSuccessfulResultV1,
} from "./storedAttemptAuthentication/commitInputVerification";

export {
  InvalidVerifiedCommitInputV1Error,
  PointCommitPlannerInvariantV1Defect,
  PointCommitUniqueConstraintEligibilityV1Error,
  UnsupportedPointCommitPlanV1Error,
} from "./storedAttemptAuthentication/pointCommitPlanning";

export type {
  PointCommitPlannerInvariantV1DefectReason,
} from "./storedAttemptAuthentication/pointCommitPlanning";

export type {
  AuthenticatedCommitAuthorityV1,
  FinishingPreparedPointCommitV1,
  PreparedPointCommitV1,
  VerifiedCommitInputV1,
} from "./storedAttemptAuthentication/planningOperations";

export {
  InvalidPreparedPointCommitV1Error,
} from "./storedAttemptAuthentication/planningOperations";

export {
  PointMutationOccRerunAuthorityCorruptionV1Error,
  PointMutationOccRerunFreshAttemptV1Error,
  PointMutationOccRerunOwnershipLostV1Error,
} from "./storedAttemptAuthentication/attemptReplacementOperations";

export type {
  AuthorizedPointMutationOccRerunV1,
  PointMutationOccRerunFreshAttemptMismatchV1,
} from "./storedAttemptAuthentication/attemptReplacementOperations";

export {
  InvalidAuthorizedPointMutationOccRerunV1Error,
  InvalidPointMutationOccConflictV1Error,
  PointMutationOccRerunExhaustedV1Error,
} from "./storedAttemptAuthentication/occRerunAuthorizationOperations";

export {
  PointMutationOccExecutionAuthorityCorruptionV1Error,
  PointMutationOccExecutionAuthorityMismatchV1Error,
  PointMutationOccExecutionEvidencePersistenceV1Error,
  PointMutationOccExecutionNotRunnableV1Error,
} from "./storedAttemptAuthentication/occRerunExecutionOperations";

export {
  PointCommitKnownSettledSqlRetryExhaustedV1Error,
  PointCommitUncertainOutcomeRecoveryCorruptionV1Error,
  PointCommitUncertainOutcomeUnresolvedV1Error,
} from "./storedAttemptAuthentication/finishingOperations";

type PointCommitOutcomeLookupSqlFailureV1 = Extract<
  PointCommitOutcomeResolutionV1Error,
  {
    readonly _tag:
      | "PointCommitSqlErrorV1"
      | "CommittedPointOutcomeSqlErrorV1";
  }
>;

export type PointCommitUncertainOutcomeSecondaryV1 =
  | Readonly<{
      readonly kind: "outcomeLookupFailed";
      readonly error: PointCommitOutcomeLookupSqlFailureV1;
    }>
  | Readonly<{
      readonly kind: "secondDecisionUncertain";
      readonly error: PointCommitDecisionUncertainV1Error;
    }>;

export interface PointCommitKnownSettledSqlRetryFailureV1 {
  readonly operation:
    PointCommitConfirmedPreDecisionRollbackV1Error["operation"];
  readonly sqlState:
    PointCommitConfirmedPreDecisionRollbackV1Error["sqlState"];
  readonly cause: unknown;
}

export {
  PointMutationOccApplicationErrorV1,
  PointMutationOccExecutionContextV1Error,
  PointMutationOccUserCodeV1Error,
} from "./storedAttemptAuthentication/exactPointMutationExecutionOperations";

export interface PointMutationOccExecutionContextV1 {
  readonly executionId: string;
  readonly logScopeId: string;
  readonly randomSeed: Uint8Array;
  readonly executionTime: AppCreationTimeV1;
  readonly initialCreationTimeCursor: AppCreationTimeV1;
  readonly attemptFence: TransactionAttemptFence;
  readonly snapshotToken: SnapshotToken;
}

export interface PointMutationOccBoundJournalV1 {
  readonly resolvePointTable: (
    tableName: unknown,
  ) => ReturnType<PointMutationJournalV1["resolvePointTable"]>;
  readonly runPointOperation: (
    table: PointMutationJournalTableV1,
    operation: unknown,
  ) => ReturnType<PointMutationJournalV1["runPointOperation"]>;
  readonly resolveDeveloperIndex: (
    table: PointMutationJournalTableV1,
    indexDescriptor: unknown,
  ) => ReturnType<PointMutationJournalV1["resolveDeveloperIndex"]>;
  readonly runIndexedQuery: (
    index: Parameters<PointMutationJournalV1["runIndexedQuery"]>[0],
    operation: unknown,
  ) => ReturnType<PointMutationJournalV1["runIndexedQuery"]>;
}

interface PointMutationOccRuntimeNeutralRunnerInputCommonV1 {
  readonly argumentsJson: JsonObject;
  readonly argumentArraySemanticBytes: number;
  readonly schemaManifest: SchemaManifestAppSchemaV1;
  readonly stableBindings: StoredCommitAuthoritySchemaEvidencePortV1["stableBindings"];
  readonly context: PointMutationOccExecutionContextV1;
  readonly journal: PointMutationOccBoundJournalV1;
}

export type PointMutationOccRuntimeNeutralRunnerInputV1 =
  PointMutationOccRuntimeNeutralRunnerInputCommonV1 & (
    | Readonly<{
        readonly executionAuthorityGeneration: "legacy_dynamic_worker_v1";
        readonly verifiedGrant: VerifiedTransactionGrantInspectionV1;
        readonly functionMetadata: PointMutationTargetFunctionMetadataV1;
        readonly applicationGraph?: never;
      }>
    | Readonly<{
        readonly executionAuthorityGeneration: "application_v1";
        readonly verifiedGrant: InertApplicationMutationGrantEvidenceV1;
        readonly applicationGraph:
          AuthenticatedApplicationMutationCommitAuthorityGraph;
        readonly functionMetadata?: never;
      }>
  );

export interface PointMutationOccExecutionContextFactoryV1 {
  readonly make: () => Effect.Effect<
    Readonly<{
      readonly executionId: unknown;
      readonly logScopeId: unknown;
      readonly randomSeed: unknown;
    }>,
    never,
    never
  >;
}

export type PointMutationOccRuntimeNeutralRunnerV1Error =
  | PointMutationOccApplicationErrorV1
  | PointMutationOccUserCodeV1Error
  | PointMutationJournalBoundaryV1Error
  | PointMutationJournalResultRejectedV1Error
  | PointMutationExactRuntimeRunnerHostV1Error;

export interface PointMutationOccRuntimeNeutralRunnerV1 {
  readonly run: (
    input: PointMutationOccRuntimeNeutralRunnerInputV1,
  ) => Effect.Effect<
    unknown,
    PointMutationOccRuntimeNeutralRunnerV1Error,
    never
  >;
}

export type PointMutationOccRerunAuthorizationResultV1 =
  | Readonly<{
      readonly kind: "replayed";
      readonly outcome: Extract<
        CommittedPointOutcomeResolutionV1,
        { readonly kind: "available" }
      >;
    }>
  | Readonly<{
      readonly kind: "expired";
      readonly outcome: Extract<
        CommittedPointOutcomeResolutionV1,
        { readonly kind: "expired" }
      >;
    }>
  | Readonly<{
      readonly kind: "authorized";
      readonly rerun: AuthorizedPointMutationOccRerunV1;
      readonly backoffUpperBoundMilliseconds: number;
      readonly backoffMilliseconds: number;
    }>;

export interface AuthorizedPointMutationOccRerunInspectionV1 {
  readonly deploymentId: TransactionGrantDeploymentIdV1;
  readonly scopeId: ReplacementScopeIdV1;
  readonly sessionId: TransactionSessionIdV1;
  readonly requestKey: string;
  readonly previousAttemptFence: TransactionAttemptFence;
  readonly attemptFence: TransactionAttemptFence;
  readonly previousSnapshotToken: SnapshotToken;
  readonly snapshotToken: SnapshotToken;
  readonly conflict: PointCommitConflictEvidenceV1;
  readonly conflictingCommitSeq: SnapshotToken["commitSeq"];
}

export type StoredAttemptStorageCorruptionReasonV1 =
  | "repeatableReadCapabilityMissing"
  | "scopeClockMissingOrDuplicate"
  | "databaseClockInvalid"
  | "sessionRecordDuplicate"
  | "sessionRecordInvalid"
  | "snapshotLeaseMissingOrDuplicate"
  | "snapshotLeaseInvalid"
  | "journalRootMissingOrDuplicate"
  | "journalRootInvalid"
  | "executionClaimInvalid"
  | "pointEvidenceOverflow"
  | "pointEvidenceInvalid"
  | "journalEvidenceInvalid"
  | "successfulResultEvidenceInvalid"
  | "journalDigestInvalid"
  | "resultDigestInvalid"
  | "resultBytesInvalid"
  | "resultSemanticBytesMismatch"
  | "journalCounterMismatch"
  | "duplicatePointEvidence"
  | "pointDependencyMismatch"
  | "pointDependencySetMismatch"
  | "writeWithoutPointEvidence"
  | "nonLiveOverlayCarriesEvidence"
  | "liveOverlayEvidenceMissing"
  | "liveOverlaySemanticBytesMismatch"
  | "presentDependencyRevisionMissing"
  | "missingDependencyUnexpectedRevision"
  | "tombstoneDependencyRevisionMissing"
  | "readOnlyPointHasOverlay"
  | "tombstoneDependencyHasWrite"
  | "invalidInsertTransition"
  | "deleteNotTerminal"
  | "writeChainEmpty"
  | "deleteOverlayMismatch"
  | "liveWriteOverlayMismatch"
  | "insertCreationTimeMismatch"
  | "completeWriteMissing"
  | "unexpectedWriteAfterCompleteValue"
  | "completeWriteOverlayMismatch"
  | "patchRemoveOverlayMismatch"
  | "patchSetOverlayMissing"
  | "patchSetOverlayMismatch"
  | "overlayDocumentNotObject"
  | "jsonPropertyMissing"
  | "storedEvidenceInvalid";

export interface StoredAttemptAuthorityStateV1 {
  readonly deploymentId: TransactionGrantDeploymentIdV1;
  readonly scopeId: ReplacementScopeIdV1;
  readonly sessionId: TransactionSessionIdV1;
  readonly attemptFence: TransactionAttemptFence;
  readonly storageGeneration: FlarexDbV1StorageGeneration;
  readonly storageGenerationFence: StorageGenerationFence;
  readonly snapshotToken: SnapshotToken;
  readonly schemaVersionId: CatalogSchemaVersionId;
  readonly executionClaim?: TransactionExecutionClaimPinV1;
}

export type StoredAttemptEvidenceAuthorityPortV1 = Readonly<
  StoredAttemptAuthorityStateV1
>;

export type StoredAttemptSessionScalarsPortV1 =
  StoredTransactionSessionScalarsV1;

interface StoredAttemptSealedRootPortV1 {
  readonly lastSyscallSequence: CommitFinalSyscallSequenceV1;
  readonly creationTimeSeed: AppCreationTimeV1;
  readonly nextCreationTime: AppCreationTimeV1;
  readonly readDocuments: number;
  readonly readSemanticBytes: number;
  readonly pointDependencyCount: number;
  readonly indexedQuerySyscalls: number;
  readonly indexRangeDependencyCount: number;
  readonly indexRangeDependencyEvidenceBytes: number;
  readonly writeOperations: number;
  readonly writeSemanticBytes: number;
  readonly materialWriteEventEvidenceBytes:
    CommitMaterialWriteEventEvidenceBytesV1;
  readonly sealedFinalSyscallSequence: CommitFinalSyscallSequenceV1;
  readonly journalBytes: Uint8Array;
  readonly journalSha256: Uint8Array;
  readonly resultValueCodecVersion: FlarexValueCodecVersion;
  readonly resultSemanticBytes: number;
  readonly resultBytes: Uint8Array;
  readonly resultSha256: Uint8Array;
  readonly createdAtMilliseconds: number;
  readonly updatedAtMilliseconds: number;
  readonly sealedAtMilliseconds: number;
}

export interface StoredAttemptSealIdentityPortV1 {
  readonly scopeUuid: ScopeUuidV1;
  readonly lifecycle: "running" | "finishing";
  readonly sessionUpdatedAtMilliseconds: number;
  readonly leaseExpiresAtMilliseconds: number;
  readonly rootCreatedAtMilliseconds: number;
  readonly rootUpdatedAtMilliseconds: number;
  readonly sealedAtMilliseconds: number;
  readonly finalSyscallSequence: CommitFinalSyscallSequenceV1;
  readonly creationTimeSeed: AppCreationTimeV1;
  readonly nextCreationTime: AppCreationTimeV1;
  readonly journalFormat: SessionJournalV1["format"];
  readonly journalProtocolVersion: SessionJournalV1["protocolVersion"];
  readonly journalValueCodecVersion: SessionJournalV1["valueCodecVersion"];
  readonly journalByteLength: number;
  readonly journalSha256: Uint8Array;
  readonly resultValueCodecVersion: FlarexValueCodecVersion;
  readonly resultSemanticBytes: number;
  readonly resultByteLength: number;
  readonly resultSha256: Uint8Array;
  readonly readDocuments: number;
  readonly readSemanticBytes: number;
  readonly pointDependencyCount: number;
  readonly indexedQuerySyscalls: number;
  readonly indexRangeDependencyCount: number;
  readonly indexRangeDependencyEvidenceBytes: number;
  readonly writeOperations: number;
  readonly writeSemanticBytes: number;
  readonly materialWriteEventEvidenceBytes:
    CommitMaterialWriteEventEvidenceBytesV1;
}

export interface StoredAttemptPointEvidencePortV1 {
  readonly tableId: CatalogTableId;
  readonly rowId: Uint8Array;
  readonly dependencyKind:
    | "present"
    | "missing_no_visible_revision"
    | "missing_tombstone";
  readonly dependencyRevisionCommitSeq: bigint | null;
  readonly overlayKind: "none" | "live" | "deleted";
  readonly overlayCreationTime: AppCreationTimeV1 | null;
  readonly overlayValueCodecVersion: FlarexValueCodecVersion | null;
  readonly overlayValueJson: JsonObject | null;
  readonly overlayValueBytes: Uint8Array | null;
  readonly overlayValueSha256: Uint8Array | null;
  readonly overlaySemanticBytes: number | null;
  readonly createdAtMilliseconds: number;
  readonly updatedAtMilliseconds: number;
}

export interface StoredAttemptEvidencePortV1 {
  readonly deploymentId: TransactionGrantDeploymentIdV1;
  readonly scopeId: ReplacementScopeIdV1;
  readonly scopeUuid: ScopeUuidV1;
  readonly sessionId: TransactionSessionIdV1;
  readonly attemptFence: TransactionAttemptFence;
  readonly databaseNowMilliseconds: number;
  readonly session: StoredAttemptSessionScalarsPortV1;
  readonly lease: Readonly<{
    readonly snapshotToken: SnapshotToken;
    readonly leaseExpiresAtMilliseconds: number;
  }>;
  readonly root: StoredAttemptSealedRootPortV1;
  readonly points: ReadonlyArray<StoredAttemptPointEvidencePortV1>;
}

export type StoredAttemptEvidenceLoadResultPortV1 =
  | Readonly<{
      readonly kind: "loaded";
      readonly evidence: StoredAttemptEvidencePortV1;
    }>
  | Readonly<{
      readonly kind: "alreadyCommitted";
      readonly updatedAtMilliseconds: number;
    }>
  | Readonly<{
      readonly kind: "notPlannable";
      readonly reason: "lifecycle" | "rootNotSealed" | "expired";
      readonly lifecycle?: TransactionSessionLifecycleV1;
      readonly rootState?: "open" | "sealed" | "failed";
    }>
  | Readonly<{
      readonly kind: "authorityMismatch";
      readonly reason:
        | "placementChanged"
        | "scopeChanged"
        | "attemptMissing"
        | "attemptReplaced"
        | "generationChanged"
        | "epochChanged"
        | "snapshotChanged"
        | "schemaChanged"
        | "revocationEpochChanged"
        | "executionClaimChanged";
    }>
  | Readonly<{
      readonly kind: "corrupt";
      readonly reason: StoredAttemptStorageCorruptionReasonV1;
      readonly cause?: unknown;
    }>;

export interface StoredAttemptEvidencePersistencePortErrorV1 {
  readonly _tag: "StoredAttemptEvidencePersistenceV1Error";
  readonly cause: unknown;
}

export interface StoredAttemptEvidenceLoaderPortV1 {
  readonly loadEffect: (
    authority: StoredAttemptEvidenceAuthorityPortV1,
  ) => Effect.Effect<
    StoredAttemptEvidenceLoadResultPortV1,
    StoredAttemptEvidencePersistencePortErrorV1
  >;
}

export interface StoredAttemptFinishingEvidenceLoaderPortV1
  extends StoredAttemptEvidenceLoaderPortV1 {
  readonly loadFinishingEffect: (
    selector: PointMutationSessionAttemptSelectorV1,
  ) => Effect.Effect<
    StoredAttemptEvidenceLoadResultPortV1,
    StoredAttemptEvidencePersistencePortErrorV1
  >;
}

export interface StoredAttemptAuthenticationV1 {
  readonly deriveAuthority: (
    attempt: LoadedPointMutationSessionAttemptV1,
    executionClaim: PointMutationExecutionScopeV1,
  ) => Effect.Effect<
    TrustedStoredAttemptAuthorityV1,
    InvalidStoredAttemptAuthorityV1Error
  >;
  readonly authenticate: (
    authority: TrustedStoredAttemptAuthorityV1,
    envelope: unknown,
  ) => Effect.Effect<
    AuthenticatedStoredAttemptV1,
    StoredAttemptAuthenticationV1Error
  >;
  readonly isAuthenticated: (value: unknown) => boolean;
  /** Internal test seam: compares private state without exposing evidence. */
  readonly remainsAuthenticatedStateUnchangedForTest: (
    value: AuthenticatedStoredAttemptV1,
    action: () => void,
  ) => boolean;
}

export type StoredCommitAuthorityAuthenticationV1Error =
  | InvalidAuthenticatedStoredAttemptV1Error
  | StoredCommitAuthorityPersistenceV1Error
  | StoredCommitAuthorityNotPlannableV1Error
  | StoredCommitAuthorityMismatchV1Error
  | StoredCommitAuthorityCorruptionV1Error
  | PinnedFunctionMetadataSourceV1Error
  | TransactionGrantVerificationV1Error
  | PointMutationTargetSelectionV1Error;

export interface StoredCommitAuthorityAuthenticationV1
  extends StoredAttemptAuthenticationV1 {
  readonly authenticateCommitAuthority: (
    attempt: AuthenticatedStoredAttemptV1,
  ) => Effect.Effect<
    AuthenticatedCommitAuthorityV1,
    StoredCommitAuthorityAuthenticationV1Error
  >;
  readonly isCommitAuthorityAuthenticated: (value: unknown) => boolean;
  /** Internal test seam: verifies defensive detachment without exposing state. */
  readonly remainsCommitAuthorityStateUnchangedForTest: (
    value: AuthenticatedCommitAuthorityV1,
    action: () => void,
  ) => boolean;
}

export interface AuthenticatedStoredAttemptStateV1 {
  readonly authority: StoredAttemptAuthorityStateV1;
  /** Private process-local execution scope; never projected into persistence. */
  readonly executionScope?: PointMutationExecutionScopeV1;
  readonly session: StoredAttemptSessionScalarsPortV1;
  readonly sealIdentity: Readonly<StoredAttemptSealIdentityPortV1>;
  readonly journal: SessionJournalV1;
  readonly successfulResult: AuthenticatedSuccessfulResultV1;
  readonly points: ReadonlyArray<AuthenticatedStoredAttemptPointV1>;
}

export interface AuthenticatedSuccessfulResultV1 {
  readonly value: CanonicalFlarexRuntimeValueV1;
  readonly valueJson: Json;
  readonly canonicalBytes: Uint8Array;
  readonly semanticSizeBytes: number;
  readonly sha256Hex: CanonicalSuccessfulResultV1["evidence"]["sha256Hex"];
}

export interface AuthenticatedCommitAuthorityStateV1 {
  readonly storedAttempt: AuthenticatedStoredAttemptStateV1;
  readonly databaseNowMilliseconds: number;
  readonly argumentsJson: JsonObject;
  readonly argumentArraySemanticBytes: number;
  readonly verifiedGrant:
    | VerifiedTransactionGrantInspectionV1
    | InertApplicationMutationGrantEvidenceV1;
  readonly schemaManifest: SchemaManifestAppSchemaV1;
  readonly stableBindings: StoredCommitAuthoritySchemaEvidencePortV1[
    "stableBindings"
  ];
  readonly functionMetadata: PointMutationTargetFunctionMetadataV1;
}

export interface StoredCommitInputVerificationV1
  extends StoredCommitAuthorityAuthenticationV1 {
  readonly verifyCommitInput: (
    authority: AuthenticatedCommitAuthorityV1,
  ) => Effect.Effect<
    VerifiedCommitInputV1,
    CommitInputVerificationV1Error
  >;
  readonly isCommitInputVerified: (value: unknown) => boolean;
  /** Internal test seam: verifies private-state detachment without exposure. */
  readonly remainsVerifiedCommitInputStateUnchangedForTest: (
    value: VerifiedCommitInputV1,
    action: () => void,
  ) => boolean;
}

export type PointCommitPlanningV1Error =
  | InvalidVerifiedCommitInputV1Error
  | PointCommitUniqueConstraintEligibilityV1Error
  | UnsupportedPointCommitPlanV1Error;

export interface StoredPointCommitPlanningV1
  extends StoredCommitInputVerificationV1 {
  readonly planPointCommit: (
    input: VerifiedCommitInputV1,
  ) => Effect.Effect<
    PreparedPointCommitV1,
    PointCommitPlanningV1Error,
    never
  >;
  readonly isPointCommitPrepared: (value: unknown) => boolean;
  /** Internal test seam: compares opaque same-factory plan state. */
  readonly arePreparedPointCommitStatesEquivalentForTest: (
    left: PreparedPointCommitV1,
    right: PreparedPointCommitV1,
  ) => boolean;
}

export interface StoredPointCommitRollbackProofConfigV1
  extends StoredCommitAuthorityAuthenticationConfigV1 {
  readonly pointCommit: PointCommitRollbackProofPortV1;
}

export interface StoredPointCommitPublisherConfigV1
  extends StoredCommitAuthorityAuthenticationConfigV1 {
  readonly pointCommit: PointCommitPublisherPortV1;
}

export interface StoredPointCommitFinishingTransitionConfigV1
  extends StoredPointCommitPublisherConfigV1 {
  readonly pointCommitFinishing: PointCommitFinishingTransitionPortV1;
}

export interface StoredPointCommitExecutorConfigV1
  extends StoredPointCommitFinishingTransitionConfigV1 {
  readonly pointCommit:
    PointCommitPublisherPortV1 & PointCommitOutcomeResolutionPortV1;
}

export interface StoredPointMutationAttemptReplacementConfigV1
  extends StoredPointCommitExecutorConfigV1 {
  readonly pointMutationAttemptReplacement:
    PointMutationAttemptReplacementPortV1;
}

export interface StoredPointMutationOccRerunAuthorizationConfigV1
  extends StoredPointMutationAttemptReplacementConfigV1 {
  readonly pointCommit:
    PointCommitPublisherPortV1 & PointCommitOutcomeResolutionPortV1;
  readonly pointMutationOccRerun: Readonly<{
    readonly attemptLoading: PointMutationSessionAttemptLoadingV1;
  }>;
}

export interface StoredPointMutationOccRerunExecutionConfigV1
  extends StoredPointMutationOccRerunAuthorizationConfigV1 {
  readonly pointMutationOccRerun: Readonly<{
    readonly attemptLoading: PointMutationSessionAttemptLoadingV1;
    readonly executionEvidence: StoredOccExecutionEvidenceLoaderV1;
    readonly journal: PointMutationJournalV1;
    readonly terminalization: PointMutationSessionAttemptTerminalizationV1;
    readonly contextFactory: PointMutationOccExecutionContextFactoryV1;
    readonly runner: PointMutationOccRuntimeNeutralRunnerV1;
    readonly liveness: PointMutationExecutionClaimLivenessV1;
    readonly heartbeatIntervalMilliseconds: number;
  }>;
}

export interface StoredPointMutationCrashRedispatchConfigV1
  extends StoredPointMutationOccRerunExecutionConfigV1 {
  readonly pointMutationRedispatch: Readonly<{
    readonly acquisition: PointMutationExecutionClaimDispatchAcquisitionV1;
    readonly disposition: PointMutationSessionAttemptDispositionV1;
  }>;
}

export type PointCommitRollbackV1Error =
  | InvalidPreparedPointCommitV1Error
  | PointCommitRollbackProofV1Error;

export interface StoredPointCommitRollbackProofV1
  extends StoredPointCommitPlanningV1 {
  readonly provePointCommitRollback: (
    input: PreparedPointCommitV1,
  ) => Effect.Effect<
    PointCommitWouldCommitV1,
    PointCommitRollbackV1Error,
    never
  >;
}

export type PointCommitPublicationExecutionV1Error =
  | InvalidPreparedPointCommitV1Error
  | PointCommitPublicationV1Error;

type PointCommitKnownSettledSqlPublicationV1Error =
  | Exclude<
      PointCommitPublicationV1Error,
      PointCommitConfirmedPreDecisionRollbackV1Error
    >
  | PointCommitKnownSettledSqlRetryExhaustedV1Error;

/**
 * O08-C closes confirmed pre-decision rollback inside the genuine finishing
 * publication path. The generic publisher remains a truthful one-attempt port.
 */
export type PointCommitFinishingPublicationExecutionV1Error =
  | InvalidPreparedPointCommitV1Error
  | PointCommitKnownSettledSqlPublicationV1Error;

export interface StoredPointCommitPublisherV1
  extends StoredPointCommitRollbackProofV1 {
  readonly publishPointCommit: (
    input: PreparedPointCommitV1,
  ) => Effect.Effect<
    PointCommitPublicationResultV1,
    PointCommitPublicationExecutionV1Error,
    never
  >;
}

export type PointCommitFinishingExecutionV1Error =
  | InvalidPreparedPointCommitV1Error
  | PointCommitFinishingTransitionV1Error;

export interface StoredPointCommitFinishingTransitionV1
  extends Omit<StoredPointCommitPublisherV1, "publishPointCommit"> {
  readonly publishPointCommit: (
    input: FinishingPreparedPointCommitV1,
  ) => Effect.Effect<
    PointCommitPublicationResultV1,
    PointCommitFinishingPublicationExecutionV1Error,
    never
  >;
  readonly enterPointCommitFinishing: (
    input: PreparedPointCommitV1,
  ) => Effect.Effect<
    FinishingPreparedPointCommitV1,
    PointCommitFinishingExecutionV1Error,
    never
  >;
}

export type PointCommitFinishingRecoveryV1Error =
  | InvalidPointMutationSessionAttemptSelectorV1Error
  | StoredAttemptAlreadyCommittedV1Error
  | StoredAttemptNotPlannableV1Error
  | StoredAttemptAuthorityMismatchV1Error
  | StoredAttemptStorageCorruptionV1Error
  | StoredAttemptPersistenceV1Error
  | StoredCommitAuthorityAuthenticationV1Error
  | CommitInputVerificationV1Error
  | PointCommitPlanningV1Error
  | InvalidPreparedPointCommitV1Error;

export type PointCommitFinishingRecoveryExecutionV1Error =
  | PointCommitFinishingRecoveryV1Error
  | PointCommitRecoveredPublicationExecutionV1Error;

export type PointCommitRecoveredPublicationExecutionV1Error =
  | Exclude<
      PointCommitFinishingPublicationExecutionV1Error,
      PointCommitDecisionUncertainV1Error
    >
  | PointCommitUncertainOutcomeUnresolvedV1Error
  | PointCommitUncertainOutcomeRecoveryCorruptionV1Error
  | PointCommitFinishingRecoveryV1Error
  | PointCommitOutcomeResolutionV1Error;

export type PointCommitFinishingCompositionV1Error =
  | PointCommitFinishingExecutionV1Error
  | PointCommitRecoveredPublicationExecutionV1Error;

export interface StoredPointCommitExecutorV1
  extends Omit<StoredPointCommitFinishingTransitionV1, "publishPointCommit"> {
  readonly publishPointCommit: (
    input: FinishingPreparedPointCommitV1,
  ) => Effect.Effect<
    PointCommitPublicationResultV1,
    PointCommitRecoveredPublicationExecutionV1Error,
    never
  >;
  readonly reconstructPointCommitFinishing: (
    selector: unknown,
  ) => Effect.Effect<
    FinishingPreparedPointCommitV1,
    PointCommitFinishingRecoveryV1Error,
    never
  >;
  readonly finishPointCommit: (
    input: PreparedPointCommitV1,
  ) => Effect.Effect<
    PointCommitPublicationResultV1,
    PointCommitFinishingCompositionV1Error,
    never
  >;
  readonly resumePointCommit: (
    selector: unknown,
  ) => Effect.Effect<
    PointCommitPublicationResultV1,
    PointCommitFinishingRecoveryExecutionV1Error,
    never
  >;
}

export type PointMutationAttemptReplacementExecutionV1Error =
  | InvalidPreparedPointCommitV1Error
  | PointMutationAttemptReplacementV1Error;

export interface StoredPointMutationAttemptReplacementV1
  extends StoredPointCommitExecutorV1 {
  readonly replaceConflictedPointMutationAttempt: (
    input: FinishingPreparedPointCommitV1,
    conflict: PointCommitConflictEvidenceV1,
  ) => Effect.Effect<
    PointMutationAttemptReplacementObservationV1,
    PointMutationAttemptReplacementExecutionV1Error,
    never
  >;
}

export type PointMutationOccRerunAuthorizationV1Error =
  | InvalidPointMutationOccConflictV1Error
  | PointMutationOccRerunExhaustedV1Error
  | PointMutationOccRerunOwnershipLostV1Error
  | PointMutationOccRerunFreshAttemptV1Error
  | PointMutationOccRerunAuthorityCorruptionV1Error
  | PointCommitOutcomeResolutionV1Error
  | PointMutationAttemptReplacementExecutionV1Error
  | PointMutationSessionAttemptLoadingExecutionV1Error;

export interface StoredPointMutationOccRerunAuthorizationV1
  extends StoredPointMutationAttemptReplacementV1 {
  readonly authorizePointMutationOccRerun: (
    conflict: unknown,
  ) => Effect.Effect<
    PointMutationOccRerunAuthorizationResultV1,
    PointMutationOccRerunAuthorizationV1Error,
    never
  >;
  /** Test-only stand-in for B2's future synchronous single-use claim. */
  readonly consumeAuthorizedPointMutationOccRerunForTest: (
    rerun: unknown,
  ) => AuthorizedPointMutationOccRerunInspectionV1;
}

export type PointMutationOccRerunExecutionV1Error =
  | InvalidAuthorizedPointMutationOccRerunV1Error
  | PointMutationAuthenticatedAttemptExecutionV1Error
  | PointMutationOccRerunAuthorizationV1Error;

export interface StoredPointMutationOccRerunExecutionV1
  extends StoredPointMutationOccRerunAuthorizationV1 {
  readonly executeAuthorizedPointMutationOccRerun: (
    rerun: unknown,
  ) => Effect.Effect<
    PointCommitPublicationResultV1,
    PointMutationOccRerunExecutionV1Error,
    never
  >;
}

export type PointMutationInitialExecutionV1Error =
  | InvalidActivatedPointMutationSessionV1Error
  | ActivatedPointMutationSessionBusyV1Error
  | InvalidPointMutationExecutionClaimV1Error
  | PointMutationInitialExecutionAuthorityV1Error
  | PointMutationAuthenticatedAttemptExecutionV1Error
  | PointMutationOccRerunExecutionV1Error;

export interface PointMutationInitialExecutionV1
  extends StoredPointMutationOccRerunExecutionV1 {
  readonly executeInitialPointMutationAttempt: (
    activated: ActivatedPointMutationSessionV1,
  ) => Effect.Effect<
    PointCommitPublicationResultV1,
    PointMutationInitialExecutionV1Error,
    never
  >;
}

export type PointMutationCrashRedispatchResultV1 =
  | PointCommitPublicationResultV1
  | Readonly<{ readonly kind: "busy" }>
  | Readonly<{
      readonly kind: "closed";
      readonly reason: "dirtyOpen" | "failedRoot";
      readonly lifecycle: "aborted" | "expired";
      readonly terminalizedAt: string;
    }>
  | Readonly<{
      readonly kind: "closed";
      readonly reason: "authorityExpired";
      readonly lifecycle: "expired";
      readonly terminalizedAt: string;
    }>;

export type PointMutationCrashRedispatchV1Error =
  | PointMutationExecutionClaimAcquisitionV1Error
  | InvalidPointMutationExecutionClaimV1Error
  | PointMutationSessionAttemptDispositionExecutionV1Error
  | PointMutationAuthenticatedAttemptExecutionV1Error;

export interface StoredPointMutationCrashRedispatchV1
  extends PointMutationInitialExecutionV1 {
  readonly redispatchExactPointMutationAttempt: (
    selector: unknown,
  ) => Effect.Effect<
    PointMutationCrashRedispatchResultV1,
    PointMutationCrashRedispatchV1Error,
    never
  >;
}

function isPointMutationOccExecutionContextFactoryV1(
  value: unknown,
): value is PointMutationOccExecutionContextFactoryV1 {
  return isNonArrayRecord(value) && typeof value.make === "function";
}

function isPointMutationOccRuntimeNeutralRunnerV1(
  value: unknown,
): value is PointMutationOccRuntimeNeutralRunnerV1 {
  return isNonArrayRecord(value) && typeof value.run === "function";
}

function isStoredAttemptFinishingEvidenceLoaderPortV1(
  value: StoredAttemptEvidenceLoaderPortV1,
): value is StoredAttemptFinishingEvidenceLoaderPortV1 {
  return typeof Reflect.get(value, "loadFinishingEffect") === "function";
}

export function createStoredAttemptAuthenticationV1(
  loader: StoredAttemptEvidenceLoaderPortV1,
  executionClaims: PointMutationExecutionClaimVaultV1,
): StoredAttemptAuthenticationV1 {
  return createStoredPointMutationCapabilityRuntimeV1(
    loader,
    undefined,
    executionClaims,
    "authentication",
  );
}

export function createStoredPointCommitPlanningV1(
  loader: StoredAttemptEvidenceLoaderPortV1,
  configuration: StoredCommitAuthorityAuthenticationConfigV1,
  executionClaims: PointMutationExecutionClaimVaultV1,
): StoredPointCommitPlanningV1 {
  return createStoredPointMutationCapabilityRuntimeV1(
    loader,
    configuration,
    executionClaims,
    "planning",
  );
}

export function createStoredPointCommitRollbackProofV1(
  loader: StoredAttemptEvidenceLoaderPortV1,
  configuration: StoredPointCommitRollbackProofConfigV1,
  executionClaims: PointMutationExecutionClaimVaultV1,
): StoredPointCommitRollbackProofV1 {
  return createStoredPointMutationCapabilityRuntimeV1(
    loader,
    configuration,
    executionClaims,
    "rollbackProof",
  );
}

export function createStoredPointCommitPublisherV1(
  loader: StoredAttemptEvidenceLoaderPortV1,
  configuration: StoredPointCommitPublisherConfigV1,
  executionClaims: PointMutationExecutionClaimVaultV1,
): StoredPointCommitPublisherV1 {
  return createStoredPointMutationCapabilityRuntimeV1(
    loader,
    configuration,
    executionClaims,
    "publisher",
  );
}

export function createStoredPointCommitFinishingTransitionV1(
  loader: StoredAttemptEvidenceLoaderPortV1,
  configuration: StoredPointCommitFinishingTransitionConfigV1,
  executionClaims: PointMutationExecutionClaimVaultV1,
): StoredPointCommitFinishingTransitionV1 {
  return createStoredPointMutationCapabilityRuntimeV1(
    loader,
    configuration,
    executionClaims,
    "finishingTransition",
  );
}

export function createStoredPointCommitExecutorV1(
  loader: StoredAttemptFinishingEvidenceLoaderPortV1,
  configuration: StoredPointCommitExecutorConfigV1,
  executionClaims: PointMutationExecutionClaimVaultV1,
): StoredPointCommitExecutorV1 {
  return createStoredPointMutationCapabilityRuntimeV1(
    loader,
    configuration,
    executionClaims,
    "executor",
  );
}

export function createStoredPointMutationAttemptReplacementV1(
  loader: StoredAttemptFinishingEvidenceLoaderPortV1,
  configuration: StoredPointMutationAttemptReplacementConfigV1,
  executionClaims: PointMutationExecutionClaimVaultV1,
): StoredPointMutationAttemptReplacementV1 {
  return createStoredPointMutationCapabilityRuntimeV1(
    loader,
    configuration,
    executionClaims,
    "attemptReplacement",
  );
}

export function createStoredPointMutationOccRerunAuthorizationV1(
  loader: StoredAttemptFinishingEvidenceLoaderPortV1,
  configuration: StoredPointMutationOccRerunAuthorizationConfigV1,
  executionClaims: PointMutationExecutionClaimVaultV1,
): StoredPointMutationOccRerunAuthorizationV1 {
  return createStoredPointMutationCapabilityRuntimeV1(
    loader,
    configuration,
    executionClaims,
    "occRerunAuthorization",
  );
}

export function createStoredPointMutationOccRerunExecutionV1(
  loader: StoredAttemptFinishingEvidenceLoaderPortV1,
  configuration: StoredPointMutationOccRerunExecutionConfigV1,
  executionClaims: PointMutationExecutionClaimVaultV1,
): StoredPointMutationOccRerunExecutionV1 {
  return createStoredPointMutationCapabilityRuntimeV1(
    loader,
    configuration,
    executionClaims,
    "occRerunExecution",
  );
}

export function createPointMutationInitialExecutionV1(
  loader: StoredAttemptFinishingEvidenceLoaderPortV1,
  configuration: StoredPointMutationOccRerunExecutionConfigV1,
  executionClaims: PointMutationExecutionClaimVaultV1,
): PointMutationInitialExecutionV1 {
  return createStoredPointMutationCapabilityRuntimeV1(
    loader,
    configuration,
    executionClaims,
    "initialExecution",
  );
}

export function createStoredPointMutationCrashRedispatchV1(
  loader: StoredAttemptFinishingEvidenceLoaderPortV1,
  configuration: StoredPointMutationCrashRedispatchConfigV1,
  executionClaims: PointMutationExecutionClaimVaultV1,
): StoredPointMutationCrashRedispatchV1 {
  return createStoredPointMutationCapabilityRuntimeV1(
    loader,
    configuration,
    executionClaims,
    "crashRedispatch",
  );
}

function createStoredPointMutationCapabilityRuntimeV1(
  loader: StoredAttemptEvidenceLoaderPortV1,
  commitAuthority: undefined,
  executionClaims: PointMutationExecutionClaimVaultV1,
  stage: "authentication",
): StoredAttemptAuthenticationV1;
function createStoredPointMutationCapabilityRuntimeV1(
  loader: StoredAttemptFinishingEvidenceLoaderPortV1,
  commitAuthority: StoredPointMutationCrashRedispatchConfigV1,
  executionClaims: PointMutationExecutionClaimVaultV1,
  stage: "crashRedispatch",
): StoredPointMutationCrashRedispatchV1;
function createStoredPointMutationCapabilityRuntimeV1(
  loader: StoredAttemptFinishingEvidenceLoaderPortV1,
  commitAuthority: StoredPointMutationOccRerunExecutionConfigV1,
  executionClaims: PointMutationExecutionClaimVaultV1,
  stage: "initialExecution",
): PointMutationInitialExecutionV1;
function createStoredPointMutationCapabilityRuntimeV1(
  loader: StoredAttemptFinishingEvidenceLoaderPortV1,
  commitAuthority: StoredPointMutationOccRerunExecutionConfigV1,
  executionClaims: PointMutationExecutionClaimVaultV1,
  stage: "occRerunExecution",
): StoredPointMutationOccRerunExecutionV1;
function createStoredPointMutationCapabilityRuntimeV1(
  loader: StoredAttemptFinishingEvidenceLoaderPortV1,
  commitAuthority: StoredPointMutationOccRerunAuthorizationConfigV1,
  executionClaims: PointMutationExecutionClaimVaultV1,
  stage: "occRerunAuthorization",
): StoredPointMutationOccRerunAuthorizationV1;
function createStoredPointMutationCapabilityRuntimeV1(
  loader: StoredAttemptFinishingEvidenceLoaderPortV1,
  commitAuthority: StoredPointMutationAttemptReplacementConfigV1,
  executionClaims: PointMutationExecutionClaimVaultV1,
  stage: "attemptReplacement",
): StoredPointMutationAttemptReplacementV1;
function createStoredPointMutationCapabilityRuntimeV1(
  loader: StoredAttemptFinishingEvidenceLoaderPortV1,
  commitAuthority: StoredPointCommitExecutorConfigV1,
  executionClaims: PointMutationExecutionClaimVaultV1,
  stage: "executor",
): StoredPointCommitExecutorV1;
function createStoredPointMutationCapabilityRuntimeV1(
  loader: StoredAttemptEvidenceLoaderPortV1,
  commitAuthority: StoredPointCommitFinishingTransitionConfigV1,
  executionClaims: PointMutationExecutionClaimVaultV1,
  stage: "finishingTransition",
): StoredPointCommitFinishingTransitionV1;
function createStoredPointMutationCapabilityRuntimeV1(
  loader: StoredAttemptEvidenceLoaderPortV1,
  commitAuthority: StoredPointCommitPublisherConfigV1,
  executionClaims: PointMutationExecutionClaimVaultV1,
  stage: "publisher",
): StoredPointCommitPublisherV1;
function createStoredPointMutationCapabilityRuntimeV1(
  loader: StoredAttemptEvidenceLoaderPortV1,
  commitAuthority: StoredPointCommitRollbackProofConfigV1,
  executionClaims: PointMutationExecutionClaimVaultV1,
  stage: "rollbackProof",
): StoredPointCommitRollbackProofV1;
function createStoredPointMutationCapabilityRuntimeV1(
  loader: StoredAttemptEvidenceLoaderPortV1,
  commitAuthority: StoredCommitAuthorityAuthenticationConfigV1,
  executionClaims: PointMutationExecutionClaimVaultV1,
  stage: "planning",
): StoredPointCommitPlanningV1;
function createStoredPointMutationCapabilityRuntimeV1(
  loader: StoredAttemptEvidenceLoaderPortV1,
  commitAuthority:
    | undefined
    | StoredCommitAuthorityAuthenticationConfigV1
    | StoredPointCommitRollbackProofConfigV1
    | StoredPointCommitPublisherConfigV1
    | StoredPointCommitFinishingTransitionConfigV1
    | StoredPointCommitExecutorConfigV1
    | StoredPointMutationAttemptReplacementConfigV1
    | StoredPointMutationOccRerunAuthorizationConfigV1
    | StoredPointMutationOccRerunExecutionConfigV1
    | StoredPointMutationCrashRedispatchConfigV1,
  executionClaims: PointMutationExecutionClaimVaultV1,
  stage: StoredPointMutationCapabilityStageV1,
):
  | StoredAttemptAuthenticationV1
  | StoredPointCommitPlanningV1
  | StoredPointCommitRollbackProofV1
  | StoredPointCommitPublisherV1
  | StoredPointCommitFinishingTransitionV1
  | StoredPointCommitExecutorV1
  | StoredPointMutationAttemptReplacementV1
  | StoredPointMutationOccRerunAuthorizationV1
  | StoredPointMutationOccRerunExecutionV1
  | PointMutationInitialExecutionV1
  | StoredPointMutationCrashRedispatchV1 {
  const {
    authorityStates,
    authenticatedStates,
    commitAuthorityStates,
    verifiedCommitInputStates,
    preparedPointCommitStates,
    finishingPreparedPointCommitStates,
    decisionUncertainTickets,
    capturedDecisionUncertainties,
    consumedDecisionUncertainties,
    occConflictTickets,
    capturedOccConflicts,
    consumedOccConflicts,
    authorizedOccRerunStates,
    mintedAuthorizedOccReruns,
    consumedAuthorizedOccReruns,
  } = makeStoredPointMutationCapabilityVaultV1();
  if (executionClaims === undefined) {
    throw new StoredCommitAuthorityConfigurationV1Error({
      reason: "missingExecutionClaimVault",
    });
  }
  const grantKernel = commitAuthority === undefined
    ? undefined
    : findTransactionGrantVerificationKernelV1(
      commitAuthority.transactionGrantVerifier,
    );
  if (commitAuthority !== undefined && grantKernel === undefined) {
    throw new StoredCommitAuthorityConfigurationV1Error({
      reason: "unregisteredTransactionGrantVerifier",
    });
  }
  const authenticationOperations = makeStoredAttemptAuthenticationOperationsV1({
    loader,
    executionClaims,
    authorityStates,
    authenticatedStates,
  });
  const {
    facade: base,
    mintAuthenticatedStoredAttempt,
    lookupAuthority,
    loadAndVerifyStoredEvidence,
  } = authenticationOperations;
  const { authenticate, deriveAuthority } = base;
  if (stage === "authentication") {
    return base;
  }
  if (commitAuthority === undefined || grantKernel === undefined) {
    throw new StoredPointMutationCapabilityConfigurationV1Defect({
      stage,
      missing: "commitAuthority",
    });
  }

  const pointCommitDescriptor = Object.getOwnPropertyDescriptor(
    commitAuthority,
    "pointCommit",
  );
  const planningPointCommitCandidate: unknown = pointCommitDescriptor !== undefined &&
      "value" in pointCommitDescriptor
    ? pointCommitDescriptor.value
    : undefined;

  const planning = makeStoredPointCommitPlanningOperationsV1({
    base,
    configuration: commitAuthority,
    grantKernel,
    developerIndexMaintenance:
      supportsPointCommitDeveloperIndexMaintenanceV1(
        planningPointCommitCandidate,
      ),
    uniqueConstraintMaintenance:
      supportsPointCommitUniqueConstraintMaintenanceV1(
        planningPointCommitCandidate,
      ),
    uniqueConstraintEligibility:
      supportsPointCommitUniqueConstraintEligibilityV1(
        planningPointCommitCandidate,
      ),
    pointCommitCandidate: planningPointCommitCandidate,
    authenticatedStates,
    commitAuthorityStates,
    verifiedCommitInputStates,
    preparedPointCommitStates,
  });
  const {
    authenticateCommitAuthority,
    verifyCommitInput,
    planPointCommit,
  } = planning;
  if (stage === "planning") return planning;
  const pointCommitCandidate = planningPointCommitCandidate;
  const pointCommit:
    | PointCommitRollbackProofPortV1
    | PointCommitPublisherPortV1
    | undefined = stage === "rollbackProof"
      ? isPointCommitRollbackProofPortV1(pointCommitCandidate)
        ? pointCommitCandidate
        : undefined
      : isPointCommitPublisherPortV1(pointCommitCandidate)
        ? pointCommitCandidate
        : isPointCommitRollbackProofPortV1(pointCommitCandidate)
          ? pointCommitCandidate
          : undefined;
  if (pointCommit === undefined) {
    throw new StoredPointMutationCapabilityConfigurationV1Defect({
      stage,
      missing: "pointCommitRollbackProof",
    });
  }

  const rollbackProof = makeStoredPointCommitRollbackProofOperationsV1({
    base: planning,
    pointCommit,
    preparedPointCommitStates,
    captureTransactionCommand: capturePointCommitTransactionCommand,
  });
  if (stage === "rollbackProof") return rollbackProof;
  if (!isPointCommitPublisherPortV1(pointCommit)) {
    throw new StoredPointMutationCapabilityConfigurationV1Defect({
      stage,
      missing: "pointCommitPublisher",
    });
  }

  const publisher = makeStoredPointCommitPublicationOperationsV1({
    base: rollbackProof,
    pointCommit,
    preparedPointCommitStates,
    capturePublicationCommand: capturePointCommitPublicationCommand,
  });
  if (stage === "publisher") return publisher;
  const pointCommitFinishingCandidate: unknown =
    "pointCommitFinishing" in commitAuthority
      ? commitAuthority.pointCommitFinishing
      : undefined;
  const pointCommitFinishing = isPointCommitFinishingTransitionPortV1(
      pointCommitFinishingCandidate,
    )
    ? pointCommitFinishingCandidate
    : undefined;
  if (pointCommitFinishing === undefined) {
    throw new StoredPointMutationCapabilityConfigurationV1Defect({
      stage,
      missing: "pointCommitFinishing",
    });
  }

  const {
    captureOccConflictTicket,
    captureAndClaimDecisionUncertainTicket,
  } = makePointCommitOutcomeTicketCaptureOperationsV1({
    decisionUncertainTickets,
    capturedDecisionUncertainties,
    consumedDecisionUncertainties,
    occConflictTickets,
    capturedOccConflicts,
    captureAttemptSelector: capturePointMutationSessionAttemptSelector,
  });

  const { publishCapturedFinishingPointCommit } =
    makeStoredPointCommitKnownSettledPublicationOperationsV1({
      pointCommit,
      captureOccConflictTicket,
    });

  const {
    facade: finishingTransition,
    lookupFinishingPreparedPointCommit,
  } = makeStoredPointCommitFinishingTransitionOperationsV1({
    base: publisher,
    pointCommitFinishing,
    executionClaims,
    preparedPointCommitStates,
    finishingPreparedPointCommitStates,
    captureTransitionCommand: capturePointCommitFinishingTransitionCommand,
    rebaseFinishingState: rebaseFinishingPreparedPointCommitState,
    capturePublicationCommand: capturePointCommitPublicationCommand,
    publishCapturedFinishingPointCommit,
  });
  const { enterPointCommitFinishing } = finishingTransition;
  if (stage === "finishingTransition") return finishingTransition;
  const finishingEvidenceLoader =
    isStoredAttemptFinishingEvidenceLoaderPortV1(loader) ? loader : undefined;
  const pointCommitOutcomeResolution =
    isPointCommitOutcomeResolutionPortV1(pointCommit) ? pointCommit : undefined;
  if (finishingEvidenceLoader === undefined) {
    throw new StoredPointMutationCapabilityConfigurationV1Defect({
      stage,
      missing: "finishingEvidenceLoader",
    });
  }
  if (pointCommitOutcomeResolution === undefined) {
    throw new StoredPointMutationCapabilityConfigurationV1Defect({
      stage,
      missing: "pointCommitOutcomeResolution",
    });
  }

  const {
    facade: executor,
    resolvePointCommitOutcomeFromStoredSession,
    resolvePointCommitOutcomeObservation,
    publishFinishingPointCommit,
    publicationResultFromCommittedOutcome,
  } = makeStoredPointCommitExecutionPublicationOperationsV1({
    base: finishingTransition,
    pointCommitOutcomeResolution,
    finishingEvidenceLoader,
    mintAuthenticatedStoredAttempt,
    authenticateCommitAuthority,
    verifyCommitInput,
    planPointCommit,
    preparedPointCommitStates,
    finishingPreparedPointCommitStates,
    lookupFinishingPreparedPointCommit,
    publishCapturedFinishingPointCommit,
    captureAndClaimDecisionUncertainTicket,
    capturePublicationCommand: capturePointCommitPublicationCommand,
    publicationCommandsEqual: pointCommitPublicationCommandsEqual,
  });

  const { resumePointCommit } = executor;
  if (stage === "executor") return executor;
  const pointMutationAttemptReplacementCandidate: unknown =
    "pointMutationAttemptReplacement" in commitAuthority
      ? commitAuthority.pointMutationAttemptReplacement
      : undefined;
  const pointMutationAttemptReplacement =
    isPointMutationAttemptReplacementPortV1(
        pointMutationAttemptReplacementCandidate,
      )
      ? pointMutationAttemptReplacementCandidate
      : undefined;
  if (pointMutationAttemptReplacement === undefined) {
    throw new StoredPointMutationCapabilityConfigurationV1Defect({
      stage,
      missing: "pointMutationAttemptReplacement",
    });
  }

  const replacement = makeStoredPointMutationAttemptReplacementOperationsV1({
    base: executor,
    pointMutationAttemptReplacement,
    preparedPointCommitStates,
    finishingPreparedPointCommitStates,
    captureReplacementCommand:
      capturePointMutationAttemptReplacementCommand,
  });
  const { replaceConflictedPointMutationAttempt } = replacement;
  if (stage === "attemptReplacement") return replacement;
  const pointMutationOccRerunCandidate: unknown =
    "pointMutationOccRerun" in commitAuthority
      ? commitAuthority.pointMutationOccRerun
      : undefined;
  const pointMutationOccAttemptLoadingCandidate = isNonArrayRecord(
      pointMutationOccRerunCandidate,
    )
    ? Reflect.get(pointMutationOccRerunCandidate, "attemptLoading")
    : undefined;
  const pointMutationOccAttemptLoading = isPointMutationSessionAttemptLoadingV1(
    pointMutationOccAttemptLoadingCandidate,
  )
    ? pointMutationOccAttemptLoadingCandidate
    : undefined;
  if (pointMutationOccAttemptLoading === undefined) {
    throw new StoredPointMutationCapabilityConfigurationV1Defect({
      stage,
      missing: "pointMutationOccAttemptLoading",
    });
  }
  const handoffFreshPointMutationAttempt =
    makeStoredPointMutationFreshAttemptHandoffOperationsV1({
      replaceConflictedPointMutationAttempt,
      pointMutationOccAttemptLoading,
      executionClaimIssuer: executionClaims.issuer,
      authorizedOccRerunStates,
      mintedAuthorizedOccReruns,
    });

  const {
    facade: authorization,
    claimAuthorizedPointMutationOccRerun,
    resolvePointMutationOccOutcome,
  } = makeStoredPointMutationOccRerunAuthorizationOperationsV1({
    base: replacement,
    resolvePointMutationOccOutcomeObservation:
      resolvePointCommitOutcomeObservation,
    handoffFreshPointMutationAttempt,
    occConflictTickets,
    consumedOccConflicts,
    authorizedOccRerunStates,
    mintedAuthorizedOccReruns,
    consumedAuthorizedOccReruns,
  });
  if (stage === "occRerunAuthorization") return authorization;
  const pointMutationOccExecutionEvidenceCandidate = isNonArrayRecord(
      pointMutationOccRerunCandidate,
    )
    ? Reflect.get(pointMutationOccRerunCandidate, "executionEvidence")
    : undefined;
  const pointMutationOccExecutionEvidence =
    isStoredOccExecutionEvidenceLoaderV1(
      pointMutationOccExecutionEvidenceCandidate,
    )
      ? pointMutationOccExecutionEvidenceCandidate
      : undefined;
  const pointMutationOccJournalCandidate = isNonArrayRecord(
      pointMutationOccRerunCandidate,
    )
    ? Reflect.get(pointMutationOccRerunCandidate, "journal")
    : undefined;
  const pointMutationOccJournal = isPointMutationJournalV1(
      pointMutationOccJournalCandidate,
    )
    ? pointMutationOccJournalCandidate
    : undefined;
  const pointMutationOccTerminalizationCandidate = isNonArrayRecord(
      pointMutationOccRerunCandidate,
    )
    ? Reflect.get(pointMutationOccRerunCandidate, "terminalization")
    : undefined;
  const pointMutationOccTerminalization =
    isPointMutationSessionAttemptTerminalizationV1(
      pointMutationOccTerminalizationCandidate,
    )
      ? pointMutationOccTerminalizationCandidate
      : undefined;
  const pointMutationOccContextFactoryCandidate = isNonArrayRecord(
      pointMutationOccRerunCandidate,
    )
    ? Reflect.get(pointMutationOccRerunCandidate, "contextFactory")
    : undefined;
  const pointMutationOccContextFactory =
    isPointMutationOccExecutionContextFactoryV1(
      pointMutationOccContextFactoryCandidate,
    )
      ? pointMutationOccContextFactoryCandidate
      : undefined;
  const pointMutationOccRunnerCandidate = isNonArrayRecord(
    pointMutationOccRerunCandidate,
  )
    ? Reflect.get(pointMutationOccRerunCandidate, "runner")
    : undefined;
  const pointMutationOccRunner = isPointMutationOccRuntimeNeutralRunnerV1(
    pointMutationOccRunnerCandidate,
  )
      ? pointMutationOccRunnerCandidate
      : undefined;
  const pointMutationOccLivenessCandidate = isNonArrayRecord(
      pointMutationOccRerunCandidate,
    )
    ? Reflect.get(pointMutationOccRerunCandidate, "liveness")
    : undefined;
  const pointMutationOccLiveness = isPointMutationExecutionClaimLivenessV1(
      pointMutationOccLivenessCandidate,
    )
    ? pointMutationOccLivenessCandidate
    : undefined;
  const pointMutationOccHeartbeatIntervalCandidate = isNonArrayRecord(
      pointMutationOccRerunCandidate,
    )
    ? Reflect.get(
        pointMutationOccRerunCandidate,
        "heartbeatIntervalMilliseconds",
      )
    : undefined;
  const pointMutationOccExecutionEvidencePort =
    requireStoredPointMutationCapabilityDependencyV1(
      stage,
      "pointMutationOccExecutionEvidence",
      pointMutationOccExecutionEvidence,
    );
  const pointMutationOccJournalPort =
    requireStoredPointMutationCapabilityDependencyV1(
      stage,
      "pointMutationOccJournal",
      pointMutationOccJournal,
    );
  const pointMutationOccTerminalizationPort =
    requireStoredPointMutationCapabilityDependencyV1(
      stage,
      "pointMutationOccTerminalization",
      pointMutationOccTerminalization,
    );
  const pointMutationOccContextFactoryPort =
    requireStoredPointMutationCapabilityDependencyV1(
      stage,
      "pointMutationOccContextFactory",
      pointMutationOccContextFactory,
    );
  const pointMutationOccRunnerPort =
    requireStoredPointMutationCapabilityDependencyV1(
      stage,
      "pointMutationOccRunner",
      pointMutationOccRunner,
    );
  const pointMutationOccLivenessPort =
    requireStoredPointMutationCapabilityDependencyV1(
      stage,
      "pointMutationOccLiveness",
      pointMutationOccLiveness,
    );
  const pointMutationOccHeartbeatInterval =
    typeof pointMutationOccHeartbeatIntervalCandidate === "number"
      ? pointMutationOccHeartbeatIntervalCandidate
      : requireStoredPointMutationCapabilityDependencyV1<number>(
        stage,
        "pointMutationOccHeartbeatInterval",
        undefined,
      );

  const pointMutationExecutionLiveness =
    createPointMutationExecutionLivenessCoordinatorV1(
      executionClaims.admission,
      pointMutationOccLivenessPort,
      Object.freeze({
        heartbeatIntervalMilliseconds: pointMutationOccHeartbeatInterval,
      }),
    );

  const {
    executeExactPointMutationAttempt: executeExactPointMutationAttemptKernel,
  } = makeExactPointMutationExecutionOperationsV1({
    functionMetadata: commitAuthority.functionMetadata,
    contextFactory: pointMutationOccContextFactoryPort,
    attemptLoading: pointMutationOccAttemptLoading,
    journal: pointMutationOccJournalPort,
    runner: pointMutationOccRunnerPort,
    terminalization: pointMutationOccTerminalizationPort,
    deriveAuthority,
    authenticate,
    authenticateCommitAuthority,
    verifyCommitInput,
    planPointCommit,
    enterPointCommitFinishing,
    publishFinishingPointCommit,
  });

  const occExecution = makeStoredPointMutationOccRerunExecutionOperationsV1({
    base: authorization,
    claimAuthorizedPointMutationOccRerun,
    executionClaimAdmission: executionClaims.admission,
    executionLiveness: pointMutationExecutionLiveness,
    executionEvidence: pointMutationOccExecutionEvidencePort,
    resolvePointMutationOccOutcome,
    verifyCommitAuthorityEvidence: (state, evidence) =>
      verifyCommitAuthorityEvidenceEffect(
        state,
        evidence,
        grantKernel,
        commitAuthority.applicationMutationGrantVerifier,
      ),
    executeExactPointMutationAttempt: executeExactPointMutationAttemptKernel,
    publicationResultFromCommittedOutcome,
  });
  if (stage === "occRerunExecution") return occExecution;
  const initialExecution = Object.freeze({
    ...occExecution,
    ...makeInitialPointMutationExecutionOperationsV1({
      rerun: occExecution,
      executionClaimAdmission: executionClaims.admission,
      executionLiveness: pointMutationExecutionLiveness,
      executionEvidence: pointMutationOccExecutionEvidencePort,
      verifyCommitAuthorityEvidence: (state, evidence) =>
        verifyCommitAuthorityEvidenceEffect(
          state,
          evidence,
          grantKernel,
          commitAuthority.applicationMutationGrantVerifier,
        ),
      executeExactPointMutationAttempt: executeExactPointMutationAttemptKernel,
      publicationResultFromCommittedOutcome,
    }),
  } satisfies PointMutationInitialExecutionV1);
  if (stage === "initialExecution") return initialExecution;
  const pointMutationRedispatchCandidate: unknown =
    "pointMutationRedispatch" in commitAuthority
      ? commitAuthority.pointMutationRedispatch
      : undefined;
  const pointMutationRedispatchAcquisitionCandidate = isNonArrayRecord(
      pointMutationRedispatchCandidate,
    )
    ? Reflect.get(pointMutationRedispatchCandidate, "acquisition")
    : undefined;
  const pointMutationRedispatchAcquisition =
    isPointMutationExecutionClaimDispatchAcquisitionV1(
        pointMutationRedispatchAcquisitionCandidate,
      )
      ? pointMutationRedispatchAcquisitionCandidate
      : undefined;
  const pointMutationRedispatchDispositionCandidate = isNonArrayRecord(
      pointMutationRedispatchCandidate,
    )
    ? Reflect.get(pointMutationRedispatchCandidate, "disposition")
    : undefined;
  const pointMutationRedispatchDisposition =
    isPointMutationSessionAttemptDispositionV1(
        pointMutationRedispatchDispositionCandidate,
      )
      ? pointMutationRedispatchDispositionCandidate
      : undefined;
  const pointMutationRedispatchAcquisitionPort =
    requireStoredPointMutationCapabilityDependencyV1(
      stage,
      "pointMutationRedispatchAcquisition",
      pointMutationRedispatchAcquisition,
    );
  const pointMutationRedispatchDispositionPort =
    requireStoredPointMutationCapabilityDependencyV1(
      stage,
      "pointMutationRedispatchDisposition",
      pointMutationRedispatchDisposition,
    );

  return makeStoredPointMutationCrashRedispatchOperationsV1({
    base: initialExecution,
    acquisition: pointMutationRedispatchAcquisitionPort,
    disposition: pointMutationRedispatchDispositionPort,
    executionClaims,
    attemptLoading: pointMutationOccAttemptLoading,
    terminalization: pointMutationOccTerminalizationPort,
    executionLiveness: pointMutationExecutionLiveness,
    executionEvidence: pointMutationOccExecutionEvidencePort,
    deriveAuthority,
    lookupAuthority,
    loadAndVerifyStoredEvidence,
    mintAuthenticatedStoredAttempt,
    authenticateCommitAuthority,
    verifyCommitInput,
    planPointCommit,
    enterPointCommitFinishing,
    publishFinishingPointCommit,
    resumePointCommit,
    verifyCommitAuthorityEvidence: (state, evidence) =>
      verifyCommitAuthorityEvidenceEffect(
        state,
        evidence,
        grantKernel,
        commitAuthority.applicationMutationGrantVerifier,
      ),
    executeExactPointMutationAttempt: executeExactPointMutationAttemptKernel,
    resolvePointCommitOutcomeFromStoredSession,
    publicationResultFromCommittedOutcome,
  });
}
