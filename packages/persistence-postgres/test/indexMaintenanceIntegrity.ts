import { and, eq } from "drizzle-orm";
import { Effect } from "effect";
import { AppIndexPhysicalSpecSha256HexV1Schema } from "flarex-protocol/index-definition";
import { expect, vi } from "vitest";
import { CatalogTableIdSchema } from "flarex-protocol/catalog";
import type { LocatedAppIndexDefinitionV1 } from "../src/appIndexDefinitions";
import type { FlarexMetadataDatabase } from "../src/deployments";
import { decodeIndexBuildStateRowResult, isIndexBuildSnapshotCoveredInTransactionEffect, readIndexCoverageContextInTransactionEffect } from "../src/indexBuildStates";
import { decodeIndexMaintenanceEvidenceResult, hashIndexMaintenanceEvidence, indexMaintenanceFrameBytes } from "../src/indexMaintenanceEvidence";
import { fxSystemIndexBuildStates } from "../src/schema";
import { lockScopeClockForShareInTransactionEffect } from "../src/scopeClock";
import { IndexBuildAttemptFenceSchema } from "flarex-protocol/index-build-state";
import { runEffect } from "./effectTestRuntime";

/** Corruptions are test-only writes; every probe exercises the production coverage owner. */
export async function assertIndexMaintenanceIntegrity(db: FlarexMetadataDatabase, definition: LocatedAppIndexDefinitionV1) {
  const identity = and(eq(fxSystemIndexBuildStates.scopeId, definition.scopeId), eq(fxSystemIndexBuildStates.indexDefinitionId, definition.indexDefinitionId));
  const original = (await db.select().from(fxSystemIndexBuildStates).where(identity))[0];
  if (!original) throw new Error("Missing maintained build");
  const evidence = await runEffect(Effect.fromResult(decodeIndexMaintenanceEvidenceResult(
    original.maintenanceActivationSequence, original.maintenanceBytes, original.maintenanceSha256,
  )));
  if (!evidence) throw new Error("Expected genuine activation certificate");
  const probe = () => db.transaction(tx => runEffect(Effect.gen(function* () {
    const clock = yield* lockScopeClockForShareInTransactionEffect(tx, definition.scopeId);
    const rows = yield* Effect.promise(() => tx.select().from(fxSystemIndexBuildStates).where(identity));
    const row = rows[0];
    if (!row) throw new Error("Missing test build");
    const build = yield* Effect.fromResult(decodeIndexBuildStateRowResult(row, definition.scopeId, definition.indexDefinitionId));
    return yield* isIndexBuildSnapshotCoveredInTransactionEffect(tx, build, { ...definition, tableId: definition.access.tableId },
      clock.lastCommitSeq, yield* readIndexCoverageContextInTransactionEffect(tx, clock));
  })));
  expect(await probe()).toBe(true);
  for (const frame of [
    { ...evidence.frame, headSha256: "0".repeat(64) },
    { ...evidence.frame, activationSequence: (BigInt(evidence.frame.activationSequence) + 1n).toString() },
    { ...evidence.frame, physicalSpecSha256Hex: AppIndexPhysicalSpecSha256HexV1Schema.make("0".repeat(64)) },
    { ...evidence.frame, tableId: CatalogTableIdSchema.make(999999) },
    { ...evidence.frame, deploymentId: `${evidence.frame.deploymentId}:foreign` },
    { ...evidence.frame, schemaVersionId: `${evidence.frame.schemaVersionId}:foreign` },
    { ...evidence.frame, schemaManifestSha256: "0".repeat(64) },
  ]) {
    const bytes = indexMaintenanceFrameBytes(frame);
    await db.update(fxSystemIndexBuildStates).set({ maintenanceActivationSequence: BigInt(frame.activationSequence),
      maintenanceBytes: bytes, maintenanceSha256: await runEffect(hashIndexMaintenanceEvidence(bytes)) }).where(identity);
    try { await expect(probe()).rejects.toMatchObject({ reason: "storedState" }); }
    finally { await db.update(fxSystemIndexBuildStates).set(original).where(identity); }
  }
  await db.update(fxSystemIndexBuildStates).set({ maintenanceSha256: new Uint8Array(32) }).where(identity);
  try { await expect(probe()).rejects.toMatchObject({ reason: "storedState" }); }
  finally { await db.update(fxSystemIndexBuildStates).set(original).where(identity); }
  await db.update(fxSystemIndexBuildStates).set({ attemptFence: IndexBuildAttemptFenceSchema.make(original.attemptFence + 1n) }).where(identity);
  try { await expect(probe()).rejects.toMatchObject({ _tag: "IndexBuildStateCorruptionError" }); }
  finally { await db.update(fxSystemIndexBuildStates).set(original).where(identity); }
  expect(await probe()).toBe(true);
}

/** Fail only this certificate's crypto operation, leaving other authority hashes real. */
export async function withIndexMaintenanceHashFailure(work: (failure: Error) => Promise<void>) {
  const failure = new Error("Index maintenance hash unavailable");
  const digest = crypto.subtle.digest.bind(crypto.subtle);
  const spy = vi.spyOn(crypto.subtle, "digest").mockImplementation((algorithm, data) => {
    if (new TextDecoder().decode(data).includes('"format":"flarex.index-maintenance"')) return Promise.reject(failure);
    return digest(algorithm, data);
  });
  try { await work(failure); } finally { spy.mockRestore(); }
}
