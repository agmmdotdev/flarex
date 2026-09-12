import { PGlite } from "@electric-sql/pglite";
import { describe, it } from "vitest";
import { createPGlitePersistence } from "../src/pglite";
import { createPostgresPersistence } from "../src/postgres";
import { makeDrizzleCopyFixture } from "./migrationFixtureSupport";
import { verifyTerminalSessionMigration, verifyTerminalSessionSchema } from "./terminalSessionStorageScenario";
import { postgresUrl, withTemporaryPostgresPersistence, withTemporaryPostgresSchema } from "./postgresHelpers";

describe("terminal session storage", () => {
  it("enforces complete active bodies and absent terminal bodies on PGlite", async () => {
    const db = new PGlite();
    try {
      const persistence = await createPGlitePersistence({ db });
      await persistence.migrate();
      await verifyTerminalSessionSchema(persistence);
    } finally {
      await db.close();
    }
  }, 30_000);
  it.skipIf(postgresUrl === null)("enforces complete active bodies and absent terminal bodies on PostgreSQL", async () => {
    await withTemporaryPostgresPersistence(verifyTerminalSessionSchema);
  }, 30_000);
  it("scrubs only terminal bodies and preserves exact identities across migration rollback/replay on PGlite", async () => {
    const fixture = await makeDrizzleCopyFixture("flarex-terminal-payload", "pglite", "0094_terminal-session-payload.sql");
    const db = new PGlite();
    try {
      const persistence = await createPGlitePersistence({ db, migrationsFolder: fixture.migrationsFolder });
      await verifyTerminalSessionMigration(persistence, fixture, "drizzle");
    } finally {
      await db.close();
      await fixture.cleanup();
    }
  }, 30_000);
  it.skipIf(postgresUrl === null)("scrubs only terminal bodies and preserves exact identities across migration rollback/replay on PostgreSQL", async () => {
    const fixture = await makeDrizzleCopyFixture("flarex-terminal-payload", "postgres", "0094_terminal-session-payload.sql");
    try {
      await withTemporaryPostgresSchema(async options => {
        const persistence = await createPostgresPersistence({ ...options, migrationsFolder: fixture.migrationsFolder });
        try {
          await verifyTerminalSessionMigration(persistence, fixture, options.migrationsSchema);
        } finally {
          await persistence.close();
        }
      });
    } finally {
      await fixture.cleanup();
    }
  }, 30_000);
});
