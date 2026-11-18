import { describe } from "vitest";
import { createPostgresPersistence } from "../../src/database/postgres";
import { postgresUrl, withTemporaryPostgresSchema } from "../support/postgresHelpers";
import { registerVerdictOwnershipMigrationTests } from "./declarativeV2VerdictOwnershipMigrationScenario";

const describePostgres = postgresUrl === null ? describe.skip : describe;
describePostgres("Declarative V2 verdict ownership migration - PostgreSQL", () => {
  registerVerdictOwnershipMigrationTests(async (migrationsFolder, run) => {
    await withTemporaryPostgresSchema(async options => {
      const persistence = await createPostgresPersistence({ ...options, migrationsFolder });
      try { await run(persistence, options.migrationsSchema); } finally { await persistence.close(); }
    });
  });
});
