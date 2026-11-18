import { createHash } from "node:crypto";
import { Pool } from "pg";
import { Effect } from "effect";
import { FetchHttpClient } from "effect/unstable/http";
import { inject } from "vitest";
import { createPostgresPersistence, type PostgresFlarexPersistence } from "../../src/database/postgres";
import { openPreparedHostTestRuntime, closePreparedHostTestRuntime } from "../execution/preparation/preparedHostRuntimeTestSupport";
import type { FileScopedPersistenceFixture } from "./fileScopedPersistenceFixture";
import { persistenceFixtureSourceKey } from "./persistenceFixtureFingerprint";
import { createPostgresStorageReset, supportsPostgresStorageStatisticsReset } from "./postgresStorageReset";
import { decodeStorageRequest, type PostgresStorageSessionEndpoint } from "./postgresStorageProtocol";
import { postgresStorageRequest } from "./postgresStorageClient";

export interface PostgresStorageFixture extends FileScopedPersistenceFixture<PostgresFlarexPersistence> {
  readonly schemaName: string;
  readonly migrationsSchema: string;
}

export const postgresStorageFixtureKey = () => persistenceFixtureSourceKey("postgres-storage", [
  "test/support/postgresStorageFixture.ts", "test/support/postgresStorageReset.ts",
  "test/support/postgresStorageSession.ts", "test/support/postgresStorageSessionOwner.ts",
  "test/support/postgresStorageLeasePool.ts", "test/support/postgresStorageProtocol.ts",
  "test/support/postgresStorageClient.ts",
  "test/support/fileScopedPersistenceFixture.ts", "test/support/storageTestHarness.ts",
  "test/execution/preparation/preparedHostRuntimeTestSupport.ts",
]);

/** Promise bridge for the private loopback Vitest resource protocol. A failed
 * response is visible; uncertain requests are never automatically replayed. */
function request(endpoint: PostgresStorageSessionEndpoint, command: ReturnType<typeof decodeStorageRequest>) {
  return Effect.runPromise(postgresStorageRequest(endpoint, command).pipe(
    Effect.timeout("30 seconds"), Effect.provide(FetchHttpClient.layer),
  ));
}

/** The runner retains only a clean schema. Each file and each successful reset
 * constructs a fresh driver pool/runtime, so GUCs, temp objects, statements,
 * advisory locks and database-keyed in-process caches cannot cross test cases. */
export async function createPostgresStorageFixture(
  endpoint = inject("postgresStorageSession"),
): Promise<PostgresStorageFixture> {
  const connectionString = process.env.FLAREX_POSTGRES_DATABASE_URL?.trim();
  if (endpoint === undefined || connectionString === undefined || connectionString.length === 0) {
    throw new Error("Postgres storage tests require the runner-owned storage global setup and PostgreSQL URL");
  }
  if (createHash("sha256").update(connectionString).digest("hex") !== endpoint.connectionKey) {
    throw new Error("Postgres storage endpoint changed during the runner session");
  }
  const key = await postgresStorageFixtureKey();
  const admin = new Pool({ connectionString, max: 1 });
  let supported: boolean;
  try { supported = await supportsPostgresStorageStatisticsReset(admin); }
  catch (cause: unknown) {
    try { await admin.end(); }
    catch (cleanup: unknown) { throw new AggregateError([cause, cleanup], "Statistics capability check and cleanup failed"); }
    throw cause;
  }
  if (!supported) {
    await admin.end();
    return (await import("./postgresHelpers")).createFileScopedPostgresFixture();
  }
  let acquired;
  try { acquired = await request(endpoint, { operation: "acquire", key }); }
  catch (cause: unknown) {
    try { await admin.end(); }
    catch (cleanup: unknown) { throw new AggregateError([cause, cleanup], "Schema acquisition and cleanup failed"); }
    throw cause;
  }
  const lease = acquired.lease;
  if (lease === undefined) { await admin.end(); throw new Error("Storage session returned no schema lease"); }
  let persistence: PostgresFlarexPersistence | undefined;
  let seal: string | null = null;
  let healthy = true;
  let disposal: Promise<void> | undefined;
  const open = async () => {
    const current = await createPostgresPersistence({ connectionString, migrationsSchema: lease.migrationsSchema,
      poolConfig: { options: `-c search_path=${lease.schemaName}`, application_name: lease.schemaName } });
    persistence = current;
    await openPreparedHostTestRuntime(current.drizzle);
    return current;
  };
  const closeDriver = async (failures: unknown[]) => {
    const current = persistence;
    persistence = undefined;
    if (current === undefined) return;
    try { await closePreparedHostTestRuntime(current.drizzle); } catch (cause: unknown) { failures.push(cause); }
    try { await current.close(); } catch (cause: unknown) { failures.push(cause); }
  };
  const release = async (failures: unknown[]) => {
    await closeDriver(failures);
    try { await admin.end(); } catch (cause: unknown) { failures.push(cause); }
    try { await request(endpoint, { operation: "release", leaseId: lease.leaseId,
      healthy: healthy && failures.length === 0, seal }); }
    catch (cause: unknown) { failures.push(cause); }
  };
  try {
    const initial = await open();
    if (lease.fresh) {
      await initial.migrate();
      if (await postgresStorageFixtureKey() !== key) throw new Error("Postgres storage bootstrap inputs changed while migrating");
    }
    const rows = await createPostgresStorageReset(admin, lease.schemaName, lease.migrationsSchema, lease.seal);
    seal = rows.seal;
    return {
      schemaName: lease.schemaName,
      migrationsSchema: lease.migrationsSchema,
      get persistence() {
        if (persistence === undefined) throw new Error("Postgres storage fixture is closed");
        return persistence;
      },
      async reset() {
        if (disposal !== undefined || persistence === undefined) throw new Error("Postgres storage fixture is closed");
        try {
          const pool = persistence.pool;
          if (pool.waitingCount !== 0 || pool.idleCount !== pool.totalCount) throw new Error("Postgres storage test left a checked-out or waiting pool client");
          const failures: unknown[] = [];
          await closeDriver(failures);
          if (failures.length > 0) throw new AggregateError(failures, "Postgres storage driver cleanup failed");
          await rows.reset();
          await open();
        } catch (cause: unknown) { healthy = false; throw cause; }
      },
      invalidate() { healthy = false; },
      dispose() {
        disposal ??= (async () => {
          const failures: unknown[] = [];
          await closeDriver(failures);
          if (healthy && failures.length === 0) {
            try { await rows.verify(); }
            catch (cause: unknown) { healthy = false; failures.push(cause); }
          }
          await release(failures);
          if (failures.length > 0) throw new AggregateError(failures, "Postgres storage fixture disposal failed");
        })();
        return disposal;
      },
    };
  } catch (cause: unknown) {
    healthy = false;
    const failures: unknown[] = [cause];
    await release(failures);
    if (failures.length > 1) throw new AggregateError(failures, "Postgres storage fixture acquisition and cleanup failed");
    throw cause;
  }
}
