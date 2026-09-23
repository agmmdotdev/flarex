import { Data, Effect } from "effect";
import type { CatalogTableId } from "flarex-protocol/catalog";
import type { QualifiedLogicalTable } from "flarex-protocol/internal/logical-schema-candidate";
import type { Json } from "flarex-protocol/json";
import { decodeSchemaManifestAppSchemaV1Result } from "flarex-protocol/schema-manifest";
import { isLogicalSchemaAdmissionManifest, readLogicalSchemaAdmissionEvidence } from "./logicalSchemaAdmissionEvidence";

export interface SchemaVersionTableBinding extends QualifiedLogicalTable {
  readonly tableId: CatalogTableId;
}

export class SchemaVersionTableBindingsError extends Data.TaggedError("SchemaVersionTableBindingsError")<{
  readonly reason: "storedCorruption" | "resourceFailure";
  readonly cause: unknown;
}> {}

/** Read identities from an artifact whose bytes and digest the artifact owner
 * has already verified. Candidate source digests are verified as well. Views
 * reuse their definition's identity and never add a second table binding.
 * This supplies catalog preparation evidence, not serving or write authority. */
export const readSchemaVersionTableBindings = Effect.fn("SchemaVersionTableBindings.read")(function* (
  manifest: Json, deploymentId: string,
): Effect.fn.Return<readonly SchemaVersionTableBinding[], SchemaVersionTableBindingsError> {
  if (isLogicalSchemaAdmissionManifest(manifest)) {
    const evidence = yield* readLogicalSchemaAdmissionEvidence(manifest, deploymentId).pipe(
      Effect.mapError(cause => new SchemaVersionTableBindingsError({ reason: cause.reason, cause })));
    return Object.freeze(evidence.tableBindings.map(binding => Object.freeze({
      ...binding.table, tableId: binding.tableId,
    })));
  }
  const app = yield* Effect.fromResult(decodeSchemaManifestAppSchemaV1Result(manifest)).pipe(
    Effect.mapError(cause => new SchemaVersionTableBindingsError({ reason: "storedCorruption", cause })));
  return Object.freeze(app.tableDefinitions.tables.map(table => Object.freeze({
    namespace: table.namespace, logicalName: table.logicalName, tableId: table.tableId,
  })));
});
