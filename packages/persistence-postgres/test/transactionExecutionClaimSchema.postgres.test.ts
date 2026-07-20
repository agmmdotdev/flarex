import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import type { FlarexSqlClient } from "../src";
import { createPostgresPersistence } from "../src/postgres";
import {
  writeJournalThrough0031,
  writeJournalThrough0032,
} from "./idempotencySchemaTestSupport";
import {
  postgresUrl,
  withTemporaryPostgresPersistence,
  withTemporaryPostgresSchema,
} from "./postgresHelpers";
import {
  insertOpenTransactionJournalFixture,
  insertSessionTestScope,
  insertSnapshotLeaseFixture,
  insertTransactionSessionFixture,
  SESSION_TEST_SCOPE_UUID,
  snapshotLeaseFixture,
  transactionSessionFixture,
  transactionSessionIdAt,
} from "./sessionAuthorityTestSupport";
import { insertExecutionClaimFixture } from
  "./transactionExecutionClaimSchemaTestSupport";

const MIGRATION_NAME = "0032_transaction_execution_claim.sql";
const describePostgres = postgresUrl === null ? describe.skip : describe;
type SqlPersistence = Pick<FlarexSqlClient, "query">;

describePostgres("real Postgres B2b1 exact-attempt claim schema", () => {
  it("rolls back, upgrades 0031 without backfill, and replays off public", async () => {
    const fixture = await migrationFixture();
    const sessionId = transactionSessionIdAt(331);
    try {
      await withTemporaryPostgresSchema(async (databaseOptions) => {
        const previous = await createPostgresPersistence({
          ...databaseOptions,
          migrationsFolder: fixture.migrationsFolder,
        });
        let current:
          | Awaited<ReturnType<typeof createPostgresPersistence>>
          | undefined;
        try {
          await previous.migrate();
          await insertSessionTestScope(previous);
          await insertTransactionSessionFixture(
            previous,
            transactionSessionFixture(sessionId, { lifecycle: "running" }),
          );
          await insertSnapshotLeaseFixture(
            previous,
            snapshotLeaseFixture(sessionId),
          );
          await insertOpenTransactionJournalFixture(previous, {
            scopeUuid: SESSION_TEST_SCOPE_UUID,
            sessionId,
          });

          await writeJournalThrough0032(
            fixture.currentJournal,
            fixture.temporaryJournal,
          );
          const migration = await readFile(fixture.copiedMigration, "utf8");
          await writeFile(
            fixture.copiedMigration,
            `${migration}\n--> statement-breakpoint\nselect * from fx_b2b1_deliberate_missing_table;\n`,
            "utf8",
          );
          current = await createPostgresPersistence({
            ...databaseOptions,
            migrationsFolder: fixture.migrationsFolder,
          });
          await expect(current.migrate()).rejects.toThrow();
          await expect(readUpgradeState(
            current,
            databaseOptions.migrationsSchema,
          )).resolves.toEqual({
            currentSchemaIsPublic: false,
            sessions: 1,
            leases: 1,
            journals: 1,
            claims: 0,
            claimTables: 0,
            receipts: 32,
          });

          await writeFile(fixture.copiedMigration, migration, "utf8");
          await expect(current.migrate()).resolves.toBeUndefined();
          await expect(current.migrate()).resolves.toBeUndefined();
          await expect(readUpgradeState(
            current,
            databaseOptions.migrationsSchema,
          )).resolves.toEqual({
            currentSchemaIsPublic: false,
            sessions: 1,
            leases: 1,
            journals: 1,
            claims: 0,
            claimTables: 1,
            receipts: 33,
          });
        } finally {
          await Promise.all([previous.close(), current?.close()]);
        }
      });
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  }, 30_000);

  it("enforces the exact FK/check matrix, cascade, and an indexed lookup plan", async () => {
    await withTemporaryPostgresPersistence(async (persistence) => {
      const sessionId = transactionSessionIdAt(332);
      await insertSessionTestScope(persistence);
      await insertTransactionSessionFixture(
        persistence,
        transactionSessionFixture(sessionId, { lifecycle: "running" }),
      );
      await insertOpenTransactionJournalFixture(persistence, {
        scopeUuid: SESSION_TEST_SCOPE_UUID,
        sessionId,
      });

      await expect(insertExecutionClaimFixture(persistence, {
        sessionId: transactionSessionIdAt(998),
      })).rejects.toThrow(/fx_system_tx_execution_claim_journal_fk/);
      for (const invalid of [
        { attemptFence: "0" },
        { claimFence: "0" },
        { claimOwner: "61000000-0000-3000-8000-000000000101" },
        { claimedAt: "infinity" },
        { claimExpiresAt: "infinity" },
        { claimExpiresAt: "2030-01-01T00:00:00.000Z" },
        { claimExpiresAt: "2029-12-31T23:59:59.000Z" },
      ]) {
        await expect(insertExecutionClaimFixture(
          persistence,
          { sessionId, ...invalid },
        )).rejects.toThrow();
      }

      await insertExecutionClaimFixture(persistence, { sessionId });
      const foreignKey = await persistence.query<{ definition: string }>(`
        select pg_get_constraintdef(oid) as definition
        from pg_constraint
        where conname = 'fx_system_tx_execution_claim_journal_fk'
          and conrelid = 'fx_system_tx_execution_claim'::regclass
      `);
      expect(foreignKey.rows).toEqual([{
        definition: expect.stringContaining(
          "ON UPDATE RESTRICT ON DELETE CASCADE",
        ),
      }]);

      await persistence.query("analyze fx_system_tx_execution_claim");
      await persistence.query("set enable_seqscan = off");
      const plan = await persistence.query<{ plan: unknown }>(`
        explain (format json, costs off)
        select claim_fence, claim_owner
        from fx_system_tx_execution_claim
        where scope_uuid = '${SESSION_TEST_SCOPE_UUID}'::uuid
          and session_id = '${sessionId}'::uuid
          and attempt_fence = 1
        for update
      `);
      const planText = JSON.stringify(plan.rows);
      expect(planText).not.toContain('"Node Type":"Seq Scan"');
      expect([
        planText.includes("fx_system_tx_execution_claim_pk"),
        planText.includes("fx_system_tx_execution_claim_expiry_idx"),
      ]).toContain(true);

      await persistence.query(
        `delete from fx_system_tx_journal where session_id = $1::uuid`,
        [sessionId],
      );
      const remaining = await persistence.query<{ count: number }>(
        `select count(*)::int as count from fx_system_tx_execution_claim`,
      );
      expect(remaining.rows).toEqual([{ count: 0 }]);
    });
  });
});

async function readUpgradeState(
  persistence: SqlPersistence,
  migrationsSchema: string,
): Promise<Readonly<{
  currentSchemaIsPublic: boolean;
  sessions: number;
  leases: number;
  journals: number;
  claims: number;
  claimTables: number;
  receipts: number;
}>> {
  const result = await persistence.query<{
    current_schema_is_public: boolean;
    sessions: number;
    leases: number;
    journals: number;
    claim_tables: number;
    receipts: number;
  }>(`
    select
      current_schema() = 'public' as current_schema_is_public,
      (select count(*)::int from fx_system_tx_session) as sessions,
      (select count(*)::int from fx_system_snapshot_lease) as leases,
      (select count(*)::int from fx_system_tx_journal) as journals,
      (select count(*)::int from information_schema.tables
       where table_schema = current_schema()
         and table_name = 'fx_system_tx_execution_claim') as claim_tables,
      (select count(*)::int
       from ${quoteIdentifier(migrationsSchema)}.__drizzle_migrations)
       as receipts
  `);
  const row = result.rows[0];
  if (row === undefined) throw new Error("Expected one migration state row.");
  const claims = row.claim_tables === 0
    ? 0
    : (await persistence.query<{ count: number }>(
      `select count(*)::int as count from fx_system_tx_execution_claim`,
    )).rows[0]?.count;
  if (claims === undefined) throw new Error("Expected one claim count row.");
  return Object.freeze({
    currentSchemaIsPublic: row.current_schema_is_public,
    sessions: row.sessions,
    leases: row.leases,
    journals: row.journals,
    claims,
    claimTables: row.claim_tables,
    receipts: row.receipts,
  });
}

async function migrationFixture(): Promise<Readonly<{
  root: string;
  migrationsFolder: string;
  currentJournal: string;
  temporaryJournal: string;
  copiedMigration: string;
}>> {
  const root = await mkdtemp(resolve(tmpdir(), "flarex-b2b1-postgres-"));
  const migrationsFolder = resolve(root, "drizzle");
  const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const currentMigrationsFolder = resolve(packageRoot, "drizzle");
  const currentJournal = resolve(currentMigrationsFolder, "meta/_journal.json");
  const temporaryJournal = resolve(migrationsFolder, "meta/_journal.json");
  await cp(currentMigrationsFolder, migrationsFolder, { recursive: true });
  await writeJournalThrough0031(currentJournal, temporaryJournal);
  return Object.freeze({
    root,
    migrationsFolder,
    currentJournal,
    temporaryJournal,
    copiedMigration: resolve(migrationsFolder, MIGRATION_NAME),
  });
}

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}
