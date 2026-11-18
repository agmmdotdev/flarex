import { sql, type SQLWrapper } from "drizzle-orm";
import {
  bigint,
  check,
  doublePrecision,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import type { AppCreationTimeV1 } from "flarex-protocol/app-document";
import {
  MAX_COMMIT_CANONICAL_EVIDENCE_BYTES_V1,
  MAX_COMMIT_FAILED_RECEIPT_EVIDENCE_BYTES_V1,
  MAX_COMMIT_PARTICIPANT_WORK_BYTES_V1,
  MAX_COMMIT_PARTICIPANT_WORK_CALLS_V1,
  MAX_COMMIT_FAILED_PARTICIPANT_WORK_BYTES_V1,
  MAX_COMMIT_FAILED_PARTICIPANT_WORK_CALLS_V1,
  CommitMaterialWriteEventEvidenceBytesV1Schema,
  MAX_COMMIT_MATERIAL_WRITE_EVENT_EVIDENCE_BYTES_V1,
  MAX_COMMIT_INDEXED_QUERY_SYSCALLS_V1,
  MAX_COMMIT_INDEX_RANGE_READ_DEPENDENCIES_V1,
  MAX_COMMIT_INDEX_RANGE_DEPENDENCY_EVIDENCE_BYTES_V1,
  MAX_COMMIT_POINT_READ_DEPENDENCIES_V1,
  MAX_COMMIT_RELATION_BASE_OCCURRENCES_V1,
  MAX_COMMIT_RELATION_READ_DEPENDENCIES_V1,
  MAX_COMMIT_RELATION_READ_SYSCALLS_V1,
  MAX_COMMIT_READ_DOCUMENTS_V1,
  MAX_COMMIT_READ_SEMANTIC_BYTES_V1,
  MAX_COMMIT_RESULT_SEMANTIC_BYTES_V1,
  MAX_COMMIT_WRITE_OPERATIONS_V1,
  MAX_COMMIT_WRITE_SEMANTIC_BYTES_V1,
  SESSION_JOURNAL_FORMAT,
  type ApplicationActivationSequenceV1,
  type CommitFinalSyscallSequenceV1,
  type CommitMaterialWriteEventEvidenceBytesV1,
  type CommitProtocolV1LimitDimension,
  type CommitSyscallSequenceV1,
  type LogicalAppWriteV1,
} from "flarex-protocol/commit-protocol";
import type {
  CatalogEdgeDefinitionId,
  CatalogIndexDefinitionId,
  CatalogTableId,
} from "flarex-protocol/catalog";
import {
  MAX_ORDERED_INDEX_BOUND_BYTES_V1,
  MAX_ORDERED_INDEX_KEY_BYTES_V1,
  type OrderedIndexKeyCodecVersion,
} from "flarex-protocol/ordered-index";
import type { JsonObject } from "flarex-protocol/json";
import type { CommitSeq, ScopeUuidV1 } from "flarex-protocol/storage-authority";
import type {
  TransactionAttemptFence,
  TransactionSessionIdV1,
} from "flarex-protocol/transaction-session";
import {
  MAX_FLAREX_APP_DOCUMENT_SEMANTIC_BYTES_V1,
  type CanonicalFlarexValueBytesV1,
  type FlarexValueCodecVersion,
  type FlarexValueSha256V1,
} from "flarex-protocol/value";
import type {
  TransactionExecutionClaimFenceV1,
  TransactionExecutionClaimOwnerV1,
} from "../../execution/claims/transactionExecutionClaimModel";
import { bytea } from "./primitives";
import { fxSystemTransactionSessions } from "./transactionSessions";

type TransactionJournalOperationalLimitDimensionV1 = Extract<
  CommitProtocolV1LimitDimension,
  | "readDocuments"
  | "readSemanticBytes"
  | "pointReadDependencies"
  | "indexedQuerySyscalls"
  | "indexRangeReadDependencies"
  | "indexRangeDependencyEvidenceBytes"
  | "relationReadSyscalls"
  | "relationReadDependencies"
  | "relationBaseOccurrences"
  | "writeOperations"
  | "writeSemanticBytes"
  | "materialWriteEventEvidenceBytes"
> | "operationCalls" | "receiptEvidenceBytes";

type TransactionJournalOperationKindV1 =
  | "get"
  | "insert"
  | "patch"
  | "replace"
  | "delete"
  | "indexRange"
  | "relationIncoming"
  | "admittedLogicalOperation";

type TransactionJournalOutcomeKindV1 =
  | "missing"
  | "present"
  | "inserted"
  | "unit"
  | "indexRangePage"
  | "relationIncomingPage"
  | "relationConflict"
  | "error"
  | "admittedLogicalInvoking"
  | "admittedLogicalResult"
  | "admittedLogicalError";

type TransactionJournalDependencyKindV1 =
  | "present"
  | "missing_no_visible_revision"
  | "missing_tombstone"
  | "generated_insertion";

/** Bounded, temporary, exact-attempt logical journal authority. */
export const fxSystemTransactionJournals = pgTable(
  "fx_system_tx_journal",
  {
    scopeUuid: uuid("scope_uuid").$type<ScopeUuidV1>().notNull(),
    sessionId: uuid("session_id").$type<TransactionSessionIdV1>().notNull(),
    attemptFence: bigint("attempt_fence", { mode: "bigint" })
      .$type<TransactionAttemptFence>()
      .notNull(),
    journalFormat: text("journal_format").$type<typeof SESSION_JOURNAL_FORMAT>().notNull(),
    executionProfile: text("execution_profile")
      .$type<"durableOperations" | "finiteRoot">()
      .notNull()
      .default("durableOperations"),
    state: text("state")
      .$type<"open" | "sealed" | "failed" | "operation_invoking" | "operation_failed" | "relation_conflicted">()
      .notNull(),
    lastSyscallSequence: bigint("last_syscall_sequence", { mode: "bigint" })
      .$type<CommitFinalSyscallSequenceV1>()
      .notNull()
      .default(sql`0`),
    receiptEvidenceBytes: integer("receipt_evidence_bytes").notNull().default(0),
    participantWorkBytes: integer("participant_work_bytes").notNull().default(0),
    participantWorkCalls: integer("participant_work_calls").notNull().default(0),
    creationTimeSeed: doublePrecision("creation_time_seed")
      .$type<AppCreationTimeV1>()
      .notNull(),
    nextCreationTime: doublePrecision("next_creation_time")
      .$type<AppCreationTimeV1>()
      .notNull(),
    readDocuments: integer("read_documents").notNull().default(0),
    readSemanticBytes: integer("read_semantic_bytes").notNull().default(0),
    pointDependencyCount: integer("point_dependency_count").notNull().default(0),
    indexedQuerySyscalls: integer("indexed_query_syscalls").notNull().default(0),
    indexRangeDependencyCount: integer("index_range_dependency_count")
      .notNull().default(0),
    indexRangeDependencyEvidenceBytes: integer(
      "index_range_dependency_evidence_bytes",
    ).notNull().default(0),
    relationReadSyscalls: integer("relation_read_syscalls")
      .notNull().default(0),
    relationDependencyCount: integer("relation_dependency_count")
      .notNull().default(0),
    relationBaseOccurrences: integer("relation_base_occurrences")
      .notNull().default(0),
    writeOperations: integer("write_operations").notNull().default(0),
    writeSemanticBytes: integer("write_semantic_bytes").notNull().default(0),
    materialWriteEventEvidenceBytes: integer(
      "material_write_event_evidence_bytes",
    ).$type<CommitMaterialWriteEventEvidenceBytesV1>().notNull().default(
      CommitMaterialWriteEventEvidenceBytesV1Schema.make(0),
    ),
    failureDimension: text("failure_dimension")
      .$type<TransactionJournalOperationalLimitDimensionV1>(),
    sealedJournalBytes: bytea("sealed_journal_bytes"),
    sealedJournalSha256: bytea("sealed_journal_sha256"),
    sealedResultValueCodecVersion: integer("sealed_result_value_codec_version")
      .$type<FlarexValueCodecVersion>(),
    sealedResultSemanticBytes: integer("sealed_result_semantic_bytes"),
    sealedResultBytes: bytea("sealed_result_bytes"),
    sealedResultSha256: bytea("sealed_result_sha256"),
    sealedAt: timestamp("sealed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    primaryKey({
      name: "fx_system_tx_journal_pk",
      columns: [table.scopeUuid, table.sessionId, table.attemptFence],
    }),
    foreignKey({
      name: "fx_system_tx_journal_attempt_fk",
      columns: [table.scopeUuid, table.sessionId, table.attemptFence],
      foreignColumns: [
        fxSystemTransactionSessions.scopeUuid,
        fxSystemTransactionSessions.sessionId,
        fxSystemTransactionSessions.attemptFence,
      ],
    })
      .onUpdate("restrict")
      .onDelete("restrict"),
    check(
      "fx_system_tx_journal_attempt_fence_check",
      sql`${table.attemptFence} >= 1`,
    ),
    check("fx_system_tx_journal_format_check", sql`${table.journalFormat} = 'flarex.session-journal'`),
    check("fx_system_tx_journal_execution_profile_check", sql`${table.executionProfile} in ('durableOperations', 'finiteRoot')`),
    check(
      "fx_system_tx_journal_state_check",
      sql`${table.state} in ('open', 'sealed', 'failed', 'operation_invoking', 'operation_failed', 'relation_conflicted')`,
    ),
    check(
      "fx_system_tx_journal_sequence_check",
      sql`${table.lastSyscallSequence} between 0 and 4096`,
    ),
    check("fx_system_tx_journal_receipt_bytes_check", sql`
      ${table.receiptEvidenceBytes} >= 0
      and (
        ${table.receiptEvidenceBytes} <= ${sql.raw(String(MAX_COMMIT_CANONICAL_EVIDENCE_BYTES_V1))}
        or (
          ${table.state} = 'failed'
          and ${table.failureDimension} is not null
          and ${table.receiptEvidenceBytes} <= ${sql.raw(String(MAX_COMMIT_FAILED_RECEIPT_EVIDENCE_BYTES_V1))}
        )
      )
    `),
    check("fx_system_tx_journal_participant_work_bytes_check", sql`
      ${table.participantWorkBytes} >= 0
      and (
        ${table.participantWorkBytes} <= ${sql.raw(String(MAX_COMMIT_PARTICIPANT_WORK_BYTES_V1))}
        or (${table.state} = 'operation_failed'
          and ${table.participantWorkBytes} <= ${sql.raw(String(MAX_COMMIT_FAILED_PARTICIPANT_WORK_BYTES_V1))})
      )
    `),
    check("fx_system_tx_journal_participant_work_calls_check", sql`
      ${table.participantWorkCalls} >= 0
      and (
        ${table.participantWorkCalls} <= ${sql.raw(String(MAX_COMMIT_PARTICIPANT_WORK_CALLS_V1))}
        or (${table.state} = 'operation_failed'
          and ${table.participantWorkCalls} <= ${sql.raw(String(MAX_COMMIT_FAILED_PARTICIPANT_WORK_CALLS_V1))})
      )
    `),
    check(
      "fx_system_tx_journal_creation_time_check",
      sql`
        ${table.creationTimeSeed} > 0
        and ${table.creationTimeSeed} < 9007199254740992
        and ${table.nextCreationTime} >= ${table.creationTimeSeed}
        and ${table.nextCreationTime} < 9007199254740992
      `,
    ),
    check(
      "fx_system_tx_journal_read_documents_check",
      sql`${table.readDocuments} between 0 and ${sql.raw(String(MAX_COMMIT_READ_DOCUMENTS_V1))}`,
    ),
    check(
      "fx_system_tx_journal_read_bytes_check",
      sql`${table.readSemanticBytes} between 0 and ${sql.raw(String(MAX_COMMIT_READ_SEMANTIC_BYTES_V1))}`,
    ),
    check(
      "fx_system_tx_journal_point_count_check",
      sql`${table.pointDependencyCount} between 0 and ${sql.raw(String(MAX_COMMIT_POINT_READ_DEPENDENCIES_V1))}`,
    ),
    check(
      "fx_system_tx_journal_indexed_query_count_check",
      sql`${table.indexedQuerySyscalls} between 0 and ${sql.raw(String(MAX_COMMIT_INDEXED_QUERY_SYSCALLS_V1))}`,
    ),
    check(
      "fx_system_tx_journal_index_range_count_check",
      sql`${table.indexRangeDependencyCount} between 0 and ${sql.raw(String(MAX_COMMIT_INDEX_RANGE_READ_DEPENDENCIES_V1))}`,
    ),
    check(
      "fx_system_tx_journal_index_range_evidence_bytes_check",
      sql`${table.indexRangeDependencyEvidenceBytes} between 0 and ${sql.raw(String(MAX_COMMIT_INDEX_RANGE_DEPENDENCY_EVIDENCE_BYTES_V1))}`,
    ),
    check(
      "fx_system_tx_journal_relation_read_count_check",
      sql`${table.relationReadSyscalls} between 0 and ${sql.raw(String(MAX_COMMIT_RELATION_READ_SYSCALLS_V1))}`,
    ),
    check(
      "fx_system_tx_journal_relation_dependency_count_check",
      sql`${table.relationDependencyCount} between 0 and ${sql.raw(String(MAX_COMMIT_RELATION_READ_DEPENDENCIES_V1))}`,
    ),
    check(
      "fx_system_tx_journal_relation_base_occurrence_count_check",
      sql`${table.relationBaseOccurrences} between 0 and ${sql.raw(String(MAX_COMMIT_RELATION_BASE_OCCURRENCES_V1))}`,
    ),
    check(
      "fx_system_tx_journal_write_count_check",
      sql`${table.writeOperations} between 0 and ${sql.raw(String(MAX_COMMIT_WRITE_OPERATIONS_V1))}`,
    ),
    check(
      "fx_system_tx_journal_write_bytes_check",
      sql`${table.writeSemanticBytes} between 0 and ${sql.raw(String(MAX_COMMIT_WRITE_SEMANTIC_BYTES_V1))}`,
    ),
    check(
      "fx_system_tx_journal_material_write_event_evidence_bytes_check",
      sql`${table.materialWriteEventEvidenceBytes} between 0 and ${sql.raw(String(MAX_COMMIT_MATERIAL_WRITE_EVENT_EVIDENCE_BYTES_V1))}`,
    ),
    check(
      "fx_system_tx_journal_failure_dimension_check",
      sql`
        ${table.failureDimension} is null
        or (
          ${table.failureDimension} is not null
          and ${table.failureDimension} in (
            'readDocuments',
            'readSemanticBytes',
            'pointReadDependencies',
            'indexedQuerySyscalls',
            'indexRangeReadDependencies',
            'indexRangeDependencyEvidenceBytes',
            'relationReadSyscalls',
            'relationReadDependencies',
            'relationBaseOccurrences',
            'writeOperations',
            'writeSemanticBytes',
            'materialWriteEventEvidenceBytes'
            ,'operationCalls'
            ,'receiptEvidenceBytes'
          )
        )
      `,
    ),
    check(
      "fx_system_tx_journal_state_evidence_check",
      sql`
        (
          ${table.state} = 'open'
          and ${table.failureDimension} is null
          and ${table.sealedJournalBytes} is null
          and ${table.sealedJournalSha256} is null
          and ${table.sealedResultValueCodecVersion} is null
          and ${table.sealedResultSemanticBytes} is null
          and ${table.sealedResultBytes} is null
          and ${table.sealedResultSha256} is null
          and ${table.sealedAt} is null
        )
        or (
          ${table.state} = 'operation_invoking'
          and ${table.failureDimension} is null
          and ${table.sealedJournalBytes} is null
          and ${table.sealedJournalSha256} is null
          and ${table.sealedResultValueCodecVersion} is null
          and ${table.sealedResultSemanticBytes} is null
          and ${table.sealedResultBytes} is null
          and ${table.sealedResultSha256} is null
          and ${table.sealedAt} is null
        )
        or (
          ${table.state} = 'operation_failed'
          and ${table.failureDimension} is null
          and ${table.sealedJournalBytes} is null
          and ${table.sealedJournalSha256} is null
          and ${table.sealedResultValueCodecVersion} is null
          and ${table.sealedResultSemanticBytes} is null
          and ${table.sealedResultBytes} is null
          and ${table.sealedResultSha256} is null
          and ${table.sealedAt} is null
        )
        or (
          ${table.state} = 'failed'
          and ${table.failureDimension} is not null
          and ${table.sealedJournalBytes} is null
          and ${table.sealedJournalSha256} is null
          and ${table.sealedResultValueCodecVersion} is null
          and ${table.sealedResultSemanticBytes} is null
          and ${table.sealedResultBytes} is null
          and ${table.sealedResultSha256} is null
          and ${table.sealedAt} is null
        )
        or (
          ${table.state} = 'relation_conflicted'
          and ${table.failureDimension} is null
          and ${table.sealedJournalBytes} is null
          and ${table.sealedJournalSha256} is null
          and ${table.sealedResultValueCodecVersion} is null
          and ${table.sealedResultSemanticBytes} is null
          and ${table.sealedResultBytes} is null
          and ${table.sealedResultSha256} is null
          and ${table.sealedAt} is null
        )
        or (
          ${table.state} = 'sealed'
          and ${table.failureDimension} is null
          and ${table.sealedJournalBytes} is not null
          and octet_length(${table.sealedJournalBytes}) between 1 and ${sql.raw(String(MAX_COMMIT_CANONICAL_EVIDENCE_BYTES_V1))}
          and ${table.sealedJournalSha256} is not null
          and octet_length(${table.sealedJournalSha256}) = 32
          and ${table.sealedResultValueCodecVersion} is not null
          and ${table.sealedResultValueCodecVersion} = 1
          and ${table.sealedResultSemanticBytes} is not null
          and ${table.sealedResultSemanticBytes} between 0 and ${sql.raw(String(MAX_COMMIT_RESULT_SEMANTIC_BYTES_V1))}
          and ${table.sealedResultBytes} is not null
          and octet_length(${table.sealedResultBytes}) between 1 and ${sql.raw(String(MAX_COMMIT_CANONICAL_EVIDENCE_BYTES_V1))}
          and ${table.sealedResultSha256} is not null
          and octet_length(${table.sealedResultSha256}) = 32
          and ${table.sealedAt} is not null
          and isfinite(${table.sealedAt})
        )
      `,
    ),
    check(
      "fx_system_tx_journal_timestamp_check",
      sql`
        isfinite(${table.createdAt})
        and isfinite(${table.updatedAt})
        and ${table.updatedAt} >= ${table.createdAt}
        and (
          ${table.sealedAt} is null
          or (
            ${table.sealedAt} is not null
            and ${table.sealedAt} >= ${table.createdAt}
          )
        )
      `,
    ),
  ],
);

/**
 * Singular execution ownership for one exact running attempt.
 *
 * The row is intentionally a child of the journal root rather than a second
 * lifecycle authority. Deleting or replacing the root therefore removes the
 * corresponding execution authority in the same transaction.
 */
export const fxSystemTransactionExecutionClaims = pgTable(
  "fx_system_tx_execution_claim",
  {
    scopeUuid: uuid("scope_uuid").$type<ScopeUuidV1>().notNull(),
    sessionId: uuid("session_id").$type<TransactionSessionIdV1>().notNull(),
    attemptFence: bigint("attempt_fence", { mode: "bigint" })
      .$type<TransactionAttemptFence>()
      .notNull(),
    claimFence: bigint("claim_fence", { mode: "bigint" })
      .$type<TransactionExecutionClaimFenceV1>()
      .notNull(),
    claimOwner: uuid("claim_owner")
      .$type<TransactionExecutionClaimOwnerV1>()
      .notNull(),
    claimedAt: timestamp("claimed_at", { withTimezone: true }).notNull(),
    claimExpiresAt: timestamp("claim_expires_at", {
      withTimezone: true,
    }).notNull(),
  },
  (table) => [
    primaryKey({
      name: "fx_system_tx_execution_claim_pk",
      columns: [table.scopeUuid, table.sessionId, table.attemptFence],
    }),
    foreignKey({
      name: "fx_system_tx_execution_claim_journal_fk",
      columns: [table.scopeUuid, table.sessionId, table.attemptFence],
      foreignColumns: [
        fxSystemTransactionJournals.scopeUuid,
        fxSystemTransactionJournals.sessionId,
        fxSystemTransactionJournals.attemptFence,
      ],
    })
      .onUpdate("restrict")
      .onDelete("cascade"),
    index("fx_system_tx_execution_claim_expiry_idx").on(
      table.scopeUuid,
      table.claimExpiresAt,
      table.sessionId,
      table.attemptFence,
    ),
    check(
      "fx_system_tx_execution_claim_attempt_fence_check",
      sql`${table.attemptFence} >= 1`,
    ),
    check(
      "fx_system_tx_execution_claim_fence_check",
      sql`${table.claimFence} >= 1`,
    ),
    check(
      "fx_system_tx_execution_claim_owner_check",
      sql`${table.claimOwner}::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'`,
    ),
    check(
      "fx_system_tx_execution_claim_time_check",
      sql`
        isfinite(${table.claimedAt})
        and isfinite(${table.claimExpiresAt})
        and ${table.claimExpiresAt} > ${table.claimedAt}
      `,
    ),
  ],
);

/** Bounded exact-sequence receipts for authenticated replay within one attempt. */
export const fxSystemTransactionJournalReceipts = pgTable(
  "fx_system_tx_journal_receipt",
  {
    scopeUuid: uuid("scope_uuid").$type<ScopeUuidV1>().notNull(),
    sessionId: uuid("session_id").$type<TransactionSessionIdV1>().notNull(),
    attemptFence: bigint("attempt_fence", { mode: "bigint" })
      .$type<TransactionAttemptFence>()
      .notNull(),
    lastSyscallSequence: bigint("last_syscall_sequence", { mode: "bigint" })
      .$type<CommitSyscallSequenceV1>()
      .notNull(),
    operationKind: text("operation_kind")
      .$type<TransactionJournalOperationKindV1>()
      .notNull(),
    requestCodecVersion: integer("request_codec_version")
      .$type<2>()
      .notNull(),
    requestBytes: bytea("request_bytes").notNull(),
    requestSha256: bytea("request_sha256").notNull(),
    participantBindingSha256: bytea("participant_binding_sha256"),
    outcomeKind: text("outcome_kind")
      .$type<TransactionJournalOutcomeKindV1>()
      .notNull(),
    outcomeCodecVersion: integer("outcome_codec_version")
      .$type<2>()
      .notNull(),
    outcomeBytes: bytea("outcome_bytes").notNull(),
    outcomeSha256: bytea("outcome_sha256").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    primaryKey({
      name: "fx_system_tx_journal_receipt_pk",
      columns: [table.scopeUuid, table.sessionId, table.attemptFence, table.lastSyscallSequence],
    }),
    foreignKey({
      name: "fx_system_tx_journal_receipt_root_fk",
      columns: [table.scopeUuid, table.sessionId, table.attemptFence],
      foreignColumns: [
        fxSystemTransactionJournals.scopeUuid,
        fxSystemTransactionJournals.sessionId,
        fxSystemTransactionJournals.attemptFence,
      ],
    })
      .onUpdate("restrict")
      .onDelete("cascade"),
    check(
      "fx_system_tx_journal_receipt_fence_check",
      sql`${table.attemptFence} >= 1`,
    ),
    check(
      "fx_system_tx_journal_receipt_sequence_check",
      sql`${table.lastSyscallSequence} >= 1`,
    ),
    check(
      "fx_system_tx_journal_receipt_operation_check",
      sql`(${table.operationKind} in ('get', 'insert', 'patch', 'replace', 'delete', 'indexRange', 'relationIncoming')
        and ${table.participantBindingSha256} is null)
        or (${table.operationKind} = 'admittedLogicalOperation'
        and ${table.participantBindingSha256} is not null)`,
    ),
    check(
      "fx_system_tx_journal_receipt_request_check",
      sql`
        ${table.requestCodecVersion} = 2
        and octet_length(${table.requestBytes}) between 1 and ${sql.raw(String(MAX_COMMIT_CANONICAL_EVIDENCE_BYTES_V1))}
        and octet_length(${table.requestSha256}) = 32
        and (${table.participantBindingSha256} is null or octet_length(${table.participantBindingSha256}) = 32)
      `,
    ),
    check(
      "fx_system_tx_journal_receipt_outcome_check",
      sql`
        ((${table.operationKind} = 'admittedLogicalOperation' and ${table.outcomeKind} in ('admittedLogicalInvoking', 'admittedLogicalResult', 'admittedLogicalError', 'error'))
          or (${table.operationKind} <> 'admittedLogicalOperation' and ${table.outcomeKind} in
            ('missing', 'present', 'inserted', 'unit', 'indexRangePage', 'relationIncomingPage', 'relationConflict', 'error')))
        and ${table.outcomeCodecVersion} = 2
        and octet_length(${table.outcomeBytes}) between 1 and ${sql.raw(String(MAX_COMMIT_CANONICAL_EVIDENCE_BYTES_V1))}
        and octet_length(${table.outcomeSha256}) = 32
      `,
    ),
    check(
      "fx_system_tx_journal_receipt_timestamp_check",
      sql`
        isfinite(${table.createdAt})
        and isfinite(${table.updatedAt})
        and ${table.updatedAt} >= ${table.createdAt}
      `,
    ),
  ],
);

/** One source for the durable point discriminator and its installation proof. */
export function transactionJournalPointDependencyCheck(
  dependencyKind: SQLWrapper, dependencyRevisionCommitSeq: SQLWrapper,
) {
  return sql`
        (
          ${dependencyKind} = 'present'
          and ${dependencyRevisionCommitSeq} is not null
          and ${dependencyRevisionCommitSeq} >= 1
        )
        or (
          ${dependencyKind} = 'missing_no_visible_revision'
          and ${dependencyRevisionCommitSeq} is null
        )
        or (
          ${dependencyKind} = 'missing_tombstone'
          and ${dependencyRevisionCommitSeq} is not null
          and ${dependencyRevisionCommitSeq} >= 1
        )
        or (
          ${dependencyKind} = 'generated_insertion'
          and ${dependencyRevisionCommitSeq} is null
        )
      `;
}

/** One original read or generated-insertion obligation plus its same-row overlay. */
export const fxSystemTransactionJournalPoints = pgTable(
  "fx_system_tx_journal_point",
  {
    scopeUuid: uuid("scope_uuid").$type<ScopeUuidV1>().notNull(),
    sessionId: uuid("session_id").$type<TransactionSessionIdV1>().notNull(),
    attemptFence: bigint("attempt_fence", { mode: "bigint" })
      .$type<TransactionAttemptFence>()
      .notNull(),
    tableId: integer("table_id").$type<CatalogTableId>().notNull(),
    rowId: bytea("row_id").notNull(),
    dependencyKind: text("dependency_kind")
      .$type<TransactionJournalDependencyKindV1>()
      .notNull(),
    dependencyRevisionCommitSeq: bigint("dependency_revision_commit_seq", {
      mode: "bigint",
    }).$type<CommitSeq>(),
    overlayKind: text("overlay_kind")
      .$type<"none" | "live" | "deleted">()
      .notNull(),
    overlayCreationTime: doublePrecision("overlay_creation_time")
      .$type<AppCreationTimeV1>(),
    overlayValueCodecVersion: integer("overlay_value_codec_version")
      .$type<FlarexValueCodecVersion>(),
    overlayValueJson: jsonb("overlay_value_json").$type<JsonObject>(),
    overlayValueBytes: bytea("overlay_value_bytes")
      .$type<CanonicalFlarexValueBytesV1>(),
    overlayValueSha256: bytea("overlay_value_sha256")
      .$type<FlarexValueSha256V1>(),
    overlaySemanticBytes: integer("overlay_semantic_bytes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    primaryKey({
      name: "fx_system_tx_journal_point_pk",
      columns: [
        table.scopeUuid,
        table.sessionId,
        table.attemptFence,
        table.tableId,
        table.rowId,
      ],
    }),
    foreignKey({
      name: "fx_system_tx_journal_point_root_fk",
      columns: [table.scopeUuid, table.sessionId, table.attemptFence],
      foreignColumns: [
        fxSystemTransactionJournals.scopeUuid,
        fxSystemTransactionJournals.sessionId,
        fxSystemTransactionJournals.attemptFence,
      ],
    })
      .onUpdate("restrict")
      .onDelete("cascade"),
    check(
      "fx_system_tx_journal_point_identity_check",
      sql`
        ${table.attemptFence} >= 1
        and ${table.tableId} between 1 and 2147483647
        and octet_length(${table.rowId}) = 16
      `,
    ),
    check(
      "fx_system_tx_journal_point_dependency_check",
      transactionJournalPointDependencyCheck(table.dependencyKind, table.dependencyRevisionCommitSeq),
    ),
    check(
      "fx_system_tx_journal_point_overlay_check",
      sql`
        (
          ${table.overlayKind} in ('none', 'deleted')
          and ${table.overlayCreationTime} is null
          and ${table.overlayValueCodecVersion} is null
          and ${table.overlayValueJson} is null
          and ${table.overlayValueBytes} is null
          and ${table.overlayValueSha256} is null
          and ${table.overlaySemanticBytes} is null
        )
        or (
          ${table.overlayKind} = 'live'
          and ${table.overlayCreationTime} is not null
          and ${table.overlayCreationTime} > 0
          and ${table.overlayCreationTime} < 9007199254740992
          and ${table.overlayValueCodecVersion} is not null
          and ${table.overlayValueCodecVersion} = 1
          and ${table.overlayValueJson} is not null
          and jsonb_typeof(${table.overlayValueJson}) = 'object'
          and ${table.overlayValueBytes} is not null
          and octet_length(${table.overlayValueBytes}) > 0
          and ${table.overlayValueSha256} is not null
          and octet_length(${table.overlayValueSha256}) = 32
          and ${table.overlaySemanticBytes} is not null
          and ${table.overlaySemanticBytes} between 1 and ${sql.raw(String(MAX_FLAREX_APP_DOCUMENT_SEMANTIC_BYTES_V1))}
        )
      `,
    ),
    check(
      "fx_system_tx_journal_point_timestamp_check",
      sql`
        isfinite(${table.createdAt})
        and isfinite(${table.updatedAt})
        and ${table.updatedAt} >= ${table.createdAt}
      `,
    ),
  ],
);

/** Canonically merged, bounded indexed-range OCC dependencies for one attempt. */
export const fxSystemTransactionJournalIndexRanges = pgTable(
  "fx_system_tx_journal_index_range",
  {
    scopeUuid: uuid("scope_uuid").$type<ScopeUuidV1>().notNull(),
    sessionId: uuid("session_id").$type<TransactionSessionIdV1>().notNull(),
    attemptFence: bigint("attempt_fence", { mode: "bigint" })
      .$type<TransactionAttemptFence>().notNull(),
    ordinal: integer("ordinal").notNull(),
    tableId: integer("table_id").$type<CatalogTableId>().notNull(),
    indexDefinitionId: integer("index_definition_id")
      .$type<CatalogIndexDefinitionId>().notNull(),
    keyCodecVersion: integer("key_codec_version")
      .$type<OrderedIndexKeyCodecVersion>().notNull(),
    physicalSpecSha256: bytea("physical_spec_sha256").notNull(),
    direction: text("direction").$type<"asc">().notNull(),
    lowerKind: text("lower_kind")
      .$type<"unbounded" | "key_inclusive">().notNull(),
    lowerEncodedKey: bytea("lower_encoded_key"),
    upperKind: text("upper_kind")
      .$type<"unbounded" | "key_exclusive" | "position_inclusive">()
      .notNull(),
    upperEncodedKey: bytea("upper_encoded_key"),
    upperRowId: bytea("upper_row_id"),
    evidenceBytes: integer("evidence_bytes").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    primaryKey({
      name: "fx_system_tx_journal_index_range_pk",
      columns: [
        table.scopeUuid,
        table.sessionId,
        table.attemptFence,
        table.ordinal,
      ],
    }),
    foreignKey({
      name: "fx_system_tx_journal_index_range_root_fk",
      columns: [table.scopeUuid, table.sessionId, table.attemptFence],
      foreignColumns: [
        fxSystemTransactionJournals.scopeUuid,
        fxSystemTransactionJournals.sessionId,
        fxSystemTransactionJournals.attemptFence,
      ],
    }).onUpdate("restrict").onDelete("cascade"),
    check(
      "fx_system_tx_journal_index_range_identity_check",
      sql`
        ${table.attemptFence} >= 1
        and ${table.ordinal} between 0 and ${sql.raw(String(MAX_COMMIT_INDEX_RANGE_READ_DEPENDENCIES_V1 - 1))}
        and ${table.tableId} between 1 and 2147483647
        and ${table.indexDefinitionId} between 1 and 2147483647
        and ${table.keyCodecVersion} = 1
        and octet_length(${table.physicalSpecSha256}) = 32
        and ${table.direction} = 'asc'
        and ${table.evidenceBytes} between 1 and ${sql.raw(String(MAX_COMMIT_INDEX_RANGE_DEPENDENCY_EVIDENCE_BYTES_V1))}
      `,
    ),
    check(
      "fx_system_tx_journal_index_range_lower_check",
      sql`
        (
          ${table.lowerKind} = 'unbounded'
          and ${table.lowerEncodedKey} is null
        )
        or (
          ${table.lowerKind} = 'key_inclusive'
          and ${table.lowerEncodedKey} is not null
          and octet_length(${table.lowerEncodedKey}) between 0 and ${sql.raw(String(MAX_ORDERED_INDEX_BOUND_BYTES_V1))}
        )
      `,
    ),
    check(
      "fx_system_tx_journal_index_range_upper_check",
      sql`
        (
          ${table.upperKind} = 'unbounded'
          and ${table.upperEncodedKey} is null
          and ${table.upperRowId} is null
        )
        or (
          ${table.upperKind} = 'key_exclusive'
          and ${table.upperEncodedKey} is not null
          and octet_length(${table.upperEncodedKey}) between 0 and ${sql.raw(String(MAX_ORDERED_INDEX_BOUND_BYTES_V1))}
          and ${table.upperRowId} is null
        )
        or (
          ${table.upperKind} = 'position_inclusive'
          and ${table.upperEncodedKey} is not null
          and octet_length(${table.upperEncodedKey}) between 0 and ${sql.raw(String(MAX_ORDERED_INDEX_KEY_BYTES_V1))}
          and ${table.upperRowId} is not null
          and octet_length(${table.upperRowId}) = 16
        )
      `,
    ),
    check(
      "fx_system_tx_journal_index_range_timestamp_check",
      sql`
        isfinite(${table.createdAt})
        and isfinite(${table.updatedAt})
        and ${table.updatedAt} >= ${table.createdAt}
      `,
    ),
  ],
);

/** Coalesced exact incoming-adjacency OCC dependencies for one attempt. */
export const fxSystemTransactionJournalRelationIncomingDependencies = pgTable(
  "fx_system_tx_journal_relation_incoming",
  {
    scopeUuid: uuid("scope_uuid").$type<ScopeUuidV1>().notNull(),
    sessionId: uuid("session_id").$type<TransactionSessionIdV1>().notNull(),
    attemptFence: bigint("attempt_fence", { mode: "bigint" })
      .$type<TransactionAttemptFence>().notNull(),
    edgeDefinitionId: integer("edge_definition_id")
      .$type<CatalogEdgeDefinitionId>().notNull(),
    targetRowId: bytea("target_row_id").notNull(),
    observedAdjacencyVersion: bigint("observed_adjacency_version", {
      mode: "bigint",
    }).$type<CommitSeq>().notNull(),
    activationSequence: bigint("activation_sequence", { mode: "bigint" })
      .$type<ApplicationActivationSequenceV1>().notNull(),
    activeHeadSha256: bytea("active_head_sha256").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    primaryKey({
      name: "fx_system_tx_journal_relation_incoming_pk",
      columns: [
        table.scopeUuid,
        table.sessionId,
        table.attemptFence,
        table.edgeDefinitionId,
        table.targetRowId,
      ],
    }),
    foreignKey({
      name: "fx_system_tx_journal_relation_incoming_root_fk",
      columns: [table.scopeUuid, table.sessionId, table.attemptFence],
      foreignColumns: [
        fxSystemTransactionJournals.scopeUuid,
        fxSystemTransactionJournals.sessionId,
        fxSystemTransactionJournals.attemptFence,
      ],
    }).onUpdate("restrict").onDelete("cascade"),
    check(
      "fx_system_tx_journal_relation_incoming_identity_check",
      sql`
        ${table.attemptFence} >= 1
        and ${table.edgeDefinitionId} between 1 and 2147483647
        and octet_length(${table.targetRowId}) = 16
        and ${table.observedAdjacencyVersion} >= 0
        and ${table.activationSequence} between 1 and 9223372036854775807
        and octet_length(${table.activeHeadSha256}) = 32
      `,
    ),
    check(
      "fx_system_tx_journal_relation_incoming_timestamp_check",
      sql`
        isfinite(${table.createdAt})
        and isfinite(${table.updatedAt})
        and ${table.updatedAt} >= ${table.createdAt}
      `,
    ),
  ],
);

/** Ordered material writes retained before same-row coalescing. */
export const fxSystemTransactionJournalWriteEvents = pgTable(
  "fx_system_tx_journal_write_event",
  {
    scopeUuid: uuid("scope_uuid").$type<ScopeUuidV1>().notNull(),
    sessionId: uuid("session_id").$type<TransactionSessionIdV1>().notNull(),
    attemptFence: bigint("attempt_fence", { mode: "bigint" })
      .$type<TransactionAttemptFence>()
      .notNull(),
    syscallSequence: bigint("syscall_sequence", { mode: "bigint" })
      .$type<CommitSyscallSequenceV1>()
      .notNull(),
    effectOrdinal: integer("effect_ordinal").notNull().default(0),
    writeKind: text("write_kind")
      .$type<LogicalAppWriteV1["kind"] | "logicalDocument">()
      .notNull(),
    eventCodecVersion: integer("event_codec_version").$type<2>().notNull(),
    eventBytes: bytea("event_bytes").notNull(),
    eventSha256: bytea("event_sha256").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    primaryKey({
      name: "fx_system_tx_journal_event_pk",
      columns: [
        table.scopeUuid,
        table.sessionId,
        table.attemptFence,
        table.syscallSequence,
        table.effectOrdinal,
      ],
    }),
    foreignKey({
      name: "fx_system_tx_journal_event_root_fk",
      columns: [table.scopeUuid, table.sessionId, table.attemptFence],
      foreignColumns: [
        fxSystemTransactionJournals.scopeUuid,
        fxSystemTransactionJournals.sessionId,
        fxSystemTransactionJournals.attemptFence,
      ],
    })
      .onUpdate("restrict")
      .onDelete("cascade"),
    check(
      "fx_system_tx_journal_event_identity_check",
      sql`${table.attemptFence} >= 1 and ${table.syscallSequence} >= 1 and ${table.effectOrdinal} between 0 and 65535`,
    ),
    check(
      "fx_system_tx_journal_event_payload_check",
      sql`
        ${table.writeKind} in ('insert', 'patch', 'replace', 'delete', 'logicalDocument')
        and ${table.eventCodecVersion} = 2
        and octet_length(${table.eventBytes}) between 1 and ${sql.raw(String(MAX_COMMIT_MATERIAL_WRITE_EVENT_EVIDENCE_BYTES_V1))}
        and octet_length(${table.eventSha256}) = 32
      `,
    ),
    check(
      "fx_system_tx_journal_event_timestamp_check",
      sql`isfinite(${table.createdAt})`,
    ),
  ],
);
