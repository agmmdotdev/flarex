import { setTimeout as delay } from "node:timers/promises";
import { sql } from "drizzle-orm";
import {
  CommitSeqSchema,
  FlarexDbV1StorageGenerationSchema,
  OutboxSeqSchema,
  ScopeEpochSchema,
  ScopeIdSchema,
  StorageGenerationFenceSchema,
  type ScopeId,
} from "flarex-protocol/storage-authority";
import { describe, expect, it } from "vitest";

import type { FlarexPersistence } from "../src";
import { lockScopeClockForUpdateInTransaction } from "../src/scopeClock";
import { fxSystemScopeClocks } from "../src/schema";
import {
  postgresUrl,
  withTemporaryPostgresPersistence,
} from "./postgresHelpers";

const describePostgres = postgresUrl === null ? describe.skip : describe;

describePostgres("real Postgres scope clock locking", () => {
  it("blocks the same scope, permits another scope, and rolls back the probe", async () => {
    await withTemporaryPostgresPersistence(async (persistence) => {
      const lockedScopeId = ScopeIdSchema.make("scope_clock_pg_locked");
      const independentScopeId = ScopeIdSchema.make(
        "scope_clock_pg_independent",
      );
      await insertScopeClock(persistence, lockedScopeId, "epoch-locked");
      await insertScopeClock(
        persistence,
        independentScopeId,
        "epoch-independent",
      );
      const before = await persistence.getScopeClock(lockedScopeId);
      if (before === null) {
        throw new Error("Expected the real Postgres scope-clock fixture.");
      }

      const releaseLocker = new Deferred<void>();
      const lockerPidReady = new Deferred<number>();
      const waiterPidReady = new Deferred<number>();
      const lockerTransaction = persistence.drizzle.transaction(async (tx) => {
        try {
          const lockerPid = await backendPid(tx);
          await lockScopeClockForUpdateInTransaction(tx, lockedScopeId);
          await tx
            .update(fxSystemScopeClocks)
            .set({
              storageGeneration:
                FlarexDbV1StorageGenerationSchema.make("flarexdb_v1"),
              storageGenerationFence:
                StorageGenerationFenceSchema.make(2n),
              lastCommitSeq: CommitSeqSchema.make(1n),
              lastOutboxSeq: OutboxSeqSchema.make(1n),
              epoch: ScopeEpochSchema.make("epoch-tentative"),
              updatedAt: new Date("2026-07-11T00:00:00.000Z"),
            })
            .where(sql`${fxSystemScopeClocks.scopeId} = ${lockedScopeId}`);
          lockerPidReady.resolve(lockerPid);
          await releaseLocker.promise;
          throw new Error("scope-clock-postgres-rollback-probe");
        } catch (error) {
          lockerPidReady.reject(error);
          throw error;
        }
      });
      void lockerTransaction.catch(() => undefined);

      const lockerPid = await lockerPidReady.promise;
      const waiterTransaction = persistence.drizzle.transaction(async (tx) => {
        try {
          await tx.execute(sql`set local lock_timeout = '10s'`);
          await tx.execute(sql`set local statement_timeout = '15s'`);
          const waiterPid = await backendPid(tx);
          waiterPidReady.resolve(waiterPid);
          return await lockScopeClockForUpdateInTransaction(tx, lockedScopeId);
        } catch (error) {
          waiterPidReady.reject(error);
          throw error;
        }
      });
      void waiterTransaction.catch(() => undefined);

      try {
        const waiterPid = await waiterPidReady.promise;
        await waitForBlockedScopeClockRead(
          persistence,
          waiterPid,
          lockerPid,
        );

        await expect(
          persistence.drizzle.transaction((tx) =>
            lockScopeClockForUpdateInTransaction(tx, independentScopeId),
          ),
        ).resolves.toMatchObject({
          scopeId: independentScopeId,
          lastCommitSeq: 0n,
        });

        releaseLocker.resolve(undefined);
        await expect(lockerTransaction).rejects.toThrow(
          "scope-clock-postgres-rollback-probe",
        );
        await expect(waiterTransaction).resolves.toMatchObject({
          scopeId: lockedScopeId,
          storageGeneration: "legacy_v1",
          storageGenerationFence: 1n,
          lastCommitSeq: 0n,
          lastOutboxSeq: 0n,
          epoch: "epoch-locked",
        });
      } finally {
        releaseLocker.resolve(undefined);
        await Promise.allSettled([lockerTransaction, waiterTransaction]);
      }

      await expect(persistence.getScopeClock(lockedScopeId)).resolves.toEqual(
        before,
      );
    });
  });
});

async function insertScopeClock(
  persistence: Pick<FlarexPersistence, "query">,
  scopeId: ScopeId,
  epoch: string,
): Promise<void> {
  await persistence.query(
    `
      insert into fx_system_scope_clock (
        scope_id,
        storage_generation,
        epoch
      ) values ($1, 'legacy_v1', $2)
    `,
    [scopeId, epoch],
  );
}

async function backendPid(
  tx: Parameters<typeof lockScopeClockForUpdateInTransaction>[0],
): Promise<number> {
  const result = await tx.execute<{ pid: number }>(
    sql`select pg_backend_pid()::int as pid`,
  );
  if (typeof result !== "object" || result === null) {
    throw new Error("Postgres returned an invalid backend PID result.");
  }
  const rows = Reflect.get(result, "rows");
  if (!Array.isArray(rows)) {
    throw new Error("Postgres returned an invalid backend PID row set.");
  }
  const firstRow: unknown = rows[0];
  if (typeof firstRow !== "object" || firstRow === null) {
    throw new Error("Postgres did not return a backend PID.");
  }
  const pid = Reflect.get(firstRow, "pid");
  if (typeof pid !== "number" || !Number.isInteger(pid) || pid <= 0) {
    throw new Error("Postgres returned an invalid backend PID.");
  }
  return pid;
}

async function waitForBlockedScopeClockRead(
  persistence: Pick<FlarexPersistence, "query">,
  waiterPid: number,
  lockerPid: number,
): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const result = await persistence.query<{ blocked: boolean }>(
      `
        select exists (
          select 1
          from pg_stat_activity
          where pid = $1
            and wait_event_type = 'Lock'
            and $2 = any(pg_blocking_pids(pid))
        ) as blocked
      `,
      [waiterPid, lockerPid],
    );
    if (result.rows[0]?.blocked === true) return;
    await delay(25);
  }
  throw new Error(
    `Timed out waiting for scope-clock backend ${waiterPid} to block on ${lockerPid}.`,
  );
}

class Deferred<Value> {
  readonly promise: Promise<Value>;
  private resolvePromise: ((value: Value) => void) | null = null;
  private rejectPromise: ((error: unknown) => void) | null = null;

  constructor() {
    this.promise = new Promise<Value>((resolve, reject) => {
      this.resolvePromise = resolve;
      this.rejectPromise = reject;
    });
  }

  resolve(value: Value): void {
    const resolve = this.resolvePromise;
    if (resolve === null) return;
    this.resolvePromise = null;
    this.rejectPromise = null;
    resolve(value);
  }

  reject(error: unknown): void {
    const reject = this.rejectPromise;
    if (reject === null) return;
    this.resolvePromise = null;
    this.rejectPromise = null;
    reject(error);
  }
}
