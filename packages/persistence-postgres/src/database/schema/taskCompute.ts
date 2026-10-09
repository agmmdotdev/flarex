import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import type {
  TaskAttemptIdV1,
  TaskAttemptNumberV1,
  TaskCancellationGenerationV1,
  TaskDefinitionRevisionIdV1,
  TaskDurationMsV1,
  TaskExecutionFenceV1,
  TaskLeaseVersionV1,
  TaskRequestedEffectSequenceV1,
  TaskRequestedEffectV1,
  TaskRunIdV1,
  TaskRunVersionV1,
} from "@flarex/durable-task/internal/run-attempt-v1";
import type {
  ApplicationTaskRuntimeTargetSha256V1,
} from "@flarex/durable-task/internal/run-creation-v1";
import type { ScopeId } from "flarex-protocol/storage-authority";
import {
  MAX_TASK_COMPUTE_DELIVERY_EVIDENCE_BYTES_V1,
  MAX_TASK_COMPUTE_DELIVERY_REASON_CODE_UTF8_BYTES_V1,
  MAX_TASK_COMPUTE_PROFILE_STORAGE_BYTES_V1,
  TASK_COMPUTE_DELIVERY_EVIDENCE_CODEC_V1,
  TASK_COMPUTE_PROFILE_STORAGE_CODEC_V1,
  type TaskComputeCancellationDeliveryStateV1,
  type TaskComputeDispatchDeliveryStateV1,
} from "../../tasks/taskComputeDeliveryEvidenceV1";
import { bytea } from "./primitives";
import {
  fxSystemDurableTaskDefinitionRevisionsV1,
  fxSystemDurableTaskRunsV1,
  fxSystemDurableTaskRequestedEffectsV1,
} from "./taskRuns";

type TaskComputePendingRequestedEffectKindV1 = Extract<
  TaskRequestedEffectV1["kind"],
  "dispatch_attempt" | "request_execution_cancellation"
>;

/** Indexed membership only; the immutable requested effect remains authority. */
export const fxSystemDurableTaskComputePendingV1 = pgTable(
  "fx_system_durable_task_compute_pending_v1",
  {
    scopeId: text("scope_id").$type<ScopeId>().notNull(),
    runId: text("run_id").$type<TaskRunIdV1>().notNull(),
    requestedEffectSequence: bigint("requested_effect_sequence", {
      mode: "bigint",
    }).$type<TaskRequestedEffectSequenceV1>().notNull(),
    kind: text("kind").$type<TaskComputePendingRequestedEffectKindV1>()
      .notNull(),
    eligibleAt: timestamp("eligible_at", { withTimezone: true }).notNull(),
  },
  table => [
    primaryKey({
      columns: [
        table.scopeId,
        table.runId,
        table.requestedEffectSequence,
      ],
      name: "fx_task_compute_pending_v1_pk",
    }),
    foreignKey({
      name: "fx_task_compute_pending_v1_effect_fk",
      columns: [
        table.scopeId,
        table.runId,
        table.requestedEffectSequence,
      ],
      foreignColumns: [
        fxSystemDurableTaskRequestedEffectsV1.scopeId,
        fxSystemDurableTaskRequestedEffectsV1.runId,
        fxSystemDurableTaskRequestedEffectsV1.sequence,
      ],
    }).onDelete("restrict"),
    index("fx_task_compute_pending_v1_discovery_idx").on(
      table.scopeId,
      table.kind,
      table.eligibleAt,
      table.runId,
      table.requestedEffectSequence,
    ),
    check(
      "fx_task_compute_pending_v1_identity_check",
      sql`${table.runId} ~ '^run_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        and ${table.requestedEffectSequence} >= 1
        and ${table.kind} in (
          'dispatch_attempt',
          'request_execution_cancellation'
        )`,
    ),
    check(
      "fx_task_compute_pending_v1_eligible_at_check",
      sql`isfinite(${table.eligibleAt})
        and ${table.eligibleAt} = date_trunc('milliseconds', ${table.eligibleAt})`,
    ),
  ],
);

/** Subordinate, operation-specific evidence for one exact dispatch effect. */
export const fxSystemDurableTaskComputeDispatchesV1 = pgTable(
  "fx_system_durable_task_compute_dispatch_v1",
  {
    scopeId: text("scope_id").$type<ScopeId>().notNull(),
    runId: text("run_id").$type<TaskRunIdV1>().notNull(),
    requestedEffectSequence: bigint("requested_effect_sequence", {
      mode: "bigint",
    }).$type<TaskRequestedEffectSequenceV1>().notNull(),
    acceptedRunVersion: bigint("accepted_run_version", { mode: "bigint" })
      .$type<TaskRunVersionV1>()
      .notNull(),
    definitionGeneration: text("definition_generation")
      .$type<"legacy_definition_v1" | "application_v1">()
      .notNull(),
    taskDefinitionRevisionId: text("task_definition_revision_id")
      .$type<TaskDefinitionRevisionIdV1>(),
    applicationTaskRuntimeTargetSha256: bytea(
      "application_task_runtime_target_sha256",
    ).$type<ApplicationTaskRuntimeTargetSha256V1>(),
    attemptId: text("attempt_id").$type<TaskAttemptIdV1>().notNull(),
    attemptNumber: integer("attempt_number")
      .$type<TaskAttemptNumberV1>()
      .notNull(),
    executionFence: bigint("execution_fence", { mode: "bigint" })
      .$type<TaskExecutionFenceV1>()
      .notNull(),
    leaseVersion: bigint("lease_version", { mode: "bigint" })
      .$type<TaskLeaseVersionV1>()
      .notNull(),
    computeProfileCodecVersion: integer("compute_profile_codec_version")
      .notNull(),
    computeProfileByteLength: integer("compute_profile_byte_length")
      .notNull(),
    computeProfileBytes: bytea("compute_profile_bytes").notNull(),
    cancellationKind: text("cancellation_kind")
      .$type<"not_requested" | "requested">()
      .notNull(),
    cancellationGeneration: bigint("cancellation_generation", {
      mode: "bigint",
    }).$type<TaskCancellationGenerationV1>().notNull(),
    maximumDurationMs: bigint("maximum_duration_ms", { mode: "number" })
      .$type<TaskDurationMsV1>()
      .notNull(),
    requestCodecVersion: integer("request_codec_version").notNull(),
    requestByteLength: bigint("request_byte_length", { mode: "bigint" })
      .notNull(),
    requestSha256: bytea("request_sha256").notNull(),
    requestBytes: bytea("request_bytes").notNull(),
    deliveryState: text("delivery_state")
      .$type<TaskComputeDispatchDeliveryStateV1>()
      .notNull(),
    claimOwner: uuid("claim_owner"),
    claimFence: bigint("claim_fence", { mode: "bigint" }).notNull(),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    claimExpiresAt: timestamp("claim_expires_at", { withTimezone: true }),
    deliveryAttemptCount: bigint("delivery_attempt_count", {
      mode: "bigint",
    }).notNull(),
    deliveryStartedAt: timestamp("delivery_started_at", {
      withTimezone: true,
    }),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
    reasonCode: text("reason_code"),
    acceptanceCodecVersion: integer("acceptance_codec_version"),
    acceptanceByteLength: bigint("acceptance_byte_length", {
      mode: "bigint",
    }),
    acceptanceSha256: bytea("acceptance_sha256"),
    acceptanceBytes: bytea("acceptance_bytes"),
    settledAt: timestamp("settled_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  table => [
    primaryKey({
      columns: [
        table.scopeId,
        table.runId,
        table.requestedEffectSequence,
      ],
      name: "fx_task_compute_dispatch_v1_pk",
    }),
    unique("fx_task_compute_dispatch_v1_attempt_unique").on(
      table.scopeId,
      table.runId,
      table.attemptId,
      table.executionFence,
    ),
    foreignKey({
      name: "fx_task_compute_dispatch_v1_run_fk",
      columns: [table.scopeId, table.runId],
      foreignColumns: [
        fxSystemDurableTaskRunsV1.scopeId,
        fxSystemDurableTaskRunsV1.runId,
      ],
    }).onDelete("restrict"),
    foreignKey({
      name: "fx_task_compute_dispatch_v1_effect_fk",
      columns: [
        table.scopeId,
        table.runId,
        table.requestedEffectSequence,
      ],
      foreignColumns: [
        fxSystemDurableTaskRequestedEffectsV1.scopeId,
        fxSystemDurableTaskRequestedEffectsV1.runId,
        fxSystemDurableTaskRequestedEffectsV1.sequence,
      ],
    }).onDelete("restrict"),
    foreignKey({
      name: "fx_task_compute_dispatch_v1_definition_fk",
      columns: [table.scopeId, table.taskDefinitionRevisionId],
      foreignColumns: [
        fxSystemDurableTaskDefinitionRevisionsV1.scopeId,
        fxSystemDurableTaskDefinitionRevisionsV1.taskDefinitionRevisionId,
      ],
    }).onDelete("restrict"),
    index("fx_task_compute_dispatch_v1_due_idx").on(
      table.scopeId,
      table.deliveryState,
      table.nextAttemptAt,
      table.runId,
      table.requestedEffectSequence,
    ).where(sql`${table.claimOwner} is null`),
    index("fx_task_compute_dispatch_v1_claim_idx").on(
      table.scopeId,
      table.claimExpiresAt,
      table.runId,
      table.requestedEffectSequence,
    ).where(sql`${table.claimOwner} is not null`),
    check(
      "fx_task_compute_dispatch_v1_identity_check",
      sql`${table.runId} ~ '^run_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        and ${table.requestedEffectSequence} >= 1
        and ${table.acceptedRunVersion} >= 1
        and ((${table.definitionGeneration} = 'legacy_definition_v1'
              and ${table.taskDefinitionRevisionId} is not null
              and ${table.taskDefinitionRevisionId} ~ '^taskdef_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
              and ${table.applicationTaskRuntimeTargetSha256} is null)
          or (${table.definitionGeneration} = 'application_v1'
              and ${table.taskDefinitionRevisionId} is null
              and ${table.applicationTaskRuntimeTargetSha256} is not null
              and octet_length(${table.applicationTaskRuntimeTargetSha256}) = 32))
        and ${table.attemptId} ~ '^attempt_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        and ${table.attemptNumber} between 1 and 250
        and ${table.executionFence} >= 1
        and ${table.leaseVersion} >= 1
        and ${table.computeProfileCodecVersion} = ${sql.raw(String(TASK_COMPUTE_PROFILE_STORAGE_CODEC_V1))}
        and ${table.computeProfileByteLength} between 2 and ${sql.raw(String(MAX_TASK_COMPUTE_PROFILE_STORAGE_BYTES_V1))}
        and ${table.computeProfileByteLength} % 2 = 0
        and octet_length(${table.computeProfileBytes}) = ${table.computeProfileByteLength}
        and ${table.maximumDurationMs} between 1 and 9007199254740991
        and ((${table.cancellationKind} = 'not_requested'
              and ${table.cancellationGeneration} = 0)
          or (${table.cancellationKind} = 'requested'
              and ${table.cancellationGeneration} >= 1))`,
    ),
    check(
      "fx_task_compute_dispatch_v1_request_check",
      sql`${table.requestCodecVersion} = ${sql.raw(
        String(TASK_COMPUTE_DELIVERY_EVIDENCE_CODEC_V1),
      )}
        and ${table.requestByteLength} between 1 and ${sql.raw(
          String(MAX_TASK_COMPUTE_DELIVERY_EVIDENCE_BYTES_V1),
        )}
        and octet_length(${table.requestBytes}) = ${table.requestByteLength}
        and octet_length(${table.requestSha256}) = 32`,
    ),
    check(
      "fx_task_compute_dispatch_v1_claim_check",
      sql`(${table.claimFence} >= 0 and (
        (${table.claimOwner} is null
          and ${table.claimedAt} is null
          and ${table.claimExpiresAt} is null)
        or (${table.claimOwner} is not null
          and ${table.claimFence} >= 1
          and ${table.deliveryState} in ('prepared', 'delivering', 'retry_wait')
          and ${table.claimedAt} is not null
          and isfinite(${table.claimedAt})
          and ${table.claimExpiresAt} is not null
          and isfinite(${table.claimExpiresAt})
          and ${table.claimExpiresAt} > ${table.claimedAt})
      )) is true`,
    ),
    check(
      "fx_task_compute_dispatch_v1_acceptance_check",
      sql`(
        (${table.acceptanceCodecVersion} is null
          and ${table.acceptanceByteLength} is null
          and ${table.acceptanceSha256} is null
          and ${table.acceptanceBytes} is null)
        or (${table.acceptanceCodecVersion} = ${sql.raw(
          String(TASK_COMPUTE_DELIVERY_EVIDENCE_CODEC_V1),
        )}
          and ${table.acceptanceByteLength} between 1 and ${sql.raw(
            String(MAX_TASK_COMPUTE_DELIVERY_EVIDENCE_BYTES_V1),
          )}
          and octet_length(${table.acceptanceBytes}) =
            ${table.acceptanceByteLength}
          and octet_length(${table.acceptanceSha256}) = 32)
      ) is true`,
    ),
    check(
      "fx_task_compute_dispatch_v1_state_check",
      sql`(
        (${table.deliveryState} = 'prepared'
          and ${table.deliveryAttemptCount} = 0
          and ${table.deliveryStartedAt} is null
          and ${table.nextAttemptAt} is null
          and ${table.reasonCode} is null
          and ${table.acceptanceCodecVersion} is null
          and ${table.settledAt} is null)
        or (${table.deliveryState} = 'delivering'
          and ${table.deliveryAttemptCount} >= 1
          and ${table.deliveryStartedAt} is not null
          and ${table.nextAttemptAt} is null
          and ${table.reasonCode} is null
          and ${table.acceptanceCodecVersion} is null
          and ${table.settledAt} is null
          and ${table.claimOwner} is not null)
        or (${table.deliveryState} = 'accepted'
          and ${table.deliveryAttemptCount} >= 1
          and ${table.deliveryStartedAt} is not null
          and ${table.nextAttemptAt} is null
          and ${table.reasonCode} is null
          and ${table.acceptanceCodecVersion} is not null
          and ${table.settledAt} is not null
          and ${table.claimOwner} is null)
        or (${table.deliveryState} = 'retry_wait'
          and ${table.deliveryAttemptCount} >= 1
          and ${table.deliveryStartedAt} is not null
          and ${table.nextAttemptAt} is not null
          and ${table.nextAttemptAt} > ${table.deliveryStartedAt}
          and ${table.reasonCode} is not null
          and ${table.acceptanceCodecVersion} is null
          and ${table.settledAt} is null)
        or (${table.deliveryState} = 'rejected'
          and ${table.deliveryAttemptCount} >= 1
          and ${table.deliveryStartedAt} is not null
          and ${table.nextAttemptAt} is null
          and ${table.reasonCode} is not null
          and ${table.acceptanceCodecVersion} is null
          and ${table.settledAt} is not null
          and ${table.claimOwner} is null)
        or (${table.deliveryState} = 'quarantined'
          and ${table.deliveryAttemptCount} >= 0
          and ((${table.deliveryAttemptCount} = 0
              and ${table.deliveryStartedAt} is null)
            or (${table.deliveryAttemptCount} >= 1
              and ${table.deliveryStartedAt} is not null))
          and ${table.nextAttemptAt} is null
          and ${table.reasonCode} is not null
          and ${table.acceptanceCodecVersion} is null
          and ${table.settledAt} is not null
          and ${table.claimOwner} is null)
        or (${table.deliveryState} = 'obsolete'
          and ${table.deliveryAttemptCount} = 0
          and ${table.deliveryStartedAt} is null
          and ${table.nextAttemptAt} is null
          and ${table.reasonCode} is not null
          and ${table.acceptanceCodecVersion} is null
          and ${table.settledAt} is not null
          and ${table.claimOwner} is null)
      ) is true`,
    ),
    check(
      "fx_task_compute_dispatch_v1_reason_check",
      sql`(${table.reasonCode} is null or (
        ${table.reasonCode} ~ '^[a-z][a-z0-9_]*$'
        and octet_length(convert_to(${table.reasonCode}, 'UTF8')) between 1 and ${sql.raw(
          String(MAX_TASK_COMPUTE_DELIVERY_REASON_CODE_UTF8_BYTES_V1),
        )}
      )) is true`,
    ),
    check(
      "fx_task_compute_dispatch_v1_time_check",
      sql`(isfinite(${table.createdAt})
        and isfinite(${table.updatedAt})
        and ${table.updatedAt} >= ${table.createdAt}
        and (${table.deliveryStartedAt} is null
          or (isfinite(${table.deliveryStartedAt})
            and ${table.deliveryStartedAt} >= ${table.createdAt}))
        and (${table.nextAttemptAt} is null
          or isfinite(${table.nextAttemptAt}))
        and (${table.settledAt} is null
          or (isfinite(${table.settledAt})
            and ${table.settledAt} >= ${table.createdAt}
            and (${table.deliveryStartedAt} is null
              or ${table.settledAt} >= ${table.deliveryStartedAt})))) is true`,
    ),
  ],
);

/** Subordinate evidence for one exact cancellation-delivery effect. */
export const fxSystemDurableTaskComputeCancellationsV1 = pgTable(
  "fx_system_durable_task_compute_cancellation_v1",
  {
    scopeId: text("scope_id").$type<ScopeId>().notNull(),
    runId: text("run_id").$type<TaskRunIdV1>().notNull(),
    requestedEffectSequence: bigint("requested_effect_sequence", {
      mode: "bigint",
    }).$type<TaskRequestedEffectSequenceV1>().notNull(),
    acceptedRunVersion: bigint("accepted_run_version", { mode: "bigint" })
      .$type<TaskRunVersionV1>()
      .notNull(),
    dispatchRequestedEffectSequence: bigint(
      "dispatch_requested_effect_sequence",
      { mode: "bigint" },
    ).$type<TaskRequestedEffectSequenceV1>().notNull(),
    attemptId: text("attempt_id").$type<TaskAttemptIdV1>().notNull(),
    executionFence: bigint("execution_fence", { mode: "bigint" })
      .$type<TaskExecutionFenceV1>()
      .notNull(),
    cancellationGeneration: bigint("cancellation_generation", {
      mode: "bigint",
    }).$type<TaskCancellationGenerationV1>().notNull(),
    requestCodecVersion: integer("request_codec_version"),
    requestByteLength: bigint("request_byte_length", { mode: "bigint" }),
    requestSha256: bytea("request_sha256"),
    requestBytes: bytea("request_bytes"),
    deliveryState: text("delivery_state")
      .$type<TaskComputeCancellationDeliveryStateV1>()
      .notNull(),
    claimOwner: uuid("claim_owner"),
    claimFence: bigint("claim_fence", { mode: "bigint" }).notNull(),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    claimExpiresAt: timestamp("claim_expires_at", { withTimezone: true }),
    deliveryAttemptCount: bigint("delivery_attempt_count", {
      mode: "bigint",
    }).notNull(),
    deliveryStartedAt: timestamp("delivery_started_at", {
      withTimezone: true,
    }),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
    reasonCode: text("reason_code"),
    receiptCodecVersion: integer("receipt_codec_version"),
    receiptByteLength: bigint("receipt_byte_length", { mode: "bigint" }),
    receiptSha256: bytea("receipt_sha256"),
    receiptBytes: bytea("receipt_bytes"),
    settledAt: timestamp("settled_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  table => [
    primaryKey({
      columns: [
        table.scopeId,
        table.runId,
        table.requestedEffectSequence,
      ],
      name: "fx_task_compute_cancel_v1_pk",
    }),
    unique("fx_task_compute_cancel_v1_generation_unique").on(
      table.scopeId,
      table.runId,
      table.attemptId,
      table.executionFence,
      table.cancellationGeneration,
    ),
    foreignKey({
      name: "fx_task_compute_cancel_v1_run_fk",
      columns: [table.scopeId, table.runId],
      foreignColumns: [
        fxSystemDurableTaskRunsV1.scopeId,
        fxSystemDurableTaskRunsV1.runId,
      ],
    }).onDelete("restrict"),
    foreignKey({
      name: "fx_task_compute_cancel_v1_effect_fk",
      columns: [
        table.scopeId,
        table.runId,
        table.requestedEffectSequence,
      ],
      foreignColumns: [
        fxSystemDurableTaskRequestedEffectsV1.scopeId,
        fxSystemDurableTaskRequestedEffectsV1.runId,
        fxSystemDurableTaskRequestedEffectsV1.sequence,
      ],
    }).onDelete("restrict"),
    foreignKey({
      name: "fx_task_compute_cancel_v1_dispatch_fk",
      columns: [
        table.scopeId,
        table.runId,
        table.dispatchRequestedEffectSequence,
      ],
      foreignColumns: [
        fxSystemDurableTaskComputeDispatchesV1.scopeId,
        fxSystemDurableTaskComputeDispatchesV1.runId,
        fxSystemDurableTaskComputeDispatchesV1.requestedEffectSequence,
      ],
    }).onDelete("restrict"),
    index("fx_task_compute_cancel_v1_due_idx").on(
      table.scopeId,
      table.deliveryState,
      table.nextAttemptAt,
      table.runId,
      table.requestedEffectSequence,
    ).where(sql`${table.claimOwner} is null`),
    index("fx_task_compute_cancel_v1_claim_idx").on(
      table.scopeId,
      table.claimExpiresAt,
      table.runId,
      table.requestedEffectSequence,
    ).where(sql`${table.claimOwner} is not null`),
    check(
      "fx_task_compute_cancel_v1_identity_check",
      sql`${table.runId} ~ '^run_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        and ${table.requestedEffectSequence} >= 1
        and ${table.acceptedRunVersion} >= 1
        and ${table.dispatchRequestedEffectSequence} >= 1
        and ${table.dispatchRequestedEffectSequence} <
          ${table.requestedEffectSequence}
        and ${table.attemptId} ~ '^attempt_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        and ${table.executionFence} >= 1
        and ${table.cancellationGeneration} >= 1`,
    ),
    check(
      "fx_task_compute_cancel_v1_request_check",
      sql`(
        (${table.requestCodecVersion} is null
          and ${table.requestByteLength} is null
          and ${table.requestSha256} is null
          and ${table.requestBytes} is null)
        or (${table.requestCodecVersion} = ${sql.raw(
          String(TASK_COMPUTE_DELIVERY_EVIDENCE_CODEC_V1),
        )}
          and ${table.requestByteLength} between 1 and ${sql.raw(
            String(MAX_TASK_COMPUTE_DELIVERY_EVIDENCE_BYTES_V1),
          )}
          and octet_length(${table.requestBytes}) = ${table.requestByteLength}
          and octet_length(${table.requestSha256}) = 32)
      ) is true`,
    ),
    check(
      "fx_task_compute_cancel_v1_claim_check",
      sql`(${table.claimFence} >= 0 and (
        (${table.claimOwner} is null
          and ${table.claimedAt} is null
          and ${table.claimExpiresAt} is null)
        or (${table.claimOwner} is not null
          and ${table.claimFence} >= 1
          and ${table.deliveryState} in ('prepared', 'delivering', 'retry_wait')
          and ${table.claimedAt} is not null
          and isfinite(${table.claimedAt})
          and ${table.claimExpiresAt} is not null
          and isfinite(${table.claimExpiresAt})
          and ${table.claimExpiresAt} > ${table.claimedAt})
      )) is true`,
    ),
    check(
      "fx_task_compute_cancel_v1_receipt_check",
      sql`(
        (${table.receiptCodecVersion} is null
          and ${table.receiptByteLength} is null
          and ${table.receiptSha256} is null
          and ${table.receiptBytes} is null)
        or (${table.receiptCodecVersion} = ${sql.raw(
          String(TASK_COMPUTE_DELIVERY_EVIDENCE_CODEC_V1),
        )}
          and ${table.receiptByteLength} between 1 and ${sql.raw(
            String(MAX_TASK_COMPUTE_DELIVERY_EVIDENCE_BYTES_V1),
          )}
          and octet_length(${table.receiptBytes}) = ${table.receiptByteLength}
          and octet_length(${table.receiptSha256}) = 32)
      ) is true`,
    ),
    check(
      "fx_task_compute_cancel_v1_state_check",
      sql`(
        (${table.deliveryState} = 'waiting_dispatch'
          and ${table.requestCodecVersion} is null
          and ${table.deliveryAttemptCount} = 0
          and ${table.deliveryStartedAt} is null
          and ${table.nextAttemptAt} is null
          and ${table.reasonCode} is null
          and ${table.receiptCodecVersion} is null
          and ${table.settledAt} is null
          and ${table.claimOwner} is null)
        or (${table.deliveryState} = 'prepared'
          and ${table.requestCodecVersion} is not null
          and ${table.deliveryAttemptCount} = 0
          and ${table.deliveryStartedAt} is null
          and ${table.nextAttemptAt} is null
          and ${table.reasonCode} is null
          and ${table.receiptCodecVersion} is null
          and ${table.settledAt} is null)
        or (${table.deliveryState} = 'delivering'
          and ${table.requestCodecVersion} is not null
          and ${table.deliveryAttemptCount} >= 1
          and ${table.deliveryStartedAt} is not null
          and ${table.nextAttemptAt} is null
          and ${table.reasonCode} is null
          and ${table.receiptCodecVersion} is null
          and ${table.settledAt} is null
          and ${table.claimOwner} is not null)
        or (${table.deliveryState} = 'delivered'
          and ${table.requestCodecVersion} is not null
          and ${table.deliveryAttemptCount} >= 1
          and ${table.deliveryStartedAt} is not null
          and ${table.nextAttemptAt} is null
          and ${table.reasonCode} is null
          and ${table.receiptCodecVersion} is not null
          and ${table.settledAt} is not null
          and ${table.claimOwner} is null)
        or (${table.deliveryState} = 'retry_wait'
          and ${table.requestCodecVersion} is not null
          and ${table.deliveryAttemptCount} >= 1
          and ${table.deliveryStartedAt} is not null
          and ${table.nextAttemptAt} is not null
          and ${table.nextAttemptAt} > ${table.deliveryStartedAt}
          and ${table.reasonCode} is not null
          and ${table.receiptCodecVersion} is null
          and ${table.settledAt} is null)
        or (${table.deliveryState} = 'rejected'
          and ${table.requestCodecVersion} is not null
          and ${table.deliveryAttemptCount} >= 1
          and ${table.deliveryStartedAt} is not null
          and ${table.nextAttemptAt} is null
          and ${table.reasonCode} is not null
          and ${table.receiptCodecVersion} is null
          and ${table.settledAt} is not null
          and ${table.claimOwner} is null)
        or (${table.deliveryState} = 'obsolete'
          and ${table.deliveryAttemptCount} = 0
          and ${table.deliveryStartedAt} is null
          and ${table.nextAttemptAt} is null
          and ${table.reasonCode} is not null
          and ${table.receiptCodecVersion} is null
          and ${table.settledAt} is not null
          and ${table.claimOwner} is null)
        or (${table.deliveryState} = 'quarantined'
          and ${table.deliveryAttemptCount} >= 0
          and ((${table.deliveryAttemptCount} = 0
              and ${table.deliveryStartedAt} is null)
            or (${table.deliveryAttemptCount} >= 1
              and ${table.deliveryStartedAt} is not null
              and ${table.requestCodecVersion} is not null))
          and ${table.nextAttemptAt} is null
          and ${table.reasonCode} is not null
          and ${table.receiptCodecVersion} is null
          and ${table.settledAt} is not null
          and ${table.claimOwner} is null)
      ) is true`,
    ),
    check(
      "fx_task_compute_cancel_v1_reason_check",
      sql`(${table.reasonCode} is null or (
        ${table.reasonCode} ~ '^[a-z][a-z0-9_]*$'
        and octet_length(convert_to(${table.reasonCode}, 'UTF8')) between 1 and ${sql.raw(
          String(MAX_TASK_COMPUTE_DELIVERY_REASON_CODE_UTF8_BYTES_V1),
        )}
      )) is true`,
    ),
    check(
      "fx_task_compute_cancel_v1_time_check",
      sql`(isfinite(${table.createdAt})
        and isfinite(${table.updatedAt})
        and ${table.updatedAt} >= ${table.createdAt}
        and (${table.deliveryStartedAt} is null
          or (isfinite(${table.deliveryStartedAt})
            and ${table.deliveryStartedAt} >= ${table.createdAt}))
        and (${table.nextAttemptAt} is null
          or isfinite(${table.nextAttemptAt}))
        and (${table.settledAt} is null
          or (isfinite(${table.settledAt})
            and ${table.settledAt} >= ${table.createdAt}
            and (${table.deliveryStartedAt} is null
              or ${table.settledAt} >= ${table.deliveryStartedAt})))) is true`,
    ),
  ],
);
