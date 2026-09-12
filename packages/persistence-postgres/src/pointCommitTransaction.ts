import { sqlCall } from "./pointCommitErrors";
import { runPointCommitInTransactionEffect, projectPointCommitTransactionResult } from "./pointCommitPromiseBoundary";
import { allocatePointCommitKernelResult, readPointCommitDatabaseTime, writeScopePublicationPrefix, advanceScopePublicationClock } from "./commitPublication/pointCommitProjection";
import { PointCommitDependencyV1, PointCommitRowIntentV1, PreparedLivePointCommitRowIntentV1, PreparedPointCommitRowIntentV1, PreparedPointCommitCandidateSchemaWriteGuard, PreparedPointCommitApplicationRelations, LocatedPreparedPointCommitApplicationRelations, LoadedPointCommitHeadV1 } from "./applicationDocumentMaterialization/model";
import { hasApplicationRelationCommitAuthorityForPointCommit } from "./applicationRelationCommit";
import { hasAppSchemaCandidateWriteGuardComposition } from "./appSchemaCandidateValidation";
import { PointCommitConflictV1Error, PointCommitConflictEvidenceV1, PointCommitStaleAuthorityV1Error, PointCommitStaleAuthorityReasonV1, PointCommitCorruptionV1Error, PointCommitCorruptionReasonV1, PointCommitSqlFailureMarkerV1, PointCommitSqlOperationV1, PointCommitSqlErrorV1, mapTransactionFailure, PointCommitRollbackProofV1Error, corruption, sqlError, findSqlState } from "./pointCommitErrors";
import { prepareIntrinsicIndexDefinitions, prepareDeveloperIndexDefinitions, prepareUniqueConstraintDefinitions, prepareCandidateSchemaWriteGuard, prepareApplicationRelationDefinitions, lockPointCommitIntrinsicIndexBuilds, lockPointCommitDeveloperIndexBuilds, loadPointCommitHeads, hasOwn, parseNonNegativeIntegerTextResult, parseNullableCommitSeqTextResult, decodePointCommitSeqResult, decodePointCommitCreationTimeResult, validatePointCommitDependenciesResult, findPointCommitConflictAfterEvidenceValidationResult, preparePointCommitApplicationRelationPlan, preparePointCommitDeveloperIndexActions, preparePointCommitUniqueKeyActions, runCandidateSchemaWriteGuard, materializeApplicationDocumentRows, pointDependenciesEqual, emitTransactionStep, maintainPointCommitApplicationRelationsEffect, resetPointCommitDeveloperIndexValidation } from "./applicationDocumentMaterialization/materialization";

import { type ScopePublicationContribution } from "./commitPublication/scopePublicationModel";

import { bytesEqualFullScan as bytesEqual, copyBytes, encodeBytesToLowercaseHex, isUint8Array, isUint8ArrayWithByteLength } from "@flarex/utils/bytes";
import { finiteDateMilliseconds } from "@flarex/utils/dates";
import { isNonNegativeSafeInteger, isPositiveSafeInteger } from "@flarex/utils/numbers";
import { isNonArrayRecord } from "@flarex/utils/records";
import { and, eq, inArray, sql } from "drizzle-orm";
import { Data, Effect, Result, Schema } from "effect";
import { validateApplicationWriteOwnershipForCommit } from "./applicationWriteOwnership/Commit";

import { type AppCreationTimeV1 } from "flarex-protocol/app-document";
import { RELATION_INCOMING_PAGE_MAXIMUM_IDENTITIES_V1 } from "flarex-protocol/internal/application-schema-binding";
import { AppRowIdHexV1Schema, appRowIdHexV1ToBytes, appRowIdHexV1FromBytesResult, decodeAppDocumentIdentityV1Result, type AppRowIdHexV1 } from "flarex-protocol/app-document-id";
import { CatalogEdgeDefinitionIdSchema, type CatalogIndexDefinitionId, type CatalogEdgeDefinitionId, CatalogRelationIdSchema, type CatalogRelationId, CatalogIndexDefinitionIdSchema, CatalogTableIdSchema, type CatalogTableId } from "flarex-protocol/catalog";
import { CanonicalSuccessfulResultBytesV1Schema, CanonicalSessionJournalBytesV1Schema, decodeCanonicalSessionJournalV1Effect, CommitSyscallSequenceV1Schema, LogicalApplicationRelationIncomingReadDependencyV1Schema, LogicalIndexRangeReadDependencyV1Schema, MAX_COMMIT_INDEXED_QUERY_SYSCALLS_V1, MAX_COMMIT_INDEX_RANGE_DEPENDENCY_EVIDENCE_BYTES_V1, MAX_COMMIT_INDEX_RANGE_READ_DEPENDENCIES_V1, MAX_COMMIT_MATERIAL_WRITE_EVENT_EVIDENCE_BYTES_V1, MAX_COMMIT_READ_DOCUMENTS_V1, MAX_COMMIT_READ_SEMANTIC_BYTES_V1, MAX_COMMIT_RELATION_READ_DEPENDENCIES_V1, MAX_COMMIT_RELATION_READ_SYSCALLS_V1, MAX_COMMIT_RELATION_BASE_OCCURRENCES_V1, MAX_COMMIT_POINT_READ_DEPENDENCIES_V1, MAX_COMMIT_WRITE_OPERATIONS_V1, MAX_COMMIT_WRITE_SEMANTIC_BYTES_V1, MAX_POINT_COMMIT_MATERIAL_ROWS_V1, SESSION_JOURNAL_FORMAT_V1, canonicalizeSuccessfulResultV1Effect, measureLogicalIndexRangeReadDependencyEvidenceBytesV1Result, normalizeLogicalIndexRangeReadDependenciesV1Result, type CommitFinalSyscallSequenceV1, type CommitSyscallSequenceV1, type CommitMaterialWriteEventEvidenceBytesV1, type LogicalReadDependencyV1, type LogicalApplicationRelationIncomingReadDependencyV1, type LogicalIndexRangeReadDependencyV1, type SuccessfulResultSha256HexV1 } from "flarex-protocol/commit-protocol";
import { orderedIndexBoundHexV1ToBytes, orderedIndexKeyBytesHexV1FromBytes, orderedIndexKeyBytesHexV1ToBytes, orderedIndexRowIdHexV1ToBytes, orderedIndexRowIdHexV1FromBytesResult, OrderedIndexKeyBytesHexV1Schema, OrderedIndexRowIdHexV1Schema, type OrderedIndexKeyBytesHexV1, type OrderedIndexRowIdHexV1 } from "flarex-protocol/ordered-index";
import { CatalogSchemaVersionIdSchema, type CatalogSchemaVersionId } from "flarex-protocol/schema-manifest";
import { CommitSeqSchema, ScopeEpochUuidV1Schema, ScopeUuidV1Schema, projectScopeEpochUuidV1Result, projectScopeIdUuidV1Result, type CommitSeq, type FlarexDbV1StorageGeneration, type ReplacementScopeIdV1, type ScopeEpochUuidV1, type ScopeUuidV1, type SnapshotToken, type StorageGenerationFence } from "flarex-protocol/storage-authority";
import type { TransactionGrantDeploymentIdV1 } from "flarex-protocol/transaction-grant";
import { TRANSACTION_SESSION_PROTOCOL_VERSION_V1, MAX_TRANSACTION_ATTEMPT_FENCE, TransactionAttemptFenceSchema, TransactionAuthorizationRevocationEpochSchema, TransactionIdentityAccessPolicySha256V1Schema, TransactionRequestSha256V1Schema, type StoredTransactionSessionScalarsV1, type TransactionArtifactIdV1, type TransactionArtifactRuntimeV1, type TransactionAttemptFence, type TransactionAuthorizationGrantIdV1, type TransactionAuthorizationRevocationEpoch, type TransactionExecutionModuleV1, type TransactionFunctionPathV1, type TransactionPackageIdV1, type TransactionPolicyVersionV1, type TransactionRequestKeyV1, type TransactionSessionIdV1, type TransactionSourcePackageSha256HexV1 } from "flarex-protocol/transaction-session";
import { FLAREX_VALUE_CODEC_VERSION_V1, FlarexValueCodecV1Error, FlarexValueEvidenceV1Error, canonicalizeFlarexValueV1, decodeCanonicalFlarexValueEvidenceV1, isCanonicalFlarexRuntimeObjectV1, type CanonicalFlarexRuntimeValueV1, type CanonicalFlarexValueV1, type FlarexValueCodecVersion } from "flarex-protocol/value";

import { type AppDeveloperIndexDefinitionPortV1 } from "./appDeveloperIndexCommitV1";
import { snapshotApplicationExecutionAuthorityJson } from "./applicationExecutionAuthoritySnapshot";
import { hasAppUniqueConstraintDefinitionAuthorityV1, type AppUniqueConstraintDefinitionPortV1 } from "./appUniqueConstraintCommitV1";
import { type LocatedAppUniqueConstraintDefinitionV1 } from "./appUniqueConstraintDefinitions";
import { hasAppUniqueConstraintSetEligibilityPortV1, hasAppUniqueConstraintSetEligibilityCompositionV1, hasAppUniqueConstraintSetEligibilityForDefinitionPortV1, loadAppUniqueConstraintSetEligibilityV1Effect, loadAppUniqueConstraintSetEligibilityForReadinessV1Effect, validateAppUniqueConstraintSetEligibilityEvidenceInTransactionV1Effect, AppUniqueConstraintSetEligibilityV1Error, AppUniqueConstraintSetBuildIntegrationV1Error, type AppUniqueConstraintSetEligibilityInputV1, type AppUniqueConstraintSetEligibilityEvidenceV1, type AppUniqueConstraintSetEligibilityPortV1, type AppUniqueConstraintSetEligibilityResultV1, type AppUniqueConstraintSetBuildStaleAuthorityV1Error, type AppUniqueConstraintSetBuildStateV1Error, type LoadAppUniqueConstraintSetEligibilityV1Error } from "./appUniqueConstraintSetBuildV1";

import type { LocatedAppIndexDefinitionV1 } from "./appIndexDefinitions";
import { isAppendAppRowRevisionV1Error, type AppRowTransaction } from "./appRows";
import { AppRelationEdgePersistenceError, readAppRelationEdgeAdjacencyVersionInTransactionEffect, readIncomingAppRelationEdgeAdjacencyVersionsInTransactionEffect } from "./appRelationEdges";
import { ApplicationRelationCommitUnavailableError, type ApplicationRelationAdjacencyChange, type ApplicationRelationCommitPort } from "./applicationRelationCommit";
import { readCoherentApplicationActiveHeadForShareInTransactionEffect } from "./applicationActiveHeadRead";

import { type AppSchemaCandidateWriteGuardPort } from "./appSchemaCandidateValidation";
import type { FlarexMetadataDatabase } from "./deployments";
import type { IntrinsicCreationTimeIndexDefinitionPortV1 } from "./intrinsicCreationTimeIndexBuildV1";

import { CommittedPointOutcomeCorruptionErrorV1, CommittedPointOutcomeInputErrorV1, CommittedPointOutcomeRequestKeyReuseErrorV1, CommittedPointOutcomeSqlErrorV1, type CommittedPointOutcomeResolutionV1, type CommittedPointOutcomeTokenV1, type CommittedPointSuccessfulResultV1, type CommittedPointOutcomeCorruptionReasonV1, type CommittedPointOutcomeMismatchV1, type CommittedPointOutcomeRequestEvidenceV1, type ResolveCommittedPointOutcomeErrorV1, type ResolveCommittedPointOutcomeInputV1, validateCommittedPointOutcomeRequestEvidenceShapeV1, validateCommittedPointOutcomeStoredScalarsAfterRequestShapeV1 } from "./committedPointOutcome";

import { rowsFromDriverExecuteResult } from "./driverExecuteResult";
import { observeDrizzleQuery as observeCompiledDrizzleQuery } from "./drizzleQueryObservation";
import { decodeScopeClockRecordResult, ScopeClockCorruptionError, ScopeClockNotFoundError, type ScopeClockRecord } from "./scopeClock";
import { resolveLocatedTrustedScopeAuthorityEffect, TrustedScopeAuthorityPortError, TrustedScopeAuthorityResolutionError, type LocatedTrustedScopeAuthority, type TrustedScopeAuthority, type TrustedScopeAuthorityError } from "./scopeAuthorityResolution";
import { fxSystemApplicationActiveHeads } from "./applicationActivationSchema";
import { fxSystemApplicationReadiness } from "./applicationRelationSchema";
import { fxSystemCommits, fxSystemIdempotency, fxSystemApplicationReadinessV1, fxSystemScopeClocks, fxSystemSnapshotLeases, fxSystemTransactionExecutionClaims, fxSystemTransactionJournalLatestReceipts, fxSystemTransactionJournalIndexRanges, fxSystemTransactionJournalPoints, fxSystemTransactionJournalRelationIncomingDependencies, fxSystemTransactionJournalWriteEvents, fxSystemTransactionJournals, fxSystemTransactionSessions } from "./schema";
import { deriveTransactionExecutionClaimV1, lockExactTransactionExecutionClaimV1Result, requireLiveTransactionExecutionClaimV1Result, TransactionExecutionClaimCorruptionV1Error, TransactionExecutionClaimStaleV1Error } from "./transactionExecutionClaimPersistence";
import { decodeTransactionExecutionClaimFenceV1, decodeTransactionExecutionClaimOwnerV1, type TransactionExecutionClaimObservationV1, type TransactionExecutionClaimOwnerV1, type TransactionExecutionClaimPinV1 } from "./transactionExecutionClaimModel";
import { isLocatedPointCommitPublicationTargetV1, isLocatedReadCommittedAttemptTargetV1, LocatedReadCommittedTransactionFailureV1, RESOLVE_LOCATED_COMMITTED_POINT_OUTCOME_V1, RUN_LOCATED_READ_COMMITTED_V1, type LocatedReadCommittedAttemptTargetV1, type LocatedPointCommitPublicationTargetV1 } from "./transactionSessionAttemptKernel";
import type { PointMutationSessionAuthorityResolutionPortsV1 } from "./transactionSessionActivation";
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

const decodePointCommitJournalBytesResult = Schema.decodeUnknownResult(CanonicalSessionJournalBytesV1Schema);
const decodePointCommitTableIdResult = Schema.decodeUnknownResult(
  Schema.toType(CatalogTableIdSchema),
);
const decodePointCommitRowIdResult = Schema.decodeUnknownResult(
  Schema.toType(AppRowIdHexV1Schema),
);
const decodePointCommitSchemaVersionIdResult = Schema.decodeUnknownResult(
  Schema.toType(CatalogSchemaVersionIdSchema),
);

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
  readonly journalFormat: typeof SESSION_JOURNAL_FORMAT_V1;
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
  readonly dependencies: ReadonlyArray<PointCommitDependencyV1>;
  readonly indexRangeDependencies: ReadonlyArray<
    LogicalIndexRangeReadDependencyV1
  >;
  readonly relationDependencies: ReadonlyArray<
    LogicalApplicationRelationIncomingReadDependencyV1
  >;
  readonly rowIntents: ReadonlyArray<PointCommitRowIntentV1>;
}

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
  readonly codecVersion: 1;
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
  | PointMutationAttemptReplacementConfigurationV1Error
  | PointMutationAttemptReplacementCommittedOutcomeV1Error
  | PointMutationAttemptReplacementConflictNoLongerPresentV1Error
  | PointMutationAttemptReplacementRequestKeyReuseV1Error
  | PointMutationAttemptReplacementCorruptionV1Error
  | PointMutationAttemptReplacementStaleAuthorityV1Error
  | PointMutationAttemptReplacementResourceExhaustionV1Error
  | PointMutationAttemptReplacementSqlErrorV1;

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
  | "intrinsicIndexBuildLocked"
  | "developerIndexBuildLocked"
  | "tentativeRowWritten"
  | "intrinsicIndexEntryWritten"
  | "developerIndexEntryWritten"
  | "uniqueKeyWritten"
  | "relationBindingValidated"
  | "relationTargetsValidated"
  | "relationEdgeWritten"
  | "relationRestrictValidated"
  | "uniqueConstraintValidationReset"
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
  /**
   * Private C08 composition. Absence keeps the lower-level O07/C07 proof lane
   * independent of a published schema; presence requires the exact intrinsic
   * definition and fails closed when it cannot be located.
   */
  readonly intrinsicCreationTimeIndexes?:
    IntrinsicCreationTimeIndexDefinitionPortV1;
  /** Private C08-A composition; absence preserves the lower O07 proof lane. */
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
  return Object.freeze({
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
  });
}

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
  codecVersion: Schema.Literal(1),
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
  codecVersion: Schema.Literal(1),
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
  | PreparedPointMutationAttemptReplacementCommandV1;

type PointCommitTransactionModeV1 = "rollbackProof" | "publish";
type PointCommitSessionLockModeV1 =
  | PointCommitTransactionModeV1
  | "enterFinishing"
  | "replaceAttempt"
  | "recoverRunningRelationConflict"
  | "replaceRunningRelationConflict";

type PreparedPointCommitAuthorityCommandV1 =
  | PreparedPointCommitAttemptScalarCommandV1
  | PreparedRunningRelationConflictRecoveryCommand
  | PreparedRunningRelationConflictAttemptReplacementCommandV1;

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
  deploymentId: TransactionGrantDeploymentIdV1,
  ports: PointMutationSessionAuthorityResolutionPortsV1,
): Effect.Effect<
  LocatedTrustedScopeAuthority,
  PointCommitFinishingTransitionV1Error
> =>
  resolveLocatedTrustedScopeAuthorityEffect(deploymentId, {
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
      command.authorityPins.deploymentId,
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
    return yield* Effect.uninterruptible(Effect.tryPromise({
      try: () => runPointCommitFinishingTransition(
        target,
        located.authority,
        command,
        options,
      ),
      catch: mapFinishingTransitionFailure,
    }));
  });

  return Object.freeze({ enterFinishing });
}

export function createPointMutationAttemptReplacementPortV1(
  ports: PointMutationSessionAuthorityResolutionPortsV1,
  options: PointMutationAttemptReplacementOptionsV1,
): PointMutationAttemptReplacementPortV1 &
  RunningRelationConflictAttemptReplacementPortV1 &
  RunningRelationConflictRecoveryPort {
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
  const proofOptions: PointCommitTransactionProofOptionsV1 = Object.freeze(
    options.observeQuery === undefined
      ? {}
      : { observeQuery: options.observeQuery },
  );

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
      command.authorityPins.deploymentId,
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
    return yield* Effect.uninterruptible(Effect.tryPromise({
      try: () => runPointMutationAttemptReplacement(
        target,
        located.authority,
        command,
        options,
        proofOptions,
        decodedOwner,
        executionClaimDurationMilliseconds,
      ),
      catch: mapPointMutationAttemptReplacementTransactionFailure,
    }));
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
        command.authorityPins.deploymentId,
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
      return yield* Effect.uninterruptible(Effect.tryPromise({
        try: () => runRunningRelationConflictAttemptReplacement(
          target,
          located.authority,
          command,
          options,
          proofOptions,
          decodedOwner,
          executionClaimDurationMilliseconds,
        ),
        catch: mapPointMutationAttemptReplacementTransactionFailure,
      }));
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
          command.authorityPins.deploymentId,
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
        return yield* Effect.uninterruptible(Effect.tryPromise({
          try: () => runRunningRelationConflictRecovery(
            target,
            located.authority,
            command,
            options,
            proofOptions,
          ),
          catch: mapPointMutationAttemptReplacementTransactionFailure,
        }));
      });

  return Object.freeze({
    replace,
    replaceRunningRelationConflict,
    recoverRunningRelationConflict,
  });
}

export function createPointCommitRollbackProofPortV1(
  ports: PointMutationSessionAuthorityResolutionPortsV1,
  options: PointCommitTransactionProofOptionsV1 = {},
): PointCommitRollbackProofPortV1 {
  const capturedOptions = capturePointCommitTransactionProofOptionsV1(options);
  const prove: PointCommitRollbackProofPortV1["prove"] = Effect.fn(
    "PointCommitTransaction.proveRollback",
  )(function* (input) {
    const command = yield* preparePointCommitCommand(input);
    const located = yield* resolvePointCommitAuthority(
      command.authorityPins.deploymentId,
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
    const intrinsicDefinitions = yield* prepareIntrinsicIndexDefinitions(
      command,
      capturedOptions,
    );
    const developerDefinitions = yield* prepareDeveloperIndexDefinitions(
      command,
      capturedOptions,
    );
    const uniqueDefinitions = yield* prepareUniqueConstraintDefinitions(
      command,
      capturedOptions,
    );
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
    return yield* Effect.uninterruptible(Effect.tryPromise({
      try: () => runRollbackProof(
        target,
        located.authority,
        command,
        intrinsicDefinitions,
        developerDefinitions,
        uniqueDefinitions,
        applicationRelations,
        candidateSchemaWriteGuard,
        capturedOptions,
      ),
      catch: mapTransactionFailure,
    }));
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
  ports: PointMutationSessionAuthorityResolutionPortsV1,
  options: PointCommitTransactionProofOptionsV1 = {},
): PointCommitPublisherPortV1 & PointCommitOutcomeResolutionPortV1 {
  const capturedOptions = capturePointCommitTransactionProofOptionsV1(options);
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
    const command = yield* preparePointCommitPublicationCommand(input);
    const located = yield* resolvePointCommitAuthority(
      command.authorityPins.deploymentId,
      ports,
    );
    const target = isLocatedPointCommitPublicationTargetV1(located.target)
      ? located.target
      : null;
    if (target === null) {
      return yield* Effect.fail(corruption(
        "readCommittedCapabilityMissing",
      ));
    }
    const lookup = captureCommittedOutcomeLookup(command);
    const existing = yield* resolveOutcome(target, lookup);
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

    const intrinsicDefinitions = yield* prepareIntrinsicIndexDefinitions(
      command,
      capturedOptions,
    );
    const developerDefinitions = yield* prepareDeveloperIndexDefinitions(
      command,
      capturedOptions,
    );
    const uniqueDefinitions = yield* prepareUniqueConstraintDefinitions(
      command,
      capturedOptions,
    );
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

    const runPublication = awaitPointCommitPublicationSettlement(
      runPointCommitPublication(
        target,
        located.authority,
        command,
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
          resolveOutcome(target, lookup).pipe(
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

    const resolved = yield* resolveOutcome(target, lookup);
    if (decision.kind === "existing") {
      return yield* publicationResultFromOutcomeEffect(resolved, "replayed");
    }
    return yield* publicationResultFromOutcomeEffect(
      resolved,
      "published",
      decision.token,
    );
  });

  const resolvePointCommitOutcome: PointCommitOutcomeResolutionPortV1[
    typeof RESOLVE_POINT_COMMIT_OUTCOME_V1
  ] = Effect.fn(
    "PointCommitTransaction.resolvePointCommitOutcome",
  )(function* (deploymentId, input) {
    const located = yield* resolvePointCommitAuthority(deploymentId, ports);
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

  return registerPointCommitApplicationRelationMaintenance(
    registerPointCommitUniqueConstraintEligibilityV1(
      registerPointCommitUniqueConstraintMaintenanceV1(
        registerPointCommitDeveloperIndexMaintenanceV1(Object.freeze({
          ...rollback,
          publish,
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
}

function awaitPointCommitPublicationSettlement(
  transaction: Promise<PointCommitPublicationDecisionV1>,
): Effect.Effect<
  PointCommitPublicationDecisionV1,
  PointCommitPublicationV1Error |
    PointCommitTransactionDecisionUncertainV1Error
> {
  return Effect.uninterruptibleMask((restore) =>
    restore(Effect.tryPromise({
      try: () => transaction,
      catch: mapPublicationTransactionFailure,
    })).pipe(
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
  if (captured.journalBytes !== undefined) {
    const journal = yield* decodeCanonicalSessionJournalV1Effect({ canonicalBytes: captured.journalBytes,
      expectedSha256Hex: encodeBytesToLowercaseHex(captured.sealIdentity.journalSha256) }).pipe(
      Effect.mapError(() => corruption("commandInvalid")));
    const tables = new Set<CatalogTableId>();
    for (const write of journal.journal.writes) {
      const identity = yield* Effect.fromResult(decodeAppDocumentIdentityV1Result(write.documentId).pipe(
        Result.mapError(() => corruption("commandInvalid"))));
      tables.add(identity.tableId);
    }
    attemptedTableIds = Object.freeze([...tables]);
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
    rowIntents: Object.freeze(rowIntents),
  });
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
    const edgeDefinitionId = yield* Schema.decodeUnknownResult(
      CatalogEdgeDefinitionIdSchema,
    )(conflict.edgeDefinitionId).pipe(
      Result.mapError(() => corruption("commandInvalid")),
    );
    const targetRowId = yield* Schema.decodeUnknownResult(
      AppRowIdHexV1Schema,
    )(conflict.targetRowId).pipe(
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
      const dependency = yield* Schema.decodeUnknownResult(
        LogicalIndexRangeReadDependencyV1Schema,
      )(input[index]).pipe(Result.mapError(() => corruption("commandInvalid")));
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
      const dependency = yield* Schema.decodeUnknownResult(
        Schema.toType(LogicalApplicationRelationIncomingReadDependencyV1Schema),
      )(input[index]).pipe(Result.mapError(() => corruption("commandInvalid")));
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
    if (currentCommitSeq <= expectedSnapshotCommitSeq) {
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
      const edgeDefinitionId = yield* Schema.decodeUnknownResult(
        CatalogEdgeDefinitionIdSchema,
      )(cause.edgeDefinitionId).pipe(
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
    const tableId = yield* Schema.decodeUnknownResult(CatalogTableIdSchema)(
      cause.tableId,
    ).pipe(Result.mapError(() => corruption("commandInvalid")));
    const indexDefinitionId = yield* Schema.decodeUnknownResult(
      CatalogIndexDefinitionIdSchema,
    )(cause.indexDefinitionId).pipe(
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
          encodedKey: Schema.decodeUnknownResult(
            OrderedIndexKeyBytesHexV1Schema,
          )(cause.encodedKey),
          rowId: Schema.decodeUnknownResult(
            OrderedIndexRowIdHexV1Schema,
          )(cause.rowId),
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
      input.journalFormat !== SESSION_JOURNAL_FORMAT_V1 ||
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
  intent: Extract<PointCommitRowIntentV1, { readonly kind: "live" }>,
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

type PointCommitScopeClockRowV1 = typeof fxSystemScopeClocks.$inferSelect;

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

async function runPointMutationAttemptReplacement(
  target: LocatedReadCommittedAttemptTargetV1,
  preliminaryAuthority: TrustedScopeAuthority,
  command: PreparedPointMutationAttemptReplacementCommandV1,
  options: PointMutationAttemptReplacementOptionsV1,
  sharedOptions: PointCommitTransactionProofOptionsV1,
  executionClaimOwner: TransactionExecutionClaimOwnerV1,
  executionClaimDurationMilliseconds: number,
): Promise<PointMutationAttemptReplacementObservationV1> {
  return target[RUN_LOCATED_READ_COMMITTED_V1](async (tx) => {
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
    await lockPointCommitJournalRoot(tx, command, sharedOptions);
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
    );
  });
}

async function runRunningRelationConflictAttemptReplacement(
  target: LocatedReadCommittedAttemptTargetV1,
  preliminaryAuthority: TrustedScopeAuthority,
  command: PreparedRunningRelationConflictAttemptReplacementCommandV1,
  options: PointMutationAttemptReplacementOptionsV1,
  sharedOptions: PointCommitTransactionProofOptionsV1,
  executionClaimOwner: TransactionExecutionClaimOwnerV1,
  executionClaimDurationMilliseconds: number,
): Promise<PointMutationAttemptReplacementObservationV1> {
  return target[RUN_LOCATED_READ_COMMITTED_V1](async (tx) => {
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
      mutationTimeMilliseconds,
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
  const receiptQuery = tx.select()
    .from(fxSystemTransactionJournalLatestReceipts)
    .where(and(
      eq(fxSystemTransactionJournalLatestReceipts.scopeUuid, command.scopeUuid),
      eq(
        fxSystemTransactionJournalLatestReceipts.sessionId,
        command.authorityPins.sessionId,
      ),
      eq(
        fxSystemTransactionJournalLatestReceipts.attemptFence,
        command.authorityPins.attemptFence,
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
    receipt.outcomeKind !== "relationConflict" ||
    receipt.requestCodecVersion !== 1 ||
    receipt.outcomeCodecVersion !== 1 ||
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
)).returning({ attemptFence: fxSystemTransactionJournals.attemptFence });
observeReplacementQuery("deleteRetryJournal", journalDelete, options);
const deletedJournal = await replacementSqlCall(
  "deleteRetryJournal",
  () => journalDelete,
);
if (
  deletedJournal.length !== 1 ||
  deletedJournal[0]?.attemptFence !== command.authorityPins.attemptFence
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

const rootInsert = tx.insert(fxSystemTransactionJournals)
  .values(freshFacet.journalRoot)
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
await emitReplacementStep(options, command, "beforeCommit");
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
    lease.snapshotCommitSeq <= command.authorityPins.snapshotToken.commitSeq ||
    lease.snapshotCommitSeq > clock.record.lastCommitSeq ||
    leaseExpiresAtMilliseconds === undefined ||
    leaseExpiresAtMilliseconds <= session.updatedAtMilliseconds ||
    leaseExpiresAtMilliseconds >
      session.authorizationGrantExpiresAtMilliseconds ||
    leaseExpiresAtMilliseconds > session.hardExpiresAtMilliseconds
  ) {
    throw replacementCorruption("replacementConvergenceInvalid");
  }
  const expectedFacet = projectPointCommitTransactionResult(
    buildFreshTransactionAttemptFacetV1({
      scopeUuid: clock.scopeUuid,
      sessionId: command.authorityPins.sessionId,
      attemptFence: expectedFence,
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
  const expectedRoot = expectedFacet.journalRoot;
  if (
    rootRows.length !== 1 ||
    root === undefined ||
    !isPristineFreshTransactionAttemptJournalRootV1(root, expectedRoot)
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
      select 1 from ${fxSystemTransactionJournalLatestReceipts}
      where ${fxSystemTransactionJournalLatestReceipts.scopeUuid} =
        ${clock.scopeUuid}
        and ${fxSystemTransactionJournalLatestReceipts.sessionId} =
          ${command.authorityPins.sessionId}
        and ${fxSystemTransactionJournalLatestReceipts.attemptFence} =
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
      await runPointCommitTransactionKernel(
        tx,
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
  return target[RUN_LOCATED_READ_COMMITTED_V1](async (tx) => {
    const kernel = await runPointCommitTransactionKernel(
      tx,
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
    await publishPointCommitInTransaction(
      tx,
      command,
      ready,
      options,
    );
    await emitTransactionStep(options, command, "beforeCommit");
    return Object.freeze({
      kind: "published",
      token: Object.freeze({
        scopeUuid: ready.clock.scopeUuid,
        epochUuid: ready.clock.epochUuid,
        commitSeq: ready.commitSeq,
      }),
    });
  });
}

/**
 * The reusable O06/O07-B transaction body. Rollback-proof mode exits through
 * the private sentinel after this exact validation/lowering path; publication
 * mode continues to the O07-B atoms and is the first durable caller allowed to
 * return normally from the transaction.
 */
async function runPointCommitTransactionKernel(
  tx: AppRowTransaction,
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
  const clock = await lockPointCommitClock(tx, command, options);
  await emitTransactionStep(options, command, "clockLocked");
  if (
    mode === "publish" &&
    await inspectCommittedOutcomeInTransaction(tx, clock, command, options) !==
      null
  ) {
    await emitTransactionStep(options, command, "outcomeRechecked");
    return Object.freeze({ kind: "existing" });
  }
  projectPointCommitTransactionResult(
    requireLockedClockAuthorityResult(clock, preliminaryAuthority, command),
  );
  projectPointCommitTransactionResult(await runPointCommitInTransactionEffect(
    validateApplicationWriteOwnershipForCommit(tx, { scopeId: command.authorityPins.scopeId,
      generation: command.authorityPins.executionAuthorityGeneration,
      authenticatedAttemptedTables: command.attemptedTableIds, materialTables: command.rowIntents.map(row => row.tableId) }, options.uniqueConstraints).pipe(
      Effect.mapError(error => error.reason === "resourceFailure"
        ? new PointCommitSqlFailureMarkerV1("validateActiveApplicationSchema", error.cause ?? error)
        : corruption(error.reason === "writeDenied" ? "applicationWritePolicyDenied" : "applicationWritePolicyEvidenceInvalid"))),
  ));
  await validateActiveRelationSelectionForPointCommit(tx, command);
  if (command.relationDependencies.length > 0) {
    await emitTransactionStep(
      options,
      command,
      "activeRelationSelectionValidated",
    );
  }
  const validatedApplicationRelations =
    await validateActiveApplicationSchemaForPointCommit(
    tx,
    command,
    applicationRelations,
    options,
  );
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
  const intrinsicBuilds = await lockPointCommitIntrinsicIndexBuilds(
    tx,
    clock,
    intrinsicDefinitions,
    command,
  );
  if (intrinsicBuilds.length > 0) {
    await emitTransactionStep(options, command, "intrinsicIndexBuildLocked");
  }
  const developerBuilds = await lockPointCommitDeveloperIndexBuilds(
    tx,
    clock,
    developerDefinitions,
    command,
  );
  if (developerBuilds.length > 0) {
    await emitTransactionStep(options, command, "developerIndexBuildLocked");
  }

  const session = await lockPointCommitSession(
    tx,
    command,
    options,
    mode,
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

  const loadedHeads = await loadPointCommitHeads(
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
  const preWriteDatabaseNowMilliseconds = await readPointCommitDatabaseTime(
    tx,
    command.authorityPins.scopeId,
    options,
  );
  projectPointCommitTransactionResult(
    requireAttemptIsLiveResult(
      session,
      lease,
      preWriteDatabaseNowMilliseconds,
    ),
  );
  const allocation = projectPointCommitTransactionResult(
    allocatePointCommitKernelResult(
      clock,
      preWriteDatabaseNowMilliseconds,
    ),
  );
  const developerIndexActions = await preparePointCommitDeveloperIndexActions(
    tx,
    command,
    loadedHeads,
    developerBuilds,
  );
  const uniqueKeyActions = await preparePointCommitUniqueKeyActions(
    tx,
    command,
    loadedHeads,
    uniqueDefinitions,
  );
  const relationPlan = await preparePointCommitApplicationRelationPlan(
    tx,
    command,
    loadedHeads,
    validatedApplicationRelations,
    clock.record.lastCommitSeq,
    options,
  );
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
      command.rowIntents.flatMap((intent) => intent.kind === "live"
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
  await materializeApplicationDocumentRows(tx, command, allocation.commitSeq, clock.record.epoch,
    loadedHeads, intrinsicBuilds, developerIndexActions, uniqueKeyActions, options);
  if (relationPlan !== null) {
    const relationMaintenance = await runPointCommitInTransactionEffect(
      maintainPointCommitApplicationRelationsEffect(
        tx,
        command,
        allocation.commitSeq,
        relationPlan,
        options,
      ),
    );
    projectPointCommitTransactionResult(relationMaintenance);
  }
  for (const developer of developerBuilds) {
    await resetPointCommitDeveloperIndexValidation(tx, developer.build);
  }
  return Object.freeze({
    kind: "ready",
    clock,
    relationAdjacencyChanges:
      relationPlan?.prepared.adjacencyChanges ?? Object.freeze([]),
    ...allocation,
  });
}

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
): Promise<LockedPointCommitClockV1> {
  const query = tx
    .select()
    .from(fxSystemScopeClocks)
    .where(eq(
      fxSystemScopeClocks.scopeId,
      command.authorityPins.scopeId,
    ))
    .limit(2)
    .for("update");
  observeDrizzleQuery("lockScopeClock", query, options);
  const rows = await sqlCall("lockScopeClock", () => query);
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
    const requestEvidence: CommittedPointOutcomeRequestEvidenceV1 = row;
    yield* validateCommittedPointOutcomeRequestEvidenceShapeV1(
      lookup,
      requestEvidence,
    );
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
  }));
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
    command.rowIntents.length > 0 &&
    preparedApplicationRelations === null
  ) {
    throw new ApplicationRelationCommitUnavailableError({
      reason: "compositionMissing",
    });
  }
  if (
    (readinessContractVersion === 2 || readinessContractVersion === 3) &&
    command.rowIntents.length > 0 &&
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

async function lockPointCommitSession(
  tx: AppRowTransaction,
  command: PreparedPointCommitAuthorityCommandV1,
  options: PointCommitTransactionProofOptionsV1,
  mode: PointCommitSessionLockModeV1,
): Promise<LockedPointCommitSessionV1> {
  const query = tx
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
      validatedArgsCanonicalByteLength: sql<number>`
        octet_length(${fxSystemTransactionSessions.validatedArgsCanonicalBytes})
      `,
      validatedArgsSha256: fxSystemTransactionSessions.validatedArgsSha256,
      authorizationGrantId:
        fxSystemTransactionSessions.authorizationGrantId,
      authorizationGrantValueCodecVersion:
        fxSystemTransactionSessions.authorizationGrantValueCodecVersion,
      authorizationGrantCanonicalByteLength: sql<number>`
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
    .for("update");
  observeDrizzleQuery("lockSession", query, options);
  const rows = await sqlCall("lockSession", () => query);
  return projectPointCommitTransactionResult(Result.gen(function* () {
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
    } else if (mode === "recoverRunningRelationConflict") {
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
        expected.validatedArgsCanonicalByteLength ||
      !bytesEqual(row.validatedArgsSha256, expected.validatedArgsSha256) ||
      row.authorizationGrantId !== expected.authorizationGrantId ||
      row.authorizationGrantValueCodecVersion !==
        expected.authorizationGrantValueCodecVersion ||
      row.authorizationGrantCanonicalByteLength !==
        expected.authorizationGrantCanonicalByteLength ||
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
          : updatedAtMilliseconds !== expected.updatedAtMilliseconds
      )
    ) {
      return yield* Result.fail(corruption("sessionInvalid"));
    }
    if (row.lifecycle !== "running" && row.lifecycle !== "finishing") {
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
  }));
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
    });
  }));
}

async function lockPointCommitJournalRoot(
  tx: AppRowTransaction,
  command: PreparedPointCommitAttemptScalarCommandV1,
  options: PointCommitTransactionProofOptionsV1,
): Promise<void> {
  const query = tx
    .select({
      scopeUuid: fxSystemTransactionJournals.scopeUuid,
      sessionId: fxSystemTransactionJournals.sessionId,
      attemptFence: fxSystemTransactionJournals.attemptFence,
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
  projectPointCommitTransactionResult(Result.gen(function* () {
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
  }));
}

function requireAttemptIsLiveResult(
  session: LockedPointCommitSessionV1,
  lease: LockedPointCommitLeaseV1,
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
        Schema.decodeUnknownResult(CatalogTableIdSchema)(parsed).pipe(
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

async function requireReproduciblePointCommitConflict(
  tx: AppRowTransaction,
  clock: LockedPointCommitClockV1,
  command: PreparedPointMutationAttemptReplacementCommandV1,
  heads: ReadonlyArray<LoadedPointCommitHeadV1>,
  options: PointCommitTransactionProofOptionsV1,
): Promise<void> {
  const pointConflict = projectPointCommitTransactionResult(
    findPointCommitConflictAfterEvidenceValidationResult(command, heads),
  );
  const actual = pointConflict ?? await findPointCommitIndexRangeConflict(
    tx,
    clock,
    command,
  ) ?? await findPointCommitRelationConflict(tx, clock, command, options);
  if (
    actual === null ||
    !pointCommitConflictsReproduce(command.expectedConflict, actual)
  ) {
    throw new PointMutationAttemptReplacementConflictNoLongerPresentV1Error({
      reason: "conflictNoLongerPresent",
    });
  }
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
  if (actual.conflict.kind !== "appIndexRange") return false;
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
  const contribution: ScopePublicationContribution = {
    authorityPins: command.authorityPins,
    rowIntents: command.rowIntents,
    identityAccessPolicySha256: command.session.identityAccessPolicySha256,
    requestSha256: command.session.requestSha256,
    resultSha256: command.sealIdentity.resultSha256,
    successfulResult: command.successfulResult,
  };
  await writeScopePublicationPrefix(tx, contribution, kernel, options);
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

  const session = await sqlCall("commitSession", () =>
    tx.update(fxSystemTransactionSessions).set({
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
      const callbackCause = cause.issue.callbackCause;
      if (callbackCause instanceof PointCommitSqlFailureMarkerV1) {
        const sqlState = confirmedPreDecisionSqlState(
          callbackCause.cause,
        );
        if (sqlState !== undefined) {
          return new PointCommitConfirmedPreDecisionRollbackV1Error({
            operation: callbackCause.operation,
            sqlState,
            cause: callbackCause.cause,
          });
        }
      }
      return mapTransactionFailure(callbackCause);
    }
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
