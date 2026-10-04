import { migrate } from "drizzle-orm/node-postgres/migrator";
import { describe, it } from "vitest";
import { createPostgresPersistence } from "../src/postgres";
import { finiteExecutionAuthorityMigrationScenario } from "./finiteExecutionAuthorityMigrationScenario";
import { makeDrizzleCopyFixture } from "./migrationFixtureSupport";
import { postgresUrl, withTemporaryPostgresSchema } from "./postgresHelpers";

describe.skipIf(postgresUrl === null)("finite execution authority forward migration (Postgres)", () => {
  it("refuses undrained finite roots and preserves legacy and direct owners", async () => {
    const fixture = await makeDrizzleCopyFixture("flarex-finite-authority", "postgres", "0126_finite_execution_authority.sql");
    try {
      await withTemporaryPostgresSchema(async options => {
        const persistence = await createPostgresPersistence({ ...options, migrationsFolder: fixture.migrationsFolder });
        try {
          await finiteExecutionAuthorityMigrationScenario(persistence, fixture,
            () => migrate(persistence.drizzle, { migrationsFolder: fixture.migrationsFolder,
              migrationsSchema: options.migrationsSchema }));
        } finally { await persistence.close(); }
      });
    } finally { await fixture.cleanup(); }
  }, 120_000);
});
