import { CAPTURE_FINITE_STORAGE, bindFiniteStorageCaptureOwner, type FiniteStorageCaptureTarget, type FiniteStorageCaptureProfile } from "./finiteStorageCapture";
import { runLocatedReadCommittedEffect } from "../database/locatedReadCommittedEffect";
import { runPointCommitInTransactionEffect, projectPointCommitTransactionResult, runPointCommitPromiseEffect } from "../commit/pointCommitPromiseBoundary";
import { selectScopeClockRows, type ScopeClockRow } from "../scope/scopeClock";
import { SessionJournalPersistenceV1Error, type SessionJournalStorePersistence } from "./sessionJournalStore";
import { captureFiniteAttemptAnchor, projectCapturedFiniteAttemptAnchor, readFiniteAttemptAnchorRow,
  lockFiniteAttemptAnchorInTransaction, requireFiniteAttemptIsLive,
  FiniteAttemptAnchorError } from "./finiteAttemptAnchor";
import type { FiniteAttemptAnchorContext, FiniteAttemptFrontierRow } from "./finiteAttemptAnchor";
import { readCapturedFiniteMetadataReservation, type CapturedFiniteMetadataReservation } from "./finiteMetadataReservation";
import { runDrizzleStatementEffect } from "../database/drizzleStatementEffect";
import { captureFiniteEntryObservationInTransactionEffect, closeFiniteEntryObservation,
  type FiniteEntryObservation } from "./finiteEntryObservation";
import type { FiniteEntryAttemptKernelContext } from "./transactionSessionAttemptKernel";
import { encodeFiniteMetadataComparison, prepareFiniteMetadataEntryComparison, acceptFiniteMetadataEntryComparisonVerdict, submitFiniteMetadataEntryComparisonEffect,
  type PreparedFiniteMetadataProjection } from "./finiteMetadataDependencies";
import {
  bytesEqual,
  encodeBytesToLowercaseHex,
  isUint8ArrayWithByteLength,
} from "@flarex/utils/bytes";
import {
  copyFiniteDate,
  finiteDateMilliseconds,
} from "@flarex/utils/dates";
import { isPositiveSafeInteger } from "@flarex/utils/numbers";
import { and, asc, eq, getTableColumns, sql, type SQL } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import { Cause, Data, Effect, Result, Schema } from "effect";
import { runEffectTransactionSettlement } from "../database/effectTransaction";

import {
  canonicalizeApplicationMutationExecutionAuthorityV1,
  type CanonicalApplicationMutationExecutionAuthorityV1,
  type ApplicationMutationExecutionAuthorityV1Error,
} from "flarex-protocol/internal/application-mutation-authority-v1";
import {
  inspectVerifiedApplicationMutationGrantV1,
  type VerifiedApplicationMutationGrantV1,
} from "flarex-protocol/internal/application-mutation-grant-v1";

import { decodeAppCreationTimeV1 } from "flarex-protocol/app-document";
import {
  CommitFinalSyscallSequenceV1Schema,
  CommitMaterialWriteEventEvidenceBytesV1Schema,
  SESSION_JOURNAL_FORMAT,
} from "flarex-protocol/commit-protocol";
import {
  isJsonArray,
  isJsonObject,
  isJsonObjectFromUnknown,
  jsonEqual,
  type Json,
  type JsonObject,
} from "flarex-protocol/json";
import {
  CatalogSchemaVersionIdSchema,
  type CatalogSchemaVersionId,
} from "flarex-protocol/schema-manifest";
import {
  CommitSeqSchema,
  FlarexDbV1StorageGenerationSchema,
  MAX_PERSISTED_SIGNED_INT64_V1,
  SnapshotTokenSchema,
  StorageGenerationFenceSchema,
  ReplacementScopeIdV1Schema,
  decodeReplacementScopeIdV1,
  decodeScopeEpochUuidV1,
  decodeScopeUuidV1,
  projectScopeEpochUuidV1,
  projectScopeIdUuidV1,
  replacementScopeEpochV1FromUuid,
  replacementScopeIdV1FromUuid,
  type CommitSeq,
  type FlarexDbV1StorageGeneration,
  type ReplacementScopeIdV1,
  type ScopeEpoch,
  type ScopeEpochUuidV1,
  type ScopeId,
  type ScopeUuidV1,
  type SnapshotToken,
  type StorageGenerationFence,
} from "flarex-protocol/storage-authority";
import {
  TransactionGrantDeploymentIdV1Schema,
  type TransactionGrantDeploymentIdV1,
} from "flarex-protocol/transaction-grant";
import {
  TRANSACTION_SESSION_PROTOCOL_VERSION_V1,
  CanonicalTransactionArgumentsBytesV1Schema,
  CanonicalTransactionAuthorizationGrantBytesV1Schema,
  TransactionAttemptFenceSchema,
  TransactionArgumentsSha256V1Schema,
  TransactionAuthorizationGrantSha256V1Schema,
  TransactionAuthorizationRevocationEpochSchema,
  TransactionFunctionPathV1Schema,
  TransactionIdentityAccessPolicySha256V1Schema,
  TransactionRequestKeyV1Schema,
  TransactionRequestSha256V1Schema,
  TransactionSessionIdV1Schema,
  type TransactionAttemptFence,
  type TransactionAuthorizationRevocationEpoch,
  type TransactionSessionLifecycleV1,
  type TransactionRequestKeyV1,
  type TransactionSessionIdV1,
} from "flarex-protocol/transaction-session";
import {
  canonicalizeFlarexValueJsonV1Effect,
} from "flarex-protocol/value";

import type { FlarexMetadataDatabase } from "../application/deployments";
import type { ApplicationGraphSessionSelector } from "../commit/authority/postgresLoader";
import {
  closeProtectedMetadataFinalGuardScope,
  flushProtectedMetadataFinalGuards,
  openProtectedMetadataFinalGuardScope,
  prepareProtectedMetadataFinalGuardBatch,
  acceptProtectedMetadataFinalGuardBatch,
} from "./preparation/preparedMetadataEpoch";
import type { AppRowTransaction } from "../storage/documents/appRows";
import { readRunningAttemptTail, type RunningAttemptTailIssue } from "./exactRunningAttemptTail";
import {
  createCommittedPointOutcomeResolverV1,
  type CommittedPointOutcomeResolutionV1,
  type CommittedPointOutcomeResolverV1,
  type ResolveCommittedPointOutcomeErrorV1,
  type ResolveCommittedPointOutcomeInputV1,
} from "../commit/committedPointOutcome";
import {
  getScopeClock,
  decodeScopeClockRecord,
  readFiniteExecutionAuthorityObservation,
  ScopeClockNotFoundError,
  type ScopeClockRecord,
  openExactAttemptScopeClockObservation,
  closeExactAttemptScopeClockObservation,
  openFiniteExecutionAuthorityObservation, closeFiniteExecutionAuthorityObservation,
} from "../scope/scopeClock";
import {
  resolveLocatedTrustedScopeAuthorityByIdEffect,
  TrustedScopeAuthorityPortError,
  type LocatedTrustedScopeAuthority,
  type LocatedScopeClockReader,
  type ScopeClockTargetReaderResolver,
  type ExactScopeMetadataReader,
  type ScopeMetadataReader,
  type ScopeProvisioningReceiptReader,
  type TrustedScopeAuthority,
  type TrustedScopeAuthorityError,
  type TrustedScopeAuthorityPortOperation,
  type TrustedScopeAuthorityResolutionError,
} from "../scope/scopeAuthorityResolution";
import type { ScopePhysicalLocator } from "../scope/scopeMetadataTypes";
import { captureScopePhysicalLocator } from "../scope/scopePhysicalLocator";
import { ScopeExecutionAuthorityError } from "../scope/execution/Errors";
import { liveScopeExecution } from "../scope/execution/ScopeExecution";
import { closeInstallationAdmission, lockInstallationForCurrentTransaction, acquireCoLocatedInstallationAdmission, acquireInstallationAdmission,
  requireAdmittedTargetInstallationSchema,
  type PreparedCoLocatedReadInstallation, type PreparedInstallation } from "../installation/installationLifecycle";
import { INSTALLED_SCOPE_AUTHORITY_TARGET, ACCEPT_INSTALLED_ATTEMPT_SCOPE_AUTHORITY_IN_TRANSACTION, RUN_INSTALLED_ACCEPTING_READ_COMMITTED, prepareInstalledAttemptScopeAuthority, type PreparedInstalledAttemptScopeAuthority } from "../scope/scopeAuthorityControlRead";
import { registerProtectedMetadataTransactionFinalGuard, requireProtectedControlPreparation, type ProtectedMetadataPreparation } from "./preparation/preparedMetadataEpoch";
import { defineScopedWriteOperation } from
  "../scope/execution/ScopedTransaction";
import {
  resolvePinnedDeveloperIndexIdV1Effect,
  resolvePinnedPointTableIdV1Effect,
} from "../storage/documents/pinnedPointTableResolution";
import {
  fxSystemScopeClocks,
  fxSystemScopeExecutionAuthorities,
  fxSystemIdempotency,
  fxSystemSnapshotLeases,
  fxSystemTransactionExecutionClaims,
  fxSystemTransactionJournalReceipts,
  fxSystemTransactionJournalIndexRanges,
  fxSystemTransactionJournalRelationIncomingDependencies,
  fxSystemTransactionJournalPoints,
  fxSystemTransactionJournalWriteEvents,
  fxSystemTransactionJournals,
  fxSystemTransactionSessions,
} from "../database/schema";
import {
  deriveTransactionExecutionClaimV1,
  inspectTransactionExecutionClaimV1Result,
  lockExactTransactionExecutionClaimV1Result,
  requireLiveTransactionExecutionClaimV1Result,
  TransactionExecutionClaimCorruptionV1Error,
  TransactionExecutionClaimStaleV1Error,
} from "./claims/transactionExecutionClaimPersistence";
import {
  decodeTransactionExecutionClaimFenceV1,
  TransactionExecutionClaimFenceV1Schema,
  decodeTransactionExecutionClaimOwnerV1,
  type TransactionExecutionClaimObservationV1,
  type TransactionExecutionClaimOwnerV1,
  type TransactionExecutionClaimPinV1,
} from "./claims/transactionExecutionClaimModel";
import {
  PointMutationExecutionClaimLivenessConfigurationV1Error,
  PointMutationExecutionClaimLivenessCorruptionV1Error,
  PointMutationExecutionClaimLivenessInputV1Error,
  PointMutationExecutionClaimLivenessPersistenceV1Error,
  PointMutationExecutionClaimLivenessStaleV1Error,
  PointMutationExecutionClaimLivenessUncertainV1Error,
  RENEW_POINT_MUTATION_EXECUTION_CLAIM_EFFECT_V1,
  projectExecutionClaimRenewalV1Result,
  type LocatedPointMutationExecutionClaimLivenessInputV1,
  type LocatedPointMutationExecutionClaimLivenessTargetV1,
  type PointMutationExecutionClaimLivenessResultV1,
  type PointMutationExecutionClaimLivenessV1Error,
  type ProjectExecutionClaimRenewalIssueV1,
} from "./claims/transactionExecutionClaimLiveness";
import {
  claimApplicationExecutableActiveSelection,
  validateApplicationExecutableActiveSelectionInTransaction,
  ApplicationActivationError,
  type ApplicationActiveSelection,
  type CurrentApplicationFiniteEntry,
} from "../application/applicationActivation";
import {
  readPreparedFiniteApplicationMutationActivationInputs,
  type ApplicationMutationActivationBasis,
  withPreparedFiniteApplicationMutationAdmissionInTransaction,
  type PreparedFiniteApplicationMutationAdmissionAcceptanceError,
  type PreparedFiniteApplicationMutationAdmission,
  type ApplicationMutationAdmissionContext,
  type ApplicationMutationAdmissionError,
  type ApplicationMutationAdmission,
} from "../application/applicationMutationAdmission";
import {
  abandonPreparedFiniteSessionJournalEntry,
  prepareFiniteSessionJournalEntryControlEffect,
  runPreparedFiniteSessionJournalEntryEffect,
  acceptPreparedFiniteSessionJournalEntryForContinuationEffect,
  confirmPreparedFiniteSessionJournalEntry,
  type PreparedFiniteSessionJournalEntry,
  type ConfirmedFiniteRootEntryCapture,
} from "./sessionJournalFiniteEntry";
import {
  buildFreshTransactionAttemptFacetV1,
  isPristineFreshTransactionAttemptJournalRootV1,
  isTerminalTransactionSessionLifecycleV1,
} from "./transactionSessionAttemptFacet";
import {
  DISCOVER_LOCATED_POINT_MUTATION_ATTEMPTS_V1,
  discoverLocatedPointMutationAttemptsEffectV1,
  type LocatedPointMutationAttemptDiscoveryTargetV1,
} from "./recovery/pointMutationAttemptDiscovery";
import {
  RESOLVE_PINNED_DEVELOPER_INDEX_ID_EFFECT_V1,
  RESOLVE_PINNED_POINT_TABLE_ID_EFFECT_V1,
  RESOLVE_LOCATED_COMMITTED_POINT_OUTCOME_V1,
  ExactRunningAttemptTransactionV1Error,
  LOCATED_READ_COMMITTED_RUNNER_V1,
  LocatedReadCommittedTransactionFailureV1,
  RUN_EXACT_RUNNING_POINT_MUTATION_ATTEMPT_EFFECT_V1,
  RUN_LOCATED_READ_COMMITTED_V1,
  RUN_LOCATED_REPEATABLE_READ_V1,
  registerLocatedReadCommittedTargetDatabaseV1,
  type ExactRunningAttemptKernelContextV1,
  type ExactRunningAttemptEffectWorkV1,
  type ExactRunningAttemptKernelInputV1,
  type LocatedExactRunningAttemptKernelV1,
  type LocatedReadCommittedAttemptTargetV1,
  type LocatedPointCommitPublicationTargetV1,
  type RunLocatedReadCommittedTransactionV1,
} from "./transactionSessionAttemptKernel";
import {
  RUN_EXACT_RUNNING_POINT_MUTATION_READ_SYSCALL_EFFECT_V1,
  type LocatedExactRunningAttemptReadSyscallKernelV1,
} from "./transactionSessionReadSyscallKernel";

const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const INITIAL_ATTEMPT_FENCE = TransactionAttemptFenceSchema.make(1n);

export type PointMutationExecutionProfile =
  | "durableOperations"
  | "finiteRoot";

const ACTIVATE_PREPARED_POINT_MUTATION_SESSION_EFFECT_V1 = Symbol(
  "flarex.persistence-postgres.activatePreparedPointMutationSessionEffectV1",
);
const ACTIVATE_APPLICATION_MUTATION_SESSION_EFFECT_V1 = Symbol(
  "flarex.persistence-postgres.activateApplicationMutationSessionEffectV1",
);
const ACTIVATE_FINITE_APPLICATION_MUTATION_SESSION_EFFECT = Symbol(
  "flarex.persistence-postgres.activateFiniteApplicationMutationSession",
);
const LOAD_EXACT_POINT_MUTATION_SESSION_ATTEMPT_EFFECT_V1 = Symbol(
  "flarex.persistence-postgres.loadExactPointMutationSessionAttemptEffectV1",
);
const TERMINALIZE_EXACT_POINT_MUTATION_SESSION_ATTEMPT_EFFECT_V1 = Symbol(
  "flarex.persistence-postgres.terminalizeExactPointMutationSessionAttemptEffectV1",
);
const ACQUIRE_POINT_MUTATION_EXECUTION_CLAIM_EFFECT_V1 = Symbol(
  "flarex.persistence-postgres.acquirePointMutationExecutionClaimEffectV1",
);

const decodeAttemptDeploymentIdResult = Schema.decodeUnknownResult(
  Schema.toType(TransactionGrantDeploymentIdV1Schema),
);
const decodeAttemptScopeIdResult = Schema.decodeUnknownResult(
  Schema.toType(ReplacementScopeIdV1Schema),
);
const decodeAttemptSessionIdResult = Schema.decodeUnknownResult(
  Schema.toType(TransactionSessionIdV1Schema),
);
const decodeAttemptFenceResult = Schema.decodeUnknownResult(
  Schema.toType(TransactionAttemptFenceSchema),
);
const decodeAttemptSnapshotTokenResult = Schema.decodeUnknownResult(
  Schema.toType(SnapshotTokenSchema),
);

export interface PointMutationSessionAuthorityResolutionPortsV1 {
  readonly scopeMetadata: ExactScopeMetadataReader & ScopeMetadataReader;
  readonly provisioningReceipts: ScopeProvisioningReceiptReader;
  readonly scopeSessionTargets: ScopeClockTargetReaderResolver;
}

export type PointMutationSessionActivationResolutionPortsV1 =
  PointMutationSessionAuthorityResolutionPortsV1;

export interface PointMutationSessionActivationPersistenceOptionsV1 {
  readonly leaseDurationMilliseconds: number;
  readonly randomUuid?: () => string;
  readonly executionClaimDurationMilliseconds?: number;
  readonly randomExecutionClaimOwner?: () => string;
}

type TransactionSessionInsert =
  typeof fxSystemTransactionSessions.$inferInsert;
type TransactionSessionRow =
  typeof fxSystemTransactionSessions.$inferSelect;
const checkedTransactionSessionSelection = {
  executionProfile: fxSystemTransactionSessions.executionProfile,
  executionAuthorityGeneration: fxSystemTransactionSessions.executionAuthorityGeneration,
  functionPath: fxSystemTransactionSessions.functionPath,
  functionKind: fxSystemTransactionSessions.functionKind,
  executionModule: sql`coalesce(${fxSystemTransactionSessions.executionModule}, ${fxSystemTransactionSessions.applicationExecutionAuthorityJson} #>> '{runtimeTarget,executionModulePath}')`.mapWith(fxSystemTransactionSessions.executionModule).as("execution_module"),
  sessionId: fxSystemTransactionSessions.sessionId,
  attemptFence: fxSystemTransactionSessions.attemptFence,
  storageGeneration: fxSystemTransactionSessions.storageGeneration,
  storageGenerationFence: fxSystemTransactionSessions.storageGenerationFence,
  authorizationRevocationEpoch:
    fxSystemTransactionSessions.authorizationRevocationEpoch,
  authorizationGrantExpiresAt:
    fxSystemTransactionSessions.authorizationGrantExpiresAt,
  hardExpiresAt: fxSystemTransactionSessions.hardExpiresAt,
  createdAt: fxSystemTransactionSessions.createdAt,
  updatedAt: fxSystemTransactionSessions.updatedAt,
  protocolVersion: fxSystemTransactionSessions.protocolVersion,
  lifecycle: fxSystemTransactionSessions.lifecycle,
  schemaVersionId: fxSystemTransactionSessions.schemaVersionId,
  identityAccessPolicySha256: fxSystemTransactionSessions.identityAccessPolicySha256,
  requestKey: fxSystemTransactionSessions.requestKey,
};
type CheckedTransactionSessionRow = Pick<
  TransactionSessionRow,
  keyof typeof checkedTransactionSessionSelection
>;
type SnapshotLeaseRow = typeof fxSystemSnapshotLeases.$inferSelect;

export type PreparedPointMutationSessionEvidenceV1 = Readonly<
  Omit<Pick<
    TransactionSessionInsert,
    | "packageId"
    | "artifactRuntime"
    | "artifactId"
    | "sourcePackageHash"
    | "executionModule"
    | "functionPath"
    | "functionKind"
    | "schemaVersionId"
    | "policyVersion"
    | "identityAccessPolicySha256"
    | "validatedArgsJson"
    | "validatedArgsValueCodecVersion"
    | "validatedArgsCanonicalBytes"
    | "validatedArgsSha256"
    | "authorizationGrantId"
    | "authorizationGrantJson"
    | "authorizationGrantValueCodecVersion"
    | "authorizationGrantCanonicalBytes"
    | "authorizationGrantSha256"
    | "authorizationRevocationEpoch"
    | "authorizationGrantExpiresAt"
    | "requestKey"
    | "requestSha256"
  >, "packageId" | "artifactRuntime" | "artifactId" |
    "sourcePackageHash" | "executionModule" | "validatedArgsJson" |
    "validatedArgsCanonicalBytes" | "authorizationGrantJson" |
    "authorizationGrantCanonicalBytes"> & {
      readonly validatedArgsJson: NonNullable<TransactionSessionInsert["validatedArgsJson"]>;
      readonly validatedArgsCanonicalBytes:
        NonNullable<TransactionSessionInsert["validatedArgsCanonicalBytes"]>;
      readonly authorizationGrantJson: NonNullable<TransactionSessionInsert["authorizationGrantJson"]>;
      readonly authorizationGrantCanonicalBytes:
        NonNullable<TransactionSessionInsert["authorizationGrantCanonicalBytes"]>;
      readonly packageId: NonNullable<TransactionSessionInsert["packageId"]>;
      readonly artifactRuntime:
        NonNullable<TransactionSessionInsert["artifactRuntime"]>;
      readonly artifactId: NonNullable<TransactionSessionInsert["artifactId"]>;
      readonly sourcePackageHash:
        NonNullable<TransactionSessionInsert["sourcePackageHash"]>;
      readonly executionModule:
        NonNullable<TransactionSessionInsert["executionModule"]>;
    }
>;

type PreparedMutationSessionCommonEvidenceV1 = Omit<
  PreparedPointMutationSessionEvidenceV1,
  "packageId" | "artifactRuntime" | "artifactId" |
    "sourcePackageHash" | "executionModule"
>;

type PreparedStoredMutationSessionEvidenceV1 =
  PreparedMutationSessionCommonEvidenceV1 & (
    | Readonly<{
        readonly executionAuthorityGeneration:
          "legacy_dynamic_worker_v1";
        readonly applicationExecutionAuthorityJson: null;
        readonly applicationExecutionAuthorityCanonicalBytes: null;
        readonly applicationExecutionAuthoritySha256: null;
        readonly packageId:
          PreparedPointMutationSessionEvidenceV1["packageId"];
        readonly artifactRuntime:
          PreparedPointMutationSessionEvidenceV1["artifactRuntime"];
        readonly artifactId:
          PreparedPointMutationSessionEvidenceV1["artifactId"];
        readonly sourcePackageHash:
          PreparedPointMutationSessionEvidenceV1["sourcePackageHash"];
        readonly executionModule:
          PreparedPointMutationSessionEvidenceV1["executionModule"];
      }>
    | Readonly<{
        readonly executionAuthorityGeneration: "application_v1";
        readonly applicationExecutionAuthorityJson:
          NonNullable<TransactionSessionInsert[
            "applicationExecutionAuthorityJson"
          ]>;
        readonly applicationExecutionAuthorityCanonicalBytes: Uint8Array;
        readonly applicationExecutionAuthoritySha256: Uint8Array;
        readonly packageId: null;
        readonly artifactRuntime: null;
        readonly artifactId: null;
        readonly sourcePackageHash: null;
        readonly executionModule: null;
      }>
  );

interface PreparedStoredMutationSessionActivationV1 {
  readonly deploymentId: TransactionGrantDeploymentIdV1;
  readonly scopeId: ReplacementScopeIdV1;
  readonly executionProfile: PointMutationExecutionProfile;
  readonly evidence: PreparedStoredMutationSessionEvidenceV1;
}

export interface PreparedPointMutationSessionActivationV1 {
  readonly deploymentId: TransactionGrantDeploymentIdV1;
  readonly scopeId: ReplacementScopeIdV1;
  readonly executionProfile?: PointMutationExecutionProfile;
  readonly evidence: PreparedPointMutationSessionEvidenceV1;
}

export interface PointMutationSessionAttemptSelectorV1 {
  readonly deploymentId: TransactionGrantDeploymentIdV1;
  readonly scopeId: ReplacementScopeIdV1;
  readonly sessionId: TransactionSessionIdV1;
  readonly attemptFence: TransactionAttemptFence;
}

export interface PointMutationSessionAnchorV1 {
  readonly deploymentId: TransactionGrantDeploymentIdV1;
  readonly scopeId: ReplacementScopeIdV1;
  readonly sessionId: TransactionSessionIdV1;
  readonly requestKey: TransactionRequestKeyV1;
  readonly executionProfile: PointMutationExecutionProfile;
  readonly storageGeneration: FlarexDbV1StorageGeneration;
  readonly storageGenerationFence: StorageGenerationFence;
  readonly attemptFence: TransactionAttemptFence;
  readonly snapshotToken: SnapshotToken;
  readonly hardExpiresAt: string;
  readonly leaseExpiresAt: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export type PointMutationSessionActivationResultV1 =
  | {
      readonly status: "created";
      readonly anchor: PointMutationSessionAnchorV1;
      readonly executionClaim: TransactionExecutionClaimObservationV1;
    }
  | {
      readonly status: "busy";
      readonly anchor: PointMutationSessionAnchorV1;
    };

export type PointMutationExecutionClaimAcquisitionModeV1 =
  | "execute"
  | "finishOnly"
  | "replaceRelationConflict"
  | "abortOnly";

export type PointMutationExecutionClaimAbortReasonV1 =
  | "dirtyOpen"
  | "failedRoot";

export type PointMutationExecutionClaimAcquisitionResultV1 =
  | Readonly<{
      readonly kind: "replayed";
      readonly outcome: Exclude<
        CommittedPointOutcomeResolutionV1,
        Readonly<{ readonly kind: "missing" }>
      >;
    }>
  | Readonly<{
      readonly kind: "busy";
      readonly observation: TransactionExecutionClaimObservationV1;
    }>
  | Readonly<{ readonly kind: "finiteRecovery"; readonly capture: FiniteRecoveryAttempt }>
  | Readonly<{
      /** Inert routing evidence; C05-B must independently authenticate it. */
      readonly kind: "finishing";
    }>
  | Readonly<{
      readonly kind: "acquired";
      readonly mode: Exclude<
        PointMutationExecutionClaimAcquisitionModeV1,
        "abortOnly"
      >;
      readonly observation: TransactionExecutionClaimObservationV1;
    }>
  | Readonly<{
      readonly kind: "acquired";
      readonly mode: "abortOnly";
      readonly reason: PointMutationExecutionClaimAbortReasonV1;
      readonly observation: TransactionExecutionClaimObservationV1;
    }>;

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

export interface PointMutationExecutionClaimAcquisitionV1 {
  readonly acquireEffect: (
    input: PointMutationSessionAttemptSelectorV1,
  ) => Effect.Effect<
    PointMutationExecutionClaimAcquisitionResultV1,
    PointMutationExecutionClaimAcquisitionV1Error
  >;
}

export interface PointMutationExecutionClaimAcquisitionOptionsV1 {
  readonly durationMilliseconds: number;
  readonly randomOwner?: () => string;
}

export interface PointMutationSessionAttemptLoadResultV1 {
  readonly status: "loaded";
  readonly lastMetadataSequence: ScopeClockRecord["lastMetadataSequence"];
  readonly anchor: PointMutationSessionAnchorV1;
  readonly executionPin: PointMutationSessionAttemptExecutionPinV1;
  /** Temporal, non-authorizing evidence captured under the exact root lock. */
  readonly attemptFacet: PointMutationSessionAttemptFacetObservationV1;
}

export interface PointMutationSessionAttemptFacetObservationV1 {
  readonly kind: "pristineOpen" | "nonPristine";
}

/** Private execution input reloaded from the authoritative exact attempt. */
export interface PointMutationSessionAttemptExecutionPinV1 {
  readonly schemaVersionId: CatalogSchemaVersionId;
  readonly functionPath: TransactionSessionRow["functionPath"];
  readonly functionKind: TransactionSessionRow["functionKind"];
  readonly executionModule: TransactionSessionRow["executionModule"];
}

export type PointMutationSessionActiveLifecycleV1 = Extract<
  TransactionSessionLifecycleV1,
  "running" | "finishing"
>;

export type PointMutationSessionTerminalLifecycleV1 = Extract<
  TransactionSessionLifecycleV1,
  "committed" | "aborted" | "expired"
>;

export type PointMutationSessionTerminalizedLifecycleV1 = Extract<
  PointMutationSessionTerminalLifecycleV1,
  "aborted" | "expired"
>;

export interface PointMutationSessionTerminalObservationV1<
  Lifecycle extends PointMutationSessionTerminalLifecycleV1 =
    PointMutationSessionTerminalLifecycleV1,
> extends PointMutationSessionAttemptSelectorV1 {
  readonly lifecycle: Lifecycle;
  readonly terminalizedAt: string;
}

export type PointMutationSessionAttemptTerminalizationResultV1 =
  | {
      readonly status: "terminalized";
      readonly terminal: PointMutationSessionTerminalObservationV1<
        PointMutationSessionTerminalizedLifecycleV1
      >;
    }
  | {
      readonly status: "observed";
      readonly terminal: PointMutationSessionTerminalObservationV1;
    };

export interface PointMutationSessionAttemptAbortInputV1 {
  readonly selector: PointMutationSessionAttemptSelectorV1;
  readonly expectedSnapshotToken: SnapshotToken;
  readonly executionClaim: TransactionExecutionClaimPinV1;
}

export interface PointMutationSessionActivationPersistenceV1 {
  readonly activateEffect: (
    input: PreparedPointMutationSessionActivationV1,
  ) => Effect.Effect<
    PointMutationSessionActivationResultV1,
    PointMutationSessionActivationEffectErrorV1
  >;
}

type ApplicationGrantStorageFieldV1 =
  | "authorizationGrantId"
  | "authorizationGrantJson"
  | "authorizationGrantValueCodecVersion"
  | "authorizationGrantCanonicalBytes"
  | "authorizationGrantSha256"
  | "authorizationRevocationEpoch"
  | "authorizationGrantExpiresAt";

export type PreparedApplicationMutationSessionEvidenceV1 = Readonly<
  Omit<PreparedMutationSessionCommonEvidenceV1,
    ApplicationGrantStorageFieldV1> & {
      readonly executionAuthority: unknown;
      readonly verifiedGrant: VerifiedApplicationMutationGrantV1;
    }
>;

export interface PreparedApplicationMutationSessionActivationV1 {
  readonly deploymentId: TransactionGrantDeploymentIdV1;
  readonly scopeId: ReplacementScopeIdV1;
  readonly executionProfile?: "durableOperations";
  readonly activeSelection: ApplicationActiveSelection;
  readonly evidence: PreparedApplicationMutationSessionEvidenceV1;
}

export interface ApplicationMutationSessionActivationPersistenceV1 {
  readonly activateFiniteEffect: (
    input: PreparedFiniteApplicationMutationSessionActivation,
    entry: PreparedFiniteSessionJournalEntry,
  ) => Effect.Effect<FiniteApplicationMutationSessionActivationResult,
    FiniteApplicationMutationSessionActivationError>;
  readonly activateEffect: (
    input: PreparedApplicationMutationSessionActivationV1,
  ) => Effect.Effect<
    PointMutationSessionActivationResultV1,
    | PointMutationSessionActivationEffectErrorV1
    | ApplicationActivationError
    | ApplicationMutationExecutionAuthorityV1Error
  >;
}

export interface PreparedFiniteApplicationMutationSessionActivation {
  readonly deploymentId: TransactionGrantDeploymentIdV1;
  readonly scopeId: ReplacementScopeIdV1;
  readonly preparedAdmission: PreparedFiniteApplicationMutationAdmission;
  readonly admissionContext: ApplicationMutationAdmissionContext;
  readonly evidence: PreparedApplicationMutationSessionEvidenceV1;
  readonly currentEntry?: CurrentApplicationFiniteEntry;
}

export type FiniteApplicationMutationSessionActivationResult = Readonly<{
  activation: PointMutationSessionActivationResultV1;
  entry?: ConfirmedFiniteRootEntryCapture;
}>;
export type FiniteApplicationMutationSessionActivationError =
  | PointMutationSessionActivationEffectErrorV1
  | ApplicationActivationError
  | ApplicationMutationAdmissionError
  | ApplicationMutationExecutionAuthorityV1Error
  | PreparedFiniteApplicationMutationAdmissionAcceptanceError
  | Effect.Error<ReturnType<SessionJournalStorePersistence["prepareFiniteEntryEffect"]>>
  | Effect.Error<ReturnType<typeof runPreparedFiniteSessionJournalEntryEffect>>;

export interface PointMutationSessionAttemptLoadPersistenceV1 {
  readonly loadEffect: (
    selector: PointMutationSessionAttemptSelectorV1,
  ) => Effect.Effect<
    PointMutationSessionAttemptLoadResultV1,
    PointMutationSessionAttemptLoadEffectErrorV1
  >;
}

export interface PointMutationSessionAttemptTerminalizationPersistenceV1 {
  readonly abortEffect: (
    input: PointMutationSessionAttemptAbortInputV1,
  ) => Effect.Effect<
    PointMutationSessionAttemptTerminalizationResultV1,
    PointMutationSessionAttemptTerminalizationEffectErrorV1
  >;
  readonly expireEffect: (
    selector: PointMutationSessionAttemptSelectorV1,
  ) => Effect.Effect<
    PointMutationSessionAttemptTerminalizationResultV1,
    PointMutationSessionAttemptTerminalizationEffectErrorV1
  >;
}

export type PointMutationSessionActivationConfigurationIssueV1 =
  | { readonly reason: "invalidLeaseDuration" }
  | { readonly reason: "invalidExecutionClaimDuration" }
  | { readonly reason: "invalidGeneratedSessionId"; readonly value: string }
  | { readonly reason: "sessionIdGenerationFailed"; readonly cause: unknown }
  | { readonly reason: "invalidGeneratedExecutionClaimOwner"; readonly value: string }
  | {
      readonly reason: "executionClaimOwnerGenerationFailed";
      readonly cause: unknown;
    };

export class PointMutationSessionActivationConfigurationV1Error extends Error {
  readonly _tag = "PointMutationSessionActivationConfigurationV1Error";
  readonly name = "PointMutationSessionActivationConfigurationV1Error";

  constructor(
    readonly issue: PointMutationSessionActivationConfigurationIssueV1,
  ) {
    super(`Point-mutation session activation configuration failed: ${issue.reason}.`);
  }
}

export type PointMutationSessionActivationIssueV1 =
  | { readonly reason: "scopeMismatch" }
  | { readonly reason: "unsupportedStorageGeneration" }
  | { readonly reason: "storageGenerationChanged" }
  | { readonly reason: "storageGenerationFenceChanged" }
  | { readonly reason: "scopeEpochChanged" }
  | { readonly reason: "snapshotCommitSeqChanged" }
  | { readonly reason: "authorizationRevocationEpochChanged" }
  | { readonly reason: "invalidPreparedEvidence" }
  | { readonly reason: "authorizationGrantExpired" }
  | { readonly reason: "requestKeyConflict" }
  | {
      readonly reason: "terminalRequest";
      readonly lifecycle: Exclude<TransactionSessionLifecycleV1, "running">;
    }
  | { readonly reason: "activeAttemptExpired" }
  | { readonly reason: "executionClaimUnavailable" }
  | { readonly reason: "sessionIdCollision" };

export class PointMutationSessionActivationV1Error extends Error {
  readonly _tag = "PointMutationSessionActivationV1Error";
  readonly name = "PointMutationSessionActivationV1Error";

  constructor(readonly issue: PointMutationSessionActivationIssueV1) {
    super(`Point-mutation session activation failed: ${issue.reason}.`);
  }
}

export type PointMutationSessionAttemptLoadIssueV1 =
  | { readonly reason: "invalidSelector"; readonly cause: unknown }
  | { readonly reason: "selectorScopeMismatch" }
  | { readonly reason: "sessionMissing" }
  | { readonly reason: "staleAttemptFence" }
  | {
      readonly reason: "attemptNotRunning";
      readonly lifecycle: Exclude<TransactionSessionLifecycleV1, "running">;
    }
  | { readonly reason: "unsupportedStorageGeneration" }
  | { readonly reason: "storageGenerationChanged" }
  | { readonly reason: "storageGenerationFenceChanged" }
  | { readonly reason: "scopeEpochChanged" }
  | { readonly reason: "authorizationRevocationEpochChanged" }
  | { readonly reason: "activeAttemptExpired" }
  | { readonly reason: "executionClaimUnavailable" };

export class PointMutationSessionAttemptLoadV1Error extends Error {
  readonly _tag = "PointMutationSessionAttemptLoadV1Error";
  readonly name = "PointMutationSessionAttemptLoadV1Error";

  constructor(readonly issue: PointMutationSessionAttemptLoadIssueV1) {
    super(`Point-mutation session attempt load failed: ${issue.reason}.`);
  }
}

export type PointMutationSessionAttemptTerminalizationIssueV1 =
  | { readonly reason: "invalidSelector"; readonly cause: unknown }
  | { readonly reason: "invalidAbortSnapshot"; readonly cause: unknown }
  | { readonly reason: "invalidAbortExecutionClaim"; readonly cause: unknown }
  | { readonly reason: "selectorScopeMismatch" }
  | { readonly reason: "sessionMissing" }
  | { readonly reason: "staleAttemptFence" }
  | {
      readonly reason: "attemptNotTerminalizable";
      readonly lifecycle: Exclude<
        TransactionSessionLifecycleV1,
        "running" |
          PointMutationSessionTerminalLifecycleV1
      >;
    }
  | { readonly reason: "unsupportedStorageGeneration" }
  | { readonly reason: "storageGenerationChanged" }
  | { readonly reason: "storageGenerationFenceChanged" }
  | { readonly reason: "scopeEpochChanged" }
  | { readonly reason: "authorizationRevocationEpochChanged" }
  | {
      readonly reason: "attemptStillLive";
      readonly effectiveExpiresAt: string;
    }
  | { readonly reason: "executionClaimUnavailable" };

export class PointMutationSessionAttemptTerminalizationV1Error extends Error {
  readonly _tag = "PointMutationSessionAttemptTerminalizationV1Error";
  readonly name = "PointMutationSessionAttemptTerminalizationV1Error";

  constructor(
    readonly issue: PointMutationSessionAttemptTerminalizationIssueV1,
  ) {
    super(`Point-mutation attempt terminalization failed: ${issue.reason}.`);
  }
}

export type PointMutationSessionAuthorityCorruptionIssueV1 =
  | "scopeClockNativeProjectionInvalid"
  | "databaseClockInvalid"
  | "duplicateRequestAnchors"
  | "sessionRecordInvalid"
  | "snapshotLeaseMissing"
  | "snapshotLeaseInvalid"
  | "snapshotAheadOfScopeClock"
  | "terminalSnapshotLeasePresent"
  | "activeJournalRootMissing"
  | "journalRootInvalid"
  | "terminalJournalRootPresent"
  | "attemptSnapshotChanged"
  | "executionClaimInvalid"
  | "terminalizationWriteMismatch";

export class PointMutationSessionAuthorityCorruptionV1Error extends Error {
  readonly _tag = "PointMutationSessionAuthorityCorruptionV1Error";
  readonly name = "PointMutationSessionAuthorityCorruptionV1Error";

  constructor(
    readonly scopeId: ScopeId,
    readonly issue: PointMutationSessionAuthorityCorruptionIssueV1,
    options?: ErrorOptions,
  ) {
    super(`Point-mutation session authority is corrupt for ${scopeId}: ${issue}.`, options);
  }
}

export class PointMutationSessionActivationTargetV1Error extends Error {
  readonly _tag = "PointMutationSessionActivationTargetV1Error";
  readonly name = "PointMutationSessionActivationTargetV1Error";

  constructor(readonly scopeId: ScopeId) {
    super(`Located scope target cannot activate point-mutation sessions: ${scopeId}.`);
  }
}

export class PointMutationSessionAttemptLoadTargetV1Error extends Error {
  readonly _tag = "PointMutationSessionAttemptLoadTargetV1Error";
  readonly name = "PointMutationSessionAttemptLoadTargetV1Error";

  constructor(readonly scopeId: ScopeId) {
    super(`Located scope target cannot load point-mutation attempts: ${scopeId}.`);
  }
}

export class PointMutationSessionAttemptTerminalizationTargetV1Error
  extends Error {
  readonly _tag = "PointMutationSessionAttemptTerminalizationTargetV1Error";
  readonly name = "PointMutationSessionAttemptTerminalizationTargetV1Error";

  constructor(readonly scopeId: ScopeId) {
    super(
      `Located scope target cannot terminalize point-mutation attempts: ${scopeId}.`,
    );
  }
}

export type PointMutationSessionActivationPersistenceOperationV1 =
  | TrustedScopeAuthorityPortOperation
  | "activationTransaction";

export class PointMutationSessionActivationPersistenceV1Error
  extends Data.TaggedError("PointMutationSessionActivationPersistenceV1Error")<{
    readonly operation: PointMutationSessionActivationPersistenceOperationV1;
    readonly cause: unknown;
  }> {}

export type PointMutationSessionActivationEffectErrorV1 =
  | TrustedScopeAuthorityResolutionError
  | PointMutationSessionActivationConfigurationV1Error
  | PointMutationSessionActivationV1Error
  | PointMutationSessionAuthorityCorruptionV1Error
  | PointMutationSessionActivationTargetV1Error
  | PointMutationSessionActivationPersistenceV1Error;

export type PointMutationSessionAttemptLoadPersistenceOperationV1 =
  | TrustedScopeAuthorityPortOperation
  | "attemptLoadTransaction";

export class PointMutationSessionAttemptLoadPersistenceV1Error
  extends Data.TaggedError("PointMutationSessionAttemptLoadPersistenceV1Error")<{
    readonly operation: PointMutationSessionAttemptLoadPersistenceOperationV1;
    readonly cause: unknown;
  }> {}

export type PointMutationSessionAttemptLoadEffectErrorV1 =
  | TrustedScopeAuthorityResolutionError
  | PointMutationSessionAttemptLoadV1Error
  | PointMutationSessionAuthorityCorruptionV1Error
  | PointMutationSessionAttemptLoadTargetV1Error
  | PointMutationSessionAttemptLoadPersistenceV1Error;

export type PointMutationSessionAttemptTerminalizationPersistenceOperationV1 =
  | TrustedScopeAuthorityPortOperation
  | "attemptAbortTransaction"
  | "attemptExpireTransaction";

export class PointMutationSessionAttemptTerminalizationPersistenceV1Error
  extends Data.TaggedError(
    "PointMutationSessionAttemptTerminalizationPersistenceV1Error",
  )<{
    readonly operation:
      PointMutationSessionAttemptTerminalizationPersistenceOperationV1;
    readonly cause: unknown;
  }> {}

export type PointMutationSessionAttemptTerminalizationEffectErrorV1 =
  | TrustedScopeAuthorityResolutionError
  | PointMutationSessionAttemptTerminalizationV1Error
  | PointMutationSessionAuthorityCorruptionV1Error
  | PointMutationSessionAttemptTerminalizationTargetV1Error
  | PointMutationSessionAttemptTerminalizationPersistenceV1Error;

export type PointMutationSessionActivationWriteStepV1 =
  | "sessionInserted"
  | "leaseInserted"
  | "journalRootInserted"
  | "executionClaimInserted";

export type PointMutationSessionAttemptLoadLockStepV1 =
  | "clockLocked"
  | "sessionLocked"
  | "leaseLocked"
  | "attemptTailLocked"
  | "journalRootLocked"
  | "executionClaimLocked";

export type PointMutationSessionAttemptTerminalizationOperationV1 =
  | "abort"
  | "expire";

export type PointMutationSessionAttemptTerminalizationEventV1 =
  | {
      readonly phase: "lock";
      readonly operation: PointMutationSessionAttemptTerminalizationOperationV1;
      readonly step: PointMutationSessionAttemptLoadLockStepV1;
    }
  | {
      readonly phase: "write";
      readonly operation: PointMutationSessionAttemptTerminalizationOperationV1;
      readonly step:
        | "journalDeleted"
        | "leaseDeleted"
        | "sessionTerminalized";
    };

/** Installed captures borrow only the construction-owned implicit-read driver. */
export const FINITE_STORAGE_CAPTURE_DRIVER: unique symbol = Symbol("FlarexDB/finiteStorageCaptureDriver");
export const FINITE_STORAGE_CAPTURE_AUTHORITY: unique symbol = Symbol("FlarexDB/finiteStorageCaptureAuthority");

export interface LocatedPointMutationSessionActivationTargetOptionsV1 {
  readonly directInstallation?: PreparedInstallation;
  readonly [FINITE_STORAGE_CAPTURE_DRIVER]?: Extract<FiniteStorageCaptureProfile, { kind: "installed" }>["driver"];
  readonly [FINITE_STORAGE_CAPTURE_AUTHORITY]?: Extract<FiniteStorageCaptureProfile, { kind: "fullArtifact" }>["authority"];
  readonly managedInstallation?: Readonly<{ installation: PreparedCoLocatedReadInstallation;
    controlProtection: ProtectedMetadataPreparation }>;
  /** Internal connected-client runner; its symbol is not package-exported. */
  readonly [LOCATED_READ_COMMITTED_RUNNER_V1]?:
    RunLocatedReadCommittedTransactionV1;
  /** Construction-bound instrumentation used by focused rollback proofs. */
  readonly afterWrite?: (
    step: PointMutationSessionActivationWriteStepV1,
  ) => void | Promise<void>;
  /** Construction-bound instrumentation used by focused lock-order proofs. */
  readonly afterLoadLock?: (
    step: PointMutationSessionAttemptLoadLockStepV1,
  ) => void | Promise<void>;
  /** Construction-bound instrumentation used by focused B2b1 proofs. */
  readonly afterTerminalizationEvent?: (
    event: PointMutationSessionAttemptTerminalizationEventV1,
  ) => void | Promise<void>;
  /** Construction-bound instrumentation used by focused b1a proofs. */
  readonly afterExecutionClaimLivenessEvent?: (
    event: PointMutationExecutionClaimLivenessEventV1,
  ) => void | Promise<void>;
}

export type PointMutationExecutionClaimLivenessEventV1 =
  | Readonly<{
      readonly phase: "lock";
      readonly step:
        | "clockLocked"
        | "sessionLocked"
        | "leaseLocked"
        | "journalRootLocked"
        | "executionClaimLocked";
    }>
  | Readonly<{
      readonly phase: "write";
      readonly step: "leaseRenewed" | "executionClaimRenewed";
    }>;

interface LocatedPointMutationSessionActivationTargetV1
  extends LocatedScopeClockReader {
  readonly [INSTALLED_SCOPE_AUTHORITY_TARGET]?: true;
  readonly [ACTIVATE_PREPARED_POINT_MUTATION_SESSION_EFFECT_V1]: (
    input: LocatedPointMutationSessionActivationInputV1,
  ) => Effect.Effect<
    PointMutationSessionActivationResultV1,
    | PointMutationSessionActivationV1Error
    | PointMutationSessionAuthorityCorruptionV1Error
    | PointMutationSessionActivationPersistenceV1Error
  >;
  readonly [ACTIVATE_APPLICATION_MUTATION_SESSION_EFFECT_V1]: (
    input: LocatedPointMutationSessionActivationInputV1,
    selection: ApplicationActiveSelection,
  ) => Effect.Effect<
    PointMutationSessionActivationResultV1,
    | PointMutationSessionActivationV1Error
    | PointMutationSessionAuthorityCorruptionV1Error
    | PointMutationSessionActivationPersistenceV1Error
    | ApplicationActivationError
  >;
  readonly [ACTIVATE_FINITE_APPLICATION_MUTATION_SESSION_EFFECT]: (
    input: LocatedPointMutationSessionActivationInputV1,
    prepared: PreparedFiniteApplicationMutationSessionActivation,
    entry: PreparedFiniteSessionJournalEntry,
  ) => Effect.Effect<Readonly<{
    activation: PointMutationSessionActivationResultV1;
    capture?: Effect.Success<ReturnType<typeof runPreparedFiniteSessionJournalEntryEffect>>;
  }>, FiniteApplicationMutationSessionActivationError>;
}

interface LocatedPointMutationSessionAttemptLoadTargetV1
  extends LocatedScopeClockReader {
  readonly [LOAD_EXACT_POINT_MUTATION_SESSION_ATTEMPT_EFFECT_V1]: (
    input: LocatedPointMutationSessionAttemptLoadInputV1,
  ) => Effect.Effect<
    PointMutationSessionAttemptLoadResultV1,
    | PointMutationSessionAttemptLoadV1Error
    | PointMutationSessionAuthorityCorruptionV1Error
    | PointMutationSessionAttemptLoadPersistenceV1Error
  >;
}

interface LocatedPointMutationSessionAttemptTerminalizationTargetV1
  extends LocatedScopeClockReader {
  readonly [TERMINALIZE_EXACT_POINT_MUTATION_SESSION_ATTEMPT_EFFECT_V1]: (
    input: LocatedPointMutationSessionAttemptTerminalizationInputV1,
  ) => Effect.Effect<
    PointMutationSessionAttemptTerminalizationResultV1,
    | PointMutationSessionAttemptTerminalizationV1Error
    | PointMutationSessionAuthorityCorruptionV1Error
    | PointMutationSessionAttemptTerminalizationPersistenceV1Error
  >;
}

interface LocatedPointMutationExecutionClaimAcquisitionTargetV1
  extends LocatedScopeClockReader {
  readonly [ACQUIRE_POINT_MUTATION_EXECUTION_CLAIM_EFFECT_V1]: (
    input: Readonly<{
      readonly selector: PointMutationSessionAttemptSelectorV1;
      readonly preliminaryAuthority: TrustedScopeAuthority;
      readonly durationMilliseconds: number;
      readonly randomOwner: () => string;
    }>,
  ) => Effect.Effect<
    PointMutationExecutionClaimAcquisitionResultV1,
    PointMutationExecutionClaimAcquisitionV1Error
  >;
}

interface LocatedPointMutationSessionTargetV1
  extends LocatedPointMutationSessionActivationTargetV1,
    LocatedPointMutationSessionAttemptLoadTargetV1,
    LocatedPointMutationSessionAttemptTerminalizationTargetV1,
    LocatedPointMutationExecutionClaimAcquisitionTargetV1,
    LocatedPointMutationAttemptDiscoveryTargetV1,
    LocatedPointMutationExecutionClaimLivenessTargetV1,
    LocatedExactRunningAttemptKernelV1,
    LocatedExactRunningAttemptReadSyscallKernelV1,
    FiniteStorageCaptureTarget,
    LocatedPointCommitPublicationTargetV1 {}

interface LocatedPointMutationSessionActivationInputV1 {
  readonly prepared: PreparedStoredMutationSessionActivationV1;
  readonly preliminaryAuthority: TrustedScopeAuthority;
  readonly candidateSessionId: TransactionSessionIdV1;
  readonly leaseDurationMilliseconds: number;
  readonly executionClaimDurationMilliseconds: number;
  readonly executionClaimOwner: TransactionExecutionClaimOwnerV1;
}

interface LocatedPointMutationSessionAttemptLoadInputV1 {
  readonly selector: PointMutationSessionAttemptSelectorV1;
  readonly preliminaryAuthority: TrustedScopeAuthority;
}

type PreparedPointMutationSessionAttemptTerminalizationInputV1 =
  | {
      readonly operation: "abort";
      readonly selector: PointMutationSessionAttemptSelectorV1;
      readonly expectedSnapshotToken: SnapshotToken;
      readonly executionClaim: TransactionExecutionClaimPinV1;
    }
  | {
      readonly operation: "expire";
      readonly selector: PointMutationSessionAttemptSelectorV1;
    };

type LocatedPointMutationSessionAttemptTerminalizationInputV1 =
  PreparedPointMutationSessionAttemptTerminalizationInputV1 & {
    readonly preliminaryAuthority: TrustedScopeAuthority;
  };

interface LockedPointMutationSessionClockV1 {
  readonly record: ScopeClockRecord;
  readonly scopeUuid: ScopeUuidV1;
  readonly epochUuid: ScopeEpochUuidV1;
  readonly authorizationRevocationEpoch:
    TransactionAuthorizationRevocationEpoch;
}

export function createPointMutationSessionActivationPersistenceV1(
  ports: PointMutationSessionActivationResolutionPortsV1,
  options: PointMutationSessionActivationPersistenceOptionsV1,
): PointMutationSessionActivationPersistenceV1 {
  const leaseDurationMilliseconds = requireLeaseDuration(
    options.leaseDurationMilliseconds,
  );
  const executionClaimDurationMilliseconds = requireActivationExecutionClaimDuration(
    options.executionClaimDurationMilliseconds ?? leaseDurationMilliseconds,
  );
  const randomUuid = options.randomUuid ?? (() => crypto.randomUUID());
  const randomExecutionClaimOwner = options.randomExecutionClaimOwner ??
    (() => crypto.randomUUID());

  const activateEffect = Effect.fn("PointMutationSessionActivation.activate")(
    function* (
      input: PreparedPointMutationSessionActivationV1,
    ): Effect.fn.Return<
      PointMutationSessionActivationResultV1,
      PointMutationSessionActivationEffectErrorV1
    > {
      const prepared = yield* Effect.fromResult(
        capturePreparedActivation(input),
      );
      const candidateSessionId = yield* generateSessionIdEffect(randomUuid);
      const executionClaimOwner = yield* generateExecutionClaimOwnerEffect(
        randomExecutionClaimOwner,
      );
      const located = yield* resolveLocatedTrustedScopeAuthorityByIdEffect(
        { deploymentId: prepared.deploymentId, scopeId: prepared.scopeId },
        {
          scopeMetadata: ports.scopeMetadata,
          provisioningReceipts: ports.provisioningReceipts,
          scopeClockTargets: ports.scopeSessionTargets,
        },
      ).pipe(Effect.mapError(mapActivationAuthorityError));
      if (located.authority.scopeId !== prepared.scopeId) {
        return yield* Effect.fail(activationError({ reason: "scopeMismatch" }));
      }
      const target = yield* Effect.fromResult(requireActivationTarget(
        located.target,
        prepared.scopeId,
      ));
      return yield* target[ACTIVATE_PREPARED_POINT_MUTATION_SESSION_EFFECT_V1]({
        prepared,
        preliminaryAuthority: located.authority,
        candidateSessionId,
        leaseDurationMilliseconds,
        executionClaimDurationMilliseconds,
        executionClaimOwner,
      });
    },
  );

  return Object.freeze({ activateEffect });
}

/**
 * Inert Application-authority admission. This deliberately shares the
 * transaction-session creation kernel while retaining a distinct input
 * contract and an in-transaction active-selection check.
 */
export function createApplicationMutationSessionActivationPersistenceV1(
  ports: PointMutationSessionActivationResolutionPortsV1,
  options: PointMutationSessionActivationPersistenceOptionsV1,
): ApplicationMutationSessionActivationPersistenceV1 {
  const leaseDurationMilliseconds = requireLeaseDuration(
    options.leaseDurationMilliseconds,
  );
  const executionClaimDurationMilliseconds =
    requireActivationExecutionClaimDuration(
      options.executionClaimDurationMilliseconds ?? leaseDurationMilliseconds,
    );
  const randomUuid = options.randomUuid ?? (() => crypto.randomUUID());
  const randomExecutionClaimOwner = options.randomExecutionClaimOwner ??
    (() => crypto.randomUUID());

  const activateEffect = Effect.fn(
    "ApplicationMutationSessionActivation.activate",
  )(function* (
    input: PreparedApplicationMutationSessionActivationV1,
  ): Effect.fn.Return<
    PointMutationSessionActivationResultV1,
    | PointMutationSessionActivationEffectErrorV1
    | ApplicationActivationError
    | ApplicationMutationExecutionAuthorityV1Error
  > {
    const prepared = yield* capturePreparedApplicationActivation(input);
    const candidateSessionId = yield* generateSessionIdEffect(randomUuid);
    const executionClaimOwner = yield* generateExecutionClaimOwnerEffect(
      randomExecutionClaimOwner,
    );
    const located = yield* resolveLocatedTrustedScopeAuthorityByIdEffect(
      { deploymentId: prepared.activation.deploymentId, scopeId: prepared.activation.scopeId },
      {
        scopeMetadata: ports.scopeMetadata,
        provisioningReceipts: ports.provisioningReceipts,
        scopeClockTargets: ports.scopeSessionTargets,
      },
    ).pipe(Effect.mapError(mapActivationAuthorityError));
    if (located.authority.scopeId !== prepared.activation.scopeId) {
      return yield* Effect.fail(activationError({ reason: "scopeMismatch" }));
    }
    const target = yield* Effect.fromResult(requireActivationTarget(
      located.target,
      prepared.activation.scopeId,
    ));
    return yield* target[ACTIVATE_APPLICATION_MUTATION_SESSION_EFFECT_V1](
      {
        prepared: prepared.activation,
        preliminaryAuthority: located.authority,
        candidateSessionId,
        leaseDurationMilliseconds,
        executionClaimDurationMilliseconds,
        executionClaimOwner,
      },
      prepared.selection,
    );
  });

  const activateFiniteEffect: ApplicationMutationSessionActivationPersistenceV1["activateFiniteEffect"] =
    Effect.fn("ApplicationMutationSessionActivation.activateFinite")(function* (input, entry) {
      return yield* Effect.gen(function* () {
        const inputs = yield* Effect.fromResult(readPreparedFiniteApplicationMutationActivationInputs(input.preparedAdmission, input.admissionContext));
        const prepared = yield* capturePreparedApplicationActivationFromBasis({ ...input, executionProfile: "finiteRoot" }, inputs.basis,
          inputs.executionAuthority);
        const candidateSessionId = yield* generateSessionIdEffect(randomUuid);
        const executionClaimOwner = yield* generateExecutionClaimOwnerEffect(randomExecutionClaimOwner);
        const preparedTarget = yield* Effect.tryPromise({ try: () => ports.scopeSessionTargets.resolve(inputs.basis.authority.physicalLocator),
          catch: mapActivationTransactionError });
        const located = Reflect.get(preparedTarget, INSTALLED_SCOPE_AUTHORITY_TARGET) === true
          ? { target: preparedTarget, authority: inputs.basis.authority }
          : yield* resolveLocatedTrustedScopeAuthorityByIdEffect({ deploymentId: input.deploymentId, scopeId: input.scopeId }, {
          scopeMetadata: ports.scopeMetadata, provisioningReceipts: ports.provisioningReceipts, scopeClockTargets: ports.scopeSessionTargets,
        }).pipe(Effect.mapError(mapActivationAuthorityError));
        const target = yield* Effect.fromResult(requireActivationTarget(located.target, input.scopeId));
        const result = yield* target[ACTIVATE_FINITE_APPLICATION_MUTATION_SESSION_EFFECT]({ prepared: prepared.activation,
          preliminaryAuthority: located.authority, candidateSessionId, leaseDurationMilliseconds,
          executionClaimDurationMilliseconds, executionClaimOwner }, input, entry);
        if (result.capture === undefined) {
          abandonPreparedFiniteSessionJournalEntry(entry);
          return Object.freeze({ activation: result.activation });
        }
        return Object.freeze({ activation: result.activation,
          entry: confirmPreparedFiniteSessionJournalEntry(entry, result.capture) });
      }).pipe(Effect.onError(() => Effect.sync(() => abandonPreparedFiniteSessionJournalEntry(entry))));
    });
  return Object.freeze({ activateEffect, activateFiniteEffect });
}

export function createPointMutationSessionAttemptLoadPersistenceV1(
  ports: PointMutationSessionAuthorityResolutionPortsV1,
): PointMutationSessionAttemptLoadPersistenceV1 {
  const loadEffect = Effect.fn("PointMutationSessionAttemptLoad.load")(
    function* (
      input: PointMutationSessionAttemptSelectorV1,
    ): Effect.fn.Return<
      PointMutationSessionAttemptLoadResultV1,
      PointMutationSessionAttemptLoadEffectErrorV1
    > {
      const selector = yield* Effect.fromResult(captureAttemptSelector(input));
      const located = yield* resolveLocatedTrustedScopeAuthorityByIdEffect(
        { deploymentId: selector.deploymentId, scopeId: selector.scopeId },
        {
          scopeMetadata: ports.scopeMetadata,
          provisioningReceipts: ports.provisioningReceipts,
          scopeClockTargets: ports.scopeSessionTargets,
        },
      ).pipe(Effect.mapError(mapAttemptLoadAuthorityError));
      if (located.authority.scopeId !== selector.scopeId) {
        return yield* Effect.fail(
          attemptLoadError({ reason: "selectorScopeMismatch" }),
        );
      }
      const target = yield* Effect.fromResult(
        requireAttemptLoadTarget(located.target, selector.scopeId),
      );
      return yield* target[LOAD_EXACT_POINT_MUTATION_SESSION_ATTEMPT_EFFECT_V1]({
        selector,
        preliminaryAuthority: located.authority,
      });
    },
  );

  return Object.freeze({ loadEffect });
}

export function createPointMutationExecutionClaimAcquisitionV1(
  ports: PointMutationSessionAuthorityResolutionPortsV1,
  options: PointMutationExecutionClaimAcquisitionOptionsV1,
): PointMutationExecutionClaimAcquisitionV1 {
  const durationMilliseconds = requireExecutionClaimAcquisitionDuration(
    options.durationMilliseconds,
  );
  const randomOwner = options.randomOwner ?? (() => crypto.randomUUID());
  const acquireEffect = Effect.fn(
    "PointMutationExecutionClaimAcquisition.acquire",
  )(function* (
    input: PointMutationSessionAttemptSelectorV1,
  ): Effect.fn.Return<
    PointMutationExecutionClaimAcquisitionResultV1,
    PointMutationExecutionClaimAcquisitionV1Error
  > {
    const selector = yield* Effect.fromResult(
      captureAttemptSelector(input).pipe(Result.mapError((cause) =>
        new PointMutationExecutionClaimAcquisitionInputV1Error({
          reason: "invalidSelector",
          cause,
        })
      )),
    );
    const located = yield* resolveLocatedTrustedScopeAuthorityByIdEffect(
      { deploymentId: selector.deploymentId, scopeId: selector.scopeId },
      {
        scopeMetadata: ports.scopeMetadata,
        provisioningReceipts: ports.provisioningReceipts,
        scopeClockTargets: ports.scopeSessionTargets,
      },
    ).pipe(Effect.mapError(mapExecutionClaimAcquisitionAuthorityError));
    if (located.authority.scopeId !== selector.scopeId) {
      return yield* Effect.fail(
        new PointMutationExecutionClaimAcquisitionStaleV1Error({
          reason: "scopeChanged",
        }),
      );
    }
    const candidate = located.target;
    if (
      typeof Reflect.get(
        candidate,
        ACQUIRE_POINT_MUTATION_EXECUTION_CLAIM_EFFECT_V1,
      ) !== "function"
    ) {
      return yield* Effect.fail(
        new PointMutationExecutionClaimAcquisitionPersistenceV1Error({
          operation: "prelude",
          cause: new Error(
            "Located scope target cannot acquire execution claims.",
          ),
        }),
      );
    }
    // SAFETY: the Reflect.get check above proved the candidate carries the
    // acquisition method, so it satisfies the located target brand.
    const target = candidate as LocatedPointMutationExecutionClaimAcquisitionTargetV1;
    return yield* target[ACQUIRE_POINT_MUTATION_EXECUTION_CLAIM_EFFECT_V1]({
      selector,
      preliminaryAuthority: located.authority,
      durationMilliseconds,
      randomOwner,
    });
  });
  return Object.freeze({ acquireEffect });
}

export function createPointMutationSessionAttemptTerminalizationPersistenceV1(
  ports: PointMutationSessionAuthorityResolutionPortsV1,
): PointMutationSessionAttemptTerminalizationPersistenceV1 {
  const terminalize = Effect.fn(function* (
    input: PreparedPointMutationSessionAttemptTerminalizationInputV1,
  ): Effect.fn.Return<
    PointMutationSessionAttemptTerminalizationResultV1,
    PointMutationSessionAttemptTerminalizationEffectErrorV1
  > {
    const located = yield* resolveLocatedTrustedScopeAuthorityByIdEffect(
      { deploymentId: input.selector.deploymentId, scopeId: input.selector.scopeId },
      {
        scopeMetadata: ports.scopeMetadata,
        provisioningReceipts: ports.provisioningReceipts,
        scopeClockTargets: ports.scopeSessionTargets,
      },
    ).pipe(Effect.mapError(mapAttemptTerminalizationAuthorityError));
    if (located.authority.scopeId !== input.selector.scopeId) {
      return yield* Effect.fail(
        attemptTerminalizationError({ reason: "selectorScopeMismatch" }),
      );
    }
    const target = yield* Effect.fromResult(
      requireAttemptTerminalizationTarget(
        located.target,
        input.selector.scopeId,
      ),
    );
    return yield* target[
      TERMINALIZE_EXACT_POINT_MUTATION_SESSION_ATTEMPT_EFFECT_V1
    ]({
      ...input,
      preliminaryAuthority: located.authority,
    });
  });

  const abortEffect = Effect.fn(
    "PointMutationSessionAttemptTerminalization.abort",
  )(function* (
    input: PointMutationSessionAttemptAbortInputV1,
  ): Effect.fn.Return<
    PointMutationSessionAttemptTerminalizationResultV1,
    PointMutationSessionAttemptTerminalizationEffectErrorV1
  > {
    const captured = yield* Effect.fromResult(captureAttemptAbortInput(input));
    return yield* terminalize({
      operation: "abort",
      selector: captured.selector,
      expectedSnapshotToken: captured.expectedSnapshotToken,
      executionClaim: captured.executionClaim,
    });
  });

  const expireEffect = Effect.fn(
    "PointMutationSessionAttemptTerminalization.expire",
  )(function* (
    input: PointMutationSessionAttemptSelectorV1,
  ): Effect.fn.Return<
    PointMutationSessionAttemptTerminalizationResultV1,
    PointMutationSessionAttemptTerminalizationEffectErrorV1
  > {
    const selector = yield* Effect.fromResult(
      captureTerminalizationAttemptSelector(input),
    );
    return yield* terminalize({
      operation: "expire",
      selector,
    });
  });

  return Object.freeze({ abortEffect, expireEffect });
}

const legacyActivationScopedOperation = defineScopedWriteOperation(
  (
    tx,
    _scoped,
    operationInput: Readonly<{
      readonly input: LocatedPointMutationSessionActivationInputV1;
      readonly afterWrite?: (
        step: PointMutationSessionActivationWriteStepV1,
      ) => void | Promise<void>;
    }>,
  ) => runPointCommitPromiseEffect(() => activateInTransaction(
      tx,
      operationInput.input,
      operationInput.afterWrite,
    ), mapActivationTransactionError),
);

const applicationActivationScopedOperation = defineScopedWriteOperation(
  Effect.fn("ApplicationMutationSessionActivation.inTransaction")(
    function* (
      tx: AppRowTransaction,
      _scoped,
      operationInput: Readonly<{
        readonly input: LocatedPointMutationSessionActivationInputV1;
        readonly selection: ApplicationActiveSelection;
      }>,
    ) {
      const { input, selection } = operationInput;
      const clock = yield* runPointCommitPromiseEffect(
        () => lockPointMutationSessionClock(tx, input.prepared.scopeId), mapActivationTransactionError);
      yield* Effect.fromResult(requireStableAuthority(clock, input));
      const replay = yield* runPointCommitPromiseEffect(
        () => replayApplicationSessionIfPresent(tx, input, clock), mapActivationTransactionError);
      if (replay !== null) return replay;
      yield* validateApplicationExecutableActiveSelectionInTransaction(
        selection,
        tx,
        clock.record,
      );
      return yield* runPointCommitPromiseEffect(
        () => activateAfterLockedClock(tx, input, clock, undefined), mapActivationTransactionError);
    },
  ),
);

const finiteApplicationActivationOperation = Effect.fn("ApplicationMutationSessionActivation.enterFiniteInTransaction")(function* (
    tx: AppRowTransaction, operationInput: Readonly<{
      input: LocatedPointMutationSessionActivationInputV1;
      prepared: PreparedFiniteApplicationMutationSessionActivation;
      entry: PreparedFiniteSessionJournalEntry;
      target: LocatedExactRunningAttemptKernelV1;
      afterWrite: LocatedPointMutationSessionActivationTargetOptionsV1["afterWrite"];
      managedControlProtection?: ProtectedMetadataPreparation;
      database: FlarexMetadataDatabase;
      installedAuthority?: PreparedInstalledAttemptScopeAuthority;
    }>) {
    const { input, prepared, entry, target, afterWrite } = operationInput;
    const clock = operationInput.installedAuthority === undefined ? yield* Effect.tryPromise({
      try: () => lockPointMutationSessionClock(tx, input.prepared.scopeId), catch: mapActivationTransactionError,
    }) : decodeLockedPointMutationSessionClock((yield* operationInput.installedAuthority.lock(tx, {
      deploymentId: input.prepared.deploymentId, scopeId: input.prepared.scopeId }, "attempt").pipe(
        Effect.mapError(mapApplicationActivationTransactionError))).row);
    yield* Effect.fromResult(requireStableAuthority(clock, input));
    openExactAttemptScopeClockObservation(tx, clock.record, clock.authorizationRevocationEpoch, "attempt");
    let observation: FiniteEntryObservation | null = null;
    return yield* Effect.gen(function* () {
    const observed = yield* captureFiniteEntryObservationInTransactionEffect(tx,
      input.preliminaryAuthority.physicalLocator.schemaName, clock.record, clock.scopeUuid,
      clock.record.storageGeneration, input.prepared.evidence.requestKey).pipe(Effect.mapError(mapApplicationActivationTransactionError));
    observation = observed.observation;
    if (observed.sessions.length > 1) return yield* Effect.fail(corruptionError(input.prepared.scopeId, "duplicateRequestAnchors"));
    const historical = observed.sessions[0];
    if (historical !== undefined) {
      const replay = yield* runPointCommitPromiseEffect(
        () => replayExistingSession(tx, input.prepared, clock, historical, observed.databaseNow), mapActivationTransactionError);
      return Object.freeze({ activation: replay });
    }
    if (observation === null) return yield* Effect.fail(corruptionError(input.prepared.scopeId, "sessionRecordInvalid"));
    const finiteEntry = observation;
    openProtectedMetadataFinalGuardScope(tx);
    return yield* Effect.gen(function* () {
    if (operationInput.installedAuthority !== undefined)
      yield* operationInput.installedAuthority.registerFinalGuards(tx,
        { deploymentId: input.prepared.deploymentId, scopeId: input.prepared.scopeId }, "attempt")
        .pipe(Effect.mapError(mapApplicationActivationTransactionError));
    return yield* withPreparedFiniteApplicationMutationAdmissionInTransaction(
      prepared.preparedAdmission, prepared.admissionContext, tx, clock.record, (accepted, binding) => Effect.gen(function* () {
      if (operationInput.managedControlProtection !== undefined)
        yield* registerProtectedMetadataTransactionFinalGuard(operationInput.managedControlProtection, operationInput.database, tx)
          .pipe(Effect.mapError(mapApplicationActivationTransactionError));
      if (operationInput.installedAuthority === undefined && clock.record.lastCommitSeq !== input.preliminaryAuthority.lastCommitSeq)
        return yield* Effect.fail(activationError({ reason: "snapshotCommitSeqChanged" }));
      const created = yield* prepareProvisionalFiniteSessionEffect(tx, input, clock, afterWrite,
        operationInput.installedAuthority !== undefined, observed.databaseNow);
      const { context } = created;
      const inputs = yield* Effect.fromResult(readPreparedFiniteApplicationMutationActivationInputs(prepared.preparedAdmission, prepared.admissionContext));
      const authority = inputs.executionAuthority.authority;
      const entryControl = yield* prepareFiniteSessionJournalEntryControlEffect(entry, {
        kind: "claimedAttempt", deploymentId: input.prepared.deploymentId, scopeId: input.prepared.scopeId,
        scopeUuid: context.scopeUuid, sessionId: context.anchor.sessionId, attemptFence: context.anchor.attemptFence,
        storageGeneration: context.anchor.storageGeneration, storageGenerationFence: context.anchor.storageGenerationFence,
        snapshotToken: context.anchor.snapshotToken, schemaVersionId: context.executionPin.schemaVersionId,
        executionClaim: context.executionClaim,
      }, { executionAuthorityGeneration: "application_v1", applicationExecutionAuthorityFormat: authority.format,
        applicationExecutionAuthorityVersionText: String(authority.version), applicationExecutionAuthorityActivationSequence: authority.activationSequence,
        applicationExecutionAuthorityRevisionId: authority.runtimeTarget.revisionId,
        applicationExecutionAuthorityFunctionPath: authority.runtimeTarget.function.path,
        applicationExecutionAuthoritySchemaSha256: authority.runtimeTarget.schemaSha256 }, inputs.application);
      let capture = yield* runPreparedFiniteSessionJournalEntryEffect(entry, tx, context,
        { authority: { ...input.preliminaryAuthority, ...clock.record }, target }, accepted.selection, binding, entryControl,
        inputs.executionAuthority,
        requireCorrelatedFiniteEntryEffect(tx, input.prepared.scopeId).pipe(Effect.mapError(cause =>
          new SessionJournalPersistenceV1Error({ operation: "openAttempt", cause }))), finiteEntry);
      capture = yield* acceptPreparedFiniteSessionJournalEntryForContinuationEffect(entry, tx, capture);
      return Object.freeze({ activation: activationResult("created", capture.context.anchor, capture.context.executionClaim), capture });
    }), finiteEntry, prepared.currentEntry);
    }).pipe(Effect.ensuring(Effect.sync(() => {
      closeProtectedMetadataFinalGuardScope(tx);
      closeFiniteExecutionAuthorityObservation(tx);
      finiteEntryAnchorExpectations.delete(tx);
    })));
    }).pipe(Effect.ensuring(Effect.sync(() => {
      closeFiniteEntryObservation(observation);
      closeExactAttemptScopeClockObservation(tx);
    })));
  });

export function createLocatedPointMutationSessionActivationTargetV1(
  db: FlarexMetadataDatabase,
  physicalLocator: ScopePhysicalLocator,
  options: LocatedPointMutationSessionActivationTargetOptionsV1 = {},
): LocatedScopeClockReader {
  const configuredManaged = options.managedInstallation;
  const managedInstallation = configuredManaged === undefined ? undefined : Object.freeze({
    installation: configuredManaged.installation, controlProtection: configuredManaged.controlProtection });
  if (managedInstallation !== undefined)
    Result.getOrThrowWith(requireProtectedControlPreparation(managedInstallation.controlProtection,
      db, managedInstallation.installation), cause => cause);
  const capturedLocator = captureScopePhysicalLocator(physicalLocator);
  const installedAuthority = managedInstallation === undefined ? undefined :
    Result.getOrThrowWith(prepareInstalledAttemptScopeAuthority(managedInstallation.installation, db, capturedLocator), cause => cause);
  const finiteCaptureDriver = options[FINITE_STORAGE_CAPTURE_DRIVER];
  const finiteCaptureAuthority = options[FINITE_STORAGE_CAPTURE_AUTHORITY];
  const finiteCaptureProfile: FiniteStorageCaptureProfile = managedInstallation === undefined
    ? { kind: "fullArtifact", ...(finiteCaptureAuthority === undefined ? {} : { authority: finiteCaptureAuthority }) }
    : finiteCaptureDriver === undefined
      ? (() => { throw new Error("Installed finite storage capture requires its implicit-read driver"); })()
      : { kind: "installed", installation: managedInstallation.installation, driver: finiteCaptureDriver };
  const finiteStorage = Result.getOrThrowWith(bindFiniteStorageCaptureOwner(db, capturedLocator, finiteCaptureProfile), cause => cause);
  const afterWrite = options.afterWrite;
  const afterLoadLock = options.afterLoadLock;
  const afterTerminalizationEvent = options.afterTerminalizationEvent;
  const afterExecutionClaimLivenessEvent =
    options.afterExecutionClaimLivenessEvent;
  if (managedInstallation !== undefined && options.directInstallation !== undefined)
    throw new Error("A located target requires one installation admission profile");
  const installationAdmission = options.directInstallation === undefined
    ? managedInstallation === undefined ? undefined : { kind: "coLocated" as const, installation: managedInstallation.installation }
    : { kind: "direct" as const, installation: options.directInstallation };
  const runReadCommitted = options[LOCATED_READ_COMMITTED_RUNNER_V1] ??
    createDefaultLocatedReadCommittedTransactionRunnerV1(db, installationAdmission);
  const runInstalledReadCommitted = installedAuthority === undefined ? undefined :
    <Value>(selection: Readonly<{ deploymentId: string; scopeId: ScopeId }>, work: (tx: AppRowTransaction) => Promise<Value>) =>
      createDefaultLocatedReadCommittedTransactionRunnerV1(db, installationAdmission,
        { owner: installedAuthority, selection, protection: "attempt" })(work);
  const committedOutcomeResolver = createCommittedPointOutcomeResolverV1(db);
  const getCurrentClockAtTarget = (scopeId: ScopeId) =>
    getScopeClock(db, scopeId);
  const scopeExecutionTarget = Object.freeze({
    physicalLocator: capturedLocator,
    getCurrentClock: getCurrentClockAtTarget,
    [RUN_LOCATED_READ_COMMITTED_V1]: runReadCommitted,
  });
  const target = Object.freeze({
    ...(installedAuthority === undefined ? {} : { [INSTALLED_SCOPE_AUTHORITY_TARGET]: true as const }),
    ...(installedAuthority === undefined ? {} : { [ACCEPT_INSTALLED_ATTEMPT_SCOPE_AUTHORITY_IN_TRANSACTION]:
      (tx: AppRowTransaction, selection: Readonly<{ deploymentId: string; scopeId: ScopeId }>) =>
        installedAuthority.lock(tx, selection, "attempt") }),
    ...(runInstalledReadCommitted === undefined ? {} : { [RUN_INSTALLED_ACCEPTING_READ_COMMITTED]: runInstalledReadCommitted }),
    physicalLocator: capturedLocator,
    getCurrentClock: getCurrentClockAtTarget,
    [ACTIVATE_PREPARED_POINT_MUTATION_SESSION_EFFECT_V1]: (
      input: LocatedPointMutationSessionActivationInputV1,
    ) => liveScopeExecution.runWrite(
      locatedActivationAuthority(
        scopeExecutionTarget,
        input.preliminaryAuthority,
      ),
      {
        clockProtection: "ordinaryWrite",
        rollbackMessage: "Point-mutation session activation rolled back.",
        cleanupDefect: mapActivationTransactionError,
      },
      legacyActivationScopedOperation,
      Object.freeze({
        input,
        ...(afterWrite === undefined ? {} : { afterWrite }),
      }),
    ).pipe(Effect.catchCause(cause => Effect.failCause(Cause.map(cause, mapActivationTransactionError)))),
    [ACTIVATE_APPLICATION_MUTATION_SESSION_EFFECT_V1]: (
      input: LocatedPointMutationSessionActivationInputV1,
      selection: ApplicationActiveSelection,
    ) => liveScopeExecution.runWrite(
      locatedActivationAuthority(
        scopeExecutionTarget,
        input.preliminaryAuthority,
      ),
      {
        clockProtection: "ordinaryWrite",
        rollbackMessage: "Application mutation session activation rolled back.",
        cleanupDefect: mapApplicationActivationTransactionError,
      },
      applicationActivationScopedOperation,
      Object.freeze({ input, selection }),
    ).pipe(Effect.catchCause(cause => Effect.failCause(Cause.map(cause, mapApplicationActivationTransactionError)))),
    [ACTIVATE_FINITE_APPLICATION_MUTATION_SESSION_EFFECT]: (
      input: LocatedPointMutationSessionActivationInputV1,
      prepared: PreparedFiniteApplicationMutationSessionActivation,
      entry: PreparedFiniteSessionJournalEntry,
    ): ReturnType<LocatedPointMutationSessionActivationTargetV1[typeof ACTIVATE_FINITE_APPLICATION_MUTATION_SESSION_EFFECT]> => runLocatedReadCommittedEffect(
      runInstalledReadCommitted === undefined ? scopeExecutionTarget : Object.freeze({ ...scopeExecutionTarget,
        [RUN_LOCATED_READ_COMMITTED_V1]: <Value>(work: (tx: AppRowTransaction) => Promise<Value>) =>
          runInstalledReadCommitted({ deploymentId: input.prepared.deploymentId, scopeId: input.prepared.scopeId }, work) }), {
      rollbackMessage: "Finite Application entry rolled back.", cleanupDefect: mapActivationTransactionError,
    }, tx => finiteApplicationActivationOperation(tx, {
        input, prepared, entry, target, afterWrite, database: db,
        ...(installedAuthority === undefined ? {} : { installedAuthority }),
        ...(managedInstallation === undefined ? {} : { managedControlProtection: managedInstallation.controlProtection }) })).pipe(
      Effect.catchCause(cause => Effect.failCause(Cause.map(cause,
        failure => failure instanceof ScopeExecutionAuthorityError || failure instanceof LocatedReadCommittedTransactionFailureV1
          ? mapApplicationActivationTransactionError(failure) : failure))),
    ),
    [LOAD_EXACT_POINT_MUTATION_SESSION_ATTEMPT_EFFECT_V1]: (
      input: LocatedPointMutationSessionAttemptLoadInputV1,
    ) => Effect.uninterruptible(runPointCommitPromiseEffect(() =>
        db.transaction(async tx => {
          await Effect.runPromise(lockInstallationForCurrentTransaction(tx));
          try {
            return await loadAttemptInTransaction(tx, input, afterLoadLock);
          } finally {
            closeInstallationAdmission(tx);
          }
        }), mapAttemptLoadTransactionError)),
    [RUN_EXACT_RUNNING_POINT_MUTATION_ATTEMPT_EFFECT_V1]: <Result, Failure>(
      input: ExactRunningAttemptKernelInputV1,
      work: ExactRunningAttemptEffectWorkV1<Result, Failure>,
    ): Effect.Effect<
      Result,
      Failure | ExactRunningAttemptTransactionV1Error
    > => runExactRunningAttemptEffectTransaction(
      db,
      input,
      work,
      afterLoadLock,
      "attempt",
      installedAuthority, managedInstallation?.controlProtection,
    ),
    [CAPTURE_FINITE_STORAGE]: finiteStorage.capture,
    [RUN_EXACT_RUNNING_POINT_MUTATION_READ_SYSCALL_EFFECT_V1]: <
      Result,
      Failure,
    >(
      input: ExactRunningAttemptKernelInputV1,
      work: ExactRunningAttemptEffectWorkV1<Result, Failure>,
    ): Effect.Effect<
      Result,
      Failure | ExactRunningAttemptTransactionV1Error
    > => runExactRunningAttemptEffectTransaction(
      db,
      input,
      work,
      afterLoadLock,
      "share",
      installedAuthority, managedInstallation?.controlProtection,
    ),
    [RESOLVE_PINNED_POINT_TABLE_ID_EFFECT_V1]:
      resolvePinnedPointTableIdV1Effect.bind(
        undefined,
        db,
      ),
    [RESOLVE_PINNED_DEVELOPER_INDEX_ID_EFFECT_V1]:
      resolvePinnedDeveloperIndexIdV1Effect.bind(
        undefined,
        db,
      ),
    [RUN_LOCATED_REPEATABLE_READ_V1]: <Result>(
      work: (tx: AppRowTransaction) => Promise<Result>,
    ): Promise<Result> => db.transaction(async (tx) => {
      await tx.setTransaction({
        isolationLevel: "repeatable read",
      });
      // The installation row SHARE latch requires a read-write SQL session;
      // the private detached loader still exposes only its read operation.
      await Effect.runPromise(lockInstallationForCurrentTransaction(tx));
      try {
        return await work(tx);
      } finally {
        closeInstallationAdmission(tx);
      }
    }),
    [RUN_LOCATED_READ_COMMITTED_V1]: runReadCommitted,
    [RESOLVE_LOCATED_COMMITTED_POINT_OUTCOME_V1]:
      committedOutcomeResolver.resolve,
    [ACQUIRE_POINT_MUTATION_EXECUTION_CLAIM_EFFECT_V1]: (input) =>
      acquireLocatedPointMutationExecutionClaimEffect(
        db,
        runReadCommitted,
        committedOutcomeResolver,
        input,
      ),
    [RENEW_POINT_MUTATION_EXECUTION_CLAIM_EFFECT_V1]: (input) =>
      renewLocatedPointMutationExecutionClaimEffect(
        input.installedFinite === true && runInstalledReadCommitted !== undefined ?
          work => runInstalledReadCommitted(input.selector, work) : runReadCommitted,
        input,
        afterExecutionClaimLivenessEvent,
        installedAuthority,
      ),
    [DISCOVER_LOCATED_POINT_MUTATION_ATTEMPTS_V1]: (input) =>
      discoverLocatedPointMutationAttemptsEffectV1(db, input),
    [TERMINALIZE_EXACT_POINT_MUTATION_SESSION_ATTEMPT_EFFECT_V1]: (
      input: LocatedPointMutationSessionAttemptTerminalizationInputV1,
    ) => Effect.uninterruptible(runPointCommitPromiseEffect(() =>
        db.transaction(async tx => {
          await Effect.runPromise(lockInstallationForCurrentTransaction(tx));
          try {
            return await terminalizeAttemptInTransaction(
              tx,
              input,
              afterTerminalizationEvent,
            );
          } finally {
            closeInstallationAdmission(tx);
          }
        }), cause => mapAttemptTerminalizationTransactionError(input.operation, cause))),
  } satisfies LocatedPointMutationSessionTargetV1);
  registerLocatedReadCommittedTargetDatabaseV1(target, db);
  return target;
}

const renewLocatedPointMutationExecutionClaimEffect = Effect.fn(
  "PointMutationExecutionClaimLiveness.renewLocated",
)(function* (
  runReadCommitted: RunLocatedReadCommittedTransactionV1,
  input: LocatedPointMutationExecutionClaimLivenessInputV1,
  afterEvent:
    | LocatedPointMutationSessionActivationTargetOptionsV1[
      "afterExecutionClaimLivenessEvent"
    ]
    | undefined,
  installedAuthority?: PreparedInstalledAttemptScopeAuthority,
): Effect.fn.Return<
  PointMutationExecutionClaimLivenessResultV1,
  Exclude<
    PointMutationExecutionClaimLivenessV1Error,
    | PointMutationExecutionClaimLivenessInputV1Error
    | PointMutationExecutionClaimLivenessConfigurationV1Error
    | TrustedScopeAuthorityResolutionError
  >
> {
  return yield* Effect.uninterruptible(runPointCommitPromiseEffect(() =>
      runReadCommitted((tx) =>
        renewExecutionClaimLivenessInTransaction(tx, input, afterEvent, installedAuthority)), mapExecutionClaimLivenessTransactionError));
});

async function renewExecutionClaimLivenessInTransaction(
  tx: AppRowTransaction,
  input: LocatedPointMutationExecutionClaimLivenessInputV1,
  afterEvent:
    | LocatedPointMutationSessionActivationTargetOptionsV1[
      "afterExecutionClaimLivenessEvent"
    ]
    | undefined,
  installedAuthority?: PreparedInstalledAttemptScopeAuthority,
): Promise<PointMutationExecutionClaimLivenessResultV1> {
  const emit = async (
    event: PointMutationExecutionClaimLivenessEventV1,
  ): Promise<void> => {
    await afterEvent?.(event);
  };
  if (input.installedFinite === true && installedAuthority === undefined)
    throw executionClaimLivenessCorruption("clockInvalid");
  const clock = input.installedFinite !== true ? await lockPointMutationSessionClock(tx, input.selector.scopeId) :
    decodeLockedPointMutationSessionClock((await projectPointCommitTransactionResult(
      await runPointCommitInTransactionEffect(installedAuthority!.lock(tx, input.selector, "attempt")))).row);
  await emit({ phase: "lock", step: "clockLocked" });
  projectTransactionSessionActivationResult(requireStablePointMutationSessionAttemptAuthority(
    clock,
    input,
    executionClaimLivenessStableAuthorityFailures,
  ));
  if (input.installedFinite === true) {
    return projectPointCommitTransactionResult(await runPointCommitInTransactionEffect(
      renewFiniteExecutionClaimInTransaction(tx, input, clock, () => emit({ phase: "lock", step: "sessionLocked" }))));
  }
  const session = await lockExactPointMutationSession(
    tx,
    input.selector,
    clock,
    executionClaimLivenessExactSessionFailures,
    async () => emit({ phase: "lock", step: "sessionLocked" }),
  );
  if (session.lifecycle !== "running" && session.lifecycle !== "finishing") {
    throw new PointMutationExecutionClaimLivenessStaleV1Error({
      reason: "lifecycleChanged",
    });
  }
  if (session.executionProfile === "finiteRoot") {
    return projectPointCommitTransactionResult(await runPointCommitInTransactionEffect(renewFiniteExecutionClaimInTransaction(tx, input, clock)));
  }
  const locked = await lockPointMutationSessionAttemptStructure(
    tx,
    {
      scopeId: input.selector.scopeId,
      authorityProfile: "liveExecution",
      failures: executionClaimLivenessAttemptAuthorityFailures,
      afterLeaseLock: async () =>
        emit({ phase: "lock", step: "leaseLocked" }),
    },
    clock,
    session,
    "requireRetainedSnapshot",
  );
  if (locked.leaseState === "absent") {
    throw executionClaimLivenessCorruption("leaseInvalid");
  }
  const root = await requireExactPointMutationSessionJournalRoot(
    tx,
    input.selector.scopeId,
    clock.scopeUuid,
    locked.sessionId,
    locked.attemptFence,
    async () => emit({ phase: "lock", step: "journalRootLocked" }),
  );
  const claimRows = await tx.select().from(
    fxSystemTransactionExecutionClaims,
  ).where(and(
    eq(fxSystemTransactionExecutionClaims.scopeUuid, clock.scopeUuid),
    eq(fxSystemTransactionExecutionClaims.sessionId, locked.sessionId),
    eq(
      fxSystemTransactionExecutionClaims.attemptFence,
      locked.attemptFence,
    ),
  )).limit(2).for("update");
  await emit({ phase: "lock", step: "executionClaimLocked" });

  const grantExpiresAtMilliseconds = finiteDateMilliseconds(
    session.authorizationGrantExpiresAt,
  );
  const hardExpiresAtMilliseconds = finiteDateMilliseconds(
    session.hardExpiresAt,
  );
  const databaseNow = await readDatabaseNow(tx, input.selector.scopeId);
  const databaseNowMilliseconds = finiteDateMilliseconds(databaseNow);
  if (
    grantExpiresAtMilliseconds === undefined ||
    hardExpiresAtMilliseconds === undefined ||
    databaseNowMilliseconds === undefined
  ) {
    throw executionClaimLivenessCorruption("sessionInvalid");
  }
  const authorityTargetMilliseconds = Math.min(
    grantExpiresAtMilliseconds,
    hardExpiresAtMilliseconds,
  );

  if (session.lifecycle === "finishing") {
    if (
      root.state !== "sealed" ||
      claimRows.length !== 0 ||
      locked.leaseExpiresAtMilliseconds !== authorityTargetMilliseconds
    ) {
      throw executionClaimLivenessCorruption("claimInvalid");
    }
    return Object.freeze({ kind: "consumedByFinishing" });
  }
  if (session.lifecycle !== "running") {
    throw new PointMutationExecutionClaimLivenessStaleV1Error({
      reason: "lifecycleChanged",
    });
  }
  const claimRow = claimRows[0];
  if (claimRows.length !== 1 || claimRow === undefined) {
    throw executionClaimLivenessCorruption("claimInvalid");
  }
  const claim = projectExecutionClaimLivenessResult(
    requireLiveTransactionExecutionClaimV1Result(
      input.selector.scopeId,
      claimRow,
      input.executionClaim,
      databaseNow,
    ),
  );
  const phase = root.state === "sealed"
    ? "sealed"
    : root.state === "failed" || root.state === "operation_failed"
    ? "failed"
    : root.state === "relation_conflicted"
    ? "relationConflicted"
    : root.state === "open" || root.state === "operation_invoking"
    ? "open"
    : undefined;
  if (phase === undefined) {
    throw executionClaimLivenessCorruption("journalRootInvalid");
  }
  const projected = projectExecutionClaimLivenessResult(
    projectExecutionClaimRenewalV1Result({
      databaseNowMilliseconds,
      currentLeaseExpiresAtMilliseconds: locked.leaseExpiresAtMilliseconds,
      currentClaimExpiresAtMilliseconds: Date.parse(claim.claimExpiresAt),
      authorizationGrantExpiresAtMilliseconds: grantExpiresAtMilliseconds,
      hardExpiresAtMilliseconds,
      claimDurationMilliseconds: input.claimDurationMilliseconds,
      leaseRenewalDurationMilliseconds:
        input.leaseRenewalDurationMilliseconds,
      maximumLiveSnapshotRetentionMilliseconds:
        input.maximumLiveSnapshotRetentionMilliseconds,
      phase,
    }).pipe(Result.mapError(mapExecutionClaimRenewalIssue)),
  );

  const targetLeaseExpiresAt = new Date(
    projected.targetLeaseExpiresAtMilliseconds,
  );
  if (
    projected.targetLeaseExpiresAtMilliseconds !==
      locked.leaseExpiresAtMilliseconds
  ) {
    const renewedLeases = await tx.update(fxSystemSnapshotLeases).set({
      leaseExpiresAt: targetLeaseExpiresAt,
    }).where(and(
      eq(fxSystemSnapshotLeases.scopeUuid, clock.scopeUuid),
      eq(fxSystemSnapshotLeases.sessionId, locked.sessionId),
      eq(fxSystemSnapshotLeases.attemptFence, locked.attemptFence),
      eq(
        fxSystemSnapshotLeases.snapshotEpochUuid,
        locked.lease.snapshotEpochUuid,
      ),
      eq(
        fxSystemSnapshotLeases.snapshotCommitSeq,
        locked.lease.snapshotCommitSeq,
      ),
      eq(fxSystemSnapshotLeases.leaseExpiresAt, locked.lease.leaseExpiresAt),
    )).returning({ leaseExpiresAt: fxSystemSnapshotLeases.leaseExpiresAt });
    if (
      renewedLeases.length !== 1 ||
      finiteDateMilliseconds(renewedLeases[0]?.leaseExpiresAt) !==
        projected.targetLeaseExpiresAtMilliseconds
    ) {
      throw executionClaimLivenessCorruption("mutationInvalid");
    }
    await emit({ phase: "write", step: "leaseRenewed" });
  }

  const targetClaimExpiresAt = new Date(
    projected.targetClaimExpiresAtMilliseconds,
  );
  if (
    projected.targetClaimExpiresAtMilliseconds !==
      Date.parse(claim.claimExpiresAt)
  ) {
    const renewedClaims = await tx.update(
      fxSystemTransactionExecutionClaims,
    ).set({ claimExpiresAt: targetClaimExpiresAt }).where(and(
      eq(fxSystemTransactionExecutionClaims.scopeUuid, clock.scopeUuid),
      eq(fxSystemTransactionExecutionClaims.sessionId, locked.sessionId),
      eq(
        fxSystemTransactionExecutionClaims.attemptFence,
        locked.attemptFence,
      ),
      eq(
        fxSystemTransactionExecutionClaims.claimOwner,
        input.executionClaim.claimOwner,
      ),
      eq(
        fxSystemTransactionExecutionClaims.claimFence,
        input.executionClaim.claimFence,
      ),
      eq(fxSystemTransactionExecutionClaims.claimedAt, claimRow.claimedAt),
      eq(
        fxSystemTransactionExecutionClaims.claimExpiresAt,
        claimRow.claimExpiresAt,
      ),
    )).returning({
      claimExpiresAt: fxSystemTransactionExecutionClaims.claimExpiresAt,
    });
    if (
      renewedClaims.length !== 1 ||
      finiteDateMilliseconds(renewedClaims[0]?.claimExpiresAt) !==
        projected.targetClaimExpiresAtMilliseconds
    ) {
      throw executionClaimLivenessCorruption("mutationInvalid");
    }
    await emit({ phase: "write", step: "executionClaimRenewed" });
  }

  const observation = Object.freeze({
    ...claim,
    claimExpiresAt: targetClaimExpiresAt.toISOString(),
  });
  const leaseExpiresAt = targetLeaseExpiresAt.toISOString();
  return phase === "failed"
    ? Object.freeze({
      kind: "terminalizationRequired",
      reason: "failedRoot",
      leaseExpiresAt,
      executionClaim: observation,
    })
    : Object.freeze({
      kind: "renewed",
      phase,
      leaseExpiresAt,
      executionClaim: observation,
    });
}

declare const finiteRecoveryAttemptBrand: unique symbol;
/** Original admitted request evidence only. This grants no execution claim. */
export interface FiniteRecoveryAttempt { readonly [finiteRecoveryAttemptBrand]: true }
const finiteRecoveryAttempts = new WeakMap<FiniteRecoveryAttempt, FiniteEntryAttemptKernelContext>();
export function readFiniteRecoveryAttempt(capture: FiniteRecoveryAttempt): Result.Result<FiniteEntryAttemptKernelContext,
  PointMutationExecutionClaimAcquisitionInputV1Error> {
  const context = finiteRecoveryAttempts.get(capture);
  return context === undefined ? Result.fail(new PointMutationExecutionClaimAcquisitionInputV1Error({ reason: "invalidSelector" })) : Result.succeed(structuredClone(context));
}

/** The Promise transaction callback above owns this one bounded runtime bridge. */
const renewFiniteExecutionClaimInTransaction = Effect.fn("PointMutationExecutionClaimLiveness.renewFinite")(
  function* (tx: AppRowTransaction, input: LocatedPointMutationExecutionClaimLivenessInputV1,
    clock: LockedPointMutationSessionClockV1, afterSessionLock?: () => Promise<void>) {
    const context = yield* lockFiniteAttemptAnchorInTransaction(tx, input.selector).pipe(Effect.mapError(cause => executionClaimLivenessCorruption("sessionInvalid", cause)));
    const session = context.session;
    if (afterSessionLock !== undefined) yield* Effect.tryPromise({ try: afterSessionLock, catch: mapExecutionClaimLivenessTransactionError });
    if (session.lifecycle !== "running") return yield* Effect.fail(new PointMutationExecutionClaimLivenessStaleV1Error({ reason: "lifecycleChanged" }));
    if (session.storageGeneration !== clock.record.storageGeneration || session.storageGenerationFence !== clock.record.storageGenerationFence)
      return yield* Effect.fail(new PointMutationExecutionClaimLivenessStaleV1Error({ reason: "generationChanged" }));
    if (session.authorizationRevocationEpoch !== clock.authorizationRevocationEpoch)
      return yield* Effect.fail(new PointMutationExecutionClaimLivenessStaleV1Error({ reason: "revocationEpochChanged" }));
    const databaseNow = yield* Effect.tryPromise({ try: () => readDatabaseNow(tx, input.selector.scopeId), catch: mapExecutionClaimLivenessTransactionError });
    if (context.snapshotToken.epoch !== clock.record.epoch) return yield* Effect.fail(new PointMutationExecutionClaimLivenessStaleV1Error({ reason: "epochChanged" }));
    if (context.snapshotToken.commitSeq < clock.record.oldestAvailableCommitSeq)
      return yield* Effect.fail(executionClaimLivenessCorruption("leaseInvalid"));
    const claim = context.executionClaim;
    if (claim.claimOwner !== input.executionClaim.claimOwner) return yield* Effect.fail(new PointMutationExecutionClaimLivenessStaleV1Error({ reason: "claimOwnerChanged" }));
    if (claim.claimFence !== input.executionClaim.claimFence) return yield* Effect.fail(new PointMutationExecutionClaimLivenessStaleV1Error({ reason: "claimFenceChanged" }));
    const projected = yield* Effect.fromResult(projectExecutionClaimRenewalV1Result({
      databaseNowMilliseconds: databaseNow.getTime(), currentLeaseExpiresAtMilliseconds: context.leaseExpiresAt.getTime(),
      currentClaimExpiresAtMilliseconds: Date.parse(claim.claimExpiresAt), authorizationGrantExpiresAtMilliseconds: session.authorizationGrantExpiresAt.getTime(),
      hardExpiresAtMilliseconds: session.hardExpiresAt.getTime(), claimDurationMilliseconds: input.claimDurationMilliseconds,
      leaseRenewalDurationMilliseconds: input.leaseRenewalDurationMilliseconds,
      maximumLiveSnapshotRetentionMilliseconds: input.maximumLiveSnapshotRetentionMilliseconds, phase: "open",
    }).pipe(Result.mapError(mapExecutionClaimRenewalIssue)));
    const rows = yield* Effect.tryPromise({ try: () => tx.update(fxSystemTransactionSessions).set({
      finiteLeaseExpiresAt: new Date(projected.targetLeaseExpiresAtMilliseconds), finiteClaimExpiresAt: new Date(projected.targetClaimExpiresAtMilliseconds),
    }).where(and(eq(fxSystemTransactionSessions.scopeUuid, session.scopeUuid), eq(fxSystemTransactionSessions.sessionId, session.sessionId),
      eq(fxSystemTransactionSessions.attemptFence, session.attemptFence), eq(fxSystemTransactionSessions.lifecycle, "running"),
      eq(fxSystemTransactionSessions.finiteClaimOwner, claim.claimOwner), eq(fxSystemTransactionSessions.finiteClaimFence, claim.claimFence)))
      .returning({ sessionId: fxSystemTransactionSessions.sessionId }), catch: mapExecutionClaimLivenessTransactionError });
    if (rows.length !== 1) return yield* Effect.fail(executionClaimLivenessCorruption("mutationInvalid"));
    return Object.freeze({ kind: "renewed" as const, phase: "open" as const,
      leaseExpiresAt: new Date(projected.targetLeaseExpiresAtMilliseconds).toISOString(),
      executionClaim: Object.freeze({ ...claim, claimExpiresAt: new Date(projected.targetClaimExpiresAtMilliseconds).toISOString() }) });
  });

interface PointMutationExecutionClaimAcquisitionPreludeV1 {
  readonly lookup: ResolveCommittedPointOutcomeInputV1;
  readonly attemptFence: TransactionAttemptFence;
}

type PointMutationExecutionClaimAcquisitionTransactionResultV1 =
  | Readonly<{ readonly kind: "outcomeObserved" }>
  | Exclude<
      PointMutationExecutionClaimAcquisitionResultV1,
      Readonly<{ readonly kind: "replayed" }>
    >;

const acquireLocatedPointMutationExecutionClaimEffect = Effect.fn(
  "PointMutationExecutionClaimAcquisition.acquireLocated",
)(function* (
  db: FlarexMetadataDatabase,
  runReadCommitted: RunLocatedReadCommittedTransactionV1,
  outcomeResolver: CommittedPointOutcomeResolverV1,
  input: Readonly<{
    readonly selector: PointMutationSessionAttemptSelectorV1;
    readonly preliminaryAuthority: TrustedScopeAuthority;
    readonly durationMilliseconds: number;
    readonly randomOwner: () => string;
  }>,
): Effect.fn.Return<
  PointMutationExecutionClaimAcquisitionResultV1,
  PointMutationExecutionClaimAcquisitionV1Error
> {
  const prelude = yield* Effect.uninterruptible(Effect.tryPromise({
    try: () => loadExecutionClaimAcquisitionPrelude(db, input.selector),
    catch: mapExecutionClaimAcquisitionPreludeFailure,
  }));
  const initialOutcome = yield* outcomeResolver.resolve(prelude.lookup);
  if (initialOutcome.kind !== "missing") {
    return Object.freeze({
      kind: "replayed",
      outcome: initialOutcome,
    });
  }

  const rawOwner = yield* Effect.try({
    try: input.randomOwner,
    catch: (cause) =>
      new PointMutationExecutionClaimAcquisitionConfigurationV1Error({
        reason: "claimOwnerGenerationFailed",
        cause,
      }),
  });
  const claimOwner = decodeTransactionExecutionClaimOwnerV1(rawOwner);
  if (Result.isFailure(claimOwner)) {
    return yield* Effect.fail(
      new PointMutationExecutionClaimAcquisitionConfigurationV1Error({
        reason: "claimOwnerInvalid",
      }),
    );
  }

  const transactionResult = yield* Effect.uninterruptible(
    runPointCommitPromiseEffect(() => runReadCommitted((tx) =>
        acquireExecutionClaimInTransaction(
          tx,
          {
            selector: input.selector,
            preliminaryAuthority: input.preliminaryAuthority,
            durationMilliseconds: input.durationMilliseconds,
            claimOwner: claimOwner.success,
          },
          prelude,
        )), mapExecutionClaimAcquisitionTransactionFailure),
  );
  if (transactionResult.kind !== "outcomeObserved") {
    return transactionResult;
  }
  const settledOutcome = yield* outcomeResolver.resolve(prelude.lookup);
  if (settledOutcome.kind === "missing") {
    return yield* Effect.fail(
      new PointMutationExecutionClaimAcquisitionCorruptionV1Error({
        reason: "committedOutcomeMissing",
      }),
    );
  }
  return Object.freeze({ kind: "replayed", outcome: settledOutcome });
});

async function loadExecutionClaimAcquisitionPrelude(
  db: FlarexMetadataDatabase,
  selector: PointMutationSessionAttemptSelectorV1,
): Promise<PointMutationExecutionClaimAcquisitionPreludeV1> {
  const scopeUuid = projectScopeIdUuidV1(selector.scopeId).scopeUuid;
  const rows = await db.select({
    scopeUuid: fxSystemTransactionSessions.scopeUuid,
    sessionId: fxSystemTransactionSessions.sessionId,
    attemptFence: fxSystemTransactionSessions.attemptFence,
    requestKey: fxSystemTransactionSessions.requestKey,
    identityAccessPolicySha256:
      fxSystemTransactionSessions.identityAccessPolicySha256,
    functionPath: fxSystemTransactionSessions.functionPath,
    requestSha256: fxSystemTransactionSessions.requestSha256,
  }).from(fxSystemTransactionSessions).where(and(
    eq(fxSystemTransactionSessions.scopeUuid, scopeUuid),
    eq(fxSystemTransactionSessions.sessionId, selector.sessionId),
  )).limit(2);
  const row = rows[0];
  if (rows.length === 0 || row === undefined) {
    throw new PointMutationExecutionClaimAcquisitionStaleV1Error({
      reason: "attemptMissing",
    });
  }
  if (rows.length !== 1) {
    throw new PointMutationExecutionClaimAcquisitionCorruptionV1Error({
      reason: "preludeInvalid",
    });
  }
  if (
    row.scopeUuid !== scopeUuid ||
    row.sessionId !== selector.sessionId ||
    !isUint8ArrayWithByteLength(row.identityAccessPolicySha256, 32) ||
    !isUint8ArrayWithByteLength(row.requestSha256, 32)
  ) {
    throw new PointMutationExecutionClaimAcquisitionCorruptionV1Error({
      reason: "preludeInvalid",
    });
  }
  try {
    return Object.freeze({
      attemptFence: TransactionAttemptFenceSchema.make(row.attemptFence),
      lookup: Object.freeze({
        scopeUuid,
        requestKey: TransactionRequestKeyV1Schema.make(row.requestKey),
        expectedIdentityAccessPolicySha256:
          TransactionIdentityAccessPolicySha256V1Schema.make(
            new Uint8Array(row.identityAccessPolicySha256),
          ),
        expectedFunctionPath: TransactionFunctionPathV1Schema.make(
          row.functionPath,
        ),
        expectedRequestSha256: TransactionRequestSha256V1Schema.make(
          new Uint8Array(row.requestSha256),
        ),
      }),
    });
  } catch (cause) {
    throw new PointMutationExecutionClaimAcquisitionCorruptionV1Error({
      reason: "preludeInvalid",
      cause,
    });
  }
}

async function acquireExecutionClaimInTransaction(
  tx: AppRowTransaction,
  input: Readonly<{
    readonly selector: PointMutationSessionAttemptSelectorV1;
    readonly preliminaryAuthority: TrustedScopeAuthority;
    readonly durationMilliseconds: number;
    readonly claimOwner: TransactionExecutionClaimOwnerV1;
  }>,
  prelude: PointMutationExecutionClaimAcquisitionPreludeV1,
): Promise<PointMutationExecutionClaimAcquisitionTransactionResultV1> {
  const selector = input.selector;
  const clock = await lockPointMutationSessionClock(tx, selector.scopeId);
  requireStableExecutionClaimAcquisitionAuthority(
    clock,
    input.preliminaryAuthority,
    selector,
  );

  const outcomeRows = await tx.select({
    requestKey: fxSystemIdempotency.requestKey,
  }).from(fxSystemIdempotency).where(and(
    eq(fxSystemIdempotency.scopeUuid, clock.scopeUuid),
    eq(fxSystemIdempotency.requestKey, prelude.lookup.requestKey),
  )).limit(2).for("update");
  if (outcomeRows.length > 1) {
    throw new PointMutationExecutionClaimAcquisitionCorruptionV1Error({
      reason: "committedOutcomeInvalid",
    });
  }
  if (outcomeRows[0] !== undefined) {
    return Object.freeze({ kind: "outcomeObserved" });
  }

  const sessionRows = await tx.select().from(fxSystemTransactionSessions)
    .where(and(
      eq(fxSystemTransactionSessions.scopeUuid, clock.scopeUuid),
      eq(fxSystemTransactionSessions.sessionId, selector.sessionId),
    )).limit(2).for("update");
  const session = sessionRows[0];
  if (sessionRows.length === 0 || session === undefined) {
    throw new PointMutationExecutionClaimAcquisitionStaleV1Error({
      reason: "attemptMissing",
    });
  }
  if (sessionRows.length !== 1) {
    throw new PointMutationExecutionClaimAcquisitionCorruptionV1Error({
      reason: "sessionInvalid",
    });
  }
  if (session.attemptFence !== selector.attemptFence) {
    throw new PointMutationExecutionClaimAcquisitionStaleV1Error({
      reason: "attemptReplaced",
    });
  }
  if (!sessionMatchesExecutionClaimPrelude(session, prelude)) {
    throw new PointMutationExecutionClaimAcquisitionCorruptionV1Error({
      reason: "sessionInvalid",
    });
  }
  if (session.lifecycle === "committed") {
    throw new PointMutationExecutionClaimAcquisitionCorruptionV1Error({
      reason: "committedOutcomeMissing",
    });
  }
  if (session.executionProfile === "finiteRoot" && (session.lifecycle === "running" || session.lifecycle === "retrying")) {
    const context = projectPointCommitTransactionResult(await runPointCommitInTransactionEffect(readFiniteAttemptAnchorRow(session)
      .pipe(Effect.mapError(cause => new PointMutationExecutionClaimAcquisitionCorruptionV1Error({ reason: "sessionInvalid", cause })))));
    const databaseNow = await readDatabaseNow(tx, selector.scopeId);
    if (session.lifecycle === "running" && Date.parse(context.executionClaim.claimExpiresAt) > databaseNow.getTime())
      return Object.freeze({ kind: "busy", observation: context.executionClaim });
    const evidence = projectPointCommitTransactionResult(await runPointCommitInTransactionEffect(
      finiteEntryAttemptContextFromAnchor(context, selector.deploymentId, clock.record, databaseNow)));
    // SAFETY: only this locked acquisition owner issues an inert recovery capture.
    const capture = Object.freeze({}) as FiniteRecoveryAttempt;
    finiteRecoveryAttempts.set(capture, evidence);
    return Object.freeze({ kind: "finiteRecovery", capture });
  }
  if (session.lifecycle === "finishing") {
    return Object.freeze({ kind: "finishing" });
  }
  if (session.lifecycle !== "running") {
    throw new PointMutationExecutionClaimAcquisitionStaleV1Error({
      reason: "lifecycle",
    });
  }

  const locked = await lockPointMutationSessionAttemptStructure(
    tx,
    {
      scopeId: selector.scopeId,
      authorityProfile: "liveExecution",
      failures: executionClaimAcquisitionAuthorityFailures,
      afterLeaseLock: undefined,
    },
    clock,
    session,
    "requireRetainedSnapshot",
  );
  if (locked.leaseState === "absent") {
    throw new PointMutationExecutionClaimAcquisitionCorruptionV1Error({
      reason: "leaseInvalid",
    });
  }
  const root = await requireExactPointMutationSessionJournalRoot(
    tx,
    selector.scopeId,
    clock.scopeUuid,
    locked.sessionId,
    locked.attemptFence,
    undefined,
  );
  const claimRow = projectTransactionSessionActivationResult(
    await lockExactTransactionExecutionClaimV1Result(tx, {
      scopeId: selector.scopeId,
      scopeUuid: clock.scopeUuid,
      sessionId: locked.sessionId,
      attemptFence: locked.attemptFence,
    }),
  );
  const databaseNow = await readDatabaseNow(tx, selector.scopeId);
  const now = finiteDateMilliseconds(databaseNow);
  const grantExpiresAt = finiteDateMilliseconds(
    session.authorizationGrantExpiresAt,
  );
  const hardExpiresAt = finiteDateMilliseconds(session.hardExpiresAt);
  if (
    now === undefined ||
    grantExpiresAt === undefined ||
    hardExpiresAt === undefined
  ) {
    throw new PointMutationExecutionClaimAcquisitionCorruptionV1Error({
      reason: "sessionInvalid",
    });
  }
  if (
    root.state === "sealed" &&
    locked.leaseExpiresAtMilliseconds !== Math.min(
      grantExpiresAt,
      hardExpiresAt,
    )
  ) {
    throw new PointMutationExecutionClaimAcquisitionCorruptionV1Error({
      reason: "leaseInvalid",
    });
  }
  if (grantExpiresAt <= now || hardExpiresAt <= now) {
    throw new PointMutationExecutionClaimAcquisitionStaleV1Error({
      reason: "authorizationExpired",
    });
  }
  if (locked.leaseExpiresAtMilliseconds <= now) {
    throw new PointMutationExecutionClaimAcquisitionStaleV1Error({
      reason: "leaseExpired",
    });
  }

  const current = projectTransactionSessionActivationResult(
    inspectTransactionExecutionClaimV1Result(selector.scopeId, claimRow),
  );
  const currentClaimedAt = Date.parse(current.claimedAt);
  const currentExpiry = Date.parse(current.claimExpiresAt);
  if (currentClaimedAt > now) {
    throw new PointMutationExecutionClaimAcquisitionCorruptionV1Error({
      reason: "claimInvalid",
    });
  }
  if (currentExpiry > now) {
    return Object.freeze({ kind: "busy", observation: current });
  }

  let disposition:
    | Readonly<{
        readonly mode: "execute" | "finishOnly" | "replaceRelationConflict";
      }>
    | Readonly<{
        readonly mode: "abortOnly";
        readonly reason: PointMutationExecutionClaimAbortReasonV1;
      }>;
  if (root.state === "sealed") {
    disposition = { mode: "finishOnly" };
  } else if (root.state === "relation_conflicted") {
    disposition = { mode: "replaceRelationConflict" };
  } else if (root.state === "open") {
    // A finite root can have tentative child results in its lost evaluator
    // while its durable journal still looks pristine. Never resume that root
    // under the same attempt fence after the execution claim expires.
    if (root.executionProfile === "finiteRoot") {
      disposition = { mode: "abortOnly", reason: "dirtyOpen" };
    } else {
      const facet = await observePointMutationSessionAttemptFacet(
        tx,
        clock,
        session,
        locked,
        root,
      );
      disposition = facet.kind !== "pristineOpen"
        ? { mode: "abortOnly", reason: "dirtyOpen" }
        : { mode: "execute" };
    }
  } else {
    disposition = { mode: "abortOnly", reason: "failedRoot" };
  }

  if (current.claimFence >= MAX_PERSISTED_SIGNED_INT64_V1) {
    throw new PointMutationExecutionClaimAcquisitionResourceV1Error({
      dimension: "claimFence",
      maximum: MAX_PERSISTED_SIGNED_INT64_V1,
    });
  }
  const mutationDatabaseNow = await readDatabaseNow(tx, selector.scopeId);
  const mutationNow = finiteDateMilliseconds(mutationDatabaseNow);
  if (mutationNow === undefined) {
    throw new PointMutationExecutionClaimAcquisitionCorruptionV1Error({
      reason: "sessionInvalid",
    });
  }
  if (grantExpiresAt <= mutationNow || hardExpiresAt <= mutationNow) {
    throw new PointMutationExecutionClaimAcquisitionStaleV1Error({
      reason: "authorizationExpired",
    });
  }
  if (locked.leaseExpiresAtMilliseconds <= mutationNow) {
    throw new PointMutationExecutionClaimAcquisitionStaleV1Error({
      reason: "leaseExpired",
    });
  }
  const next = deriveTransactionExecutionClaimV1({
    scopeUuid: clock.scopeUuid,
    sessionId: locked.sessionId,
    attemptFence: locked.attemptFence,
    claimFence: current.claimFence + 1n,
    claimOwner: input.claimOwner,
    databaseNow: mutationDatabaseNow,
    durationMilliseconds: input.durationMilliseconds,
    leaseExpiresAt: locked.lease.leaseExpiresAt,
    authorizationGrantExpiresAt: session.authorizationGrantExpiresAt,
    hardExpiresAt: session.hardExpiresAt,
  });
  const renewedClaim = Result.match(next, {
    onSuccess: (renewed) => renewed,
    onFailure: (failure) => {
      throw failure === "authorityExpired"
        ? new PointMutationExecutionClaimAcquisitionStaleV1Error({
            reason: "authorizationExpired",
          })
        : new PointMutationExecutionClaimAcquisitionCorruptionV1Error({
            reason: "claimInvalid",
          });
    },
  });
  const updated = await tx.update(fxSystemTransactionExecutionClaims).set({
    claimFence: renewedClaim.claimFence,
    claimOwner: renewedClaim.claimOwner,
    claimedAt: renewedClaim.claimedAt,
    claimExpiresAt: renewedClaim.claimExpiresAt,
  }).where(and(
    eq(fxSystemTransactionExecutionClaims.scopeUuid, clock.scopeUuid),
    eq(fxSystemTransactionExecutionClaims.sessionId, locked.sessionId),
    eq(fxSystemTransactionExecutionClaims.attemptFence, locked.attemptFence),
    eq(fxSystemTransactionExecutionClaims.claimFence, current.claimFence),
    eq(fxSystemTransactionExecutionClaims.claimOwner, current.claimOwner),
  )).returning({
    claimFence: fxSystemTransactionExecutionClaims.claimFence,
    claimOwner: fxSystemTransactionExecutionClaims.claimOwner,
    claimedAt: fxSystemTransactionExecutionClaims.claimedAt,
    claimExpiresAt: fxSystemTransactionExecutionClaims.claimExpiresAt,
  });
  if (
    updated.length !== 1 ||
    updated[0]?.claimFence !== renewedClaim.claimFence ||
    updated[0]?.claimOwner !== renewedClaim.claimOwner
  ) {
    throw new PointMutationExecutionClaimAcquisitionCorruptionV1Error({
      reason: "claimMutationInvalid",
    });
  }
  const observation = Object.freeze({
    claimOwner: renewedClaim.claimOwner,
    claimFence: renewedClaim.claimFence,
    claimedAt: renewedClaim.claimedAt.toISOString(),
    claimExpiresAt: renewedClaim.claimExpiresAt.toISOString(),
  });
  if (disposition.mode === "abortOnly") {
    return Object.freeze({
      kind: "acquired",
      mode: disposition.mode,
      reason: disposition.reason,
      observation,
    });
  }
  return Object.freeze({
    kind: "acquired",
    mode: disposition.mode,
    observation,
  });
}

const executionClaimAcquisitionAuthorityFailures = Object.freeze({
  unsupportedStorageGeneration: () =>
    new PointMutationExecutionClaimAcquisitionStaleV1Error({
      reason: "generationChanged",
    }),
  storageGenerationFenceChanged: () =>
    new PointMutationExecutionClaimAcquisitionStaleV1Error({
      reason: "generationChanged",
    }),
  authorizationRevocationEpochChanged: () =>
    new PointMutationExecutionClaimAcquisitionStaleV1Error({
      reason: "revocationEpochChanged",
    }),
  scopeEpochChanged: () =>
    new PointMutationExecutionClaimAcquisitionStaleV1Error({
      reason: "epochChanged",
    }),
} satisfies PointMutationSessionAttemptAuthorityFailureFactoryV1);

function requireStableExecutionClaimAcquisitionAuthority(
  clock: LockedPointMutationSessionClockV1,
  preliminary: TrustedScopeAuthority,
  selector: PointMutationSessionAttemptSelectorV1,
): void {
  if (preliminary.deploymentId !== selector.deploymentId) {
    throw new PointMutationExecutionClaimAcquisitionStaleV1Error({
      reason: "deploymentChanged",
    });
  }
  projectTransactionSessionActivationResult(requireStablePointMutationSessionAttemptAuthority(
    clock,
    { selector, preliminaryAuthority: preliminary },
    executionClaimAcquisitionStableAuthorityFailures,
  ));
}

const executionClaimAcquisitionStableAuthorityFailures = Object.freeze({
  selectorScopeMismatch: () =>
    new PointMutationExecutionClaimAcquisitionStaleV1Error({
      reason: "scopeChanged",
    }),
  unsupportedStorageGeneration: () =>
    new PointMutationExecutionClaimAcquisitionStaleV1Error({
      reason: "generationChanged",
    }),
  storageGenerationChanged: () =>
    new PointMutationExecutionClaimAcquisitionStaleV1Error({
      reason: "generationChanged",
    }),
  storageGenerationFenceChanged: () =>
    new PointMutationExecutionClaimAcquisitionStaleV1Error({
      reason: "generationChanged",
    }),
  scopeEpochChanged: () =>
    new PointMutationExecutionClaimAcquisitionStaleV1Error({
      reason: "epochChanged",
    }),
} satisfies PointMutationSessionStableAuthorityFailureFactoryV1);

function sessionMatchesExecutionClaimPrelude(
  session: TransactionSessionRow,
  prelude: PointMutationExecutionClaimAcquisitionPreludeV1,
): boolean {
  return session.attemptFence === prelude.attemptFence &&
    session.requestKey === prelude.lookup.requestKey &&
    session.functionPath === prelude.lookup.expectedFunctionPath &&
    isUint8ArrayWithByteLength(session.identityAccessPolicySha256, 32) &&
    bytesEqual(
      session.identityAccessPolicySha256,
      prelude.lookup.expectedIdentityAccessPolicySha256,
    ) &&
    isUint8ArrayWithByteLength(session.requestSha256, 32) &&
    bytesEqual(session.requestSha256, prelude.lookup.expectedRequestSha256);
}

function mapExecutionClaimAcquisitionPreludeFailure(
  cause: unknown,
): PointMutationExecutionClaimAcquisitionV1Error {
  if (
    cause instanceof PointMutationExecutionClaimAcquisitionStaleV1Error ||
    cause instanceof PointMutationExecutionClaimAcquisitionCorruptionV1Error
  ) return cause;
  return new PointMutationExecutionClaimAcquisitionPersistenceV1Error({
    operation: "prelude",
    cause,
  });
}

function mapExecutionClaimAcquisitionAuthorityError(
  error: TrustedScopeAuthorityError,
): PointMutationExecutionClaimAcquisitionStaleV1Error |
  PointMutationExecutionClaimAcquisitionCorruptionV1Error |
  PointMutationExecutionClaimAcquisitionPersistenceV1Error {
  if (error instanceof TrustedScopeAuthorityPortError) {
    return new PointMutationExecutionClaimAcquisitionPersistenceV1Error({
      operation: "prelude",
      cause: error.cause,
    });
  }

  const failure = error.failure;
  switch (failure.reason) {
    case "scopeMetadataMissing":
    case "scopeMetadataAmbiguous":
    case "scopeDeploymentMismatch":
      return new PointMutationExecutionClaimAcquisitionStaleV1Error({
        reason: "deploymentChanged",
      });
    case "splitProvisioningReceiptMissing":
    case "splitProvisioningReceiptScopeMismatch":
    case "splitProvisioningReceiptNotReady":
    case "splitProvisioningReceiptPlacementMismatch":
    case "scopeClockTargetPlacementMismatch":
    case "scopeClockMissing":
      return new PointMutationExecutionClaimAcquisitionStaleV1Error({
        reason: "scopeChanged",
      });
    case "scopeClockTargetResolutionFailed":
      return new PointMutationExecutionClaimAcquisitionPersistenceV1Error({
        operation: "prelude",
        cause: failure.resolutionCause,
      });
    case "scopeClockTargetInvalid":
    case "scopeClockScopeMismatch":
      return new PointMutationExecutionClaimAcquisitionCorruptionV1Error({
        reason: "preludeInvalid",
        cause: error,
      });
    default: {
      const unhandledFailure: never = failure;
      return unhandledFailure;
    }
  }
}

function mapExecutionClaimAcquisitionTransactionFailure(
  cause: unknown,
): PointMutationExecutionClaimAcquisitionV1Error {
  if (
    cause instanceof LocatedReadCommittedTransactionFailureV1 &&
    cause.issue.kind === "callbackRolledBack"
  ) {
    return mapExecutionClaimAcquisitionTransactionFailure(
      cause.issue.callbackCause,
    );
  }
  if (
    cause instanceof PointMutationExecutionClaimAcquisitionStaleV1Error ||
    cause instanceof PointMutationExecutionClaimAcquisitionCorruptionV1Error ||
    cause instanceof PointMutationExecutionClaimAcquisitionResourceV1Error ||
    cause instanceof PointMutationExecutionClaimAcquisitionPersistenceV1Error
  ) return cause;
  if (cause instanceof TransactionExecutionClaimCorruptionV1Error) {
    return new PointMutationExecutionClaimAcquisitionCorruptionV1Error({
      reason: "claimInvalid",
      cause,
    });
  }
  if (cause instanceof PointMutationSessionAuthorityCorruptionV1Error) {
    return new PointMutationExecutionClaimAcquisitionCorruptionV1Error({
      reason: cause.issue === "snapshotLeaseInvalid"
        ? "leaseInvalid"
        : cause.issue === "journalRootInvalid" ||
            cause.issue === "activeJournalRootMissing"
        ? "journalRootInvalid"
        : "sessionInvalid",
      cause,
    });
  }
  return new PointMutationExecutionClaimAcquisitionPersistenceV1Error({
    operation: "transaction",
    cause,
  });
}

/**
 * Package-internal construction seam shared by narrowly located persistence
 * capabilities. This module is not a package export.
 */
export function createDefaultLocatedReadCommittedTransactionRunnerV1(
  db: FlarexMetadataDatabase,
  installation?: Readonly<{ kind: "coLocated"; installation: PreparedCoLocatedReadInstallation }> |
    Readonly<{ kind: "direct"; installation: PreparedInstallation }>,
  accepting?: Readonly<{ owner: PreparedInstalledAttemptScopeAuthority;
    selection: Readonly<{ deploymentId: string; scopeId: ScopeId }>; protection: "share" | "attempt" }>,
): RunLocatedReadCommittedTransactionV1 {
  return async <Result>(work: (
    tx: AppRowTransaction,
  ) => Promise<Result>): Promise<Result> => {
    const state: {
      phase: "configuring" | "running" | "completed" | "rejected";
      callbackCause: unknown;
    } = { phase: "configuring", callbackCause: undefined };
    try {
      return await db.transaction(async (tx) => {
        await tx.setTransaction({ isolationLevel: "read committed" });
        if (accepting !== undefined) Result.getOrThrowWith(accepting.owner.requireDatabase(db), cause => cause);
        if (accepting === undefined) await Effect.runPromise(installation === undefined ? lockInstallationForCurrentTransaction(tx)
          : installation.kind === "coLocated" ? acquireCoLocatedInstallationAdmission(installation.installation, db, tx).pipe(Effect.asVoid)
          : acquireInstallationAdmission(installation.installation, db, tx).pipe(Effect.asVoid));
        state.phase = "running";
        try {
          const result = await work(tx);
          if (accepting !== undefined) Result.getOrThrowWith(
            accepting.owner.requireAcceptedTransaction(tx, accepting.selection, accepting.protection), cause => cause);
          state.phase = "completed";
          return result;
        } catch (cause) {
          state.phase = "rejected";
          state.callbackCause = cause;
          throw cause;
        } finally {
          accepting?.owner.closeAcceptedTransaction(tx);
          closeInstallationAdmission(tx);
        }
      });
    } catch (cause) {
      if (state.phase === "rejected" && cause === state.callbackCause) {
        throw new LocatedReadCommittedTransactionFailureV1(Object.freeze({
          kind: "callbackRolledBack",
          callbackCause: state.callbackCause,
        }));
      }
      if (state.phase === "rejected") {
        throw new LocatedReadCommittedTransactionFailureV1(Object.freeze({
          kind: "callbackCleanupFailed",
          callbackCause: state.callbackCause,
          transactionCause: cause,
        }));
      }
      if (state.phase === "completed") {
        throw new LocatedReadCommittedTransactionFailureV1(Object.freeze({
          kind: "decisionUncertain",
          settlementCause: cause,
        }));
      }
      throw new LocatedReadCommittedTransactionFailureV1(Object.freeze({
        kind: "infrastructureFailure",
        phase: "beginOrConfigure",
        cause,
      }));
    }
  };
}


/** The shared bridge owns full callback Cause and native settlement; this
 * exact-attempt owner retains admission, final guards and cleanup. */
function runExactRunningAttemptEffectTransaction<Result, Failure>(
  db: FlarexMetadataDatabase,
  input: ExactRunningAttemptKernelInputV1,
  work: ExactRunningAttemptEffectWorkV1<Result, Failure>,
  afterLoadLock:
    | LocatedPointMutationSessionActivationTargetOptionsV1["afterLoadLock"]
    | undefined,
  clockProtection: "share" | "attempt",
  installedAuthority?: PreparedInstalledAttemptScopeAuthority,
  controlProtection?: ProtectedMetadataPreparation,
): Effect.Effect<Result, Failure | ExactRunningAttemptTransactionV1Error> {
  return Effect.uninterruptible(runEffectTransactionSettlement<Result, Failure | ExactRunningAttemptTransactionV1Error,
    ExactRunningAttemptTransactionV1Error, AppRowTransaction>(callback => db.transaction(callback),
    "Effect exact-attempt work failed; roll back the transaction.", tx =>
      Effect.uninterruptible(Effect.gen(function* () {
        const admission = Effect.gen(function* () {
          const installed = installedAuthority === undefined ? undefined :
            yield* installedAuthority.lock(tx, input.selector, clockProtection);
          if (installed === undefined) yield* lockInstallationForCurrentTransaction(tx);
          const locked = yield* runPointCommitPromiseEffect(() => lockExactRunningAttemptInTransaction(
            tx, input, afterLoadLock, clockProtection,
            installed === undefined ? undefined : decodeLockedPointMutationSessionClock(installed.row)), cause => cause);
          const context = yield* Effect.fromResult(runningAttemptKernelContextResult(locked, tx));
          openProtectedMetadataFinalGuardScope(tx);
          openExactAttemptScopeClockObservation(tx, locked.clock.record,
            locked.clock.authorizationRevocationEpoch, clockProtection);
          return context;
        }).pipe(Effect.catchCause(cause => Effect.failCause(Cause.map(cause,
          failure => new ExactRunningAttemptTransactionV1Error({ cause: failure, callbackCause: undefined })))));
        const context = yield* admission;
        if (installedAuthority !== undefined) {
          if (controlProtection === undefined) return yield* Effect.die("Installed attempt lost its protected control preparation");
          yield* registerProtectedMetadataTransactionFinalGuard(controlProtection, db, tx).pipe(Effect.mapError(cause =>
            new ExactRunningAttemptTransactionV1Error({ cause, callbackCause: undefined })));
        }
        const value = yield* Effect.suspend(() => work(tx, context));
        yield* flushProtectedMetadataFinalGuards(tx).pipe(Effect.mapError(cause =>
          new ExactRunningAttemptTransactionV1Error({ cause, callbackCause: undefined })));
        return value;
      }).pipe(Effect.ensuring(Effect.sync(() => {
        closeExactAttemptScopeClockObservation(tx);
        closeFiniteExecutionAuthorityObservation(tx);
        finiteEntryLeaseExpectations.delete(tx);
        closeProtectedMetadataFinalGuardScope(tx);
        closeInstallationAdmission(tx);
      })))), cause => new ExactRunningAttemptTransactionV1Error({ cause, callbackCause: undefined })));
}

async function activateInTransaction(
  tx: AppRowTransaction,
  input: LocatedPointMutationSessionActivationInputV1,
  afterWrite:
    | LocatedPointMutationSessionActivationTargetOptionsV1["afterWrite"]
    | undefined,
): Promise<PointMutationSessionActivationResultV1> {
  const clock = await lockPointMutationSessionClock(
    tx,
    input.prepared.scopeId,
  );
  projectTransactionSessionActivationResult(requireStableAuthority(clock, input));
  return activateAfterLockedClock(tx, input, clock, afterWrite);
}

async function activateAfterLockedClock(
  tx: AppRowTransaction,
  input: LocatedPointMutationSessionActivationInputV1,
  clock: LockedPointMutationSessionClockV1,
  afterWrite:
    | LocatedPointMutationSessionActivationTargetOptionsV1["afterWrite"]
    | undefined,
): Promise<PointMutationSessionActivationResultV1> {
  const matchingSessions = await lockSessionsByRequestKey(tx, input, clock);
  if (matchingSessions.length > 1) {
    throw corruptionError(input.prepared.scopeId, "duplicateRequestAnchors");
  }
  const existing = matchingSessions[0];
  if (existing !== undefined) {
    return replayExistingSession(tx, input.prepared, clock, existing);
  }
  if (clock.record.lastCommitSeq !== input.preliminaryAuthority.lastCommitSeq) {
    throw activationError({ reason: "snapshotCommitSeqChanged" });
  }
  return createSession(
    tx,
    input,
    clock,
    await readDatabaseNow(tx, input.prepared.scopeId),
    afterWrite,
  );
}

async function replayApplicationSessionIfPresent(
  tx: AppRowTransaction,
  input: LocatedPointMutationSessionActivationInputV1,
  clock: LockedPointMutationSessionClockV1,
): Promise<PointMutationSessionActivationResultV1 | null> {
  const matchingSessions = await lockSessionsByRequestKey(tx, input, clock);
  if (matchingSessions.length > 1) {
    throw corruptionError(input.prepared.scopeId, "duplicateRequestAnchors");
  }
  const existing = matchingSessions[0];
  return existing === undefined
    ? null
    : replayExistingSession(tx, input.prepared, clock, existing);
}

function lockSessionsByRequestKey(
  tx: AppRowTransaction,
  input: LocatedPointMutationSessionActivationInputV1,
  clock: LockedPointMutationSessionClockV1,
) {
  return tx.select().from(fxSystemTransactionSessions).where(and(
    eq(fxSystemTransactionSessions.scopeUuid, clock.scopeUuid),
    eq(fxSystemTransactionSessions.requestKey, input.prepared.evidence.requestKey),
  )).orderBy(asc(fxSystemTransactionSessions.sessionId)).limit(2).for("update");
}

/** The finite profile has one durable session anchor, never a journal facet. */
const prepareProvisionalFiniteSessionEffect = Effect.fn("ApplicationMutationSessionActivation.prepareFiniteSession")(
  function* (tx: AppRowTransaction, input: LocatedPointMutationSessionActivationInputV1,
    clock: LockedPointMutationSessionClockV1, afterWrite: LocatedPointMutationSessionActivationTargetOptionsV1["afterWrite"],
    installed: boolean, databaseNow: Date) {
    const evidence = input.prepared.evidence;
    const hardExpiresAt = cloneValidDate(evidence.authorizationGrantExpiresAt);
    const leaseExpiresAt = yield* Effect.fromResult(deriveInitialLeaseExpiry(databaseNow, hardExpiresAt, input.leaseDurationMilliseconds));
    const snapshotToken = SnapshotTokenSchema.make({ scopeId: input.prepared.scopeId, epoch: clock.record.epoch,
      commitSeq: clock.record.lastCommitSeq });
    const claim = yield* Effect.fromResult(deriveTransactionExecutionClaimV1({ scopeUuid: clock.scopeUuid,
      sessionId: input.candidateSessionId, attemptFence: INITIAL_ATTEMPT_FENCE, claimFence: 1n, claimOwner: input.executionClaimOwner,
      databaseNow, durationMilliseconds: input.executionClaimDurationMilliseconds, leaseExpiresAt,
      authorizationGrantExpiresAt: evidence.authorizationGrantExpiresAt, hardExpiresAt }).pipe(Result.mapError(reason =>
      reason === "authorityExpired" ? activationError({ reason: "authorizationGrantExpired" }) :
        corruptionError(input.prepared.scopeId, "sessionRecordInvalid"))));
    const session = { scopeUuid: clock.scopeUuid, sessionId: input.candidateSessionId,
      storageGeneration: FlarexDbV1StorageGenerationSchema.make("flarexdb_v1"), storageGenerationFence: clock.record.storageGenerationFence,
      ...evidence, executionProfile: "finiteRoot" as const,
      finiteAttemptBytes: null, finiteAttemptSha256: null, finiteMetadataWatermark: null,
      finiteSnapshotEpochUuid: projectScopeEpochUuidV1(snapshotToken.epoch).epochUuid,
      finiteSnapshotCommitSeq: snapshotToken.commitSeq,
      lifecycle: "running" as const, attemptFence: INITIAL_ATTEMPT_FENCE,
      protocolVersion: TRANSACTION_SESSION_PROTOCOL_VERSION_V1, hardExpiresAt, createdAt: databaseNow, updatedAt: databaseNow,
      finiteLeaseExpiresAt: leaseExpiresAt, finiteClaimOwner: claim.claimOwner, finiteClaimFence: claim.claimFence,
      finiteClaimedAt: claim.claimedAt, finiteClaimExpiresAt: claim.claimExpiresAt } satisfies TransactionSessionRow;
    // This private owner-authored state is inert until complete insertion and
    // acknowledged COMMIT. In particular, no empty durable anchor is created.
    finiteEntryAnchorExpectations.set(tx, Object.freeze({ session, snapshotToken, provisional: true,
      schemaName: input.preliminaryAuthority.physicalLocator.schemaName, afterWrite, installed }));
    const finiteAttempt: FiniteAttemptAnchorContext = Object.freeze({ session, snapshotToken, reservation: null,
      leaseExpiresAt, executionClaim: Object.freeze({ claimOwner: claim.claimOwner, claimFence: claim.claimFence,
        claimedAt: claim.claimedAt.toISOString(), claimExpiresAt: claim.claimExpiresAt.toISOString() }) });
    const context = yield* finiteEntryAttemptContextFromAnchor(finiteAttempt, input.prepared.deploymentId, clock.record, databaseNow);
    return Object.freeze({ activation: activationResult("created", context.anchor, context.executionClaim), context });
  });

const finiteAttemptContextScalars = Effect.fn("ApplicationMutationSessionActivation.finiteEntryContext")(
  function* <Session extends FiniteAttemptFrontierRow>(finiteAttempt: FiniteAttemptAnchorContext<Session>, deploymentId: PointMutationSessionAttemptSelectorV1["deploymentId"],
    scopeId: PointMutationSessionAttemptSelectorV1["scopeId"], databaseNow: Date) {
    const session = finiteAttempt.session;
    if (session.storageGeneration !== "flarexdb_v1") {
      return yield* Effect.fail(corruptionError(scopeId, "sessionRecordInvalid"));
    }
    const schemaVersionId = yield* Effect.fromResult(decodeCheckedSchemaVersionIdResult(session.schemaVersionId)
      .pipe(Result.mapError(cause => corruptionError(scopeId, "sessionRecordInvalid", cause))));
    if (!isUint8ArrayWithByteLength(session.identityAccessPolicySha256, 32))
      return yield* Effect.fail(corruptionError(scopeId, "sessionRecordInvalid"));
    return Object.freeze({ scopeUuid: session.scopeUuid, session, finiteAttempt,
      anchor: Object.freeze({ deploymentId, scopeId: scopeId, sessionId: session.sessionId, requestKey: session.requestKey,
        executionProfile: "finiteRoot" as const, storageGeneration: FlarexDbV1StorageGenerationSchema.make("flarexdb_v1"),
        storageGenerationFence: session.storageGenerationFence, attemptFence: session.attemptFence,
        snapshotToken: finiteAttempt.snapshotToken, hardExpiresAt: session.hardExpiresAt.toISOString(),
        leaseExpiresAt: finiteAttempt.leaseExpiresAt.toISOString(), createdAt: session.createdAt.toISOString(), updatedAt: session.updatedAt.toISOString() }),
      executionPin: Object.freeze({ schemaVersionId, functionPath: session.functionPath, functionKind: session.functionKind, executionModule: session.executionModule }),
      executionAuthorityGeneration: session.executionAuthorityGeneration, principalDigest: encodeBytesToLowercaseHex(session.identityAccessPolicySha256),
      authorizationGrantExpiresAtMilliseconds: session.authorizationGrantExpiresAt.getTime(), hardExpiresAtMilliseconds: session.hardExpiresAt.getTime(),
      databaseNow, executionClaim: finiteAttempt.executionClaim });
  });

export const finiteEntryAttemptContextFromAnchor = Effect.fn("ApplicationMutationSessionActivation.finiteEntryContext")(
  function* (finiteAttempt: FiniteAttemptAnchorContext, deploymentId: PointMutationSessionAttemptSelectorV1["deploymentId"],
    scopeClock: ScopeClockRecord, databaseNow: Date) {
    return Object.freeze({ ...yield* finiteAttemptContextScalars(finiteAttempt, deploymentId, decodeReplacementScopeIdV1(scopeClock.scopeId), databaseNow), scopeClock });
  });

const finiteEntryAnchorExpectations = new WeakMap<AppRowTransaction, Readonly<{
  session: TransactionSessionRow;
  snapshotToken: SnapshotToken;
  provisional?: true;
  schemaName?: string;
  afterWrite?: LocatedPointMutationSessionActivationTargetOptionsV1["afterWrite"];
  installed?: boolean;
}>>();

/** Only the private entry issuer can defer the projection check to complete insertion. */
export function hasProvisionalFiniteEntry(tx: AppRowTransaction): boolean {
  return finiteEntryAnchorExpectations.get(tx)?.provisional === true;
}

const FiniteEntryCompletionVerdict = Schema.Struct({
  reason: Schema.Literals(["accepted", "protectedMetadataChanged", "expired", "sessionIdCollision", "storedCorruption"]),
  databaseNow: Schema.NullOr(Schema.Date),
  leaseExpiresAt: Schema.NullOr(Schema.Date), claimExpiresAt: Schema.NullOr(Schema.Date),
  metadataVerdict: Schema.Unknown, guardValid: Schema.NullOr(Schema.Boolean),
});
const decodeFiniteEntryCompletionVerdict = Schema.decodeUnknownResult(FiniteEntryCompletionVerdict);

/** One complete insertion followed by an actual stored-row read inside the
 * installed owner. INSERT RETURNING alone cannot see AFTER-trigger changes. */
const completeProvisionalFiniteEntry = Effect.fn("ApplicationMutationSessionActivation.completeFiniteEntry")(
  function* (tx: AppRowTransaction, context: FiniteEntryAttemptKernelContext,
    anchor: import("./finiteAttemptAnchor").CapturedFiniteAttemptAnchor,
    projection: PreparedFiniteMetadataProjection, schemaName: string, installed: boolean,
    afterWrite: LocatedPointMutationSessionActivationTargetOptionsV1["afterWrite"]) {
    const scopeId = context.anchor.scopeId;
    const expected = finiteEntryAnchorExpectations.get(tx);
    if (expected?.provisional !== true || !sessionAnchorRowsEqual(expected.session, context.session))
      return yield* Effect.fail(corruptionError(scopeId, "sessionRecordInvalid"));
    const metadata = yield* Effect.fromResult(prepareFiniteMetadataEntryComparison(projection))
      .pipe(Effect.mapError(cause => new SessionJournalPersistenceV1Error({ operation: "openAttempt", cause })));
    const guard = installed ? yield* prepareProtectedMetadataFinalGuardBatch(tx).pipe(Effect.mapError(cause =>
      new SessionJournalPersistenceV1Error({ operation: "openAttempt", cause }))) : undefined;
    if (guard === undefined) {
      yield* submitFiniteMetadataEntryComparisonEffect(tx, scopeId, context.scopeClock.lastMetadataSequence, metadata)
        .pipe(Effect.mapError(cause => new SessionJournalPersistenceV1Error({ operation: "openAttempt", cause })));
      yield* flushProtectedMetadataFinalGuards(tx).pipe(Effect.mapError(cause =>
        new SessionJournalPersistenceV1Error({ operation: "openAttempt", cause })));
    }
    const columns = Object.entries(getTableColumns(fxSystemTransactionSessions));
    const row = sql`row(${sql.join(columns.map(([key, column]) =>
      sql`${sql.param(Reflect.get(expected.session, key), column)}::${sql.raw(column.getSQLType())}`), sql`, `)})
      ::${sql.identifier(schemaName)}.fx_finite_entry_expected`;
    // Materialization performs the genuine comparison once. CASE never acquires
    // an epoch lock for a known metadata refusal, including NOWAIT contention.
    const source = guard === undefined ? sql`(values (true, null::jsonb))` : sql`(
      with metadata_check as materialized (select ${sql.identifier(schemaName)}.fx_compare_finite_metadata(
        ${scopeId}::text, ${context.scopeClock.lastMetadataSequence.toString()}::bigint,
        ${encodeFiniteMetadataComparison(metadata)}::jsonb) as verdict),
      epoch_check as materialized (select case when verdict->>'reason' = 'accepted'
        then (select valid from ${guard.source} as actual_epoch(valid)) else null::boolean end as valid,
        verdict from metadata_check)
      select valid, verdict from epoch_check)`;
    const rows = yield* runDrizzleStatementEffect(tx.select({
      guardValid: sql<boolean | null>`epoch_guard.valid`, reason: sql<string>`completion.reason`,
      databaseNow: sql`completion.database_now`.mapWith(fxSystemTransactionSessions.createdAt),
      leaseExpiresAt: sql`completion.lease_expires_at`.mapWith(fxSystemTransactionSessions.finiteLeaseExpiresAt),
      claimExpiresAt: sql`completion.claim_expires_at`.mapWith(fxSystemTransactionSessions.finiteClaimExpiresAt),
      metadataVerdict: sql<unknown>`epoch_guard.verdict`,
    }).from(sql`${source} as epoch_guard(valid, verdict) cross join lateral
      ${sql.identifier(schemaName)}.fx_complete_finite_entry(${row}, epoch_guard.valid) completion`), mapActivationTransactionError);
    if (rows.length !== 1) return yield* Effect.fail(corruptionError(scopeId, "sessionRecordInvalid"));
    const verdict = yield* Effect.fromResult(decodeFiniteEntryCompletionVerdict(rows[0])).pipe(
      Effect.mapError(cause => corruptionError(scopeId, "sessionRecordInvalid", cause)));
    if (guard !== undefined) {
      yield* Effect.fromResult(acceptFiniteMetadataEntryComparisonVerdict(verdict.metadataVerdict, metadata, context.scopeClock.lastMetadataSequence)
        .pipe(Result.mapError(cause => new SessionJournalPersistenceV1Error({ operation: "openAttempt", cause }))));
      // Only accepted metadata may correlate with an evaluated Boolean guard.
      // NULL denotes the unexecuted metadata-refusal branch.
      if (verdict.guardValid === null) return yield* Effect.fail(corruptionError(scopeId, "sessionRecordInvalid"));
      yield* acceptProtectedMetadataFinalGuardBatch(tx, [{ valid: verdict.guardValid }])
        .pipe(Effect.mapError(cause => new SessionJournalPersistenceV1Error({ operation: "openAttempt", cause })));
    }
    if (verdict.reason === "expired") return yield* Effect.fail(new FiniteAttemptAnchorError({ reason: "expired" }));
    if (verdict.reason === "sessionIdCollision") return yield* Effect.fail(activationError({ reason: "sessionIdCollision" }));
    if (verdict.reason !== "accepted") return yield* Effect.fail(corruptionError(scopeId, "sessionRecordInvalid"));
    const { databaseNow, leaseExpiresAt, claimExpiresAt } = verdict;
    if (databaseNow === null || leaseExpiresAt === null || claimExpiresAt === null ||
      ![databaseNow, leaseExpiresAt, claimExpiresAt].every(date => Number.isSafeInteger(date.getTime())))
      return yield* Effect.fail(corruptionError(scopeId, "sessionRecordInvalid"));
    const current = context.finiteAttempt;
    const projected = yield* Effect.fromResult(projectExecutionClaimRenewalV1Result({
      databaseNowMilliseconds: databaseNow.getTime(), currentLeaseExpiresAtMilliseconds: current.leaseExpiresAt.getTime(),
      currentClaimExpiresAtMilliseconds: Date.parse(current.executionClaim.claimExpiresAt),
      authorizationGrantExpiresAtMilliseconds: context.authorizationGrantExpiresAtMilliseconds,
      hardExpiresAtMilliseconds: context.hardExpiresAtMilliseconds,
      claimDurationMilliseconds: Date.parse(current.executionClaim.claimExpiresAt) - Date.parse(current.executionClaim.claimedAt),
      leaseRenewalDurationMilliseconds: current.leaseExpiresAt.getTime() - Date.parse(current.executionClaim.claimedAt),
      maximumLiveSnapshotRetentionMilliseconds: current.leaseExpiresAt.getTime() - Date.parse(current.executionClaim.claimedAt),
      phase: "open",
    }).pipe(Result.mapError(mapExecutionClaimRenewalIssue)));
    if (leaseExpiresAt.getTime() !== projected.targetLeaseExpiresAtMilliseconds ||
      claimExpiresAt.getTime() !== projected.targetClaimExpiresAtMilliseconds)
      return yield* Effect.fail(corruptionError(scopeId, "sessionRecordInvalid"));
    const session = { ...expected.session, finiteLeaseExpiresAt: leaseExpiresAt, finiteClaimExpiresAt: claimExpiresAt };
    const accepted = yield* readFiniteAttemptAnchorRow(session, anchor);
    finiteEntryAnchorExpectations.set(tx, Object.freeze({ session, snapshotToken: expected.snapshotToken }));
    if (afterWrite !== undefined) {
      yield* runPointCommitPromiseEffect(async () => afterWrite("sessionInserted"), mapActivationTransactionError);
      // The test hook may perform a real trusted write after the installed
      // proof. Such a mutation requires a new complete actual-row correlation.
      yield* requireCorrelatedFiniteEntryEffect(tx, scopeId);
    }
    return Object.freeze({ ...context, session, finiteAttempt: accepted, databaseNow,
      executionClaim: accepted.executionClaim, anchor: Object.freeze({ ...context.anchor,
        leaseExpiresAt: leaseExpiresAt.toISOString() }) });
  });

/** Bind each owner-authored column once. The database compares the complete
 * previous and resulting rows, including changes made by BEFORE triggers. */
function correlatedFiniteSessionUpdateStatement(tx: AppRowTransaction,
  previous: Readonly<TransactionSessionRow>, changes: Readonly<Partial<TransactionSessionRow>>) {
  const projectionName = "finite_entry_row";
  const fields: Record<string, SQL.Aliased> = {};
  const updates: Record<string, SQL> = {};
  const previousChecks: SQL[] = [], resultingChecks: SQL[] = [];
  const reference = (name: string) => sql`${sql.identifier(projectionName)}.${sql.identifier(name)}`;
  for (const [key, column] of Object.entries(getTableColumns(fxSystemTransactionSessions))) {
    const originalName = `original_${key}`;
    fields[originalName] = sql`${sql.param(Reflect.get(previous, key), column)}::${sql.raw(column.getSQLType())}`.as(originalName);
    previousChecks.push(sql`${column} is not distinct from ${reference(originalName)}`);
    if (Object.hasOwn(changes, key)) {
      const resultingName = `resulting_${key}`;
      fields[resultingName] = sql`${sql.param(Reflect.get(changes, key), column)}::${sql.raw(column.getSQLType())}`.as(resultingName);
      updates[key] = reference(resultingName);
      resultingChecks.push(sql`${column} is not distinct from ${reference(resultingName)}`);
    } else {
      resultingChecks.push(sql`${column} is not distinct from ${reference(originalName)}`);
    }
  }
  const projection = tx.$with(projectionName).as(tx.select(fields)
    .from(sql`(values (true)) as finite_entry_source(present)`));
  return tx.with(projection).update(fxSystemTransactionSessions).set(updates).from(projection)
    .where(sql.join(previousChecks, sql` and `))
    .returning({ matches: sql<boolean>`(${sql.join(resultingChecks, sql` and `)})` });
}

/** The same transaction that issued entry owns its final post-wait admission.
 * No historical session row or confirmed-entry handle can request this write. */
export const acceptFiniteEntryForContinuationInTransactionEffect = Effect.fn("ApplicationMutationSessionActivation.acceptFiniteContinuation")(
  function* (tx: AppRowTransaction, context: FiniteEntryAttemptKernelContext,
    anchor: import("./finiteAttemptAnchor").CapturedFiniteAttemptAnchor,
    projection?: PreparedFiniteMetadataProjection) {
    const expected = finiteEntryAnchorExpectations.get(tx);
    const scopeId = context.anchor.scopeId;
    if (expected === undefined || !sessionAnchorRowsEqual(expected.session, context.session))
      return yield* Effect.fail(corruptionError(scopeId, "sessionRecordInvalid"));
    if (expected.provisional === true) {
      if (projection === undefined || expected.schemaName === undefined)
        return yield* Effect.fail(corruptionError(scopeId, "sessionRecordInvalid"));
      return yield* completeProvisionalFiniteEntry(tx, context, anchor, projection, expected.schemaName, expected.installed === true, expected.afterWrite);
    }
    const session = expected.session;
    const current = yield* readFiniteAttemptAnchorRow(session, anchor);
    const databaseNow = yield* Effect.tryPromise({ try: () => readDatabaseNow(tx, scopeId), catch: mapActivationTransactionError });
    yield* Effect.fromResult(requireFiniteAttemptIsLive(current, databaseNow));
    const claimedAt = Date.parse(current.executionClaim.claimedAt);
    const claimDurationMilliseconds = Date.parse(current.executionClaim.claimExpiresAt) - claimedAt;
    const leaseDurationMilliseconds = current.leaseExpiresAt.getTime() - claimedAt;
    const projected = yield* Effect.fromResult(projectExecutionClaimRenewalV1Result({
      databaseNowMilliseconds: databaseNow.getTime(), currentLeaseExpiresAtMilliseconds: current.leaseExpiresAt.getTime(),
      currentClaimExpiresAtMilliseconds: Date.parse(current.executionClaim.claimExpiresAt),
      authorizationGrantExpiresAtMilliseconds: session.authorizationGrantExpiresAt.getTime(),
      hardExpiresAtMilliseconds: session.hardExpiresAt.getTime(), claimDurationMilliseconds,
      leaseRenewalDurationMilliseconds: leaseDurationMilliseconds, maximumLiveSnapshotRetentionMilliseconds: leaseDurationMilliseconds,
      phase: "open",
    }).pipe(Result.mapError(mapExecutionClaimRenewalIssue)));
    const next = { ...session, finiteLeaseExpiresAt: new Date(projected.targetLeaseExpiresAtMilliseconds),
      finiteClaimExpiresAt: new Date(projected.targetClaimExpiresAtMilliseconds) };
    const rows = yield* runDrizzleStatementEffect(correlatedFiniteSessionUpdateStatement(tx, session, {
      finiteLeaseExpiresAt: next.finiteLeaseExpiresAt, finiteClaimExpiresAt: next.finiteClaimExpiresAt,
    }), mapActivationTransactionError);
    if (rows.length !== 1 || rows[0]?.matches !== true)
      return yield* Effect.fail(corruptionError(scopeId, "sessionRecordInvalid"));
    const accepted = yield* readFiniteAttemptAnchorRow(next, anchor);
    finiteEntryAnchorExpectations.set(tx, Object.freeze({ ...expected, session: next }));
    return yield* finiteEntryAttemptContextFromAnchor(accepted, context.anchor.deploymentId, context.scopeClock, databaseNow);
  });

/** Complete private entry construction without creating a durable placeholder.
 * Replacement retains the existing exact-row update of its durable anchor. */
export const captureFiniteAttemptReservationInTransaction = Effect.fn("ApplicationMutationSessionActivation.captureFiniteMetadata")(
  function* (tx: AppRowTransaction, selector: PointMutationSessionAttemptSelectorV1,
    reservation: CapturedFiniteMetadataReservation) {
    const expected = finiteEntryAnchorExpectations.get(tx);
    if (expected === undefined)
      return yield* Effect.fail(corruptionError(selector.scopeId, "sessionRecordInvalid"));
    const { session, snapshotToken } = expected;
    if (session.lifecycle !== "running" || session.finiteMetadataWatermark !== null)
      return yield* Effect.fail(new FiniteAttemptAnchorError({ reason: "lifecycleChanged" }));
    const issued = readCapturedFiniteMetadataReservation(reservation);
    if (issued === null || issued.deploymentId !== selector.deploymentId || issued.sessionId !== selector.sessionId ||
      issued.attemptFence !== selector.attemptFence || issued.scopeId !== selector.scopeId ||
      session.sessionId !== selector.sessionId || session.attemptFence !== selector.attemptFence ||
      snapshotToken.scopeId !== selector.scopeId || issued.storageGenerationFence !== session.storageGenerationFence ||
      issued.schemaVersionId !== session.schemaVersionId)
      return yield* Effect.fail(new FiniteAttemptAnchorError({ reason: "invalidInput" }));
    const anchor = yield* captureFiniteAttemptAnchor({ snapshotToken, reservation });
    const values = yield* Effect.fromResult(projectCapturedFiniteAttemptAnchor(anchor));
    if (expected.provisional !== true) {
      const rows = yield* runDrizzleStatementEffect(correlatedFiniteSessionUpdateStatement(tx, session, values),
        cause => new FiniteAttemptAnchorError({ reason: "resourceFailure", cause }));
      if (rows.length !== 1) return yield* Effect.fail(new FiniteAttemptAnchorError({ reason: "storedCorruption" }));
      if (rows[0]?.matches !== true)
        return yield* Effect.fail(corruptionError(selector.scopeId, "sessionRecordInvalid"));
    }
    const complete = { ...session, ...values };
    const context = yield* readFiniteAttemptAnchorRow(complete, anchor);
    finiteEntryAnchorExpectations.set(tx, Object.freeze({ ...expected, session: complete }));
    return Object.freeze({ anchor, context });
  },
);

function sessionAnchorRowsEqual(left: Readonly<TransactionSessionRow>, right: Readonly<TransactionSessionRow>): boolean {
  return Object.keys(getTableColumns(fxSystemTransactionSessions)).every(key => {
    const a = Reflect.get(left, key), b = Reflect.get(right, key);
    return a === b || a instanceof Uint8Array && b instanceof Uint8Array && bytesEqual(a, b) ||
      a instanceof Date && b instanceof Date && a.getTime() === b.getTime() ||
      a !== null && b !== null && typeof a === "object" && typeof b === "object" && nullableJsonEqual(a, b);
  });
}

export const requireCorrelatedFiniteEntryEffect = Effect.fn("ApplicationMutationSessionActivation.correlateFiniteEntry")(
  function* (tx: AppRowTransaction, scopeId: ReplacementScopeIdV1) {
    const capture = finiteEntryAnchorExpectations.get(tx);
    if (capture === undefined) return yield* Effect.fail(corruptionError(scopeId, "sessionRecordInvalid"));
    const expected = capture.session;
    // Preparation authenticates an inert issuer, not an absent stored row.
    // The completion function proves every stored column after the sole INSERT.
    if (capture.provisional === true) return;
    const rows = yield* Effect.tryPromise({ try: () => tx.select({ matches: sql<boolean>`(${freshSessionRowCorrelationSql(fxSystemTransactionSessions, expected)})` })
      .from(fxSystemTransactionSessions).where(and(eq(fxSystemTransactionSessions.scopeUuid, expected.scopeUuid),
        eq(fxSystemTransactionSessions.sessionId, expected.sessionId))).limit(2), catch: mapActivationTransactionError });
    if (rows.length !== 1 || rows[0]?.matches !== true) return yield* Effect.fail(corruptionError(scopeId, "sessionRecordInvalid"));
  });

async function createSession(
  tx: AppRowTransaction,
  input: LocatedPointMutationSessionActivationInputV1,
  clock: LockedPointMutationSessionClockV1,
  databaseNow: Date,
  afterWrite:
    | LocatedPointMutationSessionActivationTargetOptionsV1["afterWrite"]
    | undefined,
  captureProjection?: (projection: FreshSessionEntryProjection) => void,
): Promise<PointMutationSessionActivationResultV1> {
  if (input.prepared.executionProfile !== "durableOperations") {
    return Promise.reject(activationError({ reason: "invalidPreparedEvidence" }));
  }
  const evidence = input.prepared.evidence;
  const hardExpiresAt = cloneValidDate(evidence.authorizationGrantExpiresAt);
  const leaseExpiresAt = projectTransactionSessionActivationResult(deriveInitialLeaseExpiry(
    databaseNow,
    hardExpiresAt,
    input.leaseDurationMilliseconds,
  ));
  const sessionRow = {
      executionProfile: "durableOperations" as const, finiteAttemptBytes: null, finiteAttemptSha256: null,
      finiteSnapshotEpochUuid: null, finiteSnapshotCommitSeq: null, finiteMetadataWatermark: null,
      finiteLeaseExpiresAt: null, finiteClaimOwner: null, finiteClaimFence: null, finiteClaimedAt: null, finiteClaimExpiresAt: null,
      scopeUuid: clock.scopeUuid,
      sessionId: input.candidateSessionId,
      storageGeneration: FlarexDbV1StorageGenerationSchema.make("flarexdb_v1"),
      storageGenerationFence: clock.record.storageGenerationFence,
      ...evidence,
      lifecycle: "running",
      attemptFence: INITIAL_ATTEMPT_FENCE,
      protocolVersion: TRANSACTION_SESSION_PROTOCOL_VERSION_V1,
      hardExpiresAt,
      createdAt: databaseNow,
      updatedAt: databaseNow,
    } satisfies typeof fxSystemTransactionSessions.$inferSelect;
  const inserted = await tx
    .insert(fxSystemTransactionSessions)
    .values(sessionRow)
    .onConflictDoNothing({
      target: [
        fxSystemTransactionSessions.scopeUuid,
        fxSystemTransactionSessions.sessionId,
      ],
    })
    .returning({ sessionId: fxSystemTransactionSessions.sessionId });
  if (inserted[0] === undefined) {
    throw activationError({ reason: "sessionIdCollision" });
  }
  await afterWrite?.("sessionInserted");

  const leaseRow = {
    scopeUuid: clock.scopeUuid,
    sessionId: input.candidateSessionId,
    attemptFence: INITIAL_ATTEMPT_FENCE,
    snapshotEpochUuid: clock.epochUuid,
    snapshotCommitSeq: clock.record.lastCommitSeq,
    metadataWatermark: null, finiteMetadataReservationBytes: null, finiteMetadataReservationSha256: null,
    leaseExpiresAt,
  } satisfies typeof fxSystemSnapshotLeases.$inferSelect;
  await tx.insert(fxSystemSnapshotLeases).values(leaseRow);
  await afterWrite?.("leaseInserted");

  const databaseNowMilliseconds = finiteDateMilliseconds(databaseNow);
  if (databaseNowMilliseconds === undefined) {
    throw corruptionError(input.prepared.scopeId, "databaseClockInvalid");
  }
  const creationTimeSeed = decodeAppCreationTimeV1(databaseNowMilliseconds);
  const journalRow = {
    scopeUuid: clock.scopeUuid,
    sessionId: input.candidateSessionId,
    attemptFence: INITIAL_ATTEMPT_FENCE,
    journalFormat: SESSION_JOURNAL_FORMAT,
    executionProfile: input.prepared.executionProfile,
    state: "open",
    lastSyscallSequence: CommitFinalSyscallSequenceV1Schema.make(0n),
    receiptEvidenceBytes: 0,
    participantWorkBytes: 0,
    participantWorkCalls: 0,
    creationTimeSeed,
    nextCreationTime: creationTimeSeed,
    readDocuments: 0,
    readSemanticBytes: 0,
    pointDependencyCount: 0,
    indexedQuerySyscalls: 0,
    indexRangeDependencyCount: 0,
    indexRangeDependencyEvidenceBytes: 0,
    relationReadSyscalls: 0,
    relationDependencyCount: 0,
    relationBaseOccurrences: 0,
    writeOperations: 0,
    writeSemanticBytes: 0,
    materialWriteEventEvidenceBytes:
      CommitMaterialWriteEventEvidenceBytesV1Schema.make(0),
    createdAt: databaseNow,
    updatedAt: databaseNow,
    failureDimension: null, sealedJournalBytes: null, sealedJournalSha256: null,
    sealedResultValueCodecVersion: null, sealedResultSemanticBytes: null, sealedResultBytes: null,
    sealedResultSha256: null, sealedAt: null,
  } satisfies typeof fxSystemTransactionJournals.$inferSelect;
  await tx.insert(fxSystemTransactionJournals).values(journalRow);
  await afterWrite?.("journalRootInserted");

  const executionClaim = deriveTransactionExecutionClaimV1({
    scopeUuid: clock.scopeUuid,
    sessionId: input.candidateSessionId,
    attemptFence: INITIAL_ATTEMPT_FENCE,
    claimFence: 1n,
    claimOwner: input.executionClaimOwner,
    databaseNow,
    durationMilliseconds: input.executionClaimDurationMilliseconds,
    leaseExpiresAt,
    authorizationGrantExpiresAt: evidence.authorizationGrantExpiresAt,
    hardExpiresAt,
  });
  const claimRow = Result.match(executionClaim, {
    onSuccess: (claim) => claim,
    onFailure: (failure) => {
      throw failure === "authorityExpired"
        ? activationError({ reason: "authorizationGrantExpired" })
        : corruptionError(input.prepared.scopeId, "sessionRecordInvalid");
    },
  });
  await tx.insert(fxSystemTransactionExecutionClaims).values(
    claimRow,
  );
  await afterWrite?.("executionClaimInserted");
  captureProjection?.(Object.freeze({ session: sessionRow, lease: leaseRow, root: journalRow, claim: claimRow }));

  return activationResult("created", {
    deploymentId: input.prepared.deploymentId,
    scopeId: input.prepared.scopeId,
    sessionId: input.candidateSessionId,
    requestKey: evidence.requestKey,
    executionProfile: input.prepared.executionProfile,
    storageGeneration: FlarexDbV1StorageGenerationSchema.make("flarexdb_v1"),
    storageGenerationFence: clock.record.storageGenerationFence,
    attemptFence: INITIAL_ATTEMPT_FENCE,
    snapshotToken: SnapshotTokenSchema.make({
      scopeId: input.prepared.scopeId,
      epoch: clock.record.epoch,
      commitSeq: clock.record.lastCommitSeq,
    }),
    hardExpiresAt: hardExpiresAt.toISOString(),
    leaseExpiresAt: leaseExpiresAt.toISOString(),
    createdAt: databaseNow.toISOString(),
    updatedAt: databaseNow.toISOString(),
  }, Object.freeze({
    claimOwner: claimRow.claimOwner,
    claimFence: claimRow.claimFence,
    claimedAt: claimRow.claimedAt.toISOString(),
    claimExpiresAt: claimRow.claimExpiresAt.toISOString(),
  }));
}

const finiteEntryLeaseExpectations = new WeakMap<AppRowTransaction, SnapshotLeaseRow>();
/** Root-only recognition of its checked reservation write; every other lease column stays exact. */
export function recognizeFiniteMetadataReservationUpdate(tx: AppRowTransaction,
  previous: Readonly<SnapshotLeaseRow>, updated: SnapshotLeaseRow,
): Result.Result<void, PointMutationSessionAuthorityCorruptionV1Error> {
  const expected = finiteEntryLeaseExpectations.get(tx);
  if (expected === undefined || expected.scopeUuid !== previous.scopeUuid || expected.sessionId !== previous.sessionId
    || expected.attemptFence !== previous.attemptFence || expected.snapshotEpochUuid !== previous.snapshotEpochUuid
    || expected.snapshotCommitSeq !== previous.snapshotCommitSeq || expected.leaseExpiresAt.getTime() !== previous.leaseExpiresAt.getTime()
    || expected.metadataWatermark !== previous.metadataWatermark
    || !nullableBytesEqual(expected.finiteMetadataReservationBytes, previous.finiteMetadataReservationBytes)
    || !nullableBytesEqual(expected.finiteMetadataReservationSha256, previous.finiteMetadataReservationSha256)
    || updated.scopeUuid !== expected.scopeUuid || updated.sessionId !== expected.sessionId || updated.attemptFence !== expected.attemptFence
    || updated.snapshotEpochUuid !== expected.snapshotEpochUuid || updated.snapshotCommitSeq !== expected.snapshotCommitSeq
    || updated.leaseExpiresAt.getTime() !== expected.leaseExpiresAt.getTime() || updated.metadataWatermark === null
    || updated.finiteMetadataReservationBytes === null || updated.finiteMetadataReservationSha256 === null
    || updated.finiteMetadataReservationBytes.byteLength < 1 || updated.finiteMetadataReservationBytes.byteLength > 65536
    || updated.metadataWatermark < 0n || updated.finiteMetadataReservationSha256.byteLength !== 32) return Result.fail(corruptionError(
      replacementScopeIdV1FromUuid(previous.scopeUuid), "snapshotLeaseInvalid"));
  finiteEntryLeaseExpectations.set(tx, updated);
  return Result.succeed(undefined);
}

interface FreshSessionEntryProjection {
  readonly session: typeof fxSystemTransactionSessions.$inferSelect;
  readonly lease: typeof fxSystemSnapshotLeases.$inferSelect;
  readonly root: typeof fxSystemTransactionJournals.$inferSelect;
  readonly claim: typeof fxSystemTransactionExecutionClaims.$inferSelect;
}

/** All actual final columns correlate on the server; no large payload crosses before this verdict. */
async function correlateFreshSessionEntryProjection(tx: AppRowTransaction, projection: FreshSessionEntryProjection,
  _scopeId: ReplacementScopeIdV1): Promise<boolean> {
  const session = projection.session;
  const rows = await tx.select({
    session: sql<boolean>`(${freshSessionRowCorrelationSql(fxSystemTransactionSessions, projection.session)})`,
    lease: sql<boolean>`(${freshSessionRowCorrelationSql(fxSystemSnapshotLeases, finiteEntryLeaseExpectations.get(tx) ?? projection.lease)})`,
    root: sql<boolean>`(${freshSessionRowCorrelationSql(fxSystemTransactionJournals, projection.root)})`,
    claim: sql<boolean>`(${freshSessionRowCorrelationSql(fxSystemTransactionExecutionClaims, projection.claim)})`,
    childrenAbsent: sql<boolean>`not exists (select 1 from ${fxSystemTransactionJournalReceipts} where ${fxSystemTransactionJournalReceipts.scopeUuid} = ${session.scopeUuid} and ${fxSystemTransactionJournalReceipts.sessionId} = ${session.sessionId} and ${fxSystemTransactionJournalReceipts.attemptFence} = ${session.attemptFence})
      and not exists (select 1 from ${fxSystemTransactionJournalPoints} where ${fxSystemTransactionJournalPoints.scopeUuid} = ${session.scopeUuid} and ${fxSystemTransactionJournalPoints.sessionId} = ${session.sessionId} and ${fxSystemTransactionJournalPoints.attemptFence} = ${session.attemptFence})
      and not exists (select 1 from ${fxSystemTransactionJournalIndexRanges} where ${fxSystemTransactionJournalIndexRanges.scopeUuid} = ${session.scopeUuid} and ${fxSystemTransactionJournalIndexRanges.sessionId} = ${session.sessionId} and ${fxSystemTransactionJournalIndexRanges.attemptFence} = ${session.attemptFence})
      and not exists (select 1 from ${fxSystemTransactionJournalRelationIncomingDependencies} where ${fxSystemTransactionJournalRelationIncomingDependencies.scopeUuid} = ${session.scopeUuid} and ${fxSystemTransactionJournalRelationIncomingDependencies.sessionId} = ${session.sessionId} and ${fxSystemTransactionJournalRelationIncomingDependencies.attemptFence} = ${session.attemptFence})
      and not exists (select 1 from ${fxSystemTransactionJournalWriteEvents} where ${fxSystemTransactionJournalWriteEvents.scopeUuid} = ${session.scopeUuid} and ${fxSystemTransactionJournalWriteEvents.sessionId} = ${session.sessionId} and ${fxSystemTransactionJournalWriteEvents.attemptFence} = ${session.attemptFence})`,
  }).from(fxSystemTransactionSessions)
    .innerJoin(fxSystemSnapshotLeases, and(eq(fxSystemSnapshotLeases.scopeUuid, fxSystemTransactionSessions.scopeUuid), eq(fxSystemSnapshotLeases.sessionId, fxSystemTransactionSessions.sessionId)))
    .innerJoin(fxSystemTransactionJournals, and(eq(fxSystemTransactionJournals.scopeUuid, fxSystemTransactionSessions.scopeUuid), eq(fxSystemTransactionJournals.sessionId, fxSystemTransactionSessions.sessionId), eq(fxSystemTransactionJournals.attemptFence, fxSystemTransactionSessions.attemptFence)))
    .innerJoin(fxSystemTransactionExecutionClaims, and(eq(fxSystemTransactionExecutionClaims.scopeUuid, fxSystemTransactionSessions.scopeUuid), eq(fxSystemTransactionExecutionClaims.sessionId, fxSystemTransactionSessions.sessionId), eq(fxSystemTransactionExecutionClaims.attemptFence, fxSystemTransactionSessions.attemptFence)))
    .where(and(eq(fxSystemTransactionSessions.scopeUuid, session.scopeUuid), eq(fxSystemTransactionSessions.sessionId, session.sessionId))).limit(2);
  return rows.length === 1 && rows[0] !== undefined && Object.values(rows[0]).every(value => value === true);
}

function freshSessionRowCorrelationSql(table: PgTable, expected: Readonly<Record<string, unknown>>): SQL {
  return sql.join(Object.entries(getTableColumns(table)).map(([key, column]) =>
    sql`${column} is not distinct from ${sql.param(expected[key], column)}`), sql` and `);
}

const requireCorrelatedFreshSessionEntryEffect = Effect.fn("ApplicationMutationSessionActivation.correlateFinalEntry")(
  function* (tx: AppRowTransaction, projection: FreshSessionEntryProjection, scopeId: ReplacementScopeIdV1) {
    const matches = yield* Effect.tryPromise({ try: () => correlateFreshSessionEntryProjection(tx, projection, scopeId), catch: mapActivationTransactionError });
    if (!matches) return yield* Effect.fail(corruptionError(scopeId, "sessionRecordInvalid"));
  });

/** The complete scalar verdict above proves these owner-authored bytes are the actual final stored rows. */
function projectCorrelatedFreshSessionEntry(input: LocatedPointMutationSessionActivationInputV1,
  clock: LockedPointMutationSessionClockV1, projection: FreshSessionEntryProjection):
  Result.Result<LockedRunningPointMutationSessionAttemptV1, PointMutationSessionAuthorityCorruptionV1Error> {
  const { session, lease, root, claim } = projection;
  return buildFreshTransactionAttemptFacetV1({ scopeUuid: clock.scopeUuid, sessionId: session.sessionId,
    attemptFence: session.attemptFence, executionProfile: root.executionProfile, snapshotEpochUuid: lease.snapshotEpochUuid,
    snapshotCommitSeq: lease.snapshotCommitSeq, databaseNowMilliseconds: session.createdAt.getTime(),
    authorizationGrantExpiresAtMilliseconds: session.authorizationGrantExpiresAt.getTime(), hardExpiresAtMilliseconds: session.hardExpiresAt.getTime(),
    leaseDurationMilliseconds: lease.leaseExpiresAt.getTime() - session.createdAt.getTime() }).pipe(
    Result.mapError(cause => corruptionError(input.prepared.scopeId, "journalRootInvalid", cause)),
    Result.flatMap(facet => !isPristineFreshTransactionAttemptJournalRootV1(root, facet.journalRoot)
      ? Result.fail(corruptionError(input.prepared.scopeId, "journalRootInvalid"))
      : inspectTransactionExecutionClaimV1Result(input.prepared.scopeId, claim).pipe(
    Result.mapError(cause => corruptionError(input.prepared.scopeId, "executionClaimInvalid", cause)),
    Result.map(executionClaim => ({ deploymentId: input.prepared.deploymentId, scopeId: input.prepared.scopeId,
      clock, session, journalRoot: root, executionClaim, databaseNow: session.createdAt,
      authorizationGrantExpiresAtMilliseconds: session.authorizationGrantExpiresAt.getTime(),
      hardExpiresAtMilliseconds: session.hardExpiresAt.getTime(),
      locked: { leaseState: "present" as const, sessionId: session.sessionId, attemptFence: session.attemptFence,
        storageGenerationFence: session.storageGenerationFence, lease, leaseExpiresAtMilliseconds: lease.leaseExpiresAt.getTime(),
        snapshotEpoch: replacementScopeEpochV1FromUuid(lease.snapshotEpochUuid), snapshotCommitSeq: lease.snapshotCommitSeq },
    })))),
  );
}

async function replayExistingSession(
  tx: AppRowTransaction,
  prepared: PreparedStoredMutationSessionActivationV1,
  clock: LockedPointMutationSessionClockV1,
  session: typeof fxSystemTransactionSessions.$inferSelect,
  acceptedDatabaseNow?: Date,
): Promise<PointMutationSessionActivationResultV1> {
  if (!sessionEvidenceMatches(session, prepared.evidence)) {
    throw activationError({ reason: "requestKeyConflict" });
  }
  if (session.executionProfile === "finiteRoot") {
    if (prepared.executionProfile !== "finiteRoot") {
      return Promise.reject(activationError({ reason: "requestKeyConflict" }));
    }
    const anchor = projectPointCommitTransactionResult(await runPointCommitInTransactionEffect(readFiniteAttemptAnchorRow(session).pipe(
      Effect.mapError(cause => corruptionError(prepared.scopeId, "sessionRecordInvalid", cause)))));
    const databaseNow = acceptedDatabaseNow ?? await readDatabaseNow(tx, prepared.scopeId);
    const context = projectPointCommitTransactionResult(await runPointCommitInTransactionEffect(finiteEntryAttemptContextFromAnchor(anchor, prepared.deploymentId, clock.record, databaseNow)));
    return activationResult("busy", context.anchor);
  }
  const loaded = await loadLockedRunningAttempt(
    tx,
    {
      deploymentId: prepared.deploymentId,
      scopeId: prepared.scopeId,
      failures: activationAttemptFailures,
      afterLeaseLock: undefined,
      claimRequirement: "present",
    },
    clock,
    session,
  );
  await observePointMutationSessionAttemptFacet(
    tx, loaded.clock, loaded.session, loaded.locked, loaded.journalRoot,
  );
  const context = projectTransactionSessionActivationResult(runningAttemptKernelContextResult(loaded));
  if (context.anchor.executionProfile !== prepared.executionProfile) {
    return Promise.reject(activationError({ reason: "requestKeyConflict" }));
  }
  return activationResult("busy", context.anchor);
}

async function loadAttemptInTransaction(
  tx: AppRowTransaction,
  input: LocatedPointMutationSessionAttemptLoadInputV1,
  afterLoadLock:
    | LocatedPointMutationSessionActivationTargetOptionsV1["afterLoadLock"]
    | undefined,
): Promise<PointMutationSessionAttemptLoadResultV1> {
  const clock = await lockPointMutationSessionClock(tx, input.selector.scopeId);
  await afterLoadLock?.("clockLocked");
  projectTransactionSessionActivationResult(requireStableAttemptLoadAuthority(clock, input));
  const session = await lockExactPointMutationSession(tx, input.selector, clock, attemptLoadExactSessionFailures, afterLoadLock);
  if (session.executionProfile === "finiteRoot") {
    const finiteAttempt = projectPointCommitTransactionResult(await runPointCommitInTransactionEffect(lockFiniteAttemptAnchorInTransaction(tx, input.selector).pipe(
      Effect.mapError(cause => corruptionError(input.selector.scopeId, "sessionRecordInvalid", cause)))));
    if (finiteAttempt.session.lifecycle !== "running") throw attemptLoadFailures.terminal(finiteAttempt.session.lifecycle);
    const databaseNow = await readDatabaseNow(tx, input.selector.scopeId);
    const context = projectPointCommitTransactionResult(await runPointCommitInTransactionEffect(finiteEntryAttemptContextFromAnchor(finiteAttempt, input.selector.deploymentId, clock.record, databaseNow)));
    // A recovered finite root has no retained callback graph. This observation
    // cannot authorize execution; outcome resolution and fencing must come first.
    return Object.freeze({ status: "loaded", lastMetadataSequence: clock.record.lastMetadataSequence,
      anchor: captureSessionAnchor(context.anchor), executionPin: context.executionPin, attemptFacet: { kind: "nonPristine" as const } });
  }
  const loaded = await loadLockedRunningAttempt(tx, {
    deploymentId: input.selector.deploymentId,
    scopeId: input.selector.scopeId,
    failures: attemptLoadFailures,
    afterLeaseLock: afterLoadLock,
    claimRequirement: "live",
  }, clock, session);
  const attemptFacet = await observePointMutationSessionAttemptFacet(
    tx, loaded.clock, loaded.session, loaded.locked, loaded.journalRoot,
  );
  return attemptLoadResult(projectTransactionSessionActivationResult(runningAttemptKernelContextResult(loaded)), attemptFacet);
}

async function lockExactRunningAttemptInTransaction(
  tx: AppRowTransaction,
  input:
    | ExactRunningAttemptKernelInputV1
    | LocatedPointMutationSessionAttemptLoadInputV1,
  afterLoadLock:
    | LocatedPointMutationSessionActivationTargetOptionsV1["afterLoadLock"]
    | undefined,
  clockProtection: "share" | "attempt",
  observedClock?: LockedPointMutationSessionClockV1,
): Promise<LockedRunningPointMutationSessionAttemptV1> {
  const selector = input.selector;
  const clock = observedClock ?? (clockProtection === "share"
    ? await lockPointMutationSessionClockForShare(tx, selector.scopeId)
    : await lockPointMutationSessionClock(tx, selector.scopeId));
  await afterLoadLock?.("clockLocked");
  projectTransactionSessionActivationResult(requireStableAttemptLoadAuthority(clock, input));
  const session = await lockExactPointMutationSession(
    tx,
    selector,
    clock,
    attemptLoadExactSessionFailures,
    afterLoadLock,
  );

  return loadLockedRunningAttempt(
    tx,
    {
      deploymentId: selector.deploymentId,
      scopeId: selector.scopeId,
      failures: attemptLoadFailures,
      afterLeaseLock: afterLoadLock,
      claimRequirement: "live",
      ...(!("executionClaim" in input) || input.executionClaim === undefined
        ? {}
        : { executionClaim: input.executionClaim }),
    },
    clock,
    session,
  );
}

/** Trusted replacement owner only: the caller owns this admitted transaction,
 * final guards and COMMIT. Close this capture after entry correlation, and
 * confirm the prepared finite entry only after that COMMIT succeeds. */
export const captureFiniteReplacementAttemptInTransactionEffect = Effect.fn(
  "PointMutationSessionActivation.captureFiniteReplacementAttemptInTransaction",
)(function* (tx: AppRowTransaction, input: ExactRunningAttemptKernelInputV1,
  original?: NonNullable<ReturnType<typeof import("./sessionJournalFiniteEntry").readOriginalFiniteExecutionAuthority>>) {
  yield* Effect.fromResult(requireAdmittedTargetInstallationSchema(tx));
  if (readFiniteExecutionAuthorityObservation(tx, input.selector.scopeId) !== undefined)
    return yield* Effect.fail(corruptionError(input.selector.scopeId, "sessionRecordInvalid"));
  const clock = yield* Effect.tryPromise({ try: () => lockPointMutationSessionClock(tx, input.selector.scopeId),
    catch: mapAttemptLoadTransactionError });
  yield* Effect.fromResult(requireStableAttemptLoadAuthority(clock, input));
  const finiteAttempt = yield* lockFiniteAttemptAnchorInTransaction(tx, input.selector, input.executionClaim)
    .pipe(Effect.mapError(cause => corruptionError(input.selector.scopeId, "sessionRecordInvalid", cause)));
  const session = finiteAttempt.session;
  const databaseNow = yield* Effect.tryPromise({ try: () => readDatabaseNow(tx, input.selector.scopeId),
    catch: mapAttemptLoadTransactionError });
  yield* Effect.fromResult(requireFiniteAttemptIsLive(finiteAttempt, databaseNow)).pipe(
    Effect.mapError(cause => corruptionError(input.selector.scopeId, "executionClaimInvalid", cause)));
  if (finiteAttempt.snapshotToken.epoch !== clock.record.epoch ||
    finiteAttempt.snapshotToken.commitSeq !== clock.record.lastCommitSeq || finiteAttempt.reservation !== null)
    return yield* Effect.fail(corruptionError(input.selector.scopeId, "snapshotLeaseInvalid"));
  finiteEntryAnchorExpectations.set(tx, Object.freeze({ session, snapshotToken: finiteAttempt.snapshotToken }));
  yield* requireCorrelatedFiniteEntryEffect(tx, input.selector.scopeId);
  if (session.executionAuthorityGeneration !== "application_v1" ||
    session.applicationExecutionAuthorityJson === null ||
    session.applicationExecutionAuthorityCanonicalBytes === null ||
    session.applicationExecutionAuthoritySha256 === null)
    return yield* Effect.fail(corruptionError(input.selector.scopeId, "sessionRecordInvalid"));
  if (original !== undefined && (original.context.anchor.deploymentId !== input.selector.deploymentId ||
    original.context.anchor.scopeId !== input.selector.scopeId || original.context.anchor.sessionId !== input.selector.sessionId ||
    original.context.anchor.attemptFence >= input.selector.attemptFence ||
    !bytesEqual(original.context.session.requestSha256, session.requestSha256) ||
    !bytesEqual(original.context.session.identityAccessPolicySha256, session.identityAccessPolicySha256) ||
    !bytesEqual(original.context.session.validatedArgsSha256, session.validatedArgsSha256) ||
    !bytesEqual(original.context.session.authorizationGrantSha256, session.authorizationGrantSha256)))
    return yield* Effect.fail(corruptionError(input.selector.scopeId, "sessionRecordInvalid"));
  const canonical = original === undefined
    ? yield* canonicalizeApplicationMutationExecutionAuthorityV1(session.applicationExecutionAuthorityJson)
      .pipe(Effect.mapError(cause => corruptionError(input.selector.scopeId, "sessionRecordInvalid", cause)))
    : original.canonicalExecutionAuthority;
  const authority = canonical.authority;
  if (!nullableJsonEqual(canonical.authority, session.applicationExecutionAuthorityJson) ||
    !bytesEqual(canonical.canonicalBytes, session.applicationExecutionAuthorityCanonicalBytes) ||
    !bytesEqual(canonical.sha256, session.applicationExecutionAuthoritySha256) ||
    authority.runtimeTarget.scopeId !== input.selector.scopeId ||
    authority.schemaVersionId !== session.schemaVersionId ||
    authority.runtimeTarget.function.path !== session.functionPath ||
    authority.runtimeTarget.function.kind !== session.functionKind)
    return yield* Effect.fail(corruptionError(input.selector.scopeId, "sessionRecordInvalid"));
  const applicationSelector = Object.freeze({
    executionAuthorityGeneration: session.executionAuthorityGeneration,
    applicationExecutionAuthorityFormat: authority.format,
    applicationExecutionAuthorityVersionText: authority.version.toString(),
    applicationExecutionAuthorityActivationSequence: authority.activationSequence,
    applicationExecutionAuthorityRevisionId: authority.runtimeTarget.revisionId,
    applicationExecutionAuthorityFunctionPath: authority.runtimeTarget.function.path,
    applicationExecutionAuthoritySchemaSha256: authority.runtimeTarget.schemaSha256,
  }) satisfies ApplicationGraphSessionSelector;
  const context = yield* finiteEntryAttemptContextFromAnchor(finiteAttempt, input.selector.deploymentId, clock.record, databaseNow);
  return Object.freeze({ context, applicationSelector, executionAuthority: authority, canonicalExecutionAuthority: canonical,
    session: Object.freeze({ ...session }),
    verifyFinalRows: requireCorrelatedFiniteEntryEffect(tx, input.selector.scopeId),
    close: () => { finiteEntryAnchorExpectations.delete(tx); },
  });
});

interface PointMutationSessionAttemptAuthorityFailureFactoryV1<
  Failure extends Error = Error,
> {
  readonly unsupportedStorageGeneration: () => Failure;
  readonly storageGenerationFenceChanged: () => Failure;
  readonly authorizationRevocationEpochChanged: () => Failure;
  readonly scopeEpochChanged: () => Failure;
}

interface PointMutationSessionAttemptFailureFactoryV1<Failure extends Error>
  extends PointMutationSessionAttemptAuthorityFailureFactoryV1<Failure> {
  readonly terminal: (
    lifecycle: Exclude<TransactionSessionLifecycleV1, "running">,
  ) => Failure;
  readonly activeAttemptExpired: () => Failure;
  readonly executionClaimUnavailable: () => Failure;
}

interface PointMutationSessionExactSessionFailureFactoryV1 {
  readonly sessionMissing: () => Error;
  readonly staleAttemptFence: () => Error;
}

async function lockExactPointMutationSession(
  tx: FlarexMetadataDatabase,
  selector: PointMutationSessionAttemptSelectorV1,
  clock: LockedPointMutationSessionClockV1,
  failures: PointMutationSessionExactSessionFailureFactoryV1,
  afterSessionLock:
    | ((step: PointMutationSessionAttemptLoadLockStepV1) =>
        void | Promise<void>)
    | undefined,
): Promise<CheckedTransactionSessionRow> {
  const sessions = await tx
    .select(checkedTransactionSessionSelection)
    .from(fxSystemTransactionSessions)
    .where(and(
      eq(fxSystemTransactionSessions.scopeUuid, clock.scopeUuid),
      eq(fxSystemTransactionSessions.sessionId, selector.sessionId),
    ))
    .limit(2)
    .for("update");
  const session = sessions[0];
  if (session === undefined) {
    throw failures.sessionMissing();
  }
  if (sessions.length !== 1) {
    throw corruptionError(selector.scopeId, "sessionRecordInvalid");
  }
  await afterSessionLock?.("sessionLocked");

  let persistedAttemptFence: TransactionAttemptFence;
  try {
    persistedAttemptFence = TransactionAttemptFenceSchema.make(
      session.attemptFence,
    );
  } catch (cause) {
    throw corruptionError(selector.scopeId, "sessionRecordInvalid", cause);
  }
  if (persistedAttemptFence !== selector.attemptFence) {
    throw failures.staleAttemptFence();
  }
  return session;
}

interface LockedPointMutationSessionAttemptLoadV1<Failure extends Error> {
  readonly deploymentId: TransactionGrantDeploymentIdV1;
  readonly scopeId: ReplacementScopeIdV1;
  readonly failures: PointMutationSessionAttemptFailureFactoryV1<Failure>;
  readonly afterLeaseLock:
    | ((step: PointMutationSessionAttemptLoadLockStepV1) =>
        void | Promise<void>)
    | undefined;
  readonly claimRequirement: "live" | "present";
  readonly executionClaim?: ExactRunningAttemptKernelInputV1["executionClaim"];
}

interface LockedRunningPointMutationSessionAttemptV1 {
  readonly deploymentId: TransactionGrantDeploymentIdV1;
  readonly scopeId: ReplacementScopeIdV1;
  readonly clock: LockedPointMutationSessionClockV1;
  readonly session: CheckedTransactionSessionRow;
  readonly locked: Extract<
    LockedPointMutationSessionAttemptStructureV1,
    { readonly leaseState: "present" }
  >;
  readonly journalRoot: typeof fxSystemTransactionJournals.$inferSelect;
  readonly executionClaim: TransactionExecutionClaimObservationV1;
  readonly authorizationGrantExpiresAtMilliseconds: number;
  readonly hardExpiresAtMilliseconds: number;
  readonly databaseNow: Date;
}

async function loadLockedRunningAttempt<Failure extends Error>(
  tx: AppRowTransaction,
  input: LockedPointMutationSessionAttemptLoadV1<Failure>,
  clock: LockedPointMutationSessionClockV1,
  session: CheckedTransactionSessionRow,
): Promise<LockedRunningPointMutationSessionAttemptV1> {
  const locked = await lockPointMutationSessionAttemptStructure(
    tx,
    { ...input, authorityProfile: "liveExecution" },
    clock,
    session,
    "requireRetainedSnapshot",
  );
  if (session.lifecycle !== "running") {
    throw input.failures.terminal(session.lifecycle);
  }
  if (locked.leaseState === "absent") {
    throw corruptionError(input.scopeId, "snapshotLeaseMissing");
  }

  const tail = projectTransactionSessionActivationResult(
    (await readRunningAttemptTail(tx, {
      scopeId: input.scopeId,
      scopeUuid: clock.scopeUuid,
      sessionId: locked.sessionId,
      attemptFence: locked.attemptFence,
    })).pipe(Result.mapError(issue => runningAttemptTailError(input.scopeId, issue))),
  );
  await input.afterLeaseLock?.("attemptTailLocked");
  const journalRoot = tail.journalRoot;
  const claim = tail.executionClaim;
  const databaseNow = databaseNowFromEpochMilliseconds(input.scopeId, tail.databaseNowEpochMilliseconds);
  const authorizationGrantExpiresAtMilliseconds = finiteDateMilliseconds(
    session.authorizationGrantExpiresAt,
  );
  const hardExpiresAtMilliseconds = finiteDateMilliseconds(
    session.hardExpiresAt,
  );
  const databaseNowMilliseconds = finiteDateMilliseconds(databaseNow);
  if (
    authorizationGrantExpiresAtMilliseconds === undefined ||
    hardExpiresAtMilliseconds === undefined ||
    databaseNowMilliseconds === undefined
  ) {
    throw corruptionError(input.scopeId, "sessionRecordInvalid");
  }
  if (
    journalRoot.state === "sealed" &&
    locked.leaseExpiresAtMilliseconds !== Math.min(
      authorizationGrantExpiresAtMilliseconds,
      hardExpiresAtMilliseconds,
    )
  ) {
    throw corruptionError(input.scopeId, "snapshotLeaseInvalid");
  }
  if (
    authorizationGrantExpiresAtMilliseconds <= databaseNowMilliseconds ||
    hardExpiresAtMilliseconds <= databaseNowMilliseconds ||
    locked.leaseExpiresAtMilliseconds <= databaseNowMilliseconds
  ) {
    throw input.failures.activeAttemptExpired();
  }
  const executionClaim = projectTransactionSessionActivationResult(
    validateLockedRunningAttemptExecutionClaimResult(
      input,
      claim,
      databaseNow,
      databaseNowMilliseconds,
    ),
  );
  return {
    deploymentId: input.deploymentId,
    scopeId: input.scopeId,
    clock,
    session,
    locked,
    journalRoot,
    executionClaim,
    authorizationGrantExpiresAtMilliseconds,
    hardExpiresAtMilliseconds,
    databaseNow,
  };
}

function runningAttemptTailError(scopeId: ScopeId, issue: RunningAttemptTailIssue):
  PointMutationSessionAuthorityCorruptionV1Error | TransactionExecutionClaimCorruptionV1Error {
  switch (issue.reason) {
    case "journalRootMissing": return corruptionError(scopeId, "activeJournalRootMissing");
    case "journalRootInvalid": return corruptionError(scopeId, "journalRootInvalid", issue.cause);
    case "executionClaimMissingOrDuplicate": return new TransactionExecutionClaimCorruptionV1Error({
      scopeId, reason: "claimMissingOrDuplicate",
    });
    case "databaseClockInvalid": return corruptionError(scopeId, "databaseClockInvalid");
  }
}

const decodeCheckedSchemaVersionIdResult = Schema.decodeUnknownResult(CatalogSchemaVersionIdSchema);

function runningAttemptKernelContextResult(
  loaded: LockedRunningPointMutationSessionAttemptV1,
  tx?: AppRowTransaction,
): Result.Result<ExactRunningAttemptKernelContextV1, PointMutationSessionAuthorityCorruptionV1Error> {
  const { clock, session, locked, journalRoot } = loaded;
  if (tx !== undefined && journalRoot.executionProfile === "finiteRoot") {
    finiteEntryLeaseExpectations.set(tx, locked.lease);
    if (readFiniteExecutionAuthorityObservation(tx, clock.record.scopeId) === undefined)
      openFiniteExecutionAuthorityObservation(tx, { scopeId: clock.record.scopeId, scopeUuid: clock.scopeUuid,
        storageGeneration: clock.record.storageGeneration, storageGenerationFence: clock.record.storageGenerationFence,
        epoch: clock.record.epoch, epochUuid: clock.epochUuid, oldestAvailableCommitSeq: clock.record.oldestAvailableCommitSeq,
        authorizationRevocationEpoch: clock.authorizationRevocationEpoch }, { sessionId: session.sessionId,
          attemptFence: locked.attemptFence, snapshotToken: SnapshotTokenSchema.make({ scopeId: loaded.scopeId,
            epoch: locked.snapshotEpoch, commitSeq: locked.snapshotCommitSeq }) });
  }
  const finiteAuthority = tx === undefined ? undefined : readFiniteExecutionAuthorityObservation(tx, loaded.scopeId);
  return decodeCheckedSchemaVersionIdResult(session.schemaVersionId).pipe(
    Result.mapError(cause => corruptionError(loaded.scopeId, "sessionRecordInvalid", cause)),
    Result.flatMap(schemaVersionId => !isUint8ArrayWithByteLength(session.identityAccessPolicySha256, 32)
      ? Result.fail(corruptionError(loaded.scopeId, "sessionRecordInvalid"))
      : Result.succeed(Object.freeze({
      scopeUuid: clock.scopeUuid,
      snapshotLease: Object.freeze({ ...locked.lease }),
      ...(finiteAuthority === undefined ? {} : { finiteAuthority }),
      scopeClock: Object.freeze({
        ...clock.record,
        updatedAt: new Date(clock.record.updatedAt.getTime()),
      }),
      anchor: Object.freeze({
        deploymentId: loaded.deploymentId,
        scopeId: loaded.scopeId,
        sessionId: locked.sessionId,
        requestKey: session.requestKey,
        executionProfile: journalRoot.executionProfile,
        storageGeneration: FlarexDbV1StorageGenerationSchema.make("flarexdb_v1"),
        storageGenerationFence: locked.storageGenerationFence,
        attemptFence: locked.attemptFence,
        snapshotToken: SnapshotTokenSchema.make({
          scopeId: loaded.scopeId,
          epoch: locked.snapshotEpoch,
          commitSeq: locked.snapshotCommitSeq,
        }),
        hardExpiresAt: session.hardExpiresAt.toISOString(),
        leaseExpiresAt: locked.lease.leaseExpiresAt.toISOString(),
        createdAt: session.createdAt.toISOString(),
        updatedAt: session.updatedAt.toISOString(),
      } satisfies PointMutationSessionAnchorV1),
      executionPin: Object.freeze({ schemaVersionId, functionPath: session.functionPath, functionKind: session.functionKind, executionModule: session.executionModule }),
      executionAuthorityGeneration: session.executionAuthorityGeneration,
      principalDigest: encodeBytesToLowercaseHex(session.identityAccessPolicySha256),
      authorizationGrantExpiresAtMilliseconds:
        loaded.authorizationGrantExpiresAtMilliseconds,
      hardExpiresAtMilliseconds: loaded.hardExpiresAtMilliseconds,
      databaseNow: loaded.databaseNow,
      journalRoot: Object.freeze({ ...journalRoot }),
      executionClaim: loaded.executionClaim,
      } satisfies ExactRunningAttemptKernelContextV1))),
  );
}

function validateLockedRunningAttemptExecutionClaimResult<
  Failure extends Error,
>(
  input: LockedPointMutationSessionAttemptLoadV1<Failure>,
  claim: typeof fxSystemTransactionExecutionClaims.$inferSelect,
  databaseNow: Date,
  databaseNowMilliseconds: number,
): Result.Result<
  TransactionExecutionClaimObservationV1,
  Failure | PointMutationSessionAuthorityCorruptionV1Error
> {
  const inspected = input.claimRequirement === "live"
    ? requireLiveTransactionExecutionClaimV1Result(
        input.scopeId,
        claim,
        input.executionClaim,
        databaseNow,
      )
    : inspectTransactionExecutionClaimV1Result(input.scopeId, claim);
  return inspected.pipe(
    Result.flatMap((observation) =>
      input.claimRequirement === "present" &&
        Date.parse(observation.claimedAt) > databaseNowMilliseconds
        ? Result.fail(new TransactionExecutionClaimCorruptionV1Error({
            scopeId: input.scopeId,
            reason: "claimEvidenceInvalid",
          }))
        : Result.succeed(observation)
    ),
    Result.mapError((cause) =>
      cause instanceof TransactionExecutionClaimStaleV1Error
        ? input.failures.executionClaimUnavailable()
        : corruptionError(
            input.scopeId,
            "executionClaimInvalid",
            cause,
          )
    ),
  );
}

async function requireExactPointMutationSessionJournalRoot(
  tx: FlarexMetadataDatabase,
  scopeId: ScopeId,
  scopeUuid: ScopeUuidV1,
  sessionId: TransactionSessionIdV1,
  attemptFence: TransactionAttemptFence,
  afterRootLock:
    | ((step: PointMutationSessionAttemptLoadLockStepV1) =>
        void | Promise<void>)
    | undefined,
): Promise<typeof fxSystemTransactionJournals.$inferSelect> {
  const roots = await tx
    .select()
    .from(fxSystemTransactionJournals)
    .where(and(
      eq(fxSystemTransactionJournals.scopeUuid, scopeUuid),
      eq(fxSystemTransactionJournals.sessionId, sessionId),
      eq(fxSystemTransactionJournals.attemptFence, attemptFence),
    ))
    .limit(2)
    .for("update");
  const root = roots[0];
  if (root === undefined) {
    throw corruptionError(scopeId, "activeJournalRootMissing");
  }
  if (roots.length !== 1) {
    throw corruptionError(scopeId, "journalRootInvalid");
  }
  await afterRootLock?.("journalRootLocked");
  return root;
}

async function observePointMutationSessionAttemptFacet(
  tx: FlarexMetadataDatabase,
  clock: LockedPointMutationSessionClockV1,
  session: CheckedTransactionSessionRow,
  locked: Extract<
    LockedPointMutationSessionAttemptStructureV1,
    { readonly leaseState: "present" }
  >,
  root: typeof fxSystemTransactionJournals.$inferSelect,
): Promise<PointMutationSessionAttemptFacetObservationV1> {
  const sessionUpdatedAtMilliseconds = finiteDateMilliseconds(
    session.updatedAt,
  );
  const authorizationGrantExpiresAtMilliseconds = finiteDateMilliseconds(
    session.authorizationGrantExpiresAt,
  );
  const hardExpiresAtMilliseconds = finiteDateMilliseconds(
    session.hardExpiresAt,
  );
  if (
    sessionUpdatedAtMilliseconds === undefined ||
    authorizationGrantExpiresAtMilliseconds === undefined ||
    hardExpiresAtMilliseconds === undefined
  ) {
    throw corruptionError(clock.record.scopeId, "sessionRecordInvalid");
  }
  const expectedFacet = buildFreshTransactionAttemptFacetV1({
    scopeUuid: clock.scopeUuid,
    sessionId: locked.sessionId,
    attemptFence: locked.attemptFence,
    executionProfile: root.executionProfile,
    snapshotEpochUuid: clock.epochUuid,
    snapshotCommitSeq: locked.snapshotCommitSeq,
    databaseNowMilliseconds: sessionUpdatedAtMilliseconds,
    authorizationGrantExpiresAtMilliseconds,
    hardExpiresAtMilliseconds,
    leaseDurationMilliseconds:
      locked.leaseExpiresAtMilliseconds - sessionUpdatedAtMilliseconds,
  });
  if (
    Result.isFailure(expectedFacet) ||
    !isPristineFreshTransactionAttemptJournalRootV1(
      root,
      expectedFacet.success.journalRoot,
    )
  ) {
    return Object.freeze({ kind: "nonPristine" });
  }

  const rows = await tx.select({
    receiptExists: sql<boolean>`exists(
      select 1 from ${fxSystemTransactionJournalReceipts}
      where ${fxSystemTransactionJournalReceipts.scopeUuid} =
        ${clock.scopeUuid}
        and ${fxSystemTransactionJournalReceipts.sessionId} =
          ${locked.sessionId}
        and ${fxSystemTransactionJournalReceipts.attemptFence} =
          ${locked.attemptFence}
    )`,
    pointExists: sql<boolean>`exists(
      select 1 from ${fxSystemTransactionJournalPoints}
      where ${fxSystemTransactionJournalPoints.scopeUuid} = ${clock.scopeUuid}
        and ${fxSystemTransactionJournalPoints.sessionId} = ${locked.sessionId}
        and ${fxSystemTransactionJournalPoints.attemptFence} =
          ${locked.attemptFence}
    )`,
    indexRangeExists: sql<boolean>`exists(
      select 1 from ${fxSystemTransactionJournalIndexRanges}
      where ${fxSystemTransactionJournalIndexRanges.scopeUuid} =
        ${clock.scopeUuid}
        and ${fxSystemTransactionJournalIndexRanges.sessionId} =
          ${locked.sessionId}
        and ${fxSystemTransactionJournalIndexRanges.attemptFence} =
          ${locked.attemptFence}
    )`,
    relationDependencyExists: sql<boolean>`exists(
      select 1 from ${fxSystemTransactionJournalRelationIncomingDependencies}
      where ${fxSystemTransactionJournalRelationIncomingDependencies.scopeUuid} =
        ${clock.scopeUuid}
        and ${fxSystemTransactionJournalRelationIncomingDependencies.sessionId} =
          ${locked.sessionId}
        and ${fxSystemTransactionJournalRelationIncomingDependencies.attemptFence} =
          ${locked.attemptFence}
    )`,
    eventExists: sql<boolean>`exists(
      select 1 from ${fxSystemTransactionJournalWriteEvents}
      where ${fxSystemTransactionJournalWriteEvents.scopeUuid} =
        ${clock.scopeUuid}
        and ${fxSystemTransactionJournalWriteEvents.sessionId} =
          ${locked.sessionId}
        and ${fxSystemTransactionJournalWriteEvents.attemptFence} =
          ${locked.attemptFence}
    )`,
  }).from(fxSystemScopeClocks).where(eq(
    fxSystemScopeClocks.scopeUuid,
    clock.scopeUuid,
  )).limit(1);
  const observation = rows[0];
  if (
    rows.length !== 1 ||
    observation === undefined ||
    typeof observation.receiptExists !== "boolean" ||
    typeof observation.pointExists !== "boolean" ||
    typeof observation.indexRangeExists !== "boolean" ||
    typeof observation.relationDependencyExists !== "boolean" ||
    typeof observation.eventExists !== "boolean"
  ) {
    throw corruptionError(clock.record.scopeId, "journalRootInvalid");
  }
  return Object.freeze({
    kind: observation.receiptExists ||
        observation.pointExists ||
        observation.indexRangeExists ||
        observation.relationDependencyExists ||
        observation.eventExists
      ? "nonPristine"
      : "pristineOpen",
  });
}

interface LockedPointMutationSessionAttemptStructureBaseV1 {
  readonly sessionId: TransactionSessionIdV1;
  readonly attemptFence: TransactionAttemptFence;
  readonly storageGenerationFence: StorageGenerationFence;
}

type LockedPointMutationSessionAttemptStructureV1 =
  | (LockedPointMutationSessionAttemptStructureBaseV1 & {
      readonly leaseState: "absent";
    })
  | (LockedPointMutationSessionAttemptStructureBaseV1 & {
      readonly leaseState: "present";
      readonly lease: SnapshotLeaseRow;
      readonly leaseExpiresAtMilliseconds: number;
      readonly snapshotEpoch: ScopeEpoch;
      readonly snapshotCommitSeq: CommitSeq;
    });

async function lockPointMutationSessionAttemptStructure(
  tx: FlarexMetadataDatabase,
  input: {
    readonly scopeId: ReplacementScopeIdV1;
    readonly authorityProfile: "liveExecution" | "terminalCleanup";
    readonly failures: PointMutationSessionAttemptAuthorityFailureFactoryV1;
    readonly afterLeaseLock:
      | ((step: PointMutationSessionAttemptLoadLockStepV1) =>
          void | Promise<void>)
      | undefined;
  },
  clock: LockedPointMutationSessionClockV1,
  session: CheckedTransactionSessionRow,
  snapshotRetentionFloorPolicy:
    | "requireRetainedSnapshot"
    | "allowExpiredTerminalization",
): Promise<LockedPointMutationSessionAttemptStructureV1> {
  if (session.storageGeneration !== "flarexdb_v1") {
    throw input.failures.unsupportedStorageGeneration();
  }
  if (
    session.storageGenerationFence !== clock.record.storageGenerationFence
  ) {
    throw input.failures.storageGenerationFenceChanged();
  }
  if (
    session.authorizationRevocationEpoch !==
    clock.authorizationRevocationEpoch &&
    (input.authorityProfile === "liveExecution" ||
      session.authorizationRevocationEpoch > clock.authorizationRevocationEpoch)
  ) {
    throw input.failures.authorizationRevocationEpochChanged();
  }
  const authorizationGrantExpiresAtMilliseconds = finiteDateMilliseconds(
    session.authorizationGrantExpiresAt,
  );
  const hardExpiresAtMilliseconds = finiteDateMilliseconds(
    session.hardExpiresAt,
  );
  if (
    authorizationGrantExpiresAtMilliseconds === undefined ||
    hardExpiresAtMilliseconds === undefined ||
    finiteDateMilliseconds(session.createdAt) === undefined ||
    finiteDateMilliseconds(session.updatedAt) === undefined ||
    hardExpiresAtMilliseconds > authorizationGrantExpiresAtMilliseconds
  ) {
    throw corruptionError(input.scopeId, "sessionRecordInvalid");
  }

  let sessionId: TransactionSessionIdV1;
  let attemptFence: TransactionAttemptFence;
  let storageGenerationFence: StorageGenerationFence;
  try {
    sessionId = TransactionSessionIdV1Schema.make(session.sessionId);
    attemptFence = TransactionAttemptFenceSchema.make(session.attemptFence);
    storageGenerationFence = StorageGenerationFenceSchema.make(
      session.storageGenerationFence,
    );
  } catch (cause) {
    throw corruptionError(
      input.scopeId,
      "sessionRecordInvalid",
      cause,
    );
  }
  if (session.protocolVersion !== TRANSACTION_SESSION_PROTOCOL_VERSION_V1) {
    throw corruptionError(input.scopeId, "sessionRecordInvalid");
  }

  const leases = await tx
    .select()
    .from(fxSystemSnapshotLeases)
    .where(and(
      eq(fxSystemSnapshotLeases.scopeUuid, clock.scopeUuid),
      eq(fxSystemSnapshotLeases.sessionId, sessionId),
    ))
    .limit(2)
    .for("update");
  if (leases.length > 1) {
    throw corruptionError(input.scopeId, "snapshotLeaseInvalid");
  }
  const lease = leases[0];
  if (lease === undefined) {
    return Object.freeze({
      leaseState: "absent",
      sessionId,
      attemptFence,
      storageGenerationFence,
    } satisfies LockedPointMutationSessionAttemptStructureV1);
  }
  await input.afterLeaseLock?.("leaseLocked");
  const leaseExpiresAtMilliseconds = finiteDateMilliseconds(
    lease.leaseExpiresAt,
  );
  if (
    lease.attemptFence !== attemptFence ||
    leaseExpiresAtMilliseconds === undefined ||
    leaseExpiresAtMilliseconds > hardExpiresAtMilliseconds
  ) {
    throw corruptionError(input.scopeId, "snapshotLeaseInvalid");
  }

  let snapshotEpoch: ScopeEpoch;
  let snapshotCommitSeq: CommitSeq;
  try {
    snapshotEpoch = replacementScopeEpochV1FromUuid(lease.snapshotEpochUuid);
    snapshotCommitSeq = CommitSeqSchema.make(lease.snapshotCommitSeq);
  } catch (cause) {
    throw corruptionError(
      input.scopeId,
      "snapshotLeaseInvalid",
      cause,
    );
  }
  if (snapshotEpoch !== clock.record.epoch) {
    throw input.failures.scopeEpochChanged();
  }
  if (snapshotCommitSeq > clock.record.lastCommitSeq) {
    throw corruptionError(input.scopeId, "snapshotAheadOfScopeClock");
  }
  if (snapshotRetentionFloorPolicy === "requireRetainedSnapshot") {
    projectTransactionSessionActivationResult(
      validateSnapshotRetentionFloorResult(
        input.scopeId,
        snapshotCommitSeq,
        clock.record.oldestAvailableCommitSeq,
      ),
    );
  }

  return Object.freeze({
    leaseState: "present",
    sessionId,
    attemptFence,
    storageGenerationFence,
    lease,
    leaseExpiresAtMilliseconds,
    snapshotEpoch,
    snapshotCommitSeq,
  } satisfies LockedPointMutationSessionAttemptStructureV1);
}

function validateSnapshotRetentionFloorResult(
  scopeId: ReplacementScopeIdV1,
  snapshotCommitSeq: CommitSeq,
  oldestAvailableCommitSeq: CommitSeq,
): Result.Result<void, PointMutationSessionAuthorityCorruptionV1Error> {
  return snapshotCommitSeq < oldestAvailableCommitSeq
    ? Result.fail(corruptionError(scopeId, "snapshotLeaseInvalid"))
    : Result.succeed(undefined);
}

async function terminalizeAttemptInTransaction(
  tx: AppRowTransaction,
  input: LocatedPointMutationSessionAttemptTerminalizationInputV1,
  afterEvent:
    | LocatedPointMutationSessionActivationTargetOptionsV1[
        "afterTerminalizationEvent"
      ]
    | undefined,
): Promise<PointMutationSessionAttemptTerminalizationResultV1> {
  const selector = input.selector;
  const emitLock = async (
    step: PointMutationSessionAttemptLoadLockStepV1,
  ): Promise<void> => {
    await afterEvent?.(Object.freeze({
      phase: "lock",
      operation: input.operation,
      step,
    } satisfies PointMutationSessionAttemptTerminalizationEventV1));
  };
  const emitWrite = async (
    step: Extract<
      PointMutationSessionAttemptTerminalizationEventV1,
      { readonly phase: "write" }
    >["step"],
  ): Promise<void> => {
    await afterEvent?.(Object.freeze({
      phase: "write",
      operation: input.operation,
      step,
    } satisfies PointMutationSessionAttemptTerminalizationEventV1));
  };

  // Terminal cleanup releases durable attempt ownership; it does not admit
  // execution under the revoked grant. Serialize lifecycle changes first.
  const clock = await lockPointMutationSessionClockWithMode(tx, selector.scopeId, "terminalCleanup");
  await emitLock("clockLocked");
  projectTransactionSessionActivationResult(requireStableAttemptTerminalizationAuthority(clock, input));
  const session = await lockExactPointMutationSession(
    tx,
    selector,
    clock,
    attemptTerminalizationExactSessionFailures,
    emitLock,
  );
  if (session.executionProfile === "finiteRoot") {
    return projectPointCommitTransactionResult(await runPointCommitInTransactionEffect(terminalizeFiniteAttemptInTransaction(tx, input, clock)));
  }
  const locked = await lockPointMutationSessionAttemptStructure(
    tx,
    {
      scopeId: selector.scopeId,
      authorityProfile: "terminalCleanup",
      failures: attemptTerminalizationAuthorityFailures,
      afterLeaseLock: emitLock,
    },
    clock,
    session,
    input.operation === "expire"
      ? "allowExpiredTerminalization"
      : "requireRetainedSnapshot",
  );
  const journalRoots = await tx
    .select({ attemptFence: fxSystemTransactionJournals.attemptFence })
    .from(fxSystemTransactionJournals)
    .where(and(
      eq(fxSystemTransactionJournals.scopeUuid, clock.scopeUuid),
      eq(fxSystemTransactionJournals.sessionId, locked.sessionId),
      eq(fxSystemTransactionJournals.attemptFence, locked.attemptFence),
    ))
    .limit(2)
    .for("update");
  if (journalRoots.length > 1) {
    throw corruptionError(selector.scopeId, "journalRootInvalid");
  }
  if (journalRoots[0] !== undefined) {
    await emitLock("journalRootLocked");
  }

  switch (session.lifecycle) {
    case "committed":
    case "aborted":
    case "expired": {
      if (locked.leaseState === "present") {
        throw corruptionError(
          selector.scopeId,
          "terminalSnapshotLeasePresent",
        );
      }
      if (journalRoots[0] !== undefined) {
        throw corruptionError(selector.scopeId, "terminalJournalRootPresent");
      }
      return attemptTerminalizationResult(
        "observed",
        selector,
        session.lifecycle,
        session.updatedAt,
      );
    }
    case "created":
    case "committing":
    case "retrying":
      throw attemptTerminalizationError({
        reason: "attemptNotTerminalizable",
        lifecycle: session.lifecycle,
      });
    case "running":
      break;
    case "finishing":
      if (input.operation === "abort") {
        throw attemptTerminalizationError({
          reason: "attemptNotTerminalizable",
          lifecycle: "finishing",
        });
      }
      break;
    default: {
      const unexpectedLifecycle: never = session.lifecycle;
      throw corruptionError(
        selector.scopeId,
        "sessionRecordInvalid",
        unexpectedLifecycle,
      );
    }
  }

  if (locked.leaseState === "absent") {
    throw corruptionError(selector.scopeId, "snapshotLeaseMissing");
  }
  if (journalRoots[0] === undefined) {
    throw corruptionError(selector.scopeId, "activeJournalRootMissing");
  }
  if (
    input.operation === "abort" &&
    (
      input.expectedSnapshotToken.scopeId !== selector.scopeId ||
      input.expectedSnapshotToken.epoch !== locked.snapshotEpoch ||
      input.expectedSnapshotToken.commitSeq !== locked.snapshotCommitSeq
    )
  ) {
    throw corruptionError(selector.scopeId, "attemptSnapshotChanged");
  }
  // Clock-independent refusals and idempotent terminal observations precede
  // the later claim gate. A live abort still samples time after every lock wait.
  const executionClaimResult = input.operation === "abort"
    ? await lockExactTransactionExecutionClaimV1Result(tx, {
        scopeId: selector.scopeId,
        scopeUuid: clock.scopeUuid,
        sessionId: locked.sessionId,
        attemptFence: locked.attemptFence,
      })
    : undefined;
  const databaseNow = await readDatabaseNow(tx, selector.scopeId);
  if (input.operation === "abort") {
    if (executionClaimResult === undefined)
      throw corruptionError(selector.scopeId, "executionClaimInvalid");
    const executionClaim = projectTransactionSessionActivationResult(
      executionClaimResult,
    );
    await emitLock("executionClaimLocked");
    projectTransactionSessionActivationResult(
      requireLiveTransactionExecutionClaimV1Result(
        selector.scopeId,
        executionClaim,
        input.executionClaim,
        databaseNow,
      ),
    );
  }

  const hardExpiresAtMilliseconds = finiteDateMilliseconds(
    session.hardExpiresAt,
  );
  const authorizationGrantExpiresAtMilliseconds = finiteDateMilliseconds(
    session.authorizationGrantExpiresAt,
  );
  const databaseNowMilliseconds = finiteDateMilliseconds(databaseNow);
  if (
    hardExpiresAtMilliseconds === undefined ||
    authorizationGrantExpiresAtMilliseconds === undefined ||
    databaseNowMilliseconds === undefined
  ) {
    throw corruptionError(selector.scopeId, "sessionRecordInvalid");
  }
  const effectiveExpiryMilliseconds = Math.min(
    locked.leaseExpiresAtMilliseconds,
    hardExpiresAtMilliseconds,
    authorizationGrantExpiresAtMilliseconds,
  );
  const effectiveExpiresAt = new Date(effectiveExpiryMilliseconds);
  if (finiteDateMilliseconds(effectiveExpiresAt) === undefined) {
    throw corruptionError(selector.scopeId, "snapshotLeaseInvalid");
  }
  const isExpired = effectiveExpiryMilliseconds <= databaseNowMilliseconds;
  if (input.operation === "expire" && !isExpired) {
    throw attemptTerminalizationError({
      reason: "attemptStillLive",
      effectiveExpiresAt: effectiveExpiresAt.toISOString(),
    });
  }
  const lifecycle = isExpired ? "expired" : "aborted";

  const deletedJournal = await tx
    .delete(fxSystemTransactionJournals)
    .where(and(
      eq(fxSystemTransactionJournals.scopeUuid, clock.scopeUuid),
      eq(fxSystemTransactionJournals.sessionId, locked.sessionId),
      eq(fxSystemTransactionJournals.attemptFence, locked.attemptFence),
    ))
    .returning({ attemptFence: fxSystemTransactionJournals.attemptFence });
  if (
    deletedJournal.length !== 1 ||
    deletedJournal[0]?.attemptFence !== locked.attemptFence
  ) {
    throw corruptionError(selector.scopeId, "terminalizationWriteMismatch");
  }
  await emitWrite("journalDeleted");

  const deleted = await tx
    .delete(fxSystemSnapshotLeases)
    .where(and(
      eq(fxSystemSnapshotLeases.scopeUuid, clock.scopeUuid),
      eq(fxSystemSnapshotLeases.sessionId, locked.sessionId),
      eq(fxSystemSnapshotLeases.attemptFence, locked.attemptFence),
    ))
    .returning({ attemptFence: fxSystemSnapshotLeases.attemptFence });
  if (
    deleted.length !== 1 ||
    deleted[0]?.attemptFence !== locked.attemptFence
  ) {
    throw corruptionError(selector.scopeId, "terminalizationWriteMismatch");
  }
  await emitWrite("leaseDeleted");

  const updated = await tx
    .update(fxSystemTransactionSessions)
    .set({
      validatedArgsJson: null,
      validatedArgsCanonicalBytes: null,
      authorizationGrantJson: null,
      authorizationGrantCanonicalBytes: null,
      applicationExecutionAuthorityJson: null,
      applicationExecutionAuthorityCanonicalBytes: null,
      lifecycle,
      updatedAt: databaseNow,
    })
    .where(and(
      eq(fxSystemTransactionSessions.scopeUuid, clock.scopeUuid),
      eq(fxSystemTransactionSessions.sessionId, locked.sessionId),
      eq(fxSystemTransactionSessions.attemptFence, locked.attemptFence),
      eq(fxSystemTransactionSessions.lifecycle, session.lifecycle),
    ))
    .returning({
      lifecycle: fxSystemTransactionSessions.lifecycle,
      updatedAt: fxSystemTransactionSessions.updatedAt,
    });
  const terminal = updated[0];
  const terminalUpdatedAt = copyFiniteDate(terminal?.updatedAt);
  if (
    updated.length !== 1 ||
    terminal === undefined ||
    terminal.lifecycle !== lifecycle ||
    terminalUpdatedAt === undefined
  ) {
    throw corruptionError(selector.scopeId, "terminalizationWriteMismatch");
  }
  await emitWrite("sessionTerminalized");

  return attemptTerminalizationResult(
    "terminalized",
    selector,
    lifecycle,
    terminalUpdatedAt,
  );
}

const terminalizeFiniteAttemptInTransaction = Effect.fn("PointMutationSessionTerminalization.finite")(
  function* (tx: AppRowTransaction, input: LocatedPointMutationSessionAttemptTerminalizationInputV1,
    clock: LockedPointMutationSessionClockV1) {
    const context = yield* lockFiniteAttemptAnchorInTransaction(tx, input.selector).pipe(Effect.mapError(cause => corruptionError(input.selector.scopeId, "sessionRecordInvalid", cause)));
    const session = context.session;
    if (session.lifecycle === "committed" || session.lifecycle === "aborted" || session.lifecycle === "expired")
      return attemptTerminalizationResult("observed", input.selector, session.lifecycle, session.updatedAt);
    if (session.lifecycle !== "running") return yield* Effect.fail(attemptTerminalizationError({
      reason: "attemptNotTerminalizable", lifecycle: session.lifecycle }));
    if (session.storageGenerationFence !== clock.record.storageGenerationFence || context.snapshotToken.epoch !== clock.record.epoch)
      return yield* Effect.fail(corruptionError(input.selector.scopeId, "attemptSnapshotChanged"));
    if (session.authorizationRevocationEpoch > clock.authorizationRevocationEpoch)
      return yield* Effect.fail(corruptionError(input.selector.scopeId, "sessionRecordInvalid"));
    if (input.operation === "abort" && (input.expectedSnapshotToken.scopeId !== context.snapshotToken.scopeId ||
      input.expectedSnapshotToken.epoch !== context.snapshotToken.epoch || input.expectedSnapshotToken.commitSeq !== context.snapshotToken.commitSeq))
      return yield* Effect.fail(corruptionError(input.selector.scopeId, "attemptSnapshotChanged"));
    const databaseNow = yield* Effect.tryPromise({ try: () => readDatabaseNow(tx, input.selector.scopeId),
      catch: cause => mapAttemptTerminalizationTransactionError(input.operation, cause) });
    if (input.operation === "abort" && (context.executionClaim.claimOwner !== input.executionClaim.claimOwner ||
      context.executionClaim.claimFence !== input.executionClaim.claimFence || Date.parse(context.executionClaim.claimExpiresAt) <= databaseNow.getTime()))
      return yield* Effect.fail(attemptTerminalizationError({ reason: "executionClaimUnavailable" }));
    const effectiveExpiry = Math.min(context.leaseExpiresAt.getTime(), session.authorizationGrantExpiresAt.getTime(), session.hardExpiresAt.getTime());
    const expired = effectiveExpiry <= databaseNow.getTime();
    if (input.operation === "expire" && !expired) return yield* Effect.fail(attemptTerminalizationError({
      reason: "attemptStillLive", effectiveExpiresAt: new Date(effectiveExpiry).toISOString() }));
    const lifecycle = expired ? "expired" as const : "aborted" as const;
    const rows = yield* Effect.tryPromise({ try: () => tx.update(fxSystemTransactionSessions).set({ lifecycle, updatedAt: databaseNow,
      validatedArgsJson: null, validatedArgsCanonicalBytes: null, authorizationGrantJson: null,
      authorizationGrantCanonicalBytes: null, applicationExecutionAuthorityJson: null,
      applicationExecutionAuthorityCanonicalBytes: null }).where(and(
      eq(fxSystemTransactionSessions.scopeUuid, session.scopeUuid), eq(fxSystemTransactionSessions.sessionId, session.sessionId),
      eq(fxSystemTransactionSessions.attemptFence, session.attemptFence), eq(fxSystemTransactionSessions.lifecycle, "running")))
      .returning({ sessionId: fxSystemTransactionSessions.sessionId }), catch: cause => mapAttemptTerminalizationTransactionError(input.operation, cause) });
    if (rows.length !== 1) return yield* Effect.fail(corruptionError(input.selector.scopeId, "terminalizationWriteMismatch"));
    return attemptTerminalizationResult("terminalized", input.selector, lifecycle, databaseNow);
  });

const activationAttemptFailures = Object.freeze({
  terminal: (lifecycle: Exclude<TransactionSessionLifecycleV1, "running">) =>
    activationError({ reason: "terminalRequest", lifecycle }),
  unsupportedStorageGeneration: () =>
    activationError({ reason: "unsupportedStorageGeneration" }),
  storageGenerationFenceChanged: () =>
    activationError({ reason: "storageGenerationFenceChanged" }),
  authorizationRevocationEpochChanged: () =>
    activationError({ reason: "authorizationRevocationEpochChanged" }),
  scopeEpochChanged: () => activationError({ reason: "scopeEpochChanged" }),
  activeAttemptExpired: () =>
    activationError({ reason: "activeAttemptExpired" }),
  executionClaimUnavailable: () =>
    activationError({ reason: "executionClaimUnavailable" }),
} satisfies PointMutationSessionAttemptFailureFactoryV1<
  PointMutationSessionActivationV1Error
>);

const attemptLoadFailures = Object.freeze({
  terminal: (lifecycle: Exclude<TransactionSessionLifecycleV1, "running">) =>
    attemptLoadError({ reason: "attemptNotRunning", lifecycle }),
  unsupportedStorageGeneration: () =>
    attemptLoadError({ reason: "unsupportedStorageGeneration" }),
  storageGenerationFenceChanged: () =>
    attemptLoadError({ reason: "storageGenerationFenceChanged" }),
  authorizationRevocationEpochChanged: () =>
    attemptLoadError({ reason: "authorizationRevocationEpochChanged" }),
  scopeEpochChanged: () => attemptLoadError({ reason: "scopeEpochChanged" }),
  activeAttemptExpired: () =>
    attemptLoadError({ reason: "activeAttemptExpired" }),
  executionClaimUnavailable: () =>
    attemptLoadError({ reason: "executionClaimUnavailable" }),
} satisfies PointMutationSessionAttemptFailureFactoryV1<
  PointMutationSessionAttemptLoadV1Error
>);

const attemptLoadExactSessionFailures = Object.freeze({
  sessionMissing: () => attemptLoadError({ reason: "sessionMissing" }),
  staleAttemptFence: () => attemptLoadError({ reason: "staleAttemptFence" }),
} satisfies PointMutationSessionExactSessionFailureFactoryV1);

const attemptLoadStableAuthorityFailures = Object.freeze({
  selectorScopeMismatch: () =>
    attemptLoadError({ reason: "selectorScopeMismatch" }),
  unsupportedStorageGeneration: () =>
    attemptLoadError({ reason: "unsupportedStorageGeneration" }),
  storageGenerationChanged: () =>
    attemptLoadError({ reason: "storageGenerationChanged" }),
  storageGenerationFenceChanged: () =>
    attemptLoadError({ reason: "storageGenerationFenceChanged" }),
  scopeEpochChanged: () => attemptLoadError({ reason: "scopeEpochChanged" }),
} satisfies PointMutationSessionStableAuthorityFailureFactoryV1);

const attemptTerminalizationAuthorityFailures = Object.freeze({
  unsupportedStorageGeneration: () =>
    attemptTerminalizationError({ reason: "unsupportedStorageGeneration" }),
  storageGenerationFenceChanged: () =>
    attemptTerminalizationError({ reason: "storageGenerationFenceChanged" }),
  authorizationRevocationEpochChanged: () =>
    attemptTerminalizationError({
      reason: "authorizationRevocationEpochChanged",
    }),
  scopeEpochChanged: () =>
    attemptTerminalizationError({ reason: "scopeEpochChanged" }),
} satisfies PointMutationSessionAttemptAuthorityFailureFactoryV1);

const attemptTerminalizationExactSessionFailures = Object.freeze({
  sessionMissing: () =>
    attemptTerminalizationError({ reason: "sessionMissing" }),
  staleAttemptFence: () =>
    attemptTerminalizationError({ reason: "staleAttemptFence" }),
} satisfies PointMutationSessionExactSessionFailureFactoryV1);

const attemptTerminalizationStableAuthorityFailures = Object.freeze({
  selectorScopeMismatch: () =>
    attemptTerminalizationError({ reason: "selectorScopeMismatch" }),
  unsupportedStorageGeneration: () =>
    attemptTerminalizationError({ reason: "unsupportedStorageGeneration" }),
  storageGenerationChanged: () =>
    attemptTerminalizationError({ reason: "storageGenerationChanged" }),
  storageGenerationFenceChanged: () =>
    attemptTerminalizationError({ reason: "storageGenerationFenceChanged" }),
  scopeEpochChanged: () =>
    attemptTerminalizationError({ reason: "scopeEpochChanged" }),
} satisfies PointMutationSessionStableAuthorityFailureFactoryV1);

async function lockPointMutationSessionClock(
  tx: FlarexMetadataDatabase,
  scopeId: ReplacementScopeIdV1,
): Promise<LockedPointMutationSessionClockV1> {
  return lockPointMutationSessionClockWithMode(tx, scopeId, "attempt");
}

async function lockPointMutationSessionClockForShare(
  tx: FlarexMetadataDatabase,
  scopeId: ReplacementScopeIdV1,
): Promise<LockedPointMutationSessionClockV1> {
  return lockPointMutationSessionClockWithMode(tx, scopeId, "share");
}

async function lockPointMutationSessionClockWithMode(
  tx: FlarexMetadataDatabase,
  scopeId: ReplacementScopeIdV1,
  lockMode: "share" | "attempt" | "terminalCleanup",
): Promise<LockedPointMutationSessionClockV1> {
  await tx.select({ scopeId: fxSystemScopeExecutionAuthorities.scopeId }).from(fxSystemScopeExecutionAuthorities)
    .where(eq(fxSystemScopeExecutionAuthorities.scopeId, scopeId)).limit(1)
    .for(lockMode === "terminalCleanup" ? "update" : "share");
  const query = selectScopeClockRows(tx)
    .where(eq(fxSystemScopeClocks.scopeId, scopeId))
    .limit(1);
  const rows = lockMode === "share"
    ? await query.for("share", { of: fxSystemScopeClocks })
    : lockMode === "terminalCleanup"
    ? await query.for("update", { of: fxSystemScopeClocks })
    : await query.for("no key update", { of: fxSystemScopeClocks });
  const row = rows[0];
  if (row === undefined) throw new ScopeClockNotFoundError(scopeId);
  return decodeLockedPointMutationSessionClock(row);
}

function decodeLockedPointMutationSessionClock(row: ScopeClockRow): LockedPointMutationSessionClockV1 {
  const scopeId = row.scopeId;
  const record = decodeScopeClockRecord(row);
  try {
    const scopeProjection = projectScopeIdUuidV1(record.scopeId);
    const epochProjection = projectScopeEpochUuidV1(record.epoch);
    const scopeUuid = decodeScopeUuidV1(row.scopeUuid);
    const epochUuid = decodeScopeEpochUuidV1(row.epochUuid);
    if (
      scopeUuid !== scopeProjection.scopeUuid ||
      epochUuid !== epochProjection.epochUuid
    ) {
      throw new Error("Native scope-clock projection mismatch.");
    }
    return Object.freeze({
      record,
      scopeUuid,
      epochUuid,
      authorizationRevocationEpoch:
        TransactionAuthorizationRevocationEpochSchema.make(
          row.authorizationRevocationEpoch,
        ),
    });
  } catch (cause) {
    throw corruptionError(
      scopeId,
      "scopeClockNativeProjectionInvalid",
      cause,
    );
  }
}

function requireStableAuthority(
  clock: LockedPointMutationSessionClockV1,
  input: LocatedPointMutationSessionActivationInputV1,
): Result.Result<void, PointMutationSessionActivationV1Error> {
  const preliminary = input.preliminaryAuthority;
  if (
    clock.record.scopeId !== input.prepared.scopeId ||
    preliminary.scopeId !== input.prepared.scopeId
  ) {
    return Result.fail(activationError({ reason: "scopeMismatch" }));
  }
  if (
    clock.record.storageGeneration !== "flarexdb_v1" ||
    preliminary.storageGeneration !== "flarexdb_v1"
  ) {
    return Result.fail(activationError({ reason: "unsupportedStorageGeneration" }));
  }
  if (clock.record.storageGeneration !== preliminary.storageGeneration) {
    return Result.fail(activationError({ reason: "storageGenerationChanged" }));
  }
  if (
    clock.record.storageGenerationFence !==
    preliminary.storageGenerationFence
  ) {
    return Result.fail(activationError({ reason: "storageGenerationFenceChanged" }));
  }
  if (clock.record.epoch !== preliminary.epoch) {
    return Result.fail(activationError({ reason: "scopeEpochChanged" }));
  }
  if (
    clock.authorizationRevocationEpoch !==
    input.prepared.evidence.authorizationRevocationEpoch
  ) {
    return Result.fail(activationError({
      reason: "authorizationRevocationEpochChanged",
    }));
  }
  return Result.succeed(undefined);
}

function requireStableAttemptLoadAuthority(
  clock: LockedPointMutationSessionClockV1,
  input: LocatedPointMutationSessionAttemptLoadInputV1,
) {
  return requireStablePointMutationSessionAttemptAuthority(
    clock,
    input,
    attemptLoadStableAuthorityFailures,
  );
}

function requireStableAttemptTerminalizationAuthority(
  clock: LockedPointMutationSessionClockV1,
  input: LocatedPointMutationSessionAttemptTerminalizationInputV1,
) {
  return requireStablePointMutationSessionAttemptAuthority(
    clock,
    input,
    attemptTerminalizationStableAuthorityFailures,
  );
}

interface PointMutationSessionStableAuthorityFailureFactoryV1<Failure extends Error = Error> {
  readonly selectorScopeMismatch: () => Failure;
  readonly unsupportedStorageGeneration: () => Failure;
  readonly storageGenerationChanged: () => Failure;
  readonly storageGenerationFenceChanged: () => Failure;
  readonly scopeEpochChanged: () => Failure;
}

function requireStablePointMutationSessionAttemptAuthority<Failure extends Error>(
  clock: LockedPointMutationSessionClockV1,
  input: {
    readonly selector: PointMutationSessionAttemptSelectorV1;
    readonly preliminaryAuthority: TrustedScopeAuthority;
  },
  failures: PointMutationSessionStableAuthorityFailureFactoryV1<Failure>,
): Result.Result<void, Failure> {
  const selector = input.selector;
  const preliminary = input.preliminaryAuthority;
  if (
    clock.record.scopeId !== selector.scopeId ||
    preliminary.scopeId !== selector.scopeId ||
    preliminary.deploymentId !== selector.deploymentId
  ) {
    return Result.fail(failures.selectorScopeMismatch());
  }
  if (
    clock.record.storageGeneration !== "flarexdb_v1" ||
    preliminary.storageGeneration !== "flarexdb_v1"
  ) {
    return Result.fail(failures.unsupportedStorageGeneration());
  }
  if (clock.record.storageGeneration !== preliminary.storageGeneration) {
    return Result.fail(failures.storageGenerationChanged());
  }
  if (
    clock.record.storageGenerationFence !==
    preliminary.storageGenerationFence
  ) {
    return Result.fail(failures.storageGenerationFenceChanged());
  }
  if (clock.record.epoch !== preliminary.epoch) {
    return Result.fail(failures.scopeEpochChanged());
  }
  return Result.succeed(undefined);
}

async function readDatabaseNow(
  tx: FlarexMetadataDatabase,
  scopeId: ScopeId,
): Promise<Date> {
  const rows = await tx
    .select({
      databaseNowEpochMilliseconds: sql<string>`
        floor(extract(epoch from clock_timestamp()) * 1000)::bigint::text
      `,
    })
    .from(fxSystemScopeClocks)
    .where(eq(fxSystemScopeClocks.scopeId, scopeId))
    .limit(1);
  return databaseNowFromEpochMilliseconds(scopeId, rows[0]?.databaseNowEpochMilliseconds);
}

function databaseNowFromEpochMilliseconds(scopeId: ScopeId, epochMillisecondsText: unknown): Date {
  return projectTransactionSessionActivationResult(databaseNowFromEpochMillisecondsResult(scopeId, epochMillisecondsText));
}

function databaseNowFromEpochMillisecondsResult(scopeId: ScopeId, epochMillisecondsText: unknown) {
  if (typeof epochMillisecondsText !== "string") {
    return Result.fail(corruptionError(scopeId, "databaseClockInvalid"));
  }
  const epochMilliseconds = Number(epochMillisecondsText);
  const databaseNow = new Date(epochMilliseconds);
  if (
    !isPositiveSafeInteger(epochMilliseconds) ||
    finiteDateMilliseconds(databaseNow) === undefined
  ) {
    return Result.fail(corruptionError(scopeId, "databaseClockInvalid"));
  }
  return Result.succeed(databaseNow);
}

function deriveInitialLeaseExpiry(
  databaseNow: Date,
  hardExpiresAt: Date,
  leaseDurationMilliseconds: number,
): Result.Result<Date, PointMutationSessionActivationV1Error> {
  const databaseNowMilliseconds = finiteDateMilliseconds(databaseNow);
  const hardExpiryMilliseconds = finiteDateMilliseconds(hardExpiresAt);
  if (
    databaseNowMilliseconds === undefined ||
    hardExpiryMilliseconds === undefined
  ) {
    return Result.fail(activationError({ reason: "authorizationGrantExpired" }));
  }
  const remainingMilliseconds =
    hardExpiryMilliseconds - databaseNowMilliseconds;
  if (remainingMilliseconds <= 0) {
    return Result.fail(activationError({ reason: "authorizationGrantExpired" }));
  }
  const leaseExpiresAt = new Date(
    databaseNowMilliseconds +
      Math.min(leaseDurationMilliseconds, remainingMilliseconds),
  );
  const leaseExpiresAtMilliseconds = finiteDateMilliseconds(leaseExpiresAt);
  if (
    leaseExpiresAtMilliseconds === undefined ||
    leaseExpiresAtMilliseconds <= databaseNowMilliseconds
  ) {
    return Result.fail(activationError({ reason: "authorizationGrantExpired" }));
  }
  return Result.succeed(leaseExpiresAt);
}

function sessionEvidenceMatches(
  session: typeof fxSystemTransactionSessions.$inferSelect,
  expected: PreparedStoredMutationSessionEvidenceV1,
): boolean {
  const terminal = isTerminalTransactionSessionLifecycleV1(session.lifecycle);
  const logicalEvidenceMatches = session.executionAuthorityGeneration ===
      expected.executionAuthorityGeneration &&
    (terminal || (nullableJsonEqual(
      session.applicationExecutionAuthorityJson,
      expected.applicationExecutionAuthorityJson,
    ) && nullableBytesEqual(
      session.applicationExecutionAuthorityCanonicalBytes,
      expected.applicationExecutionAuthorityCanonicalBytes,
    ))) &&
    nullableBytesEqual(
      session.applicationExecutionAuthoritySha256,
      expected.applicationExecutionAuthoritySha256,
    ) &&
    session.packageId === expected.packageId &&
    session.artifactRuntime === expected.artifactRuntime &&
    session.artifactId === expected.artifactId &&
    session.sourcePackageHash === expected.sourcePackageHash &&
    session.executionModule === expected.executionModule &&
    session.functionPath === expected.functionPath &&
    session.functionKind === expected.functionKind &&
    session.schemaVersionId === expected.schemaVersionId &&
    session.policyVersion === expected.policyVersion &&
    bytesEqual(
      session.identityAccessPolicySha256,
      expected.identityAccessPolicySha256,
    ) &&
    (terminal || nullableJsonEqual(session.validatedArgsJson, expected.validatedArgsJson)) &&
    session.validatedArgsValueCodecVersion ===
      expected.validatedArgsValueCodecVersion &&
    (terminal || nullableBytesEqual(
      session.validatedArgsCanonicalBytes,
      expected.validatedArgsCanonicalBytes,
    )) &&
    bytesEqual(session.validatedArgsSha256, expected.validatedArgsSha256) &&
    session.authorizationRevocationEpoch ===
      expected.authorizationRevocationEpoch &&
    session.requestKey === expected.requestKey &&
    bytesEqual(session.requestSha256, expected.requestSha256);
  if (!logicalEvidenceMatches) return false;
  // Application admission has already authenticated the fresh grant against
  // every logical pin above. Retain the first stored grant as execution
  // authority so a newly signed retry of the same request is busy/replay, not
  // a false request-key conflict. Legacy callers still replay exact grant
  // evidence because their external preparation contract reuses that grant.
  if (expected.executionAuthorityGeneration === "application_v1") return true;
  const actualGrantExpiresAtMilliseconds = finiteDateMilliseconds(
    session.authorizationGrantExpiresAt,
  );
  const expectedGrantExpiresAtMilliseconds = finiteDateMilliseconds(
    expected.authorizationGrantExpiresAt,
  );
  return (
    session.authorizationGrantId === expected.authorizationGrantId &&
    (terminal || nullableJsonEqual(
      session.authorizationGrantJson,
      expected.authorizationGrantJson,
    )) &&
    session.authorizationGrantValueCodecVersion ===
      expected.authorizationGrantValueCodecVersion &&
    (terminal || nullableBytesEqual(
      session.authorizationGrantCanonicalBytes,
      expected.authorizationGrantCanonicalBytes,
    )) &&
    bytesEqual(
      session.authorizationGrantSha256,
      expected.authorizationGrantSha256,
    ) &&
    actualGrantExpiresAtMilliseconds !== undefined &&
    actualGrantExpiresAtMilliseconds === expectedGrantExpiresAtMilliseconds
  );
}

function nullableJsonEqual(
  actual: unknown | null,
  expected: unknown | null,
): boolean {
  if (actual === null || expected === null) return actual === expected;
  return isJsonObjectFromUnknown(actual) && isJsonObjectFromUnknown(expected) &&
    jsonEqual(actual, expected);
}

function nullableBytesEqual(
  actual: Uint8Array | null,
  expected: Uint8Array | null,
): boolean {
  return actual === null || expected === null
    ? actual === expected
    : bytesEqual(actual, expected);
}

function capturePreparedActivation(
  input: PreparedPointMutationSessionActivationV1,
): Result.Result<
  PreparedStoredMutationSessionActivationV1,
  PointMutationSessionActivationV1Error
> {
  if (input.executionProfile !== undefined &&
    input.executionProfile !== "durableOperations" &&
    input.executionProfile !== "finiteRoot") {
    return Result.fail(activationError({ reason: "invalidPreparedEvidence" }));
  }
  const evidence = input.evidence;
  return capturePreparedCommonEvidence(
    input.deploymentId,
    input.scopeId,
    input.evidence,
  ).pipe(Result.map(common => Object.freeze({
    ...common,
    executionProfile: input.executionProfile ?? "durableOperations",
    evidence: Object.freeze({
      ...common.evidence,
      executionAuthorityGeneration:
        "legacy_dynamic_worker_v1" as const,
      applicationExecutionAuthorityJson: null,
      applicationExecutionAuthorityCanonicalBytes: null,
      applicationExecutionAuthoritySha256: null,
      packageId: evidence.packageId,
      artifactRuntime: evidence.artifactRuntime,
      artifactId: evidence.artifactId,
      sourcePackageHash: evidence.sourcePackageHash,
      executionModule: evidence.executionModule,
    }),
  }) satisfies PreparedStoredMutationSessionActivationV1));
}

function capturePreparedCommonEvidence(
  deploymentId: TransactionGrantDeploymentIdV1,
  scopeId: ReplacementScopeIdV1,
  evidence: PreparedMutationSessionCommonEvidenceV1,
): Result.Result<
  Readonly<{
    readonly deploymentId: TransactionGrantDeploymentIdV1;
    readonly scopeId: ReplacementScopeIdV1;
    readonly evidence: PreparedMutationSessionCommonEvidenceV1;
  }>,
  PointMutationSessionActivationV1Error
> {
  if (
    !isJsonObjectFromUnknown(evidence.validatedArgsJson) ||
    !isJsonObjectFromUnknown(evidence.authorizationGrantJson)
  ) return Result.fail(activationError({ reason: "invalidPreparedEvidence" }));
  return Result.try({
    try: () => Object.freeze({
      deploymentId,
      scopeId: decodeReplacementScopeIdV1(scopeId),
      evidence: Object.freeze({
        functionPath: evidence.functionPath,
        functionKind: evidence.functionKind,
        schemaVersionId: evidence.schemaVersionId,
        policyVersion: evidence.policyVersion,
        identityAccessPolicySha256:
          TransactionIdentityAccessPolicySha256V1Schema.make(
            new Uint8Array(evidence.identityAccessPolicySha256),
          ),
        validatedArgsJson: cloneJsonObject(evidence.validatedArgsJson),
        validatedArgsValueCodecVersion:
          evidence.validatedArgsValueCodecVersion,
        validatedArgsCanonicalBytes:
          CanonicalTransactionArgumentsBytesV1Schema.make(
            new Uint8Array(evidence.validatedArgsCanonicalBytes),
          ),
        validatedArgsSha256: TransactionArgumentsSha256V1Schema.make(
          new Uint8Array(evidence.validatedArgsSha256),
        ),
        authorizationGrantId: evidence.authorizationGrantId,
        authorizationGrantJson: cloneJsonObject(
          evidence.authorizationGrantJson,
        ),
        authorizationGrantValueCodecVersion:
          evidence.authorizationGrantValueCodecVersion,
        authorizationGrantCanonicalBytes:
          CanonicalTransactionAuthorizationGrantBytesV1Schema.make(
            new Uint8Array(evidence.authorizationGrantCanonicalBytes),
          ),
        authorizationGrantSha256:
          TransactionAuthorizationGrantSha256V1Schema.make(
            new Uint8Array(evidence.authorizationGrantSha256),
          ),
        authorizationRevocationEpoch:
          TransactionAuthorizationRevocationEpochSchema.make(
            evidence.authorizationRevocationEpoch,
          ),
        authorizationGrantExpiresAt: cloneValidDate(
          evidence.authorizationGrantExpiresAt,
        ),
        requestKey: evidence.requestKey,
        requestSha256: TransactionRequestSha256V1Schema.make(
          new Uint8Array(evidence.requestSha256),
        ),
      }),
    }),
    catch: () => activationError({ reason: "invalidPreparedEvidence" }),
  });
}

const capturePreparedApplicationActivation = Effect.fn(
  "ApplicationMutationSessionActivation.capture",
)(function* (input: PreparedApplicationMutationSessionActivationV1) {
  if (input.executionProfile !== undefined &&
    input.executionProfile !== "durableOperations")
    return yield* Effect.fail(activationError({ reason: "invalidPreparedEvidence" }));
  const claimedSelection = yield* Effect.fromResult(
    claimApplicationExecutableActiveSelection(input.activeSelection),
  );
  const prepared = yield* capturePreparedApplicationActivationFromBasis(input, claimedSelection.basis);
  return Object.freeze({ ...prepared, selection: input.activeSelection });
});

const capturePreparedApplicationActivationFromBasis = Effect.fn("ApplicationMutationSessionActivation.captureBasis")(
function* (input: Omit<PreparedApplicationMutationSessionActivationV1, "activeSelection" | "executionProfile"> &
  Readonly<{ executionProfile?: PointMutationExecutionProfile }>,
  selectionBasis: ApplicationMutationActivationBasis, original?: CanonicalApplicationMutationExecutionAuthorityV1) {
  const executionAuthority = original ?? (yield* canonicalizeApplicationMutationExecutionAuthorityV1(input.evidence.executionAuthority));
  if (original !== undefined && !nullableJsonEqual(input.evidence.executionAuthority, original.authority))
    return yield* Effect.fail(activationError({ reason: "invalidPreparedEvidence" }));
  const grant = yield* Effect.try({
    try: () => inspectVerifiedApplicationMutationGrantV1(
      input.evidence.verifiedGrant,
    ),
    catch: () => activationError({ reason: "invalidPreparedEvidence" }),
  });
  const authority = executionAuthority.authority;
  const grantPayload = grant.payload;
  const canonicalArgs = yield* canonicalizeFlarexValueJsonV1Effect(
    input.evidence.validatedArgsJson,
  ).pipe(Effect.mapError(() =>
    activationError({ reason: "invalidPreparedEvidence" })
  ));
  if (
    input.deploymentId !== selectionBasis.deploymentId ||
    input.scopeId !== selectionBasis.authority.scopeId ||
    authority.runtimeTarget.scopeId !== input.scopeId ||
    authority.runtimeTarget.revisionId !== selectionBasis.revisionId ||
    authority.runtimeTarget.candidateId !== selectionBasis.candidateId ||
    authority.runtimeTarget.analysisId !== selectionBasis.analysisId ||
    authority.runtimeTarget.sourceArtifactRootSha256 !==
      encodeBytesToLowercaseHex(selectionBasis.sourceArtifactRootSha256) ||
    authority.runtimeTarget.manifestSha256 !==
      encodeBytesToLowercaseHex(selectionBasis.manifestSha256) ||
    authority.runtimeTarget.schemaSha256 !==
      encodeBytesToLowercaseHex(selectionBasis.applicationSchemaSha256) ||
    authority.runtimeTarget.functionCatalogSha256 !==
      encodeBytesToLowercaseHex(selectionBasis.functionCatalogSha256) ||
    authority.runtimeTarget.publicationSha256 !==
      encodeBytesToLowercaseHex(selectionBasis.publicationSha256) ||
    authority.activationSequence !== selectionBasis.activationSequence.toString() ||
    authority.activeHeadSha256 !==
      encodeBytesToLowercaseHex(selectionBasis.headSha256) ||
    authority.schemaVersionId !== selectionBasis.schemaVersionId ||
    grantPayload.deploymentId !== input.deploymentId ||
    grantPayload.scopeId !== input.scopeId ||
    grantPayload.executionAuthoritySha256 !==
      encodeBytesToLowercaseHex(executionAuthority.sha256) ||
    grantPayload.activationSequence !== authority.activationSequence ||
    grantPayload.activeHeadSha256 !== authority.activeHeadSha256 ||
    grantPayload.schemaVersionId !== authority.schemaVersionId ||
    grantPayload.functionPath !== authority.runtimeTarget.function.path ||
    grantPayload.functionKind !== authority.runtimeTarget.function.kind ||
    input.evidence.functionPath !== grantPayload.functionPath ||
    input.evidence.functionKind !== grantPayload.functionKind ||
    input.evidence.schemaVersionId !== grantPayload.schemaVersionId ||
    grantPayload.policyVersion !== input.evidence.policyVersion ||
    grantPayload.identityAccessPolicySha256 !==
      encodeBytesToLowercaseHex(input.evidence.identityAccessPolicySha256) ||
    grantPayload.validatedArgsValueCodecVersion !==
      input.evidence.validatedArgsValueCodecVersion ||
    grantPayload.validatedArgsSha256 !==
      encodeBytesToLowercaseHex(input.evidence.validatedArgsSha256) ||
    !bytesEqual(
      canonicalArgs.canonicalBytes,
      input.evidence.validatedArgsCanonicalBytes,
    ) ||
    !bytesEqual(canonicalArgs.sha256, input.evidence.validatedArgsSha256) ||
    grantPayload.requestKey !== input.evidence.requestKey ||
    grantPayload.requestSha256 !==
      encodeBytesToLowercaseHex(input.evidence.requestSha256)
  ) return yield* Effect.fail(
    activationError({ reason: "invalidPreparedEvidence" }),
  );
  const common = yield* Effect.fromResult(capturePreparedCommonEvidence(
    input.deploymentId,
    input.scopeId,
    {
      ...input.evidence,
      authorizationGrantId: grant.authorizationGrantId,
      authorizationGrantJson: grant.authorizationGrantJson,
      authorizationGrantValueCodecVersion:
        grant.authorizationGrantValueCodecVersion,
      authorizationGrantCanonicalBytes:
        grant.authorizationGrantCanonicalBytes,
      authorizationGrantSha256: grant.authorizationGrantSha256,
      authorizationRevocationEpoch:
        grant.authorizationRevocationEpoch,
      authorizationGrantExpiresAt: new Date(
        grant.authorizationGrantExpiresAt,
      ),
    },
  ));
  return Object.freeze({
    activation: Object.freeze({
      deploymentId: common.deploymentId,
      scopeId: common.scopeId,
      executionProfile: input.executionProfile ?? "durableOperations",
      evidence: Object.freeze({
        ...common.evidence,
        executionAuthorityGeneration: "application_v1" as const,
        applicationExecutionAuthorityJson:
          executionAuthority.authority,
        applicationExecutionAuthorityCanonicalBytes:
          executionAuthority.canonicalBytes,
        applicationExecutionAuthoritySha256: executionAuthority.sha256,
        packageId: null,
        artifactRuntime: null,
        artifactId: null,
        sourcePackageHash: null,
        executionModule: null,
      }),
    }) satisfies PreparedStoredMutationSessionActivationV1,
  });
});

function captureAttemptSelector(
  input: PointMutationSessionAttemptSelectorV1,
): Result.Result<
  PointMutationSessionAttemptSelectorV1,
  PointMutationSessionAttemptLoadV1Error
> {
  return decodeAttemptSelectorResult(input).pipe(
    Result.mapError(invalidAttemptSelector),
  );
}

function decodeAttemptSelectorResult(
  input: PointMutationSessionAttemptSelectorV1,
): Result.Result<PointMutationSessionAttemptSelectorV1, unknown> {
  return Result.gen(function* () {
    const deploymentIdInput = yield* readAttemptSelectorInput(
      () => input.deploymentId,
    );
    const deploymentId = yield* decodeAttemptDeploymentIdResult(
      deploymentIdInput,
    );
    const scopeIdInput = yield* readAttemptSelectorInput(() => input.scopeId);
    const scopeId = yield* decodeAttemptScopeIdResult(scopeIdInput);
    const sessionIdInput = yield* readAttemptSelectorInput(
      () => input.sessionId,
    );
    const sessionId = yield* decodeAttemptSessionIdResult(sessionIdInput);
    const attemptFenceInput = yield* readAttemptSelectorInput(
      () => input.attemptFence,
    );
    const attemptFence = yield* decodeAttemptFenceResult(attemptFenceInput);
    return Object.freeze({
      deploymentId,
      scopeId,
      sessionId,
      attemptFence,
    } satisfies PointMutationSessionAttemptSelectorV1);
  });
}

function readAttemptSelectorInput<A>(
  read: () => A,
): Result.Result<A, unknown> {
  return Result.try({ try: read, catch: (cause) => cause });
}

function invalidAttemptSelector(
  cause: unknown,
): PointMutationSessionAttemptLoadV1Error {
  return attemptLoadError({ reason: "invalidSelector", cause });
}

function captureTerminalizationAttemptSelector(
  input: PointMutationSessionAttemptSelectorV1,
): Result.Result<
  PointMutationSessionAttemptSelectorV1,
  PointMutationSessionAttemptTerminalizationV1Error
> {
  return decodeAttemptSelectorResult(input).pipe(
    Result.mapError(invalidTerminalizationAttemptSelector),
  );
}

function captureAttemptAbortInput(
  input: PointMutationSessionAttemptAbortInputV1,
): Result.Result<
  PointMutationSessionAttemptAbortInputV1,
  PointMutationSessionAttemptTerminalizationV1Error
> {
  return Result.gen(function* () {
    const selectorInput = yield* readAttemptTerminalizationInput(
      () => input.selector,
      invalidTerminalizationAttemptSelector,
    );
    const selector = yield* captureTerminalizationAttemptSelector(selectorInput);
    const expectedSnapshotTokenInput = yield* readAttemptTerminalizationInput(
      () => input.expectedSnapshotToken,
      invalidAbortSnapshot,
    );
    const expectedSnapshotToken = yield* decodeAttemptSnapshotTokenResult(
      expectedSnapshotTokenInput,
    ).pipe(Result.mapError(invalidAbortSnapshot));
    if (expectedSnapshotToken.scopeId !== selector.scopeId) {
      return yield* Result.fail(invalidAbortSnapshot(
        new Error("Abort snapshot scope does not match its selector."),
      ));
    }
    const claimInput = yield* readAttemptTerminalizationInput(
      () => input.executionClaim,
      invalidAbortExecutionClaim,
    );
    const claimOwner = decodeTransactionExecutionClaimOwnerV1(
      claimInput.claimOwner,
    );
    const claimFence = decodeTransactionExecutionClaimFenceV1(
      claimInput.claimFence,
    );
    if (Result.isFailure(claimOwner) || Result.isFailure(claimFence)) {
      return yield* Result.fail(invalidAbortExecutionClaim(
        new Error("Abort execution claim is invalid."),
      ));
    }
    return Object.freeze({
      selector,
      expectedSnapshotToken: Object.freeze(expectedSnapshotToken),
      executionClaim: Object.freeze({
        claimOwner: claimOwner.success,
        claimFence: claimFence.success,
      }),
    });
  });
}

function readAttemptTerminalizationInput<A>(
  read: () => A,
  onFailure: (cause: unknown) => PointMutationSessionAttemptTerminalizationV1Error,
): Result.Result<A, PointMutationSessionAttemptTerminalizationV1Error> {
  return Result.try({ try: read, catch: onFailure });
}

function invalidTerminalizationAttemptSelector(
  cause: unknown,
): PointMutationSessionAttemptTerminalizationV1Error {
  return attemptTerminalizationError({ reason: "invalidSelector", cause });
}

function invalidAbortSnapshot(
  cause: unknown,
): PointMutationSessionAttemptTerminalizationV1Error {
  return attemptTerminalizationError({
    reason: "invalidAbortSnapshot",
    cause,
  });
}

function invalidAbortExecutionClaim(
  cause: unknown,
): PointMutationSessionAttemptTerminalizationV1Error {
  return attemptTerminalizationError({
    reason: "invalidAbortExecutionClaim",
    cause,
  });
}

function requireActivationTarget(
  target: LocatedScopeClockReader,
  scopeId: ScopeId,
): Result.Result<
  LocatedPointMutationSessionActivationTargetV1,
  PointMutationSessionActivationTargetV1Error
> {
  if (!isActivationTarget(target)) {
    return Result.fail(
      new PointMutationSessionActivationTargetV1Error(scopeId),
    );
  }
  return Result.succeed(target);
}

function requireAttemptLoadTarget(
  target: LocatedScopeClockReader,
  scopeId: ScopeId,
): Result.Result<
  LocatedPointMutationSessionAttemptLoadTargetV1,
  PointMutationSessionAttemptLoadTargetV1Error
> {
  if (!isAttemptLoadTarget(target)) {
    return Result.fail(new PointMutationSessionAttemptLoadTargetV1Error(scopeId));
  }
  return Result.succeed(target);
}

function requireAttemptTerminalizationTarget(
  target: LocatedScopeClockReader,
  scopeId: ScopeId,
): Result.Result<
  LocatedPointMutationSessionAttemptTerminalizationTargetV1,
  PointMutationSessionAttemptTerminalizationTargetV1Error
> {
  if (!isAttemptTerminalizationTarget(target)) {
    return Result.fail(
      new PointMutationSessionAttemptTerminalizationTargetV1Error(scopeId),
    );
  }
  return Result.succeed(target);
}

function isActivationTarget(
  target: LocatedScopeClockReader,
): target is LocatedPointMutationSessionActivationTargetV1 {
  return typeof Reflect.get(
    target,
    ACTIVATE_PREPARED_POINT_MUTATION_SESSION_EFFECT_V1,
  ) === "function";
}

function isAttemptLoadTarget(
  target: LocatedScopeClockReader,
): target is LocatedPointMutationSessionAttemptLoadTargetV1 {
  return typeof Reflect.get(
    target,
    LOAD_EXACT_POINT_MUTATION_SESSION_ATTEMPT_EFFECT_V1,
  ) === "function";
}

function isAttemptTerminalizationTarget(
  target: LocatedScopeClockReader,
): target is LocatedPointMutationSessionAttemptTerminalizationTargetV1 {
  return typeof Reflect.get(
    target,
    TERMINALIZE_EXACT_POINT_MUTATION_SESSION_ATTEMPT_EFFECT_V1,
  ) === "function";
}

function requireLeaseDuration(value: number): number {
  if (!isPositiveSafeInteger(value)) {
    throw new PointMutationSessionActivationConfigurationV1Error({
      reason: "invalidLeaseDuration",
    });
  }
  return value;
}

function requireActivationExecutionClaimDuration(value: number): number {
  if (!isPositiveSafeInteger(value)) {
    throw new PointMutationSessionActivationConfigurationV1Error({
      reason: "invalidExecutionClaimDuration",
    });
  }
  return value;
}

function requireExecutionClaimAcquisitionDuration(value: number): number {
  if (!isPositiveSafeInteger(value)) {
    throw new PointMutationExecutionClaimAcquisitionConfigurationV1Error({
      reason: "invalidClaimDuration",
    });
  }
  return value;
}

const generateSessionIdEffect = Effect.fn(
  "PointMutationSessionActivation.generateSessionId",
)(function* (
  randomUuid: () => string,
): Effect.fn.Return<
  TransactionSessionIdV1,
  PointMutationSessionActivationConfigurationV1Error
> {
  const value = yield* Effect.try({
    try: randomUuid,
    catch: (cause) =>
      new PointMutationSessionActivationConfigurationV1Error({
        reason: "sessionIdGenerationFailed",
        cause,
      }),
  });
  return yield* Effect.fromResult(validateGeneratedSessionId(value));
});

function validateGeneratedSessionId(
  value: string,
): Result.Result<
  TransactionSessionIdV1,
  PointMutationSessionActivationConfigurationV1Error
> {
  if (!UUID_V4_PATTERN.test(value)) {
    return Result.fail(new PointMutationSessionActivationConfigurationV1Error({
      reason: "invalidGeneratedSessionId",
      value,
    }));
  }
  return Result.succeed(TransactionSessionIdV1Schema.make(value));
}

function projectExecutionClaimLivenessResult<Success>(
  result: Result.Result<
    Success,
    | PointMutationExecutionClaimLivenessV1Error
    | TransactionExecutionClaimCorruptionV1Error
    | TransactionExecutionClaimStaleV1Error
  >,
): Success {
  return Result.match(result, {
    onSuccess: (value) => value,
    onFailure: (failure) => {
      if (failure instanceof TransactionExecutionClaimStaleV1Error) {
        const reason = failure.reason === "claimOwnerMismatch"
          ? "claimOwnerChanged"
          : failure.reason === "claimFenceMismatch"
          ? "claimFenceChanged"
          : "claimExpired";
        throw new PointMutationExecutionClaimLivenessStaleV1Error({ reason });
      }
      if (failure instanceof TransactionExecutionClaimCorruptionV1Error) {
        throw executionClaimLivenessCorruption("claimInvalid", failure);
      }
      throw failure;
    },
  });
}

function mapExecutionClaimRenewalIssue(
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

function executionClaimLivenessCorruption(
  reason: PointMutationExecutionClaimLivenessCorruptionV1Error["reason"],
  cause?: unknown,
): PointMutationExecutionClaimLivenessCorruptionV1Error {
  return new PointMutationExecutionClaimLivenessCorruptionV1Error({
    reason,
    ...(cause === undefined ? {} : { cause }),
  });
}

function mapExecutionClaimLivenessTransactionError(
  cause: unknown,
): Exclude<
  PointMutationExecutionClaimLivenessV1Error,
  | PointMutationExecutionClaimLivenessInputV1Error
  | PointMutationExecutionClaimLivenessConfigurationV1Error
  | TrustedScopeAuthorityResolutionError
> {
  if (cause instanceof LocatedReadCommittedTransactionFailureV1) {
    switch (cause.issue.kind) {
      case "callbackRolledBack":
        return mapExecutionClaimLivenessTransactionError(
          cause.issue.callbackCause,
        );
      case "decisionUncertain":
        return new PointMutationExecutionClaimLivenessUncertainV1Error({
          cause,
        });
      case "callbackCleanupFailed":
      case "infrastructureFailure":
        return new PointMutationExecutionClaimLivenessPersistenceV1Error({
          operation: "transaction",
          cause,
        });
    }
  }
  if (
    cause instanceof PointMutationExecutionClaimLivenessStaleV1Error ||
    cause instanceof PointMutationExecutionClaimLivenessCorruptionV1Error ||
    cause instanceof PointMutationExecutionClaimLivenessPersistenceV1Error ||
    cause instanceof PointMutationExecutionClaimLivenessUncertainV1Error
  ) {
    return cause;
  }
  if (cause instanceof PointMutationSessionAuthorityCorruptionV1Error) {
    return executionClaimLivenessCorruption(
      cause.issue === "snapshotLeaseInvalid"
        ? "leaseInvalid"
        : cause.issue === "journalRootInvalid" ||
            cause.issue === "activeJournalRootMissing"
        ? "journalRootInvalid"
        : "sessionInvalid",
      cause,
    );
  }
  if (cause instanceof ScopeClockNotFoundError) {
    return new PointMutationExecutionClaimLivenessStaleV1Error({
      reason: "scopeChanged",
    });
  }
  return new PointMutationExecutionClaimLivenessPersistenceV1Error({
    operation: "transaction",
    cause,
  });
}

const executionClaimLivenessStableAuthorityFailures = Object.freeze({
  selectorScopeMismatch: () =>
    new PointMutationExecutionClaimLivenessStaleV1Error({
      reason: "scopeChanged",
    }),
  unsupportedStorageGeneration: () =>
    new PointMutationExecutionClaimLivenessStaleV1Error({
      reason: "generationChanged",
    }),
  storageGenerationChanged: () =>
    new PointMutationExecutionClaimLivenessStaleV1Error({
      reason: "generationChanged",
    }),
  storageGenerationFenceChanged: () =>
    new PointMutationExecutionClaimLivenessStaleV1Error({
      reason: "generationChanged",
    }),
  scopeEpochChanged: () =>
    new PointMutationExecutionClaimLivenessStaleV1Error({
      reason: "epochChanged",
    }),
} satisfies PointMutationSessionStableAuthorityFailureFactoryV1);

const executionClaimLivenessExactSessionFailures = Object.freeze({
  sessionMissing: () =>
    new PointMutationExecutionClaimLivenessStaleV1Error({
      reason: "attemptMissing",
    }),
  staleAttemptFence: () =>
    new PointMutationExecutionClaimLivenessStaleV1Error({
      reason: "attemptReplaced",
    }),
} satisfies PointMutationSessionExactSessionFailureFactoryV1);

const executionClaimLivenessAttemptAuthorityFailures = Object.freeze({
  unsupportedStorageGeneration: () =>
    new PointMutationExecutionClaimLivenessStaleV1Error({
      reason: "generationChanged",
    }),
  storageGenerationFenceChanged: () =>
    new PointMutationExecutionClaimLivenessStaleV1Error({
      reason: "generationChanged",
    }),
  authorizationRevocationEpochChanged: () =>
    new PointMutationExecutionClaimLivenessStaleV1Error({
      reason: "revocationEpochChanged",
    }),
  scopeEpochChanged: () =>
    new PointMutationExecutionClaimLivenessStaleV1Error({
      reason: "epochChanged",
    }),
} satisfies PointMutationSessionAttemptAuthorityFailureFactoryV1);

const generateExecutionClaimOwnerEffect = Effect.fn(
  "PointMutationSessionActivation.generateExecutionClaimOwner",
)(function* (
  randomUuid: () => string,
): Effect.fn.Return<
  TransactionExecutionClaimOwnerV1,
  PointMutationSessionActivationConfigurationV1Error
> {
  const value = yield* Effect.try({
    try: randomUuid,
    catch: (cause) =>
      new PointMutationSessionActivationConfigurationV1Error({
        reason: "executionClaimOwnerGenerationFailed",
        cause,
      }),
  });
  const decodedOutcome = Result.match(
    decodeTransactionExecutionClaimOwnerV1(value),
    {
      onSuccess: (ownerValue) => ({ ok: true as const, ownerValue }),
      onFailure: () => ({ ok: false as const }),
    },
  );
  if (!decodedOutcome.ok) {
    return yield* Effect.fail(
      new PointMutationSessionActivationConfigurationV1Error({
        reason: "invalidGeneratedExecutionClaimOwner",
        value,
      }),
    );
  }
  return decodedOutcome.ownerValue;
});

function mapActivationAuthorityError(
  error: TrustedScopeAuthorityError,
): TrustedScopeAuthorityResolutionError |
  PointMutationSessionActivationPersistenceV1Error {
  return error instanceof TrustedScopeAuthorityPortError
    ? new PointMutationSessionActivationPersistenceV1Error({
        operation: error.operation,
        cause: error.cause,
      })
    : error;
}

function mapActivationTransactionError(
  cause: unknown,
): PointMutationSessionActivationV1Error |
  PointMutationSessionAuthorityCorruptionV1Error |
  PointMutationSessionActivationPersistenceV1Error {
  if (cause instanceof ScopeExecutionAuthorityError) {
    return activationError({
      reason: cause.reason === "targetPlacementMismatch" ||
          cause.reason === "scopeMismatch"
        ? "scopeMismatch"
        : cause.reason,
    });
  }
  if (
    cause instanceof LocatedReadCommittedTransactionFailureV1 &&
    cause.issue.kind === "callbackRolledBack"
  ) {
    return mapActivationTransactionError(cause.issue.callbackCause);
  }
  if (
    cause instanceof PointMutationSessionActivationV1Error ||
    cause instanceof PointMutationSessionAuthorityCorruptionV1Error ||
    cause instanceof PointMutationSessionActivationPersistenceV1Error
  ) {
    return cause;
  }
  if (cause instanceof TransactionExecutionClaimStaleV1Error) {
    return activationError({ reason: "executionClaimUnavailable" });
  }
  if (cause instanceof TransactionExecutionClaimCorruptionV1Error) {
    return corruptionError(cause.scopeId, "executionClaimInvalid", cause);
  }
  return new PointMutationSessionActivationPersistenceV1Error({
    operation: "activationTransaction",
    cause,
  });
}

function mapApplicationActivationTransactionError(
  cause: unknown,
): PointMutationSessionActivationV1Error |
  PointMutationSessionAuthorityCorruptionV1Error |
  PointMutationSessionActivationPersistenceV1Error |
  ApplicationActivationError {
  if (
    cause instanceof LocatedReadCommittedTransactionFailureV1 &&
    cause.issue.kind === "callbackRolledBack"
  ) return mapApplicationActivationTransactionError(
    cause.issue.callbackCause,
  );
  if (cause instanceof ApplicationActivationError) return cause;
  return mapActivationTransactionError(cause);
}

function locatedActivationAuthority(
  target: LocatedReadCommittedAttemptTargetV1,
  authority: TrustedScopeAuthority,
): LocatedTrustedScopeAuthority<LocatedReadCommittedAttemptTargetV1> {
  return Object.freeze({ authority, target });
}

function mapAttemptLoadAuthorityError(
  error: TrustedScopeAuthorityError,
): TrustedScopeAuthorityResolutionError |
  PointMutationSessionAttemptLoadPersistenceV1Error {
  return error instanceof TrustedScopeAuthorityPortError
    ? new PointMutationSessionAttemptLoadPersistenceV1Error({
        operation: error.operation,
        cause: error.cause,
      })
    : error;
}

function mapAttemptLoadTransactionError(
  cause: unknown,
): PointMutationSessionAttemptLoadV1Error |
  PointMutationSessionAuthorityCorruptionV1Error |
  PointMutationSessionAttemptLoadPersistenceV1Error {
  if (
    cause instanceof PointMutationSessionAttemptLoadV1Error ||
    cause instanceof PointMutationSessionAuthorityCorruptionV1Error
  ) {
    return cause;
  }
  if (cause instanceof TransactionExecutionClaimStaleV1Error) {
    return attemptLoadError({ reason: "executionClaimUnavailable" });
  }
  if (cause instanceof TransactionExecutionClaimCorruptionV1Error) {
    return corruptionError(cause.scopeId, "executionClaimInvalid", cause);
  }
  return new PointMutationSessionAttemptLoadPersistenceV1Error({
    operation: "attemptLoadTransaction",
    cause,
  });
}

function mapAttemptTerminalizationAuthorityError(
  error: TrustedScopeAuthorityError,
): TrustedScopeAuthorityResolutionError |
  PointMutationSessionAttemptTerminalizationPersistenceV1Error {
  return error instanceof TrustedScopeAuthorityPortError
    ? new PointMutationSessionAttemptTerminalizationPersistenceV1Error({
        operation: error.operation,
        cause: error.cause,
      })
    : error;
}

function mapAttemptTerminalizationTransactionError(
  operation: PointMutationSessionAttemptTerminalizationOperationV1,
  cause: unknown,
): PointMutationSessionAttemptTerminalizationV1Error |
  PointMutationSessionAuthorityCorruptionV1Error |
  PointMutationSessionAttemptTerminalizationPersistenceV1Error {
  if (
    cause instanceof PointMutationSessionAttemptTerminalizationV1Error ||
    cause instanceof PointMutationSessionAuthorityCorruptionV1Error
  ) {
    return cause;
  }
  if (cause instanceof TransactionExecutionClaimStaleV1Error) {
    return attemptTerminalizationError({
      reason: "executionClaimUnavailable",
    });
  }
  if (cause instanceof TransactionExecutionClaimCorruptionV1Error) {
    return corruptionError(cause.scopeId, "executionClaimInvalid", cause);
  }
  return new PointMutationSessionAttemptTerminalizationPersistenceV1Error({
    operation: operation === "abort"
      ? "attemptAbortTransaction"
      : "attemptExpireTransaction",
    cause,
  });
}

function activationResult(
  status: PointMutationSessionActivationResultV1["status"],
  anchor: PointMutationSessionAnchorV1,
  executionClaim?: TransactionExecutionClaimObservationV1,
): PointMutationSessionActivationResultV1 {
  const capturedAnchor = Object.freeze({
    ...anchor,
    snapshotToken: Object.freeze(
      SnapshotTokenSchema.make({
        scopeId: anchor.snapshotToken.scopeId,
        epoch: anchor.snapshotToken.epoch,
        commitSeq: anchor.snapshotToken.commitSeq,
      }),
    ),
  } satisfies PointMutationSessionAnchorV1);
  switch (status) {
    case "created":
      if (executionClaim === undefined) {
        throw corruptionError(anchor.scopeId, "executionClaimInvalid");
      }
      return Object.freeze({
        status: "created",
        anchor: capturedAnchor,
        executionClaim: Object.freeze({ ...executionClaim }),
      } satisfies PointMutationSessionActivationResultV1);
    case "busy":
      return Object.freeze({
        status: "busy",
        anchor: capturedAnchor,
      } satisfies PointMutationSessionActivationResultV1);
  }
}

function attemptLoadResult(
  loaded: ExactRunningAttemptKernelContextV1,
  attemptFacet: PointMutationSessionAttemptFacetObservationV1,
): PointMutationSessionAttemptLoadResultV1 {
  return Object.freeze({
    status: "loaded",
    lastMetadataSequence: loaded.scopeClock.lastMetadataSequence,
    anchor: captureSessionAnchor(loaded.anchor),
    executionPin: Object.freeze({
      ...loaded.executionPin,
    }),
    attemptFacet: Object.freeze({ kind: attemptFacet.kind }),
  });
}

function attemptTerminalizationResult(
  status: PointMutationSessionAttemptTerminalizationResultV1["status"],
  selector: PointMutationSessionAttemptSelectorV1,
  lifecycle: PointMutationSessionTerminalLifecycleV1,
  terminalizedAt: Date,
): PointMutationSessionAttemptTerminalizationResultV1 {
  switch (status) {
    case "terminalized": {
      if (lifecycle === "committed") {
        throw corruptionError(selector.scopeId, "sessionRecordInvalid");
      }
      return Object.freeze({
        status: "terminalized",
        terminal: createTerminalObservation(
          selector,
          lifecycle,
          terminalizedAt,
        ),
      });
    }
    case "observed":
      return Object.freeze({
        status: "observed",
        terminal: createTerminalObservation(
          selector,
          lifecycle,
          terminalizedAt,
        ),
      });
  }
}

function createTerminalObservation<
  Lifecycle extends PointMutationSessionTerminalLifecycleV1,
>(
  selector: PointMutationSessionAttemptSelectorV1,
  lifecycle: Lifecycle,
  terminalizedAt: Date,
): PointMutationSessionTerminalObservationV1<Lifecycle> {
  return Object.freeze({
    ...selector,
    lifecycle,
    terminalizedAt: cloneValidTerminalDate(
      terminalizedAt,
      selector.scopeId,
    ).toISOString(),
  });
}

function captureSessionAnchor(
  anchor: PointMutationSessionAnchorV1,
): PointMutationSessionAnchorV1 {
  return Object.freeze({
    ...anchor,
    snapshotToken: Object.freeze(
      SnapshotTokenSchema.make({
        scopeId: anchor.snapshotToken.scopeId,
        epoch: anchor.snapshotToken.epoch,
        commitSeq: anchor.snapshotToken.commitSeq,
      }),
    ),
  } satisfies PointMutationSessionAnchorV1);
}

function activationError(
  issue: PointMutationSessionActivationIssueV1,
): PointMutationSessionActivationV1Error {
  return new PointMutationSessionActivationV1Error(issue);
}

function attemptLoadError(
  issue: PointMutationSessionAttemptLoadIssueV1,
): PointMutationSessionAttemptLoadV1Error {
  return new PointMutationSessionAttemptLoadV1Error(issue);
}

function attemptTerminalizationError(
  issue: PointMutationSessionAttemptTerminalizationIssueV1,
): PointMutationSessionAttemptTerminalizationV1Error {
  return new PointMutationSessionAttemptTerminalizationV1Error(issue);
}

function corruptionError(
  scopeId: ScopeId,
  issue: PointMutationSessionAuthorityCorruptionIssueV1,
  cause?: unknown,
): PointMutationSessionAuthorityCorruptionV1Error {
  return new PointMutationSessionAuthorityCorruptionV1Error(
    scopeId,
    issue,
    cause === undefined ? undefined : { cause },
  );
}

/**
 * Temporary projection owned by Drizzle 0.45's Promise transaction callbacks.
 * Delete it when activation, acquisition, reload, and terminalization yield
 * Result or Effect failures directly from an Effect-native transaction client.
 */
function projectTransactionSessionActivationResult<A, E>(
  result: Result.Result<A, E>,
): A {
  return Result.getOrThrow(result);
}

function cloneValidDate(value: Date): Date {
  const cloned = copyFiniteDate(value);
  if (cloned === undefined) {
    throw new PointMutationSessionActivationV1Error({
      reason: "invalidPreparedEvidence",
    });
  }
  return cloned;
}

function cloneValidTerminalDate(value: Date, scopeId: ScopeId): Date {
  const cloned = copyFiniteDate(value);
  if (cloned === undefined) {
    throw corruptionError(scopeId, "sessionRecordInvalid");
  }
  return cloned;
}

function cloneJsonObject(value: JsonObject): JsonObject {
  const result: Record<string, Json> = {};
  for (const key of Object.keys(value)) {
    const child = value[key];
    if (child === undefined) {
      throw new Error(`Missing JSON object value for key ${key}.`);
    }
    Object.defineProperty(result, key, {
      configurable: false,
      enumerable: true,
      value: cloneJson(child),
      writable: false,
    });
  }
  return Object.freeze(result);
}

function cloneJson(value: Json): Json {
  if (isJsonArray(value)) {
    return Object.freeze(value.map(cloneJson));
  }
  if (isJsonObject(value)) {
    return cloneJsonObject(value);
  }
  return value;
}
