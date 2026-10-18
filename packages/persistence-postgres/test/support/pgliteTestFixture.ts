import { readFile } from "node:fs/promises";
import { createTestPGlite } from "./pgliteSearchExtensions";
import { PGlite, type Transaction } from "@electric-sql/pglite";
import { openPreparedHostTestRuntime, closePreparedHostTestRuntime } from "../execution/preparation/preparedHostRuntimeTestSupport";
import { inject, onTestFinished } from "vitest";
import { buildMigratedPGliteDataDir } from "./pgliteMigrationBaseline";
import {
  useFileScopedPersistence,
  type FileScopedPersistenceFixture,
} from "./fileScopedPersistenceFixture";

import { createPGlitePersistence } from "../../src/database/pglite";

type PGlitePersistence = Awaited<ReturnType<typeof createPGlitePersistence>>;

declare module "vitest" {
  export interface ProvidedContext {
    pgliteMigrationBaselinePath?: string;
  }
}

let migratedDataDirPromise: Promise<Blob | File> | undefined;

export function migratedPGliteDataDir(): Promise<Blob | File> {
  if (migratedDataDirPromise === undefined) {
    const path = inject("pgliteMigrationBaselinePath");
    migratedDataDirPromise = path === undefined
      ? buildMigratedPGliteDataDir()
      : readFile(path).then(bytes => new Blob([new Uint8Array(bytes)]));
  }
  return migratedDataDirPromise;
}

/**
 * Loads an isolated in-memory database from a schema-only migrated snapshot.
 * The PGlite lane prepares one immutable snapshot per run. Direct invocations
 * without that setup build one per isolated file. Each database closes when
 * its owning test finishes.
 */
export async function createMigratedPGlitePersistence(registerCleanup: (cleanup: () => Promise<void>) => void = onTestFinished,
  transport: "ordinary" | "finiteCapture" = "ordinary"): Promise<PGlitePersistence> {
  const db = await createTestPGlite({ loadDataDir: await migratedPGliteDataDir(),
    ...(transport === "finiteCapture" ? { startParams: [...PGlite.defaultStartParams, "-c", "statement_timeout=30000"] } : {}) });

  try {
    const persistence = await createPGlitePersistence({ db });
    await openPreparedHostTestRuntime(persistence.drizzle);
    registerCleanup(async () => { await closePreparedHostTestRuntime(persistence.drizzle); await db.close(); });
    return persistence;
  } catch (error: unknown) {
    await db.close();
    throw error;
  }
}

/** Row-only legacy runtime/sync suites. Modern catalog, migration, DDL, session
 * configuration and restart tests must keep their independent databases. */
export function useFileScopedPGliteRuntimePersistence() {
  return useFileScopedPersistence(() => createFileScopedPGliteFixture(async db => () => resetRuntimeRows(db)));
}

/** Row and relation storage only. Catalog, commit history and persistent DDL
 * require independent databases; unexpected dependants make reset fail closed. */
export function useFileScopedPGliteStoragePersistence() {
  return useFileScopedPersistence(() => createFileScopedPGliteFixture(async db => () => resetStorageRows(db)));
}

/** Control scope metadata and provisioning receipts only. System authority,
 * catalog and persistent DDL require independent fixtures; unexpected foreign-key
 * dependants fail closed. */
export function useFileScopedPGliteControlScopePersistence() {
  return useFileScopedPersistence(() => createFileScopedPGliteFixture(async db => () => resetControlScopeRows(db)));
}

/** Shared scope authority and control metadata only. Application rows, catalog
 * and persistent DDL require independent fixtures; foreign keys stay enabled. */
export function useFileScopedPGliteScopeAuthorityPersistence() {
  return useFileScopedPersistence(() => createFileScopedPGliteFixture(async db => () => resetScopeAuthorityRows(db)));
}

/** Current outcome/feed/wake schema cases only. Additional publication families and
 * persistent DDL keep independent databases; unexpected dependants fail closed. */
export function useFileScopedPGliteCommitSchemaPersistence() {
  return useFileScopedPersistence(() => createFileScopedPGliteFixture(async db => () => resetCommitSchemaRows(db)));
}

/** Single-database scheduler cases only. Multi-database and persistent schema
 * corruption witnesses keep independent fixtures. */
export function useFileScopedPGliteRedeliverySchedulerPersistence() {
  return useFileScopedPersistence(() => createFileScopedPGliteFixture(db =>
    createSchedulerSeedReset(db, "fx_system_point_mutation_redelivery_scheduler")));
}

export function useFileScopedPGliteTaskRepairSchedulerPersistence() {
  return useFileScopedPersistence(() => createFileScopedPGliteFixture(db =>
    createSchedulerSeedReset(db, "fx_system_durable_task_repair_scheduler_v1")));
}

export function useFileScopedPGliteRetainedHistorySchedulerPersistence() {
  return useFileScopedPersistence(() => createFileScopedPGliteFixture(db =>
    createSchedulerSeedReset(db, "fx_system_retained_history_scheduler")));
}

type SchedulerSeedTable =
  | "fx_system_point_mutation_redelivery_scheduler"
  | "fx_system_durable_task_repair_scheduler_v1"
  | "fx_system_retained_history_scheduler";

async function createSchedulerSeedReset(db: PGlite, tableName: SchedulerSeedTable): Promise<() => Promise<void>> {
  // Retain the actual migration seed, including timestamps and future fields;
  // the fixture does not duplicate scheduler defaults or reset live policy.
  const rows = await db.query<{ seed: string }>(`
    select row_to_json(seed)::text as seed from ${tableName} seed
  `);
  const seed = rows.rows[0]?.seed;
  if (rows.rows.length !== 1 || seed === undefined) throw new Error(`Expected one migrated scheduler seed in ${tableName}`);
  return async () => {
    await db.transaction(async transaction => {
      await transaction.exec(`delete from ${tableName}`);
      await transaction.query(`insert into ${tableName}
        select (json_populate_record(null::${tableName}, $1::json)).*`, [seed]);
    });
  };
}

async function resetRuntimeRows(db: PGlite): Promise<void> {
  await db.transaction(async transaction => {
    // Deployments has modern FK dependants. CASCADE would truncate
    // protected framework history and migration-seeded singleton rows.
    await transaction.exec(`truncate table
      deployment_packages, documents, indexes, leases, commits, outbox,
      invoke_sessions, invoke_session_document_reads, invoke_session_table_reads,
      invoke_session_index_reads, invoke_session_document_writes,
      freshness_processed_events, document_freshness_versions, table_freshness_versions,
      live_query_subscriptions, live_query_connections, live_query_deliveries`);
    await transaction.exec("delete from deployments");
  });
}

async function resetStorageRows(db: PGlite): Promise<void> {
  await db.transaction(resetStorageRowsInTransaction);
}

async function resetControlScopeRows(db: PGlite): Promise<void> {
  await db.transaction(resetControlScopeRowsInTransaction);
}

async function resetScopeAuthorityRows(db: PGlite): Promise<void> {
  await db.transaction(async transaction => {
    await resetScopeClockRowsInTransaction(transaction);
    await resetControlScopeRowsInTransaction(transaction);
  });
}

async function resetControlScopeRowsInTransaction(transaction: Transaction): Promise<void> {
  // Preserve every foreign key and leave other deployment dependants intact.
  await transaction.exec(`
    delete from fx_control_scope_provisioning;
    delete from fx_control_scope;
    delete from deployments;
  `);
}

async function resetCommitSchemaRows(db: PGlite): Promise<void> {
  await db.transaction(async transaction => {
    await transaction.exec(`
      delete from fx_system_idempotency;
      delete from fx_system_commit_wake;
      delete from fx_system_commit_app_row_change;
      delete from fx_system_commit_relation_adjacency_change;
      delete from fx_system_commit;
    `);
    await resetStorageRowsInTransaction(transaction);
  });
}

async function resetStorageRowsInTransaction(transaction: Transaction): Promise<void> {
  // DELETE preserves constraints from other table families.
  await transaction.exec(`
    delete from fx_app_edge_current;
    delete from fx_app_edge_adjacency_version;
    delete from fx_app_row_current;
    delete from fx_app_row_rev;
  `);
  await resetScopeClockRowsInTransaction(transaction);
}

async function resetScopeClockRowsInTransaction(transaction: Transaction): Promise<void> {
  // The deferred authority/clock pair must disappear in the same transaction.
  await transaction.exec(`
    delete from fx_system_scope_execution_authority;
    delete from fx_system_scope_clock;
  `);
}

/** Driver lifetime shared by domain-owned row reset policies. */
export async function createFileScopedPGliteFixture(
  createResetRows: (db: PGlite) => Promise<(persistence: PGlitePersistence) => Promise<void>>,
): Promise<FileScopedPersistenceFixture<PGlitePersistence>> {
  const db = await createTestPGlite({ loadDataDir: await migratedPGliteDataDir() });
  let persistence: PGlitePersistence | undefined;
  const open = async () => {
    const current = await createPGlitePersistence({ db });
    persistence = current;
    await openPreparedHostTestRuntime(current.drizzle);
    return current;
  };
  const dispose = async () => {
    const failures: unknown[] = [];
    try {
      if (persistence !== undefined) await closePreparedHostTestRuntime(persistence.drizzle);
    } catch (error: unknown) { failures.push(error); }
    try { await db.close(); }
    catch (error: unknown) { failures.push(error); }
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1) throw new AggregateError(failures, "PGlite fixture cleanup failed");
  };

  try {
    let current = await open();
    const resetRows = await createResetRows(db);
    return {
      get persistence() { return current; },
      async reset() {
        await closePreparedHostTestRuntime(current.drizzle);
        await resetRows(current);
        // Retain only the backend; database-keyed runtime state gets a fresh owner.
        current = await open();
      },
      dispose,
    };
  } catch (error: unknown) {
    try { await dispose(); }
    catch (cleanupError: unknown) {
      throw new AggregateError([error, cleanupError], "PGlite fixture setup and cleanup failed");
    }
    throw error;
  }
}
