import { and, eq, sql } from "drizzle-orm";
import { Effect, Result, Schema } from "effect";
import { expect } from "vitest";
import { CatalogIndexDefinitionIdSchema, type CatalogIndexDefinitionId } from "flarex-protocol/catalog";
import type { CatalogSchemaVersionId } from "flarex-protocol/schema-manifest";
import type { ScopeId } from "flarex-protocol/storage-authority";
import { isJsonObject } from "flarex-protocol/json";
import type { FlarexMetadataDatabase } from "../src/deployments";
import { fxControlLogicalReadAccess, fxSystemIndexBuildStates } from "../src/schema";
import type { LogicalSourceReadPin } from "../src/logicalReadMetadata";
import type { PreparedInstallation } from "../src/installationLifecycle";
import { logicalIndexReadAccessQuery } from "../src/logicalReadAccessQueries";
import { runEffectTransaction } from "../src/effectTransaction";
import { runDrizzleStatementEffect } from "../src/drizzleStatementEffect";
import type { FlarexMetadataTransaction } from "../src/metadataTransaction";

/** A fixture-owned witness for one actual active-row index selector. It keeps
 * SQL and complete readiness-row restoration with persistence test support. */
export async function prepareLogicalReadIndexReadinessWitness(input: Readonly<{
  controlDb: FlarexMetadataDatabase;
  targetDb: FlarexMetadataDatabase;
  deploymentId: string;
  schemaVersionId: CatalogSchemaVersionId;
  scopeId: ScopeId;
  sourceKey: string;
  localName: string;
  field: string;
}>) {
  const rows = await input.controlDb.select().from(fxControlLogicalReadAccess).where(and(
    eq(fxControlLogicalReadAccess.deploymentId, input.deploymentId),
    eq(fxControlLogicalReadAccess.schemaVersionId, input.schemaVersionId),
    eq(fxControlLogicalReadAccess.sourceKey, input.sourceKey),
    eq(fxControlLogicalReadAccess.localName, input.localName),
    eq(fxControlLogicalReadAccess.selectorKind, "index"),
    eq(fxControlLogicalReadAccess.leadingField, input.field),
    eq(fxControlLogicalReadAccess.prefixLength, 1),
    sql`${fxControlLogicalReadAccess.projectionJson}->'predicate' =
      ${JSON.stringify({ kind: "fieldIsNull", field: "deleted_at" })}::jsonb`,
  ));
  expect(rows).toHaveLength(1);
  const access = Result.getOrThrow(Schema.decodeUnknownResult(Schema.Json)(rows[0]?.projectionJson));
  if (!isJsonObject(access)) throw new Error("Missing logical index selector");
  expect(access).toMatchObject({ fields: [input.field], predicate: { kind: "fieldIsNull", field: "deleted_at" } });
  const indexDefinitionId = Result.getOrThrow(Schema.decodeUnknownResult(CatalogIndexDefinitionIdSchema)(access.indexDefinitionId));
  return captureReadinessRow(input.targetDb, input.scopeId, indexDefinitionId);
}

/** Ask the actual selector owner for the native scalar demand winner,
 * including predicate and ordinal rules, before mutating that exact build. */
export async function prepareLogicalReadDemandReadinessWitness(input: Readonly<{
  controlDb: FlarexMetadataDatabase;
  targetDb: FlarexMetadataDatabase;
  installation: PreparedInstallation;
  deploymentId: string;
  schemaVersionId: CatalogSchemaVersionId;
  scopeId: ScopeId;
  source: LogicalSourceReadPin;
  localName: string;
  equality: Readonly<{ column: string; value: string }>;
}>) {
  const selected = await Effect.runPromise(runEffectTransaction<CatalogIndexDefinitionId, Error, Error, FlarexMetadataTransaction>(
    work => input.controlDb.transaction(work), "Native demand selection rolled back", tx => Effect.gen(function* () {
      const rows = yield* runDrizzleStatementEffect(logicalIndexReadAccessQuery(tx,
        { ...input, sourceKey: input.source.sourceKey }, { [input.equality.column]: input.equality.value }),
      cause => new Error("Native demand selection", { cause }));
      expect(rows).toHaveLength(1);
      const access = Result.getOrThrow(Schema.decodeUnknownResult(Schema.Json)(rows[0]?.projectionJson));
      if (!isJsonObject(access)) throw new Error("Missing native scalar index selection");
      expect(access).toMatchObject({ fields: [input.equality.column], predicate: null });
      return Result.getOrThrow(Schema.decodeUnknownResult(CatalogIndexDefinitionIdSchema)(access.indexDefinitionId));
    }), cause => new Error("Native demand selection settlement", { cause }),
    { token: input.installation, database: input.controlDb },
  ));
  return captureReadinessRow(input.targetDb, input.scopeId, selected);
}

async function captureReadinessRow(targetDb: FlarexMetadataDatabase, scopeId: ScopeId,
  indexDefinitionId: CatalogIndexDefinitionId) {
  const predicate = and(eq(fxSystemIndexBuildStates.scopeId, scopeId),
    eq(fxSystemIndexBuildStates.indexDefinitionId, indexDefinitionId));
  const [original] = await targetDb.select().from(fxSystemIndexBuildStates).where(predicate);
  if (original === undefined) throw new Error("Missing logical index readiness");
  expect(original.lifecycle).toBe("enabled");
  return Object.freeze({
    indexDefinitionId,
    retire: async () => {
      const changed = await targetDb.update(fxSystemIndexBuildStates).set({ lifecycle: "retiring",
        maintenanceActivationSequence: null, }).where(predicate).returning();
      expect(changed).toHaveLength(1);
      expect(changed[0]?.lifecycle).toBe("retiring");
    },
    restore: async () => {
      const [restored] = await targetDb.update(fxSystemIndexBuildStates).set(original).where(predicate).returning();
      expect(restored).toEqual(original);
    },
  });
}
