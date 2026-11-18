import { describe, it } from "vitest";
import { createPostgresPersistence } from "../../src/database/postgres";
import { postgresUrl, withTemporaryPostgresSchema } from "../support/postgresHelpers";
import { assertMigration117Cutover, withMigration117Folder } from "./migration117CutoverScenario";

describe.skipIf(postgresUrl === null)("mixed attempt journal migration 0117 on ordinary-role PostgreSQL", () => {
  it("refuses open and sealed legacy evidence, then preserves committed results during the empty cutover", async () => {
    await withMigration117Folder((folder, restoreCurrentJournal) => withTemporaryPostgresSchema(async options => {
      const previous = await createPostgresPersistence({ ...options, migrationsFolder: folder });
      try {
        await previous.migrate();
        await restoreCurrentJournal();
        const current = await createPostgresPersistence({ ...options, migrationsFolder: folder });
        try {
          await assertMigration117Cutover(previous, current, options.migrationsSchema);
        } finally {
          await current.close();
        }
      } finally {
        await previous.close();
      }
    }));
  }, 120_000);
});
