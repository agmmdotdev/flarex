import { readFile } from "node:fs/promises";
import { createTestPGlite } from "./pgliteSearchExtensions";
import { PGlite } from "@electric-sql/pglite";
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
  return useFileScopedPersistence(createPGliteRuntimeFixture);
}

async function createPGliteRuntimeFixture(): Promise<FileScopedPersistenceFixture<PGlitePersistence>> {
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
    if (failures.length > 1) throw new AggregateError(failures, "PGlite runtime fixture cleanup failed");
  };

  try {
    let current = await open();
    return {
      get persistence() { return current; },
      async reset() {
        await closePreparedHostTestRuntime(current.drizzle);
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
        // Retain only the backend; database-keyed runtime state gets a fresh owner.
        current = await open();
      },
      dispose,
    };
  } catch (error: unknown) {
    try { await dispose(); }
    catch (cleanupError: unknown) {
      throw new AggregateError([error, cleanupError], "PGlite runtime fixture setup and cleanup failed");
    }
    throw error;
  }
}
