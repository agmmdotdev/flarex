import { Data, Effect, Result } from "effect";

import type { CatalogTableId } from "flarex-protocol/catalog";
import {
  decodeSchemaManifestAppSchemaV1Result,
  type CatalogSchemaVersionId,
  type SchemaManifestAppTableName,
} from "flarex-protocol/schema-manifest";
import type { TransactionGrantDeploymentIdV1 } from "flarex-protocol/transaction-grant";

import type { FlarexMetadataDatabase } from "./deployments";
import {
  readSchemaManifestAppTableBindingsEffect,
  SchemaManifestTableBindingPersistenceError,
} from "./schemaManifestTableBindings";
import {
  SchemaVersionArtifactPersistenceError,
  readSchemaVersionArtifactByIdEffect,
} from "./schemaVersionArtifacts";

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

/**
 * Resolves only immutable, attempt-pinned point table identity. Manifest
 * membership is authoritative; the stable deployment binding corroborates it.
 * This function never reads the mutable active-schema pointer.
 */
export const resolvePinnedPointTableIdV1Effect = Effect.fn(
  "PinnedPointTable.resolve",
)(function* (
  db: FlarexMetadataDatabase,
  input: ResolvePinnedPointTableIdV1Input,
): Effect.fn.Return<CatalogTableId, ResolvePinnedPointTableIdV1Error> {
  const artifact = yield* readSchemaVersionArtifactByIdEffect(
    db,
    input.deploymentId,
    input.schemaVersionId,
  ).pipe(
    Effect.mapError((cause) =>
      cause instanceof SchemaVersionArtifactPersistenceError
        ? new PinnedPointTablePersistenceV1Error({
            operation: "loadSchemaArtifact",
            cause: cause.cause,
          })
        : pinnedPointTableCorruption(
            input,
            "schemaArtifactInvalid",
            cause,
          )
    ),
  );
  if (artifact === null) {
    return yield* Effect.fail(pinnedPointTableCorruption(
      input,
      "schemaArtifactMissing",
    ));
  }
  const manifest = yield* Effect.fromResult(
    decodeSchemaManifestAppSchemaV1Result(artifact.manifestJson).pipe(
      Result.mapError((cause) => pinnedPointTableCorruption(
        input,
        "schemaArtifactInvalid",
        cause,
      )),
    ),
  );
  const declared = manifest.tableDefinitions.tables.find(
    (table) => table.logicalName === input.tableName,
  );
  if (declared === undefined) {
    return yield* Effect.fail(new PinnedPointTableNotFoundV1Error(input));
  }
  const bindings = yield* readSchemaManifestAppTableBindingsEffect(
    db,
    input.deploymentId,
    [input.tableName],
  ).pipe(
    Effect.mapError((cause) =>
      cause instanceof SchemaManifestTableBindingPersistenceError
        ? new PinnedPointTablePersistenceV1Error({
            operation: "loadStableBinding",
            cause: cause.cause,
          })
        : pinnedPointTableCorruption(
            input,
            "stableBindingInvalid",
            cause,
          )
    ),
  );
  const stableTableId = bindings.get(input.tableName);
  if (stableTableId === undefined) {
    return yield* Effect.fail(pinnedPointTableCorruption(
      input,
      "stableBindingMissing",
    ));
  }
  if (stableTableId !== declared.tableId) {
    return yield* Effect.fail(pinnedPointTableCorruption(
      input,
      "stableBindingMismatch",
    ));
  }
  return declared.tableId;
});

function pinnedPointTableCorruption(
  input: ResolvePinnedPointTableIdV1Input,
  reason: PinnedPointTableCorruptionV1Error["reason"],
  cause?: unknown,
): PinnedPointTableCorruptionV1Error {
  return new PinnedPointTableCorruptionV1Error({
    ...input,
    reason,
    ...(cause === undefined ? {} : { cause }),
  });
}
