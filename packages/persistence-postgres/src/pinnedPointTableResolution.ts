import { Data } from "effect";

import type { CatalogTableId } from "flarex-protocol/catalog";
import {
  decodeSchemaManifestAppSchemaV1,
  type CatalogSchemaVersionId,
  type SchemaManifestAppTableName,
} from "flarex-protocol/schema-manifest";
import type { TransactionGrantDeploymentIdV1 } from "flarex-protocol/transaction-grant";

import type { FlarexMetadataDatabase } from "./deployments";
import { readSchemaManifestAppTableBindings } from "./schemaManifestTableBindings";
import { getSchemaVersionArtifactById } from "./schemaVersionArtifacts";

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
    | "stableBindingMissing"
    | "stableBindingMismatch";
}> {}

/**
 * Resolves only immutable, attempt-pinned point table identity. Manifest
 * membership is authoritative; the stable deployment binding corroborates it.
 * This function never reads the mutable active-schema pointer.
 */
export async function resolvePinnedPointTableIdV1(
  db: FlarexMetadataDatabase,
  input: ResolvePinnedPointTableIdV1Input,
): Promise<CatalogTableId> {
  const artifact = await getSchemaVersionArtifactById(
    db,
    input.deploymentId,
    input.schemaVersionId,
  );
  if (artifact === null) {
    throw new PinnedPointTableCorruptionV1Error({
      ...input,
      reason: "schemaArtifactMissing",
    });
  }
  const manifest = decodeSchemaManifestAppSchemaV1(artifact.manifestJson);
  const declared = manifest.tableDefinitions.tables.find(
    (table) => table.logicalName === input.tableName,
  );
  if (declared === undefined) {
    throw new PinnedPointTableNotFoundV1Error(input);
  }
  const bindings = await readSchemaManifestAppTableBindings(
    db,
    input.deploymentId,
    [input.tableName],
  );
  const stableTableId = bindings.get(input.tableName);
  if (stableTableId === undefined) {
    throw new PinnedPointTableCorruptionV1Error({
      ...input,
      reason: "stableBindingMissing",
    });
  }
  if (stableTableId !== declared.tableId) {
    throw new PinnedPointTableCorruptionV1Error({
      ...input,
      reason: "stableBindingMismatch",
    });
  }
  return declared.tableId;
}
