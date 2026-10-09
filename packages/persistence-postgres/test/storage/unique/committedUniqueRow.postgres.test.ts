import { describe, it } from "vitest";
import { createProtectedFileScopedPostgresFixture, postgresUrl } from "../../support/postgresHelpers";
import { committedUniqueRowScenario } from "./committedUniqueRowScenario";

const native = postgresUrl !== null && process.env.FLAREX_POSTGRES_PROVISIONING_DATABASE_URL ? describe : describe.skip;
native("restricted PostgreSQL committed unique owner and row capture", () => {
  it("shares the statement cut and preserves lazy failure order and body limits", async () => {
    const fixture = await createProtectedFileScopedPostgresFixture("managed");
    try { await committedUniqueRowScenario(fixture.persistence.drizzle); }
    finally { await fixture.dispose(); }
  }, 180_000);
});
