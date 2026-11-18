import { describe, it, onTestFinished } from "vitest";
import { privatePayloadSaveFixture } from "./support/privatePayloadSaveFixture";
import { privatePayloadBindingOrderingScenario, serialPrivateBindingSaveOrder } from "./support/privatePayloadBindingOrderingScenario";
import { postgresPrivateBindingSaveOrder } from "./support/privatePayloadBindingPostgresOrdering";
import { createMigratedPGlitePersistence } from "../../persistence-postgres/test/support/pgliteTestFixture";
import { createRelationalPGliteFixture } from "../../persistence-postgres/test/database/relationalPGliteWorkerTestSupport";
import { createFileScopedPostgresFixture, postgresUrl } from "../../persistence-postgres/test/support/postgresHelpers";
import { makePostgresRelationalSession } from "../../persistence-postgres/src/database/relationalTransaction/session";

it("preserves both serial binding/save outcomes and fresh root retries (PGlite)", async () => {
  const control = await createMigratedPGlitePersistence();
  const database = await createRelationalPGliteFixture({ immutableCatalog: control.drizzle,
    transport: "finiteCapture", registerCleanup: onTestFinished });
  const fixture = await privatePayloadSaveFixture({ persistence: database.persistence, session: database.session, control });
  try { await privatePayloadBindingOrderingScenario(fixture, serialPrivateBindingSaveOrder(fixture)); }
  finally { await fixture.close(); }
}, 480_000);

describe.skipIf(postgresUrl === null)("private binding/save ordering with ordinary-role PostgreSQL", () => {
  it("observes both real lock orders and publishes only accepted fresh work", async () => {
    const database = await createFileScopedPostgresFixture({}, {}, "finiteCapture");
    try {
      const fixture = await privatePayloadSaveFixture({ persistence: database.persistence,
        session: makePostgresRelationalSession(database.persistence) });
      try { await privatePayloadBindingOrderingScenario(fixture, postgresPrivateBindingSaveOrder(database.persistence)); }
      finally { await fixture.close(); }
    } finally { await database.dispose(); }
  }, 480_000);
});
