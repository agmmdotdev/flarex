import { and, eq } from "drizzle-orm";
import { bytesEqualFullScan } from "@flarex/utils/bytes";
import { Effect } from "effect";
import { expect } from "vitest";
import {
  fxSystemApplicationActivations,
  fxSystemApplicationActiveHeads,
  fxSystemApplicationReadBindings,
} from "../../../src/application/applicationActivationSchema";
import {
  fxAppRowCurrent,
  fxAppRowRevisions,
  fxSystemApplicationReadinessV1,
  fxSystemCommits,
  fxSystemIdempotency,
  fxSystemInstallation,
  fxSystemMetadataContractObservations,
  fxSystemScopeClocks,
  fxSystemSnapshotLeases,
  fxSystemTransactionExecutionClaims,
  fxSystemTransactionJournals,
  fxSystemTransactionSessions,
} from "../../../src/database/schema";
import { readFiniteAttemptAnchorRow } from "../../../src/execution/finiteAttemptAnchor";
import type { ApplicationNativeMutationFixture, ApplicationNativeMutationPersistence } from "../applicationNativeMutationTestFixture";
import { FINITE_INDEXED_QUERY_OPTIONS, makeFiniteIndexedQueriesHarness } from "../../execution/journal/finiteIndexedQueriesScenario";

export { FINITE_INDEXED_QUERY_OPTIONS as EXECUTION_CATALOG_BACKFILL_CORRUPTION_OPTIONS };

/** Deliberate stored corruption is confined to this disposable installation.
 * Public maintenance must keep it drained; fixture teardown owns disposal. */
export const executionCatalogBackfillCorruptionScenario = Effect.fn("ExecutionGroup.catalogBackfillCorruption")(
  function* (native: ApplicationNativeMutationFixture<ApplicationNativeMutationPersistence>,
    maintenance: Readonly<{ kind: "pglite" | "postgres"; migrate: () => Promise<void>;
      writer: ApplicationNativeMutationPersistence }>) {
    const harness = yield* makeFiniteIndexedQueriesHarness(native);
    const completed = yield* harness.freeze(yield* harness.open());
    expect(yield* harness.publisher.publishFinite(completed.command)).toMatchObject({ kind: "published" });
    const nonterminal = yield* harness.open();
    const active = yield* native.activation.readActive();
    const database = maintenance.writer.drizzle;
    const snapshot = async () => ({
      metadata: await database.select().from(fxSystemMetadataContractObservations).orderBy(
        fxSystemMetadataContractObservations.namespace, fxSystemMetadataContractObservations.ownerKey,
        fxSystemMetadataContractObservations.contractKey),
      clocks: await database.select().from(fxSystemScopeClocks).orderBy(fxSystemScopeClocks.scopeId),
      heads: await database.select().from(fxSystemApplicationActiveHeads).orderBy(fxSystemApplicationActiveHeads.scopeId),
      activations: await database.select().from(fxSystemApplicationActivations).orderBy(
        fxSystemApplicationActivations.scopeId, fxSystemApplicationActivations.activationSequence),
      bindings: await database.select().from(fxSystemApplicationReadBindings).orderBy(
        fxSystemApplicationReadBindings.scopeId, fxSystemApplicationReadBindings.activationSequence),
      sessions: await database.select().from(fxSystemTransactionSessions).orderBy(fxSystemTransactionSessions.sessionId),
      leases: await database.select().from(fxSystemSnapshotLeases).orderBy(fxSystemSnapshotLeases.sessionId),
      claims: await database.select().from(fxSystemTransactionExecutionClaims).orderBy(fxSystemTransactionExecutionClaims.sessionId),
      journals: await database.select().from(fxSystemTransactionJournals).orderBy(fxSystemTransactionJournals.sessionId),
      outcomes: await database.select().from(fxSystemIdempotency).orderBy(fxSystemIdempotency.requestKey),
      commits: await database.select().from(fxSystemCommits).orderBy(fxSystemCommits.scopeUuid, fxSystemCommits.commitSeq),
      documents: await database.select().from(fxAppRowCurrent).orderBy(fxAppRowCurrent.scopeUuid, fxAppRowCurrent.tableId, fxAppRowCurrent.rowId),
      revisions: await database.select().from(fxAppRowRevisions).orderBy(
        fxAppRowRevisions.scopeUuid, fxAppRowRevisions.tableId, fxAppRowRevisions.rowId, fxAppRowRevisions.commitSeq),
    });
    const preserved = yield* Effect.tryPromise(snapshot);
    expect(preserved.metadata.length).toBeGreaterThan(0);
    expect(preserved.bindings).toHaveLength(1);
    expect(preserved.heads).toHaveLength(1);
    expect(preserved.outcomes.length).toBeGreaterThan(0);
    const originalSession = preserved.sessions.find(row => row.sessionId === nonterminal.context.anchor.sessionId);
    if (originalSession === undefined) throw new Error("Missing genuine nonterminal finite session");
    expect(originalSession.lifecycle).toBe("running");
    expect(originalSession.finiteAttemptBytes?.byteLength).toBeGreaterThan(0);
    const anchor = yield* readFiniteAttemptAnchorRow(originalSession);
    if (anchor.reservation === null) throw new Error("Missing genuine finite metadata reservation");
    expect(anchor.reservation).toMatchObject({ sessionId: nonterminal.context.anchor.sessionId,
      metadataWatermark: nonterminal.context.session.finiteMetadataWatermark,
      application: { revisionId: active.basis.revisionId } });
    const readinessRows = yield* Effect.tryPromise(() => database.select().from(fxSystemApplicationReadinessV1).where(and(
      eq(fxSystemApplicationReadinessV1.scopeId, native.authority.scopeId),
      eq(fxSystemApplicationReadinessV1.revisionId, active.basis.revisionId))));
    const original = readinessRows[0];
    if (original === undefined) throw new Error("Missing actual active readiness receipt");
    expect(readinessRows).toHaveLength(1);
    expect(bytesEqualFullScan(original.functionCatalogSha256, active.basis.functionCatalogSha256)).toBe(true);
    expect(original.functionCatalogSha256.byteLength).toBe(32);
    const corruptDigest = original.functionCatalogSha256.map((byte, index) => index === 0 ? byte ^ 0xff : byte);
    // Test-admin corruption changes this field alone. Normal admission and
    // metadata invalidation triggers remain installed and enabled throughout.
    const corrupted = yield* Effect.tryPromise(() => database.update(fxSystemApplicationReadinessV1)
      .set({ functionCatalogSha256: corruptDigest }).where(and(
        eq(fxSystemApplicationReadinessV1.scopeId, original.scopeId),
        eq(fxSystemApplicationReadinessV1.revisionId, original.revisionId))).returning());
    expect(corrupted).toEqual([{ ...original, functionCatalogSha256: corruptDigest }]);
    expect(yield* Effect.tryPromise(snapshot)).toEqual(preserved);
    for (const attempt of ["initial", "successor"] as const) {
      const refusal = yield* Effect.flip(Effect.tryPromise({ try: maintenance.migrate, catch: cause => cause }));
      const catalogFailure = { _tag: "ApplicationActivationError", operation: "activate", reason: "storedState",
        revisionId: original.revisionId, retryable: false };
      expect(refusal, attempt).toMatchObject(maintenance.kind === "pglite" ? catalogFailure
        : { _tag: "InstallationLifecycleError", reason: "invalidInstallation", cause: catalogFailure });
      expect(yield* Effect.tryPromise(() => database.select({ state: fxSystemInstallation.state,
        maintenanceOwner: fxSystemInstallation.maintenanceOwner }).from(fxSystemInstallation)), attempt)
        .toEqual([{ state: "draining", maintenanceOwner: expect.any(String) }]);
      expect(yield* Effect.tryPromise(snapshot), attempt).toEqual(preserved);
      expect(yield* Effect.tryPromise(() => database.select().from(fxSystemApplicationReadinessV1).where(and(
        eq(fxSystemApplicationReadinessV1.scopeId, original.scopeId),
        eq(fxSystemApplicationReadinessV1.revisionId, original.revisionId)))), attempt).toEqual(corrupted);
    }
    // Stored corruption has no automatic repair owner. Reopening valid
    // predecessor metadata is covered by the separate maintenance scenario.
  },
);
