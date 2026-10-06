import { closeExactAttemptScopeClockObservation, openExactAttemptScopeClockObservation, lockScopeClockRowsForOrdinaryWriteInTransactionEffect, lockScopeExecutionAuthorityInTransactionEffect,
  selectScopeClockRows, ScopeAuthorizationRevocationEpochPersistenceError } from "./scopeClock";
import { openProtectedMetadataFinalGuardScope, closeProtectedMetadataFinalGuardScope,
  flushProtectedMetadataFinalGuards, prepareProtectedMetadataFinalGuardBatch, acceptProtectedMetadataFinalGuardBatch } from "./preparedMetadataEpoch";
import type { AppSchemaCandidateWriteGuardPlanningHead } from "./appSchemaCandidateValidation";
import { ACCEPT_INSTALLED_ATTEMPT_SCOPE_AUTHORITY_IN_TRANSACTION, RUN_INSTALLED_ACCEPTING_READ_COMMITTED, isInstalledAttemptScopeAuthorityTarget } from "./scopeAuthorityControlRead";
import { sqlCall } from "./pointCommitErrors";
import { PointCommitPublicationObservation, observePointCommitPublicationEffect, observePointCommitPublicationPromise } from "./pointCommitPublicationObservation";
import { prepareAppUniqueConstraintSet, acceptPreparedAppUniqueConstraintSet, type AppUniqueConstraintSetPreparation } from "./appUniqueConstraintSetBuildV1";
import { hasApplicationDocumentOrderedIndexComposition } from "./applicationDocumentMaterialization/indexComposition";
import { MAX_POINT_COMMIT_UNIQUE_KEY_TRANSITIONS_V1 } from "./applicationDocumentMaterialization/materialization";
import { prepareApplicationDocumentSettlementEffect, preparedApplicationDocumentSettlementHasFailure,
  acceptPreparedApplicationOriginalsEffect, acceptPreparedApplicationDeveloperTransitionsEffect,
  acceptPreparedApplicationUniqueOwnersEffect, acceptPreparedApplicationRelationsEffect,
  type PreparedApplicationDocumentSettlement } from "./applicationDocumentMaterialization/materialization";
import type { StoredCommitAuthorityEvidenceLoaderPortsV1 } from "./storedCommitAuthority/postgresLoader";
import { runPointCommitInTransactionEffect, projectPointCommitTransactionResult, runPointCommitPromiseEffect } from "./pointCommitPromiseBoundary";
import { allocatePointCommitKernelResult, readPointCommitDatabaseTime, writeScopePublicationPrefix, advanceScopePublicationClock,
  requireScopePublicationStrongReferences, reproveScopePublicationPrefix } from "./commitPublication/pointCommitProjection";
import { scopePublicationClockAdvanceSource, requirePointCommitClockPublicationResult } from "./commitPublication/publication";
import { scopePublicationMetadataChanged, scopePublicationProcedureFailure } from "./commitPublication/prefixProjection";
import { runDrizzleStatementEffect } from "./drizzleStatementEffect";
import { PointCommitDependencyV1, PointCommitRowIntentV1, PreparedLivePointCommitRowIntentV1, PreparedPointCommitRowIntentV1, PreparedPointCommitCandidateSchemaWriteGuard, PreparedPointCommitApplicationRelations, LocatedPreparedPointCommitApplicationRelations, LoadedPointCommitHeadV1, type ApplicationDocumentMaterializationCommand } from "./applicationDocumentMaterialization/model";
import { hasApplicationRelationCommitAuthorityForPointCommit, prepareApplicationRelationDefinitionsFromLocatedBindingResult } from "./applicationRelationCommit";
import { hasAppSchemaCandidateWriteGuardComposition, prepareFiniteAppSchemaCandidateWriteGuardFromPlanningHeadEffect,
  AppSchemaCandidateWriteGuardError } from "./appSchemaCandidateValidation";
import { PointCommitConflictV1Error, PointCommitConflictEvidenceV1, PointCommitStaleAuthorityV1Error, PointCommitStaleAuthorityReasonV1, PointCommitCorruptionV1Error, PointCommitCorruptionReasonV1, PointCommitSqlFailureMarkerV1, PointCommitSqlOperationV1, PointCommitSqlErrorV1, mapTransactionFailure, PointCommitRollbackProofV1Error, corruption, sqlError, findSqlState } from "./pointCommitErrors";
import type { PointCommitConflictCauseV1 } from "./pointCommitErrors";
import { runEffectTransactionSettlement } from "./effectTransaction";
import { prepareFiniteActiveApplication, type ApplicationActivationRepository, type PreparedFiniteActiveApplication } from "./applicationActivation";
import { confirmPreparedFiniteSessionJournalEntry, runPreparedFiniteReplacementSessionJournalEntryEffect,
  readOriginalFiniteExecutionAuthority, projectOriginalFinitePublicationSession,
  type PreparedFiniteSessionJournalEntry, type ConfirmedFiniteRootEntryCapture,
  type runPreparedFiniteSessionJournalEntryEffect } from "./sessionJournalFiniteEntry";
import type { ScopeClockRow } from "./scopeClock";
import { prepareIntrinsicIndexDefinitions, prepareDeveloperIndexDefinitions, prepareUniqueConstraintDefinitions, validateApplicationUniqueTransitionBudget, prepareCandidateSchemaWriteGuard, prepareApplicationRelationDefinitions, lockPointCommitIntrinsicIndexBuilds, lockPointCommitDeveloperIndexBuilds, loadPointCommitHeads, lockFinitePointCommitDeveloperIndexBuildsAndHeads, loadApplicationDocumentPriorState, hasOwn, parseNonNegativeIntegerTextResult, parseNullableCommitSeqTextResult, decodePointCommitSeqResult, decodePointCommitCreationTimeResult, validatePointCommitDependenciesResult, findPointCommitConflictAfterEvidenceValidationResult, preparePointCommitApplicationRelationPlan, preparePointCommitDeveloperIndexActions, preparePointCommitUniqueKeyActions, runCandidateSchemaWriteGuard, materializeApplicationDocumentRows, pointDependenciesEqual, emitTransactionStep, maintainPointCommitApplicationRelationsEffect, resetPointCommitDeveloperIndexValidations } from "./applicationDocumentMaterialization/materialization";

import { type ScopePublicationContribution } from "./commitPublication/scopePublicationModel";

import { bytesEqualFullScan as bytesEqual, copyBytes, encodeBytesToLowercaseHex, isUint8Array, isUint8ArrayWithByteLength } from "@flarex/utils/bytes";
import { finiteDateMilliseconds } from "@flarex/utils/dates";
import { isNonNegativeSafeInteger, isPositiveSafeInteger } from "@flarex/utils/numbers";
import { isNonArrayRecord } from "@flarex/utils/records";
import { and, eq, inArray, sql } from "drizzle-orm";
import { Cause, Data, Effect, Encoding, Exit, Result, Schema } from "effect";
import { ApplicationMutationAdmissionError } from "./applicationMutationAdmission";
import { validateApplicationWriteOwnershipForCommit } from "./applicationWriteOwnership/Commit";
import { hasLogicalParticipantCommitAuthority, inspectLogicalParticipantCommitAuthority, inspectLogicalParticipantCommitAuthoritySource, inspectLogicalParticipantCommitMetadataProjection, requireLogicalParticipantCommitAuthorityEffect, requireFiniteLogicalParticipantCommitAuthorityEffect, type LogicalParticipantCommitAuthority } from "./logicalDocuments/participantAdmission";
import { withSharedLogicalSourceBindingChecks } from "./logicalDocuments/sourceAdmission";
import { inspectLogicalParticipantAdmissionBundle, inspectFiniteOperationCommitAuthority,
  prepareFiniteOperationCommitObservation }
  from "./logicalDocuments/participantAdmission";
import { readOwnedFrozenFiniteAttempt, readFrozenFiniteAttemptOrigin, type FrozenFiniteAttempt, type OwnedFrozenFiniteAttemptData, type FrozenFiniteOperation } from "./sessionJournalFiniteFreeze";
import { lockFiniteAttemptAnchorRowByIdentityInTransaction, readFiniteAttemptAnchorRow,
  lendComparedFinitePublicationAnchor,
  requireFiniteAttemptIsLive, FiniteAttemptAnchorError,
  fenceFiniteAttemptNonacceptanceInTransaction, confirmFiniteAttemptNonacceptance, observeFencedFiniteAttemptNonacceptance,
  replaceFiniteAttemptAnchorInTransaction, readFiniteAttemptNonacceptanceProof,
  rejectFiniteAttemptNonacceptanceInTransaction,
  MAX_FINITE_ATTEMPT_COUNT,
  type FiniteAttemptNonacceptanceProof, type PendingFiniteAttemptNonacceptance } from "./finiteAttemptAnchor";
import { validateLogicalDocumentChanges } from "./logicalDocuments/contribution";
import { validateLogicalParticipantDependencyEvidence } from "./logicalDocuments/commitEvidence";
import { decodeLogicalParticipantDependencyEvidence } from "./logicalDocuments/journalEvidence";
import { validateConsumedMetadataDependencies, captureFiniteMetadataDependency, finiteMetadataTableKey,
  finiteMetadataContractKey, prepareConsumedFiniteMetadataComparison,
  prepareFiniteTableWriteClosureComparison, acceptFiniteTableWriteClosureComparison, acceptFiniteMetadataComparisonVerdict } from "./finiteMetadataDependencies";
import { readStoredFiniteMetadataReservation, type FiniteMetadataReservation } from "./finiteMetadataReservation";
import { FiniteMetadataConflictSchema, LogicalMetadataReadDependencySchema, logicalMetadataDependencyIdentity,
  type LogicalMetadataReadDependency } from "flarex-protocol/commit-protocol";
import { LogicalSearchMaintenanceError, type LogicalSearchDefinition } from "./logicalDocuments/searchEntries";
import { admittedCommerceEventGroup, validateAdmittedCommerceEventIntents, validateAdmittedOperationEventIntents,
  type ParticipantEventSelection, prepareAtomicCommerceEvents } from "./atomicCommerce/events";
import { EventEnvelope, type CommittedEvent } from "./commitEvents/model";
import { commitEventsDigest } from "./commitEvents/digest";
import { finitePublicationAnchorQuery, observeFinitePublicationMetadata } from "./finitePublicationObservation";
import { beginFiniteApplicationMaterialization, type CapturedApplicationMaterializationCoverage } from "./indexBuildStates";
import { lockInstallationForCurrentTransaction, closeInstallationAdmission } from "./installationLifecycle";

import { type AppCreationTimeV1 } from "flarex-protocol/app-document";
import { RELATION_INCOMING_PAGE_MAXIMUM_IDENTITIES_V1 } from "flarex-protocol/internal/application-schema-binding";
import { AppRowIdHexV1Schema, appDocumentIdV1FromRowIdentity, appRowIdHexV1ToBytes, appRowIdHexV1FromBytesResult, decodeAppDocumentIdentityV1Result, type AppRowIdHexV1 } from "flarex-protocol/app-document-id";
import { CatalogEdgeDefinitionIdSchema, type CatalogIndexDefinitionId, type CatalogUniqueConstraintDefinitionId, type CatalogEdgeDefinitionId, CatalogRelationIdSchema, type CatalogRelationId, CatalogIndexDefinitionIdSchema, CatalogTableIdSchema, type CatalogTableId } from "flarex-protocol/catalog";
import { CanonicalSuccessfulResultBytesV1Schema, CanonicalSessionJournalBytesSchema, decodeCanonicalSessionJournalEffect, CommitSyscallSequenceV1Schema, LogicalApplicationRelationIncomingReadDependencyV1Schema, LogicalIndexRangeReadDependencyV1Schema, MAX_COMMIT_INDEXED_QUERY_SYSCALLS_V1, MAX_COMMIT_INDEX_RANGE_DEPENDENCY_EVIDENCE_BYTES_V1, MAX_COMMIT_INDEX_RANGE_READ_DEPENDENCIES_V1, MAX_COMMIT_MATERIAL_WRITE_EVENT_EVIDENCE_BYTES_V1, MAX_COMMIT_READ_DOCUMENTS_V1, MAX_COMMIT_READ_SEMANTIC_BYTES_V1, MAX_COMMIT_RELATION_READ_DEPENDENCIES_V1, MAX_COMMIT_RELATION_READ_SYSCALLS_V1, MAX_COMMIT_RELATION_BASE_OCCURRENCES_V1, MAX_COMMIT_POINT_READ_DEPENDENCIES_V1, MAX_COMMIT_WRITE_OPERATIONS_V1, MAX_COMMIT_WRITE_SEMANTIC_BYTES_V1, MAX_POINT_COMMIT_MATERIAL_ROWS_V1, SESSION_JOURNAL_FORMAT, canonicalizeAdmittedParticipantBindingV1Result, canonicalizeAdmittedSourceBundleResult, canonicalizeSuccessfulResultV1Effect, measureLogicalIndexRangeReadDependencyEvidenceBytesV1Result, normalizeLogicalIndexRangeReadDependenciesV1Result, verifyParticipantPointCorrelationEffect, type ParticipantPointCorrelation, type SessionJournal, type AdmittedParticipantOperation, type SourceContribution, type CommitFinalSyscallSequenceV1, type CommitSyscallSequenceV1, type CommitMaterialWriteEventEvidenceBytesV1, type LogicalReadDependencyV1, type LogicalApplicationRelationIncomingReadDependencyV1, type LogicalIndexRangeReadDependencyV1, type SuccessfulResultSha256HexV1 } from "flarex-protocol/commit-protocol";
import { orderedIndexBoundHexV1ToBytes, orderedIndexKeyBytesHexV1FromBytes, orderedIndexKeyBytesHexV1ToBytes, orderedIndexRowIdHexV1ToBytes, orderedIndexRowIdHexV1FromBytesResult, OrderedIndexKeyBytesHexV1Schema, OrderedIndexRowIdHexV1Schema, type OrderedIndexKeyBytesHexV1, type OrderedIndexRowIdHexV1 } from "flarex-protocol/ordered-index";
import { CatalogSchemaVersionIdSchema, type CatalogSchemaVersionId } from "flarex-protocol/schema-manifest";
import { CommitSeqSchema, SnapshotTokenSchema, ScopeEpochUuidV1Schema, ScopeUuidV1Schema, projectScopeEpochUuidV1Result, projectScopeIdUuidV1Result, replacementScopeIdV1FromUuid, type CommitSeq, type FlarexDbV1StorageGeneration, type ReplacementScopeIdV1, type ScopeEpochUuidV1, type ScopeUuidV1, type SnapshotToken, type StorageGenerationFence } from "flarex-protocol/storage-authority";
import type { TransactionGrantDeploymentIdV1 } from "flarex-protocol/transaction-grant";
import { TRANSACTION_SESSION_PROTOCOL_VERSION_V1, MAX_TRANSACTION_ATTEMPT_FENCE, TransactionAttemptFenceSchema, TransactionAuthorizationRevocationEpochSchema, TransactionIdentityAccessPolicySha256V1Schema, TransactionRequestSha256V1Schema, type StoredTransactionSessionScalarsV1, type TransactionArtifactIdV1, type TransactionArtifactRuntimeV1, type TransactionAttemptFence, type TransactionAuthorizationGrantIdV1, type TransactionAuthorizationRevocationEpoch, type TransactionExecutionModuleV1, type TransactionFunctionPathV1, type TransactionPackageIdV1, type TransactionPolicyVersionV1, type TransactionRequestKeyV1, type TransactionSessionIdV1, type TransactionSourcePackageSha256HexV1 } from "flarex-protocol/transaction-session";
import { FLAREX_VALUE_CODEC_VERSION_V1, FlarexValueSha256V1Schema, jsonToFlarexValueV1, FlarexValueCodecV1Error, FlarexValueEvidenceV1Error, canonicalizeFlarexValueV1, decodeCanonicalFlarexValueEvidenceV1, isCanonicalFlarexRuntimeObjectV1, type CanonicalFlarexRuntimeValueV1, type CanonicalFlarexValueV1, type FlarexValueCodecVersion } from "flarex-protocol/value";

import { type AppDeveloperIndexDefinitionPortV1 } from "./appDeveloperIndexCommitV1";
import { snapshotApplicationExecutionAuthorityJson } from "./applicationExecutionAuthoritySnapshot";
import { hasAppUniqueConstraintDefinitionAuthorityV1, type AppUniqueConstraintDefinitionPortV1 } from "./appUniqueConstraintCommitV1";
import { isLocatedAppUniqueConstraintDefinitionV1, type LocatedAppUniqueConstraintDefinitionV1 } from "./appUniqueConstraintDefinitions";
import { hasAppUniqueConstraintSetEligibilityPortV1, hasAppUniqueConstraintSetEligibilityCompositionV1, hasAppUniqueConstraintSetEligibilityForDefinitionPortV1, loadAppUniqueConstraintSetEligibilityV1Effect, loadAppUniqueConstraintSetEligibilityForReadinessV1Effect, validateAppUniqueConstraintSetEligibilityEvidenceInTransactionV1Effect, AppUniqueConstraintSetEligibilityV1Error, AppUniqueConstraintSetBuildIntegrationV1Error, type AppUniqueConstraintSetEligibilityInputV1, type AppUniqueConstraintSetEligibilityEvidenceV1, type AppUniqueConstraintSetEligibilityPortV1, type AppUniqueConstraintSetEligibilityResultV1, type AppUniqueConstraintSetBuildStaleAuthorityV1Error, type AppUniqueConstraintSetBuildStateV1Error, type LoadAppUniqueConstraintSetEligibilityV1Error } from "./appUniqueConstraintSetBuildV1";

import { isLocatedAppIndexDefinitionV1, type LocatedAppIndexDefinitionV1 } from "./appIndexDefinitions";
import { AppRowReadPersistenceError, consumeAppRowSnapshotRevisionsInTransactionEffect, isAppendAppRowRevisionV1Error, type AppRowTransaction } from "./appRows";
import { AppRelationEdgePersistenceError, readAppRelationEdgeAdjacencyVersionInTransactionEffect, readIncomingAppRelationEdgeAdjacencyVersionsInTransactionEffect } from "./appRelationEdges";
import { ApplicationRelationCommitUnavailableError, type ApplicationRelationAdjacencyChange, type ApplicationRelationCommitPort } from "./applicationRelationCommit";
import { readCoherentApplicationActiveHeadForShareInTransactionEffect } from "./applicationActiveHeadRead";

import { type AppSchemaCandidateWriteGuardPort } from "./appSchemaCandidateValidation";
import type { FlarexMetadataDatabase } from "./deployments";
import type { IntrinsicCreationTimeIndexDefinitionPortV1 } from "./intrinsicCreationTimeIndexBuildV1";

import { CommittedPointOutcomeCorruptionErrorV1, CommittedPointOutcomeInputErrorV1, CommittedPointOutcomeRequestKeyReuseErrorV1, CommittedPointOutcomeSqlErrorV1, type CommittedPointOutcomeResolutionV1, type CommittedPointOutcomeTokenV1, type CommittedPointSuccessfulResultV1, type CommittedPointOutcomeCorruptionReasonV1, type CommittedPointOutcomeMismatchV1, type CommittedPointOutcomeStoredScalarEvidenceV1, type ResolveCommittedPointOutcomeErrorV1, type ResolveCommittedPointOutcomeInputV1, validateCommittedPointOutcomeRequestEvidenceShapeV1, validateCommittedPointOutcomeStoredScalarsAfterRequestShapeV1 } from "./committedPointOutcome";

import { rowsFromDriverExecuteResult } from "./driverExecuteResult";
import { createCommittedPointOutcomeResolverV1 } from "./committedPointOutcome";
import { observeDrizzleQuery as observeCompiledDrizzleQuery } from "./drizzleQueryObservation";
import { decodeScopeClockRecordResult, ScopeClockCorruptionError, ScopeClockNotFoundError, type ScopeClockRecord } from "./scopeClock";
import { resolveLocatedTrustedScopeAuthorityByIdEffect, resolveTrustedScopePlacementSnapshotResult, resolveTrustedScopeAuthoritySnapshotResult,
  TrustedScopeAuthorityPortError, TrustedScopeAuthorityResolutionError, type LocatedTrustedScopeAuthority, type TrustedScopeAuthority, type TrustedScopeAuthorityError, type TrustedScopeSelection } from "./scopeAuthorityResolution";
import { fxSystemApplicationActiveHeads } from "./applicationActivationSchema";
import { fxSystemApplicationReadiness } from "./applicationRelationSchema";
import { fxSystemCommits, fxSystemIdempotency, fxSystemApplicationReadinessV1, fxSystemScopeClocks, fxSystemSnapshotLeases, fxSystemTransactionExecutionClaims, fxSystemTransactionJournalReceipts, fxSystemTransactionJournalIndexRanges, fxSystemTransactionJournalPoints, fxSystemTransactionJournalRelationIncomingDependencies, fxSystemTransactionJournalWriteEvents, fxSystemTransactionJournals, fxSystemTransactionSessions } from "./schema";
import { deriveTransactionExecutionClaimV1, lockExactTransactionExecutionClaimV1Result, requireLiveTransactionExecutionClaimV1Result, TransactionExecutionClaimCorruptionV1Error, TransactionExecutionClaimStaleV1Error } from "./transactionExecutionClaimPersistence";
import { decodeTransactionExecutionClaimFenceV1, decodeTransactionExecutionClaimOwnerV1, type TransactionExecutionClaimObservationV1, type TransactionExecutionClaimOwnerV1, type TransactionExecutionClaimPinV1 } from "./transactionExecutionClaimModel";
import { isLocatedExactRunningAttemptKernelV1, isLocatedPointCommitPublicationTargetV1, isLocatedReadCommittedAttemptTargetV1, LocatedReadCommittedTransactionFailureV1, RESOLVE_LOCATED_COMMITTED_POINT_OUTCOME_V1, RUN_LOCATED_READ_COMMITTED_V1, type LocatedReadCommittedAttemptTargetV1, type LocatedPointCommitPublicationTargetV1 } from "./transactionSessionAttemptKernel";
import type { PointMutationSessionAuthorityResolutionPortsV1 } from "./transactionSessionActivation";
import { scopePhysicalLocatorsEqual } from "./scopePhysicalLocator";
import type { TrustedScopeAuthorityResolutionPorts } from "./scopeAuthorityResolution";
import { buildFreshTransactionAttemptFacetV1, isPristineFreshTransactionAttemptJournalRootV1 } from "./transactionSessionAttemptFacet";

export type {
  CommittedPointOutcomeResolutionV1,
  ResolveCommittedPointOutcomeInputV1,
} from "./committedPointOutcome";
export type {
  AppUniqueConstraintSetEligibilityEvidenceV1,
  AppUniqueConstraintSetEligibilityResultV1,
} from "./appUniqueConstraintSetBuildV1";
const HASH_BYTE_LENGTH = 32;

const decodePointCommitJournalBytesResult = Schema.decodeUnknownResult(CanonicalSessionJournalBytesSchema);
const decodePointCommitEventEnvelope = Schema.decodeUnknownResult(EventEnvelope, { onExcessProperty: "error" });
const decodePointCommitTableIdResult = Schema.decodeUnknownResult(
  Schema.toType(CatalogTableIdSchema),
);
const decodePointCommitRowIdResult = Schema.decodeUnknownResult(
  Schema.toType(AppRowIdHexV1Schema),
);
const decodePointCommitSchemaVersionIdResult = Schema.decodeUnknownResult(
  Schema.toType(CatalogSchemaVersionIdSchema),
);
const decodePointCommitMetadataDependenciesEffect = Schema.decodeUnknownEffect(Schema.Array(LogicalMetadataReadDependencySchema));
const FinitePublicationSourceObservationPagesSchema = Schema.Array(Schema.Unknown);
const decodeFinitePublicationSourceObservationPages = Schema.decodeUnknownEffect(FinitePublicationSourceObservationPagesSchema);
const decodePointCommitMetadataConflictResult = Schema.decodeUnknownResult(Schema.toType(FiniteMetadataConflictSchema));
const decodePointCommitEdgeDefinitionIdResult = Schema.decodeUnknownResult(CatalogEdgeDefinitionIdSchema);
const decodePointCommitEncodedRowIdResult = Schema.decodeUnknownResult(AppRowIdHexV1Schema);
const decodePointCommitIndexRangeDependencyResult = Schema.decodeUnknownResult(LogicalIndexRangeReadDependencyV1Schema);
const decodePointCommitRelationDependencyResult = Schema.decodeUnknownResult(Schema.toType(LogicalApplicationRelationIncomingReadDependencyV1Schema));
const decodePointCommitSyscallSequenceResult = Schema.decodeUnknownResult(Schema.toType(CommitSyscallSequenceV1Schema));
const decodePointCommitEncodedTableIdResult = Schema.decodeUnknownResult(CatalogTableIdSchema);
const decodePointCommitIndexDefinitionIdResult = Schema.decodeUnknownResult(CatalogIndexDefinitionIdSchema);
const decodePointCommitOrderedKeyResult = Schema.decodeUnknownResult(OrderedIndexKeyBytesHexV1Schema);
const decodePointCommitOrderedRowIdResult = Schema.decodeUnknownResult(OrderedIndexRowIdHexV1Schema);

interface PointCommitAuthorityCommonPinsV1 {
  readonly deploymentId: TransactionGrantDeploymentIdV1;
  readonly scopeId: ReplacementScopeIdV1;
  readonly sessionId: TransactionSessionIdV1;
  readonly attemptFence: TransactionAttemptFence;
  readonly storageGeneration: FlarexDbV1StorageGeneration;
  readonly storageGenerationFence: StorageGenerationFence;
  readonly snapshotToken: SnapshotToken;
  readonly schemaVersionId: CatalogSchemaVersionId;
  readonly functionPath: TransactionFunctionPathV1;
  readonly functionKind: "mutation";
  readonly policyVersion: TransactionPolicyVersionV1;
  readonly authorizationRevocationEpoch: TransactionAuthorizationRevocationEpoch;
  readonly requestKey: TransactionRequestKeyV1;
}

export type PointCommitAuthorityPinsV1 =
  | Readonly<PointCommitAuthorityCommonPinsV1 & {
      readonly executionAuthorityGeneration: "legacy_dynamic_worker_v1";
      readonly packageId: TransactionPackageIdV1;
      readonly artifactRuntime: TransactionArtifactRuntimeV1;
      readonly artifactId: TransactionArtifactIdV1;
      readonly sourcePackageHash: TransactionSourcePackageSha256HexV1;
      readonly executionModule: TransactionExecutionModuleV1;
      readonly applicationExecutionAuthoritySha256?: never;
    }>
  | Readonly<PointCommitAuthorityCommonPinsV1 & {
      readonly executionAuthorityGeneration: "application_v1";
      readonly applicationExecutionAuthoritySha256: Uint8Array;
      readonly packageId?: never;
      readonly artifactRuntime?: never;
      readonly artifactId?: never;
      readonly sourcePackageHash?: never;
      readonly executionModule?: never;
    }>;

export type PointCommitSessionScalarsV1 =
  StoredTransactionSessionScalarsV1 extends infer Session
    ? Session extends StoredTransactionSessionScalarsV1
      ? Omit<Session, "authorizationGrantId"> & {
          readonly authorizationGrantId: TransactionAuthorizationGrantIdV1;
        }
      : never
    : never;

export interface PointCommitSealIdentityV1 {
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
  readonly journalFormat: typeof SESSION_JOURNAL_FORMAT;
  readonly journalProtocolVersion: number;
  readonly journalValueCodecVersion: FlarexValueCodecVersion;
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
  readonly relationReadSyscalls: number;
  readonly relationDependencyCount: number;
  readonly relationBaseOccurrences: number;
  readonly writeOperations: number;
  readonly writeSemanticBytes: number;
  readonly materialWriteEventEvidenceBytes:
    CommitMaterialWriteEventEvidenceBytesV1;
  readonly receiptEvidenceBytes: number;
  readonly participantWorkBytes: number;
  readonly participantWorkCalls: number;
}

export interface PointCommitAttemptScalarCommandV1 {
  readonly authorityPins: PointCommitAuthorityPinsV1;
  readonly session: PointCommitSessionScalarsV1;
  readonly sealIdentity: PointCommitSealIdentityV1;
}

export interface PointCommitFinishingTransitionCommandV1
  extends Omit<PointCommitAttemptScalarCommandV1, "session" | "sealIdentity"> {
  readonly session: PointCommitRunningSessionScalarsV1;
  readonly sealIdentity: Readonly<
    Omit<PointCommitSealIdentityV1, "lifecycle"> & {
      readonly lifecycle: "running";
    }
  >;
  readonly executionClaim: TransactionExecutionClaimPinV1;
}

type PointCommitRunningSessionScalarsV1 =
  PointCommitSessionScalarsV1 extends infer Session
    ? Session extends PointCommitSessionScalarsV1
      ? Readonly<Omit<Session, "lifecycle"> & { readonly lifecycle: "running" }>
      : never
    : never;

export interface PointCommitTransactionCommandV1
  extends PointCommitAttemptScalarCommandV1 {
  /** Full authenticated journal preserves attempted writes before net-zero coalescing. */
  readonly journalBytes?: Uint8Array;
  readonly candidatePlanningHead?: AppSchemaCandidateWriteGuardPlanningHead;
  readonly dependencies: ReadonlyArray<PointCommitDependencyV1>;
  readonly indexRangeDependencies: ReadonlyArray<
    LogicalIndexRangeReadDependencyV1
  >;
  readonly relationDependencies: ReadonlyArray<
    LogicalApplicationRelationIncomingReadDependencyV1
  >;
  readonly rowIntents: ReadonlyArray<PointCommitRowIntentV1>;
}

export interface PointFiniteCommitCommand {
  readonly authorityPins: PointCommitAuthorityPinsV1;
  readonly session: PointCommitSessionScalarsV1;
  readonly executionClaim: TransactionExecutionClaimPinV1;
  readonly frozenAttempt: FrozenFiniteAttempt;
}
export interface PointFiniteCommitPublisherPort {
  readonly publishFinite: (command: PointFiniteCommitCommand) => Effect.Effect<PointCommitPublicationResultV1,
    PointCommitPublicationV1Error | PointCommitDecisionUncertainV1Error>;
  readonly resolveFinite: (command: PointFiniteAttemptResolutionCommand) => Effect.Effect<PointFiniteAttemptResolution,
    PointCommitPublicationV1Error | PointCommitDecisionUncertainV1Error>;
}
export type PointFiniteAttemptResolutionCommand = Omit<PointFiniteCommitCommand, "frozenAttempt"> & Readonly<{
  readonly frozenAttempt?: FrozenFiniteAttempt;
  readonly terminalRefusal?: PointFiniteTerminalRefusal;
  readonly terminalRefusalProof?: FiniteAttemptNonacceptanceProof;
}>;
export type PointFiniteTerminalRefusal = PointCommitPublicationV1Error | PointMutationAttemptReplacementFiniteEntryError;
export type PointFiniteAttemptResolution = Readonly<{ kind: "committed"; outcome: Exclude<CommittedPointOutcomeResolutionV1, { kind: "missing" }> }>
  | Readonly<{ kind: "noncommit"; proof: FiniteAttemptNonacceptanceProof }>
  | Readonly<{ kind: "rejected"; error: PointFiniteTerminalRefusal }>;
interface PreparedFiniteAttemptResolutionCommand extends PointFiniteAttemptResolutionCommand { readonly scopeUuid: ScopeUuidV1 }
const finitePublishers = new WeakSet<object>();
const finiteSettlementRefusals = new WeakMap<object,
  Readonly<{ kind: "publication"; command: PointFiniteCommitCommand }> |
  Readonly<{ kind: "replacement"; command: PointFiniteAttemptResolutionCommand; proof: FiniteAttemptNonacceptanceProof }>>();
export function isPointFiniteReplacementTerminalRefusal(failure: unknown, command: PointFiniteAttemptResolutionCommand,
  proof: FiniteAttemptNonacceptanceProof): failure is PointMutationAttemptReplacementFiniteEntryError {
  if (!(failure instanceof PointMutationAttemptReplacementFiniteEntryError)) return false;
  const emitted = finiteSettlementRefusals.get(failure);
  return emitted?.kind === "replacement" && emitted.proof === proof &&
    emitted.command.authorityPins === command.authorityPins && emitted.command.session === command.session &&
    emitted.command.executionClaim === command.executionClaim;
}
export const isPointFiniteCommitPublisherPort = (candidate: unknown): candidate is PointFiniteCommitPublisherPort =>
  typeof candidate === "object" && candidate !== null && finitePublishers.has(candidate);

export class PointFiniteAttemptRetryBudgetExhaustedError extends Data.TaggedError("PointFiniteAttemptRetryBudgetExhaustedError")<{
  readonly attemptFence: TransactionAttemptFence;
  readonly maximumAttempts: bigint;
}> {}

interface PreparedFiniteCommitCommand extends ApplicationDocumentMaterializationCommand {
  readonly authorityPins: PointCommitAuthorityPinsV1;
  readonly session: PointCommitSessionScalarsV1;
  readonly scopeUuid: ScopeUuidV1;
  readonly executionClaim: TransactionExecutionClaimPinV1;
  readonly frozen: OwnedFrozenFiniteAttemptData;
  readonly attemptedTableIds: readonly CatalogTableId[];
  readonly participantMaterialDocumentIds: ReadonlySet<string>;
  readonly indexRangeDependencies: readonly LogicalIndexRangeReadDependencyV1[];
  readonly relationDependencies: readonly LogicalApplicationRelationIncomingReadDependencyV1[];
  readonly successfulResult: PreparedPointCommitPublicationCommandV1["successfulResult"];
  readonly sources: readonly FiniteCommitSource[];
  readonly events: readonly CommittedEvent[];
}
interface FiniteCommitSource {
  readonly token: LogicalParticipantCommitAuthority;
  readonly operation: Extract<FrozenFiniteOperation, { kind: "participant" }>;
  readonly admission: import("./logicalDocuments/participantAdmission").LogicalParticipantAttemptAdmission;
  readonly methods: readonly string[];
  readonly selected: NonNullable<ReturnType<typeof inspectFiniteOperationCommitAuthority>>;
  readonly touchedTables: readonly CatalogTableId[];
}

interface PreparedFiniteSourceAcceptance {
  readonly source: FiniteCommitSource;
  readonly touchedTables: readonly CatalogTableId[];
  readonly documentResults: readonly Exit.Exit<void, PointCommitCorruptionV1Error>[];
  readonly definitionResults: readonly Exit.Exit<void, PointCommitCorruptionV1Error>[];
}

/** Retained outcomes belong to this publication's genuine frozen graph. They
 * prove no current binding, permission, maintenance state or data dependency. */
const prepareFiniteSourceAcceptance = Effect.fn("PointCommitTransaction.prepareFiniteSourceAcceptance")(function* (
  command: PreparedFiniteCommitCommand,
  developerDefinitions: readonly LocatedAppIndexDefinitionV1[],
  uniqueDefinitions: readonly LocatedAppUniqueConstraintDefinitionV1[],
) {
  const grouped = new Map<LogicalParticipantCommitAuthority, { source: FiniteCommitSource; touchedTables: Set<CatalogTableId> }>();
  for (const source of command.sources) {
    const prior = grouped.get(source.token);
    if (prior === undefined) grouped.set(source.token, { source, touchedTables: new Set(source.touchedTables) });
    else for (const tableId of source.touchedTables) prior.touchedTables.add(tableId);
  }
  const plans: PreparedFiniteSourceAcceptance[] = [];
  for (const { source, touchedTables } of grouped.values()) {
    const documentResults: Exit.Exit<void, PointCommitCorruptionV1Error>[] = [];
    const definitionResults: Exit.Exit<void, PointCommitCorruptionV1Error>[] = [];
    for (const intent of command.rowIntents) {
      if (intent.kind !== "live" || !source.selected.tableIds.has(intent.tableId)) continue;
      const outcome = yield* Effect.exit(Effect.sync(() => source.selected.validateDocument(intent.tableId, intent.document))
        .pipe(Effect.flatMap(result => Effect.fromResult(result.pipe(Result.mapError(() => corruption("rowWriteInvalid"))))), Effect.asVoid));
      documentResults.push(outcome);
      if (Exit.isFailure(outcome)) break;
    }
    if (documentResults.every(Exit.isSuccess)) {
      const indexes = yield* Effect.exit(Effect.sync(() => {
        const actual = developerDefinitions.filter(index => touchedTables.has(index.access.tableId));
        const expected = source.selected.indexes.filter(index => index.access.kind === "developer" && touchedTables.has(index.access.tableId));
        return actual.length !== expected.length || expected.some(index => !actual.some(member =>
          member.indexDefinitionId === index.indexDefinitionId && member.physicalSpecSha256Hex === index.physicalSpecSha256Hex))
          ? Result.fail(corruption("developerIndexBuildInvalid")) : Result.succeed(undefined);
      }).pipe(Effect.flatMap(Effect.fromResult)));
      definitionResults.push(indexes);
      if (Exit.isSuccess(indexes)) {
        definitionResults.push(yield* Effect.exit(Effect.sync(() => {
          const actual = uniqueDefinitions.filter(constraint => touchedTables.has(constraint.tableId));
          const expected = source.selected.unique.filter(constraint => touchedTables.has(constraint.tableId));
          return actual.length !== expected.length || expected.some(constraint => !actual.some(member =>
            member.uniqueConstraintDefinitionId === constraint.uniqueConstraintDefinitionId && member.tableId === constraint.tableId &&
            member.logicalUniqueConstraintId === constraint.logicalUniqueConstraintId && member.physicalSpecSha256Hex === constraint.physicalSpecSha256Hex))
            ? Result.fail(corruption("uniqueConstraintDefinitionInvalid")) : Result.succeed(undefined);
        }).pipe(Effect.flatMap(Effect.fromResult))));
      }
    }
    plans.push(Object.freeze({ source, touchedTables: Object.freeze([...touchedTables]),
      documentResults: Object.freeze(documentResults), definitionResults: Object.freeze(definitionResults) }));
    // A later source has no genuine stage before this retained refusal.
    if (documentResults.some(Exit.isFailure) || definitionResults.some(Exit.isFailure)) break;
  }
  return Object.freeze(plans);
});

/**
 * O08-A correlation evidence only. Persistence re-resolves every authority
 * fact and reproduces the OCC conflict; this detached record cannot authorize
 * user-code execution or a later retry.
 */
export interface PointMutationAttemptReplacementCommandV1
  extends PointCommitAttemptScalarCommandV1 {
  readonly dependencies: ReadonlyArray<PointCommitDependencyV1>;
  readonly indexRangeDependencies: ReadonlyArray<
    LogicalIndexRangeReadDependencyV1
  >;
  readonly relationDependencies: ReadonlyArray<
    LogicalApplicationRelationIncomingReadDependencyV1
  >;
  readonly expectedConflict: PointCommitConflictEvidenceV1;
}

export interface RunningRelationConflictEvidenceV1 {
  readonly kind: "relationConflict";
  readonly edgeDefinitionId: CatalogEdgeDefinitionId;
  readonly targetRowId: AppRowIdHexV1;
  readonly expectedAdjacencyVersion: CommitSeq;
  readonly actualAdjacencyVersion: CommitSeq;
  readonly snapshotCommitSeq: CommitSeq;
}

export interface RunningRelationConflictRequestEvidenceV1 {
  readonly format: "flarex.session-journal-syscall";
  readonly codecVersion: 2;
  readonly kind: "relationIncoming";
  readonly syscallSequence: CommitSyscallSequenceV1;
  readonly relationId: CatalogRelationId;
  readonly edgeDefinitionId: CatalogEdgeDefinitionId;
  readonly sourceTableId: CatalogTableId;
  readonly targetTableId: CatalogTableId;
  readonly targetRowId: AppRowIdHexV1;
  readonly limit: number;
}

/**
 * O10-R correlation input for an already-persisted running-attempt conflict.
 * It carries no sealed journal/result identity and cannot enter finishing.
 */
export interface RunningRelationConflictAttemptReplacementCommandV1 {
  readonly authorityPins: PointCommitAuthorityPinsV1;
  readonly session: PointCommitRunningSessionScalarsV1;
  readonly executionClaim: TransactionExecutionClaimPinV1;
  readonly request: RunningRelationConflictRequestEvidenceV1;
  readonly conflict: RunningRelationConflictEvidenceV1;
}

export interface RunningRelationConflictRecoveryCommand {
  readonly authorityPins: PointCommitAuthorityPinsV1;
  readonly session: PointCommitRunningSessionScalarsV1;
  readonly executionClaim: TransactionExecutionClaimPinV1;
}

const recoveredRunningRelationConflictEvidenceBrand: unique symbol = Symbol(
  "FlarexPersistence/RecoveredRunningRelationConflictEvidence",
);

/** Exact durable evidence authenticated for fresh-process O08 replacement. */
export interface RecoveredRunningRelationConflictEvidence {
  readonly [recoveredRunningRelationConflictEvidenceBrand]: true;
  readonly request: RunningRelationConflictRequestEvidenceV1;
  readonly conflict: RunningRelationConflictEvidenceV1;
}

export class PointMutationAttemptReplacementCommittedOutcomeV1Error
  extends Data.TaggedError(
    "PointMutationAttemptReplacementCommittedOutcomeV1Error",
  )<{
    readonly reason:
      | "committedOutcomeAvailable"
      | "committedOutcomeExpired";
    readonly commitSeq: CommitSeq;
  }> {}

export class PointMutationAttemptReplacementConflictNoLongerPresentV1Error
  extends Data.TaggedError(
    "PointMutationAttemptReplacementConflictNoLongerPresentV1Error",
  )<{
    readonly reason: "conflictNoLongerPresent";
  }> {}

export class PointMutationAttemptReplacementRequestKeyReuseV1Error
  extends Data.TaggedError(
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

export class PointMutationAttemptReplacementCorruptionV1Error
  extends Data.TaggedError(
    "PointMutationAttemptReplacementCorruptionV1Error",
  )<{
    readonly reason: PointMutationAttemptReplacementCorruptionReasonV1;
  }> {}

export class PointMutationAttemptReplacementStaleAuthorityV1Error
  extends Data.TaggedError(
    "PointMutationAttemptReplacementStaleAuthorityV1Error",
  )<{
    readonly reason: PointCommitStaleAuthorityReasonV1;
  }> {}

export class PointMutationAttemptReplacementResourceExhaustionV1Error
  extends Data.TaggedError(
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

export class PointMutationAttemptReplacementSqlErrorV1
  extends Data.TaggedError("PointMutationAttemptReplacementSqlErrorV1")<{
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

interface PreparedFiniteReplacementEntry {
  readonly preparation: PreparedFiniteSessionJournalEntry;
  readonly application: PreparedFiniteActiveApplication;
  capture?: Effect.Success<ReturnType<typeof runPreparedFiniteSessionJournalEntryEffect>>;
}

const prepareFiniteReplacementEntryEffect = Effect.fn("PointMutationAttemptReplacement.prepareFiniteEntry")(
  function* (composition: NonNullable<PointMutationAttemptReplacementOptionsV1["finiteEntry"]>) {
    const preparation = yield* composition.prepareEntry();
    const application = yield* prepareFiniteActiveApplication(composition.application).pipe(Effect.mapError(cause =>
      new PointMutationAttemptReplacementFiniteEntryError({ cause })));
    return { preparation, application } satisfies PreparedFiniteReplacementEntry;
  },
);

function confirmFiniteReplacementEntry(observation: PointMutationAttemptReplacementObservationV1,
  entry: PreparedFiniteReplacementEntry | undefined): PointMutationAttemptReplacementObservationV1 {
  if (observation.kind !== "replaced" || entry?.capture === undefined) return observation;
  return Object.freeze({ ...observation, finiteEntry: Object.freeze({ preparation: entry.preparation,
    capture: confirmPreparedFiniteSessionJournalEntry(entry.preparation, entry.capture) }) });
}

/**
 * Persistence settlement evidence. The structural claim receipt remains
 * non-authorizing until the owning executor factory mints an opaque handle.
 */
export type PointMutationAttemptReplacementObservationV1 = Readonly<{
  readonly kind: "replaced";
  readonly scopeUuid: ScopeUuidV1;
  readonly sessionId: TransactionSessionIdV1;
  readonly previousAttemptFence: TransactionAttemptFence;
  readonly attemptFence: TransactionAttemptFence;
  readonly executionClaim: TransactionExecutionClaimObservationV1;
  readonly finiteEntry?: Readonly<{ preparation: PreparedFiniteSessionJournalEntry; capture: ConfirmedFiniteRootEntryCapture }>;
}> | Readonly<{
  readonly kind: "alreadyReplaced";
  readonly scopeUuid: ScopeUuidV1;
  readonly sessionId: TransactionSessionIdV1;
  readonly previousAttemptFence: TransactionAttemptFence;
  readonly attemptFence: TransactionAttemptFence;
}>;

export interface PointMutationAttemptReplacementPortV1 {
  readonly replace: (
    command: PointMutationAttemptReplacementCommandV1,
  ) => Effect.Effect<
    PointMutationAttemptReplacementObservationV1,
    PointMutationAttemptReplacementV1Error,
    never
  >;
}
export interface PointFiniteAttemptReplacementPort {
  readonly replaceFinite: (command: PointFiniteAttemptResolutionCommand & Readonly<{ proof: FiniteAttemptNonacceptanceProof }>) =>
    Effect.Effect<PointMutationAttemptReplacementObservationV1, PointMutationAttemptReplacementV1Error | PointCommitDecisionUncertainV1Error>;
}

export interface RunningRelationConflictAttemptReplacementPortV1 {
  readonly replaceRunningRelationConflict: (
    command: RunningRelationConflictAttemptReplacementCommandV1,
  ) => Effect.Effect<
    PointMutationAttemptReplacementObservationV1,
    PointMutationAttemptReplacementV1Error,
    never
  >;
}

export interface RunningRelationConflictRecoveryPort {
  readonly recoverRunningRelationConflict: (
    command: RunningRelationConflictRecoveryCommand,
  ) => Effect.Effect<
    RecoveredRunningRelationConflictEvidence,
    PointMutationAttemptReplacementV1Error,
    never
  >;
}

export class PointMutationAttemptReplacementConfigurationV1Error
  extends Error {
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

export interface PointCommitSuccessfulResultV1 {
  readonly valueCodecVersion: FlarexValueCodecVersion;
  readonly value: CanonicalFlarexRuntimeValueV1;
  readonly canonicalBytes:
    typeof CanonicalSuccessfulResultBytesV1Schema.Type;
  readonly semanticSizeBytes: number;
  readonly sha256Hex: SuccessfulResultSha256HexV1;
}

export interface PointCommitPublicationCommandV1
  extends PointCommitTransactionCommandV1 {
  readonly successfulResult: PointCommitSuccessfulResultV1;
}

export interface PointCommitWouldCommitV1 {
  readonly kind: "wouldCommit";
}

export const MAX_INDEX_RANGE_OCC_COMMIT_SPAN_V1 = 128n;

export type PointCommitFinishingTransitionResultV1 = Readonly<{
  readonly kind: "transitioned" | "observed";
  readonly scopeUuid: ScopeUuidV1;
  readonly sessionId: TransactionSessionIdV1;
  readonly attemptFence: TransactionAttemptFence;
  readonly priorSessionUpdatedAtMilliseconds: number;
  readonly finishingSessionUpdatedAtMilliseconds: number;
}>;

export type PointCommitConfirmedPreDecisionSqlStateV1 = "40001" | "40P01";

export class PointCommitConfirmedPreDecisionRollbackV1Error
  extends Data.TaggedError(
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

export interface PointCommitFinishingTransitionPortV1 {
  readonly enterFinishing: (
    command: PointCommitFinishingTransitionCommandV1,
  ) => Effect.Effect<
    PointCommitFinishingTransitionResultV1,
    PointCommitFinishingTransitionV1Error,
    never
  >;
}

export interface PointCommitRollbackProofPortV1 {
  readonly prove: (
    command: PointCommitTransactionCommandV1,
  ) => Effect.Effect<
    PointCommitWouldCommitV1,
    PointCommitRollbackProofV1Error,
    never
  >;
}

const pointCommitDeveloperIndexMaintenancePortsV1 = new WeakSet<object>();
const pointCommitUniqueConstraintMaintenancePortsV1 = new WeakSet<object>();
const pointCommitApplicationRelationMaintenancePorts = new WeakSet<object>();
const pointCommitUniqueConstraintEligibilityPortsV1 = new WeakMap<
  object,
  AppUniqueConstraintSetEligibilityPortV1
>();

/** Exact private C09 point-commit composition; structural copies fail closed. */
export function hasPointCommitApplicationRelationMaintenance(
  value: unknown,
): boolean {
  return typeof value === "object" && value !== null &&
    pointCommitApplicationRelationMaintenancePorts.has(value);
}

function registerPointCommitApplicationRelationMaintenance<T extends object>(
  port: T,
  applicationRelations: ApplicationRelationCommitPort | undefined,
  pointCommitAuthority: PointMutationSessionAuthorityResolutionPortsV1,
): T {
  if (hasApplicationRelationCommitAuthorityForPointCommit(
    applicationRelations,
    pointCommitAuthority,
  )) {
    pointCommitApplicationRelationMaintenancePorts.add(port);
  }
  return port;
}

/**
 * Process-local private capability check. Only point-commit ports constructed
 * with the C08-A definition locator are registered; structural lookalikes and
 * copied ports cannot acquire this authority.
 */
export function hasPointCommitDeveloperIndexMaintenanceV1(
  value: unknown,
): boolean {
  return typeof value === "object" && value !== null &&
    pointCommitDeveloperIndexMaintenancePortsV1.has(value);
}

function registerPointCommitDeveloperIndexMaintenanceV1<T extends object>(
  port: T,
  developerIndexes: AppDeveloperIndexDefinitionPortV1 | undefined,
): T {
  if (developerIndexes !== undefined) {
    pointCommitDeveloperIndexMaintenancePortsV1.add(port);
  }
  return port;
}

/** Exact private C08-B2 composition authority; structural copies fail closed. */
export function hasPointCommitUniqueConstraintMaintenanceV1(
  value: unknown,
): boolean {
  return typeof value === "object" && value !== null &&
    pointCommitUniqueConstraintMaintenancePortsV1.has(value);
}

function registerPointCommitUniqueConstraintMaintenanceV1<T extends object>(
  port: T,
  uniqueConstraints: AppUniqueConstraintDefinitionPortV1 | undefined,
): T {
  if (hasAppUniqueConstraintDefinitionAuthorityV1(uniqueConstraints)) {
    pointCommitUniqueConstraintMaintenancePortsV1.add(port);
  }
  return port;
}

/** Exact private C08-B1 composition; structural copies fail closed. */
export function hasPointCommitUniqueConstraintEligibilityV1(
  value: unknown,
): boolean {
  return typeof value === "object" && value !== null &&
    pointCommitUniqueConstraintEligibilityPortsV1.has(value);
}

export class PointCommitUniqueConstraintEligibilityUnavailableV1Error
  extends Data.TaggedError(
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

export const loadPointCommitUniqueConstraintEligibilityV1Effect = Effect.fn(
  "PointCommitTransaction.loadUniqueConstraintEligibility",
)(function* (
  value: unknown,
  input: AppUniqueConstraintSetEligibilityInputV1,
): Effect.fn.Return<
  AppUniqueConstraintSetEligibilityResultV1,
  LoadPointCommitUniqueConstraintEligibilityV1Error
> {
  const eligibility = typeof value === "object" && value !== null
    ? pointCommitUniqueConstraintEligibilityPortsV1.get(value)
    : undefined;
  if (eligibility === undefined) {
    return yield* Effect.fail(
      new PointCommitUniqueConstraintEligibilityUnavailableV1Error({
        reason: "notSameFactory",
      }),
    );
  }
  return yield* loadAppUniqueConstraintSetEligibilityV1Effect(
    eligibility,
    input,
  );
});

/** Exact FSV04/FSV05 composition over one control catalog and target resolver. */
export const loadPointCommitUniqueConstraintEligibilityForReadinessV1Effect =
  Effect.fn(
    "PointCommitTransaction.loadUniqueConstraintEligibilityForReadiness",
  )(function* (
    value: unknown,
    input: AppUniqueConstraintSetEligibilityInputV1,
    controlDb: FlarexMetadataDatabase,
    authority: TrustedScopeAuthorityResolutionPorts,
  ): Effect.fn.Return<
    AppUniqueConstraintSetEligibilityResultV1,
    LoadPointCommitUniqueConstraintEligibilityV1Error
  > {
    const eligibility = typeof value === "object" && value !== null
      ? pointCommitUniqueConstraintEligibilityPortsV1.get(value)
      : undefined;
    if (
      eligibility === undefined ||
      !hasAppUniqueConstraintSetEligibilityCompositionV1(
        eligibility,
        controlDb,
        authority,
      )
    ) {
      return yield* Effect.fail(
        new PointCommitUniqueConstraintEligibilityUnavailableV1Error({
          reason: eligibility === undefined
            ? "notSameFactory"
            : "compositionMismatch",
        }),
      );
    }
    return yield* loadAppUniqueConstraintSetEligibilityForReadinessV1Effect(
      eligibility,
      input,
    );
  });

/** Catalog-only preparation through the same authenticated unique-set owner. */
export const preparePointCommitUniqueConstraintSet = Effect.fn("PointCommitTransaction.prepareUniqueConstraintSet")(
  function* (value: unknown, input: AppUniqueConstraintSetEligibilityInputV1,
    controlDb: FlarexMetadataDatabase, authority: TrustedScopeAuthorityResolutionPorts) {
    const eligibility = typeof value === "object" && value !== null ? pointCommitUniqueConstraintEligibilityPortsV1.get(value) : undefined;
    if (eligibility === undefined || !hasAppUniqueConstraintSetEligibilityCompositionV1(eligibility, controlDb, authority)) {
      return yield* Effect.fail(new PointCommitUniqueConstraintEligibilityUnavailableV1Error({ reason: eligibility === undefined ? "notSameFactory" : "compositionMismatch" }));
    }
    return yield* prepareAppUniqueConstraintSet(eligibility, input);
  },
);

export const acceptPreparedPointCommitUniqueConstraintSet = Effect.fn("PointCommitTransaction.acceptPreparedUniqueConstraintSet")(
  function* (value: unknown, preparation: AppUniqueConstraintSetPreparation, tx: AppRowTransaction,
    authority: TrustedScopeAuthority, clock: ScopeClockRecord) {
    const eligibility = typeof value === "object" && value !== null ? pointCommitUniqueConstraintEligibilityPortsV1.get(value) : undefined;
    if (eligibility === undefined) return yield* Effect.fail(new PointCommitUniqueConstraintEligibilityUnavailableV1Error({ reason: "notSameFactory" }));
    return yield* acceptPreparedAppUniqueConstraintSet(eligibility, preparation, tx, authority, clock);
  },
);

/**
 * Private FSV04/FSV05 composition seam. The caller owns the transaction and
 * must already hold the exact scope-clock lock represented by `clock`.
 */
export const validatePointCommitUniqueConstraintEligibilityInTransactionV1Effect =
  Effect.fn(
    "PointCommitTransaction.validateUniqueConstraintEligibilityInTransaction",
  )(function* (
    value: unknown,
    tx: AppRowTransaction,
    evidence: AppUniqueConstraintSetEligibilityEvidenceV1,
    authority: TrustedScopeAuthority,
    clock: ScopeClockRecord,
  ): Effect.fn.Return<
    AppUniqueConstraintSetEligibilityResultV1,
    ValidatePointCommitUniqueConstraintEligibilityV1Error
  > {
    const eligibility = typeof value === "object" && value !== null
      ? pointCommitUniqueConstraintEligibilityPortsV1.get(value)
      : undefined;
    if (eligibility === undefined) {
      return yield* Effect.fail(
        new PointCommitUniqueConstraintEligibilityUnavailableV1Error({
          reason: "notSameFactory",
        }),
      );
    }
    return yield*
      validateAppUniqueConstraintSetEligibilityEvidenceInTransactionV1Effect(
        tx,
        eligibility,
        evidence,
        authority,
        clock,
      );
  });

function registerPointCommitUniqueConstraintEligibilityV1<T extends object>(
  port: T,
  uniqueConstraints: AppUniqueConstraintDefinitionPortV1 | undefined,
  eligibility: AppUniqueConstraintSetEligibilityPortV1 | undefined,
): T {
  if (
    hasAppUniqueConstraintDefinitionAuthorityV1(uniqueConstraints) &&
    hasAppUniqueConstraintSetEligibilityPortV1(eligibility) &&
    hasAppUniqueConstraintSetEligibilityForDefinitionPortV1(
      eligibility,
      uniqueConstraints,
    )
  ) pointCommitUniqueConstraintEligibilityPortsV1.set(port, eligibility);
  return port;
}

export type PointCommitPublicationV1Error =
  | PointFiniteAttemptRetryBudgetExhaustedError
  | PointCommitRollbackProofV1Error
  | PointCommitConfirmedPreDecisionRollbackV1Error
  | PointCommitDecisionUncertainV1Error
  | CommittedPointOutcomeInputErrorV1
  | CommittedPointOutcomeRequestKeyReuseErrorV1
  | CommittedPointOutcomeCorruptionErrorV1
  | CommittedPointOutcomeSqlErrorV1;

export type PointCommitPublicationResultV1 =
  | Readonly<{
      readonly kind: "published" | "replayed";
      readonly token: CommittedPointOutcomeTokenV1;
      readonly successfulResult: CommittedPointSuccessfulResultV1;
    }>
  | Readonly<{
      readonly kind: "expired";
      readonly token: CommittedPointOutcomeTokenV1;
    }>;

export interface PointCommitPublisherPortV1
  extends PointCommitRollbackProofPortV1 {
  readonly publish: (
    command: PointCommitPublicationCommandV1,
  ) => Effect.Effect<
    PointCommitPublicationResultV1,
    PointCommitPublicationV1Error,
    never
  >;
}

/**
 * Intentional internal O07-A seam for the O08 coordinators. The deployment id
 * is only a locator; the resolver still derives the trusted target and the
 * stored request evidence remains authoritative. This symbol is deliberately
 * absent from the persistence package root.
 */
export const RESOLVE_POINT_COMMIT_OUTCOME_V1: unique symbol =
  Symbol("FlarexDB/resolvePointCommitOutcomeV1");

export type PointCommitOutcomeResolutionV1Error =
  | PointCommitFinishingTransitionV1Error
  | ResolveCommittedPointOutcomeErrorV1;

export interface PointCommitOutcomeResolutionPortV1 {
  readonly [RESOLVE_POINT_COMMIT_OUTCOME_V1]: (
    deploymentId: TransactionGrantDeploymentIdV1,
    input: ResolveCommittedPointOutcomeInputV1,
  ) => Effect.Effect<
    CommittedPointOutcomeResolutionV1,
    PointCommitOutcomeResolutionV1Error,
    never
  >;
}

export type PointCommitTransactionProofStepV1 =
  | "lifecycleProtected"
  | "clockLocked"
  | "activeApplicationSchemaValidated"
  | "activeRelationSelectionValidated"
  | "sessionLocked"
  | "leaseLocked"
  | "journalRootLocked"
  | "executionClaimLocked"
  | "executionClaimDeleted"
  | "sessionEnteredFinishing"
  | "dependenciesValidated"
  | "finiteParticipantDocumentValidated"
  | "intrinsicIndexBuildLocked"
  | "developerIndexBuildLocked"
  | "rowBatchWriting"
  | "rowBatchWritten"
  | "intrinsicMembershipPreparing"
  | "intrinsicMembershipPrepared"
  | "tentativeRowWritten"
  | "indexBatchWriting"
  | "indexBatchWritten"
  | "intrinsicIndexEntryWritten"
  | "developerIndexEntryWritten"
  | "uniqueKeyWritten"
  | "uniqueKeyBatchWriting"
  | "uniqueKeyBatchWritten"
  | "relationBindingValidated"
  | "relationTargetsValidated"
  | "relationEdgeWritten"
  | "relationRestrictValidated"
  | "uniquePublicationApplied"
  | "candidateSchemaValidationFailed"
  | "outcomeRechecked"
  | "commitHeaderWritten"
  | "commitChangeWritten"
  | "commitRelationAdjacencyChangeWritten"
  | "outcomeWritten"
  | "wakeWritten"
  | "journalDeleted"
  | "leaseDeleted"
  | "sessionCommitted"
  | "clockAdvanced"
  | "beforeCommit"
  | "beforeRollback";

export interface PointCommitTransactionProofOptionsV1 {
  readonly publicationObservation?: PointCommitPublicationObservation;
  /** Trusted selector profiles authenticate whole ordered source bundles,
   * including zero-effect sources and the pinned producer revision. */
  readonly logicalOperationProfiles?: readonly Readonly<{
    participant: string;
    operationMethods: readonly string[];
    profileRevision: string;
    sources: readonly LogicalParticipantCommitAuthority[];
    operationEvents?: Readonly<{
      policy: Effect.Success<ReturnType<typeof prepareAtomicCommerceEvents>>;
      selection: ParticipantEventSelection;
    }>;
  }>[];
  /** Same opaque participant token pins the event contract selected before ack. */
  readonly logicalParticipantEvents?: readonly Readonly<{
    authority: LogicalParticipantCommitAuthority;
    policy: Effect.Success<ReturnType<typeof prepareAtomicCommerceEvents>>;
    selection: ParticipantEventSelection;
  }>[];
  /**
   * Required issued composition for Application material writes. Absence is
   * retained only for lower-level legacy proof/runtime callers, whose active
   * Application exclusion is an explicit CE2 cutover gate.
   */
  readonly intrinsicCreationTimeIndexes?:
    IntrinsicCreationTimeIndexDefinitionPortV1;
  /** Required from the same control database for Application material writes. */
  readonly developerIndexes?: AppDeveloperIndexDefinitionPortV1;
  /** Private C08-B2 composition; absence preserves the lower proof lane. */
  readonly uniqueConstraints?: AppUniqueConstraintDefinitionPortV1;
  /**
   * Private C08-B1 eligibility facet. It is effective only when composed with
   * the exact B2 definition owner on this same point-commit port.
   */
  readonly uniqueConstraintEligibility?: AppUniqueConstraintSetEligibilityPortV1;
  /** Private C09 composition; absence preserves the lower proof lane. */
  readonly applicationRelations?: ApplicationRelationCommitPort;
  /** Private M03-B composition; absence preserves the lower commit lane. */
  readonly candidateSchemaWriteGuard?: AppSchemaCandidateWriteGuardPort;
  readonly afterTransactionStep?: (
    event: Readonly<{
      readonly scopeId: ReplacementScopeIdV1;
      readonly step: PointCommitTransactionProofStepV1;
    }>,
  ) => Promise<void>;
  readonly observeQuery?: (
    query: Readonly<{
      readonly name: PointCommitSqlOperationV1;
      readonly sql: string;
      readonly params: ReadonlyArray<unknown>;
    }>,
  ) => void;
}

function capturePointCommitEvents(events: NonNullable<NonNullable<PointCommitTransactionProofOptionsV1["logicalOperationProfiles"]>[number]["operationEvents"]>) {
  return Object.freeze({
    policy: Object.freeze({ ...events.policy,
      allowed: new Map(events.policy.allowed),
      identity: structuredClone(events.policy.identity),
      subscribers: structuredClone(events.policy.subscribers) }),
    selection: Object.freeze({ contracts: Object.freeze([...events.selection.contracts]),
      select: events.selection.select }),
  });
}

function capturePointCommitTransactionProofOptionsV1(
  options: PointCommitTransactionProofOptionsV1,
): PointCommitTransactionProofOptionsV1 {
  const intrinsicCreationTimeIndexes = options.intrinsicCreationTimeIndexes;
  const developerIndexes = options.developerIndexes;
  const uniqueConstraints = options.uniqueConstraints;
  const uniqueConstraintEligibility = options.uniqueConstraintEligibility;
  const applicationRelations = options.applicationRelations;
  const candidateSchemaWriteGuard = options.candidateSchemaWriteGuard;
  const afterTransactionStep = options.afterTransactionStep;
  const observeQuery = options.observeQuery;
  const publicationObservation = options.publicationObservation;
  const logicalParticipantEvents = options.logicalParticipantEvents;
  const logicalOperationProfiles = options.logicalOperationProfiles;
  return Object.freeze({
    ...(logicalParticipantEvents === undefined ? {} : { logicalParticipantEvents: Object.freeze(
      logicalParticipantEvents.map(binding => Object.freeze({ authority: binding.authority,
        ...capturePointCommitEvents(binding) }))) }),
    ...(logicalOperationProfiles === undefined ? {} : { logicalOperationProfiles: Object.freeze(
      logicalOperationProfiles.map(profile => Object.freeze({ ...profile,
        operationMethods: Object.freeze([...profile.operationMethods]),
        sources: Object.freeze([...profile.sources]),
        ...(profile.operationEvents === undefined ? {} :
          { operationEvents: capturePointCommitEvents(profile.operationEvents) }) }))) }),
    ...(intrinsicCreationTimeIndexes === undefined
      ? {}
      : { intrinsicCreationTimeIndexes }),
    ...(developerIndexes === undefined ? {} : { developerIndexes }),
    ...(uniqueConstraints === undefined ? {} : { uniqueConstraints }),
    ...(uniqueConstraintEligibility === undefined
      ? {}
      : { uniqueConstraintEligibility }),
    ...(applicationRelations === undefined
      ? {}
      : { applicationRelations }),
    ...(candidateSchemaWriteGuard === undefined
      ? {}
      : { candidateSchemaWriteGuard }),
    ...(afterTransactionStep === undefined ? {} : { afterTransactionStep }),
    ...(observeQuery === undefined ? {} : { observeQuery }),
    ...(publicationObservation === undefined ? {} : { publicationObservation }),
  });
}

function selectLogicalOperationProfileResult(
  options: PointCommitTransactionProofOptionsV1,
  operation: AdmittedParticipantOperation,
): Result.Result<Readonly<{ profile: NonNullable<PointCommitTransactionProofOptionsV1["logicalOperationProfiles"]>[number];
  authorities: readonly LogicalParticipantCommitAuthority[] }>, PointCommitCorruptionV1Error> {
  const matching = (options.logicalOperationProfiles ?? []).filter(profile =>
    profile.participant === operation.participant && profile.operationMethods.includes(operation.method));
  if (matching.length !== 1) return Result.fail(corruption("commandInvalid"));
  const profile = matching[0]!;
  if (profile.profileRevision !== operation.profileRevision ||
    profile.sources.length !== operation.sourceContributions.length ||
    profile.sources.length === 0) return Result.fail(corruption("commandInvalid"));
  for (const [ordinal, token] of profile.sources.entries()) {
    const source = inspectLogicalParticipantCommitAuthoritySource(token);
    const contribution = operation.sourceContributions[ordinal];
    if (source === null || contribution === undefined ||
      source.sourceKey !== contribution.sourceKey ||
      source.sourceSha256 !== contribution.sourceSha256Hex ||
      source.methods.length !== contribution.methods.length ||
      source.methods.some((method, position) => method !== contribution.methods[position]) ||
      !hasLogicalParticipantCommitAuthority(token, operation.participant, contribution)) {
      return Result.fail(corruption("commandInvalid"));
    }
  }
  return Result.succeed(Object.freeze({ profile, authorities: profile.sources }));
}

class PointCommitAdmissionDigestProviderError extends Data.TaggedError("PointCommitAdmissionDigestProviderError")<{
  readonly cause: unknown;
}> {}

const requireAdmittedOperationBundleDigest = Effect.fn("PointCommit.requireAdmissionBundleDigest")(function* (
  operation: AdmittedParticipantOperation,
) {
  const bundle = yield* Effect.fromResult(canonicalizeAdmittedSourceBundleResult({
    participant: operation.participant, method: operation.method,
    profileRevision: operation.profileRevision,
    sources: operation.sourceContributions.map(source => ({
      sourceKey: source.sourceKey, sourceSha256Hex: source.sourceSha256Hex,
      bindingHead: source.bindingHead, sourceBindingSha256Hex: source.sourceBindingSha256Hex,
      methods: source.methods,
    })),
  }).pipe(Result.mapError(() => corruption("commandInvalid"))));
  const bytes = yield* Effect.tryPromise({
    try: () => crypto.subtle.digest("SHA-256", new Uint8Array(bundle.bytes).buffer),
    // A provider rejection is not a malformed stored digest; preserve it at
    // this foreign boundary for the outer transaction failure owner.
    catch: cause => new PointCommitAdmissionDigestProviderError({ cause }),
  });
  if (encodeBytesToLowercaseHex(new Uint8Array(bytes)) !== operation.admissionBundleSha256Hex)
    return yield* Effect.fail(corruption("commandInvalid"));
});

export type PointMutationAttemptReplacementProofStepV1 =
  | "clockLocked"
  | "outcomeRechecked"
  | "activeRelationSelectionValidated"
  | "sessionLocked"
  | "leaseLocked"
  | "journalRootLocked"
  | "dependenciesValidated"
  | "sessionEnteredRetrying"
  | "journalDeleted"
  | "leaseDeleted"
  | "attemptFenceAdvanced"
  | "leaseInserted"
  | "journalRootInserted"
  | "executionClaimDeleted"
  | "executionClaimInserted"
  | "sessionRunning"
  | "beforeCommit";

export interface PointMutationAttemptReplacementOptionsV1 {
  readonly leaseDurationMilliseconds: number;
  /** Trusted reserved-graph composition. Stored profile and reservation require
   * it; its presence never chooses a weaker admission path. */
  readonly finiteEntry?: Readonly<{
    application: ApplicationActivationRepository<unknown, unknown>;
    prepareEntry: () => Effect.Effect<PreparedFiniteSessionJournalEntry, PointMutationAttemptReplacementFiniteEntryError, import("effect").Scope.Scope>;
  }>;
  /** Same trusted aggregate profile selection used by final publication. */
  readonly logicalOperationProfiles?: PointCommitTransactionProofOptionsV1["logicalOperationProfiles"];
  readonly executionClaimDurationMilliseconds?: number;
  readonly randomExecutionClaimOwner?: () => string;
  /** Test-only deterministic transaction pause/failure seam. */
  readonly afterReplacementStep?: (
    event: Readonly<{
      readonly scopeId: ReplacementScopeIdV1;
      readonly step: PointMutationAttemptReplacementProofStepV1;
    }>,
  ) => Promise<void>;
  /** Test-only bounded query observation. */
  readonly observeQuery?: (
    query: Readonly<{
      readonly name: PointMutationAttemptReplacementSqlOperationV1;
      readonly sql: string;
      readonly params: ReadonlyArray<unknown>;
    }>,
  ) => void;
}

interface PreparedPointCommitFinishingTransitionCommandV1
  extends PointCommitFinishingTransitionCommandV1 {}

interface PreparedPointCommitAttemptScalarCommandV1
  extends PointCommitAttemptScalarCommandV1 {}

interface PreparedPointCommitTransactionCommandV1
  extends PreparedPointCommitAttemptScalarCommandV1,
    Omit<
      PointCommitTransactionCommandV1,
      keyof PointCommitAttemptScalarCommandV1 | "rowIntents"
    > {
  readonly rowIntents: ReadonlyArray<PreparedPointCommitRowIntentV1>;
  readonly attemptedTableIds: ReadonlyArray<CatalogTableId> | null;
  readonly participantOperations: readonly AdmittedParticipantOperation[];
  readonly participantJournal: SessionJournal | null;
  readonly participantMaterialDocumentIds: ReadonlySet<string>;
  readonly participantEventIntents: readonly CommittedEvent[];
  readonly metadataDependencies: readonly LogicalMetadataReadDependency[];
  readonly finiteMetadataReservationSha256Hex: string | null;
}

interface PreparedPointCommitPublicationCommandV1
  extends PreparedPointCommitTransactionCommandV1 {
  readonly successfulResult: Readonly<
    Omit<PointCommitSuccessfulResultV1, "canonicalBytes"> & {
      readonly canonicalBytes:
        typeof CanonicalSuccessfulResultBytesV1Schema.Type;
    }
  >;
}

interface PreparedPointMutationAttemptReplacementCommandV1
  extends PreparedPointCommitAttemptScalarCommandV1 {
  readonly dependencies: ReadonlyArray<PointCommitDependencyV1>;
  readonly indexRangeDependencies: ReadonlyArray<
    LogicalIndexRangeReadDependencyV1
  >;
  readonly relationDependencies: ReadonlyArray<
    LogicalApplicationRelationIncomingReadDependencyV1
  >;
  readonly expectedConflict: PointCommitConflictEvidenceV1;
}

interface PreparedRunningRelationConflictRecoveryCommand {
  readonly authorityPins: PointCommitAuthorityPinsV1;
  readonly session: PointCommitRunningSessionScalarsV1;
  readonly scopeUuid: ScopeUuidV1;
  readonly executionClaim: TransactionExecutionClaimPinV1;
}

interface PreparedRunningRelationConflictAttemptReplacementCommandV1
  extends PreparedRunningRelationConflictRecoveryCommand {
  readonly request: RunningRelationConflictRequestEvidenceV1;
  readonly conflict: RunningRelationConflictEvidenceV1;
}

interface RecoveredApplicationRelationActiveSelection {
  readonly activationSequence: bigint;
  readonly activeHeadSha256Hex: string;
}

const RunningRelationConflictRequestV1Schema = Schema.Struct({
  format: Schema.Literal("flarex.session-journal-syscall"),
  codecVersion: Schema.Literal(2),
  kind: Schema.Literal("relationIncoming"),
  syscallSequence: Schema.toType(CommitSyscallSequenceV1Schema),
  relationId: CatalogRelationIdSchema,
  edgeDefinitionId: CatalogEdgeDefinitionIdSchema,
  sourceTableId: CatalogTableIdSchema,
  targetTableId: CatalogTableIdSchema,
  targetRowId: AppRowIdHexV1Schema,
  limit: Schema.Int,
}).annotate({
  parseOptions: { onExcessProperty: "error" },
});

const RunningRelationConflictRequestEvidenceV1Schema = Schema.Struct({
  format: Schema.Literal("flarex.session-journal-syscall"),
  codecVersion: Schema.Literal(2),
  kind: Schema.Literal("relationIncoming"),
  syscallSequence: CommitSyscallSequenceV1Schema,
  relationId: CatalogRelationIdSchema,
  edgeDefinitionId: CatalogEdgeDefinitionIdSchema,
  sourceTableId: CatalogTableIdSchema,
  targetTableId: CatalogTableIdSchema,
  targetRowId: AppRowIdHexV1Schema,
  limit: Schema.Int,
}).annotate({
  parseOptions: { onExcessProperty: "error" },
});

const RunningRelationConflictOutcomeEvidenceV1Schema = Schema.Struct({
  kind: Schema.Literal("relationConflict"),
  edgeDefinitionId: CatalogEdgeDefinitionIdSchema,
  targetRowId: AppRowIdHexV1Schema,
  expectedAdjacencyVersion: CommitSeqSchema,
  actualAdjacencyVersion: CommitSeqSchema,
  snapshotCommitSeq: CommitSeqSchema,
}).annotate({
  parseOptions: { onExcessProperty: "error" },
});

const decodeRunningRelationConflictRequestV1Result =
  Schema.decodeUnknownResult(RunningRelationConflictRequestV1Schema, {
    onExcessProperty: "error",
  });
const decodeRunningRelationConflictRequestEvidenceV1Result =
  Schema.decodeUnknownResult(RunningRelationConflictRequestEvidenceV1Schema, {
    onExcessProperty: "error",
  });
const decodeRunningRelationConflictOutcomeEvidenceV1Result =
  Schema.decodeUnknownResult(RunningRelationConflictOutcomeEvidenceV1Schema, {
    onExcessProperty: "error",
  });

type PreparedPointCommitDependencyCommandV1 =
  | PreparedPointCommitTransactionCommandV1
  | PreparedPointMutationAttemptReplacementCommandV1
  | PreparedFiniteCommitCommand;

type PointCommitTransactionModeV1 = "rollbackProof" | "publish";
type PointCommitSessionLockModeV1 =
  | PointCommitTransactionModeV1
  | "enterFinishing"
  | "replaceAttempt"
  | "recoverRunningRelationConflict"
  | "replaceRunningRelationConflict"
  | "publishFinite"
  | "resolveFinite";

type PreparedPointCommitAuthorityCommandV1 =
  | PreparedPointCommitAttemptScalarCommandV1
  | PreparedRunningRelationConflictRecoveryCommand
  | PreparedRunningRelationConflictAttemptReplacementCommandV1
  | PreparedFiniteCommitCommand
  | PreparedFiniteAttemptResolutionCommand;

function pointCommitCommandScopeUuid(
  command: PreparedPointCommitAuthorityCommandV1,
): ScopeUuidV1 {
  return "scopeUuid" in command
    ? command.scopeUuid
    : command.sealIdentity.scopeUuid;
}

const WOULD_COMMIT = Object.freeze({
  kind: "wouldCommit",
} satisfies PointCommitWouldCommitV1);

const ROLLBACK_SENTINEL = Object.freeze({
  kind: "pointCommitRollbackSentinel",
});

class PointCommitTransactionDecisionUncertainV1Error extends Data.TaggedError(
  "PointCommitTransactionDecisionUncertainV1Error",
)<{
  readonly cause: LocatedReadCommittedTransactionFailureV1;
}> {}

class PointMutationAttemptReplacementSqlFailureMarkerV1 {
  constructor(
    readonly operation: PointMutationAttemptReplacementSqlOperationV1,
    readonly cause: unknown,
  ) {}
}

const resolvePointCommitAuthority = Effect.fn(
  "PointCommitTransaction.resolveAuthority",
)((
  selection: TrustedScopeSelection,
  ports: PointMutationSessionAuthorityResolutionPortsV1,
): Effect.Effect<
  LocatedTrustedScopeAuthority,
  PointCommitFinishingTransitionV1Error
> =>
  resolveLocatedTrustedScopeAuthorityByIdEffect(selection, {
    scopeMetadata: ports.scopeMetadata,
    provisioningReceipts: ports.provisioningReceipts,
    scopeClockTargets: ports.scopeSessionTargets,
  }).pipe(Effect.catch(routeAuthorityResolutionFailure)));

export function createPointCommitFinishingTransitionPortV1(
  ports: PointMutationSessionAuthorityResolutionPortsV1,
  options: PointCommitTransactionProofOptionsV1 = {},
): PointCommitFinishingTransitionPortV1 {
  const enterFinishing: PointCommitFinishingTransitionPortV1[
    "enterFinishing"
  ] = Effect.fn(
    "PointCommitTransaction.enterFinishing",
  )(function* (input) {
    const command = yield* Effect.fromResult(
      capturePointCommitFinishingTransitionCommandResult(input),
    );
    const located = yield* resolvePointCommitAuthority(
      command.authorityPins,
      ports,
    );
    const preliminaryFailure = preliminaryAuthorityFailure(
      command,
      located.authority,
    );
    if (preliminaryFailure !== null) {
      return yield* Effect.fail(preliminaryFailure);
    }
    const target = isLocatedReadCommittedAttemptTargetV1(located.target)
      ? located.target
      : null;
    if (target === null) {
      return yield* Effect.fail(corruption(
        "readCommittedCapabilityMissing",
      ));
    }
    return yield* Effect.uninterruptible(runPointCommitPromiseEffect(() => runPointCommitFinishingTransition(
        target,
        located.authority,
        command,
        options,
      ), mapFinishingTransitionFailure));
  });

  return Object.freeze({ enterFinishing });
}

export function createPointMutationAttemptReplacementPortV1(
  ports: PointMutationSessionAuthorityResolutionPortsV1,
  options: PointMutationAttemptReplacementOptionsV1,
): PointMutationAttemptReplacementPortV1 &
  RunningRelationConflictAttemptReplacementPortV1 &
  RunningRelationConflictRecoveryPort & PointFiniteAttemptReplacementPort {
  if (!isPositiveSafeInteger(options.leaseDurationMilliseconds)) {
    throw new PointMutationAttemptReplacementConfigurationV1Error(
      "leaseDurationInvalid",
    );
  }
  const executionClaimDurationMilliseconds =
    options.executionClaimDurationMilliseconds ??
      options.leaseDurationMilliseconds;
  if (!isPositiveSafeInteger(executionClaimDurationMilliseconds)) {
    throw new PointMutationAttemptReplacementConfigurationV1Error(
      "executionClaimDurationInvalid",
    );
  }
  const randomExecutionClaimOwner = options.randomExecutionClaimOwner ??
    (() => crypto.randomUUID());
  const proofOptions = capturePointCommitTransactionProofOptionsV1({
    ...(options.observeQuery === undefined ? {} : { observeQuery: options.observeQuery }),
    ...(options.logicalOperationProfiles === undefined ? {} :
      { logicalOperationProfiles: options.logicalOperationProfiles }),
  });

  const replace: PointMutationAttemptReplacementPortV1["replace"] = Effect.fn(
    "PointMutationAttemptReplacement.replace",
  )(function* (input) {
    const command = yield* Effect.fromResult(
      capturePointMutationAttemptReplacementCommandResult(input),
    ).pipe(Effect.mapError(mapPointMutationAttemptReplacementSharedError));
    const generatedOwner = yield* Effect.try({
      try: randomExecutionClaimOwner,
      catch: () => new PointMutationAttemptReplacementConfigurationV1Error(
        "executionClaimOwnerGenerationFailed",
      ),
    });
    const decodedOwner = yield* Effect.fromResult(
      decodeTransactionExecutionClaimOwnerV1(generatedOwner),
    ).pipe(
      Effect.mapError(() =>
        new PointMutationAttemptReplacementConfigurationV1Error(
          "executionClaimOwnerInvalid",
        )
      ),
    );
    const located = yield* resolvePointCommitAuthority(
      command.authorityPins,
      ports,
    ).pipe(Effect.mapError(mapPointMutationAttemptReplacementSharedError));
    const preliminaryFailure = preliminaryAuthorityFailure(
      command,
      located.authority,
    );
    if (preliminaryFailure !== null) {
      return yield* Effect.fail(
        mapPointMutationAttemptReplacementSharedError(preliminaryFailure),
      );
    }
    const target = isLocatedReadCommittedAttemptTargetV1(located.target)
      ? located.target
      : null;
    if (target === null) {
      return yield* Effect.fail(replacementCorruption(
        "readCommittedCapabilityMissing",
      ));
    }
    return yield* Effect.uninterruptible(runPointMutationAttemptReplacement(
        target,
        located.authority,
        command,
        options,
        proofOptions,
        decodedOwner,
        executionClaimDurationMilliseconds,
      ));
  });

  const replaceRunningRelationConflict:
    RunningRelationConflictAttemptReplacementPortV1[
      "replaceRunningRelationConflict"
    ] = Effect.fn(
      "PointMutationAttemptReplacement.replaceRunningRelationConflict",
    )(function* (input) {
      const command = yield* Effect.fromResult(
        captureRunningRelationConflictAttemptReplacementCommandResult(input),
      ).pipe(Effect.mapError(mapPointMutationAttemptReplacementSharedError));
      const generatedOwner = yield* Effect.try({
        try: randomExecutionClaimOwner,
        catch: () => new PointMutationAttemptReplacementConfigurationV1Error(
          "executionClaimOwnerGenerationFailed",
        ),
      });
      const decodedOwner = yield* Effect.fromResult(
        decodeTransactionExecutionClaimOwnerV1(generatedOwner),
      ).pipe(Effect.mapError(() =>
        new PointMutationAttemptReplacementConfigurationV1Error(
          "executionClaimOwnerInvalid",
        )
      ));
      const located = yield* resolvePointCommitAuthority(
        command.authorityPins,
        ports,
      ).pipe(Effect.mapError(mapPointMutationAttemptReplacementSharedError));
      const preliminaryFailure = preliminaryAuthorityFailure(
        command,
        located.authority,
      );
      if (preliminaryFailure !== null) {
        return yield* Effect.fail(
          mapPointMutationAttemptReplacementSharedError(preliminaryFailure),
        );
      }
      const target = isLocatedReadCommittedAttemptTargetV1(located.target)
        ? located.target
        : null;
      if (target === null) {
        return yield* Effect.fail(replacementCorruption(
          "readCommittedCapabilityMissing",
        ));
      }
      return yield* Effect.uninterruptible(runRunningRelationConflictAttemptReplacement(
          target,
          located.authority,
          command,
          options,
          proofOptions,
          decodedOwner,
          executionClaimDurationMilliseconds,
        ));
    });

  const recoverRunningRelationConflict:
    RunningRelationConflictRecoveryPort["recoverRunningRelationConflict"] =
      Effect.fn(
        "PointMutationAttemptReplacement.recoverRunningRelationConflict",
      )(function* (input) {
        const command = yield* Effect.fromResult(
          captureRunningRelationConflictRecoveryCommandResult(input),
        ).pipe(Effect.mapError(mapPointMutationAttemptReplacementSharedError));
        const located = yield* resolvePointCommitAuthority(
          command.authorityPins,
          ports,
        ).pipe(Effect.mapError(mapPointMutationAttemptReplacementSharedError));
        const preliminaryFailure = preliminaryAuthorityFailure(
          command,
          located.authority,
        );
        if (preliminaryFailure !== null) {
          return yield* Effect.fail(
            mapPointMutationAttemptReplacementSharedError(preliminaryFailure),
          );
        }
        const target = isLocatedReadCommittedAttemptTargetV1(located.target)
          ? located.target
          : null;
        if (target === null) {
          return yield* Effect.fail(replacementCorruption(
            "readCommittedCapabilityMissing",
          ));
        }
        return yield* Effect.uninterruptible(runPointCommitPromiseEffect(() => runRunningRelationConflictRecovery(
            target,
            located.authority,
            command,
            options,
            proofOptions,
          ), mapPointMutationAttemptReplacementTransactionFailure));
      });

  const replaceFinite: PointFiniteAttemptReplacementPort["replaceFinite"] = Effect.fn("PointMutationAttemptReplacement.replaceFinite")(function* (input) {
    const command = yield* prepareFiniteAttemptResolutionCommand(input).pipe(Effect.mapError(mapPointMutationAttemptReplacementSharedError));
    const originalEntry = "frozenAttempt" in input
      ? (yield* requireFrozenFiniteAttemptOrigin(input, command).pipe(Effect.mapError(mapPointMutationAttemptReplacementSharedError))).originalEntry
      : undefined;
    const proof = yield* Effect.fromResult(readFiniteAttemptNonacceptanceProof(input.proof)).pipe(Effect.mapError(cause =>
      new PointMutationAttemptReplacementFiniteEntryError({ cause })));
    if (proof.selector.scopeId !== command.authorityPins.scopeId || proof.selector.deploymentId !== command.authorityPins.deploymentId ||
      proof.selector.sessionId !== command.authorityPins.sessionId || proof.selector.attemptFence !== command.authorityPins.attemptFence ||
      proof.executionClaim.claimOwner !== command.executionClaim.claimOwner || proof.executionClaim.claimFence !== command.executionClaim.claimFence)
      return yield* Effect.fail(replacementCorruption("replacementMutationInvalid"));
    if (options.finiteEntry === undefined) return yield* Effect.fail(new PointMutationAttemptReplacementFiniteEntryError({ cause: "finiteEntryCompositionMissing" }));
    const generatedOwner = yield* Effect.try({ try: randomExecutionClaimOwner,
      catch: () => new PointMutationAttemptReplacementConfigurationV1Error("executionClaimOwnerGenerationFailed") });
    const owner = yield* Effect.fromResult(decodeTransactionExecutionClaimOwnerV1(generatedOwner)).pipe(Effect.mapError(() =>
      new PointMutationAttemptReplacementConfigurationV1Error("executionClaimOwnerInvalid")));
    const located = yield* resolvePointCommitAuthority(command.authorityPins, ports).pipe(Effect.mapError(mapPointMutationAttemptReplacementSharedError));
    if (!isLocatedPointCommitPublicationTargetV1(located.target) || !isLocatedExactRunningAttemptKernelV1(located.target))
      return yield* Effect.fail(replacementCorruption("readCommittedCapabilityMissing"));
    const target = located.target;
    let admissionRefusal: ApplicationMutationAdmissionError | undefined;
    return yield* Effect.scoped(Effect.gen(function* () {
      const entry: PreparedFiniteReplacementEntry = yield* prepareFiniteReplacementEntryEffect(options.finiteEntry!);
      const transaction = runFiniteCommitTransactionEffect(target, tx => Effect.gen(function* () {
          const clock = yield* finiteCommitPromiseEffect(() => lockPointCommitClock(tx, command, proofOptions));
          yield* finiteCommitPromiseEffect(() => emitReplacementStep(options, command, "clockLocked"));
          const anchorRow = yield* lockFiniteAttemptAnchorRowByIdentityInTransaction(tx, proof.selector).pipe(Effect.mapError(mapFiniteAnchorFailure));
          const outcome = yield* finiteCommitPromiseEffect(() => inspectCommittedOutcomeInTransaction(tx, clock, command, proofOptions));
          if (outcome !== null) return yield* Effect.fail(new PointMutationAttemptReplacementCommittedOutcomeV1Error({ reason: outcome.state === "available"
            ? "committedOutcomeAvailable" : "committedOutcomeExpired", commitSeq: outcome.commitSeq }));
          const current = yield* readFiniteAttemptAnchorRow(anchorRow).pipe(Effect.mapError(mapFiniteAnchorFailure));
          if (current.reservation === null) return yield* Effect.fail(corruption("occEvidenceInvalid"));
          yield* Effect.fromResult(requireLockedClockAuthorityResult(clock, located.authority, command));
          if (current.session.lifecycle !== "retrying" || current.session.attemptFence !== proof.selector.attemptFence ||
            current.executionClaim.claimOwner !== proof.fencedClaim.claimOwner || current.executionClaim.claimFence !== proof.fencedClaim.claimFence)
            return yield* Effect.fail(replacementCorruption("replacementMutationInvalid"));
          const databaseNow = new Date(yield* finiteCommitPromiseEffect(() => readPointCommitDatabaseTime(tx, command.authorityPins.scopeId, proofOptions)));
          if (current.session.attemptFence >= MAX_FINITE_ATTEMPT_COUNT) {
            yield* rejectFiniteAttemptNonacceptanceInTransaction(tx, current, "aborted").pipe(Effect.mapError(mapFiniteAnchorFailure));
            return Object.freeze({ kind: "refused" as const, error: new PointFiniteAttemptRetryBudgetExhaustedError({
              attemptFence: current.session.attemptFence, maximumAttempts: MAX_FINITE_ATTEMPT_COUNT,
            }) });
          }
          const leaseExpiresAt = new Date(Math.min(databaseNow.getTime() + options.leaseDurationMilliseconds,
            current.session.authorizationGrantExpiresAt.getTime(), current.session.hardExpiresAt.getTime()));
          const claimExpiresAt = new Date(Math.min(databaseNow.getTime() + executionClaimDurationMilliseconds, leaseExpiresAt.getTime()));
          const fresh = yield* replaceFiniteAttemptAnchorInTransaction(tx, input.proof,
            { snapshotToken: SnapshotTokenSchema.make({ scopeId: command.authorityPins.scopeId, epoch: clock.record.epoch, commitSeq: clock.record.lastCommitSeq }),
              claimOwner: owner, claimedAt: databaseNow, claimExpiresAt, leaseExpiresAt }).pipe(Effect.mapError(mapFiniteAnchorFailure));
          entry.capture = yield* runPreparedFiniteReplacementSessionJournalEntryEffect(entry.preparation, entry.application, tx,
            { selector: { ...proof.selector, attemptFence: fresh.context.session.attemptFence }, preliminaryAuthority: located.authority,
              executionClaim: fresh.context.executionClaim }, { authority: located.authority, target },
            failure => { admissionRefusal = failure; }, originalEntry).pipe(Effect.mapError(cause =>
              new PointMutationAttemptReplacementFiniteEntryError({ cause })));
          const observation = Object.freeze({ kind: "replaced" as const, scopeUuid: current.session.scopeUuid, sessionId: proof.selector.sessionId,
            previousAttemptFence: proof.selector.attemptFence, attemptFence: fresh.context.session.attemptFence, executionClaim: entry.capture.context.executionClaim });
          yield* finiteCommitPromiseEffect(() => emitReplacementStep(options, command, "beforeCommit"));
          return observation;
      }));
      const result = yield* transaction.pipe(
        Effect.catchCause(cause => Effect.failCause(Cause.map(cause,
          error => error instanceof PointCommitTransactionDecisionUncertainV1Error
            ? decisionUncertain(error.cause, { kind: "missing" }) : mapPointMutationAttemptReplacementTransactionFailure(error)))));
      if (result.kind === "refused") return yield* Effect.fail(result.error);
      return confirmFiniteReplacementEntry(result, entry);
    })).pipe(
      // The transaction and its local entry cleanup have both settled. Only the
      // exact guard-emitted single failure confers terminal authority; combined
      // rollback/resource failures, defects and interruption retain full Cause.
      Effect.onExit(exit => Effect.sync(() => {
        const reason = Exit.isFailure(exit) && exit.cause.reasons.length === 1 ? exit.cause.reasons[0] : undefined;
        if (reason !== undefined && Cause.isFailReason(reason) &&
          reason.error instanceof PointMutationAttemptReplacementFiniteEntryError &&
          admissionRefusal !== undefined && reason.error.cause === admissionRefusal && !admissionRefusal.retryable &&
          (admissionRefusal.reason === "invalidExecutionAuthority" || admissionRefusal.reason === "functionMissing" ||
            admissionRefusal.reason === "functionUnsupported"))
          finiteSettlementRefusals.set(reason.error, { kind: "replacement", command: input, proof: input.proof });
      })),
    );
  });
  return Object.freeze({
    replace,
    replaceFinite,
    replaceRunningRelationConflict,
    recoverRunningRelationConflict,
  });
}

export function createPointCommitRollbackProofPortV1(
  ports: StoredCommitAuthorityEvidenceLoaderPortsV1,
  options: PointCommitTransactionProofOptionsV1 = {},
): PointCommitRollbackProofPortV1 {
  const capturedOptions = capturePointCommitTransactionProofOptionsV1(options);
  const hasOrderedIndexes = hasApplicationDocumentOrderedIndexComposition(ports.applicationControlDb, capturedOptions);
  const prove: PointCommitRollbackProofPortV1["prove"] = Effect.fn(
    "PointCommitTransaction.proveRollback",
  )(function* (input) {
    const command = yield* preparePointCommitCommand(input);
    const located = yield* resolvePointCommitAuthority(
      command.authorityPins,
      ports,
    );
    const preliminaryFailure = preliminaryAuthorityFailure(
      command,
      located.authority,
    );
    if (preliminaryFailure !== null) {
      return yield* Effect.fail(preliminaryFailure);
    }
    const target = isLocatedReadCommittedAttemptTargetV1(located.target)
      ? located.target
      : null;
    if (target === null) {
      return yield* Effect.fail(corruption(
        "readCommittedCapabilityMissing",
      ));
    }
    if (command.authorityPins.executionAuthorityGeneration === "application_v1" &&
      command.rowIntents.length > 0 && !hasOrderedIndexes) {
      return yield* Effect.fail(corruption("orderedIndexCompositionInvalid"));
    }
    const intrinsicDefinitions = yield* prepareIntrinsicIndexDefinitions(
      command,
      capturedOptions,
    );
    const mixedDefinitions = yield* observePointCommitPublicationEffect(capturedOptions.publicationObservation, "mixedDefinitions", preparePointCommitMixedDefinitions(command, capturedOptions));
    const developerDefinitions = mixedDefinitions.developerDefinitions;
    const uniqueDefinitions = mixedDefinitions.uniqueDefinitions;
    const mixedCommand = Object.freeze({ ...command,
      sourceSchemaVersionByTable: mixedDefinitions.sourceSchemaVersionByTable });
    const applicationRelations = yield* prepareApplicationRelationDefinitions(
      command,
      { hasRelationAuthority: port => hasApplicationRelationCommitAuthorityForPointCommit(port, ports), hasCandidateGuardAuthority: port => hasAppSchemaCandidateWriteGuardComposition(port, ports) },
      capturedOptions,
    );
    const candidateSchemaWriteGuard = yield* prepareCandidateSchemaWriteGuard(
      command,
      { hasRelationAuthority: port => hasApplicationRelationCommitAuthorityForPointCommit(port, ports), hasCandidateGuardAuthority: port => hasAppSchemaCandidateWriteGuardComposition(port, ports) },
      capturedOptions,
    );
    return yield* Effect.uninterruptible(runPointCommitPromiseEffect(() => runRollbackProof(
        target,
        located.authority,
        mixedCommand,
        intrinsicDefinitions,
        developerDefinitions,
        uniqueDefinitions,
        applicationRelations,
        candidateSchemaWriteGuard,
        capturedOptions,
      ), mapTransactionFailure));
  });

  return registerPointCommitApplicationRelationMaintenance(
    registerPointCommitUniqueConstraintEligibilityV1(
      registerPointCommitUniqueConstraintMaintenanceV1(
        registerPointCommitDeveloperIndexMaintenanceV1(
          Object.freeze({ prove }),
          capturedOptions.developerIndexes,
        ),
        capturedOptions.uniqueConstraints,
      ),
      capturedOptions.uniqueConstraints,
      capturedOptions.uniqueConstraintEligibility,
    ),
    capturedOptions.applicationRelations,
    ports,
  );
}

export function createPointCommitPublisherPortV1(
  ports: StoredCommitAuthorityEvidenceLoaderPortsV1,
  options: PointCommitTransactionProofOptionsV1 = {},
): PointCommitPublisherPortV1 & PointCommitOutcomeResolutionPortV1 & PointFiniteCommitPublisherPort {
  const capturedOptions = capturePointCommitTransactionProofOptionsV1(options);
  const finiteOperations = createFinitePublisherOperations(ports, capturedOptions);
  const hasOrderedIndexes = hasApplicationDocumentOrderedIndexComposition(ports.applicationControlDb, capturedOptions);
  const rollback = createPointCommitRollbackProofPortV1(ports, capturedOptions);

  const resolveOutcome = Effect.fn(
    "PointCommitTransaction.resolveCommittedOutcome",
  )((
    target: LocatedPointCommitPublicationTargetV1,
    input: ResolveCommittedPointOutcomeInputV1,
  ): Effect.Effect<
    CommittedPointOutcomeResolutionV1,
    ResolveCommittedPointOutcomeErrorV1
  > => target[RESOLVE_LOCATED_COMMITTED_POINT_OUTCOME_V1](input));

  const publish: PointCommitPublisherPortV1["publish"] = Effect.fn(
    "PointCommitTransaction.publish",
  )(function* (input) {
    const observation = capturedOptions.publicationObservation;
    const command = yield* observePointCommitPublicationEffect(observation, "commandPreparation",
      preparePointCommitPublicationCommand(input));
    if (observation?.detail) {
      observation.record({ kind: "counts", owner: "plan", counts: {
        rows: command.rowIntents.length,
        liveRows: command.rowIntents.filter(row => row.kind === "live").length,
        tombstones: command.rowIntents.filter(row => row.kind === "deleted").length,
        tables: new Set(command.rowIntents.map(row => row.tableId)).size,
        canonicalBytes: command.rowIntents.reduce((sum, row) => sum + (row.kind === "live" ? row.document.canonicalBytes.byteLength : 0), 0),
        semanticBytes: command.rowIntents.reduce((sum, row) => sum + (row.kind === "live" ? row.document.semanticSizeBytes : 0), 0),
        journalBytes: command.journalBytes?.byteLength ?? 0,
        resultBytes: command.successfulResult.canonicalBytes.byteLength,
        pointDependencies: command.dependencies.length,
        rangeDependencies: command.indexRangeDependencies.length,
        relationDependencies: command.relationDependencies.length,
        writeOperations: command.sealIdentity.writeOperations,
        participantOperations: command.participantOperations.length,
        sourceContributions: command.participantOperations.reduce((sum, operation) => sum + operation.sourceContributions.length, 0),
        effectOccurrences: command.participantOperations.reduce((sum, operation) => sum + operation.sourceContributions.reduce((sourceSum, source) => sourceSum + source.effects.length, 0), 0),
        eventIntents: command.participantEventIntents.length,
      } });
    }
    const located = yield* observePointCommitPublicationEffect(observation, "authorityResolution", resolvePointCommitAuthority(
      command.authorityPins,
      ports,
    ));
    const target = isLocatedPointCommitPublicationTargetV1(located.target)
      ? located.target
      : null;
    if (target === null) {
      return yield* Effect.fail(corruption(
        "readCommittedCapabilityMissing",
      ));
    }
    const lookup = captureCommittedOutcomeLookup(command);
    const existing = yield* observePointCommitPublicationEffect(observation, "initialOutcome", resolveOutcome(target, lookup));
    if (existing.kind !== "missing") {
      return yield* publicationResultFromOutcomeEffect(existing, "replayed");
    }

    const preliminaryFailure = preliminaryAuthorityFailure(
      command,
      located.authority,
    );
    if (preliminaryFailure !== null) {
      return yield* Effect.fail(preliminaryFailure);
    }

    if (command.authorityPins.executionAuthorityGeneration === "application_v1" &&
      command.rowIntents.length > 0 && !hasOrderedIndexes) {
      return yield* Effect.fail(corruption("orderedIndexCompositionInvalid"));
    }
    const definitions = yield* observePointCommitPublicationEffect(observation, "definitionPreparation", Effect.gen(function* () {
    const intrinsicDefinitions = yield* prepareIntrinsicIndexDefinitions(
      command,
      capturedOptions,
    );
    const mixedDefinitions = yield* observePointCommitPublicationEffect(observation, "mixedDefinitions", preparePointCommitMixedDefinitions(command, capturedOptions));
    const developerDefinitions = mixedDefinitions.developerDefinitions;
    const uniqueDefinitions = mixedDefinitions.uniqueDefinitions;
    const mixedCommand = Object.freeze({ ...command,
      sourceSchemaVersionByTable: mixedDefinitions.sourceSchemaVersionByTable });
    const applicationRelations = yield* prepareApplicationRelationDefinitions(
      command,
      { hasRelationAuthority: port => hasApplicationRelationCommitAuthorityForPointCommit(port, ports), hasCandidateGuardAuthority: port => hasAppSchemaCandidateWriteGuardComposition(port, ports) },
      capturedOptions,
    );
    const candidateSchemaWriteGuard = yield* prepareCandidateSchemaWriteGuard(
      command,
      { hasRelationAuthority: port => hasApplicationRelationCommitAuthorityForPointCommit(port, ports), hasCandidateGuardAuthority: port => hasAppSchemaCandidateWriteGuardComposition(port, ports) },
      capturedOptions,
    );
    return { intrinsicDefinitions, developerDefinitions, uniqueDefinitions, mixedCommand, applicationRelations, candidateSchemaWriteGuard };
    }));
    const { intrinsicDefinitions, developerDefinitions, uniqueDefinitions, mixedCommand, applicationRelations, candidateSchemaWriteGuard } = definitions;
    if (observation?.detail) observation.record({ kind: "counts", owner: "definitions", counts: {
      intrinsicDefinitions: intrinsicDefinitions.length, developerDefinitions: developerDefinitions.length,
      uniqueDefinitions: uniqueDefinitions.length,
    } });

    const runPublication = awaitPointCommitPublicationSettlement(
      runPointCommitPublication(
        target,
        located.authority,
        mixedCommand,
        intrinsicDefinitions,
        developerDefinitions,
        uniqueDefinitions,
        applicationRelations,
        candidateSchemaWriteGuard,
        capturedOptions,
      ),
    );
    const decision: PointCommitPublicationRunDecisionV1 = yield*
      runPublication.pipe(
        Effect.catchTag(
          "PointCommitTransactionDecisionUncertainV1Error",
          (uncertainty) =>
          observePointCommitPublicationEffect(observation, "finalOutcome", resolveOutcome(target, lookup)).pipe(
              Effect.catchTag(
                "CommittedPointOutcomeSqlErrorV1",
                (error) => Effect.fail(decisionUncertain(
                  uncertainty.cause,
                  Object.freeze({ kind: "lookupFailed", error }),
                )),
              ),
              Effect.flatMap((recovered): Effect.Effect<
                PointCommitPublicationRunDecisionV1,
                PointCommitDecisionUncertainV1Error
              > => recovered.kind === "missing"
                ? Effect.fail(decisionUncertain(
                    uncertainty.cause,
                    Object.freeze({ kind: "missing" }),
                  ))
                : Effect.succeed(Object.freeze({
                    kind: "recovered" as const,
                    outcome: recovered,
                  }))),
            ),
        ),
      );
    if (decision.kind === "recovered") {
      return yield* publicationResultFromOutcomeEffect(
        decision.outcome,
        "replayed",
      );
    }

    const resolved = yield* observePointCommitPublicationEffect(observation, "finalOutcome", resolveOutcome(target, lookup));
    if (decision.kind === "existing") {
      return yield* publicationResultFromOutcomeEffect(resolved, "replayed");
    }
    return yield* publicationResultFromOutcomeEffect(
      resolved,
      "published",
      decision.token,
    );
  }, effect => observePointCommitPublicationEffect(capturedOptions.publicationObservation, "publisher", effect));

  const resolvePointCommitOutcome: PointCommitOutcomeResolutionPortV1[
    typeof RESOLVE_POINT_COMMIT_OUTCOME_V1
  ] = Effect.fn(
    "PointCommitTransaction.resolvePointCommitOutcome",
  )(function* (deploymentId, input) {
    const located = yield* resolvePointCommitAuthority({
      deploymentId,
      scopeId: replacementScopeIdV1FromUuid(input.scopeUuid),
    }, ports);
    const target = isLocatedPointCommitPublicationTargetV1(located.target)
      ? located.target
      : null;
    if (target === null) {
      return yield* Effect.fail(corruption(
        "readCommittedCapabilityMissing",
      ));
    }
    return yield* resolveOutcome(target, input);
  });

  const port = registerPointCommitApplicationRelationMaintenance(
    registerPointCommitUniqueConstraintEligibilityV1(
      registerPointCommitUniqueConstraintMaintenanceV1(
        registerPointCommitDeveloperIndexMaintenanceV1(Object.freeze({
          ...rollback,
          publish,
          publishFinite: finiteOperations.publishFinite,
          resolveFinite: finiteOperations.resolveFinite,
          [RESOLVE_POINT_COMMIT_OUTCOME_V1]: resolvePointCommitOutcome,
        }), capturedOptions.developerIndexes),
        capturedOptions.uniqueConstraints,
      ),
      capturedOptions.uniqueConstraints,
      capturedOptions.uniqueConstraintEligibility,
    ),
    capturedOptions.applicationRelations,
    ports,
  );
  finitePublishers.add(port);
  return port;
}

function awaitPointCommitPublicationSettlement<Decision>(
  transaction: Promise<Decision>,
): Effect.Effect<
  Decision,
  PointCommitPublicationV1Error |
    PointCommitTransactionDecisionUncertainV1Error
> {
  return Effect.uninterruptibleMask((restore) =>
    restore(runPointCommitPromiseEffect(() => transaction, mapPublicationTransactionFailure)).pipe(
      Effect.onInterrupt(() =>
        // oxlint-disable-next-line flarex/no-unreviewed-effect-promise -- REVIEW: lifecycle - interrupt drain maps fulfillment and rejection to void so the waiter cannot reject
        Effect.promise(() =>
        transaction.then(
          () => undefined,
          () => undefined,
        )
      )),
    )
  );
}

/** Finite settlement composes one Effect callback beneath the existing located
 * transaction. The shared bridge preserves the complete callback Cause and
 * drains the original transaction; the located owner retains COMMIT certainty. */
function runFiniteCommitTransactionEffect<Value, Failure>(target: LocatedPointCommitPublicationTargetV1,
  body: (tx: AppRowTransaction) => Effect.Effect<Value, Failure>,
  runTransaction: LocatedPointCommitPublicationTargetV1[typeof RUN_LOCATED_READ_COMMITTED_V1] = target[RUN_LOCATED_READ_COMMITTED_V1]) {
  return runEffectTransactionSettlement<Value, Failure, ReturnType<typeof mapPublicationTransactionFailure>, AppRowTransaction>(
    callback => runTransaction(callback).catch(cause => {
    if (cause instanceof LocatedReadCommittedTransactionFailureV1 && cause.issue.kind === "callbackRolledBack")
      throw cause.issue.callbackCause;
    throw cause;
  }), "Finite point mutation callback rolled back", tx => body(tx).pipe(
    Effect.ensuring(Effect.sync(() => {
      closeExactAttemptScopeClockObservation(tx);
      closeProtectedMetadataFinalGuardScope(tx);
      // Installed admission remains live through the accepting runner's
      // post-callback assertion; that same runner closes it in its finally.
      if (!isInstalledAttemptScopeAuthorityTarget(target)) closeInstallationAdmission(tx);
    }))), mapPublicationTransactionFailure);
}

function finiteCommitPromiseEffect<Value>(work: () => PromiseLike<Value>) {
  return runPointCommitPromiseEffect(work, mapPointCommitCallbackFailure);
}

function finiteCommitSqlFailure(operation: PointCommitSqlOperationV1, cause: unknown) {
  return mapPointCommitCallbackFailure(new PointCommitSqlFailureMarkerV1(operation, cause));
}

function mapFiniteAnchorFailure(error: FiniteAttemptAnchorError) {
  switch (error.reason) {
    case "resourceFailure": return finiteCommitSqlFailure("lockSession", error.cause ?? error);
    case "attemptMissing": return stale("attemptMissing");
    case "attemptReplaced": return stale("attemptReplaced");
    case "ownershipChanged": return stale("lifecycleChanged");
    case "expired": return stale("expired");
    case "lifecycleChanged": return stale("lifecycleChanged");
    case "invalidInput": case "storedCorruption": return corruption("sessionInvalid");
  }
}

const prepareFiniteCommitDefinitions = Effect.fn("PointCommitTransaction.prepareFiniteDefinitions")(function* (
  command: PreparedFiniteCommitCommand, ports: StoredCommitAuthorityEvidenceLoaderPortsV1, options: PointCommitTransactionProofOptionsV1,
) {
  const originalEntry = readOriginalFiniteExecutionAuthority(command.frozen.originalEntry, ports);
  if (originalEntry === undefined) return yield* Effect.fail(corruption("commandInvalid"));
  const expectedSession = yield* Effect.fromResult(projectOriginalFinitePublicationSession(command.frozen.originalEntry,
    ports).pipe(Result.mapError(() => corruption("commandInvalid"))));
  const applicationTables = new Set(command.rowIntents.filter(row => !command.participantMaterialDocumentIds.has(row.documentId))
    .map(row => row.tableId));
  const prepared = command.frozen.applicationPublicationDefinitions;
  const indexes = new Map<CatalogIndexDefinitionId, LocatedAppIndexDefinitionV1>();
  const unique = new Map<CatalogUniqueConstraintDefinitionId, LocatedAppUniqueConstraintDefinitionV1>();
  for (const index of prepared.indexes.filter(member => applicationTables.has(member.access.tableId))) {
    if (!isLocatedAppIndexDefinitionV1(index) || index.scopeId !== command.authorityPins.scopeId ||
      index.deploymentId !== command.authorityPins.deploymentId) return yield* Effect.fail(corruption("developerIndexBuildInvalid"));
    indexes.set(index.indexDefinitionId, index);
  }
  for (const constraint of prepared.unique.filter(member => applicationTables.has(member.tableId))) {
    if (!isLocatedAppUniqueConstraintDefinitionV1(constraint) || constraint.scopeId !== command.authorityPins.scopeId ||
      constraint.deploymentId !== command.authorityPins.deploymentId || constraint.schemaVersionId !== command.authorityPins.schemaVersionId)
      return yield* Effect.fail(corruption("uniqueConstraintDefinitionInvalid"));
    unique.set(constraint.uniqueConstraintDefinitionId, constraint);
  }
  const sourceSchemaVersionByTable = new Map<CatalogTableId, CatalogSchemaVersionId>();
  for (const source of command.sources) {
    for (const tableId of source.touchedTables) {
      const prior = sourceSchemaVersionByTable.get(tableId);
      if (prior !== undefined && prior !== source.selected.schemaVersionId) return yield* Effect.fail(corruption("commandInvalid"));
      sourceSchemaVersionByTable.set(tableId, source.selected.schemaVersionId);
    }
    for (const index of source.selected.indexes.filter(member => source.touchedTables.includes(member.access.tableId))) {
      if (!isLocatedAppIndexDefinitionV1(index) || index.scopeId !== command.authorityPins.scopeId ||
        index.deploymentId !== command.authorityPins.deploymentId) return yield* Effect.fail(corruption("developerIndexBuildInvalid"));
      const prior = indexes.get(index.indexDefinitionId);
      if (prior !== undefined && prior.physicalSpecSha256Hex !== index.physicalSpecSha256Hex)
        return yield* Effect.fail(corruption("developerIndexBuildInvalid"));
      indexes.set(index.indexDefinitionId, index);
    }
    for (const constraint of source.selected.unique.filter(member => source.touchedTables.includes(member.tableId))) {
      if (!isLocatedAppUniqueConstraintDefinitionV1(constraint) || constraint.scopeId !== command.authorityPins.scopeId ||
        constraint.deploymentId !== command.authorityPins.deploymentId || constraint.schemaVersionId !== source.selected.schemaVersionId)
        return yield* Effect.fail(corruption("uniqueConstraintDefinitionInvalid"));
      const prior = unique.get(constraint.uniqueConstraintDefinitionId);
      if (prior !== undefined && prior.physicalSpecSha256Hex !== constraint.physicalSpecSha256Hex)
        return yield* Effect.fail(corruption("uniqueConstraintDefinitionInvalid"));
      unique.set(constraint.uniqueConstraintDefinitionId, constraint);
    }
  }
  const mixedCommand = Object.freeze({ ...command, sourceSchemaVersionByTable });
  const intrinsicDefinitions = Object.freeze([...indexes.values()].filter(index => index.access.kind === "by_creation_time")
    .toSorted((a, b) => a.indexDefinitionId - b.indexDefinitionId));
  for (const tableId of new Set(command.rowIntents.map(row => row.tableId)))
    if (intrinsicDefinitions.filter(index => index.access.tableId === tableId).length !== 1)
      return yield* Effect.fail(corruption("intrinsicIndexBuildInvalid"));
  const developerDefinitions = Object.freeze([...indexes.values()].filter(index => index.access.kind === "developer")
    .toSorted((a, b) => a.indexDefinitionId - b.indexDefinitionId));
  const uniqueDefinitions = Object.freeze([...unique.values()].toSorted((a, b) => a.uniqueConstraintDefinitionId - b.uniqueConstraintDefinitionId));
  if (uniqueDefinitions.length > MAX_POINT_COMMIT_UNIQUE_KEY_TRANSITIONS_V1)
    return yield* Effect.fail(corruption("uniqueConstraintDefinitionInvalid"));
  yield* Effect.fromResult(validateApplicationUniqueTransitionBudget(command.rowIntents, uniqueDefinitions));
  let applicationRelations: PreparedPointCommitApplicationRelations | null = null;
  let candidateSchemaWriteGuard: PreparedPointCommitCandidateSchemaWriteGuard | null = null;
  if (command.rowIntents.length > 0) {
    const relationPort = options.applicationRelations;
    if (relationPort !== undefined) {
      if (!hasApplicationRelationCommitAuthorityForPointCommit(relationPort, ports))
        return yield* Effect.fail(new ApplicationRelationCommitUnavailableError({ reason: "compositionMissing" }));
      const definitions = prepared.relations === null ? null : yield* Effect.fromResult(
        prepareApplicationRelationDefinitionsFromLocatedBindingResult(relationPort, prepared.relations, command.authorityPins.deploymentId))
        .pipe(Effect.mapError(() => corruption("relationBindingInvalid")));
      if (definitions !== null && definitions.schemaVersionId !== command.authorityPins.schemaVersionId)
        return yield* Effect.fail(corruption("relationBindingInvalid"));
      applicationRelations = Object.freeze({ port: relationPort, definitions });
    } else if (prepared.relations !== null) return yield* Effect.fail(corruption("relationBindingInvalid"));
    const guard = options.candidateSchemaWriteGuard;
    if (guard !== undefined) {
      if (!hasAppSchemaCandidateWriteGuardComposition(guard, ports))
        return yield* Effect.fail(new AppSchemaCandidateWriteGuardError({ reason: "compositionMismatch" }));
      const planned = yield* prepareFiniteAppSchemaCandidateWriteGuardFromPlanningHeadEffect(guard,
        command.frozen.candidatePlanningHead, command.authorityPins);
      candidateSchemaWriteGuard = Object.freeze({ guard, prepared: planned });
    }
  }
  return { mixedCommand, intrinsicDefinitions, developerDefinitions, uniqueDefinitions, applicationRelations, candidateSchemaWriteGuard,
    originalIssuer: ports, expectedSession };
});

const prepareFiniteCommitSettlement = Effect.fn("PointCommitTransaction.prepareFiniteSettlement")(function* (
  definitions: Effect.Success<ReturnType<typeof prepareFiniteCommitDefinitions>>,
) {
  const command = definitions.mixedCommand;
  const sources = yield* prepareFiniteSourceAcceptance(command, definitions.developerDefinitions, definitions.uniqueDefinitions);
  const sourcePreparationSucceeded = sources.every(source => source.documentResults.every(Exit.isSuccess) && source.definitionResults.every(Exit.isSuccess));
  const documentSettlement = sourcePreparationSucceeded ? yield* prepareApplicationDocumentSettlementEffect(command,
    command.frozen.originalRows, definitions.developerDefinitions, definitions.uniqueDefinitions,
    preparedApplicationRelationsForFiniteCommit(definitions.applicationRelations), definitions.intrinsicDefinitions) : null;
  const publicationContribution = documentSettlement !== null && !preparedApplicationDocumentSettlementHasFailure(documentSettlement)
    ? yield* Effect.exit(Effect.gen(function* () {
      const eventSha = command.events.length === 0 ? null : yield* commitEventsDigest(command.events).pipe(Effect.mapError(error =>
        error.reason === "resourceFailure" ? finiteCommitSqlFailure("writeCommitChange", error.cause ?? error) : corruption("commandInvalid")));
      const resultDigest = yield* Effect.fromResult(Encoding.decodeHex(command.successfulResult.sha256Hex)
        .pipe(Result.mapError(() => corruption("successfulResultInvalid"))));
      return { authorityPins: command.authorityPins, rowIntents: command.rowIntents,
        identityAccessPolicySha256: command.session.identityAccessPolicySha256, requestSha256: command.session.requestSha256,
        resultSha256: resultDigest, successfulResult: { ...command.successfulResult, encoding: "application-value" },
        ...(command.events.length === 0 ? {} : { events: { values: command.events, sha256: eventSha } }) } satisfies ScopePublicationContribution;
    })) : null;
  return Object.freeze({ ...definitions, sourceAcceptance: sources, documentSettlement, publicationContribution });
});

function createFinitePublisherOperations(ports: StoredCommitAuthorityEvidenceLoaderPortsV1,
  options: PointCommitTransactionProofOptionsV1): PointFiniteCommitPublisherPort {
  const publishFiniteOperation = Effect.fn("PointCommitTransaction.publishFinite")(function* (input: PointFiniteCommitCommand) {
    const outcomeCommand = yield* prepareFiniteAttemptResolutionCommand(input);
    const located = (yield* requireFrozenFiniteAttemptOrigin(input, outcomeCommand)).resolvedTarget;
    if (!isLocatedPointCommitPublicationTargetV1(located.target)) return yield* Effect.fail(corruption("readCommittedCapabilityMissing"));
    const target = located.target;
    const lookup = captureCommittedOutcomeLookup(outcomeCommand);
    const existing = yield* target[RESOLVE_LOCATED_COMMITTED_POINT_OUTCOME_V1](lookup);
    if (existing.kind !== "missing") return yield* publicationResultFromOutcomeEffect(existing, "replayed");
    const command = yield* prepareFiniteCommitCommand(input, options);
    if (!isInstalledAttemptScopeAuthorityTarget(target)) {
      // The explicit full-proof profile cannot lend installed placement proof.
      // Authenticate its current authority while retaining the original target.
      const current = yield* Effect.gen(function* () {
        const selection = command.authorityPins;
        const scope = yield* Effect.tryPromise({ try: () => ports.scopeMetadata.getScopeMetadata(selection.scopeId),
          catch: cause => new TrustedScopeAuthorityPortError({ operation: "scopeMetadataRead", cause }) });
        if (scope === null || !scopePhysicalLocatorsEqual(scope.physicalLocator, target.physicalLocator))
          return yield* Effect.fail(new TrustedScopeAuthorityResolutionError({ reason: "scopeClockTargetPlacementMismatch",
            scopeId: selection.scopeId, expected: scope?.physicalLocator ?? located.authority.physicalLocator, actual: target.physicalLocator }));
        const receipt = scope.physicalLocator.kind === "shared_database" ? null : yield* Effect.tryPromise({
          try: () => ports.provisioningReceipts.getScopeAuthorityProvisioningReceipt(selection.scopeId),
          catch: cause => new TrustedScopeAuthorityPortError({ operation: "provisioningReceiptRead", cause }) });
        yield* Effect.fromResult(resolveTrustedScopePlacementSnapshotResult(selection, scope, receipt, target.physicalLocator));
        const clock = yield* Effect.tryPromise({ try: () => target.getCurrentClock(selection.scopeId),
          catch: cause => new TrustedScopeAuthorityPortError({ operation: "scopeClockRead", cause }) });
        return yield* Effect.fromResult(resolveTrustedScopeAuthoritySnapshotResult(selection, scope, receipt, target.physicalLocator, clock));
      }).pipe(Effect.catchTag("TrustedScopeAuthorityResolutionError", routeAuthorityResolutionFailure),
        Effect.catchTag("TrustedScopeAuthorityPortError", routeAuthorityResolutionFailure));
      const currentFailure = preliminaryAuthorityFailure(command, current);
      if (currentFailure !== null) return yield* Effect.fail(currentFailure);
    }
    const preliminaryFailure = preliminaryAuthorityFailure(command, located.authority);
    if (preliminaryFailure !== null) return yield* Effect.fail(preliminaryFailure);
    const definitions = yield* prepareFiniteCommitDefinitions(command, ports, options);
    const settlement = yield* prepareFiniteCommitSettlement(definitions);
    const transaction = runFinitePointCommitPublication(target, located.authority, settlement, options);
    const decision = yield* transaction.pipe(Effect.catchTag(
      "PointCommitTransactionDecisionUncertainV1Error", uncertainty => target[RESOLVE_LOCATED_COMMITTED_POINT_OUTCOME_V1](lookup).pipe(
        Effect.catchTag("CommittedPointOutcomeSqlErrorV1", error => Effect.fail(decisionUncertain(uncertainty.cause, { kind: "lookupFailed", error }))),
        Effect.flatMap(recovered => recovered.kind === "missing" ? Effect.fail(decisionUncertain(uncertainty.cause, { kind: "missing" })) :
          Effect.succeed({ kind: "recovered" as const, outcome: recovered })),
      )));
    if (decision.kind === "recovered") return yield* publicationResultFromOutcomeEffect(decision.outcome, "replayed");
    if (decision.kind === "existing") return yield* publicationResultFromOutcomeEffect(
      yield* target[RESOLVE_LOCATED_COMMITTED_POINT_OUTCOME_V1](lookup), "replayed");
    const result = command.frozen.successfulResult;
    const digest = yield* Effect.fromResult(Encoding.decodeHex(result.evidence.sha256Hex).pipe(Result.mapError(() => corruption("successfulResultInvalid"))));
    return Object.freeze({ kind: "published" as const, token: decision.token, successfulResult: Object.freeze({
      valueCodecVersion: FLAREX_VALUE_CODEC_VERSION_V1, valueJson: structuredClone(result.valueJson), semanticSizeBytes: result.semanticSizeBytes,
      canonicalText: result.canonicalText, canonicalBytes: CanonicalSuccessfulResultBytesV1Schema.make(copyBytes(result.canonicalBytes)), sha256: FlarexValueSha256V1Schema.make(digest),
    }) });
  });
  const publishFinite: PointFiniteCommitPublisherPort["publishFinite"] = input => publishFiniteOperation(input).pipe(
    Effect.tapError(error => Effect.sync(() => finiteSettlementRefusals.set(error, { kind: "publication", command: input }))));
  const resolveFinite: PointFiniteCommitPublisherPort["resolveFinite"] = Effect.fn("PointCommitTransaction.resolveFinite")(function* (input) {
    const command = yield* prepareFiniteAttemptResolutionCommand(input);
    const located = "frozenAttempt" in input
      ? (yield* requireFrozenFiniteAttemptOrigin(input, command)).resolvedTarget
      : yield* resolvePointCommitAuthority(command.authorityPins, ports);
    if (!isLocatedPointCommitPublicationTargetV1(located.target)) return yield* Effect.fail(corruption("readCommittedCapabilityMissing"));
    const target = located.target;
    const lookup = captureCommittedOutcomeLookup(command);
    const observed = yield* target[RESOLVE_LOCATED_COMMITTED_POINT_OUTCOME_V1](lookup);
    if (observed.kind !== "missing") return Object.freeze({ kind: "committed" as const, outcome: observed });
    const transaction = runFiniteCommitTransactionEffect(target, tx => Effect.gen(function* () {
        const clock = yield* finiteCommitPromiseEffect(() => lockPointCommitClock(tx, command, options));
        const selector = { deploymentId: command.authorityPins.deploymentId, scopeId: command.authorityPins.scopeId,
          sessionId: command.authorityPins.sessionId, attemptFence: command.authorityPins.attemptFence };
        const lockedRow = yield* lockFiniteAttemptAnchorRowByIdentityInTransaction(tx, selector).pipe(Effect.mapError(mapFiniteAnchorFailure));
        // A final publisher retains these same authority/sequencer/anchor locks
        // through COMMIT. Absence after this wait conclusively excludes it.
        if ((yield* finiteCommitPromiseEffect(() => inspectCommittedOutcomeInTransaction(tx, clock, command, options))) !== null)
          return { kind: "existing" as const };
        const anchor = yield* readFiniteAttemptAnchorRow(lockedRow).pipe(Effect.mapError(mapFiniteAnchorFailure));
        const row = anchor.session;
        if (row.attemptFence !== selector.attemptFence) return yield* Effect.fail(stale("attemptReplaced"));
        if (anchor.reservation === null) return yield* Effect.fail(corruption("occEvidenceInvalid"));
        yield* Effect.fromResult(validatePointCommitSessionRowsResult([{ ...row,
          validatedArgsCanonicalByteLength: row.validatedArgsCanonicalBytes?.byteLength ?? null,
          authorizationGrantCanonicalByteLength: row.authorizationGrantCanonicalBytes?.byteLength ?? null,
        }], command, "resolveFinite"));
        const databaseNow = yield* finiteCommitPromiseEffect(() => readPointCommitDatabaseTime(tx, command.authorityPins.scopeId, options));
        if (!Number.isSafeInteger(databaseNow)) return yield* Effect.fail(corruption("scopeClockInvalid"));
        if (row.updatedAt.getTime() > databaseNow) return yield* Effect.fail(corruption("sessionInvalid"));
        if (row.lifecycle === "aborted" || row.lifecycle === "expired") {
          if (anchor.executionClaim.claimOwner !== command.executionClaim.claimOwner || anchor.executionClaim.claimFence < command.executionClaim.claimFence)
            return yield* Effect.fail(stale("attemptReplaced"));
          return { kind: "rejected" as const, error: command.terminalRefusal ?? stale(row.lifecycle === "expired" ? "expired" : "lifecycleChanged") };
        }
        if (anchor.executionClaim.claimOwner !== command.executionClaim.claimOwner ||
          anchor.executionClaim.claimFence !== command.executionClaim.claimFence + (row.lifecycle === "retrying" ? 1n : 0n))
          return yield* Effect.fail(stale("attemptReplaced"));
        const currentAuthority = requireLockedClockAuthorityResult(clock, located.authority, command);
        const expired = databaseNow >= row.authorizationGrantExpiresAt.getTime() || databaseNow >= row.hardExpiresAt.getTime();
        const budget = row.attemptFence >= MAX_FINITE_ATTEMPT_COUNT ? new PointFiniteAttemptRetryBudgetExhaustedError({
          attemptFence: row.attemptFence, maximumAttempts: MAX_FINITE_ATTEMPT_COUNT,
        }) : undefined;
        if (Result.isFailure(currentAuthority) || expired || command.terminalRefusal !== undefined || budget !== undefined) {
          const error = command.terminalRefusal ?? budget ?? (Result.isFailure(currentAuthority) ? currentAuthority.failure : stale("expired"));
          yield* rejectFiniteAttemptNonacceptanceInTransaction(tx, anchor, expired ? "expired" : "aborted")
            .pipe(Effect.mapError(mapFiniteAnchorFailure));
          return { kind: "rejected" as const, error };
        }
        let candidate: PendingFiniteAttemptNonacceptance;
        if (row.lifecycle === "retrying") candidate = yield* Effect.fromResult(
          observeFencedFiniteAttemptNonacceptance(selector, command.executionClaim, anchor).pipe(Result.mapError(mapFiniteAnchorFailure)));
        else {
          if (anchor.executionClaim.claimOwner !== command.executionClaim.claimOwner || anchor.executionClaim.claimFence !== command.executionClaim.claimFence)
            return yield* Effect.fail(stale("attemptReplaced"));
          candidate = yield* fenceFiniteAttemptNonacceptanceInTransaction(tx, selector, anchor).pipe(Effect.mapError(mapFiniteAnchorFailure));
        }
        return { kind: "fenced" as const, candidate };
    }));
    const decision = yield* transaction.pipe(Effect.catchTag(
      "PointCommitTransactionDecisionUncertainV1Error", uncertainty => target[RESOLVE_LOCATED_COMMITTED_POINT_OUTCOME_V1](lookup).pipe(
        Effect.catchTag("CommittedPointOutcomeSqlErrorV1", error => Effect.fail(decisionUncertain(uncertainty.cause, { kind: "lookupFailed", error }))),
        Effect.flatMap(outcome => outcome.kind === "missing" ? Effect.fail(decisionUncertain(uncertainty.cause, { kind: "missing" })) :
          Effect.succeed({ kind: "recovered" as const, outcome })),
      )));
    if (decision.kind === "recovered") return Object.freeze({ kind: "committed" as const, outcome: decision.outcome });
    if (decision.kind === "rejected") return Object.freeze({ kind: "rejected" as const, error: decision.error });
    if (decision.kind === "existing") {
      const outcome = yield* target[RESOLVE_LOCATED_COMMITTED_POINT_OUTCOME_V1](lookup);
      if (outcome.kind === "missing") return yield* Effect.fail(corruption("committedOutcomeMissing"));
      return Object.freeze({ kind: "committed" as const, outcome });
    }
    const proof = yield* Effect.fromResult(confirmFiniteAttemptNonacceptance(decision.candidate).pipe(Result.mapError(error =>
      error.reason === "resourceFailure" ? sqlError("lockSession", error.cause ?? error) : corruption("sessionInvalid"))));
    return Object.freeze({ kind: "noncommit" as const, proof });
  });
  return Object.freeze({ publishFinite, resolveFinite });
}

const requireFrozenFiniteAttemptOrigin = Effect.fn("PointCommitTransaction.requireFrozenOrigin")(function* (
  input: PointFiniteAttemptResolutionCommand, command: PreparedFiniteAttemptResolutionCommand,
) {
  if (input.frozenAttempt === undefined) return yield* Effect.fail(corruption("commandInvalid"));
  const origin = readFrozenFiniteAttemptOrigin(input.frozenAttempt);
  if (origin === undefined || origin.selector.deploymentId !== command.authorityPins.deploymentId ||
    origin.selector.scopeId !== command.authorityPins.scopeId || origin.selector.sessionId !== command.authorityPins.sessionId ||
    origin.selector.attemptFence !== command.authorityPins.attemptFence)
    return yield* Effect.fail(corruption("commandInvalid"));
  return origin;
});

const prepareFiniteAttemptResolutionCommand = Effect.fn("PointCommitTransaction.prepareFiniteResolution")(function* (
  input: PointFiniteAttemptResolutionCommand,
) {
  const authorityPins = yield* Effect.fromResult(captureAuthorityPinsResult(input.authorityPins));
  const session = yield* Effect.fromResult(captureSessionScalarsResult(input.session));
  const executionClaim = yield* Effect.fromResult(captureExecutionClaimPinResult(input.executionClaim));
  if (input.terminalRefusal !== undefined) {
    const emitted = finiteSettlementRefusals.get(input.terminalRefusal);
    if (emitted === undefined || emitted.command.authorityPins !== input.authorityPins || emitted.command.session !== input.session ||
      emitted.command.executionClaim !== input.executionClaim ||
      (emitted.kind === "replacement" ? emitted.proof !== input.terminalRefusalProof : input.terminalRefusalProof !== undefined))
      return yield* Effect.fail(corruption("commandInvalid"));
  } else if (input.terminalRefusalProof !== undefined) {
    return yield* Effect.fail(corruption("commandInvalid"));
  }
  if (session.lifecycle !== "running" || authorityPins.storageGeneration !== session.storageGeneration ||
    authorityPins.storageGenerationFence !== session.storageGenerationFence || !commandExecutionAuthorityConsistent(authorityPins, session) ||
    authorityPins.functionPath !== session.functionPath || authorityPins.functionKind !== session.functionKind ||
    authorityPins.schemaVersionId !== session.schemaVersionId || authorityPins.policyVersion !== session.policyVersion ||
    authorityPins.authorizationRevocationEpoch !== session.authorizationRevocationEpoch || authorityPins.requestKey !== session.requestKey)
    return yield* Effect.fail(corruption("commandInvalid"));
  const scope = yield* Effect.fromResult(projectScopeIdUuidV1Result(authorityPins.scopeId).pipe(Result.mapError(() => corruption("commandInvalid"))));
  return Object.freeze({ authorityPins, session, executionClaim, scopeUuid: scope.scopeUuid,
    ...(input.terminalRefusal === undefined ? {} : { terminalRefusal: input.terminalRefusal }),
    ...(input.terminalRefusalProof === undefined ? {} : { terminalRefusalProof: input.terminalRefusalProof }) }) satisfies PreparedFiniteAttemptResolutionCommand;
});

function runFinitePointCommitPublication(target: LocatedPointCommitPublicationTargetV1, preliminaryAuthority: TrustedScopeAuthority,
  settlement: Effect.Success<ReturnType<typeof prepareFiniteCommitSettlement>>, options: PointCommitTransactionProofOptionsV1,
) {
  const { mixedCommand: command, intrinsicDefinitions, developerDefinitions, uniqueDefinitions, applicationRelations, candidateSchemaWriteGuard,
    originalIssuer, expectedSession, sourceAcceptance, documentSettlement, publicationContribution } = settlement;
  return runFiniteCommitTransactionEffect(target, tx => Effect.gen(function* () {
      if (!isInstalledAttemptScopeAuthorityTarget(target))
        yield* lockInstallationForCurrentTransaction(tx, preliminaryAuthority.physicalLocator.schemaName).pipe(
          Effect.mapError(error => error.reason === "resourceFailure" ? finiteCommitSqlFailure("lockScopeClock", error.cause ?? error)
            : stale("scopeChanged")));
      yield* Effect.sync(() => openProtectedMetadataFinalGuardScope(tx));
      const accepted = isInstalledAttemptScopeAuthorityTarget(target)
        ? yield* target[ACCEPT_INSTALLED_ATTEMPT_SCOPE_AUTHORITY_IN_TRANSACTION](tx, command.authorityPins)
          .pipe(Effect.mapError(error => "reason" in error && error.reason === "resourceFailure"
            ? finiteCommitSqlFailure("lockScopeClock", error.cause ?? error) : stale("scopeChanged")))
        : undefined;
      const clock = accepted === undefined
        ? yield* finiteCommitPromiseEffect(() => lockPointCommitClock(tx, command, options))
        : yield* Effect.fromResult(decodeLockedPointCommitClockResult(accepted.row));
      yield* finiteCommitPromiseEffect(() => emitTransactionStep(options, command, "clockLocked"));
      const namespace = sql.identifier(preliminaryAuthority.physicalLocator.schemaName);
      if (options.afterTransactionStep !== undefined) {
        const [locked] = yield* finiteCommitPromiseEffect(() => sqlCall("lockSession", () => tx.select({
          found: sql<boolean>`${namespace}.fx_lock_finite_publication_anchor(${command.scopeUuid}::uuid,
            ${command.authorityPins.sessionId}::uuid)`,
        }).from(sql`(values(1)) as publication_lock`)));
        if (locked?.found !== true) return yield* Effect.fail(stale("attemptMissing"));
        yield* finiteCommitPromiseEffect(() => emitTransactionStep(options, command, "sessionLocked"));
      }
      const lookup = captureCommittedOutcomeLookup(command);
      const observationQuery = finitePublicationAnchorQuery(tx, preliminaryAuthority.physicalLocator.schemaName, {
        ...lookup, sessionId: command.authorityPins.sessionId, expectedSession,
      });
      observeDrizzleQuery("lockSession", observationQuery, options);
      const observedRows = yield* finiteCommitPromiseEffect(() => sqlCall("lockSession", () => observationQuery));
      const observed = observedRows[0];
      if (observedRows.length !== 1 || observed === undefined) return yield* Effect.fail(corruption("sessionInvalid"));
      if (options.afterTransactionStep === undefined)
        yield* finiteCommitPromiseEffect(() => emitTransactionStep(options, command, "sessionLocked"));
      if (observed.reason === "attemptMissing") return yield* Effect.fail(stale("attemptMissing"));
      // A real outcome snapshot follows the actual stable lock. Its existing
      // canonical scalar/header decoder precedes every new anchor refusal.
      if (observed.reason === "replay") {
        yield* Effect.fromResult(acceptObservedCommittedOutcomeResult(observed.outcome, clock, command));
        return Object.freeze({ kind: "existing" as const });
      }
      if (observed.reason !== "accepted") return yield* Effect.fail(corruption("sessionInvalid"));
      const anchor = yield* lendComparedFinitePublicationAnchor(command.frozen.originalEntry, originalIssuer,
        observed.mutable).pipe(Effect.mapError(mapFiniteAnchorFailure));
      yield* Effect.fromResult(requireLockedClockAuthorityResult(clock, preliminaryAuthority, command));
      if (accepted !== undefined) {
        const authorityFailure = preliminaryAuthorityFailure(command, accepted.authority);
        if (authorityFailure !== null) return yield* Effect.fail(authorityFailure);
        if (!scopePhysicalLocatorsEqual(accepted.authority.physicalLocator, preliminaryAuthority.physicalLocator))
          return yield* Effect.fail(stale("scopeChanged"));
      }
      const acceptedAuthority = accepted?.authority ?? preliminaryAuthority;
      if (anchor.executionClaim.claimOwner !== command.executionClaim.claimOwner || anchor.executionClaim.claimFence !== command.executionClaim.claimFence)
        return yield* Effect.fail(stale("attemptReplaced"));
      const row = anchor.session;
      yield* Effect.fromResult(validatePointCommitSessionRowsResult([{ ...row,
        validatedArgsCanonicalByteLength: row.validatedArgsCanonicalBytes?.byteLength ?? null,
        authorizationGrantCanonicalByteLength: row.authorizationGrantCanonicalBytes?.byteLength ?? null,
      }], command, "publishFinite"));
      if (anchor.reservation === null || anchor.snapshotToken.epoch !== command.authorityPins.snapshotToken.epoch ||
        anchor.snapshotToken.commitSeq !== command.authorityPins.snapshotToken.commitSeq ||
        anchor.snapshotToken.commitSeq < clock.oldestAvailableCommitSeq) return yield* Effect.fail(corruption("sessionInvalid"));
      const now = finiteDateMilliseconds(observed.databaseNow);
      if (now === undefined) return yield* Effect.fail(corruption("sessionInvalid"));
      yield* Effect.fromResult(requireFiniteAttemptIsLive(anchor, new Date(now)).pipe(Result.mapError(mapFiniteAnchorFailure)));
      // The ordinary full-artifact lock owner already issued this observation.
      // Installed acceptance supplies its actual clock row without that scope.
      if (accepted !== undefined) yield* Effect.sync(() => openExactAttemptScopeClockObservation(tx,
        clock.record, clock.authorizationRevocationEpoch, "attempt"));
      const capturedWatermark = anchor.reservation.metadataWatermark;
      const admittedParticipants = yield* withSharedLogicalSourceBindingChecks(tx, () => Effect.gen(function* () {
      const watermark = capturedWatermark;
      const consumedExpected = yield* Effect.fromResult(prepareConsumedFiniteMetadataComparison(watermark,
        command.frozen.graph.metadataDependencies ?? [])).pipe(Effect.mapError(() => corruption("dependencySetInvalid")));
      const applicationExpected = prepareFiniteTableWriteClosureComparison(command.frozen.applicationMetadataProjection, command.attemptedTableIds);
      const sourceExpectations = sourceAcceptance.map(({source,touchedTables}) =>
        prepareFiniteOperationCommitObservation(source.token, source.admission, command.frozen.attempt,
          source.operation.participant, source.methods, tx, acceptedAuthority, clock.record, touchedTables));
      const metadata = yield* observeFinitePublicationMetadata(tx, preliminaryAuthority.physicalLocator.schemaName,
        command.authorityPins.scopeId, watermark, consumedExpected,
        Result.match(applicationExpected, { onFailure: () => [], onSuccess: prepared => prepared.pages }),
        sourceExpectations.map(expected => Result.match(expected, { onFailure: () => [], onSuccess: prepared => prepared.pages }))).pipe(Effect.mapError(error =>
          error.reason === "resourceFailure" ? finiteCommitSqlFailure("validateIndexRanges", error.cause ?? error) : corruption("dependencySetInvalid")));
      yield* Effect.fromResult(acceptFiniteMetadataComparisonVerdict(metadata.consumed, consumedExpected, watermark)).pipe(Effect.mapError(error =>
          error.reason === "writeConflict" && error.dependency !== undefined && error.capturedMetadataWatermark !== undefined && error.lastChangedMetadataSequence !== undefined
            ? new PointCommitConflictV1Error({ conflict: { kind: "metadata", ...error.dependency,
              capturedMetadataWatermark: error.capturedMetadataWatermark, lastChangedMetadataSequence: error.lastChangedMetadataSequence },
              snapshotCommitSeq: anchor.snapshotToken.commitSeq, currentCommitSeq: clock.record.lastCommitSeq })
            : error.reason === "resourceFailure" ? finiteCommitSqlFailure("validateIndexRanges", error.cause ?? error) : corruption("dependencySetInvalid")));
      const applicationPlan = yield* Effect.fromResult(applicationExpected).pipe(Effect.mapError(() => stale("activeSchemaChanged")));
      yield* Effect.fromResult(acceptFiniteTableWriteClosureComparison(applicationPlan, metadata.application)).pipe(
          Effect.mapError(error => error.reason === "resourceFailure" ? finiteCommitSqlFailure("validateActiveApplicationSchema", error.cause ?? error)
            : stale("activeSchemaChanged")));
      yield* validateApplicationWriteOwnershipForCommit(tx,
        { scopeId: command.authorityPins.scopeId, generation: command.authorityPins.executionAuthorityGeneration,
          authenticatedAttemptedTables: command.attemptedTableIds,
          materialTables: command.rowIntents.filter(intent => !command.participantMaterialDocumentIds.has(intent.documentId)).map(intent => intent.tableId) },
        options.uniqueConstraints, target, metadata.ownership).pipe(Effect.mapError(error => error.reason === "resourceFailure"
          ? finiteCommitSqlFailure("validateActiveApplicationSchema", error.cause ?? error) : corruption("applicationWritePolicyDenied")));
      yield* finiteCommitPromiseEffect(() => validateActiveRelationSelectionForPointCommit(tx, command));
          const acceptedSources: Readonly<{ search: readonly LogicalSearchDefinition[] }>[] = [];
          for (const source of command.sources) {
            // Every receipt retains its exact method/admission check. Only the
            // genuine issuer token identifies shared final validation ownership.
            const selected = inspectFiniteOperationCommitAuthority(source.token, source.admission, command.frozen.attempt,
              source.operation.participant, source.methods);
            if (selected === null) return yield* Effect.fail(corruption("commandInvalid"));
          }
          const sourceObservations = yield* decodeFinitePublicationSourceObservationPages(metadata.sources)
            .pipe(Effect.mapError(() => stale("activeSchemaChanged")));
          let sourceOrdinal = 0;
          for (const { source, touchedTables, documentResults, definitionResults } of sourceAcceptance) {
            const sourceExpectation = sourceExpectations[sourceOrdinal];
            if (sourceExpectation === undefined) return yield* Effect.fail(stale("activeSchemaChanged"));
            const sourcePrepared = yield* Effect.fromResult(sourceExpectation).pipe(Effect.mapError(() => stale("activeSchemaChanged")));
            yield* sourcePrepared.accept(sourceObservations[sourceOrdinal] ?? null)
              .pipe(Effect.mapError(error => error.reason === "resourceFailure" ? finiteCommitSqlFailure("validateActiveApplicationSchema", error.cause ?? error)
                : stale("activeSchemaChanged")));
            for (const result of documentResults) {
              if (Exit.isFailure(result)) return yield* Effect.failCause(result.cause);
              yield* finiteCommitPromiseEffect(() => emitTransactionStep(options, command, "finiteParticipantDocumentValidated"));
            }
            for (const result of definitionResults) if (Exit.isFailure(result)) return yield* Effect.failCause(result.cause);
            acceptedSources.push({ search: source.selected.search.filter(search => touchedTables.includes(search.tableId)) });
            sourceOrdinal++;
          }
          if (sourceObservations.length !== sourceOrdinal) return yield* Effect.fail(stale("activeSchemaChanged"));
          return acceptedSources;
        }));
      const allowed = new Set([...command.attemptedTableIds, ...command.sources.flatMap(source => [...source.selected.tableIds])]);
      yield* validateLogicalDocumentChanges({ tx,
        scopeId: command.authorityPins.scopeId, tables: allowed, maximumIndexEntries: 4096,
        conflict: observation => new PointCommitConflictV1Error({ conflict: { kind: "finiteRootGraph", observation },
          snapshotCommitSeq: anchor.snapshotToken.commitSeq, currentCommitSeq: clock.record.lastCommitSeq }),
        error: (reason, cause): PointCommitPublicationV1Error => reason === "statementFailure" || reason === "resourceFailure"
          ? finiteCommitSqlFailure("validateIndexRanges", cause ?? reason) : corruption("dependencySetInvalid"),
      }, command.frozen.graph);
      const intrinsicBuilds = yield* finiteCommitPromiseEffect(() => lockPointCommitIntrinsicIndexBuilds(tx, clock, intrinsicDefinitions, command));
      const { developerIndexBuilds: developerBuilds, freshHeads } = yield* finiteCommitPromiseEffect(() =>
        lockFinitePointCommitDeveloperIndexBuildsAndHeads(tx, clock, developerDefinitions, command,
          command.frozen.originalRows, uniqueDefinitions, preparedApplicationRelationsForFiniteCommit(applicationRelations), options));
      const heads = freshHeads.heads;
      yield* Effect.fromResult(validatePointCommitDependenciesResult(command, heads));
      const ranges = yield* finiteCommitPromiseEffect(() => findPointCommitIndexRangeConflict(tx, clock, command));
      if (ranges !== null) return yield* Effect.fail(ranges);
      const relations = yield* finiteCommitPromiseEffect(() => findPointCommitRelationConflict(tx, clock, command, options));
      if (relations !== null) return yield* Effect.fail(relations);
      const materialization = yield* beginFiniteApplicationMaterialization(tx, clock.record,
        new Date(Math.min(anchor.leaseExpiresAt.getTime(), Date.parse(anchor.executionClaim.claimExpiresAt),
          anchor.session.authorizationGrantExpiresAt.getTime(), anchor.session.hardExpiresAt.getTime()))).pipe(Effect.mapError(error =>
            error.reason === "resourceFailure" ? finiteCommitSqlFailure("readDatabaseTime", error.cause ?? error)
              : corruption("sessionInvalid")));
      const preWriteTime = materialization.databaseNowMilliseconds;
      yield* Effect.fromResult(requireFiniteAttemptIsLive(anchor, new Date(preWriteTime)).pipe(Result.mapError(mapFiniteAnchorFailure)));
      if (documentSettlement === null) return yield* Effect.fail(corruption("commandInvalid"));
      const kernel = yield* finiteCommitPromiseEffect(() => lowerAcceptedPointCommit(tx, command, clock, heads, intrinsicBuilds, developerBuilds, developerDefinitions,
        uniqueDefinitions, preparedApplicationRelationsForFiniteCommit(applicationRelations), candidateSchemaWriteGuard, acceptedAuthority,
        preWriteTime, admittedParticipants, options, { freshHeads, documentSettlement,
          ...(materialization.capturedCoverage === null ? {} : { capturedCoverage: materialization.capturedCoverage }) }));
      if (kernel.kind === "existing") return Object.freeze({ kind: "existing" as const });
      const ready = yield* Effect.fromResult(requirePointCommitReadyForPublicationResult(kernel));
      if (publicationContribution === null) return yield* Effect.fail(corruption("commandInvalid"));
      if (Exit.isFailure(publicationContribution)) return yield* Effect.failCause(publicationContribution.cause);
      const contribution = publicationContribution.value;
      yield* finiteCommitPromiseEffect(() => writeScopePublicationPrefix(tx, contribution, ready, options, undefined, anchor.session));
      if (accepted !== undefined && options.afterTransactionStep === undefined) {
        yield* finiteCommitPromiseEffect(() => requireScopePublicationStrongReferences(tx, ready, options));
        const guard = yield* prepareProtectedMetadataFinalGuardBatch(tx).pipe(Effect.mapError(error =>
          error.reason === "resourceFailure" ? finiteCommitSqlFailure("validateActiveApplicationSchema", error.cause ?? error) : stale("activeSchemaChanged")));
        yield* Effect.sync(() => closeExactAttemptScopeClockObservation(tx));
        const query = tx.select({ lastCommitSeq: sql`advanced.last_commit_seq`.mapWith(fxSystemScopeClocks.lastCommitSeq),
          valid: sql<boolean>`case when advanced.reason = 'accepted' then
            case when (select metadata_guard.valid from ${guard.source} as metadata_guard)
              then true else ${namespace}.fx_refuse_scope_publication_metadata() end else false end`,
        }).from(sql`${scopePublicationClockAdvanceSource(preliminaryAuthority.physicalLocator.schemaName, ready)} advanced`);
        observeDrizzleQuery("advanceScopeClock", query, options);
        yield* Effect.sync(() => options.publicationObservation?.record({ kind: "phase", phase: "clockAdvance", edge: "begin" }));
        const rows = yield* runDrizzleStatementEffect(query, cause => {
          if (scopePublicationMetadataChanged(cause) || findSqlState(cause) === "55P03") return stale("activeSchemaChanged");
          const refused = scopePublicationProcedureFailure(cause);
          return refused === null ? finiteCommitSqlFailure("advanceScopeClock", cause) : corruption(refused.reason);
        }).pipe(Effect.ensuring(Effect.sync(() => options.publicationObservation?.record({ kind: "phase", phase: "clockAdvance", edge: "end" }))));
        yield* Effect.fromResult(requirePointCommitClockPublicationResult(rows, ready.commitSeq).pipe(Result.mapError(error => corruption(error.reason))));
        yield* acceptProtectedMetadataFinalGuardBatch(tx, rows.map(guardRow => ({ valid: guardRow.valid }))).pipe(Effect.mapError(error =>
          error.reason === "resourceFailure" ? finiteCommitSqlFailure("validateActiveApplicationSchema", error.cause ?? error) : stale("activeSchemaChanged")));
      } else {
        yield* finiteCommitPromiseEffect(() => advanceScopePublicationClock(tx, contribution, ready, options));
        yield* finiteCommitPromiseEffect(() => emitTransactionStep(options, command, "beforeCommit"));
        yield* flushProtectedMetadataFinalGuards(tx).pipe(Effect.mapError(error => error.reason === "resourceFailure"
          ? finiteCommitSqlFailure("validateActiveApplicationSchema", error.cause ?? error) : stale("activeSchemaChanged")));
      }
      return { kind: "published" as const, token: { scopeUuid: ready.clock.scopeUuid, epochUuid: ready.clock.epochUuid, commitSeq: ready.commitSeq } };
  }), isInstalledAttemptScopeAuthorityTarget(target)
    ? callback => target[RUN_INSTALLED_ACCEPTING_READ_COMMITTED](command.authorityPins, callback)
    : target[RUN_LOCATED_READ_COMMITTED_V1]);
}

const preparePointCommitCommand = Effect.fn(
  "PointCommitTransaction.prepareCommand",
)(function* (
  input: PointCommitTransactionCommandV1,
): Effect.fn.Return<
  PreparedPointCommitTransactionCommandV1,
  PointCommitCorruptionV1Error | PointCommitStaleAuthorityV1Error
> {
  const captured = yield* Effect.fromResult(
    capturePointCommitCommandResult(input),
  );
  let attemptedTableIds: ReadonlyArray<CatalogTableId> | null = null;
  let participantOperations: readonly AdmittedParticipantOperation[] = Object.freeze([]);
  let participantJournal: SessionJournal | null = null;
  let finiteMetadataReservationSha256Hex: string | null = null;
  const metadataDependencies: LogicalMetadataReadDependency[] = [];
  let participantMaterialDocumentIds: ReadonlySet<string> = new Set();
  const participantEventIntents: CommittedEvent[] = [];
  if (captured.journalBytes !== undefined) {
    const journal = yield* decodeCanonicalSessionJournalEffect({ canonicalBytes: captured.journalBytes,
      expectedSha256Hex: encodeBytesToLowercaseHex(captured.sealIdentity.journalSha256) }).pipe(
      Effect.mapError(() => corruption("commandInvalid")));
    const tables = new Set<CatalogTableId>();
    for (const write of journal.journal.writes) {
      const identity = yield* Effect.fromResult(decodeAppDocumentIdentityV1Result(write.documentId).pipe(
        Result.mapError(() => corruption("commandInvalid"))));
      tables.add(identity.tableId);
    }
    attemptedTableIds = Object.freeze([...tables]);
    participantOperations = journal.journal.participantOperations;
    participantJournal = journal.journal;
    finiteMetadataReservationSha256Hex = journal.journal.finiteMetadataReservationSha256Hex ?? null;
    metadataDependencies.push(...journal.journal.readDependencies.filter(dependency => dependency.kind === "metadata"));
    for (const operation of participantOperations) for (const contribution of operation.sourceContributions) {
      const evidence = yield* Effect.fromResult(decodeLogicalParticipantDependencyEvidence(contribution.dependencyEvidence)
        .pipe(Result.mapError(() => corruption("commandInvalid"))));
      if (evidence.version === 2) {
        if (finiteMetadataReservationSha256Hex === null) return yield* Effect.fail(corruption("commandInvalid"));
        const sourceMetadataDependencies = yield* decodePointCommitMetadataDependenciesEffect(
          evidence.metadataDependencies).pipe(Effect.mapError(() => corruption("commandInvalid")));
        for (const dependency of sourceMetadataDependencies) {
          const retained = metadataDependencies.find(member => logicalMetadataDependencyIdentity(member) === logicalMetadataDependencyIdentity(dependency));
          if (retained === undefined || retained.capturedWatermark !== dependency.capturedWatermark || retained.observed.kind !== dependency.observed.kind ||
            retained.observed.kind === "present" && dependency.observed.kind === "present" && retained.observed.semanticSha256Hex !== dependency.observed.semanticSha256Hex)
            return yield* Effect.fail(corruption("commandInvalid"));
        }
      } else if (finiteMetadataReservationSha256Hex !== null) return yield* Effect.fail(corruption("commandInvalid"));
    }
    if (metadataDependencies.length > 0 && finiteMetadataReservationSha256Hex === null)
      return yield* Effect.fail(corruption("commandInvalid"));
    if (finiteMetadataReservationSha256Hex !== null && captured.relationDependencies.length > 0)
      return yield* Effect.fail(corruption("commandInvalid"));
    const documents = new Set<string>();
    const appDocuments = new Set(journal.journal.writes.map(write => write.documentId));
    for (const operation of participantOperations) for (const contribution of operation.sourceContributions)
      for (const effect of contribution.effects) {
      if (appDocuments.has(effect.documentId) || tables.has(effect.tableId))
        return yield* Effect.fail(corruption("commandInvalid"));
      documents.add(effect.documentId);
    }
    for (const operation of participantOperations) for (const event of operation.eventIntents)
      participantEventIntents.push(yield* Effect.fromResult(decodePointCommitEventEnvelope(event.intent)
        .pipe(Result.mapError(() => corruption("commandInvalid")))));
    participantMaterialDocumentIds = documents;
  }
  const rowIntents: PreparedPointCommitRowIntentV1[] = [];
  for (const rowIntent of captured.rowIntents) {
    if (rowIntent.kind === "deleted") {
      rowIntents.push(rowIntent);
      continue;
    }
    const document = yield* Effect.tryPromise({
      try: () => canonicalizeFlarexValueV1(
        rowIntent.value,
        "appDocument",
      ),
      catch: (cause): unknown => cause,
    }).pipe(Effect.catch((cause: unknown) =>
      cause instanceof FlarexValueCodecV1Error
        ? Effect.fail(corruption("commandInvalid"))
        : Effect.die(cause)
    ));
    if (
      !bytesEqual(document.canonicalBytes, rowIntent.canonicalBytes) ||
      document.semanticSizeBytes !== rowIntent.semanticSizeBytes ||
      !isCanonicalDocumentForIntent(document, rowIntent)
    ) {
      return yield* Effect.fail(corruption("commandInvalid"));
    }
    rowIntents.push(Object.freeze({
      documentId: rowIntent.documentId,
      tableId: rowIntent.tableId,
      rowId: rowIntent.rowId,
      dependency: rowIntent.dependency,
      kind: "live",
      creationTime: rowIntent.creationTime,
      document,
    } satisfies PreparedLivePointCommitRowIntentV1));
  }
  return Object.freeze({
    ...captured,
    attemptedTableIds,
    participantOperations,
    participantJournal,
    metadataDependencies: Object.freeze([...new Map(metadataDependencies.map(dependency => [logicalMetadataDependencyIdentity(dependency), dependency])).values()]),
    finiteMetadataReservationSha256Hex,
    participantMaterialDocumentIds,
    participantEventIntents: Object.freeze(participantEventIntents),
    rowIntents: Object.freeze(rowIntents),
  });
});

const prepareFiniteCommitCommand = Effect.fn("PointCommitTransaction.prepareFiniteCommand")(function* (
  input: PointFiniteCommitCommand, options: PointCommitTransactionProofOptionsV1,
) {
  const authorityPins = yield* Effect.fromResult(captureAuthorityPinsResult(input.authorityPins));
  const session = yield* Effect.fromResult(captureSessionScalarsResult(input.session));
  if (authorityPins.storageGeneration !== session.storageGeneration || authorityPins.storageGenerationFence !== session.storageGenerationFence ||
    !commandExecutionAuthorityConsistent(authorityPins, session) || authorityPins.functionPath !== session.functionPath ||
    authorityPins.functionKind !== session.functionKind || authorityPins.schemaVersionId !== session.schemaVersionId ||
    authorityPins.policyVersion !== session.policyVersion || authorityPins.authorizationRevocationEpoch !== session.authorizationRevocationEpoch ||
    authorityPins.requestKey !== session.requestKey) return yield* Effect.fail(corruption("commandInvalid"));
  const executionClaim = yield* Effect.fromResult(captureExecutionClaimPinResult(input.executionClaim));
  const scope = yield* Effect.fromResult(projectScopeIdUuidV1Result(authorityPins.scopeId)
    .pipe(Result.mapError(() => corruption("commandInvalid"))));
  const frozen = readOwnedFrozenFiniteAttempt(input.frozenAttempt);
  if (frozen === undefined || session.lifecycle !== "running" ||
    frozen.attemptState.selector.scopeId !== authorityPins.scopeId || frozen.attemptState.selector.deploymentId !== authorityPins.deploymentId ||
    frozen.attemptState.selector.sessionId !== authorityPins.sessionId || frozen.attemptState.selector.attemptFence !== authorityPins.attemptFence ||
    frozen.attemptState.snapshotToken.epoch !== authorityPins.snapshotToken.epoch ||
    frozen.attemptState.snapshotToken.commitSeq !== authorityPins.snapshotToken.commitSeq ||
    frozen.attemptState.schemaVersionId !== authorityPins.schemaVersionId ||
    frozen.attemptState.executionClaim.claimOwner !== executionClaim.claimOwner || frozen.attemptState.executionClaim.claimFence !== executionClaim.claimFence ||
    frozen.attemptState.executionProfile !== "finiteRoot") return yield* Effect.fail(corruption("commandInvalid"));
  const dependencies = yield* Effect.fromResult(capturePointCommitDependenciesResult(
    [...frozen.graph.dependencies].toSorted((a, b) => a.tableId - b.tableId || compareRowIds(a.rowId, b.rowId)), frozen.graph.dependencies.length));
  const rowIntents = frozen.rowIntents;
  if (rowIntents.length > MAX_POINT_COMMIT_MATERIAL_ROWS_V1) return yield* Effect.fail(corruption("commandInvalid"));
  yield* Effect.fromResult(requireCanonicalDependencyOrderResult(rowIntents));
  for (const row of rowIntents) {
    if (!dependencies.some(dependency => pointDependenciesEqual(dependency, row))) return yield* Effect.fail(corruption("dependencySetInvalid"));
    if (row.kind === "live" && !isCanonicalDocumentForIntent(row.document, row))
      return yield* Effect.fail(corruption("commandInvalid"));
  }
  const applicationTables = new Set<CatalogTableId>();
  const sources: FiniteCommitSource[] = [];
  const nativeTables = new Set<CatalogTableId>();
  const events: CommittedEvent[] = [];
  const attributedAttempts = new Set<number>();
  for (const operation of frozen.operations) {
    if (operation.kind !== "participant") {
      if (operation.write !== undefined) applicationTables.add(yield* Effect.fromResult(decodeAppDocumentIdentityV1Result(operation.write.documentId)
        .pipe(Result.map(identity => identity.tableId), Result.mapError(() => corruption("commandInvalid")))));
      continue;
    }
    const profiles = (options.logicalOperationProfiles ?? []).filter(profile => profile.participant === operation.participant &&
      profile.operationMethods.includes(operation.method) && profile.profileRevision === operation.profileRevision);
    const bundle = inspectLogicalParticipantAdmissionBundle(operation.admission, frozen.attempt, operation.participant, operation.method, operation.profileRevision);
    const profile = profiles[0];
    if (profiles.length !== 1 || profile === undefined || bundle === null || profile.sources.length !== bundle.admissions.length ||
      operation.sourceRefs.length !== bundle.admissions.length || operation.attemptStart < 0 || operation.attemptEnd < operation.attemptStart ||
      operation.attemptEnd > frozen.graph.attempts.length) return yield* Effect.fail(corruption("commandInvalid"));
    if (operation.eventIntents.some(intent => intent.sourceKey !== null &&
      !operation.sourceRefs.some(reference => reference.sourceKey === intent.sourceKey)))
      return yield* Effect.fail(corruption("commandInvalid"));
    for (const [ordinal, admission] of bundle.admissions.entries()) {
      const token = profile.sources[ordinal]!, methods = bundle.sourceMethods[ordinal]!;
      const selected = inspectFiniteOperationCommitAuthority(token, admission, frozen.attempt, operation.participant, methods);
      const reference = operation.sourceRefs[ordinal];
      if (selected === null || reference === undefined || reference.sourceKey !== selected.sourceKey ||
        reference.sourceSha256Hex !== selected.sourceSha256 || reference.bindingHead.sequence !== selected.head.sequence ||
        reference.bindingHead.sha256 !== selected.head.sha256 || selected.root.principalDigest !== encodeBytesToLowercaseHex(session.identityAccessPolicySha256) ||
        selected.root.sessionId !== authorityPins.sessionId || selected.root.attemptFence !== authorityPins.attemptFence)
        return yield* Effect.fail(corruption("commandInvalid"));
      const touchedTables = new Set<CatalogTableId>();
      for (let index = operation.attemptStart; index < operation.attemptEnd; index++) {
        const attempted = frozen.graph.attempts[index]!;
        if (selected.tableIds.has(attempted.tableId)) { touchedTables.add(attempted.tableId); attributedAttempts.add(index); }
      }
      for (const tableId of selected.tableIds) nativeTables.add(tableId);
      sources.push({ token, operation, admission, methods, selected, touchedTables: Object.freeze([...touchedTables]) });
      const selectedEvents: CommittedEvent[] = [];
      for (const event of operation.eventIntents.filter(intent => intent.sourceKey === selected.sourceKey))
        selectedEvents.push(yield* Effect.fromResult(decodePointCommitEventEnvelope(event.intent).pipe(Result.mapError(() => corruption("commandInvalid")))));
      const policies = (options.logicalParticipantEvents ?? []).filter(policy => policy.authority === token);
      if (policies.length > 1 || selectedEvents.length > 0 && policies.length !== 1) return yield* Effect.fail(corruption("commandInvalid"));
      const policy = policies[0];
      if (policy !== undefined) yield* validateAdmittedCommerceEventIntents(policy.policy, policy.selection, selectedEvents,
        admittedCommerceEventGroup({ scopeUuid: scope.scopeUuid, sessionId: authorityPins.sessionId, attemptFence: authorityPins.attemptFence }))
        .pipe(Effect.mapError(() => corruption("commandInvalid")));
    }
    const operationEvents: CommittedEvent[] = [];
    for (const event of operation.eventIntents.filter(intent => intent.sourceKey === null))
      operationEvents.push(yield* Effect.fromResult(decodePointCommitEventEnvelope(event.intent).pipe(Result.mapError(() => corruption("commandInvalid")))));
    if (operationEvents.length > 0 && profile.operationEvents === undefined) return yield* Effect.fail(corruption("commandInvalid"));
    if (profile.operationEvents !== undefined) yield* validateAdmittedOperationEventIntents(profile.operationEvents.policy,
      profile.operationEvents.selection, operationEvents, admittedCommerceEventGroup({ scopeUuid: scope.scopeUuid,
        sessionId: authorityPins.sessionId, attemptFence: authorityPins.attemptFence })).pipe(Effect.mapError(() => corruption("commandInvalid")));
    // Source and operation policies validate their own selections above. The
    // publication preserves the producer's original interleaving across them.
    for (const intent of operation.eventIntents)
      events.push(yield* Effect.fromResult(decodePointCommitEventEnvelope(intent.intent)
        .pipe(Result.mapError(() => corruption("commandInvalid")))));
  }
  if (frozen.graph.attempts.some((attempt, ordinal) => !attributedAttempts.has(ordinal) && !applicationTables.has(attempt.tableId)))
    return yield* Effect.fail(corruption("commandInvalid"));
  const resultValue = yield* Effect.fromResult(Result.try({ try: () => jsonToFlarexValueV1(frozen.successfulResult.valueJson),
    catch: () => corruption("successfulResultInvalid") }));
  const successfulResult = Object.freeze({ valueCodecVersion: FLAREX_VALUE_CODEC_VERSION_V1, value: resultValue,
    semanticSizeBytes: frozen.successfulResult.semanticSizeBytes, sha256Hex: frozen.successfulResult.evidence.sha256Hex,
    canonicalBytes: CanonicalSuccessfulResultBytesV1Schema.make(copyBytes(frozen.successfulResult.canonicalBytes)) });
  return Object.freeze({ authorityPins, session, executionClaim, scopeUuid: scope.scopeUuid, frozen,
    dependencies, rowIntents, sources: Object.freeze(sources), events: Object.freeze(events),
    attemptedTableIds: Object.freeze([...applicationTables]),
    participantMaterialDocumentIds: new Set(rowIntents.filter(row => nativeTables.has(row.tableId)).map(row => row.documentId)),
    indexRangeDependencies: frozen.applicationIndexRanges, relationDependencies: frozen.applicationRelationDependencies,
    successfulResult }) satisfies PreparedFiniteCommitCommand;
});

/** Application and selected native sources may have different logical schema
 * revisions. Gather their trusted definitions before taking publication locks;
 * the locked kernel revalidates every participant binding and definition. */
const preparePointCommitMixedDefinitions = Effect.fn("PointCommitTransaction.prepareMixedDefinitions")(
  function* (command: PreparedPointCommitTransactionCommandV1, options: PointCommitTransactionProofOptionsV1) {
    const applicationRows = command.rowIntents.filter(row => !command.participantMaterialDocumentIds.has(row.documentId));
    const applicationCommand = Object.freeze({ ...command, rowIntents: applicationRows });
    const applicationIndexes = yield* prepareDeveloperIndexDefinitions(applicationCommand, options);
    const applicationUnique = yield* prepareUniqueConstraintDefinitions(applicationCommand, options);
    const indexes = new Map(applicationIndexes.map(definition => [definition.indexDefinitionId, definition] as const));
    const unique = new Map(applicationUnique.map(definition => [definition.uniqueConstraintDefinitionId, definition] as const));
    const sourceSchemaVersionByTable = new Map<CatalogTableId, CatalogSchemaVersionId>();
    for (const operation of command.participantOperations) {
      const selectedProfile = yield* Effect.fromResult(selectLogicalOperationProfileResult(options, operation));
      for (const [ordinal, contribution] of operation.sourceContributions.entries()) {
      const selected = inspectLogicalParticipantCommitAuthority(
        selectedProfile.authorities[ordinal]!, operation, contribution);
      if (selected === null) return yield* Effect.fail(corruption("commandInvalid"));
      const touched = new Set(contribution.effects.map(effect => effect.tableId));
      for (const tableId of touched) {
        const prior = sourceSchemaVersionByTable.get(tableId);
        if (prior !== undefined && prior !== selected.schemaVersionId) return yield* Effect.fail(corruption("commandInvalid"));
        sourceSchemaVersionByTable.set(tableId, selected.schemaVersionId);
      }
      for (const definition of selected.indexes) {
        if (definition.access.kind !== "developer" || !touched.has(definition.access.tableId)) continue;
        const prior = indexes.get(definition.indexDefinitionId);
        if (prior !== undefined && (prior.access.tableId !== definition.access.tableId ||
          prior.physicalSpecSha256Hex !== definition.physicalSpecSha256Hex))
          return yield* Effect.fail(corruption("developerIndexBuildInvalid"));
        indexes.set(definition.indexDefinitionId, definition);
      }
      for (const definition of selected.unique) {
        if (!touched.has(definition.tableId)) continue;
        const prior = unique.get(definition.uniqueConstraintDefinitionId);
        if (prior !== undefined && (prior.tableId !== definition.tableId ||
          prior.schemaVersionId !== definition.schemaVersionId ||
          prior.physicalSpecSha256Hex !== definition.physicalSpecSha256Hex))
          return yield* Effect.fail(corruption("uniqueConstraintDefinitionInvalid"));
        unique.set(definition.uniqueConstraintDefinitionId, definition);
      }
      }
    }
    const developerDefinitions = Object.freeze([...indexes.values()].toSorted((a, b) => a.indexDefinitionId - b.indexDefinitionId));
    const uniqueDefinitions = Object.freeze([...unique.values()].toSorted((a, b) =>
      a.uniqueConstraintDefinitionId - b.uniqueConstraintDefinitionId));
    if (uniqueDefinitions.length > MAX_POINT_COMMIT_UNIQUE_KEY_TRANSITIONS_V1)
      return yield* Effect.fail(corruption("uniqueConstraintDefinitionInvalid"));
    yield* Effect.fromResult(validateApplicationUniqueTransitionBudget(command.rowIntents, uniqueDefinitions));
    return Object.freeze({ developerDefinitions, uniqueDefinitions, sourceSchemaVersionByTable });
  });

const preparePointCommitPublicationCommand = Effect.fn(
  "PointCommitTransaction.preparePublicationCommand",
)(function* (
  input: PointCommitPublicationCommandV1,
): Effect.fn.Return<
  PreparedPointCommitPublicationCommandV1,
  PointCommitCorruptionV1Error | PointCommitStaleAuthorityV1Error
> {
  const command = yield* preparePointCommitCommand(input);
  const successfulResult = yield* Effect.fromResult(
    captureSuccessfulResultResult(
      input.successfulResult,
      command.sealIdentity.resultByteLength,
    ),
  );
  const canonical = yield* canonicalizeSuccessfulResultV1Effect(
    successfulResult.value,
  ).pipe(
    Effect.mapError(() => corruption("successfulResultInvalid")),
  );
  const seal = command.sealIdentity;
  if (
    successfulResult.valueCodecVersion !== FLAREX_VALUE_CODEC_VERSION_V1 ||
    canonical.evidence.valueCodecVersion !==
      successfulResult.valueCodecVersion ||
    !bytesEqual(canonical.canonicalBytes, successfulResult.canonicalBytes) ||
    canonical.semanticSizeBytes !== successfulResult.semanticSizeBytes ||
    canonical.evidence.sha256Hex !== successfulResult.sha256Hex ||
    canonical.canonicalBytes.byteLength !== seal.resultByteLength ||
    canonical.semanticSizeBytes !== seal.resultSemanticBytes ||
    canonical.evidence.sha256Hex !==
      encodeBytesToLowercaseHex(seal.resultSha256)
  ) {
    return yield* Effect.fail(corruption("successfulResultInvalid"));
  }
  const stableBytes = copyBytes(canonical.canonicalBytes);
  return Object.freeze({
    ...command,
    successfulResult: Object.freeze({
      valueCodecVersion: FLAREX_VALUE_CODEC_VERSION_V1,
      value: successfulResult.value,
      canonicalBytes: CanonicalSuccessfulResultBytesV1Schema.make(stableBytes),
      semanticSizeBytes: canonical.semanticSizeBytes,
      sha256Hex: canonical.evidence.sha256Hex,
    }),
  });
});

function captureSuccessfulResultResult(
  input: PointCommitSuccessfulResultV1,
  expectedByteLength: number,
): Result.Result<
  Readonly<PointCommitSuccessfulResultV1>,
  PointCommitCorruptionV1Error
> {
  return Result.gen(function* () {
    const canonicalBytes = yield* Result.try({
      try: () => input.canonicalBytes,
      catch: () => corruption("successfulResultInvalid"),
    });
    if (
      !isNonArrayRecord(input) ||
      !isUint8ArrayWithByteLength(canonicalBytes, expectedByteLength)
    ) {
      return yield* Result.fail(corruption("successfulResultInvalid"));
    }
    const stableBytes = copyBytes(canonicalBytes);
    const stableValue = yield* Result.try({
      try: () => structuredClone(input.value),
      catch: () => corruption("successfulResultInvalid"),
    });
    const scalars = yield* Result.try({
      try: () => Object.freeze({
        valueCodecVersion: input.valueCodecVersion,
        semanticSizeBytes: input.semanticSizeBytes,
        sha256Hex: input.sha256Hex,
      }),
      catch: () => corruption("successfulResultInvalid"),
    });
    if (
      scalars.valueCodecVersion !== FLAREX_VALUE_CODEC_VERSION_V1 ||
      stableBytes.byteLength < 1 ||
      !isNonNegativeSafeInteger(scalars.semanticSizeBytes) ||
      typeof scalars.sha256Hex !== "string" ||
      !/^[0-9a-f]{64}$/.test(scalars.sha256Hex)
    ) {
      return yield* Result.fail(corruption("successfulResultInvalid"));
    }
    return Object.freeze({
      valueCodecVersion: scalars.valueCodecVersion,
      value: stableValue,
      get canonicalBytes(): PointCommitSuccessfulResultV1["canonicalBytes"] {
        return CanonicalSuccessfulResultBytesV1Schema.make(
          copyBytes(stableBytes),
        );
      },
      semanticSizeBytes: scalars.semanticSizeBytes,
      sha256Hex: scalars.sha256Hex,
    });
  });
}

function captureCommittedOutcomeLookup(
  command: PreparedPointCommitAuthorityCommandV1,
): ResolveCommittedPointOutcomeInputV1 {
  return Object.freeze({
    scopeUuid: pointCommitCommandScopeUuid(command),
    requestKey: command.authorityPins.requestKey,
    expectedIdentityAccessPolicySha256:
      TransactionIdentityAccessPolicySha256V1Schema.make(copyBytes(
        command.session.identityAccessPolicySha256,
      )),
    expectedFunctionPath: command.authorityPins.functionPath,
    expectedRequestSha256: TransactionRequestSha256V1Schema.make(copyBytes(
      command.session.requestSha256,
    )),
  });
}

function capturePointCommitCommandResult(
  input: PointCommitTransactionCommandV1,
): Result.Result<
  PointCommitTransactionCommandV1,
  PointCommitCorruptionV1Error | PointCommitStaleAuthorityV1Error
> {
  if (
    input.session.lifecycle !== "finishing" ||
    input.sealIdentity.lifecycle !== "finishing"
  ) {
    return Result.fail(stale("lifecycleChanged"));
  }
  return Result.gen(function* () {
    const authorityPins = yield* captureAuthorityPinsResult(
      input.authorityPins,
    );
    const session = yield* captureSessionScalarsResult(input.session);
    const sealIdentity = yield* captureSealIdentityResult(input.sealIdentity);
    yield* requireCommandAuthorityConsistencyResult(
      authorityPins,
      session,
      sealIdentity,
    );
    const dependencies = yield* capturePointCommitDependenciesResult(
      input.dependencies,
      sealIdentity.pointDependencyCount,
    );
    const indexRangeDependencies = yield* capturePointCommitIndexRangeDependenciesResult(
      input.indexRangeDependencies,
      sealIdentity.indexRangeDependencyCount,
      sealIdentity.indexRangeDependencyEvidenceBytes,
    );
    const relationDependencies = yield*
      capturePointCommitRelationDependenciesResult(
        input.relationDependencies,
        sealIdentity.relationDependencyCount,
        authorityPins.snapshotToken.commitSeq,
      );
    const rowIntents = yield* captureRowIntentsResult(input.rowIntents);
    const journalBytes = input.journalBytes === undefined ? undefined : yield* decodePointCommitJournalBytesResult(input.journalBytes).pipe(
      Result.map(copyBytes), Result.mapError(() => corruption("commandInvalid")));
    for (const rowIntent of rowIntents) {
      if (!dependencies.some(
        (dependency) => pointDependenciesEqual(dependency, rowIntent),
      )) {
        return yield* Result.fail(corruption("commandInvalid"));
      }
    }
    return Object.freeze({
      authorityPins,
      session,
      sealIdentity,
      dependencies,
      indexRangeDependencies,
      relationDependencies,
      rowIntents,
      ...(journalBytes === undefined ? {} : { journalBytes }),
      ...(input.candidatePlanningHead === undefined ? {} : { candidatePlanningHead: input.candidatePlanningHead }),
    });
  });
}

function capturePointMutationAttemptReplacementCommandResult(
  input: PointMutationAttemptReplacementCommandV1,
): Result.Result<
  PreparedPointMutationAttemptReplacementCommandV1,
  PointCommitCorruptionV1Error | PointCommitStaleAuthorityV1Error
> {
  if (
    input.session.lifecycle !== "finishing" ||
    input.sealIdentity.lifecycle !== "finishing"
  ) {
    return Result.fail(stale("lifecycleChanged"));
  }
  return Result.gen(function* () {
    const authorityPins = yield* captureAuthorityPinsResult(
      input.authorityPins,
    );
    const session = yield* captureSessionScalarsResult(input.session);
    const sealIdentity = yield* captureSealIdentityResult(input.sealIdentity);
    yield* requireCommandAuthorityConsistencyResult(
      authorityPins,
      session,
      sealIdentity,
    );
    const dependencies = yield* capturePointCommitDependenciesResult(
      input.dependencies,
      sealIdentity.pointDependencyCount,
    );
    const indexRangeDependencies = yield* capturePointCommitIndexRangeDependenciesResult(
      input.indexRangeDependencies,
      sealIdentity.indexRangeDependencyCount,
      sealIdentity.indexRangeDependencyEvidenceBytes,
    );
    const relationDependencies = yield*
      capturePointCommitRelationDependenciesResult(
        input.relationDependencies,
        sealIdentity.relationDependencyCount,
        authorityPins.snapshotToken.commitSeq,
      );
    const expectedConflict = yield* capturePointCommitConflictEvidenceResult(
      input.expectedConflict,
      authorityPins.snapshotToken.commitSeq,
      dependencies,
      indexRangeDependencies,
      relationDependencies,
    );
    return Object.freeze({
      authorityPins,
      session,
      sealIdentity,
      dependencies,
      indexRangeDependencies,
      relationDependencies,
      expectedConflict,
    });
  });
}

function captureRunningRelationConflictAttemptReplacementCommandResult(
  input: RunningRelationConflictAttemptReplacementCommandV1,
): Result.Result<
  PreparedRunningRelationConflictAttemptReplacementCommandV1,
  PointCommitCorruptionV1Error | PointCommitStaleAuthorityV1Error
> {
  return Result.gen(function* () {
    const base = yield* captureRunningRelationConflictRecoveryCommandResult(
      input,
    );
    const requestInput = yield* Result.try({
      try: () => structuredClone(input.request),
      catch: () => corruption("commandInvalid"),
    });
    const request = yield* decodeRunningRelationConflictRequestV1Result(
      requestInput,
    ).pipe(Result.mapError(() => corruption("commandInvalid")));
    if (
      request.limit < 1 ||
      request.limit > RELATION_INCOMING_PAGE_MAXIMUM_IDENTITIES_V1
    ) {
      return yield* Result.fail(corruption("commandInvalid"));
    }
    const conflict = yield* Result.try({
      try: () => structuredClone(input.conflict),
      catch: () => corruption("commandInvalid"),
    });
    if (
      !isNonArrayRecord(conflict) ||
      conflict.kind !== "relationConflict"
    ) {
      return yield* Result.fail(corruption("commandInvalid"));
    }
    const edgeDefinitionId = yield* decodePointCommitEdgeDefinitionIdResult(conflict.edgeDefinitionId).pipe(
      Result.mapError(() => corruption("commandInvalid")),
    );
    const targetRowId = yield* decodePointCommitEncodedRowIdResult(conflict.targetRowId).pipe(
      Result.mapError(() => corruption("commandInvalid")),
    );
    const expectedAdjacencyVersion = yield* decodePointCommitSeqResult(
      conflict.expectedAdjacencyVersion,
    ).pipe(Result.mapError(() => corruption("commandInvalid")));
    const actualAdjacencyVersion = yield* decodePointCommitSeqResult(
      conflict.actualAdjacencyVersion,
    ).pipe(Result.mapError(() => corruption("commandInvalid")));
    const snapshotCommitSeq = yield* decodePointCommitSeqResult(
      conflict.snapshotCommitSeq,
    ).pipe(Result.mapError(() => corruption("commandInvalid")));
    if (
      snapshotCommitSeq !== base.authorityPins.snapshotToken.commitSeq ||
      expectedAdjacencyVersion > snapshotCommitSeq ||
      actualAdjacencyVersion <= snapshotCommitSeq ||
      request.edgeDefinitionId !== edgeDefinitionId ||
      request.targetRowId !== targetRowId
    ) {
      return yield* Result.fail(corruption("commandInvalid"));
    }
    return Object.freeze({
      ...base,
      request: Object.freeze({ ...request }),
      conflict: Object.freeze({
        kind: "relationConflict" as const,
        edgeDefinitionId,
        targetRowId,
        expectedAdjacencyVersion,
        actualAdjacencyVersion,
        snapshotCommitSeq,
      }),
    });
  });
}

function captureRunningRelationConflictRecoveryCommandResult(
  input: RunningRelationConflictRecoveryCommand,
): Result.Result<
  PreparedRunningRelationConflictRecoveryCommand,
  PointCommitCorruptionV1Error | PointCommitStaleAuthorityV1Error
> {
  if (input.session.lifecycle !== "running") {
    return Result.fail(stale("lifecycleChanged"));
  }
  return Result.gen(function* () {
    const authorityPins = yield* captureAuthorityPinsResult(
      input.authorityPins,
    );
    const session = yield* captureSessionScalarsResult(input.session);
    const scopeUuid = (yield* projectScopeIdUuidV1Result(
      authorityPins.scopeId,
    ).pipe(Result.mapError(() => corruption("commandInvalid")))).scopeUuid;
    if (
      authorityPins.storageGeneration !== session.storageGeneration ||
      authorityPins.storageGenerationFence !== session.storageGenerationFence ||
      !commandExecutionAuthorityConsistent(authorityPins, session) ||
      authorityPins.functionPath !== session.functionPath ||
      authorityPins.functionKind !== session.functionKind ||
      authorityPins.schemaVersionId !== session.schemaVersionId ||
      authorityPins.policyVersion !== session.policyVersion ||
      authorityPins.authorizationRevocationEpoch !==
        session.authorizationRevocationEpoch ||
      authorityPins.requestKey !== session.requestKey
    ) {
      return yield* Result.fail(corruption("commandInvalid"));
    }
    const claimOwner = yield* decodeTransactionExecutionClaimOwnerV1(
      input.executionClaim.claimOwner,
    ).pipe(Result.mapError(() => corruption("commandInvalid")));
    const claimFence = yield* decodeTransactionExecutionClaimFenceV1(
      input.executionClaim.claimFence,
    ).pipe(Result.mapError(() => corruption("commandInvalid")));
    return Object.freeze({
      authorityPins,
      session: Object.freeze({ ...session, lifecycle: "running" as const }),
      scopeUuid,
      executionClaim: Object.freeze({ claimOwner, claimFence }),
    });
  });
}

function capturePointCommitIndexRangeDependenciesResult(
  input: ReadonlyArray<LogicalIndexRangeReadDependencyV1>,
  expectedCount: number,
  expectedEvidenceBytes: number,
): Result.Result<
  ReadonlyArray<LogicalIndexRangeReadDependencyV1>,
  PointCommitCorruptionV1Error
> {
  if (
    !Array.isArray(input) ||
    input.length !== expectedCount ||
    input.length > MAX_COMMIT_INDEX_RANGE_READ_DEPENDENCIES_V1
  ) {
    return Result.fail(corruption("commandInvalid"));
  }
  return Result.gen(function* () {
    const captured: LogicalIndexRangeReadDependencyV1[] = [];
    let evidenceBytes = 0;
    for (let index = 0; index < input.length; index += 1) {
      if (!Object.hasOwn(input, index)) {
        return yield* Result.fail(corruption("commandInvalid"));
      }
      const dependency = yield* decodePointCommitIndexRangeDependencyResult(input[index]).pipe(Result.mapError(() => corruption("commandInvalid")));
      captured.push(dependency);
      evidenceBytes += yield* measureLogicalIndexRangeReadDependencyEvidenceBytesV1Result(
        dependency,
      ).pipe(Result.mapError(() => corruption("commandInvalid")));
    }
    if (
      evidenceBytes !== expectedEvidenceBytes ||
      evidenceBytes > MAX_COMMIT_INDEX_RANGE_DEPENDENCY_EVIDENCE_BYTES_V1
    ) {
      return yield* Result.fail(corruption("commandInvalid"));
    }
    const normalized = yield* normalizeLogicalIndexRangeReadDependenciesV1Result(
      captured,
    ).pipe(Result.mapError(() => corruption("commandInvalid")));
    if (
      normalized.length !== captured.length ||
      normalized.some((dependency, index) =>
        !indexRangeDependenciesEqual(dependency, captured[index])
      )
    ) {
      return yield* Result.fail(corruption("commandInvalid"));
    }
    return normalized;
  });
}

function indexRangeDependenciesEqual(
  left: LogicalIndexRangeReadDependencyV1,
  right: LogicalIndexRangeReadDependencyV1 | undefined,
): boolean {
  return right !== undefined &&
    left.tableId === right.tableId &&
    left.indexDefinitionId === right.indexDefinitionId &&
    left.keyCodecVersion === right.keyCodecVersion &&
    left.physicalSpecSha256Hex === right.physicalSpecSha256Hex &&
    left.direction === right.direction &&
    indexRangeLowerBoundsEqual(left.lower, right.lower) &&
    indexRangeUpperBoundsEqual(left.upper, right.upper);
}

function capturePointCommitRelationDependenciesResult(
  input: ReadonlyArray<LogicalApplicationRelationIncomingReadDependencyV1>,
  expectedCount: number,
  snapshotCommitSeq: CommitSeq,
): Result.Result<
  ReadonlyArray<LogicalApplicationRelationIncomingReadDependencyV1>,
  PointCommitCorruptionV1Error
> {
  if (
    !Array.isArray(input) ||
    input.length !== expectedCount ||
    input.length > MAX_COMMIT_RELATION_READ_DEPENDENCIES_V1
  ) {
    return Result.fail(corruption("commandInvalid"));
  }
  return Result.gen(function* () {
    const captured: LogicalApplicationRelationIncomingReadDependencyV1[] = [];
    let activeSelection:
      | Pick<
          LogicalApplicationRelationIncomingReadDependencyV1,
          "activationSequence" | "activeHeadSha256Hex"
        >
      | undefined;
    for (let index = 0; index < input.length; index += 1) {
      if (!Object.hasOwn(input, index)) {
        return yield* Result.fail(corruption("commandInvalid"));
      }
      const dependency = yield* decodePointCommitRelationDependencyResult(input[index]).pipe(Result.mapError(() => corruption("commandInvalid")));
      const previous = captured.at(-1);
      if (
        dependency.observedAdjacencyVersion > snapshotCommitSeq ||
        (activeSelection !== undefined &&
          (dependency.activationSequence !==
              activeSelection.activationSequence ||
            dependency.activeHeadSha256Hex !==
              activeSelection.activeHeadSha256Hex)) ||
        (previous !== undefined &&
          comparePointCommitRelationDependencies(previous, dependency) >= 0)
      ) {
        return yield* Result.fail(corruption("commandInvalid"));
      }
      activeSelection ??= dependency;
      captured.push(dependency);
    }
    return Object.freeze(captured);
  });
}

function comparePointCommitRelationDependencies(
  left: LogicalApplicationRelationIncomingReadDependencyV1,
  right: LogicalApplicationRelationIncomingReadDependencyV1,
): number {
  if (left.edgeDefinitionId !== right.edgeDefinitionId) {
    return left.edgeDefinitionId - right.edgeDefinitionId;
  }
  return left.targetRowId < right.targetRowId
    ? -1
    : left.targetRowId > right.targetRowId
      ? 1
      : 0;
}

function indexRangeLowerBoundsEqual(
  left: LogicalIndexRangeReadDependencyV1["lower"],
  right: LogicalIndexRangeReadDependencyV1["lower"],
): boolean {
  return left === null
    ? right === null
    : right !== null && left.encodedKey === right.encodedKey;
}

function indexRangeUpperBoundsEqual(
  left: LogicalIndexRangeReadDependencyV1["upper"],
  right: LogicalIndexRangeReadDependencyV1["upper"],
): boolean {
  if (left === null) return right === null;
  if (right === null || left.kind !== right.kind) return false;
  if (left.encodedKey !== right.encodedKey) return false;
  return left.kind === "key" ||
    (right.kind === "position" && left.rowId === right.rowId);
}

function capturePointCommitConflictEvidenceResult(
  input: PointCommitConflictEvidenceV1,
  expectedSnapshotCommitSeq: CommitSeq,
  pointDependencies: ReadonlyArray<PointCommitDependencyV1>,
  indexRangeDependencies: ReadonlyArray<LogicalIndexRangeReadDependencyV1>,
  relationDependencies: ReadonlyArray<
    LogicalApplicationRelationIncomingReadDependencyV1
  >,
): Result.Result<PointCommitConflictEvidenceV1, PointCommitCorruptionV1Error> {
  return Result.gen(function* () {
    const captured = yield* Result.try({
      try: () => structuredClone(input),
      catch: () => corruption("commandInvalid"),
    });
    if (
      !isNonArrayRecord(captured) ||
      captured.snapshotCommitSeq !== expectedSnapshotCommitSeq ||
      !isNonArrayRecord(captured.conflict)
    ) {
      return yield* Result.fail(corruption("commandInvalid"));
    }
    const cause = captured.conflict;
    const currentCommitSeq = yield* decodePointCommitSeqResult(
      captured.currentCommitSeq,
    ).pipe(Result.mapError(() => corruption("commandInvalid")));
    if (currentCommitSeq < expectedSnapshotCommitSeq || currentCommitSeq === expectedSnapshotCommitSeq && cause.kind !== "metadata") {
      return yield* Result.fail(corruption("commandInvalid"));
    }
    if (cause.kind === "appRowPoint") {
      const identity = yield* decodeAppDocumentIdentityV1Result(
        cause.documentId,
      ).pipe(Result.mapError(() => corruption("commandInvalid")));
      if (!pointDependencies.some((dependency) =>
        dependency.documentId === identity.id
      )) {
        return yield* Result.fail(corruption("commandInvalid"));
      }
      return Object.freeze({
        conflict: Object.freeze({
          kind: "appRowPoint",
          documentId: identity.id,
        }),
        snapshotCommitSeq: expectedSnapshotCommitSeq,
        currentCommitSeq,
      });
    }
    if (cause.kind === "appRelationIncoming") {
      const edgeDefinitionId = yield* decodePointCommitEdgeDefinitionIdResult(cause.edgeDefinitionId).pipe(
        Result.mapError(() => corruption("commandInvalid")),
      );
      const targetRowId = yield* decodePointCommitRowIdResult(
        cause.targetRowId,
      ).pipe(Result.mapError(() => corruption("commandInvalid")));
      if (!relationDependencies.some((dependency) =>
        dependency.edgeDefinitionId === edgeDefinitionId &&
        dependency.targetRowId === targetRowId
      )) {
        return yield* Result.fail(corruption("commandInvalid"));
      }
      return Object.freeze({
        conflict: Object.freeze({
          kind: "appRelationIncoming",
          edgeDefinitionId,
          targetRowId,
        }),
        snapshotCommitSeq: expectedSnapshotCommitSeq,
        currentCommitSeq,
      });
    }
    if (cause.kind === "logicalParticipant") {
      const syscallSequence = yield* decodePointCommitSyscallSequenceResult(cause.syscallSequence).pipe(Result.mapError(() => corruption("commandInvalid")));
      if (typeof cause.participant !== "string" || cause.participant.length === 0)
        return yield* Result.fail(corruption("commandInvalid"));
      return Object.freeze({ conflict: Object.freeze({ kind: "logicalParticipant", participant: cause.participant,
        syscallSequence }), snapshotCommitSeq: expectedSnapshotCommitSeq, currentCommitSeq });
    }
    if (cause.kind === "metadata") {
      const witness = yield* decodePointCommitMetadataConflictResult(cause)
        .pipe(Result.mapError(() => corruption("commandInvalid")));
      return Object.freeze({ conflict: Object.freeze(witness),
        snapshotCommitSeq: expectedSnapshotCommitSeq, currentCommitSeq });
    }
    if (
      cause.kind !== "appIndexRange" ||
      (cause.reason !== "overlap" &&
        cause.reason !== "validationWindowExceeded") ||
      !isNonNegativeSafeInteger(cause.dependencyOrdinal) ||
      (cause.reason === "overlap" &&
        (typeof cause.encodedKey !== "string" || typeof cause.rowId !== "string"))
    ) {
      return yield* Result.fail(corruption("commandInvalid"));
    }
    const tableId = yield* decodePointCommitEncodedTableIdResult(
      cause.tableId,
    ).pipe(Result.mapError(() => corruption("commandInvalid")));
    const indexDefinitionId = yield* decodePointCommitIndexDefinitionIdResult(cause.indexDefinitionId).pipe(
      Result.mapError(() => corruption("commandInvalid")),
    );
    const dependency = indexRangeDependencies[cause.dependencyOrdinal];
    if (
      dependency === undefined ||
      dependency.tableId !== tableId ||
      dependency.indexDefinitionId !== indexDefinitionId
    ) {
      return yield* Result.fail(corruption("commandInvalid"));
    }
    const overlap = cause.reason === "overlap"
      ? Result.all({
          encodedKey: decodePointCommitOrderedKeyResult(cause.encodedKey),
          rowId: decodePointCommitOrderedRowIdResult(cause.rowId),
        }).pipe(Result.mapError(() => corruption("commandInvalid")))
      : Result.succeed(undefined);
    const overlapEvidence = yield* overlap;
    return Object.freeze({
      conflict: Object.freeze({
        kind: "appIndexRange",
        reason: cause.reason,
        dependencyOrdinal: cause.dependencyOrdinal,
        tableId,
        indexDefinitionId,
        ...(overlapEvidence === undefined
          ? {}
          : overlapEvidence),
      }),
      snapshotCommitSeq: expectedSnapshotCommitSeq,
      currentCommitSeq,
    });
  });
}

function capturePointCommitDependenciesResult(
  input: ReadonlyArray<PointCommitDependencyV1>,
  expectedCount: number,
): Result.Result<
  ReadonlyArray<PointCommitDependencyV1>,
  PointCommitCorruptionV1Error
> {
  if (!Array.isArray(input)) {
    return Result.fail(corruption("commandInvalid"));
  }
  const dependencyCount = input.length;
  if (
    dependencyCount > MAX_COMMIT_POINT_READ_DEPENDENCIES_V1 ||
    dependencyCount !== expectedCount
  ) {
    return Result.fail(corruption("commandInvalid"));
  }
  return Result.gen(function* () {
    const captured: PointCommitDependencyV1[] = [];
    for (let index = 0; index < dependencyCount; index += 1) {
      if (!Object.hasOwn(input, index)) {
        return yield* Result.fail(corruption("commandInvalid"));
      }
      const dependency = input[index];
      if (dependency === undefined) {
        return yield* Result.fail(corruption("commandInvalid"));
      }
      captured.push(yield* capturePointDependencyResult(dependency));
    }
    if (captured.length !== expectedCount) {
      return yield* Result.fail(corruption("commandInvalid"));
    }
    const dependencies = Object.freeze(captured);
    yield* requireCanonicalDependencyOrderResult(dependencies);
    return dependencies;
  });
}

function capturePointCommitFinishingTransitionCommandResult(
  input: PointCommitFinishingTransitionCommandV1,
): Result.Result<
  PreparedPointCommitFinishingTransitionCommandV1,
  PointCommitCorruptionV1Error | PointCommitStaleAuthorityV1Error
> {
  if (
    input.session.lifecycle !== "running" ||
    input.sealIdentity.lifecycle !== "running"
  ) {
    return Result.fail(stale("lifecycleChanged"));
  }
  return Result.gen(function* () {
    const authorityPins = yield* captureAuthorityPinsResult(
      input.authorityPins,
    );
    const session = yield* captureSessionScalarsResult(input.session);
    const sealIdentity = yield* captureSealIdentityResult(input.sealIdentity);
    const executionClaim = yield* captureExecutionClaimPinResult(
      input.executionClaim,
    );
    yield* requireCommandAuthorityConsistencyResult(
      authorityPins,
      session,
      sealIdentity,
    );
    return Object.freeze({
      authorityPins,
      session: Object.freeze({ ...session, lifecycle: "running" as const }),
      sealIdentity: Object.freeze({
        ...sealIdentity,
        lifecycle: "running" as const,
      }),
      executionClaim,
    });
  });
}

function captureExecutionClaimPinResult(
  input: TransactionExecutionClaimPinV1,
): Result.Result<TransactionExecutionClaimPinV1, PointCommitCorruptionV1Error> {
  return Result.gen(function* () {
    const fields = yield* Result.try({
      try: () => Object.freeze({
        owner: input.claimOwner,
        fence: input.claimFence,
      }),
      catch: () => corruption("commandInvalid"),
    });
    const owner = yield* decodeTransactionExecutionClaimOwnerV1(
      fields.owner,
    ).pipe(Result.mapError(() => corruption("commandInvalid")));
    const fence = yield* decodeTransactionExecutionClaimFenceV1(
      fields.fence,
    ).pipe(Result.mapError(() => corruption("commandInvalid")));
    return Object.freeze({
      claimOwner: owner,
      claimFence: fence,
    });
  });
}

function captureAuthorityPinsResult(
  input: PointCommitAuthorityPinsV1,
): Result.Result<
  Readonly<PointCommitAuthorityPinsV1>,
  PointCommitCorruptionV1Error
> {
  if (
    input.storageGeneration !== "flarexdb_v1" ||
    input.storageGenerationFence < 1n ||
    input.snapshotToken.scopeId !== input.scopeId ||
    input.snapshotToken.commitSeq < 0n ||
    input.functionKind !== "mutation"
  ) {
    return Result.fail(corruption("commandInvalid"));
  }
  if (input.executionAuthorityGeneration === "legacy_dynamic_worker_v1") {
    if (hasOwn(input, "applicationExecutionAuthoritySha256")) {
      return Result.fail(corruption("commandInvalid"));
    }
    return Result.succeed(Object.freeze({
      executionAuthorityGeneration: "legacy_dynamic_worker_v1",
      deploymentId: input.deploymentId,
      scopeId: input.scopeId,
      sessionId: input.sessionId,
      attemptFence: input.attemptFence,
      storageGeneration: input.storageGeneration,
      storageGenerationFence: input.storageGenerationFence,
      snapshotToken: Object.freeze({ ...input.snapshotToken }),
      schemaVersionId: input.schemaVersionId,
      packageId: input.packageId,
      artifactRuntime: input.artifactRuntime,
      artifactId: input.artifactId,
      sourcePackageHash: input.sourcePackageHash,
      executionModule: input.executionModule,
      functionPath: input.functionPath,
      functionKind: input.functionKind,
      policyVersion: input.policyVersion,
      authorizationRevocationEpoch: input.authorizationRevocationEpoch,
      requestKey: input.requestKey,
    }));
  }
  if (
    input.executionAuthorityGeneration !== "application_v1" ||
    hasAnyOwn(input, LEGACY_EXECUTION_AUTHORITY_FIELDS) ||
    !validHash(input.applicationExecutionAuthoritySha256)
  ) {
    return Result.fail(corruption("commandInvalid"));
  }
  return Result.succeed(Object.freeze({
    executionAuthorityGeneration: "application_v1",
    deploymentId: input.deploymentId,
    scopeId: input.scopeId,
    sessionId: input.sessionId,
    attemptFence: input.attemptFence,
    storageGeneration: input.storageGeneration,
    storageGenerationFence: input.storageGenerationFence,
    snapshotToken: Object.freeze({ ...input.snapshotToken }),
    schemaVersionId: input.schemaVersionId,
    applicationExecutionAuthoritySha256: new Uint8Array(
      input.applicationExecutionAuthoritySha256,
    ),
    functionPath: input.functionPath,
    functionKind: input.functionKind,
    policyVersion: input.policyVersion,
    authorizationRevocationEpoch: input.authorizationRevocationEpoch,
    requestKey: input.requestKey,
  }) satisfies Readonly<PointCommitAuthorityPinsV1>);
}

function captureSessionScalarsResult(
  input: PointCommitSessionScalarsV1,
): Result.Result<
  Readonly<PointCommitSessionScalarsV1>,
  PointCommitCorruptionV1Error
> {
  if (
    input.storageGeneration !== "flarexdb_v1" ||
    input.storageGenerationFence < 1n ||
    input.validatedArgsValueCodecVersion !== FLAREX_VALUE_CODEC_VERSION_V1 ||
    input.authorizationGrantValueCodecVersion !==
      FLAREX_VALUE_CODEC_VERSION_V1 ||
    input.protocolVersion !== TRANSACTION_SESSION_PROTOCOL_VERSION_V1 ||
    !isPositiveSafeInteger(input.validatedArgsCanonicalByteLength) ||
    !isPositiveSafeInteger(input.authorizationGrantCanonicalByteLength) ||
    !validHash(input.identityAccessPolicySha256) ||
    !validHash(input.validatedArgsSha256) ||
    !validHash(input.authorizationGrantSha256) ||
    !validHash(input.requestSha256) ||
    !validEpochMilliseconds(input.authorizationGrantExpiresAtMilliseconds) ||
    !validEpochMilliseconds(input.hardExpiresAtMilliseconds) ||
    !validEpochMilliseconds(input.createdAtMilliseconds) ||
    !validEpochMilliseconds(input.updatedAtMilliseconds) ||
    input.updatedAtMilliseconds < input.createdAtMilliseconds ||
    input.hardExpiresAtMilliseconds >
      input.authorizationGrantExpiresAtMilliseconds
  ) {
    return Result.fail(corruption("commandInvalid"));
  }
  if (input.executionAuthorityGeneration === "legacy_dynamic_worker_v1") {
    if (hasAnyOwn(input, APPLICATION_EXECUTION_AUTHORITY_FIELDS)) {
      return Result.fail(corruption("commandInvalid"));
    }
    return Result.succeed(Object.freeze({
      executionAuthorityGeneration: "legacy_dynamic_worker_v1",
      lifecycle: input.lifecycle,
      storageGeneration: input.storageGeneration,
      storageGenerationFence: input.storageGenerationFence,
      packageId: input.packageId,
      artifactRuntime: input.artifactRuntime,
      artifactId: input.artifactId,
      sourcePackageHash: input.sourcePackageHash,
      executionModule: input.executionModule,
      functionPath: input.functionPath,
      functionKind: input.functionKind,
      schemaVersionId: input.schemaVersionId,
      policyVersion: input.policyVersion,
      identityAccessPolicySha256: new Uint8Array(input.identityAccessPolicySha256),
      validatedArgsValueCodecVersion: input.validatedArgsValueCodecVersion,
      validatedArgsCanonicalByteLength: input.validatedArgsCanonicalByteLength,
      validatedArgsSha256: new Uint8Array(input.validatedArgsSha256),
      authorizationGrantId: input.authorizationGrantId,
      authorizationGrantValueCodecVersion:
        input.authorizationGrantValueCodecVersion,
      authorizationGrantCanonicalByteLength:
        input.authorizationGrantCanonicalByteLength,
      authorizationGrantSha256: new Uint8Array(input.authorizationGrantSha256),
      authorizationRevocationEpoch: input.authorizationRevocationEpoch,
      authorizationGrantExpiresAtMilliseconds:
        input.authorizationGrantExpiresAtMilliseconds,
      requestKey: input.requestKey,
      requestSha256: new Uint8Array(input.requestSha256),
      protocolVersion: input.protocolVersion,
      hardExpiresAtMilliseconds: input.hardExpiresAtMilliseconds,
      createdAtMilliseconds: input.createdAtMilliseconds,
      updatedAtMilliseconds: input.updatedAtMilliseconds,
    }));
  }
  if (
    input.executionAuthorityGeneration !== "application_v1" ||
    hasAnyOwn(input, LEGACY_EXECUTION_AUTHORITY_FIELDS) ||
    !validHash(input.applicationExecutionAuthoritySha256) ||
    !isUint8Array(input.applicationExecutionAuthorityCanonicalBytes)
  ) return Result.fail(corruption("commandInvalid"));
  return Result.try({
    try: () => Object.freeze({
      executionAuthorityGeneration: "application_v1" as const,
      lifecycle: input.lifecycle,
      storageGeneration: input.storageGeneration,
      storageGenerationFence: input.storageGenerationFence,
      applicationExecutionAuthorityJson:
        snapshotApplicationExecutionAuthorityJson(
          input.applicationExecutionAuthorityJson,
        ),
      applicationExecutionAuthorityCanonicalBytes: new Uint8Array(
        input.applicationExecutionAuthorityCanonicalBytes,
      ),
      applicationExecutionAuthoritySha256: new Uint8Array(
        input.applicationExecutionAuthoritySha256,
      ),
      functionPath: input.functionPath,
      functionKind: input.functionKind,
      schemaVersionId: input.schemaVersionId,
      policyVersion: input.policyVersion,
      identityAccessPolicySha256: new Uint8Array(input.identityAccessPolicySha256),
      validatedArgsValueCodecVersion: input.validatedArgsValueCodecVersion,
      validatedArgsCanonicalByteLength: input.validatedArgsCanonicalByteLength,
      validatedArgsSha256: new Uint8Array(input.validatedArgsSha256),
      authorizationGrantId: input.authorizationGrantId,
      authorizationGrantValueCodecVersion:
        input.authorizationGrantValueCodecVersion,
      authorizationGrantCanonicalByteLength:
        input.authorizationGrantCanonicalByteLength,
      authorizationGrantSha256: new Uint8Array(input.authorizationGrantSha256),
      authorizationRevocationEpoch: input.authorizationRevocationEpoch,
      authorizationGrantExpiresAtMilliseconds:
        input.authorizationGrantExpiresAtMilliseconds,
      requestKey: input.requestKey,
      requestSha256: new Uint8Array(input.requestSha256),
      protocolVersion: input.protocolVersion,
      hardExpiresAtMilliseconds: input.hardExpiresAtMilliseconds,
      createdAtMilliseconds: input.createdAtMilliseconds,
      updatedAtMilliseconds: input.updatedAtMilliseconds,
    }) satisfies Readonly<PointCommitSessionScalarsV1>,
    catch: () => corruption("commandInvalid"),
  });
}

const LEGACY_EXECUTION_AUTHORITY_FIELDS = [
  "packageId",
  "artifactRuntime",
  "artifactId",
  "sourcePackageHash",
  "executionModule",
] as const;

const APPLICATION_EXECUTION_AUTHORITY_FIELDS = [
  "applicationExecutionAuthorityJson",
  "applicationExecutionAuthorityCanonicalBytes",
  "applicationExecutionAuthoritySha256",
] as const;

function hasAnyOwn<T extends object>(
  value: T,
  fields: ReadonlyArray<PropertyKey>,
): boolean {
  return fields.some(field => hasOwn(value, field));
}

function captureSealIdentityResult(
  input: PointCommitSealIdentityV1,
): Result.Result<
  Readonly<PointCommitSealIdentityV1>,
  PointCommitCorruptionV1Error
> {
  return Result.gen(function* () {
    const creationTimeSeedInput =
      yield* readPointCommitCommandFieldResult(
        () => input.creationTimeSeed,
      );
    const creationTimeSeed = yield* decodePointCommitCreationTimeResult(
      creationTimeSeedInput,
    ).pipe(Result.mapError(() => corruption("commandInvalid")));
    const nextCreationTimeInput = yield* readPointCommitCommandFieldResult(
      () => input.nextCreationTime,
    );
    const nextCreationTime = yield* decodePointCommitCreationTimeResult(
      nextCreationTimeInput,
    ).pipe(Result.mapError(() => corruption("commandInvalid")));
    if (
      input.journalFormat !== SESSION_JOURNAL_FORMAT ||
      input.journalProtocolVersion !==
        TRANSACTION_SESSION_PROTOCOL_VERSION_V1 ||
      input.journalValueCodecVersion !== FLAREX_VALUE_CODEC_VERSION_V1 ||
      input.resultValueCodecVersion !== FLAREX_VALUE_CODEC_VERSION_V1 ||
      input.finalSyscallSequence < 0n ||
      nextCreationTime < creationTimeSeed ||
      !isPositiveSafeInteger(input.journalByteLength) ||
      !isPositiveSafeInteger(input.resultByteLength) ||
      !isNonNegativeSafeInteger(input.resultSemanticBytes) ||
      !isNonNegativeSafeInteger(input.readDocuments) ||
      !isNonNegativeSafeInteger(input.readSemanticBytes) ||
      !isNonNegativeSafeInteger(input.pointDependencyCount) ||
      !isNonNegativeSafeInteger(input.indexedQuerySyscalls) ||
      !isNonNegativeSafeInteger(input.indexRangeDependencyCount) ||
      input.indexRangeDependencyCount > MAX_COMMIT_INDEX_RANGE_READ_DEPENDENCIES_V1 ||
      !isNonNegativeSafeInteger(input.indexRangeDependencyEvidenceBytes) ||
      input.indexRangeDependencyEvidenceBytes >
        MAX_COMMIT_INDEX_RANGE_DEPENDENCY_EVIDENCE_BYTES_V1 ||
      !isNonNegativeSafeInteger(input.relationReadSyscalls) ||
      input.relationReadSyscalls > MAX_COMMIT_RELATION_READ_SYSCALLS_V1 ||
      !isNonNegativeSafeInteger(input.relationDependencyCount) ||
      input.relationDependencyCount >
        MAX_COMMIT_RELATION_READ_DEPENDENCIES_V1 ||
      !isNonNegativeSafeInteger(input.relationBaseOccurrences) ||
      input.relationBaseOccurrences > MAX_COMMIT_RELATION_BASE_OCCURRENCES_V1 ||
      !isNonNegativeSafeInteger(input.writeOperations) ||
      !isNonNegativeSafeInteger(input.writeSemanticBytes) ||
      !isNonNegativeSafeInteger(input.materialWriteEventEvidenceBytes) ||
      !isNonNegativeSafeInteger(input.receiptEvidenceBytes) ||
      !isNonNegativeSafeInteger(input.participantWorkBytes) ||
      !isNonNegativeSafeInteger(input.participantWorkCalls) ||
      !validHash(input.journalSha256) ||
      !validHash(input.resultSha256) ||
      !validEpochMilliseconds(input.sessionUpdatedAtMilliseconds) ||
      !validEpochMilliseconds(input.leaseExpiresAtMilliseconds) ||
      !validEpochMilliseconds(input.rootCreatedAtMilliseconds) ||
      !validEpochMilliseconds(input.rootUpdatedAtMilliseconds) ||
      !validEpochMilliseconds(input.sealedAtMilliseconds) ||
      input.rootUpdatedAtMilliseconds < input.rootCreatedAtMilliseconds ||
      input.sealedAtMilliseconds < input.rootCreatedAtMilliseconds
    ) {
      return yield* Result.fail(corruption("commandInvalid"));
    }
    return Object.freeze({
      ...input,
      creationTimeSeed,
      nextCreationTime,
      journalSha256: new Uint8Array(input.journalSha256),
      resultSha256: new Uint8Array(input.resultSha256),
    });
  });
}

function requireCommandAuthorityConsistencyResult(
  pins: Readonly<PointCommitAuthorityPinsV1>,
  session: Readonly<PointCommitSessionScalarsV1>,
  seal: Readonly<PointCommitSealIdentityV1>,
): Result.Result<void, PointCommitCorruptionV1Error> {
  return Result.gen(function* () {
    const projectedScopeUuid = (yield* projectScopeIdUuidV1Result(
      pins.scopeId,
    ).pipe(Result.mapError(() => corruption("commandInvalid")))).scopeUuid;
    if (
      seal.scopeUuid !== projectedScopeUuid ||
      seal.sessionUpdatedAtMilliseconds !== session.updatedAtMilliseconds ||
      seal.leaseExpiresAtMilliseconds > session.hardExpiresAtMilliseconds ||
      pins.storageGeneration !== session.storageGeneration ||
      pins.storageGenerationFence !== session.storageGenerationFence ||
      !commandExecutionAuthorityConsistent(pins, session) ||
      pins.functionPath !== session.functionPath ||
      pins.functionKind !== session.functionKind ||
      pins.schemaVersionId !== session.schemaVersionId ||
      pins.policyVersion !== session.policyVersion ||
      pins.authorizationRevocationEpoch !==
        session.authorizationRevocationEpoch ||
      pins.requestKey !== session.requestKey
    ) {
      return yield* Result.fail(corruption("commandInvalid"));
    }
  });
}

function commandExecutionAuthorityConsistent(
  pins: Readonly<PointCommitAuthorityPinsV1>,
  session: Readonly<PointCommitSessionScalarsV1>,
): boolean {
  if (pins.executionAuthorityGeneration !== session.executionAuthorityGeneration) {
    return false;
  }
  if (
    pins.executionAuthorityGeneration === "legacy_dynamic_worker_v1" &&
    session.executionAuthorityGeneration === "legacy_dynamic_worker_v1"
  ) {
    return pins.packageId === session.packageId &&
      pins.artifactRuntime === session.artifactRuntime &&
      pins.artifactId === session.artifactId &&
      pins.sourcePackageHash === session.sourcePackageHash &&
      pins.executionModule === session.executionModule;
  }
  return pins.executionAuthorityGeneration === "application_v1" &&
    session.executionAuthorityGeneration === "application_v1" &&
    bytesEqual(
      pins.applicationExecutionAuthoritySha256,
      session.applicationExecutionAuthoritySha256,
    );
}

function capturePointDependencyResult(
  input: PointCommitDependencyV1,
): Result.Result<
  Readonly<PointCommitDependencyV1>,
  PointCommitCorruptionV1Error
> {
  return Result.gen(function* () {
    const tableIdInput = yield* readPointCommitCommandFieldResult(
      () => input.tableId,
    );
    const tableId = yield* decodePointCommitTableIdResult(tableIdInput).pipe(
      Result.mapError(() => corruption("commandInvalid")),
    );
    const rowIdInput = yield* readPointCommitCommandFieldResult(
      () => input.rowId,
    );
    const rowId = yield* decodePointCommitRowIdResult(rowIdInput).pipe(
      Result.mapError(() => corruption("commandInvalid")),
    );
    const documentIdInput = yield* readPointCommitCommandFieldResult(
      () => input.documentId,
    );
    const identity = yield* decodeAppDocumentIdentityV1Result(
      documentIdInput,
    ).pipe(Result.mapError(() => corruption("commandInvalid")));
    if (identity.tableId !== tableId || identity.rowId !== rowId) {
      return yield* Result.fail(corruption("commandInvalid"));
    }
    const dependencyInput = yield* readPointCommitCommandFieldResult(
      () => input.dependency,
    );
    const dependencyKind = yield* readPointCommitCommandFieldResult(
      () => dependencyInput.kind,
    );
    if (dependencyKind !== "appRowPoint") {
      return yield* Result.fail(corruption("commandInvalid"));
    }
    const dependencyDocumentId = yield* readPointCommitCommandFieldResult(
      () => dependencyInput.documentId,
    );
    if (dependencyDocumentId !== identity.id) {
      return yield* Result.fail(corruption("commandInvalid"));
    }
    const dependency = yield* captureLogicalDependencyResult(dependencyInput);
    return Object.freeze({
      documentId: identity.id,
      tableId,
      rowId,
      dependency,
    });
  });
}

const INVALID_LOGICAL_DEPENDENCY = Symbol("InvalidLogicalDependency");

function captureLogicalDependencyResult(
  input: Extract<LogicalReadDependencyV1, { readonly kind: "appRowPoint" }>,
): Result.Result<
  Extract<LogicalReadDependencyV1, { readonly kind: "appRowPoint" }>,
  PointCommitCorruptionV1Error
> {
  const captured: Result.Result<
    | Extract<LogicalReadDependencyV1, { readonly kind: "appRowPoint" }>
    | typeof INVALID_LOGICAL_DEPENDENCY,
    PointCommitCorruptionV1Error
  > = Result.try({
    try: () => {
      switch (input.observed.kind) {
        case "present":
          return Object.freeze({
            kind: "appRowPoint",
            documentId: input.documentId,
            observed: Object.freeze({
              kind: "present",
              revisionCommitSeq: input.observed.revisionCommitSeq,
            }),
          } satisfies Extract<
            LogicalReadDependencyV1,
            { readonly kind: "appRowPoint" }
          >);
        case "missing":
          switch (input.observed.basis.kind) {
            case "noVisibleRevision":
              return Object.freeze({
                kind: "appRowPoint",
                documentId: input.documentId,
                observed: Object.freeze({
                  kind: "missing",
                  basis: Object.freeze({ kind: "noVisibleRevision" }),
                }),
              } satisfies Extract<
                LogicalReadDependencyV1,
                { readonly kind: "appRowPoint" }
              >);
            case "tombstone":
              return Object.freeze({
                kind: "appRowPoint",
                documentId: input.documentId,
                observed: Object.freeze({
                  kind: "missing",
                  basis: Object.freeze({
                    kind: "tombstone",
                    revisionCommitSeq:
                      input.observed.basis.revisionCommitSeq,
                  }),
                }),
              } satisfies Extract<
                LogicalReadDependencyV1,
                { readonly kind: "appRowPoint" }
              >);
            default:
              return INVALID_LOGICAL_DEPENDENCY;
          }
        default:
          return INVALID_LOGICAL_DEPENDENCY;
      }
    },
    catch: () => corruption("commandInvalid"),
  });
  return captured.pipe(Result.flatMap((dependency) =>
    dependency === INVALID_LOGICAL_DEPENDENCY
      ? Result.fail(corruption("commandInvalid"))
      : Result.succeed(dependency)
  ));
}

function readPointCommitCommandFieldResult<Value>(
  read: () => Value,
): Result.Result<Value, PointCommitCorruptionV1Error> {
  return Result.try({
    try: read,
    catch: () => corruption("commandInvalid"),
  });
}

function captureRowIntentResult(
  input: PointCommitRowIntentV1,
): Result.Result<
  Readonly<PointCommitRowIntentV1>,
  PointCommitCorruptionV1Error
> {
  return Result.gen(function* () {
    const dependency = yield* capturePointDependencyResult(input);
    if (input.kind === "deleted") {
      return Object.freeze({ ...dependency, kind: "deleted" });
    }
    const creationTimeInput = yield* readPointCommitCommandFieldResult(
      () => input.creationTime,
    );
    const creationTime = yield* decodePointCommitCreationTimeResult(
      creationTimeInput,
    ).pipe(Result.mapError(() => corruption("commandInvalid")));
    const canonicalBytesInput = yield* readPointCommitCommandFieldResult(
      () => input.canonicalBytes,
    );
    if (!isUint8Array(canonicalBytesInput)) {
      return yield* Result.fail(corruption("commandInvalid"));
    }
    const canonicalBytes = yield* Result.try({
      try: () => copyBytes(canonicalBytesInput),
      catch: () => corruption("commandInvalid"),
    });
    if (
      canonicalBytes.byteLength === 0 ||
      !isPositiveSafeInteger(input.semanticSizeBytes)
    ) {
      return yield* Result.fail(corruption("commandInvalid"));
    }
    return Object.freeze({
      ...dependency,
      kind: "live",
      creationTime,
      value: structuredClone(input.value),
      canonicalBytes,
      semanticSizeBytes: input.semanticSizeBytes,
    });
  });
}

function captureRowIntentsResult(
  input: ReadonlyArray<PointCommitRowIntentV1>,
): Result.Result<
  ReadonlyArray<Readonly<PointCommitRowIntentV1>>,
  PointCommitCorruptionV1Error
> {
  if (
    !Array.isArray(input) ||
    input.length > MAX_POINT_COMMIT_MATERIAL_ROWS_V1
  ) {
    return Result.fail(corruption("commandInvalid"));
  }
  return Result.gen(function* () {
    const captured: Readonly<PointCommitRowIntentV1>[] = [];
    for (let index = 0; index < input.length; index += 1) {
      if (!Object.hasOwn(input, index)) {
        return yield* Result.fail(corruption("commandInvalid"));
      }
      const intent = input[index];
      if (intent === undefined) {
        return yield* Result.fail(corruption("commandInvalid"));
      }
      captured.push(yield* captureRowIntentResult(intent));
    }
    const rowIntents = Object.freeze(captured);
    yield* requireCanonicalDependencyOrderResult(rowIntents);
    return rowIntents;
  });
}

function requireCanonicalDependencyOrderResult(
  dependencies: ReadonlyArray<Readonly<PointCommitDependencyV1>>,
): Result.Result<void, PointCommitCorruptionV1Error> {
  for (let index = 1; index < dependencies.length; index += 1) {
    const previous = dependencies[index - 1];
    const current = dependencies[index];
    if (previous === undefined || current === undefined) {
      return Result.fail(corruption("commandInvalid"));
    }
    const tableDifference = previous.tableId - current.tableId;
    const rowDifference = compareRowIds(previous.rowId, current.rowId);
    if (tableDifference > 0 || (tableDifference === 0 && rowDifference >= 0)) {
      return Result.fail(corruption("commandInvalid"));
    }
  }
  return Result.succeed(undefined);
}

function compareRowIds(left: AppRowIdHexV1, right: AppRowIdHexV1): number {
  const leftBytes = appRowIdHexV1ToBytes(left);
  const rightBytes = appRowIdHexV1ToBytes(right);
  for (let index = 0; index < leftBytes.byteLength; index += 1) {
    const difference = (leftBytes[index] ?? 0) - (rightBytes[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

function isCanonicalDocumentForIntent(
  document: CanonicalFlarexValueV1,
  intent: Pick<PreparedLivePointCommitRowIntentV1, "documentId" | "creationTime">,
): boolean {
  const value = document.value;
  if (!isCanonicalFlarexRuntimeObjectV1(value)) return false;
  return value._id === intent.documentId &&
    value._creationTime === intent.creationTime;
}

interface LockedPointCommitClockV1 {
  readonly record: ScopeClockRecord;
  readonly oldestAvailableCommitSeq: bigint;
  readonly scopeUuid: ScopeUuidV1;
  readonly epochUuid: ScopeEpochUuidV1;
  readonly authorizationRevocationEpoch: TransactionAuthorizationRevocationEpoch;
}

type PointCommitScopeClockRowV1 = ScopeClockRow;

const decodePointCommitScopeUuidResult = Schema.decodeUnknownResult(
  Schema.toType(ScopeUuidV1Schema),
);
const decodePointCommitScopeEpochUuidResult = Schema.decodeUnknownResult(
  Schema.toType(ScopeEpochUuidV1Schema),
);
const decodePointCommitRetainedFloorResult = Schema.decodeUnknownResult(
  Schema.toType(CommitSeqSchema),
);
const decodePointCommitAuthorizationRevocationEpochResult =
  Schema.decodeUnknownResult(
    Schema.toType(TransactionAuthorizationRevocationEpochSchema),
  );

interface LockedPointCommitSessionV1 {
  readonly lifecycle: "running" | "finishing";
  readonly attemptFence: TransactionAttemptFence;
  readonly authorizationGrantExpiresAtMilliseconds: number;
  readonly hardExpiresAtMilliseconds: number;
  readonly updatedAtMilliseconds: number;
}

interface LockedCommittedPointOutcomeV1 {
  readonly state: "available" | "expired";
  readonly commitSeq: CommitSeq;
}

interface LockedPointCommitLeaseV1 {
  readonly expiresAtMilliseconds: number;
  readonly row: typeof fxSystemSnapshotLeases.$inferSelect;
}

type PointCommitKernelResultV1 =
  | Readonly<{ readonly kind: "existing" }>
  | Readonly<{
      readonly kind: "ready";
      readonly clock: LockedPointCommitClockV1;
      readonly commitSeq: CommitSeq | null;
      readonly publicationTimeMilliseconds: number | null;
      readonly relationAdjacencyChanges:
        ReadonlyArray<ApplicationRelationAdjacencyChange>;
    }>;

type PointCommitReadyForPublicationV1 = Extract<
  PointCommitKernelResultV1,
  { readonly kind: "ready" }
> & {
  readonly commitSeq: CommitSeq;
  readonly publicationTimeMilliseconds: number;
};

type PointCommitPublicationDecisionV1 =
  | Readonly<{ readonly kind: "existing" }>
  | Readonly<{
      readonly kind: "published";
      readonly token: CommittedPointOutcomeTokenV1;
    }>;

type PointCommitPublicationRunDecisionV1 =
  | PointCommitPublicationDecisionV1
  | Readonly<{
      readonly kind: "recovered";
      readonly outcome: Exclude<
        CommittedPointOutcomeResolutionV1,
        Readonly<{ readonly kind: "missing" }>
      >;
    }>;

function runReplacementTransactionEffect<Value>(target: LocatedReadCommittedAttemptTargetV1,
  work: (tx: AppRowTransaction) => Effect.Effect<Value, PointMutationAttemptReplacementV1Error>) {
  return runEffectTransactionSettlement(callback => target[RUN_LOCATED_READ_COMMITTED_V1](callback).catch(cause => {
    // Only this runner's callback rollback contains the Effect bridge's private sentinel.
    if (cause instanceof LocatedReadCommittedTransactionFailureV1 && cause.issue.kind === "callbackRolledBack")
      throw cause.issue.callbackCause;
    throw cause;
  }), "Point mutation replacement callback rolled back", work, mapPointMutationAttemptReplacementTransactionFailure);
}

function requireDurableReplacementProfile(profile: "durableOperations" | "finiteRoot",
  lease: typeof fxSystemSnapshotLeases.$inferSelect): void {
  // Legacy replacement tickets only authorize the actual durable profile.
  // Finite replay is owned by stable-anchor nonacceptance and replaceFinite.
  if (profile !== "durableOperations" || lease.metadataWatermark !== null ||
    lease.finiteMetadataReservationBytes !== null || lease.finiteMetadataReservationSha256 !== null)
    // The Promise rollback adapter converts this displaced finite profile into
    // the existing typed replacement-corruption channel.
    // oxlint-disable-next-line flarex/no-throw-inside-effect-operation -- REVIEW: transaction - the native Drizzle replacement callback rejects with typed corruption to roll back a displaced finite profile
    throw replacementCorruption("journalRootInvalid");
}
function runPointMutationAttemptReplacement(
  target: LocatedReadCommittedAttemptTargetV1,
  preliminaryAuthority: TrustedScopeAuthority,
  command: PreparedPointMutationAttemptReplacementCommandV1,
  options: PointMutationAttemptReplacementOptionsV1,
  sharedOptions: PointCommitTransactionProofOptionsV1,
  executionClaimOwner: TransactionExecutionClaimOwnerV1,
  executionClaimDurationMilliseconds: number,
): Effect.Effect<PointMutationAttemptReplacementObservationV1, PointMutationAttemptReplacementV1Error> {
  return runReplacementTransactionEffect(target, tx => {
    return runPointCommitPromiseEffect(async () => {
    const clock = await lockPointCommitClock(tx, command, sharedOptions);
    await emitReplacementStep(options, command, "clockLocked");
    const outcome = await inspectCommittedOutcomeInTransaction(
      tx,
      clock,
      command,
      sharedOptions,
    );
    await emitReplacementStep(options, command, "outcomeRechecked");
    if (outcome !== null) {
      throw new PointMutationAttemptReplacementCommittedOutcomeV1Error({
        reason: outcome.state === "available"
          ? "committedOutcomeAvailable"
          : "committedOutcomeExpired",
        commitSeq: outcome.commitSeq,
      });
    }
    projectPointCommitTransactionResult(
      requireLockedClockAuthorityResult(
        clock,
        preliminaryAuthority,
        command,
      ),
    );
    const session = await lockPointCommitSession(
      tx,
      command,
      sharedOptions,
      "replaceAttempt",
    );
    await emitReplacementStep(options, command, "sessionLocked");
    if (session.attemptFence !== command.authorityPins.attemptFence) {
      return observeReplacedPointMutationAttempt(
        tx,
        clock,
        command,
        session,
        options,
        command.expectedConflict.conflict.kind === "metadata" ? command.expectedConflict.conflict : undefined,
      );
    }
    await validateActiveRelationSelectionForPointCommit(tx, command);
    if (command.relationDependencies.length > 0) {
      await emitReplacementStep(
        options,
        command,
        "activeRelationSelectionValidated",
      );
    }

    const lease = await lockPointCommitLease(tx, command, sharedOptions);
    await emitReplacementStep(options, command, "leaseLocked");
    const executionProfile = await lockPointCommitJournalRoot(tx, command, sharedOptions);
    const sealedJournal = await readSealedPointCommitJournal(tx, command, sharedOptions);
    requireDurableReplacementProfile(executionProfile, lease.row);
    await emitReplacementStep(options, command, "journalRootLocked");
    await requireNoFinishingExecutionClaim(
      tx,
      clock,
      command,
      options,
    );
    const databaseNowMilliseconds = await readPointCommitDatabaseTime(
      tx,
      command.authorityPins.scopeId,
      sharedOptions,
    );
    projectPointCommitTransactionResult(
      requireAttemptIsLiveResult(session, lease, databaseNowMilliseconds),
    );

    const heads = await loadPointCommitHeads(
      tx,
      clock,
      command,
      sharedOptions,
    );
    await requireReproduciblePointCommitConflict(
      tx,
      clock,
      command,
      heads,
      sharedOptions,
      preliminaryAuthority,
      sealedJournal,
      null,
    );
    await emitReplacementStep(options, command, "dependenciesValidated");

    return replaceLockedPointMutationAttempt(
      tx,
      clock,
      command,
      session,
      lease,
      options,
      sharedOptions,
      executionClaimOwner,
      executionClaimDurationMilliseconds,
      executionProfile,
    );
    }, mapPointMutationAttemptReplacementTransactionFailure).pipe(
      Effect.tap(observation => observation.kind === "replaced" ? runPointCommitPromiseEffect(
        () => emitReplacementStep(options, command, "beforeCommit"), mapPointMutationAttemptReplacementTransactionFailure) : Effect.void),
    );
  });
}

function runRunningRelationConflictAttemptReplacement(
  target: LocatedReadCommittedAttemptTargetV1,
  preliminaryAuthority: TrustedScopeAuthority,
  command: PreparedRunningRelationConflictAttemptReplacementCommandV1,
  options: PointMutationAttemptReplacementOptionsV1,
  sharedOptions: PointCommitTransactionProofOptionsV1,
  executionClaimOwner: TransactionExecutionClaimOwnerV1,
  executionClaimDurationMilliseconds: number,
): Effect.Effect<PointMutationAttemptReplacementObservationV1, PointMutationAttemptReplacementV1Error> {
  return runReplacementTransactionEffect(target, tx => {
    return runPointCommitPromiseEffect(async () => {
    const clock = await lockPointCommitClock(tx, command, sharedOptions);
    await emitReplacementStep(options, command, "clockLocked");
    const outcome = await inspectCommittedOutcomeInTransaction(
      tx,
      clock,
      command,
      sharedOptions,
    );
    await emitReplacementStep(options, command, "outcomeRechecked");
    if (outcome !== null) {
      throw new PointMutationAttemptReplacementCommittedOutcomeV1Error({
        reason: outcome.state === "available"
          ? "committedOutcomeAvailable"
          : "committedOutcomeExpired",
        commitSeq: outcome.commitSeq,
      });
    }
    projectPointCommitTransactionResult(
      requireLockedClockAuthorityResult(
        clock,
        preliminaryAuthority,
        command,
      ),
    );

    const session = await lockPointCommitSession(
      tx,
      command,
      sharedOptions,
      "replaceRunningRelationConflict",
    );
    await emitReplacementStep(options, command, "sessionLocked");
    if (session.attemptFence !== command.authorityPins.attemptFence) {
      return observeReplacedPointMutationAttempt(
        tx,
        clock,
        command,
        session,
        options,
      );
    }

    const lease = await lockPointCommitLease(tx, command, sharedOptions);
    await emitReplacementStep(options, command, "leaseLocked");
    const conflictJournal = await lockRunningRelationConflictJournal(
      tx,
      command,
      options,
    );
    requireDurableReplacementProfile(conflictJournal.executionProfile, lease.row);
    await emitReplacementStep(options, command, "journalRootLocked");
    const databaseNowMilliseconds = await readPointCommitDatabaseTime(
      tx,
      command.authorityPins.scopeId,
      sharedOptions,
    );
    projectPointCommitTransactionResult(
      requireAttemptIsLiveResult(session, lease, databaseNowMilliseconds),
    );
    if (conflictJournal.updatedAtMilliseconds > databaseNowMilliseconds) {
      throw replacementCorruption("journalRootInvalid");
    }
    const executionClaim = projectPointCommitTransactionResult(
      await lockExactTransactionExecutionClaimV1Result(tx, {
        scopeId: command.authorityPins.scopeId,
        scopeUuid: clock.scopeUuid,
        sessionId: command.authorityPins.sessionId,
        attemptFence: command.authorityPins.attemptFence,
      }),
    );
    projectPointCommitTransactionResult(
      requireLiveTransactionExecutionClaimV1Result(
        command.authorityPins.scopeId,
        executionClaim,
        command.executionClaim,
        new Date(databaseNowMilliseconds),
      ),
    );
    const recoveredConflict = await recoverRunningRelationConflictEvidence(
      tx,
      clock,
      command,
      conflictJournal,
      options,
    );
    if (
      !runningRelationConflictRecoveryMatchesCommand(
        recoveredConflict,
        command,
      )
    ) {
      throw replacementCorruption("occEvidenceInvalid");
    }
    await emitReplacementStep(
      options,
      command,
      "activeRelationSelectionValidated",
    );
    await emitReplacementStep(options, command, "dependenciesValidated");
    const mutationTimeMilliseconds = await readPointCommitDatabaseTime(
      tx,
      command.authorityPins.scopeId,
      sharedOptions,
    );
    projectPointCommitTransactionResult(
      requireAttemptIsLiveResult(session, lease, mutationTimeMilliseconds),
    );
    projectPointCommitTransactionResult(
      requireLiveTransactionExecutionClaimV1Result(
        command.authorityPins.scopeId,
        executionClaim,
        command.executionClaim,
        new Date(mutationTimeMilliseconds),
      ),
    );
    await deleteRunningRelationConflictExecutionClaim(
      tx,
      clock,
      command,
      options,
    );
    await emitReplacementStep(options, command, "executionClaimDeleted");

    return replaceLockedPointMutationAttempt(
      tx,
      clock,
      command,
      session,
      lease,
      options,
      sharedOptions,
      executionClaimOwner,
      executionClaimDurationMilliseconds,
      conflictJournal.executionProfile,
      mutationTimeMilliseconds,
    );
    }, mapPointMutationAttemptReplacementTransactionFailure).pipe(
      Effect.tap(observation => observation.kind === "replaced" ? runPointCommitPromiseEffect(
        () => emitReplacementStep(options, command, "beforeCommit"), mapPointMutationAttemptReplacementTransactionFailure) : Effect.void),
    );
  });
}

async function runRunningRelationConflictRecovery(
  target: LocatedReadCommittedAttemptTargetV1,
  preliminaryAuthority: TrustedScopeAuthority,
  command: PreparedRunningRelationConflictRecoveryCommand,
  options: PointMutationAttemptReplacementOptionsV1,
  sharedOptions: PointCommitTransactionProofOptionsV1,
): Promise<RecoveredRunningRelationConflictEvidence> {
  return target[RUN_LOCATED_READ_COMMITTED_V1](async (tx) => {
    const clock = await lockPointCommitClock(tx, command, sharedOptions);
    projectPointCommitTransactionResult(
      requireLockedClockAuthorityResult(
        clock,
        preliminaryAuthority,
        command,
      ),
    );
    const session = await lockPointCommitSession(
      tx,
      command,
      sharedOptions,
      "recoverRunningRelationConflict",
    );
    const lease = await lockPointCommitLease(tx, command, sharedOptions);
    const conflictJournal = await lockRunningRelationConflictJournal(
      tx,
      command,
      options,
    );
    const databaseNowMilliseconds = await readPointCommitDatabaseTime(
      tx,
      command.authorityPins.scopeId,
      sharedOptions,
    );
    projectPointCommitTransactionResult(
      requireAttemptIsLiveResult(session, lease, databaseNowMilliseconds),
    );
    if (conflictJournal.updatedAtMilliseconds > databaseNowMilliseconds) {
      throw replacementCorruption("journalRootInvalid");
    }
    const executionClaim = projectPointCommitTransactionResult(
      await lockExactTransactionExecutionClaimV1Result(tx, {
        scopeId: command.authorityPins.scopeId,
        scopeUuid: clock.scopeUuid,
        sessionId: command.authorityPins.sessionId,
        attemptFence: command.authorityPins.attemptFence,
      }),
    );
    projectPointCommitTransactionResult(
      requireLiveTransactionExecutionClaimV1Result(
        command.authorityPins.scopeId,
        executionClaim,
        command.executionClaim,
        new Date(databaseNowMilliseconds),
      ),
    );
    const recovered = await recoverRunningRelationConflictEvidence(
      tx,
      clock,
      command,
      conflictJournal,
      options,
    );
    return Object.freeze({
      [recoveredRunningRelationConflictEvidenceBrand]: true as const,
      request: recovered.request,
      conflict: recovered.conflict,
    });
  });
}

interface LockedRunningRelationConflictJournalV1 {
  readonly executionProfile: "durableOperations" | "finiteRoot";
  readonly lastSyscallSequence: bigint;
  readonly relationDependencyCount: number;
  readonly createdAtMilliseconds: number;
  readonly updatedAtMilliseconds: number;
}

async function lockRunningRelationConflictJournal(
  tx: AppRowTransaction,
  command: PreparedRunningRelationConflictRecoveryCommand,
  options: PointMutationAttemptReplacementOptionsV1,
): Promise<LockedRunningRelationConflictJournalV1> {
  const query = tx.select().from(fxSystemTransactionJournals).where(and(
    eq(fxSystemTransactionJournals.scopeUuid, command.scopeUuid),
    eq(
      fxSystemTransactionJournals.sessionId,
      command.authorityPins.sessionId,
    ),
    eq(
      fxSystemTransactionJournals.attemptFence,
      command.authorityPins.attemptFence,
    ),
  )).limit(2).for("update");
  observeReplacementQuery("lockJournalRoot", query, options);
  const rows = await replacementSqlCall("lockJournalRoot", () => query);
  if (rows.length !== 1) {
    throw replacementCorruption("journalRootMissingOrDuplicate");
  }
  const row = rows[0];
  if (row === undefined) {
    throw replacementCorruption("journalRootMissingOrDuplicate");
  }
  const createdAtMilliseconds = finiteDateMilliseconds(row.createdAt);
  const updatedAtMilliseconds = finiteDateMilliseconds(row.updatedAt);
  const creationTimeSeed = projectPointCommitTransactionResult(
    decodePointCommitCreationTimeResult(row.creationTimeSeed).pipe(
      Result.mapError(() => corruption("journalRootInvalid")),
    ),
  );
  const nextCreationTime = projectPointCommitTransactionResult(
    decodePointCommitCreationTimeResult(row.nextCreationTime).pipe(
      Result.mapError(() => corruption("journalRootInvalid")),
    ),
  );
  if (
    row.scopeUuid !== command.scopeUuid ||
    row.sessionId !== command.authorityPins.sessionId ||
    row.attemptFence !== command.authorityPins.attemptFence ||
    row.state !== "relation_conflicted" ||
    row.lastSyscallSequence < 1n ||
    row.failureDimension !== null ||
    !isNonNegativeSafeInteger(row.readDocuments) ||
    row.readDocuments > MAX_COMMIT_READ_DOCUMENTS_V1 ||
    !isNonNegativeSafeInteger(row.readSemanticBytes) ||
    row.readSemanticBytes > MAX_COMMIT_READ_SEMANTIC_BYTES_V1 ||
    !isNonNegativeSafeInteger(row.pointDependencyCount) ||
    row.pointDependencyCount > MAX_COMMIT_POINT_READ_DEPENDENCIES_V1 ||
    !isNonNegativeSafeInteger(row.indexedQuerySyscalls) ||
    row.indexedQuerySyscalls > MAX_COMMIT_INDEXED_QUERY_SYSCALLS_V1 ||
    !isNonNegativeSafeInteger(row.indexRangeDependencyCount) ||
    row.indexRangeDependencyCount >
      MAX_COMMIT_INDEX_RANGE_READ_DEPENDENCIES_V1 ||
    !isNonNegativeSafeInteger(row.indexRangeDependencyEvidenceBytes) ||
    row.indexRangeDependencyEvidenceBytes >
      MAX_COMMIT_INDEX_RANGE_DEPENDENCY_EVIDENCE_BYTES_V1 ||
    !isPositiveSafeInteger(row.relationReadSyscalls) ||
    row.relationReadSyscalls > MAX_COMMIT_RELATION_READ_SYSCALLS_V1 ||
    !isNonNegativeSafeInteger(row.relationDependencyCount) ||
    row.relationDependencyCount > MAX_COMMIT_RELATION_READ_DEPENDENCIES_V1 ||
    !isNonNegativeSafeInteger(row.relationBaseOccurrences) ||
    row.relationBaseOccurrences > MAX_COMMIT_RELATION_BASE_OCCURRENCES_V1 ||
    !isNonNegativeSafeInteger(row.writeOperations) ||
    row.writeOperations > MAX_COMMIT_WRITE_OPERATIONS_V1 ||
    !isNonNegativeSafeInteger(row.writeSemanticBytes) ||
    row.writeSemanticBytes > MAX_COMMIT_WRITE_SEMANTIC_BYTES_V1 ||
    !isNonNegativeSafeInteger(row.materialWriteEventEvidenceBytes) ||
    row.materialWriteEventEvidenceBytes >
      MAX_COMMIT_MATERIAL_WRITE_EVENT_EVIDENCE_BYTES_V1 ||
    row.sealedJournalBytes !== null ||
    row.sealedJournalSha256 !== null ||
    row.sealedResultValueCodecVersion !== null ||
    row.sealedResultSemanticBytes !== null ||
    row.sealedResultBytes !== null ||
    row.sealedResultSha256 !== null ||
    row.sealedAt !== null ||
    createdAtMilliseconds === undefined ||
    updatedAtMilliseconds === undefined ||
    createdAtMilliseconds !== command.session.updatedAtMilliseconds ||
    creationTimeSeed !== createdAtMilliseconds ||
    updatedAtMilliseconds < createdAtMilliseconds ||
    nextCreationTime < creationTimeSeed
  ) {
    throw replacementCorruption("journalRootInvalid");
  }
  return Object.freeze({
    executionProfile: row.executionProfile,
    lastSyscallSequence: row.lastSyscallSequence,
    relationDependencyCount: row.relationDependencyCount,
    createdAtMilliseconds,
    updatedAtMilliseconds,
  });
}

async function recoverRunningRelationConflictEvidence(
  tx: AppRowTransaction,
  clock: LockedPointCommitClockV1,
  command: PreparedRunningRelationConflictRecoveryCommand,
  journal: LockedRunningRelationConflictJournalV1,
  options: PointMutationAttemptReplacementOptionsV1,
): Promise<Readonly<{
  readonly request: RunningRelationConflictRequestEvidenceV1;
  readonly conflict: RunningRelationConflictEvidenceV1;
  readonly activeSelection: RecoveredApplicationRelationActiveSelection;
}>> {
  const receiptSequence = projectPointCommitTransactionResult(
    decodePointCommitSyscallSequenceResult(
      journal.lastSyscallSequence,
    ).pipe(Result.mapError(() => replacementCorruption("occEvidenceInvalid"))),
  );
  const receiptQuery = tx.select()
    .from(fxSystemTransactionJournalReceipts)
    .where(and(
      eq(fxSystemTransactionJournalReceipts.scopeUuid, command.scopeUuid),
      eq(
        fxSystemTransactionJournalReceipts.sessionId,
        command.authorityPins.sessionId,
      ),
      eq(
        fxSystemTransactionJournalReceipts.attemptFence,
        command.authorityPins.attemptFence,
      ),
      eq(
        fxSystemTransactionJournalReceipts.lastSyscallSequence,
        receiptSequence,
      ),
    )).limit(2).for("update");
  observeReplacementQuery("validateRelationDependencies", receiptQuery, options);
  const receipts = await replacementSqlCall(
    "validateRelationDependencies",
    () => receiptQuery,
  );
  if (receipts.length !== 1) {
    throw replacementCorruption("occEvidenceInvalid");
  }
  const receipt = receipts[0];
  const receiptCreatedAt = receipt === undefined
    ? undefined
    : finiteDateMilliseconds(receipt.createdAt);
  const receiptUpdatedAt = receipt === undefined
    ? undefined
    : finiteDateMilliseconds(receipt.updatedAt);
  if (
    receipt === undefined ||
    receipt.scopeUuid !== command.scopeUuid ||
    receipt.sessionId !== command.authorityPins.sessionId ||
    receipt.attemptFence !== command.authorityPins.attemptFence ||
    receipt.lastSyscallSequence !== journal.lastSyscallSequence ||
    receipt.operationKind !== "relationIncoming" ||
    receipt.participantBindingSha256 !== null ||
    receipt.outcomeKind !== "relationConflict" ||
    receipt.requestCodecVersion !== 2 ||
    receipt.outcomeCodecVersion !== 2 ||
    receiptCreatedAt === undefined ||
    receiptUpdatedAt === undefined ||
    receiptCreatedAt !== journal.updatedAtMilliseconds ||
    receiptUpdatedAt !== journal.updatedAtMilliseconds
  ) {
    throw replacementCorruption("occEvidenceInvalid");
  }
  const request = await decodeRunningRelationConflictRequestEvidence(
    receipt.requestBytes,
    receipt.requestSha256,
  );
  const outcome = await decodeRunningRelationConflictOutcomeEvidence(
    receipt.outcomeBytes,
    receipt.outcomeSha256,
  );
  if (
    request.syscallSequence !== journal.lastSyscallSequence ||
    request.limit < 1 ||
    request.limit > RELATION_INCOMING_PAGE_MAXIMUM_IDENTITIES_V1 ||
    outcome.edgeDefinitionId !== request.edgeDefinitionId ||
    outcome.targetRowId !== request.targetRowId ||
    outcome.snapshotCommitSeq !== command.authorityPins.snapshotToken.commitSeq ||
    outcome.expectedAdjacencyVersion > outcome.snapshotCommitSeq ||
    outcome.actualAdjacencyVersion <= outcome.snapshotCommitSeq
  ) {
    throw replacementCorruption("occEvidenceInvalid");
  }

  const dependencyQuery = tx.select()
    .from(fxSystemTransactionJournalRelationIncomingDependencies)
    .where(and(
      eq(
        fxSystemTransactionJournalRelationIncomingDependencies.scopeUuid,
        command.scopeUuid,
      ),
      eq(
        fxSystemTransactionJournalRelationIncomingDependencies.sessionId,
        command.authorityPins.sessionId,
      ),
      eq(
        fxSystemTransactionJournalRelationIncomingDependencies.attemptFence,
        command.authorityPins.attemptFence,
      ),
    ))
    .orderBy(
      fxSystemTransactionJournalRelationIncomingDependencies.edgeDefinitionId,
      fxSystemTransactionJournalRelationIncomingDependencies.targetRowId,
    )
    .limit(MAX_COMMIT_RELATION_READ_DEPENDENCIES_V1 + 1)
    .for("update");
  observeReplacementQuery(
    "validateRelationDependencies",
    dependencyQuery,
    options,
  );
  const dependencies = await replacementSqlCall(
    "validateRelationDependencies",
    () => dependencyQuery,
  );
  if (dependencies.length !== journal.relationDependencyCount) {
    throw replacementCorruption("occEvidenceInvalid");
  }
  let matchingDependencyCount = 0;
  let activeSelection: Readonly<{
    readonly activationSequence: bigint;
    readonly activeHeadSha256Hex: string;
  }> | undefined;
  for (const dependency of dependencies) {
    const targetRowId = projectPointCommitTransactionResult(
      appRowIdHexV1FromBytesResult(dependency.targetRowId).pipe(
        Result.mapError(() => corruption("occEvidenceInvalid")),
      ),
    );
    const dependencyCreatedAt = finiteDateMilliseconds(dependency.createdAt);
    const dependencyUpdatedAt = finiteDateMilliseconds(dependency.updatedAt);
    if (
      dependency.observedAdjacencyVersion > outcome.snapshotCommitSeq ||
      dependency.activationSequence < 1n ||
      !isUint8ArrayWithByteLength(dependency.activeHeadSha256, 32) ||
      (activeSelection !== undefined &&
        (dependency.activationSequence !==
            activeSelection.activationSequence ||
          encodeBytesToLowercaseHex(dependency.activeHeadSha256) !==
            activeSelection.activeHeadSha256Hex)) ||
      dependencyCreatedAt === undefined ||
      dependencyUpdatedAt === undefined ||
      dependencyCreatedAt < journal.createdAtMilliseconds ||
      dependencyUpdatedAt < dependencyCreatedAt ||
      dependencyUpdatedAt > journal.updatedAtMilliseconds
    ) {
      throw replacementCorruption("occEvidenceInvalid");
    }
    activeSelection ??= Object.freeze({
      activationSequence: dependency.activationSequence,
      activeHeadSha256Hex:
        encodeBytesToLowercaseHex(dependency.activeHeadSha256),
    });
    if (
      dependency.edgeDefinitionId === outcome.edgeDefinitionId &&
      targetRowId === outcome.targetRowId
    ) {
      matchingDependencyCount += 1;
      if (
        dependency.observedAdjacencyVersion !==
          outcome.expectedAdjacencyVersion
      ) {
        throw replacementCorruption("occEvidenceInvalid");
      }
    }
  }
  if (matchingDependencyCount !== 1 || activeSelection === undefined) {
    throw replacementCorruption("occEvidenceInvalid");
  }
  await validateExpectedActiveRelationSelectionForPointCommit(
    tx,
    command.authorityPins.scopeId,
    [activeSelection],
  );

  const settled = await runPointCommitInTransactionEffect(
    readAppRelationEdgeAdjacencyVersionInTransactionEffect(tx, {
      scopeId: command.authorityPins.scopeId,
      edgeDefinitionId: outcome.edgeDefinitionId,
      direction: "incoming",
      endpointRowId: outcome.targetRowId,
    }),
  );
  const current = projectPointCommitTransactionResult(
    settled.pipe(Result.mapError((failure) =>
      failure instanceof AppRelationEdgePersistenceError
        ? new PointCommitSqlFailureMarkerV1(
            "validateRelationDependencies",
            failure.cause,
          )
        : corruption("occEvidenceInvalid")
    )),
  );
  if (
    current < outcome.actualAdjacencyVersion ||
    current <= outcome.snapshotCommitSeq ||
    current > clock.record.lastCommitSeq
  ) {
    throw replacementCorruption("occEvidenceInvalid");
  }
  return Object.freeze({
    request: Object.freeze({ ...request }),
    conflict: Object.freeze({ ...outcome }),
    activeSelection,
  });
}

function runningRelationConflictRecoveryMatchesCommand(
  recovered: Readonly<{
    readonly request: RunningRelationConflictRequestEvidenceV1;
    readonly conflict: RunningRelationConflictEvidenceV1;
  }>,
  command: PreparedRunningRelationConflictAttemptReplacementCommandV1,
): boolean {
  const request = recovered.request;
  const expectedRequest = command.request;
  const conflict = recovered.conflict;
  const expectedConflict = command.conflict;
  return request.syscallSequence === expectedRequest.syscallSequence &&
    request.relationId === expectedRequest.relationId &&
    request.edgeDefinitionId === expectedRequest.edgeDefinitionId &&
    request.sourceTableId === expectedRequest.sourceTableId &&
    request.targetTableId === expectedRequest.targetTableId &&
    request.targetRowId === expectedRequest.targetRowId &&
    request.limit === expectedRequest.limit &&
    conflict.edgeDefinitionId === expectedConflict.edgeDefinitionId &&
    conflict.targetRowId === expectedConflict.targetRowId &&
    conflict.expectedAdjacencyVersion ===
      expectedConflict.expectedAdjacencyVersion &&
    conflict.actualAdjacencyVersion ===
      expectedConflict.actualAdjacencyVersion &&
    conflict.snapshotCommitSeq === expectedConflict.snapshotCommitSeq;
}

async function decodeRunningRelationConflictRequestEvidence(
  canonicalBytes: unknown,
  sha256: unknown,
): Promise<typeof RunningRelationConflictRequestV1Schema.Type> {
  try {
    const evidence = await decodeCanonicalFlarexValueEvidenceV1({
      canonicalBytes,
      sha256,
    });
    return projectPointCommitTransactionResult(
      decodeRunningRelationConflictRequestEvidenceV1Result(evidence.value).pipe(
        Result.mapError(() => corruption("occEvidenceInvalid")),
      ),
    );
  } catch (cause) {
    if (
      cause instanceof FlarexValueCodecV1Error ||
      cause instanceof FlarexValueEvidenceV1Error
    ) {
      throw replacementCorruption("occEvidenceInvalid");
    }
    throw cause;
  }
}

async function decodeRunningRelationConflictOutcomeEvidence(
  canonicalBytes: unknown,
  sha256: unknown,
): Promise<typeof RunningRelationConflictOutcomeEvidenceV1Schema.Type> {
  try {
    const evidence = await decodeCanonicalFlarexValueEvidenceV1({
      canonicalBytes,
      sha256,
    });
    return projectPointCommitTransactionResult(
      decodeRunningRelationConflictOutcomeEvidenceV1Result(evidence.value).pipe(
        Result.mapError(() => corruption("occEvidenceInvalid")),
      ),
    );
  } catch (cause) {
    if (
      cause instanceof FlarexValueCodecV1Error ||
      cause instanceof FlarexValueEvidenceV1Error
    ) {
      throw replacementCorruption("occEvidenceInvalid");
    }
    throw cause;
  }
}

async function deleteRunningRelationConflictExecutionClaim(
  tx: AppRowTransaction,
  clock: LockedPointCommitClockV1,
  command: PreparedRunningRelationConflictAttemptReplacementCommandV1,
  options: PointMutationAttemptReplacementOptionsV1,
): Promise<void> {
  const query = tx.delete(fxSystemTransactionExecutionClaims).where(and(
    eq(fxSystemTransactionExecutionClaims.scopeUuid, clock.scopeUuid),
    eq(
      fxSystemTransactionExecutionClaims.sessionId,
      command.authorityPins.sessionId,
    ),
    eq(
      fxSystemTransactionExecutionClaims.attemptFence,
      command.authorityPins.attemptFence,
    ),
    eq(
      fxSystemTransactionExecutionClaims.claimOwner,
      command.executionClaim.claimOwner,
    ),
    eq(
      fxSystemTransactionExecutionClaims.claimFence,
      command.executionClaim.claimFence,
    ),
    sql`${fxSystemTransactionExecutionClaims.claimExpiresAt} > clock_timestamp()`,
  )).returning({
    claimFence: fxSystemTransactionExecutionClaims.claimFence,
  });
  observeReplacementQuery("deleteExecutionClaim", query, options);
  const rows = await replacementSqlCall("deleteExecutionClaim", () => query);
  if (
    rows.length !== 1 ||
    rows[0]?.claimFence !== command.executionClaim.claimFence
  ) {
    throw replacementCorruption("replacementMutationInvalid");
  }
}

async function replaceLockedPointMutationAttempt(
  tx: AppRowTransaction,
  clock: LockedPointCommitClockV1,
  command: PreparedPointCommitAuthorityCommandV1,
  session: LockedPointCommitSessionV1,
  lease: LockedPointCommitLeaseV1,
  options: PointMutationAttemptReplacementOptionsV1,
  sharedOptions: PointCommitTransactionProofOptionsV1,
  executionClaimOwner: TransactionExecutionClaimOwnerV1,
  executionClaimDurationMilliseconds: number,
  executionProfile: "durableOperations" | "finiteRoot",
  knownMutationTimeMilliseconds?: number,
): Promise<PointMutationAttemptReplacementObservationV1> {
const sourceLifecycle = "scopeUuid" in command ? "running" : "finishing";
const mutationTimeMilliseconds = knownMutationTimeMilliseconds ??
  await readPointCommitDatabaseTime(
    tx,
    command.authorityPins.scopeId,
    sharedOptions,
  );
projectPointCommitTransactionResult(
  requireAttemptIsLiveResult(session, lease, mutationTimeMilliseconds),
);
if (
  command.authorityPins.attemptFence >= MAX_TRANSACTION_ATTEMPT_FENCE
) {
  throw new PointMutationAttemptReplacementResourceExhaustionV1Error({
    dimension: "attemptFence",
    maximum: MAX_TRANSACTION_ATTEMPT_FENCE,
  });
}
const replacementFence = TransactionAttemptFenceSchema.make(
  command.authorityPins.attemptFence + 1n,
);
const freshFacet = projectPointCommitTransactionResult(
  buildFreshTransactionAttemptFacetV1({
    scopeUuid: clock.scopeUuid,
    sessionId: command.authorityPins.sessionId,
    attemptFence: replacementFence,
    executionProfile,
    snapshotEpochUuid: clock.epochUuid,
    snapshotCommitSeq: clock.record.lastCommitSeq,
    databaseNowMilliseconds: mutationTimeMilliseconds,
    authorizationGrantExpiresAtMilliseconds:
      session.authorizationGrantExpiresAtMilliseconds,
    hardExpiresAtMilliseconds: session.hardExpiresAtMilliseconds,
    leaseDurationMilliseconds: options.leaseDurationMilliseconds,
  }).pipe(Result.mapError((reason) =>
    reason === "authorityExpired"
      ? stale("expired")
      : replacementCorruption("freshLeaseInvalid")
  )),
);
const freshExecutionClaim = projectPointCommitTransactionResult(
  deriveTransactionExecutionClaimV1({
    scopeUuid: clock.scopeUuid,
    sessionId: command.authorityPins.sessionId,
    attemptFence: replacementFence,
    claimFence: 1n,
    claimOwner: executionClaimOwner,
    databaseNow: new Date(mutationTimeMilliseconds),
    durationMilliseconds: executionClaimDurationMilliseconds,
    leaseExpiresAt: freshFacet.leaseExpiresAt,
    authorizationGrantExpiresAt: new Date(
      session.authorizationGrantExpiresAtMilliseconds,
    ),
    hardExpiresAt: new Date(session.hardExpiresAtMilliseconds),
  }).pipe(Result.mapError((reason) =>
    reason === "authorityExpired"
      ? stale("expired")
      : replacementCorruption("freshLeaseInvalid")
  )),
);

const retrying = tx.update(fxSystemTransactionSessions).set({
  lifecycle: "retrying",
  updatedAt: freshFacet.sessionUpdatedAt,
}).where(and(
  eq(fxSystemTransactionSessions.scopeUuid, clock.scopeUuid),
  eq(
    fxSystemTransactionSessions.sessionId,
    command.authorityPins.sessionId,
  ),
  eq(
    fxSystemTransactionSessions.attemptFence,
    command.authorityPins.attemptFence,
  ),
  eq(fxSystemTransactionSessions.lifecycle, sourceLifecycle),
)).returning({ lifecycle: fxSystemTransactionSessions.lifecycle });
observeReplacementQuery("enterRetrying", retrying, options);
const retryingRows = await replacementSqlCall(
  "enterRetrying",
  () => retrying,
);
if (retryingRows.length !== 1 || retryingRows[0]?.lifecycle !== "retrying") {
  throw replacementCorruption("replacementMutationInvalid");
}
await emitReplacementStep(options, command, "sessionEnteredRetrying");

const journalDelete = tx.delete(fxSystemTransactionJournals).where(and(
  eq(fxSystemTransactionJournals.scopeUuid, clock.scopeUuid),
  eq(
    fxSystemTransactionJournals.sessionId,
    command.authorityPins.sessionId,
  ),
  eq(
    fxSystemTransactionJournals.attemptFence,
    command.authorityPins.attemptFence,
  ),
)).returning({ attemptFence: fxSystemTransactionJournals.attemptFence,
  executionProfile: fxSystemTransactionJournals.executionProfile });
observeReplacementQuery("deleteRetryJournal", journalDelete, options);
const deletedJournal = await replacementSqlCall(
  "deleteRetryJournal",
  () => journalDelete,
);
const deletedRoot = deletedJournal[0];
if (
  deletedJournal.length !== 1 ||
  deletedRoot === undefined ||
  deletedRoot.attemptFence !== command.authorityPins.attemptFence
) {
  throw replacementCorruption("replacementMutationInvalid");
}
await emitReplacementStep(options, command, "journalDeleted");

const leaseDelete = tx.delete(fxSystemSnapshotLeases).where(and(
  eq(fxSystemSnapshotLeases.scopeUuid, clock.scopeUuid),
  eq(
    fxSystemSnapshotLeases.sessionId,
    command.authorityPins.sessionId,
  ),
  eq(
    fxSystemSnapshotLeases.attemptFence,
    command.authorityPins.attemptFence,
  ),
)).returning({ attemptFence: fxSystemSnapshotLeases.attemptFence });
observeReplacementQuery("deleteRetryLease", leaseDelete, options);
const deletedLease = await replacementSqlCall(
  "deleteRetryLease",
  () => leaseDelete,
);
if (
  deletedLease.length !== 1 ||
  deletedLease[0]?.attemptFence !== command.authorityPins.attemptFence
) {
  throw replacementCorruption("replacementMutationInvalid");
}
await emitReplacementStep(options, command, "leaseDeleted");

const fenceUpdate = tx.update(fxSystemTransactionSessions).set({
  attemptFence: replacementFence,
}).where(and(
  eq(fxSystemTransactionSessions.scopeUuid, clock.scopeUuid),
  eq(
    fxSystemTransactionSessions.sessionId,
    command.authorityPins.sessionId,
  ),
  eq(
    fxSystemTransactionSessions.attemptFence,
    command.authorityPins.attemptFence,
  ),
  eq(fxSystemTransactionSessions.lifecycle, "retrying"),
  eq(
    fxSystemTransactionSessions.updatedAt,
    freshFacet.sessionUpdatedAt,
  ),
)).returning({ attemptFence: fxSystemTransactionSessions.attemptFence });
observeReplacementQuery("advanceAttemptFence", fenceUpdate, options);
const advanced = await replacementSqlCall(
  "advanceAttemptFence",
  () => fenceUpdate,
);
if (advanced.length !== 1 || advanced[0]?.attemptFence !== replacementFence) {
  throw replacementCorruption("attemptFenceUpdateInvalid");
}
await emitReplacementStep(options, command, "attemptFenceAdvanced");

const leaseInsert = tx.insert(fxSystemSnapshotLeases)
  .values(freshFacet.lease)
  .returning({ attemptFence: fxSystemSnapshotLeases.attemptFence });
observeReplacementQuery("insertRetryLease", leaseInsert, options);
const insertedLease = await replacementSqlCall(
  "insertRetryLease",
  () => leaseInsert,
);
if (
  insertedLease.length !== 1 ||
  insertedLease[0]?.attemptFence !== replacementFence
) {
  throw replacementCorruption("freshLeaseInvalid");
}
await emitReplacementStep(options, command, "leaseInserted");

if (deletedRoot.executionProfile !== executionProfile) {
  throw replacementCorruption("replacementMutationInvalid");
}
const rootInsert = tx.insert(fxSystemTransactionJournals)
  .values({ ...freshFacet.journalRoot, journalFormat: SESSION_JOURNAL_FORMAT })
  .returning({ attemptFence: fxSystemTransactionJournals.attemptFence });
observeReplacementQuery("insertRetryJournalRoot", rootInsert, options);
const insertedRoot = await replacementSqlCall(
  "insertRetryJournalRoot",
  () => rootInsert,
);
if (
  insertedRoot.length !== 1 ||
  insertedRoot[0]?.attemptFence !== replacementFence
) {
  throw replacementCorruption("freshJournalRootInvalid");
}
await emitReplacementStep(options, command, "journalRootInserted");

const claimInsert = tx.insert(fxSystemTransactionExecutionClaims)
  .values(freshExecutionClaim)
  .returning({
    attemptFence: fxSystemTransactionExecutionClaims.attemptFence,
  });
observeReplacementQuery("insertRetryExecutionClaim", claimInsert, options);
const insertedClaim = await replacementSqlCall(
  "insertRetryExecutionClaim",
  () => claimInsert,
);
if (
  insertedClaim.length !== 1 ||
  insertedClaim[0]?.attemptFence !== replacementFence
) {
  throw replacementCorruption("replacementMutationInvalid");
}
await emitReplacementStep(options, command, "executionClaimInserted");

const runningUpdate = tx.update(fxSystemTransactionSessions).set({
  lifecycle: "running",
}).where(and(
  eq(fxSystemTransactionSessions.scopeUuid, clock.scopeUuid),
  eq(
    fxSystemTransactionSessions.sessionId,
    command.authorityPins.sessionId,
  ),
  eq(fxSystemTransactionSessions.attemptFence, replacementFence),
  eq(fxSystemTransactionSessions.lifecycle, "retrying"),
  eq(
    fxSystemTransactionSessions.updatedAt,
    freshFacet.sessionUpdatedAt,
  ),
)).returning({ lifecycle: fxSystemTransactionSessions.lifecycle });
observeReplacementQuery("enterRetryRunning", runningUpdate, options);
const running = await replacementSqlCall(
  "enterRetryRunning",
  () => runningUpdate,
);
if (running.length !== 1 || running[0]?.lifecycle !== "running") {
  throw replacementCorruption("replacementMutationInvalid");
}
await emitReplacementStep(options, command, "sessionRunning");
return replacementObservation(
  "replaced",
  command,
  replacementFence,
  Object.freeze({
    claimOwner: freshExecutionClaim.claimOwner,
    claimFence: freshExecutionClaim.claimFence,
    claimedAt: freshExecutionClaim.claimedAt.toISOString(),
    claimExpiresAt:
      freshExecutionClaim.claimExpiresAt.toISOString(),
  }),
);

}

async function requireNoFinishingExecutionClaim(
  tx: AppRowTransaction,
  clock: LockedPointCommitClockV1,
  command: PreparedPointMutationAttemptReplacementCommandV1,
  options: PointMutationAttemptReplacementOptionsV1,
): Promise<void> {
  const query = tx.select({
    claimFence: fxSystemTransactionExecutionClaims.claimFence,
  }).from(fxSystemTransactionExecutionClaims).where(and(
    eq(fxSystemTransactionExecutionClaims.scopeUuid, clock.scopeUuid),
    eq(
      fxSystemTransactionExecutionClaims.sessionId,
      command.authorityPins.sessionId,
    ),
    eq(
      fxSystemTransactionExecutionClaims.attemptFence,
      command.authorityPins.attemptFence,
    ),
  )).limit(2).for("update");
  observeReplacementQuery("validateFinishingClaimAbsence", query, options);
  const rows = await replacementSqlCall(
    "validateFinishingClaimAbsence",
    () => query,
  );
  if (rows.length !== 0) {
    throw replacementCorruption("finishingExecutionClaimPresent");
  }
}

async function observeReplacedPointMutationAttempt(
  tx: AppRowTransaction,
  clock: LockedPointCommitClockV1,
  command: PreparedPointCommitAuthorityCommandV1,
  session: LockedPointCommitSessionV1,
  options: PointMutationAttemptReplacementOptionsV1,
  metadataConflict?: Extract<PointCommitConflictCauseV1, { readonly kind: "metadata" }>,
): Promise<PointMutationAttemptReplacementObservationV1> {
  const expectedFence = command.authorityPins.attemptFence <
      MAX_TRANSACTION_ATTEMPT_FENCE
    ? TransactionAttemptFenceSchema.make(
        command.authorityPins.attemptFence + 1n,
      )
    : null;
  if (
    expectedFence === null ||
    session.attemptFence !== expectedFence ||
    session.lifecycle !== "running"
  ) {
    throw replacementCorruption("replacementConvergenceInvalid");
  }
  const leaseQuery = tx.select().from(fxSystemSnapshotLeases).where(and(
    eq(fxSystemSnapshotLeases.scopeUuid, clock.scopeUuid),
    eq(
      fxSystemSnapshotLeases.sessionId,
      command.authorityPins.sessionId,
    ),
  )).limit(2).for("update");
  observeReplacementQuery("validatePristineAttempt", leaseQuery, options);
  const leaseRows = await replacementSqlCall(
    "validatePristineAttempt",
    () => leaseQuery,
  );
  const lease = leaseRows[0];
  const leaseExpiresAtMilliseconds = lease === undefined
    ? undefined
    : finiteDateMilliseconds(lease.leaseExpiresAt);
  if (
    leaseRows.length !== 1 ||
    lease === undefined ||
    lease.scopeUuid !== clock.scopeUuid ||
    lease.sessionId !== command.authorityPins.sessionId ||
    lease.attemptFence !== expectedFence ||
    lease.snapshotEpochUuid !== clock.epochUuid ||
    lease.snapshotCommitSeq < command.authorityPins.snapshotToken.commitSeq ||
    lease.snapshotCommitSeq === command.authorityPins.snapshotToken.commitSeq && metadataConflict === undefined ||
    metadataConflict !== undefined && (clock.record.lastMetadataSequence <= metadataConflict.capturedMetadataWatermark ||
      clock.record.lastMetadataSequence < metadataConflict.lastChangedMetadataSequence) ||
    lease.snapshotCommitSeq > clock.record.lastCommitSeq ||
    leaseExpiresAtMilliseconds === undefined ||
    leaseExpiresAtMilliseconds <= session.updatedAtMilliseconds ||
    leaseExpiresAtMilliseconds >
      session.authorizationGrantExpiresAtMilliseconds ||
    leaseExpiresAtMilliseconds > session.hardExpiresAtMilliseconds
  ) {
    throw replacementCorruption("replacementConvergenceInvalid");
  }
  await emitReplacementStep(options, command, "leaseLocked");

  const rootQuery = tx.select().from(fxSystemTransactionJournals).where(and(
    eq(fxSystemTransactionJournals.scopeUuid, clock.scopeUuid),
    eq(
      fxSystemTransactionJournals.sessionId,
      command.authorityPins.sessionId,
    ),
    eq(fxSystemTransactionJournals.attemptFence, expectedFence),
  )).limit(2).for("update");
  observeReplacementQuery("validatePristineAttempt", rootQuery, options);
  const rootRows = await replacementSqlCall(
    "validatePristineAttempt",
    () => rootQuery,
  );
  const root = rootRows[0];
  if (rootRows.length !== 1 || root === undefined) {
    throw replacementCorruption("replacementConvergenceInvalid");
  }
  const expectedFacet = projectPointCommitTransactionResult(
    buildFreshTransactionAttemptFacetV1({
      scopeUuid: clock.scopeUuid,
      sessionId: command.authorityPins.sessionId,
      attemptFence: expectedFence,
      executionProfile: root.executionProfile,
      snapshotEpochUuid: lease.snapshotEpochUuid,
      snapshotCommitSeq: lease.snapshotCommitSeq,
      databaseNowMilliseconds: session.updatedAtMilliseconds,
      authorizationGrantExpiresAtMilliseconds:
        session.authorizationGrantExpiresAtMilliseconds,
      hardExpiresAtMilliseconds: session.hardExpiresAtMilliseconds,
      leaseDurationMilliseconds:
        leaseExpiresAtMilliseconds - session.updatedAtMilliseconds,
    }).pipe(Result.mapError(() =>
      replacementCorruption("replacementConvergenceInvalid")
    )),
  );
  if (
    leaseExpiresAtMilliseconds !==
      finiteDateMilliseconds(expectedFacet.leaseExpiresAt)
  ) {
    throw replacementCorruption("replacementConvergenceInvalid");
  }
  if (
    !isPristineFreshTransactionAttemptJournalRootV1(root, expectedFacet.journalRoot)
  ) {
    throw replacementCorruption("replacementConvergenceInvalid");
  }
  await emitReplacementStep(options, command, "journalRootLocked");

  const executionClaim = projectPointCommitTransactionResult(
    await lockExactTransactionExecutionClaimV1Result(tx, {
      scopeId: command.authorityPins.scopeId,
      scopeUuid: clock.scopeUuid,
      sessionId: command.authorityPins.sessionId,
      attemptFence: expectedFence,
    }),
  );

  const childrenQuery = tx.select({
    receiptExists: sql<boolean>`exists(
      select 1 from ${fxSystemTransactionJournalReceipts}
      where ${fxSystemTransactionJournalReceipts.scopeUuid} =
        ${clock.scopeUuid}
        and ${fxSystemTransactionJournalReceipts.sessionId} =
          ${command.authorityPins.sessionId}
        and ${fxSystemTransactionJournalReceipts.attemptFence} =
          ${expectedFence}
    )`,
    pointExists: sql<boolean>`exists(
      select 1 from ${fxSystemTransactionJournalPoints}
      where ${fxSystemTransactionJournalPoints.scopeUuid} = ${clock.scopeUuid}
        and ${fxSystemTransactionJournalPoints.sessionId} =
          ${command.authorityPins.sessionId}
        and ${fxSystemTransactionJournalPoints.attemptFence} =
          ${expectedFence}
    )`,
    indexRangeExists: sql<boolean>`exists(
      select 1 from ${fxSystemTransactionJournalIndexRanges}
      where ${fxSystemTransactionJournalIndexRanges.scopeUuid} = ${clock.scopeUuid}
        and ${fxSystemTransactionJournalIndexRanges.sessionId} =
          ${command.authorityPins.sessionId}
        and ${fxSystemTransactionJournalIndexRanges.attemptFence} =
          ${expectedFence}
    )`,
    relationExists: sql<boolean>`exists(
      select 1 from ${fxSystemTransactionJournalRelationIncomingDependencies}
      where ${fxSystemTransactionJournalRelationIncomingDependencies.scopeUuid} =
          ${clock.scopeUuid}
        and ${fxSystemTransactionJournalRelationIncomingDependencies.sessionId} =
          ${command.authorityPins.sessionId}
        and ${fxSystemTransactionJournalRelationIncomingDependencies.attemptFence} =
          ${expectedFence}
    )`,
    eventExists: sql<boolean>`exists(
      select 1 from ${fxSystemTransactionJournalWriteEvents}
      where ${fxSystemTransactionJournalWriteEvents.scopeUuid} =
        ${clock.scopeUuid}
        and ${fxSystemTransactionJournalWriteEvents.sessionId} =
          ${command.authorityPins.sessionId}
        and ${fxSystemTransactionJournalWriteEvents.attemptFence} =
          ${expectedFence}
    )`,
  }).from(fxSystemScopeClocks).where(eq(
    fxSystemScopeClocks.scopeId,
    command.authorityPins.scopeId,
  )).limit(1);
  observeReplacementQuery("validatePristineAttempt", childrenQuery, options);
  const children = await replacementSqlCall(
    "validatePristineAttempt",
    () => childrenQuery,
  );
  if (
    children.length !== 1 ||
    children[0]?.receiptExists !== false ||
    children[0]?.pointExists !== false ||
    children[0]?.indexRangeExists !== false ||
    children[0]?.relationExists !== false ||
    children[0]?.eventExists !== false
  ) {
    throw replacementCorruption("replacementConvergenceInvalid");
  }

  const databaseNowMilliseconds = await readPointCommitDatabaseTime(
    tx,
    command.authorityPins.scopeId,
    Object.freeze(
      options.observeQuery === undefined
        ? {}
        : { observeQuery: options.observeQuery },
    ),
  );
  if (session.updatedAtMilliseconds > databaseNowMilliseconds) {
    throw replacementCorruption("replacementConvergenceInvalid");
  }
  projectPointCommitTransactionResult(
    requireAttemptIsLiveResult(
      session,
      Object.freeze({
        expiresAtMilliseconds:
          finiteDateMilliseconds(expectedFacet.leaseExpiresAt) ?? 0,
      }),
      databaseNowMilliseconds,
    ),
  );
  projectPointCommitTransactionResult(
    requireLiveTransactionExecutionClaimV1Result(
      command.authorityPins.scopeId,
      executionClaim,
      undefined,
      new Date(databaseNowMilliseconds),
    ),
  );
  return replacementObservation("alreadyReplaced", command, expectedFence);
}

function replacementObservation(
  kind: PointMutationAttemptReplacementObservationV1["kind"],
  command: PreparedPointCommitAuthorityCommandV1,
  attemptFence: TransactionAttemptFence,
  executionClaim?: TransactionExecutionClaimObservationV1,
): PointMutationAttemptReplacementObservationV1 {
  const common = {
    scopeUuid: pointCommitCommandScopeUuid(command),
    sessionId: command.authorityPins.sessionId,
    previousAttemptFence: command.authorityPins.attemptFence,
    attemptFence,
  } as const;
  if (kind === "replaced") {
    if (executionClaim === undefined) {
      throw replacementCorruption("replacementMutationInvalid");
    }
    return Object.freeze({
      kind: "replaced",
      ...common,
      executionClaim: Object.freeze({ ...executionClaim }),
    });
  }
  return Object.freeze({ kind: "alreadyReplaced", ...common });
}

async function runPointCommitFinishingTransition(
  target: LocatedReadCommittedAttemptTargetV1,
  preliminaryAuthority: TrustedScopeAuthority,
  command: PreparedPointCommitFinishingTransitionCommandV1,
  options: PointCommitTransactionProofOptionsV1,
): Promise<PointCommitFinishingTransitionResultV1> {
  return target[RUN_LOCATED_READ_COMMITTED_V1](async (tx) => {
    const clock = await lockPointCommitClock(tx, command, options);
    await emitTransactionStep(options, command, "clockLocked");
    projectPointCommitTransactionResult(
      requireLockedClockAuthorityResult(
        clock,
        preliminaryAuthority,
        command,
      ),
    );

    const session = await lockPointCommitSession(
      tx,
      command,
      options,
      "enterFinishing",
    );
    await emitTransactionStep(options, command, "sessionLocked");
    const lease = await lockPointCommitLease(tx, command, options);
    await emitTransactionStep(options, command, "leaseLocked");
    await lockPointCommitJournalRoot(tx, command, options);
    await emitTransactionStep(options, command, "journalRootLocked");

    const databaseNowMilliseconds = await readPointCommitDatabaseTime(
      tx,
      command.authorityPins.scopeId,
      options,
    );
    projectPointCommitTransactionResult(
      requireAttemptIsLiveResult(session, lease, databaseNowMilliseconds),
    );
    projectPointCommitTransactionResult(
      requireFinishingSessionTimeResult(
        session.updatedAtMilliseconds,
        databaseNowMilliseconds,
      ),
    );
    const priorSessionUpdatedAtMilliseconds =
      command.session.updatedAtMilliseconds;
    if (session.lifecycle === "finishing") {
      const claims = await tx.select({
        claimFence: fxSystemTransactionExecutionClaims.claimFence,
      }).from(fxSystemTransactionExecutionClaims).where(and(
        eq(
          fxSystemTransactionExecutionClaims.scopeUuid,
          command.sealIdentity.scopeUuid,
        ),
        eq(
          fxSystemTransactionExecutionClaims.sessionId,
          command.authorityPins.sessionId,
        ),
        eq(
          fxSystemTransactionExecutionClaims.attemptFence,
          command.authorityPins.attemptFence,
        ),
      )).limit(2).for("update");
      projectPointCommitTransactionResult(
        requireNoFinishingExecutionClaimResult(claims),
      );
      return finishingTransitionResult(
        "observed",
        command,
        priorSessionUpdatedAtMilliseconds,
        session.updatedAtMilliseconds,
      );
    }
    const executionClaim = projectPointCommitTransactionResult(
      await lockExactTransactionExecutionClaimV1Result(tx, {
        scopeId: command.authorityPins.scopeId,
        scopeUuid: command.sealIdentity.scopeUuid,
        sessionId: command.authorityPins.sessionId,
        attemptFence: command.authorityPins.attemptFence,
      }),
    );
    await emitTransactionStep(options, command, "executionClaimLocked");
    projectPointCommitTransactionResult(
      requireLiveTransactionExecutionClaimV1Result(
        command.authorityPins.scopeId,
        executionClaim,
        command.executionClaim,
        new Date(databaseNowMilliseconds),
      ),
    );
    const deleteClaim = tx.delete(fxSystemTransactionExecutionClaims).where(
      and(
        eq(
          fxSystemTransactionExecutionClaims.scopeUuid,
          command.sealIdentity.scopeUuid,
        ),
        eq(
          fxSystemTransactionExecutionClaims.sessionId,
          command.authorityPins.sessionId,
        ),
        eq(
          fxSystemTransactionExecutionClaims.attemptFence,
          command.authorityPins.attemptFence,
        ),
        eq(
          fxSystemTransactionExecutionClaims.claimOwner,
          command.executionClaim.claimOwner,
        ),
        eq(
          fxSystemTransactionExecutionClaims.claimFence,
          command.executionClaim.claimFence,
        ),
      ),
    ).returning({
      claimFence: fxSystemTransactionExecutionClaims.claimFence,
    });
    observeDrizzleQuery("deleteExecutionClaim", deleteClaim, options);
    const deletedClaims = await sqlCall(
      "deleteExecutionClaim",
      () => deleteClaim,
    );
    projectPointCommitTransactionResult(
      validateDeletedFinishingExecutionClaimResult(
        deletedClaims,
        command.executionClaim.claimFence,
      ),
    );
    await emitTransactionStep(options, command, "executionClaimDeleted");
    const finishingUpdatedAt = new Date(databaseNowMilliseconds);
    const query = tx
      .update(fxSystemTransactionSessions)
      .set({ lifecycle: "finishing", updatedAt: finishingUpdatedAt })
      .where(and(
        eq(
          fxSystemTransactionSessions.scopeUuid,
          command.sealIdentity.scopeUuid,
        ),
        eq(
          fxSystemTransactionSessions.sessionId,
          command.authorityPins.sessionId,
        ),
        eq(
          fxSystemTransactionSessions.attemptFence,
          command.authorityPins.attemptFence,
        ),
        eq(fxSystemTransactionSessions.lifecycle, "running"),
      ))
      .returning({
        lifecycle: fxSystemTransactionSessions.lifecycle,
        updatedAt: fxSystemTransactionSessions.updatedAt,
      });
    observeDrizzleQuery("enterFinishing", query, options);
    const rows = await sqlCall("enterFinishing", () => query);
    const updatedAtMilliseconds = projectPointCommitTransactionResult(
      materializeEnteredFinishingSessionResult(
        rows,
        databaseNowMilliseconds,
      ),
    );
    await emitTransactionStep(options, command, "sessionEnteredFinishing");
    return finishingTransitionResult(
      "transitioned",
      command,
      priorSessionUpdatedAtMilliseconds,
      updatedAtMilliseconds,
    );
  });
}

function requireFinishingSessionTimeResult(
  sessionUpdatedAtMilliseconds: number,
  databaseNowMilliseconds: number,
): Result.Result<void, PointCommitCorruptionV1Error> {
  return sessionUpdatedAtMilliseconds <= databaseNowMilliseconds
    ? Result.succeed(undefined)
    : Result.fail(corruption("finishingTransitionInvalid"));
}

function requireNoFinishingExecutionClaimResult(
  claims: ReadonlyArray<unknown>,
): Result.Result<void, PointCommitCorruptionV1Error> {
  return claims.length === 0
    ? Result.succeed(undefined)
    : Result.fail(corruption("finishingTransitionInvalid"));
}

function validateDeletedFinishingExecutionClaimResult(
  deletedClaims: ReadonlyArray<Readonly<{ readonly claimFence: bigint }>>,
  expectedClaimFence: bigint,
): Result.Result<void, PointCommitCorruptionV1Error> {
  return deletedClaims.length === 1 &&
      deletedClaims[0]?.claimFence === expectedClaimFence
    ? Result.succeed(undefined)
    : Result.fail(corruption("finishingTransitionInvalid"));
}

function materializeEnteredFinishingSessionResult(
  rows: ReadonlyArray<Readonly<{
    readonly lifecycle: string;
    readonly updatedAt: Date;
  }>>,
  databaseNowMilliseconds: number,
): Result.Result<number, PointCommitCorruptionV1Error> {
  const updated = rows[0];
  const updatedAtMilliseconds = updated === undefined
    ? undefined
    : finiteDateMilliseconds(updated.updatedAt);
  return rows.length === 1 &&
      updated !== undefined &&
      updated.lifecycle === "finishing" &&
      updatedAtMilliseconds !== undefined &&
      updatedAtMilliseconds === databaseNowMilliseconds
    ? Result.succeed(updatedAtMilliseconds)
    : Result.fail(corruption("finishingTransitionInvalid"));
}

function finishingTransitionResult(
  kind: PointCommitFinishingTransitionResultV1["kind"],
  command: PreparedPointCommitFinishingTransitionCommandV1,
  priorSessionUpdatedAtMilliseconds: number,
  finishingSessionUpdatedAtMilliseconds: number,
): PointCommitFinishingTransitionResultV1 {
  return Object.freeze({
    kind,
    scopeUuid: command.sealIdentity.scopeUuid,
    sessionId: command.authorityPins.sessionId,
    attemptFence: command.authorityPins.attemptFence,
    priorSessionUpdatedAtMilliseconds,
    finishingSessionUpdatedAtMilliseconds,
  });
}

async function runRollbackProof(
  target: LocatedReadCommittedAttemptTargetV1,
  preliminaryAuthority: TrustedScopeAuthority,
  command: PreparedPointCommitTransactionCommandV1,
  intrinsicDefinitions: ReadonlyArray<LocatedAppIndexDefinitionV1>,
  developerDefinitions: ReadonlyArray<LocatedAppIndexDefinitionV1>,
  uniqueDefinitions: ReadonlyArray<LocatedAppUniqueConstraintDefinitionV1>,
  applicationRelations: PreparedPointCommitApplicationRelations | null,
  candidateSchemaWriteGuard:
    PreparedPointCommitCandidateSchemaWriteGuard | null,
  options: PointCommitTransactionProofOptionsV1,
): Promise<PointCommitWouldCommitV1> {
  try {
    await target[RUN_LOCATED_READ_COMMITTED_V1](async (tx) => {
    try {
      await runPointCommitTransactionKernel(
        tx,
        target,
        preliminaryAuthority,
        command,
        intrinsicDefinitions,
        developerDefinitions,
        uniqueDefinitions,
        applicationRelations,
        candidateSchemaWriteGuard,
        options,
        "rollbackProof",
      );
      await emitTransactionStep(options, command, "beforeRollback");
      throw ROLLBACK_SENTINEL;
    } finally { closeExactAttemptScopeClockObservation(tx); }
    });
  } catch (cause) {
    if (cause === ROLLBACK_SENTINEL) return WOULD_COMMIT;
    if (
      cause instanceof LocatedReadCommittedTransactionFailureV1 &&
      cause.issue.kind === "callbackRolledBack" &&
      cause.issue.callbackCause === ROLLBACK_SENTINEL
    ) {
      return WOULD_COMMIT;
    }
    throw cause;
  }
  throw corruption("rollbackSentinelMissing");
}

async function runPointCommitPublication(
  target: LocatedPointCommitPublicationTargetV1,
  preliminaryAuthority: TrustedScopeAuthority,
  command: PreparedPointCommitPublicationCommandV1,
  intrinsicDefinitions: ReadonlyArray<LocatedAppIndexDefinitionV1>,
  developerDefinitions: ReadonlyArray<LocatedAppIndexDefinitionV1>,
  uniqueDefinitions: ReadonlyArray<LocatedAppUniqueConstraintDefinitionV1>,
  applicationRelations: PreparedPointCommitApplicationRelations | null,
  candidateSchemaWriteGuard:
    PreparedPointCommitCandidateSchemaWriteGuard | null,
  options: PointCommitTransactionProofOptionsV1,
): Promise<PointCommitPublicationDecisionV1> {
  return observePointCommitPublicationPromise(options.publicationObservation, "transaction", () =>
    target[RUN_LOCATED_READ_COMMITTED_V1](async (tx) => {
    try {
    const kernel = await runPointCommitTransactionKernel(
      tx,
      target,
      preliminaryAuthority,
      command,
      intrinsicDefinitions,
      developerDefinitions,
      uniqueDefinitions,
      applicationRelations,
      candidateSchemaWriteGuard,
      options,
      "publish",
    );
    if (kernel.kind === "existing") return kernel;
    const ready = projectPointCommitTransactionResult(
      requirePointCommitReadyForPublicationResult(kernel),
    );
    await observePointCommitPublicationPromise(options.publicationObservation, "durablePublication", () => publishPointCommitInTransaction(
      tx,
      command,
      ready,
      options,
    ));
    await emitTransactionStep(options, command, "beforeCommit");
    return Object.freeze({
      kind: "published",
      token: Object.freeze({
        scopeUuid: ready.clock.scopeUuid,
        epochUuid: ready.clock.epochUuid,
        commitSeq: ready.commitSeq,
      }),
    });
    } finally { closeExactAttemptScopeClockObservation(tx); }
  }));
}

/**
 * The reusable O06/O07-B transaction body. Rollback-proof mode exits through
 * the private sentinel after this exact validation/lowering path; publication
 * mode continues to the O07-B atoms and is the first durable caller allowed to
 * return normally from the transaction.
 */
async function runPointCommitTransactionKernel(
  tx: AppRowTransaction,
  target: LocatedReadCommittedAttemptTargetV1,
  preliminaryAuthority: TrustedScopeAuthority,
  command: PreparedPointCommitTransactionCommandV1,
  intrinsicDefinitions: ReadonlyArray<LocatedAppIndexDefinitionV1>,
  developerDefinitions: ReadonlyArray<LocatedAppIndexDefinitionV1>,
  uniqueDefinitions: ReadonlyArray<LocatedAppUniqueConstraintDefinitionV1>,
  applicationRelations: PreparedPointCommitApplicationRelations | null,
  candidateSchemaWriteGuard:
    PreparedPointCommitCandidateSchemaWriteGuard | null,
  options: PointCommitTransactionProofOptionsV1,
  mode: PointCommitTransactionModeV1,
): Promise<PointCommitKernelResultV1> {
  // Only lifecycle-stable metadata may be read before publication exclusion.
  // Session/build locks stay below the upgrade: their other owners are clock-first.
  const admissionClock = await observePointCommitPublicationPromise(options.publicationObservation, "lifecycleAcceptance", () => lockPointCommitClock(
    tx, command, options, "key share",
  ));
  await emitTransactionStep(options, command, "lifecycleProtected");
  if (
    mode === "publish" &&
    projectPointCommitTransactionResult(await runPointCommitInTransactionEffect(
      // The shared resolver captures the outcome and its ceiling in one query.
      // admissionClock may precede a concurrent duplicate's publication.
      createCommittedPointOutcomeResolverV1(tx).resolve(
        captureCommittedOutcomeLookup(command),
      ).pipe(
        Effect.mapError(error => error instanceof CommittedPointOutcomeSqlErrorV1
          ? new PointCommitSqlFailureMarkerV1("recheckOutcome", error.cause)
          : error),
      ),
    )).kind !== "missing"
  ) {
    await emitTransactionStep(options, command, "outcomeRechecked");
    return Object.freeze({ kind: "existing" });
  }
  projectPointCommitTransactionResult(
    requireLockedClockAuthorityResult(
      admissionClock, preliminaryAuthority, command,
    ),
  );
  projectPointCommitTransactionResult(await runPointCommitInTransactionEffect(
    observePointCommitPublicationEffect(options.publicationObservation, "lifecycleAcceptance", validateApplicationWriteOwnershipForCommit(tx, { scopeId: command.authorityPins.scopeId,
      generation: command.authorityPins.executionAuthorityGeneration,
      authenticatedAttemptedTables: command.attemptedTableIds,
      materialTables: command.rowIntents.filter(row => !command.participantMaterialDocumentIds.has(row.documentId))
        .map(row => row.tableId) }, options.uniqueConstraints, target).pipe(
      Effect.mapError(error => error.reason === "resourceFailure"
        ? new PointCommitSqlFailureMarkerV1("validateActiveApplicationSchema", error.cause ?? error)
        : corruption(error.reason === "writeDenied" ? "applicationWritePolicyDenied" : "applicationWritePolicyEvidenceInvalid")))),
  ));
  await observePointCommitPublicationPromise(options.publicationObservation, "lifecycleAcceptance", () => validateActiveRelationSelectionForPointCommit(tx, command));
  if (command.relationDependencies.length > 0) {
    await emitTransactionStep(
      options,
      command,
      "activeRelationSelectionValidated",
    );
  }
  const validatedApplicationRelations =
    command.finiteMetadataReservationSha256Hex !== null ? preparedApplicationRelationsForFiniteCommit(applicationRelations) :
    await observePointCommitPublicationPromise(options.publicationObservation, "lifecycleAcceptance", () => validateActiveApplicationSchemaForPointCommit(
    tx,
    command,
    applicationRelations,
    options,
  ));
  if (
    validatedApplicationRelations !== null &&
    command.authorityPins.executionAuthorityGeneration === "application_v1"
  ) {
    await emitTransactionStep(options, command, "relationBindingValidated");
  }
  if (command.authorityPins.executionAuthorityGeneration === "application_v1") {
    await emitTransactionStep(
      options,
      command,
      "activeApplicationSchemaValidated",
    );
  }
  const clock = await observePointCommitPublicationPromise(options.publicationObservation, "lockedAttemptAcceptance", () => lockPointCommitClock(tx, command, options));
  await emitTransactionStep(options, command, "clockLocked");
  if (
    mode === "publish" &&
    await inspectCommittedOutcomeInTransaction(tx, clock, command, options) !== null
  ) {
    await emitTransactionStep(options, command, "outcomeRechecked");
    return Object.freeze({ kind: "existing" });
  }
  projectPointCommitTransactionResult(
    requireLockedClockAuthorityResult(clock, preliminaryAuthority, command),
  );
  const intrinsicBuilds = await observePointCommitPublicationPromise(options.publicationObservation, "lockedAttemptAcceptance", () => lockPointCommitIntrinsicIndexBuilds(
    tx,
    clock,
    intrinsicDefinitions,
    command,
  ));
  if (intrinsicBuilds.length > 0) {
    await emitTransactionStep(options, command, "intrinsicIndexBuildLocked");
  }
  const developerBuilds = await observePointCommitPublicationPromise(options.publicationObservation, "lockedAttemptAcceptance", () => lockPointCommitDeveloperIndexBuilds(
    tx,
    clock,
    developerDefinitions,
    command,
  ));
  if (developerBuilds.length > 0) {
    await emitTransactionStep(options, command, "developerIndexBuildLocked");
  }

  const session = await observePointCommitPublicationPromise(options.publicationObservation, "lockedAttemptAcceptance", () => lockPointCommitSession(
    tx,
    command,
    options,
    mode,
  ));
  await emitTransactionStep(options, command, "sessionLocked");
  const lease = await observePointCommitPublicationPromise(options.publicationObservation, "lockedAttemptAcceptance", () => lockPointCommitLease(tx, command, options));
  await emitTransactionStep(options, command, "leaseLocked");
  await observePointCommitPublicationPromise(options.publicationObservation, "lockedAttemptAcceptance", () => lockPointCommitJournalRoot(tx, command, options));
  await emitTransactionStep(options, command, "journalRootLocked");

  const databaseNowMilliseconds = await observePointCommitPublicationPromise(options.publicationObservation, "lockedAttemptAcceptance", () => readPointCommitDatabaseTime(
    tx,
    command.authorityPins.scopeId,
    options,
  ));
  projectPointCommitTransactionResult(
    requireAttemptIsLiveResult(session, lease, databaseNowMilliseconds),
  );
  const finiteReservation = command.finiteMetadataReservationSha256Hex === null ? null :
    projectPointCommitTransactionResult(await runPointCommitInTransactionEffect(requireFinitePointCommitReservation(command, lease.row)));
  if (finiteReservation !== null) projectPointCommitTransactionResult(await runPointCommitInTransactionEffect(
    validateConsumedMetadataDependencies(tx, command.authorityPins.scopeId, finiteReservation.metadataWatermark, command.metadataDependencies)
      .pipe(Effect.mapError(error => error.reason === "writeConflict" && error.dependency !== undefined &&
        error.capturedMetadataWatermark !== undefined && error.lastChangedMetadataSequence !== undefined
        ? new PointCommitConflictV1Error({ conflict: { kind: "metadata", ...error.dependency,
          capturedMetadataWatermark: error.capturedMetadataWatermark, lastChangedMetadataSequence: error.lastChangedMetadataSequence },
          snapshotCommitSeq: command.authorityPins.snapshotToken.commitSeq, currentCommitSeq: clock.record.lastCommitSeq })
        : error.reason === "resourceFailure" ? new PointCommitSqlFailureMarkerV1("validateIndexRanges", error.cause ?? error)
          : corruption("dependencySetInvalid")))));

  const admittedParticipants = await observePointCommitPublicationPromise(options.publicationObservation, "participantProof", () =>
    validateAdmittedParticipantOperations(tx, preliminaryAuthority, command, clock.record,
      developerDefinitions, uniqueDefinitions, options, finiteReservation));

  let loadedHeads: ReadonlyArray<LoadedPointCommitHeadV1>;
  options.publicationObservation?.record({ kind: "phase", phase: "occProof", edge: "begin" });
  try {
    loadedHeads = await loadPointCommitHeads(
      tx,
      clock,
      command,
      options,
    );
    projectPointCommitTransactionResult(
      validatePointCommitDependenciesResult(command, loadedHeads),
    );
    const rangeConflict = await findPointCommitIndexRangeConflict(
      tx,
      clock,
      command,
    );
    if (rangeConflict !== null) throw rangeConflict;
    const relationConflict = await findPointCommitRelationConflict(
      tx,
      clock,
      command,
      options,
    );
    if (relationConflict !== null) throw relationConflict;
  } finally {
    options.publicationObservation?.record({ kind: "phase", phase: "occProof", edge: "end" });
  }
  await emitTransactionStep(options, command, "dependenciesValidated");

  if (mode === "rollbackProof" && command.rowIntents.length === 0) {
    return Object.freeze({
      kind: "ready",
      clock,
      commitSeq: null,
      publicationTimeMilliseconds: null,
      relationAdjacencyChanges: Object.freeze([]),
    });
  }
  const preWriteDatabaseNowMilliseconds = await observePointCommitPublicationPromise(options.publicationObservation, "lockedAttemptAcceptance", () => readPointCommitDatabaseTime(
    tx,
    command.authorityPins.scopeId,
    options,
  ));
  projectPointCommitTransactionResult(
    requireAttemptIsLiveResult(
      session,
      lease,
      preWriteDatabaseNowMilliseconds,
    ),
  );
  return lowerAcceptedPointCommit(tx, command, clock, loadedHeads, intrinsicBuilds, developerBuilds,
    developerDefinitions, uniqueDefinitions, validatedApplicationRelations, candidateSchemaWriteGuard, preliminaryAuthority,
    preWriteDatabaseNowMilliseconds, admittedParticipants, options);
}


/** Application and finite settlement share one row/index/unique/relation lowering owner.
 * The command carries material graph facts; no durable seal is needed here. */
async function lowerAcceptedPointCommit(
  tx: AppRowTransaction,
  command: import("./applicationDocumentMaterialization/model").ApplicationDocumentMaterializationCommand & Readonly<{
    attemptedTableIds: readonly CatalogTableId[] | null; participantMaterialDocumentIds: ReadonlySet<string>;
  }>,
  clock: LockedPointCommitClockV1,
  loadedHeads: readonly LoadedPointCommitHeadV1[],
  intrinsicBuilds: Awaited<ReturnType<typeof lockPointCommitIntrinsicIndexBuilds>>,
  developerBuilds: Awaited<ReturnType<typeof lockPointCommitDeveloperIndexBuilds>>,
  developerDefinitions: readonly LocatedAppIndexDefinitionV1[],
  uniqueDefinitions: readonly LocatedAppUniqueConstraintDefinitionV1[],
  validatedApplicationRelations: LocatedPreparedPointCommitApplicationRelations | null,
  candidateSchemaWriteGuard: PreparedPointCommitCandidateSchemaWriteGuard | null,
  preliminaryAuthority: TrustedScopeAuthority,
  preWriteDatabaseNowMilliseconds: number,
  admittedParticipants: readonly Readonly<{search: readonly LogicalSearchDefinition[]}>[],
  options: PointCommitTransactionProofOptionsV1,
  finitePredecessors?: Readonly<{
    freshHeads: import("./applicationDocumentMaterialization/model").FinitePointCommitHeads;
    documentSettlement: PreparedApplicationDocumentSettlement;
    capturedCoverage?: CapturedApplicationMaterializationCoverage;
  }>,
): Promise<PointCommitKernelResultV1> {
  options.publicationObservation?.record({ kind: "phase", phase: "lowering", edge: "begin" });
  try {
    const allocation = projectPointCommitTransactionResult(
      allocatePointCommitKernelResult(
        clock,
        preWriteDatabaseNowMilliseconds,
      ),
    );
    const preparation = finitePredecessors === undefined
      ? { kind: "ordinary" as const, priorState: projectPointCommitTransactionResult(await runPointCommitInTransactionEffect(
        observePointCommitPublicationEffect(options.publicationObservation, "priorDocuments", loadApplicationDocumentPriorState(
          tx, command, loadedHeads, developerBuilds, uniqueDefinitions, validatedApplicationRelations, options)))) }
      : { kind: "finite" as const, settlement: finitePredecessors.documentSettlement, freshHeads: finitePredecessors.freshHeads };
    if (preparation.kind === "finite")
      projectPointCommitTransactionResult(await runPointCommitInTransactionEffect(observePointCommitPublicationEffect(
        options.publicationObservation, "priorDocuments", acceptPreparedApplicationOriginalsEffect(command,
          preparation.freshHeads, preparation.settlement, developerBuilds, uniqueDefinitions, validatedApplicationRelations))));
    const developerIndexActions = await observePointCommitPublicationPromise(options.publicationObservation, "developerIndexPreparation", () =>
      preparation.kind === "ordinary" ? preparePointCommitDeveloperIndexActions(tx, command, preparation.priorState, developerBuilds)
        : runPointCommitInTransactionEffect(acceptPreparedApplicationDeveloperTransitionsEffect(tx, preparation.settlement, developerBuilds))
          .then(result => projectPointCommitTransactionResult(result)));
    const uniquePreparation = await observePointCommitPublicationPromise(options.publicationObservation, "uniquePreparation", async () => {
      if (preparation.kind === "ordinary")
        return preparePointCommitUniqueKeyActions(tx, command, preparation.priorState, uniqueDefinitions, clock.record.epoch);
      const actions = projectPointCommitTransactionResult(await runPointCommitInTransactionEffect(
        acceptPreparedApplicationUniqueOwnersEffect(tx, preparation.settlement, clock.record.epoch)));
      const unique = preparation.settlement.unique;
      if (unique === undefined) throw new Error("Accepted finite unique planning was not reached");
      if (Exit.isFailure(unique)) return projectPointCommitTransactionResult(await runPointCommitInTransactionEffect(Effect.failCause(unique.cause)));
      return Object.freeze({ actions, pairs: unique.value });
    });
    const relationPlan = await observePointCommitPublicationPromise(options.publicationObservation, "relationPreparation", () =>
      preparation.kind === "ordinary" ? preparePointCommitApplicationRelationPlan(tx, command, preparation.priorState,
        validatedApplicationRelations, clock.record.lastCommitSeq, options)
        : runPointCommitInTransactionEffect(acceptPreparedApplicationRelationsEffect(tx, preparation.settlement, clock.record.lastCommitSeq, options))
          .then(result => projectPointCommitTransactionResult(result)));
    if (
      relationPlan !== null &&
      relationPlan.prepared.distinctFinalTargetCount > 0
    ) {
      await emitTransactionStep(options, command, "relationTargetsValidated");
    }
    if (candidateSchemaWriteGuard !== null) {
      const guardResult = projectPointCommitTransactionResult(await runPointCommitInTransactionEffect(runCandidateSchemaWriteGuard(
        tx,
        candidateSchemaWriteGuard,
        preliminaryAuthority,
        clock.record,
        allocation.commitSeq,
        command.rowIntents.flatMap((intent) => intent.kind === "live" &&
          !command.participantMaterialDocumentIds.has(intent.documentId)
          ? [Object.freeze({
              tableId: intent.tableId,
              rowId: intent.rowId,
              document: intent.document,
            })]
          : []),
      )));
      if (guardResult.status === "candidateFailed") {
        await emitTransactionStep(
          options,
          command,
          "candidateSchemaValidationFailed",
        );
      }
    }
    const applicationTables = new Set(command.attemptedTableIds ?? []);
    const indexPublicationProfile = command.participantMaterialDocumentIds.size === 0 ? "activeApplication" as const :
      Object.freeze({ kind: "mixedSelectedSources" as const, activeApplicationTables: applicationTables,
        activeApplicationDeveloperIndexDefinitionIds: new Set(developerDefinitions.filter(definition =>
          definition.access.kind === "developer" && applicationTables.has(definition.access.tableId))
          .map(definition => definition.indexDefinitionId)) });
    const searchContribution = admittedParticipants.length === 0 ? undefined : Result.gen(function* () {
      const searchByIdentity = new Map<string, LogicalSearchDefinition>();
      for (const member of admittedParticipants) for (const definition of member.search) {
        const key = `${definition.tableId}:${definition.logicalIndexId}`;
        const prior = searchByIdentity.get(key);
        if (prior !== undefined && prior.sourceSha256 !== definition.sourceSha256)
          return yield* Result.fail(corruption("developerIndexBuildInvalid"));
        searchByIdentity.set(key, definition);
      }
      return Object.freeze({ definitions: Object.freeze([...searchByIdentity.values()]),
        changes: Object.freeze(command.rowIntents.filter(row => command.participantMaterialDocumentIds.has(row.documentId))) });
    });
    const capturedCoverage = finitePredecessors?.capturedCoverage;
    const preparedIntrinsic = preparation.kind === "finite" ? preparation.settlement.intrinsic : undefined;
    if (preparation.kind === "finite" && preparedIntrinsic === undefined)
      throw new Error("Finite intrinsic planning was not reached");
    try {
      await materializeApplicationDocumentRows(tx, {
        command, commitSeq: allocation.commitSeq, clock: clock.record,
        loadedHeads, intrinsicBuilds, developerIndexActions, developerBuilds,
        uniqueKeyActions: uniquePreparation.actions, uniqueDefinitions, canonicalUniquePairs: uniquePreparation.pairs,
        publicationProfile: indexPublicationProfile, options,
        ...(capturedCoverage === undefined ? {} : { capturedCoverage }),
        ...(searchContribution === undefined ? {} : { searchContribution }),
        ...(preparedIntrinsic === undefined ? {} : { preparedIntrinsic }),
      });
    } catch (cause) {
      // The shared owner preserves search failures; this Promise settlement
      // boundary retains the finite publisher's existing error contract.
      if (cause instanceof LogicalSearchMaintenanceError)
        throw cause.reason === "statementFailure"
          ? new PointCommitSqlFailureMarkerV1("writeCommitChange", cause.cause ?? cause)
          : corruption("rowWriteInvalid");
      throw cause;
    }
    if (relationPlan !== null) {
      const relationMaintenance = await runPointCommitInTransactionEffect(
        observePointCommitPublicationEffect(options.publicationObservation, "relationWrites", maintainPointCommitApplicationRelationsEffect(
          tx,
          command,
          allocation.commitSeq,
          relationPlan,
          options,
        )),
      );
      projectPointCommitTransactionResult(relationMaintenance);
    }
    await resetPointCommitDeveloperIndexValidations(tx, developerBuilds.map(developer => developer.build), options.publicationObservation);
    return Object.freeze({
      kind: "ready",
      clock,
      relationAdjacencyChanges:
        relationPlan?.prepared.adjacencyChanges ?? Object.freeze([]),
      ...allocation,
    });
  } finally {
    options.publicationObservation?.record({ kind: "phase", phase: "lowering", edge: "end" });
  }
}

/** Reconstruct participant authority from trusted publisher composition. This
 * runs for both live settlement and finish-only recovery under the same scope
 * and journal locks, without invoking any framework callback. */
async function validateParticipantPointCorrelation(
  tx: AppRowTransaction, command: PreparedPointCommitTransactionCommandV1,
): Promise<void> {
  const journal = command.participantJournal;
  if (journal === null) throw corruption("commandInvalid");
  if (journal.operationUsage.receiptEvidenceBytes !== command.sealIdentity.receiptEvidenceBytes ||
    journal.operationUsage.participantWorkBytes !== command.sealIdentity.participantWorkBytes ||
    journal.operationUsage.participantWorkCalls !== command.sealIdentity.participantWorkCalls)
    throw corruption("occEvidenceInvalid");
  const query = tx.select().from(fxSystemTransactionJournalPoints).where(and(
    eq(fxSystemTransactionJournalPoints.scopeUuid, command.sealIdentity.scopeUuid),
    eq(fxSystemTransactionJournalPoints.sessionId, command.authorityPins.sessionId),
    eq(fxSystemTransactionJournalPoints.attemptFence, command.authorityPins.attemptFence),
  )).limit(MAX_COMMIT_POINT_READ_DEPENDENCIES_V1 + 1);
  const rows = await sqlCall("validateParticipantEvidence", () => query);
  if (rows.length > MAX_COMMIT_POINT_READ_DEPENDENCIES_V1) throw corruption("occEvidenceInvalid");
  const points: ParticipantPointCorrelation[] = [];
  for (const row of rows) {
    const rowId = projectPointCommitTransactionResult(appRowIdHexV1FromBytesResult(row.rowId)
      .pipe(Result.mapError(() => corruption("occEvidenceInvalid"))));
    const tableId = projectPointCommitTransactionResult(decodePointCommitEncodedTableIdResult(row.tableId)
      .pipe(Result.mapError(() => corruption("occEvidenceInvalid"))));
    const documentId = appDocumentIdV1FromRowIdentity({ tableId, rowId });
    const revision = row.dependencyRevisionCommitSeq === null ? null : projectPointCommitTransactionResult(
      decodePointCommitRetainedFloorResult(row.dependencyRevisionCommitSeq)
        .pipe(Result.mapError(() => corruption("occEvidenceInvalid"))));
    const observed: ParticipantPointCorrelation["observed"] = row.dependencyKind === "present" && revision !== null
      ? { kind: "present", revisionCommitSeq: revision }
      : row.dependencyKind === "missing_tombstone" && revision !== null
        ? { kind: "missing", basis: { kind: "tombstone", revisionCommitSeq: revision } }
        : row.dependencyKind === "missing_no_visible_revision" && revision === null
          ? { kind: "missing", basis: { kind: "noVisibleRevision" } }
          : (() => { throw corruption("occEvidenceInvalid"); })();
    points.push(Object.freeze({ documentId, tableId, observed, overlayKind: row.overlayKind,
      overlayValueJson: row.overlayValueJson }));
  }
  projectPointCommitTransactionResult(await runPointCommitInTransactionEffect(
    verifyParticipantPointCorrelationEffect(journal, points)
      .pipe(Effect.mapError(() => corruption("occEvidenceInvalid")))));
  const pointById = new Map(points.map(point => [point.documentId, point] as const));
  const firstBefore = new Map<SourceContribution["effects"][number]["documentId"],
    SourceContribution["effects"][number]>();
  for (const operation of journal.participantOperations)
    for (const effect of operation.sourceContributions.flatMap(source => source.effects)
      .toSorted((left, right) => left.effectOrdinal - right.effectOrdinal))
    if (!firstBefore.has(effect.documentId)) firstBefore.set(effect.documentId, effect);
  const rowById = new Map(command.rowIntents.map(row => [row.documentId, row] as const));
  const selected = [...firstBefore];
  for (let offset = 0; offset < selected.length;) {
    const firstEntry = selected[offset];
    if (firstEntry === undefined) throw corruption("occEvidenceInvalid");
    const tableId = firstEntry[1].tableId;
    const batch: typeof selected = [];
    while (offset < selected.length && batch.length < 32) {
      const entry = selected[offset];
      if (entry === undefined || entry[1].tableId !== tableId) break;
      const intent = rowById.get(entry[0]);
      if (intent === undefined || intent.tableId !== tableId || !pointById.has(entry[0])) {
        if (batch.length === 0) throw corruption("occEvidenceInvalid");
        break;
      }
      batch.push(entry);
      offset++;
    }
    let ordinal = 0;
    projectPointCommitTransactionResult(await runPointCommitInTransactionEffect(
      consumeAppRowSnapshotRevisionsInTransactionEffect(tx, {
        scopeId: command.authorityPins.scopeId, tableId,
        rowIds: batch.map(([documentId]) => rowById.get(documentId)!.rowId),
        snapshotCommitSeq: command.authorityPins.snapshotToken.commitSeq,
      }, error => error instanceof AppRowReadPersistenceError
        ? new PointCommitSqlFailureMarkerV1("validateParticipantEvidence", error.cause ?? error)
        : corruption("occEvidenceInvalid"), (_rowId, historical) => Effect.gen(function* () {
            const entry = batch[ordinal++];
            if (entry === undefined) return yield* Effect.fail(corruption("occEvidenceInvalid"));
            const [documentId, first] = entry;
            const point = pointById.get(documentId);
            const intent = rowById.get(documentId);
            if (point === undefined || intent === undefined) return yield* Effect.fail(corruption("occEvidenceInvalid"));
    if (point.observed.kind === "present") {
      if (historical.kind !== "live" || historical.commitSeq !== point.observed.revisionCommitSeq ||
        first.before === null) return yield* Effect.fail(corruption("occEvidenceInvalid"));
      const prior = yield* Effect.tryPromise({ try: () => canonicalizeFlarexValueV1(first.before!, "appDocument"),
          catch: () => corruption("occEvidenceInvalid") });
      if (!bytesEqual(prior.canonicalBytes, historical.document.canonicalBytes)) return yield* Effect.fail(corruption("occEvidenceInvalid"));
    } else if (point.observed.basis.kind === "tombstone") {
      if (historical.kind !== "tombstone" || historical.commitSeq !== point.observed.basis.revisionCommitSeq)
        return yield* Effect.fail(corruption("occEvidenceInvalid"));
    } else if (historical.kind !== "missing") return yield* Effect.fail(corruption("occEvidenceInvalid"));
    if (point.overlayKind === "live") {
      if (intent.kind !== "live" || point.overlayValueJson === null) return yield* Effect.fail(corruption("occEvidenceInvalid"));
      const final = yield* Effect.tryPromise({ try: () => canonicalizeFlarexValueV1(point.overlayValueJson!, "appDocument"),
          catch: () => corruption("occEvidenceInvalid") });
      if (!bytesEqual(final.canonicalBytes, intent.document.canonicalBytes)) return yield* Effect.fail(corruption("occEvidenceInvalid"));
    } else if (point.overlayKind === "deleted") {
      if (intent.kind !== "deleted") return yield* Effect.fail(corruption("occEvidenceInvalid"));
    } else return yield* Effect.fail(corruption("occEvidenceInvalid"));
        })),
    ));
  }
}

async function validateAdmittedParticipantOperations(
  tx: AppRowTransaction,
  authority: TrustedScopeAuthority,
  command: PreparedPointCommitTransactionCommandV1,
  clock: ScopeClockRecord,
  developerDefinitions: ReadonlyArray<LocatedAppIndexDefinitionV1>,
  uniqueDefinitions: ReadonlyArray<LocatedAppUniqueConstraintDefinitionV1>,
  options: PointCommitTransactionProofOptionsV1,
  finiteReservation: FiniteMetadataReservation | null = null,
): Promise<readonly Readonly<{ search: readonly LogicalSearchDefinition[] }>[]> {
  if (command.participantOperations.length === 0) return [];
  await validateParticipantPointCorrelation(tx, command);
  // The existing Promise transaction owns this single Effect bridge. Source
  // evidence is shared only within the already locked publication transaction.
  return projectPointCommitTransactionResult((await runPointCommitInTransactionEffect(
    withSharedLogicalSourceBindingChecks(tx, () => validateAdmittedParticipantOperationsInTransaction(
      tx, authority, command, clock, developerDefinitions, uniqueDefinitions, options, finiteReservation)),
  )).pipe(Result.mapError(error => error instanceof PointCommitAdmissionDigestProviderError ? error.cause : error)));
}

const validateAdmittedParticipantOperationsInTransaction = Effect.fn("PointCommit.validateAdmittedParticipants")(
function* (
  tx: AppRowTransaction,
  authority: TrustedScopeAuthority,
  command: PreparedPointCommitTransactionCommandV1,
  clock: ScopeClockRecord,
  developerDefinitions: ReadonlyArray<LocatedAppIndexDefinitionV1>,
  uniqueDefinitions: ReadonlyArray<LocatedAppUniqueConstraintDefinitionV1>,
  options: PointCommitTransactionProofOptionsV1,
  finiteReservation: FiniteMetadataReservation | null,
){
  const operations = command.participantOperations;
  const principalDigest = encodeBytesToLowercaseHex(command.session.identityAccessPolicySha256);
  const validated: Array<Readonly<{ search: readonly LogicalSearchDefinition[] }>> = [];
  for (const operation of operations) {
    const selectedProfile = yield* Effect.fromResult(selectLogicalOperationProfileResult(options, operation));
    for (const [ordinal, contribution] of operation.sourceContributions.entries()) {
    const dependencyEvidence = yield* Effect.fromResult(decodeLogicalParticipantDependencyEvidence(contribution.dependencyEvidence)
      .pipe(Result.mapError(() => corruption("dependencySetInvalid"))));
    if (finiteReservation === null ? dependencyEvidence.version !== 1 : dependencyEvidence.version !== 2 ||
      dependencyEvidence.metadataWatermark !== finiteReservation.metadataWatermark.toString())
      return yield* Effect.fail(corruption("dependencySetInvalid"));
    const token = selectedProfile.authorities[ordinal]!;
    if (finiteReservation !== null && dependencyEvidence.version === 2) {
      const projection = inspectLogicalParticipantCommitMetadataProjection(token, operation, contribution);
      if (projection === null) return yield* Effect.fail(corruption("dependencySetInvalid"));
      const metadata = yield* decodePointCommitMetadataDependenciesEffect(dependencyEvidence.metadataDependencies)
        .pipe(Effect.mapError(() => corruption("dependencySetInvalid")));
      for (const tableId of new Set(contribution.effects.map(effect => effect.tableId))) {
        const table = finiteMetadataTableKey(projection, tableId, "table"), closure = finiteMetadataTableKey(projection, tableId, "writeClosure");
        if (table === null || closure === null) return yield* Effect.fail(corruption("dependencySetInvalid"));
        for (const key of [table, closure, { namespace: table.namespace, ownerKey: table.ownerKey, contractKey: finiteMetadataContractKey("sourcePolicy") }]) {
          const expected = yield* Effect.fromResult(captureFiniteMetadataDependency(projection, key, finiteReservation.metadataWatermark)
            .pipe(Result.mapError(() => corruption("dependencySetInvalid"))));
          if (expected.observed.kind !== "present") return yield* Effect.fail(corruption("dependencySetInvalid"));
          const semanticSha256Hex = expected.observed.semanticSha256Hex;
          if (!metadata.some(member =>
            logicalMetadataDependencyIdentity(member) === logicalMetadataDependencyIdentity(expected) && member.observed.kind === "present" &&
            member.capturedWatermark === expected.capturedWatermark && member.observed.semanticSha256Hex === semanticSha256Hex))
            return yield* Effect.fail(corruption("dependencySetInvalid"));
        }
      }
    }
    const binding = yield* Effect.fromResult(canonicalizeAdmittedParticipantBindingV1Result({
      scopeId: command.authorityPins.scopeId,
      sessionId: command.authorityPins.sessionId,
      attemptFence: command.authorityPins.attemptFence,
      snapshotCommitSeq: command.authorityPins.snapshotToken.commitSeq,
      schemaVersionId: command.authorityPins.schemaVersionId,
      principalDigest,
      participant: operation.participant,
      method: operation.method,
      sourceKey: contribution.sourceKey,
      sourceSha256Hex: contribution.sourceSha256Hex,
      bindingHead: contribution.bindingHead,
    }).pipe(Result.mapError(() => corruption("commandInvalid"))));
    const bindingBytes = yield* Effect.tryPromise({
      try: () => crypto.subtle.digest("SHA-256", new Uint8Array(binding.bytes).buffer),
      catch: cause => new PointCommitAdmissionDigestProviderError({ cause }),
    });
    if (encodeBytesToLowercaseHex(new Uint8Array(bindingBytes)) !== contribution.sourceBindingSha256Hex)
      return yield* Effect.fail(corruption("commandInvalid"));
    const admittedEffect = (finiteReservation === null ? requireLogicalParticipantCommitAuthorityEffect : requireFiniteLogicalParticipantCommitAuthorityEffect)(
      token, operation, contribution, tx, authority, clock).pipe(
      Effect.mapError(error => error.reason === "resourceFailure"
        ? new PointCommitSqlFailureMarkerV1("validateActiveApplicationSchema", error.cause ?? error)
        : error.reason === "storedCorruption" ? corruption("activeApplicationHeadInvalid")
          : new PointCommitStaleAuthorityV1Error({ reason: "activeSchemaChanged" })));
    const admitted = yield* admittedEffect;
    const touched = new Set(contribution.effects.map(effect => effect.tableId));
    const expectedIndexes = admitted.indexes.filter(definition => definition.access.kind === "developer" &&
      touched.has(definition.access.tableId));
    const actualIndexes = developerDefinitions.filter(definition => touched.has(definition.access.tableId));
    if (expectedIndexes.length !== actualIndexes.length || expectedIndexes.some(expected =>
      !actualIndexes.some(actual => actual.indexDefinitionId === expected.indexDefinitionId &&
        actual.physicalSpecSha256Hex === expected.physicalSpecSha256Hex)))
      return yield* Effect.fail(corruption("developerIndexBuildInvalid"));
    const expectedUnique = admitted.unique.filter(definition => touched.has(definition.tableId));
    const actualUnique = uniqueDefinitions.filter(definition => touched.has(definition.tableId));
    if (expectedUnique.length !== actualUnique.length || expectedUnique.some(expected =>
      !actualUnique.some(actual => actual.uniqueConstraintDefinitionId === expected.uniqueConstraintDefinitionId &&
        actual.physicalSpecSha256Hex === expected.physicalSpecSha256Hex)))
      return yield* Effect.fail(corruption("uniqueConstraintDefinitionInvalid"));
    for (const row of command.rowIntents) {
      if (!command.participantMaterialDocumentIds.has(row.documentId) || !touched.has(row.tableId) || row.kind === "deleted")
        continue;
      yield* Effect.fromResult(admitted.validateDocument(row.tableId, row.document)
        .pipe(Result.mapError(() => corruption("rowWriteInvalid"))));
    }
    validated.push(Object.freeze({ search: admitted.search.filter(definition => touched.has(definition.tableId)) }));
    const dependencyEffect = validateLogicalParticipantDependencyEvidence(
      tx, command.authorityPins.scopeId, operation, contribution,
      { tableIds: admitted.tableIds, ...admitted.readDefinitions }, options.publicationObservation).pipe(
        Effect.mapError(error => error.reason === "writeConflict"
          ? new PointCommitConflictV1Error({ conflict: { kind: "logicalParticipant",
            participant: operation.participant, syscallSequence: operation.syscallSequence },
            snapshotCommitSeq: command.authorityPins.snapshotToken.commitSeq,
            currentCommitSeq: clock.lastCommitSeq })
          : error.reason === "resourceFailure" ? new PointCommitSqlFailureMarkerV1("validateIndexRanges", error.cause ?? error)
            : corruption("dependencySetInvalid")));
    yield* dependencyEffect;
    const events: CommittedEvent[] = [];
    for (const event of operation.eventIntents.filter(intent => intent.sourceKey === contribution.sourceKey))
      events.push(yield* Effect.fromResult(decodePointCommitEventEnvelope(event.intent)
        .pipe(Result.mapError(() => corruption("commandInvalid")))));
    const eventBindings = (options.logicalParticipantEvents ?? []).filter(member => member.authority === token);
    if (eventBindings.length > 1 || (events.length > 0 && eventBindings.length !== 1))
      return yield* Effect.fail(corruption("commandInvalid"));
    const eventBinding = eventBindings[0];
    if (eventBinding !== undefined) {
      const group = admittedCommerceEventGroup({ scopeUuid: command.sealIdentity.scopeUuid,
        sessionId: command.authorityPins.sessionId, attemptFence: command.authorityPins.attemptFence });
      const eventEvidence = validateAdmittedCommerceEventIntents(
        eventBinding.policy, eventBinding.selection, events, group).pipe(
        Effect.mapError(() => corruption("commandInvalid")));
      yield* eventEvidence;
    }
    }
    yield* requireAdmittedOperationBundleDigest(operation);
    const workflowEvents: CommittedEvent[] = [];
    for (const event of operation.eventIntents.filter(intent => intent.sourceKey === null))
      workflowEvents.push(yield* Effect.fromResult(decodePointCommitEventEnvelope(event.intent)
        .pipe(Result.mapError(() => corruption("commandInvalid")))));
    const operationEventBinding = selectedProfile.profile.operationEvents;
    if (workflowEvents.length > 0 && operationEventBinding === undefined)
      return yield* Effect.fail(corruption("commandInvalid"));
    if (operationEventBinding !== undefined) {
      const group = admittedCommerceEventGroup({ scopeUuid: command.sealIdentity.scopeUuid,
        sessionId: command.authorityPins.sessionId, attemptFence: command.authorityPins.attemptFence });
      yield* validateAdmittedOperationEventIntents(operationEventBinding.policy,
        operationEventBinding.selection, workflowEvents, group)
        .pipe(Effect.mapError(() => corruption("commandInvalid")));
    }
  }
  return Object.freeze(validated);
});

function requirePointCommitReadyForPublicationResult(
  kernel: Extract<PointCommitKernelResultV1, { readonly kind: "ready" }>,
): Result.Result<
  PointCommitReadyForPublicationV1,
  PointCommitCorruptionV1Error
> {
  const commitSeq = kernel.commitSeq;
  if (commitSeq === null) {
    return Result.fail(corruption("publicationInvariantInvalid"));
  }
  const publicationTimeMilliseconds = kernel.publicationTimeMilliseconds;
  if (publicationTimeMilliseconds === null) {
    return Result.fail(corruption("publicationInvariantInvalid"));
  }
  return Result.succeed(Object.freeze({
    ...kernel,
    commitSeq,
    publicationTimeMilliseconds,
  }));
}

async function lockPointCommitClock(
  tx: AppRowTransaction,
  command: PreparedPointCommitAuthorityCommandV1,
  options: PointCommitTransactionProofOptionsV1,
  protection: "key share" | "no key update" = "no key update",
): Promise<LockedPointCommitClockV1> {
  if (protection === "key share") projectPointCommitTransactionResult(await runPointCommitInTransactionEffect(
    lockScopeExecutionAuthorityInTransactionEffect(tx, command.authorityPins.scopeId, "key share").pipe(Effect.mapError(cause =>
      cause instanceof ScopeAuthorizationRevocationEpochPersistenceError
        ? new PointCommitSqlFailureMarkerV1("lockScopeClock", cause.cause) : corruption("scopeClockInvalid")))));
  const query = selectScopeClockRows(tx)
    .where(eq(
      fxSystemScopeClocks.scopeId,
      command.authorityPins.scopeId,
    ))
    .limit(2)
    .for(protection, { of: fxSystemScopeClocks });
  if (protection === "key share") observeDrizzleQuery("lockScopeClock", query, options);
  const rows = protection === "no key update"
    ? projectPointCommitTransactionResult(await runPointCommitInTransactionEffect(
      lockScopeClockRowsForOrdinaryWriteInTransactionEffect(tx, command.authorityPins.scopeId, options.observeQuery).pipe(Effect.mapError(cause =>
        cause instanceof ScopeAuthorizationRevocationEpochPersistenceError
          ? new PointCommitSqlFailureMarkerV1("lockScopeClock", cause.cause) : corruption("scopeClockInvalid")))))
    : await sqlCall("lockScopeClock", () => query);
  return projectPointCommitTransactionResult(
    materializeLockedPointCommitClockResult(rows),
  );
}

function materializeLockedPointCommitClockResult(
  rows: ReadonlyArray<PointCommitScopeClockRowV1>,
): Result.Result<
  LockedPointCommitClockV1,
  PointCommitStaleAuthorityV1Error | PointCommitCorruptionV1Error
> {
  return Result.gen(function* () {
    if (rows.length === 0) {
      return yield* Result.fail(stale("scopeChanged"));
    }
    if (rows.length !== 1) {
      return yield* Result.fail(corruption("scopeClockInvalid"));
    }
    const row = rows[0];
    if (row === undefined) {
      return yield* Result.fail(corruption("scopeClockInvalid"));
    }
    return yield* decodeLockedPointCommitClockResult(row);
  });
}

function decodeLockedPointCommitClockResult(
  row: PointCommitScopeClockRowV1,
): Result.Result<LockedPointCommitClockV1, PointCommitCorruptionV1Error> {
  return Result.gen(function* () {
    const record = yield* pointCommitClockFieldResult(
      decodeScopeClockRecordResult(row),
    );
    const scopeUuid = yield* pointCommitClockFieldResult(
      decodePointCommitScopeUuidResult(row.scopeUuid),
    );
    const epochUuid = yield* pointCommitClockFieldResult(
      decodePointCommitScopeEpochUuidResult(row.epochUuid),
    );
    const scopeProjection = yield* pointCommitClockFieldResult(
      projectScopeIdUuidV1Result(record.scopeId),
    );
    if (scopeUuid !== scopeProjection.scopeUuid) {
      return yield* Result.fail(corruption("scopeClockInvalid"));
    }
    const epochProjection = yield* pointCommitClockFieldResult(
      projectScopeEpochUuidV1Result(record.epoch),
    );
    if (epochUuid !== epochProjection.epochUuid) {
      return yield* Result.fail(corruption("scopeClockInvalid"));
    }
    const oldestAvailableCommitSeq = yield* pointCommitClockFieldResult(
      decodePointCommitRetainedFloorResult(row.oldestAvailableCommitSeq),
    );
    if (oldestAvailableCommitSeq > record.lastCommitSeq) {
      return yield* Result.fail(corruption("scopeClockInvalid"));
    }
    const authorizationRevocationEpoch = yield* pointCommitClockFieldResult(
      decodePointCommitAuthorizationRevocationEpochResult(
        row.authorizationRevocationEpoch,
      ),
    );
    return Object.freeze({
      record,
      oldestAvailableCommitSeq,
      scopeUuid,
      epochUuid,
      authorizationRevocationEpoch,
    });
  });
}

function pointCommitClockFieldResult<Value>(
  result: Result.Result<Value, unknown>,
): Result.Result<Value, PointCommitCorruptionV1Error> {
  return result.pipe(
    Result.mapError(() => corruption("scopeClockInvalid")),
  );
}

async function inspectCommittedOutcomeInTransaction(
  tx: AppRowTransaction,
  clock: LockedPointCommitClockV1,
  command: PreparedPointCommitAuthorityCommandV1,
  options: PointCommitTransactionProofOptionsV1,
): Promise<LockedCommittedPointOutcomeV1 | null> {
  const lookup = captureCommittedOutcomeLookup(command);
  const query = tx
    .select({
      outcomeScopeUuid: fxSystemIdempotency.scopeUuid,
      outcomeRequestKey: fxSystemIdempotency.requestKey,
      identityHashByteLength: sql<number>`
        octet_length(${fxSystemIdempotency.identityAccessPolicySha256})
      `,
      identityMatches: sql<boolean>`
        ${fxSystemIdempotency.identityAccessPolicySha256} =
          ${lookup.expectedIdentityAccessPolicySha256}
      `,
      functionPathValid: sql<boolean>`
        btrim(
          ${fxSystemIdempotency.functionPath},
          U&' \\0009\\000a\\000b\\000c\\000d\\00a0\\1680\\2000\\2001\\2002\\2003\\2004\\2005\\2006\\2007\\2008\\2009\\200a\\2028\\2029\\202f\\205f\\3000\\feff'
        ) <> ''
      `,
      functionPathMatches: sql<boolean>`
        ${fxSystemIdempotency.functionPath} = ${lookup.expectedFunctionPath}
      `,
      requestHashByteLength: sql<number>`
        octet_length(${fxSystemIdempotency.requestSha256})
      `,
      requestMatches: sql<boolean>`
        ${fxSystemIdempotency.requestSha256} = ${lookup.expectedRequestSha256}
      `,
      epochUuid: fxSystemIdempotency.epochUuid,
      commitSeq: fxSystemIdempotency.commitSeq,
      resultState: fxSystemIdempotency.resultState,
      resultEncoding: fxSystemIdempotency.resultEncoding,
      resultValueCodecVersion: fxSystemIdempotency.resultValueCodecVersion,
      resultSemanticBytes: fxSystemIdempotency.resultSemanticBytes,
      resultByteLength: sql<number | null>`
        case when ${fxSystemIdempotency.resultBytes} is null then null
          else octet_length(${fxSystemIdempotency.resultBytes}) end
      `,
      resultSha256ByteLength: sql<number | null>`
        case when ${fxSystemIdempotency.resultSha256} is null then null
          else octet_length(${fxSystemIdempotency.resultSha256}) end
      `,
      resultExpiredAt: fxSystemIdempotency.resultExpiredAt,
      createdAt: fxSystemIdempotency.createdAt,
      retainedHeaderScopeUuid: fxSystemCommits.scopeUuid,
      retainedHeaderEpochUuid: fxSystemCommits.epochUuid,
      retainedHeaderCommitSeq: fxSystemCommits.commitSeq,
    })
    .from(fxSystemIdempotency)
    .leftJoin(
      fxSystemCommits,
      and(
        eq(fxSystemCommits.scopeUuid, fxSystemIdempotency.scopeUuid),
        eq(fxSystemCommits.commitSeq, fxSystemIdempotency.commitSeq),
      ),
    )
    .where(and(
      eq(fxSystemIdempotency.scopeUuid, pointCommitCommandScopeUuid(command)),
      eq(fxSystemIdempotency.requestKey, command.authorityPins.requestKey),
    ))
    .limit(2);
  observeDrizzleQuery("recheckOutcome", query, options);
  const rows = await sqlCall("recheckOutcome", () => query);
  return projectPointCommitTransactionResult(Result.gen(function* () {
    if (rows.length > 1) {
      return yield* Result.fail(
        committedOutcomeCorruption(lookup, "duplicateOutcome"),
      );
    }
    const row = rows[0];
    if (row === undefined) return null;
    return yield* acceptObservedCommittedOutcomeResult(row, clock, command);
  }));
}

function acceptObservedCommittedOutcomeResult(row: CommittedPointOutcomeStoredScalarEvidenceV1,
  clock: LockedPointCommitClockV1, command: PreparedPointCommitAuthorityCommandV1) {
  const lookup = captureCommittedOutcomeLookup(command);
  return Result.gen(function* () {
    yield* validateCommittedPointOutcomeRequestEvidenceShapeV1(lookup, row);
    const scalars =
      yield* validateCommittedPointOutcomeStoredScalarsAfterRequestShapeV1(
        lookup,
        row,
        Object.freeze({
          lastCommitSeq: clock.record.lastCommitSeq,
          oldestAvailableCommitSeq: clock.oldestAvailableCommitSeq,
        }),
      );
    return Object.freeze({
      state: scalars.state,
      commitSeq: scalars.token.commitSeq,
    });
  });
}

function requireLockedClockAuthorityResult(
  clock: LockedPointCommitClockV1,
  preliminary: TrustedScopeAuthority,
  command: PreparedPointCommitAuthorityCommandV1,
): Result.Result<
  void,
  PointCommitStaleAuthorityV1Error | PointCommitCorruptionV1Error
> {
  const pins = command.authorityPins;
  return Result.gen(function* () {
    if (
      clock.record.scopeId !== pins.scopeId ||
      preliminary.scopeId !== pins.scopeId ||
      preliminary.deploymentId !== pins.deploymentId ||
      clock.scopeUuid !== pointCommitCommandScopeUuid(command)
    ) {
      return yield* Result.fail(stale("scopeChanged"));
    }
    if (
      clock.record.storageGeneration !== "flarexdb_v1" ||
      preliminary.storageGeneration !== "flarexdb_v1" ||
      clock.record.storageGeneration !== pins.storageGeneration ||
      preliminary.storageGeneration !== pins.storageGeneration ||
      clock.record.storageGenerationFence !== pins.storageGenerationFence ||
      preliminary.storageGenerationFence !== pins.storageGenerationFence
    ) {
      return yield* Result.fail(stale("generationChanged"));
    }
    if (
      clock.record.epoch !== pins.snapshotToken.epoch ||
      preliminary.epoch !== pins.snapshotToken.epoch
    ) {
      return yield* Result.fail(stale("epochChanged"));
    }
    if (
      clock.authorizationRevocationEpoch !==
        pins.authorizationRevocationEpoch
    ) {
      return yield* Result.fail(stale("revocationEpochChanged"));
    }
    if (pins.snapshotToken.commitSeq > clock.record.lastCommitSeq) {
      return yield* Result.fail(corruption("scopeClockInvalid"));
    }
  });
}

async function validateActiveRelationSelectionForPointCommit(
  tx: AppRowTransaction,
  command: PreparedPointCommitDependencyCommandV1,
): Promise<void> {
  if (command.relationDependencies.length === 0) return;
  await validateExpectedActiveRelationSelectionForPointCommit(
    tx,
    command.authorityPins.scopeId,
    command.relationDependencies,
  );
}

async function validateExpectedActiveRelationSelectionForPointCommit(
  tx: AppRowTransaction,
  scopeId: ReplacementScopeIdV1,
  expected: ReadonlyArray<RecoveredApplicationRelationActiveSelection>,
): Promise<void> {
  const settled = await runPointCommitInTransactionEffect(
    readCoherentApplicationActiveHeadForShareInTransactionEffect(
      tx,
      scopeId,
    ),
  );
  const active = projectPointCommitTransactionResult(settled.pipe(
    Result.mapError((failure) => failure.reason === "resourceFailure"
      ? new PointCommitSqlFailureMarkerV1(
          "validateActiveRelationSelection",
          failure.cause ?? failure,
        )
      : corruption("activeApplicationHeadInvalid")),
  ));
  if (
    active === null ||
    active.head.readinessKind !== "relation" ||
    expected.some((dependency) =>
      dependency.activationSequence !== active.head.activationSequence ||
      dependency.activeHeadSha256Hex !==
        encodeBytesToLowercaseHex(active.head.headSha256)
    )
  ) {
    throw stale("activeRelationSelectionChanged");
  }
}

async function validateActiveApplicationSchemaForPointCommit(
  tx: AppRowTransaction,
  command: PreparedPointCommitTransactionCommandV1,
  preparedApplicationRelations: PreparedPointCommitApplicationRelations | null,
  options: PointCommitTransactionProofOptionsV1,
): Promise<LocatedPreparedPointCommitApplicationRelations | null> {
  if (command.authorityPins.executionAuthorityGeneration !== "application_v1") {
    return preparedApplicationRelations?.definitions === null ||
        preparedApplicationRelations === null
      ? null
      : Object.freeze({
          port: preparedApplicationRelations.port,
          definitions: preparedApplicationRelations.definitions,
        });
  }
  const contractQuery = tx.select({
    readinessContractVersion:
      fxSystemApplicationActiveHeads.readinessContractVersion,
  }).from(fxSystemApplicationActiveHeads).where(eq(
    fxSystemApplicationActiveHeads.scopeId,
    command.authorityPins.scopeId,
  )).limit(2).for("share");
  const contractRows = await sqlCall(
    "validateActiveApplicationSchema",
    () => contractQuery,
  );
  const readinessContractVersion =
    contractRows[0]?.readinessContractVersion;
  if (contractRows.length !== 1 ||
    (readinessContractVersion !== 1 && readinessContractVersion !== 2 && readinessContractVersion !== 3)) {
    throw corruption("activeApplicationHeadInvalid");
  }
  if (
    (readinessContractVersion === 2 || readinessContractVersion === 3) &&
    command.rowIntents.some(row => !command.participantMaterialDocumentIds.has(row.documentId)) &&
    preparedApplicationRelations === null
  ) {
    throw new ApplicationRelationCommitUnavailableError({
      reason: "compositionMissing",
    });
  }
  if (
    (readinessContractVersion === 2 || readinessContractVersion === 3) &&
    command.rowIntents.some(row => !command.participantMaterialDocumentIds.has(row.documentId)) &&
    preparedApplicationRelations?.definitions === null
  ) {
    throw new ApplicationRelationCommitUnavailableError({
      reason: "bindingUnavailable",
    });
  }
  const applicationRelations = preparedApplicationRelations?.definitions ??
    null;
  const query = readinessContractVersion === 1
    ? tx.select({
        deploymentId: fxSystemApplicationReadinessV1.deploymentId,
        schemaVersionId: fxSystemApplicationReadinessV1.schemaVersionId,
        applicationSchemaSha256:
          fxSystemApplicationReadinessV1.applicationSchemaSha256,
        schemaManifestSha256:
          fxSystemApplicationReadinessV1.schemaManifestSha256,
        boundPublicationSha256: sql<Uint8Array | null>`null`,
      }).from(fxSystemApplicationActiveHeads).innerJoin(
        fxSystemApplicationReadinessV1,
        and(
          eq(fxSystemApplicationReadinessV1.scopeId,
            fxSystemApplicationActiveHeads.scopeId),
          eq(fxSystemApplicationReadinessV1.revisionId,
            fxSystemApplicationActiveHeads.revisionId),
          eq(fxSystemApplicationReadinessV1.readinessSha256,
            fxSystemApplicationActiveHeads.readinessSha256),
        ),
      ).where(and(
        eq(fxSystemApplicationActiveHeads.scopeId,
          command.authorityPins.scopeId),
        eq(fxSystemApplicationActiveHeads.readinessContractVersion, 1),
      )).limit(2).for("share")
    : tx.select({
        deploymentId: fxSystemApplicationReadiness.deploymentId,
        schemaVersionId: fxSystemApplicationReadiness.schemaVersionId,
        applicationSchemaSha256:
          fxSystemApplicationReadiness.applicationSchemaSha256,
        schemaManifestSha256:
          fxSystemApplicationReadiness.schemaManifestSha256,
        boundPublicationSha256:
          fxSystemApplicationReadiness.boundPublicationSha256,
      }).from(fxSystemApplicationActiveHeads).innerJoin(
        fxSystemApplicationReadiness,
        and(
          eq(fxSystemApplicationReadiness.scopeId,
            fxSystemApplicationActiveHeads.scopeId),
          eq(fxSystemApplicationReadiness.revisionId,
            fxSystemApplicationActiveHeads.revisionId),
          eq(fxSystemApplicationReadiness.readinessSha256,
            fxSystemApplicationActiveHeads.readinessSha256),
          eq(fxSystemApplicationReadiness.relationSetReadinessSha256,
            fxSystemApplicationActiveHeads.relationSetReadinessSha256),
          eq(fxSystemApplicationReadiness.relationCount,
            fxSystemApplicationActiveHeads.relationCount),
        ),
      ).where(and(
        eq(fxSystemApplicationActiveHeads.scopeId,
          command.authorityPins.scopeId),
        inArray(fxSystemApplicationActiveHeads.readinessContractVersion, [2, 3]),
      )).limit(2).for("share");
  observeDrizzleQuery("validateActiveApplicationSchema", query, options);
  const rows = await sqlCall(
    "validateActiveApplicationSchema",
    () => query,
  );
  projectPointCommitTransactionResult(Result.gen(function* () {
    if (rows.length !== 1) {
      return yield* Result.fail(corruption("activeApplicationHeadInvalid"));
    }
    const row = rows[0];
    if (
      row === undefined ||
      row.deploymentId !== command.authorityPins.deploymentId
    ) {
      return yield* Result.fail(corruption("activeApplicationHeadInvalid"));
    }
    const activeSchemaVersionId = yield* decodePointCommitSchemaVersionIdResult(
      row.schemaVersionId,
    ).pipe(
      Result.mapError(() => corruption("activeApplicationHeadInvalid")),
    );
    if (activeSchemaVersionId !== command.authorityPins.schemaVersionId) {
      return yield* Result.fail(stale("activeSchemaChanged"));
    }
    if (
      applicationRelations !== null &&
      (
        !isUint8ArrayWithByteLength(row.applicationSchemaSha256, 32) ||
        !isUint8ArrayWithByteLength(row.schemaManifestSha256, 32) ||
        encodeBytesToLowercaseHex(row.applicationSchemaSha256) !==
          applicationRelations.applicationSchemaSha256 ||
        encodeBytesToLowercaseHex(row.schemaManifestSha256) !==
          applicationRelations.schemaManifestSha256 ||
        (
          (readinessContractVersion === 2 || readinessContractVersion === 3) &&
          (
            !isUint8ArrayWithByteLength(row.boundPublicationSha256, 32) ||
            encodeBytesToLowercaseHex(row.boundPublicationSha256) !==
              applicationRelations.boundPublicationSha256
          )
        )
      )
    ) {
      return yield* Result.fail(corruption("relationBindingInvalid"));
    }
  }));
  return preparedApplicationRelations !== null &&
      preparedApplicationRelations.definitions !== null
    ? Object.freeze({
        port: preparedApplicationRelations.port,
        definitions: preparedApplicationRelations.definitions,
      })
    : null;
}

function preparedApplicationRelationsForFiniteCommit(
  prepared: PreparedPointCommitApplicationRelations | null,
): LocatedPreparedPointCommitApplicationRelations | null {
  return prepared?.definitions == null ? null : Object.freeze({ port: prepared.port, definitions: prepared.definitions });
}

const requireFinitePointCommitReservation = Effect.fn("PointCommit.requireFiniteReservation")(function* (
  command: Pick<PreparedPointCommitTransactionCommandV1, "authorityPins" | "finiteMetadataReservationSha256Hex">,
  lease: typeof fxSystemSnapshotLeases.$inferSelect,
) {
  const reservation = yield* readStoredFiniteMetadataReservation(lease).pipe(Effect.mapError(error =>
    error.reason === "resourceFailure" ? new PointCommitSqlFailureMarkerV1("lockLease", error.cause ?? error) : corruption("leaseInvalid")));
  const pins = command.authorityPins;
  if (lease.finiteMetadataReservationSha256 === null ||
    encodeBytesToLowercaseHex(lease.finiteMetadataReservationSha256) !== command.finiteMetadataReservationSha256Hex ||
    reservation.deploymentId !== pins.deploymentId || reservation.scopeId !== pins.scopeId || reservation.sessionId !== pins.sessionId ||
    reservation.attemptFence !== pins.attemptFence || reservation.storageGeneration !== pins.storageGeneration ||
    reservation.storageGenerationFence !== pins.storageGenerationFence || reservation.schemaVersionId !== pins.schemaVersionId ||
    reservation.snapshotToken.scopeId !== pins.snapshotToken.scopeId || reservation.snapshotToken.epoch !== pins.snapshotToken.epoch ||
    reservation.snapshotToken.commitSeq !== pins.snapshotToken.commitSeq)
    return yield* Effect.fail(corruption("leaseInvalid"));
  return reservation;
});

function selectPointCommitSessionRows(tx: AppRowTransaction, command: PreparedPointCommitAuthorityCommandV1) {
  return tx
    .select({
      scopeUuid: fxSystemTransactionSessions.scopeUuid,
      sessionId: fxSystemTransactionSessions.sessionId,
      storageGeneration: fxSystemTransactionSessions.storageGeneration,
      storageGenerationFence:
        fxSystemTransactionSessions.storageGenerationFence,
      executionAuthorityGeneration:
        fxSystemTransactionSessions.executionAuthorityGeneration,
      applicationExecutionAuthoritySha256:
        fxSystemTransactionSessions.applicationExecutionAuthoritySha256,
      packageId: fxSystemTransactionSessions.packageId,
      artifactRuntime: fxSystemTransactionSessions.artifactRuntime,
      artifactId: fxSystemTransactionSessions.artifactId,
      sourcePackageHash: fxSystemTransactionSessions.sourcePackageHash,
      executionModule: fxSystemTransactionSessions.executionModule,
      functionPath: fxSystemTransactionSessions.functionPath,
      functionKind: fxSystemTransactionSessions.functionKind,
      schemaVersionId: fxSystemTransactionSessions.schemaVersionId,
      policyVersion: fxSystemTransactionSessions.policyVersion,
      identityAccessPolicySha256:
        fxSystemTransactionSessions.identityAccessPolicySha256,
      validatedArgsValueCodecVersion:
        fxSystemTransactionSessions.validatedArgsValueCodecVersion,
      validatedArgsCanonicalByteLength: sql<number | null>`
        octet_length(${fxSystemTransactionSessions.validatedArgsCanonicalBytes})
      `,
      validatedArgsSha256: fxSystemTransactionSessions.validatedArgsSha256,
      authorizationGrantId:
        fxSystemTransactionSessions.authorizationGrantId,
      authorizationGrantValueCodecVersion:
        fxSystemTransactionSessions.authorizationGrantValueCodecVersion,
      authorizationGrantCanonicalByteLength: sql<number | null>`
        octet_length(${fxSystemTransactionSessions.authorizationGrantCanonicalBytes})
      `,
      authorizationGrantSha256:
        fxSystemTransactionSessions.authorizationGrantSha256,
      authorizationRevocationEpoch:
        fxSystemTransactionSessions.authorizationRevocationEpoch,
      authorizationGrantExpiresAt:
        fxSystemTransactionSessions.authorizationGrantExpiresAt,
      requestKey: fxSystemTransactionSessions.requestKey,
      requestSha256: fxSystemTransactionSessions.requestSha256,
      lifecycle: fxSystemTransactionSessions.lifecycle,
      attemptFence: fxSystemTransactionSessions.attemptFence,
      protocolVersion: fxSystemTransactionSessions.protocolVersion,
      hardExpiresAt: fxSystemTransactionSessions.hardExpiresAt,
      createdAt: fxSystemTransactionSessions.createdAt,
      updatedAt: fxSystemTransactionSessions.updatedAt,
    })
    .from(fxSystemTransactionSessions)
    .where(and(
      eq(
        fxSystemTransactionSessions.scopeUuid,
        pointCommitCommandScopeUuid(command),
      ),
      eq(
        fxSystemTransactionSessions.sessionId,
        command.authorityPins.sessionId,
      ),
    ))
    .limit(2)
    ;
}

type PointCommitSelectedSessionRow = Awaited<ReturnType<typeof selectPointCommitSessionRows>>[number];

function validatePointCommitSessionRowsResult(rows: readonly PointCommitSelectedSessionRow[],
  command: PreparedPointCommitAuthorityCommandV1, mode: PointCommitSessionLockModeV1) {
  return Result.gen(function* () {
    if (rows.length === 0) return yield* Result.fail(stale("attemptMissing"));
    if (rows.length !== 1) {
      return yield* Result.fail(corruption("sessionDuplicate"));
    }
    const row = rows[0];
    if (row === undefined) {
      return yield* Result.fail(corruption("sessionDuplicate"));
    }
    const expectedAttemptFence = command.authorityPins.attemptFence;
    const replacementAttemptFence = expectedAttemptFence <
        MAX_TRANSACTION_ATTEMPT_FENCE
      ? TransactionAttemptFenceSchema.make(expectedAttemptFence + 1n)
      : null;
    const isReplacement = mode === "replaceAttempt" ||
      mode === "replaceRunningRelationConflict";
    const observesReplacement = isReplacement &&
      replacementAttemptFence !== null &&
      row.attemptFence === replacementAttemptFence;
    if (row.attemptFence !== expectedAttemptFence && !observesReplacement) {
      return yield* Result.fail(stale("attemptReplaced"));
    }
    if (isReplacement) {
      const sourceLifecycle = mode === "replaceAttempt"
        ? "finishing"
        : "running";
      if (
        (observesReplacement && row.lifecycle !== "running") ||
        (!observesReplacement && row.lifecycle !== sourceLifecycle)
      ) {
        return yield* Result.fail(stale("lifecycleChanged"));
      }
    } else if (mode === "resolveFinite") {
      if (row.lifecycle !== "running" && row.lifecycle !== "retrying" && row.lifecycle !== "aborted" && row.lifecycle !== "expired")
        return yield* Result.fail(stale("lifecycleChanged"));
    } else if (mode === "recoverRunningRelationConflict" || mode === "publishFinite") {
      if (row.lifecycle !== "running") {
        return yield* Result.fail(stale("lifecycleChanged"));
      }
    } else if (mode === "enterFinishing") {
      if (row.lifecycle !== "running" && row.lifecycle !== "finishing") {
        return yield* Result.fail(stale("lifecycleChanged"));
      }
    } else if (row.lifecycle !== "finishing") {
      if (mode === "publish" && row.lifecycle === "committed") {
        return yield* Result.fail(corruption("committedOutcomeMissing"));
      }
      return yield* Result.fail(stale("lifecycleChanged"));
    }
    const expected = command.session;
    const authorizationGrantExpiresAtMilliseconds = finiteDateMilliseconds(
      row.authorizationGrantExpiresAt,
    );
    const hardExpiresAtMilliseconds = finiteDateMilliseconds(row.hardExpiresAt);
    const createdAtMilliseconds = finiteDateMilliseconds(row.createdAt);
    const updatedAtMilliseconds = finiteDateMilliseconds(row.updatedAt);
    if (
      row.scopeUuid !== pointCommitCommandScopeUuid(command) ||
      row.sessionId !== command.authorityPins.sessionId ||
      row.storageGeneration !== expected.storageGeneration ||
      row.storageGenerationFence !== expected.storageGenerationFence ||
      !storedExecutionAuthorityMatchesPointCommit(
        row,
        command.authorityPins,
        expected,
      ) ||
      row.functionPath !== expected.functionPath ||
      row.functionKind !== expected.functionKind ||
      row.schemaVersionId !== expected.schemaVersionId ||
      row.policyVersion !== expected.policyVersion ||
      !bytesEqual(
        row.identityAccessPolicySha256,
        expected.identityAccessPolicySha256,
      ) ||
      row.validatedArgsValueCodecVersion !==
        expected.validatedArgsValueCodecVersion ||
      row.validatedArgsCanonicalByteLength !==
        (mode === "resolveFinite" && (row.lifecycle === "aborted" || row.lifecycle === "expired") ? null : expected.validatedArgsCanonicalByteLength) ||
      !bytesEqual(row.validatedArgsSha256, expected.validatedArgsSha256) ||
      row.authorizationGrantId !== expected.authorizationGrantId ||
      row.authorizationGrantValueCodecVersion !==
        expected.authorizationGrantValueCodecVersion ||
      row.authorizationGrantCanonicalByteLength !==
        (mode === "resolveFinite" && (row.lifecycle === "aborted" || row.lifecycle === "expired") ? null : expected.authorizationGrantCanonicalByteLength) ||
      !bytesEqual(
        row.authorizationGrantSha256,
        expected.authorizationGrantSha256,
      ) ||
      row.authorizationRevocationEpoch !==
        expected.authorizationRevocationEpoch ||
      row.requestKey !== expected.requestKey ||
      !bytesEqual(row.requestSha256, expected.requestSha256) ||
      row.protocolVersion !== expected.protocolVersion ||
      authorizationGrantExpiresAtMilliseconds === undefined ||
      hardExpiresAtMilliseconds === undefined ||
      createdAtMilliseconds === undefined ||
      updatedAtMilliseconds === undefined ||
      authorizationGrantExpiresAtMilliseconds !==
        expected.authorizationGrantExpiresAtMilliseconds ||
      hardExpiresAtMilliseconds !== expected.hardExpiresAtMilliseconds ||
      createdAtMilliseconds !== expected.createdAtMilliseconds ||
      (
        isReplacement && observesReplacement
          ? updatedAtMilliseconds < expected.updatedAtMilliseconds
          : mode === "enterFinishing"
          ? row.lifecycle === "running"
            ? updatedAtMilliseconds !== expected.updatedAtMilliseconds
            : updatedAtMilliseconds < expected.updatedAtMilliseconds
          : mode === "resolveFinite" && (row.lifecycle === "aborted" || row.lifecycle === "expired")
          ? updatedAtMilliseconds < expected.updatedAtMilliseconds
          : updatedAtMilliseconds !== expected.updatedAtMilliseconds
      )
    ) {
      return yield* Result.fail(corruption("sessionInvalid"));
    }
    if (row.lifecycle !== "running" && row.lifecycle !== "finishing" && !(mode === "resolveFinite" &&
      (row.lifecycle === "retrying" || row.lifecycle === "aborted" || row.lifecycle === "expired"))) {
      return yield* Result.fail(corruption("sessionInvalid"));
    }
    return Object.freeze({
      lifecycle: row.lifecycle,
      attemptFence: observesReplacement
        ? replacementAttemptFence
        : expectedAttemptFence,
      authorizationGrantExpiresAtMilliseconds,
      hardExpiresAtMilliseconds,
      updatedAtMilliseconds,
    });
  });
}

async function lockPointCommitSession(
  tx: AppRowTransaction,
  command: PreparedPointCommitAuthorityCommandV1,
  options: PointCommitTransactionProofOptionsV1,
  mode: PointCommitSessionLockModeV1,
): Promise<LockedPointCommitSessionV1> {
  const query = selectPointCommitSessionRows(tx, command).for("update");
  observeDrizzleQuery("lockSession", query, options);
  const rows = await sqlCall("lockSession", () => query);
  const accepted = projectPointCommitTransactionResult(validatePointCommitSessionRowsResult(rows, command, mode));
  // The Promise rollback adapter maps this terminal lifecycle refusal to its
  // existing typed stale-authority channel.
  // oxlint-disable-next-line flarex/no-throw-inside-effect-operation -- REVIEW: transaction - the native Drizzle callback rejects the typed terminal lifecycle refusal so the transaction rolls back
  if (accepted.lifecycle !== "running" && accepted.lifecycle !== "finishing") throw stale("lifecycleChanged");
  return { ...accepted, lifecycle: accepted.lifecycle };
}

function storedExecutionAuthorityMatchesPointCommit(
  row: Readonly<{
    readonly executionAuthorityGeneration: string;
    readonly packageId: string | null;
    readonly artifactRuntime: string | null;
    readonly artifactId: string | null;
    readonly sourcePackageHash: string | null;
    readonly executionModule: string | null;
    readonly applicationExecutionAuthoritySha256: Uint8Array | null;
  }>,
  pins: PointCommitAuthorityPinsV1,
  session: PointCommitSessionScalarsV1,
): boolean {
  if (
    row.executionAuthorityGeneration !== pins.executionAuthorityGeneration ||
    session.executionAuthorityGeneration !== pins.executionAuthorityGeneration
  ) return false;
  if (
    pins.executionAuthorityGeneration === "legacy_dynamic_worker_v1" &&
    session.executionAuthorityGeneration === "legacy_dynamic_worker_v1"
  ) {
    return row.packageId === pins.packageId && pins.packageId === session.packageId &&
      row.artifactRuntime === pins.artifactRuntime &&
      pins.artifactRuntime === session.artifactRuntime &&
      row.artifactId === pins.artifactId && pins.artifactId === session.artifactId &&
      row.sourcePackageHash === pins.sourcePackageHash &&
      pins.sourcePackageHash === session.sourcePackageHash &&
      row.executionModule === pins.executionModule &&
      pins.executionModule === session.executionModule &&
      row.applicationExecutionAuthoritySha256 === null;
  }
  if (
    pins.executionAuthorityGeneration === "application_v1" &&
    session.executionAuthorityGeneration === "application_v1"
  ) {
    return row.packageId === null && row.artifactRuntime === null &&
      row.artifactId === null && row.sourcePackageHash === null &&
      row.executionModule === null &&
      row.applicationExecutionAuthoritySha256 !== null &&
      bytesEqual(
        row.applicationExecutionAuthoritySha256,
        pins.applicationExecutionAuthoritySha256,
      ) && bytesEqual(
        pins.applicationExecutionAuthoritySha256,
        session.applicationExecutionAuthoritySha256,
      );
  }
  return false;
}

async function lockPointCommitLease(
  tx: AppRowTransaction,
  command: PreparedPointCommitAuthorityCommandV1,
  options: PointCommitTransactionProofOptionsV1,
): Promise<LockedPointCommitLeaseV1> {
  const query = tx
    .select()
    .from(fxSystemSnapshotLeases)
    .where(and(
      eq(
        fxSystemSnapshotLeases.scopeUuid,
        pointCommitCommandScopeUuid(command),
      ),
      eq(
        fxSystemSnapshotLeases.sessionId,
        command.authorityPins.sessionId,
      ),
    ))
    .limit(2)
    .for("update");
  observeDrizzleQuery("lockLease", query, options);
  const rows = await sqlCall("lockLease", () => query);
  return projectPointCommitTransactionResult(Result.gen(function* () {
    if (rows.length === 0) return yield* Result.fail(stale("leaseMissing"));
    if (rows.length !== 1) {
      return yield* Result.fail(corruption("leaseDuplicate"));
    }
    const row = rows[0];
    if (row === undefined) {
      return yield* Result.fail(corruption("leaseDuplicate"));
    }
    if (row.attemptFence !== command.authorityPins.attemptFence) {
      return yield* Result.fail(stale("leaseReplaced"));
    }
    const expectedEpochUuid = yield* projectScopeEpochUuidV1Result(
      command.authorityPins.snapshotToken.epoch,
    ).pipe(Result.mapError(() => corruption("leaseInvalid")));
    const snapshotEpochUuid = yield* decodePointCommitScopeEpochUuidResult(
      row.snapshotEpochUuid,
    ).pipe(Result.mapError(() => corruption("leaseInvalid")));
    const leaseExpiresAtMilliseconds = finiteDateMilliseconds(
      row.leaseExpiresAt,
    );
    if (
      row.scopeUuid !== pointCommitCommandScopeUuid(command) ||
      row.sessionId !== command.authorityPins.sessionId ||
      snapshotEpochUuid !== expectedEpochUuid.epochUuid ||
      row.snapshotCommitSeq !== command.authorityPins.snapshotToken.commitSeq ||
      leaseExpiresAtMilliseconds === undefined ||
      ("sealIdentity" in command &&
        leaseExpiresAtMilliseconds !==
          command.sealIdentity.leaseExpiresAtMilliseconds) ||
      leaseExpiresAtMilliseconds > command.session.hardExpiresAtMilliseconds
    ) {
      return yield* Result.fail(corruption("leaseInvalid"));
    }
    return Object.freeze({
      expiresAtMilliseconds: leaseExpiresAtMilliseconds,
      row,
    });
  }));
}

async function lockPointCommitJournalRoot(
  tx: AppRowTransaction,
  command: PreparedPointCommitAttemptScalarCommandV1,
  options: PointCommitTransactionProofOptionsV1,
): Promise<"durableOperations" | "finiteRoot"> {
  const query = tx
    .select({
      scopeUuid: fxSystemTransactionJournals.scopeUuid,
      sessionId: fxSystemTransactionJournals.sessionId,
      attemptFence: fxSystemTransactionJournals.attemptFence,
      executionProfile: fxSystemTransactionJournals.executionProfile,
      state: fxSystemTransactionJournals.state,
      lastSyscallSequence:
        fxSystemTransactionJournals.lastSyscallSequence,
      creationTimeSeed: fxSystemTransactionJournals.creationTimeSeed,
      nextCreationTime: fxSystemTransactionJournals.nextCreationTime,
      readDocuments: fxSystemTransactionJournals.readDocuments,
      readSemanticBytes: fxSystemTransactionJournals.readSemanticBytes,
      pointDependencyCount:
        fxSystemTransactionJournals.pointDependencyCount,
      indexedQuerySyscalls:
        fxSystemTransactionJournals.indexedQuerySyscalls,
      indexRangeDependencyCount:
        fxSystemTransactionJournals.indexRangeDependencyCount,
      indexRangeDependencyEvidenceBytes:
        fxSystemTransactionJournals.indexRangeDependencyEvidenceBytes,
      relationReadSyscalls:
        fxSystemTransactionJournals.relationReadSyscalls,
      relationDependencyCount:
        fxSystemTransactionJournals.relationDependencyCount,
      relationBaseOccurrences:
        fxSystemTransactionJournals.relationBaseOccurrences,
      writeOperations: fxSystemTransactionJournals.writeOperations,
      writeSemanticBytes: fxSystemTransactionJournals.writeSemanticBytes,
      materialWriteEventEvidenceBytes:
        fxSystemTransactionJournals.materialWriteEventEvidenceBytes,
      receiptEvidenceBytes: fxSystemTransactionJournals.receiptEvidenceBytes,
      participantWorkBytes: fxSystemTransactionJournals.participantWorkBytes,
      participantWorkCalls: fxSystemTransactionJournals.participantWorkCalls,
      failureDimension: fxSystemTransactionJournals.failureDimension,
      sealedJournalByteLength: sql<number | null>`
        octet_length(${fxSystemTransactionJournals.sealedJournalBytes})
      `,
      sealedJournalSha256:
        fxSystemTransactionJournals.sealedJournalSha256,
      sealedResultValueCodecVersion:
        fxSystemTransactionJournals.sealedResultValueCodecVersion,
      sealedResultSemanticBytes:
        fxSystemTransactionJournals.sealedResultSemanticBytes,
      sealedResultByteLength: sql<number | null>`
        octet_length(${fxSystemTransactionJournals.sealedResultBytes})
      `,
      sealedResultSha256:
        fxSystemTransactionJournals.sealedResultSha256,
      sealedAt: fxSystemTransactionJournals.sealedAt,
      createdAt: fxSystemTransactionJournals.createdAt,
      updatedAt: fxSystemTransactionJournals.updatedAt,
    })
    .from(fxSystemTransactionJournals)
    .where(and(
      eq(
        fxSystemTransactionJournals.scopeUuid,
        command.sealIdentity.scopeUuid,
      ),
      eq(
        fxSystemTransactionJournals.sessionId,
        command.authorityPins.sessionId,
      ),
      eq(
        fxSystemTransactionJournals.attemptFence,
        command.authorityPins.attemptFence,
      ),
    ))
    .limit(2)
    .for("update");
  observeDrizzleQuery("lockJournalRoot", query, options);
  const rows = await sqlCall("lockJournalRoot", () => query);
  return projectPointCommitTransactionResult(Result.gen(function* () {
    if (rows.length !== 1) {
      return yield* Result.fail(
        corruption("journalRootMissingOrDuplicate"),
      );
    }
    const row = rows[0];
    if (row === undefined) {
      return yield* Result.fail(
        corruption("journalRootMissingOrDuplicate"),
      );
    }
    const expected = command.sealIdentity;
    const createdAtMilliseconds = finiteDateMilliseconds(row.createdAt);
    const updatedAtMilliseconds = finiteDateMilliseconds(row.updatedAt);
    const sealedAtMilliseconds = finiteDateMilliseconds(row.sealedAt);
    if (
      row.scopeUuid !== expected.scopeUuid ||
      row.sessionId !== command.authorityPins.sessionId ||
      row.attemptFence !== command.authorityPins.attemptFence ||
      row.state !== "sealed" ||
      row.failureDimension !== null ||
      row.sealedJournalByteLength === null ||
      row.sealedJournalSha256 === null ||
      row.sealedResultValueCodecVersion === null ||
      row.sealedResultSemanticBytes === null ||
      row.sealedResultByteLength === null ||
      row.sealedResultSha256 === null ||
      row.sealedAt === null ||
      row.lastSyscallSequence !== expected.finalSyscallSequence ||
      row.creationTimeSeed !== expected.creationTimeSeed ||
      row.nextCreationTime !== expected.nextCreationTime ||
      row.readDocuments !== expected.readDocuments ||
      row.readSemanticBytes !== expected.readSemanticBytes ||
      row.pointDependencyCount !== expected.pointDependencyCount ||
      row.indexedQuerySyscalls !== expected.indexedQuerySyscalls ||
      row.indexRangeDependencyCount !==
        expected.indexRangeDependencyCount ||
      row.indexRangeDependencyEvidenceBytes !==
        expected.indexRangeDependencyEvidenceBytes ||
      row.relationReadSyscalls !== expected.relationReadSyscalls ||
      row.relationDependencyCount !== expected.relationDependencyCount ||
      row.relationBaseOccurrences !== expected.relationBaseOccurrences ||
      row.writeOperations !== expected.writeOperations ||
      row.writeSemanticBytes !== expected.writeSemanticBytes ||
      row.materialWriteEventEvidenceBytes !==
        expected.materialWriteEventEvidenceBytes ||
      row.receiptEvidenceBytes !== expected.receiptEvidenceBytes ||
      row.participantWorkBytes !== expected.participantWorkBytes ||
      row.participantWorkCalls !== expected.participantWorkCalls ||
      row.sealedJournalByteLength !== expected.journalByteLength ||
      !bytesEqual(row.sealedJournalSha256, expected.journalSha256) ||
      row.sealedResultValueCodecVersion !== expected.resultValueCodecVersion ||
      row.sealedResultSemanticBytes !== expected.resultSemanticBytes ||
      row.sealedResultByteLength !== expected.resultByteLength ||
      !bytesEqual(row.sealedResultSha256, expected.resultSha256) ||
      createdAtMilliseconds === undefined ||
      updatedAtMilliseconds === undefined ||
      sealedAtMilliseconds === undefined ||
      createdAtMilliseconds !== expected.rootCreatedAtMilliseconds ||
      updatedAtMilliseconds !== expected.rootUpdatedAtMilliseconds ||
      sealedAtMilliseconds !== expected.sealedAtMilliseconds
    ) {
      return yield* Result.fail(corruption("journalRootInvalid"));
    }
    return row.executionProfile;
  }));
}

function requireAttemptIsLiveResult(
  session: LockedPointCommitSessionV1,
  lease: Pick<LockedPointCommitLeaseV1, "expiresAtMilliseconds">,
  databaseNowMilliseconds: number,
): Result.Result<void, PointCommitStaleAuthorityV1Error> {
  if (
    session.authorizationGrantExpiresAtMilliseconds <=
      databaseNowMilliseconds ||
    session.hardExpiresAtMilliseconds <= databaseNowMilliseconds ||
    lease.expiresAtMilliseconds <= databaseNowMilliseconds
  ) {
    return Result.fail(stale("expired"));
  }
  return Result.succeed(undefined);
}

async function findPointCommitIndexRangeConflict(
  tx: AppRowTransaction,
  clock: LockedPointCommitClockV1,
  command: PreparedPointCommitDependencyCommandV1,
): Promise<PointCommitConflictV1Error | null> {
  const dependencies = command.indexRangeDependencies;
  if (dependencies.length === 0) return null;
  const snapshotCommitSeq = command.authorityPins.snapshotToken.commitSeq;
  const lastCommitSeq = CommitSeqSchema.make(clock.record.lastCommitSeq);
  const first = dependencies[0]!;
  if (
    snapshotCommitSeq < clock.oldestAvailableCommitSeq ||
    lastCommitSeq - snapshotCommitSeq > MAX_INDEX_RANGE_OCC_COMMIT_SPAN_V1
  ) {
    return new PointCommitConflictV1Error({
      conflict: Object.freeze({
        kind: "appIndexRange",
        reason: "validationWindowExceeded",
        dependencyOrdinal: 0,
        tableId: first.tableId,
        indexDefinitionId: first.indexDefinitionId,
      }),
      snapshotCommitSeq,
      currentCommitSeq: lastCommitSeq,
    });
  }
  if (lastCommitSeq === snapshotCommitSeq) return null;

  const requestedValues = sql.join(dependencies.map((dependency, ordinal) => {
    const lower = dependency.lower === null
      ? null
      : orderedIndexBoundHexV1ToBytes(dependency.lower.encodedKey);
    const upper = dependency.upper === null
      ? null
      : dependency.upper.kind === "key"
        ? orderedIndexBoundHexV1ToBytes(dependency.upper.encodedKey)
        : orderedIndexKeyBytesHexV1ToBytes(dependency.upper.encodedKey);
    const upperRowId = dependency.upper?.kind === "position"
      ? orderedIndexRowIdHexV1ToBytes(dependency.upper.rowId)
      : null;
    return sql`(
      ${ordinal}::integer,
      ${dependency.indexDefinitionId}::integer,
      ${lower}::bytea,
      ${dependency.upper?.kind ?? "unbounded"}::text,
      ${upper}::bytea,
      ${upperRowId}::bytea
    )`;
  }), sql`, `);
  const statement = sql`
    with requested(
      ordinal,
      index_definition_id,
      lower_encoded_key,
      upper_kind,
      upper_encoded_key,
      upper_row_id
    ) as (values ${requestedValues})
    select
      requested.ordinal::text as "ordinalText",
      revision.table_id::text as "tableIdText",
      revision.key_codec_version::text as "keyCodecVersionText",
      revision.physical_spec_sha256 as "physicalSpecSha256",
      revision.encoded_key as "encodedKeyBytes",
      revision.row_id as "rowIdBytes",
      revision.commit_seq::text as "commitSeqText"
    from requested
    join fx_app_index_entry_rev as revision
      on revision.scope_uuid = ${clock.scopeUuid}
      and revision.index_definition_id = requested.index_definition_id
      and revision.commit_seq > ${snapshotCommitSeq}
      and revision.commit_seq <= ${lastCommitSeq}
      and (
        requested.lower_encoded_key is null or
        revision.encoded_key >= requested.lower_encoded_key
      )
      and (
        requested.upper_kind = 'unbounded' or
        (
          requested.upper_kind = 'key' and
          revision.encoded_key < requested.upper_encoded_key
        ) or
        (
          requested.upper_kind = 'position' and
          (
            revision.encoded_key < requested.upper_encoded_key or
            (
              revision.encoded_key = requested.upper_encoded_key and
              revision.row_id <= requested.upper_row_id
            )
          )
        )
      )
    order by requested.ordinal asc, revision.commit_seq asc,
      revision.encoded_key asc, revision.row_id asc
    limit 1
  `;
  const result = await sqlCall(
    "validateIndexRanges",
    () => tx.execute(statement),
  );
  const rows = rowsFromDriverExecuteResult(result, () => {
    throw corruption("occEvidenceInvalid");
  });
  if (rows.length === 0) return null;
  if (rows.length !== 1) throw corruption("occEvidenceInvalid");
  const decoded = projectPointCommitTransactionResult(
    decodePointCommitIndexRangeConflictRowResult(
      rows[0],
      dependencies,
      snapshotCommitSeq,
      lastCommitSeq,
    ),
  );
  return new PointCommitConflictV1Error({
    conflict: Object.freeze({
      kind: "appIndexRange",
      reason: "overlap",
      dependencyOrdinal: decoded.ordinal,
      tableId: decoded.tableId,
      indexDefinitionId: decoded.indexDefinitionId,
      encodedKey: decoded.encodedKey,
      rowId: decoded.rowId,
    }),
    snapshotCommitSeq,
    currentCommitSeq: decoded.currentCommitSeq,
  });
}

async function findPointCommitRelationConflict(
  tx: AppRowTransaction,
  clock: LockedPointCommitClockV1,
  command: PreparedPointCommitDependencyCommandV1,
  options: PointCommitTransactionProofOptionsV1,
): Promise<PointCommitConflictV1Error | null> {
  const dependencies = command.relationDependencies;
  if (dependencies.length === 0) return null;
  const pointCommitObserver = options.observeQuery;
  const settled = await runPointCommitInTransactionEffect(
    readIncomingAppRelationEdgeAdjacencyVersionsInTransactionEffect(tx, {
      scopeId: command.authorityPins.scopeId,
      endpoints: dependencies.map((dependency) => Object.freeze({
        edgeDefinitionId: dependency.edgeDefinitionId,
        targetRowId: dependency.targetRowId,
      })),
      ...(pointCommitObserver === undefined
        ? {}
        : {
            observeQuery: ({ sql: statement, params }) =>
              pointCommitObserver(Object.freeze({
                name: "validateRelationDependencies",
                sql: statement,
                params,
              })),
          }),
    }),
  );
  const currentVersions = projectPointCommitTransactionResult(
    settled.pipe(Result.mapError((failure) =>
      failure instanceof AppRelationEdgePersistenceError
        ? new PointCommitSqlFailureMarkerV1(
            "validateRelationDependencies",
            failure.cause,
          )
        : corruption("occEvidenceInvalid")
    )),
  );
  if (currentVersions.length !== dependencies.length) {
    throw corruption("occEvidenceInvalid");
  }
  for (let ordinal = 0; ordinal < dependencies.length; ordinal += 1) {
    const dependency = dependencies[ordinal];
    const currentVersion = currentVersions[ordinal];
    if (dependency === undefined || currentVersion === undefined) {
      throw corruption("occEvidenceInvalid");
    }
    if (
      currentVersion.edgeDefinitionId !== dependency.edgeDefinitionId ||
      currentVersion.targetRowId !== dependency.targetRowId
    ) {
      throw corruption("occEvidenceInvalid");
    }
    const current = currentVersion.adjacencyVersion;
    if (
      current < dependency.observedAdjacencyVersion ||
      current > clock.record.lastCommitSeq
    ) {
      throw corruption("occEvidenceInvalid");
    }
    if (current !== dependency.observedAdjacencyVersion) {
      if (current <= command.authorityPins.snapshotToken.commitSeq) {
        throw corruption("occEvidenceInvalid");
      }
      return new PointCommitConflictV1Error({
        conflict: Object.freeze({
          kind: "appRelationIncoming",
          edgeDefinitionId: dependency.edgeDefinitionId,
          targetRowId: dependency.targetRowId,
        }),
        snapshotCommitSeq: command.authorityPins.snapshotToken.commitSeq,
        currentCommitSeq: current,
      });
    }
  }
  return null;
}

function decodePointCommitIndexRangeConflictRowResult(
  value: unknown,
  dependencies: PreparedPointCommitDependencyCommandV1[
    "indexRangeDependencies"
  ],
  snapshotCommitSeq: CommitSeq,
  lastCommitSeq: CommitSeq,
): Result.Result<
  Readonly<{
    readonly ordinal: number;
    readonly tableId: CatalogTableId;
    readonly indexDefinitionId: CatalogIndexDefinitionId;
    readonly currentCommitSeq: CommitSeq;
    readonly encodedKey: OrderedIndexKeyBytesHexV1;
    readonly rowId: OrderedIndexRowIdHexV1;
  }>,
  PointCommitCorruptionV1Error
> {
  return Result.gen(function* () {
    if (!isNonArrayRecord(value)) {
      return yield* Result.fail(corruption("occEvidenceInvalid"));
    }
    const ordinal = yield* parseNonNegativeIntegerTextResult(
      value.ordinalText,
    ).pipe(Result.mapError(() => corruption("occEvidenceInvalid")));
    const dependency = dependencies[ordinal];
    if (dependency === undefined) {
      return yield* Result.fail(corruption("occEvidenceInvalid"));
    }
    const tableId = yield* parseNonNegativeIntegerTextResult(
      value.tableIdText,
    ).pipe(
      Result.mapError(() => corruption("occEvidenceInvalid")),
      Result.filterOrFail(
        (parsed) => parsed > 0,
        () => corruption("occEvidenceInvalid"),
      ),
      Result.flatMap((parsed) =>
        decodePointCommitEncodedTableIdResult(parsed).pipe(
          Result.mapError(() => corruption("occEvidenceInvalid")),
        )
      ),
    );
    const keyCodecVersion = yield* parseNonNegativeIntegerTextResult(
      value.keyCodecVersionText,
    ).pipe(Result.mapError(() => corruption("occEvidenceInvalid")));
    const currentCommitSeq = yield* parseNullableCommitSeqTextResult(
      value.commitSeqText,
    ).pipe(
      Result.mapError(() => corruption("occEvidenceInvalid")),
      Result.filterOrFail(
        (parsed): parsed is CommitSeq => parsed !== null,
        () => corruption("occEvidenceInvalid"),
      ),
    );
    if (
      !isUint8Array(value.physicalSpecSha256) ||
      encodeBytesToLowercaseHex(value.physicalSpecSha256) !==
        dependency.physicalSpecSha256Hex ||
      tableId !== dependency.tableId ||
      keyCodecVersion !== dependency.keyCodecVersion ||
      currentCommitSeq <= snapshotCommitSeq ||
      currentCommitSeq > lastCommitSeq ||
      !isUint8Array(value.encodedKeyBytes) ||
      !isUint8Array(value.rowIdBytes)
    ) {
      return yield* Result.fail(corruption("occEvidenceInvalid"));
    }
    const encodedKeyBytes = value.encodedKeyBytes;
    const rowIdBytes = value.rowIdBytes;
    const encodedKey = yield* Result.try({
      try: () => orderedIndexKeyBytesHexV1FromBytes(encodedKeyBytes),
      catch: () => corruption("occEvidenceInvalid"),
    });
    const rowId = yield* orderedIndexRowIdHexV1FromBytesResult(
      rowIdBytes,
    ).pipe(Result.mapError(() => corruption("occEvidenceInvalid")));
    return Object.freeze({
      ordinal,
      tableId,
      indexDefinitionId: dependency.indexDefinitionId,
      currentCommitSeq,
      encodedKey,
      rowId,
    });
  });
}

/** Cold replacement authenticates the sealed contract before inspecting lease
 * presence. Its exact journal also owns conflict reproduction below. */
async function readSealedPointCommitJournal(
  tx: AppRowTransaction, command: PreparedPointCommitAttemptScalarCommandV1,
  options: PointCommitTransactionProofOptionsV1,
): Promise<SessionJournal> {
  const query = tx.select({ sealedJournalBytes: fxSystemTransactionJournals.sealedJournalBytes })
    .from(fxSystemTransactionJournals).where(and(
      eq(fxSystemTransactionJournals.scopeUuid, command.sealIdentity.scopeUuid),
      eq(fxSystemTransactionJournals.sessionId, command.authorityPins.sessionId),
      eq(fxSystemTransactionJournals.attemptFence, command.authorityPins.attemptFence),
    )).limit(2);
  observeDrizzleQuery("lockJournalRoot", query, options);
  const rows = await sqlCall("lockJournalRoot", () => query);
  const bytes = rows[0]?.sealedJournalBytes;
  if (rows.length !== 1 || !isUint8ArrayWithByteLength(bytes, command.sealIdentity.journalByteLength))
    // oxlint-disable-next-line flarex/no-throw-inside-effect-operation -- REVIEW: transaction - corrupt sealed journal rows refuse before replacement through the typed Promise rollback adapter
    throw corruption("occEvidenceInvalid");
  const sealed = projectPointCommitTransactionResult(await runPointCommitInTransactionEffect(
    decodeCanonicalSessionJournalEffect({ canonicalBytes: bytes,
      expectedSha256Hex: encodeBytesToLowercaseHex(command.sealIdentity.journalSha256) })
      .pipe(Effect.mapError(() => corruption("occEvidenceInvalid")))));
  return sealed.journal;
}

async function requireReproduciblePointCommitConflict(
  tx: AppRowTransaction,
  clock: LockedPointCommitClockV1,
  command: PreparedPointMutationAttemptReplacementCommandV1,
  heads: ReadonlyArray<LoadedPointCommitHeadV1>,
  options: PointCommitTransactionProofOptionsV1,
  authority: TrustedScopeAuthority,
  sealedJournal: SessionJournal,
  finiteReservation: FiniteMetadataReservation | null,
): Promise<void> {
  const metadataConflict = command.expectedConflict.conflict;
  if (metadataConflict.kind === "metadata" && (clock.record.lastMetadataSequence <= metadataConflict.capturedMetadataWatermark ||
    // oxlint-disable-next-line flarex/no-throw-inside-effect-operation -- REVIEW: transaction - inconsistent authenticated metadata witness must refuse through the typed Promise rollback adapter
    clock.record.lastMetadataSequence < metadataConflict.lastChangedMetadataSequence)) throw corruption("occEvidenceInvalid");
  const actual = command.expectedConflict.conflict.kind === "logicalParticipant"
    ? await findPointCommitLogicalParticipantConflict(tx, clock, command, options, authority, sealedJournal, finiteReservation)
    : command.expectedConflict.conflict.kind === "metadata"
    ? await findPointCommitMetadataConflict(tx, clock, command, sealedJournal, finiteReservation)
    : projectPointCommitTransactionResult(
      findPointCommitConflictAfterEvidenceValidationResult(command, heads),
    ) ?? await findPointCommitIndexRangeConflict(tx, clock, command) ??
      await findPointCommitRelationConflict(tx, clock, command, options);
  if (
    actual === null ||
    !pointCommitConflictsReproduce(command.expectedConflict, actual)
  ) {
    throw new PointMutationAttemptReplacementConflictNoLongerPresentV1Error({
      reason: "conflictNoLongerPresent",
    });
  }
}

async function findPointCommitMetadataConflict(tx: AppRowTransaction, clock: LockedPointCommitClockV1,
  command: PreparedPointMutationAttemptReplacementCommandV1, sealedJournal: SessionJournal,
  reservation: FiniteMetadataReservation | null): Promise<PointCommitConflictEvidenceV1 | null> {
  const expected = command.expectedConflict.conflict;
  if (expected.kind !== "metadata") return null;
  // oxlint-disable-next-line flarex/no-throw-inside-effect-operation -- REVIEW: transaction - metadata conflict without its reserved authority must refuse through the typed Promise rollback adapter
  if (reservation === null) throw corruption("occEvidenceInvalid");
  const dependencies = sealedJournal.readDependencies.filter((dependency): dependency is LogicalMetadataReadDependency => dependency.kind === "metadata" &&
    logicalMetadataDependencyIdentity(dependency) === logicalMetadataDependencyIdentity(expected));
  // oxlint-disable-next-line flarex/no-throw-inside-effect-operation -- REVIEW: transaction - missing or nonunique sealed dependency refuses through the typed Promise rollback adapter
  if (dependencies.length !== 1) throw corruption("occEvidenceInvalid");
  return projectPointCommitTransactionResult(await runPointCommitInTransactionEffect(
    validateConsumedMetadataDependencies(tx, command.authorityPins.scopeId, reservation.metadataWatermark, dependencies).pipe(
      Effect.as(null), Effect.catchTag("FiniteMetadataError", error => error.reason === "writeConflict" &&
        error.capturedMetadataWatermark !== undefined && error.lastChangedMetadataSequence !== undefined ? Effect.succeed(Object.freeze({
        conflict: Object.freeze({ kind: "metadata" as const, namespace: expected.namespace, ownerKey: expected.ownerKey, contractKey: expected.contractKey,
          capturedMetadataWatermark: error.capturedMetadataWatermark, lastChangedMetadataSequence: error.lastChangedMetadataSequence }),
        snapshotCommitSeq: command.authorityPins.snapshotToken.commitSeq, currentCommitSeq: clock.record.lastCommitSeq,
      })) : Effect.fail(error.reason === "resourceFailure" ? new PointCommitSqlFailureMarkerV1("validateIndexRanges", error.cause ?? error)
        : corruption("occEvidenceInvalid"))))));
}

async function findPointCommitLogicalParticipantConflict(
  tx: AppRowTransaction,
  clock: LockedPointCommitClockV1,
  command: PreparedPointMutationAttemptReplacementCommandV1,
  options: PointCommitTransactionProofOptionsV1,
  authority: TrustedScopeAuthority,
  sealedJournal: SessionJournal,
  finiteReservation: FiniteMetadataReservation | null,
): Promise<PointCommitConflictEvidenceV1 | null> {
  const expected = command.expectedConflict.conflict;
  if (expected.kind !== "logicalParticipant") return null;
  const matching = sealedJournal.participantOperations.filter(operation =>
    operation.participant === expected.participant && operation.syscallSequence === expected.syscallSequence);
  if (matching.length !== 1) throw corruption("occEvidenceInvalid");
  const operation = matching[0]!;
  const selectedProfile = projectPointCommitTransactionResult(selectLogicalOperationProfileResult(options, operation));
  projectPointCommitTransactionResult((await runPointCommitInTransactionEffect(
    requireAdmittedOperationBundleDigest(operation))).pipe(Result.mapError(error =>
      error instanceof PointCommitAdmissionDigestProviderError ? error.cause : error)));
  for (const [ordinal, contribution] of operation.sourceContributions.entries()) {
  const binding = projectPointCommitTransactionResult(canonicalizeAdmittedParticipantBindingV1Result({
    scopeId: command.authorityPins.scopeId,
    sessionId: command.authorityPins.sessionId,
    attemptFence: command.authorityPins.attemptFence,
    snapshotCommitSeq: command.authorityPins.snapshotToken.commitSeq,
    schemaVersionId: command.authorityPins.schemaVersionId,
    principalDigest: encodeBytesToLowercaseHex(command.session.identityAccessPolicySha256),
    participant: operation.participant,
    method: operation.method,
    sourceKey: contribution.sourceKey,
    sourceSha256Hex: contribution.sourceSha256Hex,
    bindingHead: contribution.bindingHead,
  }).pipe(Result.mapError(() => corruption("commandInvalid"))));
  const bindingDigest = encodeBytesToLowercaseHex(new Uint8Array(
    await crypto.subtle.digest("SHA-256", new Uint8Array(binding.bytes).buffer)));
  if (bindingDigest !== contribution.sourceBindingSha256Hex) throw corruption("commandInvalid");
  const admitted = projectPointCommitTransactionResult(await runPointCommitInTransactionEffect(
    (finiteReservation === null ? requireLogicalParticipantCommitAuthorityEffect : requireFiniteLogicalParticipantCommitAuthorityEffect)(selectedProfile.authorities[ordinal]!,
      operation, contribution, tx, authority, clock.record).pipe(
      Effect.mapError(error => error.reason === "resourceFailure"
        ? new PointCommitSqlFailureMarkerV1("validateActiveApplicationSchema", error.cause ?? error)
        : error.reason === "storedCorruption" ? corruption("activeApplicationHeadInvalid")
          : new PointCommitStaleAuthorityV1Error({ reason: "activeSchemaChanged" })))));
  const validation = projectPointCommitTransactionResult(await runPointCommitInTransactionEffect(Effect.result(
    validateLogicalParticipantDependencyEvidence(tx, command.authorityPins.scopeId,
      operation, contribution, { tableIds: admitted.tableIds, ...admitted.readDefinitions }))));
  const conflict = Result.match(validation, {
    onSuccess: () => null,
    onFailure: failure => {
      if (failure.reason === "resourceFailure")
        throw new PointCommitSqlFailureMarkerV1("validateIndexRanges", failure.cause ?? failure);
      if (failure.reason !== "writeConflict") throw corruption("dependencySetInvalid");
      return Object.freeze({ conflict: Object.freeze({ kind: "logicalParticipant" as const,
        participant: operation.participant, syscallSequence: operation.syscallSequence }),
        snapshotCommitSeq: command.authorityPins.snapshotToken.commitSeq,
        currentCommitSeq: clock.record.lastCommitSeq });
    },
  });
  if (conflict !== null) return conflict;
  }
  return null;
}

function pointCommitConflictsReproduce(
  expected: PointCommitConflictEvidenceV1,
  actual: PointCommitConflictEvidenceV1,
): boolean {
  if (
    expected.snapshotCommitSeq !== actual.snapshotCommitSeq ||
    expected.conflict.kind !== actual.conflict.kind
  ) return false;
  if (expected.conflict.kind === "appRowPoint") {
    return actual.conflict.kind === "appRowPoint" &&
      expected.conflict.documentId === actual.conflict.documentId &&
      expected.currentCommitSeq === actual.currentCommitSeq;
  }
  if (expected.conflict.kind === "appRelationIncoming") {
    return actual.conflict.kind === "appRelationIncoming" &&
      expected.conflict.edgeDefinitionId ===
        actual.conflict.edgeDefinitionId &&
      expected.conflict.targetRowId === actual.conflict.targetRowId &&
      actual.currentCommitSeq >= expected.currentCommitSeq;
  }
  if (expected.conflict.kind === "logicalParticipant") {
    return actual.conflict.kind === "logicalParticipant" &&
      expected.conflict.participant === actual.conflict.participant &&
      expected.conflict.syscallSequence === actual.conflict.syscallSequence &&
      actual.currentCommitSeq >= expected.currentCommitSeq;
  }
  if (expected.conflict.kind === "metadata") return actual.conflict.kind === "metadata" &&
    logicalMetadataDependencyIdentity(expected.conflict) === logicalMetadataDependencyIdentity(actual.conflict) &&
    expected.conflict.capturedMetadataWatermark === actual.conflict.capturedMetadataWatermark &&
    actual.conflict.lastChangedMetadataSequence >= expected.conflict.lastChangedMetadataSequence &&
    actual.currentCommitSeq >= expected.currentCommitSeq;
  // Root-graph conflicts use exact finite nonacceptance, never legacy tickets.
  if (expected.conflict.kind !== "appIndexRange" || actual.conflict.kind !== "appIndexRange") return false;
  if (
    expected.conflict.reason !== actual.conflict.reason ||
    expected.conflict.dependencyOrdinal !== actual.conflict.dependencyOrdinal ||
    expected.conflict.tableId !== actual.conflict.tableId ||
    expected.conflict.indexDefinitionId !== actual.conflict.indexDefinitionId
  ) return false;
  return expected.conflict.reason === "validationWindowExceeded"
    ? actual.currentCommitSeq >= expected.currentCommitSeq
    : expected.currentCommitSeq === actual.currentCommitSeq &&
      expected.conflict.encodedKey === actual.conflict.encodedKey &&
      expected.conflict.rowId === actual.conflict.rowId;
}

async function publishPointCommitInTransaction(
  tx: AppRowTransaction,
  command: PreparedPointCommitPublicationCommandV1,
  kernel: Extract<PointCommitKernelResultV1, { readonly kind: "ready" }> & {
    readonly commitSeq: CommitSeq;
    readonly publicationTimeMilliseconds: number;
  },
  options: PointCommitTransactionProofOptionsV1,
): Promise<void> {
  const events = command.participantEventIntents;
  const eventSha256 = events.length === 0 ? null : projectPointCommitTransactionResult(
    await runPointCommitInTransactionEffect(commitEventsDigest(events).pipe(Effect.mapError(error =>
      error.reason === "resourceFailure" ? new PointCommitSqlFailureMarkerV1("writeCommitChange", error.cause ?? error)
        : corruption("commandInvalid")))));
  const contribution: ScopePublicationContribution = {
    authorityPins: command.authorityPins,
    rowIntents: command.rowIntents,
    identityAccessPolicySha256: command.session.identityAccessPolicySha256,
    requestSha256: command.session.requestSha256,
    resultSha256: command.sealIdentity.resultSha256,
    successfulResult: { ...command.successfulResult, encoding: "application-value" },
    ...(events.length === 0 ? {} : { events: { values: events, sha256: eventSha256 } }),
  };
  const prefix = await writeScopePublicationPrefix(tx, contribution, kernel, options);
  const publicationTime = new Date(kernel.publicationTimeMilliseconds);
  const scopeUuid = kernel.clock.scopeUuid;
  const journal = await sqlCall("deleteJournal", () =>
    tx.delete(fxSystemTransactionJournals).where(and(
      eq(fxSystemTransactionJournals.scopeUuid, scopeUuid),
      eq(
        fxSystemTransactionJournals.sessionId,
        command.authorityPins.sessionId,
      ),
      eq(
        fxSystemTransactionJournals.attemptFence,
        command.authorityPins.attemptFence,
      ),
    )).returning({ sessionId: fxSystemTransactionJournals.sessionId }));
  projectPointCommitTransactionResult(requireSinglePublicationWriteResult(
    journal,
    command.authorityPins.sessionId,
    "sessionId",
  ));
  await emitTransactionStep(options, command, "journalDeleted");
  if (options.publicationObservation?.detail) options.publicationObservation.record({ kind: "batch", owner: "journalDeletes", counts: { rows: journal.length } });

  const lease = await sqlCall("deleteLease", () =>
    tx.delete(fxSystemSnapshotLeases).where(and(
      eq(fxSystemSnapshotLeases.scopeUuid, scopeUuid),
      eq(
        fxSystemSnapshotLeases.sessionId,
        command.authorityPins.sessionId,
      ),
      eq(
        fxSystemSnapshotLeases.attemptFence,
        command.authorityPins.attemptFence,
      ),
    )).returning({ sessionId: fxSystemSnapshotLeases.sessionId }));
  projectPointCommitTransactionResult(requireSinglePublicationWriteResult(
    lease,
    command.authorityPins.sessionId,
    "sessionId",
  ));
  await emitTransactionStep(options, command, "leaseDeleted");
  if (options.publicationObservation?.detail) options.publicationObservation.record({ kind: "batch", owner: "leaseDeletes", counts: { rows: lease.length } });

  const session = await sqlCall("commitSession", () =>
    tx.update(fxSystemTransactionSessions).set({
      validatedArgsJson: null,
      validatedArgsCanonicalBytes: null,
      authorizationGrantJson: null,
      authorizationGrantCanonicalBytes: null,
      applicationExecutionAuthorityJson: null,
      applicationExecutionAuthorityCanonicalBytes: null,
      lifecycle: "committed",
      updatedAt: publicationTime,
    }).where(and(
      eq(fxSystemTransactionSessions.scopeUuid, scopeUuid),
      eq(
        fxSystemTransactionSessions.sessionId,
        command.authorityPins.sessionId,
      ),
      eq(
        fxSystemTransactionSessions.attemptFence,
        command.authorityPins.attemptFence,
      ),
      eq(fxSystemTransactionSessions.lifecycle, "finishing"),
    )).returning({ sessionId: fxSystemTransactionSessions.sessionId }));
  projectPointCommitTransactionResult(requireSinglePublicationWriteResult(
    session,
    command.authorityPins.sessionId,
    "sessionId",
  ));
  await emitTransactionStep(options, command, "sessionCommitted");
  if (options.publicationObservation?.detail) options.publicationObservation.record({ kind: "batch", owner: "sessionCommits", counts: { rows: session.length } });

  await reproveScopePublicationPrefix(prefix);
  await advanceScopePublicationClock(tx, contribution, kernel, options);
}

function requireSinglePublicationWriteResult<
  Key extends "commitSeq" | "sessionId",
  Value,
>(
  rows: ReadonlyArray<Readonly<Record<Key, Value>>>,
  expected: Value,
  key: Key,
): Result.Result<void, PointCommitCorruptionV1Error> {
  return rows.length === 1 && rows[0]?.[key] === expected
    ? Result.succeed(undefined)
    : Result.fail(corruption("publicationInvariantInvalid"));
}

async function emitReplacementStep(
  options: PointMutationAttemptReplacementOptionsV1,
  command: PreparedPointCommitAuthorityCommandV1,
  step: PointMutationAttemptReplacementProofStepV1,
): Promise<void> {
  await options.afterReplacementStep?.(Object.freeze({
    scopeId: command.authorityPins.scopeId,
    step,
  }));
}

function preliminaryAuthorityFailure(
  command: PreparedPointCommitAuthorityCommandV1,
  preliminary: TrustedScopeAuthority,
): PointCommitStaleAuthorityV1Error | null {
  const pins = command.authorityPins;
  if (
    preliminary.deploymentId !== pins.deploymentId ||
    preliminary.scopeId !== pins.scopeId
  ) {
    return stale("scopeChanged");
  }
  if (
    preliminary.storageGeneration !== pins.storageGeneration ||
    preliminary.storageGenerationFence !== pins.storageGenerationFence
  ) {
    return stale("generationChanged");
  }
  if (preliminary.epoch !== pins.snapshotToken.epoch) {
    return stale("epochChanged");
  }
  return null;
}

function observeDrizzleQuery(
  name: PointCommitSqlOperationV1,
  query: Readonly<{
    toSQL: () => Readonly<{
      sql: string;
      params: ReadonlyArray<unknown>;
    }>;
  }>,
  options: PointCommitTransactionProofOptionsV1,
): void {
  observeCompiledDrizzleQuery(name, query, options.observeQuery);
}

function observeReplacementQuery(
  name: PointMutationAttemptReplacementSqlOperationV1,
  query: Readonly<{
    toSQL: () => Readonly<{
      sql: string;
      params: ReadonlyArray<unknown>;
    }>;
  }>,
  options: PointMutationAttemptReplacementOptionsV1,
): void {
  observeCompiledDrizzleQuery(name, query, options.observeQuery);
}

async function replacementSqlCall<Value>(
  operation: PointMutationAttemptReplacementSqlOperationV1,
  call: () => PromiseLike<Value>,
): Promise<Value> {
  try {
    return await call();
  } catch (cause) {
    if (
      cause instanceof PointMutationAttemptReplacementCommittedOutcomeV1Error ||
      cause instanceof PointMutationAttemptReplacementConflictNoLongerPresentV1Error ||
      cause instanceof PointMutationAttemptReplacementRequestKeyReuseV1Error ||
      cause instanceof PointMutationAttemptReplacementCorruptionV1Error ||
      cause instanceof PointMutationAttemptReplacementStaleAuthorityV1Error ||
      cause instanceof PointMutationAttemptReplacementResourceExhaustionV1Error ||
      cause instanceof PointCommitConflictV1Error ||
      cause instanceof PointCommitStaleAuthorityV1Error ||
      cause instanceof PointCommitCorruptionV1Error ||
      cause instanceof CommittedPointOutcomeRequestKeyReuseErrorV1 ||
      cause instanceof CommittedPointOutcomeCorruptionErrorV1
    ) {
      throw cause;
    }
    throw new PointMutationAttemptReplacementSqlFailureMarkerV1(
      operation,
      cause,
    );
  }
}

function mapPointMutationAttemptReplacementSharedError(
  cause:
    | PointCommitStaleAuthorityV1Error
    | PointCommitCorruptionV1Error
    | PointCommitSqlErrorV1,
): PointMutationAttemptReplacementV1Error {
  if (cause instanceof PointCommitStaleAuthorityV1Error) {
    return new PointMutationAttemptReplacementStaleAuthorityV1Error({
      reason: cause.reason,
    });
  }
  if (cause instanceof PointCommitCorruptionV1Error) {
    return replacementCorruption(cause.reason);
  }
  return replacementSqlError(cause.operation, cause.cause);
}

function publicationResultFromOutcomeResult(
  outcome: CommittedPointOutcomeResolutionV1,
  disposition: "published" | "replayed",
  expectedToken?: CommittedPointOutcomeTokenV1,
): Result.Result<
  PointCommitPublicationResultV1,
  PointCommitCorruptionV1Error
> {
  if (outcome.kind === "missing") {
    return Result.fail(corruption("committedOutcomeMissing"));
  }
  if (
    expectedToken !== undefined &&
    (
      outcome.token.scopeUuid !== expectedToken.scopeUuid ||
      outcome.token.epochUuid !== expectedToken.epochUuid ||
      outcome.token.commitSeq !== expectedToken.commitSeq
    )
  ) {
    return Result.fail(corruption("publishedOutcomeInvalid"));
  }
  if (outcome.kind === "expired") {
    if (disposition === "published") {
      return Result.fail(corruption("publishedOutcomeInvalid"));
    }
    return Result.succeed(
      Object.freeze({ kind: "expired", token: outcome.token }),
    );
  }
  return Result.succeed(
    Object.freeze({
      kind: disposition,
      token: outcome.token,
      successfulResult: outcome.successfulResult,
    }),
  );
}

function publicationResultFromOutcomeEffect(
  outcome: CommittedPointOutcomeResolutionV1,
  disposition: "published" | "replayed",
  expectedToken?: CommittedPointOutcomeTokenV1,
): Effect.Effect<
  PointCommitPublicationResultV1,
  PointCommitCorruptionV1Error
> {
  return Effect.fromResult(
    publicationResultFromOutcomeResult(
      outcome,
      disposition,
      expectedToken,
    ),
  );
}

function routeAuthorityResolutionFailure(
  cause: TrustedScopeAuthorityError,
): Effect.Effect<never, PointCommitFinishingTransitionV1Error> {
  const underlyingCause = cause instanceof TrustedScopeAuthorityPortError
    ? cause.cause
    : cause;
  if (underlyingCause instanceof TrustedScopeAuthorityResolutionError) {
    const failure = underlyingCause.failure;
    switch (failure.reason) {
      case "scopeClockTargetResolutionFailed":
        return Effect.fail(
          sqlError("resolveAuthority", failure.resolutionCause),
        );
      case "scopeClockTargetInvalid":
      case "scopeClockScopeMismatch":
        return Effect.fail(corruption("scopeClockInvalid"));
      case "scopeMetadataMissing":
      case "scopeMetadataAmbiguous":
      case "scopeDeploymentMismatch":
      case "splitProvisioningReceiptMissing":
      case "splitProvisioningReceiptScopeMismatch":
      case "splitProvisioningReceiptNotReady":
      case "splitProvisioningReceiptPlacementMismatch":
      case "scopeClockTargetPlacementMismatch":
      case "scopeClockMissing":
        return Effect.fail(stale("placementChanged"));
      default:
        return unexpectedAuthorityResolutionFailure(failure);
    }
  }
  const sqlState = findSqlState(underlyingCause);
  if (sqlState !== undefined) {
    return Effect.fail(sqlError("resolveAuthority", underlyingCause));
  }
  return Effect.die(underlyingCause);
}

function unexpectedAuthorityResolutionFailure(failure: never): never {
  throw failure;
}

function mapFinishingTransitionFailure(
  cause: unknown,
): PointCommitFinishingTransitionV1Error {
  if (
    cause instanceof PointCommitStaleAuthorityV1Error ||
    cause instanceof PointCommitCorruptionV1Error ||
    cause instanceof PointCommitSqlErrorV1
  ) {
    return cause;
  }
  if (cause instanceof TransactionExecutionClaimCorruptionV1Error) {
    return corruption("finishingTransitionInvalid");
  }
  if (cause instanceof TransactionExecutionClaimStaleV1Error) {
    return stale(
      cause.reason === "claimExpired" ? "expired" : "lifecycleChanged",
    );
  }
  if (cause instanceof LocatedReadCommittedTransactionFailureV1) {
    if (
      cause.issue.kind === "callbackRolledBack" &&
      cause.issue.callbackCause !== cause
    ) {
      return mapFinishingTransitionFailure(cause.issue.callbackCause);
    }
    return sqlError("beginOrRollback", cause);
  }
  if (cause instanceof PointCommitSqlFailureMarkerV1) {
    return sqlError(cause.operation, cause.cause);
  }
  if (
    cause instanceof ScopeClockCorruptionError ||
    cause instanceof ScopeClockNotFoundError
  ) {
    return corruption("scopeClockInvalid");
  }
  const sqlState = findSqlState(cause);
  if (sqlState !== undefined) {
    return sqlError("beginOrRollback", cause);
  }
  throw cause;
}

function mapPointMutationAttemptReplacementTransactionFailure(
  cause: unknown,
): PointMutationAttemptReplacementV1Error {
  if (
    cause instanceof PointFiniteAttemptRetryBudgetExhaustedError ||
    cause instanceof PointMutationAttemptReplacementFiniteEntryError ||
    cause instanceof PointMutationAttemptReplacementCommittedOutcomeV1Error ||
    cause instanceof PointMutationAttemptReplacementConflictNoLongerPresentV1Error ||
    cause instanceof PointMutationAttemptReplacementRequestKeyReuseV1Error ||
    cause instanceof PointMutationAttemptReplacementCorruptionV1Error ||
    cause instanceof PointMutationAttemptReplacementStaleAuthorityV1Error ||
    cause instanceof PointMutationAttemptReplacementResourceExhaustionV1Error ||
    cause instanceof PointMutationAttemptReplacementSqlErrorV1
  ) {
    return cause;
  }
  if (cause instanceof PointCommitConfirmedPreDecisionRollbackV1Error)
    return replacementSqlError(cause.operation, cause.cause);
  if (cause instanceof CommittedPointOutcomeRequestKeyReuseErrorV1) {
    return new PointMutationAttemptReplacementRequestKeyReuseV1Error({
      mismatches: Object.freeze([...cause.mismatches]),
    });
  }
  if (cause instanceof CommittedPointOutcomeCorruptionErrorV1) {
    return replacementCorruption("committedOutcomeInvalid");
  }
  if (
    cause instanceof PointCommitStaleAuthorityV1Error ||
    cause instanceof PointCommitCorruptionV1Error ||
    cause instanceof PointCommitSqlErrorV1
  ) {
    return mapPointMutationAttemptReplacementSharedError(cause);
  }
  if (cause instanceof PointCommitConflictV1Error) {
    return replacementCorruption("occEvidenceInvalid");
  }
  if (cause instanceof TransactionExecutionClaimCorruptionV1Error) {
    return replacementCorruption("replacementConvergenceInvalid");
  }
  if (cause instanceof TransactionExecutionClaimStaleV1Error) {
    return new PointMutationAttemptReplacementStaleAuthorityV1Error({
      reason: cause.reason === "claimExpired" ? "expired" : "lifecycleChanged",
    });
  }
  if (cause instanceof LocatedReadCommittedTransactionFailureV1) {
    if (
      cause.issue.kind === "callbackRolledBack" &&
      cause.issue.callbackCause !== cause
    ) {
      return mapPointMutationAttemptReplacementTransactionFailure(
        cause.issue.callbackCause,
      );
    }
    return replacementSqlError("beginOrRollback", cause);
  }
  if (cause instanceof PointMutationAttemptReplacementSqlFailureMarkerV1) {
    return replacementSqlError(cause.operation, cause.cause);
  }
  if (cause instanceof PointCommitSqlFailureMarkerV1) {
    return replacementSqlError(cause.operation, cause.cause);
  }
  if (
    cause instanceof ScopeClockCorruptionError ||
    cause instanceof ScopeClockNotFoundError
  ) {
    return replacementCorruption("scopeClockInvalid");
  }
  if (isAppendAppRowRevisionV1Error(cause)) {
    return replacementCorruption("rowHeadInvalid");
  }
  const sqlState = findSqlState(cause);
  if (sqlState !== undefined) {
    return replacementSqlError("beginOrRollback", cause);
  }
  throw cause;
}

function mapPublicationTransactionFailure(
  cause: unknown,
): PointCommitPublicationV1Error |
  PointCommitTransactionDecisionUncertainV1Error {
  if (
    cause instanceof CommittedPointOutcomeRequestKeyReuseErrorV1 ||
    cause instanceof CommittedPointOutcomeCorruptionErrorV1
  ) {
    return cause;
  }
  if (cause instanceof LocatedReadCommittedTransactionFailureV1) {
    if (cause.issue.kind === "decisionUncertain") {
      return new PointCommitTransactionDecisionUncertainV1Error({ cause });
    }
    if (cause.issue.kind === "callbackRolledBack") {
      return mapPointCommitCallbackFailure(cause.issue.callbackCause);
    }
  }
  return mapTransactionFailure(cause);
}

function mapPointCommitCallbackFailure(cause: unknown): PointCommitPublicationV1Error {
  if (cause instanceof PointCommitSqlFailureMarkerV1) {
    const sqlState = confirmedPreDecisionSqlState(cause.cause);
    if (sqlState !== undefined) return new PointCommitConfirmedPreDecisionRollbackV1Error({
      operation: cause.operation, sqlState, cause: cause.cause,
    });
  }
  return mapTransactionFailure(cause);
}

function confirmedPreDecisionSqlState(
  cause: unknown,
): PointCommitConfirmedPreDecisionSqlStateV1 | undefined {
  const sqlState = findSqlState(cause);
  return sqlState === "40001" || sqlState === "40P01"
    ? sqlState
    : undefined;
}

function decisionUncertain(
  cause: LocatedReadCommittedTransactionFailureV1,
  outcomeCheck: PointCommitDecisionUncertainOutcomeCheckV1,
): PointCommitDecisionUncertainV1Error {
  return new PointCommitDecisionUncertainV1Error({
    phase: "commitOrRelease",
    cause,
    outcomeCheck,
  });
}

function validHash(value: unknown): value is Uint8Array {
  return isUint8ArrayWithByteLength(value, HASH_BYTE_LENGTH);
}

function validEpochMilliseconds(value: unknown): value is number {
  return isPositiveSafeInteger(value);
}

function committedOutcomeCorruption(
  input: ResolveCommittedPointOutcomeInputV1,
  reason: CommittedPointOutcomeCorruptionReasonV1,
  commitSeq?: CommitSeq,
): CommittedPointOutcomeCorruptionErrorV1 {
  return new CommittedPointOutcomeCorruptionErrorV1({
    scopeUuid: input.scopeUuid,
    reason,
    ...(commitSeq === undefined ? {} : { commitSeq }),
  });
}

function replacementCorruption(
  reason: PointMutationAttemptReplacementCorruptionReasonV1,
): PointMutationAttemptReplacementCorruptionV1Error {
  return new PointMutationAttemptReplacementCorruptionV1Error({ reason });
}

function replacementSqlError(
  operation: PointMutationAttemptReplacementSqlOperationV1,
  cause: unknown,
): PointMutationAttemptReplacementSqlErrorV1 {
  const sqlState = findSqlState(cause);
  return new PointMutationAttemptReplacementSqlErrorV1({
    operation,
    cause,
    ...(sqlState === undefined ? {} : { sqlState }),
  });
}

function stale(
  reason: PointCommitStaleAuthorityReasonV1,
): PointCommitStaleAuthorityV1Error {
  return new PointCommitStaleAuthorityV1Error({ reason });
}

export { PointCommitConflictV1Error, type PointCommitConflictEvidenceV1, type PointCommitConflictCauseV1, PointCommitStaleAuthorityV1Error, type PointCommitStaleAuthorityReasonV1, PointCommitCorruptionV1Error, type PointCommitCorruptionReasonV1, PointCommitResourceExhaustionV1Error, PointCommitIntrinsicIndexDefinitionUnavailableV1Error, PointCommitDeveloperIndexMaintenanceUnavailableV1Error, PointCommitUniqueConstraintMaintenanceUnavailableV1Error, type PointCommitSqlOperationV1, PointCommitSqlErrorV1, type PointCommitRollbackProofV1Error } from "./pointCommitErrors";
export { MAX_POINT_COMMIT_DEVELOPER_INDEX_ENTRY_REVISIONS_V1, MAX_POINT_COMMIT_UNIQUE_KEY_TRANSITIONS_V1, MAX_POINT_COMMIT_UNIQUE_KEY_ACTIONS_V1 } from "./applicationDocumentMaterialization/materialization";
export { type PointCommitRowIntentV1, type PointCommitDependencyV1 } from "./applicationDocumentMaterialization/model";
