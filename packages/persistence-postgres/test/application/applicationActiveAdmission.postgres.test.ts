import { and, eq, sql } from "drizzle-orm";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { prepareApplicationBindingSelection, withAcceptedApplicationBinding } from "../../src/application/applicationActivation";
import { fxSystemApplicationReadiness, fxSystemApplicationReadinessRelations } from "../../src/application/relations/applicationRelationSchema";
import type { FlarexMetadataTransaction } from "../../src/database/metadataTransaction";
import { fxControlBoundApplicationSchemas, fxControlIndexDefinitions, fxControlSchemaVersionUniqueConstraintSets, fxSystemApplicationRevisionsV2 } from "../../src/database/schema";
import { lockScopeClockForShareInTransactionEffect } from "../../src/scope/scopeClock";
import { prepareReadinessEvidence, relationReadinessFixture } from "./relations/applicationRelationReadinessFixture";
import { runEffect, runEffectFailure } from "../support/effectTestRuntime";
import { postgresUrl, useFileScopedPostgresPersistence, withTemporaryPostgresPersistencePair } from "../support/postgresHelpers";

describe.skipIf(postgresUrl === null)("active readiness admission locks", () => {
  const withPersistence = useFileScopedPostgresPersistence();

  it.each(["schema binding", "unique closure", "ordered definition"] as const)("rejects %s corruption observed inside the accepting transaction", kind => withPersistence(async persistence => {
    const fixture = await relationReadinessFixture({ persistence, bindingAdmission: true });
    await prepareReadinessEvidence(fixture);
    await runEffect(fixture.fold.settle(fixture.input));
    await runEffect(fixture.relationActivation.activate({ revisionId: fixture.input.revisionId, expectedActiveHead: null }));
    const selection = await runEffect(prepareApplicationBindingSelection(fixture.relationActivation));
    const rollback = new Error("Rollback deliberate catalog corruption");
    await expect(persistence.drizzle.transaction(async tx => {
      if (kind === "schema binding") {
        await tx.update(fxControlBoundApplicationSchemas).set({ bindingBytes: new Uint8Array([1]) })
          .where(eq(fxControlBoundApplicationSchemas.deploymentId, fixture.deploymentId));
      } else if (kind === "unique closure") {
        await tx.update(fxControlSchemaVersionUniqueConstraintSets).set({ definitionSetSha256: new Uint8Array(32) })
          .where(eq(fxControlSchemaVersionUniqueConstraintSets.deploymentId, fixture.deploymentId));
      } else {
        const rows = await tx.update(fxControlIndexDefinitions).set({ physicalSpecBytes: new Uint8Array([1]) })
          .where(eq(fxControlIndexDefinitions.deploymentId, fixture.deploymentId)).returning();
        expect(rows.length).toBeGreaterThan(0);
      }
      const clock = await runEffect(lockScopeClockForShareInTransactionEffect(tx, fixture.authority.scopeId));
      expect(await runEffectFailure(withAcceptedApplicationBinding(selection, tx, clock, () => Effect.void)))
        .toMatchObject({ _tag: kind === "schema binding" ? "ReadApplicationRelationBindingError" : kind === "unique closure" ? "AppUniqueConstraintSetClosureCorruptionV1Error" : "AppIndexDefinitionCatalogCorruptionError" });
      throw rollback;
    })).rejects.toBe(rollback);
    await persistence.drizzle.transaction(tx => runEffect(Effect.gen(function* () {
      const clock = yield* lockScopeClockForShareInTransactionEffect(tx, fixture.authority.scopeId);
      yield* withAcceptedApplicationBinding(selection, tx, clock, () => Effect.void);
    })));
  }), 120_000);

  it("keeps separately placed catalog reads on their registered database", () => withTemporaryPostgresPersistencePair(async (control, target) => {
    const fixture = await relationReadinessFixture({ persistence: target, controlPersistence: control, bindingAdmission: true });
    await prepareReadinessEvidence(fixture);
    await runEffect(fixture.fold.settle(fixture.input));
    await runEffect(fixture.relationActivation.activate({ revisionId: fixture.input.revisionId, expectedActiveHead: null }));
    const selection = await runEffect(prepareApplicationBindingSelection(fixture.relationActivation));
    const admit = (tx: FlarexMetadataTransaction) => Effect.gen(function* () {
      const clock = yield* lockScopeClockForShareInTransactionEffect(tx, fixture.authority.scopeId);
      yield* withAcceptedApplicationBinding(selection, tx, clock, () => Effect.void);
    });
    await target.drizzle.transaction(tx => runEffect(admit(tx)));
    await control.drizzle.update(fxControlBoundApplicationSchemas).set({ bindingBytes: new Uint8Array([1]) })
      .where(eq(fxControlBoundApplicationSchemas.deploymentId, fixture.deploymentId));
    expect(await target.drizzle.transaction(tx => runEffectFailure(admit(tx))))
      .toMatchObject({ _tag: "ReadApplicationRelationBindingError" });
    for (const persistence of [control, target]) {
      expect(persistence.pool.waitingCount).toBe(0);
      expect(persistence.pool.totalCount).toBe(persistence.pool.idleCount);
    }
  }), 120_000);

  it("shares revision, root and child protection while excluding their updates", () => withPersistence(async persistence => {
    const fixture = await relationReadinessFixture({ persistence, bindingAdmission: true });
    await prepareReadinessEvidence(fixture);
    await runEffect(fixture.fold.settle(fixture.input));
    await runEffect(fixture.relationActivation.activate({ revisionId: fixture.input.revisionId, expectedActiveHead: null }));
    const selection = await runEffect(prepareApplicationBindingSelection(fixture.relationActivation));
    const scopeId = fixture.authority.scopeId;
    const revisionId = fixture.input.revisionId;
    const admit = (tx: FlarexMetadataTransaction) => runEffect(Effect.gen(function* () {
      const clock = yield* lockScopeClockForShareInTransactionEffect(tx, scopeId);
      yield* withAcceptedApplicationBinding(selection, tx, clock, () => Effect.void);
    }));
    // Non-key no-op updates probe protection without introducing a lifecycle engine.
    const updates = [
      (tx: FlarexMetadataTransaction) => tx.update(fxSystemApplicationRevisionsV2)
        .set({ registeredAt: sql`${fxSystemApplicationRevisionsV2.registeredAt}` }).where(and(eq(fxSystemApplicationRevisionsV2.scopeId, scopeId), eq(fxSystemApplicationRevisionsV2.revisionId, revisionId)))
        .returning({ revisionId: fxSystemApplicationRevisionsV2.revisionId }),
      (tx: FlarexMetadataTransaction) => tx.update(fxSystemApplicationReadiness)
        .set({ readyAt: sql`${fxSystemApplicationReadiness.readyAt}` }).where(and(eq(fxSystemApplicationReadiness.scopeId, scopeId), eq(fxSystemApplicationReadiness.revisionId, revisionId)))
        .returning({ revisionId: fxSystemApplicationReadiness.revisionId }),
      (tx: FlarexMetadataTransaction) => tx.update(fxSystemApplicationReadinessRelations)
        .set({ physicalAttemptFence: sql`${fxSystemApplicationReadinessRelations.physicalAttemptFence}` }).where(and(eq(fxSystemApplicationReadinessRelations.scopeId, scopeId), eq(fxSystemApplicationReadinessRelations.revisionId, revisionId)))
        .returning({ revisionId: fxSystemApplicationReadinessRelations.revisionId }),
    ];
    expect(await persistence.drizzle.select({ revisionId: fxSystemApplicationReadinessRelations.revisionId })
      .from(fxSystemApplicationReadinessRelations).where(eq(fxSystemApplicationReadinessRelations.scopeId, scopeId))).toHaveLength(2);
    await persistence.drizzle.transaction(async first => {
      await admit(first);
      // A second full admission completes before the first transaction ends.
      await persistence.drizzle.transaction(async second => {
        await second.execute(sql`set local lock_timeout = '500ms'`);
        await admit(second);
      });
      for (const update of updates) {
        await expect(persistence.drizzle.transaction(async writer => {
          await writer.execute(sql`set local lock_timeout = '100ms'`);
          return update(writer);
        })).rejects.toMatchObject({ cause: { code: "55P03" } });
      }
    });
    for (const [index, update] of updates.entries()) {
      expect(await persistence.drizzle.transaction(async tx => update(tx))).toHaveLength(index === 2 ? 2 : 1);
    }
    await persistence.drizzle.transaction(admit);
  }), 120_000);
});
