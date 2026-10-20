import { openPreparedHostTestRuntime, closePreparedHostTestRuntime } from "../execution/preparation/preparedHostRuntimeTestSupport";
import { randomBytes } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";

import { Client, Pool, type PoolClient, type PoolConfig } from "pg";
import { sql } from "drizzle-orm";
import { Effect } from "effect";
import { trimToNonBlankOrNull } from "@flarex/utils/strings";
import { useFileScopedPersistence, type FileScopedPersistenceFixture, type WithFileScopedPersistence } from "./fileScopedPersistenceFixture";
import { registerFrameworkMaintenanceFixture } from "../installation/frameworkSchema/frameworkMigrationPostgresFixture";

import {
  createPostgresClientPersistence,
  type PostgresClientFlarexPersistence,
} from "../../src/database/postgresClient";
import {
  createPostgresPersistence,
  type PostgresFlarexPersistence,
} from "../../src/database/postgres";
import {
  withHistoricalApplicationAnalysisMigrations,
} from "../../src/testing/systemTestHistoricalApplicationAnalysisMigrations";
import { prepareProtectedMetadata, type ProtectedMetadataPreparation } from "../../src/execution/preparation/preparedMetadataEpoch";
import { loadManagedInstallation, loadCoLocatedReadInstallation, loadActivationServingInstallation,
  type InstallationAccessProfile, type PreparedActivationServingInstallation, type PreparedInstallation,
  type PreparedCoLocatedReadInstallation } from "../../src/installation/installationLifecycle";
import type { FlarexMetadataDatabase } from "../../src/application/deployments";
import { configureInstallationRuntimePermissions, withInstallationMaintenance,
  publishVerifiedInstallation, publishFullProofInstallation, type InstallationMigrationJournal } from "../../src/database/postgresInstallationMaintenance";

export const postgresUrl = trimToNonBlankOrNull(
  process.env.FLAREX_POSTGRES_DATABASE_URL,
);

/** Explicit private fixture endpoints; diagnostics must not redirect process
 * environment or a module-captured default while another fixture is alive. */
export interface PostgresFixtureEndpoints {
  readonly connectionString: string;
  readonly provisioningConnectionString: string;
}

export interface HeldPostgresDeploymentLock {
  readonly client: PoolClient;
  readonly blockerPid: number;
}

export interface BlockedPostgresDeploymentLockWaiter {
  readonly waiterPid: number;
  readonly blockerPids: readonly number[];
}

export interface TemporaryPostgresSchemaOptions {
  readonly connectionString: string;
  readonly migrationsSchema: string;
  readonly poolConfig: PoolConfig;
}

export type WithFileScopedPostgresPersistence = WithFileScopedPersistence<PostgresFlarexPersistence>;

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
    await rollbackAndReleasePostgresClient(client);
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

export async function waitForBlockedPostgresDeploymentLockWaiters(
  persistence: PostgresFlarexPersistence,
  lock: HeldPostgresDeploymentLock,
  expectedBlocked: number,
): Promise<readonly BlockedPostgresDeploymentLockWaiter[]> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const result = await persistence.query<{
      waiterPid: number;
      blockerPids: number[];
    }>(
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
        select activity.pid::int as "waiterPid",
               pg_blocking_pids(activity.pid) as "blockerPids"
        from blocked
        join pg_stat_activity as activity using (pid)
        where activity.datname = current_database()
          and activity.wait_event_type = 'Lock'
          and activity.query ilike '%deployments%'
          and activity.query ilike '%for update%'
        order by activity.pid
      `,
      [lock.blockerPid],
    );
    if (result.rows.length >= expectedBlocked) {
      return Object.freeze(result.rows.map(row => Object.freeze({
        waiterPid: row.waiterPid,
        blockerPids: Object.freeze([...row.blockerPids]),
      })));
    }
    await delay(25);
  }
  throw new Error(
    `Timed out waiting for ${expectedBlocked} deployment-lock waiters blocked by backend ${lock.blockerPid}.`,
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
    readonly transport?: "ordinary" | "finiteCapture";
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
          ...(options.transport === "finiteCapture" ? { statement_timeout: 30_000 } : {}),
        },
      });
      await current.migrate();
      registerFrameworkMaintenanceFixture(current, { config: current.pool.options, schemaName,
        journal: { migrationsSchema }, runtimePolicies: [] });
      await openPreparedHostTestRuntime(current.drizzle);
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
      await recordCleanupError(cleanupErrors, () => closePreparedHostTestRuntime(persistenceToClose.drizzle));
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
 * renew their prepared runtime and reset SQL rows unless retainRows is enabled
 * for read-only cases or cases with independent scopes. A failed test marks the fixture
 * for a full schema rebuild before the next test so failures cannot poison the
 * rest of the file. Callback settlement and reset finish before another
 * callback or test can borrow the fixture, even if its caller timed out.
 */
export function useFileScopedPostgresPersistence(
  options: Parameters<typeof createFileScopedPostgresFixture>[0] = {},
): WithFileScopedPostgresPersistence {
  return useFileScopedPersistence(() => createFileScopedPostgresFixture(options), postgresUrl !== null);
}

/** Row-only scheduler cases retain the exact migrated singleton rows, rather
 * than reconstructing scheduler policy, timestamps or defaults during reset. */
export function useFileScopedPostgresSchedulerPersistence(): WithFileScopedPostgresPersistence {
  return useFileScopedPersistence(async () => {
    const fixture = await createFileScopedPostgresFixture();
    try {
      const seeds: { tableName: string; seed: string }[] = [];
      for (const tableName of ["fx_system_point_mutation_redelivery_scheduler", "fx_system_retained_history_scheduler", "fx_system_durable_task_repair_scheduler_v1"]) {
        const result = await fixture.persistence.query<{ seed: string }>(
          `select row_to_json(seed)::text as seed from ${quoteIdentifier(tableName)} seed`,
        );
        const seed = result.rows[0]?.seed;
        if (result.rows.length !== 1 || seed === undefined) throw new Error(`Expected one migrated ${tableName} seed`);
        seeds.push({ tableName, seed });
      }
      return {
        ...fixture,
        async reset() {
          await fixture.reset();
          await fixture.persistence.drizzle.transaction(async transaction => {
            for (const { tableName, seed } of seeds) {
              await transaction.execute(sql`insert into ${sql.identifier(tableName)}
                select (json_populate_record(null::${sql.identifier(tableName)}, ${seed}::json)).*`);
            }
          });
        },
      };
    } catch (error: unknown) {
      try { await fixture.dispose(); }
      catch (cleanupError: unknown) {
        throw new AggregateError([error, cleanupError], "Scheduler fixture capture and cleanup failed");
      }
      throw error;
    }
  }, postgresUrl !== null);
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
        poolConfig: { options: `-c search_path=${controlSchema}`, application_name: controlSchema },
      }),
      createPostgresPersistence({
        connectionString,
        migrationsSchema: targetMigrationsSchema,
        poolConfig: { options: `-c search_path=${targetSchema}`, application_name: targetSchema },
      }),
    ]);
    // These schemas share database-wide extension identities. Bootstrap them
    // sequentially so concurrent CREATE EXTENSION IF NOT EXISTS cannot race.
    await control.migrate();
    await target.migrate();
    registerFrameworkMaintenanceFixture(control, { config: control.pool.options, schemaName: controlSchema,
      journal: { migrationsSchema: controlMigrationsSchema }, runtimePolicies: [] });
    registerFrameworkMaintenanceFixture(target, { config: target.pool.options, schemaName: targetSchema,
      journal: { migrationsSchema: targetMigrationsSchema }, runtimePolicies: [] });
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

export interface FileScopedPostgresFixture extends FileScopedPersistenceFixture<PostgresFlarexPersistence> {
  readonly schemaName: string;
  readonly migrationsSchema: string;
  readonly migrationsTable: string;
  readonly installationTiming: Readonly<{ baseMigration: Readonly<{ migrationMs: number }> }>;
}

export async function createFileScopedPostgresFixture(
  options: Readonly<{ sameSchema?: boolean; tableName?: string; retainRows?: boolean }> = {},
  maintenanceSession: Readonly<{ standardConformingStrings?: "off"; immutableCatalog?: FlarexMetadataDatabase }> = {},
  transport: "ordinary" | "finiteCapture" = "ordinary",
  postgresEndpoints?: PostgresFixtureEndpoints,
): Promise<FileScopedPostgresFixture> {
  const retainRows = options.retainRows === true;
  const connectionString = postgresEndpoints?.connectionString ?? requiredPostgresUrl();
  const schemaName = temporaryIdentifier("flarex_file_test");
  const migrationsSchema = options.sameSchema === true ? schemaName : temporaryIdentifier("flarex_file_migrations");
  const migrationsTable = options.tableName ?? "__drizzle_migrations";
  const adminPool = new Pool({ connectionString });
  let persistence: PostgresFlarexPersistence | undefined;
  let migrationMs = 0;

  try {
    await adminPool.query(`create schema ${quoteIdentifier(schemaName)}`);
    if (migrationsSchema !== schemaName) await adminPool.query(`create schema ${quoteIdentifier(migrationsSchema)}`);
    persistence = await createPostgresPersistence({
      connectionString,
      migrationsSchema,
      migrationsTable,
      ...(maintenanceSession.immutableCatalog===undefined ? {} : { immutableCatalog: maintenanceSession.immutableCatalog }),
      poolConfig: {
        options: `-c search_path=${schemaName}`,
        application_name: schemaName,
        ...(transport === "finiteCapture" ? { statement_timeout: 30_000 } : {}),
      },
    });
    const migrationStarted = performance.now();
    await persistence.migrate();
    registerFrameworkMaintenanceFixture(persistence, {
      config: maintenanceSession.standardConformingStrings === "off" ? { ...persistence.pool.options,
        options: `${persistence.pool.options.options ?? ""} -c standard_conforming_strings=off` } : persistence.pool.options,
      schemaName,
      journal: { migrationsSchema, migrationsTable }, runtimePolicies: [] });
    migrationMs = performance.now() - migrationStarted;
    await openPreparedHostTestRuntime(persistence.drizzle);
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
    if (cleanupErrors.length > 0) throw new AggregateError([error, ...cleanupErrors],
      "File-scoped fixture creation and cleanup failed");
    throw error;
  }

  const migratedPersistence = persistence;
  let disposed = false;

  return {
    persistence: migratedPersistence,
    schemaName,
    migrationsSchema,
    migrationsTable,
    installationTiming: Object.freeze({ baseMigration: Object.freeze({ migrationMs }) }),
    async reset(): Promise<void> {
      if (disposed) throw new Error("File-scoped Postgres fixture is closed.");
      const pool = migratedPersistence.pool;
      if (pool.waitingCount !== 0 || pool.idleCount !== pool.totalCount) {
        throw new Error(
          "File-scoped Postgres test left a checked-out or waiting pool client.",
        );
      }
      await closePreparedHostTestRuntime(migratedPersistence.drizzle);
      if (!retainRows) {
        const tables = await migratedPersistence.query<{ tablename: string }>(
          `
          select tablename
          from pg_catalog.pg_tables
          where schemaname = $1 and tablename not in
            ('fx_system_installation','fx_system_installation_runtime', $2)
          order by tablename
        `,
          [schemaName, migrationsSchema === schemaName ? migrationsTable : ""],
        );
        if (tables.rows.length === 0) {
          throw new Error("File-scoped Postgres fixture found no migrated tables.");
        }
        const qualifiedTables = tables.rows.map(({ tablename }) =>
          `${quoteIdentifier(schemaName)}.${quoteIdentifier(tablename)}`
        );
        // Administrative teardown of this exact disposable schema. Runtime roles
        // cannot disable these guards or truncate installed migration evidence.
        const guarded = await migratedPersistence.query<{ tablename: string }>(`
        select c.relname as tablename from pg_catalog.pg_trigger t
        join pg_catalog.pg_class c on c.oid = t.tgrelid
        join pg_catalog.pg_namespace n on n.oid = c.relnamespace
        where n.nspname = $1 and t.tgname = 'fx_framework_history_no_truncate'
        order by c.relname
      `, [schemaName]);
        await migratedPersistence.drizzle.transaction(async transaction => {
          for (const { tablename } of guarded.rows) {
            await transaction.execute(sql.raw(`alter table ${quoteIdentifier(schemaName)}.${quoteIdentifier(tablename)} disable trigger fx_framework_history_no_truncate`));
          }
          await transaction.execute(sql.raw(`truncate table ${qualifiedTables.join(", ")} restart identity cascade`));
          await transaction.execute(sql.raw(`insert into ${quoteIdentifier(schemaName)}.fx_system_prepared_metadata_epoch
          (singleton_id, database_name, namespace_oid, incarnation, generation)
          select 1, current_database(), n.oid::bigint, gen_random_uuid(), 1
          from pg_catalog.pg_namespace n where n.nspname = '${schemaName}'`));
          for (const { tablename } of guarded.rows) {
            await transaction.execute(sql.raw(`alter table ${quoteIdentifier(schemaName)}.${quoteIdentifier(tablename)} enable trigger fx_framework_history_no_truncate`));
          }
        });
      }
      await openPreparedHostTestRuntime(migratedPersistence.drizzle);
    },
    async dispose(): Promise<void> {
      if (disposed) return;
      disposed = true;
      const cleanupErrors: unknown[] = [];
      await recordCleanupError(cleanupErrors, () => closePreparedHostTestRuntime(migratedPersistence.drizzle));
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

/** A disposable owner-migrated schema with a separate authenticated runtime
 * login. The runtime credential owns no schema or table and cannot switch to
 * the migration owner. Tests use its persistence for ordinary core APIs. */
export async function createProtectedFileScopedPostgresFixture(
  profile: "fullProof" | "managed" = "fullProof",
  existingOwner?: Pick<FileScopedPostgresFixture, "persistence" | "schemaName" | "migrationsSchema" | "installationTiming"> &
    Partial<Pick<FileScopedPostgresFixture, "migrationsTable">>,
  transport: "ordinary" | "finiteCapture" = "ordinary",
  postgresEndpoints?: PostgresFixtureEndpoints,
): Promise<Readonly<{
  persistence: PostgresFlarexPersistence;
  protectedMetadata: ProtectedMetadataPreparation;
  installation: PreparedInstallation | undefined;
  schemaName: string;
  migrationsSchema: string;
  migrationsTable: string;
  installationTiming: Readonly<{ baseMigration: Readonly<{ migrationMs: number }>; managedSetupMs: number }>;
  dispose: () => Promise<void>;
}>> {
  const provisionUrl = trimToNonBlankOrNull(postgresEndpoints?.provisioningConnectionString ?? process.env.FLAREX_POSTGRES_PROVISIONING_DATABASE_URL);
  if (provisionUrl === null) throw new Error("FLAREX_POSTGRES_PROVISIONING_DATABASE_URL is required.");
  const ownedFixture = existingOwner === undefined ? await createFileScopedPostgresFixture({}, {}, "ordinary", postgresEndpoints) : undefined;
  const owner = existingOwner ?? ownedFixture;
  if (owner === undefined) throw new Error("Missing protected fixture owner");
  const provision = new Pool({ connectionString: provisionUrl });
  const roleName = temporaryIdentifier("flarex_runtime");
  const password = randomBytes(24).toString("base64url");
  let roleCreated = false;
  let runtime: PostgresFlarexPersistence | undefined;
  const managedStarted = performance.now();
  try {
    await provision.query(`create role ${quoteIdentifier(roleName)} login password ${quoteLiteral(password)}
      nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls`);
    roleCreated = true;
    await owner.persistence.pool.query(`grant usage on schema ${quoteIdentifier(owner.schemaName)} to ${quoteIdentifier(roleName)}`);
    await owner.persistence.pool.query(`grant select, insert, update, delete on all tables in schema
      ${quoteIdentifier(owner.schemaName)} to ${quoteIdentifier(roleName)}`);
    await owner.persistence.pool.query(`grant usage, select on all sequences in schema
      ${quoteIdentifier(owner.schemaName)} to ${quoteIdentifier(roleName)}`);
    await owner.persistence.pool.query(`revoke all on ${quoteIdentifier(owner.schemaName)}.fx_system_prepared_metadata_epoch
      from ${quoteIdentifier(roleName)}`);
    await owner.persistence.pool.query(`grant select on ${quoteIdentifier(owner.schemaName)}.fx_system_prepared_metadata_epoch
      to ${quoteIdentifier(roleName)}`);
    await owner.persistence.pool.query(`grant execute on function ${quoteIdentifier(owner.schemaName)}.
      fx_lock_prepared_metadata_epoch() to ${quoteIdentifier(roleName)}`);
    const runtimeUrl = new URL(postgresEndpoints?.connectionString ?? requiredPostgresUrl());
    runtimeUrl.username = roleName;
    runtimeUrl.password = password;
    runtime = await createPostgresPersistence({
      connectionString: runtimeUrl.toString(),
      migrationsSchema: owner.migrationsSchema,
      migrationsTable: owner.migrationsTable ?? "__drizzle_migrations",
      migrationPool: owner.persistence.pool,
      poolConfig: { options: `-c search_path=${owner.schemaName}`, application_name: `${roleName}_test`,
        ...(transport === "finiteCapture" || profile === "managed" ? { statement_timeout: 30_000 } : {}) },
    });
    const activeRuntime = runtime;
    const endpointPolicy = "protected-postgres-fixture";
    registerFrameworkMaintenanceFixture(activeRuntime, { config: owner.persistence.pool.options,
      schemaName: owner.schemaName,
      journal: { migrationsSchema: owner.migrationsSchema, migrationsTable: owner.migrationsTable ?? "__drizzle_migrations" },
      runtimePolicies: profile === "managed" ? [{ database: activeRuntime.drizzle, endpointPolicy }] : [],
      runtimeDatabases: [activeRuntime.drizzle] });
    await Effect.runPromise(withInstallationMaintenance(owner.persistence.pool.options, owner.schemaName, handle =>
      Effect.gen(function* () {
        const journal = { migrationsSchema: owner.migrationsSchema, migrationsTable: owner.migrationsTable ?? "__drizzle_migrations" };
        yield* configureInstallationRuntimePermissions(handle, roleName, journal);
        yield* profile === "managed" ? publishVerifiedInstallation(handle,
          [{ database: activeRuntime.drizzle, endpointPolicy }], journal) : publishFullProofInstallation(handle, journal);
      })));
    const installation = profile === "managed" ? await Effect.runPromise(
      loadManagedInstallation(runtime.drizzle, endpointPolicy, owner.schemaName)) : undefined;
    await openPreparedHostTestRuntime(runtime.drizzle);
    const protectedMetadata = await Effect.runPromise(prepareProtectedMetadata(runtime.drizzle, installation));
    let disposed = false;
    return Object.freeze({ persistence: activeRuntime, protectedMetadata, installation, schemaName: owner.schemaName,
      migrationsSchema: owner.migrationsSchema, migrationsTable: owner.migrationsTable ?? "__drizzle_migrations",
      installationTiming: Object.freeze({ baseMigration: owner.installationTiming.baseMigration,
        managedSetupMs: performance.now() - managedStarted }),
      async dispose() {
        if (disposed) return;
        disposed = true;
        const errors: unknown[] = [];
        await recordCleanupError(errors, () => closePreparedHostTestRuntime(activeRuntime.drizzle));
        await recordCleanupError(errors, () => activeRuntime.close());
        if (ownedFixture !== undefined) await recordCleanupError(errors, () => ownedFixture.dispose());
        // This helper created this unique restricted role. Remove its grants
        // when a caller-owned schema survives the reader fixture's lifetime.
        await recordCleanupError(errors, () => provision.query(`drop owned by ${quoteIdentifier(roleName)}`));
        await recordCleanupError(errors, () => provision.query(`drop role ${quoteIdentifier(roleName)}`));
        await recordCleanupError(errors, () => provision.end());
        if (errors.length > 0) throw new Error(`Protected fixture cleanup failed: ${errors.map(errorMessage).join("; ")}`);
      } });
  } catch (error) {
    const cleanupErrors: unknown[] = [];
    if (runtime !== undefined) {
      const failedRuntime = runtime;
      await recordCleanupError(cleanupErrors, () => closePreparedHostTestRuntime(failedRuntime.drizzle));
      await recordCleanupError(cleanupErrors, () => failedRuntime.close());
    }
    if (ownedFixture !== undefined) await recordCleanupError(cleanupErrors, () => ownedFixture.dispose());
    if (roleCreated) {
      await recordCleanupError(cleanupErrors, () => provision.query(`drop owned by ${quoteIdentifier(roleName)}`));
      await recordCleanupError(cleanupErrors, () => provision.query(`drop role ${quoteIdentifier(roleName)}`));
    }
    await recordCleanupError(cleanupErrors, () => provision.end());
    if (cleanupErrors.length > 0) throw new AggregateError([error, ...cleanupErrors],
      "Protected fixture creation and cleanup failed");
    throw error;
  }
}

/** Add one existing target login as a SELECT-only control reader. Existing
 * control runtime policy is reverified alongside it; writers retain their role.
 * Both old control capabilities expire when the control installation drains. */
export async function createCoLocatedReadInstallationFixture(input: Readonly<{
  target: Readonly<{ persistence: PostgresFlarexPersistence; installation: PreparedInstallation | undefined }>;
  control: Readonly<{ persistence: PostgresFlarexPersistence }>;
  controlOwner: Pick<FileScopedPostgresFixture, "persistence" | "schemaName" | "migrationsSchema"> &
    Partial<Pick<FileScopedPostgresFixture, "migrationsTable">>;
}>): Promise<Readonly<{ installation: PreparedCoLocatedReadInstallation;
  installationTiming: Readonly<{ coLocatedSetupMs: number }> }>> {
  const started = performance.now();
  if (input.target.installation === undefined) throw new Error("A managed target installation is required");
  const controlEndpointPolicy = "colocated-control-read-fixture";
  const journal = { migrationsSchema: input.controlOwner.migrationsSchema,
    migrationsTable: input.controlOwner.migrationsTable ?? "__drizzle_migrations" };
  await Effect.runPromise(withInstallationMaintenance(input.controlOwner.persistence.pool.options,
    input.controlOwner.schemaName, handle => publishVerifiedInstallation(handle, [
      { database: input.control.persistence.drizzle, endpointPolicy: "protected-postgres-fixture" },
      { database: input.target.persistence.drizzle, endpointPolicy: controlEndpointPolicy, accessProfile: "controlRead" },
    ], journal)));
  const controlInstallation = await Effect.runPromise(loadManagedInstallation(input.control.persistence.drizzle,
    "protected-postgres-fixture", input.controlOwner.schemaName));
  const installation = await Effect.runPromise(loadCoLocatedReadInstallation({ database: input.target.persistence.drizzle,
    targetInstallation: input.target.installation, control: { database: input.control.persistence.drizzle,
      installation: controlInstallation }, controlEndpointPolicy }));
  return Object.freeze({ installation, installationTiming: Object.freeze({ coLocatedSetupMs: performance.now() - started }) });
}

type ActivationServingFixtureOwner = Pick<FileScopedPostgresFixture,
  "persistence" | "schemaName" | "migrationsSchema" | "migrationsTable" | "installationTiming">;
interface ActivationInstallationFixtureMember {
  readonly persistence: PostgresFlarexPersistence;
  readonly login: string;
  readonly installation: PreparedInstallation;
}
interface PreparedActivationInstallationFixtureMember extends ActivationInstallationFixtureMember {
  readonly protectedMetadata: ProtectedMetadataPreparation;
  readonly schemaName: string;
  readonly migrationsSchema: string;
  readonly migrationsTable: string;
  readonly installationTiming: Readonly<{ baseMigration: Readonly<{ migrationMs: number }>; managedSetupMs: number }>;
}
interface RawActivationServingFixturePreparations {
  readonly serving: ActivationInstallationFixtureMember & Readonly<{ protectedMetadata: ProtectedMetadataPreparation }>;
  readonly activation: ActivationInstallationFixtureMember & Readonly<{ protectedMetadata: ProtectedMetadataPreparation }>;
  readonly controlRead: ActivationInstallationFixtureMember;
  readonly pair: PreparedActivationServingInstallation;
}
export interface ActivationServingFixturePreparations {
  readonly serving: PreparedActivationInstallationFixtureMember;
  readonly activation: PreparedActivationInstallationFixtureMember;
  readonly controlRead: ActivationInstallationFixtureMember;
  readonly pair: PreparedActivationServingInstallation;
}
export interface ActivationServingFileScopedPostgresFixture extends ActivationServingFixturePreparations {
  readonly owner: ActivationServingFixtureOwner;
  readonly schemaName: string;
  readonly journal: InstallationMigrationJournal;
  readonly runtimePolicies: ReadonlyArray<Readonly<{ database: FlarexMetadataDatabase;
    endpointPolicy: string; accessProfile: InstallationAccessProfile }>>;
  readonly installationTiming: PreparedActivationInstallationFixtureMember["installationTiming"];
  readonly reload: () => Promise<ActivationServingFixturePreparations>;
  readonly setIncomingActivationMembership: (enabled: boolean) => Promise<void>;
  readonly dispose: () => Promise<void>;
}

/** All actual logins exist before one installation publication. No preparation
 * from an earlier maintenance generation is copied into the issued pair. */
export async function createActivationServingFileScopedPostgresFixture(
  existingOwner?: ActivationServingFixtureOwner,
  transport: "ordinary" | "finiteCapture" = "ordinary",
  postgresEndpoints?: PostgresFixtureEndpoints,
): Promise<ActivationServingFileScopedPostgresFixture> {
  const provisioningUrl = trimToNonBlankOrNull(postgresEndpoints?.provisioningConnectionString ?? process.env.FLAREX_POSTGRES_PROVISIONING_DATABASE_URL);
  if (provisioningUrl === null) throw new Error("FLAREX_POSTGRES_PROVISIONING_DATABASE_URL is required.");
  const ownedOwner = existingOwner === undefined ? await createFileScopedPostgresFixture({}, {}, transport, postgresEndpoints) : undefined;
  const owner = existingOwner ?? ownedOwner;
  if (owner === undefined) throw new Error("Missing activation installation fixture owner");
  const managedStarted = performance.now();
  const provisioning = new Pool({ connectionString: provisioningUrl });
  const roles: string[] = [];
  const members = new Map<InstallationAccessProfile, Readonly<{ persistence: PostgresFlarexPersistence; login: string }>>();
  const journal = { migrationsSchema: owner.migrationsSchema, migrationsTable: owner.migrationsTable };
  let disposed = false;
  const cleanup = async (): Promise<unknown[]> => {
    if (disposed) return [];
    disposed = true;
    const errors: unknown[] = [];
    for (const member of members.values()) {
      await recordCleanupError(errors, () => closePreparedHostTestRuntime(member.persistence.drizzle));
      await recordCleanupError(errors, () => member.persistence.close());
    }
    if (ownedOwner !== undefined) await recordCleanupError(errors, () => ownedOwner.dispose());
    for (const login of roles) {
      await recordCleanupError(errors, () => provisioning.query(`drop owned by ${quoteIdentifier(login)}`));
      await recordCleanupError(errors, () => provisioning.query(`drop role ${quoteIdentifier(login)}`));
    }
    await recordCleanupError(errors, () => provisioning.end());
    return errors;
  };
  try {
    for (const profile of ["dataRuntime", "activationWriter", "controlRead"] as const) {
      const login = temporaryIdentifier(`flarex_${profile.toLowerCase()}`);
      const password = randomBytes(24).toString("base64url");
      await provisioning.query(`create role ${quoteIdentifier(login)} login password ${quoteLiteral(password)}
        nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls`);
      roles.push(login);
      await owner.persistence.query(`grant usage on schema ${quoteIdentifier(owner.schemaName)} to ${quoteIdentifier(login)}`);
      await owner.persistence.query(`grant select,insert,update,delete on all tables in schema
        ${quoteIdentifier(owner.schemaName)} to ${quoteIdentifier(login)}`);
      await owner.persistence.query(`grant usage,select on all sequences in schema
        ${quoteIdentifier(owner.schemaName)} to ${quoteIdentifier(login)}`);
      const runtimeUrl = new URL(postgresEndpoints?.connectionString ?? requiredPostgresUrl());
      runtimeUrl.username = login;
      runtimeUrl.password = password;
      const persistence = await createPostgresPersistence({ connectionString: runtimeUrl.toString(),
        migrationPool: owner.persistence.pool, ...journal,
        poolConfig: { options: `-c search_path=${owner.schemaName}`, application_name: `${login}_test`,
          ...(transport === "finiteCapture" || profile !== "activationWriter" ? { statement_timeout: 30_000 } : {}) } });
      members.set(profile, Object.freeze({ persistence, login }));
    }
    const serving = members.get("dataRuntime"), activation = members.get("activationWriter"), controlRead = members.get("controlRead");
    if (serving === undefined || activation === undefined || controlRead === undefined)
      throw new Error("Missing actual installation profile pool");
    const endpointPolicy = "activation-serving-fixture";
    const runtimePolicies = Object.freeze([
      Object.freeze({ database: serving.persistence.drizzle, endpointPolicy, accessProfile: "dataRuntime" as const }),
      Object.freeze({ database: activation.persistence.drizzle, endpointPolicy, accessProfile: "activationWriter" as const }),
      Object.freeze({ database: controlRead.persistence.drizzle, endpointPolicy, accessProfile: "controlRead" as const }),
    ]);
    await Effect.runPromise(withInstallationMaintenance(owner.persistence.pool.options, owner.schemaName, handle =>
      publishVerifiedInstallation(handle, runtimePolicies, journal)));
    for (const member of [serving, activation]) await openPreparedHostTestRuntime(member.persistence.drizzle);
    const prepare = async (): Promise<RawActivationServingFixturePreparations> => Effect.runPromise(Effect.gen(function* () {
      const servingInstallation = yield* loadManagedInstallation(serving.persistence.drizzle, endpointPolicy, owner.schemaName, "dataRuntime");
      const activationInstallation = yield* loadManagedInstallation(activation.persistence.drizzle, endpointPolicy, owner.schemaName, "activationWriter");
      const controlInstallation = yield* loadManagedInstallation(controlRead.persistence.drizzle, endpointPolicy, owner.schemaName, "controlRead");
      const pair = yield* loadActivationServingInstallation({
        serving: { database: serving.persistence.drizzle, installation: servingInstallation },
        activation: { database: activation.persistence.drizzle, installation: activationInstallation },
      });
      const servingProtectedMetadata = yield* prepareProtectedMetadata(serving.persistence.drizzle, servingInstallation);
      const activationProtectedMetadata = yield* prepareProtectedMetadata(activation.persistence.drizzle, activationInstallation);
      return Object.freeze({
        serving: Object.freeze({ ...serving, installation: servingInstallation, protectedMetadata: servingProtectedMetadata }),
        activation: Object.freeze({ ...activation, installation: activationInstallation, protectedMetadata: activationProtectedMetadata }),
        controlRead: Object.freeze({ ...controlRead, installation: controlInstallation }), pair,
      });
    }));
    const initialRaw = await prepare();
    const installationTiming = Object.freeze({ baseMigration: owner.installationTiming.baseMigration,
      managedSetupMs: performance.now() - managedStarted });
    const present = (prepared: RawActivationServingFixturePreparations): ActivationServingFixturePreparations => {
      const shared = { schemaName: owner.schemaName, ...journal, installationTiming };
      return Object.freeze({ ...prepared, serving: Object.freeze({ ...prepared.serving, ...shared }),
        activation: Object.freeze({ ...prepared.activation, ...shared }) });
    };
    const initial = present(initialRaw);
    const reload = async (): Promise<ActivationServingFixturePreparations> => present(await prepare());
    for (const member of [serving, activation, controlRead]) registerFrameworkMaintenanceFixture(member.persistence, {
      config: owner.persistence.pool.options, schemaName: owner.schemaName, journal, runtimePolicies,
      runtimeDatabases: [serving.persistence.drizzle, activation.persistence.drizzle, controlRead.persistence.drizzle],
    });
    return Object.freeze({ ...initial, owner, schemaName: owner.schemaName, journal, runtimePolicies, installationTiming, reload,
      async setIncomingActivationMembership(enabled: boolean): Promise<void> {
        await provisioning.query(enabled
          ? `grant ${quoteIdentifier(activation.login)} to ${quoteIdentifier(serving.login)}`
          : `revoke ${quoteIdentifier(activation.login)} from ${quoteIdentifier(serving.login)}`);
      },
      async dispose(): Promise<void> {
        const errors = await cleanup();
        if (errors.length > 0) throw new AggregateError(errors, "Activation installation fixture cleanup failed");
      },
    });
  } catch (cause) {
    const errors = await cleanup();
    if (errors.length > 0) throw new AggregateError([cause, ...errors], "Activation installation fixture setup and cleanup failed");
    throw cause;
  }
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

function quoteLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
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
