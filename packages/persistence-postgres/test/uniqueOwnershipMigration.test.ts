import { PGlite } from "@electric-sql/pglite";
import { describe, it } from "vitest";
import { createPGlitePersistence } from "../src/pglite";
import { createPostgresPersistence } from "../src/postgres";
import { makeDrizzleCopyFixture } from "./migrationFixtureSupport";
import { verifyUniqueOwnershipMigration } from "./uniqueOwnershipMigrationScenario";
import { postgresUrl, withTemporaryPostgresSchema } from "./postgresHelpers";

describe("stable unique claim storage", () => {
  it("preserves claims and Application rows while replacing build progress across migration rollback/replay on PGlite", async () => {
    const fixture = await makeDrizzleCopyFixture(
      "flarex-unique-ownership",
      "pglite",
      "0097_unique_physical_coverage.sql",
    );
    const db = new PGlite();
    try {
      const persistence = await createPGlitePersistence({
        db,
        migrationsFolder: fixture.migrationsFolder,
      });
      await verifyUniqueOwnershipMigration(persistence, fixture, "drizzle");
    } finally {
      await db.close();
      await fixture.cleanup();
    }
  }, 30_000);
  it.skipIf(postgresUrl === null)(
    "preserves claims and Application rows while replacing build progress across migration rollback/replay on PostgreSQL",
    async () => {
      const fixture = await makeDrizzleCopyFixture(
        "flarex-unique-ownership",
        "postgres",
        "0097_unique_physical_coverage.sql",
      );
      try {
        await withTemporaryPostgresSchema(async (options) => {
          const persistence = await createPostgresPersistence({
            ...options,
            migrationsFolder: fixture.migrationsFolder,
          });
          try {
            await verifyUniqueOwnershipMigration(
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
