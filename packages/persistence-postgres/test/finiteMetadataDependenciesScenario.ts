import { and, eq, sql } from "drizzle-orm";
import { Effect, Result, Schema } from "effect";
import { LogicalMetadataReadDependencySchema, MetadataSequenceSchema } from "flarex-protocol/commit-protocol";
import { ScopeIdSchema } from "flarex-protocol/storage-authority";
import { expect } from "vitest";
import { applyFiniteMetadataActivationProjection, captureFiniteMetadataDependency,
  finiteMetadataContractKey, initializeCurrentFiniteMetadataProjection, inspectFiniteMetadataProjection, mergeFiniteMetadataProjections,
  prepareFiniteMetadataProjection, requireCurrentFiniteMetadataProjection,
  validateConsumedMetadataDependencies, matchesFiniteMetadataDependencyObservation,
  prepareFiniteMetadataEntryComparison, acceptFiniteMetadataComparisonVerdict } from "../src/finiteMetadataDependencies";
import type { FlarexMetadataDatabase } from "../src/deployments";
import { fxSystemMetadataContractObservations, fxSystemScopeClocks } from "../src/schema";
import { insertCurrentScopeClockFixture } from "./scopeClockFixture";

/** The real owner proves metadata OCC independently of application-data OCC. */
export async function finiteMetadataDependenciesScenario(db: FlarexMetadataDatabase, readComparatorCount: () => number) {
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
  let captured = await initialize(original);
  const initializedRows = await db.select().from(fxSystemMetadataContractObservations).where(eq(fxSystemMetadataContractObservations.scopeId, scopeId))
    .orderBy(fxSystemMetadataContractObservations.namespace, fxSystemMetadataContractObservations.ownerKey, fxSystemMetadataContractObservations.contractKey);
  expect(await initialize(original)).toBe(captured);
  expect(await db.select().from(fxSystemMetadataContractObservations).where(eq(fxSystemMetadataContractObservations.scopeId, scopeId))
    .orderBy(fxSystemMetadataContractObservations.namespace, fxSystemMetadataContractObservations.ownerKey, fxSystemMetadataContractObservations.contractKey)).toEqual(initializedRows);
  // Exact predecessor metadata carries only its authentic digest. The real
  // canonical initializer must reconstruct its full semantics before cutover;
  // it cannot treat a matching old hash as a complete current projection.
  await db.update(fxSystemMetadataContractObservations).set({ semanticBytes: null }).where(and(
    eq(fxSystemMetadataContractObservations.scopeId, scopeId),
    eq(fxSystemMetadataContractObservations.contractKey, key("a").contractKey)));
  const restored = await initialize(original);
  expect(restored).toBe(captured + 1n);
  const restoredRows = await db.select().from(fxSystemMetadataContractObservations).where(eq(fxSystemMetadataContractObservations.scopeId, scopeId))
    .orderBy(fxSystemMetadataContractObservations.namespace, fxSystemMetadataContractObservations.ownerKey, fxSystemMetadataContractObservations.contractKey);
  expect(restoredRows.map(row => row.semanticBytes)).toEqual(initializedRows.map(row => row.semanticBytes));
  expect(restoredRows.every(row => row.semanticBytes !== null)).toBe(true);
  expect(await initialize(original)).toBe(restored);
  captured = restored;
  const a = Result.getOrThrow(captureFiniteMetadataDependency(original, key("a"), captured));
  const missing = Result.getOrThrow(captureFiniteMetadataDependency(original, key("negative"), captured));
  const beforeDuplicates = readComparatorCount();
  expect(Result.isSuccess(await validate(captured, [a, a, missing, missing]))).toBe(true);
  expect(readComparatorCount() - beforeDuplicates).toBe(1);
  const beforeConflictingDuplicate = readComparatorCount();
  expect(await validate(captured, [a, { ...a, observed: { kind: "missing" } }]))
    .toMatchObject({ _tag: "Failure", failure: { reason: "invalidInput" } });
  expect(readComparatorCount()).toBe(beforeConflictingDuplicate);
  expect(missing.observed.kind).toBe("missing");
  expect(matchesFiniteMetadataDependencyObservation(original, key("a"), captured, a)).toBe(true);
  expect(matchesFiniteMetadataDependencyObservation(original, key("negative"), captured, missing)).toBe(true);
  expect(matchesFiniteMetadataDependencyObservation({ ...original }, key("a"), captured, a)).toBe(false);
  expect(matchesFiniteMetadataDependencyObservation(await prepare(2, 1), key("a"), captured, a)).toBe(false);
  expect(matchesFiniteMetadataDependencyObservation(await prepare(1, 1, true), key("negative"), captured, missing)).toBe(false);
  expect(matchesFiniteMetadataDependencyObservation(original, key("a"), MetadataSequenceSchema.make(captured + 1n), a)).toBe(false);
  expect(matchesFiniteMetadataDependencyObservation(original, key("b"), captured, a)).toBe(false);
  expect(matchesFiniteMetadataDependencyObservation(original, key("a"), captured,
    { ...a, observed: { kind: "present", semanticSha256Hex: "f".repeat(64) } })).toBe(false);
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
  const expected = Result.getOrThrow(prepareFiniteMetadataEntryComparison(current));
  expect(Result.isFailure(prepareFiniteMetadataEntryComparison({ ...current }))).toBe(true);
  const [compact] = await db.select({ verdict: sql<unknown>`fx_compare_finite_metadata(${scopeId}::text,
    ${after.lastMetadataSequence.toString()}::bigint, ${JSON.stringify(expected)}::jsonb)` }).from(sql`(values (1)) as metadata_comparison`);
  expect(compact?.verdict).toEqual({ reason: "accepted" });
  expect(Result.isSuccess(acceptFiniteMetadataComparisonVerdict(compact?.verdict, expected, after.lastMetadataSequence))).toBe(true);
  expect(acceptFiniteMetadataComparisonVerdict({ reason: "accepted", observations: [] }, expected, after.lastMetadataSequence))
    .toMatchObject({ _tag: "Failure", failure: { reason: "invalidProjection" } });
  expect(acceptFiniteMetadataComparisonVerdict({ reason: "projectionMissing", ordinal: expected.length,
    currentObservation: null }, expected, after.lastMetadataSequence))
    .toMatchObject({ _tag: "Failure", failure: { reason: "invalidProjection" } });

  // The SQL owner retains input order across different failure kinds. A digest
  // mismatch at the original watermark precedes a later-key changed sequence;
  // reordering the actual dependencies reverses the first refusal.
  const freshA = Result.getOrThrow(captureFiniteMetadataDependency(current, key("a"), after.lastMetadataSequence));
  const freshB = Result.getOrThrow(captureFiniteMetadataDependency(current, key("b"), after.lastMetadataSequence));
  const predicate = (path: string) => and(eq(fxSystemMetadataContractObservations.scopeId, scopeId),
    eq(fxSystemMetadataContractObservations.namespace, owner.namespace),
    eq(fxSystemMetadataContractObservations.ownerKey, owner.ownerKey),
    eq(fxSystemMetadataContractObservations.contractKey, key(path).contractKey));
  const [storedA] = await db.select().from(fxSystemMetadataContractObservations).where(predicate("a"));
  const [storedB] = await db.select().from(fxSystemMetadataContractObservations).where(predicate("b"));
  if (storedA === undefined || storedB === undefined) throw new Error("Missing real ordered metadata rows");
  // A genuinely absent row cannot satisfy a captured positive observation;
  // this reaches the migrated SQL LEFT JOIN, not a synthetic verdict decoder.
  await db.delete(fxSystemMetadataContractObservations).where(predicate("a"));
  const beforeMissingRow = readComparatorCount();
  expect(await validate(after.lastMetadataSequence, [freshA]))
    .toMatchObject({ _tag: "Failure", failure: { reason: "projectionMissing", dependency: key("a"), currentObservation: null } });
  expect(readComparatorCount() - beforeMissingRow).toBe(1);
  await db.insert(fxSystemMetadataContractObservations).values(storedA);
  await db.update(fxSystemMetadataContractObservations).set({ semanticSha256Hex: "f".repeat(64) }).where(predicate("a"));
  await db.update(fxSystemMetadataContractObservations).set({
    lastChangedMetadataSequence: MetadataSequenceSchema.make(after.lastMetadataSequence + 1n),
  }).where(predicate("b"));
  expect(await validate(after.lastMetadataSequence, [freshA, freshB]))
    .toMatchObject({ _tag: "Failure", failure: { reason: "projectionMissing", dependency: key("a") } });
  expect(await validate(after.lastMetadataSequence, [freshB, freshA]))
    .toMatchObject({ _tag: "Failure", failure: { reason: "writeConflict", dependency: key("b"),
      lastChangedMetadataSequence: after.lastMetadataSequence + 1n } });
  await db.update(fxSystemMetadataContractObservations).set({ semanticSha256Hex: storedA.semanticSha256Hex }).where(predicate("a"));
  await db.update(fxSystemMetadataContractObservations).set({ lastChangedMetadataSequence: storedB.lastChangedMetadataSequence }).where(predicate("b"));
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
