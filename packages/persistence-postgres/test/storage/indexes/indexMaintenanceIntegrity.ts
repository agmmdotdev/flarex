import { and, eq } from "drizzle-orm";
import { Effect } from "effect";
import { expect } from "vitest";
import { CatalogTableIdSchema } from "flarex-protocol/catalog";
import type { LocatedAppIndexDefinitionV1 } from "../../../src/storage/indexes/appIndexDefinitions";
import type { FlarexMetadataDatabase } from "../../../src/application/deployments";
import { decodeIndexBuildStateRowResult, indexBuildStateSelection, indexMaintenanceBindingPredicate,
  isIndexBuildSnapshotCoveredInTransactionEffect, readIndexCoverageContextInTransactionEffect,
  type IndexBuildStateRow } from "../../../src/storage/indexes/indexBuildStates";
import { fxSystemIndexBuildStates, fxSystemIndexMaintenanceObligations } from "../../../src/database/schema";
import { lockScopeClockForShareInTransactionEffect } from "../../../src/scope/scopeClock";
import { IndexBuildAttemptFenceSchema } from "flarex-protocol/index-build-state";
import { CommitSeqSchema, ScopeEpochSchema, StorageGenerationFenceSchema } from "flarex-protocol/storage-authority";
import { runEffect } from "../../support/effectTestRuntime";

/** Corrupt capture witnesses exercise the production accepting owners. Actual
 * obligation immutability and compound opening pins refuse ordinary DML too. */
export async function assertIndexMaintenanceIntegrity(db: FlarexMetadataDatabase, definition: LocatedAppIndexDefinitionV1) {
  const identity = and(eq(fxSystemIndexBuildStates.scopeId, definition.scopeId), eq(fxSystemIndexBuildStates.indexDefinitionId, definition.indexDefinitionId));
  const original = (await db.select(indexBuildStateSelection()).from(fxSystemIndexBuildStates)
    .leftJoin(fxSystemIndexMaintenanceObligations, indexMaintenanceBindingPredicate()).where(identity))[0];
  const obligation = original?.maintenanceObligation;
  if (original === undefined || obligation === null || obligation === undefined)
    throw new Error("Expected genuine activation opening obligation");
  const probe = (override: Partial<IndexBuildStateRow> = {}) => db.transaction(tx => runEffect(Effect.gen(function* () {
    const clock = yield* lockScopeClockForShareInTransactionEffect(tx, definition.scopeId);
    const rows = yield* Effect.promise(() => tx.select(indexBuildStateSelection()).from(fxSystemIndexBuildStates)
      .leftJoin(fxSystemIndexMaintenanceObligations, indexMaintenanceBindingPredicate()).where(identity));
    const row = rows[0];
    if (!row) throw new Error("Missing test build");
    const captured = { ...row, ...override };
    const build = yield* Effect.fromResult(decodeIndexBuildStateRowResult(captured, definition.scopeId, definition.indexDefinitionId, captured.maintenanceObligation));
    return yield* isIndexBuildSnapshotCoveredInTransactionEffect(tx, build, { ...definition, tableId: definition.access.tableId },
      clock.lastCommitSeq, yield* readIndexCoverageContextInTransactionEffect(tx, clock));
  })));
  expect(await probe()).toBe(true);
  for (const wrongBinding of [
    { ...obligation, headSha256: new Uint8Array(32) },
    { ...obligation, activationSha256: new Uint8Array(32) },
    { ...obligation, physicalSpecSha256: new Uint8Array(32) },
    { ...obligation, tableId: CatalogTableIdSchema.make(999999) },
    { ...obligation, deploymentId: `${obligation.deploymentId}:foreign` },
    { ...obligation, schemaVersionId: `${obligation.schemaVersionId}:foreign` },
    { ...obligation, schemaManifestSha256: new Uint8Array(32) },
  ]) {
    await expect(probe({ maintenanceObligation: wrongBinding })).rejects.toMatchObject({ reason: "storedState" });
  }
  for (const wrongOpening of [
    { ...obligation, activationSequence: obligation.activationSequence + 1n },
    { ...obligation, attemptFence: IndexBuildAttemptFenceSchema.make(obligation.attemptFence + 1n) },
    { ...obligation, storageGenerationFence: StorageGenerationFenceSchema.make(obligation.storageGenerationFence + 1n) },
    { ...obligation, epoch: ScopeEpochSchema.make(`${obligation.epoch}:foreign`) },
    { ...obligation, openedCommitSeq: CommitSeqSchema.make(obligation.openedCommitSeq + 1n) },
  ]) await expect(probe({ maintenanceObligation: wrongOpening })).rejects.toMatchObject({ _tag: "IndexBuildStateCorruptionError" });
  // Keep the detached opening frontier coherent and matched to the captured
  // build so this refusal isolates its immutable first-readable pin.
  const laterOpening = CommitSeqSchema.make(obligation.openedCommitSeq + 1n);
  await expect(probe({ coveredThroughCommitSeq: laterOpening, maintenanceObligation: {
    ...obligation, firstReadableCommitSeq: CommitSeqSchema.make(obligation.firstReadableCommitSeq + 1n),
    openedCommitSeq: laterOpening,
  } })).rejects.toMatchObject({ _tag: "IndexBuildStateCorruptionError" });
  await expect(probe({ maintenanceObligation: null })).rejects.toMatchObject({ _tag: "IndexBuildStateCorruptionError" });
  await expect(probe({ maintenanceActivationSequence: null })).rejects.toMatchObject({ _tag: "IndexBuildStateCorruptionError" });
  const inventory = () => db.select(indexBuildStateSelection()).from(fxSystemIndexBuildStates)
    .leftJoin(fxSystemIndexMaintenanceObligations, indexMaintenanceBindingPredicate()).where(identity);
  const beforeRefusal = await inventory();
  await expect(db.update(fxSystemIndexBuildStates).set({
    attemptFence: IndexBuildAttemptFenceSchema.make(original.attemptFence + 1n),
  }).where(identity)).rejects.toMatchObject({ cause: { code: "23503", constraint: "fx_index_build_maintenance_opening_fk" } });
  expect(await inventory()).toEqual(beforeRefusal);
  await expect(db.update(fxSystemIndexMaintenanceObligations).set({ headSha256: new Uint8Array(32) }).where(and(
    eq(fxSystemIndexMaintenanceObligations.scopeId, definition.scopeId),
    eq(fxSystemIndexMaintenanceObligations.indexDefinitionId, definition.indexDefinitionId),
    eq(fxSystemIndexMaintenanceObligations.activationSequence, obligation.activationSequence),
  ))).rejects.toMatchObject({ cause: { code: "55000", message: "Maintenance opening obligations are immutable" } });
  expect(await inventory()).toEqual(beforeRefusal);
  expect(await probe()).toBe(true);
}
