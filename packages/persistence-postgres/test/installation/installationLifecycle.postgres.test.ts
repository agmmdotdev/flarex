import { Client, Pool } from "pg";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { getTableName, sql } from "drizzle-orm";
import { getTableConfig, PgDialect } from "drizzle-orm/pg-core";
import { Cause, Data, Effect, Exit, Fiber } from "effect";
import { describe, expect, it } from "vitest";
import { acquireInstallationAdmission, closeInstallationAdmission, loadManagedInstallation, verifyInstallationWriterProtection,
  type InstallationLifecycleError } from "../../src/installation/installationLifecycle";
import { publishVerifiedInstallation, runInstallationMigrations, withInstallationMaintenance,
  type InstallationMaintenance } from "../../src/database/postgresInstallationMaintenance";
import { createFileScopedPostgresFixture, createProtectedFileScopedPostgresFixture, postgresUrl } from "../support/postgresHelpers";
import { flarexSchema, fxSystemTransactionJournalPoints } from "../../src/database/schema";

const native = postgresUrl !== null && process.env.FLAREX_POSTGRES_PROVISIONING_DATABASE_URL ? describe : describe.skip;
class DeliberateMaintenanceFailure extends Data.TaggedError("DeliberateMaintenanceFailure")<{}> {}
const policy = "protected-postgres-fixture";
const delay = (milliseconds: number) => new Promise<void>(resolve => { setTimeout(resolve, milliseconds); });
function signal() {
  let release: () => void = () => { throw new Error("Barrier was not initialized"); };
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, release };
}
async function waitForSleepingCommand(observer: Pool, applicationName: string): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const activity = await observer.query<{ sleeping: boolean }>(`select exists(select 1 from pg_catalog.pg_stat_activity
      where application_name = $1 and wait_event = 'PgSleep') as sleeping`, [applicationName]);
    if (activity.rows[0]?.sleeping === true) return;
    await delay(5);
  }
  throw new Error("Maintenance command did not reach its observed in-flight state");
}

async function waitForClosedBackend(observer: Pool, applicationName: string): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const activity = await observer.query<{ active: number }>(`select count(*)::integer as active
      from pg_catalog.pg_stat_activity where application_name = $1`, [applicationName]);
    if (activity.rows[0]?.active === 0) return;
    await delay(5);
  }
  throw new Error("Timed-out migration backend did not close");
}

async function writeMaintenanceMigration(folder: string, when: number, statement: string): Promise<void> {
  await mkdir(join(folder, "meta"), { recursive: true });
  await writeFile(join(folder, "meta", "_journal.json"), JSON.stringify({ version: "7", dialect: "postgresql",
    entries: [{ idx: 0, version: "7", when, tag: "0000_lifecycle_witness", breakpoints: true }] }));
  await writeFile(join(folder, "0000_lifecycle_witness.sql"), statement);
}

native("managed installation PostgreSQL lifecycle", () => {
  it("attests the journal CHECK through actual managed maintenance and cleans nested parser references", async () => {
    const owner = await createFileScopedPostgresFixture();
    const fixture = await createProtectedFileScopedPostgresFixture("managed", owner);
    const journal = { migrationsSchema: owner.migrationsSchema, migrationsTable: owner.migrationsTable };
    const proofJournal = { schemaName: owner.migrationsSchema, tableName: owner.migrationsTable };
    const folder = await mkdtemp(join(tmpdir(), "flarex-journal-check-witness-"));
    const migrationOptions = { migrationsFolder: folder, migrationsSchema: owner.migrationsSchema,
      migrationsTable: "installation_journal_check_witness" };
    const table = fxSystemTransactionJournalPoints;
    const check = getTableConfig(table).checks.find(value => value.name === "fx_system_tx_journal_point_dependency_check");
    if (check === undefined) throw new Error("Missing actual journal CHECK");
    const dialect = new PgDialect();
    let when = 0;
    const alter = (expression: ReturnType<typeof sql> | undefined, suffix = sql``) => {
      const statement = sql`alter table ${sql.identifier(owner.schemaName)}.${sql.identifier(getTableName(table))}
        drop constraint ${sql.identifier(check.name)}`;
      if (expression !== undefined) statement.append(sql`, add constraint ${sql.identifier(check.name)} check (${expression}) ${suffix}`);
      const compiled = dialect.sqlToQuery(statement);
      if (compiled.params.length !== 0) throw new Error("CHECK witness must contain only schema-owned SQL");
      return compiled.sql;
    };
    const refs = (database: typeof owner.persistence.drizzle) => database.select({ count: sql<number>`count(*)::integer` })
      .from(sql`pg_catalog.pg_class`).where(sql`relnamespace=pg_catalog.pg_my_temp_schema()
        and relname like 'fx_point_dependency_reference_%'`);
    const publish = (statement: string) => Effect.gen(function* () {
      yield* Effect.promise(() => writeMaintenanceMigration(folder, ++when, statement));
      return yield* withInstallationMaintenance(owner.persistence.pool.options, owner.schemaName, handle => Effect.gen(function* () {
        yield* runInstallationMigrations(handle, migrationOptions);
        yield* publishVerifiedInstallation(handle, [{ database: fixture.persistence.drizzle, endpointPolicy: policy }], journal);
      }));
    });
    const rollback = new Error("exact ordinary cold verification rollback");
    try {
      await owner.persistence.drizzle.transaction(async tx => {
        for (let index = 0; index < 2; index += 1) {
          await Effect.runPromise(verifyInstallationWriterProtection(tx, owner.schemaName, proofJournal));
          expect((await tx.execute<{ count: number }>(sql`select count(*)::integer as count from pg_catalog.pg_class
            where relnamespace=pg_catalog.pg_my_temp_schema() and relname like 'fx_point_dependency_reference_%'`)).rows)
            .toEqual([{ count: 0 }]);
        }
      });
      await expect(owner.persistence.drizzle.transaction(async tx => {
        await Effect.runPromise(verifyInstallationWriterProtection(tx, owner.schemaName, proofJournal));
        throw rollback;
      })).rejects.toBe(rollback);
      expect(await refs(owner.persistence.drizzle)).toEqual([{ count: 0 }]);
      const failed = await Effect.runPromiseExit(verifyInstallationWriterProtection(owner.persistence.drizzle, "missing_installation_schema", proofJournal));
      expect(Exit.isFailure(failed)).toBe(true);
      if (Exit.isFailure(failed)) {
        expect(failed.cause.reasons).toHaveLength(1);
        expect(failed.cause.reasons[0]).toMatchObject({ _tag: "Fail", error: { reason: "resourceFailure" } });
        expect(Cause.pretty(failed.cause)).not.toContain("25P02");
      }
      expect(await refs(owner.persistence.drizzle)).toEqual([{ count: 0 }]);
      for (const statement of [alter(undefined), alter(sql`true`), alter(sql`(${table.dependencyKind} = 'present' and ${table.dependencyRevisionCommitSeq} is not null
        and ${table.dependencyRevisionCommitSeq} >= 1 or ${table.dependencyKind} = 'missing_no_visible_revision')
        and ${table.dependencyRevisionCommitSeq} is null or (${table.dependencyKind} = 'missing_tombstone'
        and ${table.dependencyRevisionCommitSeq} is not null and ${table.dependencyRevisionCommitSeq} >= 1)
        or (${table.dependencyKind} = 'generated_insertion' and ${table.dependencyRevisionCommitSeq} is null)`),
        alter(check.value, sql`not valid`), alter(check.value, sql`no inherit`)]) {
        await expect(Effect.runPromise(publish(statement))).rejects.toMatchObject({ reason: "invalidInstallation" });
        expect((await owner.persistence.query("select state from fx_system_installation")).rows).toEqual([{ state: "draining" }]);
        await expect(fixture.persistence.query("update fx_system_scope_execution_authority set epoch=epoch where false"))
          .rejects.toMatchObject({ code: "55000" });
        const exists = await owner.persistence.query<{ present: boolean }>(`select exists(select 1 from pg_catalog.pg_constraint
          where conrelid='${owner.schemaName}.${getTableName(table)}'::pg_catalog.regclass and conname='${check.name}') as present`);
        const restore = dialect.sqlToQuery(sql`alter table ${sql.identifier(owner.schemaName)}.${sql.identifier(getTableName(table))}
          ${exists.rows[0]?.present === true ? sql`drop constraint ${sql.identifier(check.name)},` : sql``}
          add constraint ${sql.identifier(check.name)} check (${check.value})`);
        if (restore.params.length !== 0) throw new Error("Schema restore must have no parameters");
        await Effect.runPromise(publish(restore.sql));
        expect((await owner.persistence.query("select state from fx_system_installation")).rows).toEqual([{ state: "active" }]);
      }
    } finally { await fixture.dispose(); await owner.dispose(); await rm(folder, { recursive: true, force: true }); }
  }, 180_000);
  it("protects an exact configured same-schema journal including inherited column grants", async () => {
    const owner = await createFileScopedPostgresFixture({ sameSchema: true, tableName: "configured_migration_receipts" });
    const fixture = await createProtectedFileScopedPostgresFixture("managed", owner);
    const journal = { migrationsSchema: owner.migrationsSchema, migrationsTable: owner.migrationsTable };
    const qualified = `"${owner.schemaName}"."${owner.migrationsTable}"`;
    try {
      await expect(fixture.persistence.query(`update ${qualified} set hash = hash where false`))
        .rejects.toMatchObject({ code: "42501" });
      // Direct role revocation cannot erase a grant inherited from PUBLIC.
      await owner.persistence.query(`grant update (hash) on table ${qualified} to public`);
      await expect(Effect.runPromise(withInstallationMaintenance(owner.persistence.pool.options, owner.schemaName, handle =>
        publishVerifiedInstallation(handle, [{ database: fixture.persistence.drizzle, endpointPolicy: policy }], journal))))
        .rejects.toMatchObject({ reason: "invalidInstallation" });
      expect((await owner.persistence.query("select state from fx_system_installation")).rows).toEqual([{ state: "draining" }]);
      await owner.persistence.query(`revoke update (hash) on table ${qualified} from public`);
      await Effect.runPromise(withInstallationMaintenance(owner.persistence.pool.options, owner.schemaName, handle =>
        publishVerifiedInstallation(handle, [{ database: fixture.persistence.drizzle, endpointPolicy: policy }], journal)));
      await expect(fixture.persistence.query(`update ${qualified} set hash = hash where false`))
        .rejects.toMatchObject({ code: "42501" });
    } finally { await fixture.dispose(); await owner.dispose(); }
  }, 180_000);

  it("denies runtime bypass, drains actual readers, stays closed after failure and fences stale snapshots", async () => {
    const fixture = await createProtectedFileScopedPostgresFixture("managed");
    const installation = fixture.installation;
    if (installation === undefined) throw new Error("Missing managed installation");
    const database = fixture.persistence.drizzle;
    const owner = new Pool({ connectionString: postgresUrl!, options: `-c search_path=${fixture.schemaName}` });
    const readerEntered = signal(), releaseReader = signal(), maintenanceEntered = signal(), releaseMaintenance = signal();
    let reading: Promise<void> | undefined;
    let maintaining: Promise<void> | undefined;
    try {
      for (const statement of [
        "update fx_system_installation set structural_generation = structural_generation + 1",
        "update fx_system_installation_runtime set endpoint_policy = 'forged'",
        "insert into fx_system_application_read_binding select * from fx_system_application_read_binding where false",
        "alter table fx_system_scope_clock disable trigger fx_00_installation_admission",
        "set session_replication_role = replica",
      ]) await expect(fixture.persistence.query(statement)).rejects.toMatchObject({ code: "42501" });

      reading = database.transaction(async tx => {
        await Effect.runPromise(acquireInstallationAdmission(installation, database, tx));
        readerEntered.release();
        try { await releaseReader.promise; } finally { closeInstallationAdmission(tx); }
      });
      await readerEntered.promise;
      const config = { ...owner.options, application_name: "installation-drain-race" };
      maintaining = Effect.runPromise(withInstallationMaintenance(config, fixture.schemaName, () => Effect.gen(function* () {
        maintenanceEntered.release();
        yield* Effect.promise(() => releaseMaintenance.promise);
        return yield* Effect.fail(new DeliberateMaintenanceFailure());
      })));
      // Observe a real blocked drain on another backend, not a timing guess.
      const deadline = Date.now() + 5_000;
      let blocked = false;
      while (Date.now() < deadline) {
        const status = await owner.query<{ blocked: boolean }>(`select exists(select 1 from pg_catalog.pg_stat_activity
          where application_name = 'installation-drain-race' and wait_event_type = 'Lock') as blocked`);
        if (status.rows[0]?.blocked === true) { blocked = true; break; }
        await delay(10);
      }
      expect(blocked).toBe(true);
      await expect(database.transaction(tx => Effect.runPromise(acquireInstallationAdmission(installation, database, tx))))
        .rejects.toMatchObject({ reason: "busy" });
      await expect(fixture.persistence.query("update fx_system_scope_execution_authority set epoch = epoch where false"))
        .rejects.toMatchObject({ code: "55P03" });
      await expect(Effect.runPromise(withInstallationMaintenance(owner.options, fixture.schemaName, () => Effect.void)))
        .rejects.toMatchObject({ reason: "busy" });
      releaseReader.release();
      await reading;
      await maintenanceEntered.promise;
      await expect(database.transaction(tx => Effect.runPromise(acquireInstallationAdmission(installation, database, tx))))
        .rejects.toMatchObject({ reason: "busy" });
      releaseMaintenance.release();
      await expect(maintaining).rejects.toBeInstanceOf(DeliberateMaintenanceFailure);
      expect((await owner.query("select state from fx_system_installation")).rows).toEqual([{ state: "draining" }]);
      await expect(database.transaction(tx => Effect.runPromise(acquireInstallationAdmission(installation, database, tx))))
        .rejects.toMatchObject({ reason: "inactive" });

      await Effect.runPromise(withInstallationMaintenance(owner.options, fixture.schemaName, handle =>
        publishVerifiedInstallation(handle, [{ database, endpointPolicy: policy }], { migrationsSchema: fixture.migrationsSchema })));
      await expect(database.transaction(tx => Effect.runPromise(acquireInstallationAdmission(installation, database, tx))))
        .rejects.toMatchObject({ reason: "changed" });
      const replacement = await Effect.runPromise(loadManagedInstallation(database, policy, fixture.schemaName));
      await expect(database.transaction(async tx => {
        await tx.execute("select 1 from fx_system_installation"); // Establish repeatable-read snapshot before maintenance.
        await Effect.runPromise(withInstallationMaintenance(owner.options, fixture.schemaName, handle =>
          publishVerifiedInstallation(handle, [{ database, endpointPolicy: policy }], { migrationsSchema: fixture.migrationsSchema })));
        await Effect.runPromise(acquireInstallationAdmission(replacement, database, tx));
      }, { isolationLevel: "repeatable read" })).rejects.toMatchObject({ reason: "changed" });
    } finally {
      releaseReader.release(); releaseMaintenance.release();
      await Promise.allSettled([reading, maintaining]);
      await owner.end();
      await fixture.dispose();
    }
  }, 180_000);

  it("closes the predecessor backend before takeover and refuses commands after verification begins", async () => {
    const fixture = await createProtectedFileScopedPostgresFixture("managed");
    const database = fixture.persistence.drizzle;
    const owner = new Pool({ connectionString: postgresUrl!, options: `-c search_path=${fixture.schemaName}` });
    const migrationsFolder = await mkdtemp(join(tmpdir(), "flarex-installation-race-"));
    const migrationOptions = { migrationsFolder, migrationsSchema: fixture.migrationsSchema,
      migrationsTable: "installation_race_migrations" };
    try {
      await writeMaintenanceMigration(migrationsFolder, 1,
        "select pg_sleep(0.25);\n--> statement-breakpoint\ncreate table late_predecessor_write (id integer)");
      const config = { ...owner.options, application_name: "installation-interrupt-race" };
      await expect(Effect.runPromise(withInstallationMaintenance(config, fixture.schemaName, handle => Effect.gen(function* () {
        const pending = yield* Effect.forkChild(runInstallationMigrations(handle, migrationOptions));
        yield* Effect.promise(() => waitForSleepingCommand(owner, config.application_name));
        const competing = yield* Effect.exit(withInstallationMaintenance(owner.options, fixture.schemaName, () => Effect.void));
        expect(Exit.isFailure(competing)).toBe(true);
        yield* Fiber.interrupt(pending);
        const interrupted = yield* Fiber.await(pending);
        // The foreign command settled before its interrupted fiber returned.
        if (!Exit.isFailure(interrupted)) return yield* Effect.die(new Error("Command interruption was lost"));
        const settled = yield* Effect.promise(() => owner.query("select to_regclass('late_predecessor_write') as relation"));
        expect(settled.rows).toEqual([{ relation: "late_predecessor_write" }]);
        return yield* Effect.fail(new DeliberateMaintenanceFailure());
      })))).rejects.toBeInstanceOf(DeliberateMaintenanceFailure);
      await writeMaintenanceMigration(migrationsFolder, 2, "drop table late_predecessor_write");
      await Effect.runPromise(withInstallationMaintenance(owner.options, fixture.schemaName, handle => Effect.gen(function* () {
        yield* runInstallationMigrations(handle, migrationOptions);
        yield* publishVerifiedInstallation(handle, [{ database, endpointPolicy: policy }], { migrationsSchema: fixture.migrationsSchema });
        const refused = yield* Effect.exit(runInstallationMigrations(handle, migrationOptions));
        if (!Exit.isFailure(refused)) return yield* Effect.die(new Error("Closed command lane accepted work"));
        expect(refused.cause.reasons.some(reason => Cause.isFailReason(reason) &&
          reason.error.reason === "invalidCapability")).toBe(true);
      })));
      const successor = new Client({ ...owner.options });
      await successor.connect();
      try {
        expect((await successor.query("select pg_try_advisory_lock(2147483001, (namespace_oid - 2147483648)::integer) as acquired from fx_system_installation"))
          .rows[0]?.acquired).toBe(true);
        expect((await successor.query("select to_regclass('late_predecessor_write') as relation")).rows[0]?.relation).toBeNull();
      } finally { await successor.end(); }
    } finally { await owner.end(); await fixture.dispose(); await rm(migrationsFolder, { recursive: true, force: true }); }
  }, 180_000);

  it("puts temporary relations after the installed schema for actual accepting reads", async () => {
    const fixture = await createProtectedFileScopedPostgresFixture("managed");
    const client = new Client({ ...fixture.persistence.pool.options });
    try {
      await client.connect();
      await client.query("create temporary table fx_system_scope_clock (shadow_marker integer)");
      await client.query("insert into fx_system_scope_clock values (17)");
      const database = drizzle(client, { schema: flarexSchema });
      const installation = await Effect.runPromise(loadManagedInstallation(database, policy, fixture.schemaName));
      await database.transaction(async tx => {
        await Effect.runPromise(acquireInstallationAdmission(installation, database, tx));
        try {
          const selected = await tx.execute<{ installed: boolean }>(`select tableoid =
            '${fixture.schemaName}.fx_system_scope_clock'::pg_catalog.regclass as installed
            from fx_system_scope_clock`);
          // The installed table is empty; the temporary shadow has one row.
          expect(selected.rows).toEqual([]);
          const path = await tx.execute<{ path: string }>("select current_setting('search_path') as path");
          expect(path.rows[0]?.path).toContain("pg_temp");
          expect(path.rows[0]?.path.endsWith(", pg_temp")).toBe(true);
        } finally { closeInstallationAdmission(tx); }
      });
      expect((await client.query("select shadow_marker from pg_temp.fx_system_scope_clock")).rows).toEqual([{ shadow_marker: 17 }]);
    } finally { await client.end(); await fixture.dispose(); }
  }, 180_000);

  it("recovers after an actual maintenance backend crash without late predecessor publication", async () => {
    const fixture = await createProtectedFileScopedPostgresFixture("managed");
    const installation = fixture.installation;
    if (installation === undefined) throw new Error("Missing managed installation");
    const database = fixture.persistence.drizzle;
    const owner = new Pool({ connectionString: postgresUrl!, options: `-c search_path=${fixture.schemaName}` });
    const migrationsFolder = await mkdtemp(join(tmpdir(), "flarex-installation-crash-"));
    const migrationOptions = { migrationsFolder, migrationsSchema: fixture.migrationsSchema,
      migrationsTable: "installation_crash_migrations" };
    const journal = { migrationsSchema: fixture.migrationsSchema, migrationsTable: fixture.migrationsTable };
    const applicationName = "installation-backend-crash";
    let predecessor: InstallationMaintenance | undefined;
    let running: Promise<Exit.Exit<void, InstallationLifecycleError>> | undefined;
    try {
      const before = (await owner.query<{ generation: string }>(
        "select structural_generation::text as generation from fx_system_installation")).rows[0];
      if (before === undefined) throw new Error("Missing installation generation");
      await writeMaintenanceMigration(migrationsFolder, 1, `create table rolled_back_crash_write (id integer);
        --> statement-breakpoint
        select pg_sleep(10)`);
      running = Effect.runPromiseExit(withInstallationMaintenance({ ...owner.options, application_name: applicationName },
        fixture.schemaName, handle => {
          predecessor = handle;
          return runInstallationMigrations(handle, migrationOptions);
        }));
      await waitForSleepingCommand(owner, applicationName);
      await expect(Effect.runPromise(withInstallationMaintenance(owner.options, fixture.schemaName, () => Effect.void)))
        .rejects.toMatchObject({ reason: "busy" });
      // The singleton binds both PID and backend_start. Terminate only this
      // registered owner, never an arbitrary matching application-name session.
      const terminated = await owner.query<{ terminated: boolean }>(`select pg_catalog.pg_terminate_backend(a.pid) as terminated
        from pg_catalog.pg_stat_activity a join fx_system_installation i
          on i.maintenance_pid = a.pid and i.maintenance_backend_start = a.backend_start
        where i.singleton_id = 1 and i.state = 'draining' and a.application_name = $1`, [applicationName]);
      expect(terminated.rows).toEqual([{ terminated: true }]);
      const crashed = await running;
      if (!Exit.isFailure(crashed)) throw new Error("Crashed maintenance unexpectedly succeeded");
      const failures = crashed.cause.reasons.filter(Cause.isFailReason).map(reason => reason.error);
      expect(failures.length).toBeGreaterThanOrEqual(2);
      expect(failures.every(error => error.reason === "resourceFailure")).toBe(true);
      // Preserve the socket error alongside the failed command's full cause.
      expect(failures.some(error => error.cause instanceof Error &&
        error.cause.message === "Connection terminated unexpectedly")).toBe(true);
      await waitForClosedBackend(owner, applicationName);
      expect((await owner.query("select state from fx_system_installation")).rows).toEqual([{ state: "draining" }]);
      expect((await owner.query("select to_regclass('rolled_back_crash_write') as relation")).rows[0]?.relation).toBeNull();
      await expect(database.transaction(tx => Effect.runPromise(acquireInstallationAdmission(installation, database, tx))))
        .rejects.toMatchObject({ reason: "inactive" });

      await writeMaintenanceMigration(migrationsFolder, 2, "select 1");
      await Effect.runPromise(withInstallationMaintenance(owner.options, fixture.schemaName, handle => Effect.gen(function* () {
        yield* runInstallationMigrations(handle, migrationOptions);
        yield* publishVerifiedInstallation(handle, [{ database, endpointPolicy: policy }], journal);
      })));
      const after = (await owner.query<{ generation: string; state: string }>(
        "select structural_generation::text as generation,state from fx_system_installation")).rows[0];
      if (after === undefined) throw new Error("Missing recovered generation");
      expect(after.state).toBe("active");
      expect(BigInt(after.generation)).toBeGreaterThan(BigInt(before.generation));
      await expect(database.transaction(tx => Effect.runPromise(acquireInstallationAdmission(installation, database, tx))))
        .rejects.toMatchObject({ reason: "changed" });
      const replacement = await Effect.runPromise(loadManagedInstallation(database, policy, fixture.schemaName));
      await database.transaction(async tx => {
        try { await Effect.runPromise(acquireInstallationAdmission(replacement, database, tx)); }
        finally { closeInstallationAdmission(tx); }
      });
      if (predecessor === undefined) throw new Error("Missing predecessor capability");
      await expect(Effect.runPromise(runInstallationMigrations(predecessor, migrationOptions)))
        .rejects.toMatchObject({ reason: "invalidCapability" });
      await expect(Effect.runPromise(publishVerifiedInstallation(predecessor, [{ database, endpointPolicy: policy }], journal)))
        .rejects.toMatchObject({ reason: "invalidCapability" });
      expect((await owner.query("select to_regclass('rolled_back_crash_write') as relation")).rows[0]?.relation).toBeNull();
      expect((await owner.query("select structural_generation::text as generation,state from fx_system_installation")).rows).toEqual([after]);
    } finally {
      await Promise.allSettled([running]);
      await owner.end(); await fixture.dispose(); await rm(migrationsFolder, { recursive: true, force: true });
    }
  }, 180_000);

  it("rolls back a timed-out migration and closes queued commands before verification", async () => {
    const fixture = await createProtectedFileScopedPostgresFixture("managed");
    const database = fixture.persistence.drizzle;
    const owner = new Pool({ connectionString: postgresUrl!, options: `-c search_path=${fixture.schemaName}` });
    const migrationsFolder = await mkdtemp(join(tmpdir(), "flarex-installation-timeout-"));
    const migrationOptions = { migrationsFolder, migrationsSchema: fixture.migrationsSchema,
      migrationsTable: "installation_timeout_migrations" };
    const journal = { migrationsSchema: fixture.migrationsSchema, migrationsTable: fixture.migrationsTable };
    const applicationName = "installation-timeout-race";
    try {
      await writeMaintenanceMigration(migrationsFolder, 1, `set local statement_timeout = '30ms';
        --> statement-breakpoint
        select pg_sleep(0.1);
        --> statement-breakpoint
        create table escaped_timeout_write (id integer)`);
      await expect(Effect.runPromise(withInstallationMaintenance({ ...owner.options, application_name: applicationName },
        fixture.schemaName, handle => runInstallationMigrations(handle, migrationOptions))))
        .rejects.toMatchObject({ reason: "resourceFailure", cause: { cause: { code: "57014" } } });
      expect((await owner.query("select state from fx_system_installation")).rows).toEqual([{ state: "draining" }]);
      expect((await owner.query("select to_regclass('escaped_timeout_write') as relation")).rows[0]?.relation).toBeNull();
      await waitForClosedBackend(owner, applicationName);

      // A real in-flight migration keeps verification queued. Closing the lane
      // must reject an already queued command before its next migration starts.
      await writeMaintenanceMigration(migrationsFolder, 2, "select pg_sleep(0.5)");
      await Effect.runPromise(withInstallationMaintenance({ ...owner.options, application_name: applicationName },
        fixture.schemaName, handle => Effect.gen(function* () {
          const pending = yield* Effect.forkChild(runInstallationMigrations(handle, migrationOptions));
          yield* Effect.promise(() => waitForSleepingCommand(owner, applicationName));
          const queued = yield* Effect.forkChild(runInstallationMigrations(handle, migrationOptions));
          yield* Effect.yieldNow;
          const verification = yield* Effect.forkChild(publishVerifiedInstallation(handle,
            [{ database, endpointPolicy: policy }], journal));
          yield* Effect.yieldNow;
          const fresh = yield* Effect.exit(runInstallationMigrations(handle, migrationOptions));
          if (!Exit.isFailure(fresh)) return yield* Effect.die(new Error("Verifying lane accepted fresh migration"));
          expect(fresh.cause.reasons.some(reason => Cause.isFailReason(reason) &&
            reason.error.reason === "invalidCapability")).toBe(true);
          yield* Fiber.join(pending);
          const refused = yield* Fiber.await(queued);
          if (!Exit.isFailure(refused)) return yield* Effect.die(new Error("Verifying lane accepted queued migration"));
          expect(refused.cause.reasons.some(reason => Cause.isFailReason(reason) &&
            reason.error.reason === "invalidCapability")).toBe(true);
          yield* Fiber.join(verification);
        })));
      expect((await owner.query("select state from fx_system_installation")).rows).toEqual([{ state: "active" }]);
    } finally { await owner.end(); await fixture.dispose(); await rm(migrationsFolder, { recursive: true, force: true }); }
  }, 180_000);
});
