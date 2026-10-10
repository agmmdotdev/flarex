import { webcrypto } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import {
  createApplicationTaskCatalogSnapshotPort,
} from "../../../src/application/tasks/applicationTaskBindings";
import {
  createApplicationRelationTaskCatalogSnapshotPort,
} from "../../../src/application/relations/applicationRelationTaskBindings";
import { lockScopeClockForSnapshotReadInTransactionEffect } from "../../../src/scope/scopeClock";
import { runEffect, runEffectFailure } from "../../support/effectTestRuntime";
import { postgresUrl, withTemporaryPostgresPersistencePair } from "../../support/postgresHelpers";
import { readinessFixture } from "../support/readinessPostgresFixture";

beforeAll(() => {
  if (globalThis.crypto === undefined) {
    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      value: webcrypto,
    });
  }
});

const describePostgres = postgresUrl === null ? describe.skip : describe;

describePostgres("Application tasks/admission.postgres", { timeout: 30_000 }, () => {
  it("rechecks task authority after a key-share clock lock permits a non-key update", async () => {
    await withTemporaryPostgresPersistencePair(async (control, target) => {
      const fixture = await readinessFixture(control, target);
      let releaseLocked: (() => void) | undefined;
      const locked = new Promise<void>(resolve => { releaseLocked = resolve; });
      let releaseWriter: (() => void) | undefined;
      const writerDone = new Promise<void>(resolve => { releaseWriter = resolve; });
      const reader = target.drizzle.transaction(async tx => {
        const clock = await runEffect(lockScopeClockForSnapshotReadInTransactionEffect(
          tx, fixture.authority.scopeId,
        ));
        expect(clock.storageGeneration).toBe("flarexdb_v1");
        releaseLocked?.();
        await writerDone;
        const legacy = await runEffectFailure(
          createApplicationTaskCatalogSnapshotPort().loadInTransaction(
            tx, fixture.authority, fixture.input.revisionId,
          ),
        );
        const relation = await runEffectFailure(
          createApplicationRelationTaskCatalogSnapshotPort().loadInTransaction(
            tx, fixture.authority, fixture.input.revisionId,
          ),
        );
        expect(legacy).toMatchObject({ reason: "authorityChanged" });
        expect(relation).toMatchObject({ reason: "authorityChanged" });
      });
      let failure: unknown;
      try {
        // Race the handshake with reader completion so an early reader failure
        // cannot leave the test waiting for a signal that will never arrive.
        await Promise.race([locked, reader]);
        const writer = await target.pool.connect();
        try {
          await writer.query("begin");
          await writer.query("set local lock_timeout = '2s'");
          await writer.query(
            "update fx_system_scope_execution_authority set storage_generation = 'legacy_v1' where scope_id = $1",
            [fixture.authority.scopeId],
          );
          await writer.query("commit");
        } catch (error) {
          await writer.query("rollback");
          throw error;
        } finally {
          writer.release();
        }
      } catch (error) {
        failure = error;
      } finally {
        releaseWriter?.();
        try {
          await reader;
        } catch (error) {
          failure ??= error;
        }
      }
      if (failure !== undefined) throw failure;
    });
  }, 120_000)
});
