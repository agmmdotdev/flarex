import { describe, it, onTestFinished } from "vitest";
import { privatePayloadSaveFixture } from "./support/privatePayloadSaveFixture";
import { privatePayloadReverseRetryScenario } from "./support/privatePayloadReverseRetryScenario";
import { privatePayloadReverseRecoveryScenario } from "./support/privatePayloadReverseRecoveryScenario";
import { PRIVATE_REFERENCE_PAGE } from "../../persistence-postgres/src/execution/journal/privateReverseReadAccess";
import { createMigratedPGlitePersistence } from "../../persistence-postgres/test/support/pgliteTestFixture";
import { createRelationalPGliteFixture } from "../../persistence-postgres/test/database/relationalPGliteWorkerTestSupport";
import { createFileScopedPostgresFixture, postgresUrl } from "../../persistence-postgres/test/support/postgresHelpers";
import { makePostgresRelationalSession } from "../../persistence-postgres/src/database/relationalTransaction/session";

const payloadMethods = ["payload-create", "payload-update", "payload-delete", PRIVATE_REFERENCE_PAGE];
it("replaces stale page roots and preserves frontier, replay and cancellation semantics (PGlite)", async () => {
  const control = await createMigratedPGlitePersistence();
  const database = await createRelationalPGliteFixture({ immutableCatalog: control.drizzle, transport: "finiteCapture", registerCleanup: onTestFinished });
  const fixture = await privatePayloadSaveFixture({ persistence: database.persistence, session: database.session, control, payloadMethods });
  try { await privatePayloadReverseRetryScenario(fixture); await privatePayloadReverseRecoveryScenario(fixture); } finally { await fixture.close(); }
}, 480_000);
describe.skipIf(postgresUrl === null)("RR3 with ordinary-role PostgreSQL", () => {
  it("replaces stale roots and validates private reverse-read recovery semantics", async () => {
    const database = await createFileScopedPostgresFixture({}, {}, "finiteCapture");
    try {
      const fixture = await privatePayloadSaveFixture({ persistence: database.persistence, session: makePostgresRelationalSession(database.persistence), payloadMethods });
      try { await privatePayloadReverseRetryScenario(fixture); await privatePayloadReverseRecoveryScenario(fixture); } finally { await fixture.close(); }
    } finally { await database.dispose(); }
  }, 480_000);
});
