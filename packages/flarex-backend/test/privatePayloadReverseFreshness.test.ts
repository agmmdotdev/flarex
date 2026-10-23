import { describe, it, onTestFinished } from "vitest";
import { privatePayloadSaveFixture } from "./support/privatePayloadSaveFixture";
import { privatePayloadReverseFreshnessScenario, serialPrivateReverseReadOrder } from "./support/privatePayloadReverseFreshnessScenario";
import { postgresPrivateReverseReadOrder } from "./support/privatePayloadBindingPostgresOrdering";
import { PRIVATE_REFERENCE_PAGE } from "../../persistence-postgres/src/execution/journal/privateReverseReadAccess";
import { createMigratedPGlitePersistence } from "../../persistence-postgres/test/support/pgliteTestFixture";
import { createRelationalPGliteFixture } from "../../persistence-postgres/test/database/relationalPGliteWorkerTestSupport";
import { createFileScopedPostgresFixture, postgresUrl } from "../../persistence-postgres/test/support/postgresHelpers";
import { makePostgresRelationalSession } from "../../persistence-postgres/src/database/relationalTransaction/session";

const payloadMethods = ["payload-create", "payload-update", "payload-delete", PRIVATE_REFERENCE_PAGE];
it("validates both serial freshness orders for private native pages consumed by Application writes (PGlite)", async () => {
  const control = await createMigratedPGlitePersistence();
  const database = await createRelationalPGliteFixture({ immutableCatalog: control.drizzle, transport: "finiteCapture", registerCleanup: onTestFinished });
  const fixture = await privatePayloadSaveFixture({ persistence: database.persistence, session: database.session, control, payloadMethods });
  try { await privatePayloadReverseFreshnessScenario(fixture, serialPrivateReverseReadOrder); } finally { await fixture.close(); }
}, 480_000);

describe.skipIf(postgresUrl === null)("RR3 ordinary-role PostgreSQL publication ordering", () => {
  it("observes both lock orders for policy, membership, source, target and binding changes", async () => {
    const database = await createFileScopedPostgresFixture({}, {}, "finiteCapture");
    try {
      const fixture = await privatePayloadSaveFixture({ persistence: database.persistence, session: makePostgresRelationalSession(database.persistence), payloadMethods });
      try { await privatePayloadReverseFreshnessScenario(fixture, postgresPrivateReverseReadOrder(database.persistence)); } finally { await fixture.close(); }
    } finally { await database.dispose(); }
  }, 480_000);
});
