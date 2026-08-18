import { describe, expect, it } from "vitest";

import { createPostgresPersistence } from "../src/postgres";
import {
  makePhysicalDefinitionRetirementMigrationFixture,
  retirementMigrationInventory,
  retirementMigrationWasRolledBack,
  seedApplicationTaskRunBeforeRetirementMigration,
  writePhysicalDefinitionRetirementJournalThrough,
} from "./physicalDefinitionRetirementMigrationSupport";
import { postgresUrl, withTemporaryPostgresSchema } from "./postgresHelpers";

const describePostgres = postgresUrl === null ? describe.skip : describe;

describePostgres(
  "M05-B3 physical-definition retirement migration - PostgreSQL",
  { timeout: 480_000 },
  () => {
    it("backfills populated Application tasks and refuses malformed authority atomically", async () => {
      const fixture = await makePhysicalDefinitionRetirementMigrationFixture(
        "postgres",
      );
      try {
        await withTemporaryPostgresSchema(async databaseOptions => {
          await writePhysicalDefinitionRetirementJournalThrough(
            fixture.currentJournal,
            fixture.temporaryJournal,
            67,
          );
          const persistence = await createPostgresPersistence({
            ...databaseOptions,
            migrationsFolder: fixture.migrationsFolder,
          });
          try {
            await persistence.migrate();
            await seedApplicationTaskRunBeforeRetirementMigration(
              persistence,
              "apprev_m05_b3_postgres",
            );
            await writePhysicalDefinitionRetirementJournalThrough(
              fixture.currentJournal,
              fixture.temporaryJournal,
              68,
            );
            await expect(persistence.migrate()).resolves.toBeUndefined();
            await expect(persistence.migrate()).resolves.toBeUndefined();
            expect(await retirementMigrationInventory(
              persistence,
              databaseOptions.migrationsSchema,
            )).toEqual({
              application_revision_id: "apprev_m05_b3_postgres",
              column_count: 1,
              foreign_key_count: 1,
              index_count: 4,
              receipts: 69,
            });
            await expect(persistence.query(
              `update fx_system_durable_task_run_v1
                  set application_revision_id = 'apprev_missing_m05_b3'`,
            )).rejects.toThrow();
            expect((await retirementMigrationInventory(
              persistence,
              databaseOptions.migrationsSchema,
            )).application_revision_id).toBe("apprev_m05_b3_postgres");
            const schema = await persistence.query<{ name: string }>(
              "select current_schema() as name",
            );
            expect(schema.rows[0]?.name).not.toBe("public");
          } finally {
            await persistence.close();
          }
        });

        await withTemporaryPostgresSchema(async databaseOptions => {
          await writePhysicalDefinitionRetirementJournalThrough(
            fixture.currentJournal,
            fixture.temporaryJournal,
            67,
          );
          const persistence = await createPostgresPersistence({
            ...databaseOptions,
            migrationsFolder: fixture.migrationsFolder,
          });
          try {
            await persistence.migrate();
            await seedApplicationTaskRunBeforeRetirementMigration(
              persistence,
              null,
            );
            await writePhysicalDefinitionRetirementJournalThrough(
              fixture.currentJournal,
              fixture.temporaryJournal,
              68,
            );
            await expect(persistence.migrate()).rejects.toThrow();
            expect(await retirementMigrationWasRolledBack(
              persistence,
              databaseOptions.migrationsSchema,
            )).toEqual({ column_count: 0, receipts: 68, row_count: 1 });
          } finally {
            await persistence.close();
          }
        });
      } finally {
        await fixture.cleanup();
      }
    });
  },
);
