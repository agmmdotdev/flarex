import { migratedPGliteDataDir } from "../../support/pgliteTestFixture";
import { newTestPGlite } from "../../support/pgliteSearchExtensions";
import { describe, it } from "vitest";
import { createPGlitePersistence } from "../../../src/database/pglite";
import { createPostgresPersistence } from "../../../src/database/postgres";
import { makeDrizzleCopyFixture } from "../../support/migrationFixtureSupport";
import {
  verifyTerminalSessionMigration,
  verifyTerminalSessionSchema,
} from "./support/terminalStorageScenario";
import {
  postgresUrl,
  withTemporaryPostgresPersistence,
  withTemporaryPostgresSchema,
} from "../../support/postgresHelpers";

describe("terminal session storage", () => {
  it("enforces complete active bodies and absent terminal bodies on PGlite", async () => {
    const db = newTestPGlite({ loadDataDir: await migratedPGliteDataDir() });
    try {
      const persistence = await createPGlitePersistence({ db });
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
    const db = newTestPGlite();
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
