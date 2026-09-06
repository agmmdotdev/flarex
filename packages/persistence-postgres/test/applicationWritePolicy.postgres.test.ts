import { describe, expect, it } from "vitest";
import { setTimeout as delay } from "node:timers/promises";
import { Effect } from "effect";
import { sql } from "drizzle-orm";
import { lockScopeClockForUpdateInTransactionEffect } from "../src/scopeClock";
import { validateApplicationWriteOwnershipForCommit } from "../src/applicationWriteOwnership/Commit";
import type { PostgresFlarexPersistence } from "../src/postgres";
import { makeApplicationActivationRepository } from "../src/applicationActivation";
import { postgresUrl, useFileScopedPostgresPersistence } from "./postgresHelpers";
import { applicationWritePolicyScenario } from "./applicationWritePolicyScenario";
import { makeApplicationSchemaAuthorityPublisher } from "../src/applicationSchemaAuthority";
import { relationReadinessFixture } from "./applicationRelationReadinessFixture";

describe.skipIf(postgresUrl === null)("Application table write ownership (Postgres)", () => {
  const withPersistence = useFileScopedPostgresPersistence();
  it("enforces activation, denial, commit, recovery and physical holder ordering", () => withPersistence(async persistence => {
    await applicationWritePolicyScenario(persistence, {
      activate: async fixture => {
        const independent = await relationReadinessFixture({ persistence, writePolicy: true });
        const entered = barrier();
        const released = barrier();
        const activationOwner = makeApplicationActivationRepository({ deploymentId: fixture.deploymentId,
          readiness: fixture.legacyReadiness, relationReadiness: fixture.fold, authority: fixture.authorityPorts,
          faultAfter: async point => { if (point === "headWritten") { entered.resolve(); await released.promise; } } });
        const activation = Promise.allSettled([Effect.runPromise(activationOwner.activate({ revisionId: fixture.input.revisionId, expectedActiveHead: null }))]);
        const stalePid = barrier<number>();
        const catalogPid = barrier<number>();
        let stale: Promise<unknown> | undefined;
        let catalogPublication: Promise<PromiseSettledResult<unknown>[]> | undefined;
        try {
          await Promise.race([entered.promise, activation.then(() => { throw new Error("Activation missed barrier"); })]);
          stale = persistence.drizzle.transaction(async tx => {
            const pid = (await tx.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`)).rows[0]?.pid;
            if (!pid) throw new Error("Missing stale writer PID");
            stalePid.resolve(pid);
            return Effect.runPromise(Effect.gen(function* () {
            yield* lockScopeClockForUpdateInTransactionEffect(tx, fixture.authority.scopeId);
            return yield* validateApplicationWriteOwnershipForCommit(tx, { scopeId: fixture.authority.scopeId,
              generation: "legacy_dynamic_worker_v1", authenticatedAttemptedTables: [], materialTables: [] });
            }));
          }).then(value => ({ value }), error => ({ error }));
          const pid = await Promise.race([stalePid.promise, stale.then(() => { throw new Error("Stale writer missed PID barrier"); })]);
          await expect.poll(async () => (await persistence.query<{ blocked: boolean }>(
            "select cardinality(pg_blocking_pids($1)) > 0 as blocked", [pid])).rows[0]?.blocked).toBe(true);
          const catalog = makeApplicationSchemaAuthorityPublisher({ db: fixture.control.drizzle,
            runTransaction: run => persistence.drizzle.transaction(async tx => {
              const pid = (await tx.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`)).rows[0]?.pid;
              if (!pid) throw new Error("Missing catalog publisher PID");
              catalogPid.resolve(pid);
              return run(tx);
            }) });
          catalogPublication = Promise.allSettled([Effect.runPromise(catalog.publish({ deploymentId: fixture.deploymentId, manifest: {
            ...fixture.manifest, version: 1, schema: { version: 1, tables: fixture.manifest.schema.tables, indexes: fixture.manifest.schema.indexes },
          } }))]);
          const catalogWaiter = await Promise.race([catalogPid.promise, catalogPublication.then(() => { throw new Error("Catalog missed PID barrier"); })]);
          await expect.poll(async () => (await persistence.query<{ blocked: boolean }>(
            "select cardinality(pg_blocking_pids($1)) > 0 as blocked", [catalogWaiter])).rows[0]?.blocked).toBe(true);
          await persistence.drizzle.transaction(tx => Effect.runPromise(Effect.gen(function* () {
            yield* lockScopeClockForUpdateInTransactionEffect(tx, independent.authority.scopeId);
            yield* validateApplicationWriteOwnershipForCommit(tx, { scopeId: independent.authority.scopeId,
              generation: "legacy_dynamic_worker_v1", authenticatedAttemptedTables: [], materialTables: [] });
          })));
        } finally {
          released.resolve();
          await Promise.all([activation, stale, catalogPublication]);
        }
        expect(await activation).toMatchObject([{ status: "fulfilled", value: { status: "activated", activationSequence: 1n } }]);
        expect(await stale).toMatchObject({ error: { reason: "writeDenied" } });
        expect(await catalogPublication).toMatchObject([{ status: "fulfilled" }]);
      },
      publish: async (fixture, publish) => {
        const holder = await holdClock(persistence, fixture.authority.scopeId);
        let canceled: Promise<unknown> | undefined;
        let published: Promise<PromiseSettledResult<unknown>[]> | undefined;
        // A bounded transaction deadline and server cancellation each abandon
        // their own waiter without weakening the next current writer.
        try {
          const deadline = persistence.drizzle.transaction(async tx => {
            await tx.execute(sql`set local statement_timeout = '100ms'`);
            await Effect.runPromise(lockScopeClockForUpdateInTransactionEffect(tx, fixture.authority.scopeId));
          });
          await expect(deadline).rejects.toBeDefined();
          canceled = persistence.drizzle.transaction(tx => Effect.runPromise(lockScopeClockForUpdateInTransactionEffect(tx, fixture.authority.scopeId)))
            .then(value => ({ value }), error => ({ error }));
          const [waiter] = await waitForWaiters(persistence, holder.pid, 1);
          if (!waiter) throw new Error("Missing cancellable waiter");
          expect((await persistence.query<{ canceled: boolean }>("select pg_cancel_backend($1) as canceled", [waiter.pid])).rows[0]?.canceled).toBe(true);
          expect(await canceled).toHaveProperty("error");
          published = Promise.allSettled([publish()]);
          await waitForWaiters(persistence, holder.pid, 1);
          await holder.release();
        } finally {
          await holder.release();
          await Promise.all([canceled, published]);
        }
        const result = (await published)?.[0];
        if (result?.status !== "fulfilled") throw new Error("Current writer failed to publish", { cause: result });
        return result.value;
      },
    });
  }), 90_000);
});

async function holdClock(persistence: PostgresFlarexPersistence, scopeId: string) {
  const client = await persistence.pool.connect();
  let released = false;
  const release = async () => {
    if (released) return;
    released = true;
    try { await client.query("rollback"); } finally { client.release(); }
  };
  try {
    await client.query("begin");
    await client.query("select 1 from fx_system_scope_clock where scope_id = $1 for update", [scopeId]);
    const pid = (await client.query<{ pid: number }>("select pg_backend_pid() as pid")).rows[0]?.pid;
    if (!pid) throw new Error("Missing clock holder PID");
    return { pid, release };
  } catch (error) { await release(); throw error; }
}

function barrier<Value = void>() {
  let resolve: (value: Value) => void = () => { throw new Error("Barrier not initialized"); };
  const promise = new Promise<Value>(release => { resolve = release; });
  return { promise, resolve };
}

async function waitForWaiters(persistence: PostgresFlarexPersistence, blocker: number, count: number) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const result = await persistence.query<{ pid: number }>(`with recursive blocked(pid) as (
      select pid from pg_stat_activity where $1::int = any(pg_blocking_pids(pid))
      union select activity.pid from pg_stat_activity activity join blocked on blocked.pid = any(pg_blocking_pids(activity.pid))
    ) select activity.pid from blocked join pg_stat_activity activity using (pid)
      where activity.wait_event_type = 'Lock' and activity.query ilike '%fx_system_scope_clock%'`, [blocker]);
    if (result.rows.length >= count) return result.rows;
    await delay(25);
  }
  throw new Error(`Expected ${count} policy clock waiters`);
}
