import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { Effect, Schema } from "effect";
import { Pool } from "pg";
import type { CorePersistence } from "../../src/core/contracts";
import { loadBootstrapRegistry } from "../../src/core/bootstrap";
import { loadCoreRegistry } from "../../src/core/registry";
import { createCorePersistence } from "../../src/database/corePersistence/persistence";
import { makeCorePGliteDriver, makeCorePostgresDriver, type CoreSqlDriver, type CoreSqlParameter } from "../../src/database/corePersistence/driver";
import { installCorePersistence, loadCorePersistenceTarget } from "../../src/database/corePersistence/target";

export interface CorePersistenceFixture {
  readonly persistence: CorePersistence;
  readonly namespace: string;
  readonly instanceName: string;
  readonly reopen: (instanceName?: string) => Promise<CorePersistence>;
  /** Owned fixture maintenance/observation only; never passed to user code. */
  readonly query: (statement: string, parameters?: readonly CoreSqlParameter[]) => Promise<readonly unknown[]>;
  readonly close: () => Promise<void>;
  /** Trusted test diagnostics only; never supplied to application/framework code. */
  readonly runtimePool?: Pool;
}

/** Test observation through actual metadata owners; never a readiness implementation. */
export const readCoreFixtureRegistry = Effect.fn("CoreFixture.readRegistry")(function* (
  fixture: Pick<CorePersistenceFixture, "persistence">, timestamp: bigint,
) {
  const snapshot = yield* fixture.persistence.readSnapshot(timestamp);
  return yield* loadCoreRegistry(snapshot, yield* loadBootstrapRegistry(fixture.persistence, snapshot));
});
export interface CorePersistenceFixtureOptions {
  readonly instanceName?: string;
  readonly sqlPageSize?: number;
  /** Test-owned transport barrier; installation and observation bypass it. */
  readonly wrapRuntimeDriver?: (driver: CoreSqlDriver) => CoreSqlDriver;
}

function fixtureNamespace(): string {
  return `flarex_core_test_${randomUUID().replaceAll("-", "")}`;
}

export async function createCorePGliteFixture(
  options: CorePersistenceFixtureOptions = {},
): Promise<CorePersistenceFixture> {
  const database = new PGlite();
  const namespace = fixtureNamespace();
  const instanceName = options.instanceName ?? "application";
  const physicalDriver = makeCorePGliteDriver(database);
  try {
    const driver = options.wrapRuntimeDriver?.(physicalDriver) ?? physicalDriver;
    await Effect.runPromise(installCorePersistence(physicalDriver, namespace));
    const target = await Effect.runPromise(loadCorePersistenceTarget(driver, namespace));
    const persistence = await Effect.runPromise(createCorePersistence(target, instanceName, options));
    let closed = false;
    return Object.freeze({ persistence, namespace, instanceName,
      reopen: async (instance = instanceName) => Effect.runPromise(Effect.gen(function* () {
        const loaded = yield* loadCorePersistenceTarget(driver, namespace);
        return yield* createCorePersistence(loaded, instance, options);
      })),
      query: (statement: string, parameters?: readonly CoreSqlParameter[]) => Effect.runPromise(physicalDriver.query(statement, parameters)),
      close: async () => { if (!closed) { closed = true; await database.close(); } },
    });
  } catch (cause) {
    try { await database.close(); } catch (cleanup) { throw new AggregateError([cause, cleanup], "Core PGlite fixture setup and cleanup failed"); }
    throw cause;
  }
}

const servingRoleRows = Schema.Array(Schema.Struct({
  role_name: Schema.String, rolsuper: Schema.Boolean, rolbypassrls: Schema.Boolean,
  rolcreatedb: Schema.Boolean, rolcreaterole: Schema.Boolean,
}));

export interface CorePostgresFixtureOptions extends CorePersistenceFixtureOptions {
  readonly connectionString: string;
  readonly provisioningConnectionString: string;
}

/** Fresh owned installation, separate ordinary runtime and maintenance pools. */
export async function createCorePostgresFixture(options: CorePostgresFixtureOptions): Promise<CorePersistenceFixture> {
  const namespace = fixtureNamespace();
  const instanceName = options.instanceName ?? "application";
  const maintenance = new Pool({ connectionString: options.provisioningConnectionString, max: 2 });
  const runtime = new Pool({ connectionString: options.connectionString, max: 4, statement_timeout: 30_000 });
  const maintenanceDriver = makeCorePostgresDriver(maintenance);
  const physicalRuntimeDriver = makeCorePostgresDriver(runtime);
  let installed = false;
  try {
    const runtimeDriver = options.wrapRuntimeDriver?.(physicalRuntimeDriver) ?? physicalRuntimeDriver;
    const rows = await Effect.runPromise(runtimeDriver.query(`SELECT current_user AS role_name,
      rolsuper, rolbypassrls, rolcreatedb, rolcreaterole FROM pg_roles WHERE rolname = current_user`));
    const [role] = Schema.decodeUnknownSync(servingRoleRows)(rows);
    if (role === undefined || role.rolsuper || role.rolbypassrls || role.rolcreatedb || role.rolcreaterole) {
      throw new Error("Core PostgreSQL fixture requires an ordinary serving role");
    }
    await Effect.runPromise(installCorePersistence(maintenanceDriver, namespace));
    installed = true;
    const quotedRole = `"${role.role_name.replaceAll('"', '""')}"`;
    await maintenance.query(`GRANT USAGE ON SCHEMA "${namespace}" TO ${quotedRole}`);
    await maintenance.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA "${namespace}" TO ${quotedRole}`);
    const target = await Effect.runPromise(loadCorePersistenceTarget(runtimeDriver, namespace));
    const persistence = await Effect.runPromise(createCorePersistence(target, instanceName, options));
    let closed = false;
    return Object.freeze({ persistence, namespace, instanceName, runtimePool: runtime,
      reopen: async (instance = instanceName) => Effect.runPromise(Effect.gen(function* () {
        const loaded = yield* loadCorePersistenceTarget(runtimeDriver, namespace);
        return yield* createCorePersistence(loaded, instance, options);
      })),
      query: (statement: string, parameters?: readonly CoreSqlParameter[]) =>
        Effect.runPromise(maintenanceDriver.query(statement, parameters)),
      close: async () => {
        if (closed) return;
        closed = true;
        const failures: unknown[] = [];
        try { await runtime.end(); } catch (cause) { failures.push(cause); }
        // namespace was generated and created by this exact fixture. No caller
        // path or arbitrary namespace can reach this owned administrative drop.
        try { await maintenance.query(`DROP SCHEMA "${namespace}" CASCADE`); } catch (cause) { failures.push(cause); }
        try { await maintenance.end(); } catch (cause) { failures.push(cause); }
        if (failures.length > 0) throw new AggregateError(failures, "Core PostgreSQL fixture cleanup failed");
      },
    });
  } catch (cause) {
    const failures: unknown[] = [cause];
    try { await runtime.end(); } catch (cleanup) { failures.push(cleanup); }
    if (installed) {
      try { await maintenance.query(`DROP SCHEMA "${namespace}" CASCADE`); } catch (cleanup) { failures.push(cleanup); }
    }
    try { await maintenance.end(); } catch (cleanup) { failures.push(cleanup); }
    throw failures.length === 1 ? cause : new AggregateError(failures, "Core PostgreSQL fixture setup and cleanup failed");
  }
}
