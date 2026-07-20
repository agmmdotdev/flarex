import { PGlite } from "@electric-sql/pglite";
import { onTestFinished } from "vitest";

import { createPGlitePersistence } from "../src/pglite";

type PGlitePersistence = Awaited<ReturnType<typeof createPGlitePersistence>>;

let migratedDataDirPromise: Promise<Blob | File> | undefined;

async function buildMigratedDataDir(): Promise<Blob | File> {
  const db = new PGlite();

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
export async function createMigratedPGlitePersistence(): Promise<PGlitePersistence> {
  const db = await PGlite.create({ loadDataDir: await migratedDataDir() });

  try {
    const persistence = await createPGlitePersistence({ db });
    onTestFinished(() => db.close());
    return persistence;
  } catch (error: unknown) {
    await db.close();
    throw error;
  }
}
