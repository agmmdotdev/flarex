import { Data, Effect } from "effect";

import type { CatalogTableId } from "flarex-protocol/catalog";
import type { JsonObject } from "flarex-protocol/json";
import type {
  CatalogSchemaVersionId,
  SchemaManifestAppSchemaV1,
} from "flarex-protocol/schema-manifest";
import type {
  FlarexDbV1StorageGeneration,
  ReplacementScopeIdV1,
  SnapshotToken,
  StorageGenerationFence,
} from "flarex-protocol/storage-authority";
import type {
  TransactionGrantDeploymentIdV1,
} from "flarex-protocol/transaction-grant";
import type {
  TransactionAttemptFence,
  TransactionSessionIdV1,
} from "flarex-protocol/transaction-session";
import type { ApplicationManifest } from
  "@flarex/analysis/application-analysis";

import type { TransactionGrantVerifierV1 } from "../transactionGrant";
import type {
  ApplicationMutationGrantVerificationKernelV1,
} from "../applicationMutationGrantVerificationKernel";
import type { ApplicationMutationExecutionAuthorityV1 } from
  "flarex-protocol/internal/application-mutation-authority-v1";
import type { ApplicationRuntimeTargetV1 } from
  "flarex-protocol/internal/application-runtime-target-v1";
import type {
  StoredAttemptSealIdentityPortV1,
  StoredAttemptSessionScalarsPortV1,
} from "../storedAttemptAuthentication";

export class InvalidAuthenticatedStoredAttemptV1Error extends Data.TaggedError(
  "InvalidAuthenticatedStoredAttemptV1Error",
)<{
  readonly reason: "notSameFactory";
}> {}

export class StoredCommitAuthorityConfigurationV1Error
  extends Data.TaggedError("StoredCommitAuthorityConfigurationV1Error")<{
    readonly reason:
      | "unregisteredTransactionGrantVerifier"
      | "missingExecutionClaimVault";
  }> {}

export class StoredCommitAuthorityPersistenceV1Error extends Data.TaggedError(
  "StoredCommitAuthorityPersistenceV1Error",
)<{
  readonly cause: unknown;
}> {}

export class StoredCommitAuthorityNotPlannableV1Error
  extends Data.TaggedError("StoredCommitAuthorityNotPlannableV1Error")<{
    readonly reason: "lifecycle" | "rootNotSealed" | "expired";
  }> {}

export class StoredCommitAuthorityMismatchV1Error extends Data.TaggedError(
  "StoredCommitAuthorityMismatchV1Error",
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
    | "revocationEpochChanged"
    | "sealChanged";
}> {}

export type StoredCommitAuthorityCorruptionReasonV1 =
  | "repeatableReadCapabilityMissing"
  | "authorityProjectionInvalid"
  | "databaseClockInvalid"
  | "sessionEvidenceMissingOrDuplicate"
  | "sessionEvidenceInvalid"
  | "snapshotLeaseMissingOrDuplicate"
  | "snapshotLeaseInvalid"
  | "journalRootMissingOrDuplicate"
  | "journalRootInvalid"
  | "sizeProjectionInvalid"
  | "evidenceLimitExceeded"
  | "schemaArtifactMissingOrDuplicate"
  | "schemaArtifactInvalid"
  | "stableBindingOverflow"
  | "stableBindingMissing"
  | "stableBindingMismatch"
  | "applicationGraphMissingOrDuplicate"
  | "applicationGraphInvalid"
  | "validatedArgumentsInvalid"
  | "authorizationGrantInvalid"
  | "functionMetadataMissing"
  | "functionMetadataInvalid";

export class StoredCommitAuthorityCorruptionV1Error extends Data.TaggedError(
  "StoredCommitAuthorityCorruptionV1Error",
)<{
  readonly reason: StoredCommitAuthorityCorruptionReasonV1;
  readonly cause?: unknown;
}> {}

export class PinnedFunctionMetadataSourceV1Error extends Data.TaggedError(
  "PinnedFunctionMetadataSourceV1Error",
)<{
  readonly cause: unknown;
}> {}

type StoredCommitAuthoritySessionEvidenceFieldsPortV1 = Readonly<{
  readonly validatedArgsJson: JsonObject;
  readonly validatedArgsCanonicalBytes: Uint8Array;
  readonly authorizationGrantJson: JsonObject;
  readonly authorizationGrantCanonicalBytes: Uint8Array;
}>;

export type StoredCommitAuthoritySessionEvidencePortV1<Generation extends
  StoredAttemptSessionScalarsPortV1["executionAuthorityGeneration"] =
    StoredAttemptSessionScalarsPortV1["executionAuthorityGeneration"]> =
  Extract<StoredAttemptSessionScalarsPortV1, {
    readonly executionAuthorityGeneration: Generation;
  }> & StoredCommitAuthoritySessionEvidenceFieldsPortV1;

export interface StoredCommitAuthorityEvidenceAuthorityPortV1 {
  readonly deploymentId: TransactionGrantDeploymentIdV1;
  readonly scopeId: ReplacementScopeIdV1;
  readonly sessionId: TransactionSessionIdV1;
  readonly attemptFence: TransactionAttemptFence;
  readonly storageGeneration: FlarexDbV1StorageGeneration;
  readonly storageGenerationFence: StorageGenerationFence;
  readonly snapshotToken: SnapshotToken;
  readonly schemaVersionId: CatalogSchemaVersionId;
  readonly session: StoredAttemptSessionScalarsPortV1;
  readonly sealIdentity: StoredAttemptSealIdentityPortV1;
}

export interface StoredCommitAuthoritySchemaEvidencePortV1 {
  readonly deploymentId: TransactionGrantDeploymentIdV1;
  readonly schemaVersionId: CatalogSchemaVersionId;
  readonly manifest: SchemaManifestAppSchemaV1;
  readonly stableBindings: ReadonlyArray<Readonly<{
    readonly logicalName: string;
    readonly tableId: CatalogTableId;
  }>>;
}

interface StoredCommitAuthorityEvidenceCommonPortV1 {
  readonly databaseNowMilliseconds: number;
  readonly currentAuthorizationRevocationEpoch: bigint;
  readonly schema: StoredCommitAuthoritySchemaEvidencePortV1;
}

type StoredCommitAuthorityApplicationEvidencePortV1 = Readonly<{
    readonly manifest: ApplicationManifest;
    readonly runtimeHostIdentity: string;
    readonly compatibilityDate: string;
    readonly executionAuthority: ApplicationMutationExecutionAuthorityV1;
    readonly runtimeTarget: ApplicationRuntimeTargetV1;
    readonly activationSequence: bigint;
    readonly readinessSha256: Uint8Array;
    readonly activationSha256: Uint8Array;
    readonly activeHeadSha256: Uint8Array;
    readonly publicationSha256: Uint8Array;
    readonly functionEntrySha256: Uint8Array;
    readonly schemaBindingSha256: Uint8Array;
  }>;

export type StoredCommitAuthorityEvidencePortV1 =
  | (StoredCommitAuthorityEvidenceCommonPortV1 & Readonly<{
      readonly session: StoredCommitAuthoritySessionEvidencePortV1<
        "legacy_dynamic_worker_v1"
      >;
      readonly application?: never;
    }>)
  | (StoredCommitAuthorityEvidenceCommonPortV1 & Readonly<{
      readonly session: StoredCommitAuthoritySessionEvidencePortV1<
        "application_v1"
      >;
      readonly application: StoredCommitAuthorityApplicationEvidencePortV1;
    }>);

export type StoredCommitAuthorityEvidenceLoadResultPortV1 =
  | Readonly<{
      readonly kind: "loaded";
      readonly evidence: StoredCommitAuthorityEvidencePortV1;
    }>
  | Readonly<{
      readonly kind: "notPlannable";
      readonly reason: "lifecycle" | "rootNotSealed" | "expired";
    }>
  | Readonly<{
      readonly kind: "authorityMismatch";
      readonly reason: StoredCommitAuthorityMismatchV1Error["reason"];
    }>
  | Readonly<{
      readonly kind: "corrupt";
      readonly reason: StoredCommitAuthorityCorruptionReasonV1;
      readonly cause?: unknown;
    }>;

export interface StoredCommitAuthorityEvidencePersistencePortErrorV1 {
  readonly _tag: "StoredCommitAuthorityEvidencePersistenceV1Error";
  readonly cause: unknown;
}

export interface StoredCommitAuthorityEvidenceLoaderPortV1 {
  readonly loadEffect: (
    authority: StoredCommitAuthorityEvidenceAuthorityPortV1,
  ) => Effect.Effect<
    StoredCommitAuthorityEvidenceLoadResultPortV1,
    StoredCommitAuthorityEvidencePersistencePortErrorV1
  >;
}

export interface PinnedPointMutationFunctionMetadataSelectorV1 {
  readonly deploymentId: TransactionGrantDeploymentIdV1;
  readonly scopeId: ReplacementScopeIdV1;
  readonly packageId: string;
  readonly artifactRuntime: string;
  readonly artifactId: string;
  readonly sourcePackageHash: string;
  readonly executionModule: string;
  readonly functionPath: string;
  readonly functionKind: "mutation";
  readonly schemaVersionId: CatalogSchemaVersionId;
}

/**
 * Temporary immutable proof adapter for the private C07 composition only.
 * Replace it when roadmap 17 plus S03-D4/S04 publish one coherent production
 * package/artifact/source/function-validator/schema snapshot.
 */
export interface PinnedPointMutationFunctionMetadataReaderPortV1 {
  readonly load: (
    selector: PinnedPointMutationFunctionMetadataSelectorV1,
  ) => Effect.Effect<unknown | null, PinnedFunctionMetadataSourceV1Error>;
}

export interface StoredCommitAuthorityAuthenticationConfigV1 {
  readonly evidenceLoader: StoredCommitAuthorityEvidenceLoaderPortV1;
  readonly transactionGrantVerifier: TransactionGrantVerifierV1;
  readonly applicationMutationGrantVerifier?:
    ApplicationMutationGrantVerificationKernelV1;
  readonly functionMetadata:
    PinnedPointMutationFunctionMetadataReaderPortV1;
}
