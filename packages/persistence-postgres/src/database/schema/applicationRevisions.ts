import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  foreignKey,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import type {
  FlarexDbV1StorageGeneration,
  ScopeEpoch,
  ScopeId,
} from "flarex-protocol/storage-authority";
import { bytea, nonBlankText } from "./primitives";
import { fxSystemScopeClocks } from "./scope";

/**
 * Application Analysis candidate admission. This generation is independent of
 * the retained Declarative V2 candidate and verifier tables.
 */
export const fxSystemApplicationCandidatesV1 = pgTable(
  "fx_system_application_candidate_v1",
  {
    scopeId: text("scope_id").$type<ScopeId>().notNull(),
    candidateId: text("candidate_id").notNull(),
    requestKey: text("request_key").notNull(),
    sourceArtifactRootSha256: bytea("source_artifact_root_sha256").notNull(),
    storageGeneration: text("storage_generation")
      .$type<FlarexDbV1StorageGeneration>()
      .notNull(),
    storageGenerationFence: bigint("storage_generation_fence", {
      mode: "bigint",
    }).notNull(),
    epoch: text("epoch").$type<ScopeEpoch>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.scopeId, table.candidateId] }),
    unique("fx_application_candidate_v1_request_unique").on(
      table.scopeId,
      table.requestKey,
    ),
    unique("fx_application_candidate_v1_source_unique").on(
      table.scopeId,
      table.candidateId,
      table.sourceArtifactRootSha256,
    ),
    foreignKey({
      name: "fx_application_candidate_v1_scope_fk",
      columns: [table.scopeId],
      foreignColumns: [fxSystemScopeClocks.scopeId],
    }).onDelete("restrict"),
    check(
      "fx_application_candidate_v1_identity_check",
      sql`length(${table.candidateId}) between 1 and 256
        and length(${table.requestKey}) between 1 and 256
        and octet_length(${table.sourceArtifactRootSha256}) = 32`,
    ),
    check(
      "fx_application_candidate_v1_clock_check",
      sql`${table.storageGeneration} = 'flarexdb_v1'
        and ${table.storageGenerationFence} >= 1
        and ${nonBlankText(table.epoch)}`,
    ),
    check(
      "fx_application_candidate_v1_created_check",
      sql`isfinite(${table.createdAt})`,
    ),
  ],
);

export const fxSystemApplicationAnalysesV1 = pgTable(
  "fx_system_application_analysis_v1",
  {
    scopeId: text("scope_id").$type<ScopeId>().notNull(),
    analysisId: text("analysis_id").notNull(),
    candidateId: text("candidate_id").notNull(),
    sourceArtifactRootSha256: bytea("source_artifact_root_sha256").notNull(),
    analyzerIdentity: text("analyzer_identity").notNull(),
    analyzerPolicyIdentity: text("analyzer_policy_identity").notNull(),
    status: text("status")
      .$type<"pending" | "analyzed" | "rejected">()
      .notNull(),
    manifestSha256: bytea("manifest_sha256"),
    manifestBytes: bytea("manifest_bytes"),
    receiptSha256: bytea("receipt_sha256"),
    receiptBytes: bytea("receipt_bytes"),
    failureCode: text("failure_code"),
    failureDetail: text("failure_detail"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.scopeId, table.analysisId] }),
    unique("fx_application_analysis_v1_candidate_unique").on(
      table.scopeId,
      table.candidateId,
    ),
    unique("fx_application_analysis_v1_terminal_unique").on(
      table.scopeId,
      table.candidateId,
      table.analysisId,
      table.status,
      table.sourceArtifactRootSha256,
      table.manifestSha256,
    ),
    foreignKey({
      name: "fx_application_analysis_v1_candidate_fk",
      columns: [
        table.scopeId,
        table.candidateId,
        table.sourceArtifactRootSha256,
      ],
      foreignColumns: [
        fxSystemApplicationCandidatesV1.scopeId,
        fxSystemApplicationCandidatesV1.candidateId,
        fxSystemApplicationCandidatesV1.sourceArtifactRootSha256,
      ],
    }).onDelete("restrict"),
    check(
      "fx_application_analysis_v1_identity_check",
      sql`length(${table.analysisId}) between 1 and 256
        and length(${table.candidateId}) between 1 and 256
        and length(${table.analyzerIdentity}) between 1 and 256
        and length(${table.analyzerPolicyIdentity}) between 1 and 256
        and octet_length(${table.sourceArtifactRootSha256}) = 32`,
    ),
    check(
      "fx_application_analysis_v1_state_check",
      sql`(
          ${table.status} = 'pending'
          and ${table.manifestSha256} is null
          and ${table.manifestBytes} is null
          and ${table.receiptSha256} is null
          and ${table.receiptBytes} is null
          and ${table.failureCode} is null
          and ${table.failureDetail} is null
          and ${table.completedAt} is null
        ) or (
          ${table.status} = 'analyzed'
          and octet_length(${table.manifestSha256}) = 32
          and octet_length(${table.manifestBytes}) between 1 and 1048576
          and octet_length(${table.receiptSha256}) = 32
          and octet_length(${table.receiptBytes}) between 1 and 65536
          and ${table.failureCode} is null
          and ${table.failureDetail} is null
          and ${table.completedAt} is not null
        ) or (
          ${table.status} = 'rejected'
          and ${table.manifestSha256} is null
          and ${table.manifestBytes} is null
          and octet_length(${table.receiptSha256}) = 32
          and octet_length(${table.receiptBytes}) between 1 and 65536
          and ${table.failureCode} in (
            'invalid_source_artifact',
            'module_import_failed',
            'forbidden_import_effect',
            'invalid_registration',
            'invalid_schema',
            'limit_exceeded',
            'timeout',
            'nondeterministic_registration'
          )
          and ${table.failureDetail} is not null
          and octet_length(convert_to(${table.failureDetail}, 'UTF8')) <= 8192
          and ${table.completedAt} is not null
        )`,
    ),
    check(
      "fx_application_analysis_v1_time_check",
      sql`isfinite(${table.createdAt})
        and isfinite(${table.updatedAt})
        and ${table.updatedAt} >= ${table.createdAt}
        and (${table.completedAt} is null or (
          isfinite(${table.completedAt}) and ${table.completedAt} >= ${table.createdAt}
        ))`,
    ),
  ],
);

/**
 * Inactive Application Analysis revision generation. The composite analysis
 * foreign key admits only an analyzed terminal with the exact source root and
 * manifest digest.
 */
export const fxSystemApplicationRevisionsV2 = pgTable(
  "fx_system_application_revision_v2",
  {
    scopeId: text("scope_id").$type<ScopeId>().notNull(),
    revisionId: text("revision_id").notNull(),
    candidateId: text("candidate_id").notNull(),
    analysisId: text("analysis_id").notNull(),
    analysisStatus: text("analysis_status").$type<"analyzed">().notNull(),
    sourceArtifactRootSha256: bytea("source_artifact_root_sha256").notNull(),
    manifestSha256: bytea("manifest_sha256").notNull(),
    status: text("status").$type<"inactive">().notNull(),
    registeredAt: timestamp("registered_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.scopeId, table.revisionId] }),
    unique("fx_application_revision_v2_revision_id_unique").on(table.revisionId),
    unique("fx_application_revision_v2_candidate_unique").on(
      table.scopeId,
      table.candidateId,
    ),
    unique("fx_application_revision_v2_analysis_unique").on(
      table.scopeId,
      table.analysisId,
    ),
    unique("fx_application_revision_v2_publication_unique").on(
      table.scopeId,
      table.revisionId,
      table.candidateId,
      table.analysisId,
      table.sourceArtifactRootSha256,
      table.manifestSha256,
      table.status,
    ),
    foreignKey({
      name: "fx_application_revision_v2_analysis_fk",
      columns: [
        table.scopeId,
        table.candidateId,
        table.analysisId,
        table.analysisStatus,
        table.sourceArtifactRootSha256,
        table.manifestSha256,
      ],
      foreignColumns: [
        fxSystemApplicationAnalysesV1.scopeId,
        fxSystemApplicationAnalysesV1.candidateId,
        fxSystemApplicationAnalysesV1.analysisId,
        fxSystemApplicationAnalysesV1.status,
        fxSystemApplicationAnalysesV1.sourceArtifactRootSha256,
        fxSystemApplicationAnalysesV1.manifestSha256,
      ],
    }).onDelete("restrict"),
    check(
      "fx_application_revision_v2_identity_check",
      sql`length(${table.revisionId}) between 1 and 256
        and length(${table.candidateId}) between 1 and 256
        and length(${table.analysisId}) between 1 and 256
        and octet_length(${table.sourceArtifactRootSha256}) = 32
        and octet_length(${table.manifestSha256}) = 32`,
    ),
    check(
      "fx_application_revision_v2_state_check",
      sql`${table.analysisStatus} = 'analyzed' and ${table.status} = 'inactive'`,
    ),
    check(
      "fx_application_revision_v2_registered_check",
      sql`isfinite(${table.registeredAt})`,
    ),
  ],
);
