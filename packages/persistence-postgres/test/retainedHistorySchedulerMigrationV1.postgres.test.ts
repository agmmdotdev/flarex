import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isNonArrayRecord } from "@flarex/utils/records";
import { describe, expect, it } from "vitest";

import { createPostgresPersistence } from "../src/postgres";
import { postgresUrl, withTemporaryPostgresSchema } from "./postgresHelpers";

const describePostgres = postgresUrl === null ? describe.skip : describe;

describePostgres("real PostgreSQL O11-F1 retained-history migration", () => {
  it("upgrades atomically, rolls back a failed install, and rejects invalid singleton rows", async () => {
    const testRoot = await mkdtemp(resolve(tmpdir(), "flarex-o11-f1-pg-migration-"));
    const migrationsFolder = resolve(testRoot, "drizzle");
    const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
    const currentMigrationsFolder = resolve(packageRoot, "drizzle");
    const currentJournalPath = resolve(
      currentMigrationsFolder,
      "meta/_journal.json",
    );
    const copiedJournalPath = resolve(migrationsFolder, "meta/_journal.json");
    const copiedMigrationPath = resolve(
      migrationsFolder,
      "0065_omniscient_prism.sql",
    );
    try {
      await cp(currentMigrationsFolder, migrationsFolder, { recursive: true });
      const journalText = await readFile(currentJournalPath, "utf8");
      const previousJournal = migrationJournalBefore(journalText, 65);
      const migrationText = await readFile(copiedMigrationPath, "utf8");
      await writeFile(copiedJournalPath, previousJournal, "utf8");

      await withTemporaryPostgresSchema(async (databaseOptions) => {
        const persistence = await createPostgresPersistence({
          ...databaseOptions,
          migrationsFolder,
        });
        try {
          await persistence.migrate();
          await persistence.query(`
            update fx_system_point_mutation_redelivery_scheduler
            set run_fence = 7
          `);
          expect(await inventory(
            persistence,
            databaseOptions.migrationsSchema,
          )).toEqual({ tableCount: 0, rowCount: 0, pointFence: "7", receipts: 65 });

          await writeFile(copiedJournalPath, journalText, "utf8");
          await writeFile(
            copiedMigrationPath,
            `${migrationText}\n--> statement-breakpoint\nselect * from fx_o11_f1_deliberate_missing_table;\n`,
            "utf8",
          );
          await expect(persistence.migrate()).rejects.toThrow(
            /fx_o11_f1_deliberate_missing_table/,
          );
          expect(await inventory(
            persistence,
            databaseOptions.migrationsSchema,
          )).toEqual({ tableCount: 0, rowCount: 0, pointFence: "7", receipts: 65 });

          await writeFile(copiedMigrationPath, migrationText, "utf8");
          await persistence.migrate();
          await persistence.migrate();
          expect(await inventory(
            persistence,
            databaseOptions.migrationsSchema,
          )).toEqual({ tableCount: 1, rowCount: 1, pointFence: "7", receipts: 66 });
          await expect(persistence.query(`
            insert into fx_system_retained_history_scheduler
              (scheduler_key, scheduler_state, run_fence, checkpoint_sequence)
            values ('wrong_key', 'idle', 0, 0)
          `)).rejects.toThrow();
          expect(await inventory(
            persistence,
            databaseOptions.migrationsSchema,
          )).toEqual({ tableCount: 1, rowCount: 1, pointFence: "7", receipts: 66 });
        } finally {
          await persistence.close();
        }
      });
    } finally {
      await rm(testRoot, { recursive: true, force: true });
    }
  }, 180_000);
});

function migrationJournalBefore(
  journalText: string,
  exclusiveIndex: number,
): string {
  const parsed: unknown = JSON.parse(journalText);
  if (!isNonArrayRecord(parsed) || !Array.isArray(parsed.entries)) {
    throw new Error("Current Drizzle journal is missing its entries array.");
  }
  return `${JSON.stringify({
    ...parsed,
    entries: parsed.entries.filter((entry) =>
      isNonArrayRecord(entry) &&
      typeof entry.idx === "number" &&
      entry.idx < exclusiveIndex
    ),
  }, null, 2)}\n`;
}

async function inventory(
  persistence: Awaited<ReturnType<typeof createPostgresPersistence>>,
  migrationsSchema: string,
) {
  const quotedSchema = `"${migrationsSchema.replaceAll('"', '""')}"`;
  const result = await persistence.query<{
    table_count: number;
    point_fence: string;
    receipts: number;
  }>(`
    select
      (select count(*)::int from information_schema.tables
        where table_schema = current_schema()
          and table_name = 'fx_system_retained_history_scheduler')
        as table_count,
      (select run_fence::text
        from fx_system_point_mutation_redelivery_scheduler) as point_fence,
      (select count(*)::int
        from ${quotedSchema}.__drizzle_migrations) as receipts
  `);
  const row = result.rows[0];
  const rowCount = row?.table_count === 1
    ? (await persistence.query<{ count: number }>(`
      select count(*)::int as count
      from fx_system_retained_history_scheduler
    `)).rows[0]?.count
    : 0;
  return {
    tableCount: row?.table_count,
    rowCount,
    pointFence: row?.point_fence,
    receipts: row?.receipts,
  };
}
