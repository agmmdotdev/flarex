import { Data, Schema, type Effect } from "effect";

import type {
  CatalogEdgeDefinitionId,
  CatalogRelationId,
  CatalogTableId,
} from "flarex-protocol/catalog";
import type { AppRowIdHexV1 } from "flarex-protocol/app-document-id";
import type {
  ApplicationManifestSchemaBindingSha256Hex,
  ApplicationManifestSchemaBindingV1,
  ApplicationSchemaRelationBindingV2,
} from "flarex-protocol/internal/application-schema-binding";
import type { CatalogSchemaVersion } from
  "flarex-protocol/schema-manifest";
import {
  MAX_PERSISTED_SIGNED_INT64_V1,
  type CommitSeq,
  type FlarexDbV1StorageGeneration,
  type ScopeEpoch,
  type ScopeId,
  type StorageGenerationFence,
} from "flarex-protocol/storage-authority";

import type {
  ApplicationRelationBuildOptions,
  ApplicationRelationBuildReadinessValidationError,
  ApplicationRelationBuildTransactionError,
} from "../applicationRelationBuild";
import type {
  ApplicationRelationCommitCorruptionError,
  LocatedApplicationRelationDefinition,
  LocatedApplicationRelationDefinitionSet,
} from "../applicationRelationCommit";
import type { LockScopeClockForUpdateError } from "../scopeClock";
import type { TrustedScopeAuthorityError } from
  "../scopeAuthorityResolution";
import type {
  AppRelationEdgeBuildFrontier,
  AppRelationEdgeBuildVersionFrontier,
} from "../appRelationEdges";
import type { ReadApplicationRelationBindingError } from
  "../applicationRelationBinding";

export interface ApplicationRelationReadinessInput {
  readonly deploymentId: string;
  readonly applicationManifestSha256:
    ApplicationManifestSchemaBindingV1["applicationManifestSha256"];
}

export interface PreparedApplicationRelationImmediateOrigin {
  readonly schemaVersionId:
    Extract<
      ApplicationSchemaRelationBindingV2["evolution"],
      { readonly kind: "preserve" }
    >["fromSchemaVersionId"];
  readonly relationOrdinal: number;
  readonly semanticDefinitionSha256:
    ApplicationSchemaRelationBindingV2["semanticDefinitionSha256"];
  readonly edgeDefinitionId:
    LocatedApplicationRelationDefinition["edge"]["edgeDefinitionId"];
  readonly physicalDefinitionSha256: string;
  readonly evolution: ApplicationSchemaRelationBindingV2["evolution"];
}

export interface PreparedApplicationRelation {
  readonly binding: ApplicationSchemaRelationBindingV2;
  readonly semantic: LocatedApplicationRelationDefinition["semantic"];
  readonly edge: LocatedApplicationRelationDefinition["edge"];
  readonly physicalDefinitionSha256: string;
  readonly immediateOrigin: PreparedApplicationRelationImmediateOrigin | null;
}

/** Nominal prepared token; runtime authority is held by its issuing port. */
export interface PreparedApplicationRelationReadiness {
  readonly deploymentId: LocatedApplicationRelationDefinitionSet["deploymentId"];
  readonly applicationManifestSha256:
    ApplicationManifestSchemaBindingV1["applicationManifestSha256"];
  readonly manifestSchemaBindingSha256:
    ApplicationManifestSchemaBindingSha256Hex;
  readonly applicationSchemaSha256:
    LocatedApplicationRelationDefinitionSet["applicationSchemaSha256"];
  readonly schemaVersionId:
    LocatedApplicationRelationDefinitionSet["schemaVersionId"];
  readonly schemaVersion: CatalogSchemaVersion;
  readonly schemaManifestSha256:
    LocatedApplicationRelationDefinitionSet["schemaManifestSha256"];
  readonly boundPublicationSha256:
    LocatedApplicationRelationDefinitionSet["boundPublicationSha256"];
  readonly relations: ReadonlyArray<PreparedApplicationRelation>;
}

export interface ApplicationRelationReadinessPort {
  readonly prepare: (
    input: ApplicationRelationReadinessInput,
  ) => Effect.Effect<
    PreparedApplicationRelationReadiness,
    PrepareApplicationRelationReadinessError
  >;
  readonly advance: (
    input: ApplicationRelationReadinessInput,
    options?: ApplicationRelationBuildOptions,
  ) => Effect.Effect<
    ApplicationRelationReadinessStepResult,
    AdvanceApplicationRelationReadinessError
  >;
}

export const ApplicationRelationSemanticValidationAttemptFenceSchema =
  Schema.BigInt.check(Schema.makeFilter((value) =>
    value >= 1n && value <= MAX_PERSISTED_SIGNED_INT64_V1
      ? undefined
      : `Expected a positive semantic-validation attempt fence no greater than ${MAX_PERSISTED_SIGNED_INT64_V1}`
  )).pipe(
    Schema.brand(
      "FlarexDB/ApplicationRelationSemanticValidationAttemptFence",
    ),
  );
export type ApplicationRelationSemanticValidationAttemptFence =
  typeof ApplicationRelationSemanticValidationAttemptFenceSchema.Type;
export type ApplicationRelationSemanticReadinessOriginKind =
  | "physical"
  | "semantic";
export type ApplicationRelationSemanticValidationLifecycle =
  | "validating_sources"
  | "validating_edges"
  | "validating_versions"
  | "ready";

export interface ApplicationRelationSemanticReadinessReceipt {
  readonly format: "flarex.application-relation-semantic-readiness";
  readonly version: 1;
  readonly scopeId: ScopeId;
  readonly deploymentId: string;
  readonly applicationSchemaSha256: string;
  readonly schemaVersionId: string;
  readonly schemaVersion: number;
  readonly schemaManifestSha256: string;
  readonly boundPublicationSha256: string;
  readonly relationOrdinal: number;
  readonly relationId: CatalogRelationId;
  readonly sourceTableId: CatalogTableId;
  readonly targetTableId: CatalogTableId;
  readonly semanticDefinitionSha256: string;
  readonly edgeDefinitionId: CatalogEdgeDefinitionId;
  readonly physicalDefinitionSha256: string;
  readonly originSchemaVersionId:
    PreparedApplicationRelationReadiness["schemaVersionId"];
  readonly originRelationOrdinal: number;
  readonly originReadinessKind: ApplicationRelationSemanticReadinessOriginKind;
  readonly originSemanticAttemptFence?: string;
  readonly originSemanticReadinessSha256?: string;
  readonly physicalOriginSchemaVersionId:
    PreparedApplicationRelationReadiness["schemaVersionId"];
  readonly physicalOriginRelationOrdinal: number;
  readonly physicalAttemptFence: string;
  readonly physicalReadinessSha256: string;
  readonly physicalFrontierCommitSeq: string;
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

export interface ApplicationRelationSemanticReadinessEvidence {
  readonly receipt: ApplicationRelationSemanticReadinessReceipt;
  readonly canonicalBytes: Uint8Array;
  readonly sha256: Uint8Array;
  readonly settledAt: Date;
}

export type ApplicationRelationSetReadinessKind = "physical" | "semantic";

export interface ApplicationRelationSetReadinessChild {
  readonly relationOrdinal: number;
  readonly relationId: CatalogRelationId;
  readonly sourceTableId: CatalogTableId;
  readonly targetTableId: CatalogTableId;
  readonly semanticDefinitionSha256: string;
  readonly edgeDefinitionId: CatalogEdgeDefinitionId;
  readonly physicalDefinitionSha256: string;
  readonly readinessKind: ApplicationRelationSetReadinessKind;
  readonly attemptFence: string;
  readonly readinessSha256: string;
}

/**
 * Exact immutable child references retained by one stored relation-set
 * readiness receipt. The current scope clock remains a separate input so a
 * historical frontier can be authenticated without pretending it is current.
 */
export interface StoredApplicationRelationSetReadinessReference {
  readonly frontierCommitSeq: CommitSeq;
  readonly relations: ReadonlyArray<ApplicationRelationSetReadinessChild>;
}

export interface ApplicationRelationSetReadinessReceipt {
  readonly format: "flarex.application-relation-set-readiness";
  readonly version: 1;
  readonly scopeId: ScopeId;
  readonly deploymentId: string;
  readonly applicationManifestSha256:
    PreparedApplicationRelationReadiness["applicationManifestSha256"];
  readonly manifestSchemaBindingSha256:
    PreparedApplicationRelationReadiness["manifestSchemaBindingSha256"];
  readonly applicationSchemaSha256:
    PreparedApplicationRelationReadiness["applicationSchemaSha256"];
  readonly schemaVersionId:
    PreparedApplicationRelationReadiness["schemaVersionId"];
  readonly schemaVersion: CatalogSchemaVersion;
  readonly schemaManifestSha256:
    PreparedApplicationRelationReadiness["schemaManifestSha256"];
  readonly boundPublicationSha256:
    PreparedApplicationRelationReadiness["boundPublicationSha256"];
  readonly storageGeneration: FlarexDbV1StorageGeneration;
  readonly storageGenerationFence: string;
  readonly epoch: ScopeEpoch;
  readonly frontierCommitSeq: string;
  readonly relationCount: number;
  readonly relations: ReadonlyArray<ApplicationRelationSetReadinessChild>;
}

/** Nominal whole-set evidence; runtime authority is held by its issuing port. */
export interface ApplicationRelationSetReadinessEvidence {
  readonly receipt: ApplicationRelationSetReadinessReceipt;
  readonly canonicalBytes: Uint8Array;
  readonly sha256: Uint8Array;
}

export type ApplicationRelationSetReadinessValidationResult =
  | Readonly<{
      readonly status: "ready";
      readonly evidence: ApplicationRelationSetReadinessEvidence;
    }>
  | Readonly<{
      readonly status: "not_ready";
      readonly reason:
        | "physicalReadinessMissing"
        | "semanticReadinessIncomplete";
      readonly relationOrdinal: number;
      readonly edgeDefinitionId: CatalogEdgeDefinitionId;
    }>;

export interface ApplicationRelationSemanticValidationState {
  readonly scopeId: ScopeId;
  readonly deploymentId: string;
  readonly applicationSchemaSha256: Uint8Array;
  readonly schemaVersionId: PreparedApplicationRelationReadiness["schemaVersionId"];
  readonly schemaVersion: CatalogSchemaVersion;
  readonly schemaManifestSha256: Uint8Array;
  readonly boundPublicationSha256: Uint8Array;
  readonly relationOrdinal: number;
  readonly relationId: CatalogRelationId;
  readonly sourceTableId: CatalogTableId;
  readonly targetTableId: CatalogTableId;
  readonly semanticDefinitionSha256: Uint8Array;
  readonly edgeDefinitionId: CatalogEdgeDefinitionId;
  readonly physicalDefinitionSha256: Uint8Array;
  readonly originSchemaVersionId:
    PreparedApplicationRelationReadiness["schemaVersionId"];
  readonly originRelationOrdinal: number;
  readonly originReadinessKind: ApplicationRelationSemanticReadinessOriginKind;
  readonly originSemanticAttemptFence:
    ApplicationRelationSemanticValidationAttemptFence | null;
  readonly originSemanticReadinessSha256: Uint8Array | null;
  readonly physicalOriginSchemaVersionId:
    PreparedApplicationRelationReadiness["schemaVersionId"];
  readonly physicalOriginRelationOrdinal: number;
  readonly physicalAttemptFence: bigint;
  readonly physicalReadinessSha256: Uint8Array;
  readonly physicalFrontierCommitSeq: CommitSeq;
  readonly storageGeneration: FlarexDbV1StorageGeneration;
  readonly storageGenerationFence: StorageGenerationFence;
  readonly epoch: ScopeEpoch;
  readonly frontierCommitSeq: CommitSeq;
  readonly attemptFence: ApplicationRelationSemanticValidationAttemptFence;
  readonly lifecycle: ApplicationRelationSemanticValidationLifecycle;
  readonly sourceCursorRowId: AppRowIdHexV1 | null;
  readonly edgeCursor: AppRelationEdgeBuildFrontier | null;
  readonly versionCursor: AppRelationEdgeBuildVersionFrontier | null;
  readonly validatedSourceCount: bigint;
  readonly validatedEdgeCount: bigint;
  readonly validatedVersionCount: bigint;
  readonly readinessSha256: Uint8Array | null;
}

export type ApplicationRelationReadinessStepResult =
  | Readonly<{
      readonly status: "complete";
      readonly scopeId: ScopeId;
      readonly schemaVersionId:
        PreparedApplicationRelationReadiness["schemaVersionId"];
    }>
  | Readonly<{
      readonly status: "not_ready";
      readonly reason:
        | "physicalReadinessMissing"
        | "semanticOriginMissing";
      readonly scopeId: ScopeId;
      readonly schemaVersionId:
        PreparedApplicationRelationReadiness["schemaVersionId"];
      readonly relationOrdinal: number;
      readonly edgeDefinitionId: CatalogEdgeDefinitionId;
    }>
  | Readonly<{
      readonly status:
        | "initialized"
        | "advanced"
        | "restarted"
        | "ready"
        | "replayed";
      readonly scopeId: ScopeId;
      readonly schemaVersionId:
        PreparedApplicationRelationReadiness["schemaVersionId"];
      readonly relationOrdinal: number;
      readonly edgeDefinitionId: CatalogEdgeDefinitionId;
      readonly lifecycle: ApplicationRelationSemanticValidationLifecycle;
      readonly frontierCommitSeq: CommitSeq;
      readonly attemptFence: ApplicationRelationSemanticValidationAttemptFence;
      readonly processedSourceRows: number;
      readonly processedEdges: number;
      readonly processedVersions: number;
    }>;

export class InvalidApplicationRelationReadinessInputError
  extends Data.TaggedError("InvalidApplicationRelationReadinessInputError")<{
    readonly reason:
      | "invalidInputShape"
      | "invalidDeploymentId"
      | "invalidApplicationManifestSha256";
  }> {}

export class ApplicationRelationReadinessUnavailableError
  extends Data.TaggedError("ApplicationRelationReadinessUnavailableError")<{
    readonly reason:
      | "compositionMissing"
      | "manifestBindingUnavailable"
      | "targetCapabilityMissing";
  }> {}

export class ApplicationRelationReadinessCorruptionError
  extends Data.TaggedError("ApplicationRelationReadinessCorruptionError")<{
    readonly reason:
      | "bindingMismatch"
      | "definitionSet"
      | "lineage"
      | "storedValidation"
      | "semanticReceipt"
      | "relationSetReceipt"
      | "attemptFenceExhausted"
      | "concurrentStateChange";
    readonly cause?: unknown;
  }> {}

export class ApplicationRelationReadinessStaleAuthorityError
  extends Data.TaggedError("ApplicationRelationReadinessStaleAuthorityError")<{
    readonly scopeId: ScopeId;
    readonly reason:
      | "storageGeneration"
      | "storageGenerationFence"
      | "epoch";
  }> {}

export class ApplicationRelationReadinessPersistenceError
  extends Data.TaggedError("ApplicationRelationReadinessPersistenceError")<{
    readonly operation:
      | "readValidation"
      | "insertValidation"
      | "updateValidation"
      | "readReceipt"
      | "insertReceipt"
      | "readTimestamp"
      | "digestReceipt"
      | "digestSet"
      | "targetTransaction";
    readonly retryable: boolean;
    readonly cause: unknown;
  }> {}

export class ApplicationRelationReadinessDecisionUncertainError
  extends Data.TaggedError(
    "ApplicationRelationReadinessDecisionUncertainError",
  )<{
    readonly scopeId: ScopeId;
    readonly schemaVersionId:
      PreparedApplicationRelationReadiness["schemaVersionId"];
    readonly cause: unknown;
  }> {}

export type PrepareApplicationRelationReadinessError =
  | InvalidApplicationRelationReadinessInputError
  | ApplicationRelationReadinessUnavailableError
  | ApplicationRelationReadinessCorruptionError
  | ApplicationRelationCommitCorruptionError
  | ReadApplicationRelationBindingError
  | ReadApplicationRelationBindingError<"locateManifestBinding">;

export type AdvanceApplicationRelationReadinessError =
  | PrepareApplicationRelationReadinessError
  | ApplicationRelationReadinessPersistenceError
  | ApplicationRelationReadinessDecisionUncertainError
  | ApplicationRelationReadinessStaleAuthorityError
  | ApplicationRelationBuildTransactionError
  | LockScopeClockForUpdateError
  | TrustedScopeAuthorityError;

export type ValidateApplicationRelationSetReadinessError =
  | ApplicationRelationReadinessUnavailableError
  | ApplicationRelationReadinessCorruptionError
  | ApplicationRelationReadinessPersistenceError
  | ApplicationRelationReadinessStaleAuthorityError
  | ApplicationRelationBuildReadinessValidationError;
