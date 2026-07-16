import { Data, Effect, Schema } from "effect";

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
import type { Json, JsonObject } from "flarex-protocol/json";
import {
  CatalogSchemaVersionIdSchema,
  decodeSchemaManifestAppSchemaV1,
  type CatalogSchemaVersionId,
  type SchemaManifestAppSchemaV1,
} from "flarex-protocol/schema-manifest";
import {
  PointMutationTargetSelectionV1Error,
  PointMutationTargetFunctionMetadataV1Schema,
  requirePointMutationArgumentSemanticSizeV1,
  type PointMutationTargetFunctionMetadataV1,
} from "flarex-protocol/point-mutation-start";
import {
  CommitSeqSchema,
  ReplacementScopeIdV1Schema,
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
  TransactionArtifactIdV1Schema,
  TransactionArtifactRuntimeV1Schema,
  TransactionArgumentsSha256V1Schema,
  TransactionAuthorizationRevocationEpochSchema,
  TransactionExecutionModuleV1Schema,
  TransactionFunctionKindV1Schema,
  TransactionFunctionPathV1Schema,
  TransactionIdentityAccessPolicySha256V1Schema,
  TransactionPackageIdV1Schema,
  TransactionRequestKeyV1Schema,
  TransactionRequestSha256V1Schema,
  TransactionSourcePackageSha256HexV1Schema,
  type TransactionAttemptFence,
  type TransactionSessionIdV1,
  type TransactionSessionLifecycleV1,
} from "flarex-protocol/transaction-session";
import {
  FLAREX_VALUE_CODEC_VERSION_V1,
  canonicalizeFlarexValueJsonV1,
  decodeFlarexValueCodecVersion,
  normalizeFlarexValueJsonV1,
  normalizeFlarexValueV1,
  type CanonicalFlarexRuntimeValueV1,
  FlarexValueCodecV1Error,
  FlarexValueEvidenceV1Error,
  type FlarexValueCodecVersion,
} from "flarex-protocol/value";

import {
  inspectLoadedPointMutationSessionAttemptV1,
  type LoadedPointMutationSessionAttemptV1,
} from "./pointMutationSessionActivation";
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
} from "./storedAttemptAuthentication/commitAuthorityVerification";
import {
  bytesEqual,
  detachVerifiedGrant,
} from "./storedAttemptAuthentication/canonicalEvidence";
import {
  CommitDocumentValidationV1Error,
  CommitInputAuthorityCorruptionV1Error,
  CommitSuccessfulResultValidationV1Error,
  InvalidAuthenticatedCommitAuthorityV1Error,
  verifyCommitInputStateEffect,
  type CommitInputVerificationV1Error,
  type VerifiedCommitInputStateV1,
} from "./storedAttemptAuthentication/commitInputVerification";

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

export interface StoredAttemptSessionScalarsPortV1 {
  readonly lifecycle: "running" | "finishing";
  readonly storageGeneration: string;
  readonly storageGenerationFence: bigint;
  readonly packageId: string;
  readonly artifactRuntime: string;
  readonly artifactId: string;
  readonly sourcePackageHash: string;
  readonly executionModule: string;
  readonly functionPath: string;
  readonly functionKind: string;
  readonly schemaVersionId: string;
  readonly policyVersion: string;
  readonly identityAccessPolicySha256: Uint8Array;
  readonly validatedArgsValueCodecVersion: number;
  readonly validatedArgsCanonicalByteLength: number;
  readonly validatedArgsSha256: Uint8Array;
  readonly authorizationGrantId: string;
  readonly authorizationGrantValueCodecVersion: number;
  readonly authorizationGrantCanonicalByteLength: number;
  readonly authorizationGrantSha256: Uint8Array;
  readonly authorizationRevocationEpoch: bigint;
  readonly authorizationGrantExpiresAtMilliseconds: number;
  readonly requestKey: string;
  readonly requestSha256: Uint8Array;
  readonly protocolVersion: number;
  readonly hardExpiresAtMilliseconds: number;
  readonly createdAtMilliseconds: number;
  readonly updatedAtMilliseconds: number;
}

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

export interface StoredAttemptEvidenceLoaderPortV1 {
  readonly load: (
    authority: StoredAttemptEvidenceAuthorityPortV1,
  ) => Promise<StoredAttemptEvidenceLoadResultPortV1>;
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

export function createStoredAttemptAuthenticationV1(
  loader: StoredAttemptEvidenceLoaderPortV1,
): StoredAttemptAuthenticationV1;
export function createStoredAttemptAuthenticationV1(
  loader: StoredAttemptEvidenceLoaderPortV1,
  commitAuthority: StoredCommitAuthorityAuthenticationConfigV1,
): StoredCommitInputVerificationV1;
export function createStoredAttemptAuthenticationV1(
  loader: StoredAttemptEvidenceLoaderPortV1,
  commitAuthority?: StoredCommitAuthorityAuthenticationConfigV1,
): StoredAttemptAuthenticationV1 | StoredCommitInputVerificationV1 {
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
    VerifiedCommitInputStateV1
  >();
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
        const result = yield* Effect.tryPromise({
          try: () => loader.load(captureAuthorityPort(authorityState)),
          catch: (cause) => new StoredAttemptPersistenceV1Error({ cause }),
        });
        const evidence = yield* requireLoadedEvidenceEffect(result);
        const verified = yield* verifyStoredEvidenceEffect(
          authorityState,
          envelope,
          evidence,
        );
        const handle: AuthenticatedStoredAttemptV1 = Object.freeze({
          [authenticatedStoredAttemptBrand]: PROCESS_LOCAL_CAPABILITY,
        });
        authenticatedStates.set(handle, verified);
        return handle;
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
    const loadResult = yield* Effect.tryPromise({
      try: () => commitAuthority.evidenceLoader.load(
        captureCommitAuthorityPort(storedAttempt),
      ),
      catch: (cause) => new StoredCommitAuthorityPersistenceV1Error({ cause }),
    });
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
        verifiedCommitInputStates.set(handle, verified);
        return handle;
      },
    );

  return Object.freeze({
    ...base,
    authenticateCommitAuthority,
    verifyCommitInput,
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
      const before = serializeVerifiedCommitInputStateForTest(state);
      action();
      return before === serializeVerifiedCommitInputStateForTest(state);
    },
  } satisfies StoredCommitInputVerificationV1);
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
  states: WeakMap<object, VerifiedCommitInputStateV1>,
  value: VerifiedCommitInputV1,
): VerifiedCommitInputStateV1 {
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

const verifyStoredEvidenceEffect = Effect.fn(
  "StoredAttemptAuthentication.verifyStoredEvidence",
)(function* (
  authority: StoredAttemptAuthorityStateV1,
  envelope: StoredForSessionAttemptCommitEnvelopeV1,
  evidence: StoredAttemptEvidencePortV1,
): Effect.fn.Return<
  AuthenticatedStoredAttemptStateV1,
  | StoredAttemptAuthorityMismatchV1Error
  | StoredAttemptEnvelopeMismatchV1Error
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
    canonicalBytes: new Uint8Array(evidence.root.journalBytes),
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
  const envelopeMismatch = storedEnvelopeMismatch(
    envelope,
    evidence,
    scalarEvidence.journalSha256Hex,
    successfulResult.evidence,
  );
  if (envelopeMismatch !== undefined) {
    return yield* Effect.fail(envelopeMismatch);
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
    overlayBytes: new Uint8Array(document.canonicalBytes),
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
        return canonicalJson(normalizeFlarexValueV1(actual).valueJson) ===
          canonicalJson(normalizeFlarexValueV1(expected).valueJson);
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
  if (
    typeof value !== "object" ||
    value === null ||
    value instanceof ArrayBuffer ||
    Array.isArray(value)
  ) {
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
      journalSha256: new Uint8Array(root.journalSha256),
      resultValueCodecVersion: root.resultValueCodecVersion,
      resultSemanticBytes: root.resultSemanticBytes,
      resultByteLength: root.resultBytes.byteLength,
      resultSha256: new Uint8Array(root.resultSha256),
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
      canonicalBytes: new Uint8Array(successfulResult.canonicalBytes),
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
      : new Uint8Array(point.overlayBytes),
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
  if (!(bytes instanceof Uint8Array) || bytes.byteLength !== 32) {
    throw corruption(reason);
  }
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

function base64UrlFromBytes(bytes: Uint8Array): string {
  if (!(bytes instanceof Uint8Array)) {
    throw corruption("resultBytesInvalid");
  }
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.byteLength; offset += chunkSize) {
    const chunk = bytes.subarray(
      offset,
      Math.min(offset + chunkSize, bytes.byteLength),
    );
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

function canonicalJson(value: Json): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (isJsonObject(value)) {
    return `{${Object.keys(value)
      .sort(compareStrings)
      .map((key) => {
        const item = value[key];
        if (item === undefined) throw corruption("jsonPropertyMissing");
        return `${JSON.stringify(key)}:${canonicalJson(item)}`;
      })
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isJsonObject(value: Json): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function mapSynchronousStorageFailure(
  cause: unknown,
): StoredAttemptStorageCorruptionV1Error {
  if (cause instanceof StoredAttemptStorageCorruptionV1Error) {
    return cause;
  }
  return new StoredAttemptStorageCorruptionV1Error({
    reason: "storedEvidenceInvalid",
    cause,
  });
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
