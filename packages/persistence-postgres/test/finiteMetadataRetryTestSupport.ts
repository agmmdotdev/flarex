import { Effect, Result } from "effect";
import type { CommitSeq, ScopeEpoch, ScopeId } from "flarex-protocol/storage-authority";
import { applyFiniteMetadataActivationProjection, captureFiniteMetadataDependency, finiteMetadataContractKey,
  prepareFiniteMetadataProjection, requireCurrentFiniteMetadataProjection, validateConsumedMetadataDependencies } from "../src/finiteMetadataDependencies";
import { PointCommitConflictV1Error } from "../src/pointCommitErrors";
import { createPGlitePersistence } from "../src/pglite";
import { newTestPGlite } from "./pgliteSearchExtensions";
import { insertCurrentScopeClockFixture } from "./scopeClockFixture";

/** Actual metadata mutation and sequencer evidence for the executor retry proof. */
export async function createMetadataOnlyConflictFixture(input: Readonly<{ scopeId: ScopeId; epoch: ScopeEpoch; commitSeq: CommitSeq }>) {
  const db = newTestPGlite();
  try {
    const persistence = await createPGlitePersistence({ db });
    await persistence.migrate();
    await insertCurrentScopeClockFixture(persistence.drizzle, { scopeId: input.scopeId, epoch: input.epoch, lastCommitSeq: input.commitSeq });
    const owner = { namespace: "execution", ownerKey: "application" } as const;
    const prepare = (program: string) => Effect.runPromise(prepareFiniteMetadataProjection({ indexes: [], unique: [],
      application: { functions: [{ path: "users:create", semantic: { program } }], groups: [] } }));
    const projection = await prepare("retained");
    const watermark = await persistence.drizzle.transaction(tx => Effect.runPromise(
      applyFiniteMetadataActivationProjection(tx, input.scopeId, projection, [owner])));
    const dependency = Result.getOrThrow(captureFiniteMetadataDependency(projection,
      { ...owner, contractKey: finiteMetadataContractKey("function", "users:create") }, watermark));
    for (const program of ["change1", "change2", "changed"]) {
      const changed = await prepare(program);
      await persistence.drizzle.transaction(tx => Effect.runPromise(applyFiniteMetadataActivationProjection(tx, input.scopeId, changed, [owner])));
    }
    // Restore the exact retained semantic pin. The original attempt still
    // conflicts through ABA, while a genuine later entry can reuse that pin.
    await persistence.drizzle.transaction(tx => Effect.runPromise(applyFiniteMetadataActivationProjection(tx, input.scopeId, projection, [owner])));
    const verdict = await persistence.drizzle.transaction(tx => Effect.runPromise(Effect.result(
      validateConsumedMetadataDependencies(tx, input.scopeId, watermark, [dependency]))));
    const error = Result.match(verdict, { onSuccess: () => { throw new Error("Metadata change did not conflict"); }, onFailure: failure => failure });
    if (error.reason !== "writeConflict" || error.dependency === undefined || error.capturedMetadataWatermark === undefined ||
      error.lastChangedMetadataSequence === undefined) throw new Error("Missing real metadata conflict witness");
    const clock = await persistence.getScopeClock(input.scopeId);
    if (clock === null || clock.lastCommitSeq !== input.commitSeq) throw new Error("Metadata activation advanced application data");
    const replacementDependency = Result.getOrThrow(captureFiniteMetadataDependency(projection,
      { ...owner, contractKey: dependency.contractKey }, clock.lastMetadataSequence));
    await persistence.drizzle.transaction(tx => Effect.runPromise(requireCurrentFiniteMetadataProjection(tx, input.scopeId, clock.lastMetadataSequence, projection)
      .pipe(Effect.andThen(validateConsumedMetadataDependencies(tx, input.scopeId, clock.lastMetadataSequence, [replacementDependency])))));
    return { dependency, lastMetadataSequence: clock.lastMetadataSequence,
      conflict: new PointCommitConflictV1Error({ conflict: { kind: "metadata", ...error.dependency,
        capturedMetadataWatermark: error.capturedMetadataWatermark, lastChangedMetadataSequence: error.lastChangedMetadataSequence },
        snapshotCommitSeq: input.commitSeq, currentCommitSeq: clock.lastCommitSeq }), close: () => db.close() };
  } catch (error) { await db.close(); throw error; }
}
