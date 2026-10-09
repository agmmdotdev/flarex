import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import {
  MAX_TASK_REQUESTED_EFFECT_PERSISTED_JSON_BYTES_V1,
  MAX_TASK_RUN_ATTEMPT_PERSISTED_JSON_BYTES_V1,
  type TaskAttemptIdV1,
  type TaskCancellationGenerationV1,
  type TaskDefinitionRevisionIdV1,
  type TaskExecutionFenceV1,
  type TaskLeaseVersionV1,
  type TaskRequestedEffectPersistenceCursorV1,
  type TaskRequestedEffectSequenceV1,
  type TaskRequestedEffectV1,
  type TaskRunAttemptPersistenceProjectionV1,
  type TaskRunIdV1,
  type TaskRunVersionV1,
} from "@flarex/durable-task/internal/run-attempt-v1";
import {
  MAX_TASK_INPUT_CANONICAL_BYTES_V1,
  MAX_TASK_EXECUTION_PRINCIPAL_CANONICAL_BYTES_V1,
  type TaskExecutionPrincipalSha256V1,
  type TaskInputSha256V1,
  type TaskRunCreationAuthoritySha256V1,
  type ApplicationTaskRuntimeTargetSha256V1,
  type TaskRunCreationRequestKeySha256V1,
  type TaskRunCreationRequestSha256V1,
} from "@flarex/durable-task/internal/run-creation-v1";
import {
  MAX_TASK_DEFINITION_CANONICAL_BYTES_V1,
  MAX_TASK_ID_UTF8_BYTES_V1,
  type TaskDefinitionSha256V1,
  type TaskIdV1,
} from "@flarex/standard-application-definition/internal/task-definition-v1";
import type { ScopeId } from "flarex-protocol/storage-authority";
import {
  MAX_TASK_REPAIR_SCHEDULER_CONTINUATION_BYTES_V1,
  TASK_REPAIR_SCHEDULER_CONTINUATION_CODEC_V1,
  TASK_REPAIR_SCHEDULER_KEY_V1,
} from "../../tasks/taskRepairSchedulerModelV1";
import { bytea, nonBlankText } from "./primitives";
import { fxSystemScopeClocks } from "./scope";
import { fxSystemApplicationRevisionSchemasV1 } from "./applicationLegacyPublications";

/**
 * Inert, database-owned progress foundation for the one Task repair scheduler
 * associated with the control metadata database. E2A exposes no mutation
 * repository; the row grants neither scope authority nor attempt execution.
 */
export const fxSystemDurableTaskRepairSchedulerV1 = pgTable(
  "fx_system_durable_task_repair_scheduler_v1",
  {
    schedulerKey: text("scheduler_key").primaryKey(),
    schedulerState: text("scheduler_state")
      .$type<"idle" | "claimed">()
      .notNull(),
    runFence: bigint("run_fence", { mode: "bigint" }).notNull(),
    checkpointSequence: bigint("checkpoint_sequence", {
      mode: "bigint",
    }).notNull(),
    runOwner: uuid("run_owner"),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    claimExpiresAt: timestamp("claim_expires_at", { withTimezone: true }),
    nextRunAt: timestamp("next_run_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    continuationCodecVersion: integer("continuation_codec_version"),
    continuationBytes: bytea("continuation_bytes"),
    continuationSha256: bytea("continuation_sha256"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      "fx_system_durable_task_repair_scheduler_v1_key_check",
      sql`${table.schedulerKey} = ${sql.raw(`'${TASK_REPAIR_SCHEDULER_KEY_V1}'`)}`,
    ),
    check(
      "fx_system_durable_task_repair_scheduler_v1_state_check",
      sql`${table.schedulerState} in ('idle', 'claimed')`,
    ),
    check(
      "fx_system_durable_task_repair_scheduler_v1_fence_check",
      sql`${table.runFence} >= 0`,
    ),
    check(
      "fx_system_durable_task_repair_scheduler_v1_checkpoint_sequence_check",
      sql`${table.checkpointSequence} >= 0`,
    ),
    check(
      "fx_system_durable_task_repair_scheduler_v1_claim_check",
      sql`
        (
          ${table.schedulerState} = 'idle'
          and ${table.runOwner} is null
          and ${table.claimedAt} is null
          and ${table.claimExpiresAt} is null
        )
        or
        (
          ${table.schedulerState} = 'claimed'
          and ${table.runOwner} is not null
          and ${table.claimedAt} is not null
          and isfinite(${table.claimedAt})
          and ${table.claimExpiresAt} is not null
          and isfinite(${table.claimExpiresAt})
          and ${table.claimExpiresAt} > ${table.claimedAt}
        )
      `,
    ),
    check(
      "fx_system_durable_task_repair_scheduler_v1_continuation_check",
      sql`
        (
          ${table.continuationCodecVersion} is null
          and ${table.continuationBytes} is null
          and ${table.continuationSha256} is null
        )
        or
        (
          ${table.continuationCodecVersion} = ${sql.raw(
            String(TASK_REPAIR_SCHEDULER_CONTINUATION_CODEC_V1),
          )}
          and ${table.continuationBytes} is not null
          and octet_length(${table.continuationBytes}) between 1 and ${sql.raw(
            String(MAX_TASK_REPAIR_SCHEDULER_CONTINUATION_BYTES_V1),
          )}
          and ${table.continuationSha256} is not null
          and octet_length(${table.continuationSha256}) = 32
        )
      `,
    ),
    check(
      "fx_system_durable_task_repair_scheduler_v1_timestamp_check",
      sql`
        isfinite(${table.nextRunAt})
        and isfinite(${table.createdAt})
        and isfinite(${table.updatedAt})
        and ${table.updatedAt} >= ${table.createdAt}
      `,
    ),
  ],
);

/** Immutable, scope-owned Standard Application task/runtime binding. */
export const fxSystemDurableTaskDefinitionRevisionsV1 = pgTable(
  "fx_system_durable_task_definition_revision_v1",
  {
    scopeId: text("scope_id").$type<ScopeId>().notNull(),
    taskDefinitionRevisionId: text("task_definition_revision_id")
      .$type<TaskDefinitionRevisionIdV1>()
      .notNull(),
    taskId: text("task_id").$type<TaskIdV1>().notNull(),
    applicationRevisionId: text("application_revision_id").notNull(),
    candidateSha256: bytea("candidate_sha256")
      .$type<TaskDefinitionSha256V1>()
      .notNull(),
    bindingCodecVersion: integer("binding_codec_version").notNull(),
    bindingByteLength: bigint("binding_byte_length", { mode: "bigint" })
      .notNull(),
    bindingSha256: bytea("binding_sha256")
      .$type<TaskDefinitionSha256V1>()
      .notNull(),
    bindingBytes: bytea("binding_bytes").notNull(),
    applicationRevisionTaskBindingSha256: bytea(
      "application_revision_task_binding_sha256",
    ).$type<TaskDefinitionSha256V1>().notNull(),
    canonicalTaskManifestSha256: bytea("canonical_task_manifest_sha256")
      .$type<TaskDefinitionSha256V1>()
      .notNull(),
    taskRuntimeEntrySha256: bytea("task_runtime_entry_sha256")
      .$type<TaskDefinitionSha256V1>()
      .notNull(),
    taskCatalogSha256: bytea("task_catalog_sha256")
      .$type<TaskDefinitionSha256V1>()
      .notNull(),
    taskEntryRootSha256: bytea("task_entry_root_sha256")
      .$type<TaskDefinitionSha256V1>()
      .notNull(),
    taskRuntimeProjectionSha256: bytea("task_runtime_projection_sha256")
      .$type<TaskDefinitionSha256V1>()
      .notNull(),
    taskRuntimeGroupManifestSha256: bytea(
      "task_runtime_group_manifest_sha256",
    ).$type<TaskDefinitionSha256V1>().notNull(),
    taskRuntimeMaterializationSpecSha256: bytea(
      "task_runtime_materialization_spec_sha256",
    ).$type<TaskDefinitionSha256V1>().notNull(),
    packageSha256: bytea("package_sha256")
      .$type<TaskDefinitionSha256V1>()
      .notNull(),
    artifactSha256: bytea("artifact_sha256")
      .$type<TaskDefinitionSha256V1>()
      .notNull(),
    sourceRootSha256: bytea("source_root_sha256")
      .$type<TaskDefinitionSha256V1>()
      .notNull(),
    semanticRootSha256: bytea("semantic_root_sha256")
      .$type<TaskDefinitionSha256V1>()
      .notNull(),
  },
  table => [
    primaryKey({
      columns: [table.scopeId, table.taskDefinitionRevisionId],
      name: "fx_task_definition_v1_pk",
    }),
    unique("fx_task_definition_v1_binding_unique").on(
      table.scopeId,
      table.bindingSha256,
    ),
    unique("fx_task_definition_v1_revision_task_unique").on(
      table.scopeId,
      table.candidateSha256,
      table.applicationRevisionId,
      table.taskId,
    ),
    foreignKey({
      name: "fx_task_definition_v1_scope_fk",
      columns: [table.scopeId],
      foreignColumns: [fxSystemScopeClocks.scopeId],
    }).onDelete("restrict"),
    check(
      "fx_task_definition_v1_identity_check",
      sql`${table.taskDefinitionRevisionId} ~ '^taskdef_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        and ${nonBlankText(table.taskId)}
        and octet_length(convert_to(${table.taskId}, 'UTF8')) between 1 and ${sql.raw(
          String(MAX_TASK_ID_UTF8_BYTES_V1),
        )}
        and ${nonBlankText(table.applicationRevisionId)}
        and octet_length(convert_to(${table.applicationRevisionId}, 'UTF8')) <= 2048
        and octet_length(${table.candidateSha256}) = 32`,
    ),
    check(
      "fx_task_definition_v1_binding_check",
      sql`${table.bindingCodecVersion} = 1
        and ${table.bindingByteLength} between 1 and ${sql.raw(
          String(MAX_TASK_DEFINITION_CANONICAL_BYTES_V1),
        )}
        and octet_length(${table.bindingSha256}) = 32
        and octet_length(${table.bindingBytes}) = ${table.bindingByteLength}`,
    ),
    check(
      "fx_task_definition_v1_projection_check",
      sql`octet_length(${table.applicationRevisionTaskBindingSha256}) = 32
        and octet_length(${table.canonicalTaskManifestSha256}) = 32
        and octet_length(${table.taskRuntimeEntrySha256}) = 32
        and octet_length(${table.taskCatalogSha256}) = 32
        and octet_length(${table.taskEntryRootSha256}) = 32
        and octet_length(${table.taskRuntimeProjectionSha256}) = 32
        and octet_length(${table.taskRuntimeGroupManifestSha256}) = 32
        and octet_length(${table.taskRuntimeMaterializationSpecSha256}) = 32
        and octet_length(${table.packageSha256}) = 32
        and octet_length(${table.artifactSha256}) = 32
        and octet_length(${table.sourceRootSha256}) = 32
        and octet_length(${table.semanticRootSha256}) = 32`,
    ),
  ],
);

/** Authoritative lifecycle aggregate plus relational discovery projections. */
export const fxSystemDurableTaskRunsV1 = pgTable(
  "fx_system_durable_task_run_v1",
  {
    scopeId: text("scope_id").$type<ScopeId>().notNull(),
    runId: text("run_id").$type<TaskRunIdV1>().notNull(),
    definitionGeneration: text("definition_generation")
      .$type<"legacy_definition_v1" | "application_v1">()
      .notNull(),
    taskDefinitionRevisionId: text("task_definition_revision_id")
      .$type<TaskDefinitionRevisionIdV1>(),
    applicationRevisionId: text("application_revision_id"),
    applicationTaskRuntimeTargetSha256: bytea(
      "application_task_runtime_target_sha256",
    ).$type<ApplicationTaskRuntimeTargetSha256V1>(),
    createdAtMs: bigint("created_at_ms", { mode: "bigint" }).notNull(),
    inputCodec: text("input_codec").notNull(),
    inputStore: text("input_store").notNull(),
    inputValueCodec: text("input_value_codec").notNull(),
    inputObjectKey: text("input_object_key").notNull(),
    inputByteLength: bigint("input_byte_length", { mode: "bigint" })
      .notNull(),
    inputSha256: bytea("input_sha256").$type<TaskInputSha256V1>().notNull(),
    inputRetention: text("input_retention").notNull(),
    executionPrincipalGeneration: text("execution_principal_generation")
      .$type<"not_applicable" | "legacy_absent" | "present_v1">()
      .notNull(),
    executionPrincipalKind: text("execution_principal_kind"),
    executionPrincipalCodec: text("execution_principal_codec"),
    executionPrincipalStore: text("execution_principal_store"),
    executionPrincipalValueCodec: text("execution_principal_value_codec"),
    executionPrincipalObjectKey: text("execution_principal_object_key"),
    executionPrincipalByteLength: bigint("execution_principal_byte_length", {
      mode: "bigint",
    }),
    executionPrincipalSha256: bytea("execution_principal_sha256")
      .$type<TaskExecutionPrincipalSha256V1>(),
    executionPrincipalRetention: text("execution_principal_retention"),
    creationAuthorityCodecVersion: integer(
      "creation_authority_codec_version",
    ).notNull(),
    creationAuthorityByteLength: bigint(
      "creation_authority_byte_length",
      { mode: "bigint" },
    ).notNull(),
    creationAuthoritySha256: bytea("creation_authority_sha256")
      .$type<TaskRunCreationAuthoritySha256V1>()
      .notNull(),
    creationAuthorityBytes: bytea("creation_authority_bytes").notNull(),
    aggregateCodecVersion: integer("aggregate_codec_version").notNull(),
    aggregateByteLength: bigint("aggregate_byte_length", { mode: "bigint" })
      .notNull(),
    aggregateJson: jsonb("aggregate_json").$type<unknown>().notNull(),
    runVersion: bigint("run_version", { mode: "bigint" })
      .$type<TaskRunVersionV1>()
      .notNull(),
    phase: text("phase")
      .$type<TaskRunAttemptPersistenceProjectionV1["phase"]>()
      .notNull(),
    dueKind: text("due_kind").$type<Exclude<
      TaskRunAttemptPersistenceProjectionV1["dueKind"],
      null
    >>(),
    dueAtMs: bigint("due_at_ms", { mode: "bigint" }),
    currentAttemptId: text("current_attempt_id").$type<TaskAttemptIdV1>(),
    executionFenceBasis: bigint("execution_fence_basis", { mode: "bigint" })
      .$type<TaskExecutionFenceV1>(),
    currentLeaseVersion: bigint("current_lease_version", { mode: "bigint" })
      .$type<TaskLeaseVersionV1>(),
    currentLeaseExpiresAtMs: bigint("current_lease_expires_at_ms", {
      mode: "bigint",
    }),
    cancellationGeneration: bigint("cancellation_generation", {
      mode: "bigint",
    }).$type<TaskCancellationGenerationV1>().notNull(),
    requestedEffectSequence: bigint("requested_effect_sequence", {
      mode: "bigint",
    }).$type<TaskRequestedEffectPersistenceCursorV1>().notNull(),
  },
  table => [
    primaryKey({
      columns: [table.scopeId, table.runId],
      name: "fx_task_run_v1_pk",
    }),
    foreignKey({
      name: "fx_task_run_v1_definition_fk",
      columns: [table.scopeId, table.taskDefinitionRevisionId],
      foreignColumns: [
        fxSystemDurableTaskDefinitionRevisionsV1.scopeId,
        fxSystemDurableTaskDefinitionRevisionsV1.taskDefinitionRevisionId,
      ],
    }).onDelete("restrict"),
    foreignKey({
      name: "fx_task_run_v1_application_revision_fk",
      columns: [table.scopeId, table.applicationRevisionId],
      foreignColumns: [
        fxSystemApplicationRevisionSchemasV1.scopeId,
        fxSystemApplicationRevisionSchemasV1.revisionId,
      ],
    }).onDelete("restrict"),
    index("fx_task_run_v1_due_discovery_idx").on(
      table.scopeId,
      table.dueKind,
      table.dueAtMs,
      table.runId,
    ).where(sql`${table.dueKind} is not null`),
    index("fx_task_run_v1_application_retirement_pin_idx")
      .on(table.scopeId, table.runId)
      .where(sql`${table.definitionGeneration} = 'application_v1'
        and (${table.aggregateJson} #>> '{aggregate,phase}')
          is distinct from 'terminal'`),
    index("fx_task_run_v1_application_list_idx")
      .on(
        table.scopeId,
        table.createdAtMs.desc(),
        sql`${table.runId} collate "C" desc`,
      )
      .where(sql`${table.definitionGeneration} = 'application_v1'`),
    check(
      "fx_task_run_v1_identity_check",
      sql`${table.runId} ~ '^run_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        and ((${table.definitionGeneration} = 'legacy_definition_v1'
              and ${table.taskDefinitionRevisionId} is not null
              and ${table.taskDefinitionRevisionId} ~ '^taskdef_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
              and ${table.applicationRevisionId} is null
              and ${table.applicationTaskRuntimeTargetSha256} is null
              and ${table.executionPrincipalGeneration} = 'not_applicable'
              and ${table.executionPrincipalKind} is null
              and ${table.executionPrincipalCodec} is null
              and ${table.executionPrincipalStore} is null
              and ${table.executionPrincipalValueCodec} is null
              and ${table.executionPrincipalObjectKey} is null
              and ${table.executionPrincipalByteLength} is null
              and ${table.executionPrincipalSha256} is null
              and ${table.executionPrincipalRetention} is null)
          or (${table.definitionGeneration} = 'application_v1'
              and ${table.taskDefinitionRevisionId} is null
              and ${table.applicationRevisionId} is not null
              and ${nonBlankText(table.applicationRevisionId)}
              and octet_length(convert_to(${table.applicationRevisionId}, 'UTF8')) <= 2048
              and ${table.applicationTaskRuntimeTargetSha256} is not null
              and octet_length(${table.applicationTaskRuntimeTargetSha256}) = 32
              and ((${table.executionPrincipalGeneration} = 'legacy_absent'
                    and ${table.executionPrincipalKind} is null
                    and ${table.executionPrincipalCodec} is null
                    and ${table.executionPrincipalStore} is null
                    and ${table.executionPrincipalValueCodec} is null
                    and ${table.executionPrincipalObjectKey} is null
                    and ${table.executionPrincipalByteLength} is null
                    and ${table.executionPrincipalSha256} is null
                    and ${table.executionPrincipalRetention} is null)
                or (${table.executionPrincipalGeneration} = 'present_v1'
                    and ${table.executionPrincipalKind} is not null
                    and ${table.executionPrincipalCodec} is not null
                    and ${table.executionPrincipalStore} is not null
                    and ${table.executionPrincipalValueCodec} is not null
                    and ${table.executionPrincipalObjectKey} is not null
                    and ${table.executionPrincipalByteLength} is not null
                    and ${table.executionPrincipalSha256} is not null
                    and ${table.executionPrincipalRetention} is not null
                    and ${table.executionPrincipalKind} = 'authenticated_user'
                    and ${table.executionPrincipalCodec} = 'flarex.task-execution-principal-reference.v1'
                    and ${table.executionPrincipalStore} = 'flarex.task-execution-principal-object-store.v1'
                    and ${table.executionPrincipalValueCodec} = 'flarex-value/v1'
                    and ${table.executionPrincipalObjectKey} ~ '^durable-task-principal/v1/sha256/[0-9a-f]{64}$'
                    and ${table.executionPrincipalByteLength} between 1 and ${sql.raw(
                      String(MAX_TASK_EXECUTION_PRINCIPAL_CANONICAL_BYTES_V1),
                    )}
                    and octet_length(${table.executionPrincipalSha256}) = 32
                    and right(${table.executionPrincipalObjectKey}, 64) =
                      encode(${table.executionPrincipalSha256}, 'hex')
                    and ${table.executionPrincipalRetention} = 'run_lifetime'))))
        and ${table.createdAtMs} between 0 and 9007199254740991`,
    ),
    check(
      "fx_task_run_v1_input_check",
      sql`${table.inputCodec} = 'flarex.task-input-reference.v1'
        and ${table.inputStore} = 'flarex.task-input-object-store.v1'
        and ${table.inputValueCodec} = 'flarex-value/v1'
        and ${table.inputRetention} = 'run_lifetime'
        and ${table.inputObjectKey} ~ '^durable-task-input/v1/sha256/[0-9a-f]{64}$'
        and ${table.inputByteLength} between 1 and ${sql.raw(
          String(MAX_TASK_INPUT_CANONICAL_BYTES_V1),
        )}
        and octet_length(${table.inputSha256}) = 32
        and right(${table.inputObjectKey}, 64) = encode(${table.inputSha256}, 'hex')`,
    ),
    check(
      "fx_task_run_v1_authority_check",
      sql`${table.creationAuthorityCodecVersion} = 1
        and ${table.creationAuthorityByteLength} between 1 and ${sql.raw(
          String(MAX_TASK_DEFINITION_CANONICAL_BYTES_V1),
        )}
        and octet_length(${table.creationAuthoritySha256}) = 32
        and octet_length(${table.creationAuthorityBytes}) =
          ${table.creationAuthorityByteLength}`,
    ),
    check(
      "fx_task_run_v1_aggregate_check",
      sql`${table.aggregateCodecVersion} = 1
        and ${table.aggregateByteLength} between 1 and ${sql.raw(
          String(MAX_TASK_RUN_ATTEMPT_PERSISTED_JSON_BYTES_V1),
        )}
        and jsonb_typeof(${table.aggregateJson}) = 'object'`,
    ),
    check(
      "fx_task_run_v1_projection_counter_check",
      sql`${table.runVersion} >= 1
        and ${table.cancellationGeneration} >= 0
        and ${table.requestedEffectSequence} >= 0`,
    ),
    check(
      "fx_task_run_v1_projection_shape_check",
      sql`(
        (${table.phase} = 'ready'
          and ${table.dueKind} = 'start_attempt'
          and ${table.dueAtMs} is not null
          and ${table.currentAttemptId} is null
          and ${table.currentLeaseVersion} is null
          and ${table.currentLeaseExpiresAtMs} is null)
        or (${table.phase} = 'retry_waiting'
          and ${table.dueKind} = 'start_attempt'
          and ${table.dueAtMs} is not null
          and ${table.currentAttemptId} is null
          and ${table.executionFenceBasis} is not null
          and ${table.currentLeaseVersion} is null
          and ${table.currentLeaseExpiresAtMs} is null)
        or (${table.phase} in ('attempt_granted', 'executing')
          and ${table.dueKind} = 'handle_lease_expiry'
          and ${table.dueAtMs} is not null
          and ${table.currentAttemptId} is not null
          and ${table.executionFenceBasis} is not null
          and ${table.currentLeaseVersion} is not null
          and ${table.currentLeaseExpiresAtMs} = ${table.dueAtMs})
        or (${table.phase} = 'terminal'
          and ${table.dueKind} is null
          and ${table.dueAtMs} is null
          and ${table.currentAttemptId} is null
          and ${table.executionFenceBasis} is null
          and ${table.currentLeaseVersion} is null
          and ${table.currentLeaseExpiresAtMs} is null)
      )`,
    ),
    check(
      "fx_task_run_v1_projection_value_check",
      sql`(${table.dueAtMs} is null or
          ${table.dueAtMs} between 0 and 9007199254740991)
        and (${table.currentAttemptId} is null or
          ${table.currentAttemptId} ~ '^attempt_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')
        and (${table.executionFenceBasis} is null or
          ${table.executionFenceBasis} >= 1)
        and (${table.currentLeaseVersion} is null or
          ${table.currentLeaseVersion} >= 1)
        and (${table.currentLeaseExpiresAtMs} is null or
          ${table.currentLeaseExpiresAtMs} between 0 and 9007199254740991)`,
    ),
  ],
);

/** Scope-local run-creation idempotency identity and stable replay basis. */
export const fxSystemDurableTaskRunRequestsV1 = pgTable(
  "fx_system_durable_task_run_request_v1",
  {
    scopeId: text("scope_id").$type<ScopeId>().notNull(),
    requestKeyCodecVersion: integer("request_key_codec_version").notNull(),
    requestKeySha256: bytea("request_key_sha256")
      .$type<TaskRunCreationRequestKeySha256V1>()
      .notNull(),
    requestCodecVersion: integer("request_codec_version").notNull(),
    requestSha256: bytea("request_sha256")
      .$type<TaskRunCreationRequestSha256V1>()
      .notNull(),
    runId: text("run_id").$type<TaskRunIdV1>().notNull(),
    receiptVersion: integer("receipt_version").notNull(),
  },
  table => [
    primaryKey({
      columns: [table.scopeId, table.requestKeySha256],
      name: "fx_task_run_request_v1_pk",
    }),
    unique("fx_task_run_request_v1_run_unique").on(
      table.scopeId,
      table.runId,
    ),
    foreignKey({
      name: "fx_task_run_request_v1_run_fk",
      columns: [table.scopeId, table.runId],
      foreignColumns: [
        fxSystemDurableTaskRunsV1.scopeId,
        fxSystemDurableTaskRunsV1.runId,
      ],
    }).onDelete("restrict"),
    check(
      "fx_task_run_request_v1_identity_check",
      sql`${table.requestKeyCodecVersion} = 1
        and ${table.requestCodecVersion} = 1
        and ${table.receiptVersion} = 1
        and octet_length(${table.requestKeySha256}) = 32
        and octet_length(${table.requestSha256}) = 32
        and ${table.runId} ~ '^run_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'`,
    ),
  ],
);

/** Immutable attempt-history identity and collision evidence. */
export const fxSystemDurableTaskAttemptIdentitiesV1 = pgTable(
  "fx_system_durable_task_attempt_identity_v1",
  {
    scopeId: text("scope_id").$type<ScopeId>().notNull(),
    attemptId: text("attempt_id").$type<TaskAttemptIdV1>().notNull(),
    runId: text("run_id").$type<TaskRunIdV1>().notNull(),
    attemptNumber: integer("attempt_number").notNull(),
    executionFence: bigint("execution_fence", { mode: "bigint" })
      .$type<TaskExecutionFenceV1>()
      .notNull(),
    acceptedRunVersion: bigint("accepted_run_version", { mode: "bigint" })
      .$type<TaskRunVersionV1>()
      .notNull(),
  },
  table => [
    primaryKey({
      columns: [table.scopeId, table.attemptId],
      name: "fx_task_attempt_identity_v1_pk",
    }),
    unique("fx_task_attempt_identity_v1_ordinal_unique").on(
      table.scopeId,
      table.runId,
      table.attemptNumber,
    ),
    unique("fx_task_attempt_identity_v1_fence_unique").on(
      table.scopeId,
      table.runId,
      table.executionFence,
    ),
    foreignKey({
      name: "fx_task_attempt_identity_v1_run_fk",
      columns: [table.scopeId, table.runId],
      foreignColumns: [
        fxSystemDurableTaskRunsV1.scopeId,
        fxSystemDurableTaskRunsV1.runId,
      ],
    }).onDelete("restrict"),
    check(
      "fx_task_attempt_identity_v1_value_check",
      sql`${table.attemptId} ~ '^attempt_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        and ${table.runId} ~ '^run_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        and ${table.attemptNumber} between 1 and 250
        and ${table.executionFence} >= 1
        and ${table.acceptedRunVersion} >= 1`,
    ),
  ],
);

/** Immutable, ordered lifecycle intent; delivery remains Roadmap 05-owned. */
export const fxSystemDurableTaskRequestedEffectsV1 = pgTable(
  "fx_system_durable_task_requested_effect_v1",
  {
    scopeId: text("scope_id").$type<ScopeId>().notNull(),
    runId: text("run_id").$type<TaskRunIdV1>().notNull(),
    sequence: bigint("sequence", { mode: "bigint" })
      .$type<TaskRequestedEffectSequenceV1>()
      .notNull(),
    acceptedRunVersion: bigint("accepted_run_version", { mode: "bigint" })
      .$type<TaskRunVersionV1>()
      .notNull(),
    kind: text("kind").$type<TaskRequestedEffectV1["kind"]>().notNull(),
    payloadCodecVersion: integer("payload_codec_version").notNull(),
    payloadByteLength: bigint("payload_byte_length", { mode: "bigint" })
      .notNull(),
    payloadJson: jsonb("payload_json").$type<unknown>().notNull(),
    notBeforeMs: bigint("not_before_ms", { mode: "bigint" }),
  },
  table => [
    primaryKey({
      columns: [table.scopeId, table.runId, table.sequence],
      name: "fx_task_requested_effect_v1_pk",
    }),
    foreignKey({
      name: "fx_task_requested_effect_v1_run_fk",
      columns: [table.scopeId, table.runId],
      foreignColumns: [
        fxSystemDurableTaskRunsV1.scopeId,
        fxSystemDurableTaskRunsV1.runId,
      ],
    }).onDelete("restrict"),
    index("fx_task_requested_effect_v1_kind_idx").on(
      table.scopeId,
      table.kind,
      table.runId,
      table.sequence,
    ),
    check(
      "fx_task_requested_effect_v1_identity_check",
      sql`${table.runId} ~ '^run_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        and ${table.sequence} >= 1
        and ${table.acceptedRunVersion} >= 1`,
    ),
    check(
      "fx_task_requested_effect_v1_payload_check",
      sql`${table.payloadCodecVersion} = 1
        and ${table.payloadByteLength} between 1 and ${sql.raw(
          String(MAX_TASK_REQUESTED_EFFECT_PERSISTED_JSON_BYTES_V1),
        )}
        and jsonb_typeof(${table.payloadJson}) = 'object'`,
    ),
    check(
      "fx_task_requested_effect_v1_schedule_check",
      sql`(
        (${table.kind} in ('continue_retry', 'wake_retry', 'wake_lease_expiry')
          and ${table.notBeforeMs} between 0 and 9007199254740991)
        or (${table.kind} in (
            'dispatch_attempt',
            'request_execution_cancellation',
            'release_queue_ownership',
            'publish_lifecycle_event',
            'notify_current_state',
            'cancel_obsolete_lease_wake'
          ) and ${table.notBeforeMs} is null)
      )`,
    ),
  ],
);
