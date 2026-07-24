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
  PointCommitAuthorityPinsV1,
  PointCommitDependencyV1,
  PointCommitFinishingTransitionCommandV1,
  PointCommitFinishingTransitionPortV1,
  PointCommitFinishingTransitionResultV1,
  PointCommitFinishingTransitionV1Error,
  PointCommitPublicationCommandV1,
  PointCommitPublicationResultV1,
  PointCommitPublicationV1Error,
  PointCommitOutcomeResolutionV1Error,
  PointCommitOutcomeResolutionPortV1,
  PointCommitPublisherPortV1,
  PointCommitRollbackProofPortV1,
  PointCommitRollbackProofV1Error,
  PointCommitRowIntentV1,
  PointCommitSealIdentityV1,
  PointCommitSuccessfulResultV1,
  PointCommitTransactionCommandV1,
  PointCommitWouldCommitV1,
  PointMutationAttemptReplacementCommandV1,
  PointMutationAttemptReplacementObservationV1,
  PointMutationAttemptReplacementPortV1,
  PointMutationAttemptReplacementV1Error,
  CommittedPointOutcomeResolutionV1,
} from "@flarex/persistence-postgres/point-commit-transaction";
import {
  PointCommitConfirmedPreDecisionRollbackV1Error,
  PointCommitConflictV1Error,
  PointCommitCorruptionV1Error,
  PointCommitDecisionUncertainV1Error,
  RESOLVE_POINT_COMMIT_OUTCOME_V1,
} from "@flarex/persistence-postgres/point-commit-transaction";
import type {
  StoredOccExecutionEvidenceAuthorityV1,
  StoredOccExecutionEvidenceV1,
  StoredOccExecutionEvidenceLoaderV1,
  StoredOccExecutionEvidenceLoadResultV1,
  StoredOccExecutionEvidencePersistenceV1Error,
} from "@flarex/persistence-postgres/stored-occ-execution";
import {
  PointMutationExecutionClaimAcquisitionInputV1Error,
  PointMutationExecutionClaimAcquisitionStaleV1Error,
  type PointMutationExecutionClaimAcquisitionV1Error,
  type PointMutationSessionAttemptSelectorV1,
} from
  "@flarex/persistence-postgres/transaction-session-activation";
import type { TransactionExecutionClaimPinV1 } from "@flarex/persistence-postgres/transaction-execution-claim";
import type { PointMutationExecutionClaimLivenessV1 } from
  "@flarex/persistence-postgres/transaction-execution-claim-liveness";

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
  jsonEqual,
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
  projectScopeIdUuidV1,
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
  storedTransactionSessionScalarsEqualV1,
  type TransactionAttemptFence,
  type TransactionSessionIdV1,
  type TransactionSessionLifecycleV1,
} from "flarex-protocol/transaction-session";
import {
  FLAREX_VALUE_CODEC_VERSION_V1,
  canonicalizeFlarexValueJsonV1,
  decodeFlarexValueCodecVersion,
  isCanonicalFlarexRuntimeObjectV1,
  flarexValueToJsonV1,
  normalizeFlarexValueJsonV1,
  normalizeFlarexValueV1,
  type CanonicalFlarexRuntimeValueV1,
  FlarexValueCodecV1Error,
  FlarexValueEvidenceV1Error,
  type FlarexValueCodecVersion,
} from "flarex-protocol/value";

import {
  PointMutationSessionAttemptTerminalizationContractV1Error,
  type PointMutationSessionAttemptLoadingExecutionV1Error,
  type PointMutationSessionAttemptLoadingV1,
  type PointMutationSessionAttemptTerminalizationExecutionV1Error,
  type PointMutationSessionAttemptTerminalizationV1,
  type LoadedPointMutationSessionAttemptV1,
} from "./pointMutationSessionActivation";
import type {
  PointMutationSessionAttemptDispositionExecutionV1Error,
  PointMutationSessionAttemptDispositionV1,
} from "./pointMutationSessionAttemptDisposition";
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
  InvalidPointMutationExecutionClaimV1Error,
  type PointMutationAbortOnlyClaimStateV1,
  type PointMutationAbortOnlyScopeV1,
  type PointMutationExecutionClaimV1,
  type PointMutationExecutionWorkClaimStateV1,
  type PointMutationExecutionScopeV1,
  type PointMutationExecutionClaimVaultV1,
} from "./pointMutationExecutionClaim";
import {
  createPointMutationExecutionLivenessCoordinatorV1,
  type PointMutationExecutionLivenessControlV1,
  type PointMutationExecutionLivenessV1Error,
} from "./pointMutationExecutionClaimLiveness";
import type {
  PointMutationExecutionClaimDispatchAcquisitionV1,
  PointMutationExecutionClaimDispatchAcquisitionResultV1,
} from "./pointMutationExecutionClaimAcquisition";
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
  type StoredPointMutationCapabilityStageV1,
} from "./storedAttemptAuthentication/capabilityRuntimeConstruction";
import {
  makeStoredPointMutationCapabilityVaultV1,
  type AuthorizedPointMutationOccRerunStateV1,
  type CapturedPointMutationOccConflictV1,
  type PointCommitDecisionUncertainTicketStateV1,
  type PointCommitScalarProvenanceV1,
  type PointMutationOccConflictTicketStateV1,
  type PreparedPointCommitCapabilityStateV1,
  type VerifiedCommitCapabilityStateV1,
} from "./storedAttemptAuthentication/capabilityState";
import {
  InvalidStoredAttemptAuthorityV1Error,
  StoredAttemptAlreadyCommittedV1Error,
  StoredAttemptAuthorityMismatchV1Error,
  StoredAttemptEnvelopeMismatchV1Error,
  StoredAttemptNotPlannableV1Error,
  StoredAttemptPersistenceV1Error,
  StoredAttemptStorageCorruptionV1Error,
  makeStoredAttemptAuthenticationOperationsV1,
  requireLoadedStoredAttemptEvidenceEffect,
  type AuthenticatedStoredAttemptV1,
  type StoredAttemptAuthenticationV1Error,
  type TrustedStoredAttemptAuthorityV1,
} from "./storedAttemptAuthentication/authenticationOperations";
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
  InvalidStoredAttemptAuthorityV1Error,
  StoredAttemptAlreadyCommittedV1Error,
  StoredAttemptAuthorityMismatchV1Error,
  StoredAttemptEnvelopeMismatchV1Error,
  StoredAttemptNotPlannableV1Error,
  StoredAttemptPersistenceV1Error,
  StoredAttemptStorageCorruptionV1Error,
} from "./storedAttemptAuthentication/authenticationOperations";

export type {
  AuthenticatedStoredAttemptV1,
  StoredAttemptAuthenticationV1Error,
  TrustedStoredAttemptAuthorityV1,
} from "./storedAttemptAuthentication/authenticationOperations";

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
  UnsupportedPointCommitPlanV1Error,
} from "./storedAttemptAuthentication/pointCommitPlanning";

export type {
  PointCommitPlannerInvariantV1DefectReason,
} from "./storedAttemptAuthentication/pointCommitPlanning";

const PROCESS_LOCAL_CAPABILITY: true = true;
const POINT_COMMIT_SQL_RETRY_MAXIMUM_ATTEMPTS_V1 = 3;
const POINT_COMMIT_SQL_RETRY_INITIAL_BACKOFF_MILLISECONDS_V1 = 10;
const encodeCommitEnvelopeV1 = Schema.encodeSync(CommitEnvelopeV1Schema);
const decodeTransactionArtifactRuntimeV1 = Schema.decodeUnknownSync(
  TransactionArtifactRuntimeV1Schema,
);
const decodeFlarexDbV1StorageGeneration = Schema.decodeUnknownSync(
  FlarexDbV1StorageGenerationSchema,
);

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

export class PointCommitKnownSettledSqlRetryExhaustedV1Error
  extends Data.TaggedError(
    "PointCommitKnownSettledSqlRetryExhaustedV1Error",
  )<{
    readonly attempts: 3;
    readonly maximumAttempts: 3;
    readonly failures: readonly [
      PointCommitKnownSettledSqlRetryFailureV1,
      PointCommitKnownSettledSqlRetryFailureV1,
      PointCommitKnownSettledSqlRetryFailureV1,
    ];
  }> {}

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

/** Private O08-D terminal evidence. It carries no command or rerun authority. */
export class PointCommitUncertainOutcomeUnresolvedV1Error
  extends Data.TaggedError(
    "PointCommitUncertainOutcomeUnresolvedV1Error",
  )<{
    readonly stage:
      | "postSettlementOutcomeLookup"
      | "alreadyCommittedOutcomeLookup"
      | "guardedPublication";
    readonly primary: PointCommitDecisionUncertainV1Error;
    readonly secondary: PointCommitUncertainOutcomeSecondaryV1;
  }> {}

export class PointCommitUncertainOutcomeRecoveryCorruptionV1Error
  extends Data.TaggedError(
    "PointCommitUncertainOutcomeRecoveryCorruptionV1Error",
  )<{
    readonly reason: "reconstructedCommandMismatch";
  }> {}

export interface PointCommitKnownSettledSqlRetryFailureV1 {
  readonly operation:
    PointCommitConfirmedPreDecisionRollbackV1Error["operation"];
  readonly sqlState:
    PointCommitConfirmedPreDecisionRollbackV1Error["sqlState"];
  readonly cause: unknown;
}

type PointCommitKnownSettledSqlRetryStateV1 =
  | Readonly<{
      readonly attempt: 1;
      readonly failures: readonly [];
    }>
  | Readonly<{
      readonly attempt: 2;
      readonly failures: readonly [
        PointCommitKnownSettledSqlRetryFailureV1,
      ];
    }>
  | Readonly<{
      readonly attempt: 3;
      readonly failures: readonly [
        PointCommitKnownSettledSqlRetryFailureV1,
        PointCommitKnownSettledSqlRetryFailureV1,
      ];
    }>;

function capturePointCommitKnownSettledSqlRetryFailureV1(
  failure: PointCommitConfirmedPreDecisionRollbackV1Error,
): PointCommitKnownSettledSqlRetryFailureV1 {
  return Object.freeze({
    operation: failure.operation,
    sqlState: failure.sqlState,
    cause: failure.cause,
  });
}

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
  readonly reason:
    | Extract<
        StoredOccExecutionEvidenceLoadResultV1,
        { readonly kind: "authorityMismatch" }
      >["reason"]
    | PointMutationOccRerunFreshAttemptMismatchV1;
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
    | "loadedAttemptStateUnavailable"
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
    | "executionClaimUnavailable"
    | "notSameFactory";
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
  readonly verifiedGrant: VerifiedTransactionGrantInspectionV1;
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

type PointMutationAuthenticatedAttemptExecutionV1Error =
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
  | PointCommitRecoveredPublicationExecutionV1Error
  | PointCommitOutcomeResolutionV1Error
  | PointMutationExecutionLivenessV1Error;

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

type PointMutationRedispatchAcquisitionOrClosedV1 =
  | Readonly<{
      readonly kind: "acquisition";
      readonly acquisition: PointMutationExecutionClaimDispatchAcquisitionResultV1;
    }>
  | Readonly<{
      readonly kind: "closed";
      readonly result: Extract<
        PointMutationCrashRedispatchResultV1,
        Readonly<{ readonly kind: "closed"; readonly reason: "authorityExpired" }>
      >;
    }>;

export interface StoredPointMutationCrashRedispatchV1
  extends StoredPointMutationOccRerunExecutionV1 {
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
    captureAuthorityPort,
    verifyCanonicalStoredEvidence: verifyCanonicalStoredEvidenceEffect,
    compareCallerEnvelopeWithVerifiedState,
    serializeAuthenticatedStateForTest,
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
  if (stage === "planning") return planning;
  const pointCommitCandidate: unknown =
    "pointCommit" in commitAuthority ? commitAuthority.pointCommit : undefined;
  const pointCommit:
    | PointCommitRollbackProofPortV1
    | PointCommitPublisherPortV1
    | undefined = isPointCommitPublisherPortV1(pointCommitCandidate)
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

  const rollbackProof = Object.freeze({
    ...planning,
    provePointCommitRollback,
  } satisfies StoredPointCommitRollbackProofV1);
  if (stage === "rollbackProof") return rollbackProof;
  if (!isPointCommitPublisherPortV1(pointCommit)) {
    throw new StoredPointMutationCapabilityConfigurationV1Defect({
      stage,
      missing: "pointCommitPublisher",
    });
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
    ...rollbackProof,
    publishPointCommit,
  } satisfies StoredPointCommitPublisherV1);
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
      const executionClaim = state.provenance.executionClaim;
      if (executionClaims === undefined || executionClaim === null) {
        return yield* Effect.fail(new InvalidPreparedPointCommitV1Error({
          reason: "executionClaimUnavailable",
        }));
      }
      yield* Effect.fromResult(
        executionClaims.admission.inspectStoredAttempt(executionClaim).pipe(
          Result.mapError(() => new InvalidPreparedPointCommitV1Error({
            reason: "executionClaimUnavailable",
          })),
        ),
      );
      const result = yield* Effect.uninterruptible(
        pointCommitFinishing.enterFinishing(
          capturePointCommitFinishingTransitionCommand(state),
        ).pipe(
          Effect.tap(() => Effect.fromResult(
            executionClaims.admission.consumeStoredAttempt(executionClaim).pipe(
              Result.mapError(() => new PointCommitCorruptionV1Error({
                reason: "finishingTransitionInvalid",
              })),
            ),
          )),
        ),
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

  type PublishKnownSettledPointCommitV1 = (
    command: PointCommitPublicationCommandV1,
    state: PointCommitKnownSettledSqlRetryStateV1,
  ) => Effect.Effect<
    PointCommitPublicationResultV1,
    PointCommitKnownSettledSqlPublicationV1Error,
    never
  >;

  const publishKnownSettledPointCommit: PublishKnownSettledPointCommitV1 =
    Effect.fn(
      "StoredAttemptAuthentication.publishKnownSettledPointCommit",
    )(function (command, state) {
      return pointCommit.publish(command).pipe(
        Effect.catchTag(
          "PointCommitConfirmedPreDecisionRollbackV1Error",
          (failure) => {
            if (
              !(failure instanceof
                PointCommitConfirmedPreDecisionRollbackV1Error)
            ) {
              return Effect.die(failure);
            }
            const capturedFailure =
              capturePointCommitKnownSettledSqlRetryFailureV1(failure);
            if (state.attempt === POINT_COMMIT_SQL_RETRY_MAXIMUM_ATTEMPTS_V1) {
              const failures: readonly [
                PointCommitKnownSettledSqlRetryFailureV1,
                PointCommitKnownSettledSqlRetryFailureV1,
                PointCommitKnownSettledSqlRetryFailureV1,
              ] = Object.freeze([
                state.failures[0],
                state.failures[1],
                capturedFailure,
              ]);
              return Effect.fail(
                new PointCommitKnownSettledSqlRetryExhaustedV1Error({
                  attempts: POINT_COMMIT_SQL_RETRY_MAXIMUM_ATTEMPTS_V1,
                  maximumAttempts:
                    POINT_COMMIT_SQL_RETRY_MAXIMUM_ATTEMPTS_V1,
                  failures,
                }),
              );
            }
            let nextState: PointCommitKnownSettledSqlRetryStateV1;
            if (state.attempt === 1) {
              const failures: readonly [
                PointCommitKnownSettledSqlRetryFailureV1,
              ] = [capturedFailure];
              nextState = Object.freeze({
                attempt: 2,
                failures: Object.freeze(failures),
              });
            } else {
              const failures: readonly [
                PointCommitKnownSettledSqlRetryFailureV1,
                PointCommitKnownSettledSqlRetryFailureV1,
              ] = [state.failures[0], capturedFailure];
              nextState = Object.freeze({
                attempt: 3,
                failures: Object.freeze(failures),
              });
            }
            const backoffUpperBoundMilliseconds =
              POINT_COMMIT_SQL_RETRY_INITIAL_BACKOFF_MILLISECONDS_V1 *
              2 ** (state.attempt - 1);
            return Effect.gen(function* () {
              const random = yield* Random.next;
              yield* Effect.sleep(
                Duration.millis(random * backoffUpperBoundMilliseconds),
              );
              return yield* publishKnownSettledPointCommit(command, nextState);
            });
          },
        ),
      );
    });

  const lookupFinishingPreparedPointCommit = (
    input: unknown,
  ): Result.Result<
    Readonly<{
      readonly finishing: FinishingPreparedPointCommitV1;
      readonly prepared: PreparedPointCommitCapabilityStateV1;
    }>,
    InvalidPreparedPointCommitV1Error
  > => {
    if (typeof input !== "object" || input === null) {
      return Result.fail(new InvalidPreparedPointCommitV1Error({
        reason: "notSameFactory",
      }));
    }
    const prepared = preparedPointCommitStates.get(input);
    if (prepared === undefined) {
      return Result.fail(new InvalidPreparedPointCommitV1Error({
        reason: "notSameFactory",
      }));
    }
    if (!finishingPreparedPointCommitStates.has(input)) {
      return Result.fail(new InvalidPreparedPointCommitV1Error({
        reason: "notFinishing",
      }));
    }
    return Result.succeed(Object.freeze({
      finishing: input as FinishingPreparedPointCommitV1,
      prepared,
    }));
  };

  const captureAndClaimDecisionUncertainTicket = (
    error: PointCommitDecisionUncertainV1Error,
    finishing: FinishingPreparedPointCommitV1,
    prepared: PreparedPointCommitCapabilityStateV1,
    command: PointCommitPublicationCommandV1,
  ): PointCommitDecisionUncertainTicketStateV1 => {
    if (
      capturedDecisionUncertainties.has(error) ||
      consumedDecisionUncertainties.has(error)
    ) {
      throw new Error(
        "A point-commit decision-uncertainty ticket was already consumed.",
      );
    }
    const ticket = Object.freeze({
      finishing,
      prepared,
      selector: capturePointMutationSessionAttemptSelector(prepared),
      command,
    });
    capturedDecisionUncertainties.add(error);
    decisionUncertainTickets.set(error, ticket);
    const claimed = decisionUncertainTickets.get(error);
    decisionUncertainTickets.delete(error);
    consumedDecisionUncertainties.add(error);
    if (claimed === undefined) {
      throw new Error(
        "A point-commit decision-uncertainty ticket could not be claimed.",
      );
    }
    return claimed;
  };

  type PublishCapturedFinishingPointCommitV1 = (
    finishing: FinishingPreparedPointCommitV1,
    prepared: PreparedPointCommitCapabilityStateV1,
    command: PointCommitPublicationCommandV1,
  ) => Effect.Effect<
    PointCommitPublicationResultV1,
    PointCommitKnownSettledSqlPublicationV1Error,
    never
  >;

  const publishCapturedFinishingPointCommit:
    PublishCapturedFinishingPointCommitV1 = Effect.fn(
      "StoredAttemptAuthentication.publishCapturedFinishingPointCommit",
    )(function* (finishing, prepared, command) {
      const failures: readonly [] = [];
      return yield* publishKnownSettledPointCommit(
        command,
        Object.freeze({
          attempt: 1,
          failures: Object.freeze(failures),
        }),
      ).pipe(
        Effect.tapErrorTag(
          "PointCommitConflictV1Error",
          (error) => Effect.sync(() => {
            if (error instanceof PointCommitConflictV1Error) {
              captureOccConflictTicket(finishing, prepared, error);
            }
          }),
        ),
      );
    });

  const publishFinishingPointCommitOnce:
    StoredPointCommitFinishingTransitionV1["publishPointCommit"] = Effect.fn(
      "StoredAttemptAuthentication.publishFinishingPointCommitOnce",
    )(function* (input) {
      const captured = yield* Effect.fromResult(
        lookupFinishingPreparedPointCommit(input),
      );
      return yield* publishCapturedFinishingPointCommit(
        captured.finishing,
        captured.prepared,
        capturePointCommitPublicationCommand(captured.prepared),
      );
    });

  const finishingTransition = Object.freeze({
    ...publisher,
    enterPointCommitFinishing,
    publishPointCommit: publishFinishingPointCommitOnce,
  } satisfies StoredPointCommitFinishingTransitionV1);
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

  const resolvePointCommitOutcomeFromStoredSession = Effect.fn(
    "StoredAttemptAuthentication.resolvePointCommitOutcomeFromStoredSession",
  )(function* (
    deploymentId: TransactionGrantDeploymentIdV1,
    scopeUuid: ScopeUuidV1,
    session: Pick<
      StoredCommitAuthoritySessionEvidencePortV1,
      | "requestKey"
      | "identityAccessPolicySha256"
      | "functionPath"
      | "requestSha256"
    >,
  ) {
    return yield* pointCommitOutcomeResolution[
      RESOLVE_POINT_COMMIT_OUTCOME_V1
    ](
      deploymentId,
      Object.freeze({
        scopeUuid,
        requestKey: TransactionRequestKeyV1Schema.make(session.requestKey),
        expectedIdentityAccessPolicySha256:
          TransactionIdentityAccessPolicySha256V1Schema.make(
            copyBytes(session.identityAccessPolicySha256),
          ),
        expectedFunctionPath: TransactionFunctionPathV1Schema.make(
          session.functionPath,
        ),
        expectedRequestSha256: TransactionRequestSha256V1Schema.make(
          copyBytes(session.requestSha256),
        ),
      }),
    );
  });

  const resolvePointCommitOutcomeObservation = Effect.fn(
    "StoredAttemptAuthentication.resolvePointCommitOutcomeObservation",
  )(function* (prepared: PreparedPointCommitCapabilityStateV1) {
    const pins = prepared.plan.authorityPins;
    return yield* resolvePointCommitOutcomeFromStoredSession(
      pins.deploymentId,
      prepared.plan.sealIdentity.scopeUuid,
      prepared.provenance.session,
    );
  });

  const resolvePointCommitOutcomeForRecovery = Effect.fn(
    "StoredAttemptAuthentication.resolvePointCommitOutcomeForRecovery",
  )(function* (prepared: PreparedPointCommitCapabilityStateV1) {
    const outcome = yield* resolvePointCommitOutcomeObservation(prepared);
    if (!isCommittedPointOutcomeResolutionV1(outcome)) {
      return yield* Effect.fail(new PointCommitCorruptionV1Error({
        reason: "publishedOutcomeInvalid",
      }));
    }
    return outcome;
  });

  const reconstructPointCommitFinishingFromSelector = Effect.fn(
    "StoredAttemptAuthentication.reconstructPointCommitFinishingFromSelector",
  )(function* (selector: PointMutationSessionAttemptSelectorV1) {
      const loadResult = yield* finishingEvidenceLoader.loadFinishingEffect(
        selector,
      ).pipe(Effect.mapError((error) =>
        new StoredAttemptPersistenceV1Error({ cause: error.cause })
      ));
      const evidence = yield*
        requireLoadedStoredAttemptEvidenceEffect(loadResult);
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

  const reconstructPointCommitFinishing:
    StoredPointCommitExecutorV1["reconstructPointCommitFinishing"] = Effect.fn(
      "StoredAttemptAuthentication.reconstructPointCommitFinishing",
    )(function* (input) {
      const selector = yield* Effect.fromResult(
        decodePointMutationSessionAttemptSelectorV1Result(input),
      );
      return yield* reconstructPointCommitFinishingFromSelector(selector);
    });

  const unresolvedFromOutcomeLookup = (
    primary: PointCommitDecisionUncertainV1Error,
    stage:
      | "postSettlementOutcomeLookup"
      | "alreadyCommittedOutcomeLookup",
    error: PointCommitOutcomeLookupSqlFailureV1,
  ): PointCommitUncertainOutcomeUnresolvedV1Error =>
    new PointCommitUncertainOutcomeUnresolvedV1Error({
      stage,
      primary,
      secondary: Object.freeze({
        kind: "outcomeLookupFailed",
        error,
      }),
    });

  const resolveAlreadyCommittedUncertainOutcome = Effect.fn(
    "StoredAttemptAuthentication.resolveAlreadyCommittedUncertainOutcome",
  )(function* (
    primary: PointCommitDecisionUncertainV1Error,
    ticket: PointCommitDecisionUncertainTicketStateV1,
  ) {
    const outcome = yield* resolvePointCommitOutcomeForRecovery(
      ticket.prepared,
    ).pipe(
      Effect.catchTags({
        PointCommitSqlErrorV1: (error) => Effect.fail(
          unresolvedFromOutcomeLookup(
            primary,
            "alreadyCommittedOutcomeLookup",
            error,
          ),
        ),
        CommittedPointOutcomeSqlErrorV1: (error) => Effect.fail(
          unresolvedFromOutcomeLookup(
            primary,
            "alreadyCommittedOutcomeLookup",
            error,
          ),
        ),
      }),
    );
    if (outcome.kind === "missing") {
      return yield* Effect.fail(new PointCommitCorruptionV1Error({
        reason: "committedOutcomeMissing",
      }));
    }
    return publicationResultFromCommittedOutcome(outcome);
  });

  const recoverPointCommitDecisionUncertain = Effect.fn(
    "StoredAttemptAuthentication.recoverPointCommitDecisionUncertain",
  )(function* (
    primary: PointCommitDecisionUncertainV1Error,
    ticket: PointCommitDecisionUncertainTicketStateV1,
  ) {
    if (primary.outcomeCheck.kind === "lookupFailed") {
      return yield* Effect.fail(unresolvedFromOutcomeLookup(
        primary,
        "postSettlementOutcomeLookup",
        primary.outcomeCheck.error,
      ));
    }

    const reconstructed = yield* reconstructPointCommitFinishingFromSelector(
      ticket.selector,
    ).pipe(
      Effect.catchTag(
        "StoredAttemptAlreadyCommittedV1Error",
        () => resolveAlreadyCommittedUncertainOutcome(primary, ticket),
      ),
    );
    if (isPointCommitPublicationResultV1(reconstructed)) return reconstructed;

    const recoveredPrepared = preparedPointCommitStates.get(reconstructed);
    if (recoveredPrepared === undefined) {
      return yield* Effect.die(new Error(
        "Recovered finishing capability lost its factory-local state.",
      ));
    }
    const recoveredCommand = capturePointCommitPublicationCommand(
      recoveredPrepared,
    );
    if (!pointCommitPublicationCommandsEqual(
      ticket.command,
      recoveredCommand,
    )) {
      return yield* Effect.fail(
        new PointCommitUncertainOutcomeRecoveryCorruptionV1Error({
          reason: "reconstructedCommandMismatch",
        }),
      );
    }

    return yield* publishCapturedFinishingPointCommit(
      reconstructed,
      recoveredPrepared,
      ticket.command,
    ).pipe(
      Effect.catchTag(
        "PointCommitDecisionUncertainV1Error",
        (secondary) => {
          if (!(secondary instanceof PointCommitDecisionUncertainV1Error)) {
            return Effect.die(secondary);
          }
          captureAndClaimDecisionUncertainTicket(
            secondary,
            reconstructed,
            recoveredPrepared,
            ticket.command,
          );
          return Effect.fail(
            new PointCommitUncertainOutcomeUnresolvedV1Error({
              stage: "guardedPublication",
              primary,
              secondary: Object.freeze({
                kind: "secondDecisionUncertain",
                error: secondary,
              }),
            }),
          );
        },
      ),
    );
  });

  const publishFinishingPointCommit:
    StoredPointCommitExecutorV1["publishPointCommit"] = Effect.fn(
      "StoredAttemptAuthentication.publishFinishingPointCommit",
    )(function* (input) {
      const captured = yield* Effect.fromResult(
        lookupFinishingPreparedPointCommit(input),
      );
      const command = capturePointCommitPublicationCommand(
        captured.prepared,
      );
      return yield* publishCapturedFinishingPointCommit(
        captured.finishing,
        captured.prepared,
        command,
      ).pipe(
        Effect.catchTag(
          "PointCommitDecisionUncertainV1Error",
          (primary) => {
            if (!(primary instanceof PointCommitDecisionUncertainV1Error)) {
              return Effect.die(primary);
            }
            const ticket = captureAndClaimDecisionUncertainTicket(
              primary,
              captured.finishing,
              captured.prepared,
              command,
            );
            return recoverPointCommitDecisionUncertain(primary, ticket);
          },
        ),
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
    publishPointCommit: publishFinishingPointCommit,
    reconstructPointCommitFinishing,
    finishPointCommit,
    resumePointCommit,
  } satisfies StoredPointCommitExecutorV1);
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

  const resolvePointMutationOccOutcome = Effect.fn(
    "StoredAttemptAuthentication.resolvePointMutationOccOutcome",
  )(function* (prepared: PreparedPointCommitCapabilityStateV1) {
    const outcome = yield* resolvePointCommitOutcomeObservation(prepared);
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
        if (executionClaims === undefined) {
          return yield* Effect.fail(
            new PointMutationOccRerunAuthorityCorruptionV1Error({
              reason: "replacementObservationInvalid",
            }),
          );
        }
        const executionClaim = executionClaims.issuer.mint({
          selector: Object.freeze({
            deploymentId: pins.deploymentId,
            scopeId: pins.scopeId,
            sessionId: pins.sessionId,
            attemptFence,
          }),
          observation: replacementObservation.executionClaim,
          mode: "execute",
        });

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
            executionClaim,
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

  const claimAuthorizedPointMutationOccRerunForExecution = (
    input: unknown,
  ): Result.Result<
    Readonly<{
      readonly state: AuthorizedPointMutationOccRerunStateV1;
      readonly executionScope: PointMutationExecutionScopeV1;
    }>,
    | InvalidAuthorizedPointMutationOccRerunV1Error
    | InvalidPointMutationExecutionClaimV1Error
  > =>
    Result.gen(function* () {
      const state = yield* claimAuthorizedPointMutationOccRerun(input);
      const executionScope = yield* executionClaims.admission.admit(
        state.executionClaim,
        "execute",
      );
      return Object.freeze({ state, executionScope });
    });

  const executeExactPointMutationAttemptKernel = Effect.fn(
    "StoredAttemptAuthentication.executeExactPointMutationAttemptKernel",
  )(function* <InspectionUnavailableError, CurrentValidationError>(input: Readonly<{
    readonly selector: PointMutationSessionAttemptSelectorV1;
    readonly attemptFence: TransactionAttemptFence;
    readonly snapshotToken: SnapshotToken;
    readonly executionScope: PointMutationExecutionScopeV1;
    readonly liveness: PointMutationExecutionLivenessControlV1;
    readonly executionEvidence: StoredOccExecutionEvidenceV1;
    readonly verificationState: CommitAuthorityVerificationStateV1;
    readonly verifiedEvidence: VerifiedCommitAuthorityEvidenceV1;
    readonly expectedRequestSha256?: Uint8Array;
    readonly currentInspectionUnavailable: () => InspectionUnavailableError;
    readonly validateCurrent: (
      current: LoadedPointMutationSessionAttemptOccRerunInspectionV1,
    ) => Effect.Effect<void, CurrentValidationError>;
  }>) {
    if (input.executionEvidence.session.artifactRuntime !== "dynamic-worker") {
      return yield* Effect.fail(
        new PointMutationOccExecutionAuthorityCorruptionV1Error({
          reason: "runtimePinInvalid",
        }),
      );
    }
    const canonicalRequest = yield* Effect.promise(() =>
      canonicalizePointMutationRequestV1({
        deploymentId: input.verificationState.authority.deploymentId,
        functionPath: TransactionFunctionPathV1Schema.make(
          input.verificationState.session.functionPath,
        ),
        validatedArgsSha256: TransactionArgumentsSha256V1Schema.make(
          copyBytes(input.verificationState.session.validatedArgsSha256),
        ),
        requestKey: TransactionRequestKeyV1Schema.make(
          input.verificationState.session.requestKey,
        ),
      })
    );
    if (
      !bytesEqual(
        canonicalRequest.sha256,
        input.verificationState.session.requestSha256,
      ) ||
      (input.expectedRequestSha256 !== undefined &&
        !bytesEqual(canonicalRequest.sha256, input.expectedRequestSha256))
    ) {
      return yield* Effect.fail(
        new PointMutationOccExecutionAuthorityCorruptionV1Error({
          reason: "requestEvidenceInvalid",
        }),
      );
    }
    const metadataUnknown = yield* commitAuthority.functionMetadata.load(
      capturePinnedFunctionSelector(input.verificationState),
    );
    const functionMetadata = yield* verifyPinnedFunctionMetadataEffect(
      input.verificationState,
      metadataUnknown,
    );
    const runnerEvidence = capturePointMutationOccRunnerEvidence(
      input.verifiedEvidence,
      functionMetadata,
    );
    // Runtime-local entropy may be fresh. Persisted creation time remains the
    // exact attempt seed authenticated above.
    const entropy = yield* pointMutationOccContextFactoryPort.make();

    // The RR capture is closed. This is the last liveness/claim reload before
    // the journal admission and user-code boundary.
    const currentAttempt = yield* pointMutationOccAttemptLoading.load({
      deploymentId: input.selector.deploymentId,
      scopeId: input.selector.scopeId,
      sessionId: input.selector.sessionId,
      attemptFence: input.selector.attemptFence.toString(),
    });
    const currentInspection =
      getLoadedPointMutationSessionAttemptOccRerunInspectionV1(currentAttempt);
    if (currentInspection === undefined) {
      return yield* Effect.fail(input.currentInspectionUnavailable());
    }
    yield* input.validateCurrent(currentInspection);

    const prepareRunningPlan = Effect.gen(function* () {
      const context = yield* Effect.fromResult(
        capturePointMutationOccExecutionContext(
          entropy,
          input.executionEvidence.creationTimeSeed,
          input.attemptFence,
          input.snapshotToken,
        ),
      );
      const journalAttempt = yield* pointMutationOccJournalPort.openAttempt(
        currentAttempt,
        input.executionScope,
      );
      const successfulResult = yield* pointMutationOccRunnerPort.run(
        capturePointMutationOccRunnerInput(
          runnerEvidence,
          context,
          bindPointMutationOccJournal(
            pointMutationOccJournalPort,
            journalAttempt,
          ),
        ),
      );
      const envelope = yield* pointMutationOccJournalPort.sealSuccessfulResult(
        journalAttempt,
        successfulResult === undefined ? null : successfulResult,
      );
      const encodedEnvelope = yield* Effect.sync(() =>
        encodeCommitEnvelopeV1(envelope)
      );
      const storedAuthority = yield* deriveAuthority(
        currentAttempt,
        input.executionScope,
      );
      const storedAttempt = yield* authenticate(
        storedAuthority,
        encodedEnvelope,
      );
      const authenticatedAuthority = yield* authenticateCommitAuthority(
        storedAttempt,
      );
      const verifiedInput = yield* verifyCommitInput(authenticatedAuthority);
      return yield* planPointCommit(verifiedInput);
    });
    const runningPlan = yield* abortOnPreFinishingFailure(
      prepareRunningPlan,
      currentAttempt,
      input.executionScope,
      pointMutationOccTerminalizationPort,
    );

    const finishingPlan = yield* input.liveness.enterFinishing(
      enterPointCommitFinishing(runningPlan),
    );
    return yield* publishFinishingPointCommit(finishingPlan).pipe(
      Effect.map((result) => Object.freeze({
        kind: "completed" as const,
        result,
      })),
      Effect.catchTag("PointCommitConflictV1Error", (error) =>
        Effect.succeed(Object.freeze({
          kind: "conflict" as const,
          error,
        }))),
    );
  });

  const executeAuthorizedPointMutationOccRerun: StoredPointMutationOccRerunExecutionV1["executeAuthorizedPointMutationOccRerun"] =
    Effect.fn(
      "StoredAttemptAuthentication.executeAuthorizedPointMutationOccRerun",
    )(function* (input) {
      // The process-local B1 capability is irreversibly claimed before the
      // first asynchronous yield. Durable running/pristine state alone never
      // enters this operation.
      let claimedRerun = yield* Effect.fromResult(
        claimAuthorizedPointMutationOccRerunForExecution(
          input,
        ),
      );
      let rerunState = claimedRerun.state;
      let executionScope = claimedRerun.executionScope;

      while (true) {
        const initialOutcome = yield* resolvePointMutationOccOutcome(
          rerunState.prepared,
        );
        if (initialOutcome.kind !== "missing") {
          return publicationResultFromCommittedOutcome(initialOutcome);
        }

        const publication = yield* pointMutationExecutionLiveness.run(
          executionScope,
          "execute",
          (liveness) => Effect.gen(function* () {
            const admittedClaim = yield* Effect.fromResult(
              executionClaims.admission.inspect(executionScope, "execute"),
            );
            const executionAuthority = captureStoredOccExecutionAuthorityV1(
              rerunState,
              admittedClaim.observation,
            );
            const loadResult = yield* pointMutationOccExecutionEvidencePort
              .loadEffect(executionAuthority)
              .pipe(
                Effect.mapError(
                  (error: StoredOccExecutionEvidencePersistenceV1Error) =>
                    new PointMutationOccExecutionEvidencePersistenceV1Error({
                      cause: error.cause,
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
              return Object.freeze({
                kind: "completed" as const,
                result: publicationResultFromCommittedOutcome(
                  committedOutcome,
                ),
              });
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
            return yield* executeExactPointMutationAttemptKernel<
              PointMutationOccRerunAuthorityCorruptionV1Error,
              | PointMutationOccRerunFreshAttemptV1Error
              | PointMutationOccExecutionAuthorityMismatchV1Error
            >({
              selector: Object.freeze({
                deploymentId: rerunState.inspection.deploymentId,
                scopeId: rerunState.inspection.scopeId,
                sessionId: rerunState.inspection.sessionId,
                attemptFence: rerunState.inspection.attemptFence,
              }),
              attemptFence: rerunState.inspection.attemptFence,
              snapshotToken: rerunState.inspection.snapshotToken,
              executionScope,
              liveness,
              executionEvidence,
              verificationState,
              verifiedEvidence,
              expectedRequestSha256:
                rerunState.prepared.provenance.session.requestSha256,
              currentInspectionUnavailable: () =>
                new PointMutationOccRerunAuthorityCorruptionV1Error({
                  reason: "loadedAttemptStateUnavailable",
                }),
              validateCurrent: (currentInspection) => {
                const mismatch = pointMutationOccFreshAttemptMismatch(
                  rerunState.prepared,
                  rerunState.conflict,
                  rerunState.inspection.attemptFence,
                  currentInspection,
                );
                if (mismatch !== undefined) {
                  return Effect.fail(
                    new PointMutationOccRerunFreshAttemptV1Error({
                      reason: mismatch,
                    }),
                  );
                }
                return currentInspection.snapshotToken.scopeId ===
                      rerunState.inspection.snapshotToken.scopeId &&
                    currentInspection.snapshotToken.epoch ===
                      rerunState.inspection.snapshotToken.epoch &&
                    currentInspection.snapshotToken.commitSeq ===
                      rerunState.inspection.snapshotToken.commitSeq
                  ? Effect.void
                  : Effect.fail(
                      new PointMutationOccExecutionAuthorityMismatchV1Error({
                        reason: "snapshotChanged",
                      }),
                    );
              },
            });
          }),
        );
        if (publication.kind === "completed") return publication.result;

        const authorizationResult = yield* authorizePointMutationOccRerun(
          publication.error,
        );
        if (authorizationResult.kind === "replayed") {
          return publicationResultFromCommittedOutcome(
            authorizationResult.outcome,
          );
        }
        if (authorizationResult.kind === "expired") {
          return publicationResultFromCommittedOutcome(
            authorizationResult.outcome,
          );
        }
        const nextClaim = claimAuthorizedPointMutationOccRerun(
          authorizationResult.rerun,
        );
        if (Result.isFailure(nextClaim)) return yield* Effect.fail(
          nextClaim.failure,
        );
        const nextScope = executionClaims.admission.admit(
          nextClaim.success.executionClaim,
          "execute",
        );
        if (Result.isFailure(nextScope)) return yield* Effect.fail(
          nextScope.failure,
        );
        rerunState = nextClaim.success;
        executionScope = nextScope.success;
      }
    });

  const occExecution = Object.freeze({
    ...authorization,
    executeAuthorizedPointMutationOccRerun,
  } satisfies StoredPointMutationOccRerunExecutionV1);
  if (stage === "occRerunExecution") return occExecution;
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

  const admitRedispatchClaim = (
    claim: unknown,
    mode: "execute" | "finishOnly",
  ): Result.Result<
    Readonly<{
      readonly scope: PointMutationExecutionScopeV1;
      readonly state: PointMutationExecutionWorkClaimStateV1;
    }>,
    InvalidPointMutationExecutionClaimV1Error
  > =>
    Result.gen(function* () {
      const scope = yield* executionClaims.admission.admit(claim, mode);
      const state = yield* executionClaims.admission.inspect(scope, mode);
      return Object.freeze({ scope, state });
    });

  const admitRedispatchAbortOnlyClaim = (
    claim: unknown,
  ): Result.Result<
    Readonly<{
      readonly scope: PointMutationAbortOnlyScopeV1;
      readonly state: PointMutationAbortOnlyClaimStateV1;
    }>,
    InvalidPointMutationExecutionClaimV1Error
  > =>
    Result.gen(function* () {
      const scope = yield* executionClaims.abortOnlyAdmission.admit(claim);
      const state = yield* executionClaims.abortOnlyAdmission.inspect(scope);
      return Object.freeze({ scope, state });
    });

  const loadRedispatchAttemptAuthority = Effect.fn(
    "StoredAttemptAuthentication.loadRedispatchAttemptAuthority",
  )(function* (
    selector: PointMutationSessionAttemptSelectorV1,
    executionScope: PointMutationExecutionScopeV1,
  ) {
    const loadedAttempt = yield* pointMutationOccAttemptLoading.load({
      ...selector,
      attemptFence: selector.attemptFence.toString(),
    });
    const authorityHandle = yield* deriveAuthority(
      loadedAttempt,
      executionScope,
    );
    const authorityCapability = lookupAuthority(authorityHandle);
    if (authorityCapability === undefined) {
      return yield* Effect.fail(new InvalidStoredAttemptAuthorityV1Error({
        reason: "notProcessLocal",
      }));
    }
    return Object.freeze({ loadedAttempt, authorityCapability });
  });

  const finishClaimedSealedAttempt = Effect.fn(
    "StoredAttemptAuthentication.finishClaimedSealedAttempt",
  )(function* (
    selector: PointMutationSessionAttemptSelectorV1,
    executionScope: PointMutationExecutionScopeV1,
  ) {
    return yield* pointMutationExecutionLiveness.run(
      executionScope,
      "finishOnly",
      (liveness) => Effect.gen(function* () {
        const { authorityCapability } = yield* loadRedispatchAttemptAuthority(
          selector,
          executionScope,
        );
        const { verified } = yield* loadAndVerifyStoredEvidence(
          authorityCapability,
        );
        const storedAttempt = mintAuthenticatedStoredAttempt(verified);
        const authenticatedAuthority = yield* authenticateCommitAuthority(
          storedAttempt,
        );
        const verifiedInput = yield* verifyCommitInput(authenticatedAuthority);
        const runningPlan = yield* planPointCommit(verifiedInput);
        const finishingPlan = yield* liveness.enterFinishing(
          enterPointCommitFinishing(runningPlan),
        );
        return yield* publishFinishingPointCommit(finishingPlan);
      }),
    );
  });

  const disposeClaimedAbortOnlyAttempt = Effect.fn(
    "StoredAttemptAuthentication.disposeClaimedAbortOnlyAttempt",
  )(function* (
    selector: PointMutationSessionAttemptSelectorV1,
    executionScope: PointMutationAbortOnlyScopeV1,
    reason: "dirtyOpen" | "failedRoot",
  ) {
    const loadedAttempt = yield* pointMutationOccAttemptLoading.load({
      ...selector,
      attemptFence: selector.attemptFence.toString(),
    });
    const disposition = yield* pointMutationRedispatchDispositionPort
      .disposeAbortOnly(loadedAttempt, executionScope);
    return Object.freeze({
      kind: "closed" as const,
      reason,
      lifecycle: disposition.terminal.lifecycle,
      terminalizedAt: disposition.terminal.terminalizedAt,
    });
  });

  const closeExpiredRedispatchAttempt = Effect.fn(
    "StoredAttemptAuthentication.closeExpiredRedispatchAttempt",
  )(function* (selectorInput: unknown) {
    const terminalization = yield* pointMutationOccTerminalizationPort.expire(
      selectorInput,
    );
    if (terminalization.terminal.lifecycle !== "expired") {
      return yield* Effect.fail(
        new PointMutationSessionAttemptTerminalizationContractV1Error({
          reason: "invalidStatusOrLifecycle",
        }),
      );
    }
    return Object.freeze({
      kind: "closed" as const,
      reason: "authorityExpired" as const,
      lifecycle: "expired" as const,
      terminalizedAt: terminalization.terminal.terminalizedAt,
    });
  });

  const acquireRedispatchAttemptOrCloseExpired = Effect.fn(
    "StoredAttemptAuthentication.acquireRedispatchAttemptOrCloseExpired",
  )(function* (
    selectorInput: unknown,
  ): Effect.fn.Return<
    PointMutationRedispatchAcquisitionOrClosedV1,
    | PointMutationExecutionClaimAcquisitionV1Error
    | PointMutationSessionAttemptTerminalizationExecutionV1Error
  > {
    return yield* pointMutationRedispatchAcquisitionPort.acquireEffect(
      selectorInput,
    ).pipe(
      Effect.map((acquisition): PointMutationRedispatchAcquisitionOrClosedV1 =>
        Object.freeze({ kind: "acquisition" as const, acquisition })
      ),
      Effect.catch((error): Effect.Effect<
        PointMutationRedispatchAcquisitionOrClosedV1,
        | PointMutationExecutionClaimAcquisitionV1Error
        | PointMutationSessionAttemptTerminalizationExecutionV1Error
      > =>
        error instanceof PointMutationExecutionClaimAcquisitionStaleV1Error &&
          (error.reason === "leaseExpired" ||
            error.reason === "authorizationExpired")
          ? closeExpiredRedispatchAttempt(selectorInput).pipe(
              Effect.map((result) => Object.freeze({
                kind: "closed" as const,
                result,
              })),
            )
          : Effect.fail(error)
      ),
    );
  });

  const executeClaimedPristineAttempt = Effect.fn(
    "StoredAttemptAuthentication.executeClaimedPristineAttempt",
  )(function* (
    selector: PointMutationSessionAttemptSelectorV1,
    executionScope: PointMutationExecutionScopeV1,
  ) {
    return yield* pointMutationExecutionLiveness.run(
      executionScope,
      "execute",
      (liveness) => Effect.gen(function* () {
        const { authorityCapability } =
          yield* loadRedispatchAttemptAuthority(
            selector,
            executionScope,
          );
        const authority = authorityCapability.authority;
        if (authority.executionClaim === undefined) {
          return yield* Effect.fail(
            new PointMutationOccExecutionAuthorityCorruptionV1Error({
              reason: "executionClaimInvalid",
            }),
          );
        }
        const executionAuthority: StoredOccExecutionEvidenceAuthorityV1 =
          Object.freeze({
            kind: "claimedAttempt",
            deploymentId: authority.deploymentId,
            scopeId: authority.scopeId,
            scopeUuid: projectScopeIdUuidV1(authority.scopeId).scopeUuid,
            sessionId: authority.sessionId,
            attemptFence: authority.attemptFence,
            storageGeneration: authority.storageGeneration,
            storageGenerationFence: authority.storageGenerationFence,
            snapshotToken: Object.freeze({ ...authority.snapshotToken }),
            schemaVersionId: authority.schemaVersionId,
            executionClaim: Object.freeze({ ...authority.executionClaim }),
          });
        const loadResult =
          yield* pointMutationOccExecutionEvidencePort.loadEffect(
          executionAuthority,
        ).pipe(
          Effect.mapError(
            (error: StoredOccExecutionEvidencePersistenceV1Error) =>
              new PointMutationOccExecutionEvidencePersistenceV1Error({
                cause: error.cause,
              }),
          ),
        );
        if (loadResult.kind === "alreadyCommitted") {
          return yield* Effect.fail(
            new PointMutationOccExecutionAuthorityCorruptionV1Error({
              reason: "committedOutcomeMissing",
            }),
          );
        }
        const executionEvidence = yield* requireOccExecutionEvidenceEffect(
          loadResult,
        );
        const verificationState = captureClaimedExecutionVerificationState(
          authority,
          executionEvidence.session,
        );
        const verifiedEvidence = yield* verifyCommitAuthorityEvidenceEffect(
          verificationState,
          executionEvidence,
          grantKernel,
        );

        // Acquisition was outcome-first. Recheck after CPU verification and
        // before the final O03 liveness reload so no stored success is rerun.
        const outcome = yield* resolvePointCommitOutcomeFromStoredSession(
          authority.deploymentId,
          executionAuthority.scopeUuid,
          executionEvidence.session,
        );
        if (outcome.kind !== "missing") {
          return publicationResultFromCommittedOutcome(outcome);
        }

        const publication = yield* executeExactPointMutationAttemptKernel<
          PointMutationOccExecutionAuthorityCorruptionV1Error,
          PointMutationOccExecutionAuthorityMismatchV1Error
        >({
          selector,
          attemptFence: authority.attemptFence,
          snapshotToken: authority.snapshotToken,
          executionScope,
          liveness,
          executionEvidence,
          verificationState,
          verifiedEvidence,
          currentInspectionUnavailable: () =>
            new PointMutationOccExecutionAuthorityCorruptionV1Error({
              reason: "loadedAttemptStateUnavailable",
            }),
          validateCurrent: (current) =>
            validateClaimedCurrentAttempt(
              authority,
              executionEvidence.session,
              current,
            ),
        });
        if (publication.kind === "conflict") {
          return yield* Effect.fail(publication.error);
        }
        return publication.result;
      }),
    );
  });

  const resumeRedispatchedFinishingAttempt = Effect.fn(
    "StoredAttemptAuthentication.resumeRedispatchedFinishingAttempt",
  )(function* (selectorInput: unknown) {
    return yield* resumePointCommit(selectorInput).pipe(
      Effect.catchTag("StoredAttemptAlreadyCommittedV1Error", () =>
        Effect.gen(function* () {
          const reacquired = yield* pointMutationRedispatchAcquisitionPort
            .acquireEffect(selectorInput);
          if (reacquired.kind === "replayed") {
            return publicationResultFromCommittedOutcome(reacquired.outcome);
          }
          return yield* Effect.fail(new PointCommitCorruptionV1Error({
            reason: "committedOutcomeMissing",
          }));
        })),
    );
  });

  const redispatchExactPointMutationAttempt: StoredPointMutationCrashRedispatchV1["redispatchExactPointMutationAttempt"] =
    Effect.fn(
      "StoredAttemptAuthentication.redispatchExactPointMutationAttempt",
    )(function* (selectorInput) {
      const selector = yield* Effect.fromResult(
        decodePointMutationSessionAttemptSelectorV1Result(selectorInput).pipe(
          Result.mapError((cause) =>
            new PointMutationExecutionClaimAcquisitionInputV1Error({
              reason: "invalidSelector",
              cause,
            })
          ),
        ),
      );
      const ownedSelectorInput = Object.freeze({
        deploymentId: selector.deploymentId,
        scopeId: selector.scopeId,
        sessionId: selector.sessionId,
        attemptFence: selector.attemptFence.toString(),
      });
      const acquisitionOrClosed = yield* acquireRedispatchAttemptOrCloseExpired(
        ownedSelectorInput,
      );
      if (acquisitionOrClosed.kind === "closed") {
        return acquisitionOrClosed.result;
      }
      const acquisition = acquisitionOrClosed.acquisition;
      switch (acquisition.kind) {
        case "replayed":
          return publicationResultFromCommittedOutcome(acquisition.outcome);
        case "busy":
          return Object.freeze({ kind: "busy" as const });
        case "finishing":
          // The acquisition result grants nothing. C05-B independently loads
          // finishing + sealed + no-claim evidence before minting authority.
          return yield* resumeRedispatchedFinishingAttempt(ownedSelectorInput);
        case "acquired": {
          switch (acquisition.mode) {
            case "execute": {
              // Synchronously and irreversibly consume the same-factory claim
              // before the next asynchronous yield.
              const admitted = yield* Effect.fromResult(
                admitRedispatchClaim(acquisition.executionClaim, "execute"),
              );
              return yield* executeClaimedPristineAttempt(
                admitted.state.selector,
                admitted.scope,
              );
            }
            case "finishOnly": {
              const admitted = yield* Effect.fromResult(
                admitRedispatchClaim(acquisition.executionClaim, "finishOnly"),
              );
              return yield* finishClaimedSealedAttempt(
                admitted.state.selector,
                admitted.scope,
              );
            }
            case "abortOnly": {
              const admitted = yield* Effect.fromResult(
                admitRedispatchAbortOnlyClaim(acquisition.executionClaim),
              );
              return yield* disposeClaimedAbortOnlyAttempt(
                admitted.state.selector,
                admitted.scope,
                admitted.state.reason,
              );
            }
          }
        }
      }
    });

  return Object.freeze({
    ...occExecution,
    redispatchExactPointMutationAttempt,
  } satisfies StoredPointMutationCrashRedispatchV1);
}

function captureStoredOccExecutionAuthorityV1(
  state: AuthorizedPointMutationOccRerunStateV1,
  executionClaim: TransactionExecutionClaimPinV1,
): StoredOccExecutionEvidenceAuthorityV1 {
  const pins = state.prepared.plan.authorityPins;
  const previousSession = state.prepared.provenance.session;
  return Object.freeze({
    kind: "occRerun",
    deploymentId: pins.deploymentId,
    scopeId: pins.scopeId,
    scopeUuid: state.prepared.plan.sealIdentity.scopeUuid,
    sessionId: pins.sessionId,
    attemptFence: state.inspection.attemptFence,
    storageGeneration: pins.storageGeneration,
    storageGenerationFence: pins.storageGenerationFence,
    snapshotToken: Object.freeze({ ...state.inspection.snapshotToken }),
    schemaVersionId: pins.schemaVersionId,
    executionClaim: Object.freeze({
      claimOwner: executionClaim.claimOwner,
      claimFence: executionClaim.claimFence,
    }),
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

function captureClaimedExecutionVerificationState(
  authority: StoredAttemptAuthorityStateV1,
  session: StoredCommitAuthoritySessionEvidencePortV1,
): CommitAuthorityVerificationStateV1 {
  return Object.freeze({
    authority: Object.freeze({
      deploymentId: authority.deploymentId,
      scopeId: authority.scopeId,
      sessionId: authority.sessionId,
      attemptFence: authority.attemptFence,
      storageGeneration: authority.storageGeneration,
      storageGenerationFence: authority.storageGenerationFence,
      snapshotToken: Object.freeze({ ...authority.snapshotToken }),
      schemaVersionId: authority.schemaVersionId,
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

function validateClaimedCurrentAttempt(
  authority: StoredAttemptAuthorityStateV1,
  session: StoredCommitAuthoritySessionEvidencePortV1,
  current: LoadedPointMutationSessionAttemptOccRerunInspectionV1,
): Effect.Effect<
  void,
  PointMutationOccExecutionAuthorityMismatchV1Error
> {
  let reason: PointMutationOccRerunFreshAttemptMismatchV1 | undefined;
  if (current.selector.deploymentId !== authority.deploymentId) {
    reason = "deployment";
  } else if (current.selector.scopeId !== authority.scopeId) {
    reason = "scope";
  } else if (current.selector.sessionId !== authority.sessionId) {
    reason = "session";
  } else if (current.selector.attemptFence !== authority.attemptFence) {
    reason = "attemptFence";
  } else if (current.storageGeneration !== authority.storageGeneration) {
    reason = "storageGeneration";
  } else if (
    current.storageGenerationFence !== authority.storageGenerationFence
  ) {
    reason = "storageGenerationFence";
  } else if (current.snapshotToken.epoch !== authority.snapshotToken.epoch) {
    reason = "epoch";
  } else if (current.schemaVersionId !== authority.schemaVersionId) {
    reason = "schema";
  } else if (current.requestKey !== session.requestKey) {
    reason = "requestKey";
  } else if (current.attemptFacet.kind !== "pristineOpen") {
    reason = "attemptNotPristine";
  }
  if (reason !== undefined) {
    return Effect.fail(
      new PointMutationOccExecutionAuthorityMismatchV1Error({ reason }),
    );
  }
  return current.snapshotToken.scopeId === authority.snapshotToken.scopeId &&
      current.snapshotToken.commitSeq === authority.snapshotToken.commitSeq
    ? Effect.void
    : Effect.fail(new PointMutationOccExecutionAuthorityMismatchV1Error({
        reason: "snapshotChanged",
      }));
}

function publicationResultFromCommittedOutcome(
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
  executionClaim: PointMutationExecutionScopeV1,
  terminalization: PointMutationSessionAttemptTerminalizationV1,
): Effect.Effect<
  A,
  E | PointMutationSessionAttemptTerminalizationExecutionV1Error,
  R
> {
  return Effect.onExit(effect, (primaryExit) => {
    if (Exit.isSuccess(primaryExit)) return Effect.void;
    return Effect.uninterruptible(
      terminalization.abort(attempt, executionClaim),
    ).pipe(
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
    authority: captureAuthorityPort(storedAttempt.authority),
    executionClaim: storedAttempt.executionScope ?? null,
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
    executionClaim: null,
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
  const executionClaim = state.provenance.authority.executionClaim;
  if (executionClaim === undefined) {
    throw new Error("C05-A execution claim is unavailable.");
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
    executionClaim: Object.freeze({ ...executionClaim }),
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

function capturePointMutationSessionAttemptSelector(
  state: PreparedPointCommitCapabilityStateV1,
): PointMutationSessionAttemptSelectorV1 {
  const pins = state.plan.authorityPins;
  return Object.freeze({
    deploymentId: pins.deploymentId,
    scopeId: pins.scopeId,
    sessionId: pins.sessionId,
    attemptFence: pins.attemptFence,
  });
}

function isCommittedPointOutcomeResolutionV1(
  value: unknown,
): value is CommittedPointOutcomeResolutionV1 {
  return isNonArrayRecord(value) &&
    (value.kind === "missing" ||
      value.kind === "available" ||
      value.kind === "expired");
}

function isPointCommitPublicationResultV1(
  value: unknown,
): value is PointCommitPublicationResultV1 {
  return isNonArrayRecord(value) &&
    (value.kind === "published" ||
      value.kind === "replayed" ||
      value.kind === "expired");
}

const POINT_COMMIT_AUTHORITY_PIN_SCALAR_FIELDS = [
  "deploymentId",
  "scopeId",
  "sessionId",
  "attemptFence",
  "storageGeneration",
  "storageGenerationFence",
  "schemaVersionId",
  "packageId",
  "artifactRuntime",
  "artifactId",
  "sourcePackageHash",
  "executionModule",
  "functionPath",
  "functionKind",
  "policyVersion",
  "authorizationRevocationEpoch",
  "requestKey",
] as const satisfies ReadonlyArray<
  Exclude<keyof PointCommitAuthorityPinsV1, "snapshotToken">
>;

const POINT_COMMIT_SEAL_IDENTITY_SCALAR_FIELDS = [
  "scopeUuid",
  "lifecycle",
  "sessionUpdatedAtMilliseconds",
  "leaseExpiresAtMilliseconds",
  "rootCreatedAtMilliseconds",
  "rootUpdatedAtMilliseconds",
  "sealedAtMilliseconds",
  "finalSyscallSequence",
  "creationTimeSeed",
  "nextCreationTime",
  "journalFormat",
  "journalProtocolVersion",
  "journalValueCodecVersion",
  "journalByteLength",
  "resultValueCodecVersion",
  "resultSemanticBytes",
  "resultByteLength",
  "readDocuments",
  "readSemanticBytes",
  "pointDependencyCount",
  "writeOperations",
  "writeSemanticBytes",
  "materialWriteEventEvidenceBytes",
] as const satisfies ReadonlyArray<
  Exclude<
    keyof PointCommitSealIdentityV1,
    "journalSha256" | "resultSha256"
  >
>;

function pointCommitPublicationCommandsEqual(
  left: PointCommitPublicationCommandV1,
  right: PointCommitPublicationCommandV1,
): boolean {
  const commandFieldsAreExhaustive: Exclude<
    keyof PointCommitPublicationCommandV1,
    | "authorityPins"
    | "session"
    | "sealIdentity"
    | "dependencies"
    | "rowIntent"
    | "successfulResult"
  > extends never ? true : never = true;
  void commandFieldsAreExhaustive;
  if (!pointCommitAuthorityPinsEqual(
    left.authorityPins,
    right.authorityPins,
  )) return false;
  if (!storedTransactionSessionScalarsEqualV1(
    left.session,
    right.session,
  )) return false;
  if (!pointCommitSealIdentitiesEqual(
    left.sealIdentity,
    right.sealIdentity,
  )) return false;
  if (left.dependencies.length !== right.dependencies.length) return false;
  for (let index = 0; index < left.dependencies.length; index += 1) {
    const leftDependency = left.dependencies[index];
    const rightDependency = right.dependencies[index];
    if (
      leftDependency === undefined ||
      rightDependency === undefined ||
      !pointCommitDependenciesEqual(leftDependency, rightDependency)
    ) return false;
  }
  return pointCommitRowIntentsEqual(left.rowIntent, right.rowIntent) &&
    pointCommitSuccessfulResultsEqual(
      left.successfulResult,
      right.successfulResult,
    );
}

function pointCommitAuthorityPinsEqual(
  left: PointCommitAuthorityPinsV1,
  right: PointCommitAuthorityPinsV1,
): boolean {
  const fieldsAreExhaustive: Exclude<
    keyof PointCommitAuthorityPinsV1,
    | typeof POINT_COMMIT_AUTHORITY_PIN_SCALAR_FIELDS[number]
    | "snapshotToken"
  > extends never ? true : never = true;
  void fieldsAreExhaustive;
  for (const field of POINT_COMMIT_AUTHORITY_PIN_SCALAR_FIELDS) {
    if (left[field] !== right[field]) return false;
  }
  return left.snapshotToken.scopeId === right.snapshotToken.scopeId &&
    left.snapshotToken.epoch === right.snapshotToken.epoch &&
    left.snapshotToken.commitSeq === right.snapshotToken.commitSeq;
}

function pointCommitSealIdentitiesEqual(
  left: PointCommitSealIdentityV1,
  right: PointCommitSealIdentityV1,
): boolean {
  const fieldsAreExhaustive: Exclude<
    keyof PointCommitSealIdentityV1,
    | typeof POINT_COMMIT_SEAL_IDENTITY_SCALAR_FIELDS[number]
    | "journalSha256"
    | "resultSha256"
  > extends never ? true : never = true;
  void fieldsAreExhaustive;
  for (const field of POINT_COMMIT_SEAL_IDENTITY_SCALAR_FIELDS) {
    if (left[field] !== right[field]) return false;
  }
  return bytesEqual(left.journalSha256, right.journalSha256) &&
    bytesEqual(left.resultSha256, right.resultSha256);
}

function pointCommitDependenciesEqual(
  left: PointCommitDependencyV1,
  right: PointCommitDependencyV1,
): boolean {
  const fieldsAreExhaustive: Exclude<
    keyof PointCommitDependencyV1,
    "documentId" | "tableId" | "rowId" | "dependency"
  > extends never ? true : never = true;
  void fieldsAreExhaustive;
  return left.documentId === right.documentId &&
    left.tableId === right.tableId &&
    left.rowId === right.rowId &&
    dependenciesEqual(left.dependency, right.dependency);
}

function pointCommitRowIntentsEqual(
  left: PointCommitRowIntentV1 | null,
  right: PointCommitRowIntentV1 | null,
): boolean {
  if (left === null || right === null) return left === right;
  if (
    left.kind !== right.kind ||
    !pointCommitDependenciesEqual(left, right)
  ) return false;
  if (left.kind === "deleted" && right.kind === "deleted") return true;
  if (left.kind !== "live" || right.kind !== "live") return false;
  const liveFieldsAreExhaustive: Exclude<
    keyof Extract<PointCommitRowIntentV1, { readonly kind: "live" }>,
    | keyof PointCommitDependencyV1
    | "kind"
    | "creationTime"
    | "value"
    | "canonicalBytes"
    | "semanticSizeBytes"
  > extends never ? true : never = true;
  void liveFieldsAreExhaustive;
  return left.creationTime === right.creationTime &&
    left.semanticSizeBytes === right.semanticSizeBytes &&
    bytesEqual(left.canonicalBytes, right.canonicalBytes) &&
    jsonEqual(
      flarexValueToJsonV1(left.value, "appDocument"),
      flarexValueToJsonV1(right.value, "appDocument"),
    );
}

function pointCommitSuccessfulResultsEqual(
  left: PointCommitSuccessfulResultV1,
  right: PointCommitSuccessfulResultV1,
): boolean {
  const fieldsAreExhaustive: Exclude<
    keyof PointCommitSuccessfulResultV1,
    | "valueCodecVersion"
    | "value"
    | "canonicalBytes"
    | "semanticSizeBytes"
    | "sha256Hex"
  > extends never ? true : never = true;
  void fieldsAreExhaustive;
  const leftCanonicalBytes = left.canonicalBytes;
  const rightCanonicalBytes = right.canonicalBytes;
  return left.valueCodecVersion === right.valueCodecVersion &&
    left.semanticSizeBytes === right.semanticSizeBytes &&
    left.sha256Hex === right.sha256Hex &&
    bytesEqual(leftCanonicalBytes, rightCanonicalBytes) &&
    jsonEqual(
      flarexValueToJsonV1(left.value),
      flarexValueToJsonV1(right.value),
    );
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
      storageGeneration: decodeFlarexDbV1StorageGeneration(
        evidence.session.storageGeneration,
      ),
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
  executionScope?: PointMutationExecutionScopeV1,
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
      executionScope,
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
  executionScope?: PointMutationExecutionScopeV1,
): AuthenticatedStoredAttemptStateV1 {
  const root = evidence.root;
  return Object.freeze({
    authority: Object.freeze({
      ...authority,
      snapshotToken: Object.freeze({ ...authority.snapshotToken }),
    }),
    ...(executionScope === undefined ? {} : { executionScope }),
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
    deploymentId: authority.deploymentId,
    scopeId: authority.scopeId,
    sessionId: authority.sessionId,
    attemptFence: authority.attemptFence,
    storageGeneration: authority.storageGeneration,
    storageGenerationFence: authority.storageGenerationFence,
    snapshotToken: Object.freeze({ ...authority.snapshotToken }),
    schemaVersionId: authority.schemaVersionId,
    ...(authority.executionClaim === undefined
      ? {}
      : { executionClaim: Object.freeze({ ...authority.executionClaim }) }),
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
