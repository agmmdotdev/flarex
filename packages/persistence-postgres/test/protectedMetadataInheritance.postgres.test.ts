import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { prepareProtectedMetadata } from "../src/preparedMetadataEpoch";
import { publishFullProofInstallation, publishVerifiedInstallation, runInstallationMigrations,
  withInstallationMaintenance } from "../src/postgresInstallationMaintenance";
import { createFileScopedPostgresFixture, createProtectedFileScopedPostgresFixture, postgresUrl } from "./postgresHelpers";

const native = postgresUrl !== null && process.env.FLAREX_POSTGRES_PROVISIONING_DATABASE_URL ? describe : describe.skip;
const quoteIdentifier = (value: string) => `"${value.replaceAll('"', '""')}"`;

native("protected metadata inheritance rejection", () => {
  it.each(["child", "ancestor"] as const)("refuses active %s topology at authentic epoch attestation", async direction => {
    const owner = await createFileScopedPostgresFixture();
    const fixture = await createProtectedFileScopedPostgresFixture("fullProof", owner);
    const uncovered = direction === "child" ? "metadata_inheriting_child" : "metadata_uncovered_ancestor";
    try {
      await Effect.runPromise(prepareProtectedMetadata(fixture.persistence.drizzle));
      const runtime = (await fixture.persistence.query<{ login: string }>("select session_user as login")).rows[0];
      if (runtime === undefined) throw new Error("Missing actual runtime login");
      await owner.persistence.query(direction === "child" ? `create table ${uncovered} () inherits(fx_control_table)` :
        `create table ${uncovered}(logical_name text)`);
      if (direction === "ancestor") await owner.persistence.query(`alter table fx_control_table inherit ${uncovered}`);
      await owner.persistence.query(`create trigger fx_00_installation_admission before insert or update or delete or truncate on ${uncovered}
        for each statement execute function fx_require_active_installation()`);
      await owner.persistence.query(`grant select,insert,update,delete on ${uncovered} to ${quoteIdentifier(runtime.login)}`);
      if (direction === "ancestor") await owner.persistence.query("insert into deployments(deployment_id,project_id) values ('metadata-inheritance','metadata-inheritance')");
      await owner.persistence.query(`insert into ${direction === "child" ? uncovered : "fx_control_table"}
        (deployment_id,table_id,namespace,logical_name) values ('metadata-inheritance',123451,'app','before')`);
      const before = (await fixture.persistence.query("select generation from fx_system_prepared_metadata_epoch")).rows;
      await fixture.persistence.query(`update ${uncovered} set logical_name='changed-through-${direction}' where logical_name='before'`);
      expect((await fixture.persistence.query("select logical_name from fx_control_table where table_id=123451")).rows)
        .toEqual([{ logical_name: `changed-through-${direction}` }]);
      expect((await fixture.persistence.query("select generation from fx_system_prepared_metadata_epoch")).rows).toEqual(before);
      expect((await owner.persistence.query("select state from fx_system_installation")).rows).toEqual([{ state: "active" }]);
      await expect(Effect.runPromise(prepareProtectedMetadata(fixture.persistence.drizzle)))
        .rejects.toMatchObject({ reason: "unprotectedRuntime" });
    } finally {
      try { await fixture.dispose(); } finally { await owner.dispose(); }
    }
  }, 180_000);

  it.each([
    { direction: "child", profile: "managed" }, { direction: "ancestor", profile: "managed" },
    { direction: "child", profile: "fullProof" }, { direction: "ancestor", profile: "fullProof" },
  ] as const)("refuses $direction topology before $profile republication despite genuine generic writer admission", async ({ direction, profile }) => {
    const owner = await createFileScopedPostgresFixture();
    const fixture = await createProtectedFileScopedPostgresFixture("managed", owner);
    const folder = await mkdtemp(join(tmpdir(), "flarex-metadata-topology-"));
    const journal = { migrationsSchema: owner.migrationsSchema, migrationsTable: owner.migrationsTable };
    const uncovered = direction === "child" ? "metadata_inheriting_child" : "metadata_uncovered_ancestor";
    const structure = direction === "child"
      ? `create table ${uncovered} () inherits (fx_control_table);`
      : `create table ${uncovered} (logical_name text);
         alter table fx_control_table inherit ${uncovered};`;
    const seed = direction === "child"
      ? `insert into ${uncovered}(deployment_id,table_id,namespace,logical_name)
           values ('metadata-inheritance',123451,'app','before');`
      : `insert into deployments(deployment_id,project_id) values ('metadata-inheritance','metadata-inheritance');
         insert into fx_control_table(deployment_id,table_id,namespace,logical_name)
           values ('metadata-inheritance',123451,'app','before');`;
    try {
      const runtime = (await fixture.persistence.query<{ login: string }>("select session_user as login")).rows[0];
      if (runtime === undefined) throw new Error("Missing actual runtime login");
      await mkdir(join(folder, "meta"));
      await writeFile(join(folder, "meta", "_journal.json"), JSON.stringify({ version: "7", dialect: "postgresql",
        entries: [{ idx: 0, version: "7", when: 1, tag: "0000_metadata_topology", breakpoints: true }] }));
      await writeFile(join(folder, "0000_metadata_topology.sql"), `${structure}
        create trigger fx_00_installation_admission before insert or update or delete or truncate on ${uncovered}
          for each statement execute function fx_require_active_installation();
        grant select,insert,update,delete on ${uncovered} to ${quoteIdentifier(runtime.login)};
        ${seed}
        do $witness$ declare before_epoch bigint; after_epoch bigint; begin
          if not exists(select 1 from pg_catalog.pg_trigger where tgrelid='${uncovered}'::regclass
            and tgname='fx_00_installation_admission' and tgfoid='fx_require_active_installation()'::regprocedure
            and tgenabled='O' and tgtype=62) then raise exception 'Missing genuine generic guard'; end if;
          if exists(select 1 from pg_catalog.pg_trigger where tgrelid='${uncovered}'::regclass
            and tgname='fx_prepared_metadata_invalidate') then raise exception 'Unexpected epoch writer'; end if;
          select generation into before_epoch from fx_system_prepared_metadata_epoch where singleton_id=1;
          update ${uncovered} set logical_name='changed-through-${direction}' where logical_name='before';
          select generation into after_epoch from fx_system_prepared_metadata_epoch where singleton_id=1;
          if before_epoch <> after_epoch then raise exception 'Inherited writer unexpectedly advanced epoch'; end if;
          if not exists(select 1 from fx_control_table where table_id=123451
            and logical_name='changed-through-${direction}') then raise exception 'Parent reader did not observe inherited write'; end if;
        end $witness$;`);
      await expect(Effect.runPromise(withInstallationMaintenance(owner.persistence.pool.options, owner.schemaName, handle =>
        Effect.gen(function* () {
          yield* runInstallationMigrations(handle, { migrationsFolder: folder,
            migrationsSchema: owner.migrationsSchema, migrationsTable: "metadata_topology_witness_migrations" });
          return yield* profile === "managed" ? publishVerifiedInstallation(handle,
            [{ database: fixture.persistence.drizzle, endpointPolicy: "protected-postgres-fixture" }], journal) :
            publishFullProofInstallation(handle, journal);
        })))).rejects.toMatchObject({ reason: "invalidInstallation" });
      expect((await owner.persistence.query("select state from fx_system_installation")).rows).toEqual([{ state: "draining" }]);
      expect((await owner.persistence.query("select logical_name from fx_control_table where table_id=123451")).rows)
        .toEqual([{ logical_name: `changed-through-${direction}` }]);
      await expect(Effect.runPromise(prepareProtectedMetadata(fixture.persistence.drizzle)))
        .rejects.toMatchObject({ reason: "unprotectedRuntime" });
    } finally {
      await rm(folder, { recursive: true, force: true });
      try { await fixture.dispose(); } finally { await owner.dispose(); }
    }
  }, 180_000);
});
