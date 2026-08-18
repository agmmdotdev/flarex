import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const FIRST_MIGRATION_NAME = "0068_lumpy_pyro.sql";

export interface MigrationQueryPort {
  readonly query: <Row extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    params?: ReadonlyArray<unknown>,
  ) => Promise<Readonly<{ readonly rows: ReadonlyArray<Row> }>>;
}

export async function makePhysicalDefinitionRetirementMigrationFixture(
  label: string,
) {
  const root = await mkdtemp(resolve(tmpdir(), `flarex-m05-b3-${label}-`));
  const migrationsFolder = resolve(root, "drizzle");
  const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const currentMigrationsFolder = resolve(packageRoot, "drizzle");
  const currentJournal = resolve(currentMigrationsFolder, "meta/_journal.json");
  const temporaryJournal = resolve(migrationsFolder, "meta/_journal.json");
  await cp(currentMigrationsFolder, migrationsFolder, { recursive: true });
  return Object.freeze({
    migrationsFolder,
    currentJournal,
    temporaryJournal,
    cleanup: () => rm(root, { recursive: true, force: true }),
  });
}

export async function writePhysicalDefinitionRetirementJournalThrough(
  source: string,
  target: string,
  maximumIndex: 67 | 68,
) {
  const journal = JSON.parse(await readFile(source, "utf8")) as {
    entries: ReadonlyArray<Readonly<{ idx: number }>>;
  };
  await writeFile(target, `${JSON.stringify({
    ...journal,
    entries: journal.entries.filter(entry => entry.idx <= maximumIndex),
  }, null, 2)}\n`, "utf8");
}

export async function seedApplicationTaskRunBeforeRetirementMigration(
  persistence: MigrationQueryPort,
  revisionId: string | null,
) {
  const authority = revisionId === null
    ? { authority: { runtimeTarget: {} } }
    : { authority: { runtimeTarget: { revisionId } } };
  const authorityBytes = new TextEncoder().encode(JSON.stringify(authority));
  if (revisionId !== null) {
    await persistence.query("set session_replication_role = replica");
    try {
      await persistence.query(
        `insert into fx_system_application_revision_schema_v1
           (scope_id, revision_id, deployment_id, application_schema_sha256,
            schema_version_id, schema_version, schema_manifest_sha256,
            schema_binding_sha256)
         values
           ('scope_95000000-0000-4000-8000-000000000001', $1,
            'deployment_m05_b3', decode(repeat('41', 32), 'hex'),
            'schema_m05_b3', 1, decode(repeat('42', 32), 'hex'),
            decode(repeat('43', 32), 'hex'))`,
        [revisionId],
      );
    } finally {
      await persistence.query("set session_replication_role = origin");
    }
  }
  await persistence.query(
    `insert into fx_system_durable_task_run_v1
       (scope_id, run_id, definition_generation, task_definition_revision_id,
        application_task_runtime_target_sha256, created_at_ms,
        input_codec, input_store, input_value_codec, input_object_key,
        input_byte_length, input_sha256, input_retention,
        execution_principal_generation,
        creation_authority_codec_version, creation_authority_byte_length,
        creation_authority_sha256, creation_authority_bytes,
        aggregate_codec_version, aggregate_byte_length, aggregate_json,
        run_version, phase, due_kind, due_at_ms, current_attempt_id,
        execution_fence_basis, current_lease_version,
        current_lease_expires_at_ms, cancellation_generation,
        requested_effect_sequence)
     values
       ('scope_95000000-0000-4000-8000-000000000001',
        'run_96000000-0000-4000-8000-000000000001',
        'application_v1', null, decode(repeat('22', 32), 'hex'), 1,
        'flarex.task-input-reference.v1',
        'flarex.task-input-object-store.v1', 'flarex-value/v1',
        'durable-task-input/v1/sha256/' || repeat('11', 32),
        1, decode(repeat('11', 32), 'hex'), 'run_lifetime',
        'legacy_absent', 1, $1, decode(repeat('33', 32), 'hex'), $2,
        1, 2, '{}'::jsonb, 1, 'ready', 'start_attempt', 1,
        null, null, null, null, 0, 0)`,
    [BigInt(authorityBytes.byteLength), authorityBytes],
  );
}

export async function retirementMigrationInventory(
  persistence: MigrationQueryPort,
  migrationsSchema = "drizzle",
) {
  const quotedSchema = `"${migrationsSchema.replaceAll('"', '""')}"`;
  const result = await persistence.query<{
    application_revision_id: string | null;
    column_count: number;
    foreign_key_count: number;
    index_count: number;
    receipts: number;
  }>(`
    select
      (select application_revision_id
         from fx_system_durable_task_run_v1
        where run_id = 'run_96000000-0000-4000-8000-000000000001')
        as application_revision_id,
      (select count(*)::int
         from information_schema.columns
        where table_schema = current_schema()
          and table_name = 'fx_system_durable_task_run_v1'
          and column_name = 'application_revision_id') as column_count,
      (select count(*)::int
         from pg_constraint
        where conname = 'fx_task_run_v1_application_revision_fk')
        as foreign_key_count,
      (select count(*)::int
         from pg_indexes
        where schemaname = current_schema()
          and indexname in (
            'fx_action_invocation_v1_application_retirement_pin_idx',
            'fx_task_run_v1_application_retirement_pin_idx',
            'fx_system_snapshot_lease_retirement_pin_idx',
            'fx_system_tx_session_application_retirement_pin_idx'
          )) as index_count,
      (select count(*)::int from ${quotedSchema}.__drizzle_migrations) as receipts
  `);
  return result.rows[0];
}

export async function retirementMigrationWasRolledBack(
  persistence: MigrationQueryPort,
  migrationsSchema = "drizzle",
) {
  const quotedSchema = `"${migrationsSchema.replaceAll('"', '""')}"`;
  const result = await persistence.query<{
    column_count: number;
    receipts: number;
    row_count: number;
  }>(`
    select
      (select count(*)::int
         from information_schema.columns
        where table_schema = current_schema()
          and table_name = 'fx_system_durable_task_run_v1'
          and column_name = 'application_revision_id') as column_count,
      (select count(*)::int from ${quotedSchema}.__drizzle_migrations) as receipts,
      (select count(*)::int from fx_system_durable_task_run_v1) as row_count
  `);
  return result.rows[0];
}

export const physicalDefinitionRetirementFirstMigrationName =
  FIRST_MIGRATION_NAME;
