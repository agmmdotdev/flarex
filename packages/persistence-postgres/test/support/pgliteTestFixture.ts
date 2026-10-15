import { readFile } from "node:fs/promises";
import { createTestPGlite } from "./pgliteSearchExtensions";
import { PGlite } from "@electric-sql/pglite";
import { openPreparedHostTestRuntime, closePreparedHostTestRuntime } from "../execution/preparation/preparedHostRuntimeTestSupport";
import { inject, onTestFinished } from "vitest";
import { buildMigratedPGliteDataDir } from "./pgliteMigrationBaseline";

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
