import { eq } from "drizzle-orm";
import { Effect, Result, Schema } from "effect";
import { LogicalMetadataReadDependencySchema } from "flarex-protocol/commit-protocol";
import { ScopeIdSchema } from "flarex-protocol/storage-authority";
import { expect } from "vitest";
import { applyFiniteMetadataActivationProjection, captureFiniteMetadataDependency,
  finiteMetadataContractKey, initializeCurrentFiniteMetadataProjection, inspectFiniteMetadataProjection, mergeFiniteMetadataProjections,
  prepareFiniteMetadataProjection, requireCurrentFiniteMetadataProjection,
  validateConsumedMetadataDependencies } from "../src/finiteMetadataDependencies";
import type { FlarexMetadataDatabase } from "../src/deployments";
import { fxSystemMetadataContractObservations, fxSystemScopeClocks } from "../src/schema";
import { insertCurrentScopeClockFixture } from "./scopeClockFixture";

/** The real owner proves metadata OCC independently of application-data OCC. */
export async function finiteMetadataDependenciesScenario(db: FlarexMetadataDatabase) {
  const scopeId = ScopeIdSchema.make("scope_00000000-0000-4000-8000-000000000023");
  await insertCurrentScopeClockFixture(db, { scopeId, epoch: "epoch_00000000-0000-4000-8000-000000000024" });
  const owner = { namespace: "execution", ownerKey: "application" } as const;
  const key = (path: string) => ({ ...owner, contractKey: finiteMetadataContractKey("function", path) });
  const prepare = (a: number | null, b: number, negative = false) => Effect.runPromise(prepareFiniteMetadataProjection({
    indexes: [], unique: [],
    application: { functions: [
      ...(a === null ? [] : [{ path: "a", semantic: { result: a } }]),
      { path: "b", semantic: { result: b } },
      ...(negative ? [{ path: "negative", semantic: { result: 1 } }] : []),
    ], groups: [] },
  }));
  const activate = (projection: Effect.Success<ReturnType<typeof prepareFiniteMetadataProjection>>) =>
    db.transaction(tx => Effect.runPromise(applyFiniteMetadataActivationProjection(tx, scopeId, projection, [owner])));
  const validate = (watermark: Parameters<typeof validateConsumedMetadataDependencies>[2],
    dependencies: Parameters<typeof validateConsumedMetadataDependencies>[3]) =>
    db.transaction(tx => Effect.runPromise(Effect.result(validateConsumedMetadataDependencies(tx, scopeId, watermark, dependencies))));
  const original = await prepare(1, 1);
  const initialize = (projection: Effect.Success<ReturnType<typeof prepareFiniteMetadataProjection>>) =>
    db.transaction(tx => Effect.runPromise(initializeCurrentFiniteMetadataProjection(tx, scopeId, projection, [owner])));
  const captured = await initialize(original);
  const initializedRows = await db.select().from(fxSystemMetadataContractObservations).where(eq(fxSystemMetadataContractObservations.scopeId, scopeId))
    .orderBy(fxSystemMetadataContractObservations.namespace, fxSystemMetadataContractObservations.ownerKey, fxSystemMetadataContractObservations.contractKey);
  expect(await initialize(original)).toBe(captured);
  expect(await db.select().from(fxSystemMetadataContractObservations).where(eq(fxSystemMetadataContractObservations.scopeId, scopeId))
    .orderBy(fxSystemMetadataContractObservations.namespace, fxSystemMetadataContractObservations.ownerKey, fxSystemMetadataContractObservations.contractKey)).toEqual(initializedRows);
  const a = Result.getOrThrow(captureFiniteMetadataDependency(original, key("a"), captured));
  const missing = Result.getOrThrow(captureFiniteMetadataDependency(original, key("negative"), captured));
  expect(missing.observed.kind).toBe("missing");
  expect(await activate(await prepare(1, 1))).toBe(captured + 1n);
  expect(Result.isSuccess(await validate(captured, [a, missing]))).toBe(true);
  await activate(await prepare(1, 2));
  expect(Result.isSuccess(await validate(captured, [a, missing]))).toBe(true);
  // First use of old retained metadata after activation retains entry sequence.
  const lazyB = Result.getOrThrow(captureFiniteMetadataDependency(original, key("b"), captured));
  expect(await validate(captured, [lazyB])).toMatchObject({ _tag: "Failure", failure: { reason: "writeConflict" } });
  await activate(await prepare(2, 2));
  expect(await validate(captured, [a])).toMatchObject({ _tag: "Failure", failure: { reason: "writeConflict" } });
  await activate(await prepare(1, 2));
  expect(await validate(captured, [a])).toMatchObject({ _tag: "Failure", failure: { reason: "writeConflict" } });
  await activate(await prepare(null, 2));
  const removed = await db.select().from(fxSystemMetadataContractObservations).where(eq(
    fxSystemMetadataContractObservations.contractKey, key("a").contractKey));
  expect(removed[0]).toMatchObject({ present: false, semanticSha256Hex: null });
  const removedSequence = (await db.select().from(fxSystemScopeClocks).where(eq(fxSystemScopeClocks.scopeId, scopeId)))[0]!.lastMetadataSequence;
  expect(await initialize(await prepare(null, 2))).toBe(removedSequence);
  await activate(await prepare(1, 2));
  expect(await validate(captured, [a])).toMatchObject({ _tag: "Failure", failure: { reason: "writeConflict" } });
  const before = (await db.select().from(fxSystemScopeClocks).where(eq(fxSystemScopeClocks.scopeId, scopeId)))[0]!;
  await expect(db.transaction(async tx => {
    await Effect.runPromise(applyFiniteMetadataActivationProjection(tx, scopeId, await prepare(3, 2), [owner]));
    throw new Error("rollback metadata activation");
  })).rejects.toThrow("rollback metadata activation");
  const after = (await db.select().from(fxSystemScopeClocks).where(eq(fxSystemScopeClocks.scopeId, scopeId)))[0]!;
  expect(after.lastMetadataSequence).toBe(before.lastMetadataSequence);
  expect(after.lastCommitSeq).toBe(before.lastCommitSeq);
  const current = await prepare(1, 2);
  await db.transaction(tx => Effect.runPromise(requireCurrentFiniteMetadataProjection(tx, scopeId, after.lastMetadataSequence, current)));
  expect(Result.isSuccess(mergeFiniteMetadataProjections([current, current]))).toBe(true);
  expect(Result.isFailure(mergeFiniteMetadataProjections([current, await prepare(2, 2)]))).toBe(true);
  expect(inspectFiniteMetadataProjection({ ...current })).toBeNull();
  await activate(await prepare(1, 2, true));
  // Recovery uses decoded authenticated journal evidence, without process pins.
  const encoded = await Effect.runPromise(Schema.encodeUnknownEffect(LogicalMetadataReadDependencySchema)(missing));
  const recovered = Schema.decodeUnknownSync(LogicalMetadataReadDependencySchema)(JSON.parse(JSON.stringify(encoded)));
  expect(await validate(captured, [recovered])).toMatchObject({ _tag: "Failure", failure: { reason: "writeConflict" } });
  expect(await validate(after.lastMetadataSequence, [a])).toMatchObject({ _tag: "Failure", failure: { reason: "invalidInput" } });
}
