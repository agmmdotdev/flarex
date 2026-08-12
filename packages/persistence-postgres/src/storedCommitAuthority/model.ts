import { Data, Effect } from "effect";
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
  StoredTransactionSessionScalarsV1,
  TransactionAttemptFence,
  TransactionSessionIdV1,
} from "flarex-protocol/transaction-session";
import type { FlarexValueCodecVersion } from "flarex-protocol/value";
import type { ApplicationMutationExecutionAuthorityV1 } from
  "flarex-protocol/internal/application-mutation-authority-v1";
import type { ApplicationRuntimeTargetV1 } from
  "flarex-protocol/internal/application-runtime-target-v1";

import {
  storedAuthorityCorruptionResult,
  storedAuthorityMismatchResult,
  type StoredAuthorityCorruptionResult,
  type StoredAuthorityMismatchResult,
} from "../storedAuthorityLoadResult";

export const MAX_STORED_COMMIT_AUTHORITY_MATERIALIZATION_BYTES_V1 =
  64 * 1024 * 1024;

export type StoredCommitAuthoritySessionScalarsV1 =
  StoredTransactionSessionScalarsV1;

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
  readonly indexedQuerySyscalls: number;
  readonly indexRangeDependencyCount: number;
  readonly indexRangeDependencyEvidenceBytes: number;
  readonly writeOperations: number;
  readonly writeSemanticBytes: number;
  readonly materialWriteEventEvidenceBytes:
    CommitMaterialWriteEventEvidenceBytesV1;
}

export interface StoredCommitAuthorityCaptureAuthorityV1 {
  readonly deploymentId: TransactionGrantDeploymentIdV1;
  readonly scopeId: ReplacementScopeIdV1;
  readonly sessionId: TransactionSessionIdV1;
  readonly attemptFence: TransactionAttemptFence;
  readonly storageGeneration: FlarexDbV1StorageGeneration;
  readonly storageGenerationFence: StorageGenerationFence;
  readonly snapshotToken: SnapshotToken;
  readonly schemaVersionId: CatalogSchemaVersionId;
}

export interface StoredCommitAuthorityEvidenceAuthorityV1
  extends StoredCommitAuthorityCaptureAuthorityV1 {
  readonly session: StoredCommitAuthoritySessionScalarsV1;
  readonly sealIdentity: StoredCommitAuthoritySealIdentityV1;
}

type StoredCommitAuthoritySessionEvidenceFieldsV1 = Readonly<{
  readonly validatedArgsJson: JsonObject;
  readonly validatedArgsCanonicalBytes: Uint8Array;
  readonly authorizationGrantJson: JsonObject;
  readonly authorizationGrantCanonicalBytes: Uint8Array;
}>;

export type StoredCommitAuthoritySessionEvidenceV1<Generation extends
  StoredCommitAuthoritySessionScalarsV1["executionAuthorityGeneration"] =
    StoredCommitAuthoritySessionScalarsV1["executionAuthorityGeneration"]> =
  Extract<StoredCommitAuthoritySessionScalarsV1, {
    readonly executionAuthorityGeneration: Generation;
  }> & StoredCommitAuthoritySessionEvidenceFieldsV1;

interface StoredCommitAuthorityEvidenceCommonV1 {
  readonly databaseNowMilliseconds: number;
  readonly currentAuthorizationRevocationEpoch: bigint;
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

export type StoredCommitAuthorityEvidenceV1 =
  | (StoredCommitAuthorityEvidenceCommonV1 & Readonly<{
      readonly session: StoredCommitAuthoritySessionEvidenceV1<
        "legacy_dynamic_worker_v1"
      >;
      readonly application?: never;
    }>)
  | (StoredCommitAuthorityEvidenceCommonV1 & Readonly<{
      readonly session: StoredCommitAuthoritySessionEvidenceV1<"application_v1">;
      readonly application: StoredCommitAuthorityApplicationEvidenceV1;
    }>);

export interface StoredCommitAuthorityApplicationEvidenceV1 {
  readonly executionAuthority: ApplicationMutationExecutionAuthorityV1;
  readonly runtimeTarget: ApplicationRuntimeTargetV1;
  readonly activationSequence: bigint;
  readonly readinessSha256: Uint8Array;
  readonly activationSha256: Uint8Array;
  readonly activeHeadSha256: Uint8Array;
  readonly publicationSha256: Uint8Array;
  readonly functionEntrySha256: Uint8Array;
  readonly schemaBindingSha256: Uint8Array;
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
  | "stableBindingMismatch"
  | "applicationGraphMissingOrDuplicate"
  | "applicationGraphInvalid";

export type StoredCommitAuthorityEvidenceLoadResultV1 =
  | Readonly<{ readonly kind: "loaded"; readonly evidence: StoredCommitAuthorityEvidenceV1 }>
  | Readonly<{
      readonly kind: "notPlannable";
      readonly reason: "lifecycle" | "rootNotSealed" | "expired";
    }>
  | StoredAuthorityMismatchResult<
        | "placementChanged"
        | "scopeChanged"
        | "attemptMissing"
        | "attemptReplaced"
        | "generationChanged"
        | "epochChanged"
        | "snapshotChanged"
        | "schemaChanged"
        | "revocationEpochChanged"
        | "sealChanged"
    >
  | StoredAuthorityCorruptionResult<StoredCommitAuthorityCorruptionReasonV1>;

export type StoredCommitAuthorityEvidencePersistenceOperationV1 =
  | "scopeMetadataRead"
  | "provisioningReceiptRead"
  | "scopeClockRead"
  | "repeatableRead"
  | "afterRepeatableRead"
  | "beforeSchemaArtifactDecode"
  | "schemaManifestCanonicalization";

export class StoredCommitAuthorityEvidencePersistenceV1Error
  extends Data.TaggedError("StoredCommitAuthorityEvidencePersistenceV1Error")<{
    readonly operation:
      StoredCommitAuthorityEvidencePersistenceOperationV1;
    readonly cause: unknown;
  }> {}

export interface StoredCommitAuthorityEvidenceLoaderV1 {
  readonly loadEffect: (
    authority: StoredCommitAuthorityEvidenceAuthorityV1,
  ) => Effect.Effect<
    StoredCommitAuthorityEvidenceLoadResultV1,
    StoredCommitAuthorityEvidencePersistenceV1Error
  >;
}

export function authorityMismatch(
  reason: Extract<
    StoredCommitAuthorityEvidenceLoadResultV1,
    { readonly kind: "authorityMismatch" }
  >["reason"],
): StoredCommitAuthorityEvidenceLoadResultV1 {
  return storedAuthorityMismatchResult(reason);
}

export function corrupt(
  reason: StoredCommitAuthorityCorruptionReasonV1,
  cause?: unknown,
): StoredCommitAuthorityEvidenceLoadResultV1 {
  return storedAuthorityCorruptionResult(reason, cause);
}
