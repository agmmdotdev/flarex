import type {
  CatalogSchemaVersionId,
  SchemaManifestAppIndexBindingV1,
  SchemaManifestAppTableDefinitionV1,
  SchemaManifestSha256,
} from "flarex-protocol/schema-manifest";
import type {
  CommitSeq,
  FlarexDbV1StorageGeneration,
  ScopeEpoch,
  ScopeId,
  StorageGenerationFence,
} from "flarex-protocol/storage-authority";

import type {
  AppSchemaEvolutionChange,
  AppSchemaEvolutionClassification,
} from "./Model";

type TableId = SchemaManifestAppTableDefinitionV1["tableId"];
type TableName = SchemaManifestAppTableDefinitionV1["logicalName"];
type LogicalIndexId = SchemaManifestAppIndexBindingV1["logicalIndexId"];
type IndexDescriptor = SchemaManifestAppIndexBindingV1["descriptor"];

export interface AppSchemaEvolutionPlanAuthorityPinsV1 {
  readonly scopeId: ScopeId;
  readonly storageGeneration: FlarexDbV1StorageGeneration;
  readonly storageGenerationFence: StorageGenerationFence;
  readonly scopeEpoch: ScopeEpoch;
  readonly activeSchemaVersionId: CatalogSchemaVersionId;
  readonly activeManifestSha256: SchemaManifestSha256;
  readonly candidateSchemaVersionId: CatalogSchemaVersionId;
  readonly candidateManifestSha256: SchemaManifestSha256;
  readonly dataFrontierCommitSeq: CommitSeq;
}

export type AppSchemaRenameIntentV1 =
  | Readonly<{
      readonly kind: "table";
      readonly tableId: TableId;
      readonly fromLogicalName: TableName;
      readonly toLogicalName: TableName;
    }>
  | Readonly<{
      readonly kind: "index";
      readonly logicalIndexId: LogicalIndexId;
      readonly tableId: TableId;
      readonly fromDescriptor: IndexDescriptor;
      readonly toDescriptor: IndexDescriptor;
    }>;

export type AppSchemaResolvedRenameV1 = AppSchemaRenameIntentV1;

export type AppSchemaEvolutionPlanOperationV1 = Readonly<{
  readonly ordinal: number;
  readonly safetyClass:
    | "metadataOnly"
    | "requiresDataValidation"
    | "requiresPhysicalWork"
    | "blockedIdentity";
  readonly change: AppSchemaEvolutionChange;
}>;

export type AppSchemaEvolutionPlanBlockerCodeV1 =
  | "explicitTableRenameIntentRequired"
  | "explicitIndexRenameIntentRequired"
  | "tableIdentityReplacement"
  | "indexIdentityReplacement"
  | "tableReplacementAmbiguous"
  | "indexReplacementAmbiguous"
  | "indexMovedAcrossTables";

export type AppSchemaEvolutionPlanEvidenceV1 =
  | Readonly<{
      readonly code: AppSchemaEvolutionPlanBlockerCodeV1;
      readonly tableId?: TableId;
      readonly logicalName?: TableName;
      readonly logicalIndexId?: LogicalIndexId;
      readonly descriptor?: IndexDescriptor;
    }>
  | Readonly<{
      readonly code: "candidateDocumentValidationRequired";
      readonly tableId: TableId;
      readonly logicalName: TableName;
      readonly validatorPath: string;
      readonly reason: "narrowingOrUnknown" | "comparisonBudgetExceeded";
    }>
  | Readonly<{
      readonly code: "candidateTableEmptinessValidationRequired";
      readonly tableId: TableId;
      readonly logicalName: TableName;
    }>;

export type AppSchemaEvolutionRemediationActionV1 =
  | "declareStableIdentityRenameIntent"
  | "regenerateCandidatePreservingStableIdentity"
  | "validateCandidateDocumentsAtPinnedFrontier"
  | "emptyRemovedTablesThenReplanAtNewFrontier"
  | "buildOrRetireCandidateIndexes"
  | "resolveEveryBlockingIdentityDecision";

export type AppSchemaEvolutionActivationPrerequisiteV1 =
  | "activeAuthorityPinsStillMatch"
  | "candidateArtifactDigestStillMatches"
  | "dataFrontierStillCoversValidation"
  | "requiredPhysicalBuildsAreEnabled"
  | "planHasNoIdentityBlockers"
  | "recomputedPlanDigestMatches";

export type AppSchemaEvolutionRollbackPrerequisiteV1 =
  | "previousActiveArtifactRetained"
  | "rollbackTargetAuthorityRevalidated"
  | "rollbackUsesExistingActivationOwner";

export interface AppSchemaEvolutionPlanV1 {
  readonly format: "flarex.managed-schema/evolution-plan/v1";
  readonly planVersion: 1;
  readonly authority: Readonly<{
    readonly scopeId: ScopeId;
    readonly storageGeneration: FlarexDbV1StorageGeneration;
    readonly storageGenerationFence: string;
    readonly scopeEpoch: ScopeEpoch;
    readonly activeSchemaVersionId: CatalogSchemaVersionId;
    readonly activeManifestSha256Hex: string;
    readonly candidateSchemaVersionId: CatalogSchemaVersionId;
    readonly candidateManifestSha256Hex: string;
    readonly dataFrontierCommitSeq: string;
  }>;
  readonly disposition: AppSchemaEvolutionClassification["disposition"];
  readonly classification: Readonly<Omit<AppSchemaEvolutionClassification, "changes">>;
  readonly resolvedRenames: ReadonlyArray<AppSchemaResolvedRenameV1>;
  readonly operations: ReadonlyArray<AppSchemaEvolutionPlanOperationV1>;
  readonly incompatibilityEvidence: Readonly<{
    readonly entries: ReadonlyArray<AppSchemaEvolutionPlanEvidenceV1>;
    readonly observedCount: number;
    readonly truncated: boolean;
  }>;
  readonly remediationActions: ReadonlyArray<AppSchemaEvolutionRemediationActionV1>;
  readonly activationPrerequisites: ReadonlyArray<AppSchemaEvolutionActivationPrerequisiteV1>;
  readonly rollbackPrerequisites: ReadonlyArray<AppSchemaEvolutionRollbackPrerequisiteV1>;
  readonly canonicalText: string;
  readonly planSha256Hex: string;
}
