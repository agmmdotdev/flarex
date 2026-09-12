import { PGlite } from "@electric-sql/pglite";
import { describe, it } from "vitest";
import { createPGlitePersistence } from "../src/pglite";
import { createPostgresPersistence } from "../src/postgres";
import { makeDrizzleCopyFixture } from "./migrationFixtureSupport";
import { verifyJournalEvidenceMigration } from "./journalEvidenceMigrationScenario";
import { postgresUrl, withTemporaryPostgresSchema } from "./postgresHelpers";

describe("journal evidence migration", () => {
  it("preserves all journal states and canonical bytes across failure and replay on PGlite", async () => {
    const fixture = await makeDrizzleCopyFixture("flarex-journal-evidence", "pglite", "0093_journal-evidence.sql");
    const db = new PGlite();
    try {
      const persistence = await createPGlitePersistence({ db, migrationsFolder: fixture.migrationsFolder });
      await verifyJournalEvidenceMigration(persistence, fixture, "drizzle");
    } finally {
      await db.close();
      await fixture.cleanup();
    }
  });
  it.skipIf(postgresUrl === null)("preserves all journal states and canonical bytes across failure and replay on PostgreSQL", async () => {
    const fixture = await makeDrizzleCopyFixture("flarex-journal-evidence", "postgres", "0093_journal-evidence.sql");
    try {
      await withTemporaryPostgresSchema(async (options) => {
        const persistence = await createPostgresPersistence({ ...options, migrationsFolder: fixture.migrationsFolder });
        try {
          await verifyJournalEvidenceMigration(persistence, fixture, options.migrationsSchema);
        } finally {
          await persistence.close();
        }
      });
    } finally {
      await fixture.cleanup();
    }
  });
});
