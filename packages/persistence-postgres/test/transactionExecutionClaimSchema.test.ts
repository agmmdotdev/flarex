import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { PGlite } from "@electric-sql/pglite";
import { MAX_PERSISTED_SIGNED_INT64_V1 } from
  "flarex-protocol/storage-authority";
import { describe, expect, it } from "vitest";

import * as persistencePackage from "../src";
import type { FlarexSqlClient } from "../src";
import { createPGlitePersistence } from "../src/pglite";
import { TransactionExecutionClaimFenceV1Schema } from
  "../src/transactionExecutionClaim";
import {
  writeJournalThrough0031,
  writeJournalThrough0032,
} from "./idempotencySchemaTestSupport";
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

describe("B2b1 exact-attempt execution-claim schema", () => {
  it("brands only positive PostgreSQL signed-bigint claim fences", () => {
    expect(TransactionExecutionClaimFenceV1Schema.make(
      MAX_PERSISTED_SIGNED_INT64_V1,
    )).toBe(MAX_PERSISTED_SIGNED_INT64_V1);
    for (const invalid of [
      -1n,
      0n,
      MAX_PERSISTED_SIGNED_INT64_V1 + 1n,
    ]) {
      expect(() => TransactionExecutionClaimFenceV1Schema.make(invalid))
        .toThrow();
    }
  });

  it("installs privately with the exact bounded key and journal ownership", async () => {
    const persistence = await createPGlitePersistence();
    await expect(persistence.migrate()).resolves.toBeUndefined();
    await expect(persistence.migrate()).resolves.toBeUndefined();

    const columns = await persistence.query<{ column_name: string }>(`
      select column_name
      from information_schema.columns
      where table_schema = current_schema()
        and table_name = 'fx_system_tx_execution_claim'
      order by ordinal_position
    `);
    expect(columns.rows.map((row) => row.column_name)).toEqual([
      "scope_uuid",
      "session_id",
      "attempt_fence",
      "claim_fence",
      "claim_owner",
      "claimed_at",
      "claim_expires_at",
    ]);
    expect(persistencePackage).not.toHaveProperty(
      "fxSystemTransactionExecutionClaims",
    );

    const constraints = await persistence.query<{
      constraint_name: string;
      constraint_type: string;
      definition: string | null;
    }>(`
      select
        c.constraint_name,
        c.constraint_type,
        pg_get_constraintdef(p.oid) as definition
      from information_schema.table_constraints c
      join pg_constraint p on p.conname = c.constraint_name
      where c.table_schema = current_schema()
        and c.table_name = 'fx_system_tx_execution_claim'
      order by c.constraint_name
    `);
    expect(constraints.rows.filter((row) =>
      row.constraint_type === "PRIMARY KEY"
    )).toHaveLength(1);
    const foreignKeys = constraints.rows.filter((row) =>
      row.constraint_type === "FOREIGN KEY"
    );
    expect(foreignKeys).toHaveLength(1);
    expect(foreignKeys[0]).toMatchObject({
      constraint_name: "fx_system_tx_execution_claim_journal_fk",
    });
    expect(foreignKeys[0]?.definition).toContain("ON UPDATE RESTRICT");
    expect(foreignKeys[0]?.definition).toContain("ON DELETE CASCADE");
  });

  it("upgrades 0031 without fabricating authority and recovers an injected failure", async () => {
    const fixture = await migrationFixture();
    const db = new PGlite();
    const sessionId = transactionSessionIdAt(321);
    try {
      const previous = await createPGlitePersistence({
        db,
        migrationsFolder: fixture.migrationsFolder,
      });
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
      const current = await createPGlitePersistence({
        db,
        migrationsFolder: fixture.migrationsFolder,
      });
      await expect(current.migrate()).rejects.toThrow();
      await expect(readUpgradeState(current)).resolves.toEqual({
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
      await expect(readUpgradeState(current)).resolves.toEqual({
        sessions: 1,
        leases: 1,
        journals: 1,
        claims: 0,
        claimTables: 1,
        receipts: 33,
      });
    } finally {
      try {
        await db.close();
      } finally {
        await rm(fixture.root, { recursive: true, force: true });
      }
    }
  }, 20_000);

  it("rejects invalid claims and cascades only with the exact journal root", async () => {
    const persistence = await createPGlitePersistence();
    await persistence.migrate();
    const sessionId = transactionSessionIdAt(322);
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
      sessionId: transactionSessionIdAt(999),
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
      ))
        .rejects.toThrow();
    }

    await insertExecutionClaimFixture(persistence, { sessionId });
    await expect(insertExecutionClaimFixture(persistence, { sessionId }))
      .rejects.toThrow(
      /fx_system_tx_execution_claim_pk/,
    );
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

type SqlPersistence = Pick<FlarexSqlClient, "query">;

async function readUpgradeState(persistence: SqlPersistence): Promise<Readonly<{
  sessions: number;
  leases: number;
  journals: number;
  claims: number;
  claimTables: number;
  receipts: number;
}>> {
  const result = await persistence.query<{
    sessions: number;
    leases: number;
    journals: number;
    claim_tables: number;
    receipts: number;
  }>(`
    select
      (select count(*)::int from fx_system_tx_session) as sessions,
      (select count(*)::int from fx_system_snapshot_lease) as leases,
      (select count(*)::int from fx_system_tx_journal) as journals,
      (select count(*)::int from information_schema.tables
       where table_schema = current_schema()
         and table_name = 'fx_system_tx_execution_claim') as claim_tables,
      (select count(*)::int from drizzle.__drizzle_migrations) as receipts
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
  const root = await mkdtemp(resolve(tmpdir(), "flarex-b2b1-pglite-"));
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
