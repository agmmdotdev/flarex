import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  foreignKey,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import type {
  DeclarativeV2AttemptLifecycleV1,
} from "flarex-protocol/internal/declarative-v2-physical-v1";
import type {
  DeclarativeV2VerifierDurableCommandKindV2,
  DeclarativeV2VerifierRestartCommandKindV2,
} from "flarex-protocol/internal/declarative-v2-verifier-progress-v2";
import type { ScopeId } from "flarex-protocol/storage-authority";
import { bytea, requiredFrameCheck, requiredFrameCheckV2, nullableFrameAbsent } from "./primitives";
import { fxSystemDeclarativeV2Candidates } from "./legacyDeclarativeCandidate";

/**
 * Additive inert Durable Command V2 storage.
 *
 * These rows preserve canonical portable bytes and the metadata required for
 * bounded reads and later transaction predicates. They do not mint verifier
 * authority: leases, normalized columns, digests, and serialized frames remain
 * inert until a later private composition reacquires fresh authenticated input.
 * The superseded, production-inert V1 progress island was retired after the
 * V2 repository became the sole non-test consumer.
 */
export const fxSystemDeclarativeV2VerifierAttemptsV2 = pgTable(
  "fx_system_declarative_v2_verifier_attempt_v2",
  {
    scopeId: text("scope_id").$type<ScopeId>().notNull(),
    attemptSha256: bytea("attempt_sha256").notNull(),
    candidateSha256: bytea("candidate_sha256").notNull(),
    lifecycle: text("lifecycle").$type<DeclarativeV2AttemptLifecycleV1>().notNull(),
    writerOwnerId: uuid("writer_owner_id"),
    writerFence: bigint("writer_fence", { mode: "bigint" })
      .notNull()
      .default(sql`0`),
    leaseUpdatedAt: timestamp("lease_updated_at", { withTimezone: true }),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    settledSequence: bigint("settled_sequence", { mode: "bigint" })
      .notNull()
      .default(sql`0`),
    lastReceiptSha256: bytea("last_receipt_sha256"),
    pendingKind: text("pending_kind")
      .$type<DeclarativeV2VerifierDurableCommandKindV2>(),
    pendingSequence: bigint("pending_sequence", { mode: "bigint" }),
    pendingReservationSha256: bytea("pending_reservation_sha256"),
    pendingReservedByFence: bigint("pending_reserved_by_fence", {
      mode: "bigint",
    }),
    pendingStartedAt: timestamp("pending_started_at", { withTimezone: true }),
    identityCodecVersion: integer("identity_codec_version").notNull(),
    identityByteLength: bigint("identity_byte_length", {
      mode: "bigint",
    }).notNull(),
    identitySha256: bytea("identity_sha256").notNull(),
    identityBytes: bytea("identity_bytes").notNull(),
    ceilingsCodecVersion: integer("ceilings_codec_version").notNull(),
    ceilingsByteLength: bigint("ceilings_byte_length", {
      mode: "bigint",
    }).notNull(),
    ceilingsSha256: bytea("ceilings_sha256").notNull(),
    ceilingsBytes: bytea("ceilings_bytes").notNull(),
    usageCodecVersion: integer("usage_codec_version").notNull(),
    usageByteLength: bigint("usage_byte_length", {
      mode: "bigint",
    }).notNull(),
    usageSha256: bytea("usage_sha256").notNull(),
    usageBytes: bytea("usage_bytes").notNull(),
    progressCodecVersion: integer("progress_codec_version").notNull(),
    progressByteLength: bigint("progress_byte_length", {
      mode: "bigint",
    }).notNull(),
    progressSha256: bytea("progress_sha256").notNull(),
    progressBytes: bytea("progress_bytes").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.scopeId, table.attemptSha256] }),
    foreignKey({
      name: "fx_dv2_attempt_v2_candidate_fk",
      columns: [table.scopeId, table.candidateSha256],
      foreignColumns: [
        fxSystemDeclarativeV2Candidates.scopeId,
        fxSystemDeclarativeV2Candidates.candidateSha256,
      ],
    }).onDelete("restrict"),
    check(
      "fx_dv2_attempt_v2_digest_check",
      sql`octet_length(${table.attemptSha256}) = 32
        and octet_length(${table.candidateSha256}) = 32
        and ${table.attemptSha256} = ${table.identitySha256}`,
    ),
    check(
      "fx_dv2_attempt_v2_lifecycle_check",
      sql`${table.lifecycle} in (
        'open', 'parsing', 'parse_complete', 'linking', 'link_complete',
        'registering', 'ready', 'rejected', 'abandoned'
      )`,
    ),
    check("fx_dv2_attempt_v2_fence_check", sql`${table.writerFence} >= 0`),
    check(
      "fx_dv2_attempt_v2_lease_check",
      sql`(
        (
          ${table.writerOwnerId} is null
          and ${table.leaseUpdatedAt} is null
          and ${table.leaseExpiresAt} is null
        )
        or
        (
          ${table.writerOwnerId} is not null
          and ${table.writerFence} >= 1
          and ${table.leaseUpdatedAt} is not null
          and isfinite(${table.leaseUpdatedAt})
          and ${table.leaseExpiresAt} is not null
          and isfinite(${table.leaseExpiresAt})
          and ${table.leaseExpiresAt} > ${table.leaseUpdatedAt}
          and ${table.lifecycle} not in ('ready', 'rejected', 'abandoned')
        )
      ) is true`,
    ),
    check(
      "fx_dv2_attempt_v2_settled_check",
      sql`(
        ${table.settledSequence} >= 0
        and (
          (${table.settledSequence} = 0 and ${table.lastReceiptSha256} is null)
          or
          (
            ${table.settledSequence} >= 1
            and octet_length(${table.lastReceiptSha256}) = 32
          )
        )
      ) is true`,
    ),
    check(
      "fx_dv2_attempt_v2_pending_check",
      sql`(
        (
          ${table.pendingKind} is null
          and ${table.pendingSequence} is null
          and ${table.pendingReservationSha256} is null
          and ${table.pendingReservedByFence} is null
          and ${table.pendingStartedAt} is null
        )
        or
        (
          ${table.pendingKind} in (
            'source_page', 'parse_module', 'link_page', 'registration_page'
          )
          and ${table.pendingSequence} = ${table.settledSequence} + 1
          and ${table.settledSequence} < 9223372036854775807
          and octet_length(${table.pendingReservationSha256}) = 32
          and ${table.pendingReservedByFence} >= 1
          and ${table.pendingReservedByFence} = ${table.writerFence}
          and ${table.pendingStartedAt} is not null
          and isfinite(${table.pendingStartedAt})
          and ${table.lifecycle} not in ('ready', 'rejected', 'abandoned')
        )
      ) is true`,
    ),
    check(
      "fx_dv2_attempt_v2_identity_frame_check",
      requiredFrameCheckV2(
        table.identityCodecVersion,
        table.identityByteLength,
        table.identitySha256,
        table.identityBytes,
      ),
    ),
    check(
      "fx_dv2_attempt_v2_ceilings_frame_check",
      requiredFrameCheckV2(
        table.ceilingsCodecVersion,
        table.ceilingsByteLength,
        table.ceilingsSha256,
        table.ceilingsBytes,
      ),
    ),
    check(
      "fx_dv2_attempt_v2_usage_frame_check",
      requiredFrameCheckV2(
        table.usageCodecVersion,
        table.usageByteLength,
        table.usageSha256,
        table.usageBytes,
      ),
    ),
    check(
      "fx_dv2_attempt_v2_progress_frame_check",
      requiredFrameCheckV2(
        table.progressCodecVersion,
        table.progressByteLength,
        table.progressSha256,
        table.progressBytes,
      ),
    ),
    check(
      "fx_dv2_attempt_v2_timestamps_check",
      sql`isfinite(${table.createdAt})
        and isfinite(${table.updatedAt})
        and ${table.updatedAt} >= ${table.createdAt}`,
    ),
  ],
);

export const fxSystemDeclarativeV2VerifierCommandsV2 = pgTable(
  "fx_system_declarative_v2_verifier_command_v2",
  {
    scopeId: text("scope_id").$type<ScopeId>().notNull(),
    attemptSha256: bytea("attempt_sha256").notNull(),
    sequence: bigint("sequence", { mode: "bigint" }).notNull(),
    commandKind: text("command_kind")
      .$type<DeclarativeV2VerifierDurableCommandKindV2>()
      .notNull(),
    reservationSha256: bytea("reservation_sha256").notNull(),
    reservationCodecVersion: integer("reservation_codec_version").notNull(),
    reservationByteLength: bigint("reservation_byte_length", {
      mode: "bigint",
    }).notNull(),
    reservationFrameSha256: bytea("reservation_frame_sha256").notNull(),
    reservationBytes: bytea("reservation_bytes").notNull(),
    commandBudgetCodecVersion: integer("command_budget_codec_version").notNull(),
    commandBudgetByteLength: bigint("command_budget_byte_length", {
      mode: "bigint",
    }).notNull(),
    commandBudgetSha256: bytea("command_budget_sha256").notNull(),
    commandBudgetBytes: bytea("command_budget_bytes").notNull(),
    reservedByFence: bigint("reserved_by_fence", { mode: "bigint" }).notNull(),
    reservedAt: timestamp("reserved_at", { withTimezone: true }).notNull(),
    pageCount: bigint("page_count", { mode: "bigint" }).notNull().default(sql`0`),
    lastPageSha256: bytea("last_page_sha256"),
    outputManifestCodecVersion: integer("output_manifest_codec_version"),
    outputManifestByteLength: bigint("output_manifest_byte_length", {
      mode: "bigint",
    }),
    outputManifestSha256: bytea("output_manifest_sha256"),
    outputManifestBytes: bytea("output_manifest_bytes"),
    commandUsageCodecVersion: integer("command_usage_codec_version"),
    commandUsageByteLength: bigint("command_usage_byte_length", {
      mode: "bigint",
    }),
    commandUsageSha256: bytea("command_usage_sha256"),
    commandUsageBytes: bytea("command_usage_bytes"),
    resultingUsageCodecVersion: integer("resulting_usage_codec_version"),
    resultingUsageByteLength: bigint("resulting_usage_byte_length", {
      mode: "bigint",
    }),
    resultingUsageSha256: bytea("resulting_usage_sha256"),
    resultingUsageBytes: bytea("resulting_usage_bytes"),
    nextProgressCodecVersion: integer("next_progress_codec_version"),
    nextProgressByteLength: bigint("next_progress_byte_length", {
      mode: "bigint",
    }),
    nextProgressSha256: bytea("next_progress_sha256"),
    nextProgressBytes: bytea("next_progress_bytes"),
    receiptCodecVersion: integer("receipt_codec_version"),
    receiptByteLength: bigint("receipt_byte_length", { mode: "bigint" }),
    receiptSha256: bytea("receipt_sha256"),
    receiptBytes: bytea("receipt_bytes"),
    settledAt: timestamp("settled_at", { withTimezone: true }),
  },
  (table) => [
    primaryKey({ columns: [table.scopeId, table.attemptSha256, table.sequence] }),
    unique("fx_dv2_command_v2_reservation_unique").on(
      table.scopeId,
      table.attemptSha256,
      table.sequence,
      table.reservationSha256,
      table.commandKind,
    ),
    foreignKey({
      name: "fx_dv2_command_v2_attempt_fk",
      columns: [table.scopeId, table.attemptSha256],
      foreignColumns: [
        fxSystemDeclarativeV2VerifierAttemptsV2.scopeId,
        fxSystemDeclarativeV2VerifierAttemptsV2.attemptSha256,
      ],
    }).onDelete("restrict"),
    check(
      "fx_dv2_command_v2_identity_check",
      sql`${table.sequence} >= 1
        and ${table.commandKind} in (
          'source_page', 'parse_module', 'link_page', 'registration_page'
        )
        and octet_length(${table.attemptSha256}) = 32
        and octet_length(${table.reservationSha256}) = 32
        and ${table.reservationSha256} = ${table.reservationFrameSha256}`,
    ),
    check(
      "fx_dv2_command_v2_reservation_frame_check",
      requiredFrameCheckV2(
        table.reservationCodecVersion,
        table.reservationByteLength,
        table.reservationFrameSha256,
        table.reservationBytes,
      ),
    ),
    check(
      "fx_dv2_command_v2_budget_frame_check",
      requiredFrameCheckV2(
        table.commandBudgetCodecVersion,
        table.commandBudgetByteLength,
        table.commandBudgetSha256,
        table.commandBudgetBytes,
      ),
    ),
    check(
      "fx_dv2_command_v2_reservation_check",
      sql`${table.reservedByFence} >= 1
        and isfinite(${table.reservedAt})`,
    ),
    check(
      "fx_dv2_command_v2_page_tail_check",
      sql`(
        ${table.pageCount} >= 0
        and (
          (${table.pageCount} = 0 and ${table.lastPageSha256} is null)
          or
          (
            ${table.pageCount} >= 1
            and ${table.commandKind} in ('parse_module', 'link_page')
            and octet_length(${table.lastPageSha256}) = 32
          )
        )
      ) is true`,
    ),
    check(
      "fx_dv2_command_v2_settlement_check",
      sql`(
        (
          ${nullableFrameAbsent(
            table.outputManifestCodecVersion,
            table.outputManifestByteLength,
            table.outputManifestSha256,
            table.outputManifestBytes,
          )}
          and ${nullableFrameAbsent(
            table.commandUsageCodecVersion,
            table.commandUsageByteLength,
            table.commandUsageSha256,
            table.commandUsageBytes,
          )}
          and ${nullableFrameAbsent(
            table.resultingUsageCodecVersion,
            table.resultingUsageByteLength,
            table.resultingUsageSha256,
            table.resultingUsageBytes,
          )}
          and ${nullableFrameAbsent(
            table.nextProgressCodecVersion,
            table.nextProgressByteLength,
            table.nextProgressSha256,
            table.nextProgressBytes,
          )}
          and ${nullableFrameAbsent(
            table.receiptCodecVersion,
            table.receiptByteLength,
            table.receiptSha256,
            table.receiptBytes,
          )}
          and ${table.settledAt} is null
        )
        or
        (
          ${requiredFrameCheckV2(
            table.outputManifestCodecVersion,
            table.outputManifestByteLength,
            table.outputManifestSha256,
            table.outputManifestBytes,
          )}
          and ${requiredFrameCheckV2(
            table.commandUsageCodecVersion,
            table.commandUsageByteLength,
            table.commandUsageSha256,
            table.commandUsageBytes,
          )}
          and ${requiredFrameCheckV2(
            table.resultingUsageCodecVersion,
            table.resultingUsageByteLength,
            table.resultingUsageSha256,
            table.resultingUsageBytes,
          )}
          and ${requiredFrameCheckV2(
            table.nextProgressCodecVersion,
            table.nextProgressByteLength,
            table.nextProgressSha256,
            table.nextProgressBytes,
          )}
          and ${requiredFrameCheckV2(
            table.receiptCodecVersion,
            table.receiptByteLength,
            table.receiptSha256,
            table.receiptBytes,
          )}
          and ${table.settledAt} is not null
          and isfinite(${table.settledAt})
          and ${table.settledAt} >= ${table.reservedAt}
          and (
            ${table.commandKind} not in ('parse_module', 'link_page')
            or ${table.pageCount} >= 1
          )
        )
      ) is true`,
    ),
  ],
);

/**
 * Private authenticated-command continuity. This is deliberately separate
 * from the stable V2 command row: the V2 reservation/receipt identity stays
 * unchanged while authenticated hosts can require durable pre-execution
 * intent and terminal analysis authority.
 */
export const fxSystemDeclarativeV2VerifierCommandAuthorityV1 = pgTable(
  "fx_system_declarative_v2_verifier_command_authority_v1",
  {
    scopeId: text("scope_id").$type<ScopeId>().notNull(),
    attemptSha256: bytea("attempt_sha256").notNull(),
    sequence: bigint("sequence", { mode: "bigint" }).notNull(),
    commandKind: text("command_kind")
      .$type<DeclarativeV2VerifierDurableCommandKindV2>()
      .notNull(),
    reservationSha256: bytea("reservation_sha256").notNull(),
    reservedByFence: bigint("reserved_by_fence", { mode: "bigint" }).notNull(),
    reservedAt: timestamp("reserved_at", { withTimezone: true }).notNull(),
    futureRegistrationIntentCodecVersion: integer(
      "future_registration_intent_codec_version",
    ),
    futureRegistrationIntentByteLength: bigint(
      "future_registration_intent_byte_length",
      { mode: "bigint" },
    ),
    futureRegistrationIntentSha256: bytea(
      "future_registration_intent_sha256",
    ),
    futureRegistrationIntentBytes: bytea(
      "future_registration_intent_bytes",
    ),
    terminalProofCodecVersion: integer("terminal_proof_codec_version"),
    terminalProofByteLength: bigint("terminal_proof_byte_length", {
      mode: "bigint",
    }),
    terminalProofSha256: bytea("terminal_proof_sha256"),
    terminalProofBytes: bytea("terminal_proof_bytes"),
    settledAt: timestamp("settled_at", { withTimezone: true }),
  },
  (table) => [
    primaryKey({
      columns: [table.scopeId, table.attemptSha256, table.sequence],
    }),
    unique("fx_dv2_command_authority_v1_identity_unique").on(
      table.scopeId,
      table.attemptSha256,
      table.sequence,
      table.reservationSha256,
      table.commandKind,
    ),
    foreignKey({
      name: "fx_dv2_command_authority_v1_command_fk",
      columns: [
        table.scopeId,
        table.attemptSha256,
        table.sequence,
        table.reservationSha256,
        table.commandKind,
      ],
      foreignColumns: [
        fxSystemDeclarativeV2VerifierCommandsV2.scopeId,
        fxSystemDeclarativeV2VerifierCommandsV2.attemptSha256,
        fxSystemDeclarativeV2VerifierCommandsV2.sequence,
        fxSystemDeclarativeV2VerifierCommandsV2.reservationSha256,
        fxSystemDeclarativeV2VerifierCommandsV2.commandKind,
      ],
    }).onDelete("restrict"),
    check(
      "fx_dv2_command_authority_v1_identity_check",
      sql`${table.sequence} >= 1
        and ${table.commandKind} in (
          'source_page', 'parse_module', 'link_page', 'registration_page'
        )
        and octet_length(${table.attemptSha256}) = 32
        and octet_length(${table.reservationSha256}) = 32
        and ${table.reservedByFence} >= 1
        and isfinite(${table.reservedAt})`,
    ),
    check(
      "fx_dv2_command_authority_v1_intent_check",
      sql`(
        (
          ${table.commandKind} in ('source_page', 'parse_module')
          and ${nullableFrameAbsent(
            table.futureRegistrationIntentCodecVersion,
            table.futureRegistrationIntentByteLength,
            table.futureRegistrationIntentSha256,
            table.futureRegistrationIntentBytes,
          )}
        )
        or
        (
          ${table.commandKind} in ('link_page', 'registration_page')
          and ${requiredFrameCheck(
            table.futureRegistrationIntentCodecVersion,
            table.futureRegistrationIntentByteLength,
            table.futureRegistrationIntentSha256,
            table.futureRegistrationIntentBytes,
          )}
        )
      ) is true`,
    ),
    check(
      "fx_dv2_command_authority_v1_terminal_check",
      sql`(
        (
          ${nullableFrameAbsent(
            table.terminalProofCodecVersion,
            table.terminalProofByteLength,
            table.terminalProofSha256,
            table.terminalProofBytes,
          )}
          and ${table.settledAt} is null
        )
        or
        (
          ${requiredFrameCheck(
            table.terminalProofCodecVersion,
            table.terminalProofByteLength,
            table.terminalProofSha256,
            table.terminalProofBytes,
          )}
          and ${table.settledAt} is not null
          and isfinite(${table.settledAt})
          and ${table.settledAt} >= ${table.reservedAt}
        )
      ) is true`,
    ),
  ],
);

export const fxSystemDeclarativeV2VerifierEvidencePagesV2 = pgTable(
  "fx_system_declarative_v2_verifier_evidence_page_v2",
  {
    scopeId: text("scope_id").$type<ScopeId>().notNull(),
    attemptSha256: bytea("attempt_sha256").notNull(),
    sequence: bigint("sequence", { mode: "bigint" }).notNull(),
    commandKind: text("command_kind")
      .$type<DeclarativeV2VerifierRestartCommandKindV2>()
      .notNull(),
    reservationSha256: bytea("reservation_sha256").notNull(),
    pageOrdinal: bigint("page_ordinal", { mode: "bigint" }).notNull(),
    pageSha256: bytea("page_sha256").notNull(),
    firstEvidenceOrdinal: bigint("first_evidence_ordinal", {
      mode: "bigint",
    }).notNull(),
    evidenceCount: bigint("evidence_count", { mode: "bigint" }).notNull(),
    firstDiagnosticOrdinal: bigint("first_diagnostic_ordinal", {
      mode: "bigint",
    }).notNull(),
    diagnosticCount: bigint("diagnostic_count", { mode: "bigint" }).notNull(),
    predecessorPageSha256: bytea("predecessor_page_sha256"),
    cumulativeDiagnosticsRootSha256: bytea(
      "cumulative_diagnostics_root_sha256",
    ).notNull(),
    manifestCodecVersion: integer("manifest_codec_version").notNull(),
    manifestByteLength: bigint("manifest_byte_length", {
      mode: "bigint",
    }).notNull(),
    manifestSha256: bytea("manifest_sha256").notNull(),
    manifestBytes: bytea("manifest_bytes").notNull(),
    payloadCodecVersion: integer("payload_codec_version").notNull(),
    payloadByteLength: bigint("payload_byte_length", {
      mode: "bigint",
    }).notNull(),
    payloadSha256: bytea("payload_sha256").notNull(),
    payloadBytes: bytea("payload_bytes").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({
      columns: [
        table.scopeId,
        table.attemptSha256,
        table.sequence,
        table.pageOrdinal,
      ],
    }),
    foreignKey({
      name: "fx_dv2_page_v2_command_fk",
      columns: [
        table.scopeId,
        table.attemptSha256,
        table.sequence,
        table.reservationSha256,
        table.commandKind,
      ],
      foreignColumns: [
        fxSystemDeclarativeV2VerifierCommandsV2.scopeId,
        fxSystemDeclarativeV2VerifierCommandsV2.attemptSha256,
        fxSystemDeclarativeV2VerifierCommandsV2.sequence,
        fxSystemDeclarativeV2VerifierCommandsV2.reservationSha256,
        fxSystemDeclarativeV2VerifierCommandsV2.commandKind,
      ],
    }).onDelete("restrict"),
    check(
      "fx_dv2_page_v2_identity_check",
      sql`${table.sequence} >= 1
        and ${table.commandKind} in ('parse_module', 'link_page')
        and octet_length(${table.attemptSha256}) = 32
        and octet_length(${table.reservationSha256}) = 32
        and octet_length(${table.pageSha256}) = 32
        and ${table.pageSha256} = ${table.manifestSha256}`,
    ),
    check(
      "fx_dv2_page_v2_range_check",
      sql`${table.pageOrdinal} >= 0
        and ${table.firstEvidenceOrdinal} >= 0
        and ${table.evidenceCount} >= 1
        and ${table.firstDiagnosticOrdinal} >= 0
        and ${table.diagnosticCount} >= 0
        and ${table.diagnosticCount} <= ${table.evidenceCount}
        and ${table.firstEvidenceOrdinal} <=
          9223372036854775807 - ${table.evidenceCount}
        and ${table.firstDiagnosticOrdinal} <=
          9223372036854775807 - ${table.diagnosticCount}`,
    ),
    check(
      "fx_dv2_page_v2_predecessor_check",
      sql`((
        (
          ${table.pageOrdinal} = 0
          and ${table.firstEvidenceOrdinal} = 0
          and ${table.firstDiagnosticOrdinal} = 0
          and ${table.predecessorPageSha256} is null
        )
        or
        (
          ${table.pageOrdinal} >= 1
          and octet_length(${table.predecessorPageSha256}) = 32
        )
      )) is true`,
    ),
    check(
      "fx_dv2_page_v2_roots_check",
      sql`octet_length(${table.cumulativeDiagnosticsRootSha256}) = 32
        and octet_length(${table.payloadSha256}) = 32`,
    ),
    check(
      "fx_dv2_page_v2_manifest_frame_check",
      requiredFrameCheckV2(
        table.manifestCodecVersion,
        table.manifestByteLength,
        table.manifestSha256,
        table.manifestBytes,
      ),
    ),
    check(
      "fx_dv2_page_v2_payload_check",
      sql`${table.payloadCodecVersion} = 1
        and ${table.payloadByteLength} >= 1
        and octet_length(${table.payloadBytes}) = ${table.payloadByteLength}`,
    ),
    check(
      "fx_dv2_page_v2_created_check",
      sql`isfinite(${table.createdAt})`,
    ),
  ],
);
