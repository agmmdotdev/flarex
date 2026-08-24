import { Data, type Effect } from "effect";

import type {
  AppDocumentIdV1,
  AppRowIdHexV1,
} from "flarex-protocol/app-document-id";
import type {
  CatalogRelationId,
  CatalogTableId,
} from "flarex-protocol/catalog";
import type {
  ApplicationSchemaBindingSha256Hex,
  ApplicationSchemaBindingV2,
  ApplicationSchemaRelationBindingV2,
  SemanticRelationDefinitionV1,
} from "flarex-protocol/internal/application-schema-binding";
import { RELATION_TRANSACTION_MAXIMUM_BASE_OCCURRENCES_V1 } from
  "flarex-protocol/internal/application-schema-binding";
import type { CatalogSchemaVersionId } from
  "flarex-protocol/schema-manifest";
import type { CanonicalFlarexValueV1 } from "flarex-protocol/value";
import type { CommitSeq, ScopeId } from
  "flarex-protocol/storage-authority";
import type { TransactionGrantDeploymentIdV1 } from
  "flarex-protocol/transaction-grant";

import type {
  AppRelationEdgeDefinitionPin,
  AppRelationEdgeMutationError,
  AppRelationEdgeStorageAction,
} from "../appRelationEdges";
import type { ReadApplicationRelationBindingError } from
  "../applicationRelationBinding";

export const MAX_APPLICATION_RELATION_PRIOR_OCCURRENCES =
  RELATION_TRANSACTION_MAXIMUM_BASE_OCCURRENCES_V1;
export const MAX_APPLICATION_RELATION_FINAL_OCCURRENCES =
  RELATION_TRANSACTION_MAXIMUM_BASE_OCCURRENCES_V1;
export const MAX_APPLICATION_RELATION_EDGE_ACTIONS =
  RELATION_TRANSACTION_MAXIMUM_BASE_OCCURRENCES_V1;
export const MAX_APPLICATION_RELATION_FINAL_TARGETS =
  RELATION_TRANSACTION_MAXIMUM_BASE_OCCURRENCES_V1;
export const MAX_APPLICATION_RELATION_RESTRICT_PROBES =
  RELATION_TRANSACTION_MAXIMUM_BASE_OCCURRENCES_V1;

export interface LocatedApplicationRelationDefinition {
  readonly binding: ApplicationSchemaRelationBindingV2;
  readonly semantic: SemanticRelationDefinitionV1;
  readonly edge: AppRelationEdgeDefinitionPin;
}

export interface LocatedApplicationRelationDefinitionSet {
  readonly deploymentId: TransactionGrantDeploymentIdV1;
  readonly schemaVersionId: CatalogSchemaVersionId;
  readonly applicationSchemaSha256:
    ApplicationSchemaBindingV2["applicationSchemaSha256"];
  readonly schemaManifestSha256:
    ApplicationSchemaBindingV2["schemaManifestSha256"];
  readonly boundPublicationSha256: ApplicationSchemaBindingSha256Hex;
  readonly definitions: ReadonlyArray<LocatedApplicationRelationDefinition>;
}

export interface LocateApplicationRelationDefinitionsInput {
  readonly deploymentId: TransactionGrantDeploymentIdV1;
  readonly schemaVersionId: CatalogSchemaVersionId;
}

export interface ApplicationRelationCommitPort {
  readonly locate: (
    input: LocateApplicationRelationDefinitionsInput,
  ) => Effect.Effect<
    LocatedApplicationRelationDefinitionSet | null,
    ReadApplicationRelationBindingError |
      ApplicationRelationCommitCorruptionError
  >;
}

export class ApplicationRelationCommitUnavailableError
  extends Data.TaggedError("ApplicationRelationCommitUnavailableError")<{
    readonly reason: "compositionMissing" | "bindingUnavailable";
  }> {}

export type ApplicationRelationConstraintReason =
  | "missingRequiredValue"
  | "invalidRelationValue"
  | "relationCardinalityViolation"
  | "duplicateTarget";

export class ApplicationRelationConstraintError extends Data.TaggedError(
  "ApplicationRelationConstraintError",
)<{
  readonly reason: ApplicationRelationConstraintReason;
  readonly relationId: CatalogRelationId;
  readonly sourceDocumentId: AppDocumentIdV1;
  readonly cause?: unknown;
}> {}

export class ApplicationRelationCommitResourceExhaustionError
  extends Data.TaggedError(
    "ApplicationRelationCommitResourceExhaustionError",
  )<{
    readonly dimension:
      | "priorOccurrences"
      | "finalOccurrences"
      | "edgeActions"
      | "finalTargets"
      | "restrictProbes";
    readonly observed: number;
    readonly maximum: number;
  }> {}

export class ApplicationRelationCommitCorruptionError extends Data.TaggedError(
  "ApplicationRelationCommitCorruptionError",
)<{
  readonly reason:
    | "invalidDefinitionSet"
    | "invalidDocumentTransition"
    | "invalidPriorRelationValue";
  readonly cause?: unknown;
}> {}

export class ApplicationRelationTargetNotLiveError extends Data.TaggedError(
  "ApplicationRelationTargetNotLiveError",
)<{
  readonly targetDocumentId: AppDocumentIdV1;
}> {}

export class ApplicationRelationTargetDeleteRestrictedError
  extends Data.TaggedError(
    "ApplicationRelationTargetDeleteRestrictedError",
  )<{
    readonly relationId: CatalogRelationId;
    readonly targetDocumentId: AppDocumentIdV1;
  }> {}

export interface ApplicationRelationRowTransition {
  readonly documentId: AppDocumentIdV1;
  readonly tableId: CatalogTableId;
  readonly rowId: AppRowIdHexV1;
  readonly prior: CanonicalFlarexValueV1 | null;
  readonly final: CanonicalFlarexValueV1 | null;
}

export interface ApplicationRelationStoredTargetCheck {
  readonly documentId: AppDocumentIdV1;
  readonly tableId: CatalogTableId;
  readonly rowId: AppRowIdHexV1;
  readonly relationId: CatalogRelationId;
  readonly sourceDocumentId: AppDocumentIdV1;
}

export interface ApplicationRelationRestrictProbe {
  readonly relationId: CatalogRelationId;
  readonly definition: AppRelationEdgeDefinitionPin;
  readonly targetDocumentId: AppDocumentIdV1;
  readonly targetRowId: AppRowIdHexV1;
}

export interface PreparedApplicationRelationCommit {
  readonly actions: ReadonlyArray<AppRelationEdgeStorageAction>;
  readonly storedTargetChecks:
    ReadonlyArray<ApplicationRelationStoredTargetCheck>;
  readonly restrictProbes: ReadonlyArray<ApplicationRelationRestrictProbe>;
  readonly priorOccurrenceCount: number;
  readonly finalOccurrenceCount: number;
  readonly distinctFinalTargetCount: number;
}

export type PrepareApplicationRelationCommitError =
  | ApplicationRelationConstraintError
  | ApplicationRelationCommitResourceExhaustionError
  | ApplicationRelationCommitCorruptionError
  | ApplicationRelationTargetNotLiveError;

export interface ApplyApplicationRelationCommitEdgesInput {
  readonly scopeId: ScopeId;
  readonly schemaVersionId: CatalogSchemaVersionId;
  readonly commitSeq: CommitSeq;
  readonly prepared: PreparedApplicationRelationCommit;
}

export type ApplyApplicationRelationCommitEdgesError =
  | ApplicationRelationCommitUnavailableError
  | AppRelationEdgeMutationError;
