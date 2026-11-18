import {
  PinnedPointTableNotFoundV1Error,
  PinnedPointTableCorruptionV1Error,
  PinnedPointTablePersistenceV1Error,
  PinnedDeveloperIndexNotFoundV1Error,
  PinnedDeveloperIndexCorruptionV1Error,
  PinnedDeveloperIndexPersistenceV1Error,
} from "./pinnedPointTableErrors";
import type {
  ResolvePinnedPointTableIdV1Input,
  ResolvePinnedPointTableIdV1Error,
  ResolvePinnedDeveloperIndexIdV1Input,
  ResolvePinnedDeveloperIndexIdV1Error,
} from "./pinnedPointTableErrors";
import { Effect, Result } from "effect";

import type { CatalogIndexId, CatalogTableId } from "flarex-protocol/catalog";
import { decodeSchemaManifestAppSchemaV1Result } from "flarex-protocol/schema-manifest";

import type { FlarexMetadataDatabase } from "../../application/deployments";
import {
  readSchemaManifestAppTableBindingsEffect,
  SchemaManifestTableBindingPersistenceError,
} from "../catalog/schemaManifestTableBindings";
import {
  SchemaVersionArtifactPersistenceError,
  readSchemaVersionArtifactByIdEffect,
} from "../catalog/schemaVersionArtifacts";

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

/**
 * Resolves a developer-facing index descriptor to the immutable numeric
 * catalog identity pinned by the attempt's exact schema artifact. The caller
 * supplies a table ID that was already resolved from that same artifact.
 */
export const resolvePinnedDeveloperIndexIdV1Effect = Effect.fn(
  "PinnedDeveloperIndex.resolve",
)(function* (
  db: FlarexMetadataDatabase,
  input: ResolvePinnedDeveloperIndexIdV1Input,
): Effect.fn.Return<CatalogIndexId, ResolvePinnedDeveloperIndexIdV1Error> {
  const artifact = yield* readSchemaVersionArtifactByIdEffect(
    db,
    input.deploymentId,
    input.schemaVersionId,
  ).pipe(
    Effect.mapError((cause) =>
      cause instanceof SchemaVersionArtifactPersistenceError
        ? new PinnedDeveloperIndexPersistenceV1Error({
            operation: "loadSchemaArtifact",
            cause: cause.cause,
          })
        : pinnedDeveloperIndexCorruption(
            input,
            "schemaArtifactInvalid",
            cause,
          )
    ),
  );
  if (artifact === null) {
    return yield* Effect.fail(pinnedDeveloperIndexCorruption(
      input,
      "schemaArtifactMissing",
    ));
  }
  const manifest = yield* Effect.fromResult(
    decodeSchemaManifestAppSchemaV1Result(artifact.manifestJson).pipe(
      Result.mapError((cause) => pinnedDeveloperIndexCorruption(
        input,
        "schemaArtifactInvalid",
        cause,
      )),
    ),
  );
  const matches = manifest.indexBindings.indexes.filter((index) =>
    index.tableId === input.tableId && index.descriptor === input.descriptor
  );
  if (matches.length !== 1) {
    return yield* Effect.fail(
      matches.length === 0
        ? new PinnedDeveloperIndexNotFoundV1Error(input)
        : pinnedDeveloperIndexCorruption(input, "schemaArtifactInvalid"),
    );
  }
  return matches[0]!.logicalIndexId;
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

function pinnedDeveloperIndexCorruption(
  input: ResolvePinnedDeveloperIndexIdV1Input,
  reason: PinnedDeveloperIndexCorruptionV1Error["reason"],
  cause?: unknown,
): PinnedDeveloperIndexCorruptionV1Error {
  return new PinnedDeveloperIndexCorruptionV1Error({
    ...input,
    reason,
    ...(cause === undefined ? {} : { cause }),
  });
}
