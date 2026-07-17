import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import type { FlarexPersistence } from "../src";
import {
  createPostgresPersistence,
  type PostgresFlarexPersistence,
} from "../src/postgres";
import {
  classifyOutcomeIntegrity,
  insertAvailableOutcome,
  insertS09Header,
  insertS09Scope,
  MAX_RESULT_CANONICAL_BYTES,
  MAX_RESULT_SEMANTIC_BYTES,
  S09_EPOCH_A,
  S09_EPOCH_B,
  S09_EPOCH_C,
  S09_SCOPE_A,
  S09_SCOPE_B,
  writeJournalThrough0029,
  writeJournalThrough0030,
} from "./idempotencySchemaTestSupport";
import {
  postgresUrl,
  withTemporaryPostgresPersistence,
  withTemporaryPostgresSchema,
} from "./postgresHelpers";

const MIGRATION_NAME = "0030_absurd_vanisher.sql";
const describePostgres = postgresUrl === null ? describe.skip : describe;
type SqlPersistence = Pick<FlarexPersistence, "query">;

describePostgres("real Postgres S09-A committed-success idempotency schema", () => {
  it("rolls back, upgrades 0029, and replays in a non-public schema", async () => {
    const testRoot = await mkdtemp(resolve(tmpdir(), "flarex-s09a-postgres-"));
    const migrationsFolder = resolve(testRoot, "drizzle");
    const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
    const currentMigrationsFolder = resolve(packageRoot, "drizzle");
    const currentJournal = resolve(currentMigrationsFolder, "meta/_journal.json");
    const temporaryJournal = resolve(migrationsFolder, "meta/_journal.json");
    const copiedMigration = resolve(migrationsFolder, MIGRATION_NAME);

    try {
      await cp(currentMigrationsFolder, migrationsFolder, { recursive: true });
      await writeJournalThrough0029(currentJournal, temporaryJournal);

      await withTemporaryPostgresSchema(async (databaseOptions) => {
        const previous = await createPostgresPersistence({
          ...databaseOptions,
          migrationsFolder,
        });
        let current:
          | Awaited<ReturnType<typeof createPostgresPersistence>>
          | undefined;
        try {
          await previous.migrate();
          await insertS09Scope(previous, S09_SCOPE_A, S09_EPOCH_A, "1");
          await insertS09Header(previous, S09_SCOPE_A, S09_EPOCH_A, "1");
          await previous.query(`
            insert into commits (deployment_id, ts, source, write_summary)
            values ('legacy-s09a', 1, 'legacy', '{"writes":1}'::jsonb)
          `);
          await previous.query(`
            insert into outbox (deployment_id, ts, sequence, event)
            values ('legacy-s09a', 1, 0, '{"kind":"legacy"}'::jsonb)
          `);

          const schema = await previous.query<{ schema_name: string }>(
            `select current_schema() as schema_name`,
          );
          expect(schema.rows[0]?.schema_name).not.toBe("public");

          await writeJournalThrough0030(currentJournal, temporaryJournal);
          const migration = await readFile(copiedMigration, "utf8");
          await writeFile(
            copiedMigration,
            `${migration}\n--> statement-breakpoint\nselect * from fx_s09a_deliberate_missing_table;\n`,
            "utf8",
          );
          current = await createPostgresPersistence({
            ...databaseOptions,
            migrationsFolder,
          });
          await expect(current.migrate()).rejects.toThrow();

          const rolledBack = await current.query<{
            outcome_tables: number;
            receipts: number;
          }>(`
            select
              (select count(*)::int from information_schema.tables
               where table_schema = current_schema()
                 and table_name = 'fx_system_idempotency') as outcome_tables,
              (select count(*)::int
               from ${quoteIdentifier(databaseOptions.migrationsSchema)}.__drizzle_migrations) as receipts
          `);
          expect(rolledBack.rows).toEqual([
            { outcome_tables: 0, receipts: 30 },
          ]);

          await writeFile(
            copiedMigration,
            await readFile(
              resolve(currentMigrationsFolder, MIGRATION_NAME),
              "utf8",
            ),
            "utf8",
          );
          await expect(current.migrate()).resolves.toBeUndefined();
          await expect(current.migrate()).resolves.toBeUndefined();

          const upgraded = await current.query<{
            headers: number;
            legacy_commits: number;
            legacy_outbox: number;
            outcomes: number;
            receipts: number;
          }>(`
            select
              (select count(*)::int from fx_system_commit) as headers,
              (select count(*)::int from commits) as legacy_commits,
              (select count(*)::int from outbox) as legacy_outbox,
              (select count(*)::int from fx_system_idempotency) as outcomes,
              (select count(*)::int
               from ${quoteIdentifier(databaseOptions.migrationsSchema)}.__drizzle_migrations) as receipts
          `);
          expect(upgraded.rows).toEqual([
            {
              headers: 1,
              legacy_commits: 1,
              legacy_outbox: 1,
              outcomes: 0,
              receipts: 31,
            },
          ]);
        } finally {
          await Promise.all([previous.close(), current?.close()]);
        }
      });
    } finally {
      await rm(testRoot, { recursive: true, force: true });
    }
  }, 30_000);

  it("allows exactly one same-key winner without overwriting mismatched evidence", async () => {
    await withTemporaryPostgresPersistence(async (persistence) => {
      await insertS09Scope(persistence, S09_SCOPE_A, S09_EPOCH_A, "10");
      await insertS09Scope(persistence, S09_SCOPE_B, S09_EPOCH_C, "10");

      const contenders = await Promise.allSettled([
        insertAvailableOutcome(persistence, {
          scopeUuid: S09_SCOPE_A,
          requestKey: "concurrent-request",
          epochUuid: S09_EPOCH_A,
          commitSeq: "1",
          requestHashByte: "22",
        }),
        insertAvailableOutcome(persistence, {
          scopeUuid: S09_SCOPE_A,
          requestKey: "concurrent-request",
          epochUuid: S09_EPOCH_A,
          commitSeq: "2",
          requestHashByte: "aa",
        }),
      ]);
      expect(contenders.filter((result) => result.status === "fulfilled")).toHaveLength(
        1,
      );
      expect(contenders.filter((result) => result.status === "rejected")).toHaveLength(
        1,
      );

      const beforeMismatch = await readOutcomeMatchEvidence(
        persistence,
        S09_SCOPE_A,
        "concurrent-request",
      );
      const winnerRequestHashByte = beforeMismatch.request_sha256.slice(0, 2);
      for (const mismatch of [
        {
          identityHashByte: "cc",
          requestHashByte: winnerRequestHashByte,
        },
        {
          functionPath: "messages:update",
          requestHashByte: winnerRequestHashByte,
        },
        { requestHashByte: "bb" },
      ] as const) {
        await expect(
          insertAvailableOutcome(persistence, {
            ...mismatch,
            scopeUuid: S09_SCOPE_A,
            requestKey: "concurrent-request",
            epochUuid: beforeMismatch.epoch_uuid,
            commitSeq: beforeMismatch.commit_seq,
          }),
        ).rejects.toThrow();
        await expect(
          readOutcomeMatchEvidence(
            persistence,
            S09_SCOPE_A,
            "concurrent-request",
          ),
        ).resolves.toEqual(beforeMismatch);
      }

      await expect(
        Promise.all([
          insertAvailableOutcome(persistence, {
            scopeUuid: S09_SCOPE_A,
            requestKey: "scope-independent",
            epochUuid: S09_EPOCH_A,
            commitSeq: "4",
          }),
          insertAvailableOutcome(persistence, {
            scopeUuid: S09_SCOPE_B,
            requestKey: "scope-independent",
            epochUuid: S09_EPOCH_C,
            commitSeq: "4",
          }),
        ]),
      ).resolves.toEqual([undefined, undefined]);

      await expect(
        persistence.transaction(async (transaction) => {
          await insertS09Header(
            transaction,
            S09_SCOPE_A,
            S09_EPOCH_A,
            "7",
          );
          await insertAvailableOutcome(transaction, {
            scopeUuid: S09_SCOPE_A,
            requestKey: "rolled-back-result",
            epochUuid: S09_EPOCH_A,
            commitSeq: "7",
          });
          throw new Error("injected S09-A publication rollback");
        }),
      ).rejects.toThrow("injected S09-A publication rollback");
      const rollbackCounts = await persistence.query<{
        headers: number;
        outcomes: number;
      }>(`
        select
          (select count(*)::int from fx_system_commit where commit_seq = 7) as headers,
          (select count(*)::int from fx_system_idempotency
           where request_key = 'rolled-back-result') as outcomes
      `);
      expect(rollbackCounts.rows).toEqual([{ headers: 0, outcomes: 0 }]);

      await persistence.query(`
        insert into fx_system_idempotency
          (scope_uuid, request_key, identity_access_policy_sha256,
           function_path, request_sha256, epoch_uuid, commit_seq,
           result_state, result_value_codec_version, result_semantic_bytes,
           result_bytes, result_sha256)
        select
          '${S09_SCOPE_A}'::uuid,
          'plan-fixture-' || generate_series,
          decode(repeat('11', 32), 'hex'),
          'messages:create',
          decode(repeat('22', 32), 'hex'),
          '${S09_EPOCH_A}'::uuid,
          1,
          'available', 1, 1, decode('01', 'hex'),
          decode(repeat('33', 32), 'hex')
        from generate_series(1, 200)
      `);
      await persistence.query(`analyze fx_system_idempotency`);
      const plans = await outcomeLookupPlans(persistence);
      expect(plans.lookup).toContain(
        "fx_system_idempotency_scope_uuid_request_key_pk",
      );
      expect(plans.audit).toContain("fx_system_idempotency_commit_token_idx");
    });
  }, 30_000);

  it("keeps compacted receipts unambiguous across a repeatable-read race", async () => {
    await withTemporaryPostgresPersistence(async (persistence) => {
      await insertS09Scope(persistence, S09_SCOPE_A, S09_EPOCH_A, "3");
      await insertS09Header(persistence, S09_SCOPE_A, S09_EPOCH_A, "1");
      await insertAvailableOutcome(persistence, {
        scopeUuid: S09_SCOPE_A,
        requestKey: "compaction-race",
        epochUuid: S09_EPOCH_A,
        commitSeq: "1",
      });

      const reader = await persistence.pool.connect();
      try {
        await reader.query("begin isolation level repeatable read read only");
        const snapshotPersistence: SqlPersistence = {
          query: async (sql, params) => {
            const result = await reader.query(
              sql,
              params === undefined ? undefined : [...params],
            );
            return { rows: result.rows };
          },
        };
        await expect(
          classifyOutcomeIntegrity(
            snapshotPersistence,
            S09_SCOPE_A,
            "compaction-race",
          ),
        ).resolves.toBe("validRetained");

        await persistence.transaction(async (transaction) => {
          await transaction.query(
            `delete from fx_system_commit
             where scope_uuid = $1::uuid and commit_seq = 1`,
            [S09_SCOPE_A],
          );
          await transaction.query(
            `update fx_system_scope_clock
             set oldest_available_commit_seq = 2
             where scope_uuid = $1::uuid`,
            [S09_SCOPE_A],
          );
        });

        await expect(
          classifyOutcomeIntegrity(
            snapshotPersistence,
            S09_SCOPE_A,
            "compaction-race",
          ),
        ).resolves.toBe("validRetained");
        await reader.query("commit");
      } catch (error) {
        await reader.query("rollback").catch(() => undefined);
        throw error;
      } finally {
        reader.release();
      }

      await expect(
        classifyOutcomeIntegrity(
          persistence,
          S09_SCOPE_A,
          "compaction-race",
        ),
      ).resolves.toBe("validCompacted");

      await insertS09Header(persistence, S09_SCOPE_A, S09_EPOCH_A, "2");
      await insertAvailableOutcome(persistence, {
        scopeUuid: S09_SCOPE_A,
        requestKey: "wrong-retained-epoch",
        epochUuid: S09_EPOCH_B,
        commitSeq: "2",
      });
      await insertAvailableOutcome(persistence, {
        scopeUuid: S09_SCOPE_A,
        requestKey: "missing-retained-header",
        epochUuid: S09_EPOCH_A,
        commitSeq: "3",
      });
      await insertAvailableOutcome(persistence, {
        scopeUuid: S09_SCOPE_A,
        requestKey: "future-token",
        epochUuid: S09_EPOCH_A,
        commitSeq: "4",
      });

      await expect(
        classifyOutcomeIntegrity(
          persistence,
          S09_SCOPE_A,
          "wrong-retained-epoch",
        ),
      ).resolves.toBe("corruptRetainedEpoch");
      await expect(
        classifyOutcomeIntegrity(
          persistence,
          S09_SCOPE_A,
          "missing-retained-header",
        ),
      ).resolves.toBe("corruptMissingRetainedHeader");
      await expect(
        classifyOutcomeIntegrity(persistence, S09_SCOPE_A, "future-token"),
      ).resolves.toBe("corruptFutureToken");
    });
  }, 30_000);

  it("enforces the semantic and canonical result ceilings on large bytea", async () => {
    await withTemporaryPostgresPersistence(async (persistence) => {
      await insertS09Scope(persistence, S09_SCOPE_A, S09_EPOCH_A, "1");
      await insertAvailableOutcome(persistence, {
        scopeUuid: S09_SCOPE_A,
        requestKey: "exact-large-result",
        epochUuid: S09_EPOCH_A,
        commitSeq: "1",
        resultSemanticBytes: MAX_RESULT_SEMANTIC_BYTES,
        resultByteLength: MAX_RESULT_CANONICAL_BYTES,
      });
      const exact = await persistence.query<{
        canonical_bytes: number;
        semantic_bytes: number;
      }>(`
        select
          octet_length(result_bytes)::int as canonical_bytes,
          result_semantic_bytes as semantic_bytes
        from fx_system_idempotency
        where scope_uuid = '${S09_SCOPE_A}'::uuid
          and request_key = 'exact-large-result'
      `);
      expect(exact.rows).toEqual([
        {
          canonical_bytes: MAX_RESULT_CANONICAL_BYTES,
          semantic_bytes: MAX_RESULT_SEMANTIC_BYTES,
        },
      ]);
      await persistence.query(`delete from fx_system_idempotency`);

      await expect(
        insertAvailableOutcome(persistence, {
          scopeUuid: S09_SCOPE_A,
          requestKey: "semantic-plus-one",
          epochUuid: S09_EPOCH_A,
          commitSeq: "1",
          resultSemanticBytes: MAX_RESULT_SEMANTIC_BYTES + 1,
        }),
      ).rejects.toThrow(/fx_system_idempotency_result_evidence_check/);
      await expect(
        insertAvailableOutcome(persistence, {
          scopeUuid: S09_SCOPE_A,
          requestKey: "canonical-plus-one",
          epochUuid: S09_EPOCH_A,
          commitSeq: "1",
          resultByteLength: MAX_RESULT_CANONICAL_BYTES + 1,
        }),
      ).rejects.toThrow(/fx_system_idempotency_result_evidence_check/);
    });
  }, 180_000);
});

async function readOutcomeMatchEvidence(
  persistence: SqlPersistence,
  scopeUuid: string,
  requestKey: string,
): Promise<{
  readonly commit_seq: string;
  readonly epoch_uuid: string;
  readonly function_path: string;
  readonly identity_access_policy_sha256: string;
  readonly request_sha256: string;
}> {
  const result = await persistence.query<{
    commit_seq: string;
    epoch_uuid: string;
    function_path: string;
    identity_access_policy_sha256: string;
    request_sha256: string;
  }>(
    `
      select
        commit_seq::text as commit_seq,
        epoch_uuid::text as epoch_uuid,
        function_path,
        encode(identity_access_policy_sha256, 'hex') as identity_access_policy_sha256,
        encode(request_sha256, 'hex') as request_sha256
      from fx_system_idempotency
      where scope_uuid = $1::uuid and request_key = $2
    `,
    [scopeUuid, requestKey],
  );
  const row = result.rows[0];
  if (row === undefined) throw new Error("Missing committed outcome fixture.");
  return row;
}

async function outcomeLookupPlans(
  persistence: PostgresFlarexPersistence,
): Promise<{ readonly audit: string; readonly lookup: string }> {
  const client = await persistence.pool.connect();
  try {
    await client.query(`set enable_seqscan = off`);
    await client.query(`set enable_bitmapscan = off`);
    const lookup = await client.query<{ "QUERY PLAN": string }>(
      `
        explain (costs off)
        select request_key
        from fx_system_idempotency
        where scope_uuid = $1::uuid and request_key = $2
      `,
      [S09_SCOPE_A, "concurrent-request"],
    );
    const audit = await client.query<{ "QUERY PLAN": string }>(
      `
        explain (costs off)
        select request_key
        from fx_system_idempotency
        where scope_uuid = $1::uuid
          and commit_seq < $2
        order by commit_seq, epoch_uuid
        limit 101
      `,
      [S09_SCOPE_A, "11"],
    );
    return {
      audit: audit.rows.map((row) => row["QUERY PLAN"]).join("\n"),
      lookup: lookup.rows.map((row) => row["QUERY PLAN"]).join("\n"),
    };
  } finally {
    client.release();
  }
}

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}
