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
  postgresUrl,
  withTemporaryPostgresPersistence,
  withTemporaryPostgresSchema,
} from "./postgresHelpers";

const SCOPE_A = "83000000-0000-0000-0000-000000000001";
const EPOCH_A = "83000000-0000-0000-0000-000000000002";
const EPOCH_B = "83000000-0000-0000-0000-000000000003";
const ROW_A = "83000000000000000000000000000004";
const ROW_B = "83000000000000000000000000000005";
const SCOPE_B = "84000000-0000-0000-0000-000000000001";
const EPOCH_C = "84000000-0000-0000-0000-000000000002";
const POSTGRES_SIGNED_BIGINT_MAX = "9223372036854775807";

const describePostgres = postgresUrl === null ? describe.skip : describe;
type SqlPersistence = Pick<FlarexPersistence, "query">;

describePostgres("real Postgres S08 commit/change-feed schema", () => {
  it("rolls back, upgrades from 0028, and replays in a non-public schema", async () => {
    const testRoot = await mkdtemp(resolve(tmpdir(), "flarex-s08-postgres-"));
    const migrationsFolder = resolve(testRoot, "drizzle");
    const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
    const currentMigrationsFolder = resolve(packageRoot, "drizzle");
    const currentJournal = resolve(currentMigrationsFolder, "meta/_journal.json");
    const temporaryJournal = resolve(migrationsFolder, "meta/_journal.json");
    const migrationName = "0029_mysterious_namora.sql";
    const copiedMigration = resolve(migrationsFolder, migrationName);

    try {
      await cp(currentMigrationsFolder, migrationsFolder, { recursive: true });
      await writeJournalThrough0028(currentJournal, temporaryJournal);

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
          await insertScope(previous, SCOPE_A, EPOCH_A, "7");
          await previous.query(`
            insert into commits (deployment_id, ts, source, write_summary)
            values ('legacy-deployment', 11, 'legacy-source', '{"writes":1}'::jsonb)
          `);
          const schema = await previous.query<{ schema_name: string }>(
            `select current_schema() as schema_name`,
          );
          expect(schema.rows[0]?.schema_name).not.toBe("public");
          await expect(
            previous.query(
              `select oldest_available_commit_seq from fx_system_scope_clock`,
            ),
          ).rejects.toThrow();

          await writeJournalThrough0029(currentJournal, temporaryJournal);
          const realMigration = await readFile(copiedMigration, "utf8");
          await writeFile(
            copiedMigration,
            `${realMigration}\n--> statement-breakpoint\nselect * from fx_s08_deliberate_missing_table;\n`,
            "utf8",
          );
          current = await createPostgresPersistence({
            ...databaseOptions,
            migrationsFolder,
          });
          await expect(current.migrate()).rejects.toThrow();

          const rolledBack = await current.query<{
            feed_tables: number;
            floor_columns: number;
            receipts: number;
          }>(`
            select
              (select count(*)::int
               from information_schema.tables
               where table_schema = current_schema()
                 and table_name like 'fx_system_commit%') as feed_tables,
              (select count(*)::int
               from information_schema.columns
               where table_schema = current_schema()
                 and table_name = 'fx_system_scope_clock'
                 and column_name = 'oldest_available_commit_seq') as floor_columns,
              (select count(*)::int
               from ${quoteIdentifier(databaseOptions.migrationsSchema)}.__drizzle_migrations) as receipts
          `);
          expect(rolledBack.rows).toEqual([
            { feed_tables: 0, floor_columns: 0, receipts: 29 },
          ]);

          await writeFile(
            copiedMigration,
            await readFile(
              resolve(currentMigrationsFolder, migrationName),
              "utf8",
            ),
            "utf8",
          );
          await expect(current.migrate()).resolves.toBeUndefined();
          await expect(current.migrate()).resolves.toBeUndefined();

          const upgraded = await current.query<{
            feed_tables: number;
            floor: string;
            last_commit_seq: string;
            legacy_commits: number;
            receipts: number;
          }>(`
            select
              oldest_available_commit_seq::text as floor,
              last_commit_seq::text as last_commit_seq,
              (select count(*)::int from commits) as legacy_commits,
              (select count(*)::int
               from information_schema.tables
               where table_schema = current_schema()
                 and table_name like 'fx_system_commit%') as feed_tables,
              (select count(*)::int
               from ${quoteIdentifier(databaseOptions.migrationsSchema)}.__drizzle_migrations) as receipts
            from fx_system_scope_clock
            where scope_uuid = '${SCOPE_A}'::uuid
          `);
          expect(upgraded.rows).toEqual([
            {
              feed_tables: 2,
              floor: "0",
              last_commit_seq: "7",
              legacy_commits: 1,
              receipts: 30,
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

  it("enforces exact header/revision provenance and uses bounded feed indexes", async () => {
    await withTemporaryPostgresPersistence(async (persistence) => {
      await insertScope(persistence, SCOPE_A, EPOCH_B, "10");
      await insertScope(
        persistence,
        SCOPE_B,
        EPOCH_C,
        POSTGRES_SIGNED_BIGINT_MAX,
      );

      // A historical write epoch remains valid feed provenance after the scope
      // authority has moved to a different current epoch.
      await insertRevision(persistence, SCOPE_A, EPOCH_A, "1", ROW_A);
      await insertHeader(persistence, SCOPE_A, EPOCH_A, "1", 1);
      await insertChange(persistence, SCOPE_A, EPOCH_A, "1", 0, ROW_A);

      await expect(
        insertChange(persistence, SCOPE_A, EPOCH_A, "1", 1, ROW_A),
      ).rejects.toThrow();
      await expect(
        insertChange(persistence, SCOPE_A, EPOCH_A, "2", 0, ROW_B),
      ).rejects.toThrow();

      await insertRevision(persistence, SCOPE_A, EPOCH_A, "2", ROW_B);
      await insertHeader(persistence, SCOPE_A, EPOCH_B, "2", 1);
      await expect(
        insertChange(persistence, SCOPE_A, EPOCH_B, "2", 0, ROW_B),
      ).rejects.toThrow();
      await expect(
        insertChange(persistence, SCOPE_A, EPOCH_A, "2", 0, ROW_B),
      ).rejects.toThrow();

      await insertRevision(persistence, SCOPE_B, EPOCH_C, "3", ROW_B);
      await insertHeader(persistence, SCOPE_A, EPOCH_A, "3", 1);
      await expect(
        insertChange(persistence, SCOPE_A, EPOCH_A, "3", 0, ROW_B),
      ).rejects.toThrow();

      await insertHeader(persistence, SCOPE_A, EPOCH_A, "4", 0);
      await insertHeader(
        persistence,
        SCOPE_B,
        EPOCH_C,
        POSTGRES_SIGNED_BIGINT_MAX,
        0,
      );
      const maximum = await persistence.query<{ commit_seq: string }>(`
        select commit_seq::text
        from fx_system_commit
        where scope_uuid = '${SCOPE_B}'::uuid
        order by commit_seq desc
        limit 1
      `);
      expect(maximum.rows).toEqual([
        { commit_seq: POSTGRES_SIGNED_BIGINT_MAX },
      ]);
      await expect(
        insertHeader(
          persistence,
          SCOPE_B,
          EPOCH_C,
          "9223372036854775808",
          0,
        ),
      ).rejects.toThrow();

      for (const statement of [
        `delete from fx_system_commit
         where scope_uuid = '${SCOPE_A}'::uuid and commit_seq = 1`,
        `delete from fx_app_row_rev
         where scope_uuid = '${SCOPE_A}'::uuid and table_id = 1
           and row_id = decode('${ROW_A}', 'hex') and commit_seq = 1`,
        `delete from fx_system_scope_clock
         where scope_uuid = '${SCOPE_A}'::uuid`,
      ]) {
        await expect(persistence.query(statement)).rejects.toThrow();
      }

      const plans = await feedLookupPlans(persistence);
      expect(plans.headers).toContain(
        "fx_system_commit_scope_uuid_commit_seq_pk",
      );
      expect(plans.children).toContain(
        // PostgreSQL truncates identifiers to 63 bytes in the physical catalog.
        "fx_system_commit_app_row_change_scope_uuid_commit_seq_change_or",
      );

      const provenanceConstraint = await persistence.query<{
        definition: string;
      }>(`
        select pg_get_constraintdef(constraint_row.oid) as definition
        from pg_constraint constraint_row
        join pg_class relation on relation.oid = constraint_row.conrelid
        join pg_namespace namespace on namespace.oid = relation.relnamespace
        where namespace.nspname = current_schema()
          and relation.relname = 'fx_app_row_rev'
          and constraint_row.conname = 'fx_app_row_rev_change_provenance_unique'
      `);
      expect(provenanceConstraint.rows[0]?.definition).toContain(
        "write_epoch_uuid",
      );
    });
  }, 30_000);
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
  scopeUuid: string,
  epochUuid: string,
  commitSeq: string,
  rowHex: string,
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
    [scopeUuid, rowHex, commitSeq, epochUuid],
  );
}

async function insertHeader(
  persistence: SqlPersistence,
  scopeUuid: string,
  epochUuid: string,
  commitSeq: string,
  changeCount: number,
): Promise<void> {
  await persistence.query(
    `
      insert into fx_system_commit
        (scope_uuid, epoch_uuid, commit_seq, change_count)
      values ($1::uuid, $2::uuid, $3, $4)
    `,
    [scopeUuid, epochUuid, commitSeq, changeCount],
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

async function feedLookupPlans(
  persistence: PostgresFlarexPersistence,
): Promise<{ readonly children: string; readonly headers: string }> {
  const client = await persistence.pool.connect();
  try {
    await client.query(`set enable_seqscan = off`);
    const headers = await client.query<{ "QUERY PLAN": string }>(
      `
        explain (costs off)
        select epoch_uuid, commit_seq, change_count, committed_at
        from fx_system_commit
        where scope_uuid = $1::uuid and commit_seq > $2
        order by commit_seq
        limit 101
      `,
      [SCOPE_A, "0"],
    );
    const children = await client.query<{ "QUERY PLAN": string }>(
      `
        explain (costs off)
        select epoch_uuid, commit_seq, change_ordinal, table_id, row_id
        from fx_system_commit_app_row_change
        where scope_uuid = $1::uuid
          and commit_seq between $2 and $3
        order by commit_seq, change_ordinal
      `,
      [SCOPE_A, "1", "4"],
    );
    return {
      headers: headers.rows.map((row) => row["QUERY PLAN"]).join("\n"),
      children: children.rows.map((row) => row["QUERY PLAN"]).join("\n"),
    };
  } finally {
    client.release();
  }
}

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}
