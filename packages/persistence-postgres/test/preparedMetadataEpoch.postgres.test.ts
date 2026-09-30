import { randomBytes, randomUUID } from "node:crypto";
import { Pool } from "pg";
import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import { sql } from "drizzle-orm";

import { createPostgresPersistence } from "../src/postgres";
import {
  captureProtectedMetadataEpoch,
  guardProtectedMetadataEpoch,
  prepareProtectedMetadata,
} from "../src/preparedMetadataEpoch";
import { createFileScopedPostgresFixture, createProtectedFileScopedPostgresFixture, postgresUrl,
  withTemporaryPostgresSchema } from "./postgresHelpers";

const provisioningUrl = process.env.FLAREX_POSTGRES_PROVISIONING_DATABASE_URL;
const native = postgresUrl !== null && provisioningUrl ? describe : describe.skip;

const currentImmutableTables = [
  "fx_system_application_publication", "fx_system_application_function",
  "fx_system_application_task_catalog", "fx_system_application_task_definition",
  "fx_system_application_revision_schema", "fx_system_application_readiness",
  "fx_system_application_readiness_relation", "fx_system_application_readiness_function",
  "fx_system_application_activation", "fx_system_application_write_ownership",
  "fx_system_data_binding_candidate", "fx_system_data_binding_physical_lane",
  "fx_system_data_binding_activation",
] as const;

native("protected metadata epoch under an authenticated restricted login", () => {
  it("covers all current immutable writers and refuses runtime epoch or trigger bypass", async () => {
    const fixture = await createProtectedFileScopedPostgresFixture();
    const owner = new Pool({ connectionString: postgresUrl!,
      options: `-c search_path=${fixture.schemaName}` });
    const writer = await owner.connect();
    try {
      const target = fixture.persistence.drizzle;
      for (const table of currentImmutableTables) {
        const column = (await owner.query<{ column_name: string }>(
          "select column_name from information_schema.columns where table_schema = current_schema() and table_name = $1 order by ordinal_position limit 1",
          [table])).rows[0]?.column_name;
        if (column === undefined) throw new Error(`Missing immutable table ${table}`);
        for (const statement of [
          `insert into "${table}" select * from "${table}" where false`,
          `update "${table}" set "${column}" = "${column}" where false`,
          `delete from "${table}" where false`,
          `truncate "${table}" cascade`,
        ]) {
          const before = await target.transaction(tx => Effect.runPromise(
            captureProtectedMetadataEpoch(fixture.protectedMetadata, target, tx)));
          await writer.query("begin");
          await writer.query(statement);
          await expect(target.transaction(tx => Effect.runPromise(
            guardProtectedMetadataEpoch(fixture.protectedMetadata, target, before, tx))))
            .rejects.toMatchObject({ reason: "busy" });
          await writer.query("rollback");
          await target.transaction(tx => Effect.runPromise(
            guardProtectedMetadataEpoch(fixture.protectedMetadata, target, before, tx)));
          if (statement.startsWith("truncate")) await writer.query(statement);
          else await fixture.persistence.query(statement);
          await expect(target.transaction(tx => Effect.runPromise(
            guardProtectedMetadataEpoch(fixture.protectedMetadata, target, before, tx))))
            .rejects.toMatchObject({ reason: "changed" });
        }
        await expect(fixture.persistence.query(`truncate "${table}"`))
          .rejects.toMatchObject({ code: "42501" });
        await expect(fixture.persistence.query(`alter table "${table}" disable trigger fx_prepared_metadata_invalidate`))
          .rejects.toMatchObject({ code: "42501" });
      }
      await expect(fixture.persistence.query("truncate fx_system_prepared_metadata_epoch"))
        .rejects.toMatchObject({ code: "42501" });
      await expect(fixture.persistence.query("set session_replication_role = replica"))
        .rejects.toMatchObject({ code: "42501" });
    } finally {
      await writer.query("rollback");
      writer.release();
      await owner.end();
      await fixture.dispose();
    }
  }, 180_000);

  it("reissues a new installation incarnation after administrative fixture reset", async () => {
    const fixture = await createFileScopedPostgresFixture();
    try {
      const before = (await fixture.persistence.query<{ incarnation: string }>(
        "select incarnation::text from fx_system_prepared_metadata_epoch")).rows[0]?.incarnation;
      await fixture.reset();
      const after = (await fixture.persistence.query<{ incarnation: string; generation: string }>(
        "select incarnation::text, generation::text from fx_system_prepared_metadata_epoch")).rows[0];
      expect(after?.generation).toBe("1");
      expect(after?.incarnation).not.toBe(before);
    } finally {
      await fixture.dispose();
    }
  }, 180_000);

  it("provisions a disposable restricted runtime through the ordinary persistence factory", async () => {
    const fixture = await createProtectedFileScopedPostgresFixture();
    try {
      const identity = await fixture.persistence.query<{ login: string; role: string }>(
        "select session_user as login, current_user as role");
      expect(identity.rows[0]?.login).toBe(identity.rows[0]?.role);
      expect(identity.rows[0]?.login).toMatch(/^flarex_runtime_/);
      const epoch = await fixture.persistence.drizzle.transaction(tx =>
        Effect.runPromise(captureProtectedMetadataEpoch(fixture.protectedMetadata, fixture.persistence.drizzle, tx)));
      expect(epoch.generation).toBe(2n);
      await expect(fixture.persistence.query("truncate fx_system_application_candidate_v1"))
        .rejects.toMatchObject({ code: "42501" });
    } finally {
      await fixture.dispose();
    }
  }, 180_000);

  it("rejects column grants and replaced definer bodies before issuing a cache capability", async () => {
    const fixture = await createProtectedFileScopedPostgresFixture();
    const owner = new Pool({ connectionString: postgresUrl!,
      options: `-c search_path=${fixture.schemaName}` });
    try {
      const role = (await fixture.persistence.query<{ name: string }>("select session_user as name")).rows[0]?.name;
      if (role === undefined) throw new Error("Missing restricted login");
      await owner.query(`grant update(generation) on "${fixture.schemaName}".fx_system_prepared_metadata_epoch to "${role}"`);
      await expect(Effect.runPromise(prepareProtectedMetadata(fixture.persistence.drizzle)))
        .rejects.toMatchObject({ reason: "unprotectedRuntime" });
      await owner.query(`revoke update(generation) on "${fixture.schemaName}".fx_system_prepared_metadata_epoch from "${role}"`);
      await Effect.runPromise(prepareProtectedMetadata(fixture.persistence.drizzle));

      const functions = ["fx_invalidate_prepared_metadata", "fx_lock_prepared_metadata_epoch"] as const;
      for (const name of functions) {
        const original = (await owner.query<{ definition: string }>(
          "select pg_get_functiondef(p.oid) as definition from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = $1 and p.proname = $2",
          [fixture.schemaName, name])).rows[0]?.definition;
        if (original === undefined) throw new Error(`Missing protected function ${name}`);
        const replacement = name === "fx_invalidate_prepared_metadata"
          ? `create or replace function "${fixture.schemaName}".${name}() returns trigger language plpgsql security definer set search_path = pg_catalog, pg_temp as $$ begin return null; end; $$`
          : `create or replace function "${fixture.schemaName}".${name}() returns table(database_name text, namespace_oid bigint, incarnation uuid, generation bigint) language sql security definer set search_path = pg_catalog, pg_temp as $$ select null::text, null::bigint, null::uuid, null::bigint $$`;
        try {
          await owner.query(replacement);
          await expect(Effect.runPromise(prepareProtectedMetadata(fixture.persistence.drizzle)))
            .rejects.toMatchObject({ reason: "unprotectedRuntime" });
        } finally {
          await owner.query(original);
        }
      }
      await Effect.runPromise(prepareProtectedMetadata(fixture.persistence.drizzle));
    } finally {
      await owner.end();
      await fixture.dispose();
    }
  }, 180_000);

  it("uses a nonblocking final guard across both clock and epoch lock orders", async () => {
    const fixture = await createProtectedFileScopedPostgresFixture();
    const owner = new Pool({ connectionString: postgresUrl!,
      options: `-c search_path=${fixture.schemaName}` });
    const writer = await owner.connect();
    try {
      await fixture.persistence.query(`insert into fx_system_scope_clock
        (scope_id, storage_generation, epoch) values ('scope_epoch_lock_test', 'flarexdb_v1', 'epoch_lock_test')`);
      const prepared = fixture.protectedMetadata;
      const target = fixture.persistence.drizzle;
      const first = await target.transaction(tx =>
        Effect.runPromise(captureProtectedMetadataEpoch(prepared, target, tx)));

      // Named writers take the clock before their DML trigger updates epoch.
      await writer.query("begin");
      await writer.query("select 1 from fx_system_scope_clock where scope_id = 'scope_epoch_lock_test' for update");
      const clockFirstReader = target.transaction(async tx => {
        await tx.execute(sql`select 1 from fx_system_scope_clock where scope_id = 'scope_epoch_lock_test' for share`);
        await Effect.runPromise(guardProtectedMetadataEpoch(prepared, target, first, tx));
      });
      await writer.query("update fx_system_application_candidate_v1 set candidate_id = candidate_id where false");
      await writer.query("commit");
      await expect(clockFirstReader).rejects.toMatchObject({ reason: "changed" });

      // Direct DML may hold epoch first and then ask for a row held by a
      // reader. The reader's final NOWAIT guard aborts, releasing its row.
      const second = await target.transaction(tx =>
        Effect.runPromise(captureProtectedMetadataEpoch(prepared, target, tx)));
      let releaseReader: (() => void) | undefined;
      const readerRelease = new Promise<void>(resolve => { releaseReader = resolve; });
      let signalReader: (() => void) | undefined;
      const readerLocked = new Promise<void>(resolve => { signalReader = resolve; });
      const epochFirstReader = target.transaction(async tx => {
        await tx.execute(sql`select 1 from fx_system_scope_clock where scope_id = 'scope_epoch_lock_test' for share`);
        signalReader?.();
        await readerRelease;
        await Effect.runPromise(guardProtectedMetadataEpoch(prepared, target, second, tx));
      });
      await readerLocked;
      await writer.query("begin");
      await writer.query("update fx_system_application_candidate_v1 set candidate_id = candidate_id where false");
      const writerClock = writer.query(
        "select 1 from fx_system_scope_clock where scope_id = 'scope_epoch_lock_test' for update");
      releaseReader?.();
      await expect(epochFirstReader).rejects.toMatchObject({ reason: "busy" });
      await expect(writerClock).resolves.toBeDefined();
      await writer.query("commit");
    } finally {
      await writer.query("rollback");
      writer.release();
      await owner.end();
      await fixture.dispose();
    }
  }, 180_000);

  it("keeps writer invalidation atomic and refuses privilege bypass", async () => {
    const admin = new Pool({ connectionString: provisioningUrl });
    const login = `fx_metadata_${randomUUID().replaceAll("-", "")}`;
    const password = randomBytes(24).toString("hex");
    let roleCreated = false;
    try {
      await withTemporaryPostgresSchema(async options => {
        const owner = await createPostgresPersistence(options);
        let runtime: Awaited<ReturnType<typeof createPostgresPersistence>> | undefined;
        try {
          await owner.migrate();
          const schema = (await owner.query<{ name: string }>("select current_schema() as name")).rows[0]?.name;
          if (schema === undefined) throw new Error("Missing isolated schema");
          await admin.query(`create role "${login}" login password '${password}' nosuperuser nocreatedb nocreaterole noinherit nobypassrls noreplication`);
          roleCreated = true;
          await owner.query(`grant usage on schema "${schema}" to "${login}"`);
          await owner.query(`grant select, insert, update, delete on all tables in schema "${schema}" to "${login}"`);
          await owner.query(`revoke insert, update, delete on "${schema}".fx_system_prepared_metadata_epoch from "${login}"`);
          await owner.query(`grant execute on function "${schema}".fx_lock_prepared_metadata_epoch() to "${login}"`);
          await owner.query(`grant usage, select on all sequences in schema "${schema}" to "${login}"`);
          const url = new URL(options.connectionString);
          url.username = login;
          url.password = password;
          runtime = await createPostgresPersistence({
            connectionString: url.toString(),
            poolConfig: options.poolConfig,
            migrationsSchema: options.migrationsSchema,
            migrationPool: owner.pool,
          });
          await runtime.migrate();
          const prepared = await Effect.runPromise(prepareProtectedMetadata(runtime.drizzle));
          const before = await runtime.drizzle.transaction(tx =>
            Effect.runPromise(captureProtectedMetadataEpoch(prepared, runtime!.drizzle, tx)));
          await runtime.query("update fx_system_application_candidate_v1 set candidate_id = candidate_id where false");
          const after = await runtime.query<{ generation: string }>(
            "select generation::text from fx_system_prepared_metadata_epoch");
          expect(after.rows).toEqual([{ generation: (before.generation + 1n).toString() }]);
          await expect(runtime.drizzle.transaction(tx =>
            Effect.runPromise(guardProtectedMetadataEpoch(prepared, runtime!.drizzle, before, tx))))
            .rejects.toMatchObject({ reason: "changed" });
          await expect(runtime.query("update fx_system_prepared_metadata_epoch set generation = generation + 1"))
            .rejects.toMatchObject({ code: "42501" });
          await expect(runtime.query("truncate fx_system_application_candidate_v1"))
            .rejects.toMatchObject({ code: "42501" });
          await expect(runtime.query("alter table fx_system_application_candidate_v1 disable trigger fx_prepared_metadata_invalidate"))
            .rejects.toMatchObject({ code: "42501" });
          await expect(runtime.query(`set role "${(await owner.query<{ name: string }>("select current_user as name")).rows[0]?.name}"`))
            .rejects.toMatchObject({ code: "42501" });
        } finally {
          await runtime?.close();
          await owner.close();
        }
      });
    } finally {
      try {
        if (roleCreated) await admin.query(`drop role "${login}"`);
      } finally {
        await admin.end();
      }
    }
  }, 180_000);
});
