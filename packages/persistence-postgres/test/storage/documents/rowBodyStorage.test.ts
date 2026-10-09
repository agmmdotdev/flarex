import { newTestPGlite } from "../../support/pgliteSearchExtensions";
import { describe, it } from "vitest";
import { createPGlitePersistence } from "../../../src/database/pglite";
import { createPostgresPersistence } from "../../../src/database/postgres";
import { makeDrizzleCopyFixture } from "../../support/migrationFixtureSupport";
import { verifyRowBodyMigration } from "./rowBodyMigrationScenario";
import { postgresUrl, withTemporaryPostgresSchema } from "../../support/postgresHelpers";

describe("canonical Application row body storage", () => {
  it("preserves exact history, tombstones, identities and canonical values across migration rollback/replay on PGlite", async () => {
    const fixture = await makeDrizzleCopyFixture(
      "flarex-row-body",
      "pglite",
      "0095_app-row-body.sql",
    );
    const db = newTestPGlite();
    try {
      const persistence = await createPGlitePersistence({
        db,
        migrationsFolder: fixture.migrationsFolder,
      });
      await verifyRowBodyMigration(persistence, fixture, "drizzle");
    } finally {
      await db.close();
      await fixture.cleanup();
    }
  }, 30_000);
  it.skipIf(postgresUrl === null)(
    "preserves exact history, tombstones, identities and canonical values across migration rollback/replay on PostgreSQL",
    async () => {
      const fixture = await makeDrizzleCopyFixture(
        "flarex-row-body",
        "postgres",
        "0095_app-row-body.sql",
      );
      try {
        await withTemporaryPostgresSchema(async (options) => {
          const persistence = await createPostgresPersistence({
            ...options,
            migrationsFolder: fixture.migrationsFolder,
          });
          try {
            await verifyRowBodyMigration(
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
