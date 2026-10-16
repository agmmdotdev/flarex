import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  foreignKey,
  index,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type {
  ScopeEpoch,
  ScopeId,
  ScopeUuidV1,
  StorageGenerationFence,
} from "flarex-protocol/storage-authority";
import type {
  ApplicationActionExecutionAuthorityV1,
} from "flarex-protocol/internal/application-action-authority-v1";
import { bytea, nonBlankText } from "./primitives";
import { fxSystemScopeClocks } from "./scope";
import type { Json } from "flarex-protocol/json";

/**
 * Private, route-independent direct edge-action invocation authority.
 * Canonical arguments and results remain in R2; this row stores only their
 * content-addressed references and the fenced lifecycle decision.
 */
export const fxSystemApplicationActionInvocationsV1 = pgTable(
  "fx_system_application_action_invocation_v1",
  {
    scopeId: text("scope_id").$type<ScopeId>().notNull(),
    scopeUuid: uuid("scope_uuid")
      .$type<ScopeUuidV1>()
      .generatedAlwaysAs(sql`
        case
          when "scope_id" ~ '^scope_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          then substring("scope_id" from 7)::uuid
          else null
        end
      `),
    scopeEpoch: text("scope_epoch").$type<ScopeEpoch>().notNull(),
    storageGenerationFence: bigint("storage_generation_fence", {
      mode: "bigint",
    }).$type<StorageGenerationFence>().notNull(),
    requestKey: text("request_key").notNull(),
    invocationId: uuid("invocation_id").notNull(),
    requestIdentitySha256: bytea("request_identity_sha256").notNull(),
    executionAuthorityGeneration: text("execution_authority_generation")
      .$type<"legacy_candidate_bound_v1" | "application_v1">()
      .notNull().default("legacy_candidate_bound_v1"),
    actionBindingSha256: bytea("action_binding_sha256"),
    applicationRevisionId: text("application_revision_id"),
    candidateSha256: bytea("candidate_sha256"),
    applicationExecutionAuthorityJson: jsonb(
      "application_execution_authority_json",
    ).$type<ApplicationActionExecutionAuthorityV1>(),
    applicationExecutionAuthorityCanonicalBytes: bytea(
      "application_execution_authority_canonical_bytes",
    ),
    applicationExecutionAuthoritySha256: bytea(
      "application_execution_authority_sha256",
    ),
    actionFunctionPath: text("action_function_path").notNull(),
    executionIdentitySha256: bytea("execution_identity_sha256").notNull(),
    compatibilityDate: text("compatibility_date").notNull(),
    hostPolicySha256: bytea("host_policy_sha256").notNull(),
    argumentStoreIdentity: text("argument_store_identity").notNull(),
    argumentCodecIdentity: text("argument_codec_identity").notNull(),
    argumentObjectKey: text("argument_object_key").notNull(),
    argumentByteLength: bigint("argument_byte_length", { mode: "bigint" })
      .notNull(),
    argumentSha256: bytea("argument_sha256").notNull(),
    lifecycle: text("lifecycle").$type<
      "admitted" | "executing" | "completed" | "failed" | "uncertain" |
        "cancelled"
    >().notNull(),
    executionGeneration: bigint("execution_generation", { mode: "bigint" })
      .notNull().default(sql`0`),
    invocationTime: timestamp("invocation_time", { withTimezone: true }),
    executionDeadline: timestamp("execution_deadline", { withTimezone: true }),
    randomSeedSha256: bytea("random_seed_sha256"),
    lastEffectOrdinal: bigint("last_effect_ordinal", { mode: "bigint" })
      .notNull().default(sql`0`),
    cancellationRequestedAt: timestamp("cancellation_requested_at", {
      withTimezone: true,
    }),
    resultStoreIdentity: text("result_store_identity"),
    resultCodecIdentity: text("result_codec_identity"),
    resultObjectKey: text("result_object_key"),
    resultByteLength: bigint("result_byte_length", { mode: "bigint" }),
    resultSha256: bytea("result_sha256"),
    terminalCode: text("terminal_code"),
    admittedAt: timestamp("admitted_at", { withTimezone: true })
      .notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull().defaultNow(),
    terminalAt: timestamp("terminal_at", { withTimezone: true }),
  },
  table => [
    primaryKey({ columns: [table.scopeUuid, table.requestKey] }),
    unique("fx_action_invocation_v1_scope_invocation_unique").on(
      table.scopeUuid,
      table.invocationId,
    ),
    index("fx_action_invocation_v1_application_retirement_pin_idx")
      .on(
        table.scopeId,
        table.requestKey,
      )
      .where(sql`${table.executionAuthorityGeneration} = 'application_v1'
        and ${table.lifecycle} in ('admitted', 'executing')`),
    foreignKey({
      name: "fx_action_invocation_v1_scope_fk",
      columns: [table.scopeId],
      foreignColumns: [fxSystemScopeClocks.scopeId],
    }).onDelete("restrict"),
    check(
      "fx_action_invocation_v1_identity_check",
      sql`${nonBlankText(table.scopeId)}
        and ${nonBlankText(table.requestKey)}
        and octet_length(convert_to(${table.requestKey}, 'UTF8')) <= 2048
        and ${nonBlankText(table.actionFunctionPath)}
        and octet_length(convert_to(${table.actionFunctionPath}, 'UTF8')) <= 2048
        and ${nonBlankText(table.compatibilityDate)}
        and octet_length(convert_to(${table.compatibilityDate}, 'UTF8')) <= 2048
        and octet_length(${table.requestIdentitySha256}) = 32
        and octet_length(${table.executionIdentitySha256}) = 32
        and octet_length(${table.hostPolicySha256}) = 32
        and ${table.storageGenerationFence} >= 1`,
    ),
    check(
      "fx_action_invocation_v1_execution_authority_check",
      sql`(
        (${table.executionAuthorityGeneration} = 'legacy_candidate_bound_v1'
          and ${table.applicationRevisionId} is not null
          and ${nonBlankText(table.applicationRevisionId)}
          and octet_length(convert_to(${table.applicationRevisionId}, 'UTF8')) <= 2048
          and ${table.candidateSha256} is not null
          and octet_length(${table.candidateSha256}) = 32
          and ${table.actionBindingSha256} is not null
          and octet_length(${table.actionBindingSha256}) = 32
          and ${table.applicationExecutionAuthorityJson} is null
          and ${table.applicationExecutionAuthorityCanonicalBytes} is null
          and ${table.applicationExecutionAuthoritySha256} is null)
        or
        (${table.executionAuthorityGeneration} = 'application_v1'
          and ${table.applicationRevisionId} is null
          and ${table.candidateSha256} is null
          and ${table.actionBindingSha256} is null
          and ${table.applicationExecutionAuthorityJson} is not null
          and jsonb_typeof(${table.applicationExecutionAuthorityJson}) = 'object'
          and ${table.applicationExecutionAuthorityCanonicalBytes} is not null
          and octet_length(${table.applicationExecutionAuthorityCanonicalBytes}) between 1 and 131072
          and ${table.applicationExecutionAuthoritySha256} is not null
          and octet_length(${table.applicationExecutionAuthoritySha256}) = 32)
      )`,
    ),
    check(
      "fx_action_invocation_v1_argument_reference_check",
      sql`${table.argumentStoreIdentity} =
          'flarex.r2/execution-evidence-body/v1'
        and ${table.argumentCodecIdentity} =
          'flarex.codec/canonical-flarex-value/v1'
        and ${nonBlankText(table.argumentObjectKey)}
        and octet_length(convert_to(${table.argumentObjectKey}, 'UTF8')) <= 2048
        and ${table.argumentByteLength} >= 1
        and octet_length(${table.argumentSha256}) = 32`,
    ),
    check(
      "fx_action_invocation_v1_execution_check",
      sql`(
        (${table.lifecycle} = 'admitted'
          and ${table.invocationTime} is null
          and ${table.executionDeadline} is null
          and ${table.randomSeedSha256} is null)
        or (${table.lifecycle} <> 'admitted'
          and (${table.executionGeneration} >= 1 or
            (${table.lifecycle} = 'cancelled' and
              ${table.executionGeneration} = 0))
          and ((${table.executionGeneration} = 0
              and ${table.invocationTime} is null
              and ${table.executionDeadline} is null
              and ${table.randomSeedSha256} is null)
            or (${table.executionGeneration} >= 1
              and ${table.invocationTime} is not null
              and ${table.executionDeadline} is not null
              and ${table.executionDeadline} > ${table.invocationTime}
              and octet_length(${table.randomSeedSha256}) = 32)))
      ) and ${table.executionGeneration} >= 0
        and ${table.lastEffectOrdinal} >= 0`,
    ),
    check(
      "fx_action_invocation_v1_terminal_check",
      sql`(
        (${table.lifecycle} in ('admitted', 'executing')
          and ${table.terminalAt} is null
          and ${table.terminalCode} is null
          and ${table.resultStoreIdentity} is null
          and ${table.resultCodecIdentity} is null
          and ${table.resultObjectKey} is null
          and ${table.resultByteLength} is null
          and ${table.resultSha256} is null)
        or (${table.lifecycle} = 'completed'
          and ${table.terminalAt} is not null
          and ${table.terminalCode} is null
          and ${table.resultStoreIdentity} =
            'flarex.r2/execution-evidence-body/v1'
          and ${table.resultCodecIdentity} =
            'flarex.codec/canonical-flarex-value/v1'
          and ${nonBlankText(table.resultObjectKey)}
          and octet_length(convert_to(${table.resultObjectKey}, 'UTF8')) <= 2048
          and ${table.resultByteLength} >= 1
          and octet_length(${table.resultSha256}) = 32)
        or (${table.lifecycle} in ('failed', 'uncertain', 'cancelled')
          and ${table.terminalAt} is not null
          and ${nonBlankText(table.terminalCode)}
          and octet_length(convert_to(${table.terminalCode}, 'UTF8')) <= 2048
          and ${table.resultStoreIdentity} is null
          and ${table.resultCodecIdentity} is null
          and ${table.resultObjectKey} is null
          and ${table.resultByteLength} is null
          and ${table.resultSha256} is null)
      )`,
    ),
    check(
      "fx_action_invocation_v1_timestamp_check",
      sql`isfinite(${table.admittedAt})
        and isfinite(${table.updatedAt})
        and ${table.updatedAt} >= ${table.admittedAt}
        and (${table.terminalAt} is null or
          (isfinite(${table.terminalAt}) and
            ${table.terminalAt} >= ${table.admittedAt}))
        and (${table.cancellationRequestedAt} is null or
          isfinite(${table.cancellationRequestedAt}))`,
    ),
  ],
);

/** Shared evidence for possibly externally visible effects. */
export const fxSystemExternalEffectAttemptsV1 = pgTable(
  "fx_system_external_effect_attempt_v1",
  {
    scopeId: text("scope_id").$type<ScopeId>().notNull(),
    scopeUuid: uuid("scope_uuid")
      .$type<ScopeUuidV1>()
      .generatedAlwaysAs(sql`
        case
          when "scope_id" ~ '^scope_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          then substring("scope_id" from 7)::uuid
          else null
        end
      `),
    subjectKind: text("subject_kind").$type<
      "direct_action" | "durable_task_attempt"
    >().notNull(),
    subjectIdentitySha256: bytea("subject_identity_sha256").notNull(),
    subjectFence: bigint("subject_fence", { mode: "bigint" }).notNull(),
    effectOrdinal: bigint("effect_ordinal", { mode: "bigint" }).notNull(),
    effectKind: text("effect_kind").$type<
      "outbound_http" | "child_mutation" | "child_commerce" | "trusted_callback"
    >().notNull(),
    stableEffectKey: text("stable_effect_key").notNull(),
    requestIdentitySha256: bytea("request_identity_sha256").notNull(),
    requestStoreIdentity: text("request_store_identity"),
    requestCodecIdentity: text("request_codec_identity"),
    requestObjectKey: text("request_object_key"),
    requestByteLength: bigint("request_byte_length", { mode: "bigint" }),
    requestSha256: bytea("request_sha256"),
    childMutationRequestKey: text("child_mutation_request_key"),
    childMutationFunctionPath: text("child_mutation_function_path"),
    childMutationArgumentsSha256: bytea("child_mutation_arguments_sha256"),
    childCommerceRequestKey: text("child_commerce_request_key"),
    childCommerceCommandName: text("child_commerce_command_name"),
    childCommerceArgumentsSha256: bytea("child_commerce_arguments_sha256"),
    childCommercePolicySha256: bytea("child_commerce_policy_sha256"),
    trustedCallbackId: text("trusted_callback_id"),
    trustedCallbackRevision: text("trusted_callback_revision"),
    trustedCallbackBindingSha256: bytea("trusted_callback_binding_sha256"),
    trustedCallbackInputJson: jsonb("trusted_callback_input_json").$type<Json>(),
    trustedCallbackInputSha256: bytea("trusted_callback_input_sha256"),
    trustedCallbackPolicyJson: jsonb("trusted_callback_policy_json").$type<Json>(),
    trustedCallbackPolicySha256: bytea("trusted_callback_policy_sha256"),
    trustedCallbackOutcomeJson: jsonb("trusted_callback_outcome_json").$type<Json>(),
    trustedCallbackOutcomeSha256: bytea("trusted_callback_outcome_sha256"),
    state: text("state").$type<
      "prepared" | "failed_before_dispatch" | "dispatching" | "confirmed" |
        "uncertain"
    >().notNull(),
    preparedAt: timestamp("prepared_at", { withTimezone: true })
      .notNull().defaultNow(),
    dispatchDeclaredAt: timestamp("dispatch_declared_at", {
      withTimezone: true,
    }),
    settledAt: timestamp("settled_at", { withTimezone: true }),
    responseStoreIdentity: text("response_store_identity"),
    responseCodecIdentity: text("response_codec_identity"),
    responseObjectKey: text("response_object_key"),
    responseByteLength: bigint("response_byte_length", { mode: "bigint" }),
    responseSha256: bytea("response_sha256"),
    childMutationOutcomeSha256: bytea("child_mutation_outcome_sha256"),
    childCommerceOutcomeSha256: bytea("child_commerce_outcome_sha256"),
    terminalCode: text("terminal_code"),
  },
  table => [
    primaryKey({ columns: [
      table.scopeUuid,
      table.subjectKind,
      table.subjectIdentitySha256,
      table.subjectFence,
      table.effectOrdinal,
    ] }),
    foreignKey({
      name: "fx_external_effect_attempt_v1_scope_fk",
      columns: [table.scopeId],
      foreignColumns: [fxSystemScopeClocks.scopeId],
    }).onDelete("restrict"),
    uniqueIndex("fx_external_effect_commerce_key_idx").on(table.scopeUuid, table.stableEffectKey)
      .where(sql`${table.effectKind} = 'child_commerce'`),
    uniqueIndex("fx_external_effect_callback_key_idx").on(table.scopeUuid, table.stableEffectKey)
      .where(sql`${table.effectKind} = 'trusted_callback'`),
    check(
      "fx_external_effect_attempt_v1_identity_check",
      sql`${table.subjectKind} in ('direct_action', 'durable_task_attempt')
        and octet_length(${table.subjectIdentitySha256}) = 32
        and ${table.subjectFence} >= 1
        and ${table.effectOrdinal} >= 1
        and ${table.effectKind} in ('outbound_http', 'child_mutation', 'child_commerce', 'trusted_callback')
        and ${nonBlankText(table.stableEffectKey)}
        and octet_length(convert_to(${table.stableEffectKey}, 'UTF8')) <= 2048
        and octet_length(${table.requestIdentitySha256}) = 32`,
    ),
    check(
      "fx_external_effect_attempt_v1_request_check",
      sql`(
        (${table.effectKind} = 'outbound_http'
          and ${table.requestStoreIdentity} =
            'flarex.r2/execution-evidence-body/v1'
          and ${table.requestCodecIdentity} =
            'flarex.codec/canonical-http-request/v1'
          and ${nonBlankText(table.requestObjectKey)}
          and octet_length(convert_to(${table.requestObjectKey}, 'UTF8')) <= 2048
          and ${table.requestByteLength} >= 1
          and octet_length(${table.requestSha256}) = 32
          and ${table.childMutationRequestKey} is null
          and ${table.childMutationFunctionPath} is null
          and ${table.childMutationArgumentsSha256} is null)
        or (${table.effectKind} = 'child_mutation'
          and ${table.requestStoreIdentity} is null
          and ${table.requestCodecIdentity} is null
          and ${table.requestObjectKey} is null
          and ${table.requestByteLength} is null
          and ${table.requestSha256} is null
          and ${nonBlankText(table.childMutationRequestKey)}
          and octet_length(convert_to(${table.childMutationRequestKey}, 'UTF8')) <= 2048
          and ${nonBlankText(table.childMutationFunctionPath)}
          and octet_length(convert_to(${table.childMutationFunctionPath}, 'UTF8')) <= 2048
          and octet_length(${table.childMutationArgumentsSha256}) = 32)
        or (${table.effectKind} = 'child_commerce'
          and ${table.subjectKind} = 'durable_task_attempt'
          and ${table.effectOrdinal} between 1 and 16
          and ${table.requestStoreIdentity} is null
          and ${table.requestCodecIdentity} is null
          and ${table.requestObjectKey} is null
          and ${table.requestByteLength} is null
          and ${table.requestSha256} is null
          and ${table.childMutationRequestKey} is null
          and ${table.childMutationFunctionPath} is null
          and ${table.childMutationArgumentsSha256} is null
          and ${table.childCommerceRequestKey} is not null
          and ${table.childCommerceRequestKey} = ${table.stableEffectKey}
          and ${table.childCommerceCommandName} is not null
          and ${table.childCommerceCommandName} ~ '^[a-zA-Z][a-zA-Z0-9._-]{0,127}$'
          and ${table.childCommerceArgumentsSha256} is not null
          and octet_length(${table.childCommerceArgumentsSha256}) = 32
          and ${table.childCommercePolicySha256} is not null
          and octet_length(${table.childCommercePolicySha256}) = 32)
        or (${table.effectKind} = 'trusted_callback'
          and ${table.subjectKind} = 'durable_task_attempt'
          and ${table.effectOrdinal} between 1 and 16
          and ${table.requestStoreIdentity} is null and ${table.requestCodecIdentity} is null
          and ${table.requestObjectKey} is null and ${table.requestByteLength} is null and ${table.requestSha256} is null
          and ${table.childMutationRequestKey} is null and ${table.childMutationFunctionPath} is null
          and ${table.childMutationArgumentsSha256} is null)
      )`,
    ),
    check("fx_external_effect_commerce_columns_check", sql`
      ${table.effectKind} = 'child_commerce' or (
        ${table.childCommerceRequestKey} is null and ${table.childCommerceCommandName} is null
        and ${table.childCommerceArgumentsSha256} is null and ${table.childCommercePolicySha256} is null
        and ${table.childCommerceOutcomeSha256} is null)`),
    check("fx_external_effect_callback_columns_check", sql`
      (${table.effectKind} <> 'trusted_callback'
        and ${table.trustedCallbackId} is null and ${table.trustedCallbackRevision} is null
        and ${table.trustedCallbackBindingSha256} is null and ${table.trustedCallbackInputJson} is null
        and ${table.trustedCallbackInputSha256} is null and ${table.trustedCallbackPolicyJson} is null
        and ${table.trustedCallbackPolicySha256} is null and ${table.trustedCallbackOutcomeJson} is null
        and ${table.trustedCallbackOutcomeSha256} is null)
      or (${table.effectKind} = 'trusted_callback'
        and ${table.trustedCallbackId} is not null and ${table.trustedCallbackId} ~ '^[a-zA-Z][a-zA-Z0-9._-]{0,127}$'
        and ${table.trustedCallbackRevision} is not null and ${table.trustedCallbackRevision} ~ '^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$'
        and ${table.trustedCallbackBindingSha256} is not null and octet_length(${table.trustedCallbackBindingSha256}) = 32
        and ${table.trustedCallbackInputJson} is not null
        and octet_length(convert_to(${table.trustedCallbackInputJson}::text, 'UTF8')) <= 262144
        and ${table.trustedCallbackInputSha256} is not null and octet_length(${table.trustedCallbackInputSha256}) = 32
        and ${table.trustedCallbackPolicyJson} is not null and jsonb_typeof(${table.trustedCallbackPolicyJson}) = 'object'
        and octet_length(convert_to(${table.trustedCallbackPolicyJson}::text, 'UTF8')) <= 16384
        and ${table.trustedCallbackPolicySha256} is not null and octet_length(${table.trustedCallbackPolicySha256}) = 32
        and ((${table.state} = 'confirmed'
          and ${table.trustedCallbackOutcomeJson} is not null and jsonb_typeof(${table.trustedCallbackOutcomeJson}) = 'object'
          and ${table.trustedCallbackOutcomeJson} ? 'kind'
          and jsonb_typeof(${table.trustedCallbackOutcomeJson}->'kind') = 'string'
          and ((${table.trustedCallbackOutcomeJson}->>'kind' = 'returned'
              and ${table.trustedCallbackOutcomeJson} ? 'value'
              and (${table.trustedCallbackOutcomeJson} - 'kind' - 'value') = '{}'::jsonb)
            or (${table.trustedCallbackOutcomeJson}->>'kind' = 'failed'
              and ${table.trustedCallbackOutcomeJson} ? 'error'
              and (${table.trustedCallbackOutcomeJson} - 'kind' - 'error') = '{}'::jsonb))
          and octet_length(convert_to(${table.trustedCallbackOutcomeJson}::text, 'UTF8')) <= 262144
          and ${table.trustedCallbackOutcomeSha256} is not null and octet_length(${table.trustedCallbackOutcomeSha256}) = 32)
          or (${table.state} <> 'confirmed' and ${table.trustedCallbackOutcomeJson} is null and ${table.trustedCallbackOutcomeSha256} is null)))`),
    check(
      "fx_external_effect_attempt_v1_state_check",
      sql`(
        (${table.state} = 'prepared'
          and ${table.dispatchDeclaredAt} is null
          and ${table.settledAt} is null
          and ${table.terminalCode} is null)
        or (${table.state} = 'failed_before_dispatch'
          and ${table.dispatchDeclaredAt} is null
          and ${table.settledAt} is not null
          and ${nonBlankText(table.terminalCode)})
        or (${table.state} = 'dispatching'
          and ${table.dispatchDeclaredAt} is not null
          and ${table.settledAt} is null
          and ${table.terminalCode} is null)
        or (${table.state} = 'uncertain'
          and ${table.dispatchDeclaredAt} is not null
          and ${table.settledAt} is not null
          and ${nonBlankText(table.terminalCode)})
        or (${table.state} = 'confirmed'
          and ${table.dispatchDeclaredAt} is not null
          and ${table.settledAt} is not null
          and ${table.terminalCode} is null)
      )`,
    ),
    check(
      "fx_external_effect_attempt_v1_outcome_check",
      sql`(
        (${table.state} <> 'confirmed'
          and ${table.responseStoreIdentity} is null
          and ${table.responseCodecIdentity} is null
          and ${table.responseObjectKey} is null
          and ${table.responseByteLength} is null
          and ${table.responseSha256} is null
          and ${table.childMutationOutcomeSha256} is null)
        or (${table.state} = 'confirmed'
          and ${table.effectKind} = 'outbound_http'
          and ${table.responseStoreIdentity} =
            'flarex.r2/execution-evidence-body/v1'
          and ${table.responseCodecIdentity} =
            'flarex.codec/canonical-http-response/v1'
          and ${nonBlankText(table.responseObjectKey)}
          and octet_length(convert_to(${table.responseObjectKey}, 'UTF8')) <= 2048
          and ${table.responseByteLength} >= 1
          and octet_length(${table.responseSha256}) = 32
          and ${table.childMutationOutcomeSha256} is null)
        or (${table.state} = 'confirmed'
          and ${table.effectKind} = 'child_mutation'
          and ${table.responseStoreIdentity} is null
          and ${table.responseCodecIdentity} is null
          and ${table.responseObjectKey} is null
          and ${table.responseByteLength} is null
          and ${table.responseSha256} is null
          and octet_length(${table.childMutationOutcomeSha256}) = 32)
        or (${table.state} = 'confirmed'
          and ${table.effectKind} = 'child_commerce'
          and ${table.responseStoreIdentity} is null
          and ${table.responseCodecIdentity} is null
          and ${table.responseObjectKey} is null
          and ${table.responseByteLength} is null
          and ${table.responseSha256} is null
          and ${table.childMutationOutcomeSha256} is null
          and ${table.childCommerceOutcomeSha256} is not null
          and octet_length(${table.childCommerceOutcomeSha256}) = 32)
        or (${table.state} = 'confirmed' and ${table.effectKind} = 'trusted_callback'
          and ${table.responseStoreIdentity} is null and ${table.responseCodecIdentity} is null
          and ${table.responseObjectKey} is null and ${table.responseByteLength} is null and ${table.responseSha256} is null
          and ${table.childMutationOutcomeSha256} is null)
      )`,
    ),
    check("fx_external_effect_commerce_state_check", sql`
      ${table.effectKind} <> 'child_commerce' or (
        (${table.state} = 'confirmed' and ${table.childCommerceOutcomeSha256} is not null)
        or (${table.state} <> 'confirmed' and ${table.childCommerceOutcomeSha256} is null))`),
    check(
      "fx_external_effect_attempt_v1_timestamp_check",
      sql`isfinite(${table.preparedAt})
        and (${table.dispatchDeclaredAt} is null or
          (isfinite(${table.dispatchDeclaredAt}) and
            ${table.dispatchDeclaredAt} >= ${table.preparedAt}))
        and (${table.settledAt} is null or
          (isfinite(${table.settledAt}) and
            ${table.settledAt} >= ${table.preparedAt}))`,
    ),
  ],
);
