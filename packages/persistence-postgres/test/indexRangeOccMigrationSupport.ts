import {
  injectMigrationFailure,
  makeDrizzleCopyFixture,
  restoreMigrationFile,
  writeJournalThrough,
} from "./migrationFixtureSupport";

const MIGRATION_NAME = "0052_last_old_lace.sql";

export async function makeIndexRangeOccMigrationFixtureV1(label: string) {
  const fixture = await makeDrizzleCopyFixture(
    "flarex-o10-b",
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

export async function writeIndexRangeOccJournalThroughV1(
  source: string,
  target: string,
  maximumIndex: 51 | 52,
) {
  return writeJournalThrough(source, target, maximumIndex);
}

export async function injectIndexRangeOccMigrationFailureV1(
  migrationPath: string,
) {
  return injectMigrationFailure(
    migrationPath,
    "fx_o10_b_deliberate_missing_table",
  );
}

export async function restoreIndexRangeOccMigrationV1(
  migrationPath: string,
  currentMigrationsFolder: string,
) {
  return restoreMigrationFile(migrationPath, currentMigrationsFolder);
}
