import {
  bytesEqualFullScan as bytesEqual,
  copyBytes,
  encodeBytesToLowercaseHex,
  isUint8ArrayWithByteLength,
} from "@flarex/utils/bytes";
import { finiteDateMilliseconds } from "@flarex/utils/dates";
import {
  isNonNegativeSafeInteger,
  isPositiveSafeInteger,
} from "@flarex/utils/numbers";
import { isNonArrayRecord } from "@flarex/utils/records";
import { and, eq, sql } from "drizzle-orm";
import { Data, Effect, Result } from "effect";

import {
  decodeAppCreationTimeV1,
  type AppCreationTimeV1,
} from "flarex-protocol/app-document";
import {
  appDocumentIdV1FromRowIdentity,
  appRowIdHexV1ToBytes,
  decodeAppDocumentIdentityV1,
  decodeAppRowIdHexV1,
  type AppDocumentIdV1,
  type AppRowIdHexV1,
} from "flarex-protocol/app-document-id";
import {
  decodeCatalogTableId,
  type CatalogTableId,
} from "flarex-protocol/catalog";
import {
  CanonicalSuccessfulResultBytesV1Schema,
  MAX_COMMIT_CANONICAL_EVIDENCE_BYTES_V1,
  MAX_COMMIT_POINT_READ_DEPENDENCIES_V1,
  MAX_COMMIT_RESULT_SEMANTIC_BYTES_V1,
  SESSION_JOURNAL_FORMAT_V1,
  canonicalizeSuccessfulResultV1Effect,
  type CommitFinalSyscallSequenceV1,
  type CommitMaterialWriteEventEvidenceBytesV1,
  type LogicalReadDependencyV1,
  type SuccessfulResultSha256HexV1,
} from "flarex-protocol/commit-protocol";
import type { CatalogSchemaVersionId } from "flarex-protocol/schema-manifest";
import {
  MAX_PERSISTED_SIGNED_INT64_V1,
  CommitSeqSchema,
  OutboxSeqSchema,
  decodeScopeEpochUuidV1,
  decodeScopeUuidV1,
  projectScopeEpochUuidV1,
  projectScopeIdUuidV1,
  replacementScopeEpochV1FromUuid,
  type CommitSeq,
  type FlarexDbV1StorageGeneration,
  type OutboxSeq,
  type ReplacementScopeIdV1,
  type ScopeEpoch,
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
  type TransactionIdentityAccessPolicySha256V1,
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
  canonicalizeFlarexValueV1,
  isCanonicalFlarexRuntimeObjectV1,
  type CanonicalFlarexRuntimeValueV1,
  type CanonicalFlarexValueV1,
  type FlarexValueCodecVersion,
} from "flarex-protocol/value";

import {
  AppRowCreationTimeConflictError,
  AppRowRevisionAlreadyExistsError,
  AppRowRevisionChainConflictError,
  AppRowScopeAuthorityUnavailableError,
  AppRowStorageCorruptionError,
  InvalidAppRowRevisionV1InputError,
  appendPreparedAppRowRevisionAndAdvanceCurrentInTransaction,
  type AppRowIdentityV1,
  type AppRowPointDependencyV1,
  type AppRowTransaction,
} from "./appRows";
import {
  validateAppRowPointOccV1,
  type AppRowPointHeadObservationV1,
} from "./appRowPointOcc";
import {
  committedPointOutcomeRequestMismatchesV1,
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
} from "./committedPointOutcome";
import { COMMIT_WAKE_OUTBOX_EVENT_KIND_V1 } from "./commitWakeOutbox";
import {
  observeDrizzleQuery as observeCompiledDrizzleQuery,
} from "./drizzleQueryObservation";
import {
  decodeScopeClockRecord,
  ScopeClockCorruptionError,
  ScopeClockNotFoundError,
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
  fxAppRowCurrent,
  fxAppRowRevisions,
  fxSystemCommitAppRowChanges,
  fxSystemCommits,
  fxSystemIdempotency,
  fxSystemOutbox,
  fxSystemScopeClocks,
  fxSystemSnapshotLeases,
  fxSystemTransactionJournalLatestReceipts,
  fxSystemTransactionJournalPoints,
  fxSystemTransactionJournalWriteEvents,
  fxSystemTransactionJournals,
  fxSystemTransactionSessions,
} from "./schema";
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
import {
  buildFreshTransactionAttemptFacetV1,
  isPristineFreshTransactionAttemptJournalRootV1,
} from
  "./transactionSessionAttemptFacet";

export type {
  CommittedPointOutcomeResolutionV1,
  ResolveCommittedPointOutcomeInputV1,
} from "./committedPointOutcome";

const MAX_SIGNED_COMMIT_SEQ = MAX_PERSISTED_SIGNED_INT64_V1;
const HASH_BYTE_LENGTH = 32;

export interface PointCommitAuthorityPinsV1 {
  readonly deploymentId: TransactionGrantDeploymentIdV1;
  readonly scopeId: ReplacementScopeIdV1;
  readonly sessionId: TransactionSessionIdV1;
  readonly attemptFence: TransactionAttemptFence;
  readonly storageGeneration: FlarexDbV1StorageGeneration;
  readonly storageGenerationFence: StorageGenerationFence;
  readonly snapshotToken: SnapshotToken;
  readonly schemaVersionId: CatalogSchemaVersionId;
  readonly packageId: TransactionPackageIdV1;
  readonly artifactRuntime: TransactionArtifactRuntimeV1;
  readonly artifactId: TransactionArtifactIdV1;
  readonly sourcePackageHash: TransactionSourcePackageSha256HexV1;
  readonly executionModule: TransactionExecutionModuleV1;
  readonly functionPath: TransactionFunctionPathV1;
  readonly functionKind: "mutation";
  readonly policyVersion: TransactionPolicyVersionV1;
  readonly authorizationRevocationEpoch: TransactionAuthorizationRevocationEpoch;
  readonly requestKey: TransactionRequestKeyV1;
}

export type PointCommitSessionScalarsV1 = Omit<
  StoredTransactionSessionScalarsV1,
  "authorizationGrantId"
> & {
  readonly authorizationGrantId: TransactionAuthorizationGrantIdV1;
};

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
  readonly session: Readonly<
    Omit<PointCommitSessionScalarsV1, "lifecycle"> & {
      readonly lifecycle: "running";
    }
  >;
  readonly sealIdentity: Readonly<
    Omit<PointCommitSealIdentityV1, "lifecycle"> & {
      readonly lifecycle: "running";
    }
  >;
}

export interface PointCommitDependencyV1 {
  readonly documentId: AppDocumentIdV1;
  readonly tableId: CatalogTableId;
  readonly rowId: AppRowIdHexV1;
  readonly dependency: LogicalReadDependencyV1;
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
  readonly rowIntent: PointCommitRowIntentV1 | null;
}

/**
 * O08-A correlation evidence only. Persistence re-resolves every authority
 * fact and reproduces the OCC conflict; this detached record cannot authorize
 * user-code execution or a later retry.
 */
export interface PointMutationAttemptReplacementCommandV1
  extends PointCommitAttemptScalarCommandV1 {
  readonly dependencies: ReadonlyArray<PointCommitDependencyV1>;
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
  | "enterRetryRunning"
  | "validatePristineAttempt";

export class PointMutationAttemptReplacementSqlErrorV1
  extends Data.TaggedError("PointMutationAttemptReplacementSqlErrorV1")<{
    readonly operation: PointMutationAttemptReplacementSqlOperationV1;
    readonly cause: unknown;
    readonly sqlState?: string;
  }> {}

export type PointMutationAttemptReplacementV1Error =
  | PointMutationAttemptReplacementCommittedOutcomeV1Error
  | PointMutationAttemptReplacementConflictNoLongerPresentV1Error
  | PointMutationAttemptReplacementRequestKeyReuseV1Error
  | PointMutationAttemptReplacementCorruptionV1Error
  | PointMutationAttemptReplacementStaleAuthorityV1Error
  | PointMutationAttemptReplacementResourceExhaustionV1Error
  | PointMutationAttemptReplacementSqlErrorV1;

/** Lifecycle correlation only; this result is never an execution permit. */
export interface PointMutationAttemptReplacementObservationV1 {
  readonly kind: "replaced" | "alreadyReplaced";
  readonly scopeUuid: ScopeUuidV1;
  readonly sessionId: TransactionSessionIdV1;
  readonly previousAttemptFence: TransactionAttemptFence;
  readonly attemptFence: TransactionAttemptFence;
}

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

  constructor(readonly reason: "leaseDurationInvalid") {
    super("O08-A requires a positive safe-integer lease duration.");
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

export class PointCommitConflictV1Error extends Data.TaggedError(
  "PointCommitConflictV1Error",
)<{
  readonly documentId: AppDocumentIdV1;
  readonly snapshotCommitSeq: CommitSeq;
  readonly currentCommitSeq: CommitSeq;
}> {}

export type PointCommitStaleAuthorityReasonV1 =
  | "placementChanged"
  | "scopeChanged"
  | "generationChanged"
  | "epochChanged"
  | "revocationEpochChanged"
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

export type PointCommitSqlOperationV1 =
  | "resolveAuthority"
  | "beginOrRollback"
  | "lockScopeClock"
  | "lockSession"
  | "lockLease"
  | "lockJournalRoot"
  | "readDatabaseTime"
  | "enterFinishing"
  | "loadRowHeads"
  | "writeTentativeRow"
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
  readonly retryable: boolean;
  readonly cause: unknown;
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
  | PointCommitSqlErrorV1;

export interface PointCommitRollbackProofPortV1 {
  readonly prove: (
    command: PointCommitTransactionCommandV1,
  ) => Effect.Effect<
    PointCommitWouldCommitV1,
    PointCommitRollbackProofV1Error,
    never
  >;
}

export type PointCommitPublicationV1Error =
  | PointCommitRollbackProofV1Error
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
 * Intentional internal O07-A seam for the O08-B1 coordinator. The deployment
 * id is only a locator; the resolver still derives the trusted target and the
 * stored request evidence remains authoritative. This symbol is deliberately
 * absent from the persistence package root.
 */
export const RESOLVE_POINT_COMMIT_OUTCOME_FOR_OCC_RERUN_V1: unique symbol =
  Symbol("FlarexDB/resolvePointCommitOutcomeForOccRerunV1");

export type PointCommitOutcomeResolutionForOccRerunV1Error =
  | PointCommitFinishingTransitionV1Error
  | ResolveCommittedPointOutcomeErrorV1;

export interface PointCommitOutcomeResolutionPortV1 {
  readonly [RESOLVE_POINT_COMMIT_OUTCOME_FOR_OCC_RERUN_V1]: (
    deploymentId: TransactionGrantDeploymentIdV1,
    input: ResolveCommittedPointOutcomeInputV1,
  ) => Effect.Effect<
    CommittedPointOutcomeResolutionV1,
    PointCommitOutcomeResolutionForOccRerunV1Error,
    never
  >;
}

export type PointCommitTransactionProofStepV1 =
  | "clockLocked"
  | "sessionLocked"
  | "leaseLocked"
  | "journalRootLocked"
  | "sessionEnteredFinishing"
  | "dependenciesValidated"
  | "tentativeRowWritten"
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
  | "sessionRunning"
  | "beforeCommit";

export interface PointMutationAttemptReplacementOptionsV1 {
  readonly leaseDurationMilliseconds: number;
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
      keyof PointCommitAttemptScalarCommandV1 | "rowIntent"
    > {
  readonly rowIntent: PreparedPointCommitRowIntentV1 | null;
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
}

type PreparedPointCommitDependencyCommandV1 =
  | PreparedPointCommitTransactionCommandV1
  | PreparedPointMutationAttemptReplacementCommandV1;

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
    const command = yield* Effect.try({
      try: () => capturePointCommitFinishingTransitionCommand(input),
      catch: mapCommandPreparationFailure,
    });
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
  const proofOptions: PointCommitTransactionProofOptionsV1 = Object.freeze({
    ...(options.observeQuery === undefined
      ? {}
      : { observeQuery: options.observeQuery }),
  });

  const replace: PointMutationAttemptReplacementPortV1["replace"] = Effect.fn(
    "PointMutationAttemptReplacement.replace",
  )(function* (input) {
    const command = yield* Effect.try({
      try: () => capturePointMutationAttemptReplacementCommand(input),
      catch: mapPointMutationAttemptReplacementPreparationFailure,
    });
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
  const prove: PointCommitRollbackProofPortV1["prove"] = Effect.fn(
    "PointCommitTransaction.proveRollback",
  )(function* (input) {
    const command = yield* Effect.tryPromise({
      try: () => preparePointCommitCommand(input),
      catch: mapCommandPreparationFailure,
    });
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
      try: () => runRollbackProof(
        target,
        located.authority,
        command,
        options,
      ),
      catch: mapTransactionFailure,
    }));
  });

  return Object.freeze({ prove });
}

export function createPointCommitPublisherPortV1(
  ports: PointMutationSessionAuthorityResolutionPortsV1,
  options: PointCommitTransactionProofOptionsV1 = {},
): PointCommitPublisherPortV1 & PointCommitOutcomeResolutionPortV1 {
  const rollback = createPointCommitRollbackProofPortV1(ports, options);

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

    const runPublication = Effect.uninterruptible(Effect.tryPromise({
      try: () => runPointCommitPublication(
        target,
        located.authority,
        command,
        options,
      ),
      catch: mapPublicationTransactionFailure,
    }));
    const decision: PointCommitPublicationRunDecisionV1 = yield*
      runPublication.pipe(
        Effect.catchTag("PointCommitSqlErrorV1", (error) =>
          resolveOutcome(target, lookup).pipe(
            Effect.flatMap((recovered): Effect.Effect<
              PointCommitPublicationRunDecisionV1,
              PointCommitSqlErrorV1
            > =>
              recovered.kind === "missing"
                ? Effect.fail(error)
                : Effect.succeed(Object.freeze({
                    kind: "recovered" as const,
                    outcome: recovered,
                  }))
            ),
          )),
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

  const resolveOutcomeForOccRerun: PointCommitOutcomeResolutionPortV1[
    typeof RESOLVE_POINT_COMMIT_OUTCOME_FOR_OCC_RERUN_V1
  ] = Effect.fn(
    "PointCommitTransaction.resolveOutcomeForOccRerun",
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

  return Object.freeze({
    ...rollback,
    publish,
    [RESOLVE_POINT_COMMIT_OUTCOME_FOR_OCC_RERUN_V1]:
      resolveOutcomeForOccRerun,
  });
}

async function preparePointCommitCommand(
  input: PointCommitTransactionCommandV1,
): Promise<PreparedPointCommitTransactionCommandV1> {
  const captured = capturePointCommitCommand(input);
  if (captured.rowIntent === null) {
    return Object.freeze({ ...captured, rowIntent: null });
  }
  if (captured.rowIntent.kind === "deleted") {
    return Object.freeze({
      ...captured,
      rowIntent: captured.rowIntent,
    });
  }
  const rowIntent = captured.rowIntent;
  const document = await canonicalizeFlarexValueV1(
    rowIntent.value,
    "appDocument",
  );
  if (
    !bytesEqual(document.canonicalBytes, rowIntent.canonicalBytes) ||
    document.semanticSizeBytes !== rowIntent.semanticSizeBytes ||
    !isCanonicalDocumentForIntent(document, rowIntent)
  ) {
    throw corruption("commandInvalid");
  }
  return Object.freeze({
    ...captured,
    rowIntent: Object.freeze({
      documentId: rowIntent.documentId,
      tableId: rowIntent.tableId,
      rowId: rowIntent.rowId,
      dependency: rowIntent.dependency,
      kind: "live",
      creationTime: rowIntent.creationTime,
      document,
    } satisfies PreparedLivePointCommitRowIntentV1),
  });
}

const preparePointCommitPublicationCommand = Effect.fn(
  "PointCommitTransaction.preparePublicationCommand",
)(function* (
  input: PointCommitPublicationCommandV1,
): Effect.fn.Return<
  PreparedPointCommitPublicationCommandV1,
  PointCommitCorruptionV1Error | PointCommitStaleAuthorityV1Error
> {
  const command = yield* Effect.tryPromise({
    try: () => preparePointCommitCommand(input),
    catch: mapCommandPreparationFailure,
  });
  const successfulResult = yield* Effect.try({
    try: () => captureSuccessfulResult(
      input.successfulResult,
      command.sealIdentity.resultByteLength,
    ),
    catch: mapCommandPreparationFailure,
  });
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

function captureSuccessfulResult(
  input: PointCommitSuccessfulResultV1,
  expectedByteLength: number,
): Readonly<PointCommitSuccessfulResultV1> {
  let stableBytes: Uint8Array;
  let stableValue: CanonicalFlarexRuntimeValueV1;
  let valueCodecVersion: PointCommitSuccessfulResultV1["valueCodecVersion"];
  let semanticSizeBytes: PointCommitSuccessfulResultV1["semanticSizeBytes"];
  let sha256Hex: PointCommitSuccessfulResultV1["sha256Hex"];
  try {
    const canonicalBytes = input.canonicalBytes;
    if (
      !isNonArrayRecord(input) ||
      !isUint8ArrayWithByteLength(canonicalBytes, expectedByteLength)
    ) {
      throw new TypeError("Canonical result bytes are not a Uint8Array.");
    }
    stableBytes = copyBytes(canonicalBytes);
    stableValue = structuredClone(input.value);
    valueCodecVersion = input.valueCodecVersion;
    semanticSizeBytes = input.semanticSizeBytes;
    sha256Hex = input.sha256Hex;
  } catch {
    throw corruption("successfulResultInvalid");
  }
  if (
    valueCodecVersion !== FLAREX_VALUE_CODEC_VERSION_V1 ||
    stableBytes.byteLength < 1 ||
    !isNonNegativeSafeInteger(semanticSizeBytes) ||
    typeof sha256Hex !== "string" ||
    !/^[0-9a-f]{64}$/.test(sha256Hex)
  ) {
    throw corruption("successfulResultInvalid");
  }
  return Object.freeze({
    valueCodecVersion,
    value: stableValue,
    get canonicalBytes(): PointCommitSuccessfulResultV1["canonicalBytes"] {
      return CanonicalSuccessfulResultBytesV1Schema.make(
        copyBytes(stableBytes),
      );
    },
    semanticSizeBytes,
    sha256Hex,
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

function capturePointCommitCommand(
  input: PointCommitTransactionCommandV1,
): PointCommitTransactionCommandV1 {
  if (
    input.session.lifecycle !== "finishing" ||
    input.sealIdentity.lifecycle !== "finishing"
  ) {
    throw stale("lifecycleChanged");
  }
  const authorityPins = captureAuthorityPins(input.authorityPins);
  const session = captureSessionScalars(input.session);
  const sealIdentity = captureSealIdentity(input.sealIdentity);
  requireCommandAuthorityConsistency(authorityPins, session, sealIdentity);

  const dependencies = capturePointCommitDependencies(
    input.dependencies,
    sealIdentity.pointDependencyCount,
  );
  const rowIntent = input.rowIntent === null
    ? null
    : captureRowIntent(input.rowIntent);
  if (rowIntent !== null && !dependencies.some(
    (dependency) => pointDependenciesEqual(dependency, rowIntent),
  )) {
    throw corruption("commandInvalid");
  }

  return Object.freeze({
    authorityPins,
    session,
    sealIdentity,
    dependencies,
    rowIntent,
  });
}

function capturePointMutationAttemptReplacementCommand(
  input: PointMutationAttemptReplacementCommandV1,
): PreparedPointMutationAttemptReplacementCommandV1 {
  if (
    input.session.lifecycle !== "finishing" ||
    input.sealIdentity.lifecycle !== "finishing"
  ) {
    throw stale("lifecycleChanged");
  }
  const authorityPins = captureAuthorityPins(input.authorityPins);
  const session = captureSessionScalars(input.session);
  const sealIdentity = captureSealIdentity(input.sealIdentity);
  requireCommandAuthorityConsistency(authorityPins, session, sealIdentity);
  return Object.freeze({
    authorityPins,
    session,
    sealIdentity,
    dependencies: capturePointCommitDependencies(
      input.dependencies,
      sealIdentity.pointDependencyCount,
    ),
  });
}

function capturePointCommitDependencies(
  input: ReadonlyArray<PointCommitDependencyV1>,
  expectedCount: number,
): ReadonlyArray<PointCommitDependencyV1> {
  if (
    !Array.isArray(input) ||
    input.length > MAX_COMMIT_POINT_READ_DEPENDENCIES_V1 ||
    input.length !== expectedCount
  ) {
    throw corruption("commandInvalid");
  }
  const dependencies = Object.freeze(input.map(capturePointDependency));
  requireCanonicalDependencyOrder(dependencies);
  return dependencies;
}

function capturePointCommitFinishingTransitionCommand(
  input: PointCommitFinishingTransitionCommandV1,
): PreparedPointCommitFinishingTransitionCommandV1 {
  if (
    input.session.lifecycle !== "running" ||
    input.sealIdentity.lifecycle !== "running"
  ) {
    throw stale("lifecycleChanged");
  }
  const authorityPins = captureAuthorityPins(input.authorityPins);
  const session = captureSessionScalars(input.session);
  const sealIdentity = captureSealIdentity(input.sealIdentity);
  requireCommandAuthorityConsistency(authorityPins, session, sealIdentity);
  return Object.freeze({
    authorityPins,
    session: Object.freeze({ ...session, lifecycle: "running" as const }),
    sealIdentity: Object.freeze({
      ...sealIdentity,
      lifecycle: "running" as const,
    }),
  });
}

function captureAuthorityPins(
  input: PointCommitAuthorityPinsV1,
): Readonly<PointCommitAuthorityPinsV1> {
  if (
    input.storageGeneration !== "flarexdb_v1" ||
    input.storageGenerationFence < 1n ||
    input.snapshotToken.scopeId !== input.scopeId ||
    input.snapshotToken.commitSeq < 0n ||
    input.functionKind !== "mutation"
  ) {
    throw corruption("commandInvalid");
  }
  return Object.freeze({
    ...input,
    snapshotToken: Object.freeze({ ...input.snapshotToken }),
  });
}

function captureSessionScalars(
  input: PointCommitSessionScalarsV1,
): Readonly<PointCommitSessionScalarsV1> {
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
    input.hardExpiresAtMilliseconds !==
      input.authorizationGrantExpiresAtMilliseconds
  ) {
    throw corruption("commandInvalid");
  }
  return Object.freeze({
    ...input,
    identityAccessPolicySha256:
      new Uint8Array(input.identityAccessPolicySha256),
    validatedArgsSha256: new Uint8Array(input.validatedArgsSha256),
    authorizationGrantSha256:
      new Uint8Array(input.authorizationGrantSha256),
    requestSha256: new Uint8Array(input.requestSha256),
  });
}

function captureSealIdentity(
  input: PointCommitSealIdentityV1,
): Readonly<PointCommitSealIdentityV1> {
  let creationTimeSeed: AppCreationTimeV1;
  let nextCreationTime: AppCreationTimeV1;
  try {
    creationTimeSeed = decodeAppCreationTimeV1(input.creationTimeSeed);
    nextCreationTime = decodeAppCreationTimeV1(input.nextCreationTime);
  } catch {
    throw corruption("commandInvalid");
  }
  if (
    input.journalFormat !== SESSION_JOURNAL_FORMAT_V1 ||
    input.journalProtocolVersion !== TRANSACTION_SESSION_PROTOCOL_VERSION_V1 ||
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
    throw corruption("commandInvalid");
  }
  return Object.freeze({
    ...input,
    creationTimeSeed,
    nextCreationTime,
    journalSha256: new Uint8Array(input.journalSha256),
    resultSha256: new Uint8Array(input.resultSha256),
  });
}

function requireCommandAuthorityConsistency(
  pins: Readonly<PointCommitAuthorityPinsV1>,
  session: Readonly<PointCommitSessionScalarsV1>,
  seal: Readonly<PointCommitSealIdentityV1>,
): void {
  let projectedScopeUuid: ScopeUuidV1;
  try {
    projectedScopeUuid = projectScopeIdUuidV1(pins.scopeId).scopeUuid;
  } catch {
    throw corruption("commandInvalid");
  }
  if (
    seal.scopeUuid !== projectedScopeUuid ||
    seal.sessionUpdatedAtMilliseconds !== session.updatedAtMilliseconds ||
    seal.leaseExpiresAtMilliseconds > session.hardExpiresAtMilliseconds ||
    pins.storageGeneration !== session.storageGeneration ||
    pins.storageGenerationFence !== session.storageGenerationFence ||
    pins.packageId !== session.packageId ||
    pins.artifactRuntime !== session.artifactRuntime ||
    pins.artifactId !== session.artifactId ||
    pins.sourcePackageHash !== session.sourcePackageHash ||
    pins.executionModule !== session.executionModule ||
    pins.functionPath !== session.functionPath ||
    pins.functionKind !== session.functionKind ||
    pins.schemaVersionId !== session.schemaVersionId ||
    pins.policyVersion !== session.policyVersion ||
    pins.authorizationRevocationEpoch !==
      session.authorizationRevocationEpoch ||
    pins.requestKey !== session.requestKey
  ) {
    throw corruption("commandInvalid");
  }
}

function capturePointDependency(
  input: PointCommitDependencyV1,
): Readonly<PointCommitDependencyV1> {
  try {
    const tableId = decodeCatalogTableId(input.tableId);
    const rowId = decodeAppRowIdHexV1(input.rowId);
    const identity = decodeAppDocumentIdentityV1(input.documentId);
    if (
      identity.tableId !== tableId ||
      identity.rowId !== rowId ||
      input.dependency.kind !== "appRowPoint" ||
      input.dependency.documentId !== identity.id
    ) {
      throw corruption("commandInvalid");
    }
    const dependency = captureLogicalDependency(input.dependency);
    return Object.freeze({
      documentId: identity.id,
      tableId,
      rowId,
      dependency,
    });
  } catch (cause) {
    if (cause instanceof PointCommitCorruptionV1Error) throw cause;
    throw corruption("commandInvalid");
  }
}

function captureLogicalDependency(
  input: LogicalReadDependencyV1,
): LogicalReadDependencyV1 {
  switch (input.observed.kind) {
    case "present":
      return Object.freeze({
        kind: "appRowPoint",
        documentId: input.documentId,
        observed: Object.freeze({
          kind: "present",
          revisionCommitSeq: input.observed.revisionCommitSeq,
        }),
      });
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
          });
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
          });
      }
  }
}

function captureRowIntent(
  input: PointCommitRowIntentV1,
): Readonly<PointCommitRowIntentV1> {
  const dependency = capturePointDependency(input);
  if (input.kind === "deleted") {
    return Object.freeze({ ...dependency, kind: "deleted" });
  }
  let creationTime: AppCreationTimeV1;
  try {
    creationTime = decodeAppCreationTimeV1(input.creationTime);
  } catch {
    throw corruption("commandInvalid");
  }
  if (
    !(input.canonicalBytes instanceof Uint8Array) ||
    input.canonicalBytes.byteLength === 0 ||
    !isPositiveSafeInteger(input.semanticSizeBytes)
  ) {
    throw corruption("commandInvalid");
  }
  return Object.freeze({
    ...dependency,
    kind: "live",
    creationTime,
    value: structuredClone(input.value),
    canonicalBytes: new Uint8Array(input.canonicalBytes),
    semanticSizeBytes: input.semanticSizeBytes,
  });
}

function requireCanonicalDependencyOrder(
  dependencies: ReadonlyArray<Readonly<PointCommitDependencyV1>>,
): void {
  for (let index = 1; index < dependencies.length; index += 1) {
    const previous = dependencies[index - 1];
    const current = dependencies[index];
    if (previous === undefined || current === undefined) {
      throw corruption("commandInvalid");
    }
    const tableDifference = previous.tableId - current.tableId;
    const rowDifference = compareRowIds(previous.rowId, current.rowId);
    if (tableDifference > 0 || (tableDifference === 0 && rowDifference >= 0)) {
      throw corruption("commandInvalid");
    }
  }
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

interface LockedPointCommitClockV1 {
  readonly record: ReturnType<typeof decodeScopeClockRecord>;
  readonly oldestAvailableCommitSeq: bigint;
  readonly scopeUuid: ScopeUuidV1;
  readonly epochUuid: ReturnType<typeof decodeScopeEpochUuidV1>;
  readonly authorizationRevocationEpoch: TransactionAuthorizationRevocationEpoch;
}

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
    requireLockedClockAuthority(clock, preliminaryAuthority, command);

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
    const databaseNowMilliseconds = await readPointCommitDatabaseTime(
      tx,
      command.authorityPins.scopeId,
      sharedOptions,
    );
    requireAttemptIsLive(session, lease, databaseNowMilliseconds);

    const heads = await loadPointCommitHeads(
      tx,
      clock,
      command,
      sharedOptions,
    );
    requireReproduciblePointCommitConflict(command, heads);
    await emitReplacementStep(options, command, "dependenciesValidated");

    const mutationTimeMilliseconds = await readPointCommitDatabaseTime(
      tx,
      command.authorityPins.scopeId,
      sharedOptions,
    );
    requireAttemptIsLive(session, lease, mutationTimeMilliseconds);
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
    const freshFacetResult = buildFreshTransactionAttemptFacetV1({
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
    });
    if (Result.isFailure(freshFacetResult)) {
      if (freshFacetResult.failure === "authorityExpired") {
        throw stale("expired");
      }
      throw replacementCorruption("freshLeaseInvalid");
    }
    const freshFacet = freshFacetResult.success;

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
    return replacementObservation("replaced", command, replacementFence);
  });
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
  const expectedFacetResult = buildFreshTransactionAttemptFacetV1({
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
  });
  if (Result.isFailure(expectedFacetResult)) {
    throw replacementCorruption("replacementConvergenceInvalid");
  }
  const expectedFacet = expectedFacetResult.success;
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
  requireAttemptIsLive(
    session,
    Object.freeze({
      expiresAtMilliseconds:
        finiteDateMilliseconds(expectedFacet.leaseExpiresAt) ?? 0,
    }),
    databaseNowMilliseconds,
  );
  return replacementObservation("alreadyReplaced", command, expectedFence);
}

function replacementObservation(
  kind: PointMutationAttemptReplacementObservationV1["kind"],
  command: PreparedPointMutationAttemptReplacementCommandV1,
  attemptFence: TransactionAttemptFence,
): PointMutationAttemptReplacementObservationV1 {
  return Object.freeze({
    kind,
    scopeUuid: command.sealIdentity.scopeUuid,
    sessionId: command.authorityPins.sessionId,
    previousAttemptFence: command.authorityPins.attemptFence,
    attemptFence,
  });
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
    requireLockedClockAuthority(clock, preliminaryAuthority, command);

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
    requireAttemptIsLive(session, lease, databaseNowMilliseconds);
    if (session.updatedAtMilliseconds > databaseNowMilliseconds) {
      throw corruption("finishingTransitionInvalid");
    }
    const priorSessionUpdatedAtMilliseconds =
      command.session.updatedAtMilliseconds;
    if (session.lifecycle === "finishing") {
      return finishingTransitionResult(
        "observed",
        command,
        priorSessionUpdatedAtMilliseconds,
        session.updatedAtMilliseconds,
      );
    }
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
    const updated = rows[0];
    const updatedAtMilliseconds = updated === undefined
      ? undefined
      : finiteDateMilliseconds(updated.updatedAt);
    if (
      rows.length !== 1 ||
      updated === undefined ||
      updated.lifecycle !== "finishing" ||
      updatedAtMilliseconds === undefined ||
      updatedAtMilliseconds !== databaseNowMilliseconds
    ) {
      throw corruption("finishingTransitionInvalid");
    }
    await emitTransactionStep(options, command, "sessionEnteredFinishing");
    return finishingTransitionResult(
      "transitioned",
      command,
      priorSessionUpdatedAtMilliseconds,
      updatedAtMilliseconds,
    );
  });
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
  options: PointCommitTransactionProofOptionsV1,
): Promise<PointCommitWouldCommitV1> {
  try {
    await target[RUN_LOCATED_READ_COMMITTED_V1](async (tx) => {
      await runPointCommitTransactionKernel(
        tx,
        preliminaryAuthority,
        command,
        options,
        "rollbackProof",
      );
      await emitTransactionStep(options, command, "beforeRollback");
      throw ROLLBACK_SENTINEL;
    });
  } catch (cause) {
    if (cause === ROLLBACK_SENTINEL) return WOULD_COMMIT;
    throw cause;
  }
  throw corruption("rollbackSentinelMissing");
}

async function runPointCommitPublication(
  target: LocatedPointCommitPublicationTargetV1,
  preliminaryAuthority: TrustedScopeAuthority,
  command: PreparedPointCommitPublicationCommandV1,
  options: PointCommitTransactionProofOptionsV1,
): Promise<PointCommitPublicationDecisionV1> {
  return target[RUN_LOCATED_READ_COMMITTED_V1](async (tx) => {
    const kernel = await runPointCommitTransactionKernel(
      tx,
      preliminaryAuthority,
      command,
      options,
      "publish",
    );
    if (kernel.kind === "existing") return kernel;
    if (
      kernel.commitSeq === null ||
      kernel.outboxSeq === null ||
      kernel.publicationTimeMilliseconds === null
    ) {
      throw corruption("publicationInvariantInvalid");
    }
    const ready = Object.freeze({
      ...kernel,
      commitSeq: kernel.commitSeq,
      outboxSeq: kernel.outboxSeq,
      publicationTimeMilliseconds: kernel.publicationTimeMilliseconds,
    });
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
  requireLockedClockAuthority(clock, preliminaryAuthority, command);

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
  requireAttemptIsLive(session, lease, databaseNowMilliseconds);

  const loadedHeads = await loadPointCommitHeads(
    tx,
    clock,
    command,
    options,
  );
  validatePointCommitDependencies(command, loadedHeads);
  await emitTransactionStep(options, command, "dependenciesValidated");

  if (mode === "rollbackProof" && command.rowIntent === null) {
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
  requireAttemptIsLive(session, lease, preWriteDatabaseNowMilliseconds);
  if (clock.record.lastCommitSeq >= MAX_SIGNED_COMMIT_SEQ) {
    throw new PointCommitResourceExhaustionV1Error({
      dimension: "commitSequence",
      maximum: MAX_SIGNED_COMMIT_SEQ,
    });
  }
  if (
    mode === "publish" &&
    clock.record.lastOutboxSeq >= MAX_PERSISTED_SIGNED_INT64_V1
  ) {
    throw new PointCommitResourceExhaustionV1Error({
      dimension: "outboxSequence",
      maximum: MAX_PERSISTED_SIGNED_INT64_V1,
    });
  }
  const tentativeCommitSeq = CommitSeqSchema.make(
    clock.record.lastCommitSeq + 1n,
  );
  const rowIntent = command.rowIntent;
  if (rowIntent !== null) {
    await lowerTentativePointCommitRow(
      tx,
      clock.record.epoch,
      tentativeCommitSeq,
      command,
      loadedHeads,
    );
    await emitTransactionStep(options, command, "tentativeRowWritten");
  }
  return Object.freeze({
    kind: "ready",
    clock,
    commitSeq: tentativeCommitSeq,
    outboxSeq: mode === "publish"
      ? OutboxSeqSchema.make(clock.record.lastOutboxSeq + 1n)
      : null,
    publicationTimeMilliseconds: preWriteDatabaseNowMilliseconds,
  });
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
  if (rows.length === 0) {
    throw stale("scopeChanged");
  }
  if (rows.length !== 1) throw corruption("scopeClockInvalid");
  const row = rows[0];
  if (row === undefined) throw corruption("scopeClockInvalid");
  try {
    const record = decodeScopeClockRecord(row);
    const scopeUuid = decodeScopeUuidV1(row.scopeUuid);
    const epochUuid = decodeScopeEpochUuidV1(row.epochUuid);
    if (
      scopeUuid !== projectScopeIdUuidV1(record.scopeId).scopeUuid ||
      epochUuid !== projectScopeEpochUuidV1(record.epoch).epochUuid ||
      typeof row.oldestAvailableCommitSeq !== "bigint" ||
      row.oldestAvailableCommitSeq < 0n ||
      row.oldestAvailableCommitSeq > record.lastCommitSeq
    ) {
      throw new Error("Native scope-clock projection mismatch.");
    }
    return Object.freeze({
      record,
      oldestAvailableCommitSeq: row.oldestAvailableCommitSeq,
      scopeUuid,
      epochUuid,
      authorizationRevocationEpoch:
        TransactionAuthorizationRevocationEpochSchema.make(
          row.authorizationRevocationEpoch,
        ),
    });
  } catch {
    throw corruption("scopeClockInvalid");
  }
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
  if (rows.length > 1) {
    throw committedOutcomeCorruption(lookup, "duplicateOutcome");
  }
  const row = rows[0];
  if (row === undefined) return null;
  const requestEvidence: CommittedPointOutcomeRequestEvidenceV1 = row;
  const shape = validateCommittedPointOutcomeRequestEvidenceShapeV1(
    lookup,
    requestEvidence,
  );
  if (Result.isFailure(shape)) throw shape.failure;

  let epochUuid: LockedPointCommitClockV1["epochUuid"];
  try {
    epochUuid = decodeScopeEpochUuidV1(row.epochUuid);
  } catch {
    throw committedOutcomeCorruption(lookup, "commitTokenInvalid");
  }
  if (
    typeof row.commitSeq !== "bigint" ||
    row.commitSeq < 1n ||
    row.commitSeq > MAX_SIGNED_COMMIT_SEQ
  ) {
    throw committedOutcomeCorruption(lookup, "commitTokenInvalid");
  }
  const commitSeq = CommitSeqSchema.make(row.commitSeq);
  if (commitSeq > clock.record.lastCommitSeq) {
    throw committedOutcomeCorruption(
      lookup,
      "commitTokenAheadOfClock",
      commitSeq,
    );
  }
  const headerAbsent = row.retainedHeaderScopeUuid === null &&
    row.retainedHeaderEpochUuid === null &&
    row.retainedHeaderCommitSeq === null;
  if (headerAbsent) {
    if (
      clock.oldestAvailableCommitSeq === 0n ||
      commitSeq >= clock.oldestAvailableCommitSeq
    ) {
      throw committedOutcomeCorruption(
        lookup,
        "missingRetainedHeader",
        commitSeq,
      );
    }
  } else {
    let retainedEpoch: LockedPointCommitClockV1["epochUuid"];
    try {
      retainedEpoch = decodeScopeEpochUuidV1(row.retainedHeaderEpochUuid);
    } catch {
      throw committedOutcomeCorruption(
        lookup,
        "retainedHeaderInvalid",
        commitSeq,
      );
    }
    if (
      row.retainedHeaderScopeUuid !== lookup.scopeUuid ||
      row.retainedHeaderCommitSeq !== commitSeq
    ) {
      throw committedOutcomeCorruption(
        lookup,
        "retainedHeaderInvalid",
        commitSeq,
      );
    }
    if (retainedEpoch !== epochUuid) {
      throw committedOutcomeCorruption(
        lookup,
        "retainedHeaderEpochMismatch",
        commitSeq,
      );
    }
  }

  const createdAtMilliseconds = finiteDateMilliseconds(row.createdAt);
  const resultExpiredAtMilliseconds = finiteDateMilliseconds(
    row.resultExpiredAt,
  );
  if (createdAtMilliseconds === undefined) {
    throw committedOutcomeCorruption(lookup, "outcomeRowInvalid", commitSeq);
  }
  if (row.resultState !== "available" && row.resultState !== "expired") {
    throw committedOutcomeCorruption(lookup, "resultStateInvalid", commitSeq);
  }
  const availableScalarsValid =
    row.resultValueCodecVersion === FLAREX_VALUE_CODEC_VERSION_V1 &&
    isNonNegativeSafeInteger(row.resultSemanticBytes) &&
    row.resultSemanticBytes <= MAX_COMMIT_RESULT_SEMANTIC_BYTES_V1 &&
    isPositiveSafeInteger(row.resultByteLength) &&
    row.resultByteLength <= MAX_COMMIT_CANONICAL_EVIDENCE_BYTES_V1 &&
    row.resultSha256ByteLength === HASH_BYTE_LENGTH &&
    row.resultExpiredAt === null;
  const expiredScalarsValid =
    row.resultValueCodecVersion === null &&
    row.resultSemanticBytes === null &&
    row.resultByteLength === null &&
    row.resultSha256ByteLength === null &&
    resultExpiredAtMilliseconds !== undefined &&
    resultExpiredAtMilliseconds >= createdAtMilliseconds;
  if (
    (row.resultState === "available" && !availableScalarsValid) ||
    (row.resultState === "expired" && !expiredScalarsValid)
  ) {
    throw committedOutcomeCorruption(
      lookup,
      row.resultState === "available"
        ? "availableResultEvidenceInvalid"
        : "expiredResultEvidenceInvalid",
      commitSeq,
    );
  }

  const mismatches = committedPointOutcomeRequestMismatchesV1(
    requestEvidence,
  );
  if (mismatches.length > 0) {
    throw new CommittedPointOutcomeRequestKeyReuseErrorV1({
      scopeUuid: lookup.scopeUuid,
      mismatches,
    });
  }
  return Object.freeze({ state: row.resultState, commitSeq });
}

function requireLockedClockAuthority(
  clock: LockedPointCommitClockV1,
  preliminary: TrustedScopeAuthority,
  command: PreparedPointCommitAttemptScalarCommandV1,
): void {
  const pins = command.authorityPins;
  if (
    clock.record.scopeId !== pins.scopeId ||
    preliminary.scopeId !== pins.scopeId ||
    preliminary.deploymentId !== pins.deploymentId ||
    clock.scopeUuid !== command.sealIdentity.scopeUuid
  ) {
    throw stale("scopeChanged");
  }
  if (
    clock.record.storageGeneration !== "flarexdb_v1" ||
    preliminary.storageGeneration !== "flarexdb_v1" ||
    clock.record.storageGeneration !== pins.storageGeneration ||
    preliminary.storageGeneration !== pins.storageGeneration ||
    clock.record.storageGenerationFence !== pins.storageGenerationFence ||
    preliminary.storageGenerationFence !== pins.storageGenerationFence
  ) {
    throw stale("generationChanged");
  }
  if (
    clock.record.epoch !== pins.snapshotToken.epoch ||
    preliminary.epoch !== pins.snapshotToken.epoch
  ) {
    throw stale("epochChanged");
  }
  if (
    clock.authorizationRevocationEpoch !==
      pins.authorizationRevocationEpoch
  ) {
    throw stale("revocationEpochChanged");
  }
  if (pins.snapshotToken.commitSeq > clock.record.lastCommitSeq) {
    throw corruption("scopeClockInvalid");
  }
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
  if (rows.length === 0) throw stale("attemptMissing");
  if (rows.length !== 1) throw corruption("sessionDuplicate");
  const row = rows[0];
  if (row === undefined) throw corruption("sessionDuplicate");
  const expectedAttemptFence = command.authorityPins.attemptFence;
  const replacementAttemptFence = expectedAttemptFence <
      MAX_TRANSACTION_ATTEMPT_FENCE
    ? TransactionAttemptFenceSchema.make(expectedAttemptFence + 1n)
    : null;
  const observesReplacement = mode === "replaceAttempt" &&
    replacementAttemptFence !== null &&
    row.attemptFence === replacementAttemptFence;
  if (row.attemptFence !== expectedAttemptFence && !observesReplacement) {
    throw stale("attemptReplaced");
  }
  if (mode === "replaceAttempt") {
    if (
      (observesReplacement && row.lifecycle !== "running") ||
      (!observesReplacement && row.lifecycle !== "finishing")
    ) {
      throw stale("lifecycleChanged");
    }
  } else if (mode === "enterFinishing") {
    if (row.lifecycle !== "running" && row.lifecycle !== "finishing") {
      throw stale("lifecycleChanged");
    }
  } else if (row.lifecycle !== "finishing") {
    if (mode === "publish" && row.lifecycle === "committed") {
      throw corruption("committedOutcomeMissing");
    }
    throw stale("lifecycleChanged");
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
    row.packageId !== expected.packageId ||
    row.artifactRuntime !== expected.artifactRuntime ||
    row.artifactId !== expected.artifactId ||
    row.sourcePackageHash !== expected.sourcePackageHash ||
    row.executionModule !== expected.executionModule ||
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
    throw corruption("sessionInvalid");
  }
  if (row.lifecycle !== "running" && row.lifecycle !== "finishing") {
    throw corruption("sessionInvalid");
  }
  return Object.freeze({
    lifecycle: row.lifecycle,
    attemptFence: TransactionAttemptFenceSchema.make(row.attemptFence),
    authorizationGrantExpiresAtMilliseconds,
    hardExpiresAtMilliseconds,
    updatedAtMilliseconds,
  });
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
  if (rows.length === 0) throw stale("leaseMissing");
  if (rows.length !== 1) throw corruption("leaseDuplicate");
  const row = rows[0];
  if (row === undefined) throw corruption("leaseDuplicate");
  if (row.attemptFence !== command.authorityPins.attemptFence) {
    throw stale("leaseReplaced");
  }
  let snapshotEpoch: ScopeEpoch;
  try {
    snapshotEpoch = replacementScopeEpochV1FromUuid(row.snapshotEpochUuid);
  } catch {
    throw corruption("leaseInvalid");
  }
  const leaseExpiresAtMilliseconds = finiteDateMilliseconds(
    row.leaseExpiresAt,
  );
  if (
    row.scopeUuid !== command.sealIdentity.scopeUuid ||
    row.sessionId !== command.authorityPins.sessionId ||
    snapshotEpoch !== command.authorityPins.snapshotToken.epoch ||
    row.snapshotCommitSeq !== command.authorityPins.snapshotToken.commitSeq ||
    leaseExpiresAtMilliseconds === undefined ||
    leaseExpiresAtMilliseconds !==
      command.sealIdentity.leaseExpiresAtMilliseconds ||
    leaseExpiresAtMilliseconds > command.session.hardExpiresAtMilliseconds
  ) {
    throw corruption("leaseInvalid");
  }
  return Object.freeze({
    expiresAtMilliseconds: leaseExpiresAtMilliseconds,
  });
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
  if (rows.length !== 1) {
    throw corruption("journalRootMissingOrDuplicate");
  }
  const row = rows[0];
  if (row === undefined) {
    throw corruption("journalRootMissingOrDuplicate");
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
    throw corruption("journalRootInvalid");
  }
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
  const text = rows[0]?.milliseconds;
  if (typeof text !== "string" || !/^[1-9][0-9]*$/.test(text)) {
    throw corruption("scopeClockInvalid");
  }
  const value = Number(text);
  if (!isPositiveSafeInteger(value)) {
    throw corruption("scopeClockInvalid");
  }
  return value;
}

function requireAttemptIsLive(
  session: LockedPointCommitSessionV1,
  lease: LockedPointCommitLeaseV1,
  databaseNowMilliseconds: number,
): void {
  if (
    session.authorizationGrantExpiresAtMilliseconds <=
      databaseNowMilliseconds ||
    session.hardExpiresAtMilliseconds <= databaseNowMilliseconds ||
    lease.expiresAtMilliseconds <= databaseNowMilliseconds
  ) {
    throw stale("expired");
  }
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
  const rows = rowsFromExecuteResult(result);
  if (rows.length !== command.dependencies.length) {
    throw corruption("rowHeadInvalid");
  }
  return Object.freeze(rows.map((raw, ordinal) => decodePointCommitHead(
    raw,
    ordinal,
    command.dependencies[ordinal],
    command.authorityPins.scopeId,
    clock.record.lastCommitSeq,
  )));
}

function decodePointCommitHead(
  raw: unknown,
  expectedOrdinal: number,
  dependency: PointCommitDependencyV1 | undefined,
  scopeId: ReplacementScopeIdV1,
  lastCommitSeq: CommitSeq,
): LoadedPointCommitHeadV1 {
  if (dependency === undefined || !isNonArrayRecord(raw)) {
    throw corruption("rowHeadInvalid");
  }
  const ordinal = parseNonNegativeIntegerText(raw.ordinalText);
  const pointerCommitSeq = parseNullableCommitSeqText(
    raw.pointerCommitSeqText,
  );
  const latestCommitSeq = parseNullableCommitSeqText(
    raw.latestCommitSeqText,
  );
  if (
    ordinal !== expectedOrdinal ||
    (pointerCommitSeq === null) !== (latestCommitSeq === null) ||
    pointerCommitSeq !== latestCommitSeq
  ) {
    throw corruption("rowHeadInvalid");
  }
  const identity = freezeRowIdentity(dependency, scopeId);
  if (latestCommitSeq === null) {
    if (
      raw.latestIsTombstone !== null ||
      raw.latestCreationTimeText !== null
    ) {
      throw corruption("rowHeadInvalid");
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
    throw corruption("rowHeadInvalid");
  }
  let creationTime: AppCreationTimeV1;
  try {
    creationTime = decodeAppCreationTimeV1(
      Number(raw.latestCreationTimeText),
    );
  } catch {
    throw corruption("rowHeadInvalid");
  }
  return Object.freeze({
    head: Object.freeze({
      kind: raw.latestIsTombstone ? "tombstone" : "live",
      identity,
      revisionCommitSeq: latestCommitSeq,
    }),
    creationTime,
  });
}

function validatePointCommitDependencies(
  command: PreparedPointCommitDependencyCommandV1,
  heads: ReadonlyArray<LoadedPointCommitHeadV1>,
): void {
  const conflict = findPointCommitConflictAfterEvidenceValidation(
    command,
    heads,
  );
  if (conflict !== null) throw conflict;
}

function findPointCommitConflictAfterEvidenceValidation(
  command: PreparedPointCommitDependencyCommandV1,
  heads: ReadonlyArray<LoadedPointCommitHeadV1>,
): PointCommitConflictV1Error | null {
  if (heads.length !== command.dependencies.length) {
    throw corruption("dependencySetInvalid");
  }
  let firstConflict: PointCommitConflictV1Error | null = null;
  for (let index = 0; index < command.dependencies.length; index += 1) {
    const dependency = command.dependencies[index];
    const loaded = heads[index];
    if (dependency === undefined || loaded === undefined) {
      throw corruption("dependencySetInvalid");
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
          documentId: dependency.documentId,
          snapshotCommitSeq: validation.conflict.snapshotCommitSeq,
          currentCommitSeq: validation.conflict.currentState.revisionCommitSeq,
        });
        break;
      case "invalidEvidence":
        throw corruption("occEvidenceInvalid");
    }
  }
  return firstConflict;
}

function requireReproduciblePointCommitConflict(
  command: PreparedPointMutationAttemptReplacementCommandV1,
  heads: ReadonlyArray<LoadedPointCommitHeadV1>,
): void {
  const conflict = findPointCommitConflictAfterEvidenceValidation(
    command,
    heads,
  );
  if (conflict !== null) return;
  throw new PointMutationAttemptReplacementConflictNoLongerPresentV1Error({
    reason: "conflictNoLongerPresent",
  });
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
  const changeCount = command.rowIntent === null ? 0 : 1;

  const header = await sqlCall("writeCommitHeader", () =>
    tx.insert(fxSystemCommits).values({
      scopeUuid,
      epochUuid,
      commitSeq,
      changeCount,
      committedAt: publicationTime,
    }).returning({ commitSeq: fxSystemCommits.commitSeq }));
  requireSinglePublicationWrite(header, commitSeq);
  await emitTransactionStep(options, command, "commitHeaderWritten");

  const rowIntent = command.rowIntent;
  if (rowIntent !== null) {
    const change = await sqlCall("writeCommitChange", () =>
      tx.insert(fxSystemCommitAppRowChanges).values({
        scopeUuid,
        epochUuid,
        commitSeq,
        changeOrdinal: 0,
        tableId: rowIntent.tableId,
        rowId: appRowIdHexV1ToBytes(rowIntent.rowId),
      }).returning({ commitSeq: fxSystemCommitAppRowChanges.commitSeq }));
    requireSinglePublicationWrite(change, commitSeq);
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
  requireSinglePublicationWrite(outcome, commitSeq);
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
  if (wake.length !== 1 || wake[0]?.outboxSeq !== outboxSeq) {
    throw corruption("publicationInvariantInvalid");
  }
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
  if (
    journal.length !== 1 ||
    journal[0]?.sessionId !== command.authorityPins.sessionId
  ) {
    throw corruption("publicationInvariantInvalid");
  }
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
  if (
    lease.length !== 1 ||
    lease[0]?.sessionId !== command.authorityPins.sessionId
  ) {
    throw corruption("publicationInvariantInvalid");
  }
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
  if (
    session.length !== 1 ||
    session[0]?.sessionId !== command.authorityPins.sessionId
  ) {
    throw corruption("publicationInvariantInvalid");
  }
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
  if (
    clock.length !== 1 ||
    clock[0]?.lastCommitSeq !== commitSeq ||
    clock[0]?.lastOutboxSeq !== outboxSeq
  ) {
    throw corruption("publicationInvariantInvalid");
  }
  await emitTransactionStep(options, command, "clockAdvanced");
}

function requireSinglePublicationWrite(
  rows: ReadonlyArray<Readonly<{ readonly commitSeq: CommitSeq }>>,
  expected: CommitSeq,
): void {
  if (rows.length !== 1 || rows[0]?.commitSeq !== expected) {
    throw corruption("publicationInvariantInvalid");
  }
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

async function lowerTentativePointCommitRow(
  tx: AppRowTransaction,
  writeEpoch: ScopeEpoch,
  tentativeCommitSeq: CommitSeq,
  command: PreparedPointCommitTransactionCommandV1,
  heads: ReadonlyArray<LoadedPointCommitHeadV1>,
): Promise<void> {
  const intent = command.rowIntent;
  if (intent === null) throw corruption("rowTransitionInvalid");
  const index = command.dependencies.findIndex(
    (dependency) => pointDependenciesEqual(dependency, intent),
  );
  const loaded = heads[index];
  if (index < 0 || loaded === undefined) {
    throw corruption("rowTransitionInvalid");
  }
  const observed = intent.dependency.observed;
  if (intent.kind === "deleted") {
    if (
      observed.kind !== "present" ||
      loaded.head.kind !== "live" ||
      loaded.creationTime === null
    ) {
      throw corruption("rowTransitionInvalid");
    }
    const predecessorCommitSeq = loaded.head.revisionCommitSeq;
    const creationTime = loaded.creationTime;
    await sqlCall("writeTentativeRow", () =>
      appendPreparedAppRowRevisionAndAdvanceCurrentInTransaction(tx, {
        kind: "tombstone",
        scopeId: command.authorityPins.scopeId,
        tableId: intent.tableId,
        rowId: intent.rowId,
        writeEpoch,
        commitSeq: tentativeCommitSeq,
        prevCommitSeq: predecessorCommitSeq,
        schemaVersionId: command.authorityPins.schemaVersionId,
        creationTime,
      }));
    return;
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
    throw corruption("rowTransitionInvalid");
  }
  await sqlCall("writeTentativeRow", () =>
    appendPreparedAppRowRevisionAndAdvanceCurrentInTransaction(tx, {
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
    }));
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
      cause instanceof CommittedPointOutcomeCorruptionErrorV1 ||
      isAppRowInvariantFailure(cause)
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
      cause instanceof CommittedPointOutcomeRequestKeyReuseErrorV1 ||
      cause instanceof CommittedPointOutcomeCorruptionErrorV1 ||
      isAppRowInvariantFailure(cause)
    ) {
      throw cause;
    }
    throw new PointCommitSqlFailureMarkerV1(operation, cause);
  }
}

function rowsFromExecuteResult(result: unknown): ReadonlyArray<unknown> {
  if (Array.isArray(result)) return result;
  if (isNonArrayRecord(result) && Array.isArray(result.rows)) {
    return result.rows;
  }
  throw corruption("rowHeadInvalid");
}

function parseNonNegativeIntegerText(value: unknown): number {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]*)$/.test(value)) {
    throw corruption("rowHeadInvalid");
  }
  const parsed = Number(value);
  if (!isNonNegativeSafeInteger(parsed)) {
    throw corruption("rowHeadInvalid");
  }
  return parsed;
}

function parseNullableCommitSeqText(value: unknown): CommitSeq | null {
  if (value === null) return null;
  if (typeof value !== "string" || !/^[1-9][0-9]*$/.test(value)) {
    throw corruption("rowHeadInvalid");
  }
  const parsed = BigInt(value);
  if (parsed > MAX_SIGNED_COMMIT_SEQ) {
    throw corruption("rowHeadInvalid");
  }
  return CommitSeqSchema.make(parsed);
}

function mapCommandPreparationFailure(
  cause: unknown,
): PointCommitCorruptionV1Error | PointCommitStaleAuthorityV1Error {
  if (
    cause instanceof PointCommitCorruptionV1Error ||
    cause instanceof PointCommitStaleAuthorityV1Error
  ) {
    return cause;
  }
  if (cause instanceof FlarexValueCodecV1Error) {
    return corruption("commandInvalid");
  }
  throw cause;
}

function mapPointMutationAttemptReplacementPreparationFailure(
  cause: unknown,
): PointMutationAttemptReplacementV1Error {
  if (
    cause instanceof PointCommitStaleAuthorityV1Error ||
    cause instanceof PointCommitCorruptionV1Error ||
    cause instanceof PointCommitSqlErrorV1
  ) {
    return mapPointMutationAttemptReplacementSharedError(cause);
  }
  if (cause instanceof FlarexValueCodecV1Error) {
    return replacementCorruption("commandInvalid");
  }
  throw cause;
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

function publicationResultFromOutcome(
  outcome: CommittedPointOutcomeResolutionV1,
  disposition: "published" | "replayed",
  expectedToken?: CommittedPointOutcomeTokenV1,
): PointCommitPublicationResultV1 {
  if (outcome.kind === "missing") {
    throw corruption("committedOutcomeMissing");
  }
  if (
    expectedToken !== undefined &&
    (
      outcome.token.scopeUuid !== expectedToken.scopeUuid ||
      outcome.token.epochUuid !== expectedToken.epochUuid ||
      outcome.token.commitSeq !== expectedToken.commitSeq
    )
  ) {
    throw corruption("publishedOutcomeInvalid");
  }
  if (outcome.kind === "expired") {
    if (disposition === "published") {
      throw corruption("publishedOutcomeInvalid");
    }
    return Object.freeze({ kind: "expired", token: outcome.token });
  }
  return Object.freeze({
    kind: disposition,
    token: outcome.token,
    successfulResult: outcome.successfulResult,
  });
}

function publicationResultFromOutcomeEffect(
  outcome: CommittedPointOutcomeResolutionV1,
  disposition: "published" | "replayed",
  expectedToken?: CommittedPointOutcomeTokenV1,
): Effect.Effect<
  PointCommitPublicationResultV1,
  PointCommitCorruptionV1Error
> {
  return Effect.try({
    try: () => publicationResultFromOutcome(
      outcome,
      disposition,
      expectedToken,
    ),
    catch: (cause) => {
      if (cause instanceof PointCommitCorruptionV1Error) return cause;
      throw cause;
    },
  });
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
  if (cause instanceof LocatedReadCommittedTransactionFailureV1) {
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
  if (cause instanceof LocatedReadCommittedTransactionFailureV1) {
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
  if (isAppRowInvariantFailure(cause)) {
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
    cause instanceof PointCommitSqlErrorV1
  ) {
    return cause;
  }
  if (cause instanceof LocatedReadCommittedTransactionFailureV1) {
    return sqlError("beginOrRollback", cause);
  }
  if (cause instanceof PointCommitSqlFailureMarkerV1) {
    return sqlError(cause.operation, cause.cause);
  }
  if (isAppRowInvariantFailure(cause)) {
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
): PointCommitPublicationV1Error {
  if (
    cause instanceof CommittedPointOutcomeRequestKeyReuseErrorV1 ||
    cause instanceof CommittedPointOutcomeCorruptionErrorV1
  ) {
    return cause;
  }
  return mapTransactionFailure(cause);
}

function isAppRowInvariantFailure(cause: unknown): boolean {
  return cause instanceof InvalidAppRowRevisionV1InputError ||
    cause instanceof AppRowScopeAuthorityUnavailableError ||
    cause instanceof AppRowRevisionAlreadyExistsError ||
    cause instanceof AppRowRevisionChainConflictError ||
    cause instanceof AppRowCreationTimeConflictError ||
    cause instanceof AppRowStorageCorruptionError;
}

function sqlError(
  operation: PointCommitSqlOperationV1,
  cause: unknown,
): PointCommitSqlErrorV1 {
  const sqlState = findSqlState(cause);
  return new PointCommitSqlErrorV1({
    operation,
    retryable: sqlState === "40001" || sqlState === "40P01",
    cause,
    ...(sqlState === undefined ? {} : { sqlState }),
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
