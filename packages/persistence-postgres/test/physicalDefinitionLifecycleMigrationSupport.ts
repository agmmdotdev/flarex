import {
  injectMigrationFailure,
  makeDrizzleCopyFixture,
  restoreMigrationFile,
  writeJournalThrough,
} from "./migrationFixtureSupport";

const MIGRATION_NAME = "0067_freezing_tony_stark.sql";

export async function makePhysicalDefinitionLifecycleMigrationFixture(
  label: string,
) {
  const fixture = await makeDrizzleCopyFixture(
    "flarex-m05-b1",
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

export async function writePhysicalDefinitionLifecycleJournalThrough(
  source: string,
  target: string,
  maximumIndex: 66 | 67,
) {
  return writeJournalThrough(source, target, maximumIndex);
}

export async function injectPhysicalDefinitionLifecycleMigrationFailure(
  migrationPath: string,
) {
  return injectMigrationFailure(
    migrationPath,
    "fx_m05_b1_deliberate_missing_table",
  );
}

export async function restorePhysicalDefinitionLifecycleMigration(
  migrationPath: string,
  currentMigrationsFolder: string,
) {
  return restoreMigrationFile(migrationPath, currentMigrationsFolder);
}
