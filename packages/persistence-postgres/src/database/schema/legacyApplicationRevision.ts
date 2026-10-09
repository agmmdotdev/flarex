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
import type { CatalogSchemaVersion, CatalogSchemaVersionId } from "flarex-protocol/schema-manifest";
import type { ScopeId } from "flarex-protocol/storage-authority";
import { bytea, nonBlankText } from "./primitives";
import { fxControlSchemaVersions } from "./catalogIdentity";
import { fxSystemDeclarativeV2Candidates } from "./legacyDeclarativeCandidate";
import { fxSystemDeclarativeV2VerifierAttemptsV2 } from "./legacyDeclarativeVerifier";

/**
 * Inactive legacy application-revision registration evidence.
 *
 * These rows bind one authenticated, settled registration command to the
 * exact candidate, schema publication, function metadata, and request claim.
 * They deliberately contain no active-head or readiness transition.
 */
export const fxSystemApplicationRevisionsV1 = pgTable(
  "fx_system_application_revision_v1",
  {
    scopeId: text("scope_id").$type<ScopeId>().notNull(),
    candidateSha256: bytea("candidate_sha256").notNull(),
    revisionId: text("revision_id").notNull(),
    deploymentId: text("deployment_id").notNull(),
    attemptSha256: bytea("attempt_sha256").notNull(),
    registrationInputSha256: bytea("registration_input_sha256").notNull(),
    semanticAttemptIdentitySha256: bytea(
      "semantic_attempt_identity_sha256",
    ).notNull(),
    sourceCodecIdentity: text("source_codec_identity").notNull(),
    packageSha256: bytea("package_sha256").notNull(),
    artifactRuntimeIdentity: text("artifact_runtime_identity").notNull(),
    artifactSha256: bytea("artifact_sha256").notNull(),
    schemaVersionId: text("schema_version_id")
      .$type<CatalogSchemaVersionId>()
      .notNull(),
    schemaVersion: integer("schema_version")
      .$type<CatalogSchemaVersion>()
      .notNull(),
    manifestCodecVersion: integer("manifest_codec_version").notNull(),
    manifestByteLength: bigint("manifest_byte_length", {
      mode: "bigint",
    }).notNull(),
    schemaArtifactSha256: bytea("schema_artifact_sha256").notNull(),
    schemaBindingSha256: bytea("schema_binding_sha256").notNull(),
    functionMetadataCodecVersion: integer(
      "function_metadata_codec_version",
    ).notNull(),
    functionMetadataByteLength: bigint("function_metadata_byte_length", {
      mode: "bigint",
    }).notNull(),
    functionMetadataSha256: bytea("function_metadata_sha256").notNull(),
    functionMetadataBytes: bytea("function_metadata_bytes").notNull(),
    validatorRootSha256: bytea("validator_root_sha256").notNull(),
    declaredHandlerSetSha256: bytea(
      "declared_handler_set_sha256",
    ).notNull(),
    registrationRootSha256: bytea("registration_root_sha256").notNull(),
    registrationFrameCount: bigint("registration_frame_count", {
      mode: "bigint",
    }).notNull(),
    registrationFramesByteLength: bigint(
      "registration_frames_byte_length",
      { mode: "bigint" },
    ).notNull(),
    registrationFramesBytes: bytea("registration_frames_bytes").notNull(),
    outputManifestSha256: bytea("output_manifest_sha256").notNull(),
    outputManifestBytes: bytea("output_manifest_bytes").notNull(),
    nextProgressSha256: bytea("next_progress_sha256").notNull(),
    nextProgressBytes: bytea("next_progress_bytes").notNull(),
    receiptSha256: bytea("receipt_sha256").notNull(),
    receiptBytes: bytea("receipt_bytes").notNull(),
    status: text("status").$type<"inactive">().notNull(),
    registeredAt: timestamp("registered_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.scopeId, table.candidateSha256] }),
    unique("fx_application_revision_v1_revision_id_unique").on(
      table.revisionId,
    ),
    unique("fx_application_revision_v1_receipt_target_unique").on(
      table.scopeId,
      table.candidateSha256,
      table.revisionId,
    ),
    foreignKey({
      name: "fx_application_revision_v1_candidate_fk",
      columns: [table.scopeId, table.candidateSha256],
      foreignColumns: [
        fxSystemDeclarativeV2Candidates.scopeId,
        fxSystemDeclarativeV2Candidates.candidateSha256,
      ],
    }).onDelete("restrict"),
    foreignKey({
      name: "fx_application_revision_v1_attempt_fk",
      columns: [table.scopeId, table.attemptSha256],
      foreignColumns: [
        fxSystemDeclarativeV2VerifierAttemptsV2.scopeId,
        fxSystemDeclarativeV2VerifierAttemptsV2.attemptSha256,
      ],
    }).onDelete("restrict"),
    foreignKey({
      name: "fx_application_revision_v1_schema_fk",
      columns: [table.deploymentId, table.schemaVersionId],
      foreignColumns: [
        fxControlSchemaVersions.deploymentId,
        fxControlSchemaVersions.schemaVersionId,
      ],
    }).onDelete("restrict"),
    check(
      "fx_application_revision_v1_identity_check",
      sql`${nonBlankText(table.revisionId)}
        and ${nonBlankText(table.deploymentId)}
        and ${nonBlankText(table.schemaVersionId)}
        and ${table.sourceCodecIdentity} =
          'flarex.source-artifact-v2/codec-v1'
        and ${table.artifactRuntimeIdentity} = 'dynamic-worker'
        and octet_length(${table.candidateSha256}) = 32
        and octet_length(${table.attemptSha256}) = 32
        and octet_length(${table.registrationInputSha256}) = 32
        and octet_length(${table.semanticAttemptIdentitySha256}) = 32
        and octet_length(${table.packageSha256}) = 32
        and octet_length(${table.artifactSha256}) = 32
        and octet_length(${table.schemaArtifactSha256}) = 32
        and octet_length(${table.schemaBindingSha256}) = 32
        and octet_length(${table.functionMetadataSha256}) = 32
        and octet_length(${table.validatorRootSha256}) = 32
        and octet_length(${table.declaredHandlerSetSha256}) = 32
        and octet_length(${table.registrationRootSha256}) = 32
        and octet_length(${table.outputManifestSha256}) = 32
        and octet_length(${table.nextProgressSha256}) = 32
        and octet_length(${table.receiptSha256}) = 32`,
    ),
    check(
      "fx_application_revision_v1_evidence_check",
      sql`${table.schemaVersion} between 1 and 2147483647
        and ${table.manifestCodecVersion} >= 1
        and ${table.manifestByteLength} >= 1
        and ${table.functionMetadataCodecVersion} >= 1
        and ${table.functionMetadataByteLength} >= 1
        and octet_length(${table.functionMetadataBytes}) =
          ${table.functionMetadataByteLength}
        and ${table.registrationFrameCount} >= 0
        and ${table.registrationFramesByteLength} >= 0
        and octet_length(${table.registrationFramesBytes}) =
          ${table.registrationFramesByteLength}
        and octet_length(${table.outputManifestBytes}) >= 1
        and octet_length(${table.nextProgressBytes}) >= 1
        and octet_length(${table.receiptBytes}) >= 1`,
    ),
    check(
      "fx_application_revision_v1_inactive_check",
      sql`${table.status} = 'inactive'`,
    ),
    check(
      "fx_application_revision_v1_registered_at_check",
      sql`isfinite(${table.registeredAt})`,
    ),
  ],
);

export const fxSystemApplicationRevisionRequestsV1 = pgTable(
  "fx_system_application_revision_request_v1",
  {
    scopeId: text("scope_id").$type<ScopeId>().notNull(),
    requestKey: text("request_key").notNull(),
    registrationInputSha256: bytea("registration_input_sha256").notNull(),
    candidateSha256: bytea("candidate_sha256").notNull(),
    revisionId: text("revision_id").notNull(),
    registeredAt: timestamp("registered_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.scopeId, table.requestKey] }),
    foreignKey({
      name: "fx_application_revision_request_v1_revision_fk",
      columns: [
        table.scopeId,
        table.candidateSha256,
        table.revisionId,
      ],
      foreignColumns: [
        fxSystemApplicationRevisionsV1.scopeId,
        fxSystemApplicationRevisionsV1.candidateSha256,
        fxSystemApplicationRevisionsV1.revisionId,
      ],
    }).onDelete("restrict"),
    check(
      "fx_application_revision_request_v1_key_check",
      sql`${nonBlankText(table.requestKey)}
        and octet_length(${table.requestKey}) <= 1024`,
    ),
    check(
      "fx_application_revision_request_v1_identity_check",
      sql`${nonBlankText(table.revisionId)}
        and octet_length(${table.registrationInputSha256}) = 32
        and octet_length(${table.candidateSha256}) = 32`,
    ),
    check(
      "fx_application_revision_request_v1_registered_at_check",
      sql`isfinite(${table.registeredAt})`,
    ),
  ],
);
