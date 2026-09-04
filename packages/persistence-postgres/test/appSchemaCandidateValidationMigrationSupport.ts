import {
  injectMigrationFailure,
  makeDrizzleCopyFixture,
  restoreMigrationFile,
  writeJournalThrough,
} from "./migrationFixtureSupport";

const MIGRATION_NAME = "0057_absurd_bug.sql";

export async function makeAppSchemaCandidateValidationMigrationFixture(
  label: string,
) {
  const fixture = await makeDrizzleCopyFixture(
    "flarex-m03-a",
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

export async function writeAppSchemaCandidateValidationJournalThrough(
  source: string,
  target: string,
  maximumIndex: 56 | 57,
) {
  return writeJournalThrough(source, target, maximumIndex);
}

export async function injectAppSchemaCandidateValidationMigrationFailure(
  migrationPath: string,
) {
  return injectMigrationFailure(
    migrationPath,
    "fx_m03_a_deliberate_missing_table",
  );
}

export async function restoreAppSchemaCandidateValidationMigration(
  migrationPath: string,
  currentMigrationsFolder: string,
) {
  return restoreMigrationFile(migrationPath, currentMigrationsFolder);
}
