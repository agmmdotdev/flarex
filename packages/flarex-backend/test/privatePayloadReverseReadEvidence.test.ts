import { describe, it, onTestFinished } from "vitest";
import { privatePayloadSaveFixture } from "./support/privatePayloadSaveFixture";
import { privatePayloadReverseReadScenario } from "./support/privatePayloadReverseReadScenario";
import { PRIVATE_REFERENCE_MEMBERSHIP_PROBE } from "../../persistence-postgres/src/execution/journal/privateReverseReadAccess";
import { createMigratedPGlitePersistence } from "../../persistence-postgres/test/support/pgliteTestFixture";
import { createRelationalPGliteFixture } from "../../persistence-postgres/test/database/relationalPGliteWorkerTestSupport";
import { createFileScopedPostgresFixture, postgresUrl } from "../../persistence-postgres/test/support/postgresHelpers";
import { makePostgresRelationalSession } from "../../persistence-postgres/src/database/relationalTransaction/session";

const payloadMethods = ["payload-create", "payload-update", "payload-delete", PRIVATE_REFERENCE_MEMBERSHIP_PROBE];
it("issues protected reverse-read evidence and captures indexed membership in the real finite root (PGlite)", async () => {
  const control = await createMigratedPGlitePersistence();
  const database = await createRelationalPGliteFixture({ immutableCatalog: control.drizzle,
    transport: "finiteCapture", registerCleanup: onTestFinished });
  const fixture = await privatePayloadSaveFixture({ persistence: database.persistence, session: database.session, control, payloadMethods });
  try { await privatePayloadReverseReadScenario(fixture); } finally { await fixture.close(); }
}, 480_000);
describe.skipIf(postgresUrl === null)("RR1 with ordinary-role PostgreSQL", () => {
  it("protects read policy and carries empty/nonempty reference evidence to final validation", async () => {
    const database = await createFileScopedPostgresFixture({}, {}, "finiteCapture");
    try {
      const fixture = await privatePayloadSaveFixture({ persistence: database.persistence,
        session: makePostgresRelationalSession(database.persistence), payloadMethods });
      try { await privatePayloadReverseReadScenario(fixture); } finally { await fixture.close(); }
    } finally { await database.dispose(); }
  }, 480_000);
});
