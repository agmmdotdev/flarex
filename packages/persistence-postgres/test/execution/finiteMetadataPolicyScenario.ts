import { eq } from "drizzle-orm";
import { Effect, Result } from "effect";
import { expect } from "vitest";
import { decodeCatalogTableId } from "flarex-protocol/catalog";
import { decodeSchemaManifestAppSchemaV1 } from "flarex-protocol/schema-manifest";
import { ScopeIdSchema } from "flarex-protocol/storage-authority";
import type { FlarexMetadataDatabase } from "../../src/application/deployments";
import { fxSystemScopeClocks } from "../../src/database/schema";
import { applyFiniteMetadataActivationProjection, captureFiniteMetadataDependency, disposeFiniteMetadataProjection,
  finiteMetadataTableKey, matchesFiniteMetadataDependencyObservation, prepareFiniteMetadataProjection,
  validateConsumedMetadataDependencies } from "../../src/execution/finiteMetadataDependencies";
import { insertCurrentScopeClockFixture } from "../scope/scopeClockFixture";

/** Reused immutable policy evidence must still meet fresh database settlement. */
export async function finiteMetadataPolicyScenario(db: FlarexMetadataDatabase) {
  const scopeId = ScopeIdSchema.make("scope_00000000-0000-4000-8000-000000000033");
  await insertCurrentScopeClockFixture(db, { scopeId, epoch: "epoch_00000000-0000-4000-8000-000000000034" });
  const tableId = decodeCatalogTableId(1);
  const manifest = decodeSchemaManifestAppSchemaV1({ kind: "appSchema", manifestVersion: 1,
    tableDefinitions: { kind: "tableDefinitions", sectionVersion: 1, tables: [{ tableId: 1, namespace: "app", logicalName: "items",
      definition: { kind: "appDocument", definitionVersion: 1, documentType: { type: "object", value: {
        name: { fieldType: { type: "string" }, optional: false },
      } } } }] }, indexBindings: { kind: "indexBindings", sectionVersion: 1, indexes: [] } });
  const prepare = (version: number) => Effect.runPromise(prepareFiniteMetadataProjection({ indexes: [], unique: [],
    applicationSchema: { manifest }, sourcePolicies: [{ sourceKey: "application", semantic: { version } }] }));
  const original = await prepare(1), changed = await prepare(2);
  const owner = { namespace: "application", ownerKey: "application" } as const;
  const activate = (projection: typeof original) => db.transaction(tx => Effect.runPromise(
    applyFiniteMetadataActivationProjection(tx, scopeId, projection, [owner])));
  const validate = (dependency: Result.Result.Success<ReturnType<typeof captureFiniteMetadataDependency>>) =>
    db.transaction(tx => Effect.runPromise(Effect.result(validateConsumedMetadataDependencies(tx, scopeId,
      dependency.capturedWatermark, [dependency]))));
  const clock = async () => (await db.select().from(fxSystemScopeClocks).where(eq(fxSystemScopeClocks.scopeId, scopeId)))[0]!;
  try {
    const watermark = await activate(original);
    const key = finiteMetadataTableKey(original, tableId, "sourcePolicy");
    if (key === null) throw new Error("Missing original policy key");
    const retained = Result.getOrThrow(captureFiniteMetadataDependency(original, key, watermark));
    const before = await clock();
    await expect(db.transaction(async tx => {
      await Effect.runPromise(applyFiniteMetadataActivationProjection(tx, scopeId, changed, [owner]));
      throw new Error("rollback policy activation");
    })).rejects.toThrow("rollback policy activation");
    expect(await clock()).toEqual(before);
    expect(finiteMetadataTableKey(original, tableId, "sourcePolicy")).toBe(key);
    expect(matchesFiniteMetadataDependencyObservation(original, key, watermark, retained)).toBe(true);
    expect(Result.isSuccess(await validate(retained))).toBe(true);

    // A competing committed activation does not mutate the issuer's original
    // facts. Both original attempts must independently conflict at settlement.
    const peer = Result.getOrThrow(captureFiniteMetadataDependency(original, key, watermark));
    await activate(changed);
    const validating = [validate(retained), validate(peer)];
    await Promise.allSettled(validating);
    const verdicts = await Promise.all(validating);
    expect(verdicts).toHaveLength(2);
    for (const verdict of verdicts) expect(verdict).toMatchObject({ _tag: "Failure", failure: { reason: "writeConflict" } });
    expect(matchesFiniteMetadataDependencyObservation(original, key, watermark, retained)).toBe(true);
    expect((await clock()).lastCommitSeq).toBe(before.lastCommitSeq);

    const restoredWatermark = await activate(original);
    expect(await validate(retained)).toMatchObject({ _tag: "Failure", failure: { reason: "writeConflict" } });
    const fresh = Result.getOrThrow(captureFiniteMetadataDependency(original, key, restoredWatermark));
    expect(fresh.observed).toBe(retained.observed);
    expect(matchesFiniteMetadataDependencyObservation(original, key, restoredWatermark, retained)).toBe(false);
    expect(Result.isSuccess(await validate(fresh))).toBe(true);
  } finally { disposeFiniteMetadataProjection(original); disposeFiniteMetadataProjection(changed); }
}
