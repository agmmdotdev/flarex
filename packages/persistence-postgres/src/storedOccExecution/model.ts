import { Data, Effect } from "effect";

import type { AppCreationTimeV1 } from "flarex-protocol/app-document";
import type { CatalogSchemaVersionId } from "flarex-protocol/schema-manifest";
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
  TransactionSessionLifecycleV1,
} from "flarex-protocol/transaction-session";

import type { TransactionExecutionClaimPinV1 } from
  "../transactionExecutionClaimModel";

import type {
  StoredCommitAuthorityCorruptionReasonV1,
  StoredCommitAuthorityEvidenceV1,
  StoredCommitAuthoritySessionScalarsV1,
} from "../storedCommitAuthority/model";

interface StoredOccExecutionEvidenceAuthorityBaseV1 {
  readonly deploymentId: TransactionGrantDeploymentIdV1;
  readonly scopeId: ReplacementScopeIdV1;
  readonly scopeUuid: ScopeUuidV1;
  readonly sessionId: TransactionSessionIdV1;
  readonly attemptFence: TransactionAttemptFence;
  readonly storageGeneration: FlarexDbV1StorageGeneration;
  readonly storageGenerationFence: StorageGenerationFence;
  readonly snapshotToken: SnapshotToken;
  readonly schemaVersionId: CatalogSchemaVersionId;
  /** Exact durable execution owner admitted by the same-factory caller. */
  readonly executionClaim: TransactionExecutionClaimPinV1;
}

export type StoredOccExecutionEvidenceAuthorityV1 =
  | Readonly<StoredOccExecutionEvidenceAuthorityBaseV1 & {
      readonly kind: "occRerun";
  /**
   * Same-factory finishing lineage used only as expected correlation evidence.
   * Persistence independently reloads every current authority fact.
   */
      readonly previousSession: StoredCommitAuthoritySessionScalarsV1;
    }>
  | Readonly<StoredOccExecutionEvidenceAuthorityBaseV1 & {
      /**
       * Fresh-process execution authority was derived from a genuine acquired
       * claim plus the current O03 attempt loader. No previous plan is trusted.
       */
      readonly kind: "claimedAttempt";
    }>
  | Readonly<StoredOccExecutionEvidenceAuthorityBaseV1 & {
      /**
       * Fresh-process replacement authority for a durable running relation
       * conflict. It authenticates the current attempt without making that
       * advanced journal executable as a pristine attempt.
       */
      readonly kind: "claimedRelationConflict";
    }>;

export type StoredOccExecutionEvidenceV1 = StoredCommitAuthorityEvidenceV1 & Readonly<{
  /** Trusted fresh-root seed; databaseNow is liveness evidence only. */
  readonly creationTimeSeed: AppCreationTimeV1;
}>;

export type StoredOccExecutionCorruptionReasonV1 =
  | StoredCommitAuthorityCorruptionReasonV1
  | "durableRetrying"
  | "executionClaimInvalid"
  | "journalRootNotPristine"
  | "relationConflictEvidenceInvalid"
  | "journalChildrenPresent";

export type StoredOccExecutionEvidenceLoadResultV1 =
  | Readonly<{
      readonly kind: "loaded";
      readonly evidence: StoredOccExecutionEvidenceV1;
    }>
  | Readonly<{
      readonly kind: "alreadyCommitted";
      readonly updatedAtMilliseconds: number;
    }>
  | Readonly<{
      readonly kind: "notExecutable";
      readonly reason: "lifecycle" | "expired" | "notPristine";
      readonly lifecycle?: TransactionSessionLifecycleV1;
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
        | "executionClaimChanged"
        | "sessionChanged";
    }>
  | Readonly<{
      readonly kind: "corrupt";
      readonly reason: StoredOccExecutionCorruptionReasonV1;
      readonly cause?: unknown;
    }>;

export type StoredOccExecutionEvidencePersistenceOperationV1 =
  | "scopeMetadataRead"
  | "provisioningReceiptRead"
  | "scopeClockRead"
  | "repeatableRead"
  | "afterRepeatableRead"
  | "beforeSchemaArtifactDecode"
  | "schemaManifestCanonicalization";

export class StoredOccExecutionEvidencePersistenceV1Error extends Data.TaggedError(
  "StoredOccExecutionEvidencePersistenceV1Error",
)<{
  readonly operation: StoredOccExecutionEvidencePersistenceOperationV1;
  readonly cause: unknown;
}> {}

export interface StoredOccExecutionEvidenceLoaderV1 {
  readonly loadEffect: (
    authority: StoredOccExecutionEvidenceAuthorityV1,
  ) => Effect.Effect<
    StoredOccExecutionEvidenceLoadResultV1,
    StoredOccExecutionEvidencePersistenceV1Error
  >;
}

export function occExecutionAuthorityMismatch(
  reason: Extract<
    StoredOccExecutionEvidenceLoadResultV1,
    { readonly kind: "authorityMismatch" }
  >["reason"],
): StoredOccExecutionEvidenceLoadResultV1 {
  return Object.freeze({ kind: "authorityMismatch", reason });
}

export function occExecutionCorrupt(
  reason: StoredOccExecutionCorruptionReasonV1,
  cause?: unknown,
): StoredOccExecutionEvidenceLoadResultV1 {
  return Object.freeze({
    kind: "corrupt",
    reason,
    ...(cause === undefined ? {} : { cause }),
  });
}
