import { readFile, writeFile } from "node:fs/promises";
import { Effect } from "effect";
import { makeDrizzleCopyFixture, writeJournalThrough } from "../support/migrationFixtureSupport";
import { describe, expect, it } from "vitest";
import { createPostgresPersistence } from "../../src/database/postgres";
import { bootstrapInstallationMigrations } from "../../src/database/postgresInstallationMaintenance";
import { postgresUrl, withTemporaryPostgresSchema } from "../support/postgresHelpers";
import {
  insertSessionTestScope,
  insertTransactionSessionFixture,
  SESSION_TEST_SCOPE_UUID,
  transactionSessionFixture,
  transactionSessionIdAt,
} from "../execution/session/support/sessionStorage";

describe.skipIf(postgresUrl === null)("whole mutation migration 0127 on ordinary-role PostgreSQL", () => {
  it.each(["running", "aborted"] as const)("preserves a %s predecessor through the actual maintenance owner", async lifecycle => {
    const fixture = await makeDrizzleCopyFixture("flarex-whole-mutation", "postgres", "0127_whole_mutation.sql");
    const { migrationsFolder, temporaryJournal: journalPath } = fixture;
    try {
      const journalText = await readFile(journalPath, "utf8");
      await writeJournalThrough(fixture.currentJournal, journalPath, 126);
      await withTemporaryPostgresSchema(async options => {
        const previous = await createPostgresPersistence({ ...options, migrationsFolder });
        try {
          const [location] = (await previous.query<{ schema_name: string }>("select current_schema() schema_name")).rows;
          if (location === undefined) throw new Error("Missing actual predecessor namespace");
          // Exact structural predecessor; no current fullProof capability is
          // published using a verifier that requires the new 0127 columns.
          await Effect.runPromise(bootstrapInstallationMigrations(previous.pool.options, location.schema_name,
            { migrationsFolder, migrationsSchema: options.migrationsSchema }));
          await previous.query("update fx_system_installation set state='active' where singleton_id=1");
          await insertSessionTestScope(previous);
          const sessionId = transactionSessionIdAt(127);
          await insertTransactionSessionFixture(previous, transactionSessionFixture(sessionId, { lifecycle: "running" }));
          if (lifecycle === "aborted") await previous.query(`update fx_system_tx_session set lifecycle='aborted',
            validated_args_json=null,validated_args_canonical_bytes=null,
            authorization_grant_json=null,authorization_grant_canonical_bytes=null where session_id=$1::uuid`, [sessionId]);
          await previous.query(`insert into fx_system_tx_journal
            (scope_uuid,session_id,attempt_fence,state,journal_format,execution_profile,
             creation_time_seed,next_creation_time,created_at,updated_at)
            values ($1::uuid,$2::uuid,1,'open','flarex.session-journal','finiteRoot',
              1893456000000,1893456000000,'2030-01-01','2030-01-01')`, [SESSION_TEST_SCOPE_UUID, sessionId]);
          const identity = (await previous.query(`select scope_uuid::text,session_id::text,request_key,
            encode(request_sha256,'hex') request_hash from fx_system_tx_session`)).rows;
          await writeFile(journalPath, journalText, "utf8");
          const current = await createPostgresPersistence({ ...options, migrationsFolder });
          try {
            if (lifecycle === "running") {
            await expect(current.migrate()).rejects.toMatchObject({ reason: "resourceFailure", cause: { cause: {
              code: "55000", message: "whole mutation cutover requires terminal or authenticated recovery drain of existing finite roots",
            } } });
            expect((await current.query(`select state,exists(select 1 from information_schema.columns
              where table_schema=current_schema() and table_name='fx_system_tx_session'
              and column_name='finite_attempt_bytes') anchor_column from fx_system_installation`)).rows)
              .toEqual([{ state: "draining", anchor_column: false }]);
            expect((await current.query(`select scope_uuid::text,session_id::text,request_key,
              encode(request_sha256,'hex') request_hash from fx_system_tx_session`)).rows).toEqual(identity);
            expect((await current.query(`select lifecycle,
              (select count(*)::text from fx_system_tx_journal where execution_profile='finiteRoot') retained_roots
              from fx_system_tx_session`)).rows).toEqual([{ lifecycle: "running", retained_roots: "1" }]);
            return;
            }
            await current.migrate();
            await current.migrate();
            expect((await current.query(`select
              to_regprocedure(current_schema() || '.fx_lock_finite_running_attempt(text,uuid,bigint,text,bigint,text)') is null retired_attempt_owner,
              to_regprocedure(current_schema() || '.fx_lock_finite_scope_observation(text)') is null retired_scope_owner,
              to_regprocedure(current_schema() || '.fx_lock_read_scope_placement(text,text)') is null retired_placement_owner`)).rows)
              .toEqual([{ retired_attempt_owner: true, retired_scope_owner: true, retired_placement_owner: true }]);
            expect((await current.query(`select scope_uuid::text,session_id::text,request_key,
              encode(request_sha256,'hex') request_hash from fx_system_tx_session`)).rows).toEqual(identity);
            expect((await current.query(`select i.state,
              (select count(*)::text from fx_system_tx_journal where execution_profile='finiteRoot') retained_roots,
              (select execution_profile from fx_system_tx_session limit 1) predecessor_profile from fx_system_installation i`)).rows)
              .toEqual([{ state: "active", retained_roots: "1", predecessor_profile: "durableOperations" }]);
          } finally { await current.close(); }
        } finally { await previous.close(); }
      });
    } finally { await fixture.cleanup(); }
  }, 180_000);
});
