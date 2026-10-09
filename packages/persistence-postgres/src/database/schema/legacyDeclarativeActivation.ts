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
} from "drizzle-orm/pg-core";
import type {
  DeclarativeV2ActivationRevisionFrameV1,
} from "flarex-protocol/internal/declarative-v2-physical-v1";
import type { ScopeId } from "flarex-protocol/storage-authority";
import { bytea, nonBlankText, requiredFrameCheck } from "./primitives";
import { fxSystemScopeClocks } from "./scope";
import { fxSystemDeclarativeV2Candidates } from "./legacyDeclarativeCandidate";
import { fxSystemDeclarativeV2VerifierAttemptsV2 } from "./legacyDeclarativeVerifier";
import { fxSystemApplicationRevisionsV1 } from "./legacyApplicationRevision";

export const fxSystemDeclarativeV2Verdicts = pgTable(
  "fx_system_declarative_v2_verdict",
  {
    scopeId: text("scope_id").$type<ScopeId>().notNull(),
    attemptSha256: bytea("attempt_sha256").notNull(),
    candidateSha256: bytea("candidate_sha256").notNull(),
    revisionId: text("revision_id").notNull(),
    verdictSha256: bytea("verdict_sha256").notNull(),
    verdict: text("verdict").$type<"ready">().notNull(),
    failureCode: text("failure_code"),
    frameCodecVersion: integer("frame_codec_version").notNull(),
    frameByteLength: bigint("frame_byte_length", { mode: "bigint" }).notNull(),
    frameSha256: bytea("frame_sha256").notNull(),
    frameBytes: bytea("frame_bytes").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.scopeId, table.attemptSha256] }),
    unique("fx_dv2_verdict_digest_unique").on(
      table.scopeId,
      table.verdictSha256,
    ),
    foreignKey({
      name: "fx_dv2_verdict_attempt_fk",
      columns: [table.scopeId, table.attemptSha256],
      foreignColumns: [
        fxSystemDeclarativeV2VerifierAttemptsV2.scopeId,
        fxSystemDeclarativeV2VerifierAttemptsV2.attemptSha256,
      ],
    }).onDelete("restrict"),
    foreignKey({
      name: "fx_dv2_verdict_candidate_fk",
      columns: [table.scopeId, table.candidateSha256],
      foreignColumns: [
        fxSystemDeclarativeV2Candidates.scopeId,
        fxSystemDeclarativeV2Candidates.candidateSha256,
      ],
    }).onDelete("restrict"),
    foreignKey({
      name: "fx_dv2_verdict_revision_fk",
      columns: [table.scopeId, table.candidateSha256, table.revisionId],
      foreignColumns: [
        fxSystemApplicationRevisionsV1.scopeId,
        fxSystemApplicationRevisionsV1.candidateSha256,
        fxSystemApplicationRevisionsV1.revisionId,
      ],
    }).onDelete("restrict"),
    check(
      "fx_dv2_verdict_state_check",
      sql`${table.verdict} = 'ready' and ${table.failureCode} is null`,
    ),
    check(
      "fx_dv2_verdict_frame_check",
      sql`octet_length(${table.verdictSha256}) = 32
        and ${table.verdictSha256} = ${table.frameSha256}
        and ${nonBlankText(table.revisionId)}
        and ${table.frameByteLength} <= 16384
        and ${requiredFrameCheck(
          table.frameCodecVersion,
          table.frameByteLength,
          table.frameSha256,
          table.frameBytes,
        )}`,
    ),
    check("fx_dv2_verdict_created_check", sql`isfinite(${table.createdAt})`),
  ],
);

export const fxSystemDeclarativeV2ActivationRevisions = pgTable(
  "fx_system_declarative_v2_activation_revision",
  {
    scopeId: text("scope_id").$type<ScopeId>().notNull(),
    revision: bigint("revision", { mode: "bigint" }).notNull(),
    previousRevision: bigint("previous_revision", { mode: "bigint" }),
    action: text("action")
      .$type<DeclarativeV2ActivationRevisionFrameV1["action"]>()
      .notNull(),
    candidateSha256: bytea("candidate_sha256").notNull(),
    verdictSha256: bytea("verdict_sha256").notNull(),
    activationRequestSha256: bytea("activation_request_sha256").notNull(),
    frameCodecVersion: integer("frame_codec_version").notNull(),
    frameByteLength: bigint("frame_byte_length", { mode: "bigint" }).notNull(),
    frameSha256: bytea("frame_sha256").notNull(),
    frameBytes: bytea("frame_bytes").notNull(),
    activatedAt: timestamp("activated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.scopeId, table.revision] }),
    unique("fx_dv2_activation_request_unique").on(
      table.scopeId,
      table.activationRequestSha256,
    ),
    foreignKey({
      name: "fx_dv2_revision_scope_fk",
      columns: [table.scopeId],
      foreignColumns: [fxSystemScopeClocks.scopeId],
    }).onDelete("restrict"),
    foreignKey({
      name: "fx_dv2_revision_previous_fk",
      columns: [table.scopeId, table.previousRevision],
      foreignColumns: [table.scopeId, table.revision],
    }).onDelete("restrict"),
    foreignKey({
      name: "fx_dv2_revision_candidate_fk",
      columns: [table.scopeId, table.candidateSha256],
      foreignColumns: [
        fxSystemDeclarativeV2Candidates.scopeId,
        fxSystemDeclarativeV2Candidates.candidateSha256,
      ],
    }).onDelete("restrict"),
    foreignKey({
      name: "fx_dv2_revision_verdict_fk",
      columns: [table.scopeId, table.verdictSha256],
      foreignColumns: [
        fxSystemDeclarativeV2Verdicts.scopeId,
        fxSystemDeclarativeV2Verdicts.verdictSha256,
      ],
    }).onDelete("restrict"),
    check(
      "fx_dv2_revision_sequence_check",
      sql`
        ((
          ${table.revision} = 1
          and ${table.previousRevision} is null
        )
        or
        (
          ${table.revision} >= 2
          and ${table.previousRevision} = ${table.revision} - 1
        )) is true
      `,
    ),
    check(
      "fx_dv2_revision_action_check",
      sql`${table.action} in ('activate', 'rollback')`,
    ),
    check(
      "fx_dv2_revision_digest_check",
      sql`octet_length(${table.candidateSha256}) = 32
        and octet_length(${table.verdictSha256}) = 32
        and octet_length(${table.activationRequestSha256}) = 32`,
    ),
    check(
      "fx_dv2_revision_frame_check",
      requiredFrameCheck(
        table.frameCodecVersion,
        table.frameByteLength,
        table.frameSha256,
        table.frameBytes,
      ),
    ),
    check("fx_dv2_revision_time_check", sql`isfinite(${table.activatedAt})`),
  ],
);

export const fxSystemDeclarativeV2ActivationHeads = pgTable(
  "fx_system_declarative_v2_activation_head",
  {
    scopeId: text("scope_id").$type<ScopeId>().primaryKey(),
    revisionCounter: bigint("revision_counter", { mode: "bigint" })
      .notNull()
      .default(sql`0`),
    currentRevision: bigint("current_revision", { mode: "bigint" }),
    candidateSha256: bytea("candidate_sha256"),
    verdictSha256: bytea("verdict_sha256"),
    frameCodecVersion: integer("frame_codec_version").notNull(),
    frameByteLength: bigint("frame_byte_length", { mode: "bigint" }).notNull(),
    frameSha256: bytea("frame_sha256").notNull(),
    frameBytes: bytea("frame_bytes").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      name: "fx_dv2_head_scope_fk",
      columns: [table.scopeId],
      foreignColumns: [fxSystemScopeClocks.scopeId],
    }).onDelete("restrict"),
    foreignKey({
      name: "fx_dv2_head_revision_fk",
      columns: [table.scopeId, table.currentRevision],
      foreignColumns: [
        fxSystemDeclarativeV2ActivationRevisions.scopeId,
        fxSystemDeclarativeV2ActivationRevisions.revision,
      ],
    }).onDelete("restrict"),
    foreignKey({
      name: "fx_dv2_head_candidate_fk",
      columns: [table.scopeId, table.candidateSha256],
      foreignColumns: [
        fxSystemDeclarativeV2Candidates.scopeId,
        fxSystemDeclarativeV2Candidates.candidateSha256,
      ],
    }).onDelete("restrict"),
    foreignKey({
      name: "fx_dv2_head_verdict_fk",
      columns: [table.scopeId, table.verdictSha256],
      foreignColumns: [
        fxSystemDeclarativeV2Verdicts.scopeId,
        fxSystemDeclarativeV2Verdicts.verdictSha256,
      ],
    }).onDelete("restrict"),
    check(
      "fx_dv2_head_state_check",
      sql`
        (
        ${table.revisionCounter} >= 0
        and (
          (
            ${table.currentRevision} is null
            and ${table.candidateSha256} is null
            and ${table.verdictSha256} is null
          )
          or
          (
            ${table.currentRevision} >= 1
            and ${table.revisionCounter} >= ${table.currentRevision}
            and octet_length(${table.candidateSha256}) = 32
            and octet_length(${table.verdictSha256}) = 32
          )
        )
        ) is true
      `,
    ),
    check(
      "fx_dv2_head_frame_check",
      requiredFrameCheck(
        table.frameCodecVersion,
        table.frameByteLength,
        table.frameSha256,
        table.frameBytes,
      ),
    ),
    check(
      "fx_dv2_head_timestamps_check",
      sql`isfinite(${table.createdAt})
        and isfinite(${table.updatedAt})
        and ${table.updatedAt} >= ${table.createdAt}`,
    ),
  ],
);
