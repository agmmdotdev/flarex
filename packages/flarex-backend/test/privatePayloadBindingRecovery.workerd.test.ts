import { describe, it, onTestFinished } from "vitest";
import { privatePayloadSaveFixture } from "./support/privatePayloadSaveFixture";
import { privatePayloadBindingRecoveryOwners } from "./support/privatePayloadBindingRecoveryOwners";
import { privatePayloadBindingRecoveryScenario } from "./support/privatePayloadBindingRecoveryScenario";
import { privatePayloadBindingCommitLoss } from "./support/privatePayloadBindingCommitLoss";
import { createMigratedPGlitePersistence } from "../../persistence-postgres/test/support/pgliteTestFixture";
import { createRelationalPGliteFixture } from "../../persistence-postgres/test/database/relationalPGliteWorkerTestSupport";
import { createFileScopedPostgresFixture, postgresUrl } from "../../persistence-postgres/test/support/postgresHelpers";
import { createPostgresPersistence, type PostgresFlarexPersistence } from "../../persistence-postgres/src/database/postgres";
import { makePostgresRelationalSession } from "../../persistence-postgres/src/database/relationalTransaction/session";
import { openPreparedHostTestRuntime, closePreparedHostTestRuntime } from "../../persistence-postgres/test/execution/preparation/preparedHostRuntimeTestSupport";
import { registerFrameworkMaintenanceFixture } from "../../persistence-postgres/test/installation/frameworkSchema/frameworkMigrationPostgresFixture";

it("reconstructs binding and committed-save recovery owners after closing the writer generation (PGlite)", async () => {
  const control = await createMigratedPGlitePersistence();
  const database = await createRelationalPGliteFixture({ immutableCatalog: control.drizzle,
    transport: "finiteCapture", registerCleanup: onTestFinished });
  const fixture = await privatePayloadSaveFixture({ persistence: database.persistence, session: database.session, control });
  let closed = false;
  const close = async () => { if (!closed) { closed = true; await fixture.close(); } };
  const reconstruct = (configuration: Parameters<typeof privatePayloadBindingRecoveryOwners>[1]) =>
    privatePayloadBindingRecoveryOwners({ persistence: database.persistence, control }, configuration);
  try { await privatePayloadBindingRecoveryScenario(fixture, { mode: { kind: "reconstruction" },
    observe: reconstruct, closeProducer: close, reopen: reconstruct }); }
  finally { await close(); }
}, 480_000);

describe.skipIf(postgresUrl === null)("private binding recovery with ordinary-role PostgreSQL", () => {
  it.each(["activation", "save"] as const)("recovers real %s COMMIT acknowledgement loss after authority withdrawal and host reconstruction", async kind => {
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
        session: makePostgresRelationalSession(servingDatabase) });
      const control = fixture.fixture.control;
      let closed = false;
      closeProducer = async () => {
        if (closed) return;
        closed = true;
        try { await fixture.close(); }
        finally { try { await closePreparedHostTestRuntime(servingDatabase.drizzle); } finally { await servingDatabase.close(); } }
      };
      await privatePayloadBindingRecoveryScenario(fixture, { mode: { kind, lose: (target, run, afterDurable) =>
        privatePayloadBindingCommitLoss({ producer: servingDatabase, observer: database.persistence,
          scopeId: fixture.fixture.application.authority.scopeId, target, run, afterDurable }) },
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
