import { Pool } from "pg";
import { setTimeout as delay } from "node:timers/promises";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { prepareProtectedMetadata } from "../src/preparedMetadataEpoch";
import { createProtectedFileScopedPostgresFixture, postgresUrl, withTemporaryPostgresPersistence } from "./postgresHelpers";
import { runningAttemptTailScenario } from "./exactRunningAttemptTailScenario";
import { insertExecutionClaimFixture } from "./transactionExecutionClaimSchemaTestSupport";
import { insertOpenTransactionJournalFixture, insertSessionTestScope, insertTransactionSessionFixture,
  SESSION_TEST_SCOPE_UUID, transactionSessionFixture, transactionSessionIdAt } from "./sessionAuthorityTestSupport";
import { rollbackAndReleasePostgresClient } from "./postgresHelpers";

describe.skipIf(postgresUrl === null)("ordered running-attempt tail on PostgreSQL", () => {
  it("retains native codecs and bounded first refusals", async () => {
    await withTemporaryPostgresPersistence(runningAttemptTailScenario);
  }, 120_000);

  it("refuses duplicate or missing roots before touching a separately held claim", async () => {
    await withTemporaryPostgresPersistence(async persistence => {
      const sessionId = transactionSessionIdAt(322);
      await insertSessionTestScope(persistence);
      await insertTransactionSessionFixture(persistence, transactionSessionFixture(sessionId));
      await insertOpenTransactionJournalFixture(persistence, { scopeUuid: SESSION_TEST_SCOPE_UUID, sessionId });
      await insertExecutionClaimFixture(persistence);
      // Disposable structural corruption removes the root key and its FKs.
      await persistence.query("alter table fx_system_tx_journal drop constraint fx_system_tx_journal_pk cascade");
      await persistence.query("insert into fx_system_tx_journal select * from fx_system_tx_journal");
      const held = await persistence.pool.connect();
      try {
        await held.query("begin");
        await held.query("select 1 from fx_system_tx_execution_claim where session_id = $1 for update", [sessionId]);
        const read = () => Promise.race([
          persistence.query("select disposition from fx_lock_running_attempt_tail($1, $2, 1, 'scope_missing_tail_clock')",
            [SESSION_TEST_SCOPE_UUID, sessionId]),
          delay(2_000).then(() => { throw new Error("Root refusal waited on a later claim lock"); }),
        ]);
        await expect(read()).resolves.toMatchObject({ rows: [{ disposition: "journalRootInvalid" }] });
        await persistence.query("delete from fx_system_tx_journal where session_id = $1", [sessionId]);
        await expect(read()).resolves.toMatchObject({ rows: [{ disposition: "journalRootMissing" }] });
      } finally {
        await rollbackAndReleasePostgresClient(held);
      }
    });
  }, 120_000);
});

describe.skipIf(postgresUrl === null || !process.env.FLAREX_POSTGRES_PROVISIONING_DATABASE_URL)(
  "running-attempt tail under the restricted authenticated runtime", () => {
    it("uses only invoker privileges and refuses replaced or foreign function definitions", async () => {
      const fixture = await createProtectedFileScopedPostgresFixture();
      const owner = new Pool({ connectionString: postgresUrl!, options: `-c search_path=${fixture.schemaName}` });
      const signature = "fx_lock_running_attempt_tail(uuid,uuid,bigint,text)";
      try {
        await expect(fixture.persistence.query(`select disposition from fx_lock_running_attempt_tail(
          '61000000-0000-0000-0000-000000000001', '61000000-0000-0000-0000-000000000322', 1, 'scope_absent')`))
          .resolves.toMatchObject({ rows: [{ disposition: "journalRootMissing" }] });
        await expect(fixture.persistence.query(`alter function ${signature} rename to bypass_running_tail`))
          .rejects.toMatchObject({ code: "42501" });
        await expect(fixture.persistence.query(`alter function ${signature} security definer`))
          .rejects.toMatchObject({ code: "42501" });
        const definition = (await owner.query<{ definition: string }>(
          "select pg_get_functiondef($1::regprocedure) as definition", [signature])).rows[0]?.definition;
        if (definition === undefined) throw new Error("Missing running-attempt tail definition");
        await expect(fixture.persistence.query(definition)).rejects.toMatchObject({ code: "42501" });

        for (const mutation of [
          definition.replace("LIMIT 2 FOR UPDATE", "LIMIT 2 FOR SHARE"),
          definition.replace(`FROM ${fixture.schemaName}.fx_system_tx_journal r`, "FROM public.fx_system_tx_journal r"),
        ]) {
          if (mutation === definition) throw new Error("Function mutation did not change its definition");
          try {
            await owner.query(mutation);
            await expect(Effect.runPromise(prepareProtectedMetadata(fixture.persistence.drizzle)))
              .rejects.toMatchObject({ reason: "unprotectedRuntime" });
          } finally {
            await owner.query(definition);
          }
        }
        await owner.query("create function fx_lock_running_attempt_tail() returns text language sql as 'select ''shadow''' ");
        try {
          await expect(Effect.runPromise(prepareProtectedMetadata(fixture.persistence.drizzle)))
            .rejects.toMatchObject({ reason: "unprotectedRuntime" });
        } finally {
          await owner.query("drop function fx_lock_running_attempt_tail()");
        }
        const provisioningUrl = process.env.FLAREX_POSTGRES_PROVISIONING_DATABASE_URL;
        if (provisioningUrl === undefined) throw new Error("Missing provisioning URL");
        const provisioner = new Pool({ connectionString: provisioningUrl,
          options: `-c search_path=${fixture.schemaName}` });
        try {
          const support = await provisioner.query<{ present: boolean }>(`select exists (
            select 1 from pg_catalog.pg_proc where pronamespace = 'pg_catalog'::regnamespace
              and proname = 'array_append_support' and proargtypes = '2281'::oidvector
              and prorettype = 2281) as present`);
          if (support.rows[0]?.present !== true) throw new Error("Installed PostgreSQL lacks the built-in support witness");
          try {
            await provisioner.query(`alter function ${signature} support pg_catalog.array_append_support`);
            // Inspect installation metadata only; never invoke the altered tail.
            await expect(Effect.runPromise(prepareProtectedMetadata(fixture.persistence.drizzle)))
              .rejects.toMatchObject({ reason: "unprotectedRuntime" });
          } finally {
            await provisioner.query(definition);
          }
        } finally {
          await provisioner.end();
        }
        await Effect.runPromise(prepareProtectedMetadata(fixture.persistence.drizzle));
      } finally {
        await owner.end();
        await fixture.dispose();
      }
    }, 180_000);
  },
);
