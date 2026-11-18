import { describe, it, onTestFinished } from "vitest";
import { privatePayloadSaveFixture } from "./support/privatePayloadSaveFixture";
import { privatePayloadSaveRecoveryScenario } from "./support/privatePayloadSaveRecoveryScenario";
import { privatePayloadSaveRetryScenario } from "./support/privatePayloadSaveRetryScenario";
import { createMigratedPGlitePersistence } from "../../persistence-postgres/test/support/pgliteTestFixture";
import { createRelationalPGliteFixture } from "../../persistence-postgres/test/database/relationalPGliteWorkerTestSupport";
import { createFileScopedPostgresFixture, postgresUrl } from "../../persistence-postgres/test/support/postgresHelpers";
import { makePostgresRelationalSession } from "../../persistence-postgres/src/database/relationalTransaction/session";

it("keeps permission dependencies through replay and drains cancelled private saves (PGlite)", async () => {
  const control = await createMigratedPGlitePersistence();
  const database = await createRelationalPGliteFixture({ immutableCatalog: control.drizzle, transport: "finiteCapture", registerCleanup: onTestFinished });
  const fixture = await privatePayloadSaveFixture({ persistence: database.persistence, session: database.session, control });
  try { await privatePayloadSaveRecoveryScenario(fixture); await privatePayloadSaveRetryScenario(fixture); } finally { await fixture.close(); }
}, 240_000);

describe.skipIf(postgresUrl === null)("private save receipt and cancellation proof (ordinary-role PostgreSQL)", () => {
  it("refuses changed-grant replay, stale publication and cancelled work", async () => {
    const database = await createFileScopedPostgresFixture({}, {}, "finiteCapture");
    try {
      const fixture = await privatePayloadSaveFixture({ persistence: database.persistence, session: makePostgresRelationalSession(database.persistence) });
      try { await privatePayloadSaveRecoveryScenario(fixture); await privatePayloadSaveRetryScenario(fixture); } finally { await fixture.close(); }
    } finally { await database.dispose(); }
  }, 240_000);
});
