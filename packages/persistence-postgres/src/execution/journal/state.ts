import type { CatalogIndexId, CatalogTableId } from "flarex-protocol/catalog";
import type { CatalogSchemaVersionId, SchemaManifestAppTableName } from "flarex-protocol/schema-manifest";
import type { SnapshotToken } from "flarex-protocol/storage-authority";
import type {
  ApplicationRelationReadCapability,
  ResolvedApplicationRelationReadCapability,
} from "../../application/relations/applicationRelationRead";
import type { LocatedAppIndexDefinitionV1 } from "../../storage/indexes/appIndexDefinitions";
import type { TrustedScopeAuthority } from "../../scope/scopeAuthorityResolution";
import type { LocatedExactRunningAttemptKernelV1 } from "../transactionSessionAttemptKernel";
import type {
  PointMutationExecutionProfile,
  PointMutationSessionAttemptSelectorV1,
} from "../transactionSessionActivation";
import type { TransactionExecutionClaimPinV1 } from "../claims/transactionExecutionClaimModel";

export interface SessionJournalAttemptStateV1 {
  readonly selector: PointMutationSessionAttemptSelectorV1;
  readonly snapshotToken: SnapshotToken;
  readonly schemaVersionId: CatalogSchemaVersionId;
  readonly executionClaim: TransactionExecutionClaimPinV1;
  readonly executionProfile: PointMutationExecutionProfile;
}

export interface PinnedPointTableStateV1 {
  readonly attempt: SessionJournalAttemptStateV1;
  readonly tableName: SchemaManifestAppTableName;
  readonly tableId: CatalogTableId;
}

export interface PinnedDeveloperIndexStateV1 {
  readonly attempt: SessionJournalAttemptStateV1;
  readonly tableId: CatalogTableId;
  readonly tableName: SchemaManifestAppTableName;
  readonly logicalIndexId: CatalogIndexId;
  readonly definition: LocatedAppIndexDefinitionV1;
}

export interface PinnedApplicationRelationReadState {
  readonly attempt: SessionJournalAttemptStateV1;
  readonly capability: ApplicationRelationReadCapability;
  readonly resolved: ResolvedApplicationRelationReadCapability;
}

export interface ResolvedJournalTargetV1 {
  readonly target: LocatedExactRunningAttemptKernelV1;
  readonly authority: TrustedScopeAuthority;
}
