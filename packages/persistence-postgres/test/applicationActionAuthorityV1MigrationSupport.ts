import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const MIGRATION_NAME = "0045_jazzy_secret_warriors.sql";

export async function makeApplicationActionMigrationFixtureV1(label: string) {
  const root = await mkdtemp(resolve(tmpdir(), `flarex-aav-a1-${label}-`));
  const migrationsFolder = resolve(root, "drizzle");
  const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const currentMigrationsFolder = resolve(packageRoot, "drizzle");
  const currentJournal = resolve(currentMigrationsFolder, "meta/_journal.json");
  const temporaryJournal = resolve(migrationsFolder, "meta/_journal.json");
  const migrationPath = resolve(migrationsFolder, MIGRATION_NAME);
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

export async function writeApplicationActionJournalThroughV1(
  source: string,
  target: string,
  maximumIndex: 44 | 45,
) {
  const journal = JSON.parse(await readFile(source, "utf8")) as {
    entries: ReadonlyArray<Readonly<{ idx: number }>>;
  };
  await writeFile(target, JSON.stringify({
    ...journal,
    entries: journal.entries.filter(entry => entry.idx <= maximumIndex),
  }, null, 2), "utf8");
}

export async function injectApplicationActionMigrationFailureV1(
  migrationPath: string,
) {
  const migration = await readFile(migrationPath, "utf8");
  await writeFile(
    migrationPath,
    `${migration}\n--> statement-breakpoint\nselect * from fx_aav_a1_deliberate_missing_table;\n`,
    "utf8",
  );
}

export async function restoreApplicationActionMigrationV1(
  migrationPath: string,
  currentMigrationsFolder: string,
) {
  await writeFile(
    migrationPath,
    await readFile(resolve(currentMigrationsFolder, MIGRATION_NAME), "utf8"),
    "utf8",
  );
}
