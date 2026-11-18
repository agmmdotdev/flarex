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
} from "drizzle-orm/pg-core";
import type {
  FlarexDbV1StorageGeneration,
  ScopeEpoch,
  ScopeId,
} from "flarex-protocol/storage-authority";
import { bytea, nonBlankText, requiredFrameCheck } from "./primitives";
import { fxSystemScopeClocks } from "./scope";

/**
 * Inert target-local Declarative V2 evidence.
 *
 * Canonical byte frames own semantic meaning. The columns below exist only for
 * local lineage, bounded pagination, fencing, metadata-first admission, and
 * future lock/CAS predicates. None of these tables is a production authority
 * until the later activation-head cutover is completed.
 */
export const fxSystemDeclarativeV2Candidates = pgTable(
  "fx_system_declarative_v2_candidate",
  {
    scopeId: text("scope_id").$type<ScopeId>().notNull(),
    candidateSha256: bytea("candidate_sha256").notNull(),
    storageGeneration: text("storage_generation")
      .$type<FlarexDbV1StorageGeneration>()
      .notNull(),
    storageGenerationFence: bigint("storage_generation_fence", {
      mode: "bigint",
    }).notNull(),
    epoch: text("epoch").$type<ScopeEpoch>().notNull(),
    frameCodecVersion: integer("frame_codec_version").notNull(),
    frameByteLength: bigint("frame_byte_length", { mode: "bigint" }).notNull(),
    frameSha256: bytea("frame_sha256").notNull(),
    frameBytes: bytea("frame_bytes").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.scopeId, table.candidateSha256] }),
    foreignKey({
      name: "fx_dv2_candidate_scope_fk",
      columns: [table.scopeId],
      foreignColumns: [fxSystemScopeClocks.scopeId],
    }).onDelete("restrict"),
    check("fx_dv2_candidate_scope_check", nonBlankText(table.scopeId)),
    check(
      "fx_dv2_candidate_digest_check",
      sql`octet_length(${table.candidateSha256}) = 32
        and octet_length(${table.frameSha256}) = 32
        and ${table.candidateSha256} = ${table.frameSha256}`,
    ),
    check(
      "fx_dv2_candidate_clock_check",
      sql`${table.storageGeneration} = 'flarexdb_v1'
        and ${table.storageGenerationFence} >= 1
        and ${nonBlankText(table.epoch)}`,
    ),
    check(
      "fx_dv2_candidate_frame_check",
      requiredFrameCheck(
        table.frameCodecVersion,
        table.frameByteLength,
        table.frameSha256,
        table.frameBytes,
      ),
    ),
    check("fx_dv2_candidate_created_check", sql`isfinite(${table.createdAt})`),
  ],
);
