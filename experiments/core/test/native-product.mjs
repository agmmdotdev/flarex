import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { fixture } from "./fixture.ts";

/** Existing pinned native bootstrap helpers, restricted to this matched Product
 * workload. No business/DAL algorithm is reproduced by the comparison fixture. */
export async function nativeProductFixture(connectionString) {
  const selector = process.env.MEDUSA_MODULE_TEST_PERSISTENCE;
  if (selector !== undefined && selector !== "postgres") throw new Error(`Native PostgreSQL comparison refuses persistence selector: ${selector}`);
  const require = createRequire(import.meta.url);
  const { Modules, ContainerRegistrationKeys } = require("../../../third_party/medusa/upstream/packages/core/framework/dist/utils/index.js");
  const { mikroOrmModuleTestPersistenceAdapter: adapter } = require("../../../third_party/medusa/upstream/packages/medusa-test-utils/dist/module-test-persistence-adapter.js");
  const { getMikroOrmWrapper } = require("../../../third_party/medusa/upstream/packages/medusa-test-utils/dist/database.js");
  const { initModules } = require("../../../third_party/medusa/upstream/packages/medusa-test-utils/dist/init-modules.js");
  const { default: MockEventBusService } = require("../../../third_party/medusa/upstream/packages/medusa-test-utils/dist/mock-event-bus-service.js");
  const releases = []; let database;
  const close = async () => {
    const failures = [];
    for (const release of releases.splice(0).toReversed()) try { await release(); } catch (cause) { failures.push(cause); }
    if (database !== undefined) try { await database.close(); } catch (cause) { failures.push(cause); }
    if (failures.length !== 0) throw new AggregateError(failures, "Native Product cleanup failed");
  };
  try {
    database = await fixture(connectionString);
    if (database.ownerUrl === undefined || database.servingUrl === undefined) throw new Error("Native Product requires owned PostgreSQL URLs");
    // The pinned native schema generator emits unqualified index targets and
    // its existing business baseline uses public. The database itself is owned
    // and isolated; no active/shared public schema is touched.
    const schema = "public";
    const provisioning = { clientUrl: database.ownerUrl, schema, debug: false };
    const source = fileURLToPath(new URL("../../../third_party/medusa/upstream/packages/modules/product", import.meta.url));
    const bootstrap = adapter.createConnection(provisioning); releases.push(() => adapter.cleanupConnection(bootstrap));
    const models = adapter.prepareDatabase({ connection: bootstrap, resolve: source, dbConfig: provisioning }).models;
    const physical = getMikroOrmWrapper({ mikroOrmEntities: models, clientUrl: database.ownerUrl, schema });
    releases.push(async () => { if (physical.orm !== null) await physical.orm.close(); });
    await physical.setupDatabase();
    await database.admin(async db => {
      await db.execute(sql.raw(`grant usage on schema ${schema} to ${database.role}`));
      await db.execute(sql.raw(`grant select,insert,update,delete on all tables in schema ${schema} to ${database.role}`));
      await db.execute(sql.raw(`grant usage,select on all sequences in schema ${schema} to ${database.role}`));
    });
    const config = { clientUrl: database.servingUrl, schema, debug: false };
    const connection = adapter.createConnection(config); releases.push(() => adapter.cleanupConnection(connection));
    const modules = { [Modules.PRODUCT]: { resolve: source, options: adapter.getModuleOptions(config, {}, connection) } };
    const initialized = await initModules({ databaseConfig: config, modulesConfig: modules,
      injectedDependencies: { ...adapter.getInjectedDependencies(connection), [Modules.EVENT_BUS]: new MockEventBusService(),
        [ContainerRegistrationKeys.LOGGER]: console, [ContainerRegistrationKeys.CONFIG_MODULE]: { modules } },
      preventConnectionDestroyWarning: true, cwd: source });
    releases.push(initialized.shutdown);
    const container = initialized.medusaApp.sharedContainer;
    if (container === undefined) throw new Error("Missing actual native module container");
    return { database, product: container.resolve(Modules.PRODUCT), knex: connection, close };
  } catch (cause) {
    try { await close(); } catch (cleanup) { throw new AggregateError([cause, cleanup], "Native Product acquisition/cleanup failed", { cause }); }
    throw cause;
  }
}
