import {
  cp,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it } from "vitest";

import { createPGlitePersistence } from "../src/pglite";
import {
  insertPendingWake,
  insertWakeHeader,
  insertWakeScope,
  WAKE_EPOCH_A,
  WAKE_EPOCH_B,
  WAKE_EPOCH_C,
  WAKE_SCOPE_A,
  WAKE_SCOPE_B,
} from "./commitWakeOutboxTestSupport";
import {
  writeJournalThrough0030,
  writeJournalThrough0031,
} from "./idempotencySchemaTestSupport";

const MIGRATION_NAME = "0031_commit_wake_outbox.sql";
const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((path) => rm(path, {
      recursive: true,
      force: true,
    })),
  );
});

describe("S09-B commit-wake outbox schema", () => {
  it("installs only the private replacement wake table beside the legacy outbox", async () => {
    const persistence = await createPGlitePersistence();
    await persistence.migrate();
    const tables = await persistence.query<{ table_name: string }>(`
      select table_name
      from information_schema.tables
      where table_schema = current_schema()
        and table_name in ('fx_system_outbox', 'outbox')
      order by table_name
    `);
    expect(tables.rows).toEqual([
      { table_name: "fx_system_outbox" },
      { table_name: "outbox" },
    ]);

    const constraints = await persistence.query<{ constraint_name: string }>(`
      select constraint_name
      from information_schema.table_constraints
      where table_schema = current_schema()
        and table_name = 'fx_system_outbox'
        and constraint_type = 'FOREIGN KEY'
    `);
    expect(constraints.rows).toEqual([
      { constraint_name: "fx_system_outbox_scope_clock_fk" },
    ]);
  });

  it("upgrades 0030, rolls back an injected failure, recovers, and replays", async () => {
    const root = await migrationFixture();
    const db = new PGlite();
    const previous = await createPGlitePersistence({
      db,
      migrationsFolder: root.migrationsFolder,
    });
    await previous.migrate();
    await insertWakeScope(previous, {
      scopeUuid: WAKE_SCOPE_A,
      epochUuid: WAKE_EPOCH_A,
      lastCommitSeq: 1n,
      lastOutboxSeq: 0n,
    });
    await insertWakeHeader(previous, WAKE_SCOPE_A, WAKE_EPOCH_A, 1n);
    await previous.query(`
      insert into outbox (deployment_id, ts, sequence, event)
      values ('legacy-s09b', 1, 0, '{"kind":"legacy"}'::jsonb)
    `);

    await writeJournalThrough0031(
      root.currentJournal,
      root.temporaryJournal,
    );
    const originalMigration = await readFile(root.copiedMigration, "utf8");
    await writeFile(
      root.copiedMigration,
      `${originalMigration}\n--> statement-breakpoint\nselect * from fx_s09b_deliberate_missing_table;\n`,
      "utf8",
    );
    const failing = await createPGlitePersistence({
      db,
      migrationsFolder: root.migrationsFolder,
    });
    await expect(failing.migrate()).rejects.toThrow();
    const rolledBack = await failing.query<{
      outbox_tables: number;
      receipts: number;
    }>(`
      select
        (select count(*)::int from information_schema.tables
         where table_schema = current_schema()
           and table_name = 'fx_system_outbox') as outbox_tables,
        (select count(*)::int from drizzle.__drizzle_migrations) as receipts
    `);
    expect(rolledBack.rows).toEqual([{ outbox_tables: 0, receipts: 31 }]);

    await writeFile(root.copiedMigration, originalMigration, "utf8");
    await expect(failing.migrate()).resolves.toBeUndefined();
    await expect(failing.migrate()).resolves.toBeUndefined();
    const upgraded = await failing.query<{
      headers: number;
      legacy_outbox: number;
      replacement_outbox: number;
      receipts: number;
    }>(`
      select
        (select count(*)::int from fx_system_commit) as headers,
        (select count(*)::int from outbox) as legacy_outbox,
        (select count(*)::int from fx_system_outbox) as replacement_outbox,
        (select count(*)::int from drizzle.__drizzle_migrations) as receipts
    `);
    expect(upgraded.rows).toEqual([{
      headers: 1,
      legacy_outbox: 1,
      replacement_outbox: 0,
      receipts: 32,
    }]);
  });

  it("rejects every nullable state-matrix escape and non-finite time", async () => {
    const persistence = await createPGlitePersistence();
    await persistence.migrate();
    await insertWakeScope(persistence, {
      scopeUuid: WAKE_SCOPE_A,
      epochUuid: WAKE_EPOCH_A,
      lastCommitSeq: 8n,
      lastOutboxSeq: 8n,
    });

    const invalidStatements = [
      `insert into fx_system_outbox
         (scope_uuid, outbox_seq, epoch_uuid, commit_seq, event_kind,
          delivery_state, next_attempt_at, attempt_count, claim_fence)
       values ('${WAKE_SCOPE_A}', 1, '${WAKE_EPOCH_A}', 1,
         'deployment_sync_commit_wake_v1', 'claimed', null, 1, 1)`,
      `insert into fx_system_outbox
         (scope_uuid, outbox_seq, epoch_uuid, commit_seq, event_kind,
          delivery_state, next_attempt_at, attempt_count, claim_fence)
       values ('${WAKE_SCOPE_A}', 2, '${WAKE_EPOCH_A}', 2,
         'deployment_sync_commit_wake_v1', 'pending', now(), 1, 1)`,
      `insert into fx_system_outbox
         (scope_uuid, outbox_seq, epoch_uuid, commit_seq, event_kind,
          last_failure_code)
       values ('${WAKE_SCOPE_A}', 3, '${WAKE_EPOCH_A}', 3,
         'deployment_sync_commit_wake_v1', 'transient_delivery')`,
      `insert into fx_system_outbox
         (scope_uuid, outbox_seq, epoch_uuid, commit_seq, event_kind,
          delivery_state, next_attempt_at, attempt_count, claim_fence,
          delivered_at)
       values ('${WAKE_SCOPE_A}', 4, '${WAKE_EPOCH_A}', 4,
         'deployment_sync_commit_wake_v1', 'delivered', null, 1, 1,
         'infinity'::timestamptz)`,
      `insert into fx_system_outbox
         (scope_uuid, outbox_seq, epoch_uuid, commit_seq, event_kind,
          delivery_state, next_attempt_at, attempt_count, claim_fence,
          dead_lettered_at)
       values ('${WAKE_SCOPE_A}', 5, '${WAKE_EPOCH_A}', 5,
         'deployment_sync_commit_wake_v1', 'dead_lettered', null, 1, 1,
         now())`,
      `insert into fx_system_outbox
         (scope_uuid, outbox_seq, epoch_uuid, commit_seq, event_kind)
       values ('${WAKE_SCOPE_A}', 6, '${WAKE_EPOCH_A}', 6,
         'another_event')`,
      `insert into fx_system_outbox
         (scope_uuid, outbox_seq, epoch_uuid, commit_seq, event_kind,
          attempt_count, claim_fence)
       values ('${WAKE_SCOPE_A}', 7, '${WAKE_EPOCH_A}', 7,
         'deployment_sync_commit_wake_v1', 1, 0)`,
      `insert into fx_system_outbox
         (scope_uuid, outbox_seq, epoch_uuid, commit_seq, event_kind,
          created_at, next_attempt_at)
       values ('${WAKE_SCOPE_A}', 8, '${WAKE_EPOCH_A}', 8,
         'deployment_sync_commit_wake_v1', 'infinity'::timestamptz,
         'infinity'::timestamptz)`,
    ];
    for (const statement of invalidStatements) {
      await expect(persistence.query(statement)).rejects.toThrow();
    }
    const count = await persistence.query<{ count: number }>(
      `select count(*)::int as count from fx_system_outbox`,
    );
    expect(count.rows).toEqual([{ count: 0 }]);
  });

  it("enforces exact UTF-8 and signed-int64 boundaries", async () => {
    const persistence = await createPGlitePersistence();
    await persistence.migrate();
    await insertWakeScope(persistence, {
      scopeUuid: WAKE_SCOPE_A,
      epochUuid: WAKE_EPOCH_A,
      lastCommitSeq: 2n,
      lastOutboxSeq: 2n,
    });
    const exactSummary = "🙂".repeat(256);
    const oversizedSummary = `${exactSummary}🙂`;
    await persistence.query(
      `
        insert into fx_system_outbox
          (scope_uuid, outbox_seq, epoch_uuid, commit_seq, event_kind,
           delivery_state, next_attempt_at, attempt_count, claim_fence,
           last_failure_code, last_failure_summary, last_failed_at)
        values ($1::uuid, 1, $2::uuid, 1,
          'deployment_sync_commit_wake_v1', 'pending', now(), 1, 1,
          'transient_delivery', $3, now())
      `,
      [WAKE_SCOPE_A, WAKE_EPOCH_A, exactSummary],
    );
    await expect(persistence.query(
      `
        insert into fx_system_outbox
          (scope_uuid, outbox_seq, epoch_uuid, commit_seq, event_kind,
           delivery_state, next_attempt_at, attempt_count, claim_fence,
           last_failure_code, last_failure_summary, last_failed_at)
        values ($1::uuid, 2, $2::uuid, 2,
          'deployment_sync_commit_wake_v1', 'pending', now(), 1, 1,
          'transient_delivery', $3, now())
      `,
      [WAKE_SCOPE_A, WAKE_EPOCH_A, oversizedSummary],
    )).rejects.toThrow(/fx_system_outbox_failure_evidence_check/);

    await insertWakeScope(persistence, {
      scopeUuid: WAKE_SCOPE_B,
      epochUuid: WAKE_EPOCH_C,
      lastCommitSeq: 1n,
      lastOutboxSeq: 9_223_372_036_854_775_807n,
    });
    await insertPendingWake(persistence, {
      scopeUuid: WAKE_SCOPE_B,
      outboxSeq: 9_223_372_036_854_775_807n,
      epochUuid: WAKE_EPOCH_C,
      commitSeq: 1n,
    });
    await expect(persistence.query(`
      insert into fx_system_outbox
        (scope_uuid, outbox_seq, epoch_uuid, commit_seq, event_kind)
      values ('${WAKE_SCOPE_B}', 9223372036854775808, '${WAKE_EPOCH_C}', 2,
        'deployment_sync_commit_wake_v1')
    `)).rejects.toThrow();
  });

  it("keeps scopes isolated and feed-header retention independent", async () => {
    const persistence = await createPGlitePersistence();
    await persistence.migrate();
    await insertWakeScope(persistence, {
      scopeUuid: WAKE_SCOPE_A,
      epochUuid: WAKE_EPOCH_A,
      lastCommitSeq: 1n,
      lastOutboxSeq: 1n,
    });
    await insertWakeScope(persistence, {
      scopeUuid: WAKE_SCOPE_B,
      epochUuid: WAKE_EPOCH_C,
      lastCommitSeq: 1n,
      lastOutboxSeq: 1n,
    });
    await insertWakeHeader(persistence, WAKE_SCOPE_A, WAKE_EPOCH_A, 1n);
    await insertPendingWake(persistence, {
      scopeUuid: WAKE_SCOPE_A,
      outboxSeq: 1n,
      epochUuid: WAKE_EPOCH_A,
      commitSeq: 1n,
    });
    await insertPendingWake(persistence, {
      scopeUuid: WAKE_SCOPE_B,
      outboxSeq: 1n,
      epochUuid: WAKE_EPOCH_C,
      commitSeq: 1n,
    });
    await expect(insertPendingWake(persistence, {
      scopeUuid: WAKE_SCOPE_A,
      outboxSeq: 2n,
      epochUuid: WAKE_EPOCH_B,
      commitSeq: 1n,
    })).rejects.toThrow(/fx_system_outbox_commit_event_unique/);

    await persistence.query(`
      delete from fx_system_commit
      where scope_uuid = '${WAKE_SCOPE_A}'::uuid and commit_seq = 1
    `);
    const retained = await persistence.query<{ count: number }>(`
      select count(*)::int as count
      from fx_system_outbox
      where scope_uuid = '${WAKE_SCOPE_A}'::uuid
    `);
    expect(retained.rows).toEqual([{ count: 1 }]);
    await expect(persistence.query(`
      delete from fx_system_scope_clock
      where scope_uuid = '${WAKE_SCOPE_A}'::uuid
    `)).rejects.toThrow(/fx_system_outbox_scope_clock_fk/);
  });
});

async function migrationFixture(): Promise<Readonly<{
  migrationsFolder: string;
  currentJournal: string;
  temporaryJournal: string;
  copiedMigration: string;
}>> {
  const root = await mkdtemp(resolve(tmpdir(), "flarex-s09b-pglite-"));
  temporaryRoots.push(root);
  const migrationsFolder = resolve(root, "drizzle");
  const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const currentMigrationsFolder = resolve(packageRoot, "drizzle");
  const currentJournal = resolve(currentMigrationsFolder, "meta/_journal.json");
  const temporaryJournal = resolve(migrationsFolder, "meta/_journal.json");
  await cp(currentMigrationsFolder, migrationsFolder, { recursive: true });
  await writeJournalThrough0030(currentJournal, temporaryJournal);
  return Object.freeze({
    migrationsFolder,
    currentJournal,
    temporaryJournal,
    copiedMigration: resolve(migrationsFolder, MIGRATION_NAME),
  });
}
