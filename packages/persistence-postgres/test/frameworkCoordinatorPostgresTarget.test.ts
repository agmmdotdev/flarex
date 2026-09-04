import { sql } from "drizzle-orm";
import { setTimeout as delay } from "node:timers/promises";
import { Cause, Effect, Exit } from "effect";
import { Pool } from "pg";
import { describe, expect, it } from "vitest";

import { makePostgresFrameworkMigrationTargetEffect } from "../src/migrationCoordination/postgresTarget";
import { runFrameworkMigrationTargetTransactionEffect, withFrameworkMigrationRawTransactionEffect } from "../src/migrationCoordination/targetSession";
import { runEffect } from "./effectTestRuntime";
import { withNativeCoordinator } from "./frameworkCoordinatorPostgresFixture";
import { postgresUrl } from "./postgresHelpers";

const native = postgresUrl === null ? describe.skip : describe;
const request = { kind: "ordinary", lockTimeoutMilliseconds: 300, statementTimeoutMilliseconds: 2_000 } as const;

native("native framework migration target lifecycle", () => {
  it("runs as an ordinary role, commits, and rolls back DDL with callback failure", async () => {
    await withNativeCoordinator(async fixture => {
      const role = await fixture.persistence.query<{ rolsuper: boolean; rolcreatedb: boolean }>(
        "select rolsuper, rolcreatedb from pg_roles where rolname = current_user");
      expect(role.rows).toEqual([{ rolsuper: false, rolcreatedb: false }]);
      const result = await runEffect(runFrameworkMigrationTargetTransactionEffect(fixture.target, request, tx =>
        withFrameworkMigrationRawTransactionEffect(tx, fixture.target, raw => Effect.tryPromise(() =>
          raw.execute(sql.raw(`create table "${fixture.physicalSchema}".committed (id int)`))))));
      expect(result).toBeDefined();
      const sentinel = new Error("callback sentinel");
      const failed = await Effect.runPromiseExit(runFrameworkMigrationTargetTransactionEffect(fixture.target, request, tx =>
        withFrameworkMigrationRawTransactionEffect(tx, fixture.target, raw => Effect.gen(function* () {
          yield* Effect.tryPromise(() => raw.execute(sql.raw(`create table "${fixture.physicalSchema}".rolled_back (id int)`)));
          return yield* Effect.fail(sentinel);
        }))));
      expect(Exit.isFailure(failed) && Cause.findErrorOption(failed.cause)).toMatchObject({ _tag: "Some", value: sentinel });
      const exists = await fixture.persistence.query<{ name: string | null }>(
        "select to_regclass($1)::text as name", [`${fixture.physicalSchema}.rolled_back`]);
      expect(exists.rows[0]?.name).toBeNull();
    });
  }, 180_000);

  it.each(["deadline", "interrupt", "statement"] as const)("settles active SQL on %s and fences late work", async kind => {
    let started: () => void = () => undefined;
    const active = new Promise<void>(resolve => { started = resolve; });
    const pids = new Set<number>();
    await withNativeCoordinator(async fixture => {
      const abort = new AbortController();
      const targetRequest = { ...request, statementTimeoutMilliseconds: kind === "statement" ? 100 : 10_000 };
      const settled = Effect.runPromiseExit(runFrameworkMigrationTargetTransactionEffect(fixture.target, targetRequest, tx =>
        withFrameworkMigrationRawTransactionEffect(tx, fixture.target, raw => Effect.tryPromise(() =>
          raw.execute(sql`select pg_sleep(10)`)))), { signal: abort.signal });
      await active;
      if (kind === "interrupt") {
        const deadline = Date.now() + 2_000;
        let observed = false;
        while (Date.now() < deadline) {
          const result = await fixture.persistence.query<{ count: number }>(
            "select count(*)::int as count from pg_stat_activity where pid = any($1::int[]) and wait_event = 'PgSleep'", [[...pids]]);
          if (result.rows[0]?.count === 1) { observed = true; break; }
          await delay(10);
        }
        expect(observed).toBe(true);
        abort.abort();
      }
      const settlementStarted = performance.now();
      const exit = await settled;
      expect(Exit.isFailure(exit)).toBe(true);
      expect(performance.now() - settlementStarted).toBeLessThan(4_000);
      const activeRows = await fixture.persistence.query<{ count: number }>(
        "select count(*)::int as count from pg_stat_activity where pid = any($1::int[]) and pid <> pg_backend_pid() and state <> 'idle'", [[...pids]]);
      expect(activeRows.rows[0]?.count).toBe(0);
      // A subsequent transaction remains usable, never inherits the sleeping query.
      expect(await runEffect(runFrameworkMigrationTargetTransactionEffect(fixture.target, request, () => Effect.succeed("usable")))).toBe("usable");
    }, {
      transactionTimeoutMilliseconds: kind === "deadline" ? 150 : 5_000,
      cleanupTimeoutMilliseconds: 3_000,
      observe: event => {
        if (event.phase === "work" && event.edge === "before" && event.text?.includes("pg_sleep")) {
          const pid: unknown = Reflect.get(event.client, "processID");
          if (typeof pid === "number") pids.add(pid);
          started();
        }
      },
    });
  }, 180_000);

  it("expires acquisition and destroys a client delivered after expiry", async () => {
    await withNativeCoordinator(async fixture => {
      const pool = new Pool({ ...fixture.persistence.pool.options, max: 1 });
      const held = await pool.connect();
      try {
        const target = await runEffect(makePostgresFrameworkMigrationTargetEffect({
          persistence: { drizzle: fixture.persistence.drizzle, pool }, deploymentId: "deployment-a",
          canonicalPhysicalDatabaseIdentity: "native-framework-test/database",
          physicalLocator: { kind: "shared_database", databaseKey: "primary", schemaName: fixture.physicalSchema },
          options: { acquisitionTimeoutMilliseconds: 50 },
        }));
        const failed = await Effect.runPromiseExit(runFrameworkMigrationTargetTransactionEffect(target, request, () => Effect.void));
        expect(Exit.isFailure(failed) && Cause.findErrorOption(failed.cause)).toMatchObject({ _tag: "Some", value: { phase: "acquire" } });
      } finally { held.release(); }
      // Queue a new borrower after the abandoned waiter; it must get a new backend.
      const next = await pool.connect();
      expect(next).not.toBe(held);
      next.release();
      await pool.end();
    });
  }, 180_000);

  it("preserves callback and rollback-cleanup failures while destroying the failed connection", async () => {
    let armed = false;
    let destroyed: unknown;
    await withNativeCoordinator(async fixture => {
      armed = true;
      const sentinel = new Error("original callback failure");
      const result = await Effect.runPromiseExit(runFrameworkMigrationTargetTransactionEffect(fixture.target, request,
        () => Effect.fail(sentinel)));
      expect(Exit.isFailure(result)).toBe(true);
      if (Exit.isSuccess(result)) throw new Error("Expected failure");
      const rendered = JSON.stringify(result.cause);
      expect(rendered).toContain("rollbackOrCleanup");
      expect(Cause.findErrorOption(result.cause)).toMatchObject({ _tag: "Some", value: sentinel });
      expect(await runEffect(runFrameworkMigrationTargetTransactionEffect(fixture.target, request,
        () => Effect.succeed("healthy")))).toBe("healthy");
    }, { observe: event => {
      if (armed && event.phase === "rollback" && event.edge === "before") {
        armed = false; destroyed = event.client;
        throw new Error("injected rollback cleanup failure");
      }
      if (!armed && event.phase === "begin") expect(event.client).not.toBe(destroyed);
    } });
  }, 180_000);

  it("rejects excess statements before commit and rejects retained transaction work after return", async () => {
    await withNativeCoordinator(async fixture => {
      const result = await Effect.runPromiseExit(runFrameworkMigrationTargetTransactionEffect(fixture.target, request, tx =>
        withFrameworkMigrationRawTransactionEffect(tx, fixture.target, raw => Effect.tryPromise(async () => {
          await raw.execute(sql`select 1`); await raw.execute(sql`select 2`); await raw.execute(sql`select 3`);
        }))));
      expect(Exit.isFailure(result)).toBe(true);
      const retained = await runEffect(runFrameworkMigrationTargetTransactionEffect(fixture.target, request, tx =>
        withFrameworkMigrationRawTransactionEffect(tx, fixture.target, raw => Effect.succeed(
          () => raw.execute(sql`select 4`)))));
      await expect(retained()).rejects.toThrow();
    }, { maximumStatementsPerTransaction: 2 });
  }, 180_000);

  it("bounds a COMMIT blocked inside a deferred trigger and cancels its actual backend", async () => {
    await withNativeCoordinator(async fixture => {
      await fixture.persistence.query(`create table "${fixture.physicalSchema}".commit_probe (id int)`);
      await fixture.persistence.query(`create function "${fixture.physicalSchema}".block_commit_probe() returns trigger language plpgsql as $$
        begin perform pg_advisory_xact_lock(7314502); return new; end $$`);
      await fixture.persistence.query(`create constraint trigger block_commit_probe after insert on "${fixture.physicalSchema}".commit_probe
        deferrable initially deferred for each row execute function "${fixture.physicalSchema}".block_commit_probe()`);
      const blocker = await fixture.persistence.pool.connect();
      await blocker.query("select pg_advisory_lock(7314502)");
      try {
        const start = performance.now();
        const exit = await Effect.runPromiseExit(runFrameworkMigrationTargetTransactionEffect(fixture.target,
          { ...request, lockTimeoutMilliseconds: 10_000, statementTimeoutMilliseconds: 10_000 }, tx =>
            withFrameworkMigrationRawTransactionEffect(tx, fixture.target, raw => Effect.tryPromise(() =>
              raw.execute(sql.raw(`insert into "${fixture.physicalSchema}".commit_probe (id) values (1)`))))));
        expect(Exit.isFailure(exit) && Cause.findErrorOption(exit.cause)).toMatchObject({
          _tag: "Some", value: { _tag: "FrameworkMigrationDecisionUncertainIssue" },
        });
        expect(performance.now() - start).toBeLessThan(4_000);
        expect((await fixture.persistence.query<{ count: number }>(`select count(*)::int as count from "${fixture.physicalSchema}".commit_probe`)).rows[0]?.count).toBe(0);
        const active = await fixture.persistence.query<{ count: number }>(
          "select count(*)::int as count from pg_stat_activity where $1::int = any(pg_blocking_pids(pid))", [Reflect.get(blocker, "processID")]);
        expect(active.rows[0]?.count).toBe(0);
      } finally { await blocker.query("select pg_advisory_unlock_all()"); blocker.release(); }
    }, { transactionTimeoutMilliseconds: 500, cleanupTimeoutMilliseconds: 2_000 });
  }, 180_000);

  it("does not interpret an interrupted caller after COMMIT as a rollback", async () => {
    const abort = new AbortController();
    await withNativeCoordinator(async fixture => {
      const exit = await Effect.runPromiseExit(runFrameworkMigrationTargetTransactionEffect(fixture.target, request, tx =>
        withFrameworkMigrationRawTransactionEffect(tx, fixture.target, raw => Effect.tryPromise(() =>
          raw.execute(sql.raw(`create table "${fixture.physicalSchema}".committed_before_interrupt (id int)`))))),
        { signal: abort.signal });
      expect(Exit.isFailure(exit)).toBe(true);
      expect((await fixture.persistence.query<{ name: string | null }>(
        "select to_regclass($1)::text as name", [`${fixture.physicalSchema}.committed_before_interrupt`])).rows[0]?.name).not.toBeNull();
    }, { observe: event => { if (event.phase === "commit" && event.edge === "after") abort.abort(); } });
  }, 180_000);
});
