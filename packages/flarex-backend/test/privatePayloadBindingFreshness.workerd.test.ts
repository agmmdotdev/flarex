import { describe, it, onTestFinished } from "vitest";
import { privatePayloadSaveFixture } from "./support/privatePayloadSaveFixture";
import { privatePayloadBindingFreshnessScenario } from "./support/privatePayloadBindingFreshnessScenario";
import { createMigratedPGlitePersistence } from "../../persistence-postgres/test/support/pgliteTestFixture";
import { createRelationalPGliteFixture } from "../../persistence-postgres/test/database/relationalPGliteWorkerTestSupport";
import { createFileScopedPostgresFixture, postgresUrl } from "../../persistence-postgres/test/support/postgresHelpers";
import { makePostgresRelationalSession } from "../../persistence-postgres/src/database/relationalTransaction/session";

it("enforces fresh entry and stale private save capabilities through Worker/RPC (PGlite)", async () => {
  const control = await createMigratedPGlitePersistence();
  const database = await createRelationalPGliteFixture({ immutableCatalog: control.drizzle,
    transport: "finiteCapture", registerCleanup: onTestFinished });
  const fixture = await privatePayloadSaveFixture({ persistence: database.persistence, session: database.session, control });
  try { await privatePayloadBindingFreshnessScenario(fixture); } finally { await fixture.close(); }
}, 480_000);

describe.skipIf(postgresUrl === null)("private binding freshness with ordinary-role PostgreSQL", () => {
  it("uses genuine entry, snapshot evidence and final publication acceptance", async () => {
    const database = await createFileScopedPostgresFixture({}, {}, "finiteCapture");
    try {
      const fixture = await privatePayloadSaveFixture({ persistence: database.persistence,
        session: makePostgresRelationalSession(database.persistence) });
      try { await privatePayloadBindingFreshnessScenario(fixture); } finally { await fixture.close(); }
    } finally { await database.dispose(); }
  }, 480_000);
});
