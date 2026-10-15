import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TestProject } from "vitest/node";

import { createPGlitePersistence } from "../../src/database/pglite";
import { newTestPGlite } from "./pgliteSearchExtensions";

/** Schema only: every consumer restores this into its own mutable database. */
export async function buildMigratedPGliteDataDir(): Promise<Blob | File> {
  const db = newTestPGlite();
  try {
    const persistence = await createPGlitePersistence({ db });
    await persistence.migrate();
    return await db.dumpDataDir("none");
  } finally {
    await db.close();
  }
}

export default async function setup(project: TestProject) {
  const directory = await mkdtemp(join(tmpdir(), "flarex-pglite-baseline-"));
  const dispose = () => rm(directory, { recursive: true, force: true });
  try {
    const snapshot = await buildMigratedPGliteDataDir();
    const path = join(directory, "migrated.tar");
    await writeFile(path, new Uint8Array(await snapshot.arrayBuffer()));
    project.provide("pgliteMigrationBaselinePath", path);
  } catch (cause) {
    await dispose();
    throw cause;
  }
  return dispose;
}
