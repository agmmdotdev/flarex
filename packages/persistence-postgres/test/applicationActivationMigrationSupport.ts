import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const LEGACY_MIGRATION_NAME = "0059_pretty_toad_men.sql";
const CUTOVER_MIGRATION_NAME = "0075_omniscient_galactus.sql";

export const LEGACY_ACTIVATION_CUTOVER_SCOPE_ID =
  "scope_application_activation_cutover";
export const LEGACY_ACTIVATION_CUTOVER_REVISION_ID = "r".repeat(300);
export const LEGACY_ACTIVATION_CUTOVER_READINESS_SHA256 = "11".repeat(32);
export const LEGACY_ACTIVATION_CUTOVER_ACTIVATION_SHA256 = "33".repeat(32);
export const LEGACY_ACTIVATION_CUTOVER_HEAD_SHA256 = "44".repeat(32);
export const LEGACY_ACTIVATION_CUTOVER_ACTIVATION_BYTES =
  "legacy-activation-frame-v1";
export const LEGACY_ACTIVATION_CUTOVER_HEAD_BYTES = "legacy-head-frame-v1";

export async function makeApplicationActivationMigrationFixture(label: string) {
  return makeMigrationFixture(label, LEGACY_MIGRATION_NAME, "flarex-aa-r6");
}

export async function makeApplicationActivationCutoverMigrationFixture(
  label: string,
) {
  return makeMigrationFixture(label, CUTOVER_MIGRATION_NAME, "flarex-ra01");
}

async function makeMigrationFixture(
  label: string,
  migrationName: string,
  prefix: string,
) {
  const root = await mkdtemp(resolve(tmpdir(), `${prefix}-${label}-`));
  const migrationsFolder = resolve(root, "drizzle");
  const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const currentMigrationsFolder = resolve(packageRoot, "drizzle");
  const currentJournal = resolve(currentMigrationsFolder, "meta/_journal.json");
  const temporaryJournal = resolve(migrationsFolder, "meta/_journal.json");
  const migrationPath = resolve(migrationsFolder, migrationName);
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

export async function writeApplicationActivationJournalThrough(
  source: string,
  target: string,
  maximumIndex: 58 | 59 | 74 | 75,
) {
  const journal = JSON.parse(await readFile(source, "utf8")) as {
    entries: ReadonlyArray<Readonly<{ idx: number }>>;
  };
  await writeFile(target, `${JSON.stringify({
    ...journal,
    entries: journal.entries.filter(entry => entry.idx <= maximumIndex),
  }, null, 2)}\n`, "utf8");
}

export async function injectApplicationActivationMigrationFailure(
  migrationPath: string,
) {
  const migration = await readFile(migrationPath, "utf8");
  await writeFile(
    migrationPath,
    `${migration}\n--> statement-breakpoint\nselect * from fx_aa_r6_deliberate_missing_table;\n`,
    "utf8",
  );
}

export async function restoreApplicationActivationMigration(
  migrationPath: string,
  currentMigrationsFolder: string,
) {
  await writeFile(
    migrationPath,
    await readFile(
      resolve(currentMigrationsFolder, basename(migrationPath)),
      "utf8",
    ),
    "utf8",
  );
}

export function legacyApplicationActivationCutoverSeedStatements():
  ReadonlyArray<string> {
  return Object.freeze([
    `alter table fx_system_application_readiness_v1
       drop constraint fx_application_readiness_v1_publication_fk,
       drop constraint fx_application_readiness_v1_schema_fk,
       drop constraint fx_application_readiness_v1_task_fk`,
    `insert into fx_system_application_readiness_v1 (
       scope_id, revision_id, deployment_id, candidate_id, analysis_id,
       source_artifact_root_sha256, manifest_sha256, publication_sha256,
       application_schema_sha256, function_catalog_sha256,
       storage_generation, storage_generation_fence, epoch,
       schema_version_id, schema_manifest_sha256, schema_binding_sha256,
       task_catalog_binding_sha256, runtime_host_identity, compatibility_date,
       cold_receipt_set_sha256, candidate_validation_receipt_sha256,
       unique_constraint_status, unique_constraint_eligibility_sha256,
       physical_readiness_sha256, readiness_sha256, readiness_bytes, ready_at
     ) values (
       '${LEGACY_ACTIVATION_CUTOVER_SCOPE_ID}', repeat('r', 300),
       'deployment_application_activation_cutover', 'candidate-cutover',
       'analysis-cutover', decode(repeat('01', 32), 'hex'),
       decode(repeat('02', 32), 'hex'), decode(repeat('03', 32), 'hex'),
       decode(repeat('04', 32), 'hex'), decode(repeat('05', 32), 'hex'),
       'flarexdb_v1', 1, 'epoch-cutover', 'schema-cutover',
       decode(repeat('06', 32), 'hex'), decode(repeat('07', 32), 'hex'),
       decode(repeat('08', 32), 'hex'), 'runtime-cutover', '2026-08-25',
       decode(repeat('09', 32), 'hex'), decode(repeat('0a', 32), 'hex'),
       'not_required', decode(repeat('0b', 32), 'hex'),
       decode(repeat('0c', 32), 'hex'),
       decode(repeat('11', 32), 'hex'),
       convert_to('legacy-readiness-frame-v1', 'UTF8'),
       timestamptz '2026-08-25 12:00:00+00'
     )`,
    `insert into fx_system_application_activation_v1 (
       scope_id, activation_sequence, previous_activation_sequence,
       revision_id, readiness_sha256, activation_request_sha256,
       activation_sha256, activation_bytes, activated_at
     ) values (
       '${LEGACY_ACTIVATION_CUTOVER_SCOPE_ID}', 1, null, repeat('r', 300),
       decode(repeat('11', 32), 'hex'), decode(repeat('22', 32), 'hex'),
       decode(repeat('33', 32), 'hex'),
       convert_to('${LEGACY_ACTIVATION_CUTOVER_ACTIVATION_BYTES}', 'UTF8'),
       timestamptz '2026-08-25 12:01:00+00'
     )`,
    `insert into fx_system_application_active_head_v1 (
       scope_id, activation_sequence, revision_id, readiness_sha256,
       activation_sha256, head_sha256, head_bytes, created_at, updated_at
     ) values (
       '${LEGACY_ACTIVATION_CUTOVER_SCOPE_ID}', 1, repeat('r', 300),
       decode(repeat('11', 32), 'hex'), decode(repeat('33', 32), 'hex'),
       decode(repeat('44', 32), 'hex'),
       convert_to('${LEGACY_ACTIVATION_CUTOVER_HEAD_BYTES}', 'UTF8'),
       timestamptz '2026-08-25 12:01:00+00',
       timestamptz '2026-08-25 12:01:00+00'
     )`,
  ]);
}

export function invalidApplicationActivationWitnessStatements():
  ReadonlyArray<string> {
  return Object.freeze([
    `update fx_system_application_activation
        set legacy_readiness_sha256 = null
      where scope_id = '${LEGACY_ACTIVATION_CUTOVER_SCOPE_ID}'`,
    `update fx_system_application_activation
        set relation_readiness_sha256 = readiness_sha256
      where scope_id = '${LEGACY_ACTIVATION_CUTOVER_SCOPE_ID}'`,
    `insert into fx_system_application_activation (
       scope_id, activation_sequence, previous_activation_sequence,
       revision_id, readiness_contract_version, readiness_sha256,
       relation_readiness_sha256, relation_count,
       activation_request_sha256, activation_sha256, activation_bytes,
       activated_at
     ) values (
       '${LEGACY_ACTIVATION_CUTOVER_SCOPE_ID}', 2, 1, repeat('r', 300), 2,
       decode(repeat('11', 32), 'hex'), decode(repeat('11', 32), 'hex'), 1,
       decode(repeat('55', 32), 'hex'), decode(repeat('66', 32), 'hex'),
       convert_to('invalid-missing-relation-set-witness', 'UTF8'),
       timestamptz '2026-08-25 12:02:00+00'
     )`,
  ]);
}
