import { describe, it } from "vitest";
import { createPostgresPersistence } from "../../src/database/postgres";
import { postgresUrl, withTemporaryPostgresSchema } from "../support/postgresHelpers";
import { assertMigration118JournalCutover, withMigration118Folder } from "./migration118JournalScenario";

describe.skipIf(postgresUrl === null)("admitted operation journal migration 0118 on ordinary-role PostgreSQL", () => {
  it("refuses old sessions transactionally and installs exact new format checks after disposition", async () => {
    await withMigration118Folder((folder, enableCurrent) => withTemporaryPostgresSchema(async options => {
      const previous = await createPostgresPersistence({ ...options, migrationsFolder: folder });
      try {
        await previous.migrate();
        await enableCurrent();
        const current = await createPostgresPersistence({ ...options, migrationsFolder: folder });
        try {
          await assertMigration118JournalCutover(previous, current, options.migrationsSchema);
        } finally {
          await current.close();
        }
      } finally {
        await previous.close();
      }
    }));
  }, 120_000);
});
