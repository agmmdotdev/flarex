import { describe, expect, it } from "vitest";
import { Pool } from "pg";
import { verifyLogicalSearchBuildBatch } from "./logicalSearchBuildBatchScenario";
import { postgresUrl } from "../../support/postgresHelpers";

const describePostgres = postgresUrl === null ? describe.skip : describe;

describePostgres("PostgreSQL search readiness batching", () => {
  it("checks fresh physical identity and coverage with one query per batched category", async () => {
    const { withTemporaryPostgresPersistence } = await import("../../support/postgresHelpers");
    await withTemporaryPostgresPersistence(async persistence => {
      await verifyLogicalSearchBuildBatch(persistence, persistence.drizzle, persistence);
    });
  }, 180_000);

  it.runIf(Boolean(process.env.FLAREX_POSTGRES_PROVISIONING_DATABASE_URL))(
    "retains selected readiness and physical refusal under a separate nonowner runtime login", async () => {
      const { createProtectedFileScopedPostgresFixture } = await import("../../support/postgresHelpers");
      const fixture = await createProtectedFileScopedPostgresFixture();
      if (postgresUrl === null) throw new Error("PostgreSQL URL missing in enabled lane");
      const owner = new Pool({ connectionString: postgresUrl, options: `-c search_path=${fixture.schemaName}` });
      try {
        const login = await fixture.persistence.query<{ current_user: string; rolsuper: boolean }>(
          "select current_user, rolsuper from pg_roles where rolname = current_user");
        expect(login.rows[0]?.current_user).toMatch(/^flarex_runtime_/);
        expect(login.rows[0]?.rolsuper).toBe(false);
        await verifyLogicalSearchBuildBatch({ query: <Row extends Record<string, unknown>>(statement: string,
          parameters?: readonly unknown[]) => owner.query<Row>(statement, parameters === undefined ? undefined : [...parameters]) }, fixture.persistence.drizzle, fixture.persistence);
      } finally {
        await owner.end();
        await fixture.dispose();
      }
    }, 180_000);
});
