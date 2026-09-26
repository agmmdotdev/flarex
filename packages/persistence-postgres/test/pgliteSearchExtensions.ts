import { PGlite, type PGliteOptions } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { btree_gin } from "@electric-sql/pglite/contrib/btree_gin";

/** Latest physical migrations install the shared search GIN access path.
 * PGlite requires extension modules at construction, before SQL migration. */
function optionsWithSearchExtensions(options: PGliteOptions = {}): PGliteOptions {
  return { ...options, extensions: { ...options.extensions, pg_trgm, btree_gin } };
}

export function newTestPGlite(dataDirOrOptions?: string | PGliteOptions): PGlite {
  return typeof dataDirOrOptions === "string"
    ? new PGlite(dataDirOrOptions, optionsWithSearchExtensions())
    : new PGlite(optionsWithSearchExtensions(dataDirOrOptions));
}

export async function createTestPGlite(dataDirOrOptions?: string | PGliteOptions): Promise<PGlite> {
  const db = newTestPGlite(dataDirOrOptions);
  await db.waitReady;
  return db;
}
