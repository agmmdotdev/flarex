import { randomBytes, randomUUID } from "node:crypto";
import { Client, Pool, type ClientConfig } from "pg";
import { describe, expect, it, vi } from "vitest";
import { Cause, Effect, Exit, Fiber } from "effect";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { flarexSchema } from "../src/schema";

import { createPostgresPersistence } from "../src/postgres";
import {
  captureProtectedMetadataEpoch,
  authenticateProtectedTargetMetadataSnapshot,
  guardProtectedMetadataEpoch,
  prepareProtectedMetadata,
  PreparedMetadataEpochError,
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
  it("resolves each native hash getter once with the exact receiver and preserves getter defects", async () => {
    const fixture = await createProtectedFileScopedPostgresFixture();
    const nativeCrypto = globalThis.crypto;
    const nativeSubtle = nativeCrypto.subtle;
    const nativeDigest = nativeSubtle.digest;
    const originalCrypto = Object.getOwnPropertyDescriptor(globalThis, "crypto");
    const originalSubtle = Object.getOwnPropertyDescriptor(nativeCrypto, "subtle");
    const originalDigest = Object.getOwnPropertyDescriptor(nativeSubtle, "digest");
    let cryptoReads = 0, subtleReads = 0, digestReads = 0, calls = 0;
    const wrapper = new Proxy(nativeDigest, { apply(target, receiver, args) {
      expect(receiver).toBe(nativeSubtle);
      calls++;
      return Reflect.apply(target, receiver, args);
    } });
    const healthyGetters = () => {
      Object.defineProperty(globalThis, "crypto", { configurable: true, get() { cryptoReads++; return nativeCrypto; } });
      Object.defineProperty(nativeCrypto, "subtle", { configurable: true, get() { subtleReads++; return nativeSubtle; } });
      Object.defineProperty(nativeSubtle, "digest", { configurable: true, get() { digestReads++; return wrapper; } });
    };
    try {
      healthyGetters();
      await Effect.runPromise(prepareProtectedMetadata(fixture.persistence.drizzle));
      expect([cryptoReads, subtleReads, digestReads, calls]).toEqual([1, 1, 1, 1]);
      for (const [owner, key] of [[globalThis, "crypto"], [nativeCrypto, "subtle"], [nativeSubtle, "digest"]] as const) {
        healthyGetters();
        const defect = new DOMException(`Injected ${key} getter defect`, "OperationError");
        Object.defineProperty(owner, key, { configurable: true, get() { throw defect; } });
        const outcome = await Effect.runPromiseExit(prepareProtectedMetadata(fixture.persistence.drizzle));
        if (!Exit.isFailure(outcome)) throw new Error("Unexpected successful hash getter defect");
        expect(outcome.cause.reasons).toHaveLength(1);
        expect(outcome.cause.reasons.some(reason => Cause.isDieReason(reason) && reason.defect === defect)).toBe(true);
      }
    } finally {
      for (const [owner, key, descriptor] of [[nativeSubtle, "digest", originalDigest],
        [nativeCrypto, "subtle", originalSubtle], [globalThis, "crypto", originalCrypto]] as const) {
        if (descriptor === undefined) Reflect.deleteProperty(owner, key);
        else Object.defineProperty(owner, key, descriptor);
      }
      await fixture.dispose();
    }
  }, 180_000);

  it("executes both named owner shapes on fresh and retained clients and refuses deallocated server state without fallback", async () => {
    const fixture = await createProtectedFileScopedPostgresFixture();
    const options: ClientConfig = { ...fixture.persistence.pool.options };
    const client = new Client(options);
    const replacement = new Client(options);
    try {
      await client.connect();
      const database = drizzle(client, { schema: flarexSchema });
      const prepared = await Effect.runPromise(prepareProtectedMetadata(database));
      const epoch = await database.transaction(tx => Effect.runPromise(
        captureProtectedMetadataEpoch(prepared, database, tx)));
      for (let invocation = 0; invocation < 3; invocation++) {
        await database.transaction(async tx => {
          await Effect.runPromise(authenticateProtectedTargetMetadataSnapshot({ token: prepared, database, epoch }, tx));
          await Effect.runPromise(guardProtectedMetadataEpoch(prepared, database, epoch, tx));
        });
      }
      const names = (await client.query<{ name: string; parameter_types: string; generic_plans: number; custom_plans: number }>(
        "select name, parameter_types::text, generic_plans::int, custom_plans::int from pg_prepared_statements where name like 'fx_pm_%' order by name")).rows;
      expect(names).toHaveLength(2);
      for (const named of names) {
        expect(named.name).toMatch(/^fx_pm_[0-9a-f]{56}$/);
        expect(named.name.length).toBe(62);
        expect(named.parameter_types).toBe("{}");
        expect(named.generic_plans).toBeGreaterThanOrEqual(3);
        expect(named.custom_plans).toBe(0);
      }
      await client.query("deallocate all");
      for (const accept of [
        () => Effect.runPromise(prepareProtectedMetadata(database)),
        () => database.transaction(tx => Effect.runPromise(
          guardProtectedMetadataEpoch(prepared, database, epoch, tx))),
      ]) {
        try {
          await accept();
          throw new Error("Deallocated named proof unexpectedly succeeded");
        } catch (error) {
          expect(error).toBeInstanceOf(PreparedMetadataEpochError);
          if (!(error instanceof PreparedMetadataEpochError)) throw error;
          expect(error.reason).toBe("resourceFailure");
          const visited = new Set<object>();
          let cause = error.cause;
          while (typeof cause === "object" && cause !== null && !visited.has(cause) &&
            !("code" in cause && cause.code === "26000")) {
            visited.add(cause);
            cause = "cause" in cause ? cause.cause : undefined;
          }
          expect(cause).toMatchObject({ code: "26000" });
        }
      }
      expect((await client.query("select name from pg_prepared_statements where name like 'fx_pm_%'")).rows).toEqual([]);
      await replacement.connect();
      const replacementDatabase = drizzle(replacement, { schema: flarexSchema });
      const replacementPrepared = await Effect.runPromise(prepareProtectedMetadata(replacementDatabase));
      const replacementEpoch = await replacementDatabase.transaction(tx => Effect.runPromise(
        captureProtectedMetadataEpoch(replacementPrepared, replacementDatabase, tx)));
      await replacementDatabase.transaction(tx => Effect.runPromise(
        guardProtectedMetadataEpoch(replacementPrepared, replacementDatabase, replacementEpoch, tx)));
      expect((await replacement.query<{ name: string }>(
        "select name from pg_prepared_statements where name like 'fx_pm_%' order by name")).rows)
        .toEqual(names.map(({ name }) => ({ name })));
    } finally {
      await client.end();
      await replacement.end();
      await fixture.dispose();
    }
  }, 180_000);

  it("preserves hash resource failures, unexpected defects and driver name collisions at the genuine owner", async () => {
    const fixture = await createProtectedFileScopedPostgresFixture();
    const client = await fixture.persistence.pool.connect();
    const database = drizzle(client, { schema: flarexSchema });
    const digest = vi.spyOn(crypto.subtle, "digest");
    try {
      const unavailable = new DOMException("Injected WebCrypto refusal", "OperationError");
      digest.mockRejectedValueOnce(unavailable);
      await expect(Effect.runPromise(prepareProtectedMetadata(database)))
        .rejects.toMatchObject({ reason: "resourceFailure", cause: unavailable });
      const defect = new Error("Unexpected hash implementation defect");
      digest.mockRejectedValueOnce(defect);
      const outcome = await Effect.runPromiseExit(prepareProtectedMetadata(database));
      if (!Exit.isFailure(outcome)) throw new Error("Unexpected hash defect succeeded");
      expect(outcome.cause.reasons).toHaveLength(1);
      expect(outcome.cause.reasons.some(reason => Cause.isDieReason(reason) && reason.defect === defect)).toBe(true);
      let notifyEntered = () => {};
      const entered = new Promise<void>(resolve => { notifyEntered = resolve; });
      digest.mockImplementationOnce(() => {
        notifyEntered();
        return new Promise<ArrayBuffer>(() => {});
      });
      await Effect.runPromise(Effect.gen(function* () {
        const fiber = yield* Effect.forkChild(prepareProtectedMetadata(database));
        yield* Effect.promise(() => entered);
        yield* Fiber.interrupt(fiber);
        const interrupted = yield* Fiber.await(fiber);
        expect(Exit.isFailure(interrupted) && interrupted.cause.reasons.some(Cause.isInterruptReason)).toBe(true);
      }));
      const fixedDigest = new Uint8Array(32).buffer;
      digest.mockResolvedValue(fixedDigest);
      const prepared = await Effect.runPromise(prepareProtectedMetadata(database));
      const epoch = await database.transaction(tx => Effect.runPromise(
        captureProtectedMetadataEpoch(prepared, database, tx)));
      await expect(database.transaction(tx => Effect.runPromise(
        guardProtectedMetadataEpoch(prepared, database, epoch, tx))))
        .rejects.toMatchObject({ reason: "resourceFailure" });
      const names = (await client.query<{ name: string; generic_plans: number }>(
        "select name, generic_plans::int from pg_prepared_statements where name = $1", [`fx_pm_${"0".repeat(56)}`])).rows;
      expect(names).toHaveLength(1);
      expect(names[0]?.generic_plans).toBe(2);
    } finally {
      digest.mockRestore();
      client.release();
      await fixture.dispose();
    }
  }, 180_000);

  it("rechecks warmed owner catalog, login, membership, search path and installation identity in both shapes", async () => {
    const fixture = await createProtectedFileScopedPostgresFixture();
    const owner = new Pool({ connectionString: postgresUrl!, options: `-c search_path=${fixture.schemaName}` });
    const provision = new Pool({ connectionString: provisioningUrl });
    const client = await fixture.persistence.pool.connect();
    const schema = `"${fixture.schemaName}"`;
    const member = `fx_metadata_member_${randomUUID().replaceAll("-", "")}`;
    const shadow = `fx_metadata_shadow_${randomUUID().replaceAll("-", "")}`;
    let memberCreated = false;
    try {
      const database = drizzle(client, { schema: flarexSchema });
      const prepared = await Effect.runPromise(prepareProtectedMetadata(database));
      const epoch = await database.transaction(tx => Effect.runPromise(captureProtectedMetadataEpoch(prepared, database, tx)));
      await database.transaction(tx => Effect.runPromise(guardProtectedMetadataEpoch(prepared, database, epoch, tx)));
      const role = (await client.query<{ login: string }>("select session_user as login")).rows[0]?.login;
      if (role === undefined) throw new Error("Missing actual runtime login");
      const tableOwner = (await owner.query<{ owner: string }>(
        "select pg_get_userbyid(relowner) as owner from pg_class where oid = $1::regclass",
        [`${schema}.fx_system_application_function_v1`])).rows[0]?.owner;
      if (tableOwner === undefined) throw new Error("Missing original covered table owner");
      const refuse = async (reason: "unprotectedRuntime" | "changed" | "invalidEpoch", preparing = true) => {
        if (preparing) await expect(Effect.runPromise(prepareProtectedMetadata(database))).rejects.toMatchObject({ reason });
        await expect(database.transaction(tx => Effect.runPromise(
          authenticateProtectedTargetMetadataSnapshot({ token: prepared, database, epoch }, tx)))).rejects.toMatchObject({ reason });
        await expect(database.transaction(tx => Effect.runPromise(
          guardProtectedMetadataEpoch(prepared, database, epoch, tx)))).rejects.toMatchObject({ reason });
      };
      for (const privilege of ["bypassrls", "nologin"]) {
        try {
          await provision.query(`alter role "${role}" ${privilege}`);
          await refuse("unprotectedRuntime");
        } finally { await provision.query(`alter role "${role}" nobypassrls login`); }
      }
      await provision.query(`create role "${member}" nologin nosuperuser noinherit nobypassrls`);
      memberCreated = true;
      try {
        await owner.query(`grant usage on schema ${schema} to "${member}"`);
        await owner.query(`grant select on all tables in schema ${schema} to "${member}"`);
        await owner.query(`grant execute on function ${schema}.fx_lock_prepared_metadata_epoch() to "${member}"`);
        await provision.query(`grant "${member}" to "${role}"`);
        await refuse("unprotectedRuntime");
        await client.query(`set role "${member}"`);
        try { await refuse("unprotectedRuntime"); } finally { await client.query("reset role"); }
      } finally {
        await provision.query(`revoke "${member}" from "${role}"`);
        await provision.query(`drop owned by "${member}"`);
      }
      for (const name of ["fx_invalidate_prepared_metadata", "fx_lock_prepared_metadata_epoch", "fx_lock_running_attempt_tail"]) {
        const original = (await owner.query<{ definition: string; body: string }>(
          "select pg_get_functiondef(p.oid) as definition, p.prosrc as body from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = $1 and p.proname = $2",
          [fixture.schemaName, name])).rows[0];
        if (original === undefined || !original.definition.includes(original.body))
          throw new Error("Missing exact definer body witness");
        try {
          await owner.query(original.definition.replace(original.body, `${original.body}\n-- injected named-plan body change\n`));
          await refuse("unprotectedRuntime");
        } finally { await owner.query(original.definition); }
      }
      for (const mutation of [
        [`alter table ${schema}.fx_system_application_function_v1 owner to "${role}"`,
          `alter table ${schema}.fx_system_application_function_v1 owner to "${tableOwner}"`],
        [`alter table ${schema}.fx_system_application_function_v1 enable row level security`,
          `alter table ${schema}.fx_system_application_function_v1 disable row level security`],
        [`grant update(generation) on ${schema}.fx_system_prepared_metadata_epoch to "${role}"`,
          `revoke update(generation) on ${schema}.fx_system_prepared_metadata_epoch from "${role}"`],
        [`create function ${schema}.fx_lock_running_attempt_tail() returns text language sql as 'select ''shadow'''`,
          `drop function ${schema}.fx_lock_running_attempt_tail()`],
      ]) {
        const [apply, restore] = mutation;
        if (apply === undefined || restore === undefined) throw new Error("Incomplete owner fault witness");
        try { await provision.query(apply); await refuse("unprotectedRuntime"); }
        finally { await provision.query(restore); }
      }
      await owner.query(`create schema "${shadow}"`);
      try {
        await owner.query(`grant usage on schema "${shadow}" to "${role}"`);
        await client.query(`set search_path = "${shadow}", ${schema}`);
        await refuse("invalidEpoch");
      } finally {
        await client.query(`set search_path = ${schema}`);
        await owner.query(`drop schema "${shadow}"`);
      }
      const original = (await owner.query<{ incarnation: string }>(
        `select incarnation::text from ${schema}.fx_system_prepared_metadata_epoch`)).rows[0]?.incarnation;
      if (original === undefined) throw new Error("Missing original installation incarnation");
      try {
        await owner.query(`update ${schema}.fx_system_prepared_metadata_epoch set incarnation = $1`, [randomUUID()]);
        await refuse("changed", false);
      } finally { await owner.query(`update ${schema}.fx_system_prepared_metadata_epoch set incarnation = $1`, [original]); }
      await database.transaction(tx => Effect.runPromise(guardProtectedMetadataEpoch(prepared, database, epoch, tx)));
    } finally {
      client.release();
      await owner.end();
      if (memberCreated) await provision.query(`drop role "${member}"`);
      await provision.end();
      await fixture.dispose();
    }
  }, 180_000);

  it("refuses missing covered tables and missing, disabled, malformed or foreign-function invalidation triggers", async () => {
    const fixture = await createProtectedFileScopedPostgresFixture();
    const owner = new Pool({ connectionString: postgresUrl!,
      options: `-c search_path=${fixture.schemaName}` });
    const runtime = await fixture.persistence.pool.connect();
    const schema = `"${fixture.schemaName}"`;
    const table = `${schema}.fx_system_application_function_v1`;
    const trigger = "fx_prepared_metadata_invalidate";
    try {
      const definition = (await owner.query<{ definition: string }>(
        "select pg_get_triggerdef(t.oid) as definition from pg_trigger t where t.tgrelid = $1::regclass and t.tgname = $2",
        [table, trigger])).rows[0]?.definition;
      if (definition === undefined) throw new Error("Missing genuine invalidation trigger");
      const database = drizzle(runtime, { schema: flarexSchema });
      const prepared = await Effect.runPromise(prepareProtectedMetadata(database));
      const epoch = await database.transaction(tx => Effect.runPromise(
        captureProtectedMetadataEpoch(prepared, database, tx)));
      await database.transaction(tx => Effect.runPromise(
        guardProtectedMetadataEpoch(prepared, database, epoch, tx)));
      const refuse = async () => {
        await expect(Effect.runPromise(prepareProtectedMetadata(database)))
          .rejects.toMatchObject({ reason: "unprotectedRuntime" });
        await expect(database.transaction(tx => Effect.runPromise(
          authenticateProtectedTargetMetadataSnapshot({ token: prepared, database, epoch }, tx))))
          .rejects.toMatchObject({ reason: "unprotectedRuntime" });
        await expect(database.transaction(tx => Effect.runPromise(
          guardProtectedMetadataEpoch(prepared, database, epoch, tx))))
          .rejects.toMatchObject({ reason: "unprotectedRuntime" });
      };
      try {
        await owner.query(`alter table ${table} rename to fx_system_application_function_hidden`);
        await refuse();
      } finally {
        await owner.query(`alter table ${schema}.fx_system_application_function_hidden rename to fx_system_application_function_v1`);
      }
      try {
        await owner.query(`alter table ${table} disable trigger ${trigger}`);
        await refuse();
      } finally { await owner.query(`alter table ${table} enable trigger ${trigger}`); }

      await owner.query(`create function ${schema}.fx_foreign_metadata_invalidation() returns trigger
        language plpgsql as $$ begin return null; end; $$`);
      try {
        for (const replacement of [undefined,
          `create trigger ${trigger} after update on ${table} for each statement execute function ${schema}.fx_invalidate_prepared_metadata()`,
          `create trigger ${trigger} after insert or update or delete or truncate on ${table} for each statement execute function ${schema}.fx_foreign_metadata_invalidation()`,
        ]) {
          try {
            await owner.query(`drop trigger ${trigger} on ${table}`);
            if (replacement !== undefined) await owner.query(replacement);
            await refuse();
          } finally {
            await owner.query(`drop trigger if exists ${trigger} on ${table}`);
            await owner.query(definition);
          }
        }
      } finally { await owner.query(`drop function ${schema}.fx_foreign_metadata_invalidation()`); }
      // DDL corruption did not advance the epoch. Its complete structural
      // attestation, rather than an epoch mismatch, must drive every refusal.
      const restored = await database.transaction(tx => Effect.runPromise(
        captureProtectedMetadataEpoch(prepared, database, tx)));
      expect(restored).toEqual(epoch);
    } finally {
      runtime.release();
      await owner.end();
      await fixture.dispose();
    }
  }, 180_000);

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
      await fixture.persistence.query(`with clock as (
        insert into fx_system_scope_clock (scope_id) values ('scope_epoch_lock_test') returning scope_id
      )
      insert into fx_system_scope_execution_authority (scope_id, storage_generation, epoch)
      select scope_id, 'flarexdb_v1', 'epoch_lock_test' from clock`);
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
