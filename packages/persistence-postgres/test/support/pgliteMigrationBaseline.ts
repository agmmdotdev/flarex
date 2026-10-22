import { createPGlitePersistence } from "../../src/database/pglite";
import { newTestPGlite } from "./pgliteSearchExtensions";

/** Schema only: every consumer restores this into its own mutable database. */
export async function buildMigratedPGliteDataDir(migrationsFolder?: string): Promise<Blob | File> {
  const db = newTestPGlite();
  try {
    const persistence = await createPGlitePersistence({ db,
      ...(migrationsFolder === undefined ? {} : { migrationsFolder }) });
    await persistence.migrate();
    return await db.dumpDataDir("none");
  } finally {
    await db.close();
  }
}
