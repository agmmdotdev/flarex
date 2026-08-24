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
} from "flarex-protocol/storage-authority";

import type {
  ApplicationRelationCommitCorruptionError,
  ApplyApplicationRelationCommitEdgesError,
} from "../applicationRelationCommit";
import type {
  AppRelationEdgeBuildError,
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

/**
 * Foreign owner failures remain typed and visible; none are collapsed into a
 * catch-all Error channel at this private composition boundary.
 */
export type ApplicationRelationBuildError =
  | InvalidApplicationRelationBuildInputError
  | ApplicationRelationBuildUnavailableError
  | ApplicationRelationBuildStaleAuthorityError
  | ApplicationRelationBuildEnabledDefinitionError
  | ApplicationRelationBuildMismatchError
  | ApplicationRelationBuildCorruptionError
  | ApplicationRelationBuildPersistenceError
  | ApplicationRelationBuildDecisionUncertainError
  | ApplicationSchemaBindingError
  | ApplicationRelationCommitCorruptionError
  | ApplyApplicationRelationCommitEdgesError
  | AppRelationEdgeBuildError
  | AppRelationEdgeReadError
  | ReadApplicationRelationBindingError
  | ReadAppRowError
  | LockScopeClockForUpdateError
  | TrustedScopeAuthorityError;
