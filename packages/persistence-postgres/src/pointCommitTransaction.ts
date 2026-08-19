import {
  bytesEqualFullScan as bytesEqual,
  copyBytes,
  encodeBytesToLowercaseHex,
  isUint8Array,
  isUint8ArrayWithByteLength,
} from "@flarex/utils/bytes";
import { finiteDateMilliseconds } from "@flarex/utils/dates";
import {
  isNonNegativeSafeInteger,
  isPositiveSafeInteger,
} from "@flarex/utils/numbers";
import { isNonArrayRecord } from "@flarex/utils/records";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { Data, Effect, Result, Schema } from "effect";

import {
  AppCreationTimeV1Schema,
  type AppCreationTimeV1,
} from "flarex-protocol/app-document";
import {
  AppRowIdHexV1Schema,
  appRowIdHexV1ToBytes,
  decodeAppDocumentIdentityV1Result,
  type AppDocumentIdV1,
  type AppRowIdHexV1,
} from "flarex-protocol/app-document-id";
import {
  type CatalogIndexDefinitionId,
  type CatalogUniqueConstraintDefinitionId,
  CatalogIndexDefinitionIdSchema,
  CatalogTableIdSchema,
  type CatalogTableId,
} from "flarex-protocol/catalog";
import {
  CanonicalSuccessfulResultBytesV1Schema,
  LogicalIndexRangeReadDependencyV1Schema,
  MAX_COMMIT_INDEX_RANGE_DEPENDENCY_EVIDENCE_BYTES_V1,
  MAX_COMMIT_INDEX_RANGE_READ_DEPENDENCIES_V1,
  MAX_COMMIT_POINT_READ_DEPENDENCIES_V1,
  MAX_POINT_COMMIT_MATERIAL_ROWS_V1,
  SESSION_JOURNAL_FORMAT_V1,
  canonicalizeSuccessfulResultV1Effect,
  measureLogicalIndexRangeReadDependencyEvidenceBytesV1Result,
  normalizeLogicalIndexRangeReadDependenciesV1Result,
  type CommitFinalSyscallSequenceV1,
  type CommitMaterialWriteEventEvidenceBytesV1,
  type LogicalReadDependencyV1,
  type LogicalIndexRangeReadDependencyV1,
  type SuccessfulResultSha256HexV1,
} from "flarex-protocol/commit-protocol";
import {
  encodeAppOrderedIndexKeyV1,
  orderedIndexBoundHexV1ToBytes,
  orderedIndexCreationTimeV1,
  orderedIndexKeyBytesHexV1FromBytes,
  orderedIndexKeyBytesHexV1ToBytes,
  orderedIndexKeyHexV1ToBytes,
  orderedIndexRowIdHexV1ToBytes,
  orderedIndexRowIdHexV1FromBytesResult,
  OrderedIndexKeyBytesHexV1Schema,
  OrderedIndexRowIdHexV1Schema,
  type OrderedIndexKeyHexV1,
  type OrderedIndexKeyBytesHexV1,
  type OrderedIndexRowIdHexV1,
} from "flarex-protocol/ordered-index";
import {
  CatalogSchemaVersionIdSchema,
  type CatalogSchemaVersionId,
} from "flarex-protocol/schema-manifest";
import {
  MAX_PERSISTED_SIGNED_INT64_V1,
  CommitSeqSchema,
  OutboxSeqSchema,
  ScopeEpochUuidV1Schema,
  ScopeUuidV1Schema,
  projectScopeEpochUuidV1Result,
  projectScopeIdUuidV1Result,
  type CommitSeq,
  type FlarexDbV1StorageGeneration,
  type OutboxSeq,
  type ReplacementScopeIdV1,
  type ScopeEpoch,
  type ScopeEpochUuidV1,
  type ScopeUuidV1,
  type SnapshotToken,
  type StorageGenerationFence,
} from "flarex-protocol/storage-authority";
import type { TransactionGrantDeploymentIdV1 } from "flarex-protocol/transaction-grant";
import {
  TRANSACTION_SESSION_PROTOCOL_VERSION_V1,
  MAX_TRANSACTION_ATTEMPT_FENCE,
  TransactionAttemptFenceSchema,
  TransactionAuthorizationRevocationEpochSchema,
  TransactionIdentityAccessPolicySha256V1Schema,
  TransactionRequestSha256V1Schema,
  type StoredTransactionSessionScalarsV1,
  type TransactionArtifactIdV1,
  type TransactionArtifactRuntimeV1,
  type TransactionAttemptFence,
  type TransactionAuthorizationGrantIdV1,
  type TransactionAuthorizationRevocationEpoch,
  type TransactionExecutionModuleV1,
  type TransactionFunctionPathV1,
  type TransactionPackageIdV1,
  type TransactionPolicyVersionV1,
  type TransactionRequestKeyV1,
  type TransactionSessionIdV1,
  type TransactionSourcePackageSha256HexV1,
} from "flarex-protocol/transaction-session";
import {
  FLAREX_VALUE_CODEC_VERSION_V1,
  FlarexValueSha256V1Schema,
  FlarexValueCodecV1Error,
  FlarexValueEvidenceV1Error,
  canonicalizeFlarexValueV1,
  decodeCanonicalFlarexValueEvidenceV1,
  isCanonicalFlarexRuntimeObjectV1,
  type CanonicalFlarexRuntimeValueV1,
  type CanonicalFlarexValueV1,
  type FlarexValueCodecVersion,
} from "flarex-protocol/value";

import {
  lowerAppDeveloperIndexKeyV1,
  type AppDeveloperIndexDefinitionPortV1,
  type LocateAppDeveloperIndexDefinitionsV1Error,
} from "./appDeveloperIndexCommitV1";
import { snapshotApplicationExecutionAuthorityJson } from "./applicationExecutionAuthoritySnapshot";
import {
  hasAppUniqueConstraintDefinitionAuthorityV1,
  lowerCanonicalAppUniqueConstraintV1Result,
  type AppUniqueConstraintDefinitionPortV1,
} from "./appUniqueConstraintCommitV1";
import {
  isLocatedAppUniqueConstraintDefinitionV1,
  type LocatedAppUniqueConstraintDefinitionV1,
  type ReadAppUniqueConstraintDefinitionV1Error,
} from "./appUniqueConstraintDefinitions";
import {
  hasAppUniqueConstraintSetEligibilityPortV1,
  hasAppUniqueConstraintSetEligibilityCompositionV1,
  hasAppUniqueConstraintSetEligibilityForDefinitionPortV1,
  loadAppUniqueConstraintSetEligibilityV1Effect,
  loadAppUniqueConstraintSetEligibilityForReadinessV1Effect,
  validateAppUniqueConstraintSetEligibilityEvidenceInTransactionV1Effect,
  AppUniqueConstraintSetEligibilityV1Error,
  AppUniqueConstraintSetBuildIntegrationV1Error,
  resetAppUniqueConstraintSetValidationInTransactionEffect,
  type AppUniqueConstraintSetEligibilityInputV1,
  type AppUniqueConstraintSetEligibilityEvidenceV1,
  type AppUniqueConstraintSetEligibilityPortV1,
  type AppUniqueConstraintSetEligibilityResultV1,
  type AppUniqueConstraintSetBuildStaleAuthorityV1Error,
  type AppUniqueConstraintSetBuildStateV1Error,
  type LoadAppUniqueConstraintSetEligibilityV1Error,
} from "./appUniqueConstraintSetBuildV1";
import {
  applyAppUniqueKeyMutationInTransactionEffect,
  AppUniqueKeyConflictError,
  AppUniqueKeyHashError,
  AppUniqueKeyPersistenceError,
  CanonicalAppUniqueKeyHashCollisionError,
  type ApplyAppUniqueKeyMutationV1Input,
} from "./appUniqueKeys";
import {
  type AppUniqueKeyProjectionV1,
  type CanonicalAppUniqueKeyV1,
} from "./appUniqueKeyContract";
import {
  appendAppIndexEntryRevisionAndAdvanceCurrentInTransactionResult,
  isAppendAppIndexEntryRevisionV1Error,
  type AppendAppIndexEntryRevisionV1Error,
} from "./appIndexEntries";
import type {
  LocatedAppIndexDefinitionV1,
  ReadAppIndexDefinitionError,
} from "./appIndexDefinitions";
import {
  appendPreparedAppRowRevisionAndAdvanceCurrentInTransactionResult,
  isAppendAppRowRevisionV1Error,
  type AppendPreparedAppRowRevisionV1Input,
  type AppRowIdentityV1,
  type AppRowPointDependencyV1,
  type AppRowTransaction,
} from "./appRows";
import {
  applyAppSchemaCandidateWriteGuardInTransactionEffect,
  hasAppSchemaCandidateWriteGuardComposition,
  prepareAppSchemaCandidateWriteGuardEffect,
  AppSchemaCandidateWriteGuardError,
  type AppSchemaCandidateWriteGuardPort,
  type PreparedAppSchemaCandidateWriteGuard,
} from "./appSchemaCandidateValidation";
import type { FlarexMetadataDatabase } from "./deployments";
import type {
  IntrinsicCreationTimeIndexDefinitionPortV1,
} from "./intrinsicCreationTimeIndexBuildV1";
import {
  decodeIndexBuildStateRowResult,
  type IndexBuildStateRecord,
} from "./indexBuildStates";
import {
  validateAppRowPointOccV1,
  type AppRowPointHeadObservationV1,
} from "./appRowPointOcc";
import {
  CommittedPointOutcomeCorruptionErrorV1,
  CommittedPointOutcomeInputErrorV1,
  CommittedPointOutcomeRequestKeyReuseErrorV1,
  CommittedPointOutcomeSqlErrorV1,
  type CommittedPointOutcomeResolutionV1,
  type CommittedPointOutcomeTokenV1,
  type CommittedPointSuccessfulResultV1,
  type CommittedPointOutcomeCorruptionReasonV1,
  type CommittedPointOutcomeMismatchV1,
  type CommittedPointOutcomeRequestEvidenceV1,
  type ResolveCommittedPointOutcomeErrorV1,
  type ResolveCommittedPointOutcomeInputV1,
  validateCommittedPointOutcomeRequestEvidenceShapeV1,
  validateCommittedPointOutcomeStoredScalarsAfterRequestShapeV1,
} from "./committedPointOutcome";
import { COMMIT_WAKE_OUTBOX_EVENT_KIND_V1 } from "./commitWakeOutbox";
import { rowsFromDriverExecuteResult } from "./driverExecuteResult";
import {
  observeDrizzleQuery as observeCompiledDrizzleQuery,
} from "./drizzleQueryObservation";
import {
  decodeScopeClockRecordResult,
  ScopeClockCorruptionError,
  ScopeClockNotFoundError,
  type ScopeClockRecord,
} from "./scopeClock";
import {
  resolveLocatedTrustedScopeAuthorityEffect,
  TrustedScopeAuthorityPortError,
  TrustedScopeAuthorityResolutionError,
  type LocatedTrustedScopeAuthority,
  type TrustedScopeAuthority,
  type TrustedScopeAuthorityError,
} from "./scopeAuthorityResolution";
import {
  fxAppIndexEntryRevisions,
  fxSystemCommitAppRowChanges,
  fxSystemCommits,
  fxSystemIdempotency,
  fxSystemIndexBuildStates,
  fxSystemApplicationActiveHeadsV1,
  fxSystemApplicationReadinessV1,
  fxSystemOutbox,
  fxSystemScopeClocks,
  fxSystemSnapshotLeases,
  fxSystemTransactionExecutionClaims,
  fxSystemTransactionJournalLatestReceipts,
  fxSystemTransactionJournalIndexRanges,
  fxSystemTransactionJournalPoints,
  fxSystemTransactionJournalWriteEvents,
  fxSystemTransactionJournals,
  fxSystemTransactionSessions,
} from "./schema";
import {
  deriveTransactionExecutionClaimV1,
  lockExactTransactionExecutionClaimV1Result,
  requireLiveTransactionExecutionClaimV1Result,
  TransactionExecutionClaimCorruptionV1Error,
  TransactionExecutionClaimStaleV1Error,
} from "./transactionExecutionClaimPersistence";
import {
  decodeTransactionExecutionClaimFenceV1,
  decodeTransactionExecutionClaimOwnerV1,
  type TransactionExecutionClaimObservationV1,
  type TransactionExecutionClaimOwnerV1,
  type TransactionExecutionClaimPinV1,
} from "./transactionExecutionClaimModel";
import {
  isLocatedPointCommitPublicationTargetV1,
  isLocatedReadCommittedAttemptTargetV1,
  LocatedReadCommittedTransactionFailureV1,
  RESOLVE_LOCATED_COMMITTED_POINT_OUTCOME_V1,
  RUN_LOCATED_READ_COMMITTED_V1,
  type LocatedReadCommittedAttemptTargetV1,
  type LocatedPointCommitPublicationTargetV1,
} from "./transactionSessionAttemptKernel";
import type {
  PointMutationSessionAuthorityResolutionPortsV1,
} from "./transactionSessionActivation";
import type {
  TrustedScopeAuthorityResolutionPorts,
} from "./scopeAuthorityResolution";
import {
  buildFreshTransactionAttemptFacetV1,
  isPristineFreshTransactionAttemptJournalRootV1,
} from
  "./transactionSessionAttemptFacet";

export type {
  CommittedPointOutcomeResolutionV1,
  ResolveCommittedPointOutcomeInputV1,
} from "./committedPointOutcome";
export type {
  AppUniqueConstraintSetEligibilityEvidenceV1,
  AppUniqueConstraintSetEligibilityResultV1,
} from "./appUniqueConstraintSetBuildV1";

const MAX_SIGNED_COMMIT_SEQ = MAX_PERSISTED_SIGNED_INT64_V1;
const MAX_SIGNED_COMMIT_SEQ_TEXT_LENGTH =
  MAX_SIGNED_COMMIT_SEQ.toString().length;
const HASH_BYTE_LENGTH = 32;
const decodePointCommitCreationTimeResult = Schema.decodeUnknownResult(
  Schema.toType(AppCreationTimeV1Schema),
);
const decodePointCommitSeqResult = Schema.decodeUnknownResult(
  Schema.toType(CommitSeqSchema),
);
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

export interface PointCommitDependencyV1 {
  readonly documentId: AppDocumentIdV1;
  readonly tableId: CatalogTableId;
  readonly rowId: AppRowIdHexV1;
  readonly dependency: Extract<
    LogicalReadDependencyV1,
    { readonly kind: "appRowPoint" }
  >;
}

export type PointCommitRowIntentV1 =
  | Readonly<PointCommitDependencyV1 & {
      readonly kind: "live";
      readonly creationTime: AppCreationTimeV1;
      readonly value: CanonicalFlarexRuntimeValueV1;
      readonly canonicalBytes: Uint8Array;
      readonly semanticSizeBytes: number;
    }>
  | Readonly<PointCommitDependencyV1 & {
      readonly kind: "deleted";
    }>;

export interface PointCommitTransactionCommandV1
  extends PointCommitAttemptScalarCommandV1 {
  readonly dependencies: ReadonlyArray<PointCommitDependencyV1>;
  readonly indexRangeDependencies: ReadonlyArray<
    LogicalIndexRangeReadDependencyV1
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
  readonly expectedConflict: PointCommitConflictEvidenceV1;
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

export type PointCommitConflictCauseV1 =
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
    }>;

export interface PointCommitConflictEvidenceV1 {
  readonly conflict: PointCommitConflictCauseV1;
  readonly snapshotCommitSeq: CommitSeq;
  readonly currentCommitSeq: CommitSeq;
}

export class PointCommitConflictV1Error extends Data.TaggedError(
  "PointCommitConflictV1Error",
)<PointCommitConflictEvidenceV1> {}

export type PointCommitStaleAuthorityReasonV1 =
  | "placementChanged"
  | "scopeChanged"
  | "generationChanged"
  | "epochChanged"
  | "revocationEpochChanged"
  | "activeSchemaChanged"
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
  | "scopeClockInvalid"
  | "activeApplicationHeadInvalid"
  | "sessionDuplicate"
  | "sessionInvalid"
  | "leaseDuplicate"
  | "leaseInvalid"
  | "journalRootMissingOrDuplicate"
  | "journalRootInvalid"
  | "dependencySetInvalid"
  | "rowHeadInvalid"
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

export type PointCommitFinishingTransitionResultV1 = Readonly<{
  readonly kind: "transitioned" | "observed";
  readonly scopeUuid: ScopeUuidV1;
  readonly sessionId: TransactionSessionIdV1;
  readonly attemptFence: TransactionAttemptFence;
  readonly priorSessionUpdatedAtMilliseconds: number;
  readonly finishingSessionUpdatedAtMilliseconds: number;
}>;

export class PointCommitResourceExhaustionV1Error extends Data.TaggedError(
  "PointCommitResourceExhaustionV1Error",
)<{
  readonly dimension: "commitSequence" | "outboxSequence";
  readonly maximum: bigint;
}> {}

export class PointCommitIntrinsicIndexDefinitionUnavailableV1Error
  extends Data.TaggedError(
    "PointCommitIntrinsicIndexDefinitionUnavailableV1Error",
  )<{
    readonly deploymentId: TransactionGrantDeploymentIdV1;
    readonly scopeId: ReplacementScopeIdV1;
    readonly tableId: CatalogTableId;
  }> {}

export const MAX_POINT_COMMIT_DEVELOPER_INDEX_ENTRY_REVISIONS_V1 = 256;
/**
 * S11 currently performs one bounded transaction-local transition per action.
 * Keep this materially below the general material-row ceiling until that owner
 * has a set-based mutation primitive and corresponding contention evidence.
 */
export const MAX_POINT_COMMIT_UNIQUE_KEY_TRANSITIONS_V1 = 32;
export const MAX_POINT_COMMIT_UNIQUE_KEY_ACTIONS_V1 = 64;

export class PointCommitDeveloperIndexMaintenanceUnavailableV1Error
  extends Data.TaggedError(
    "PointCommitDeveloperIndexMaintenanceUnavailableV1Error",
  )<{
    readonly reason:
      | "definitionSetUnavailable"
      | "entryRevisionLimitExceeded"
      | "entryKeyLimitExceeded";
    readonly observed?: number;
    readonly maximum?: number;
  }> {}

export class PointCommitUniqueConstraintMaintenanceUnavailableV1Error
  extends Data.TaggedError(
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
  | "resolveAuthority"
  | "beginOrRollback"
  | "lockScopeClock"
  | "validateActiveApplicationSchema"
  | "lockSession"
  | "lockLease"
  | "lockJournalRoot"
  | "lockExecutionClaim"
  | "readDatabaseTime"
  | "enterFinishing"
  | "deleteExecutionClaim"
  | "loadRowHeads"
  | "validateIndexRanges"
  | "lockIntrinsicIndexBuild"
  | "lockDeveloperIndexBuilds"
  | "loadDeveloperIndexDocuments"
  | "loadUniqueKeyDocuments"
  | "loadDeveloperIndexEntryHeads"
  | "loadUniqueKeyOwners"
  | "resetIntrinsicIndexValidation"
  | "resetDeveloperIndexValidation"
  | "resetUniqueConstraintValidation"
  | "validateCandidateSchema"
  | "writeTentativeRow"
  | "writeIntrinsicIndexEntry"
  | "writeDeveloperIndexEntry"
  | "writeUniqueKey"
  | "recheckOutcome"
  | "writeCommitHeader"
  | "writeCommitChange"
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

export type PointCommitRollbackProofV1Error =
  | PointCommitConflictV1Error
  | PointCommitStaleAuthorityV1Error
  | PointCommitCorruptionV1Error
  | PointCommitResourceExhaustionV1Error
  | PointCommitSqlErrorV1
  | PointCommitIntrinsicIndexDefinitionUnavailableV1Error
  | PointCommitDeveloperIndexMaintenanceUnavailableV1Error
  | PointCommitUniqueConstraintMaintenanceUnavailableV1Error
  | AppSchemaCandidateWriteGuardError
  | LocateAppDeveloperIndexDefinitionsV1Error
  | ReadAppUniqueConstraintDefinitionV1Error
  | ReadAppIndexDefinitionError
  | AppendAppIndexEntryRevisionV1Error
  | AppUniqueKeyConflictError
  | AppUniqueKeyHashError
  | CanonicalAppUniqueKeyHashCollisionError;

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
const pointCommitUniqueConstraintEligibilityPortsV1 = new WeakMap<
  object,
  AppUniqueConstraintSetEligibilityPortV1
>();

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
  | "uniqueConstraintValidationReset"
  | "candidateSchemaValidationFailed"
  | "outcomeRechecked"
  | "commitHeaderWritten"
  | "commitChangeWritten"
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

interface PreparedLivePointCommitRowIntentV1
  extends Omit<Extract<PointCommitRowIntentV1, { readonly kind: "live" }>,
    "value" | "canonicalBytes" | "semanticSizeBytes"> {
  readonly document: CanonicalFlarexValueV1;
}

type PreparedPointCommitRowIntentV1 =
  | PreparedLivePointCommitRowIntentV1
  | Extract<PointCommitRowIntentV1, { readonly kind: "deleted" }>;

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
  readonly expectedConflict: PointCommitConflictEvidenceV1;
}

type PreparedPointCommitDependencyCommandV1 =
  | PreparedPointCommitTransactionCommandV1
  | PreparedPointMutationAttemptReplacementCommandV1;

type PreparedPointCommitCandidateSchemaWriteGuard = Readonly<{
  readonly guard: AppSchemaCandidateWriteGuardPort;
  readonly prepared: PreparedAppSchemaCandidateWriteGuard;
}>;

type PointCommitTransactionModeV1 = "rollbackProof" | "publish";
type PointCommitSessionLockModeV1 =
  | PointCommitTransactionModeV1
  | "enterFinishing"
  | "replaceAttempt";

const WOULD_COMMIT = Object.freeze({
  kind: "wouldCommit",
} satisfies PointCommitWouldCommitV1);

const ROLLBACK_SENTINEL = Object.freeze({
  kind: "pointCommitRollbackSentinel",
});

class PointCommitSqlFailureMarkerV1 {
  constructor(
    readonly operation: PointCommitSqlOperationV1,
    readonly cause: unknown,
  ) {}
}

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

const prepareIntrinsicIndexDefinitions = Effect.fn(
  "PointCommitTransaction.prepareIntrinsicIndexDefinitions",
)(function* (
  command: PreparedPointCommitTransactionCommandV1,
  options: PointCommitTransactionProofOptionsV1,
): Effect.fn.Return<
  ReadonlyArray<LocatedAppIndexDefinitionV1>,
  | ReadAppIndexDefinitionError
  | PointCommitIntrinsicIndexDefinitionUnavailableV1Error
  | PointCommitCorruptionV1Error
> {
  const port = options.intrinsicCreationTimeIndexes;
  if (command.rowIntents.length === 0 || port === undefined) {
    return Object.freeze([]);
  }
  const definitions: LocatedAppIndexDefinitionV1[] = [];
  let previousTableId: CatalogTableId | undefined;
  for (const intent of command.rowIntents) {
    if (intent.tableId === previousTableId) continue;
    previousTableId = intent.tableId;
    const definition = yield* port.locate({
      deploymentId: command.authorityPins.deploymentId,
      scopeId: command.authorityPins.scopeId,
      tableId: intent.tableId,
    });
    if (definition === null) {
      return yield* Effect.fail(
        new PointCommitIntrinsicIndexDefinitionUnavailableV1Error({
          deploymentId: command.authorityPins.deploymentId,
          scopeId: command.authorityPins.scopeId,
          tableId: intent.tableId,
        }),
      );
    }
    if (
      definition.scopeId !== command.authorityPins.scopeId ||
      definition.deploymentId !== command.authorityPins.deploymentId ||
      definition.access.kind !== "by_creation_time" ||
      definition.access.tableId !== intent.tableId
    ) {
      return yield* Effect.fail(corruption("intrinsicIndexBuildInvalid"));
    }
    definitions.push(definition);
  }
  return Object.freeze(definitions);
});

const prepareDeveloperIndexDefinitions = Effect.fn(
  "PointCommitTransaction.prepareDeveloperIndexDefinitions",
)(function* (
  command: PreparedPointCommitTransactionCommandV1,
  options: PointCommitTransactionProofOptionsV1,
): Effect.fn.Return<
  ReadonlyArray<LocatedAppIndexDefinitionV1>,
  | LocateAppDeveloperIndexDefinitionsV1Error
  | PointCommitDeveloperIndexMaintenanceUnavailableV1Error
  | PointCommitCorruptionV1Error
> {
  const port = options.developerIndexes;
  if (command.rowIntents.length === 0 || port === undefined) {
    return Object.freeze([]);
  }
  const definitions = yield* port.locate({
    deploymentId: command.authorityPins.deploymentId,
    scopeId: command.authorityPins.scopeId,
    schemaVersionId: command.authorityPins.schemaVersionId,
    tableIds: Object.freeze([
      ...new Set(command.rowIntents.map((intent) => intent.tableId)),
    ]),
    maximumDefinitions:
      MAX_POINT_COMMIT_DEVELOPER_INDEX_ENTRY_REVISIONS_V1,
  });
  if (definitions === null) {
    return yield* Effect.fail(
      new PointCommitDeveloperIndexMaintenanceUnavailableV1Error({
        reason: "definitionSetUnavailable",
      }),
    );
  }
  let minimumEntryRevisionCount = 0;
  let previousDefinitionId = 0;
  for (const definition of definitions) {
    if (
      definition.scopeId !== command.authorityPins.scopeId ||
      definition.deploymentId !== command.authorityPins.deploymentId ||
      definition.access.kind !== "developer" ||
      definition.indexDefinitionId <= previousDefinitionId
    ) {
      return yield* Effect.fail(corruption("developerIndexBuildInvalid"));
    }
    previousDefinitionId = definition.indexDefinitionId;
    for (const intent of command.rowIntents) {
      if (intent.tableId === definition.access.tableId) {
        minimumEntryRevisionCount += 1;
      }
    }
  }
  if (
    minimumEntryRevisionCount >
      MAX_POINT_COMMIT_DEVELOPER_INDEX_ENTRY_REVISIONS_V1
  ) {
    return yield* Effect.fail(
      new PointCommitDeveloperIndexMaintenanceUnavailableV1Error({
        reason: "entryRevisionLimitExceeded",
        observed: minimumEntryRevisionCount,
        maximum: MAX_POINT_COMMIT_DEVELOPER_INDEX_ENTRY_REVISIONS_V1,
      }),
    );
  }
  return definitions;
});

const prepareUniqueConstraintDefinitions = Effect.fn(
  "PointCommitTransaction.prepareUniqueConstraintDefinitions",
)(function* (
  command: PreparedPointCommitTransactionCommandV1,
  options: PointCommitTransactionProofOptionsV1,
): Effect.fn.Return<
  ReadonlyArray<LocatedAppUniqueConstraintDefinitionV1>,
  | ReadAppUniqueConstraintDefinitionV1Error
  | PointCommitUniqueConstraintMaintenanceUnavailableV1Error
  | PointCommitCorruptionV1Error
> {
  const port = options.uniqueConstraints;
  if (command.rowIntents.length === 0 || port === undefined) {
    return Object.freeze([]);
  }
  if (!hasAppUniqueConstraintDefinitionAuthorityV1(port)) {
    return yield* Effect.fail(
      new PointCommitUniqueConstraintMaintenanceUnavailableV1Error({
        reason: "definitionPortInvalid",
      }),
    );
  }
  const definitions = yield* port.locate({
    deploymentId: command.authorityPins.deploymentId,
    scopeId: command.authorityPins.scopeId,
    schemaVersionId: command.authorityPins.schemaVersionId,
    tableIds: Object.freeze([
      ...new Set(command.rowIntents.map((intent) => intent.tableId)),
    ]),
    maximumDefinitions: MAX_POINT_COMMIT_UNIQUE_KEY_TRANSITIONS_V1,
  });
  if (definitions === null) {
    return yield* Effect.fail(
      new PointCommitUniqueConstraintMaintenanceUnavailableV1Error({
        reason: "definitionSetUnavailable",
      }),
    );
  }
  let mutationCount = 0;
  let previousDefinitionId = 0;
  for (const definition of definitions) {
    if (
      !isLocatedAppUniqueConstraintDefinitionV1(definition) ||
      definition.scopeId !== command.authorityPins.scopeId ||
      definition.deploymentId !== command.authorityPins.deploymentId ||
      definition.schemaVersionId !== command.authorityPins.schemaVersionId ||
      definition.uniqueConstraintDefinitionId <= previousDefinitionId
    ) {
      return yield* Effect.fail(
        corruption("uniqueConstraintDefinitionInvalid"),
      );
    }
    previousDefinitionId = definition.uniqueConstraintDefinitionId;
    for (const intent of command.rowIntents) {
      if (intent.tableId === definition.tableId) mutationCount += 1;
    }
  }
  if (mutationCount > MAX_POINT_COMMIT_UNIQUE_KEY_TRANSITIONS_V1) {
    return yield* Effect.fail(
      new PointCommitUniqueConstraintMaintenanceUnavailableV1Error({
        reason: "mutationLimitExceeded",
        observed: mutationCount,
        maximum: MAX_POINT_COMMIT_UNIQUE_KEY_TRANSITIONS_V1,
      }),
    );
  }
  return definitions;
});

const prepareCandidateSchemaWriteGuard = Effect.fn(
  "PointCommitTransaction.prepareCandidateSchemaWriteGuard",
)(function* (
  command: PreparedPointCommitTransactionCommandV1,
  ports: PointMutationSessionAuthorityResolutionPortsV1,
  options: PointCommitTransactionProofOptionsV1,
): Effect.fn.Return<
  Readonly<{
    readonly guard: AppSchemaCandidateWriteGuardPort;
    readonly prepared: PreparedAppSchemaCandidateWriteGuard;
  }> | null,
  AppSchemaCandidateWriteGuardError
> {
  const guard = options.candidateSchemaWriteGuard;
  if (command.rowIntents.length === 0 || guard === undefined) return null;
  if (!hasAppSchemaCandidateWriteGuardComposition(guard, ports)) {
    return yield* Effect.fail(new AppSchemaCandidateWriteGuardError({
      reason: "compositionMismatch",
    }));
  }
  const prepared = yield* prepareAppSchemaCandidateWriteGuardEffect(guard, {
    deploymentId: command.authorityPins.deploymentId,
    scopeId: command.authorityPins.scopeId,
  });
  return Object.freeze({ guard, prepared });
});

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
): PointMutationAttemptReplacementPortV1 {
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
  const proofOptions: PointCommitTransactionProofOptionsV1 = Object.freeze({
    ...(options.observeQuery === undefined
      ? {}
      : { observeQuery: options.observeQuery }),
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

  return Object.freeze({ replace });
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
    const candidateSchemaWriteGuard = yield* prepareCandidateSchemaWriteGuard(
      command,
      ports,
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
        candidateSchemaWriteGuard,
        capturedOptions,
      ),
      catch: mapTransactionFailure,
    }));
  });

  return registerPointCommitUniqueConstraintEligibilityV1(
    registerPointCommitUniqueConstraintMaintenanceV1(
      registerPointCommitDeveloperIndexMaintenanceV1(
        Object.freeze({ prove }),
        capturedOptions.developerIndexes,
      ),
      capturedOptions.uniqueConstraints,
    ),
    capturedOptions.uniqueConstraints,
    capturedOptions.uniqueConstraintEligibility,
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
    const candidateSchemaWriteGuard = yield* prepareCandidateSchemaWriteGuard(
      command,
      ports,
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

  return registerPointCommitUniqueConstraintEligibilityV1(
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
      Effect.onInterrupt(() => Effect.promise(() =>
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
  command: PreparedPointCommitAttemptScalarCommandV1,
): ResolveCommittedPointOutcomeInputV1 {
  return Object.freeze({
    scopeUuid: command.sealIdentity.scopeUuid,
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
    const rowIntents = yield* captureRowIntentsResult(input.rowIntents);
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
      rowIntents,
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
    const expectedConflict = yield* capturePointCommitConflictEvidenceResult(
      input.expectedConflict,
      authorityPins.snapshotToken.commitSeq,
      dependencies,
      indexRangeDependencies,
    );
    return Object.freeze({
      authorityPins,
      session,
      sealIdentity,
      dependencies,
      indexRangeDependencies,
      expectedConflict,
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

function hasAnyOwn(
  value: object,
  fields: ReadonlyArray<PropertyKey>,
): boolean {
  return fields.some(field => hasOwn(value, field));
}

function hasOwn(value: object, field: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(value, field);
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

function pointDependenciesEqual(
  left: PointCommitDependencyV1,
  right: PointCommitDependencyV1,
): boolean {
  if (
    left.documentId !== right.documentId ||
    left.tableId !== right.tableId ||
    left.rowId !== right.rowId ||
    left.dependency.observed.kind !== right.dependency.observed.kind
  ) {
    return false;
  }
  if (
    left.dependency.observed.kind === "present" &&
    right.dependency.observed.kind === "present"
  ) {
    return left.dependency.observed.revisionCommitSeq ===
      right.dependency.observed.revisionCommitSeq;
  }
  if (
    left.dependency.observed.kind !== "missing" ||
    right.dependency.observed.kind !== "missing" ||
    left.dependency.observed.basis.kind !==
      right.dependency.observed.basis.kind
  ) {
    return false;
  }
  return left.dependency.observed.basis.kind === "noVisibleRevision" ||
    (
      right.dependency.observed.basis.kind === "tombstone" &&
      left.dependency.observed.basis.revisionCommitSeq ===
        right.dependency.observed.basis.revisionCommitSeq
    );
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

function isCanonicalDocumentForLoadedHead(
  document: CanonicalFlarexValueV1,
  documentId: AppDocumentIdV1,
  creationTime: AppCreationTimeV1,
): boolean {
  const value = document.value;
  return isCanonicalFlarexRuntimeObjectV1(value) &&
    value._id === documentId && value._creationTime === creationTime;
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

interface LoadedPointCommitHeadV1 {
  readonly head: AppRowPointHeadObservationV1;
  readonly creationTime: AppCreationTimeV1 | null;
}

type PointCommitKernelResultV1 =
  | Readonly<{ readonly kind: "existing" }>
  | Readonly<{
      readonly kind: "ready";
      readonly clock: LockedPointCommitClockV1;
      readonly commitSeq: CommitSeq | null;
      readonly outboxSeq: OutboxSeq | null;
      readonly publicationTimeMilliseconds: number | null;
    }>;

type PointCommitReadyForPublicationV1 = Extract<
  PointCommitKernelResultV1,
  { readonly kind: "ready" }
> & {
  readonly commitSeq: CommitSeq;
  readonly outboxSeq: OutboxSeq;
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
      eq(fxSystemTransactionSessions.lifecycle, "finishing"),
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
  });
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
  command: PreparedPointMutationAttemptReplacementCommandV1,
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
    children[0]?.eventExists !== false
  ) {
    throw replacementCorruption("replacementConvergenceInvalid");
  }

  const databaseNowMilliseconds = await readPointCommitDatabaseTime(
    tx,
    command.authorityPins.scopeId,
    Object.freeze({
      ...(options.observeQuery === undefined
        ? {}
        : { observeQuery: options.observeQuery }),
    }),
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
  command: PreparedPointMutationAttemptReplacementCommandV1,
  attemptFence: TransactionAttemptFence,
  executionClaim?: TransactionExecutionClaimObservationV1,
): PointMutationAttemptReplacementObservationV1 {
  const common = {
    scopeUuid: command.sealIdentity.scopeUuid,
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
  await validateActiveApplicationSchemaForPointCommit(
    tx,
    command,
    options,
  );
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
  await emitTransactionStep(options, command, "dependenciesValidated");

  if (mode === "rollbackProof" && command.rowIntents.length === 0) {
    return Object.freeze({
      kind: "ready",
      clock,
      commitSeq: null,
      outboxSeq: null,
      publicationTimeMilliseconds: null,
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
      mode,
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
  if (candidateSchemaWriteGuard !== null) {
    const guardResult = await runCandidateSchemaWriteGuard(
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
    );
    if (guardResult.status === "candidateFailed") {
      await emitTransactionStep(
        options,
        command,
        "candidateSchemaValidationFailed",
      );
    }
  }
  let intrinsicBuildIndex = 0;
  for (const rowIntent of command.rowIntents) {
    const rowRevision = await lowerTentativePointCommitRow(
      tx,
      clock.record.epoch,
      allocation.commitSeq,
      command,
      loadedHeads,
      rowIntent,
    );
    await emitTransactionStep(options, command, "tentativeRowWritten");
    let intrinsic: LockedPointCommitIntrinsicIndexV1 | undefined =
      intrinsicBuilds[intrinsicBuildIndex];
    while (
      intrinsic !== undefined &&
      intrinsic.definition.access.tableId < rowIntent.tableId
    ) {
      intrinsicBuildIndex += 1;
      intrinsic = intrinsicBuilds[intrinsicBuildIndex];
    }
    if (
      intrinsic !== undefined &&
      intrinsic.definition.access.tableId !== rowIntent.tableId
    ) {
      intrinsic = undefined;
    }
    if (intrinsic !== undefined) {
      const changed = await lowerTentativePointCommitIntrinsicIndex(
        tx,
        intrinsic.build,
        intrinsic.definition,
        rowRevision,
      );
      if (changed) {
        await emitTransactionStep(
          options,
          command,
          "intrinsicIndexEntryWritten",
        );
      }
    }
  }
  for (const intrinsic of intrinsicBuilds) {
    await resetPointCommitIntrinsicIndexValidation(tx, intrinsic.build);
  }
  await writePointCommitDeveloperIndexActions(
    tx,
    command,
    allocation.commitSeq,
    clock.record.epoch,
    developerIndexActions,
    options,
  );
  await writePointCommitUniqueKeyActions(
    tx,
    command,
    allocation.commitSeq,
    clock.record.epoch,
    uniqueKeyActions,
    options,
  );
  if (command.rowIntents.length > 0) {
    const reset = await resetPointCommitUniqueConstraintValidation(tx, command);
    if (reset) {
      await emitTransactionStep(
        options,
        command,
        "uniqueConstraintValidationReset",
      );
    }
  }
  for (const developer of developerBuilds) {
    await resetPointCommitDeveloperIndexValidation(tx, developer.build);
  }
  return Object.freeze({
    kind: "ready",
    clock,
    ...allocation,
  });
}

async function resetPointCommitUniqueConstraintValidation(
  tx: AppRowTransaction,
  command: PreparedPointCommitTransactionCommandV1,
): Promise<boolean> {
  const settled = await Effect.runPromise(Effect.result(
    resetAppUniqueConstraintSetValidationInTransactionEffect(tx, {
      scopeId: command.authorityPins.scopeId,
    }),
  ));
  const result = projectPointCommitTransactionResult(
    settled.pipe(Result.mapError((failure) =>
      failure instanceof AppUniqueConstraintSetBuildIntegrationV1Error
        ? new PointCommitSqlFailureMarkerV1(
            "resetUniqueConstraintValidation",
            failure.cause,
          )
        : corruption("uniqueConstraintBuildInvalid")
    )),
  );
  return result.status === "reset";
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
  const outboxSeq = kernel.outboxSeq;
  if (outboxSeq === null) {
    return Result.fail(corruption("publicationInvariantInvalid"));
  }
  const publicationTimeMilliseconds = kernel.publicationTimeMilliseconds;
  if (publicationTimeMilliseconds === null) {
    return Result.fail(corruption("publicationInvariantInvalid"));
  }
  return Result.succeed(Object.freeze({
    ...kernel,
    commitSeq,
    outboxSeq,
    publicationTimeMilliseconds,
  }));
}

function allocatePointCommitKernelResult(
  clock: LockedPointCommitClockV1,
  mode: PointCommitTransactionModeV1,
  publicationTimeMilliseconds: number,
): Result.Result<
  Readonly<{
    readonly commitSeq: CommitSeq;
    readonly outboxSeq: OutboxSeq | null;
    readonly publicationTimeMilliseconds: number;
  }>,
  PointCommitResourceExhaustionV1Error
> {
  if (clock.record.lastCommitSeq >= MAX_SIGNED_COMMIT_SEQ) {
    return Result.fail(new PointCommitResourceExhaustionV1Error({
      dimension: "commitSequence",
      maximum: MAX_SIGNED_COMMIT_SEQ,
    }));
  }
  if (
    mode === "publish" &&
    clock.record.lastOutboxSeq >= MAX_PERSISTED_SIGNED_INT64_V1
  ) {
    return Result.fail(new PointCommitResourceExhaustionV1Error({
      dimension: "outboxSequence",
      maximum: MAX_PERSISTED_SIGNED_INT64_V1,
    }));
  }
  return Result.succeed(Object.freeze({
    commitSeq: CommitSeqSchema.make(clock.record.lastCommitSeq + 1n),
    outboxSeq: mode === "publish"
      ? OutboxSeqSchema.make(clock.record.lastOutboxSeq + 1n)
      : null,
    publicationTimeMilliseconds,
  }));
}

async function lockPointCommitClock(
  tx: AppRowTransaction,
  command: PreparedPointCommitAttemptScalarCommandV1,
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
  command: PreparedPointCommitAttemptScalarCommandV1,
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
      eq(fxSystemIdempotency.scopeUuid, command.sealIdentity.scopeUuid),
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
  command: PreparedPointCommitAttemptScalarCommandV1,
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
      clock.scopeUuid !== command.sealIdentity.scopeUuid
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

async function validateActiveApplicationSchemaForPointCommit(
  tx: AppRowTransaction,
  command: PreparedPointCommitAttemptScalarCommandV1,
  options: PointCommitTransactionProofOptionsV1,
): Promise<void> {
  if (command.authorityPins.executionAuthorityGeneration !== "application_v1") {
    return;
  }
  const query = tx.select({
    deploymentId: fxSystemApplicationReadinessV1.deploymentId,
    schemaVersionId: fxSystemApplicationReadinessV1.schemaVersionId,
  }).from(fxSystemApplicationActiveHeadsV1).innerJoin(
    fxSystemApplicationReadinessV1,
    and(
      eq(
        fxSystemApplicationReadinessV1.scopeId,
        fxSystemApplicationActiveHeadsV1.scopeId,
      ),
      eq(
        fxSystemApplicationReadinessV1.revisionId,
        fxSystemApplicationActiveHeadsV1.revisionId,
      ),
      eq(
        fxSystemApplicationReadinessV1.readinessSha256,
        fxSystemApplicationActiveHeadsV1.readinessSha256,
      ),
    ),
  ).where(eq(
    fxSystemApplicationActiveHeadsV1.scopeId,
    command.authorityPins.scopeId,
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
  }));
}

async function lockPointCommitSession(
  tx: AppRowTransaction,
  command: PreparedPointCommitAttemptScalarCommandV1,
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
        command.sealIdentity.scopeUuid,
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
    const observesReplacement = mode === "replaceAttempt" &&
      replacementAttemptFence !== null &&
      row.attemptFence === replacementAttemptFence;
    if (row.attemptFence !== expectedAttemptFence && !observesReplacement) {
      return yield* Result.fail(stale("attemptReplaced"));
    }
    if (mode === "replaceAttempt") {
      if (
        (observesReplacement && row.lifecycle !== "running") ||
        (!observesReplacement && row.lifecycle !== "finishing")
      ) {
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
      row.scopeUuid !== command.sealIdentity.scopeUuid ||
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
        mode === "replaceAttempt" && observesReplacement
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
  command: PreparedPointCommitAttemptScalarCommandV1,
  options: PointCommitTransactionProofOptionsV1,
): Promise<LockedPointCommitLeaseV1> {
  const query = tx
    .select()
    .from(fxSystemSnapshotLeases)
    .where(and(
      eq(fxSystemSnapshotLeases.scopeUuid, command.sealIdentity.scopeUuid),
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
      row.scopeUuid !== command.sealIdentity.scopeUuid ||
      row.sessionId !== command.authorityPins.sessionId ||
      snapshotEpochUuid !== expectedEpochUuid.epochUuid ||
      row.snapshotCommitSeq !== command.authorityPins.snapshotToken.commitSeq ||
      leaseExpiresAtMilliseconds === undefined ||
      leaseExpiresAtMilliseconds !==
        command.sealIdentity.leaseExpiresAtMilliseconds ||
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
      writeOperations: fxSystemTransactionJournals.writeOperations,
      writeSemanticBytes: fxSystemTransactionJournals.writeSemanticBytes,
      materialWriteEventEvidenceBytes:
        fxSystemTransactionJournals.materialWriteEventEvidenceBytes,
      failureDimension: fxSystemTransactionJournals.failureDimension,
      sealedFinalSyscallSequence:
        fxSystemTransactionJournals.sealedFinalSyscallSequence,
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
      row.sealedFinalSyscallSequence === null ||
      row.sealedJournalByteLength === null ||
      row.sealedJournalSha256 === null ||
      row.sealedResultValueCodecVersion === null ||
      row.sealedResultSemanticBytes === null ||
      row.sealedResultByteLength === null ||
      row.sealedResultSha256 === null ||
      row.sealedAt === null ||
      row.lastSyscallSequence !== expected.finalSyscallSequence ||
      row.sealedFinalSyscallSequence !== expected.finalSyscallSequence ||
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

async function readPointCommitDatabaseTime(
  tx: AppRowTransaction,
  scopeId: ReplacementScopeIdV1,
  options: PointCommitTransactionProofOptionsV1,
): Promise<number> {
  const query = tx
    .select({
      milliseconds: sql<string>`
        floor(extract(epoch from clock_timestamp()) * 1000)::bigint::text
      `,
    })
    .from(fxSystemScopeClocks)
    .where(eq(fxSystemScopeClocks.scopeId, scopeId))
    .limit(1);
  observeDrizzleQuery("readDatabaseTime", query, options);
  const rows = await sqlCall("readDatabaseTime", () => query);
  return projectPointCommitTransactionResult(
    decodePointCommitDatabaseTimeResult(rows[0]?.milliseconds),
  );
}

function decodePointCommitDatabaseTimeResult(
  text: unknown,
): Result.Result<number, PointCommitCorruptionV1Error> {
  if (typeof text !== "string" || !/^[1-9][0-9]*$/.test(text)) {
    return Result.fail(corruption("scopeClockInvalid"));
  }
  const value = Number(text);
  if (!isPositiveSafeInteger(value)) {
    return Result.fail(corruption("scopeClockInvalid"));
  }
  return Result.succeed(value);
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

async function loadPointCommitHeads(
  tx: AppRowTransaction,
  clock: LockedPointCommitClockV1,
  command: PreparedPointCommitDependencyCommandV1,
  options: PointCommitTransactionProofOptionsV1,
): Promise<ReadonlyArray<LoadedPointCommitHeadV1>> {
  if (command.dependencies.length === 0) return Object.freeze([]);
  const values = sql.join(
    command.dependencies.map((dependency, ordinal) => sql`
      (
        ${ordinal}::integer,
        ${dependency.tableId}::integer,
        ${appRowIdHexV1ToBytes(dependency.rowId)}::bytea
      )
    `),
    sql`, `,
  );
  const statement = sql`
    with requested(ordinal, table_id, row_id) as (
      values ${values}
    )
    select
      requested.ordinal::text as "ordinalText",
      current_row.commit_seq::text as "pointerCommitSeqText",
      latest.commit_seq::text as "latestCommitSeqText",
      latest.is_tombstone as "latestIsTombstone",
      latest.creation_time::text as "latestCreationTimeText"
    from requested
    left join fx_app_row_current as current_row
      on current_row.scope_uuid = ${clock.scopeUuid}
      and current_row.table_id = requested.table_id
      and current_row.row_id = requested.row_id
    left join lateral (
      select revision.commit_seq, revision.is_tombstone, revision.creation_time
      from fx_app_row_rev as revision
      where revision.scope_uuid = ${clock.scopeUuid}
        and revision.table_id = requested.table_id
        and revision.row_id = requested.row_id
      order by revision.commit_seq desc
      limit 1
    ) as latest on true
    order by requested.ordinal asc
  `;
  options.observeQuery?.(Object.freeze({
    name: "loadRowHeads",
    sql: "bounded VALUES with current-pointer and latest-revision correlation",
    params: Object.freeze([]),
  }));
  const result = await sqlCall(
    "loadRowHeads",
    () => tx.execute(statement),
  );
  const rows = rowsFromDriverExecuteResult(result, () => {
    throw corruption("rowHeadInvalid");
  });
  return projectPointCommitTransactionResult(capturePointCommitHeadsResult(
    rows,
    command,
    clock.record.lastCommitSeq,
  ));
}

function capturePointCommitHeadsResult(
  rows: ReadonlyArray<unknown>,
  command: PreparedPointCommitDependencyCommandV1,
  lastCommitSeq: CommitSeq,
): Result.Result<
  ReadonlyArray<LoadedPointCommitHeadV1>,
  PointCommitCorruptionV1Error
> {
  return Result.gen(function* () {
    const rowCount = rows.length;
    if (rowCount !== command.dependencies.length) {
      return yield* Result.fail(corruption("rowHeadInvalid"));
    }
    const heads: LoadedPointCommitHeadV1[] = [];
    for (let ordinal = 0; ordinal < rowCount; ordinal += 1) {
      if (!Object.hasOwn(rows, ordinal)) {
        return yield* Result.fail(corruption("dependencySetInvalid"));
      }
      heads.push(yield* decodePointCommitHeadResult(
        rows[ordinal],
        ordinal,
        command.dependencies[ordinal],
        command.authorityPins.scopeId,
        lastCommitSeq,
      ));
    }
    return Object.freeze(heads);
  });
}

function decodePointCommitHeadResult(
  raw: unknown,
  expectedOrdinal: number,
  dependency: PointCommitDependencyV1 | undefined,
  scopeId: ReplacementScopeIdV1,
  lastCommitSeq: CommitSeq,
): Result.Result<LoadedPointCommitHeadV1, PointCommitCorruptionV1Error> {
  if (dependency === undefined || !isNonArrayRecord(raw)) {
    return Result.fail(corruption("rowHeadInvalid"));
  }
  return Result.gen(function* () {
    const ordinal = yield* parseNonNegativeIntegerTextResult(raw.ordinalText);
    const pointerCommitSeq = yield* parseNullableCommitSeqTextResult(
      raw.pointerCommitSeqText,
    );
    const latestCommitSeq = yield* parseNullableCommitSeqTextResult(
      raw.latestCommitSeqText,
    );
    if (
      ordinal !== expectedOrdinal ||
      (pointerCommitSeq === null) !== (latestCommitSeq === null) ||
      pointerCommitSeq !== latestCommitSeq
    ) {
      return yield* Result.fail(corruption("rowHeadInvalid"));
    }
    const identity = freezeRowIdentity(dependency, scopeId);
    if (latestCommitSeq === null) {
      if (
        raw.latestIsTombstone !== null ||
        raw.latestCreationTimeText !== null
      ) {
        return yield* Result.fail(corruption("rowHeadInvalid"));
      }
      return Object.freeze({
        head: Object.freeze({ kind: "missing", identity }),
        creationTime: null,
      });
    }
    if (
      latestCommitSeq > lastCommitSeq ||
      typeof raw.latestIsTombstone !== "boolean" ||
      typeof raw.latestCreationTimeText !== "string"
    ) {
      return yield* Result.fail(corruption("rowHeadInvalid"));
    }
    const creationTime = yield* decodePointCommitCreationTimeResult(
      Number(raw.latestCreationTimeText),
    ).pipe(Result.mapError(() => corruption("rowHeadInvalid")));
    return Object.freeze({
      head: Object.freeze({
        kind: raw.latestIsTombstone ? "tombstone" : "live",
        identity,
        revisionCommitSeq: latestCommitSeq,
      }),
      creationTime,
    });
  });
}

function validatePointCommitDependenciesResult(
  command: PreparedPointCommitDependencyCommandV1,
  heads: ReadonlyArray<LoadedPointCommitHeadV1>,
): Result.Result<
  void,
  PointCommitConflictV1Error | PointCommitCorruptionV1Error
> {
  return findPointCommitConflictAfterEvidenceValidationResult(
    command,
    heads,
  ).pipe(Result.flatMap((conflict) =>
    conflict === null ? Result.succeed(undefined) : Result.fail(conflict)
  ));
}

function findPointCommitConflictAfterEvidenceValidationResult(
  command: PreparedPointCommitDependencyCommandV1,
  heads: ReadonlyArray<LoadedPointCommitHeadV1>,
): Result.Result<
  PointCommitConflictV1Error | null,
  PointCommitCorruptionV1Error
> {
  if (heads.length !== command.dependencies.length) {
    return Result.fail(corruption("dependencySetInvalid"));
  }
  let firstConflict: PointCommitConflictV1Error | null = null;
  for (let index = 0; index < command.dependencies.length; index += 1) {
    const dependency = command.dependencies[index];
    const loaded = heads[index];
    if (dependency === undefined || loaded === undefined) {
      return Result.fail(corruption("dependencySetInvalid"));
    }
    const validation = validateAppRowPointOccV1({
      snapshotToken: command.authorityPins.snapshotToken,
      dependency: adaptPointDependency(
        command.authorityPins.scopeId,
        dependency,
      ),
      head: loaded.head,
    });
    switch (validation.kind) {
      case "valid":
        break;
      case "conflict":
        firstConflict ??= new PointCommitConflictV1Error({
          conflict: Object.freeze({
            kind: "appRowPoint",
            documentId: dependency.documentId,
          }),
          snapshotCommitSeq: validation.conflict.snapshotCommitSeq,
          currentCommitSeq: validation.conflict.currentState.revisionCommitSeq,
        });
        break;
      case "invalidEvidence":
        return Result.fail(corruption("occEvidenceInvalid"));
    }
  }
  return Result.succeed(firstConflict);
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
): Promise<void> {
  const pointConflict = projectPointCommitTransactionResult(
    findPointCommitConflictAfterEvidenceValidationResult(command, heads),
  );
  const actual = pointConflict ?? await findPointCommitIndexRangeConflict(
    tx,
    clock,
    command,
  );
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
    readonly outboxSeq: OutboxSeq;
    readonly publicationTimeMilliseconds: number;
  },
  options: PointCommitTransactionProofOptionsV1,
): Promise<void> {
  const publicationTime = new Date(kernel.publicationTimeMilliseconds);
  const scopeUuid = kernel.clock.scopeUuid;
  const epochUuid = kernel.clock.epochUuid;
  const commitSeq = kernel.commitSeq;
  const outboxSeq = kernel.outboxSeq;
  const changeCount = command.rowIntents.length;

  const header = await sqlCall("writeCommitHeader", () =>
    tx.insert(fxSystemCommits).values({
      scopeUuid,
      epochUuid,
      commitSeq,
      changeCount,
      committedAt: publicationTime,
    }).returning({ commitSeq: fxSystemCommits.commitSeq }));
  projectPointCommitTransactionResult(
    requireSinglePublicationWriteResult(header, commitSeq, "commitSeq"),
  );
  await emitTransactionStep(options, command, "commitHeaderWritten");

  for (let ordinal = 0; ordinal < command.rowIntents.length; ordinal += 1) {
    const rowIntent = command.rowIntents[ordinal];
    if (rowIntent === undefined) {
      throw corruption("publicationInvariantInvalid");
    }
    const change = await sqlCall("writeCommitChange", () =>
      tx.insert(fxSystemCommitAppRowChanges).values({
        scopeUuid,
        epochUuid,
        commitSeq,
        changeOrdinal: ordinal,
        tableId: rowIntent.tableId,
        rowId: appRowIdHexV1ToBytes(rowIntent.rowId),
      }).returning({ commitSeq: fxSystemCommitAppRowChanges.commitSeq }));
    projectPointCommitTransactionResult(
      requireSinglePublicationWriteResult(change, commitSeq, "commitSeq"),
    );
    await emitTransactionStep(options, command, "commitChangeWritten");
  }

  const outcome = await sqlCall("writeOutcome", () =>
    tx.insert(fxSystemIdempotency).values({
      scopeUuid,
      requestKey: command.authorityPins.requestKey,
      identityAccessPolicySha256:
        TransactionIdentityAccessPolicySha256V1Schema.make(copyBytes(
          command.session.identityAccessPolicySha256,
        )),
      functionPath: command.authorityPins.functionPath,
      requestSha256: TransactionRequestSha256V1Schema.make(copyBytes(
        command.session.requestSha256,
      )),
      epochUuid,
      commitSeq,
      resultState: "available",
      resultValueCodecVersion: FLAREX_VALUE_CODEC_VERSION_V1,
      resultSemanticBytes: command.successfulResult.semanticSizeBytes,
      resultBytes: command.successfulResult.canonicalBytes,
      resultSha256: FlarexValueSha256V1Schema.make(copyBytes(
        command.sealIdentity.resultSha256,
      )),
      resultExpiredAt: null,
      createdAt: publicationTime,
    }).returning({ commitSeq: fxSystemIdempotency.commitSeq }));
  projectPointCommitTransactionResult(
    requireSinglePublicationWriteResult(outcome, commitSeq, "commitSeq"),
  );
  await emitTransactionStep(options, command, "outcomeWritten");

  const wake = await sqlCall("writeWake", () =>
    tx.insert(fxSystemOutbox).values({
      scopeUuid,
      outboxSeq,
      epochUuid,
      commitSeq,
      eventKind: COMMIT_WAKE_OUTBOX_EVENT_KIND_V1,
      deliveryState: "pending",
      createdAt: publicationTime,
      nextAttemptAt: publicationTime,
      attemptCount: 0n,
      claimFence: 0n,
      claimOwner: null,
      claimedAt: null,
      claimExpiresAt: null,
      lastFailureCode: null,
      lastFailureSummary: null,
      lastFailedAt: null,
      deliveredAt: null,
      deadLetteredAt: null,
    }).returning({ outboxSeq: fxSystemOutbox.outboxSeq }));
  projectPointCommitTransactionResult(
    requireSinglePublicationWriteResult(wake, outboxSeq, "outboxSeq"),
  );
  await emitTransactionStep(options, command, "wakeWritten");

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

  const clock = await sqlCall("advanceScopeClock", () =>
    tx.update(fxSystemScopeClocks).set({
      lastCommitSeq: commitSeq,
      lastOutboxSeq: outboxSeq,
      updatedAt: publicationTime,
    }).where(and(
      eq(fxSystemScopeClocks.scopeUuid, scopeUuid),
      eq(
        fxSystemScopeClocks.lastCommitSeq,
        kernel.clock.record.lastCommitSeq,
      ),
      eq(
        fxSystemScopeClocks.lastOutboxSeq,
        kernel.clock.record.lastOutboxSeq,
      ),
    )).returning({
      lastCommitSeq: fxSystemScopeClocks.lastCommitSeq,
      lastOutboxSeq: fxSystemScopeClocks.lastOutboxSeq,
    }));
  projectPointCommitTransactionResult(
    requirePointCommitClockPublicationResult(clock, commitSeq, outboxSeq),
  );
  await emitTransactionStep(options, command, "clockAdvanced");
}

function requireSinglePublicationWriteResult<
  Key extends "commitSeq" | "outboxSeq" | "sessionId",
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

function requirePointCommitClockPublicationResult(
  rows: ReadonlyArray<Readonly<{
    readonly lastCommitSeq: CommitSeq;
    readonly lastOutboxSeq: OutboxSeq;
  }>>,
  expectedCommitSeq: CommitSeq,
  expectedOutboxSeq: OutboxSeq,
): Result.Result<void, PointCommitCorruptionV1Error> {
  if (
    rows.length !== 1 ||
    rows[0]?.lastCommitSeq !== expectedCommitSeq ||
    rows[0]?.lastOutboxSeq !== expectedOutboxSeq
  ) {
    return Result.fail(corruption("publicationInvariantInvalid"));
  }
  return Result.succeed(undefined);
}

function adaptPointDependency(
  scopeId: ReplacementScopeIdV1,
  input: PointCommitDependencyV1,
): AppRowPointDependencyV1 {
  const identity = freezeRowIdentity(input, scopeId);
  switch (input.dependency.observed.kind) {
    case "present":
      return Object.freeze({
        kind: "present",
        identity,
        revisionCommitSeq:
          input.dependency.observed.revisionCommitSeq,
      });
    case "missing":
      switch (input.dependency.observed.basis.kind) {
        case "noVisibleRevision":
          return Object.freeze({
            kind: "missing",
            identity,
            basis: Object.freeze({ kind: "noVisibleRevision" }),
          });
        case "tombstone":
          return Object.freeze({
            kind: "missing",
            identity,
            basis: Object.freeze({
              kind: "tombstone",
              revisionCommitSeq:
                input.dependency.observed.basis.revisionCommitSeq,
            }),
          });
      }
  }
}

interface LockedPointCommitDeveloperIndexV1 {
  readonly definition: LocatedAppIndexDefinitionV1;
  readonly build: IndexBuildStateRecord;
}

interface PointCommitDeveloperIndexEntryHeadV1 {
  readonly commitSeq: CommitSeq | null;
  readonly isTombstone: boolean | null;
}

interface PointCommitDeveloperIndexEntryActionV1 {
  readonly kind: "live" | "tombstone";
  readonly definition: LocatedAppIndexDefinitionV1;
  readonly encodedKey: OrderedIndexKeyHexV1;
  readonly rowId: OrderedIndexRowIdHexV1;
  readonly prevCommitSeq: CommitSeq | null;
}

interface PointCommitDeveloperIndexRowPlanV1 {
  readonly definition: LocatedAppIndexDefinitionV1;
  readonly build: IndexBuildStateRecord;
  readonly rowId: OrderedIndexRowIdHexV1;
  readonly priorCommitSeq: CommitSeq | null;
  readonly priorKey: OrderedIndexKeyHexV1 | null;
  readonly finalKey: OrderedIndexKeyHexV1 | null;
}

interface PointCommitDeveloperIndexDocumentRequestV1 {
  readonly documentId: AppDocumentIdV1;
  readonly tableId: CatalogTableId;
  readonly rowId: AppRowIdHexV1;
  readonly commitSeq: CommitSeq;
  readonly creationTime: AppCreationTimeV1;
}

interface PointCommitUniqueKeyPlanV1 {
  readonly definition: LocatedAppUniqueConstraintDefinitionV1;
  readonly rowId: AppRowIdHexV1;
  readonly rowPrevCommitSeq: CommitSeq | null;
  readonly previousProjection: AppUniqueKeyProjectionV1 | null;
  readonly previousCanonical: CanonicalAppUniqueKeyV1 | null;
  readonly nextProjection: AppUniqueKeyProjectionV1 | null;
  readonly nextCanonical: CanonicalAppUniqueKeyV1 | null;
}

interface PointCommitUniqueKeyOwnerV1 {
  readonly commitSeq: CommitSeq;
  readonly encodedKey: OrderedIndexKeyHexV1;
}

interface PointCommitUniqueKeyOwnerPositionV1 {
  readonly definitionId: CatalogUniqueConstraintDefinitionId;
  readonly tableId: CatalogTableId;
  readonly rowId: AppRowIdHexV1;
}

interface PointCommitUniqueKeyActionV1 {
  readonly phase: "release" | "advance" | "claim";
  readonly definition: LocatedAppUniqueConstraintDefinitionV1;
  readonly rowId: AppRowIdHexV1;
  readonly rowPrevCommitSeq: CommitSeq | null;
  readonly previousClaimCommitSeq: CommitSeq | null;
  readonly previous: AppUniqueKeyProjectionV1 | null;
  readonly next: AppUniqueKeyProjectionV1 | null;
  readonly sortKey: OrderedIndexKeyHexV1;
}

async function lockPointCommitDeveloperIndexBuilds(
  tx: AppRowTransaction,
  clock: LockedPointCommitClockV1,
  definitions: ReadonlyArray<LocatedAppIndexDefinitionV1>,
  command: PreparedPointCommitTransactionCommandV1,
): Promise<ReadonlyArray<LockedPointCommitDeveloperIndexV1>> {
  if (definitions.length === 0) return Object.freeze([]);
  const rows = await sqlCall("lockDeveloperIndexBuilds", () =>
    tx.select().from(fxSystemIndexBuildStates).where(and(
      eq(fxSystemIndexBuildStates.scopeId, command.authorityPins.scopeId),
      inArray(
        fxSystemIndexBuildStates.indexDefinitionId,
        definitions.map((definition) => definition.indexDefinitionId),
      ),
    )).orderBy(fxSystemIndexBuildStates.indexDefinitionId).for("update"));
  if (rows.length !== definitions.length) {
    throw corruption("developerIndexBuildInvalid");
  }
  const locked: LockedPointCommitDeveloperIndexV1[] = [];
  for (let index = 0; index < definitions.length; index += 1) {
    const definition = definitions[index];
    const row = rows[index];
    if (definition === undefined || row === undefined) {
      throw corruption("developerIndexBuildInvalid");
    }
    const state = projectPointCommitTransactionResult(
      decodeIndexBuildStateRowResult(
        row,
        command.authorityPins.scopeId,
        definition.indexDefinitionId,
      ).pipe(Result.mapError(() => corruption("developerIndexBuildInvalid"))),
    );
    if (
      definition.access.kind !== "developer" ||
      state.indexDefinitionId !== definition.indexDefinitionId ||
      state.storageGeneration !== clock.record.storageGeneration ||
      state.storageGenerationFence !== clock.record.storageGenerationFence ||
      state.epoch !== clock.record.epoch ||
      state.startCommitSeq > clock.record.lastCommitSeq ||
      state.lifecycle === "retiring"
    ) {
      throw corruption("developerIndexBuildInvalid");
    }
    locked.push(Object.freeze({ definition, build: state }));
  }
  return Object.freeze(locked);
}

async function preparePointCommitDeveloperIndexActions(
  tx: AppRowTransaction,
  command: PreparedPointCommitTransactionCommandV1,
  loadedHeads: ReadonlyArray<LoadedPointCommitHeadV1>,
  builds: ReadonlyArray<LockedPointCommitDeveloperIndexV1>,
): Promise<ReadonlyArray<PointCommitDeveloperIndexEntryActionV1>> {
  const plans: PointCommitDeveloperIndexRowPlanV1[] = [];
  const loadedHeadsByDocumentId = new Map<AppDocumentIdV1, LoadedPointCommitHeadV1>();
  for (let index = 0; index < command.dependencies.length; index += 1) {
    const dependency = command.dependencies[index];
    const loaded = loadedHeads[index];
    if (dependency === undefined || loaded === undefined) {
      throw corruption("developerIndexTransitionInvalid");
    }
    if (loadedHeadsByDocumentId.has(dependency.documentId)) {
      throw corruption("developerIndexTransitionInvalid");
    }
    loadedHeadsByDocumentId.set(dependency.documentId, loaded);
  }
  const priorDocuments = await loadPointCommitDeveloperIndexDocuments(
    tx,
    command,
    loadedHeadsByDocumentId,
    builds,
  );
  for (const locked of builds) {
    for (const intent of command.rowIntents) {
      const loaded = loadedHeadsByDocumentId.get(intent.documentId);
      if (
        loaded === undefined ||
        intent.tableId !== locked.definition.access.tableId
      ) {
        continue;
      }
      const rowId = projectPointCommitTransactionResult(
        orderedIndexRowIdHexV1FromBytesResult(
          appRowIdHexV1ToBytes(intent.rowId),
        ).pipe(Result.mapError(() =>
          corruption("developerIndexTransitionInvalid")
        )),
      );
      const priorDocument = priorDocuments.get(intent.documentId) ?? null;
      if (
        loaded.head.kind === "live" &&
        (priorDocument === null || loaded.creationTime === null)
      ) {
        throw corruption("developerIndexTransitionInvalid");
      }
      const priorKey = loaded.head.kind === "live" &&
          priorDocument !== null && loaded.creationTime !== null
        ? lowerDeveloperIndexKey(
          locked.definition,
          priorDocument,
          loaded.creationTime,
        )
        : null;
      const finalKey = intent.kind === "live"
        ? lowerDeveloperIndexKey(
          locked.definition,
          intent.document,
          intent.creationTime,
        )
        : null;
      plans.push(Object.freeze({
        definition: locked.definition,
        build: locked.build,
        rowId,
        priorCommitSeq: loaded.head.kind === "live"
          ? loaded.head.revisionCommitSeq
          : null,
        priorKey,
        finalKey,
      }));
    }
  }
  const positions = uniqueDeveloperIndexPositions(plans);
  const heads = await loadPointCommitDeveloperIndexEntryHeads(
    tx,
    command,
    positions,
  );
  const actions: PointCommitDeveloperIndexEntryActionV1[] = [];
  for (const plan of plans) {
    const priorHead = plan.priorKey === null
      ? null
      : heads.get(developerIndexPositionKey(
        plan.definition.indexDefinitionId,
        plan.priorKey,
        plan.rowId,
      )) ?? null;
    const finalHead = plan.finalKey === null
      ? null
      : heads.get(developerIndexPositionKey(
        plan.definition.indexDefinitionId,
        plan.finalKey,
        plan.rowId,
      )) ?? null;
    const sameKey = plan.priorKey !== null &&
      plan.priorKey === plan.finalKey;
    if (plan.priorKey !== null) {
      if (
        priorHead?.commitSeq !== null &&
        priorHead?.commitSeq !== undefined &&
        (priorHead.isTombstone ||
          priorHead.commitSeq !== plan.priorCommitSeq)
      ) {
        throw corruption("developerIndexTransitionInvalid");
      }
      if (
        (priorHead === null || priorHead.commitSeq === null) &&
        plan.build.lifecycle === "enabled"
      ) {
        throw corruption("developerIndexTransitionInvalid");
      }
      if (sameKey) {
        actions.push(Object.freeze({
          kind: "live",
          definition: plan.definition,
          encodedKey: plan.priorKey,
          rowId: plan.rowId,
          prevCommitSeq: priorHead?.commitSeq ?? null,
        }));
      } else if (priorHead !== null && priorHead.commitSeq !== null) {
        actions.push(Object.freeze({
          kind: "tombstone",
          definition: plan.definition,
          encodedKey: plan.priorKey,
          rowId: plan.rowId,
          prevCommitSeq: priorHead.commitSeq,
        }));
      }
    }
    if (plan.finalKey !== null && !sameKey) {
      if (finalHead?.commitSeq !== null && finalHead?.isTombstone === false) {
        throw corruption("developerIndexTransitionInvalid");
      }
      actions.push(Object.freeze({
        kind: "live",
        definition: plan.definition,
        encodedKey: plan.finalKey,
        rowId: plan.rowId,
        prevCommitSeq: finalHead?.commitSeq ?? null,
      }));
    }
  }
  if (actions.length > MAX_POINT_COMMIT_DEVELOPER_INDEX_ENTRY_REVISIONS_V1) {
    throw new PointCommitDeveloperIndexMaintenanceUnavailableV1Error({
      reason: "entryRevisionLimitExceeded",
      observed: actions.length,
      maximum: MAX_POINT_COMMIT_DEVELOPER_INDEX_ENTRY_REVISIONS_V1,
    });
  }
  actions.sort(compareDeveloperIndexEntryActions);
  return Object.freeze(actions);
}

async function preparePointCommitUniqueKeyActions(
  tx: AppRowTransaction,
  command: PreparedPointCommitTransactionCommandV1,
  loadedHeads: ReadonlyArray<LoadedPointCommitHeadV1>,
  definitions: ReadonlyArray<LocatedAppUniqueConstraintDefinitionV1>,
): Promise<ReadonlyArray<PointCommitUniqueKeyActionV1>> {
  if (definitions.length === 0) return Object.freeze([]);
  const headsByDocumentId = new Map<AppDocumentIdV1, LoadedPointCommitHeadV1>();
  for (let index = 0; index < command.dependencies.length; index += 1) {
    const dependency = command.dependencies[index];
    const loaded = loadedHeads[index];
    if (
      dependency === undefined || loaded === undefined ||
      headsByDocumentId.has(dependency.documentId)
    ) throw corruption("uniqueKeyTransitionInvalid");
    headsByDocumentId.set(dependency.documentId, loaded);
  }
  const priorDocuments = await loadPointCommitUniqueKeyDocuments(
    tx,
    command,
    headsByDocumentId,
    definitions,
  );
  const plans: PointCommitUniqueKeyPlanV1[] = [];
  for (const definition of definitions) {
    for (const intent of command.rowIntents) {
      if (intent.tableId !== definition.tableId) continue;
      const loaded = headsByDocumentId.get(intent.documentId);
      if (loaded === undefined) throw corruption("uniqueKeyTransitionInvalid");
      const priorDocument = priorDocuments.get(intent.documentId) ?? null;
      if (loaded.head.kind === "live" && priorDocument === null) {
        throw corruption("uniqueKeyTransitionInvalid");
      }
      const previous = loaded.head.kind === "live" && priorDocument !== null
        ? lowerPointCommitUniqueKey(definition, priorDocument)
        : null;
      const next = intent.kind === "live"
        ? lowerPointCommitUniqueKey(definition, intent.document)
        : null;
      plans.push(Object.freeze({
        definition,
        rowId: intent.rowId,
        rowPrevCommitSeq: loaded.head.kind === "live"
          ? loaded.head.revisionCommitSeq
          : null,
        previousProjection: previous?.projection ?? null,
        previousCanonical: previous?.canonical ?? null,
        nextProjection: next?.projection ?? null,
        nextCanonical: next?.canonical ?? null,
      }));
    }
  }
  const owners = await loadPointCommitUniqueKeyOwners(tx, command, plans);
  const actions: PointCommitUniqueKeyActionV1[] = [];
  for (const plan of plans) {
    const owner = owners.get(uniqueKeyOwnerPosition(
      plan.definition.uniqueConstraintDefinitionId,
      plan.definition.tableId,
      plan.rowId,
    )) ?? null;
    const previousClaim = plan.previousCanonical?.kind === "claim"
      ? plan.previousCanonical
      : null;
    const nextClaim = plan.nextCanonical?.kind === "claim"
      ? plan.nextCanonical
      : null;
    if (owner !== null) {
      if (
        plan.rowPrevCommitSeq === null ||
        owner.commitSeq !== plan.rowPrevCommitSeq ||
        previousClaim === null ||
        owner.encodedKey !== previousClaim.encodedKey
      ) throw corruption("uniqueKeyTransitionInvalid");
      if (
        nextClaim !== null &&
        nextClaim.encodedKey === previousClaim.encodedKey
      ) {
        actions.push(uniqueKeyAction(
          "advance",
          plan,
          owner.commitSeq,
          plan.previousProjection,
          plan.nextProjection,
          previousClaim.encodedKey,
        ));
        continue;
      }
      actions.push(uniqueKeyAction(
        "release",
        plan,
        owner.commitSeq,
        plan.previousProjection,
        null,
        previousClaim.encodedKey,
      ));
    }
    if (nextClaim !== null) {
      actions.push(uniqueKeyAction(
        "claim",
        plan,
        null,
        null,
        plan.nextProjection,
        nextClaim.encodedKey,
      ));
    }
  }
  if (actions.length > MAX_POINT_COMMIT_UNIQUE_KEY_ACTIONS_V1) {
    throw new PointCommitUniqueConstraintMaintenanceUnavailableV1Error({
      reason: "mutationLimitExceeded",
      observed: actions.length,
      maximum: MAX_POINT_COMMIT_UNIQUE_KEY_ACTIONS_V1,
    });
  }
  actions.sort(comparePointCommitUniqueKeyActions);
  return Object.freeze(actions);
}

function lowerPointCommitUniqueKey(
  definition: LocatedAppUniqueConstraintDefinitionV1,
  document: CanonicalFlarexValueV1,
): Readonly<{
  readonly projection: AppUniqueKeyProjectionV1;
  readonly canonical: CanonicalAppUniqueKeyV1;
}> {
  return projectPointCommitTransactionResult(
    lowerCanonicalAppUniqueConstraintV1Result(definition, document).pipe(
      Result.mapError((cause) =>
        new PointCommitUniqueConstraintMaintenanceUnavailableV1Error({
          reason: "keyInvalid",
          cause,
        })
      ),
    ),
  );
}

async function loadPointCommitUniqueKeyOwners(
  tx: AppRowTransaction,
  command: PreparedPointCommitTransactionCommandV1,
  plans: ReadonlyArray<PointCommitUniqueKeyPlanV1>,
): Promise<ReadonlyMap<string, PointCommitUniqueKeyOwnerV1>> {
  if (plans.length === 0) return new Map();
  const scopeUuid = projectPointCommitTransactionResult(
    projectScopeIdUuidV1Result(command.authorityPins.scopeId).pipe(
      Result.mapError(() => corruption("uniqueKeyTransitionInvalid")),
    ),
  ).scopeUuid;
  const positions = uniquePointCommitUniqueKeyOwnerPositions(plans);
  const values = sql.join(positions.map((position, ordinal) => sql`
    (
      ${ordinal}::integer,
      ${position.definitionId}::integer,
      ${position.tableId}::integer,
      ${appRowIdHexV1ToBytes(position.rowId)}::bytea
    )
  `), sql`, `);
  const statement = sql`
    with requested(ordinal, constraint_id, table_id, row_id) as (
      values ${values}
    )
    select
      requested.ordinal::text as "ordinalText",
      current_key.locale_key as "localeKey",
      current_key.encoded_key as "encodedKey",
      current_key.commit_seq::text as "commitSeqText"
    from requested
    left join fx_app_unique_key as current_key
      on current_key.scope_uuid = ${scopeUuid}
      and current_key.constraint_id = requested.constraint_id
      and current_key.table_id = requested.table_id
      and current_key.row_id = requested.row_id
    order by requested.ordinal asc
  `;
  const result = await sqlCall("loadUniqueKeyOwners", () =>
    tx.execute(statement));
  const rows = rowsFromDriverExecuteResult(result, () => {
    throw corruption("uniqueKeyTransitionInvalid");
  });
  if (rows.length !== positions.length) {
    throw corruption("uniqueKeyTransitionInvalid");
  }
  const owners = new Map<string, PointCommitUniqueKeyOwnerV1>();
  for (let ordinal = 0; ordinal < positions.length; ordinal += 1) {
    const row = rows[ordinal];
    const position = positions[ordinal];
    if (!isNonArrayRecord(row) || position === undefined) {
      throw corruption("uniqueKeyTransitionInvalid");
    }
    const decodedOrdinal = projectPointCommitTransactionResult(
      parseNonNegativeIntegerTextResult(row.ordinalText).pipe(
        Result.mapError(() => corruption("uniqueKeyTransitionInvalid")),
      ),
    );
    if (decodedOrdinal !== ordinal) {
      throw corruption("uniqueKeyTransitionInvalid");
    }
    if (
      row.localeKey === null &&
      row.encodedKey === null &&
      row.commitSeqText === null
    ) continue;
    if (
      row.localeKey !== "" ||
      !isUint8Array(row.encodedKey) ||
      typeof row.commitSeqText !== "string"
    ) throw corruption("uniqueKeyTransitionInvalid");
    const commitSeq = projectPointCommitTransactionResult(
      parseNullableCommitSeqTextResult(row.commitSeqText).pipe(
        Result.mapError(() => corruption("uniqueKeyTransitionInvalid")),
        Result.filterOrFail(
          (value): value is CommitSeq => value !== null,
          () => corruption("uniqueKeyTransitionInvalid"),
        ),
      ),
    );
    const ownerPosition = uniqueKeyOwnerPosition(
      position.definitionId,
      position.tableId,
      position.rowId,
    );
    if (owners.has(ownerPosition)) {
      throw corruption("uniqueKeyTransitionInvalid");
    }
    owners.set(ownerPosition, Object.freeze({
      commitSeq,
      encodedKey: encodeBytesToLowercaseHex(row.encodedKey) as
        OrderedIndexKeyHexV1,
    }));
  }
  return owners;
}

function uniquePointCommitUniqueKeyOwnerPositions(
  plans: ReadonlyArray<PointCommitUniqueKeyPlanV1>,
): ReadonlyArray<PointCommitUniqueKeyOwnerPositionV1> {
  const positions = new Map<string, PointCommitUniqueKeyOwnerPositionV1>();
  for (const plan of plans) {
    const position = Object.freeze({
      definitionId: plan.definition.uniqueConstraintDefinitionId,
      tableId: plan.definition.tableId,
      rowId: plan.rowId,
    } satisfies PointCommitUniqueKeyOwnerPositionV1);
    positions.set(uniqueKeyOwnerPosition(
      position.definitionId,
      position.tableId,
      position.rowId,
    ), position);
  }
  return Object.freeze([...positions.values()].toSorted((left, right) =>
    left.definitionId - right.definitionId ||
    left.tableId - right.tableId ||
    left.rowId.localeCompare(right.rowId)
  ));
}

function uniqueKeyAction(
  phase: PointCommitUniqueKeyActionV1["phase"],
  plan: PointCommitUniqueKeyPlanV1,
  previousClaimCommitSeq: CommitSeq | null,
  previous: AppUniqueKeyProjectionV1 | null,
  next: AppUniqueKeyProjectionV1 | null,
  sortKey: OrderedIndexKeyHexV1,
): PointCommitUniqueKeyActionV1 {
  return Object.freeze({
    phase,
    definition: plan.definition,
    rowId: plan.rowId,
    rowPrevCommitSeq: plan.rowPrevCommitSeq,
    previousClaimCommitSeq,
    previous,
    next,
    sortKey,
  });
}

function uniqueKeyOwnerPosition(
  definitionId: CatalogUniqueConstraintDefinitionId,
  tableId: CatalogTableId,
  rowId: AppRowIdHexV1,
): string {
  return `${definitionId}:${tableId}:${rowId}`;
}

function comparePointCommitUniqueKeyActions(
  left: PointCommitUniqueKeyActionV1,
  right: PointCommitUniqueKeyActionV1,
): number {
  const phaseRank = (phase: PointCommitUniqueKeyActionV1["phase"]) =>
    phase === "release" ? 0 : phase === "advance" ? 1 : 2;
  return phaseRank(left.phase) - phaseRank(right.phase) ||
    left.definition.uniqueConstraintDefinitionId -
      right.definition.uniqueConstraintDefinitionId ||
    left.sortKey.localeCompare(right.sortKey) ||
    left.rowId.localeCompare(right.rowId);
}

async function loadPointCommitDeveloperIndexDocuments(
  tx: AppRowTransaction,
  command: PreparedPointCommitTransactionCommandV1,
  loadedHeadsByDocumentId: ReadonlyMap<
    AppDocumentIdV1,
    LoadedPointCommitHeadV1
  >,
  builds: ReadonlyArray<LockedPointCommitDeveloperIndexV1>,
): Promise<ReadonlyMap<AppDocumentIdV1, CanonicalFlarexValueV1>> {
  return loadPointCommitDocumentsForTables(
    tx,
    command,
    loadedHeadsByDocumentId,
    new Set(builds.map((build) => build.definition.access.tableId)),
    "loadDeveloperIndexDocuments",
    "developerIndexTransitionInvalid",
  );
}

async function loadPointCommitUniqueKeyDocuments(
  tx: AppRowTransaction,
  command: PreparedPointCommitTransactionCommandV1,
  loadedHeadsByDocumentId: ReadonlyMap<
    AppDocumentIdV1,
    LoadedPointCommitHeadV1
  >,
  definitions: ReadonlyArray<LocatedAppUniqueConstraintDefinitionV1>,
): Promise<ReadonlyMap<AppDocumentIdV1, CanonicalFlarexValueV1>> {
  return loadPointCommitDocumentsForTables(
    tx,
    command,
    loadedHeadsByDocumentId,
    new Set(definitions.map((definition) => definition.tableId)),
    "loadUniqueKeyDocuments",
    "uniqueKeyTransitionInvalid",
  );
}

async function loadPointCommitDocumentsForTables(
  tx: AppRowTransaction,
  command: PreparedPointCommitTransactionCommandV1,
  loadedHeadsByDocumentId: ReadonlyMap<
    AppDocumentIdV1,
    LoadedPointCommitHeadV1
  >,
  indexedTableIds: ReadonlySet<CatalogTableId>,
  operation: Extract<
    PointCommitSqlOperationV1,
    "loadDeveloperIndexDocuments" | "loadUniqueKeyDocuments"
  >,
  corruptionReason: Extract<
    PointCommitCorruptionReasonV1,
    "developerIndexTransitionInvalid" | "uniqueKeyTransitionInvalid"
  >,
): Promise<ReadonlyMap<AppDocumentIdV1, CanonicalFlarexValueV1>> {
  if (indexedTableIds.size === 0) return new Map();
  const requests: PointCommitDeveloperIndexDocumentRequestV1[] = [];
  for (const intent of command.rowIntents) {
    if (!indexedTableIds.has(intent.tableId)) continue;
    const loaded = loadedHeadsByDocumentId.get(intent.documentId);
    if (loaded === undefined) {
      throw corruption(corruptionReason);
    }
    if (loaded.head.kind !== "live") continue;
    if (loaded.creationTime === null) {
      throw corruption(corruptionReason);
    }
    requests.push(Object.freeze({
      documentId: intent.documentId,
      tableId: intent.tableId,
      rowId: intent.rowId,
      commitSeq: loaded.head.revisionCommitSeq,
      creationTime: loaded.creationTime,
    }));
  }
  if (requests.length === 0) return new Map();
  const scopeUuid = projectPointCommitTransactionResult(
    projectScopeIdUuidV1Result(command.authorityPins.scopeId).pipe(
      Result.mapError(() => corruption(corruptionReason)),
    ),
  ).scopeUuid;
  const values = sql.join(requests.map((request, ordinal) => sql`
    (
      ${ordinal}::integer,
      ${request.tableId}::integer,
      ${appRowIdHexV1ToBytes(request.rowId)}::bytea,
      ${request.commitSeq}::bigint
    )
  `), sql`, `);
  const statement = sql`
    with requested(ordinal, table_id, row_id, commit_seq) as (
      values ${values}
    )
    select
      requested.ordinal::text as "ordinalText",
      revision.is_tombstone as "isTombstone",
      revision.creation_time::text as "creationTimeText",
      revision.value_codec_version as "valueCodecVersion",
      revision.value_bytes as "valueBytes",
      revision.value_sha256 as "valueSha256"
    from requested
    left join fx_app_row_rev as revision
      on revision.scope_uuid = ${scopeUuid}
      and revision.table_id = requested.table_id
      and revision.row_id = requested.row_id
      and revision.commit_seq = requested.commit_seq
    order by requested.ordinal asc
  `;
  const result = await sqlCall(
    operation,
    () => tx.execute(statement),
  );
  const rows = rowsFromDriverExecuteResult(result, () => {
    throw corruption(corruptionReason);
  });
  if (rows.length !== requests.length) {
    throw corruption(corruptionReason);
  }
  const documents = new Map<AppDocumentIdV1, CanonicalFlarexValueV1>();
  for (let ordinal = 0; ordinal < requests.length; ordinal += 1) {
    const raw = rows[ordinal];
    const request = requests[ordinal];
    if (
      !isNonArrayRecord(raw) ||
      request === undefined ||
      raw.ordinalText !== String(ordinal) ||
      raw.isTombstone !== false ||
      raw.creationTimeText !== String(request.creationTime) ||
      raw.valueCodecVersion !== FLAREX_VALUE_CODEC_VERSION_V1 ||
      !isUint8Array(raw.valueBytes) ||
      !isUint8ArrayWithByteLength(raw.valueSha256, 32)
    ) {
      throw corruption(corruptionReason);
    }
    let document: CanonicalFlarexValueV1;
    try {
      document = await decodeCanonicalFlarexValueEvidenceV1({
        profile: "appDocument",
        canonicalBytes: raw.valueBytes,
        sha256: raw.valueSha256,
      });
    } catch (cause) {
      if (
        cause instanceof FlarexValueEvidenceV1Error ||
        cause instanceof FlarexValueCodecV1Error
      ) {
        throw corruption(corruptionReason);
      }
      throw cause;
    }
    if (!isCanonicalDocumentForLoadedHead(
      document,
      request.documentId,
      request.creationTime,
    )) {
      throw corruption(corruptionReason);
    }
    documents.set(request.documentId, document);
  }
  return documents;
}

function lowerDeveloperIndexKey(
  definition: LocatedAppIndexDefinitionV1,
  document: CanonicalFlarexValueV1,
  creationTime: AppCreationTimeV1,
): OrderedIndexKeyHexV1 {
  return projectPointCommitTransactionResult(
    lowerAppDeveloperIndexKeyV1(
      definition,
      document,
      creationTime,
    ).pipe(Result.mapError((cause) =>
      new PointCommitDeveloperIndexMaintenanceUnavailableV1Error({
        reason: "entryKeyLimitExceeded",
        observed: cause.observedBytes,
        maximum: cause.maximumBytes,
      })
    )),
  );
}

interface PointCommitDeveloperIndexPositionV1 {
  readonly definitionId: CatalogIndexDefinitionId;
  readonly encodedKey: OrderedIndexKeyHexV1;
  readonly rowId: OrderedIndexRowIdHexV1;
}

function uniqueDeveloperIndexPositions(
  plans: ReadonlyArray<PointCommitDeveloperIndexRowPlanV1>,
): ReadonlyArray<PointCommitDeveloperIndexPositionV1> {
  const positions = new Map<string, PointCommitDeveloperIndexPositionV1>();
  for (const plan of plans) {
    for (const encodedKey of [plan.priorKey, plan.finalKey]) {
      if (encodedKey === null) continue;
      const key = developerIndexPositionKey(
        plan.definition.indexDefinitionId,
        encodedKey,
        plan.rowId,
      );
      positions.set(key, Object.freeze({
        definitionId: plan.definition.indexDefinitionId,
        encodedKey,
        rowId: plan.rowId,
      }));
    }
  }
  return Object.freeze([...positions.values()].toSorted((left, right) =>
    left.definitionId - right.definitionId ||
    left.encodedKey.localeCompare(right.encodedKey) ||
    left.rowId.localeCompare(right.rowId)
  ));
}

async function loadPointCommitDeveloperIndexEntryHeads(
  tx: AppRowTransaction,
  command: PreparedPointCommitTransactionCommandV1,
  positions: ReadonlyArray<PointCommitDeveloperIndexPositionV1>,
): Promise<ReadonlyMap<string, PointCommitDeveloperIndexEntryHeadV1>> {
  if (positions.length === 0) return new Map();
  const scopeUuid = projectPointCommitTransactionResult(
    projectScopeIdUuidV1Result(command.authorityPins.scopeId).pipe(
      Result.mapError(() => corruption("developerIndexTransitionInvalid")),
    ),
  ).scopeUuid;
  const values = sql.join(positions.map((position, ordinal) => sql`
    (
      ${ordinal}::integer,
      ${position.definitionId}::integer,
      ${orderedIndexKeyBytesHexV1ToBytes(position.encodedKey)}::bytea,
      ${orderedIndexRowIdHexV1ToBytes(position.rowId)}::bytea
    )
  `), sql`, `);
  const statement = sql`
    with requested(ordinal, index_definition_id, encoded_key, row_id) as (
      values ${values}
    )
    select
      requested.ordinal::text as "ordinalText",
      current_entry.commit_seq::text as "currentCommitSeqText",
      latest.commit_seq::text as "latestCommitSeqText",
      latest.is_tombstone as "latestIsTombstone"
    from requested
    left join fx_app_index_entry_current as current_entry
      on current_entry.scope_uuid = ${scopeUuid}
      and current_entry.index_definition_id = requested.index_definition_id
      and current_entry.encoded_key = requested.encoded_key
      and current_entry.row_id = requested.row_id
    left join lateral (
      select revision.commit_seq, revision.is_tombstone
      from fx_app_index_entry_rev as revision
      where revision.scope_uuid = ${scopeUuid}
        and revision.index_definition_id = requested.index_definition_id
        and revision.encoded_key = requested.encoded_key
        and revision.row_id = requested.row_id
      order by revision.commit_seq desc
      limit 1
    ) as latest on true
    order by requested.ordinal asc
  `;
  const result = await sqlCall(
    "loadDeveloperIndexEntryHeads",
    () => tx.execute(statement),
  );
  const rows = rowsFromDriverExecuteResult(result, () => {
    throw corruption("developerIndexTransitionInvalid");
  });
  if (rows.length !== positions.length) {
    throw corruption("developerIndexTransitionInvalid");
  }
  const heads = new Map<string, PointCommitDeveloperIndexEntryHeadV1>();
  for (let ordinal = 0; ordinal < positions.length; ordinal += 1) {
    const raw = rows[ordinal];
    const position = positions[ordinal];
    if (!isNonArrayRecord(raw) || position === undefined) {
      throw corruption("developerIndexTransitionInvalid");
    }
    const decodedOrdinal = projectPointCommitTransactionResult(
      parseNonNegativeIntegerTextResult(raw.ordinalText).pipe(
        Result.mapError(() => corruption("developerIndexTransitionInvalid")),
      ),
    );
    const currentCommitSeq = projectPointCommitTransactionResult(
      parseNullableCommitSeqTextResult(raw.currentCommitSeqText).pipe(
        Result.mapError(() => corruption("developerIndexTransitionInvalid")),
      ),
    );
    const latestCommitSeq = projectPointCommitTransactionResult(
      parseNullableCommitSeqTextResult(raw.latestCommitSeqText).pipe(
        Result.mapError(() => corruption("developerIndexTransitionInvalid")),
      ),
    );
    if (
      decodedOrdinal !== ordinal ||
      (latestCommitSeq === null
        ? raw.latestIsTombstone !== null || currentCommitSeq !== null
        : typeof raw.latestIsTombstone !== "boolean" ||
          (raw.latestIsTombstone
            ? currentCommitSeq !== null
            : currentCommitSeq !== latestCommitSeq))
    ) {
      throw corruption("developerIndexTransitionInvalid");
    }
    heads.set(
      developerIndexPositionKey(
        position.definitionId,
        position.encodedKey,
        position.rowId,
      ),
      Object.freeze({
        commitSeq: latestCommitSeq,
        isTombstone: latestCommitSeq === null
          ? null
          : raw.latestIsTombstone as boolean,
      }),
    );
  }
  return heads;
}

function developerIndexPositionKey(
  definitionId: CatalogIndexDefinitionId,
  encodedKey: OrderedIndexKeyHexV1,
  rowId: OrderedIndexRowIdHexV1,
): string {
  return `${definitionId}:${encodedKey}:${rowId}`;
}

function compareDeveloperIndexEntryActions(
  left: PointCommitDeveloperIndexEntryActionV1,
  right: PointCommitDeveloperIndexEntryActionV1,
): number {
  return left.definition.indexDefinitionId - right.definition.indexDefinitionId ||
    left.encodedKey.localeCompare(right.encodedKey) ||
    left.rowId.localeCompare(right.rowId) ||
    (left.kind === right.kind ? 0 : left.kind === "tombstone" ? -1 : 1);
}

async function writePointCommitDeveloperIndexActions(
  tx: AppRowTransaction,
  command: PreparedPointCommitTransactionCommandV1,
  commitSeq: CommitSeq,
  writeEpoch: ScopeEpoch,
  actions: ReadonlyArray<PointCommitDeveloperIndexEntryActionV1>,
  options: PointCommitTransactionProofOptionsV1,
): Promise<void> {
  for (const action of actions) {
    const appended = await sqlCall("writeDeveloperIndexEntry", () =>
      appendAppIndexEntryRevisionAndAdvanceCurrentInTransactionResult(tx, {
        kind: action.kind,
        scopeId: command.authorityPins.scopeId,
        definition: action.definition,
        encodedKey: action.encodedKey,
        rowId: action.rowId,
        writeEpoch,
        commitSeq,
        prevCommitSeq: action.prevCommitSeq,
      }));
    projectPointCommitTransactionResult(appended);
    await emitTransactionStep(
      options,
      command,
      "developerIndexEntryWritten",
    );
  }
}

async function writePointCommitUniqueKeyActions(
  tx: AppRowTransaction,
  command: PreparedPointCommitTransactionCommandV1,
  commitSeq: CommitSeq,
  writeEpoch: ScopeEpoch,
  actions: ReadonlyArray<PointCommitUniqueKeyActionV1>,
  options: PointCommitTransactionProofOptionsV1,
): Promise<void> {
  for (const action of actions) {
    const input: ApplyAppUniqueKeyMutationV1Input = Object.freeze({
      scopeId: command.authorityPins.scopeId,
      constraintId: action.definition.uniqueConstraintDefinitionId,
      tableId: action.definition.tableId,
      rowId: action.rowId,
      writeEpoch,
      commitSeq,
      rowPrevCommitSeq: action.rowPrevCommitSeq,
      previousClaimCommitSeq: action.previousClaimCommitSeq,
      previous: action.previous,
      next: action.next,
    });
    const settled = await runPointCommitInTransactionEffect(
      applyAppUniqueKeyMutationInTransactionEffect(tx, input),
    );
    projectPointCommitTransactionResult(
      settled.pipe(Result.mapError(mapPointCommitUniqueKeyFailure)),
    );
    await emitTransactionStep(options, command, "uniqueKeyWritten");
  }
}

/** The single audited Effect runtime bridge for the Promise transaction. */
function runPointCommitInTransactionEffect<Value, Failure>(
  effect: Effect.Effect<Value, Failure>,
) {
  return Effect.runPromise(Effect.result(effect));
}

function mapPointCommitUniqueKeyFailure(
  failure: unknown,
): unknown {
  if (
    failure instanceof AppUniqueKeyConflictError ||
    failure instanceof AppUniqueKeyHashError ||
    failure instanceof CanonicalAppUniqueKeyHashCollisionError
  ) return failure;
  if (failure instanceof AppUniqueKeyPersistenceError) {
    return new PointCommitSqlFailureMarkerV1("writeUniqueKey", failure.cause);
  }
  return corruption("uniqueKeyTransitionInvalid");
}

async function runCandidateSchemaWriteGuard(
  tx: AppRowTransaction,
  candidate: PreparedPointCommitCandidateSchemaWriteGuard,
  authority: TrustedScopeAuthority,
  clock: ScopeClockRecord,
  commitSeq: CommitSeq,
  liveRows: ReadonlyArray<Readonly<{
    readonly tableId: CatalogTableId;
    readonly rowId: AppRowIdHexV1;
    readonly document: CanonicalFlarexValueV1;
  }>>,
) {
  const settled = await runPointCommitInTransactionEffect(
    applyAppSchemaCandidateWriteGuardInTransactionEffect(
      tx,
      candidate.guard,
      candidate.prepared,
      authority,
      clock,
      commitSeq,
      liveRows,
    ),
  );
  return projectPointCommitTransactionResult(settled.pipe(
    Result.mapError((failure) => failure.reason === "persistence"
      ? new PointCommitSqlFailureMarkerV1(
          "validateCandidateSchema",
          failure.cause ?? failure,
        )
      : corruption("candidateSchemaValidationInvalid")),
  ));
}

async function resetPointCommitDeveloperIndexValidation(
  tx: AppRowTransaction,
  build: IndexBuildStateRecord,
): Promise<void> {
  if (build.lifecycle !== "validating") return;
  const updated = await sqlCall("resetDeveloperIndexValidation", () =>
    tx.update(fxSystemIndexBuildStates).set({
      backfillCursorRowId: null,
      updatedAt: sql`clock_timestamp()`,
    }).where(and(
      eq(fxSystemIndexBuildStates.scopeId, build.scopeId),
      eq(fxSystemIndexBuildStates.indexDefinitionId, build.indexDefinitionId),
      eq(
        fxSystemIndexBuildStates.storageGenerationFence,
        build.storageGenerationFence,
      ),
      eq(fxSystemIndexBuildStates.epoch, build.epoch),
      eq(fxSystemIndexBuildStates.attemptFence, build.attemptFence),
      eq(fxSystemIndexBuildStates.lifecycle, "validating"),
    )).returning({
      indexDefinitionId: fxSystemIndexBuildStates.indexDefinitionId,
    }));
  if (updated.length !== 1) {
    throw corruption("developerIndexBuildInvalid");
  }
}

interface LockedPointCommitIntrinsicIndexV1 {
  readonly definition: LocatedAppIndexDefinitionV1;
  readonly build: IndexBuildStateRecord;
}

async function lockPointCommitIntrinsicIndexBuilds(
  tx: AppRowTransaction,
  clock: LockedPointCommitClockV1,
  definitions: ReadonlyArray<LocatedAppIndexDefinitionV1>,
  command: PreparedPointCommitTransactionCommandV1,
): Promise<ReadonlyArray<LockedPointCommitIntrinsicIndexV1>> {
  const locked: LockedPointCommitIntrinsicIndexV1[] = [];
  for (const definition of definitions) {
    const rows = await sqlCall("lockIntrinsicIndexBuild", () =>
      tx.select().from(fxSystemIndexBuildStates).where(and(
        eq(
          fxSystemIndexBuildStates.scopeId,
          command.authorityPins.scopeId,
        ),
        eq(
          fxSystemIndexBuildStates.indexDefinitionId,
          definition.indexDefinitionId,
        ),
      )).limit(1).for("update"));
    const row = rows[0];
    if (row === undefined) continue;
    const state = projectPointCommitTransactionResult(
      decodeIndexBuildStateRowResult(
        row,
        command.authorityPins.scopeId,
        definition.indexDefinitionId,
      ).pipe(Result.mapError(() => corruption("intrinsicIndexBuildInvalid"))),
    );
    if (
      state.storageGeneration !== clock.record.storageGeneration ||
      state.storageGenerationFence !== clock.record.storageGenerationFence ||
      state.epoch !== clock.record.epoch ||
      state.startCommitSeq > clock.record.lastCommitSeq ||
      state.lifecycle === "retiring"
    ) {
      throw corruption("intrinsicIndexBuildInvalid");
    }
    locked.push(Object.freeze({ definition, build: state }));
  }
  return Object.freeze(locked);
}

async function lowerTentativePointCommitIntrinsicIndex(
  tx: AppRowTransaction,
  build: IndexBuildStateRecord,
  definition: LocatedAppIndexDefinitionV1,
  rowRevision: AppendPreparedAppRowRevisionV1Input,
): Promise<boolean> {
  if (
    definition.access.kind !== "by_creation_time" ||
    definition.access.tableId !== rowRevision.tableId ||
    build.indexDefinitionId !== definition.indexDefinitionId ||
    build.scopeId !== rowRevision.scopeId
  ) {
    throw corruption("intrinsicIndexBuildInvalid");
  }
  const encodedKey = encodeAppOrderedIndexKeyV1({
    spec: definition.physicalSpec,
    values: [orderedIndexCreationTimeV1(rowRevision.creationTime)],
  });
  const rowId = projectPointCommitTransactionResult(
    orderedIndexRowIdHexV1FromBytesResult(
      appRowIdHexV1ToBytes(rowRevision.rowId),
    ).pipe(Result.mapError(() =>
      corruption("intrinsicIndexTransitionInvalid")
    )),
  );
  const keyBytes = orderedIndexKeyHexV1ToBytes(encodedKey);
  const rowIdBytes = appRowIdHexV1ToBytes(rowRevision.rowId);
  const heads = await sqlCall("writeIntrinsicIndexEntry", () =>
    tx.select({
      commitSeq: fxAppIndexEntryRevisions.commitSeq,
      isTombstone: fxAppIndexEntryRevisions.isTombstone,
    }).from(fxAppIndexEntryRevisions).where(and(
      eq(fxAppIndexEntryRevisions.scopeUuid, projectScopeIdUuidV1Result(
        rowRevision.scopeId,
      ).pipe(Result.getOrThrow).scopeUuid),
      eq(
        fxAppIndexEntryRevisions.indexDefinitionId,
        definition.indexDefinitionId,
      ),
      eq(fxAppIndexEntryRevisions.encodedKey, keyBytes),
      eq(fxAppIndexEntryRevisions.rowId, rowIdBytes),
    )).orderBy(desc(fxAppIndexEntryRevisions.commitSeq)).limit(1));
  const head = heads[0];
  if (rowRevision.kind === "tombstone") {
    if (head === undefined) {
      if (build.lifecycle === "enabled") {
        throw corruption("intrinsicIndexTransitionInvalid");
      }
      return false;
    }
    if (
      head.isTombstone ||
      rowRevision.prevCommitSeq === null ||
      head.commitSeq !== rowRevision.prevCommitSeq
    ) {
      throw corruption("intrinsicIndexTransitionInvalid");
    }
  } else {
    if (
      head === undefined &&
      rowRevision.prevCommitSeq !== null &&
      build.lifecycle === "enabled"
    ) {
      throw corruption("intrinsicIndexTransitionInvalid");
    }
    if (
      head !== undefined &&
      (head.isTombstone ||
        rowRevision.prevCommitSeq === null ||
        head.commitSeq !== rowRevision.prevCommitSeq)
    ) {
      throw corruption("intrinsicIndexTransitionInvalid");
    }
  }
  const appended = await sqlCall("writeIntrinsicIndexEntry", () =>
    appendAppIndexEntryRevisionAndAdvanceCurrentInTransactionResult(tx, {
      kind: rowRevision.kind,
      scopeId: rowRevision.scopeId,
      definition,
      encodedKey,
      rowId,
      writeEpoch: rowRevision.writeEpoch,
      commitSeq: rowRevision.commitSeq,
      prevCommitSeq: head?.commitSeq ?? null,
    }));
  projectPointCommitTransactionResult(appended);
  return true;
}

async function resetPointCommitIntrinsicIndexValidation(
  tx: AppRowTransaction,
  build: IndexBuildStateRecord,
): Promise<void> {
  if (build.lifecycle !== "validating") return;
  const updated = await sqlCall("resetIntrinsicIndexValidation", () =>
    tx.update(fxSystemIndexBuildStates).set({
      backfillCursorRowId: null,
      updatedAt: sql`clock_timestamp()`,
    }).where(and(
      eq(fxSystemIndexBuildStates.scopeId, build.scopeId),
      eq(
        fxSystemIndexBuildStates.indexDefinitionId,
        build.indexDefinitionId,
      ),
      eq(
        fxSystemIndexBuildStates.storageGenerationFence,
        build.storageGenerationFence,
      ),
      eq(fxSystemIndexBuildStates.epoch, build.epoch),
      eq(fxSystemIndexBuildStates.attemptFence, build.attemptFence),
      eq(fxSystemIndexBuildStates.lifecycle, "validating"),
    )).returning({
      indexDefinitionId: fxSystemIndexBuildStates.indexDefinitionId,
    }));
  if (updated.length !== 1) {
    throw corruption("intrinsicIndexBuildInvalid");
  }
}

async function lowerTentativePointCommitRow(
  tx: AppRowTransaction,
  writeEpoch: ScopeEpoch,
  tentativeCommitSeq: CommitSeq,
  command: PreparedPointCommitTransactionCommandV1,
  heads: ReadonlyArray<LoadedPointCommitHeadV1>,
  intent: PreparedPointCommitRowIntentV1,
): Promise<AppendPreparedAppRowRevisionV1Input> {
  const input = projectPointCommitTransactionResult(
    prepareTentativePointCommitRowResult(
      writeEpoch,
      tentativeCommitSeq,
      command,
      heads,
      intent,
    ),
  );
  const written = await sqlCall("writeTentativeRow", () =>
    appendPreparedAppRowRevisionAndAdvanceCurrentInTransactionResult(tx, input));
  projectPointCommitTransactionResult(written);
  return input;
}

function prepareTentativePointCommitRowResult(
  writeEpoch: ScopeEpoch,
  tentativeCommitSeq: CommitSeq,
  command: PreparedPointCommitTransactionCommandV1,
  heads: ReadonlyArray<LoadedPointCommitHeadV1>,
  intent: PreparedPointCommitRowIntentV1,
): Result.Result<
  AppendPreparedAppRowRevisionV1Input,
  PointCommitCorruptionV1Error
> {
  const index = command.dependencies.findIndex(
    (dependency) => pointDependenciesEqual(dependency, intent),
  );
  const loaded = heads[index];
  if (index < 0 || loaded === undefined) {
    return Result.fail(corruption("rowTransitionInvalid"));
  }
  const observed = intent.dependency.observed;
  if (intent.kind === "deleted") {
    if (
      observed.kind !== "present" ||
      loaded.head.kind !== "live" ||
      loaded.creationTime === null
    ) {
      return Result.fail(corruption("rowTransitionInvalid"));
    }
    const predecessorCommitSeq = loaded.head.revisionCommitSeq;
    const creationTime = loaded.creationTime;
    return Result.succeed({
      kind: "tombstone",
      scopeId: command.authorityPins.scopeId,
      tableId: intent.tableId,
      rowId: intent.rowId,
      writeEpoch,
      commitSeq: tentativeCommitSeq,
      prevCommitSeq: predecessorCommitSeq,
      schemaVersionId: command.authorityPins.schemaVersionId,
      creationTime,
    });
  }

  let prevCommitSeq: CommitSeq | null;
  if (
    observed.kind === "missing" &&
    observed.basis.kind === "noVisibleRevision" &&
    loaded.head.kind === "missing"
  ) {
    prevCommitSeq = null;
  } else if (
    observed.kind === "present" &&
    loaded.head.kind === "live"
  ) {
    prevCommitSeq = loaded.head.revisionCommitSeq;
  } else {
    return Result.fail(corruption("rowTransitionInvalid"));
  }
  return Result.succeed({
    kind: "live",
    scopeId: command.authorityPins.scopeId,
    tableId: intent.tableId,
    rowId: intent.rowId,
    writeEpoch,
    commitSeq: tentativeCommitSeq,
    prevCommitSeq,
    schemaVersionId: command.authorityPins.schemaVersionId,
    creationTime: intent.creationTime,
    document: intent.document,
  });
}

function freezeRowIdentity(
  input: Pick<PointCommitDependencyV1, "tableId" | "rowId">,
  scopeId: ReplacementScopeIdV1,
): Readonly<AppRowIdentityV1> {
  return Object.freeze({
    scopeId,
    tableId: input.tableId,
    rowId: input.rowId,
  });
}

async function emitTransactionStep(
  options: PointCommitTransactionProofOptionsV1,
  command: PreparedPointCommitAttemptScalarCommandV1,
  step: PointCommitTransactionProofStepV1,
): Promise<void> {
  await options.afterTransactionStep?.(Object.freeze({
    scopeId: command.authorityPins.scopeId,
    step,
  }));
}

async function emitReplacementStep(
  options: PointMutationAttemptReplacementOptionsV1,
  command: PreparedPointMutationAttemptReplacementCommandV1,
  step: PointMutationAttemptReplacementProofStepV1,
): Promise<void> {
  await options.afterReplacementStep?.(Object.freeze({
    scopeId: command.authorityPins.scopeId,
    step,
  }));
}

function preliminaryAuthorityFailure(
  command: PreparedPointCommitAttemptScalarCommandV1,
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

async function sqlCall<Value>(
  operation: PointCommitSqlOperationV1,
  call: () => PromiseLike<Value>,
): Promise<Value> {
  try {
    return await call();
  } catch (cause) {
    if (
      cause instanceof PointCommitConflictV1Error ||
      cause instanceof PointCommitStaleAuthorityV1Error ||
      cause instanceof PointCommitCorruptionV1Error ||
      cause instanceof PointCommitResourceExhaustionV1Error ||
      isAppendAppIndexEntryRevisionV1Error(cause) ||
      cause instanceof CommittedPointOutcomeRequestKeyReuseErrorV1 ||
      cause instanceof CommittedPointOutcomeCorruptionErrorV1
    ) {
      throw cause;
    }
    throw new PointCommitSqlFailureMarkerV1(operation, cause);
  }
}

function parseNonNegativeIntegerTextResult(
  value: unknown,
): Result.Result<number, PointCommitCorruptionV1Error> {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]*)$/.test(value)) {
    return Result.fail(corruption("rowHeadInvalid"));
  }
  const parsed = Number(value);
  if (!isNonNegativeSafeInteger(parsed)) {
    return Result.fail(corruption("rowHeadInvalid"));
  }
  return Result.succeed(parsed);
}

function parseNullableCommitSeqTextResult(
  value: unknown,
): Result.Result<CommitSeq | null, PointCommitCorruptionV1Error> {
  if (value === null) return Result.succeed(null);
  if (
    typeof value !== "string" ||
    value.length > MAX_SIGNED_COMMIT_SEQ_TEXT_LENGTH ||
    !/^[1-9][0-9]*$/.test(value)
  ) {
    return Result.fail(corruption("rowHeadInvalid"));
  }
  const parsed = BigInt(value);
  if (parsed > MAX_SIGNED_COMMIT_SEQ) {
    return Result.fail(corruption("rowHeadInvalid"));
  }
  return decodePointCommitSeqResult(parsed).pipe(
    Result.mapError(() => corruption("rowHeadInvalid")),
  );
}

/**
 * Temporary projection owned by Drizzle 0.45's Promise transaction callback.
 * Delete it when the point-commit mutation graph owns an Effect transaction
 * client and can yield these Result failures directly.
 */
function projectPointCommitTransactionResult<A, E>(
  result: Result.Result<A, E>,
): A {
  return Result.getOrThrow(result);
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

function mapTransactionFailure(
  cause: unknown,
): PointCommitRollbackProofV1Error {
  if (
    cause instanceof PointCommitConflictV1Error ||
    cause instanceof PointCommitStaleAuthorityV1Error ||
    cause instanceof PointCommitCorruptionV1Error ||
    cause instanceof PointCommitResourceExhaustionV1Error ||
    cause instanceof PointCommitSqlErrorV1 ||
    cause instanceof PointCommitIntrinsicIndexDefinitionUnavailableV1Error ||
    cause instanceof PointCommitDeveloperIndexMaintenanceUnavailableV1Error ||
    cause instanceof PointCommitUniqueConstraintMaintenanceUnavailableV1Error ||
    cause instanceof AppSchemaCandidateWriteGuardError ||
    cause instanceof AppUniqueKeyConflictError ||
    cause instanceof AppUniqueKeyHashError ||
    cause instanceof CanonicalAppUniqueKeyHashCollisionError ||
    isAppendAppIndexEntryRevisionV1Error(cause)
  ) {
    return cause;
  }
  if (cause instanceof LocatedReadCommittedTransactionFailureV1) {
    if (
      cause.issue.kind === "callbackRolledBack" &&
      cause.issue.callbackCause !== cause
    ) {
      return mapTransactionFailure(cause.issue.callbackCause);
    }
    return sqlError("beginOrRollback", cause);
  }
  if (cause instanceof PointCommitSqlFailureMarkerV1) {
    return sqlError(cause.operation, cause.cause);
  }
  if (isAppendAppRowRevisionV1Error(cause)) {
    return corruption("rowWriteInvalid");
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

function sqlError(
  operation: PointCommitSqlOperationV1,
  cause: unknown,
): PointCommitSqlErrorV1 {
  const sqlState = findSqlState(cause);
  return new PointCommitSqlErrorV1({
    operation,
    cause,
    ...(sqlState === undefined ? {} : { sqlState }),
  });
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

function findSqlState(cause: unknown, depth = 0): string | undefined {
  if (depth > 4 || !isNonArrayRecord(cause)) return undefined;
  const code = cause.code;
  if (typeof code === "string" && /^[0-9A-Z]{5}$/.test(code)) {
    return code;
  }
  const nested = cause.cause;
  return nested === cause ? undefined : findSqlState(nested, depth + 1);
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

function corruption(
  reason: PointCommitCorruptionReasonV1,
): PointCommitCorruptionV1Error {
  return new PointCommitCorruptionV1Error({ reason });
}

function stale(
  reason: PointCommitStaleAuthorityReasonV1,
): PointCommitStaleAuthorityV1Error {
  return new PointCommitStaleAuthorityV1Error({ reason });
}
