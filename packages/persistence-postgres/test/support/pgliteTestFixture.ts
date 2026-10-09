import { newTestPGlite, createTestPGlite } from "./pgliteSearchExtensions";
import { PGlite } from "@electric-sql/pglite";
import { openPreparedHostTestRuntime, closePreparedHostTestRuntime } from "../execution/preparation/preparedHostRuntimeTestSupport";
import { onTestFinished } from "vitest";

import { createPGlitePersistence } from "../../src/database/pglite";

type PGlitePersistence = Awaited<ReturnType<typeof createPGlitePersistence>>;

let migratedDataDirPromise: Promise<Blob | File> | undefined;

async function buildMigratedDataDir(): Promise<Blob | File> {
  const db = newTestPGlite();

  try {
    const persistence = await createPGlitePersistence({ db });
    await persistence.migrate();
    return await db.dumpDataDir("none");
  } finally {
    await db.close();
  }
}

function migratedDataDir(): Promise<Blob | File> {
  migratedDataDirPromise ??= buildMigratedDataDir();
  return migratedDataDirPromise;
}

/**
 * Loads an isolated in-memory database from a schema-only migrated snapshot.
 * The snapshot is built once in each Vitest worker and the database is closed
 * automatically when the current test finishes.
 */
export async function createMigratedPGlitePersistence(registerCleanup: (cleanup: () => Promise<void>) => void = onTestFinished,
  transport: "ordinary" | "finiteCapture" = "ordinary"): Promise<PGlitePersistence> {
  const db = await createTestPGlite({ loadDataDir: await migratedDataDir(),
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
