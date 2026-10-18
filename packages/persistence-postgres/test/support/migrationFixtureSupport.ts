import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Schema } from "effect";
import { copyDrizzleMigrations } from "../../src/testing/systemTestMigrationFiles";

// Only the fields used by this helper are decoded. Drizzle and scenario-owned
// metadata, including unknown entry fields, must survive the journal rewrite.
const decodeJournal = Schema.decodeUnknownSync(Schema.Struct({
  entries: Schema.Array(Schema.Struct({ idx: Schema.Int })),
}), { onExcessProperty: "preserve" });

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
 * Copies runtime migration inputs into an isolated temp dir for migration
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
  const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const currentMigrationsFolder = resolve(packageRoot, "drizzle");
  const currentJournal = resolve(currentMigrationsFolder, "meta/_journal.json");
  const temporaryJournal = resolve(migrationsFolder, "meta/_journal.json");
  const migrationPath = resolve(migrationsFolder, migrationName);
  try {
    await copyDrizzleMigrations(currentMigrationsFolder, migrationsFolder);
  } catch (cause) {
    try { await rm(root, { recursive: true, force: true }); } catch (cleanupCause) {
      throw new AggregateError([cause, cleanupCause], "Migration fixture copy and cleanup failed");
    }
    throw cause;
  }
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
  const journal = decodeJournal(JSON.parse(await readFile(source, "utf8")));
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
