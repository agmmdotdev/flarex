import { setTimeout as delay } from "node:timers/promises";

import { Client, Pool, type PoolClient, type PoolConfig } from "pg";
import { trimToNonBlankOrNull } from "@flarex/utils/strings";
import { afterAll, beforeAll } from "vitest";

import {
  createPostgresClientPersistence,
  type PostgresClientFlarexPersistence,
} from "../src/postgresClient";
import {
  createPostgresPersistence,
  type PostgresFlarexPersistence,
} from "../src/postgres";
import {
  withHistoricalApplicationAnalysisMigrations,
} from "../src/systemTestHistoricalApplicationAnalysisMigrations";

export const postgresUrl = trimToNonBlankOrNull(
  process.env.FLAREX_POSTGRES_DATABASE_URL,
);

export interface HeldPostgresDeploymentLock {
  readonly client: PoolClient;
  readonly blockerPid: number;
}

export interface TemporaryPostgresSchemaOptions {
  readonly connectionString: string;
  readonly migrationsSchema: string;
  readonly poolConfig: PoolConfig;
}

export type WithFileScopedPostgresPersistence = (
  fn: (persistence: PostgresFlarexPersistence) => Promise<void>,
) => Promise<void>;

export async function acquirePostgresDeploymentLock(
  persistence: PostgresFlarexPersistence,
  deploymentId: string,
): Promise<HeldPostgresDeploymentLock> {
  const client = await persistence.pool.connect();
  try {
    await client.query("begin");
    await client.query(
      `
        select 1
        from deployments
        where deployment_id = $1
        for update
      `,
      [deploymentId],
    );
    const pidResult = await client.query<{ pid: number }>(
      `select pg_backend_pid()::int as pid`,
    );
    const blockerPid = pidResult.rows[0]?.pid;
    if (typeof blockerPid !== "number" || !Number.isInteger(blockerPid)) {
      throw new Error("Postgres deployment lock returned no backend PID.");
    }
    return { client, blockerPid };
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    client.release();
    throw error;
  }
}

export async function waitForBlockedPostgresDeploymentLocks(
  persistence: PostgresFlarexPersistence,
  lock: HeldPostgresDeploymentLock,
  expectedBlocked: number,
): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const result = await persistence.query<{ blocked: number }>(
      `
        with recursive blocked(pid) as (
          select activity.pid
          from pg_stat_activity as activity
          where $1::int = any(pg_blocking_pids(activity.pid))

          union

          select activity.pid
          from pg_stat_activity as activity
          join blocked as blocker
            on blocker.pid = any(pg_blocking_pids(activity.pid))
        )
        select count(*)::int as blocked
        from blocked
        join pg_stat_activity as activity using (pid)
        where activity.datname = current_database()
          and activity.wait_event_type = 'Lock'
          and activity.query ilike '%deployments%'
          and activity.query ilike '%for update%'
      `,
      [lock.blockerPid],
    );
    if ((result.rows[0]?.blocked ?? 0) >= expectedBlocked) return;
    await delay(25);
  }
  throw new Error(
    `Timed out waiting for ${expectedBlocked} deployment locks blocked by backend ${lock.blockerPid}.`,
  );
}

export async function withPostgresSequentialScansDisabled<Value>(
  persistence: PostgresFlarexPersistence,
  run: (client: PoolClient) => Promise<Value>,
): Promise<Value> {
  const client = await persistence.pool.connect();
  let primaryError: unknown;
  try {
    await client.query("begin");
    await client.query("set local enable_seqscan = off");
    return await run(client);
  } catch (error: unknown) {
    primaryError = error;
    throw error;
  } finally {
    let destroyClient = false;
    try {
      await client.query("rollback");
    } catch (rollbackError: unknown) {
      destroyClient = true;
      if (primaryError === undefined) throw rollbackError;
    } finally {
      client.release(destroyClient);
    }
  }
}

export async function rollbackAndReleasePostgresClient(
  client: PoolClient,
): Promise<void> {
  let destroyClient = false;
  try {
    await client.query("rollback");
  } catch {
    destroyClient = true;
  } finally {
    client.release(destroyClient);
  }
}

export async function withTemporaryPostgresPersistence(
  fn: (persistence: PostgresFlarexPersistence) => Promise<void>,
  options: Readonly<{
    readonly historicalApplicationAnalysis?: boolean;
  }> = {},
): Promise<void> {
  const connectionString = requiredPostgresUrl();
  const schemaName = temporaryIdentifier("flarex_test");
  const migrationsSchema = temporaryIdentifier("flarex_migrations");
  const adminPool = new Pool({ connectionString });
  let persistence: PostgresFlarexPersistence | undefined;
  let primaryError: unknown;

  try {
    await adminPool.query(`create schema ${quoteIdentifier(schemaName)}`);
    await adminPool.query(`create schema ${quoteIdentifier(migrationsSchema)}`);
    const create = async (migrationsFolder?: string) => {
      const current = await createPostgresPersistence({
        connectionString,
        migrationsSchema,
        ...(migrationsFolder === undefined ? {} : { migrationsFolder }),
        poolConfig: {
          options: `-c search_path=${schemaName}`,
        },
      });
      await current.migrate();
      return current;
    };
    persistence = options.historicalApplicationAnalysis === true
      ? await withHistoricalApplicationAnalysisMigrations(create)
      : await create();
    await fn(persistence);
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    const cleanupErrors: unknown[] = [];
    const persistenceToClose = persistence;
    if (persistenceToClose !== undefined) {
      await recordCleanupError(cleanupErrors, () => persistenceToClose.close());
    }
    await recordCleanupError(cleanupErrors, () =>
      adminPool.query(
        `drop schema if exists ${quoteIdentifier(schemaName)} cascade`,
      ),
    );
    await recordCleanupError(cleanupErrors, () =>
      adminPool.query(
        `drop schema if exists ${quoteIdentifier(migrationsSchema)} cascade`,
      ),
    );
    await recordCleanupError(cleanupErrors, () => adminPool.end());
    if (primaryError === undefined && cleanupErrors.length > 0) {
      throw new Error(
        `Failed to clean up temporary Postgres schemas: ${cleanupErrors
          .map(errorMessage)
          .join("; ")}`,
      );
    }
  }
}

/**
 * Reuses one migrated schema for the tests in a Vitest file. Successful tests
 * reset all application tables with TRUNCATE; a failed test marks the fixture
 * for a full schema rebuild before the next test so failures cannot poison the
 * rest of the file.
 */
export function useFileScopedPostgresPersistence(): WithFileScopedPostgresPersistence {
  let fixture: FileScopedPostgresFixture | undefined;
  let rebuildRequired = false;

  beforeAll(async () => {
    if (postgresUrl === null) return;
    fixture = await createFileScopedPostgresFixture();
  }, 120_000);

  afterAll(async () => {
    const fixtureToDispose = fixture;
    fixture = undefined;
    if (fixtureToDispose !== undefined) await fixtureToDispose.dispose();
  }, 120_000);

  return async (fn) => {
    if (fixture === undefined || rebuildRequired) {
      const staleFixture = fixture;
      fixture = undefined;
      rebuildRequired = false;
      if (staleFixture !== undefined) await staleFixture.dispose();
      fixture = await createFileScopedPostgresFixture();
    }

    const activeFixture = fixture;
    try {
      await fn(activeFixture.persistence);
    } catch (error: unknown) {
      rebuildRequired = true;
      throw error;
    }

    try {
      await activeFixture.reset();
    } catch (error: unknown) {
      rebuildRequired = true;
      throw error;
    }
  };
}

export async function withTemporaryPostgresSchema(
  fn: (options: TemporaryPostgresSchemaOptions) => Promise<void>,
): Promise<void> {
  const connectionString = requiredPostgresUrl();
  const schemaName = temporaryIdentifier("flarex_migration_test");
  const migrationsSchema = temporaryIdentifier(
    "flarex_migration_receipts",
  );
  const adminPool = new Pool({ connectionString });
  let primaryError: unknown;

  try {
    await adminPool.query(`create schema ${quoteIdentifier(schemaName)}`);
    await adminPool.query(
      `create schema ${quoteIdentifier(migrationsSchema)}`,
    );
    await fn({
      connectionString,
      migrationsSchema,
      poolConfig: { options: `-c search_path=${schemaName}` },
    });
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    const cleanupErrors: unknown[] = [];
    await recordCleanupError(cleanupErrors, () =>
      adminPool.query(
        `drop schema if exists ${quoteIdentifier(schemaName)} cascade`,
      ),
    );
    await recordCleanupError(cleanupErrors, () =>
      adminPool.query(
        `drop schema if exists ${quoteIdentifier(migrationsSchema)} cascade`,
      ),
    );
    await recordCleanupError(cleanupErrors, () => adminPool.end());
    if (primaryError === undefined && cleanupErrors.length > 0) {
      throw new Error(
        `Failed to clean up temporary Postgres migration schemas: ${cleanupErrors
          .map(errorMessage)
          .join("; ")}`,
      );
    }
  }
}

export async function withTemporaryPostgresClientPersistence(
  fn: (
    persistence: PostgresClientFlarexPersistence,
    client: Client,
  ) => Promise<void>,
): Promise<void> {
  const connectionString = requiredPostgresUrl();
  const schemaName = temporaryIdentifier("flarex_client_test");
  const migrationsSchema = temporaryIdentifier("flarex_client_migrations");
  const adminPool = new Pool({ connectionString });
  let migrationPersistence: PostgresFlarexPersistence | undefined;
  let client: Client | undefined;
  let primaryError: unknown;

  try {
    await adminPool.query(`create schema ${quoteIdentifier(schemaName)}`);
    await adminPool.query(`create schema ${quoteIdentifier(migrationsSchema)}`);
    migrationPersistence = await createPostgresPersistence({
      connectionString,
      migrationsSchema,
      poolConfig: { options: `-c search_path=${schemaName}` },
    });
    await migrationPersistence.migrate();
    await migrationPersistence.close();
    migrationPersistence = undefined;

    client = new Client({
      connectionString,
      options: `-c search_path=${schemaName}`,
    });
    await client.connect();
    await fn(createPostgresClientPersistence(client), client);
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    const cleanupErrors: unknown[] = [];
    const clientToClose = client;
    if (clientToClose !== undefined) {
      await recordCleanupError(cleanupErrors, () => clientToClose.end());
    }
    const migrationPersistenceToClose = migrationPersistence;
    if (migrationPersistenceToClose !== undefined) {
      await recordCleanupError(
        cleanupErrors,
        () => migrationPersistenceToClose.close(),
      );
    }
    await recordCleanupError(cleanupErrors, () =>
      adminPool.query(
        `drop schema if exists ${quoteIdentifier(schemaName)} cascade`,
      ),
    );
    await recordCleanupError(cleanupErrors, () =>
      adminPool.query(
        `drop schema if exists ${quoteIdentifier(migrationsSchema)} cascade`,
      ),
    );
    await recordCleanupError(cleanupErrors, () => adminPool.end());
    if (primaryError === undefined && cleanupErrors.length > 0) {
      throw new Error(
        `Failed to clean up temporary Postgres client schemas: ${cleanupErrors
          .map(errorMessage)
          .join("; ")}`,
      );
    }
  }
}

export async function withTemporaryPostgresPersistencePair(
  fn: (
    control: PostgresFlarexPersistence,
    target: PostgresFlarexPersistence,
  ) => Promise<void>,
): Promise<void> {
  const connectionString = requiredPostgresUrl();
  const controlSchema = temporaryIdentifier("flarex_control_test");
  const controlMigrationsSchema = temporaryIdentifier(
    "flarex_control_migrations",
  );
  const targetSchema = temporaryIdentifier("flarex_target_test");
  const targetMigrationsSchema = temporaryIdentifier(
    "flarex_target_migrations",
  );
  const schemaNames = [
    controlSchema,
    controlMigrationsSchema,
    targetSchema,
    targetMigrationsSchema,
  ] as const;
  const adminPool = new Pool({ connectionString });
  let control: PostgresFlarexPersistence | undefined;
  let target: PostgresFlarexPersistence | undefined;
  let primaryError: unknown;

  try {
    for (const schemaName of schemaNames) {
      await adminPool.query(`create schema ${quoteIdentifier(schemaName)}`);
    }
    [control, target] = await Promise.all([
      createPostgresPersistence({
        connectionString,
        migrationsSchema: controlMigrationsSchema,
        poolConfig: { options: `-c search_path=${controlSchema}` },
      }),
      createPostgresPersistence({
        connectionString,
        migrationsSchema: targetMigrationsSchema,
        poolConfig: { options: `-c search_path=${targetSchema}` },
      }),
    ]);
    await Promise.all([control.migrate(), target.migrate()]);
    await fn(control, target);
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    const cleanupErrors: unknown[] = [];
    const controlToClose = control;
    if (controlToClose !== undefined) {
      await recordCleanupError(cleanupErrors, () => controlToClose.close());
    }
    const targetToClose = target;
    if (targetToClose !== undefined) {
      await recordCleanupError(cleanupErrors, () => targetToClose.close());
    }
    for (const schemaName of schemaNames) {
      await recordCleanupError(cleanupErrors, () =>
        adminPool.query(
          `drop schema if exists ${quoteIdentifier(schemaName)} cascade`,
        ),
      );
    }
    await recordCleanupError(cleanupErrors, () => adminPool.end());
    if (primaryError === undefined && cleanupErrors.length > 0) {
      throw new Error(
        `Failed to clean up paired temporary Postgres schemas: ${cleanupErrors
          .map(errorMessage)
          .join("; ")}`,
      );
    }
  }
}

interface FileScopedPostgresFixture {
  readonly persistence: PostgresFlarexPersistence;
  readonly reset: () => Promise<void>;
  readonly dispose: () => Promise<void>;
}

async function createFileScopedPostgresFixture(): Promise<FileScopedPostgresFixture> {
  const connectionString = requiredPostgresUrl();
  const schemaName = temporaryIdentifier("flarex_file_test");
  const migrationsSchema = temporaryIdentifier("flarex_file_migrations");
  const adminPool = new Pool({ connectionString });
  let persistence: PostgresFlarexPersistence | undefined;

  try {
    await adminPool.query(`create schema ${quoteIdentifier(schemaName)}`);
    await adminPool.query(`create schema ${quoteIdentifier(migrationsSchema)}`);
    persistence = await createPostgresPersistence({
      connectionString,
      migrationsSchema,
      poolConfig: {
        options: `-c search_path=${schemaName}`,
      },
    });
    await persistence.migrate();
  } catch (error: unknown) {
    const cleanupErrors: unknown[] = [];
    const persistenceToClose = persistence;
    if (persistenceToClose !== undefined) {
      await recordCleanupError(cleanupErrors, () => persistenceToClose.close());
    }
    await recordCleanupError(cleanupErrors, () =>
      adminPool.query(
        `drop schema if exists ${quoteIdentifier(schemaName)} cascade`,
      ),
    );
    await recordCleanupError(cleanupErrors, () =>
      adminPool.query(
        `drop schema if exists ${quoteIdentifier(migrationsSchema)} cascade`,
      ),
    );
    await recordCleanupError(cleanupErrors, () => adminPool.end());
    throw error;
  }

  const migratedPersistence = persistence;
  let disposed = false;

  return {
    persistence: migratedPersistence,
    async reset(): Promise<void> {
      if (disposed) throw new Error("File-scoped Postgres fixture is closed.");
      const pool = migratedPersistence.pool;
      if (pool.waitingCount !== 0 || pool.idleCount !== pool.totalCount) {
        throw new Error(
          "File-scoped Postgres test left a checked-out or waiting pool client.",
        );
      }
      const tables = await migratedPersistence.query<{ tablename: string }>(
        `
          select tablename
          from pg_catalog.pg_tables
          where schemaname = $1
          order by tablename
        `,
        [schemaName],
      );
      if (tables.rows.length === 0) {
        throw new Error("File-scoped Postgres fixture found no migrated tables.");
      }
      const qualifiedTables = tables.rows.map(({ tablename }) =>
        `${quoteIdentifier(schemaName)}.${quoteIdentifier(tablename)}`
      );
      await migratedPersistence.query(
        `truncate table ${qualifiedTables.join(", ")} restart identity cascade`,
      );
    },
    async dispose(): Promise<void> {
      if (disposed) return;
      disposed = true;
      const cleanupErrors: unknown[] = [];
      await recordCleanupError(cleanupErrors, () => migratedPersistence.close());
      await recordCleanupError(cleanupErrors, () =>
        adminPool.query(
          `drop schema if exists ${quoteIdentifier(schemaName)} cascade`,
        ),
      );
      await recordCleanupError(cleanupErrors, () =>
        adminPool.query(
          `drop schema if exists ${quoteIdentifier(migrationsSchema)} cascade`,
        ),
      );
      await recordCleanupError(cleanupErrors, () => adminPool.end());
      if (cleanupErrors.length > 0) {
        throw new Error(
          `Failed to clean up file-scoped Postgres schemas: ${cleanupErrors
            .map(errorMessage)
            .join("; ")}`,
        );
      }
    },
  };
}

function requiredPostgresUrl(): string {
  if (postgresUrl === null) {
    throw new Error("FLAREX_POSTGRES_DATABASE_URL is required.");
  }
  return postgresUrl;
}

function temporaryIdentifier(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

async function recordCleanupError(
  errors: unknown[],
  cleanup: () => Promise<unknown>,
): Promise<void> {
  try {
    await cleanup();
  } catch (error) {
    errors.push(error);
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
