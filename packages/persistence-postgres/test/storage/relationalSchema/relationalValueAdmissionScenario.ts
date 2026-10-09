import { Effect } from "effect";
import { sql } from "drizzle-orm";
import { expect } from "vitest";
import { captureLogicalSchemaSource } from "@flarex/analysis/internal/logical-schema-candidate";
import { normalizeRelationalSchema, relationalSchemaSourceFromDefinition } from "flarex-protocol/internal/relational-schema";
import { CatalogSchemaVersionIdSchema, CatalogSchemaVersionSchema, type CatalogSchemaVersionId } from "flarex-protocol/schema-manifest";
import type { FlarexMetadataDatabase } from "../../../src/application/deployments";
import type { FlarexMetadataTransaction } from "../../../src/database/metadataTransaction";
import { readSchemaVersionArtifactByIdEffect, prepareSchemaVersionArtifactEffect, ensureSchemaVersionArtifactInTransactionEffect } from "../../../src/storage/catalog/schemaVersionArtifacts";
import { readLogicalSchemaAdmissionEvidence } from "../../../src/storage/catalog/logicalSchemaAdmissionEvidence";
import { prepareRelationalUniqueDeclarations, ensureRelationalOrderedDefinitions } from "../../../src/storage/catalog/relationalStorageDefinitions";
import { runEffectTransaction } from "../../../src/database/effectTransaction";
import { runDrizzleStatementEffect } from "../../../src/database/drizzleStatementEffect";
import { fxControlIndexes, fxControlIndexDefinitions, fxControlSchemaVersionIndexBindings,
  fxControlUniqueConstraints, fxControlUniqueConstraintDefinitions, fxControlSchemaVersionUniqueConstraintBindings,
  fxControlSchemaVersions } from "../../../src/database/schema";

/** Deliberately synthetic source revisions exercise the storage compiler's
 * admission boundary. They are not claims about Currency's actual native keys.
 * Every variant is installed and tested inside a rolled-back fixture transaction. */
export const relationalValueAdmissionScenario = Effect.fn("RelationalValueAdmission.scenario")(function* (
  db: FlarexMetadataDatabase, deploymentId: string, schemaVersionId: CatalogSchemaVersionId,
) {
  const artifact = yield* readSchemaVersionArtifactByIdEffect(db, deploymentId, schemaVersionId);
  if (artifact === null) throw new Error("Missing native schema artifact");
  const evidence = yield* readLogicalSchemaAdmissionEvidence(artifact.manifestJson, deploymentId);
  const source = evidence.candidate.sources.find(candidate => candidate.key === "medusa.currency");
  if (source?.definition.kind !== "relational") throw new Error("Missing relational source");
  const native = source.definition.schema;
  const table = native.tables[0];
  if (table === undefined) throw new Error("Missing native table");
  const inventory = Effect.fn("RelationalValueAdmission.inventory")(function* () {
    const counts: number[] = [];
    for (const catalog of [fxControlIndexes, fxControlIndexDefinitions, fxControlSchemaVersionIndexBindings,
      fxControlUniqueConstraints, fxControlUniqueConstraintDefinitions, fxControlSchemaVersionUniqueConstraintBindings,
      fxControlSchemaVersions]) {
      const rows = yield* runDrizzleStatementEffect(db.select({ count: sql<number>`count(*)::int` }).from(catalog),
        cause => new Error("Read compiler inventory", { cause }));
      const row = rows[0];
      if (row === undefined) throw new Error("Missing inventory count");
      counts.push(row.count);
    }
    return counts;
  });
  const before = yield* inventory();
  for (const field of ["rounding", "decimal_digits", "created_at", "raw_rounding"]) {
    const column = table.columns.find(candidate => candidate.identity.columnId === field);
    if (column === undefined) throw new Error("Missing native typed field");
    const schema = yield* Effect.fromResult(normalizeRelationalSchema(relationalSchemaSourceFromDefinition({
      ...native, tables: [{ ...table, keys: table.keys.map(key => ({ ...key, columns: [column.identity] })) }],
    })));
    const variant = yield* captureLogicalSchemaSource({
      key: source.key, owner: source.owner, writeProfile: source.writeProfile, bindings: source.bindings,
      evidence: { kind: "synthetic-value-admission-fixture", field }, definition: { kind: "relational", schema },
    });
    const variantId = CatalogSchemaVersionIdSchema.make(`value-admission-${field}`);
    const prepared = yield* prepareSchemaVersionArtifactEffect({ deploymentId, schemaVersionId: variantId,
      version: CatalogSchemaVersionSchema.make(2), manifest: {
        kind: "logicalSchemaAdmission", definitionVersion: 1, tableBindings: evidence.tableBindings,
        candidate: { ...evidence.candidate, sources: evidence.candidate.sources.map(candidate =>
          candidate.key === source.key ? variant : candidate) },
      },
    });
    const rollback = new Error("Discard synthetic compiler fixture");
    const result = yield* Effect.result(runEffectTransaction(callback => db.transaction(callback), "Value admission rollback",
      (tx: FlarexMetadataTransaction) => Effect.gen(function* () {
        yield* ensureSchemaVersionArtifactInTransactionEffect(tx, prepared);
        if (column.type === "integer" || column.type === "timestamptz") {
          const unique = yield* prepareRelationalUniqueDeclarations(tx, deploymentId, variantId, source.key);
          expect(unique).toHaveLength(1);
          expect(unique[0]?.descriptor).toBe("key/currency.primary");
        } else {
          expect(yield* Effect.result(prepareRelationalUniqueDeclarations(tx, deploymentId, variantId, source.key)))
            .toMatchObject({ _tag: "Failure", failure: { _tag: "RelationalStorageDefinitionError", reason: "unsupportedDefinition" } });
        }
        if (column.type === "numeric" || column.type === "integer" || column.type === "timestamptz") {
          const ordered = yield* ensureRelationalOrderedDefinitions(tx, deploymentId, variantId, source.key);
          expect(ordered[0]?.definition.physicalSpec.orderedFields[0]).toEqual({ kind: "documentPath", path: field,
            ...(column.type === "numeric" ? { valueFormat: "exactDecimal" } : {}) });
        } else {
          expect(yield* Effect.result(ensureRelationalOrderedDefinitions(tx, deploymentId, variantId, source.key)))
            .toMatchObject({ _tag: "Failure", failure: { _tag: "RelationalStorageDefinitionError", reason: "unsupportedDefinition" } });
        }
        return yield* Effect.fail(rollback);
      }), cause => new Error("Value admission transaction failed", { cause })));
    expect(result).toMatchObject({ _tag: "Failure", failure: rollback });
    expect(yield* inventory()).toEqual(before);
  }
});
