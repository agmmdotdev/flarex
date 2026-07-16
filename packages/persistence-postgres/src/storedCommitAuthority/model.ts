import type { AppCreationTimeV1 } from "flarex-protocol/app-document";
import type { CatalogTableId } from "flarex-protocol/catalog";
import type {
  CommitFinalSyscallSequenceV1,
  CommitMaterialWriteEventEvidenceBytesV1,
  SessionJournalV1,
} from "flarex-protocol/commit-protocol";
import type { JsonObject } from "flarex-protocol/json";
import type {
  CatalogSchemaVersionId,
  SchemaManifestAppSchemaV1,
} from "flarex-protocol/schema-manifest";
import type {
  FlarexDbV1StorageGeneration,
  ReplacementScopeIdV1,
  ScopeUuidV1,
  SnapshotToken,
  StorageGenerationFence,
} from "flarex-protocol/storage-authority";
import type { TransactionGrantDeploymentIdV1 } from "flarex-protocol/transaction-grant";
import type {
  TransactionAttemptFence,
  TransactionSessionIdV1,
} from "flarex-protocol/transaction-session";
import type { FlarexValueCodecVersion } from "flarex-protocol/value";

export const MAX_STORED_COMMIT_AUTHORITY_MATERIALIZATION_BYTES_V1 =
  64 * 1024 * 1024;

export interface StoredCommitAuthoritySessionScalarsV1 {
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

export interface StoredCommitAuthoritySealIdentityV1 {
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

export interface StoredCommitAuthorityEvidenceAuthorityV1 {
  readonly deploymentId: TransactionGrantDeploymentIdV1;
  readonly scopeId: ReplacementScopeIdV1;
  readonly sessionId: TransactionSessionIdV1;
  readonly attemptFence: TransactionAttemptFence;
  readonly storageGeneration: FlarexDbV1StorageGeneration;
  readonly storageGenerationFence: StorageGenerationFence;
  readonly snapshotToken: SnapshotToken;
  readonly schemaVersionId: CatalogSchemaVersionId;
  readonly session: StoredCommitAuthoritySessionScalarsV1;
  readonly sealIdentity: StoredCommitAuthoritySealIdentityV1;
}

export interface StoredCommitAuthoritySessionEvidenceV1
  extends StoredCommitAuthoritySessionScalarsV1 {
  readonly validatedArgsJson: JsonObject;
  readonly validatedArgsCanonicalBytes: Uint8Array;
  readonly authorizationGrantJson: JsonObject;
  readonly authorizationGrantCanonicalBytes: Uint8Array;
}

export interface StoredCommitAuthorityEvidenceV1 {
  readonly databaseNowMilliseconds: number;
  readonly currentAuthorizationRevocationEpoch: bigint;
  readonly session: StoredCommitAuthoritySessionEvidenceV1;
  readonly schema: Readonly<{
    readonly deploymentId: TransactionGrantDeploymentIdV1;
    readonly schemaVersionId: CatalogSchemaVersionId;
    readonly manifest: SchemaManifestAppSchemaV1;
    readonly stableBindings: ReadonlyArray<Readonly<{
      readonly logicalName: string;
      readonly tableId: CatalogTableId;
    }>>;
  }>;
}

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
  | "stableBindingMismatch";

export type StoredCommitAuthorityEvidenceLoadResultV1 =
  | Readonly<{ readonly kind: "loaded"; readonly evidence: StoredCommitAuthorityEvidenceV1 }>
  | Readonly<{
      readonly kind: "notPlannable";
      readonly reason: "lifecycle" | "rootNotSealed" | "expired";
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
        | "sealChanged";
    }>
  | Readonly<{
      readonly kind: "corrupt";
      readonly reason: StoredCommitAuthorityCorruptionReasonV1;
      readonly cause?: unknown;
    }>;

export interface StoredCommitAuthorityEvidenceLoaderV1 {
  readonly load: (
    authority: StoredCommitAuthorityEvidenceAuthorityV1,
  ) => Promise<StoredCommitAuthorityEvidenceLoadResultV1>;
}

export function authorityMismatch(
  reason: Extract<
    StoredCommitAuthorityEvidenceLoadResultV1,
    { readonly kind: "authorityMismatch" }
  >["reason"],
): StoredCommitAuthorityEvidenceLoadResultV1 {
  return Object.freeze({ kind: "authorityMismatch", reason });
}

export function corrupt(
  reason: StoredCommitAuthorityCorruptionReasonV1,
  cause?: unknown,
): StoredCommitAuthorityEvidenceLoadResultV1 {
  return Object.freeze({
    kind: "corrupt",
    reason,
    ...(cause === undefined ? {} : { cause }),
  });
}
