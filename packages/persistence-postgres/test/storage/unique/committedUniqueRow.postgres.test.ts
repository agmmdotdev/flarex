import { describe, it } from "vitest";
import { createProtectedFileScopedPostgresFixture, postgresUrl } from "../../support/postgresHelpers";
import { committedUniqueRowScenario } from "./committedUniqueRowScenario";

const native = postgresUrl !== null && process.env.FLAREX_POSTGRES_PROVISIONING_DATABASE_URL ? describe : describe.skip;
native("restricted PostgreSQL committed unique slot and separate row acceptance", () => {
  it("authenticates the body-free slot before bounded point decoding", async () => {
    const fixture = await createProtectedFileScopedPostgresFixture("managed");
    try { await committedUniqueRowScenario(fixture.persistence.drizzle); }
    finally { await fixture.dispose(); }
  }, 180_000);
});
