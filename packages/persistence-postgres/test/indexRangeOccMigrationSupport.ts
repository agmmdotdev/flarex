import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const MIGRATION_NAME = "0052_last_old_lace.sql";

export async function makeIndexRangeOccMigrationFixtureV1(label: string) {
  const root = await mkdtemp(resolve(tmpdir(), `flarex-o10-b-${label}-`));
  const migrationsFolder = resolve(root, "drizzle");
  const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const currentMigrationsFolder = resolve(packageRoot, "drizzle");
  const currentJournal = resolve(currentMigrationsFolder, "meta/_journal.json");
  const temporaryJournal = resolve(migrationsFolder, "meta/_journal.json");
  const migrationPath = resolve(migrationsFolder, MIGRATION_NAME);
  await cp(currentMigrationsFolder, migrationsFolder, { recursive: true });
  return Object.freeze({
    migrationsFolder,
    currentMigrationsFolder,
    currentJournal,
    temporaryJournal,
    migrationPath,
    cleanup: () => rm(root, { recursive: true, force: true }),
  });
}

export async function writeIndexRangeOccJournalThroughV1(
  source: string,
  target: string,
  maximumIndex: 51 | 52,
) {
  const journal = JSON.parse(await readFile(source, "utf8")) as {
    entries: ReadonlyArray<Readonly<{ idx: number }>>;
  };
  await writeFile(target, `${JSON.stringify({
    ...journal,
    entries: journal.entries.filter(entry => entry.idx <= maximumIndex),
  }, null, 2)}\n`, "utf8");
}

export async function injectIndexRangeOccMigrationFailureV1(
  migrationPath: string,
) {
  const migration = await readFile(migrationPath, "utf8");
  await writeFile(
    migrationPath,
    `${migration}\n--> statement-breakpoint\nselect * from fx_o10_b_deliberate_missing_table;\n`,
    "utf8",
  );
}

export async function restoreIndexRangeOccMigrationV1(
  migrationPath: string,
  currentMigrationsFolder: string,
) {
  await writeFile(
    migrationPath,
    await readFile(resolve(currentMigrationsFolder, MIGRATION_NAME), "utf8"),
    "utf8",
  );
}
