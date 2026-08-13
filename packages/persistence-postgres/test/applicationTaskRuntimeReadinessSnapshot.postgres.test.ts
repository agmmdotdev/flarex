import { webcrypto } from "node:crypto";
import { Result } from "effect";
import { beforeAll, describe, expect, it } from "vitest";

import { createApplicationTaskCatalogSnapshotPort } from
  "../src/applicationTaskBindings";
import { makeApplicationTaskRuntimePublicationRepository } from
  "../src/applicationTaskRuntimePublication";
import { createApplicationTaskRuntimeReadinessSnapshotPort } from
  "../src/applicationTaskRuntimeReadinessSnapshot";
import { createApplicationTaskRuntimeReadinessReservationPort } from
  "../src/applicationTaskRuntimeReadinessReservation";
import { runEffect } from "./effectTestRuntime";
import {
  makeTaskRuntimePublicationFixtureOnDatabase,
} from "./applicationTaskRuntimePublicationTestSupport";
import {
  postgresUrl,
  withTemporaryPostgresPersistence,
} from "./postgresHelpers";
import { insertSessionTestScope } from "./sessionAuthorityTestSupport";

const describePostgres = postgresUrl === null ? describe.skip : describe;

beforeAll(() => {
  if (globalThis.crypto === undefined) {
    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      value: webcrypto,
    });
  }
});

describePostgres(
  "Application task-runtime readiness snapshot - PostgreSQL",
  () => {
    it("reserves only the exact current parent and runtime publication", async () => {
      await withTemporaryPostgresPersistence(async persistence => {
        await insertSessionTestScope(persistence);
        const fixture = await makeTaskRuntimePublicationFixtureOnDatabase(
          persistence.drizzle,
        );
        const receipt = Result.getOrThrow(
          fixture.receiptAuthority.captureReceipt(fixture.publication),
        ).receipt;
        const port = createApplicationTaskRuntimeReadinessSnapshotPort(
          createApplicationTaskCatalogSnapshotPort(),
        );
        const reservation =
          createApplicationTaskRuntimeReadinessReservationPort(
            persistence.drizzle,
            port,
          );
        const load = () => persistence.drizzle.transaction(tx => runEffect(
          port.loadInTransaction(
            tx,
            fixture.authority,
            receipt.applicationRevisionId,
          ),
        ));

        expect(await load()).toBeNull();
        await runEffect(makeApplicationTaskRuntimePublicationRepository(
          fixture.db,
          fixture.receiptAuthority,
        ).publish({
          authority: fixture.authority,
          publication: fixture.publication,
        }));
        let releaseSnapshot!: () => void;
        const release = new Promise<void>(resolve => {
          releaseSnapshot = resolve;
        });
        let snapshotReserved!: () => void;
        const reserved = new Promise<void>(resolve => {
          snapshotReserved = resolve;
        });
        const heldSnapshot = persistence.drizzle.transaction(async tx => {
          const snapshot = await runEffect(port.loadInTransaction(
            tx,
            fixture.authority,
            receipt.applicationRevisionId,
          ));
          snapshotReserved();
          await release;
          return snapshot;
        });
        await reserved;
        let writerSettled = false;
        const writer = persistence.query(`
          update fx_system_application_task_runtime_publication_v1 /* readiness_snapshot_lock_probe */
          set published_at = published_at
          where scope_id = '${fixture.authority.scopeId}'
            and revision_id = '${receipt.applicationRevisionId}'
        `).finally(() => {
          writerSettled = true;
        });
        let lockAssertionFailure: unknown;
        try {
          await waitForSnapshotWriterLock(persistence);
          expect(writerSettled).toBe(false);
        } catch (cause) {
          lockAssertionFailure = cause;
        } finally {
          releaseSnapshot();
        }
        const [snapshotResult, writerResult] = await Promise.allSettled([
          heldSnapshot,
          writer,
        ]);
        if (lockAssertionFailure !== undefined) throw lockAssertionFailure;
        if (snapshotResult.status === "rejected") throw snapshotResult.reason;
        if (writerResult.status === "rejected") throw writerResult.reason;
        const snapshot = snapshotResult.value;
        if (snapshot === null) throw new Error("Expected readiness snapshot.");
        expect(snapshot.receiptObjectCount).toBe(7);
        expect(snapshot.readParentEvidence()).toMatchObject({
          scopeId: receipt.scopeId,
          candidateId: receipt.candidateId,
          analysisId: receipt.analysisId,
          applicationRevisionId: receipt.applicationRevisionId,
        });
        const replay = await runEffect(reservation.reserve({
          authority: fixture.authority,
          revisionId: receipt.applicationRevisionId,
        }));
        expect(replay?.readReceiptSha256()).toEqual(
          Result.getOrThrow(
            fixture.receiptAuthority.captureReceipt(fixture.publication),
          ).sha256,
        );
        expect((await persistence.query("select 1 as value")).rows)
          .toEqual([{ value: 1 }]);
      });
    });
  },
);

async function waitForSnapshotWriterLock(
  persistence: Parameters<Parameters<
    typeof withTemporaryPostgresPersistence
  >[0]>[0],
): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const result = await persistence.query<{
      wait_event_type: string | null;
    }>(`
      select wait_event_type
      from pg_stat_activity
      where query like '%readiness_snapshot_lock_probe%'
        and query not like '%pg_stat_activity%'
        and state = 'active'
      limit 1
    `);
    if (result.rows[0]?.wait_event_type === "Lock") return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error("Timed out waiting for the snapshot-blocked writer.");
}
