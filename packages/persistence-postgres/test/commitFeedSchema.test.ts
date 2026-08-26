import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

import type { FlarexPersistence } from "../src";
import { createPGlitePersistence } from "../src/pglite";

const SCOPE_A = "81000000-0000-0000-0000-000000000001";
const EPOCH_A = "81000000-0000-0000-0000-000000000002";
const EPOCH_B = "81000000-0000-0000-0000-000000000003";
const ROW_A = "81000000000000000000000000000004";
const ROW_B = "81000000000000000000000000000005";
const ROW_C = "81000000000000000000000000000006";
const SCOPE_B = "82000000-0000-0000-0000-000000000001";
const EPOCH_C = "82000000-0000-0000-0000-000000000002";
const POSTGRES_SIGNED_BIGINT_MAX = "9223372036854775807";

type SqlPersistence = Pick<FlarexPersistence, "query">;

describe("S08 commit/change-feed schema", () => {
  it("installs the additive inventory idempotently and keeps legacy storage intact", async () => {
    const persistence = await createPGlitePersistence();

    await expect(persistence.migrate()).resolves.toBeUndefined();
    await expect(persistence.migrate()).resolves.toBeUndefined();

    const tables = await persistence.query<{ table_name: string }>(`
      select table_name
      from information_schema.tables
      where table_schema = current_schema()
        and table_name in (
          'fx_system_commit',
          'fx_system_commit_app_row_change',
          'fx_system_commit_relation_adjacency_change',
          'commits',
          'documents',
          'leases',
          'outbox'
        )
      order by table_name
    `);
    expect(tables.rows.map(({ table_name }) => table_name)).toEqual([
      "commits",
      "documents",
      "fx_system_commit",
      "fx_system_commit_app_row_change",
      "fx_system_commit_relation_adjacency_change",
      "leases",
      "outbox",
    ]);
    const floor = await persistence.query<{
      column_default: string | null;
      is_nullable: string;
    }>(`
      select column_default, is_nullable
      from information_schema.columns
      where table_schema = current_schema()
        and table_name = 'fx_system_scope_clock'
        and column_name = 'oldest_available_commit_seq'
    `);
    expect(floor.rows).toEqual([
      { column_default: "0", is_nullable: "NO" },
    ]);
  });

  it("upgrades 0028 scope authority with floor zero and leaves legacy rows untouched", async () => {
    const testRoot = await mkdtemp(resolve(tmpdir(), "flarex-s08-upgrade-"));
    const migrationsFolder = resolve(testRoot, "drizzle");
    const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
    const currentMigrationsFolder = resolve(packageRoot, "drizzle");
    const temporaryJournal = resolve(migrationsFolder, "meta/_journal.json");
    const db = new PGlite();

    try {
      await cp(currentMigrationsFolder, migrationsFolder, { recursive: true });
      await writeJournalThrough0028(
        resolve(currentMigrationsFolder, "meta/_journal.json"),
        temporaryJournal,
      );
      const previous = await createPGlitePersistence({ db, migrationsFolder });
      await previous.migrate();
      await insertScope(previous, SCOPE_A, EPOCH_A, "7");
      await previous.query(`
        insert into commits (deployment_id, ts, source, write_summary)
        values ('legacy-deployment', 11, 'legacy-source', '{"writes":1}'::jsonb)
      `);
      await previous.query(`
        insert into documents
          (deployment_id, id, ts, table_id, json_value, deleted)
        values
          ('legacy-deployment', decode('01', 'hex'), 11,
           decode('02', 'hex'), decode('03', 'hex'), false)
      `);
      await expect(
        previous.query(`select oldest_available_commit_seq from fx_system_scope_clock`),
      ).rejects.toThrow();

      await writeJournalThrough0029(
        resolve(currentMigrationsFolder, "meta/_journal.json"),
        temporaryJournal,
      );
      const current = await createPGlitePersistence({ db, migrationsFolder });
      await expect(current.migrate()).resolves.toBeUndefined();
      await expect(current.migrate()).resolves.toBeUndefined();

      const preserved = await current.query<{
        floor: string;
        last_commit_seq: string;
        legacy_commits: string;
        legacy_documents: string;
      }>(`
        select
          oldest_available_commit_seq::text as floor,
          last_commit_seq::text as last_commit_seq,
          (select count(*)::text from commits) as legacy_commits,
          (select count(*)::text from documents) as legacy_documents
        from fx_system_scope_clock
        where scope_uuid = '${SCOPE_A}'::uuid
      `);
      expect(preserved.rows).toEqual([
        {
          floor: "0",
          last_commit_seq: "7",
          legacy_commits: "1",
          legacy_documents: "1",
        },
      ]);
    } finally {
      try {
        await db.close();
      } finally {
        await rm(testRoot, { recursive: true, force: true });
      }
    }
  });

  it("rolls back an injected 0029 failure and recovers with one receipt", async () => {
    const testRoot = await mkdtemp(resolve(tmpdir(), "flarex-s08-failure-"));
    const migrationsFolder = resolve(testRoot, "drizzle");
    const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
    const currentMigrationsFolder = resolve(packageRoot, "drizzle");
    const currentJournal = resolve(currentMigrationsFolder, "meta/_journal.json");
    const temporaryJournal = resolve(migrationsFolder, "meta/_journal.json");
    const migrationName = "0029_mysterious_namora.sql";
    const copiedMigration = resolve(migrationsFolder, migrationName);
    const db = new PGlite();

    try {
      await cp(currentMigrationsFolder, migrationsFolder, { recursive: true });
      await writeJournalThrough0028(currentJournal, temporaryJournal);
      const previous = await createPGlitePersistence({ db, migrationsFolder });
      await previous.migrate();
      await insertScope(previous, SCOPE_A, EPOCH_A, "0");
      await writeJournalThrough0029(currentJournal, temporaryJournal);

      const migration = await readFile(copiedMigration, "utf8");
      await writeFile(
        copiedMigration,
        `${migration}\n--> statement-breakpoint\nselect * from fx_s08_deliberate_missing_table;\n`,
        "utf8",
      );
      const failing = await createPGlitePersistence({ db, migrationsFolder });
      await expect(failing.migrate()).rejects.toThrow();
      const rolledBack = await failing.query<{
        floor_columns: string;
        feed_tables: string;
        receipts: string;
      }>(`
        select
          (select count(*)::text
           from information_schema.columns
           where table_schema = current_schema()
             and table_name = 'fx_system_scope_clock'
             and column_name = 'oldest_available_commit_seq') as floor_columns,
          (select count(*)::text
           from information_schema.tables
           where table_schema = current_schema()
             and table_name like 'fx_system_commit%') as feed_tables,
          (select count(*)::text from drizzle.__drizzle_migrations) as receipts
      `);
      expect(rolledBack.rows).toEqual([
        { floor_columns: "0", feed_tables: "0", receipts: "29" },
      ]);

      await writeFile(
        copiedMigration,
        await readFile(resolve(currentMigrationsFolder, migrationName), "utf8"),
        "utf8",
      );
      const recovered = await createPGlitePersistence({ db, migrationsFolder });
      await expect(recovered.migrate()).resolves.toBeUndefined();
      await expect(recovered.migrate()).resolves.toBeUndefined();
      const result = await recovered.query<{
        floor: string;
        feed_tables: string;
        receipts: string;
      }>(`
        select
          (select oldest_available_commit_seq::text
           from fx_system_scope_clock
           where scope_uuid = '${SCOPE_A}'::uuid) as floor,
          (select count(*)::text
           from information_schema.tables
           where table_schema = current_schema()
             and table_name like 'fx_system_commit%') as feed_tables,
          (select count(*)::text from drizzle.__drizzle_migrations) as receipts
      `);
      expect(result.rows).toEqual([
        { floor: "0", feed_tables: "2", receipts: "30" },
      ]);
    } finally {
      try {
        await db.close();
      } finally {
        await rm(testRoot, { recursive: true, force: true });
      }
    }
  });

  it("upgrades 0076 headers to zero relation facts and rolls back an injected 0077 failure", async () => {
    const testRoot = await mkdtemp(resolve(tmpdir(), "flarex-r03-upgrade-"));
    const migrationsFolder = resolve(testRoot, "drizzle");
    const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
    const currentMigrationsFolder = resolve(packageRoot, "drizzle");
    const currentJournal = resolve(currentMigrationsFolder, "meta/_journal.json");
    const temporaryJournal = resolve(migrationsFolder, "meta/_journal.json");
    const migrationName = "0077_lame_human_torch.sql";
    const copiedMigration = resolve(migrationsFolder, migrationName);
    const db = new PGlite();

    try {
      await cp(currentMigrationsFolder, migrationsFolder, { recursive: true });
      await writeJournalBeforeIndex(currentJournal, temporaryJournal, 77);
      const previous = await createPGlitePersistence({ db, migrationsFolder });
      await previous.migrate();
      await insertScope(previous, SCOPE_A, EPOCH_A, "1");
      await insertHeader(previous, SCOPE_A, EPOCH_A, "1", 0);

      await writeFile(
        temporaryJournal,
        await readFile(currentJournal, "utf8"),
        "utf8",
      );
      const migration = await readFile(copiedMigration, "utf8");
      await writeFile(
        copiedMigration,
        `${migration}\n--> statement-breakpoint\nselect * from fx_r03_deliberate_missing_table;\n`,
        "utf8",
      );
      const failing = await createPGlitePersistence({ db, migrationsFolder });
      await expect(failing.migrate()).rejects.toThrow();
      const rolledBack = await failing.query<{
        relation_count_columns: string;
        relation_tables: string;
        headers: string;
        receipts: string;
      }>(`
        select
          (select count(*)::text from information_schema.columns
           where table_schema = current_schema()
             and table_name = 'fx_system_commit'
             and column_name = 'relation_adjacency_change_count')
            as relation_count_columns,
          (select count(*)::text from information_schema.tables
           where table_schema = current_schema()
             and table_name =
               'fx_system_commit_relation_adjacency_change')
            as relation_tables,
          (select count(*)::text from fx_system_commit) as headers,
          (select count(*)::text from drizzle.__drizzle_migrations)
            as receipts
      `);
      expect(rolledBack.rows).toEqual([{
        relation_count_columns: "0",
        relation_tables: "0",
        headers: "1",
        receipts: "77",
      }]);

      await writeFile(copiedMigration, migration, "utf8");
      const current = await createPGlitePersistence({ db, migrationsFolder });
      await expect(current.migrate()).resolves.toBeUndefined();
      await expect(current.migrate()).resolves.toBeUndefined();
      const upgraded = await current.query<{
        relation_count: string;
        column_default: string | null;
        is_nullable: string;
        relation_children: string;
        receipts: string;
      }>(`
        select
          (select relation_adjacency_change_count::text
           from fx_system_commit
           where scope_uuid = '${SCOPE_A}'::uuid and commit_seq = 1)
            as relation_count,
          (select column_default from information_schema.columns
           where table_schema = current_schema()
             and table_name = 'fx_system_commit'
             and column_name = 'relation_adjacency_change_count')
            as column_default,
          (select is_nullable from information_schema.columns
           where table_schema = current_schema()
             and table_name = 'fx_system_commit'
             and column_name = 'relation_adjacency_change_count')
            as is_nullable,
          (select count(*)::text
           from fx_system_commit_relation_adjacency_change)
            as relation_children,
          (select count(*)::text from drizzle.__drizzle_migrations)
            as receipts
      `);
      expect(upgraded.rows).toEqual([{
        relation_count: "0",
        column_default: "0",
        is_nullable: "NO",
        relation_children: "0",
        receipts: "78",
      }]);
    } finally {
      try {
        await db.close();
      } finally {
        await rm(testRoot, { recursive: true, force: true });
      }
    }
  });

  it("enforces floor, header, child identity, and signed-bigint bounds", async () => {
    const persistence = await createPGlitePersistence();
    await persistence.migrate();
    await insertScope(persistence, SCOPE_A, EPOCH_A, "10");

    for (const statement of [
      `update fx_system_scope_clock set oldest_available_commit_seq = -1
       where scope_uuid = '${SCOPE_A}'::uuid`,
      `update fx_system_scope_clock set oldest_available_commit_seq = 11
       where scope_uuid = '${SCOPE_A}'::uuid`,
      `insert into fx_system_commit
         (scope_uuid, epoch_uuid, commit_seq, change_count)
       values ('${SCOPE_A}', '${EPOCH_A}', 0, 0)`,
      `insert into fx_system_commit
         (scope_uuid, epoch_uuid, commit_seq, change_count)
       values ('${SCOPE_A}', '${EPOCH_A}', 1, -1)`,
      `insert into fx_system_commit
         (scope_uuid, epoch_uuid, commit_seq, change_count)
       values ('${SCOPE_A}', '${EPOCH_A}', 1, 16001)`,
      `insert into fx_system_commit
         (scope_uuid, epoch_uuid, commit_seq, change_count,
          relation_adjacency_change_count)
       values ('${SCOPE_A}', '${EPOCH_A}', 1, 0, -1)`,
      `insert into fx_system_commit
         (scope_uuid, epoch_uuid, commit_seq, change_count,
          relation_adjacency_change_count)
       values ('${SCOPE_A}', '${EPOCH_A}', 1, 0, 8193)`,
      `insert into fx_system_commit
         (scope_uuid, epoch_uuid, commit_seq, change_count, committed_at)
       values ('${SCOPE_A}', '${EPOCH_A}', 1, 0, 'infinity')`,
      `insert into fx_system_commit
         (scope_uuid, epoch_uuid, commit_seq, change_count)
       values ('${SCOPE_A}', '${EPOCH_A}', 9223372036854775808, 0)`,
    ]) {
      await expect(persistence.query(statement)).rejects.toThrow();
    }

    await persistence.query(`
      insert into fx_system_commit
        (scope_uuid, epoch_uuid, commit_seq, change_count,
         relation_adjacency_change_count)
      values ('${SCOPE_A}', '${EPOCH_A}', 1, 1, 1)
    `);
    await insertRevision(persistence, {
      scopeUuid: SCOPE_A,
      epochUuid: EPOCH_A,
      commitSeq: "1",
      rowHex: ROW_A,
    });
    for (const { statement, expected } of [
      {
        statement: `insert into fx_system_commit_app_row_change
         (scope_uuid, epoch_uuid, commit_seq, change_ordinal, table_id, row_id)
       values ('${SCOPE_A}', '${EPOCH_A}', 1, -1, 1,
         decode('${ROW_A}', 'hex'))`,
        expected: /fx_system_commit_app_row_change_ordinal_check/,
      },
      {
        statement: `insert into fx_system_commit_app_row_change
         (scope_uuid, epoch_uuid, commit_seq, change_ordinal, table_id, row_id)
       values ('${SCOPE_A}', '${EPOCH_A}', 1, 16000, 1,
         decode('${ROW_A}', 'hex'))`,
        expected: /fx_system_commit_app_row_change_ordinal_check/,
      },
      {
        statement: `insert into fx_system_commit_app_row_change
         (scope_uuid, epoch_uuid, commit_seq, change_ordinal, table_id, row_id)
       values ('${SCOPE_A}', '${EPOCH_A}', 1, 0, 0,
         decode('${ROW_A}', 'hex'))`,
        expected: /fx_system_commit_app_row_change_table_id_check/,
      },
      {
        statement: `insert into fx_system_commit_app_row_change
         (scope_uuid, epoch_uuid, commit_seq, change_ordinal, table_id, row_id)
       values ('${SCOPE_A}', '${EPOCH_A}', 1, 0, 2147483648,
         decode('${ROW_A}', 'hex'))`,
        expected: /integer out of range/,
      },
      {
        statement: `insert into fx_system_commit_app_row_change
         (scope_uuid, epoch_uuid, commit_seq, change_ordinal, table_id, row_id)
       values ('${SCOPE_A}', '${EPOCH_A}', 1, 0, 1, decode('00', 'hex'))`,
        expected: /fx_system_commit_app_row_change_row_id_length_check/,
      },
    ]) {
      await expect(persistence.query(statement)).rejects.toThrow(expected);
    }

    for (const { statement, expected } of [
      {
        statement: `insert into fx_system_commit_relation_adjacency_change
          (scope_uuid, epoch_uuid, commit_seq, change_ordinal,
           edge_definition_id, direction, endpoint_row_id)
        values ('${SCOPE_A}', '${EPOCH_A}', 1, -1, 1, 'outgoing',
          decode('${ROW_A}', 'hex'))`,
        expected: /fx_system_commit_relation_adjacency_ordinal_check/,
      },
      {
        statement: `insert into fx_system_commit_relation_adjacency_change
          (scope_uuid, epoch_uuid, commit_seq, change_ordinal,
           edge_definition_id, direction, endpoint_row_id)
        values ('${SCOPE_A}', '${EPOCH_A}', 1, 8192, 1, 'outgoing',
          decode('${ROW_A}', 'hex'))`,
        expected: /fx_system_commit_relation_adjacency_ordinal_check/,
      },
      {
        statement: `insert into fx_system_commit_relation_adjacency_change
          (scope_uuid, epoch_uuid, commit_seq, change_ordinal,
           edge_definition_id, direction, endpoint_row_id)
        values ('${SCOPE_A}', '${EPOCH_A}', 1, 0, 0, 'outgoing',
          decode('${ROW_A}', 'hex'))`,
        expected: /fx_system_commit_relation_adjacency_edge_id_check/,
      },
      {
        statement: `insert into fx_system_commit_relation_adjacency_change
          (scope_uuid, epoch_uuid, commit_seq, change_ordinal,
           edge_definition_id, direction, endpoint_row_id)
        values ('${SCOPE_A}', '${EPOCH_A}', 1, 0, 1, 'sideways',
          decode('${ROW_A}', 'hex'))`,
        expected: /fx_system_commit_relation_adjacency_direction_check/,
      },
      {
        statement: `insert into fx_system_commit_relation_adjacency_change
          (scope_uuid, epoch_uuid, commit_seq, change_ordinal,
           edge_definition_id, direction, endpoint_row_id)
        values ('${SCOPE_A}', '${EPOCH_A}', 1, 0, 1, 'outgoing',
          decode('00', 'hex'))`,
        expected: /fx_system_commit_relation_adjacency_row_id_length_check/,
      },
      {
        statement: `insert into fx_system_commit_relation_adjacency_change
          (scope_uuid, epoch_uuid, commit_seq, change_ordinal,
           edge_definition_id, direction, endpoint_row_id)
        values ('${SCOPE_A}', '${EPOCH_B}', 1, 0, 1, 'outgoing',
          decode('${ROW_A}', 'hex'))`,
        expected: /fx_system_commit_relation_adjacency_header_fk/,
      },
    ]) {
      await expect(persistence.query(statement)).rejects.toThrow(expected);
    }
    await persistence.query(`
      insert into fx_system_commit_relation_adjacency_change
        (scope_uuid, epoch_uuid, commit_seq, change_ordinal,
         edge_definition_id, direction, endpoint_row_id)
      values ('${SCOPE_A}', '${EPOCH_A}', 1, 0, 1, 'outgoing',
        decode('${ROW_A}', 'hex'))
    `);
    await expect(persistence.query(`
      insert into fx_system_commit_relation_adjacency_change
        (scope_uuid, epoch_uuid, commit_seq, change_ordinal,
         edge_definition_id, direction, endpoint_row_id)
      values ('${SCOPE_A}', '${EPOCH_A}', 1, 1, 1, 'outgoing',
        decode('${ROW_A}', 'hex'))
    `)).rejects.toThrow(
      /fx_system_commit_relation_adjacency_endpoint_unique/,
    );
    await expect(persistence.query(`
      insert into fx_system_commit_relation_adjacency_change
        (scope_uuid, epoch_uuid, commit_seq, change_ordinal,
         edge_definition_id, direction, endpoint_row_id)
      values ('${SCOPE_A}', '${EPOCH_A}', 1, 0, 1, 'incoming',
        decode('${ROW_B}', 'hex'))
    `)).rejects.toThrow(/fx_system_commit_relation_adjacency_pk/);

    await persistence.query(`
      insert into fx_system_commit
        (scope_uuid, epoch_uuid, commit_seq, change_count,
         relation_adjacency_change_count)
      values ('${SCOPE_A}', '${EPOCH_A}', 9, 0, 1)
    `);
    await persistence.query(`
      insert into fx_system_commit_relation_adjacency_change
        (scope_uuid, epoch_uuid, commit_seq, change_ordinal,
         edge_definition_id, direction, endpoint_row_id)
      values ('${SCOPE_A}', '${EPOCH_A}', 9, 0, 1, 'incoming',
        decode('${ROW_B}', 'hex'))
    `);
    await expect(persistence.query(`
      delete from fx_system_commit
      where scope_uuid = '${SCOPE_A}'::uuid and commit_seq = 9
    `)).rejects.toThrow(/fx_system_commit_relation_adjacency_header_fk/);

    await insertScope(
      persistence,
      SCOPE_B,
      EPOCH_C,
      POSTGRES_SIGNED_BIGINT_MAX,
    );
    await persistence.query(`
      insert into fx_system_commit
        (scope_uuid, epoch_uuid, commit_seq, change_count)
      values
        ('${SCOPE_A}', '${EPOCH_A}', 2, 0),
        ('${SCOPE_B}', '${EPOCH_C}', 2, 0),
        ('${SCOPE_B}', '${EPOCH_C}', ${POSTGRES_SIGNED_BIGINT_MAX}, 0)
    `);
    const exact = await persistence.query<{ commit_seq: string }>(`
      select commit_seq::text
      from fx_system_commit
      where scope_uuid = '${SCOPE_B}'::uuid
      order by commit_seq desc
      limit 1
    `);
    expect(exact.rows).toEqual([{ commit_seq: POSTGRES_SIGNED_BIGINT_MAX }]);
  });

  it("physically binds each change to one header and the same-epoch row revision", async () => {
    const persistence = await createPGlitePersistence();
    await persistence.migrate();
    await insertScope(persistence, SCOPE_A, EPOCH_B, "4");
    await insertRevision(persistence, {
      scopeUuid: SCOPE_A,
      epochUuid: EPOCH_A,
      commitSeq: "1",
      rowHex: ROW_A,
    });
    await insertHeader(persistence, SCOPE_A, EPOCH_A, "1", 1, "2100-01-01");
    await insertChange(persistence, SCOPE_A, EPOCH_A, "1", 0, ROW_A);

    await insertRevision(persistence, {
      scopeUuid: SCOPE_A,
      epochUuid: EPOCH_A,
      commitSeq: "2",
      rowHex: ROW_B,
    });
    await insertHeader(persistence, SCOPE_A, EPOCH_B, "2", 1, "2000-01-01");
    await expect(
      insertChange(persistence, SCOPE_A, EPOCH_B, "2", 0, ROW_B),
    ).rejects.toThrow();
    await expect(
      insertChange(persistence, SCOPE_A, EPOCH_A, "2", 0, ROW_B),
    ).rejects.toThrow();

    await insertRevision(persistence, {
      scopeUuid: SCOPE_A,
      epochUuid: EPOCH_B,
      commitSeq: "3",
      rowHex: ROW_C,
    });
    await insertHeader(persistence, SCOPE_A, EPOCH_B, "3", 1, "1990-01-01");
    await insertChange(persistence, SCOPE_A, EPOCH_B, "3", 0, ROW_C);
    await expect(
      insertChange(persistence, SCOPE_A, EPOCH_B, "3", 0, ROW_A),
    ).rejects.toThrow();
    await expect(
      insertChange(persistence, SCOPE_A, EPOCH_B, "3", 1, ROW_B),
    ).rejects.toThrow();

    for (const statement of [
      `delete from fx_system_commit
       where scope_uuid = '${SCOPE_A}'::uuid and commit_seq = 1`,
      `delete from fx_app_row_rev
       where scope_uuid = '${SCOPE_A}'::uuid and table_id = 1
         and row_id = decode('${ROW_A}', 'hex') and commit_seq = 1`,
      `delete from fx_system_scope_clock where scope_uuid = '${SCOPE_A}'::uuid`,
    ]) {
      await expect(persistence.query(statement)).rejects.toThrow();
    }

    const sequenceOrdered = await persistence.query<{
      commit_seq: string;
      committed_at: Date;
    }>(`
      select commit_seq::text, committed_at
      from fx_system_commit
      where scope_uuid = '${SCOPE_A}'::uuid
      order by commit_seq
    `);
    expect(sequenceOrdered.rows.map(({ commit_seq }) => commit_seq)).toEqual([
      "1",
      "2",
      "3",
    ]);
    expect(sequenceOrdered.rows[0]?.committed_at.getTime())
      .toBeGreaterThan(sequenceOrdered.rows[2]?.committed_at.getTime() ?? 0);
  });
});

async function writeJournalThrough0028(
  currentJournal: string,
  targetJournal: string,
): Promise<void> {
  const parsed = JSON.parse(await readFile(currentJournal, "utf8")) as {
    entries?: Array<{ idx?: number }>;
  };
  if (!Array.isArray(parsed.entries)) {
    throw new Error("Current Drizzle journal is missing its entries array.");
  }
  parsed.entries = parsed.entries.filter(
    (entry) => typeof entry.idx === "number" && entry.idx < 29,
  );
  await writeFile(targetJournal, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
}

async function writeJournalThrough0029(
  currentJournal: string,
  targetJournal: string,
): Promise<void> {
  const parsed = JSON.parse(await readFile(currentJournal, "utf8")) as {
    entries?: Array<{ idx?: number }>;
  };
  if (!Array.isArray(parsed.entries)) {
    throw new Error("Current Drizzle journal is missing its entries array.");
  }
  parsed.entries = parsed.entries.filter(
    (entry) => typeof entry.idx === "number" && entry.idx < 30,
  );
  await writeFile(targetJournal, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
}

async function writeJournalBeforeIndex(
  currentJournal: string,
  targetJournal: string,
  beforeIndex: number,
): Promise<void> {
  const parsed = JSON.parse(await readFile(currentJournal, "utf8")) as {
    entries?: Array<{ idx?: number }>;
  };
  if (!Array.isArray(parsed.entries)) {
    throw new Error("Current Drizzle journal is missing its entries array.");
  }
  parsed.entries = parsed.entries.filter(
    (entry) => typeof entry.idx === "number" && entry.idx < beforeIndex,
  );
  await writeFile(targetJournal, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
}

async function insertScope(
  persistence: SqlPersistence,
  scopeUuid: string,
  epochUuid: string,
  lastCommitSeq: string,
): Promise<void> {
  await persistence.query(
    `
      insert into fx_system_scope_clock
        (scope_id, storage_generation, last_commit_seq, epoch)
      values ($1, 'flarexdb_v1', $2, $3)
    `,
    [`scope_${scopeUuid}`, lastCommitSeq, `epoch_${epochUuid}`],
  );
}

async function insertRevision(
  persistence: SqlPersistence,
  input: {
    readonly scopeUuid: string;
    readonly epochUuid: string;
    readonly commitSeq: string;
    readonly rowHex: string;
  },
): Promise<void> {
  await persistence.query(
    `
      insert into fx_app_row_rev
        (scope_uuid, table_id, row_id, commit_seq, prev_commit_seq,
         write_epoch_uuid, schema_version_id, creation_time,
         value_codec_version, is_tombstone)
      values ($1::uuid, 1, decode($2, 'hex'), $3, null,
        $4::uuid, 'schema_s08_v1', 1, 1, true)
    `,
    [input.scopeUuid, input.rowHex, input.commitSeq, input.epochUuid],
  );
}

async function insertHeader(
  persistence: SqlPersistence,
  scopeUuid: string,
  epochUuid: string,
  commitSeq: string,
  changeCount: number,
  committedAt?: string,
): Promise<void> {
  await persistence.query(
    `
      insert into fx_system_commit
        (scope_uuid, epoch_uuid, commit_seq, change_count, committed_at)
      values ($1::uuid, $2::uuid, $3, $4, coalesce($5::timestamptz, now()))
    `,
    [scopeUuid, epochUuid, commitSeq, changeCount, committedAt ?? null],
  );
}

async function insertChange(
  persistence: SqlPersistence,
  scopeUuid: string,
  epochUuid: string,
  commitSeq: string,
  ordinal: number,
  rowHex: string,
): Promise<void> {
  await persistence.query(
    `
      insert into fx_system_commit_app_row_change
        (scope_uuid, epoch_uuid, commit_seq, change_ordinal, table_id, row_id)
      values ($1::uuid, $2::uuid, $3, $4, 1, decode($5, 'hex'))
    `,
    [scopeUuid, epochUuid, commitSeq, ordinal, rowHex],
  );
}
