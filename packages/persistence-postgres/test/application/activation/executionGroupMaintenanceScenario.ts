import { eq } from "drizzle-orm";
import { Effect, Result } from "effect";
import { expect } from "vitest";
import type { ApplicationNativeMutationFixture, ApplicationNativeMutationPersistence } from "../applicationNativeMutationTestFixture";
import { FINITE_INDEXED_QUERY_OPTIONS, makeFiniteIndexedQueriesHarness } from "../../execution/journal/finiteIndexedQueriesScenario";
import { finiteMetadataContractKey, initializeCurrentFiniteMetadataProjection, prepareFiniteMetadataProjection,
  APPLICATION_EXECUTION_METADATA_OWNER } from "../../../src/execution/finiteMetadataDependencies";
import { fxSystemMetadataContractObservations, fxSystemScopeClocks, fxSystemTransactionSessions, fxSystemSnapshotLeases,
  fxSystemTransactionExecutionClaims, fxSystemTransactionJournals, fxSystemIdempotency } from "../../../src/database/schema";
import { lockScopeClockForUpdateInTransactionEffect } from "../../../src/scope/scopeClock";
import { readFiniteAttemptAnchorRow } from "../../../src/execution/finiteAttemptAnchor";
import { runEffectTransaction } from "../../../src/database/effectTransaction";
import type { FlarexMetadataTransaction } from "../../../src/database/metadataTransaction";

export { FINITE_INDEXED_QUERY_OPTIONS as EXECUTION_GROUP_MAINTENANCE_OPTIONS };

/** Installation reconciliation changes current observations only. The genuine
 * entries below keep their persisted watermarks, reservations and outcomes. */
export const executionGroupMaintenanceScenario = Effect.fn("ExecutionGroup.maintenanceWitness")(
  function* (native: ApplicationNativeMutationFixture<ApplicationNativeMutationPersistence>,
    maintenance: Readonly<{ migrate: () => Promise<void>; writer: ApplicationNativeMutationPersistence;
      assertStaleInstalledCapability?: () => Promise<void> }>) {
    const initial = yield* native.activation.readActive();
    yield* Effect.promise(() => native.moveHead({ expectedActiveHead: initial.expectedActiveHead,
      manifest: { ...initial.basis.manifest, functions: initial.basis.manifest.functions.filter(fn => fn.path !== "users:createInternal") } }));
    const harness = yield* makeFiniteIndexedQueriesHarness(native);
    const settled = yield* harness.open();
    const completed = yield* harness.freeze(settled);
    expect(yield* harness.publisher.publishFinite(completed.command)).toMatchObject({ kind: "published" });
    const nonterminal = yield* harness.open();
    const frozen = yield* harness.freeze(nonterminal);
    const scopeId = native.authority.scopeId;
    const executionGroupKey = finiteMetadataContractKey("executionGroup", "legacy_dynamic_worker_v1");
    const rows = () => native.target.drizzle.select().from(fxSystemMetadataContractObservations)
      .where(eq(fxSystemMetadataContractObservations.scopeId, scopeId)).orderBy(fxSystemMetadataContractObservations.namespace,
        fxSystemMetadataContractObservations.ownerKey, fxSystemMetadataContractObservations.contractKey);
    const sequence = async () => {
      const row = (await native.target.drizzle.select().from(fxSystemScopeClocks)
        .where(eq(fxSystemScopeClocks.scopeId, scopeId)))[0];
      if (row === undefined) throw new Error("Missing actual maintenance scope clock");
      return row.lastMetadataSequence;
    };
    const durable = async () => ({
      sessions: await native.target.drizzle.select().from(fxSystemTransactionSessions).orderBy(fxSystemTransactionSessions.sessionId),
      leases: await native.target.drizzle.select().from(fxSystemSnapshotLeases).orderBy(fxSystemSnapshotLeases.sessionId),
      claims: await native.target.drizzle.select().from(fxSystemTransactionExecutionClaims).orderBy(fxSystemTransactionExecutionClaims.sessionId),
      journals: await native.target.drizzle.select().from(fxSystemTransactionJournals).orderBy(fxSystemTransactionJournals.sessionId),
      outcomes: await native.target.drizzle.select().from(fxSystemIdempotency).orderBy(fxSystemIdempotency.requestKey),
    });
    const originalRows = yield* Effect.promise(rows);
    expect(originalRows).toEqual(expect.arrayContaining([expect.objectContaining({ namespace: "execution", present: false,
      contractKey: finiteMetadataContractKey("function", "users:createInternal") })]));
    const original = originalRows.find(row => row.namespace === "execution" && row.contractKey === executionGroupKey);
    if (original === undefined) return yield* Effect.die(new Error("Missing actual execution group"));
    const active = yield* native.activation.readActive();
    // These exact predecessor bytes were the old production semantic. The
    // existing canonical projection/publication owners apply them; no metadata
    // row, clock, watermark or reservation is fabricated by the witness.
    const predecessor = yield* prepareFiniteMetadataProjection({ indexes: [], unique: [], application: {
      functions: active.basis.manifest.functions.map(fn => ({ path: fn.path, semantic: { ...fn } })),
      groups: [{ group: "legacy_dynamic_worker_v1", semantic: { sourceArtifact: active.basis.manifest.sourceArtifact,
        runtimeHostIdentity: active.basis.runtimeHostIdentity, compatibilityDate: active.basis.compatibilityDate } }],
    } });
    yield* runEffectTransaction<unknown, unknown, unknown, FlarexMetadataTransaction>(
      work => maintenance.writer.drizzle.transaction(work), "Predecessor execution projection rolled back", tx => Effect.gen(function* () {
        yield* lockScopeClockForUpdateInTransactionEffect(tx, scopeId);
        return yield* initializeCurrentFiniteMetadataProjection(tx, scopeId, predecessor, [APPLICATION_EXECUTION_METADATA_OWNER]);
      }), cause => cause);
    const previous = yield* Effect.promise(rows);
    const predecessorGroup = previous.find(row => row.namespace === "execution" && row.contractKey === executionGroupKey);
    if (predecessorGroup === undefined) return yield* Effect.die(new Error("Missing predecessor group"));
    expect(predecessorGroup.semanticSha256Hex).not.toBe(original.semanticSha256Hex);
    expect(previous.filter(row => row.contractKey !== executionGroupKey)).toEqual(originalRows.filter(row => row.contractKey !== executionGroupKey));
    const preserved = yield* Effect.promise(durable);
    expect(preserved.sessions).toEqual(expect.arrayContaining([expect.objectContaining({ sessionId: nonterminal.context.anchor.sessionId,
      lifecycle: "running", finiteMetadataWatermark: nonterminal.context.session.finiteMetadataWatermark })]));
    const originalSession = preserved.sessions.find(row => row.sessionId === nonterminal.context.anchor.sessionId);
    if (originalSession === undefined) return yield* Effect.die(new Error("Missing genuine nonterminal finite session"));
    // Current finite entry stores its canonical reservation in the durable
    // session anchor. Snapshot leases retain the displaced journal profile.
    const captured = yield* readFiniteAttemptAnchorRow(originalSession);
    const reservation = captured.reservation;
    if (reservation === null) return yield* Effect.die(new Error("Missing genuine nonterminal metadata reservation"));
    expect(originalSession.finiteAttemptBytes?.byteLength).toBeGreaterThan(0);
    expect(reservation).toMatchObject({ sessionId: nonterminal.context.anchor.sessionId,
      metadataWatermark: nonterminal.context.session.finiteMetadataWatermark,
      application: { revisionId: active.basis.revisionId } });
    expect(preserved.outcomes.length).toBeGreaterThan(0);
    // New-code preparation cannot repair old-code observations in a request.
    const staleEntry = yield* Effect.result(harness.open());
    expect(Result.isFailure(staleEntry)).toBe(true);
    if (Result.isSuccess(staleEntry)) return yield* Effect.die(new Error("Stale metadata preparation unexpectedly succeeded"));
    expect(staleEntry.failure).toMatchObject({ _tag: "SessionJournalPersistenceV1Error", operation: "openAttempt",
      cause: { _tag: "SessionJournalPersistenceV1Error", operation: "openAttempt",
        cause: { _tag: "FiniteMetadataError", reason: "projectionMissing", dependency: { namespace: "execution", ownerKey: "application",
          contractKey: executionGroupKey },
          expectedObservation: { kind: "present", semanticSha256Hex: original.semanticSha256Hex },
          currentObservation: { present: true, semanticSha256Hex: predecessorGroup.semanticSha256Hex,
            lastChangedMetadataSequence: predecessorGroup.lastChangedMetadataSequence } } } });
    expect(yield* Effect.promise(rows)).toEqual(previous);
    expect(yield* Effect.promise(durable)).toEqual(preserved);
    const previousSequence = yield* Effect.promise(sequence);
    yield* Effect.promise(maintenance.migrate);
    const reconciled = yield* Effect.promise(rows);
    const repaired = reconciled.find(row => row.namespace === "execution" && row.contractKey === executionGroupKey);
    if (repaired === undefined) return yield* Effect.die(new Error("Missing reconciled execution group"));
    expect(repaired.semanticSha256Hex).toBe(original.semanticSha256Hex);
    expect(repaired.lastChangedMetadataSequence).toBeGreaterThan(previousSequence);
    expect(reconciled.filter(row => row.contractKey !== executionGroupKey)).toEqual(previous.filter(row => row.contractKey !== executionGroupKey));
    expect(yield* Effect.promise(durable)).toEqual(preserved);
    yield* maintenance.assertStaleInstalledCapability === undefined ? Effect.void : Effect.promise(maintenance.assertStaleInstalledCapability);
    const repairedSequence = yield* Effect.promise(sequence);
    yield* Effect.promise(maintenance.migrate);
    expect(yield* Effect.promise(rows)).toEqual(reconciled);
    expect(yield* Effect.promise(sequence)).toBe(repairedSequence);
    expect(yield* Effect.promise(durable)).toEqual(preserved);
    // A -> predecessor -> A still changes the recorded contract sequence. The
    // original finite capture must conflict without any business publication.
    expect(yield* Effect.flip(harness.publisher.publishFinite(frozen.command))).toMatchObject({
      _tag: "PointCommitConflictV1Error", conflict: { kind: "metadata", namespace: "execution", ownerKey: "application",
        contractKey: executionGroupKey },
    });
    expect(yield* Effect.promise(durable)).toEqual(preserved);
  },
);
