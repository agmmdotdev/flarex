import {
  bytesEqualFullScan as bytesEqual,
  copyBytes,
  encodeBytesToLowercaseHex,
  isUint8ArrayWithByteLength,
} from "@flarex/utils/bytes";
import { isNonArrayRecord } from "@flarex/utils/records";
import { isPositiveSafeInteger } from "@flarex/utils/numbers";
import { isNonBlankString } from "@flarex/utils/strings";
import {
  Cause,
  Data,
  Duration,
  Effect,
  Encoding,
  Exit,
  Random,
  Result,
  Schema,
} from "effect";

import type {
  PointCommitAttemptScalarCommandV1,
  PointCommitFinishingTransitionCommandV1,
  PointCommitFinishingTransitionPortV1,
  PointCommitFinishingTransitionResultV1,
  PointCommitFinishingTransitionV1Error,
  PointCommitPublicationCommandV1,
  PointCommitPublicationResultV1,
  PointCommitPublicationV1Error,
  PointCommitOutcomeResolutionForOccRerunV1Error,
  PointCommitOutcomeResolutionPortV1,
  PointCommitPublisherPortV1,
  PointCommitRollbackProofPortV1,
  PointCommitRollbackProofV1Error,
  PointCommitTransactionCommandV1,
  PointCommitWouldCommitV1,
  PointMutationAttemptReplacementCommandV1,
  PointMutationAttemptReplacementObservationV1,
  PointMutationAttemptReplacementPortV1,
  PointMutationAttemptReplacementV1Error,
  CommittedPointOutcomeResolutionV1,
} from "@flarex/persistence-postgres/point-commit-transaction";
import {
  PointCommitConflictV1Error,
  PointCommitCorruptionV1Error,
  RESOLVE_POINT_COMMIT_OUTCOME_FOR_OCC_RERUN_V1,
} from "@flarex/persistence-postgres/point-commit-transaction";
import type {
  StoredOccExecutionEvidenceAuthorityV1,
  StoredOccExecutionEvidenceLoaderV1,
  StoredOccExecutionEvidenceLoadResultV1,
  StoredOccExecutionEvidencePersistenceV1Error,
} from "@flarex/persistence-postgres/stored-occ-execution";
import type { PointMutationSessionAttemptSelectorV1 } from "@flarex/persistence-postgres/transaction-session-activation";

import {
  AppDocumentSystemFieldV1Error,
  canonicalizeAppDocumentV1,
  verifyAppDocumentEvidenceV1,
  type AppCreationTimeV1,
} from "flarex-protocol/app-document";
import {
  AppDocumentIdV1Error,
  appDocumentIdV1FromRowIdentity,
  appRowIdHexV1FromBytes,
  decodeAppDocumentIdentityV1,
  type AppDocumentIdV1,
  type AppRowIdHexV1,
} from "flarex-protocol/app-document-id";
import type { CatalogTableId } from "flarex-protocol/catalog";
import {
  CanonicalSuccessfulResultBytesV1Schema,
  CommitEnvelopeV1Schema,
  decodeCanonicalSessionJournalV1Effect,
  decodeCommitEnvelopeV1Effect,
  requireStoredForSessionAttemptCommitEnvelopeV1Effect,
  verifySuccessfulResultEvidenceV1Effect,
  type CommitFinalSyscallSequenceV1,
  type CommitMaterialWriteEventEvidenceBytesV1,
  type CommitProtocolV1Error,
  type CanonicalSuccessfulResultV1,
  type LogicalAppWriteV1,
  type LogicalPatchFieldV1,
  type LogicalReadDependencyV1,
  type SessionJournalV1,
  type StoredForSessionAttemptCommitEnvelopeV1,
} from "flarex-protocol/commit-protocol";
import {
  encodeCanonicalJson,
  type Json,
  type JsonObject,
} from "flarex-protocol/json";
import {
  CatalogSchemaVersionIdSchema,
  decodeSchemaManifestAppSchemaV1,
  type CatalogSchemaVersionId,
  type SchemaManifestAppSchemaV1,
} from "flarex-protocol/schema-manifest";
import {
  PointMutationTargetSelectionV1Error,
  PointMutationTargetFunctionMetadataV1Schema,
  canonicalizePointMutationRequestV1,
  requirePointMutationArgumentSemanticSizeV1,
  type PointMutationTargetFunctionMetadataV1,
} from "flarex-protocol/point-mutation-start";
import {
  CommitSeqSchema,
  FlarexDbV1StorageGenerationSchema,
  ReplacementScopeIdV1Schema,
  SnapshotTokenSchema,
  StorageGenerationFenceSchema,
  type FlarexDbV1StorageGeneration,
  type ReplacementScopeIdV1,
  type ScopeUuidV1,
  type SnapshotToken,
  type StorageGenerationFence,
} from "flarex-protocol/storage-authority";
import {
  TransactionGrantDeploymentIdV1Schema,
  transactionGrantIdentityAccessPolicySha256HexV1FromBytes,
  transactionGrantRequestSha256HexV1FromBytes,
  transactionGrantValidatedArgsSha256HexV1FromBytes,
  type TransactionGrantDeploymentIdV1,
} from "flarex-protocol/transaction-grant";
import {
  type StoredTransactionSessionScalarsV1,
  TransactionArtifactIdV1Schema,
  TransactionArtifactRuntimeV1Schema,
  TransactionAuthorizationGrantIdV1Schema,
  TransactionArgumentsSha256V1Schema,
  TransactionAuthorizationRevocationEpochSchema,
  TransactionExecutionModuleV1Schema,
  TransactionFunctionKindV1Schema,
  TransactionFunctionPathV1Schema,
  TransactionIdentityAccessPolicySha256V1Schema,
  TransactionPackageIdV1Schema,
  TransactionPolicyVersionV1Schema,
  TransactionRequestKeyV1Schema,
  TransactionRequestSha256V1Schema,
  TransactionSourcePackageSha256HexV1Schema,
  TransactionAttemptFenceSchema,
  TransactionSessionIdV1Schema,
  type TransactionAttemptFence,
  type TransactionSessionIdV1,
  type TransactionSessionLifecycleV1,
} from "flarex-protocol/transaction-session";
import {
  FLAREX_VALUE_CODEC_VERSION_V1,
  canonicalizeFlarexValueJsonV1,
  decodeFlarexValueCodecVersion,
  isCanonicalFlarexRuntimeObjectV1,
  normalizeFlarexValueJsonV1,
  normalizeFlarexValueV1,
  type CanonicalFlarexRuntimeValueV1,
  FlarexValueCodecV1Error,
  FlarexValueEvidenceV1Error,
  type FlarexValueCodecVersion,
} from "flarex-protocol/value";

import {
  inspectLoadedPointMutationSessionAttemptV1,
  type PointMutationSessionAttemptLoadingExecutionV1Error,
  type PointMutationSessionAttemptLoadingV1,
  type PointMutationSessionAttemptTerminalizationExecutionV1Error,
  type PointMutationSessionAttemptTerminalizationV1,
  type LoadedPointMutationSessionAttemptV1,
} from "./pointMutationSessionActivation";
import type {
  PointMutationJournalAttemptV1,
  PointMutationJournalBoundaryV1Error,
  PointMutationJournalTableV1,
  PointMutationJournalV1,
} from "./pointMutationJournal";
import {
  getLoadedPointMutationSessionAttemptOccRerunInspectionV1,
  type LoadedPointMutationSessionAttemptOccRerunInspectionV1,
} from "./pointMutationSessionAttemptState";
import {
  decodePointMutationSessionAttemptSelectorV1Result,
  type InvalidPointMutationSessionAttemptSelectorV1Error,
} from "./pointMutationSessionAttemptSelector";
import type { TransactionGrantVerifierV1 } from "./transactionGrant";
import {
  findTransactionGrantVerificationKernelV1,
  type TransactionGrantVerificationKernelV1,
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
  type PinnedPointMutationFunctionMetadataReaderPortV1,
  type PinnedPointMutationFunctionMetadataSelectorV1,
  type StoredCommitAuthorityAuthenticationConfigV1,
  type StoredCommitAuthorityCorruptionReasonV1,
  type StoredCommitAuthorityEvidenceAuthorityPortV1,
  type StoredCommitAuthorityEvidenceLoaderPortV1,
  type StoredCommitAuthorityEvidenceLoadResultPortV1,
  type StoredCommitAuthorityEvidencePersistencePortErrorV1,
  type StoredCommitAuthorityEvidencePortV1,
  type StoredCommitAuthoritySchemaEvidencePortV1,
  type StoredCommitAuthoritySessionEvidencePortV1,
} from "./storedAttemptAuthentication/commitAuthorityModel";
import {
  capturePinnedFunctionSelector,
  requireLoadedCommitAuthorityEvidenceEffect,
  verifyCommitAuthorityEvidenceEffect,
  verifyPinnedFunctionMetadataEffect,
  type VerifiedCommitAuthorityEvidenceV1,
  type CommitAuthorityVerificationStateV1,
} from "./storedAttemptAuthentication/commitAuthorityVerification";
import { detachVerifiedGrant } from "./storedAttemptAuthentication/verifiedGrantEvidence";
import {
  CommitDocumentValidationV1Error,
  CommitInputAuthorityCorruptionV1Error,
  CommitSuccessfulResultValidationV1Error,
  InvalidAuthenticatedCommitAuthorityV1Error,
  verifyCommitInputStateEffect,
  type CommitInputVerificationV1Error,
  type VerifiedCommitInputStateV1,
} from "./storedAttemptAuthentication/commitInputVerification";
import {
  InvalidVerifiedCommitInputV1Error,
  planPointCommitStateV1,
  UnsupportedPointCommitPlanV1Error,
  type PreparedPointCommitStateV1,
} from "./storedAttemptAuthentication/pointCommitPlanning";

export {
  InvalidAuthenticatedStoredAttemptV1Error,
  PinnedFunctionMetadataSourceV1Error,
  StoredCommitAuthorityConfigurationV1Error,
  StoredCommitAuthorityCorruptionV1Error,
  StoredCommitAuthorityMismatchV1Error,
  StoredCommitAuthorityNotPlannableV1Error,
  StoredCommitAuthorityPersistenceV1Error,
} from "./storedAttemptAuthentication/commitAuthorityModel";

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
  UnsupportedPointCommitPlanV1Error,
} from "./storedAttemptAuthentication/pointCommitPlanning";

const trustedStoredAttemptAuthorityBrand: unique symbol = Symbol(
  "FlarexExecutor/TrustedStoredAttemptAuthorityV1",
);

export interface TrustedStoredAttemptAuthorityV1 {
  readonly [trustedStoredAttemptAuthorityBrand]: true;
}

const authenticatedStoredAttemptBrand: unique symbol = Symbol(
  "FlarexExecutor/AuthenticatedStoredAttemptV1",
);

const PROCESS_LOCAL_CAPABILITY: true = true;
const encodeCommitEnvelopeV1 = Schema.encodeSync(CommitEnvelopeV1Schema);
const decodeTransactionArtifactRuntimeV1 = Schema.decodeUnknownSync(
  TransactionArtifactRuntimeV1Schema,
);

export interface AuthenticatedStoredAttemptV1 {
  readonly [authenticatedStoredAttemptBrand]: true;
}

const authenticatedCommitAuthorityBrand: unique symbol = Symbol(
  "FlarexExecutor/AuthenticatedCommitAuthorityV1",
);

/** Private C04B1 authority only; this is not VerifiedCommitInput. */
export interface AuthenticatedCommitAuthorityV1 {
  readonly [authenticatedCommitAuthorityBrand]: true;
}

const verifiedCommitInputBrand: unique symbol = Symbol(
  "FlarexExecutor/VerifiedCommitInputV1",
);

/** Private C04B2 proof capability; production activation remains deferred. */
export interface VerifiedCommitInputV1 {
  readonly [verifiedCommitInputBrand]: true;
}

const preparedPointCommitBrand: unique symbol = Symbol(
  "FlarexExecutor/PreparedPointCommitV1",
);

/** Private C04C1 logical point plan; this carries no SQL authority. */
export interface PreparedPointCommitV1 {
  readonly [preparedPointCommitBrand]: true;
}

const finishingPreparedPointCommitBrand: unique symbol = Symbol(
  "FlarexExecutor/FinishingPreparedPointCommitV1",
);

/** Private C05 continuation; C05-A/C05-B feed only the O07-B publisher. */
export interface FinishingPreparedPointCommitV1
  extends PreparedPointCommitV1 {
  readonly [finishingPreparedPointCommitBrand]: true;
}

const authorizedPointMutationOccRerunBrand: unique symbol = Symbol(
  "FlarexExecutor/AuthorizedPointMutationOccRerunV1",
);

/**
 * Private O08-B1 authority. It is process-local and must be synchronously
 * consumed by the later B2 gate immediately before execution revalidation.
 */
export interface AuthorizedPointMutationOccRerunV1 {
  readonly [authorizedPointMutationOccRerunBrand]: true;
}

export class InvalidPointMutationOccConflictV1Error extends Data.TaggedError(
  "InvalidPointMutationOccConflictV1Error",
)<{
  readonly reason: "notCaptured" | "alreadyConsumed" | "evidenceInvalid";
}> {}

export class PointMutationOccRerunExhaustedV1Error extends Data.TaggedError(
  "PointMutationOccRerunExhaustedV1Error",
)<{
  readonly attemptFence: TransactionAttemptFence;
  readonly maximumReruns: 4;
}> {}

export class PointMutationOccRerunOwnershipLostV1Error
  extends Data.TaggedError("PointMutationOccRerunOwnershipLostV1Error")<{
    readonly reason: "alreadyReplaced";
  }> {}

export type PointMutationOccRerunFreshAttemptMismatchV1 =
  | "deployment"
  | "scope"
  | "session"
  | "attemptFence"
  | "storageGeneration"
  | "storageGenerationFence"
  | "epoch"
  | "schema"
  | "requestKey"
  | "snapshotNotAdvanced"
  | "conflictingCommitNotVisible"
  | "attemptNotPristine";

export class PointMutationOccRerunFreshAttemptV1Error
  extends Data.TaggedError("PointMutationOccRerunFreshAttemptV1Error")<{
    readonly reason: PointMutationOccRerunFreshAttemptMismatchV1;
  }> {}

export class PointMutationOccRerunAuthorityCorruptionV1Error
  extends Data.TaggedError(
    "PointMutationOccRerunAuthorityCorruptionV1Error",
  )<{
    readonly reason:
      | "outcomeObservationInvalid"
      | "replacementObservationInvalid"
      | "loadedAttemptStateUnavailable";
  }> {}

export class InvalidAuthorizedPointMutationOccRerunV1Error
  extends Data.TaggedError("InvalidAuthorizedPointMutationOccRerunV1Error")<{
    readonly reason: "notSameFactory" | "alreadyConsumed";
  }> {}

export class PointMutationOccExecutionEvidencePersistenceV1Error extends Data.TaggedError(
  "PointMutationOccExecutionEvidencePersistenceV1Error",
)<{
  readonly cause: unknown;
}> {}

export class PointMutationOccExecutionNotRunnableV1Error extends Data.TaggedError(
  "PointMutationOccExecutionNotRunnableV1Error",
)<{
  readonly reason: Extract<
    StoredOccExecutionEvidenceLoadResultV1,
    { readonly kind: "notExecutable" }
  >["reason"];
  readonly lifecycle?: TransactionSessionLifecycleV1;
}> {}

export class PointMutationOccExecutionAuthorityMismatchV1Error extends Data.TaggedError(
  "PointMutationOccExecutionAuthorityMismatchV1Error",
)<{
  readonly reason: Extract<
    StoredOccExecutionEvidenceLoadResultV1,
    { readonly kind: "authorityMismatch" }
  >["reason"];
}> {}

export class PointMutationOccExecutionAuthorityCorruptionV1Error extends Data.TaggedError(
  "PointMutationOccExecutionAuthorityCorruptionV1Error",
)<{
  readonly reason:
    | Extract<
        StoredOccExecutionEvidenceLoadResultV1,
        { readonly kind: "corrupt" }
      >["reason"]
    | "committedOutcomeMissing"
    | "requestEvidenceInvalid"
    | "runtimePinInvalid";
  readonly cause?: unknown;
}> {}

export class PointMutationOccExecutionContextV1Error extends Data.TaggedError(
  "PointMutationOccExecutionContextV1Error",
)<{
  readonly reason:
    | "invalidExecutionId"
    | "invalidLogScopeId"
    | "invalidRandomSeed";
}> {}

export class PointMutationOccUserCodeV1Error extends Data.TaggedError(
  "PointMutationOccUserCodeV1Error",
)<{
  readonly cause: unknown;
}> {}

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
}

export interface PointMutationOccRuntimeNeutralRunnerInputV1 {
  readonly argumentsJson: JsonObject;
  readonly argumentArraySemanticBytes: number;
  readonly verifiedGrant: VerifiedTransactionGrantInspectionV1;
  readonly schemaManifest: SchemaManifestAppSchemaV1;
  readonly stableBindings: StoredCommitAuthoritySchemaEvidencePortV1["stableBindings"];
  readonly functionMetadata: PointMutationTargetFunctionMetadataV1;
  readonly context: PointMutationOccExecutionContextV1;
  readonly journal: PointMutationOccBoundJournalV1;
}

type PointMutationOccDetachedRunnerEvidenceV1 = Omit<
  PointMutationOccRuntimeNeutralRunnerInputV1,
  "context" | "journal"
>;

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
  | PointMutationOccUserCodeV1Error
  | PointMutationJournalBoundaryV1Error;

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
  readonly conflictDocumentId: AppDocumentIdV1;
  readonly conflictingCommitSeq: SnapshotToken["commitSeq"];
}

export class InvalidPreparedPointCommitV1Error extends Data.TaggedError(
  "InvalidPreparedPointCommitV1Error",
)<{
  readonly reason:
    | "alreadyFinishing"
    | "notFinishing"
    | "notRunning"
    | "notSameFactory";
}> {}

export class InvalidStoredAttemptAuthorityV1Error extends Data.TaggedError(
  "InvalidStoredAttemptAuthorityV1Error",
)<{
  readonly reason: "notProcessLocal" | "invalidLoadedAttempt";
}> {}

export class StoredAttemptAlreadyCommittedV1Error extends Data.TaggedError(
  "StoredAttemptAlreadyCommittedV1Error",
)<{
  readonly updatedAtMilliseconds: number;
}> {}

export class StoredAttemptNotPlannableV1Error extends Data.TaggedError(
  "StoredAttemptNotPlannableV1Error",
)<{
  readonly reason: "lifecycle" | "rootNotSealed" | "expired";
  readonly lifecycle?: TransactionSessionLifecycleV1;
  readonly rootState?: "open" | "sealed" | "failed";
}> {}

export class StoredAttemptAuthorityMismatchV1Error extends Data.TaggedError(
  "StoredAttemptAuthorityMismatchV1Error",
)<{
  readonly reason:
    | "placementChanged"
    | "scopeChanged"
    | "attemptMissing"
    | "attemptReplaced"
    | "generationChanged"
    | "epochChanged"
    | "snapshotChanged"
    | "schemaChanged"
    | "revocationEpochChanged";
}> {}

export class StoredAttemptEnvelopeMismatchV1Error extends Data.TaggedError(
  "StoredAttemptEnvelopeMismatchV1Error",
)<{
  readonly reason:
    | "attempt"
    | "protocol"
    | "sequence"
    | "journalDigest"
    | "successfulResult";
}> {}

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

export class StoredAttemptStorageCorruptionV1Error extends Data.TaggedError(
  "StoredAttemptStorageCorruptionV1Error",
)<{
  readonly reason: StoredAttemptStorageCorruptionReasonV1;
  readonly cause?: unknown;
}> {}

export class StoredAttemptPersistenceV1Error extends Data.TaggedError(
  "StoredAttemptPersistenceV1Error",
)<{
  readonly cause: unknown;
}> {}

export type StoredAttemptAuthenticationV1Error =
  | CommitProtocolV1Error
  | InvalidStoredAttemptAuthorityV1Error
  | StoredAttemptAlreadyCommittedV1Error
  | StoredAttemptNotPlannableV1Error
  | StoredAttemptAuthorityMismatchV1Error
  | StoredAttemptEnvelopeMismatchV1Error
  | StoredAttemptStorageCorruptionV1Error
  | StoredAttemptPersistenceV1Error;

export interface StoredAttemptAuthorityStateV1 {
  readonly deploymentId: TransactionGrantDeploymentIdV1;
  readonly scopeId: ReplacementScopeIdV1;
  readonly sessionId: TransactionSessionIdV1;
  readonly attemptFence: TransactionAttemptFence;
  readonly storageGeneration: FlarexDbV1StorageGeneration;
  readonly storageGenerationFence: StorageGenerationFence;
  readonly snapshotToken: SnapshotToken;
  readonly schemaVersionId: CatalogSchemaVersionId;
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
  readonly writeOperations: number;
  readonly writeSemanticBytes: number;
  readonly materialWriteEventEvidenceBytes:
    CommitMaterialWriteEventEvidenceBytesV1;
}

interface StoredAttemptPointEvidencePortV1 {
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
        | "revocationEpochChanged";
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
  readonly verifiedGrant: VerifiedTransactionGrantInspectionV1;
  readonly schemaManifest: SchemaManifestAppSchemaV1;
  readonly stableBindings: StoredCommitAuthoritySchemaEvidencePortV1[
    "stableBindings"
  ];
  readonly functionMetadata: PointMutationTargetFunctionMetadataV1;
}

interface PointCommitScalarProvenanceV1 {
  readonly authority: Readonly<StoredAttemptAuthorityStateV1>;
  readonly session: Readonly<StoredAttemptSessionScalarsPortV1>;
}

interface VerifiedCommitCapabilityStateV1 {
  readonly input: VerifiedCommitInputStateV1;
  readonly provenance: PointCommitScalarProvenanceV1;
  /** Complete authenticated execution provenance retained privately for B2. */
  readonly executionAuthority: AuthenticatedCommitAuthorityStateV1;
}

interface PreparedPointCommitCapabilityStateV1 {
  readonly plan: PreparedPointCommitStateV1;
  readonly provenance: PointCommitScalarProvenanceV1;
  readonly executionAuthority: AuthenticatedCommitAuthorityStateV1;
}

interface CapturedPointMutationOccConflictV1 {
  readonly documentId: AppDocumentIdV1;
  readonly snapshotCommitSeq: SnapshotToken["commitSeq"];
  readonly currentCommitSeq: SnapshotToken["commitSeq"];
}

interface PointMutationOccConflictTicketStateV1 {
  readonly finishing: FinishingPreparedPointCommitV1;
  readonly prepared: PreparedPointCommitCapabilityStateV1;
  readonly conflict: CapturedPointMutationOccConflictV1;
}

interface AuthorizedPointMutationOccRerunStateV1 {
  readonly loadedAttempt: LoadedPointMutationSessionAttemptV1;
  readonly prepared: PreparedPointCommitCapabilityStateV1;
  readonly conflict: CapturedPointMutationOccConflictV1;
  readonly inspection: AuthorizedPointMutationOccRerunInspectionV1;
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

export interface StoredPointMutationAttemptReplacementConfigV1
  extends StoredPointCommitFinishingTransitionConfigV1 {
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
    PointCommitPublicationExecutionV1Error,
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

export type PointCommitFinishingCompositionV1Error =
  | PointCommitFinishingExecutionV1Error
  | PointCommitPublicationExecutionV1Error;

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
  | PointCommitPublicationExecutionV1Error;

export interface StoredPointCommitExecutorV1
  extends StoredPointCommitFinishingTransitionV1 {
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
  | PointCommitOutcomeResolutionForOccRerunV1Error
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
  | PointMutationOccExecutionEvidencePersistenceV1Error
  | PointMutationOccExecutionNotRunnableV1Error
  | PointMutationOccExecutionAuthorityMismatchV1Error
  | PointMutationOccExecutionAuthorityCorruptionV1Error
  | PointMutationOccExecutionContextV1Error
  | PointMutationOccUserCodeV1Error
  | PointMutationJournalBoundaryV1Error
  | CommitProtocolV1Error
  | PointMutationSessionAttemptLoadingExecutionV1Error
  | PointMutationSessionAttemptTerminalizationExecutionV1Error
  | StoredAttemptAuthenticationV1Error
  | StoredCommitAuthorityAuthenticationV1Error
  | CommitInputVerificationV1Error
  | PointCommitPlanningV1Error
  | PointCommitFinishingExecutionV1Error
  | PointCommitPublicationExecutionV1Error
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

function isPointCommitRollbackProofPortV1(
  value: unknown,
): value is PointCommitRollbackProofPortV1 {
  return isNonArrayRecord(value) && typeof value.prove === "function";
}

function isPointCommitPublisherPortV1(
  value: unknown,
): value is PointCommitPublisherPortV1 {
  return isPointCommitRollbackProofPortV1(value) &&
    typeof Reflect.get(value, "publish") === "function";
}

function isPointCommitOutcomeResolutionPortV1(
  value: unknown,
): value is PointCommitOutcomeResolutionPortV1 {
  return isNonArrayRecord(value) && typeof Reflect.get(
    value,
    RESOLVE_POINT_COMMIT_OUTCOME_FOR_OCC_RERUN_V1,
  ) === "function";
}

function isPointCommitFinishingTransitionPortV1(
  value: unknown,
): value is PointCommitFinishingTransitionPortV1 {
  return isNonArrayRecord(value) &&
    typeof value.enterFinishing === "function";
}

function isPointMutationAttemptReplacementPortV1(
  value: unknown,
): value is PointMutationAttemptReplacementPortV1 {
  return isNonArrayRecord(value) && typeof value.replace === "function";
}

function isPointMutationSessionAttemptLoadingV1(
  value: unknown,
): value is PointMutationSessionAttemptLoadingV1 {
  return isNonArrayRecord(value) && typeof value.load === "function";
}

function isStoredOccExecutionEvidenceLoaderV1(
  value: unknown,
): value is StoredOccExecutionEvidenceLoaderV1 {
  return isNonArrayRecord(value) && typeof value.loadEffect === "function";
}

function isPointMutationJournalV1(
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

function isPointMutationSessionAttemptTerminalizationV1(
  value: unknown,
): value is PointMutationSessionAttemptTerminalizationV1 {
  return (
    isNonArrayRecord(value) &&
    typeof value.abort === "function" &&
    typeof value.expire === "function"
  );
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
): StoredAttemptAuthenticationV1;
export function createStoredAttemptAuthenticationV1(
  loader: StoredAttemptFinishingEvidenceLoaderPortV1,
  commitAuthority: StoredPointMutationOccRerunExecutionConfigV1,
): StoredPointMutationOccRerunExecutionV1;
export function createStoredAttemptAuthenticationV1(
  loader: StoredAttemptFinishingEvidenceLoaderPortV1,
  commitAuthority: StoredPointMutationOccRerunAuthorizationConfigV1,
): StoredPointMutationOccRerunAuthorizationV1;
export function createStoredAttemptAuthenticationV1(
  loader: StoredAttemptFinishingEvidenceLoaderPortV1,
  commitAuthority: StoredPointMutationAttemptReplacementConfigV1,
): StoredPointMutationAttemptReplacementV1;
export function createStoredAttemptAuthenticationV1(
  loader: StoredAttemptFinishingEvidenceLoaderPortV1,
  commitAuthority: StoredPointCommitFinishingTransitionConfigV1,
): StoredPointCommitExecutorV1;
export function createStoredAttemptAuthenticationV1(
  loader: StoredAttemptEvidenceLoaderPortV1,
  commitAuthority: StoredPointCommitFinishingTransitionConfigV1,
): StoredPointCommitFinishingTransitionV1;
export function createStoredAttemptAuthenticationV1(
  loader: StoredAttemptEvidenceLoaderPortV1,
  commitAuthority: StoredPointCommitPublisherConfigV1,
): StoredPointCommitPublisherV1;
export function createStoredAttemptAuthenticationV1(
  loader: StoredAttemptEvidenceLoaderPortV1,
  commitAuthority: StoredPointCommitRollbackProofConfigV1,
): StoredPointCommitRollbackProofV1;
export function createStoredAttemptAuthenticationV1(
  loader: StoredAttemptEvidenceLoaderPortV1,
  commitAuthority: StoredCommitAuthorityAuthenticationConfigV1,
): StoredPointCommitPlanningV1;
export function createStoredAttemptAuthenticationV1(
  loader: StoredAttemptEvidenceLoaderPortV1,
  commitAuthority?:
    | StoredCommitAuthorityAuthenticationConfigV1
    | StoredPointCommitRollbackProofConfigV1
    | StoredPointCommitPublisherConfigV1
    | StoredPointCommitFinishingTransitionConfigV1
    | StoredPointMutationAttemptReplacementConfigV1
    | StoredPointMutationOccRerunAuthorizationConfigV1
    | StoredPointMutationOccRerunExecutionConfigV1,
):
  | StoredAttemptAuthenticationV1
  | StoredPointCommitPlanningV1
  | StoredPointCommitRollbackProofV1
  | StoredPointCommitPublisherV1
  | StoredPointCommitFinishingTransitionV1
  | StoredPointCommitExecutorV1
  | StoredPointMutationAttemptReplacementV1
  | StoredPointMutationOccRerunAuthorizationV1
  | StoredPointMutationOccRerunExecutionV1 {
  const authorityStates = new WeakMap<object, StoredAttemptAuthorityStateV1>();
  const authenticatedStates = new WeakMap<
    object,
    AuthenticatedStoredAttemptStateV1
  >();
  const commitAuthorityStates = new WeakMap<
    object,
    AuthenticatedCommitAuthorityStateV1
  >();
  const verifiedCommitInputStates = new WeakMap<
    object,
    VerifiedCommitCapabilityStateV1
  >();
  const preparedPointCommitStates = new WeakMap<
    object,
    PreparedPointCommitCapabilityStateV1
  >();
  const finishingPreparedPointCommitStates = new WeakSet<object>();
  const occConflictTickets = new WeakMap<
    object,
    PointMutationOccConflictTicketStateV1
  >();
  const capturedOccConflicts = new WeakSet<object>();
  const consumedOccConflicts = new WeakSet<object>();
  const authorizedOccRerunStates = new WeakMap<
    object,
    AuthorizedPointMutationOccRerunStateV1
  >();
  const mintedAuthorizedOccReruns = new WeakSet<object>();
  const consumedAuthorizedOccReruns = new WeakSet<object>();
  const mintAuthenticatedStoredAttempt = (
    state: AuthenticatedStoredAttemptStateV1,
  ): AuthenticatedStoredAttemptV1 => {
    const handle: AuthenticatedStoredAttemptV1 = Object.freeze({
      [authenticatedStoredAttemptBrand]: PROCESS_LOCAL_CAPABILITY,
    });
    authenticatedStates.set(handle, state);
    return handle;
  };
  const mintFinishingPreparedPointCommit = (
    state: PreparedPointCommitCapabilityStateV1,
  ): Result.Result<
    FinishingPreparedPointCommitV1,
    InvalidPreparedPointCommitV1Error
  > => {
    if (
      state.provenance.session.lifecycle !== "finishing" ||
      state.plan.sealIdentity.lifecycle !== "finishing"
    ) {
      return Result.fail(new InvalidPreparedPointCommitV1Error({
        reason: "notFinishing",
      }));
    }
    const handle: FinishingPreparedPointCommitV1 = Object.freeze({
      [preparedPointCommitBrand]: PROCESS_LOCAL_CAPABILITY,
      [finishingPreparedPointCommitBrand]: PROCESS_LOCAL_CAPABILITY,
    });
    preparedPointCommitStates.set(handle, state);
    finishingPreparedPointCommitStates.add(handle);
    return Result.succeed(handle);
  };
  const pointCommitCandidate: unknown = commitAuthority !== undefined &&
      "pointCommit" in commitAuthority
    ? commitAuthority.pointCommit
    : undefined;
  const pointCommit:
    | PointCommitRollbackProofPortV1
    | PointCommitPublisherPortV1
    | undefined = isPointCommitPublisherPortV1(pointCommitCandidate)
      ? pointCommitCandidate
      : isPointCommitRollbackProofPortV1(pointCommitCandidate)
        ? pointCommitCandidate
        : undefined;
  const pointCommitOutcomeResolution =
    isPointCommitPublisherPortV1(pointCommitCandidate) &&
      isPointCommitOutcomeResolutionPortV1(pointCommitCandidate)
      ? pointCommitCandidate
      : undefined;
  const pointCommitFinishingCandidate: unknown =
    commitAuthority !== undefined && "pointCommitFinishing" in commitAuthority
      ? commitAuthority.pointCommitFinishing
      : undefined;
  const pointCommitFinishing = isPointCommitFinishingTransitionPortV1(
      pointCommitFinishingCandidate,
    )
    ? pointCommitFinishingCandidate
    : undefined;
  const pointMutationAttemptReplacementCandidate: unknown =
    commitAuthority !== undefined &&
      "pointMutationAttemptReplacement" in commitAuthority
      ? commitAuthority.pointMutationAttemptReplacement
      : undefined;
  const pointMutationAttemptReplacement =
    isPointMutationAttemptReplacementPortV1(
        pointMutationAttemptReplacementCandidate,
      )
      ? pointMutationAttemptReplacementCandidate
      : undefined;
  const pointMutationOccRerunCandidate: unknown =
    commitAuthority !== undefined && "pointMutationOccRerun" in commitAuthority
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

  const finishingEvidenceLoader =
    isStoredAttemptFinishingEvidenceLoaderPortV1(loader) ? loader : undefined;
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

  const deriveAuthority: StoredAttemptAuthenticationV1["deriveAuthority"] =
    Effect.fn("StoredAttemptAuthentication.deriveAuthority")(
      function* (attempt) {
        const inspection = yield* Effect.try({
          try: () => inspectLoadedPointMutationSessionAttemptV1(attempt),
          catch: () => new InvalidStoredAttemptAuthorityV1Error({
            reason: "invalidLoadedAttempt",
          }),
        });
        const state = Object.freeze({
          deploymentId: inspection.selector.deploymentId,
          scopeId: inspection.selector.scopeId,
          sessionId: inspection.selector.sessionId,
          attemptFence: inspection.selector.attemptFence,
          storageGeneration: inspection.storageGeneration,
          storageGenerationFence: inspection.storageGenerationFence,
          snapshotToken: Object.freeze({ ...inspection.snapshotToken }),
          schemaVersionId: inspection.schemaVersionId,
        } satisfies StoredAttemptAuthorityStateV1);
        const handle: TrustedStoredAttemptAuthorityV1 = Object.freeze({
          [trustedStoredAttemptAuthorityBrand]: PROCESS_LOCAL_CAPABILITY,
        });
        authorityStates.set(handle, state);
        return handle;
      },
    );

  const authenticate: StoredAttemptAuthenticationV1["authenticate"] =
    Effect.fn("StoredAttemptAuthentication.authenticate")(
      function* (authority, input) {
        const decodedEnvelope = yield* decodeCommitEnvelopeV1Effect(input);
        const envelope = yield*
          requireStoredForSessionAttemptCommitEnvelopeV1Effect(
            decodedEnvelope,
          );
        const authorityState = lookupAuthority(authorityStates, authority);
        if (authorityState === undefined) {
          return yield* Effect.fail(
            new InvalidStoredAttemptAuthorityV1Error({
              reason: "notProcessLocal",
            }),
          );
        }
        const result = yield* loader.loadEffect(
          captureAuthorityPort(authorityState),
        ).pipe(Effect.mapError((error) =>
          new StoredAttemptPersistenceV1Error({ cause: error.cause })
        ));
        const evidence = yield* requireLoadedEvidenceEffect(result);
        const verified = yield* verifyCanonicalStoredEvidenceEffect(
          authorityState,
          evidence,
        );
        const envelopeMismatch = yield* compareCallerEnvelopeWithVerifiedState(
          envelope,
          evidence,
          verified,
        );
        if (envelopeMismatch !== undefined) {
          return yield* Effect.fail(envelopeMismatch);
        }
        return mintAuthenticatedStoredAttempt(verified);
      },
    );

  const base: StoredAttemptAuthenticationV1 = Object.freeze({
    deriveAuthority,
    authenticate,
    isAuthenticated: (value: unknown): boolean =>
      typeof value === "object" &&
      value !== null &&
      authenticatedStates.has(value),
    remainsAuthenticatedStateUnchangedForTest: (
      value: AuthenticatedStoredAttemptV1,
      action: () => void,
    ): boolean => {
      const state = requireAuthenticatedState(authenticatedStates, value);
      const before = serializeAuthenticatedStateForTest(state);
      action();
      return before === serializeAuthenticatedStateForTest(state);
    },
  });
  if (
    commitAuthority === undefined ||
    grantKernel === undefined
  ) {
    return base;
  }

  const authenticateCommitAuthority = Effect.fn(
    "StoredAttemptAuthentication.authenticateCommitAuthority",
  )(function* (attempt: AuthenticatedStoredAttemptV1) {
    const storedAttempt = lookupSameFactoryAuthenticatedState(
      authenticatedStates,
      attempt,
    );
    if (storedAttempt === undefined) {
      return yield* Effect.fail(
        new InvalidAuthenticatedStoredAttemptV1Error({
          reason: "notSameFactory",
        }),
      );
    }
    const loadResult = yield* commitAuthority.evidenceLoader.loadEffect(
        captureCommitAuthorityPort(storedAttempt),
      ).pipe(Effect.mapError((error) =>
        new StoredCommitAuthorityPersistenceV1Error({ cause: error.cause })
      ));
    const evidence = yield* requireLoadedCommitAuthorityEvidenceEffect(
      loadResult,
    );
    const verifiedEvidence = yield* verifyCommitAuthorityEvidenceEffect(
      storedAttempt,
      evidence,
      grantKernel,
    );
    const metadataUnknown = yield* commitAuthority.functionMetadata.load(
      capturePinnedFunctionSelector(storedAttempt),
    );
    const functionMetadata = yield* verifyPinnedFunctionMetadataEffect(
      storedAttempt,
      metadataUnknown,
    );
    const state = deepDetachCommitAuthorityState(
      storedAttempt,
      verifiedEvidence,
      functionMetadata,
    );
    const handle: AuthenticatedCommitAuthorityV1 = Object.freeze({
      [authenticatedCommitAuthorityBrand]: PROCESS_LOCAL_CAPABILITY,
    });
    commitAuthorityStates.set(handle, state);
    return handle;
  });

  const verifyCommitInput: StoredCommitInputVerificationV1["verifyCommitInput"] =
    Effect.fn("StoredAttemptAuthentication.verifyCommitInput")(
      function* (authority) {
        const state = lookupCommitAuthorityState(
          commitAuthorityStates,
          authority,
        );
        if (state === undefined) {
          return yield* Effect.fail(
            new InvalidAuthenticatedCommitAuthorityV1Error({
              reason: "notSameFactory",
            }),
          );
        }
        const verified = yield* verifyCommitInputStateEffect({
          authority: state.storedAttempt.authority,
          session: state.storedAttempt.session,
          sealIdentity: state.storedAttempt.sealIdentity,
          journal: state.storedAttempt.journal,
          points: state.storedAttempt.points,
          successfulResult: state.storedAttempt.successfulResult,
          schemaManifest: state.schemaManifest,
          functionMetadata: state.functionMetadata,
        });
        const handle: VerifiedCommitInputV1 = Object.freeze({
          [verifiedCommitInputBrand]: PROCESS_LOCAL_CAPABILITY,
        });
        verifiedCommitInputStates.set(handle, Object.freeze({
          input: verified,
          provenance: capturePointCommitScalarProvenance(
            state.storedAttempt,
          ),
          executionAuthority: state,
        } satisfies VerifiedCommitCapabilityStateV1));
        return handle;
      },
    );

  const planPointCommit: StoredPointCommitPlanningV1["planPointCommit"] =
    Effect.fn("StoredAttemptAuthentication.planPointCommit")(
      function* (input) {
        const state = lookupVerifiedCommitInputState(
          verifiedCommitInputStates,
          input,
        );
        if (state === undefined) {
          return yield* Effect.fail(new InvalidVerifiedCommitInputV1Error({
            reason: "notSameFactory",
          }));
        }
        const planned = yield* Effect.fromResult(
          planPointCommitStateV1(state.input),
        );
        const handle: PreparedPointCommitV1 = Object.freeze({
          [preparedPointCommitBrand]: PROCESS_LOCAL_CAPABILITY,
        });
        preparedPointCommitStates.set(handle, Object.freeze({
          plan: planned,
          provenance: state.provenance,
          executionAuthority: state.executionAuthority,
        } satisfies PreparedPointCommitCapabilityStateV1));
        return handle;
      },
    );

  const planning = Object.freeze({
    ...base,
    authenticateCommitAuthority,
    verifyCommitInput,
    planPointCommit,
    isCommitAuthorityAuthenticated: (value: unknown): boolean =>
      typeof value === "object" &&
      value !== null &&
      commitAuthorityStates.has(value),
    remainsCommitAuthorityStateUnchangedForTest: (
      value: AuthenticatedCommitAuthorityV1,
      action: () => void,
    ): boolean => {
      const state = requireCommitAuthorityState(
        commitAuthorityStates,
        value,
      );
      const before = serializeCommitAuthorityStateForTest(state);
      action();
      return before === serializeCommitAuthorityStateForTest(state);
    },
    isCommitInputVerified: (value: unknown): boolean =>
      typeof value === "object" &&
      value !== null &&
      verifiedCommitInputStates.has(value),
    remainsVerifiedCommitInputStateUnchangedForTest: (
      value: VerifiedCommitInputV1,
      action: () => void,
    ): boolean => {
      const state = requireVerifiedCommitInputState(
        verifiedCommitInputStates,
        value,
      );
      const before = serializeVerifiedCommitInputStateForTest(state.input);
      action();
      return before === serializeVerifiedCommitInputStateForTest(state.input);
    },
    isPointCommitPrepared: (value: unknown): boolean =>
      typeof value === "object" &&
      value !== null &&
      preparedPointCommitStates.has(value),
    arePreparedPointCommitStatesEquivalentForTest: (
      left: PreparedPointCommitV1,
      right: PreparedPointCommitV1,
    ): boolean => {
      const leftState = lookupPreparedPointCommitState(
        preparedPointCommitStates,
        left,
      );
      const rightState = lookupPreparedPointCommitState(
        preparedPointCommitStates,
        right,
      );
      return leftState !== undefined &&
        rightState !== undefined &&
        serializePreparedPointCommitStateForTest(leftState.plan) ===
          serializePreparedPointCommitStateForTest(rightState.plan);
    },
  } satisfies StoredPointCommitPlanningV1);
  if (pointCommit === undefined) return planning;

  const provePointCommitRollback:
    StoredPointCommitRollbackProofV1["provePointCommitRollback"] = Effect.fn(
      "StoredAttemptAuthentication.provePointCommitRollback",
    )(function* (input) {
      const state = lookupPreparedPointCommitState(
        preparedPointCommitStates,
        input,
      );
      if (state === undefined) {
        return yield* Effect.fail(new InvalidPreparedPointCommitV1Error({
          reason: "notSameFactory",
        }));
      }
      return yield* pointCommit.prove(
        capturePointCommitTransactionCommand(state),
      );
    });

  if (!isPointCommitPublisherPortV1(pointCommit)) {
    return Object.freeze({
      ...planning,
      provePointCommitRollback,
    } satisfies StoredPointCommitRollbackProofV1);
  }

  const publishPointCommit:
    StoredPointCommitPublisherV1["publishPointCommit"] = Effect.fn(
      "StoredAttemptAuthentication.publishPointCommit",
    )(function* (input) {
      const state = lookupPreparedPointCommitState(
        preparedPointCommitStates,
        input,
      );
      if (state === undefined) {
        return yield* Effect.fail(new InvalidPreparedPointCommitV1Error({
          reason: "notSameFactory",
        }));
      }
      return yield* pointCommit.publish(
        capturePointCommitPublicationCommand(state),
      );
    });

  const publisher = Object.freeze({
    ...planning,
    provePointCommitRollback,
    publishPointCommit,
  } satisfies StoredPointCommitPublisherV1);
  if (pointCommitFinishing === undefined) return publisher;

  const enterPointCommitFinishing:
    StoredPointCommitFinishingTransitionV1[
      "enterPointCommitFinishing"
    ] = Effect.fn(
      "StoredAttemptAuthentication.enterPointCommitFinishing",
    )(function* (input) {
      const state = lookupPreparedPointCommitState(
        preparedPointCommitStates,
        input,
      );
      if (state === undefined) {
        return yield* Effect.fail(new InvalidPreparedPointCommitV1Error({
          reason: "notSameFactory",
        }));
      }
      if (finishingPreparedPointCommitStates.has(input)) {
        return yield* Effect.fail(new InvalidPreparedPointCommitV1Error({
          reason: "alreadyFinishing",
        }));
      }
      if (
        state.provenance.session.lifecycle !== "running" ||
        state.plan.sealIdentity.lifecycle !== "running"
      ) {
        return yield* Effect.fail(new InvalidPreparedPointCommitV1Error({
          reason: "notRunning",
        }));
      }
      const result = yield* pointCommitFinishing.enterFinishing(
        capturePointCommitFinishingTransitionCommand(state),
      );
      const continuedState = yield* Effect.fromResult(
        rebaseFinishingPreparedPointCommitState(state, result),
      );
      return yield* Effect.fromResult(
        mintFinishingPreparedPointCommit(continuedState),
      );
    });

  const captureOccConflictTicket = (
    finishing: FinishingPreparedPointCommitV1,
    prepared: PreparedPointCommitCapabilityStateV1,
    error: PointCommitConflictV1Error,
  ): void => {
    if (capturedOccConflicts.has(error)) return;
    capturedOccConflicts.add(error);
    occConflictTickets.set(error, Object.freeze({
      finishing,
      prepared,
      conflict: Object.freeze({
        documentId: error.documentId,
        snapshotCommitSeq: error.snapshotCommitSeq,
        currentCommitSeq: error.currentCommitSeq,
      }),
    }));
  };

  const publishFinishingPointCommit:
    StoredPointCommitFinishingTransitionV1["publishPointCommit"] = Effect.fn(
      "StoredAttemptAuthentication.publishFinishingPointCommit",
    )(function* (input) {
      if (typeof input !== "object" || input === null) {
        return yield* Effect.fail(new InvalidPreparedPointCommitV1Error({
          reason: "notSameFactory",
        }));
      }
      const state = preparedPointCommitStates.get(input);
      if (state === undefined) {
        return yield* Effect.fail(new InvalidPreparedPointCommitV1Error({
          reason: "notSameFactory",
        }));
      }
      if (!finishingPreparedPointCommitStates.has(input)) {
        return yield* Effect.fail(new InvalidPreparedPointCommitV1Error({
          reason: "notFinishing",
        }));
      }
      return yield* publisher.publishPointCommit(input).pipe(
        Effect.tapErrorTag(
          "PointCommitConflictV1Error",
          (error) => Effect.sync(() => {
            if (error instanceof PointCommitConflictV1Error) {
              captureOccConflictTicket(input, state, error);
            }
          }),
        ),
      );
    });

  const finishingTransition = Object.freeze({
    ...publisher,
    enterPointCommitFinishing,
    publishPointCommit: publishFinishingPointCommit,
  } satisfies StoredPointCommitFinishingTransitionV1);
  if (finishingEvidenceLoader === undefined) return finishingTransition;

  const reconstructPointCommitFinishing:
    StoredPointCommitExecutorV1["reconstructPointCommitFinishing"] = Effect.fn(
      "StoredAttemptAuthentication.reconstructPointCommitFinishing",
    )(function* (input) {
      const selector = yield* Effect.fromResult(
        decodePointMutationSessionAttemptSelectorV1Result(input),
      );
      const loadResult = yield* finishingEvidenceLoader.loadFinishingEffect(
        selector,
      ).pipe(Effect.mapError((error) =>
        new StoredAttemptPersistenceV1Error({ cause: error.cause })
      ));
      const evidence = yield* requireLoadedEvidenceEffect(loadResult);
      const authority = yield* captureRecoveredAuthorityEffect(
        selector,
        evidence,
      );
      const storedAttemptState = yield* verifyCanonicalStoredEvidenceEffect(
        authority,
        evidence,
      );
      const storedAttempt = mintAuthenticatedStoredAttempt(storedAttemptState);
      const authenticatedAuthority = yield* authenticateCommitAuthority(
        storedAttempt,
      );
      const verifiedInput = yield* verifyCommitInput(authenticatedAuthority);
      const prepared = yield* planPointCommit(verifiedInput);
      const preparedState = lookupPreparedPointCommitState(
        preparedPointCommitStates,
        prepared,
      );
      if (preparedState === undefined) {
        return yield* Effect.fail(new InvalidPreparedPointCommitV1Error({
          reason: "notSameFactory",
        }));
      }
      return yield* Effect.fromResult(
        mintFinishingPreparedPointCommit(preparedState),
      );
    });

  const finishPointCommit: StoredPointCommitExecutorV1["finishPointCommit"] =
    Effect.fn("StoredAttemptAuthentication.finishPointCommit")(
      function* (input) {
        const finishing = yield* enterPointCommitFinishing(input);
        return yield* publishFinishingPointCommit(finishing);
      },
    );

  const resumePointCommit: StoredPointCommitExecutorV1["resumePointCommit"] =
    Effect.fn("StoredAttemptAuthentication.resumePointCommit")(
      function* (selector) {
        const finishing = yield* reconstructPointCommitFinishing(selector);
        return yield* publishFinishingPointCommit(finishing);
      },
    );

  const executor = Object.freeze({
    ...finishingTransition,
    reconstructPointCommitFinishing,
    finishPointCommit,
    resumePointCommit,
  } satisfies StoredPointCommitExecutorV1);
  if (pointMutationAttemptReplacement === undefined) return executor;

  const replaceConflictedPointMutationAttempt:
    StoredPointMutationAttemptReplacementV1[
      "replaceConflictedPointMutationAttempt"
    ] = Effect.fn(
      "StoredAttemptAuthentication.replaceConflictedPointMutationAttempt",
    )(function* (input) {
      const state = lookupPreparedPointCommitState(
        preparedPointCommitStates,
        input,
      );
      if (state === undefined) {
        return yield* Effect.fail(new InvalidPreparedPointCommitV1Error({
          reason: "notSameFactory",
        }));
      }
      if (!finishingPreparedPointCommitStates.has(input)) {
        return yield* Effect.fail(new InvalidPreparedPointCommitV1Error({
          reason: "notFinishing",
        }));
      }
      return yield* pointMutationAttemptReplacement.replace(
        capturePointMutationAttemptReplacementCommand(state),
      );
    });

  const replacement = Object.freeze({
    ...executor,
    replaceConflictedPointMutationAttempt,
  } satisfies StoredPointMutationAttemptReplacementV1);
  if (
    pointCommitOutcomeResolution === undefined ||
    pointMutationOccAttemptLoading === undefined
  ) {
    return replacement;
  }

  const resolvePointMutationOccOutcome = Effect.fn(
    "StoredAttemptAuthentication.resolvePointMutationOccOutcome",
  )(function* (prepared: PreparedPointCommitCapabilityStateV1) {
    const pins = prepared.plan.authorityPins;
    const outcome = yield* pointCommitOutcomeResolution[
      RESOLVE_POINT_COMMIT_OUTCOME_FOR_OCC_RERUN_V1
    ](
      pins.deploymentId,
      Object.freeze({
        scopeUuid: prepared.plan.sealIdentity.scopeUuid,
        requestKey: TransactionRequestKeyV1Schema.make(pins.requestKey),
        expectedIdentityAccessPolicySha256:
          TransactionIdentityAccessPolicySha256V1Schema.make(
            copyBytes(prepared.provenance.session.identityAccessPolicySha256),
          ),
        expectedFunctionPath: TransactionFunctionPathV1Schema.make(
          pins.functionPath,
        ),
        expectedRequestSha256: TransactionRequestSha256V1Schema.make(
          copyBytes(prepared.provenance.session.requestSha256),
        ),
      }),
    );
    if (
      !isNonArrayRecord(outcome) ||
      (outcome.kind !== "missing" &&
        outcome.kind !== "available" &&
        outcome.kind !== "expired")
    ) {
      return yield* Effect.fail(
        new PointMutationOccRerunAuthorityCorruptionV1Error({
          reason: "outcomeObservationInvalid",
        }),
      );
    }
    return outcome;
  });

  const authorizePointMutationOccRerun: StoredPointMutationOccRerunAuthorizationV1["authorizePointMutationOccRerun"] =
    Effect.fn("StoredAttemptAuthentication.authorizePointMutationOccRerun")(
      function* (input) {
        // The exact error ticket is irreversibly claimed before the first yield.
        const ticket =
          typeof input === "object" && input !== null
            ? occConflictTickets.get(input)
            : undefined;
        if (ticket === undefined) {
          const alreadyConsumed =
            typeof input === "object" &&
            input !== null &&
            consumedOccConflicts.has(input);
          return yield* Effect.fail(
            new InvalidPointMutationOccConflictV1Error({
              reason: alreadyConsumed ? "alreadyConsumed" : "notCaptured",
            }),
          );
        }
        occConflictTickets.delete(input as object);
        consumedOccConflicts.add(input as object);

        const prepared = ticket.prepared;
        const pins = prepared.plan.authorityPins;
        const previousSnapshot = pins.snapshotToken;
        const conflict = ticket.conflict;
        if (
          conflict.snapshotCommitSeq !== previousSnapshot.commitSeq ||
          conflict.currentCommitSeq <= conflict.snapshotCommitSeq ||
          !prepared.plan.dependencies.some(
            (dependency) => dependency.documentId === conflict.documentId,
          )
        ) {
          return yield* Effect.fail(
            new InvalidPointMutationOccConflictV1Error({
              reason: "evidenceInvalid",
            }),
          );
        }

        const previousAttemptFence = pins.attemptFence;
        if (previousAttemptFence >= 5n) {
          return yield* Effect.fail(
            new PointMutationOccRerunExhaustedV1Error({
              attemptFence: previousAttemptFence,
              maximumReruns: 4,
            }),
          );
        }
        const consumedReruns = Number(previousAttemptFence - 1n);
        const backoffUpperBoundMilliseconds = Math.min(
          100 * 2 ** consumedReruns,
          2_000,
        );
        const random = yield* Random.next;
        const backoffMilliseconds = random * backoffUpperBoundMilliseconds;
        yield* Effect.sleep(Duration.millis(backoffMilliseconds));

        const outcome = yield* resolvePointMutationOccOutcome(prepared);
        const outcomeKind = outcome.kind;
        if (outcomeKind === "available") {
          return Object.freeze({ kind: "replayed", outcome });
        }
        if (outcomeKind === "expired") {
          return Object.freeze({ kind: "expired", outcome });
        }
        if (outcomeKind !== "missing")
          return yield* Effect.die(
            new Error("Validated OCC outcome union was not exhaustive."),
          );

        const replacementObservation =
          yield* replaceConflictedPointMutationAttempt(ticket.finishing);
        if (!isNonArrayRecord(replacementObservation)) {
          return yield* Effect.fail(
            new PointMutationOccRerunAuthorityCorruptionV1Error({
              reason: "replacementObservationInvalid",
            }),
          );
        }
        const replacementKind = replacementObservation.kind;
        if (
          replacementKind !== "replaced" &&
          replacementKind !== "alreadyReplaced"
        ) {
          return yield* Effect.fail(
            new PointMutationOccRerunAuthorityCorruptionV1Error({
              reason: "replacementObservationInvalid",
            }),
          );
        }
        const attemptFence = TransactionAttemptFenceSchema.make(
          previousAttemptFence + 1n,
        );
        if (
          replacementObservation.scopeUuid !==
            prepared.plan.sealIdentity.scopeUuid ||
          replacementObservation.sessionId !== pins.sessionId ||
          replacementObservation.previousAttemptFence !==
            previousAttemptFence ||
          replacementObservation.attemptFence !== attemptFence
        ) {
          return yield* Effect.fail(
            new PointMutationOccRerunAuthorityCorruptionV1Error({
              reason: "replacementObservationInvalid",
            }),
          );
        }
        if (replacementKind === "alreadyReplaced") {
          return yield* Effect.fail(
            new PointMutationOccRerunOwnershipLostV1Error({
              reason: "alreadyReplaced",
            }),
          );
        }

        // Once O08-A settles, cancellation intentionally leaves the durable
        // pristine attempt without process-local execution authority.
        yield* Effect.yieldNow;
        const loadedAttempt = yield* pointMutationOccAttemptLoading.load({
          deploymentId: pins.deploymentId,
          scopeId: pins.scopeId,
          sessionId: pins.sessionId,
          attemptFence: attemptFence.toString(),
        });
        const loaded =
          getLoadedPointMutationSessionAttemptOccRerunInspectionV1(
            loadedAttempt,
          );
        if (loaded === undefined) {
          return yield* Effect.fail(
            new PointMutationOccRerunAuthorityCorruptionV1Error({
              reason: "loadedAttemptStateUnavailable",
            }),
          );
        }
        const freshMismatch = pointMutationOccFreshAttemptMismatch(
          prepared,
          conflict,
          attemptFence,
          loaded,
        );
        if (freshMismatch !== undefined) {
          return yield* Effect.fail(
            new PointMutationOccRerunFreshAttemptV1Error({
              reason: freshMismatch,
            }),
          );
        }

        // B2 must still recheck the outcome and liveness immediately before use.
        yield* Effect.yieldNow;
        const inspection = Object.freeze({
          deploymentId: pins.deploymentId,
          scopeId: pins.scopeId,
          sessionId: pins.sessionId,
          requestKey: pins.requestKey,
          previousAttemptFence,
          attemptFence,
          previousSnapshotToken: Object.freeze({ ...previousSnapshot }),
          snapshotToken: Object.freeze({ ...loaded.snapshotToken }),
          conflictDocumentId: conflict.documentId,
          conflictingCommitSeq: conflict.currentCommitSeq,
        } satisfies AuthorizedPointMutationOccRerunInspectionV1);
        const rerun: AuthorizedPointMutationOccRerunV1 = Object.freeze({
          [authorizedPointMutationOccRerunBrand]: PROCESS_LOCAL_CAPABILITY,
        });
        authorizedOccRerunStates.set(
          rerun,
          Object.freeze({
            loadedAttempt,
            prepared,
            conflict,
            inspection,
          }),
        );
        mintedAuthorizedOccReruns.add(rerun);
        return Object.freeze({
          kind: "authorized",
          rerun,
          backoffUpperBoundMilliseconds,
          backoffMilliseconds,
        });
      },
    );

  const claimAuthorizedPointMutationOccRerun = (
    input: unknown,
  ): Result.Result<
    AuthorizedPointMutationOccRerunStateV1,
    InvalidAuthorizedPointMutationOccRerunV1Error
  > => {
    if (typeof input !== "object" || input === null) {
      return Result.fail(
        new InvalidAuthorizedPointMutationOccRerunV1Error({
          reason: "notSameFactory",
        }),
      );
    }
    const state = authorizedOccRerunStates.get(input);
    if (state === undefined) {
      return Result.fail(
        new InvalidAuthorizedPointMutationOccRerunV1Error({
          reason:
            mintedAuthorizedOccReruns.has(input) ||
            consumedAuthorizedOccReruns.has(input)
              ? "alreadyConsumed"
              : "notSameFactory",
        }),
      );
    }
    authorizedOccRerunStates.delete(input);
    consumedAuthorizedOccReruns.add(input);
    return Result.succeed(state);
  };

  const consumeAuthorizedPointMutationOccRerunForTest: StoredPointMutationOccRerunAuthorizationV1["consumeAuthorizedPointMutationOccRerunForTest"] =
    (input) => {
      const state = Result.getOrThrow(
        claimAuthorizedPointMutationOccRerun(input),
      );
      return Object.freeze({
        ...state.inspection,
        previousSnapshotToken: Object.freeze({
          ...state.inspection.previousSnapshotToken,
        }),
        snapshotToken: Object.freeze({ ...state.inspection.snapshotToken }),
      });
    };

  const authorization = Object.freeze({
    ...replacement,
    authorizePointMutationOccRerun,
    consumeAuthorizedPointMutationOccRerunForTest,
  } satisfies StoredPointMutationOccRerunAuthorizationV1);
  if (
    pointMutationOccExecutionEvidence === undefined ||
    pointMutationOccJournal === undefined ||
    pointMutationOccTerminalization === undefined ||
    pointMutationOccContextFactory === undefined ||
    pointMutationOccRunner === undefined
  ) {
    return authorization;
  }

  const executeAuthorizedPointMutationOccRerun: StoredPointMutationOccRerunExecutionV1["executeAuthorizedPointMutationOccRerun"] =
    Effect.fn(
      "StoredAttemptAuthentication.executeAuthorizedPointMutationOccRerun",
    )(function* (input) {
      // The process-local B1 capability is irreversibly claimed before the
      // first asynchronous yield. Durable running/pristine state alone never
      // enters this operation.
      let rerunState = yield* Effect.fromResult(
        claimAuthorizedPointMutationOccRerun(input),
      );

      while (true) {
        const initialOutcome = yield* resolvePointMutationOccOutcome(
          rerunState.prepared,
        );
        if (initialOutcome.kind !== "missing") {
          return publicationResultFromOccOutcome(initialOutcome);
        }

        const executionAuthority =
          captureStoredOccExecutionAuthorityV1(rerunState);
        const loadResult = yield* pointMutationOccExecutionEvidence
          .loadEffect(executionAuthority)
          .pipe(
            Effect.mapError(
              (error: StoredOccExecutionEvidencePersistenceV1Error) =>
                new PointMutationOccExecutionEvidencePersistenceV1Error({
                  cause: error,
                }),
            ),
          );
        if (loadResult.kind === "alreadyCommitted") {
          const committedOutcome = yield* resolvePointMutationOccOutcome(
            rerunState.prepared,
          );
          if (committedOutcome.kind === "missing") {
            return yield* Effect.fail(
              new PointMutationOccExecutionAuthorityCorruptionV1Error({
                reason: "committedOutcomeMissing",
              }),
            );
          }
          return publicationResultFromOccOutcome(committedOutcome);
        }
        const executionEvidence =
          yield* requireOccExecutionEvidenceEffect(loadResult);
        const verificationState = captureOccExecutionVerificationState(
          rerunState,
          executionEvidence.session,
        );
        const verifiedEvidence = yield* verifyCommitAuthorityEvidenceEffect(
          verificationState,
          executionEvidence,
          grantKernel,
        );
        if (executionEvidence.session.artifactRuntime !== "dynamic-worker") {
          return yield* Effect.fail(
            new PointMutationOccExecutionAuthorityCorruptionV1Error({
              reason: "runtimePinInvalid",
            }),
          );
        }
        const canonicalRequest = yield* Effect.promise(() =>
          canonicalizePointMutationRequestV1({
            deploymentId: verificationState.authority.deploymentId,
            functionPath: TransactionFunctionPathV1Schema.make(
              verificationState.session.functionPath,
            ),
            validatedArgsSha256: TransactionArgumentsSha256V1Schema.make(
              copyBytes(verificationState.session.validatedArgsSha256),
            ),
            requestKey: TransactionRequestKeyV1Schema.make(
              verificationState.session.requestKey,
            ),
          }),
        );
        if (
          !bytesEqual(
            canonicalRequest.sha256,
            verificationState.session.requestSha256,
          ) ||
          !bytesEqual(
            canonicalRequest.sha256,
            rerunState.prepared.provenance.session.requestSha256,
          )
        ) {
          return yield* Effect.fail(
            new PointMutationOccExecutionAuthorityCorruptionV1Error({
              reason: "requestEvidenceInvalid",
            }),
          );
        }
        const metadataUnknown = yield* commitAuthority.functionMetadata.load(
          capturePinnedFunctionSelector(verificationState),
        );
        const functionMetadata = yield* verifyPinnedFunctionMetadataEffect(
          verificationState,
          metadataUnknown,
        );
        // Own the bounded, potentially multi-megabyte runner evidence before
        // the final temporal reload. Only small context/journal binding may
        // occur between that reload and user-code entry.
        const runnerEvidence = capturePointMutationOccRunnerEvidence(
          verifiedEvidence,
          functionMetadata,
        );
        // Entropy allocation is deliberately before the final temporal load.
        // A slow factory cannot leave a once-live lease trusted for execution.
        const entropy = yield* pointMutationOccContextFactory.make();

        // The bounded RR capture is already closed. Reload O03 immediately
        // before user code so lease/revocation/root races cannot authorize it.
        const currentAttempt = yield* pointMutationOccAttemptLoading.load({
          deploymentId: rerunState.inspection.deploymentId,
          scopeId: rerunState.inspection.scopeId,
          sessionId: rerunState.inspection.sessionId,
          attemptFence: rerunState.inspection.attemptFence.toString(),
        });
        const currentInspection =
          getLoadedPointMutationSessionAttemptOccRerunInspectionV1(
            currentAttempt,
          );
        if (currentInspection === undefined) {
          return yield* Effect.fail(
            new PointMutationOccRerunAuthorityCorruptionV1Error({
              reason: "loadedAttemptStateUnavailable",
            }),
          );
        }
        const currentMismatch = pointMutationOccFreshAttemptMismatch(
          rerunState.prepared,
          rerunState.conflict,
          rerunState.inspection.attemptFence,
          currentInspection,
        );
        if (currentMismatch !== undefined) {
          return yield* Effect.fail(
            new PointMutationOccRerunFreshAttemptV1Error({
              reason: currentMismatch,
            }),
          );
        }
        if (
          currentInspection.snapshotToken.scopeId !==
            rerunState.inspection.snapshotToken.scopeId ||
          currentInspection.snapshotToken.epoch !==
            rerunState.inspection.snapshotToken.epoch ||
          currentInspection.snapshotToken.commitSeq !==
            rerunState.inspection.snapshotToken.commitSeq
        ) {
          return yield* Effect.fail(
            new PointMutationOccExecutionAuthorityMismatchV1Error({
              reason: "snapshotChanged",
            }),
          );
        }

        const prepareRunningPlan = Effect.gen(function* () {
          const context = yield* Effect.fromResult(
            capturePointMutationOccExecutionContext(
              entropy,
              executionEvidence.creationTimeSeed,
              rerunState.inspection.attemptFence,
              rerunState.inspection.snapshotToken,
            ),
          );
          const journalAttempt =
            yield* pointMutationOccJournal.openAttempt(currentAttempt);
          const runnerInput = capturePointMutationOccRunnerInput(
            runnerEvidence,
            context,
            bindPointMutationOccJournal(
              pointMutationOccJournal,
              journalAttempt,
            ),
          );
          const successfulResult =
            yield* pointMutationOccRunner.run(runnerInput);
          const envelope = yield* pointMutationOccJournal.sealSuccessfulResult(
            journalAttempt,
            successfulResult === undefined ? null : successfulResult,
          );
          const encodedEnvelope = yield* Effect.sync(() =>
            encodeCommitEnvelopeV1(envelope),
          );
          const storedAuthority = yield* deriveAuthority(currentAttempt);
          const storedAttempt = yield* authenticate(
            storedAuthority,
            encodedEnvelope,
          );
          const authenticatedAuthority =
            yield* authenticateCommitAuthority(storedAttempt);
          const verifiedInput = yield* verifyCommitInput(
            authenticatedAuthority,
          );
          return yield* planPointCommit(verifiedInput);
        });
        const runningPlan = yield* abortOnPreFinishingFailure(
          prepareRunningPlan,
          currentAttempt,
          pointMutationOccTerminalization,
        );

        // From this point forward, C05-A/O07-B own recovery. Never abort a
        // possibly-finishing or ambiguously published attempt.
        const finishingPlan = yield* enterPointCommitFinishing(runningPlan);
        const publication = yield* publishFinishingPointCommit(
          finishingPlan,
        ).pipe(
          Effect.map((result) =>
            Object.freeze({
              kind: "completed" as const,
              result,
            }),
          ),
          Effect.catchTag("PointCommitConflictV1Error", (error) =>
            Effect.succeed(
              Object.freeze({
                kind: "conflict" as const,
                error,
              }),
            ),
          ),
        );
        if (publication.kind === "completed") return publication.result;

        const authorizationResult = yield* authorizePointMutationOccRerun(
          publication.error,
        );
        if (authorizationResult.kind === "replayed") {
          return publicationResultFromOccOutcome(authorizationResult.outcome);
        }
        if (authorizationResult.kind === "expired") {
          return publicationResultFromOccOutcome(authorizationResult.outcome);
        }
        const nextClaim = claimAuthorizedPointMutationOccRerun(
          authorizationResult.rerun,
        );
        if (Result.isFailure(nextClaim))
          return yield* Effect.fail(nextClaim.failure);
        rerunState = nextClaim.success;
      }
    });

  return Object.freeze({
    ...authorization,
    executeAuthorizedPointMutationOccRerun,
  } satisfies StoredPointMutationOccRerunExecutionV1);
}

function captureStoredOccExecutionAuthorityV1(
  state: AuthorizedPointMutationOccRerunStateV1,
): StoredOccExecutionEvidenceAuthorityV1 {
  const pins = state.prepared.plan.authorityPins;
  const previousSession = state.prepared.provenance.session;
  return Object.freeze({
    deploymentId: pins.deploymentId,
    scopeId: pins.scopeId,
    scopeUuid: state.prepared.plan.sealIdentity.scopeUuid,
    sessionId: pins.sessionId,
    attemptFence: state.inspection.attemptFence,
    storageGeneration: pins.storageGeneration,
    storageGenerationFence: pins.storageGenerationFence,
    snapshotToken: Object.freeze({ ...state.inspection.snapshotToken }),
    schemaVersionId: pins.schemaVersionId,
    previousSession: Object.freeze({
      ...previousSession,
      identityAccessPolicySha256: copyBytes(
        previousSession.identityAccessPolicySha256,
      ),
      validatedArgsSha256: copyBytes(previousSession.validatedArgsSha256),
      authorizationGrantSha256: copyBytes(
        previousSession.authorizationGrantSha256,
      ),
      requestSha256: copyBytes(previousSession.requestSha256),
    }),
  });
}

const requireOccExecutionEvidenceEffect = Effect.fn(
  "StoredAttemptAuthentication.requireOccExecutionEvidence",
)(function* (
  result: Exclude<
    StoredOccExecutionEvidenceLoadResultV1,
    { readonly kind: "alreadyCommitted" }
  >,
) {
  switch (result.kind) {
    case "loaded":
      return result.evidence;
    case "notExecutable":
      return yield* Effect.fail(
        new PointMutationOccExecutionNotRunnableV1Error({
          reason: result.reason,
          ...(result.lifecycle === undefined
            ? {}
            : { lifecycle: result.lifecycle }),
        }),
      );
    case "authorityMismatch":
      return yield* Effect.fail(
        new PointMutationOccExecutionAuthorityMismatchV1Error({
          reason: result.reason,
        }),
      );
    case "corrupt":
      return yield* Effect.fail(
        new PointMutationOccExecutionAuthorityCorruptionV1Error({
          reason: result.reason,
          ...(result.cause === undefined ? {} : { cause: result.cause }),
        }),
      );
  }
});

function captureOccExecutionVerificationState(
  state: AuthorizedPointMutationOccRerunStateV1,
  session: StoredCommitAuthoritySessionEvidencePortV1,
): CommitAuthorityVerificationStateV1 {
  const pins = state.prepared.plan.authorityPins;
  return Object.freeze({
    authority: Object.freeze({
      deploymentId: pins.deploymentId,
      scopeId: pins.scopeId,
      sessionId: pins.sessionId,
      attemptFence: state.inspection.attemptFence,
      storageGeneration: pins.storageGeneration,
      storageGenerationFence: pins.storageGenerationFence,
      snapshotToken: Object.freeze({ ...state.inspection.snapshotToken }),
      schemaVersionId: pins.schemaVersionId,
    }),
    session: Object.freeze({
      ...session,
      identityAccessPolicySha256: copyBytes(session.identityAccessPolicySha256),
      validatedArgsSha256: copyBytes(session.validatedArgsSha256),
      authorizationGrantSha256: copyBytes(session.authorizationGrantSha256),
      requestSha256: copyBytes(session.requestSha256),
    }),
  });
}

function publicationResultFromOccOutcome(
  outcome: Exclude<
    CommittedPointOutcomeResolutionV1,
    { readonly kind: "missing" }
  >,
): PointCommitPublicationResultV1 {
  return outcome.kind === "expired"
    ? Object.freeze({ kind: "expired", token: outcome.token })
    : Object.freeze({
        kind: "replayed",
        token: outcome.token,
        successfulResult: outcome.successfulResult,
      });
}

function capturePointMutationOccExecutionContext(
  entropy: Readonly<{
    readonly executionId: unknown;
    readonly logScopeId: unknown;
    readonly randomSeed: unknown;
  }>,
  creationTimeSeed: AppCreationTimeV1,
  attemptFence: TransactionAttemptFence,
  snapshotToken: SnapshotToken,
): Result.Result<
  PointMutationOccExecutionContextV1,
  PointMutationOccExecutionContextV1Error
> {
  if (!isNonBlankString(entropy.executionId)) {
    return Result.fail(
      new PointMutationOccExecutionContextV1Error({
        reason: "invalidExecutionId",
      }),
    );
  }
  if (!isNonBlankString(entropy.logScopeId)) {
    return Result.fail(
      new PointMutationOccExecutionContextV1Error({
        reason: "invalidLogScopeId",
      }),
    );
  }
  if (!isUint8ArrayWithByteLength(entropy.randomSeed, 32)) {
    return Result.fail(
      new PointMutationOccExecutionContextV1Error({
        reason: "invalidRandomSeed",
      }),
    );
  }
  return Result.succeed(
    Object.freeze({
      executionId: entropy.executionId,
      logScopeId: entropy.logScopeId,
      randomSeed: copyBytes(entropy.randomSeed),
      executionTime: creationTimeSeed,
      initialCreationTimeCursor: creationTimeSeed,
      attemptFence,
      snapshotToken: Object.freeze({ ...snapshotToken }),
    }),
  );
}

function bindPointMutationOccJournal(
  journal: PointMutationJournalV1,
  attempt: PointMutationJournalAttemptV1,
): PointMutationOccBoundJournalV1 {
  return Object.freeze({
    resolvePointTable: (tableName: unknown) =>
      journal.resolvePointTable(attempt, tableName),
    runPointOperation: (
      table: PointMutationJournalTableV1,
      operation: unknown,
    ) => journal.runPointOperation(table, operation),
  });
}

function capturePointMutationOccRunnerEvidence(
  evidence: VerifiedCommitAuthorityEvidenceV1,
  functionMetadata: PointMutationTargetFunctionMetadataV1,
): PointMutationOccDetachedRunnerEvidenceV1 {
  return Object.freeze({
    argumentsJson: Object.freeze(structuredClone(evidence.argumentsJson)),
    argumentArraySemanticBytes: evidence.argumentArraySemanticBytes,
    verifiedGrant: detachVerifiedGrant(evidence.verifiedGrant),
    schemaManifest: Object.freeze(structuredClone(evidence.schemaManifest)),
    stableBindings: Object.freeze(structuredClone(evidence.stableBindings)),
    functionMetadata: Object.freeze(structuredClone(functionMetadata)),
  });
}

function capturePointMutationOccRunnerInput(
  evidence: PointMutationOccDetachedRunnerEvidenceV1,
  context: PointMutationOccExecutionContextV1,
  journal: PointMutationOccBoundJournalV1,
): PointMutationOccRuntimeNeutralRunnerInputV1 {
  return Object.freeze({
    ...evidence,
    context: Object.freeze({
      ...context,
      randomSeed: copyBytes(context.randomSeed),
      snapshotToken: Object.freeze({ ...context.snapshotToken }),
    }),
    journal,
  });
}

function abortOnPreFinishingFailure<A, E, R>(
  effect: Effect.Effect<A, E, R>,
  attempt: LoadedPointMutationSessionAttemptV1,
  terminalization: PointMutationSessionAttemptTerminalizationV1,
): Effect.Effect<
  A,
  E | PointMutationSessionAttemptTerminalizationExecutionV1Error,
  R
> {
  return Effect.onExit(effect, (primaryExit) => {
    if (Exit.isSuccess(primaryExit)) return Effect.void;
    return Effect.uninterruptible(terminalization.abort(attempt)).pipe(
      Effect.exit,
      Effect.flatMap((cleanupExit) =>
        Exit.isFailure(cleanupExit)
          ? Effect.failCause(
              Cause.combine(primaryExit.cause, cleanupExit.cause),
            )
          : Effect.void,
      ),
    );
  });
}

function pointMutationOccFreshAttemptMismatch(
  prepared: PreparedPointCommitCapabilityStateV1,
  conflict: CapturedPointMutationOccConflictV1,
  expectedAttemptFence: TransactionAttemptFence,
  loaded: LoadedPointMutationSessionAttemptOccRerunInspectionV1,
): PointMutationOccRerunFreshAttemptMismatchV1 | undefined {
  const pins = prepared.plan.authorityPins;
  const previousSnapshot = pins.snapshotToken;
  if (loaded.selector.deploymentId !== pins.deploymentId) return "deployment";
  if (loaded.selector.scopeId !== pins.scopeId) return "scope";
  if (loaded.selector.sessionId !== pins.sessionId) return "session";
  if (loaded.selector.attemptFence !== expectedAttemptFence) {
    return "attemptFence";
  }
  if (loaded.storageGeneration !== pins.storageGeneration) {
    return "storageGeneration";
  }
  if (loaded.storageGenerationFence !== pins.storageGenerationFence) {
    return "storageGenerationFence";
  }
  if (loaded.snapshotToken.epoch !== previousSnapshot.epoch) return "epoch";
  if (loaded.schemaVersionId !== pins.schemaVersionId) return "schema";
  if (loaded.requestKey !== pins.requestKey) return "requestKey";
  if (loaded.snapshotToken.commitSeq <= previousSnapshot.commitSeq) {
    return "snapshotNotAdvanced";
  }
  if (loaded.snapshotToken.commitSeq < conflict.currentCommitSeq) {
    return "conflictingCommitNotVisible";
  }
  if (loaded.attemptFacet.kind !== "pristineOpen") {
    return "attemptNotPristine";
  }
  return undefined;
}

function captureCommitAuthorityPort(
  state: AuthenticatedStoredAttemptStateV1,
): StoredCommitAuthorityEvidenceAuthorityPortV1 {
  return Object.freeze({
    ...state.authority,
    snapshotToken: Object.freeze({ ...state.authority.snapshotToken }),
    session: Object.freeze(structuredClone(state.session)),
    sealIdentity: Object.freeze(structuredClone(state.sealIdentity)),
  });
}

function lookupSameFactoryAuthenticatedState(
  states: WeakMap<object, AuthenticatedStoredAttemptStateV1>,
  value: AuthenticatedStoredAttemptV1,
): AuthenticatedStoredAttemptStateV1 | undefined {
  return typeof value === "object" && value !== null
    ? states.get(value)
    : undefined;
}

function requireCommitAuthorityState(
  states: WeakMap<object, AuthenticatedCommitAuthorityStateV1>,
  value: AuthenticatedCommitAuthorityV1,
): AuthenticatedCommitAuthorityStateV1 {
  const state = typeof value === "object" && value !== null
    ? states.get(value)
    : undefined;
  if (state === undefined) {
    throw new InvalidAuthenticatedStoredAttemptV1Error({
      reason: "notSameFactory",
    });
  }
  return state;
}

function lookupCommitAuthorityState(
  states: WeakMap<object, AuthenticatedCommitAuthorityStateV1>,
  value: AuthenticatedCommitAuthorityV1,
): AuthenticatedCommitAuthorityStateV1 | undefined {
  return typeof value === "object" && value !== null
    ? states.get(value)
    : undefined;
}

function requireVerifiedCommitInputState(
  states: WeakMap<object, VerifiedCommitCapabilityStateV1>,
  value: VerifiedCommitInputV1,
): VerifiedCommitCapabilityStateV1 {
  const state = typeof value === "object" && value !== null
    ? states.get(value)
    : undefined;
  if (state === undefined) {
    throw new InvalidAuthenticatedCommitAuthorityV1Error({
      reason: "notSameFactory",
    });
  }
  return state;
}

function lookupVerifiedCommitInputState(
  states: WeakMap<object, VerifiedCommitCapabilityStateV1>,
  value: VerifiedCommitInputV1,
): VerifiedCommitCapabilityStateV1 | undefined {
  return typeof value === "object" && value !== null
    ? states.get(value)
    : undefined;
}

function lookupPreparedPointCommitState(
  states: WeakMap<object, PreparedPointCommitCapabilityStateV1>,
  value: PreparedPointCommitV1,
): PreparedPointCommitCapabilityStateV1 | undefined {
  return typeof value === "object" && value !== null
    ? states.get(value)
    : undefined;
}

function deepDetachCommitAuthorityState(
  storedAttempt: AuthenticatedStoredAttemptStateV1,
  evidence: VerifiedCommitAuthorityEvidenceV1,
  functionMetadata: PointMutationTargetFunctionMetadataV1,
): AuthenticatedCommitAuthorityStateV1 {
  return Object.freeze({
    storedAttempt,
    databaseNowMilliseconds: evidence.databaseNowMilliseconds,
    argumentsJson: Object.freeze(structuredClone(evidence.argumentsJson)),
    argumentArraySemanticBytes: evidence.argumentArraySemanticBytes,
    verifiedGrant: detachVerifiedGrant(evidence.verifiedGrant),
    schemaManifest: Object.freeze(structuredClone(evidence.schemaManifest)),
    stableBindings: Object.freeze(structuredClone(evidence.stableBindings)),
    functionMetadata: Object.freeze(structuredClone(functionMetadata)),
  });
}

function capturePointCommitScalarProvenance(
  storedAttempt: AuthenticatedStoredAttemptStateV1,
): PointCommitScalarProvenanceV1 {
  const session = storedAttempt.session;
  return Object.freeze({
    authority: Object.freeze({
      ...storedAttempt.authority,
      snapshotToken: Object.freeze({
        ...storedAttempt.authority.snapshotToken,
      }),
    }),
    session: Object.freeze({
      ...session,
      identityAccessPolicySha256:
        copyBytes(session.identityAccessPolicySha256),
      validatedArgsSha256: copyBytes(session.validatedArgsSha256),
      authorizationGrantSha256:
        copyBytes(session.authorizationGrantSha256),
      requestSha256: copyBytes(session.requestSha256),
    }),
  });
}

function rebaseFinishingPreparedPointCommitState(
  state: PreparedPointCommitCapabilityStateV1,
  result: PointCommitFinishingTransitionResultV1,
): Result.Result<
  PreparedPointCommitCapabilityStateV1,
  PointCommitCorruptionV1Error
> {
  const session = state.provenance.session;
  const seal = state.plan.sealIdentity;
  const pins = state.plan.authorityPins;
  if (
    (result.kind !== "transitioned" && result.kind !== "observed") ||
    result.scopeUuid !== seal.scopeUuid ||
    result.sessionId !== pins.sessionId ||
    result.attemptFence !== pins.attemptFence ||
    result.priorSessionUpdatedAtMilliseconds !==
      session.updatedAtMilliseconds ||
    !isPositiveSafeInteger(result.finishingSessionUpdatedAtMilliseconds) ||
    result.finishingSessionUpdatedAtMilliseconds <
      result.priorSessionUpdatedAtMilliseconds ||
    result.finishingSessionUpdatedAtMilliseconds >=
      session.authorizationGrantExpiresAtMilliseconds ||
    result.finishingSessionUpdatedAtMilliseconds >=
      session.hardExpiresAtMilliseconds ||
    result.finishingSessionUpdatedAtMilliseconds >=
      seal.leaseExpiresAtMilliseconds ||
    session.lifecycle !== "running" ||
    seal.lifecycle !== "running" ||
    seal.sessionUpdatedAtMilliseconds !== session.updatedAtMilliseconds
  ) {
    return Result.fail(new PointCommitCorruptionV1Error({
      reason: "finishingTransitionInvalid",
    }));
  }
  const finishingUpdatedAtMilliseconds =
    result.finishingSessionUpdatedAtMilliseconds;
  const provenance = Object.freeze({
    authority: Object.freeze({
      ...state.provenance.authority,
      snapshotToken: Object.freeze({
        ...state.provenance.authority.snapshotToken,
      }),
    }),
    session: Object.freeze({
      ...session,
      lifecycle: "finishing" as const,
      updatedAtMilliseconds: finishingUpdatedAtMilliseconds,
      identityAccessPolicySha256:
        copyBytes(session.identityAccessPolicySha256),
      validatedArgsSha256: copyBytes(session.validatedArgsSha256),
      authorizationGrantSha256:
        copyBytes(session.authorizationGrantSha256),
      requestSha256: copyBytes(session.requestSha256),
    }),
  } satisfies PointCommitScalarProvenanceV1);
  const dependencies = Object.freeze(state.plan.dependencies.map(
    (dependency) => Object.freeze({
      documentId: dependency.documentId,
      tableId: dependency.tableId,
      rowId: dependency.rowId,
      dependency: Object.freeze(structuredClone(dependency.dependency)),
    }),
  ));
  const sourceIntent = state.plan.rowIntent;
  const rowIntent = sourceIntent === null
    ? null
    : sourceIntent.kind === "deleted"
      ? Object.freeze({
          documentId: sourceIntent.documentId,
          tableId: sourceIntent.tableId,
          rowId: sourceIntent.rowId,
          dependency: Object.freeze(structuredClone(sourceIntent.dependency)),
          kind: "deleted" as const,
        })
      : Object.freeze({
          documentId: sourceIntent.documentId,
          tableId: sourceIntent.tableId,
          rowId: sourceIntent.rowId,
          dependency: Object.freeze(structuredClone(sourceIntent.dependency)),
          kind: "live" as const,
          creationTime: sourceIntent.creationTime,
          value: normalizeFlarexValueV1(
            sourceIntent.value,
            "appDocument",
          ).value,
          canonicalBytes: copyBytes(sourceIntent.canonicalBytes),
          semanticSizeBytes: sourceIntent.semanticSizeBytes,
        });
  const successfulResult = state.plan.successfulResult;
  const plan = Object.freeze({
    authorityPins: Object.freeze({
      ...pins,
      snapshotToken: Object.freeze({ ...pins.snapshotToken }),
    }),
    sealIdentity: Object.freeze({
      ...seal,
      lifecycle: "finishing" as const,
      sessionUpdatedAtMilliseconds: finishingUpdatedAtMilliseconds,
      journalSha256: copyBytes(seal.journalSha256),
      resultSha256: copyBytes(seal.resultSha256),
    }),
    dependencies,
    rowIntent,
    successfulResult: Object.freeze({
      valueCodecVersion: successfulResult.valueCodecVersion,
      value: structuredClone(successfulResult.value),
      canonicalBytes: CanonicalSuccessfulResultBytesV1Schema.make(
        copyBytes(successfulResult.canonicalBytes),
      ),
      semanticSizeBytes: successfulResult.semanticSizeBytes,
      sha256Hex: successfulResult.sha256Hex,
    }),
  } satisfies PreparedPointCommitStateV1);
  return Result.succeed(Object.freeze({
    plan,
    provenance,
    executionAuthority: state.executionAuthority,
  }));
}

function capturePointCommitFinishingTransitionCommand(
  state: PreparedPointCommitCapabilityStateV1,
): PointCommitFinishingTransitionCommandV1 {
  const scalar = capturePointCommitAttemptScalarCommand(state);
  if (
    scalar.session.lifecycle !== "running" ||
    scalar.sealIdentity.lifecycle !== "running"
  ) {
    throw new Error("C05-A requires running prepared point-commit authority.");
  }
  return Object.freeze({
    authorityPins: scalar.authorityPins,
    session: Object.freeze({
      ...scalar.session,
      lifecycle: "running" as const,
    }),
    sealIdentity: Object.freeze({
      ...scalar.sealIdentity,
      lifecycle: "running" as const,
    }),
  });
}

function capturePointCommitAttemptScalarCommand(
  state: PreparedPointCommitCapabilityStateV1,
): PointCommitAttemptScalarCommandV1 {
  const pins = state.plan.authorityPins;
  const session = state.provenance.session;
  const seal = state.plan.sealIdentity;
  return Object.freeze({
    authorityPins: Object.freeze({
      deploymentId: TransactionGrantDeploymentIdV1Schema.make(
        pins.deploymentId,
      ),
      scopeId: ReplacementScopeIdV1Schema.make(pins.scopeId),
      sessionId: pins.sessionId,
      attemptFence: pins.attemptFence,
      storageGeneration: pins.storageGeneration,
      storageGenerationFence: pins.storageGenerationFence,
      snapshotToken: Object.freeze({ ...pins.snapshotToken }),
      schemaVersionId: CatalogSchemaVersionIdSchema.make(
        pins.schemaVersionId,
      ),
      packageId: TransactionPackageIdV1Schema.make(pins.packageId),
      artifactRuntime: decodeTransactionArtifactRuntimeV1(
        pins.artifactRuntime,
      ),
      artifactId: TransactionArtifactIdV1Schema.make(pins.artifactId),
      sourcePackageHash: TransactionSourcePackageSha256HexV1Schema.make(
        pins.sourcePackageHash,
      ),
      executionModule: TransactionExecutionModuleV1Schema.make(
        pins.executionModule,
      ),
      functionPath: TransactionFunctionPathV1Schema.make(
        pins.functionPath,
      ),
      functionKind: pins.functionKind,
      policyVersion: TransactionPolicyVersionV1Schema.make(
        pins.policyVersion,
      ),
      authorizationRevocationEpoch:
        TransactionAuthorizationRevocationEpochSchema.make(
          pins.authorizationRevocationEpoch,
        ),
      requestKey: TransactionRequestKeyV1Schema.make(pins.requestKey),
    }),
    session: Object.freeze({
      ...session,
      authorizationGrantId: TransactionAuthorizationGrantIdV1Schema.make(
        session.authorizationGrantId,
      ),
      identityAccessPolicySha256:
        copyBytes(session.identityAccessPolicySha256),
      validatedArgsSha256: copyBytes(session.validatedArgsSha256),
      authorizationGrantSha256:
        copyBytes(session.authorizationGrantSha256),
      requestSha256: copyBytes(session.requestSha256),
    }),
    sealIdentity: Object.freeze({
      ...seal,
      journalSha256: copyBytes(seal.journalSha256),
      resultSha256: copyBytes(seal.resultSha256),
    }),
  } satisfies PointCommitAttemptScalarCommandV1);
}

function capturePointCommitTransactionCommand(
  state: PreparedPointCommitCapabilityStateV1,
): PointCommitTransactionCommandV1 {
  const scalar = capturePointCommitAttemptScalarCommand(state);
  const dependencies = capturePointCommitDependencies(state);
  const rowIntent = state.plan.rowIntent === null
    ? null
    : state.plan.rowIntent.kind === "deleted"
      ? Object.freeze({
          documentId: state.plan.rowIntent.documentId,
          tableId: state.plan.rowIntent.tableId,
          rowId: state.plan.rowIntent.rowId,
          dependency: Object.freeze(structuredClone(
            state.plan.rowIntent.dependency,
          )),
          kind: "deleted" as const,
        })
      : Object.freeze({
          documentId: state.plan.rowIntent.documentId,
          tableId: state.plan.rowIntent.tableId,
          rowId: state.plan.rowIntent.rowId,
          dependency: Object.freeze(structuredClone(
            state.plan.rowIntent.dependency,
          )),
          kind: "live" as const,
          creationTime: state.plan.rowIntent.creationTime,
          value: normalizeFlarexValueV1(
            state.plan.rowIntent.value,
            "appDocument",
          ).value,
          canonicalBytes: copyBytes(state.plan.rowIntent.canonicalBytes),
          semanticSizeBytes: state.plan.rowIntent.semanticSizeBytes,
        });
  return Object.freeze({
    ...scalar,
    dependencies,
    rowIntent,
  } satisfies PointCommitTransactionCommandV1);
}

function capturePointMutationAttemptReplacementCommand(
  state: PreparedPointCommitCapabilityStateV1,
): PointMutationAttemptReplacementCommandV1 {
  return Object.freeze({
    ...capturePointCommitAttemptScalarCommand(state),
    dependencies: capturePointCommitDependencies(state),
  });
}

function capturePointCommitDependencies(
  state: PreparedPointCommitCapabilityStateV1,
): PointCommitTransactionCommandV1["dependencies"] {
  return Object.freeze(state.plan.dependencies.map(
    (dependency) => Object.freeze({
      documentId: dependency.documentId,
      tableId: dependency.tableId,
      rowId: dependency.rowId,
      dependency: Object.freeze(structuredClone(dependency.dependency)),
    }),
  ));
}

function capturePointCommitPublicationCommand(
  state: PreparedPointCommitCapabilityStateV1,
): PointCommitPublicationCommandV1 {
  const command = capturePointCommitTransactionCommand(state);
  const result = state.plan.successfulResult;
  const stableBytes = copyBytes(result.canonicalBytes);
  return Object.freeze({
    ...command,
    successfulResult: Object.freeze({
      valueCodecVersion: result.valueCodecVersion,
      value: structuredClone(result.value),
      get canonicalBytes(): PointCommitPublicationCommandV1[
        "successfulResult"
      ]["canonicalBytes"] {
        return CanonicalSuccessfulResultBytesV1Schema.make(
          copyBytes(stableBytes),
        );
      },
      semanticSizeBytes: result.semanticSizeBytes,
      sha256Hex: result.sha256Hex,
    }),
  } satisfies PointCommitPublicationCommandV1);
}

function serializeCommitAuthorityStateForTest(
  state: AuthenticatedCommitAuthorityStateV1,
): string {
  return serializePrivateStateForTest(state, () =>
    new StoredCommitAuthorityCorruptionV1Error({
      reason: "sessionEvidenceInvalid",
    })
  );
}

function serializeVerifiedCommitInputStateForTest(
  state: VerifiedCommitInputStateV1,
): string {
  return serializePrivateStateForTest(state, () =>
    new CommitInputAuthorityCorruptionV1Error({
      reason: "successfulResultInvalid",
    })
  );
}

function serializePreparedPointCommitStateForTest(
  state: PreparedPointCommitStateV1,
): string {
  return serializePrivateStateForTest(
    state,
    () => new Error("Prepared point commit state could not be serialized."),
  );
}

const requireLoadedEvidenceEffect = Effect.fn(
  "StoredAttemptAuthentication.requireLoadedEvidence",
)(function* (
  result: StoredAttemptEvidenceLoadResultPortV1,
): Effect.fn.Return<
  StoredAttemptEvidencePortV1,
  | StoredAttemptAlreadyCommittedV1Error
  | StoredAttemptNotPlannableV1Error
  | StoredAttemptAuthorityMismatchV1Error
  | StoredAttemptStorageCorruptionV1Error
> {
  switch (result.kind) {
    case "loaded":
      return result.evidence;
    case "alreadyCommitted":
      return yield* Effect.fail(new StoredAttemptAlreadyCommittedV1Error({
        updatedAtMilliseconds: result.updatedAtMilliseconds,
      }));
    case "notPlannable":
      return yield* Effect.fail(new StoredAttemptNotPlannableV1Error({
        reason: result.reason,
        ...(result.lifecycle === undefined
          ? {}
          : { lifecycle: result.lifecycle }),
        ...(result.rootState === undefined
          ? {}
          : { rootState: result.rootState }),
      }));
    case "authorityMismatch":
      return yield* Effect.fail(new StoredAttemptAuthorityMismatchV1Error({
        reason: result.reason,
      }));
    case "corrupt":
      return yield* Effect.fail(new StoredAttemptStorageCorruptionV1Error({
        reason: result.reason,
        ...(result.cause === undefined ? {} : { cause: result.cause }),
      }));
  }
});

const captureRecoveredAuthorityEffect = Effect.fn(
  "StoredAttemptAuthentication.captureRecoveredAuthority",
)(function* (
  selector: PointMutationSessionAttemptSelectorV1,
  evidence: StoredAttemptEvidencePortV1,
): Effect.fn.Return<
  StoredAttemptAuthorityStateV1,
  | StoredAttemptNotPlannableV1Error
  | StoredAttemptAuthorityMismatchV1Error
  | StoredAttemptStorageCorruptionV1Error
> {
  if (evidence.deploymentId !== selector.deploymentId) {
    return yield* Effect.fail(authorityMismatchError("placementChanged"));
  }
  if (evidence.scopeId !== selector.scopeId) {
    return yield* Effect.fail(authorityMismatchError("scopeChanged"));
  }
  if (evidence.sessionId !== selector.sessionId) {
    return yield* Effect.fail(authorityMismatchError("attemptMissing"));
  }
  if (evidence.attemptFence !== selector.attemptFence) {
    return yield* Effect.fail(authorityMismatchError("attemptReplaced"));
  }
  if (evidence.session.lifecycle !== "finishing") {
    return yield* Effect.fail(new StoredAttemptNotPlannableV1Error({
      reason: "lifecycle",
      lifecycle: evidence.session.lifecycle,
    }));
  }
  return yield* Effect.try({
    try: () => Object.freeze({
      deploymentId: TransactionGrantDeploymentIdV1Schema.make(
        evidence.deploymentId,
      ),
      scopeId: ReplacementScopeIdV1Schema.make(evidence.scopeId),
      sessionId: TransactionSessionIdV1Schema.make(evidence.sessionId),
      attemptFence: TransactionAttemptFenceSchema.make(evidence.attemptFence),
      storageGeneration: Schema.decodeUnknownSync(
        FlarexDbV1StorageGenerationSchema,
      )(evidence.session.storageGeneration),
      storageGenerationFence: StorageGenerationFenceSchema.make(
        evidence.session.storageGenerationFence,
      ),
      snapshotToken: SnapshotTokenSchema.make({
        ...evidence.lease.snapshotToken,
      }),
      schemaVersionId: CatalogSchemaVersionIdSchema.make(
        evidence.session.schemaVersionId,
      ),
    } satisfies StoredAttemptAuthorityStateV1),
    catch: mapSynchronousStorageFailure,
  });
});

const verifyCanonicalStoredEvidenceEffect = Effect.fn(
  "StoredAttemptAuthentication.verifyCanonicalStoredEvidence",
)(function* (
  authority: StoredAttemptAuthorityStateV1,
  evidence: StoredAttemptEvidencePortV1,
): Effect.fn.Return<
  AuthenticatedStoredAttemptStateV1,
  | StoredAttemptAuthorityMismatchV1Error
  | StoredAttemptStorageCorruptionV1Error
> {
  const scalarEvidence = yield* Effect.try({
    try: () => {
      return Object.freeze({
        journalSha256Hex: bytesToLowercaseHex(
          evidence.root.journalSha256,
          "journalDigestInvalid",
        ),
        successfulResultEvidence: Object.freeze({
          valueCodecVersion: evidence.root.resultValueCodecVersion,
          canonicalValueBase64Url: base64UrlFromBytes(
            evidence.root.resultBytes,
          ),
          sha256Hex: bytesToLowercaseHex(
            evidence.root.resultSha256,
            "resultDigestInvalid",
          ),
        }),
      });
    },
    catch: mapSynchronousStorageFailure,
  });
  const authorityMismatch = evidenceAuthorityMismatch(authority, evidence);
  if (authorityMismatch !== undefined) {
    return yield* Effect.fail(authorityMismatch);
  }
  const journal = yield* decodeCanonicalSessionJournalV1Effect({
    canonicalBytes: copyBytes(evidence.root.journalBytes),
    expectedSha256Hex: scalarEvidence.journalSha256Hex,
  }).pipe(
    Effect.mapError((cause) => new StoredAttemptStorageCorruptionV1Error({
      reason: "journalEvidenceInvalid",
      cause,
    })),
  );
  const successfulResult = yield* verifySuccessfulResultEvidenceV1Effect(
    scalarEvidence.successfulResultEvidence,
  ).pipe(
    Effect.mapError((cause) => new StoredAttemptStorageCorruptionV1Error({
      reason: "successfulResultEvidenceInvalid",
      cause,
    })),
  );
  if (
    successfulResult.semanticSizeBytes !== evidence.root.resultSemanticBytes
  ) {
    return yield* corruptionEffect("resultSemanticBytesMismatch");
  }
  const counterMismatch = journalCounterMismatch(evidence, journal.journal);
  if (counterMismatch !== undefined) {
    return yield* Effect.fail(counterMismatch);
  }
  const points = yield* verifyPointCorrelationEffect(
    evidence.points,
    journal.journal,
  );
  const successfulResultValue = yield* normalizeAuthenticatedResultValueEffect(
    successfulResult.valueJson,
  );
  return yield* Effect.try({
    try: () => captureAuthenticatedState(
      authority,
      evidence,
      journal.journal,
      successfulResult,
      successfulResultValue,
      points,
    ),
    catch: mapSynchronousStorageFailure,
  });
});

const compareCallerEnvelopeWithVerifiedState = Effect.fn(
  "StoredAttemptAuthentication.compareCallerEnvelopeWithVerifiedState",
)((
  envelope: StoredForSessionAttemptCommitEnvelopeV1,
  evidence: StoredAttemptEvidencePortV1,
  verified: AuthenticatedStoredAttemptStateV1,
): Effect.Effect<
  StoredAttemptEnvelopeMismatchV1Error | undefined,
  StoredAttemptStorageCorruptionV1Error
> =>
  Effect.try({
    try: () => storedEnvelopeMismatch(
      envelope,
      evidence,
      bytesToLowercaseHex(
        verified.sealIdentity.journalSha256,
        "journalDigestInvalid",
      ),
      Object.freeze({
        valueCodecVersion:
          verified.sealIdentity.resultValueCodecVersion,
        canonicalValueBase64Url: base64UrlFromBytes(
          verified.successfulResult.canonicalBytes,
        ),
        sha256Hex: verified.successfulResult.sha256Hex,
      }),
    ),
    catch: mapSynchronousStorageFailure,
  }));

const normalizeAuthenticatedResultValueEffect = Effect.fn(
  "StoredAttemptAuthentication.normalizeAuthenticatedResultValue",
)((valueJson: Json): Effect.Effect<
  CanonicalFlarexRuntimeValueV1,
  StoredAttemptStorageCorruptionV1Error
> =>
  Effect.try({
    try: () => normalizeFlarexValueJsonV1(valueJson).value,
    catch: (cause): unknown => cause,
  }).pipe(
    Effect.catch((cause: unknown) =>
      cause instanceof FlarexValueCodecV1Error
        ? Effect.fail(new StoredAttemptStorageCorruptionV1Error({
            reason: "successfulResultEvidenceInvalid",
            cause,
          }))
        : Effect.die(cause)
    ),
  ));

function evidenceAuthorityMismatch(
  expected: StoredAttemptAuthorityStateV1,
  evidence: StoredAttemptEvidencePortV1,
): StoredAttemptAuthorityMismatchV1Error | undefined {
  if (evidence.deploymentId !== expected.deploymentId) {
    return authorityMismatchError("placementChanged");
  }
  if (evidence.scopeId !== expected.scopeId) {
    return authorityMismatchError("scopeChanged");
  }
  if (evidence.sessionId !== expected.sessionId) {
    return authorityMismatchError("attemptMissing");
  }
  if (evidence.attemptFence !== expected.attemptFence) {
    return authorityMismatchError("attemptReplaced");
  }
  if (
    evidence.session.storageGeneration !== expected.storageGeneration ||
    evidence.session.storageGenerationFence !== expected.storageGenerationFence
  ) {
    return authorityMismatchError("generationChanged");
  }
  if (evidence.session.schemaVersionId !== expected.schemaVersionId) {
    return authorityMismatchError("schemaChanged");
  }
  if (evidence.lease.snapshotToken.scopeId !== expected.snapshotToken.scopeId) {
    return authorityMismatchError("snapshotChanged");
  }
  if (evidence.lease.snapshotToken.epoch !== expected.snapshotToken.epoch) {
    return authorityMismatchError("epochChanged");
  }
  if (
    evidence.lease.snapshotToken.commitSeq !== expected.snapshotToken.commitSeq
  ) {
    return authorityMismatchError("snapshotChanged");
  }
  return undefined;
}

function storedEnvelopeMismatch(
  envelope: StoredForSessionAttemptCommitEnvelopeV1,
  evidence: StoredAttemptEvidencePortV1,
  journalSha256Hex: string,
  successfulResult: Readonly<{
    readonly valueCodecVersion: FlarexValueCodecVersion;
    readonly canonicalValueBase64Url: string;
    readonly sha256Hex: string;
  }>,
): StoredAttemptEnvelopeMismatchV1Error | undefined {
  if (
    envelope.sessionId !== evidence.sessionId ||
    envelope.attemptFence !== evidence.attemptFence
  ) {
    return new StoredAttemptEnvelopeMismatchV1Error({ reason: "attempt" });
  }
  if (envelope.protocolVersion !== evidence.session.protocolVersion) {
    return new StoredAttemptEnvelopeMismatchV1Error({ reason: "protocol" });
  }
  if (
    envelope.finalSyscallSequence !==
      evidence.root.sealedFinalSyscallSequence
  ) {
    return new StoredAttemptEnvelopeMismatchV1Error({ reason: "sequence" });
  }
  if (envelope.journalSha256Hex !== journalSha256Hex) {
    return new StoredAttemptEnvelopeMismatchV1Error({
      reason: "journalDigest",
    });
  }
  if (
    envelope.successfulResult.valueCodecVersion !==
      successfulResult.valueCodecVersion ||
    envelope.successfulResult.canonicalValueBase64Url !==
      successfulResult.canonicalValueBase64Url ||
    envelope.successfulResult.sha256Hex !== successfulResult.sha256Hex
  ) {
    return new StoredAttemptEnvelopeMismatchV1Error({
      reason: "successfulResult",
    });
  }
  return undefined;
}

function journalCounterMismatch(
  evidence: StoredAttemptEvidencePortV1,
  journal: SessionJournalV1,
): StoredAttemptStorageCorruptionV1Error | undefined {
  let writeSemanticBytes = 0;
  for (const write of journal.writes) {
    if (write.kind !== "delete") {
      writeSemanticBytes += write.resultingDocumentSemanticBytes;
    }
  }
  if (
    journal.protocolVersion !== evidence.session.protocolVersion ||
    journal.finalSyscallSequence !==
      evidence.root.sealedFinalSyscallSequence ||
    evidence.root.lastSyscallSequence !==
      evidence.root.sealedFinalSyscallSequence ||
    journal.readUsage.documentsRead !== evidence.root.readDocuments ||
    journal.readUsage.semanticBytesRead !==
      evidence.root.readSemanticBytes ||
    journal.readDependencies.length !==
      evidence.root.pointDependencyCount ||
    journal.writes.length !== evidence.root.writeOperations ||
    writeSemanticBytes !== evidence.root.writeSemanticBytes ||
    evidence.points.length !== evidence.root.pointDependencyCount
  ) {
    return new StoredAttemptStorageCorruptionV1Error({
      reason: "journalCounterMismatch",
    });
  }
  return undefined;
}

export interface AuthenticatedStoredAttemptPointV1 {
  readonly documentId: AppDocumentIdV1;
  readonly tableId: CatalogTableId;
  readonly rowId: AppRowIdHexV1;
  readonly dependency: LogicalReadDependencyV1;
  readonly overlayKind: "none" | "live" | "deleted";
  readonly overlayCreationTime: AppCreationTimeV1 | null;
  readonly overlayValue: CanonicalFlarexRuntimeValueV1 | null;
  readonly overlayBytes: Uint8Array | null;
  readonly overlaySemanticBytes: number | null;
}

const verifyPointCorrelationEffect = Effect.fn(
  "StoredAttemptAuthentication.verifyPointCorrelation",
)(function* (
  rows: ReadonlyArray<StoredAttemptPointEvidencePortV1>,
  journal: SessionJournalV1,
): Effect.fn.Return<
  ReadonlyArray<AuthenticatedStoredAttemptPointV1>,
  StoredAttemptStorageCorruptionV1Error
> {
  const dependencies = new Map<AppDocumentIdV1, LogicalReadDependencyV1>();
  for (const dependency of journal.readDependencies) {
    dependencies.set(dependency.documentId, dependency);
  }
  const points = new Map<
    AppDocumentIdV1,
    AuthenticatedStoredAttemptPointV1
  >();
  for (const row of rows) {
    const point = yield* verifyPointEffect(row);
    if (points.has(point.documentId)) {
      return yield* corruptionEffect("duplicatePointEvidence");
    }
    const dependency = dependencies.get(point.documentId);
    if (
      dependency === undefined ||
      !dependenciesEqual(dependency, point.dependency)
    ) {
      return yield* corruptionEffect("pointDependencyMismatch");
    }
    points.set(point.documentId, point);
  }
  if (points.size !== dependencies.size) {
    return yield* corruptionEffect("pointDependencySetMismatch");
  }

  const writesByDocument = new Map<
    AppDocumentIdV1,
    LogicalAppWriteV1[]
  >();
  for (const write of journal.writes) {
    if (!points.has(write.documentId)) {
      return yield* corruptionEffect("writeWithoutPointEvidence");
    }
    const writes = writesByDocument.get(write.documentId) ?? [];
    writes.push(write);
    writesByDocument.set(write.documentId, writes);
  }
  for (const point of points.values()) {
    yield* verifyPointWriteChainEffect(
      point,
      writesByDocument.get(point.documentId) ?? [],
    );
  }
  return Object.freeze([...points.values()]);
});

const verifyPointEffect = Effect.fn(function* (
  row: StoredAttemptPointEvidencePortV1,
): Effect.fn.Return<
  AuthenticatedStoredAttemptPointV1,
  StoredAttemptStorageCorruptionV1Error
> {
  const identity = yield* Effect.try({
    try: () => {
      const rowId = appRowIdHexV1FromBytes(row.rowId);
      return Object.freeze({
        rowId,
        documentId: appDocumentIdV1FromRowIdentity({
          tableId: row.tableId,
          rowId,
        }),
      });
    },
    catch: mapPointEvidenceFailure,
  });
  const dependency = yield* dependencyFromPointEffect(
    row,
    identity.documentId,
  );
  if (row.overlayKind !== "live") {
    if (
      row.overlayCreationTime !== null ||
      row.overlayValueCodecVersion !== null ||
      row.overlayValueJson !== null ||
      row.overlayValueBytes !== null ||
      row.overlayValueSha256 !== null ||
      row.overlaySemanticBytes !== null
    ) {
      return yield* corruptionEffect("nonLiveOverlayCarriesEvidence");
    }
    return Object.freeze({
      documentId: identity.documentId,
      tableId: row.tableId,
      rowId: identity.rowId,
      dependency,
      overlayKind: row.overlayKind,
      overlayCreationTime: null,
      overlayValue: null,
      overlayBytes: null,
      overlaySemanticBytes: null,
    });
  }
  if (
    row.overlayCreationTime === null ||
    row.overlayValueCodecVersion === null ||
    row.overlayValueJson === null ||
    row.overlayValueBytes === null ||
    row.overlayValueSha256 === null ||
    row.overlaySemanticBytes === null
  ) {
    return yield* corruptionEffect("liveOverlayEvidenceMissing");
  }
  const overlayCreationTime = row.overlayCreationTime;
  const overlayValueCodecVersion = row.overlayValueCodecVersion;
  const overlayValueJson = row.overlayValueJson;
  const overlayValueBytes = row.overlayValueBytes;
  const overlayValueSha256 = row.overlayValueSha256;
  const document = yield* Effect.tryPromise({
    try: () => verifyAppDocumentEvidenceV1({
      tableId: row.tableId,
      rowId: identity.rowId,
      creationTime: overlayCreationTime,
      codecVersion: overlayValueCodecVersion,
      valueJson: overlayValueJson,
      canonicalBytes: overlayValueBytes,
      sha256: overlayValueSha256,
    }),
    catch: mapPointEvidenceFailure,
  });
  if (document.semanticSizeBytes !== row.overlaySemanticBytes) {
    return yield* corruptionEffect("liveOverlaySemanticBytesMismatch");
  }
  return Object.freeze({
    documentId: identity.documentId,
    tableId: row.tableId,
    rowId: identity.rowId,
    dependency,
    overlayKind: "live",
    overlayCreationTime,
    overlayValue: document.value,
    overlayBytes: copyBytes(document.canonicalBytes),
    overlaySemanticBytes: row.overlaySemanticBytes,
  });
});

const dependencyFromPointEffect = Effect.fn(function* (
  row: StoredAttemptPointEvidencePortV1,
  documentId: AppDocumentIdV1,
): Effect.fn.Return<
  LogicalReadDependencyV1,
  StoredAttemptStorageCorruptionV1Error
> {
  switch (row.dependencyKind) {
    case "present":
      if (row.dependencyRevisionCommitSeq === null) {
        return yield* corruptionEffect("presentDependencyRevisionMissing");
      }
      const presentRevisionValue = row.dependencyRevisionCommitSeq;
      const presentRevision = yield* Effect.try({
        try: () => CommitSeqSchema.make(presentRevisionValue),
        catch: mapPointEvidenceFailure,
      });
      return Object.freeze({
        kind: "appRowPoint",
        documentId,
        observed: Object.freeze({
          kind: "present",
          revisionCommitSeq: presentRevision,
        }),
      } satisfies LogicalReadDependencyV1);
    case "missing_no_visible_revision":
      if (row.dependencyRevisionCommitSeq !== null) {
        return yield* corruptionEffect("missingDependencyUnexpectedRevision");
      }
      return Object.freeze({
        kind: "appRowPoint",
        documentId,
        observed: Object.freeze({
          kind: "missing",
          basis: Object.freeze({ kind: "noVisibleRevision" }),
        }),
      } satisfies LogicalReadDependencyV1);
    case "missing_tombstone":
      if (row.dependencyRevisionCommitSeq === null) {
        return yield* corruptionEffect("tombstoneDependencyRevisionMissing");
      }
      const tombstoneRevisionValue = row.dependencyRevisionCommitSeq;
      const tombstoneRevision = yield* Effect.try({
        try: () => CommitSeqSchema.make(tombstoneRevisionValue),
        catch: mapPointEvidenceFailure,
      });
      return Object.freeze({
        kind: "appRowPoint",
        documentId,
        observed: Object.freeze({
          kind: "missing",
          basis: Object.freeze({
            kind: "tombstone",
            revisionCommitSeq: tombstoneRevision,
          }),
        }),
      } satisfies LogicalReadDependencyV1);
  }
});

const verifyPointWriteChainEffect = Effect.fn(function* (
  point: AuthenticatedStoredAttemptPointV1,
  writes: ReadonlyArray<LogicalAppWriteV1>,
): Effect.fn.Return<void, StoredAttemptStorageCorruptionV1Error> {
  if (writes.length === 0) {
    if (point.overlayKind !== "none") {
      return yield* corruptionEffect("readOnlyPointHasOverlay");
    }
    return;
  }
  if (
    point.dependency.observed.kind === "missing" &&
    point.dependency.observed.basis.kind === "tombstone"
  ) {
    return yield* corruptionEffect("tombstoneDependencyHasWrite");
  }
  const insertIndexes = writes
    .map((write, index) => write.kind === "insert" ? index : -1)
    .filter((index) => index >= 0);
  if (
    insertIndexes.length > 1 ||
    (insertIndexes.length === 1 && insertIndexes[0] !== 0) ||
    (point.dependency.observed.kind === "present" &&
      insertIndexes.length !== 0) ||
    (point.dependency.observed.kind === "missing" &&
      insertIndexes.length !== 1)
  ) {
    return yield* corruptionEffect("invalidInsertTransition");
  }
  const deleteIndex = writes.findIndex((write) => write.kind === "delete");
  if (deleteIndex >= 0 && deleteIndex !== writes.length - 1) {
    return yield* corruptionEffect("deleteNotTerminal");
  }
  const last = writes.at(-1);
  if (last === undefined) {
    return yield* corruptionEffect("writeChainEmpty");
  }
  if (last.kind === "delete") {
    if (point.overlayKind !== "deleted") {
      return yield* corruptionEffect("deleteOverlayMismatch");
    }
    return;
  }
  if (
    point.overlayKind !== "live" ||
    point.overlayCreationTime === null ||
    point.overlayValue === null ||
    point.overlayBytes === null ||
    point.overlaySemanticBytes === null ||
    last.resultingDocumentSemanticBytes !== point.overlaySemanticBytes
  ) {
    return yield* corruptionEffect("liveWriteOverlayMismatch");
  }
  const insert = writes[0]?.kind === "insert" ? writes[0] : undefined;
  if (
    insert !== undefined &&
    insert.creationTime !== point.overlayCreationTime
  ) {
    return yield* corruptionEffect("insertCreationTimeMismatch");
  }

  const completeIndex = findLastCompleteWriteIndex(writes);
  if (completeIndex >= 0) {
    const complete = writes[completeIndex];
    if (
      complete === undefined ||
      (complete.kind !== "insert" && complete.kind !== "replace")
    ) {
      return yield* corruptionEffect("completeWriteMissing");
    }
    const normalized = yield* Effect.try({
      try: () => normalizeFlarexValueJsonV1(
        complete.fieldsValueJson,
        "appDocument",
      ).value,
      catch: mapPointEvidenceFailure,
    });
    const fields = yield* copyRuntimeDocumentEffect(normalized);
    for (const write of writes.slice(completeIndex + 1)) {
      if (write.kind !== "patch") {
        return yield* corruptionEffect("unexpectedWriteAfterCompleteValue");
      }
      yield* applyPatchEffect(fields, write.changes);
    }
    const identity = yield* Effect.try({
      try: () => decodeAppDocumentIdentityV1(point.documentId),
      catch: mapPointEvidenceFailure,
    });
    const overlayCreationTime = point.overlayCreationTime;
    const rebuilt = yield* Effect.tryPromise({
      try: () => canonicalizeAppDocumentV1({
        tableId: identity.tableId,
        rowId: identity.rowId,
        creationTime: overlayCreationTime,
        fields,
      }),
      catch: mapPointEvidenceFailure,
    });
    if (!bytesEqual(rebuilt.canonicalBytes, point.overlayBytes)) {
      return yield* corruptionEffect("completeWriteOverlayMismatch");
    }
    return;
  }
  const finalFields = yield* copyRuntimeDocumentEffect(point.overlayValue);
  const lastChanges = lastPatchChangeByField(writes);
  for (const change of lastChanges.values()) {
    if (change.kind === "remove") {
      if (Object.hasOwn(finalFields, change.field)) {
        return yield* corruptionEffect("patchRemoveOverlayMismatch");
      }
      continue;
    }
    const actual = finalFields[change.field];
    if (actual === undefined) {
      return yield* corruptionEffect("patchSetOverlayMissing");
    }
    const valuesMatch = yield* Effect.try({
      try: () => {
        const expected = normalizeFlarexValueJsonV1(change.valueJson).value;
        return canonicalPointEvidenceJson(
          normalizeFlarexValueV1(actual).valueJson,
        ) === canonicalPointEvidenceJson(
          normalizeFlarexValueV1(expected).valueJson,
        );
      },
      catch: mapPointEvidenceFailure,
    });
    if (!valuesMatch) {
      return yield* corruptionEffect("patchSetOverlayMismatch");
    }
  }
});

function findLastCompleteWriteIndex(
  writes: ReadonlyArray<LogicalAppWriteV1>,
): number {
  for (let index = writes.length - 1; index >= 0; index -= 1) {
    const write = writes[index];
    if (write?.kind === "insert" || write?.kind === "replace") return index;
  }
  return -1;
}

function lastPatchChangeByField(
  writes: ReadonlyArray<LogicalAppWriteV1>,
): ReadonlyMap<string, LogicalPatchFieldV1> {
  const changes = new Map<string, LogicalPatchFieldV1>();
  for (const write of writes) {
    if (write.kind !== "patch") continue;
    for (const change of write.changes) changes.set(change.field, change);
  }
  return changes;
}

const applyPatchEffect = Effect.fn(function* (
  fields: Record<string, CanonicalFlarexRuntimeValueV1>,
  changes: ReadonlyArray<LogicalPatchFieldV1>,
): Effect.fn.Return<void, StoredAttemptStorageCorruptionV1Error> {
  for (const change of changes) {
    if (change.kind === "remove") {
      Reflect.deleteProperty(fields, change.field);
    } else {
      const value = yield* Effect.try({
        try: () => normalizeFlarexValueJsonV1(change.valueJson).value,
        catch: mapPointEvidenceFailure,
      });
      Object.defineProperty(fields, change.field, {
        value,
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
  }
});

const copyRuntimeDocumentEffect = Effect.fn(function* (
  value: CanonicalFlarexRuntimeValueV1,
): Effect.fn.Return<
  Record<string, CanonicalFlarexRuntimeValueV1>,
  StoredAttemptStorageCorruptionV1Error
> {
  if (!isCanonicalFlarexRuntimeObjectV1(value)) {
    return yield* corruptionEffect("overlayDocumentNotObject");
  }
  const fields: Record<string, CanonicalFlarexRuntimeValueV1> = {};
  for (const [field, item] of Object.entries(value)) {
    if (field === "_id" || field === "_creationTime") continue;
    Object.defineProperty(fields, field, {
      value: item,
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  return fields;
});

function dependenciesEqual(
  left: LogicalReadDependencyV1,
  right: LogicalReadDependencyV1,
): boolean {
  if (
    left.documentId !== right.documentId ||
    left.observed.kind !== right.observed.kind
  ) {
    return false;
  }
  if (left.observed.kind === "present" && right.observed.kind === "present") {
    return left.observed.revisionCommitSeq ===
      right.observed.revisionCommitSeq;
  }
  if (left.observed.kind === "missing" && right.observed.kind === "missing") {
    if (left.observed.basis.kind !== right.observed.basis.kind) return false;
    return left.observed.basis.kind === "noVisibleRevision" ||
      (right.observed.basis.kind === "tombstone" &&
        left.observed.basis.revisionCommitSeq ===
          right.observed.basis.revisionCommitSeq);
  }
  return false;
}

function captureAuthenticatedState(
  authority: StoredAttemptAuthorityStateV1,
  evidence: StoredAttemptEvidencePortV1,
  journal: SessionJournalV1,
  successfulResult: CanonicalSuccessfulResultV1,
  successfulResultValue: CanonicalFlarexRuntimeValueV1,
  points: ReadonlyArray<AuthenticatedStoredAttemptPointV1>,
): AuthenticatedStoredAttemptStateV1 {
  const root = evidence.root;
  return Object.freeze({
    authority: Object.freeze({
      ...authority,
      snapshotToken: Object.freeze({ ...authority.snapshotToken }),
    }),
    session: structuredClone(evidence.session),
    sealIdentity: Object.freeze({
      scopeUuid: evidence.scopeUuid,
      lifecycle: evidence.session.lifecycle,
      sessionUpdatedAtMilliseconds: evidence.session.updatedAtMilliseconds,
      leaseExpiresAtMilliseconds: evidence.lease.leaseExpiresAtMilliseconds,
      rootCreatedAtMilliseconds: root.createdAtMilliseconds,
      rootUpdatedAtMilliseconds: root.updatedAtMilliseconds,
      sealedAtMilliseconds: root.sealedAtMilliseconds,
      finalSyscallSequence: root.sealedFinalSyscallSequence,
      creationTimeSeed: root.creationTimeSeed,
      nextCreationTime: root.nextCreationTime,
      journalFormat: journal.format,
      journalProtocolVersion: journal.protocolVersion,
      journalValueCodecVersion: journal.valueCodecVersion,
      journalByteLength: root.journalBytes.byteLength,
      journalSha256: copyBytes(root.journalSha256),
      resultValueCodecVersion: root.resultValueCodecVersion,
      resultSemanticBytes: root.resultSemanticBytes,
      resultByteLength: root.resultBytes.byteLength,
      resultSha256: copyBytes(root.resultSha256),
      readDocuments: root.readDocuments,
      readSemanticBytes: root.readSemanticBytes,
      pointDependencyCount: root.pointDependencyCount,
      writeOperations: root.writeOperations,
      writeSemanticBytes: root.writeSemanticBytes,
      materialWriteEventEvidenceBytes:
        root.materialWriteEventEvidenceBytes,
    }),
    journal: structuredClone(journal),
    successfulResult: Object.freeze({
      value: successfulResultValue,
      valueJson: structuredClone(successfulResult.valueJson),
      canonicalBytes: copyBytes(successfulResult.canonicalBytes),
      semanticSizeBytes: successfulResult.semanticSizeBytes,
      sha256Hex: successfulResult.evidence.sha256Hex,
    }),
    points: Object.freeze(points.map(detachAuthenticatedPoint)),
  });
}

function detachAuthenticatedPoint(
  point: AuthenticatedStoredAttemptPointV1,
): AuthenticatedStoredAttemptPointV1 {
  return Object.freeze({
    documentId: point.documentId,
    tableId: point.tableId,
    rowId: point.rowId,
    dependency: Object.freeze(structuredClone(point.dependency)),
    overlayKind: point.overlayKind,
    overlayCreationTime: point.overlayCreationTime,
    overlayValue: point.overlayValue,
    overlayBytes: point.overlayBytes === null
      ? null
      : copyBytes(point.overlayBytes),
    overlaySemanticBytes: point.overlaySemanticBytes,
  });
}

function lookupAuthority(
  states: WeakMap<object, StoredAttemptAuthorityStateV1>,
  authority: TrustedStoredAttemptAuthorityV1,
): StoredAttemptAuthorityStateV1 | undefined {
  return typeof authority === "object" && authority !== null
    ? states.get(authority)
    : undefined;
}

function requireAuthenticatedState(
  states: WeakMap<object, AuthenticatedStoredAttemptStateV1>,
  value: AuthenticatedStoredAttemptV1,
): AuthenticatedStoredAttemptStateV1 {
  const state = typeof value === "object" && value !== null
    ? states.get(value)
    : undefined;
  if (state === undefined) {
    throw new InvalidStoredAttemptAuthorityV1Error({
      reason: "notProcessLocal",
    });
  }
  return state;
}

function serializeAuthenticatedStateForTest(
  state: AuthenticatedStoredAttemptStateV1,
): string {
  return serializePrivateStateForTest(
    state,
    () => corruption("storedEvidenceInvalid"),
  );
}

function serializePrivateStateForTest(
  state: unknown,
  onUndefined: () => Error,
): string {
  const serialized = JSON.stringify(
    state,
    (_key: string, value: unknown): unknown => {
      if (typeof value === "bigint") {
        return Object.freeze({ bigint: value.toString() });
      }
      if (value instanceof Uint8Array) {
        return Object.freeze({ bytes: base64UrlFromBytes(value) });
      }
      return value;
    },
  );
  if (serialized === undefined) {
    throw onUndefined();
  }
  return serialized;
}

function captureAuthorityPort(
  authority: StoredAttemptAuthorityStateV1,
): StoredAttemptEvidenceAuthorityPortV1 {
  return Object.freeze({
    ...authority,
    snapshotToken: Object.freeze({ ...authority.snapshotToken }),
  });
}

function bytesToLowercaseHex(
  bytes: Uint8Array,
  reason: StoredAttemptStorageCorruptionReasonV1,
): string {
  if (!isUint8ArrayWithByteLength(bytes, 32)) {
    throw corruption(reason);
  }
  return encodeBytesToLowercaseHex(bytes);
}

function base64UrlFromBytes(bytes: Uint8Array): string {
  if (!(bytes instanceof Uint8Array)) {
    throw corruption("resultBytesInvalid");
  }
  return Encoding.encodeBase64Url(bytes);
}

function canonicalPointEvidenceJson(value: Json): string {
  return encodeCanonicalJson(value, () => {
    throw corruption("jsonPropertyMissing");
  });
}

function mapSynchronousStorageFailure(
  cause: unknown,
): StoredAttemptStorageCorruptionV1Error {
  if (cause instanceof StoredAttemptStorageCorruptionV1Error) {
    return cause;
  }
  if (Schema.isSchemaError(cause)) {
    return new StoredAttemptStorageCorruptionV1Error({
      reason: "storedEvidenceInvalid",
      cause,
    });
  }
  throw cause;
}

function mapPointEvidenceFailure(
  cause: unknown,
): StoredAttemptStorageCorruptionV1Error {
  if (cause instanceof StoredAttemptStorageCorruptionV1Error) {
    return cause;
  }
  if (
    cause instanceof AppDocumentIdV1Error ||
    cause instanceof AppDocumentSystemFieldV1Error ||
    cause instanceof FlarexValueCodecV1Error ||
    cause instanceof FlarexValueEvidenceV1Error ||
    Schema.isSchemaError(cause)
  ) {
    return new StoredAttemptStorageCorruptionV1Error({
      reason: "pointEvidenceInvalid",
      cause,
    });
  }
  throw cause;
}

function authorityMismatchError(
  reason: StoredAttemptAuthorityMismatchV1Error["reason"],
): StoredAttemptAuthorityMismatchV1Error {
  return new StoredAttemptAuthorityMismatchV1Error({ reason });
}

function corruption(
  reason: StoredAttemptStorageCorruptionReasonV1,
): StoredAttemptStorageCorruptionV1Error {
  return new StoredAttemptStorageCorruptionV1Error({ reason });
}

function corruptionEffect(
  reason: StoredAttemptStorageCorruptionReasonV1,
): Effect.Effect<never, StoredAttemptStorageCorruptionV1Error> {
  return Effect.fail(corruption(reason));
}
