import { readFile, writeFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { makeDrizzleCopyFixture, writeJournalThrough } from "../../support/migrationFixtureSupport";

import { createPostgresPersistence } from "../../../src/database/postgres";
import { postgresUrl, withTemporaryPostgresSchema } from "../../support/postgresHelpers";

const describePostgres = postgresUrl === null ? describe.skip : describe;

describePostgres("real PostgreSQL O11-F1 retained-history migration", () => {
  it("upgrades atomically, rolls back a failed install, and rejects invalid singleton rows", async () => {
    const fixture = await makeDrizzleCopyFixture("flarex-o11-f1-pg", "migration", "0065_omniscient_prism.sql");
    const { migrationsFolder, currentJournal: currentJournalPath, temporaryJournal: copiedJournalPath, migrationPath: copiedMigrationPath } = fixture;
    try {
      const migrationText = await readFile(copiedMigrationPath, "utf8");
      await writeJournalThrough(currentJournalPath, copiedJournalPath, 64);

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

          await writeJournalThrough(currentJournalPath, copiedJournalPath, 65);
          await writeFile(
            copiedMigrationPath,
            `${migrationText}\n--> statement-breakpoint\nselect * from fx_o11_f1_deliberate_missing_table;\n`,
            "utf8",
          );
          await expect(persistence.migrate()).rejects.toMatchObject({
            _tag: "InstallationLifecycleError",
            reason: "resourceFailure",
            cause: { cause: {
              code: "42P01",
              message: expect.stringContaining("fx_o11_f1_deliberate_missing_table"),
            } },
          });
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
      await fixture.cleanup();
    }
  }, 180_000);
});

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
