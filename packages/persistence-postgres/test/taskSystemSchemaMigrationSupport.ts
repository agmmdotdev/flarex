import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isNonArrayRecord } from "@flarex/utils/records";

import type { FlarexSqlClient } from "../src/index";

const MIGRATION_NAME = "0046_amusing_golden_guardian.sql";

export async function makeTaskSystemSchemaMigrationFixtureV1(label: string) {
  const root = await mkdtemp(resolve(tmpdir(), `flarex-dte04-a3-${label}-`));
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

export async function writeTaskSystemSchemaJournalThroughV1(
  source: string,
  target: string,
  maximumIndex: 45 | 46,
): Promise<void> {
  const parsed: unknown = JSON.parse(await readFile(source, "utf8"));
  if (!isNonArrayRecord(parsed) || !Array.isArray(parsed.entries)) {
    throw new Error("Drizzle journal must contain an entries array.");
  }
  const entries = parsed.entries.filter((entry): boolean => {
    if (
      !isNonArrayRecord(entry)
      || typeof entry.idx !== "number"
      || !Number.isSafeInteger(entry.idx)
    ) {
      throw new Error("Drizzle journal entry must contain a safe integer idx.");
    }
    return entry.idx <= maximumIndex;
  });
  await writeFile(target, JSON.stringify({
    ...parsed,
    entries,
  }, null, 2), "utf8");
}

export async function injectTaskSystemSchemaMigrationFailureV1(
  migrationPath: string,
): Promise<void> {
  const migration = await readFile(migrationPath, "utf8");
  await writeFile(
    migrationPath,
    `${migration}\n--> statement-breakpoint\nselect * from fx_dte04_a3_deliberate_missing_table;\n`,
    "utf8",
  );
}

export async function restoreTaskSystemSchemaMigrationV1(
  migrationPath: string,
  currentMigrationsFolder: string,
): Promise<void> {
  await writeFile(
    migrationPath,
    await readFile(resolve(currentMigrationsFolder, MIGRATION_NAME), "utf8"),
    "utf8",
  );
}

const PGLITE_SCOPE_A = "scope_70000000-0000-4000-8000-000000000001";
const SCOPE_B = "scope_70000000-0000-4000-8000-000000000002";
const TASK_DEFINITION_ID =
  "taskdef_70000000-0000-4000-8000-000000000003";
const RUN_ID = "run_70000000-0000-4000-8000-000000000004";
const ATTEMPT_ID = "attempt_70000000-0000-4000-8000-000000000005";

export interface TaskSystemSchemaContractParentV1 {
  readonly scopeId: string;
  readonly candidateSha256Hex: string;
  readonly applicationRevisionId: string;
}

/** PGlite-only upstream fixture; its embedded client has no pooled session. */
export async function seedTaskSystemSchemaContractParentForPGliteV1(
  persistence: Pick<FlarexSqlClient, "query">,
): Promise<TaskSystemSchemaContractParentV1> {
  await persistence.query(`
    insert into fx_system_scope_clock
      (scope_id, storage_generation, epoch)
    values ('${PGLITE_SCOPE_A}', 'flarexdb_v1',
      'epoch_70000000-0000-4000-8000-000000000011')
  `);

  await persistence.query("set session_replication_role = replica");
  try {
    await persistence.query(`
      insert into fx_system_application_revision_v1 (
        scope_id, candidate_sha256, revision_id, deployment_id,
        attempt_sha256, registration_input_sha256,
        semantic_attempt_identity_sha256, source_codec_identity,
        package_sha256, artifact_runtime_identity, artifact_sha256,
        schema_version_id, schema_version, manifest_codec_version,
        manifest_byte_length, schema_artifact_sha256, schema_binding_sha256,
        function_metadata_codec_version, function_metadata_byte_length,
        function_metadata_sha256, function_metadata_bytes,
        validator_root_sha256, declared_handler_set_sha256,
        registration_root_sha256, registration_frame_count,
        registration_frames_byte_length, registration_frames_bytes,
        output_manifest_sha256, output_manifest_bytes, next_progress_sha256,
        next_progress_bytes, receipt_sha256, receipt_bytes, status
      ) values (
        '${PGLITE_SCOPE_A}', decode(repeat('11', 32), 'hex'),
        'apprev_task_contract_v1', 'deployment_task_contract_v1',
        decode(repeat('12', 32), 'hex'), decode(repeat('13', 32), 'hex'),
        decode(repeat('14', 32), 'hex'),
        'flarex.source-artifact-v2/codec-v1',
        decode(repeat('15', 32), 'hex'), 'dynamic-worker',
        decode(repeat('16', 32), 'hex'), 'schema_task_contract_v1',
        1, 1, 1, decode(repeat('17', 32), 'hex'),
        decode(repeat('18', 32), 'hex'), 1, 1,
        decode(repeat('19', 32), 'hex'), decode('01', 'hex'),
        decode(repeat('1a', 32), 'hex'), decode(repeat('1b', 32), 'hex'),
        decode(repeat('1c', 32), 'hex'), 0, 0, decode('', 'hex'),
        decode(repeat('1d', 32), 'hex'), decode('01', 'hex'),
        decode(repeat('1e', 32), 'hex'), decode('01', 'hex'),
        decode(repeat('1f', 32), 'hex'), decode('01', 'hex'), 'inactive'
      )
    `);
  } finally {
    await persistence.query("set session_replication_role = origin");
  }

  return Object.freeze({
    scopeId: PGLITE_SCOPE_A,
    candidateSha256Hex: "11".repeat(32),
    applicationRevisionId: "apprev_task_contract_v1",
  });
}

/** Exercises the same Task System contract on PGlite and PostgreSQL. */
export async function assertTaskSystemSchemaContractV1(
  persistence: Pick<FlarexSqlClient, "query">,
  parent: TaskSystemSchemaContractParentV1,
): Promise<void> {
  const SCOPE_A = parent.scopeId;
  await persistence.query(`
    insert into fx_system_scope_clock
      (scope_id, storage_generation, epoch)
    values ('${SCOPE_B}', 'flarexdb_v1',
      'epoch_70000000-0000-4000-8000-000000000012')
  `);

  await persistence.query(`
    insert into fx_system_durable_task_definition_revision_v1 (
      scope_id, task_definition_revision_id, task_id,
      application_revision_id, candidate_sha256, binding_codec_version,
      binding_byte_length, binding_sha256, binding_bytes,
      application_revision_task_binding_sha256,
      canonical_task_manifest_sha256, task_runtime_entry_sha256,
      task_catalog_sha256, task_entry_root_sha256,
      task_runtime_projection_sha256, task_runtime_group_manifest_sha256,
      task_runtime_materialization_spec_sha256, package_sha256,
      artifact_sha256, source_root_sha256, semantic_root_sha256
    ) values (
      '${SCOPE_A}', '${TASK_DEFINITION_ID}', 'orders.process',
      '${parent.applicationRevisionId}',
      decode('${parent.candidateSha256Hex}', 'hex'), 1,
      1, decode(repeat('21', 32), 'hex'), decode('01', 'hex'),
      decode(repeat('22', 32), 'hex'), decode(repeat('23', 32), 'hex'),
      decode(repeat('24', 32), 'hex'), decode(repeat('25', 32), 'hex'),
      decode(repeat('26', 32), 'hex'), decode(repeat('27', 32), 'hex'),
      decode(repeat('28', 32), 'hex'), decode(repeat('29', 32), 'hex'),
      decode(repeat('2a', 32), 'hex'), decode(repeat('2b', 32), 'hex'),
      decode(repeat('2c', 32), 'hex'), decode(repeat('2d', 32), 'hex')
    )
  `);

  await persistence.query(`
    insert into fx_system_durable_task_run_v1 (
      scope_id, run_id, task_definition_revision_id, created_at_ms,
      input_codec, input_store, input_value_codec, input_object_key,
      input_byte_length, input_sha256, input_retention,
      creation_authority_codec_version, creation_authority_byte_length,
      creation_authority_sha256, creation_authority_bytes,
      aggregate_codec_version, aggregate_byte_length, aggregate_json,
      run_version, phase, due_kind, due_at_ms, current_attempt_id,
      execution_fence_basis, current_lease_version,
      current_lease_expires_at_ms, cancellation_generation,
      requested_effect_sequence
    ) values (
      '${SCOPE_A}', '${RUN_ID}', '${TASK_DEFINITION_ID}', 1000,
      'flarex.task-input-reference.v1',
      'flarex.task-input-object-store.v1', 'flarex-value/v1',
      'durable-task-input/v1/sha256/' || repeat('44', 32),
      1, decode(repeat('44', 32), 'hex'), 'run_lifetime',
      1, 1, decode(repeat('45', 32), 'hex'), decode('01', 'hex'),
      1, 1, '{"version":1}'::jsonb,
      1, 'ready', 'start_attempt', 1000, null, null, null, null, 0, 9
    )
  `);
  await persistence.query(`
    insert into fx_system_durable_task_run_request_v1 (
      scope_id, request_key_codec_version, request_key_sha256,
      request_codec_version, request_sha256, run_id, receipt_version
    ) values (
      '${SCOPE_A}', 1, decode(repeat('46', 32), 'hex'),
      1, decode(repeat('47', 32), 'hex'), '${RUN_ID}', 1
    )
  `);
  await persistence.query(`
    insert into fx_system_durable_task_attempt_identity_v1 (
      scope_id, attempt_id, run_id, attempt_number, execution_fence,
      accepted_run_version
    ) values ('${SCOPE_A}', '${ATTEMPT_ID}', '${RUN_ID}', 1, 1, 1)
  `);
  await persistence.query(`
    insert into fx_system_durable_task_requested_effect_v1 (
      scope_id, run_id, sequence, accepted_run_version, kind,
      payload_codec_version, payload_byte_length, payload_json, not_before_ms
    ) values
      ('${SCOPE_A}', '${RUN_ID}', 1, 1, 'dispatch_attempt', 1, 1, '{}'::jsonb, null),
      ('${SCOPE_A}', '${RUN_ID}', 2, 1, 'continue_retry', 1, 1, '{}'::jsonb, 1000),
      ('${SCOPE_A}', '${RUN_ID}', 3, 1, 'wake_retry', 1, 1, '{}'::jsonb, 1000),
      ('${SCOPE_A}', '${RUN_ID}', 4, 1, 'wake_lease_expiry', 1, 1, '{}'::jsonb, 1000),
      ('${SCOPE_A}', '${RUN_ID}', 5, 1, 'request_execution_cancellation', 1, 1, '{}'::jsonb, null),
      ('${SCOPE_A}', '${RUN_ID}', 6, 1, 'release_queue_ownership', 1, 1, '{}'::jsonb, null),
      ('${SCOPE_A}', '${RUN_ID}', 7, 1, 'publish_lifecycle_event', 1, 1, '{}'::jsonb, null),
      ('${SCOPE_A}', '${RUN_ID}', 8, 1, 'notify_current_state', 1, 1, '{}'::jsonb, null),
      ('${SCOPE_A}', '${RUN_ID}', 9, 1, 'cancel_obsolete_lease_wake', 1, 1, '{}'::jsonb, null)
  `);

  for (const update of [
    `phase = 'retry_waiting', due_kind = 'start_attempt', due_at_ms = 1100,
      current_attempt_id = null, execution_fence_basis = 1,
      current_lease_version = null, current_lease_expires_at_ms = null`,
    `phase = 'attempt_granted', due_kind = 'handle_lease_expiry',
      due_at_ms = 1200, current_attempt_id = '${ATTEMPT_ID}',
      execution_fence_basis = 1, current_lease_version = 1,
      current_lease_expires_at_ms = 1200`,
    `phase = 'executing', due_kind = 'handle_lease_expiry',
      due_at_ms = 1200, current_attempt_id = '${ATTEMPT_ID}',
      execution_fence_basis = 1, current_lease_version = 1,
      current_lease_expires_at_ms = 1200`,
    `phase = 'terminal', due_kind = null, due_at_ms = null,
      current_attempt_id = null, execution_fence_basis = null,
      current_lease_version = null, current_lease_expires_at_ms = null`,
    `phase = 'ready', due_kind = 'start_attempt', due_at_ms = 1000,
      current_attempt_id = null, execution_fence_basis = null,
      current_lease_version = null, current_lease_expires_at_ms = null`,
  ]) {
    await persistence.query(`
      update fx_system_durable_task_run_v1 set ${update}
      where scope_id = '${SCOPE_A}' and run_id = '${RUN_ID}'
    `);
  }

  const checkFailures = [
    ["fx_task_definition_v1_identity_check",
      "update fx_system_durable_task_definition_revision_v1 set task_id = ' '"],
    ["fx_task_definition_v1_binding_check",
      "update fx_system_durable_task_definition_revision_v1 set binding_codec_version = 2"],
    ["fx_task_definition_v1_projection_check",
      "update fx_system_durable_task_definition_revision_v1 set package_sha256 = decode('01', 'hex')"],
    ["fx_task_run_v1_identity_check",
      "update fx_system_durable_task_run_v1 set created_at_ms = -1"],
    ["fx_task_run_v1_input_check",
      "update fx_system_durable_task_run_v1 set input_codec = 'invalid'"],
    ["fx_task_run_v1_authority_check",
      "update fx_system_durable_task_run_v1 set creation_authority_codec_version = 2"],
    ["fx_task_run_v1_aggregate_check",
      "update fx_system_durable_task_run_v1 set aggregate_codec_version = 2"],
    ["fx_task_run_v1_projection_counter_check",
      "update fx_system_durable_task_run_v1 set run_version = 0"],
    ["fx_task_run_v1_projection_shape_check",
      "update fx_system_durable_task_run_v1 set phase = 'terminal'"],
    ["fx_task_run_v1_projection_value_check",
      "update fx_system_durable_task_run_v1 set due_at_ms = -1"],
    ["fx_task_run_request_v1_identity_check",
      "update fx_system_durable_task_run_request_v1 set receipt_version = 2"],
    ["fx_task_attempt_identity_v1_value_check",
      "update fx_system_durable_task_attempt_identity_v1 set attempt_number = 0"],
    ["fx_task_requested_effect_v1_identity_check",
      "update fx_system_durable_task_requested_effect_v1 set accepted_run_version = 0 where sequence = 1"],
    ["fx_task_requested_effect_v1_payload_check",
      "update fx_system_durable_task_requested_effect_v1 set payload_codec_version = 2 where sequence = 1"],
    ["fx_task_requested_effect_v1_schedule_check",
      "update fx_system_durable_task_requested_effect_v1 set not_before_ms = 1000 where sequence = 1"],
  ] as const;
  for (const [constraint, statement] of checkFailures) {
    await expectConstraintRejection(persistence, statement, constraint);
  }

  await expectConstraintRejection(
    persistence,
    `insert into fx_system_durable_task_run_v1
       select '${SCOPE_B}',
         'run_70000000-0000-4000-8000-000000000006',
         task_definition_revision_id, created_at_ms, input_codec, input_store,
         input_value_codec, input_object_key, input_byte_length, input_sha256,
         input_retention, creation_authority_codec_version,
         creation_authority_byte_length, creation_authority_sha256,
         creation_authority_bytes, aggregate_codec_version,
         aggregate_byte_length, aggregate_json, run_version, phase, due_kind,
         due_at_ms, current_attempt_id, execution_fence_basis,
         current_lease_version, current_lease_expires_at_ms,
         cancellation_generation, requested_effect_sequence
       from fx_system_durable_task_run_v1
       where scope_id = '${SCOPE_A}' and run_id = '${RUN_ID}'`,
    "fx_task_run_v1_definition_fk",
  );
  await expectConstraintRejection(
    persistence,
    `insert into fx_system_durable_task_run_request_v1 values (
      '${SCOPE_A}', 1, decode(repeat('48', 32), 'hex'), 1,
      decode(repeat('49', 32), 'hex'), '${RUN_ID}', 1
    )`,
    "fx_task_run_request_v1_run_unique",
  );
  await expectConstraintRejection(
    persistence,
    `insert into fx_system_durable_task_attempt_identity_v1 values (
      '${SCOPE_A}', 'attempt_70000000-0000-4000-8000-000000000007',
      '${RUN_ID}', 1, 2, 2
    )`,
    "fx_task_attempt_identity_v1_ordinal_unique",
  );
  await expectConstraintRejection(
    persistence,
    `insert into fx_system_durable_task_attempt_identity_v1 values (
      '${SCOPE_A}', 'attempt_70000000-0000-4000-8000-000000000008',
      '${RUN_ID}', 2, 1, 2
    )`,
    "fx_task_attempt_identity_v1_fence_unique",
  );
  await expectConstraintRejection(
    persistence,
    `insert into fx_system_durable_task_requested_effect_v1 values (
      '${SCOPE_A}', '${RUN_ID}', 1, 1, 'dispatch_attempt',
      1, 1, '{}'::jsonb, null
    )`,
    "fx_task_requested_effect_v1_pk",
  );
}

async function expectConstraintRejection(
  persistence: Pick<FlarexSqlClient, "query">,
  statement: string,
  constraint: string,
): Promise<void> {
  try {
    await persistence.query(statement);
  } catch (error) {
    const detail = String(error);
    if (detail.includes(constraint)) {
      return;
    }
    throw new Error(
      `Expected ${constraint}, received: ${detail}`,
      { cause: error },
    );
  }
  throw new Error(`Expected ${constraint} to reject the statement.`);
}
