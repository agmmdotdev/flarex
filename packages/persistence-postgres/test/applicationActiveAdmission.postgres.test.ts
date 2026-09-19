import { and, eq, sql } from "drizzle-orm";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { prepareApplicationBindingSelection, withAcceptedApplicationBinding } from "../src/applicationActivation";
import { fxSystemApplicationReadiness, fxSystemApplicationReadinessRelations } from "../src/applicationRelationSchema";
import type { FlarexMetadataTransaction } from "../src/metadataTransaction";
import { fxSystemApplicationRevisionsV2 } from "../src/schema";
import { lockScopeClockForShareInTransactionEffect } from "../src/scopeClock";
import { prepareReadinessEvidence, relationReadinessFixture } from "./applicationRelationReadinessFixture";
import { runEffect } from "./effectTestRuntime";
import { postgresUrl, useFileScopedPostgresPersistence } from "./postgresHelpers";

describe.skipIf(postgresUrl === null)("active readiness admission locks", () => {
  const withPersistence = useFileScopedPostgresPersistence();

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
