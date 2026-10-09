import { Data } from "effect";
import type { CatalogTableId } from "flarex-protocol/catalog";
import type {
  CatalogSchemaVersionId,
  SchemaManifestAppIndexDescriptor,
  SchemaManifestAppTableName,
} from "flarex-protocol/schema-manifest";
import type { TransactionGrantDeploymentIdV1 } from "flarex-protocol/transaction-grant";

export interface ResolvePinnedPointTableIdV1Input {
  readonly deploymentId: TransactionGrantDeploymentIdV1;
  readonly schemaVersionId: CatalogSchemaVersionId;
  readonly tableName: SchemaManifestAppTableName;
}

export class PinnedPointTableNotFoundV1Error extends Data.TaggedError(
  "PinnedPointTableNotFoundV1Error",
)<{
  readonly deploymentId: TransactionGrantDeploymentIdV1;
  readonly schemaVersionId: CatalogSchemaVersionId;
  readonly tableName: SchemaManifestAppTableName;
}> {}

export class PinnedPointTableCorruptionV1Error extends Data.TaggedError(
  "PinnedPointTableCorruptionV1Error",
)<{
  readonly deploymentId: TransactionGrantDeploymentIdV1;
  readonly schemaVersionId: CatalogSchemaVersionId;
  readonly tableName: SchemaManifestAppTableName;
  readonly reason:
    | "schemaArtifactMissing"
    | "schemaArtifactInvalid"
    | "stableBindingMissing"
    | "stableBindingInvalid"
    | "stableBindingMismatch";
  readonly cause?: unknown;
}> {}

export class PinnedPointTablePersistenceV1Error extends Data.TaggedError(
  "PinnedPointTablePersistenceV1Error",
)<{
  readonly operation: "loadSchemaArtifact" | "loadStableBinding";
  readonly cause: unknown;
}> {}

export type ResolvePinnedPointTableIdV1Error =
  | PinnedPointTableNotFoundV1Error
  | PinnedPointTableCorruptionV1Error
  | PinnedPointTablePersistenceV1Error;

export interface ResolvePinnedDeveloperIndexIdV1Input {
  readonly deploymentId: TransactionGrantDeploymentIdV1;
  readonly schemaVersionId: CatalogSchemaVersionId;
  readonly tableId: CatalogTableId;
  readonly descriptor: SchemaManifestAppIndexDescriptor;
}

export class PinnedDeveloperIndexNotFoundV1Error extends Data.TaggedError(
  "PinnedDeveloperIndexNotFoundV1Error",
)<ResolvePinnedDeveloperIndexIdV1Input> {}

export class PinnedDeveloperIndexCorruptionV1Error extends Data.TaggedError(
  "PinnedDeveloperIndexCorruptionV1Error",
)<ResolvePinnedDeveloperIndexIdV1Input & {
  readonly reason: "schemaArtifactMissing" | "schemaArtifactInvalid";
  readonly cause?: unknown;
}> {}

export class PinnedDeveloperIndexPersistenceV1Error extends Data.TaggedError(
  "PinnedDeveloperIndexPersistenceV1Error",
)<{
  readonly operation: "loadSchemaArtifact";
  readonly cause: unknown;
}> {}

export type ResolvePinnedDeveloperIndexIdV1Error =
  | PinnedDeveloperIndexNotFoundV1Error
  | PinnedDeveloperIndexCorruptionV1Error
  | PinnedDeveloperIndexPersistenceV1Error;
