import {
  injectMigrationFailure,
  makeDrizzleCopyFixture,
  restoreMigrationFile,
  writeJournalThrough,
} from "./migrationFixtureSupport";

const MIGRATION_NAME = "0051_chemical_gorilla_man.sql";

export async function makeIndexedRangeJournalMigrationFixtureV1(label: string) {
  const fixture = await makeDrizzleCopyFixture(
    "flarex-o10-a",
    label,
    MIGRATION_NAME,
  );
  return Object.freeze({
    migrationsFolder: fixture.migrationsFolder,
    currentMigrationsFolder: fixture.currentMigrationsFolder,
    currentJournal: fixture.currentJournal,
    temporaryJournal: fixture.temporaryJournal,
    migrationPath: fixture.migrationPath,
    cleanup: fixture.cleanup,
  });
}

export async function writeIndexedRangeJournalThroughV1(
  source: string,
  target: string,
  maximumIndex: 50 | 51,
) {
  return writeJournalThrough(source, target, maximumIndex);
}

export async function injectIndexedRangeJournalMigrationFailureV1(
  migrationPath: string,
) {
  return injectMigrationFailure(
    migrationPath,
    "fx_o10_a_deliberate_missing_table",
  );
}

export async function restoreIndexedRangeJournalMigrationV1(
  migrationPath: string,
  currentMigrationsFolder: string,
) {
  return restoreMigrationFile(migrationPath, currentMigrationsFolder);
}
