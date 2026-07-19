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

import type { TransactionGrantVerifierV1 } from "../transactionGrant";
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

export interface StoredCommitAuthoritySessionEvidencePortV1
  extends StoredAttemptSessionScalarsPortV1 {
  readonly validatedArgsJson: JsonObject;
  readonly validatedArgsCanonicalBytes: Uint8Array;
  readonly authorizationGrantJson: JsonObject;
  readonly authorizationGrantCanonicalBytes: Uint8Array;
}

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

export interface StoredCommitAuthorityEvidencePortV1 {
  readonly databaseNowMilliseconds: number;
  readonly currentAuthorizationRevocationEpoch: bigint;
  readonly session: StoredCommitAuthoritySessionEvidencePortV1;
  readonly schema: StoredCommitAuthoritySchemaEvidencePortV1;
}

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
  readonly functionMetadata:
    PinnedPointMutationFunctionMetadataReaderPortV1;
}
