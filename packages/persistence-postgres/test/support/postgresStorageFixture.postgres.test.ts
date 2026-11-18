import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPostgresStorageFixture, type PostgresStorageFixture } from "./postgresStorageFixture";
import { createPersistenceFixtureController } from "./fileScopedPersistenceFixture";
import { preparedHostTestRuntime } from "../execution/preparation/preparedHostRuntimeTestSupport";
import { startPostgresStorageSession } from "./postgresStorageSessionOwner";
import { Pool } from "pg";
import { supportsPostgresStorageStatisticsReset } from "./postgresStorageReset";
import * as resetSupport from "./postgresStorageReset";

const describePostgres = process.env.FLAREX_POSTGRES_DATABASE_URL?.trim() ? describe : describe.skip;
let statisticsResetSupported: boolean | undefined;
beforeEach(async context => {
  if (!process.env.FLAREX_POSTGRES_DATABASE_URL?.trim()) return;
  if (statisticsResetSupported === undefined) {
    const admin = new Pool({ connectionString: process.env.FLAREX_POSTGRES_DATABASE_URL, max: 1 });
    try { statisticsResetSupported = await supportsPostgresStorageStatisticsReset(admin); }
    finally { await admin.end(); }
  }
  if (!statisticsResetSupported && context.task.suite?.name !== "Postgres statistics API compatibility") context.skip();
}, 120_000);

describePostgres("isolated reusable Postgres storage schemas", { concurrent: false }, () => {
  let primary: PostgresStorageFixture | undefined;
  let secondary: PostgresStorageFixture | undefined;
  const first = () => { if (primary === undefined) throw new Error("Missing primary fixture"); return primary; };
  const second = () => { if (secondary === undefined) throw new Error("Missing secondary fixture"); return secondary; };
  const schedulerSeed = async (fixture: PostgresStorageFixture) => (await fixture.persistence.query<{ seed: string }>(
    "select row_to_json(seed)::text as seed from fx_system_point_mutation_redelivery_scheduler seed")).rows;

  beforeEach(async () => {
    primary = await createPostgresStorageFixture();
    secondary = await createPostgresStorageFixture();
  }, 120_000);

  afterEach(async () => {
    const resources = [primary, secondary];
    primary = undefined; secondary = undefined;
    const outcomes = await Promise.allSettled(resources.map(fixture => fixture?.dispose()));
    const failures = outcomes.filter(result => result.status === "rejected").map(result => result.reason);
    if (failures.length > 0) throw new AggregateError(failures, "Storage fixture regression cleanup failed");
  }, 120_000);

  it("keeps concurrent schemas independent and preserves exact migration seeds during narrow resets", async () => {
    const a = first(); const b = second();
    expect(a.schemaName).not.toBe(b.schemaName);
    const role = await a.persistence.query<{ superuser: boolean; createRole: boolean; bypassRls: boolean }>(
      "select rolsuper as superuser, rolcreaterole as \"createRole\", rolbypassrls as \"bypassRls\" from pg_roles where rolname=current_user");
    expect(role.rows).toEqual([{ superuser: false, createRole: false, bypassRls: false }]);
    const seed = await schedulerSeed(a);
    expect(seed).toHaveLength(1);
    await a.persistence.insertDeploymentMetadata({ deploymentId: "storage_isolation", projectId: "storage_isolation" });
    expect(await b.persistence.getDeploymentMetadata("storage_isolation")).toBeNull();
    await a.reset();
    expect(await a.persistence.getDeploymentMetadata("storage_isolation")).toBeNull();
    expect(await schedulerSeed(a)).toEqual(seed);
  });

  it("removes session GUCs, temp objects, prepared statements and advisory locks by replacing the pool", async () => {
    const a = first(); const b = second();
    const old = a.persistence;
    const oldRuntime = preparedHostTestRuntime(old.drizzle);
    const client = await old.pool.connect();
    try {
      await client.query("set search_path=public; set application_name='storage_polluted'; create temp table storage_temp_witness(value integer); prepare storage_prepared_witness as select 1; select pg_advisory_lock(2147483000,42)");
    } finally { client.release(); }
    const observer = await b.persistence.pool.connect();
    try {
      expect((await observer.query<{ locked: boolean }>("select pg_try_advisory_lock(2147483000,42) as locked")).rows[0]?.locked).toBe(false);
      await a.reset();
      expect(a.persistence).not.toBe(old);
      expect(preparedHostTestRuntime(a.persistence.drizzle)).not.toBe(oldRuntime);
      expect((await a.persistence.query<{ schema: string; temporary: number; statements: string }>(`select current_schema() as schema,
        pg_my_temp_schema()::int as temporary, (select count(*)::text from pg_prepared_statements) as statements`)).rows)
        .toEqual([{ schema: a.schemaName, temporary: 0, statements: "0" }]);
      expect((await observer.query<{ locked: boolean }>("select pg_try_advisory_lock(2147483000,42) as locked")).rows[0]?.locked).toBe(true);
    } finally { await observer.query("select pg_advisory_unlock_all()"); observer.release(); }
  });

  it("restores empty physical storage and planner statistics without replacing table identities", async () => {
    const a = first();
    const state = async () => (await a.persistence.query(`select c.oid::text as oid,c.relpages,
      c.reltuples::text as tuples,(select count(*)::text from pg_stats s
        where s.schemaname=current_schema() and s.tablename='deployments') as statistics
      from pg_class c where c.oid='deployments'::regclass`)).rows;
    await a.persistence.query(`insert into deployments(deployment_id,project_id)
      select 'statistics_' || n, 'statistics' from generate_series(1,1000)n; analyze deployments`);
    const populated = await state();
    expect(populated).toEqual([expect.objectContaining({ tuples: "1000" })]);
    expect(populated[0]?.statistics).not.toBe("0");
    await a.reset();
    expect(await state()).toEqual([expect.objectContaining({ oid: populated[0]?.oid, relpages: 0, tuples: "-1", statistics: "0" })]);
  });

  it("rejects out-of-profile seed changes and quarantines that schema", async () => {
    const a = first(); const name = a.schemaName;
    await a.persistence.query("update fx_system_point_mutation_redelivery_scheduler set run_fence=run_fence+1");
    await expect(a.reset()).rejects.toThrow("outside its reset profile");
    await a.dispose(); primary = undefined;
    expect((await second().persistence.query<{ absent: boolean }>("select to_regnamespace($1) is null as absent", [name])).rows)
      .toEqual([{ absent: true }]);
  });

  it("rejects persistent DDL without disabling constraints or reusing the changed schema", async () => {
    const a = first();
    await a.persistence.query("alter table fx_app_row_current add column storage_poison integer");
    await expect(a.reset()).rejects.toThrow("outside its reset profile");
  });

  it("refuses checked-out clients before retiring their runtime", async () => {
    const a = first();
    const runtime = preparedHostTestRuntime(a.persistence.drizzle);
    const client = await a.persistence.pool.connect();
    try {
      await expect(a.reset()).rejects.toThrow("checked-out or waiting pool client");
      expect(preparedHostTestRuntime(a.persistence.drizzle)).toBe(runtime);
    } finally { client.release(); }
  });

  it("refuses to publish a clean lease when a caller omits its final row reset", async () => {
    const a = first();
    await a.persistence.insertDeploymentMetadata({ deploymentId: "unreset_profile", projectId: "unreset_profile" });
    const outcome = a.dispose();
    await expect(outcome).rejects.toMatchObject({ errors: [expect.objectContaining({ message: "Postgres storage schema still contains profile rows" })] });
    primary = undefined;
  });

  it("refuses queued pool work and waits for its caller to settle it before disposal", async () => {
    const a = first();
    const held = await Promise.all(Array.from({ length: 10 }, () => a.persistence.pool.connect()));
    const queued = a.persistence.pool.connect();
    try {
      expect(a.persistence.pool.waitingCount).toBe(1);
      await expect(a.reset()).rejects.toThrow("checked-out or waiting pool client");
    } finally {
      for (const client of held) client.release();
      (await queued).release();
    }
  });

  it("quarantines a caught callback failure through the shared lifecycle controller", async () => {
    const a = first(); const name = a.schemaName;
    const controller = createPersistenceFixtureController(async () => a);
    const failure = new Error("failed storage callback");
    await expect(controller.borrow(async persistence => {
      await persistence.insertDeploymentMetadata({ deploymentId: "failed_callback", projectId: "failed_callback" });
      throw failure;
    })).rejects.toBe(failure);
    await controller.dispose(); primary = undefined;
    expect((await second().persistence.query<{ absent: boolean }>("select to_regnamespace($1) is null as absent", [name])).rows)
      .toEqual([{ absent: true }]);
  });
});

describePostgres("Postgres statistics API compatibility", { concurrent: false }, () => {
  let session: Awaited<ReturnType<typeof startPostgresStorageSession>> | undefined;
  let fixture: PostgresStorageFixture | undefined;
  beforeEach(async () => {
    const connectionString = process.env.FLAREX_POSTGRES_DATABASE_URL?.trim();
    if (!connectionString) throw new Error("Missing PostgreSQL test URL");
    session = await startPostgresStorageSession(connectionString, 1);
    const capability = vi.spyOn(resetSupport, "supportsPostgresStorageStatisticsReset").mockResolvedValue(false);
    try { fixture = await createPostgresStorageFixture(session.endpoint); }
    finally { capability.mockRestore(); }
  }, 120_000);
  afterEach(async () => {
    const failures: unknown[] = [];
    try { await fixture?.dispose(); } catch (cause: unknown) { failures.push(cause); }
    try { await session?.close(); } catch (cause: unknown) { failures.push(cause); }
    fixture = undefined; session = undefined;
    if (failures.length > 0) throw new AggregateError(failures, "Compatibility fixture cleanup failed");
  }, 120_000);
  it("keeps the existing fixture owner when native statistics APIs are unavailable", async () => {
    if (fixture === undefined || session === undefined) throw new Error("Missing compatibility fixture");
    expect(session.statistics().created).toBe(0);
    await fixture.persistence.insertDeploymentMetadata({ deploymentId: "older_statistics", projectId: "older_statistics" });
    await fixture.reset();
    expect(await fixture.persistence.getDeploymentMetadata("older_statistics")).toBeNull();
  });
});

describePostgres("retained Postgres storage namespace", { concurrent: false }, () => {
  let session: Awaited<ReturnType<typeof startPostgresStorageSession>> | undefined;
  let fixture: PostgresStorageFixture | undefined;
  beforeEach(async () => {
    const connectionString = process.env.FLAREX_POSTGRES_DATABASE_URL?.trim();
    if (!connectionString) throw new Error("Missing PostgreSQL test URL");
    session = await startPostgresStorageSession(connectionString, 1);
    fixture = await createPostgresStorageFixture(session.endpoint);
  }, 120_000);
  afterEach(async () => {
    const failures: unknown[] = [];
    try { await fixture?.dispose(); } catch (cause: unknown) { failures.push(cause); }
    try { await session?.close(); } catch (cause: unknown) { failures.push(cause); }
    fixture = undefined; session = undefined;
    if (failures.length > 0) throw new AggregateError(failures, "Retained namespace cleanup failed");
  }, 120_000);

  it("reuses the physical namespace and untouched migration journal across fixture lifetimes", async () => {
    if (fixture === undefined || session === undefined) throw new Error("Missing retained namespace fixture");
    const identity = async (current: PostgresStorageFixture) => (await current.persistence.query(`select current_schema() as schema,
      (select oid::text from pg_namespace where nspname=$1) as oid,
      (select jsonb_agg(to_jsonb(r) || jsonb_build_object('xmin',r.xmin::text) order by id)::text
        from "${current.migrationsSchema}".__drizzle_migrations r) as journal`, [current.schemaName])).rows;
    const before = await identity(fixture);
    await fixture.dispose(); fixture = undefined;
    fixture = await createPostgresStorageFixture(session.endpoint);
    expect(await identity(fixture)).toEqual(before);
  });
});
