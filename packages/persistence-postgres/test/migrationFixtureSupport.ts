import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface DrizzleCopyFixture {
  readonly root: string;
  readonly migrationsFolder: string;
  readonly currentMigrationsFolder: string;
  readonly currentJournal: string;
  readonly temporaryJournal: string;
  readonly migrationPath: string;
  readonly cleanup: () => Promise<void>;
}

/**
 * Copies the package drizzle tree into an isolated temp dir for migration
 * tests. Caller-owned migration names, journal bounds, failure tables, and
 * receipt shapes stay with each *MigrationSupport module; only the exact
 * copy/journal/failure/restore mechanics live here.
 */
export async function makeDrizzleCopyFixture(
  labelPrefix: string,
  label: string,
  migrationName: string,
): Promise<DrizzleCopyFixture> {
  const root = await mkdtemp(resolve(tmpdir(), `${labelPrefix}-${label}-`));
  const migrationsFolder = resolve(root, "drizzle");
  const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const currentMigrationsFolder = resolve(packageRoot, "drizzle");
  const currentJournal = resolve(currentMigrationsFolder, "meta/_journal.json");
  const temporaryJournal = resolve(migrationsFolder, "meta/_journal.json");
  const migrationPath = resolve(migrationsFolder, migrationName);
  await cp(currentMigrationsFolder, migrationsFolder, { recursive: true });
  return Object.freeze({
    root,
    migrationsFolder,
    currentMigrationsFolder,
    currentJournal,
    temporaryJournal,
    migrationPath,
    cleanup: () => rm(root, { recursive: true, force: true }),
  });
}

/** Rewrites a drizzle journal keeping only entries at or below an index. */
export async function writeJournalThrough(
  source: string,
  target: string,
  maximumIndex: number,
): Promise<void> {
  const journal = JSON.parse(await readFile(source, "utf8")) as {
    entries: ReadonlyArray<Readonly<{ idx: number }>>;
  };
  await writeFile(target, `${JSON.stringify({
    ...journal,
    entries: journal.entries.filter(entry => entry.idx <= maximumIndex),
  }, null, 2)}\n`, "utf8");
}

/** Appends a deterministic failure statement to a copied migration file. */
export async function injectMigrationFailure(
  migrationPath: string,
  missingTable: string,
): Promise<void> {
  const migration = await readFile(migrationPath, "utf8");
  await writeFile(
    migrationPath,
    `${migration}\n--> statement-breakpoint\nselect * from ${missingTable};\n`,
    "utf8",
  );
}

/** Restores a copied migration file from the package drizzle tree. */
export async function restoreMigrationFile(
  migrationPath: string,
  currentMigrationsFolder: string,
): Promise<void> {
  await writeFile(
    migrationPath,
    await readFile(
      resolve(currentMigrationsFolder, basename(migrationPath)),
      "utf8",
    ),
    "utf8",
  );
}
