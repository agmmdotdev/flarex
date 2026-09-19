import { Data, Effect, Schema } from "effect";
import { verifyLogicalSchemaCandidateDigests } from "@flarex/analysis/internal/logical-schema-candidate";
import { CatalogTableIdSchema } from "flarex-protocol/catalog";
import { SchemaManifestJsonSchema } from "flarex-protocol/schema-manifest";
import { isJsonObject, type Json } from "flarex-protocol/json";
import { decodeLogicalSchemaCandidate, logicalTableKey, QualifiedLogicalTableSchema } from "flarex-protocol/internal/logical-schema-candidate";

export class LogicalSchemaAdmissionEvidenceError extends Data.TaggedError("LogicalSchemaAdmissionEvidenceError")<{
  readonly reason: "storedCorruption";
  readonly cause?: unknown;
}> {}

export const MAX_LOGICAL_SCHEMA_HISTORY_RECORDS = 64;
export const MAX_LOGICAL_SCHEMA_HISTORY_BYTES = 16_777_216;

const strict = { parseOptions: { onExcessProperty: "error" } } as const;
const Binding = Schema.Struct({ table: QualifiedLogicalTableSchema, tableId: CatalogTableIdSchema }).annotate(strict);
const Admission = Schema.Struct({
  kind: Schema.Literal("logicalSchemaAdmission"), definitionVersion: Schema.Literal(1),
  candidate: SchemaManifestJsonSchema,
  tableBindings: Schema.Array(Binding).check(Schema.isMaxLength(256)),
}).annotate(strict);
export type LogicalSchemaAdmissionBinding = typeof Binding.Type;
const decodeAdmission = Schema.decodeUnknownEffect(Admission);

/** Discrimination only. Callers must verify evidence before skipping a candidate. */
export function isLogicalSchemaAdmissionManifest(value: Json): boolean {
  return isJsonObject(value) && value.kind === "logicalSchemaAdmission";
}

/** Artifact reader must first authenticate its canonical JSON/bytes/digest. */
export const readLogicalSchemaAdmissionEvidence = Effect.fn("LogicalSchemaAdmission.readEvidence")(function* (
  manifest: Json, deploymentId: string,
) {
  const admitted = yield* decodeAdmission(manifest).pipe(Effect.mapError(cause =>
    new LogicalSchemaAdmissionEvidenceError({ reason: "storedCorruption", cause })));
  const candidate = yield* Effect.fromResult(decodeLogicalSchemaCandidate(admitted.candidate)).pipe(Effect.mapError(cause =>
    new LogicalSchemaAdmissionEvidenceError({ reason: "storedCorruption", cause })));
  yield* verifyLogicalSchemaCandidateDigests(candidate).pipe(Effect.mapError(cause =>
    new LogicalSchemaAdmissionEvidenceError({ reason: "storedCorruption", cause })));
  const definitions = candidate.sources.flatMap(source => source.bindings.filter(binding => binding.kind === "definition"));
  if (candidate.deploymentId !== deploymentId || admitted.tableBindings.length !== definitions.length ||
      new Set(admitted.tableBindings.map(binding => logicalTableKey(binding.table))).size !== definitions.length ||
      new Set(admitted.tableBindings.map(binding => binding.tableId)).size !== definitions.length ||
      admitted.tableBindings.some(binding => !definitions.some(definition => logicalTableKey(definition.table) === logicalTableKey(binding.table)))) {
    return yield* Effect.fail(new LogicalSchemaAdmissionEvidenceError({ reason: "storedCorruption" }));
  }
  return Object.freeze({ candidate, tableBindings: admitted.tableBindings });
});
