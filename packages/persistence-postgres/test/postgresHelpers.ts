import { setTimeout as delay } from "node:timers/promises";

import { Client, Pool, type PoolClient } from "pg";

import {
  createPostgresClientPersistence,
  type PostgresClientFlarexPersistence,
} from "../src/postgresClient";
import {
  createPostgresPersistence,
  type PostgresFlarexPersistence,
} from "../src/postgres";

export const postgresUrl = normalizePostgresUrl(
  process.env.FLAREX_POSTGRES_DATABASE_URL,
);

export interface HeldPostgresDeploymentLock {
  readonly client: PoolClient;
  readonly blockerPid: number;
}

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

export async function withTemporaryPostgresPersistence(
  fn: (persistence: PostgresFlarexPersistence) => Promise<void>,
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
    persistence = await createPostgresPersistence({
      connectionString,
      migrationsSchema,
      poolConfig: {
        options: `-c search_path=${schemaName}`,
      },
    });
    await persistence.migrate();
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

function requiredPostgresUrl(): string {
  if (postgresUrl === null) {
    throw new Error("FLAREX_POSTGRES_DATABASE_URL is required.");
  }
  return postgresUrl;
}

function normalizePostgresUrl(value: string | undefined): string | null {
  if (value === undefined) return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
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
