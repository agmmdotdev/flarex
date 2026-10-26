import { createRequire } from "node:module";
import { sql } from "drizzle-orm";
import { BasePayload, buildConfig } from "payload";
import { fixture, newsCollection } from "./fixture.ts";

const require = createRequire(import.meta.url);

/** Actual native adapter/bootstrap, shared by the experiment's comparisons.
 * Installation and administrative grants are outside complete request timers. */
export async function nativePayloadFixture(connectionString, collection = newsCollection()) {
  const nativePg = require("../../../work/native-business-baseline/dependencies/node_modules/pg/lib/index.js");
  const { postgresAdapter } = await import("../../../work/native-business-baseline/dependencies/node_modules/@payloadcms/db-postgres/dist/index.js");
  const database = await fixture(connectionString);
  let serving;
  const closePayload = async instance => {
    const failures = [];
    try { await instance.payload.destroy(); } catch (cause) { failures.push(cause); }
    // Same named bootstrap-checkout disposition as the native baseline. Only
    // after requests drain; acquire/release tracking uses public Pool events.
    for (const pool of instance.pools) {
      for (const client of pool.held) client.release();
      try { await pool.end(); } catch (cause) { failures.push(cause); }
    }
    if (failures.length) throw new AggregateError(failures, "Native Payload close failed");
  };
  const make = async (url, push) => {
    const payload = new BasePayload(); const pools = [];
    class OwnedPool extends nativePg.Pool {
      held = new Set();
      constructor(options) {
        super(options); pools.push(this);
        this.on("acquire", client => this.held.add(client));
        this.on("release", (_error, client) => this.held.delete(client));
      }
    }
    const instance = { payload, pools };
    try {
      await payload.init({ disableOnInit: true, config: await buildConfig({
        secret: "disposable-native-reference-not-a-deployment-secret",
        db: postgresAdapter({ pool: { connectionString: url, max: 2 }, schemaName: "native_payload", idType: "uuid", push,
          disableCreateDatabase: true, pg: { ...nativePg, Pool: OwnedPool } }),
        collections: [collection, { slug: "users", auth: true, lockDocuments: false, fields: [] }],
        admin: { user: "users", disable: true }, globals: [], folders: false, telemetry: false,
        jobs: { tasks: [], workflows: [] }, typescript: { autoGenerate: false },
        email: () => ({ name: "disabled", defaultFromAddress: "disabled@example.invalid", defaultFromName: "Disabled",
          sendEmail: async () => { throw new Error("Email is outside the admitted reference"); } }),
      }) });
      return instance;
    } catch (cause) {
      try { await closePayload(instance); } catch (cleanup) { throw new AggregateError([cause, cleanup], "Native Payload init/cleanup failed", { cause }); }
      throw cause;
    }
  };
  const close = async () => {
    const failures = [];
    if (serving !== undefined) try { await closePayload(serving); } catch (cause) { failures.push(cause); }
    try { await database.close(); } catch (cause) { failures.push(cause); }
    if (failures.length) throw new AggregateError(failures, "Native Payload fixture close failed");
  };
  try {
    const bootstrap = await make(database.ownerUrl, true); await closePayload(bootstrap);
    await database.admin(async db => {
      await db.execute(sql.raw(`grant usage on schema native_payload to ${database.role}`));
      await db.execute(sql.raw(`grant select,insert,update,delete on all tables in schema native_payload to ${database.role}`));
      await db.execute(sql.raw(`grant usage,select on all sequences in schema native_payload to ${database.role}`));
    });
    serving = await make(database.servingUrl, false);
    return { database, ...serving, close };
  } catch (cause) {
    try { await close(); } catch (cleanup) { throw new AggregateError([cause, cleanup], "Native Payload fixture acquisition/cleanup failed", { cause }); }
    throw cause;
  }
}
