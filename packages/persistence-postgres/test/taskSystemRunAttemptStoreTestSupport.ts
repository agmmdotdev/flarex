import {
  encodePersistedTaskRunAttemptAggregateJsonV1,
  decodeTaskDefinitionRevisionIdV1,
  projectTaskRunAttemptPersistenceV1,
  type TaskCancellationGenerationV1,
  type TaskComputeProfileRefV1,
  type TaskDatabaseTimeMsV1,
  type TaskDurationMsV1,
  type TaskMaximumAttemptsV1,
  type TaskRetryFactorV1,
  type TaskRunAttemptAggregateV1,
  type TaskRunIdV1,
  type TaskRunVersionV1,
} from "@flarex/durable-task/internal/run-attempt-v1";
import { Brand, Result } from "effect";
import { ScopeIdSchema } from "flarex-protocol/storage-authority";

import type { FlarexSqlClient } from "../src/index";
import { getScopeClock } from "../src/scopeClock";
import type {
  LocatedTrustedScopeAuthority,
  TrustedScopeAuthority,
} from "../src/scopeAuthorityResolution";
import type { ScopePhysicalLocator } from "../src/scopeMetadataTypes";
import type {
  LocatedTaskSystemRunAttemptTargetV1,
} from "../src/taskSystemRunAttemptStoreV1";

export const TASK_SCOPE_ID =
  "scope_72000000-0000-4000-8000-000000000001";
export const TASK_DEFINITION_ID =
  "taskdef_72000000-0000-4000-8000-000000000002";
export const TASK_RUN_ID =
  "run_72000000-0000-4000-8000-000000000003";
export const COLLIDING_ATTEMPT_UUID =
  "72000000-0000-4000-8000-000000000004";
export const ACCEPTED_ATTEMPT_UUID =
  "72000000-0000-4000-8000-000000000005";
export const TASK_LOCATOR = Object.freeze({
  kind: "shared_database",
  databaseKey: "primary",
  schemaName: "public",
} satisfies ScopePhysicalLocator);

const runVersion = Brand.nominal<TaskRunVersionV1>();
const databaseTime = Brand.nominal<TaskDatabaseTimeMsV1>();
const duration = Brand.nominal<TaskDurationMsV1>();
const cancellationGeneration =
  Brand.nominal<TaskCancellationGenerationV1>();
const computeProfile = Brand.nominal<TaskComputeProfileRefV1>();
const maximumAttempts = Brand.nominal<TaskMaximumAttemptsV1>();
const retryFactor = Brand.nominal<TaskRetryFactorV1>();
const runId = Brand.nominal<TaskRunIdV1>();
const taskDefinitionRevisionId = Result.getOrThrow(
  decodeTaskDefinitionRevisionIdV1(TASK_DEFINITION_ID),
);

export function readyTaskRunAggregateV1(): TaskRunAttemptAggregateV1 {
  return {
    version: "flarex.task-run-attempt-aggregate.v1",
    runId: runId(TASK_RUN_ID),
    taskDefinitionRevisionId,
    createdAtMs: databaseTime(0),
    runVersion: runVersion(1n),
    boundPolicy: {
      runAttempt: {
        version: 1,
        retry: {
          maxAttempts: maximumAttempts(3),
          factor: retryFactor(2),
          minTimeoutInMs: duration(1_000),
          maxTimeoutInMs: duration(60_000),
          randomize: true,
        },
        outOfMemory: {
          kind: "escalate_once",
          computeProfile: computeProfile("compute-large"),
        },
      },
      maximumDurationMs: duration(300_000),
      initialComputeProfile: computeProfile("compute-small"),
      leaseDurationMs: duration(30_000),
      immediateRetryThresholdMs: duration(5_000),
    },
    attemptHistory: { kind: "none" },
    leaseHistory: { kind: "none" },
    lastLifecycleAcceptance: null,
    completionReplays: Object.freeze([]),
    requestedEffectCursor: { kind: "none" },
    phase: "ready",
    ready: { kind: "initial", eligibleAtMs: databaseTime(0) },
    cancellation: {
      kind: "not_requested",
      generation: cancellationGeneration(0n),
    },
  };
}

export async function seedTaskSystemRunAttemptStoreV1(
  persistence: Pick<FlarexSqlClient, "query">,
  options: Readonly<{
    readonly aggregate?: TaskRunAttemptAggregateV1;
    readonly parent?: TaskSystemRunAttemptParentV1;
  }> = {},
): Promise<Readonly<{ readonly scopeId: string; readonly deploymentId: string }>> {
  const aggregate = options.aggregate ?? readyTaskRunAggregateV1();
  const parent = options.parent ?? Object.freeze({
    scopeId: TASK_SCOPE_ID,
    deploymentId: "deployment_task_store_v1",
    applicationRevisionId: "apprev_task_store_v1",
    candidateSha256Hex: "31".repeat(32),
  });
  if (options.parent === undefined) {
    await persistence.query(`
      insert into fx_system_scope_clock
        (scope_id, storage_generation, epoch)
      values ('${parent.scopeId}', 'flarexdb_v1',
        'epoch_72000000-0000-4000-8000-000000000006')
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
        '${parent.scopeId}', decode(repeat('31', 32), 'hex'),
        '${parent.applicationRevisionId}', '${parent.deploymentId}',
        decode(repeat('32', 32), 'hex'), decode(repeat('33', 32), 'hex'),
        decode(repeat('34', 32), 'hex'),
        'flarex.source-artifact-v2/codec-v1',
        decode(repeat('35', 32), 'hex'), 'dynamic-worker',
        decode(repeat('36', 32), 'hex'), 'schema_task_store_v1',
        1, 1, 1, decode(repeat('37', 32), 'hex'),
        decode(repeat('38', 32), 'hex'), 1, 1,
        decode(repeat('39', 32), 'hex'), decode('01', 'hex'),
        decode(repeat('3a', 32), 'hex'), decode(repeat('3b', 32), 'hex'),
        decode(repeat('3c', 32), 'hex'), 0, 0, decode('', 'hex'),
        decode(repeat('3d', 32), 'hex'), decode('01', 'hex'),
        decode(repeat('3e', 32), 'hex'), decode('01', 'hex'),
        decode(repeat('3f', 32), 'hex'), decode('01', 'hex'), 'inactive'
      )
      `);
    } finally {
      await persistence.query("set session_replication_role = origin");
    }
  }
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
      '${parent.scopeId}', '${TASK_DEFINITION_ID}', 'orders.process',
      '${parent.applicationRevisionId}',
      decode('${parent.candidateSha256Hex}', 'hex'), 1,
      1, decode(repeat('41', 32), 'hex'), decode('01', 'hex'),
      decode(repeat('42', 32), 'hex'), decode(repeat('43', 32), 'hex'),
      decode(repeat('44', 32), 'hex'), decode(repeat('45', 32), 'hex'),
      decode(repeat('46', 32), 'hex'), decode(repeat('47', 32), 'hex'),
      decode(repeat('48', 32), 'hex'), decode(repeat('49', 32), 'hex'),
      decode(repeat('4a', 32), 'hex'), decode(repeat('4b', 32), 'hex'),
      decode(repeat('4c', 32), 'hex'), decode(repeat('4d', 32), 'hex')
    )
  `);
  const encoded = Result.getOrThrow(
    encodePersistedTaskRunAttemptAggregateJsonV1(aggregate),
  );
  const projection = projectTaskRunAttemptPersistenceV1(aggregate);
  const aggregateJson = JSON.stringify(encoded);
  const aggregateByteLength = new TextEncoder().encode(aggregateJson).byteLength;
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
      '${parent.scopeId}', '${TASK_RUN_ID}', '${TASK_DEFINITION_ID}',
      ${aggregate.createdAtMs}, 'flarex.task-input-reference.v1',
      'flarex.task-input-object-store.v1', 'flarex-value/v1',
      'durable-task-input/v1/sha256/' || repeat('51', 32),
      1, decode(repeat('51', 32), 'hex'), 'run_lifetime',
      1, 1, decode(repeat('52', 32), 'hex'), decode('01', 'hex'),
      1, ${aggregateByteLength}, $1::jsonb, ${projection.runVersion},
      '${projection.phase}', ${sqlText(projection.dueKind)},
      ${projection.dueAtMs}, ${sqlText(projection.currentAttemptId)},
      ${projection.executionFenceBasis}, ${projection.currentLeaseVersion},
      ${projection.currentLeaseExpiresAtMs},
      ${projection.cancellationGeneration},
      ${projection.requestedEffectSequence}
    )
  `, [aggregateJson]);
  return Object.freeze({
    scopeId: parent.scopeId,
    deploymentId: parent.deploymentId,
  });
}

export async function seedAdditionalTaskSystemRunV1(
  persistence: Pick<FlarexSqlClient, "query">,
  additionalRunId: string,
): Promise<void> {
  const aggregate = Object.freeze({
    ...readyTaskRunAggregateV1(),
    runId: runId(additionalRunId),
  });
  const encoded = Result.getOrThrow(
    encodePersistedTaskRunAttemptAggregateJsonV1(aggregate),
  );
  const projection = projectTaskRunAttemptPersistenceV1(aggregate);
  const aggregateJson = JSON.stringify(encoded);
  const aggregateByteLength = new TextEncoder().encode(aggregateJson).byteLength;
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
    )
    select scope_id, '${additionalRunId}', task_definition_revision_id,
      created_at_ms, input_codec, input_store, input_value_codec,
      input_object_key, input_byte_length, input_sha256, input_retention,
      creation_authority_codec_version, creation_authority_byte_length,
      creation_authority_sha256, creation_authority_bytes,
      1, ${aggregateByteLength}, $1::jsonb, ${projection.runVersion},
      '${projection.phase}', ${sqlText(projection.dueKind)},
      ${projection.dueAtMs}, ${sqlText(projection.currentAttemptId)},
      ${projection.executionFenceBasis}, ${projection.currentLeaseVersion},
      ${projection.currentLeaseExpiresAtMs},
      ${projection.cancellationGeneration},
      ${projection.requestedEffectSequence}
    from fx_system_durable_task_run_v1
    where scope_id = '${TASK_SCOPE_ID}' and run_id = '${TASK_RUN_ID}'
  `, [aggregateJson]);
}

export async function locatedTaskAuthorityV1(
  db: Parameters<typeof getScopeClock>[0],
  target: LocatedTaskSystemRunAttemptTargetV1,
  scopeId = TASK_SCOPE_ID,
  deploymentId = "deployment_task_store_v1",
): Promise<LocatedTrustedScopeAuthority<LocatedTaskSystemRunAttemptTargetV1>> {
  const clock = await getScopeClock(db, ScopeIdSchema.make(scopeId));
  if (clock === null) throw new Error("task scope clock fixture missing");
  const authority: TrustedScopeAuthority = Object.freeze({
    deploymentId,
    scopeId: clock.scopeId,
    physicalLocator: TASK_LOCATOR,
    storageGeneration: clock.storageGeneration,
    storageGenerationFence: clock.storageGenerationFence,
    epoch: clock.epoch,
    lastCommitSeq: clock.lastCommitSeq,
    lastOutboxSeq: clock.lastOutboxSeq,
  });
  return Object.freeze({ authority, target });
}

export interface TaskSystemRunAttemptParentV1 {
  readonly scopeId: string;
  readonly deploymentId: string;
  readonly applicationRevisionId: string;
  readonly candidateSha256Hex: string;
}

function sqlText(value: string | null): string {
  return value === null ? "null" : `'${value.replaceAll("'", "''")}'`;
}
