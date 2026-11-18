import { describe, it, onTestFinished } from "vitest";
import { privatePayloadSaveFixture } from "./support/privatePayloadSaveFixture";
import { privatePayloadSaveServingScenario } from "./support/privatePayloadSaveServingScenario";
import { createMigratedPGlitePersistence } from "../../persistence-postgres/test/support/pgliteTestFixture";
import { createRelationalPGliteFixture } from "../../persistence-postgres/test/database/relationalPGliteWorkerTestSupport";
import { createFileScopedPostgresFixture, postgresUrl } from "../../persistence-postgres/test/support/postgresHelpers";
import { makePostgresRelationalSession } from "../../persistence-postgres/src/database/relationalTransaction/session";

it("serves protected private saves through the actual Worker/RPC boundary (PGlite)", async () => {
  const control = await createMigratedPGlitePersistence();
  const database = await createRelationalPGliteFixture({ immutableCatalog: control.drizzle, transport: "finiteCapture", registerCleanup: onTestFinished });
  const fixture = await privatePayloadSaveFixture({ persistence: database.persistence, session: database.session, control });
  try { await privatePayloadSaveServingScenario(fixture); } finally { await fixture.close(); }
}, 300_000);

describe.skipIf(postgresUrl === null)("selected private save serving (ordinary-role PostgreSQL)", () => {
  it("preserves authority, opaque refusal, atomic publication and fresh retry", async () => {
    const database = await createFileScopedPostgresFixture({}, {}, "finiteCapture");
    try {
      const fixture = await privatePayloadSaveFixture({ persistence: database.persistence, session: makePostgresRelationalSession(database.persistence) });
      try { await privatePayloadSaveServingScenario(fixture); } finally { await fixture.close(); }
    } finally { await database.dispose(); }
  }, 300_000);
});
