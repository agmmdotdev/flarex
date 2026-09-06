import { describe, it } from "vitest";
import { createPostgresPersistence } from "../src/postgres";
import { postgresUrl, withTemporaryPostgresSchema } from "./postgresHelpers";
import { makeDrizzleCopyFixture, writeJournalThrough } from "./migrationFixtureSupport";
import { applicationWritePolicyMigrationScenario } from "./applicationWritePolicyMigrationScenario";

describe.skipIf(postgresUrl === null)("Application write policy upgrade (Postgres)", () => {
  it("preserves bytes, rolls back failed DDL and replays in an isolated schema", async () => {
    const fixture = await makeDrizzleCopyFixture("flarex-policy", "postgres", "0086_application_write_ownership.sql");
    try {
      await writeJournalThrough(fixture.currentJournal, fixture.temporaryJournal, 74);
      await withTemporaryPostgresSchema(async options => {
        const persistence = await createPostgresPersistence({ ...options, migrationsFolder: fixture.migrationsFolder });
        try { await applicationWritePolicyMigrationScenario(persistence, fixture); }
        finally { await persistence.close(); }
      });
    } finally { await fixture.cleanup(); }
  }, 90_000);
});
