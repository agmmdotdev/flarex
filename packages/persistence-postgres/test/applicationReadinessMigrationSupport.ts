import {
  injectMigrationFailure,
  makeDrizzleCopyFixture,
  restoreMigrationFile,
  writeJournalThrough,
} from "./migrationFixtureSupport";

const MIGRATION_NAME = "0058_demonic_doctor_doom.sql";

export async function makeApplicationReadinessMigrationFixture(label: string) {
  const fixture = await makeDrizzleCopyFixture(
    "flarex-aa-r6",
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

export async function writeApplicationReadinessJournalThrough(
  source: string,
  target: string,
  maximumIndex: 57 | 58,
) {
  return writeJournalThrough(source, target, maximumIndex);
}

export async function injectApplicationReadinessMigrationFailure(
  migrationPath: string,
) {
  return injectMigrationFailure(
    migrationPath,
    "fx_aa_r6_deliberate_missing_table",
  );
}

export async function restoreApplicationReadinessMigration(
  migrationPath: string,
  currentMigrationsFolder: string,
) {
  return restoreMigrationFile(migrationPath, currentMigrationsFolder);
}
