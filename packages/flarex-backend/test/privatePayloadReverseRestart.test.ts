import { describe, it, onTestFinished } from "vitest";
import { PRIVATE_REFERENCE_PAGE } from "../../persistence-postgres/src/execution/journal/privateReverseReadAccess";
import { privatePayloadSaveFixture } from "./support/privatePayloadSaveFixture";
import { privatePayloadBindingRecoveryOwners } from "./support/privatePayloadBindingRecoveryOwners";
import { privatePayloadReverseRestartScenario } from "./support/privatePayloadReverseRestartScenario";
import { privatePayloadBindingCommitLoss } from "./support/privatePayloadBindingCommitLoss";
import { createMigratedPGlitePersistence } from "../../persistence-postgres/test/support/pgliteTestFixture";
import { createRelationalPGliteFixture } from "../../persistence-postgres/test/database/relationalPGliteWorkerTestSupport";
import { createFileScopedPostgresFixture, postgresUrl } from "../../persistence-postgres/test/support/postgresHelpers";
import { createPostgresPersistence, type PostgresFlarexPersistence } from "../../persistence-postgres/src/database/postgres";
import { makePostgresRelationalSession } from "../../persistence-postgres/src/database/relationalTransaction/session";
import { openPreparedHostTestRuntime, closePreparedHostTestRuntime } from "../../persistence-postgres/test/execution/preparation/preparedHostRuntimeTestSupport";
import { registerFrameworkMaintenanceFixture } from "../../persistence-postgres/test/installation/frameworkSchema/frameworkMigrationPostgresFixture";

const payloadMethods = ["payload-create", "payload-update", "payload-delete", PRIVATE_REFERENCE_PAGE];

it("reconstructs committed reverse-read consumption after closing the producer (PGlite)", async () => {
  const control = await createMigratedPGlitePersistence();
  const database = await createRelationalPGliteFixture({ immutableCatalog: control.drizzle,
    transport: "finiteCapture", registerCleanup: onTestFinished });
  const fixture = await privatePayloadSaveFixture({ persistence: database.persistence, session: database.session, control, payloadMethods });
  let closed = false;
  const close = async () => { if (!closed) { closed = true; await fixture.close(); } };
  const reconstruct = (configuration: Parameters<typeof privatePayloadBindingRecoveryOwners>[1]) =>
    privatePayloadBindingRecoveryOwners({ persistence: database.persistence, control }, configuration);
  try { await privatePayloadReverseRestartScenario(fixture, {
    observe: reconstruct, closeProducer: close, reopen: reconstruct }); }
  finally { await close(); }
}, 480_000);

describe.skipIf(postgresUrl === null)("RR3 reverse-read recovery with ordinary-role PostgreSQL", () => {
  it("recovers reverse-read consumption after real COMMIT acknowledgement loss and authority withdrawal", async () => {
    const database = await createFileScopedPostgresFixture({}, {}, "finiteCapture");
    let producer: PostgresFlarexPersistence | undefined;
    let closeProducer: (() => Promise<void>) | undefined;
    const reopened: PostgresFlarexPersistence[] = [];
    try {
      // The schema owner/observer is a separate pool throughout response loss.
      // A new pool after producer shutdown owns each subsequent reconstruction.
      producer = await createPostgresPersistence({ poolConfig: database.persistence.pool.options });
      await openPreparedHostTestRuntime(producer.drizzle);
      const servingDatabase = producer;
      registerFrameworkMaintenanceFixture(servingDatabase, { config: servingDatabase.pool.options,
        schemaName: database.schemaName, journal: { migrationsSchema: database.migrationsSchema, migrationsTable: database.migrationsTable },
        runtimePolicies: [] });
      const fixture = await privatePayloadSaveFixture({ persistence: servingDatabase,
        session: makePostgresRelationalSession(servingDatabase), payloadMethods });
      const control = fixture.fixture.control;
      let closed = false;
      closeProducer = async () => {
        if (closed) return;
        closed = true;
        try { await fixture.close(); }
        finally { try { await closePreparedHostTestRuntime(servingDatabase.drizzle); } finally { await servingDatabase.close(); } }
      };
      await privatePayloadReverseRestartScenario(fixture, { lose: (target, run, afterDurable) =>
        privatePayloadBindingCommitLoss({ producer: servingDatabase, observer: database.persistence,
          scopeId: fixture.fixture.application.authority.scopeId, target, run, afterDurable }),
        observe: configuration => privatePayloadBindingRecoveryOwners({ persistence: database.persistence, control }, configuration),
        closeProducer,
        reopen: async configuration => {
          const persistence = await createPostgresPersistence({ poolConfig: database.persistence.pool.options });
          reopened.push(persistence);
          return privatePayloadBindingRecoveryOwners({ persistence, control }, configuration);
        },
      });
    } finally {
      try {
        for (const persistence of reopened.toReversed()) await persistence.close();
        if (closeProducer !== undefined) await closeProducer();
        else if (producer !== undefined) {
          try { await closePreparedHostTestRuntime(producer.drizzle); } finally { await producer.close(); }
        }
      } finally { await database.dispose(); }
    }
  }, 480_000);
});
