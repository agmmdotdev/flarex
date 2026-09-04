import {
  injectMigrationFailure,
  makeDrizzleCopyFixture,
  restoreMigrationFile,
  writeJournalThrough,
} from "./migrationFixtureSupport";

const MIGRATION_NAME = "0045_jazzy_secret_warriors.sql";

export async function makeApplicationActionMigrationFixtureV1(label: string) {
  return makeDrizzleCopyFixture("flarex-aav-a1", label, MIGRATION_NAME);
}

export async function writeApplicationActionJournalThroughV1(
  source: string,
  target: string,
  maximumIndex: 44 | 45,
) {
  return writeJournalThrough(source, target, maximumIndex);
}

export async function injectApplicationActionMigrationFailureV1(
  migrationPath: string,
) {
  return injectMigrationFailure(
    migrationPath,
    "fx_aav_a1_deliberate_missing_table",
  );
}

export async function restoreApplicationActionMigrationV1(
  migrationPath: string,
  currentMigrationsFolder: string,
) {
  return restoreMigrationFile(migrationPath, currentMigrationsFolder);
}
