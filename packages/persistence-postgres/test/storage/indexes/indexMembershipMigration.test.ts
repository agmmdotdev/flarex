import { newTestPGlite } from "../../support/pgliteSearchExtensions";
import { describe, it } from "vitest";
import { createPGlitePersistence } from "../../../src/database/pglite";
import { createPostgresPersistence } from "../../../src/database/postgres";
import { makeDrizzleCopyFixture } from "../../support/migrationFixtureSupport";
import { verifyIndexMembershipMigration } from "./indexMembershipMigrationScenario";
import { postgresUrl, withTemporaryPostgresSchema } from "../../support/postgresHelpers";

describe("membership-only index storage", () => {
  it("preserves index membership and unpins old row bodies across migration rollback/replay on PGlite", async () => {
    const fixture = await makeDrizzleCopyFixture(
      "flarex-index-membership",
      "pglite",
      "0098_index_membership_history.sql",
    );
    const db = newTestPGlite();
    try {
      const persistence = await createPGlitePersistence({
        db,
        migrationsFolder: fixture.migrationsFolder,
      });
      await verifyIndexMembershipMigration(persistence, fixture, "drizzle");
    } finally {
      await db.close();
      await fixture.cleanup();
    }
  }, 30_000);
  it.skipIf(postgresUrl === null)(
    "preserves index membership and unpins old row bodies across migration rollback/replay on PostgreSQL",
    async () => {
      const fixture = await makeDrizzleCopyFixture(
        "flarex-index-membership",
        "postgres",
        "0098_index_membership_history.sql",
      );
      try {
        await withTemporaryPostgresSchema(async (options) => {
          const persistence = await createPostgresPersistence({
            ...options,
            migrationsFolder: fixture.migrationsFolder,
          });
          try {
            await verifyIndexMembershipMigration(
              persistence,
              fixture,
              options.migrationsSchema,
            );
          } finally {
            await persistence.close();
          }
        });
      } finally {
        await fixture.cleanup();
      }
    },
    30_000,
  );
});
