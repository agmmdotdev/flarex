import { eq, sql } from "drizzle-orm";
import { Cause, Effect, Exit, Result } from "effect";
import { expect, it } from "vitest";
import { acceptPreparedApplicationRelationActiveRead, prepareApplicationRelationActiveRead } from "../../../src/application/relations/applicationRelationReadinessFold";
import { AppUniqueConstraintCatalogCorruptionError } from "../../../src/storage/unique/appUniqueConstraintDefinitions";
import { fxSystemApplicationActiveHeads } from "../../../src/application/applicationActivationSchema";
import { runEffectTransaction } from "../../../src/database/effectTransaction";
import { retainPreparedHost } from "../../../src/execution/preparation/preparedHostRuntime";
import { lockScopeClockForSnapshotReadInTransactionEffect } from "../../../src/scope/scopeClock";
import { fxControlUniqueConstraintDefinitions } from "../../../src/database/schema";
import { prepareReadinessEvidence, relationReadinessFixture } from "./applicationRelationReadinessFixture";
import { runEffect } from "../../support/effectTestRuntime";
import { createMigratedPGlitePersistence } from "../../support/pgliteTestFixture";
import { createFileScopedPostgresFixture, postgresUrl } from "../../support/postgresHelpers";
import { preparedHostTestRuntime } from "../../execution/preparation/preparedHostRuntimeTestSupport";

for (const driver of ["PGlite", "PostgreSQL"] as const) {
  const test = driver === "PostgreSQL" && postgresUrl === null ? it.skip : it;
  test(`retains the fullProof relation generation while freshly refusing unique physical bytes on ${driver}`, async () => {
    const native = driver === "PostgreSQL" ? await createFileScopedPostgresFixture() : undefined;
    const resource = native?.persistence ?? await createMigratedPGlitePersistence();
    try {
      const fixture = await relationReadinessFixture({ persistence: resource, writePolicy: true,
        cmsFields: [{ name: "title", kind: "text", unique: true }] });
      await prepareReadinessEvidence(fixture);
      await runEffect(fixture.relationActivation.activate({ revisionId: fixture.input.revisionId, expectedActiveHead: null }));
      const activeHead = await resource.drizzle.select().from(fxSystemApplicationActiveHeads)
        .where(eq(fxSystemApplicationActiveHeads.scopeId, fixture.authority.scopeId));
      expect(activeHead).toHaveLength(1);
      const retained = await runEffect(retainPreparedHost(preparedHostTestRuntime(resource.drizzle),
        prepareApplicationRelationActiveRead(fixture.fold, fixture.input)));
      let callbacks = 0;
      const accept = () => retained.use(prepared => runEffectTransaction(
        work => resource.drizzle.transaction(work), "Unique catalog admission rollback", tx => Effect.gen(function* () {
          const clock = yield* lockScopeClockForSnapshotReadInTransactionEffect(tx, fixture.authority.scopeId);
          const basis = yield* acceptPreparedApplicationRelationActiveRead(prepared, tx, clock);
          callbacks++;
          return basis;
        }), cause => new Error("Unique catalog transaction failed", { cause })));
      try {
        await runEffect(accept());
        expect(callbacks).toBe(1);
        const charged = Result.getOrThrow(retained.readUsage()).chargedBytes;
        const definition = (await fixture.control.drizzle.select().from(fxControlUniqueConstraintDefinitions).limit(1))[0];
        if (definition === undefined) throw new Error("Missing genuine unique definition");
        await fixture.control.drizzle.update(fxControlUniqueConstraintDefinitions).set({
          physicalSpecBytes: sql`set_byte(${fxControlUniqueConstraintDefinitions.physicalSpecBytes}, 0,
            (get_byte(${fxControlUniqueConstraintDefinitions.physicalSpecBytes}, 0) + 1) % 256)`,
        }).where(eq(fxControlUniqueConstraintDefinitions.uniqueConstraintDefinitionId, definition.uniqueConstraintDefinitionId));
        try {
          const refused = await Effect.runPromiseExit(accept());
          expect(Exit.isFailure(refused)).toBe(true);
          if (!Exit.isFailure(refused)) throw new Error("Corrupt unique definition reached admission");
          expect(refused.cause.reasons).toHaveLength(1);
          const failure = refused.cause.reasons[0];
          if (failure === undefined || !Cause.isFailReason(failure)) throw new Error("Expected original typed catalog corruption");
          expect(failure.error).toBeInstanceOf(AppUniqueConstraintCatalogCorruptionError);
          expect(callbacks).toBe(1);
          expect(await resource.drizzle.select().from(fxSystemApplicationActiveHeads)
            .where(eq(fxSystemApplicationActiveHeads.scopeId, fixture.authority.scopeId))).toEqual(activeHead);
          expect(Result.getOrThrow(retained.readUsage()).chargedBytes).toBe(charged);
        } finally {
          await fixture.control.drizzle.update(fxControlUniqueConstraintDefinitions).set({ physicalSpecBytes: definition.physicalSpecBytes })
            .where(eq(fxControlUniqueConstraintDefinitions.uniqueConstraintDefinitionId, definition.uniqueConstraintDefinitionId));
        }
        await runEffect(accept());
        expect(callbacks).toBe(2);
        expect(Result.getOrThrow(retained.readUsage()).chargedBytes).toBe(charged);
      } finally { await runEffect(retained.close); }
    } finally { await native?.dispose(); }
  }, 60_000);
}
