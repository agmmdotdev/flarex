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
import {
  MAX_COMMIT_CANONICAL_EVIDENCE_BYTES_V1,
  MAX_COMMIT_RESULT_SEMANTIC_BYTES_V1,
} from "flarex-protocol/commit-protocol";
import type { CommitSeq, ScopeEpochUuidV1, ScopeUuidV1 } from "flarex-protocol/storage-authority";
import type {
  TransactionFunctionPathV1,
  TransactionIdentityAccessPolicySha256V1,
  TransactionRequestKeyV1,
  TransactionRequestSha256V1,
} from "flarex-protocol/transaction-session";
import { MAX_TRANSACTION_REQUEST_KEY_UTF8_BYTES_V1 } from "flarex-protocol/transaction-session";
import type { FlarexValueCodecVersion } from "flarex-protocol/value";
import {
  MAX_APPLICATION_RELATION_ADJACENCY_CHANGES,
} from "../../application/relations/commit/Model";
import { bytea, nonBlankText } from "./primitives";
import { fxSystemScopeClocks } from "./scope";

type IdempotencyResultState = "available" | "expired";

export type CommitWakeOutboxDeliveryStateV1 =
  | "pending"
  | "claimed"
  | "delivered"
  | "dead_lettered";

export type CommitWakeOutboxFailureCodeV1 =
  | "transient_delivery"
  | "claim_lease_expired"
  | "terminal_delivery"
  | "attempts_exhausted";

/**
 * Scope-local commit headers for the authoritative replacement app-row feed.
 * The sequence, rather than committed_at, defines feed order.
 */
export const fxSystemCommits = pgTable(
  "fx_system_commit",
  {
    scopeUuid: uuid("scope_uuid").$type<ScopeUuidV1>().notNull(),
    epochUuid: uuid("epoch_uuid").$type<ScopeEpochUuidV1>().notNull(),
    commitSeq: bigint("commit_seq", { mode: "bigint" })
      .$type<CommitSeq>()
      .notNull(),
    changeCount: integer("change_count").notNull(),
    relationAdjacencyChangeCount:
      integer("relation_adjacency_change_count").notNull().default(0),
    payloadPreferenceDeletionCount: integer("payload_preference_deletion_count").notNull().default(0),
    relationalChangeCount: integer("relational_change_count").notNull().default(0),
    eventCount: integer("event_count").notNull().default(0),
    eventSha256: text("event_sha256"),
    committedAt: timestamp("committed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.scopeUuid, table.commitSeq] }),
    index("fx_commit_event_directory_idx").on(table.scopeUuid, table.epochUuid, table.commitSeq).where(sql`${table.eventCount} > 0`),
    index("fx_commit_event_free_history_idx").on(table.scopeUuid, table.commitSeq).where(sql`${table.eventCount} = 0`),
    unique("fx_system_commit_scope_epoch_seq_unique").on(
      table.scopeUuid,
      table.epochUuid,
      table.commitSeq,
    ),
    foreignKey({
      name: "fx_system_commit_scope_clock_fk",
      columns: [table.scopeUuid],
      foreignColumns: [fxSystemScopeClocks.scopeUuid],
    })
      .onUpdate("restrict")
      .onDelete("restrict"),
    check(
      "fx_system_commit_seq_positive_check",
      sql`${table.commitSeq} >= 1`,
    ),
    check(
      "fx_system_commit_change_count_check",
      sql`${table.changeCount} between 0 and 16000`,
    ),
    check("fx_system_commit_preference_deletion_count_check", sql`${table.payloadPreferenceDeletionCount} between 0 and 256`),
    check("fx_system_commit_relational_change_count_check", sql`${table.relationalChangeCount} between 0 and 16000`),
    check("fx_system_commit_event_count_check", sql`${table.eventCount} between 0 and 2048`),
    check("fx_system_commit_event_digest_check", sql`(${table.eventCount} = 0 and ${table.eventSha256} is null) or (${table.eventCount} > 0 and ${table.eventSha256} is not null and ${table.eventSha256} ~ '^[0-9a-f]{64}$')`),
    check(
      "fx_system_commit_relation_adjacency_change_count_check",
      sql`${table.relationAdjacencyChangeCount} between 0 and ${sql.raw(
        String(MAX_APPLICATION_RELATION_ADJACENCY_CHANGES),
      )}`,
    ),
    check(
      "fx_system_commit_committed_at_finite_check",
      sql`isfinite(${table.committedAt})`,
    ),
  ],
);

/**
 * Scope-lifetime committed-success request outcomes. The commit token is an
 * immutable receipt, not a foreign-key pointer to compactable feed history.
 */
export const fxSystemIdempotency = pgTable(
  "fx_system_idempotency",
  {
    scopeUuid: uuid("scope_uuid").$type<ScopeUuidV1>().notNull(),
    requestKey: text("request_key")
      .$type<TransactionRequestKeyV1>()
      .notNull(),
    identityAccessPolicySha256: bytea("identity_access_policy_sha256")
      .$type<TransactionIdentityAccessPolicySha256V1>()
      .notNull(),
    functionPath: text("function_path")
      .$type<TransactionFunctionPathV1>()
      .notNull(),
    requestSha256: bytea("request_sha256")
      .$type<TransactionRequestSha256V1>()
      .notNull(),
    epochUuid: uuid("epoch_uuid").$type<ScopeEpochUuidV1>().notNull(),
    commitSeq: bigint("commit_seq", { mode: "bigint" })
      .$type<CommitSeq>()
      .notNull(),
    resultState: text("result_state")
      .$type<IdempotencyResultState>()
      .notNull(),
    resultEncoding: text("result_encoding").$type<"application-value" | "json">().notNull().default("application-value"),
    resultValueCodecVersion: integer("result_value_codec_version").$type<
      FlarexValueCodecVersion
    >(),
    resultSemanticBytes: integer("result_semantic_bytes"),
    resultBytes: bytea("result_bytes"),
    resultSha256: bytea("result_sha256"),
    resultExpiredAt: timestamp("result_expired_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.scopeUuid, table.requestKey] }),
    foreignKey({
      name: "fx_system_idempotency_scope_clock_fk",
      columns: [table.scopeUuid],
      foreignColumns: [fxSystemScopeClocks.scopeUuid],
    })
      .onUpdate("restrict")
      .onDelete("restrict"),
    index("fx_system_idempotency_commit_token_idx").on(
      table.scopeUuid,
      table.commitSeq,
      table.epochUuid,
    ),
    check(
      "fx_system_idempotency_request_key_check",
      sql`
        ${nonBlankText(table.requestKey)}
        and octet_length(${table.requestKey}) <= ${sql.raw(
          String(MAX_TRANSACTION_REQUEST_KEY_UTF8_BYTES_V1),
        )}
      `,
    ),
    check(
      "fx_system_idempotency_identity_hash_check",
      sql`octet_length(${table.identityAccessPolicySha256}) = 32`,
    ),
    check(
      "fx_system_idempotency_function_path_check",
      nonBlankText(table.functionPath),
    ),
    check(
      "fx_system_idempotency_request_hash_check",
      sql`octet_length(${table.requestSha256}) = 32`,
    ),
    check(
      "fx_system_idempotency_commit_seq_check",
      sql`${table.commitSeq} >= 1`,
    ),
    check(
      "fx_system_idempotency_result_state_check",
      sql`${table.resultState} in ('available', 'expired')`,
    ),
    check("fx_system_idempotency_result_encoding_check", sql`${table.resultEncoding} in ('application-value', 'json')`),
    check(
      "fx_system_idempotency_result_evidence_check",
      sql`
        (
          ${table.resultState} = 'available'
          and (
            (${table.resultEncoding} = 'application-value' and ${table.resultValueCodecVersion} is not null and ${table.resultValueCodecVersion} = 1)
            or (${table.resultEncoding} = 'json' and ${table.resultValueCodecVersion} is null
              and ${table.resultSemanticBytes} = octet_length(${table.resultBytes}))
          )
          and ${table.resultSemanticBytes} is not null
          and ${table.resultSemanticBytes} between 0 and ${sql.raw(
            String(MAX_COMMIT_RESULT_SEMANTIC_BYTES_V1),
          )}
          and ${table.resultBytes} is not null
          and octet_length(${table.resultBytes}) between 1 and ${sql.raw(
            String(MAX_COMMIT_CANONICAL_EVIDENCE_BYTES_V1),
          )}
          and ${table.resultSha256} is not null
          and octet_length(${table.resultSha256}) = 32
          and ${table.resultExpiredAt} is null
        )
        or
        (
          ${table.resultState} = 'expired'
          and ${table.resultValueCodecVersion} is null
          and ${table.resultSemanticBytes} is null
          and ${table.resultBytes} is null
          and ${table.resultSha256} is null
          and ${table.resultExpiredAt} is not null
          and isfinite(${table.resultExpiredAt})
          and ${table.resultExpiredAt} >= ${table.createdAt}
        )
      `,
    ),
    check(
      "fx_system_idempotency_created_at_check",
      sql`isfinite(${table.createdAt})`,
    ),
  ],
);

/**
 * Scope-local durable wake evidence for the first replacement commit
 * dispatcher. The commit token is correlated by the private repository rather
 * than foreign-keyed to compactable feed history.
 */
export const fxSystemCommitWakes = pgTable(
  "fx_system_commit_wake",
  {
    scopeUuid: uuid("scope_uuid").$type<ScopeUuidV1>().notNull(),
    epochUuid: uuid("epoch_uuid").$type<ScopeEpochUuidV1>().notNull(),
    commitSeq: bigint("commit_seq", { mode: "bigint" })
      .$type<CommitSeq>()
      .notNull(),
    deliveryState: text("delivery_state")
      .$type<CommitWakeOutboxDeliveryStateV1>()
      .notNull()
      .default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true })
      .defaultNow(),
    claimFence: bigint("claim_fence", { mode: "bigint" })
      .notNull()
      .default(sql`0`),
    claimOwner: uuid("claim_owner"),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    claimExpiresAt: timestamp("claim_expires_at", { withTimezone: true }),
    lastFailureCode: text("last_failure_code")
      .$type<CommitWakeOutboxFailureCodeV1>(),
    lastFailureSummary: text("last_failure_summary"),
    lastFailedAt: timestamp("last_failed_at", { withTimezone: true }),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    deadLetteredAt: timestamp("dead_lettered_at", { withTimezone: true }),
  },
  (table) => [
    primaryKey({ columns: [table.scopeUuid, table.commitSeq] }),
    foreignKey({
      name: "fx_system_commit_wake_scope_clock_fk",
      columns: [table.scopeUuid],
      foreignColumns: [fxSystemScopeClocks.scopeUuid],
    })
      .onUpdate("restrict")
      .onDelete("restrict"),
    index("fx_system_commit_wake_claimable_idx")
      .on(
        table.scopeUuid,
        sql`(
          case
            when ${table.deliveryState} = 'pending' then ${table.nextAttemptAt}
            when ${table.deliveryState} = 'claimed' then ${table.claimExpiresAt}
            else null
          end
        )`,
        table.commitSeq,
      )
      .where(sql`${table.deliveryState} in ('pending', 'claimed')`),
    check(
      "fx_system_commit_wake_commit_seq_check",
      sql`${table.commitSeq} >= 1`,
    ),
    check(
      "fx_system_commit_wake_delivery_state_check",
      sql`${table.deliveryState} in ('pending', 'claimed', 'delivered', 'dead_lettered')`,
    ),
    check(
      "fx_system_commit_wake_claim_fence_check",
      sql`${table.claimFence} >= 0`,
    ),
    check(
      "fx_system_commit_wake_failure_evidence_check",
      sql`
        (
          (
            ${table.lastFailureCode} is null
            and ${table.lastFailureSummary} is null
            and ${table.lastFailedAt} is null
          )
          or
          (
            ${table.lastFailureCode} in (
              'transient_delivery',
              'claim_lease_expired',
              'terminal_delivery',
              'attempts_exhausted'
            )
            and ${table.lastFailedAt} is not null
            and isfinite(${table.lastFailedAt})
            and ${table.lastFailedAt} >= ${table.createdAt}
            and (
              ${table.lastFailureSummary} is null
              or (
                ${nonBlankText(table.lastFailureSummary)}
                and octet_length(${table.lastFailureSummary}) <= 1024
              )
            )
          )
        ) is true
      `,
    ),
    check(
      "fx_system_commit_wake_state_shape_check",
      sql`
        (
          (
            ${table.deliveryState} = 'pending'
            and ${table.nextAttemptAt} is not null
            and isfinite(${table.nextAttemptAt})
            and ${table.nextAttemptAt} >= ${table.createdAt}
            and ${table.claimOwner} is null
            and ${table.claimedAt} is null
            and ${table.claimExpiresAt} is null
            and ${table.deliveredAt} is null
            and ${table.deadLetteredAt} is null
            and (
              (
                ${table.claimFence} = 0
                and ${table.nextAttemptAt} = ${table.createdAt}
                and ${table.lastFailureCode} is null
                and ${table.lastFailureSummary} is null
                and ${table.lastFailedAt} is null
              )
              or
              (
                ${table.claimFence} >= 1
                and ${table.lastFailureCode} is not null
                and ${table.lastFailedAt} is not null
                and ${table.nextAttemptAt} >= ${table.lastFailedAt}
              )
            )
          )
          or
          (
            ${table.deliveryState} = 'claimed'
            and ${table.claimFence} >= 1
            and ${table.nextAttemptAt} is null
            and ${table.claimOwner} is not null
            and ${table.claimedAt} is not null
            and isfinite(${table.claimedAt})
            and ${table.claimedAt} >= ${table.createdAt}
            and ${table.claimExpiresAt} is not null
            and isfinite(${table.claimExpiresAt})
            and ${table.claimExpiresAt} > ${table.claimedAt}
            and ${table.deliveredAt} is null
            and ${table.deadLetteredAt} is null
            and (
              (
                ${table.claimFence} = 1
                and ${table.lastFailureCode} is null
                and ${table.lastFailureSummary} is null
                and ${table.lastFailedAt} is null
              )
              or
              (
                ${table.claimFence} > 1
                and ${table.lastFailureCode} is not null
                and ${table.lastFailedAt} is not null
              )
            )
          )
          or
          (
            ${table.deliveryState} = 'delivered'
            and ${table.claimFence} >= 1
            and ${table.nextAttemptAt} is null
            and ${table.claimOwner} is null
            and ${table.claimedAt} is null
            and ${table.claimExpiresAt} is null
            and ${table.deliveredAt} is not null
            and isfinite(${table.deliveredAt})
            and ${table.deliveredAt} >= ${table.createdAt}
            and ${table.deadLetteredAt} is null
            and (
              (
                ${table.claimFence} = 1
                and ${table.lastFailureCode} is null
                and ${table.lastFailureSummary} is null
                and ${table.lastFailedAt} is null
              )
              or
              (
                ${table.claimFence} > 1
                and ${table.lastFailureCode} is not null
                and ${table.lastFailedAt} is not null
              )
            )
          )
          or
          (
            ${table.deliveryState} = 'dead_lettered'
            and ${table.claimFence} >= 1
            and ${table.nextAttemptAt} is null
            and ${table.claimOwner} is null
            and ${table.claimedAt} is null
            and ${table.claimExpiresAt} is null
            and ${table.lastFailureCode} in (
              'terminal_delivery',
              'attempts_exhausted'
            )
            and ${table.lastFailedAt} is not null
            and ${table.deliveredAt} is null
            and ${table.deadLetteredAt} is not null
            and isfinite(${table.deadLetteredAt})
            and ${table.deadLetteredAt} >= ${table.createdAt}
            and ${table.deadLetteredAt} = ${table.lastFailedAt}
          )
        ) is true
      `,
    ),
    check(
      "fx_system_commit_wake_created_at_check",
      sql`isfinite(${table.createdAt})`,
    ),
  ],
);
