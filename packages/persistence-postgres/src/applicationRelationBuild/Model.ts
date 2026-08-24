import { Data, type Effect } from "effect";

import type { AppRowIdHexV1 } from "flarex-protocol/app-document-id";
import type {
  CatalogEdgeDefinitionId,
  CatalogRelationId,
  CatalogTableId,
} from "flarex-protocol/catalog";
import type { ApplicationSchemaBindingError } from
  "flarex-protocol/internal/application-schema-binding";
import type { CatalogSchemaVersionId } from
  "flarex-protocol/schema-manifest";
import type {
  CommitSeq,
  FlarexDbV1StorageGeneration,
  ScopeEpoch,
  ScopeId,
  StorageGenerationFence,
} from "flarex-protocol/storage-authority";

import type {
  ApplicationRelationCommitCorruptionError,
  ApplyApplicationRelationCommitEdgesError,
} from "../applicationRelationCommit";
import type {
  AppRelationEdgeBuildError,
  AppRelationEdgeBuildFrontier,
  AppRelationEdgeBuildVersionFrontier,
  AppRelationEdgeReadError,
} from "../appRelationEdges";
import type { ReadApplicationRelationBindingError } from
  "../applicationRelationBinding";
import type { ReadAppRowError } from "../appRows";
import type { LockScopeClockForUpdateError } from "../scopeClock";
import type { TrustedScopeAuthorityError } from
  "../scopeAuthorityResolution";

export type ApplicationRelationBuildLifecycle =
  | "cleaning"
  | "backfilling"
  | "validating_sources"
  | "validating_edges"
  | "validating_versions"
  | "enabled";

export type ApplicationRelationBuildAttemptFence = bigint;

export interface ApplicationRelationBuildInput {
  readonly deploymentId: string;
  readonly schemaVersionId: CatalogSchemaVersionId;
  readonly edgeDefinitionId: CatalogEdgeDefinitionId;
}

export type ApplicationRelationBuildFaultPoint =
  | "afterScopeClockLock"
  | "afterCleanup"
  | "afterBackfillRow"
  | "afterValidationRow"
  | "afterReceiptInsert"
  | "afterLifecycleTransition";

export type ApplicationRelationBuildQueryName =
  | "readSourceCurrentBatch"
  | "readSourceRevisionBatch"
  | "readTargetCurrentBatch"
  | "readEdgeEndpointVersionsBatch"
  | "readVersionEndpointPresenceBatch";

export interface ApplicationRelationBuildQueryObservation {
  readonly name: ApplicationRelationBuildQueryName;
  readonly requestedRows: number;
}

export interface ApplicationRelationBuildOptions {
  /** Test-only failure injection inside the owning target transaction. */
  readonly faultAfter?: (
    point: ApplicationRelationBuildFaultPoint,
  ) => void | Promise<void>;
  /** Test-only proof that high-fanout validation stays set-based. */
  readonly observeQuery?: (
    observation: ApplicationRelationBuildQueryObservation,
  ) => void;
}

export interface ApplicationRelationBuildStepResult {
  readonly status:
    | "initialized"
    | "advanced"
    | "restarted"
    | "enabled"
    | "replayed";
  readonly scopeId: ScopeId;
  readonly edgeDefinitionId: CatalogEdgeDefinitionId;
  readonly lifecycle: ApplicationRelationBuildLifecycle;
  readonly frontierCommitSeq: CommitSeq;
  readonly attemptFence: ApplicationRelationBuildAttemptFence;
  readonly processedSourceRows: number;
  readonly processedEdges: number;
  readonly processedVersions: number;
  readonly deletedEdges: number;
  readonly deletedVersions: number;
}

export type ApplicationRelationSemanticValidationLifecycle =
  | "validating_sources"
  | "validating_edges"
  | "validating_versions"
  | "ready";

/** Opaque-to-the-facet monotonic fence supplied by its validation owner. */
export type ApplicationRelationValidationAttemptFence = bigint;

export interface ApplicationRelationSemanticValidationProgress {
  readonly relationOrdinal: number;
  readonly lifecycle: Exclude<
    ApplicationRelationSemanticValidationLifecycle,
    "ready"
  >;
  readonly rootFrontierCommitSeq: CommitSeq;
  readonly frontierCommitSeq: CommitSeq;
  readonly attemptFence: ApplicationRelationValidationAttemptFence;
  readonly sourceCursorRowId: AppRowIdHexV1 | null;
  readonly edgeCursor: AppRelationEdgeBuildFrontier | null;
  readonly versionCursor: AppRelationEdgeBuildVersionFrontier | null;
  readonly validatedSourceCount: bigint;
  readonly validatedEdgeCount: bigint;
  readonly validatedVersionCount: bigint;
}

export interface ApplicationRelationSemanticValidationPageResult {
  readonly relationOrdinal: number;
  readonly lifecycle: ApplicationRelationSemanticValidationLifecycle;
  readonly rootFrontierCommitSeq: CommitSeq;
  readonly frontierCommitSeq: CommitSeq;
  readonly attemptFence: ApplicationRelationValidationAttemptFence;
  readonly sourceCursorRowId: AppRowIdHexV1 | null;
  readonly edgeCursor: AppRelationEdgeBuildFrontier | null;
  readonly versionCursor: AppRelationEdgeBuildVersionFrontier | null;
  readonly validatedSourceCount: bigint;
  readonly validatedEdgeCount: bigint;
  readonly validatedVersionCount: bigint;
  readonly processedSourceRows: number;
  readonly processedEdges: number;
  readonly processedVersions: number;
}

export interface ApplicationRelationReadinessReceipt {
  readonly format: "flarex.application-relation-readiness";
  readonly version: 1;
  readonly scopeId: ScopeId;
  readonly deploymentId: string;
  readonly relationId: CatalogRelationId;
  readonly edgeDefinitionId: CatalogEdgeDefinitionId;
  readonly sourceTableId: CatalogTableId;
  readonly targetTableId: CatalogTableId;
  readonly semanticDefinitionSha256: string;
  readonly physicalDefinitionSha256: string;
  readonly storageGeneration: FlarexDbV1StorageGeneration;
  readonly storageGenerationFence: string;
  readonly epoch: ScopeEpoch;
  readonly frontierCommitSeq: string;
  readonly attemptFence: string;
  readonly sourceCount: string;
  readonly edgeCount: string;
  readonly versionCount: string;
  readonly settledAt: string;
}

export interface ApplicationRelationReadinessEvidence {
  readonly receipt: ApplicationRelationReadinessReceipt;
  readonly canonicalBytes: Uint8Array;
  readonly sha256: Uint8Array;
  readonly settledAt: Date;
}

/**
 * Exact immutable E01-A receipt reference retained by semantic-readiness
 * evidence. The semantic owner supplies physical identity only; E01-A remains
 * responsible for authenticating its own canonical receipt bytes.
 */
export interface ApplicationRelationBuildReadinessReference {
  readonly scopeId: ScopeId;
  readonly deploymentId: string;
  readonly relationId: CatalogRelationId;
  readonly edgeDefinitionId: CatalogEdgeDefinitionId;
  readonly sourceTableId: CatalogTableId;
  readonly targetTableId: CatalogTableId;
  readonly physicalDefinitionSha256: Uint8Array;
  readonly storageGeneration: FlarexDbV1StorageGeneration;
  readonly storageGenerationFence: StorageGenerationFence;
  readonly epoch: ScopeEpoch;
  readonly frontierCommitSeq: CommitSeq;
  readonly attemptFence: ApplicationRelationBuildAttemptFence;
  readonly readinessSha256: Uint8Array;
}

export interface ApplicationRelationBuildPort {
  readonly advance: (
    input: ApplicationRelationBuildInput,
    options?: ApplicationRelationBuildOptions,
  ) => Effect.Effect<ApplicationRelationBuildStepResult, ApplicationRelationBuildError>;
  readonly restart: (
    input: ApplicationRelationBuildInput,
    options?: ApplicationRelationBuildOptions,
  ) => Effect.Effect<ApplicationRelationBuildStepResult, ApplicationRelationBuildError>;
  readonly readiness: (
    input: ApplicationRelationBuildInput,
  ) => Effect.Effect<
    ApplicationRelationReadinessEvidence | null,
    ApplicationRelationBuildError
  >;
}

export class InvalidApplicationRelationBuildInputError extends Data.TaggedError(
  "InvalidApplicationRelationBuildInputError",
)<{
  readonly reason:
    | "invalidInputShape"
    | "invalidDeploymentId"
    | "invalidSchemaVersionId"
    | "invalidEdgeDefinitionId";
}> {}

export class ApplicationRelationBuildUnavailableError extends Data.TaggedError(
  "ApplicationRelationBuildUnavailableError",
)<{
  readonly reason:
    | "compositionMissing"
    | "targetCapabilityMissing"
    | "bindingUnavailable"
    | "definitionUnavailable";
}> {}

export class ApplicationRelationBuildStaleAuthorityError
  extends Data.TaggedError("ApplicationRelationBuildStaleAuthorityError")<{
    readonly scopeId: ScopeId;
    readonly edgeDefinitionId: CatalogEdgeDefinitionId;
    readonly reason:
      | "storageGeneration"
      | "storageGenerationFence"
      | "epoch";
  }> {}

export class ApplicationRelationBuildEnabledDefinitionError
  extends Data.TaggedError("ApplicationRelationBuildEnabledDefinitionError")<{
    readonly scopeId: ScopeId;
    readonly edgeDefinitionId: CatalogEdgeDefinitionId;
    readonly reason: "bindingMoved";
  }> {}

export class ApplicationRelationBuildMismatchError extends Data.TaggedError(
  "ApplicationRelationBuildMismatchError",
)<{
  readonly scopeId: ScopeId;
  readonly edgeDefinitionId: CatalogEdgeDefinitionId;
  readonly lifecycle: Exclude<ApplicationRelationBuildLifecycle, "enabled">;
  readonly reason:
    | "invalidSourceValue"
    | "targetNotLive"
    | "sourceContents"
    | "edgeContents"
    | "edgeEndpointVersion"
    | "orphanVersion"
    | "versionValue"
    | "sourceCount";
  readonly rowId?: AppRowIdHexV1;
  readonly cause?: unknown;
}> {}

export class ApplicationRelationBuildCorruptionError extends Data.TaggedError(
  "ApplicationRelationBuildCorruptionError",
)<{
  readonly reason:
    | "storedHead"
    | "immutableDefinition"
    | "attemptFenceExhausted"
    | "receiptEvidence"
    | "concurrentStateChange"
    | "invalidRowIdentity"
    | "currentRowEvidence"
    | "futureCurrentRevision"
    | "lowererResourceExhaustion";
  readonly cause?: unknown;
}> {}

export class ApplicationRelationBuildPersistenceError extends Data.TaggedError(
  "ApplicationRelationBuildPersistenceError",
)<{
  readonly operation:
    | "readHead"
    | "insertHead"
    | "updateHead"
    | "readSourcePage"
    | "readReceipt"
    | "insertReceipt"
    | "readCurrentRows"
    | "targetTransaction"
    | "resolveTargetCapability"
    | "digestReceipt";
  readonly retryable: boolean;
  readonly cause: unknown;
}> {}

export class ApplicationRelationBuildDecisionUncertainError
  extends Data.TaggedError("ApplicationRelationBuildDecisionUncertainError")<{
    readonly scopeId: ScopeId;
    readonly edgeDefinitionId: CatalogEdgeDefinitionId;
    readonly cause: unknown;
  }> {}

/** Failures that can originate while a caller-owned target transaction runs. */
export type ApplicationRelationBuildTransactionError =
  | ApplicationRelationBuildUnavailableError
  | ApplicationRelationBuildStaleAuthorityError
  | ApplicationRelationBuildEnabledDefinitionError
  | ApplicationRelationBuildMismatchError
  | ApplicationRelationBuildCorruptionError
  | ApplicationRelationBuildPersistenceError
  | ApplicationSchemaBindingError
  | ApplicationRelationCommitCorruptionError
  | ApplyApplicationRelationCommitEdgesError
  | AppRelationEdgeBuildError
  | AppRelationEdgeReadError
  | ReadAppRowError
  | LockScopeClockForUpdateError;

/**
 * Foreign owner failures remain typed and visible; none are collapsed into a
 * catch-all Error channel at this private composition boundary.
 */
export type ApplicationRelationBuildError =
  | InvalidApplicationRelationBuildInputError
  | ApplicationRelationBuildDecisionUncertainError
  | ReadApplicationRelationBindingError
  | TrustedScopeAuthorityError
  | ApplicationRelationBuildTransactionError;
