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
  uniqueIndex,
} from "drizzle-orm/pg-core";
import type {
  CatalogEdgeDefinitionId,
  CatalogRelationId,
  CatalogTableId,
} from "flarex-protocol/catalog";
import type { CatalogSchemaVersion, CatalogSchemaVersionId } from "flarex-protocol/schema-manifest";
import type {
  CommitSeq,
  FlarexDbV1StorageGeneration,
  ScopeEpoch,
  ScopeId,
  StorageGenerationFence,
} from "flarex-protocol/storage-authority";
import {
  APPLICATION_RELATION_BUILD_CURSOR_CODEC_VERSION,
  APPLICATION_RELATION_READINESS_RECEIPT_CODEC_VERSION,
  APPLICATION_RELATION_READINESS_RECEIPT_MAXIMUM_BYTES,
} from "../../application/relations/build/Constants";
import type {
  ApplicationRelationBuildAttemptFence,
  ApplicationRelationBuildLifecycle,
} from "../../application/relations/build/Model";
import {
  APPLICATION_RELATION_SEMANTIC_READINESS_RECEIPT_CODEC_VERSION,
  APPLICATION_RELATION_SEMANTIC_READINESS_RECEIPT_MAXIMUM_BYTES,
  APPLICATION_RELATION_SEMANTIC_VALIDATION_CURSOR_CODEC_VERSION,
} from "../../application/relations/readiness/Constants";
import type {
  ApplicationRelationSemanticReadinessOriginKind,
  ApplicationRelationSemanticValidationAttemptFence,
  ApplicationRelationSemanticValidationLifecycle,
} from "../../application/relations/readiness/Model";
import { bytea, nonBlankText } from "./primitives";
import { fxSystemScopeClocks } from "./scope";

/** Mutable scope-fenced progress for one inactive physical edge definition. */
export const fxSystemEdgeDefinitionBuilds = pgTable(
  "fx_system_edge_definition_build",
  {
    scopeId: text("scope_id").$type<ScopeId>().notNull(),
    edgeDefinitionId: integer("edge_definition_id")
      .$type<CatalogEdgeDefinitionId>()
      .notNull(),
    deploymentId: text("deployment_id").notNull(),
    relationId: integer("relation_id").$type<CatalogRelationId>().notNull(),
    sourceTableId: integer("source_table_id").$type<CatalogTableId>().notNull(),
    targetTableId: integer("target_table_id").$type<CatalogTableId>().notNull(),
    semanticDefinitionSha256: bytea("semantic_definition_sha256").notNull(),
    physicalDefinitionSha256: bytea("physical_definition_sha256").notNull(),
    storageGeneration: text("storage_generation")
      .$type<FlarexDbV1StorageGeneration>()
      .notNull(),
    storageGenerationFence: bigint("storage_generation_fence", {
      mode: "bigint",
    }).$type<StorageGenerationFence>().notNull(),
    epoch: text("epoch").$type<ScopeEpoch>().notNull(),
    frontierCommitSeq: bigint("frontier_commit_seq", { mode: "bigint" })
      .$type<CommitSeq>()
      .notNull(),
    attemptFence: bigint("attempt_fence", { mode: "bigint" })
      .$type<ApplicationRelationBuildAttemptFence>()
      .notNull(),
    lifecycle: text("lifecycle")
      .$type<ApplicationRelationBuildLifecycle>()
      .notNull(),
    cursorCodecVersion: integer("cursor_codec_version").notNull(),
    sourceCursorRowId: bytea("source_cursor_row_id"),
    edgeCursorSourceRowId: bytea("edge_cursor_source_row_id"),
    edgeCursorTargetRowId: bytea("edge_cursor_target_row_id"),
    versionCursorDirection: text("version_cursor_direction")
      .$type<"incoming" | "outgoing">(),
    versionCursorEndpointRowId: bytea("version_cursor_endpoint_row_id"),
    processedSourceCount: bigint("processed_source_count", { mode: "bigint" })
      .notNull(),
    validatedSourceCount: bigint("validated_source_count", { mode: "bigint" })
      .notNull(),
    validatedEdgeCount: bigint("validated_edge_count", { mode: "bigint" })
      .notNull(),
    validatedVersionCount: bigint("validated_version_count", { mode: "bigint" })
      .notNull(),
    readinessSha256: bytea("readiness_sha256"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({
      name: "fx_system_edge_definition_build_pk",
      columns: [table.scopeId, table.edgeDefinitionId],
    }),
    foreignKey({
      name: "fx_system_edge_definition_build_scope_fk",
      columns: [table.scopeId],
      foreignColumns: [fxSystemScopeClocks.scopeId],
    }).onDelete("restrict"),
    check(
      "fx_system_edge_definition_build_identity_check",
      sql`${nonBlankText(table.scopeId)}
        and ${nonBlankText(table.deploymentId)}
        and ${table.edgeDefinitionId} between 1 and 2147483647
        and ${table.relationId} between 1 and 2147483647
        and ${table.sourceTableId} between 1 and 2147483647
        and ${table.targetTableId} between 1 and 2147483647`,
    ),
    check(
      "fx_system_edge_definition_build_digest_check",
      sql`octet_length(${table.semanticDefinitionSha256}) = 32
        and octet_length(${table.physicalDefinitionSha256}) = 32`,
    ),
    check(
      "fx_system_edge_definition_build_authority_check",
      sql`${table.storageGeneration} = 'flarexdb_v1'
        and ${table.storageGenerationFence} >= 1
        and ${nonBlankText(table.epoch)}
        and ${table.frontierCommitSeq} >= 0
        and ${table.attemptFence} >= 1`,
    ),
    check(
      "fx_system_edge_definition_build_lifecycle_check",
      sql`${table.lifecycle} in ('cleaning', 'backfilling', 'validating_sources', 'validating_edges', 'validating_versions', 'enabled')`,
    ),
    check(
      "fx_system_edge_definition_build_cursor_check",
      sql`${table.cursorCodecVersion} = ${sql.raw(
        String(APPLICATION_RELATION_BUILD_CURSOR_CODEC_VERSION),
      )}
        and (${table.sourceCursorRowId} is null or octet_length(${table.sourceCursorRowId}) = 16)
        and (${table.edgeCursorSourceRowId} is null or octet_length(${table.edgeCursorSourceRowId}) = 16)
        and (${table.edgeCursorTargetRowId} is null or octet_length(${table.edgeCursorTargetRowId}) = 16)
        and (${table.edgeCursorSourceRowId} is null) = (${table.edgeCursorTargetRowId} is null)
        and (${table.versionCursorDirection} is null or ${table.versionCursorDirection} in ('incoming', 'outgoing'))
        and (${table.versionCursorEndpointRowId} is null or octet_length(${table.versionCursorEndpointRowId}) = 16)
        and (${table.versionCursorDirection} is null) = (${table.versionCursorEndpointRowId} is null)
        and (
          (${table.lifecycle} in ('backfilling', 'validating_sources')
            and ${table.edgeCursorSourceRowId} is null
            and ${table.versionCursorDirection} is null)
          or (${table.lifecycle} = 'validating_edges'
            and ${table.sourceCursorRowId} is null
            and ${table.versionCursorDirection} is null)
          or (${table.lifecycle} = 'validating_versions'
            and ${table.sourceCursorRowId} is null
            and ${table.edgeCursorSourceRowId} is null)
          or (${table.lifecycle} in ('cleaning', 'enabled')
            and ${table.sourceCursorRowId} is null
            and ${table.edgeCursorSourceRowId} is null
            and ${table.versionCursorDirection} is null)
        )`,
    ),
    check(
      "fx_system_edge_definition_build_count_check",
      sql`${table.processedSourceCount} >= 0
        and ${table.validatedSourceCount} >= 0
        and ${table.validatedEdgeCount} >= 0
        and ${table.validatedVersionCount} >= 0
        and (
          (${table.lifecycle} = 'cleaning'
            and ${table.processedSourceCount} = 0
            and ${table.validatedSourceCount} = 0
            and ${table.validatedEdgeCount} = 0
            and ${table.validatedVersionCount} = 0)
          or (${table.lifecycle} = 'backfilling'
            and ${table.validatedSourceCount} = 0
            and ${table.validatedEdgeCount} = 0
            and ${table.validatedVersionCount} = 0)
          or (${table.lifecycle} = 'validating_sources'
            and ${table.validatedSourceCount} <= ${table.processedSourceCount}
            and ${table.validatedEdgeCount} = 0
            and ${table.validatedVersionCount} = 0)
          or (${table.lifecycle} = 'validating_edges'
            and ${table.validatedSourceCount} = ${table.processedSourceCount}
            and ${table.validatedVersionCount} = 0)
          or (${table.lifecycle} in ('validating_versions', 'enabled')
            and ${table.validatedSourceCount} = ${table.processedSourceCount})
        )
        and (
          (${table.lifecycle} = 'enabled'
            and ${table.readinessSha256} is not null
            and octet_length(${table.readinessSha256}) = 32)
          or (${table.lifecycle} <> 'enabled' and ${table.readinessSha256} is null)
        )`,
    ),
    check(
      "fx_system_edge_definition_build_time_check",
      sql`isfinite(${table.createdAt}) and isfinite(${table.updatedAt})
        and ${table.updatedAt} >= ${table.createdAt}`,
    ),
  ],
);

/** Immutable exact physical-readiness evidence for one completed attempt. */
export const fxSystemEdgeDefinitionReadiness = pgTable(
  "fx_system_edge_definition_readiness",
  {
    scopeId: text("scope_id").$type<ScopeId>().notNull(),
    edgeDefinitionId: integer("edge_definition_id")
      .$type<CatalogEdgeDefinitionId>()
      .notNull(),
    attemptFence: bigint("attempt_fence", { mode: "bigint" })
      .$type<ApplicationRelationBuildAttemptFence>()
      .notNull(),
    deploymentId: text("deployment_id").notNull(),
    relationId: integer("relation_id").$type<CatalogRelationId>().notNull(),
    sourceTableId: integer("source_table_id").$type<CatalogTableId>().notNull(),
    targetTableId: integer("target_table_id").$type<CatalogTableId>().notNull(),
    semanticDefinitionSha256: bytea("semantic_definition_sha256").notNull(),
    physicalDefinitionSha256: bytea("physical_definition_sha256").notNull(),
    storageGeneration: text("storage_generation")
      .$type<FlarexDbV1StorageGeneration>()
      .notNull(),
    storageGenerationFence: bigint("storage_generation_fence", {
      mode: "bigint",
    }).$type<StorageGenerationFence>().notNull(),
    epoch: text("epoch").$type<ScopeEpoch>().notNull(),
    frontierCommitSeq: bigint("frontier_commit_seq", { mode: "bigint" })
      .$type<CommitSeq>()
      .notNull(),
    receiptCodecVersion: integer("receipt_codec_version").notNull(),
    receiptBytes: bytea("receipt_bytes").notNull(),
    readinessSha256: bytea("readiness_sha256").notNull(),
    sourceCount: bigint("source_count", { mode: "bigint" }).notNull(),
    edgeCount: bigint("edge_count", { mode: "bigint" }).notNull(),
    versionCount: bigint("version_count", { mode: "bigint" }).notNull(),
    settledAt: timestamp("settled_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({
      name: "fx_system_edge_definition_readiness_pk",
      columns: [table.scopeId, table.edgeDefinitionId, table.attemptFence],
    }),
    unique("fx_system_edge_definition_readiness_receipt_unique").on(
      table.scopeId,
      table.edgeDefinitionId,
      table.attemptFence,
      table.readinessSha256,
    ),
    foreignKey({
      name: "fx_system_edge_definition_readiness_build_fk",
      columns: [table.scopeId, table.edgeDefinitionId],
      foreignColumns: [
        fxSystemEdgeDefinitionBuilds.scopeId,
        fxSystemEdgeDefinitionBuilds.edgeDefinitionId,
      ],
    }).onDelete("restrict"),
    uniqueIndex("fx_system_edge_definition_readiness_digest_unique").on(
      table.scopeId,
      table.readinessSha256,
    ),
    check(
      "fx_system_edge_definition_readiness_identity_check",
      sql`${nonBlankText(table.scopeId)}
        and ${nonBlankText(table.deploymentId)}
        and ${table.edgeDefinitionId} between 1 and 2147483647
        and ${table.relationId} between 1 and 2147483647
        and ${table.sourceTableId} between 1 and 2147483647
        and ${table.targetTableId} between 1 and 2147483647
        and ${table.attemptFence} >= 1`,
    ),
    check(
      "fx_system_edge_definition_readiness_digest_check",
      sql`octet_length(${table.semanticDefinitionSha256}) = 32
        and octet_length(${table.physicalDefinitionSha256}) = 32
        and octet_length(${table.readinessSha256}) = 32`,
    ),
    check(
      "fx_system_edge_definition_readiness_authority_check",
      sql`${table.storageGeneration} = 'flarexdb_v1'
        and ${table.storageGenerationFence} >= 1
        and ${nonBlankText(table.epoch)}
        and ${table.frontierCommitSeq} >= 0`,
    ),
    check(
      "fx_system_edge_definition_readiness_receipt_check",
      sql`${table.receiptCodecVersion} = ${sql.raw(
        String(APPLICATION_RELATION_READINESS_RECEIPT_CODEC_VERSION),
      )}
        and octet_length(${table.receiptBytes}) between 1 and ${sql.raw(
          String(APPLICATION_RELATION_READINESS_RECEIPT_MAXIMUM_BYTES),
        )}`,
    ),
    check(
      "fx_system_edge_definition_readiness_count_check",
      sql`${table.sourceCount} >= 0
        and ${table.edgeCount} >= 0
        and ${table.versionCount} >= 0`,
    ),
    check(
      "fx_system_edge_definition_readiness_time_check",
      sql`isfinite(${table.settledAt})`,
    ),
  ],
);

/** Mutable validation-only progress for one policy-reused relation binding. */
export const fxSystemApplicationRelationSemanticValidations = pgTable(
  "fx_system_application_relation_semantic_validation",
  {
    scopeId: text("scope_id").$type<ScopeId>().notNull(),
    deploymentId: text("deployment_id").notNull(),
    applicationSchemaSha256: bytea("application_schema_sha256").notNull(),
    schemaVersionId: text("schema_version_id")
      .$type<CatalogSchemaVersionId>()
      .notNull(),
    schemaVersion: integer("schema_version")
      .$type<CatalogSchemaVersion>()
      .notNull(),
    schemaManifestSha256: bytea("schema_manifest_sha256").notNull(),
    boundPublicationSha256: bytea("bound_publication_sha256").notNull(),
    relationOrdinal: integer("relation_ordinal").notNull(),
    relationId: integer("relation_id").$type<CatalogRelationId>().notNull(),
    sourceTableId: integer("source_table_id")
      .$type<CatalogTableId>()
      .notNull(),
    targetTableId: integer("target_table_id")
      .$type<CatalogTableId>()
      .notNull(),
    semanticDefinitionSha256: bytea("semantic_definition_sha256").notNull(),
    edgeDefinitionId: integer("edge_definition_id")
      .$type<CatalogEdgeDefinitionId>()
      .notNull(),
    physicalDefinitionSha256: bytea("physical_definition_sha256").notNull(),
    originSchemaVersionId: text("origin_schema_version_id")
      .$type<CatalogSchemaVersionId>()
      .notNull(),
    originRelationOrdinal: integer("origin_relation_ordinal").notNull(),
    originReadinessKind: text("origin_readiness_kind")
      .$type<ApplicationRelationSemanticReadinessOriginKind>()
      .notNull(),
    originSemanticAttemptFence: bigint("origin_semantic_attempt_fence", {
      mode: "bigint",
    }).$type<ApplicationRelationSemanticValidationAttemptFence>(),
    originSemanticReadinessSha256:
      bytea("origin_semantic_readiness_sha256"),
    physicalOriginSchemaVersionId: text("physical_origin_schema_version_id")
      .$type<CatalogSchemaVersionId>()
      .notNull(),
    physicalOriginRelationOrdinal:
      integer("physical_origin_relation_ordinal").notNull(),
    physicalAttemptFence: bigint("physical_attempt_fence", {
      mode: "bigint",
    }).$type<ApplicationRelationBuildAttemptFence>().notNull(),
    physicalReadinessSha256: bytea("physical_readiness_sha256").notNull(),
    physicalFrontierCommitSeq: bigint("physical_frontier_commit_seq", {
      mode: "bigint",
    }).$type<CommitSeq>().notNull(),
    storageGeneration: text("storage_generation")
      .$type<FlarexDbV1StorageGeneration>()
      .notNull(),
    storageGenerationFence: bigint("storage_generation_fence", {
      mode: "bigint",
    }).$type<StorageGenerationFence>().notNull(),
    epoch: text("epoch").$type<ScopeEpoch>().notNull(),
    frontierCommitSeq: bigint("frontier_commit_seq", { mode: "bigint" })
      .$type<CommitSeq>()
      .notNull(),
    attemptFence: bigint("attempt_fence", { mode: "bigint" })
      .$type<ApplicationRelationSemanticValidationAttemptFence>()
      .notNull(),
    lifecycle: text("lifecycle")
      .$type<ApplicationRelationSemanticValidationLifecycle>()
      .notNull(),
    cursorCodecVersion: integer("cursor_codec_version").notNull(),
    sourceCursorRowId: bytea("source_cursor_row_id"),
    edgeCursorSourceRowId: bytea("edge_cursor_source_row_id"),
    edgeCursorTargetRowId: bytea("edge_cursor_target_row_id"),
    versionCursorDirection: text("version_cursor_direction")
      .$type<"incoming" | "outgoing">(),
    versionCursorEndpointRowId: bytea("version_cursor_endpoint_row_id"),
    validatedSourceCount: bigint("validated_source_count", { mode: "bigint" })
      .notNull(),
    validatedEdgeCount: bigint("validated_edge_count", { mode: "bigint" })
      .notNull(),
    validatedVersionCount: bigint("validated_version_count", { mode: "bigint" })
      .notNull(),
    readinessSha256: bytea("readiness_sha256"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({
      name: "fx_app_relation_semantic_validation_pk",
      columns: [table.scopeId, table.schemaVersionId, table.relationOrdinal],
    }),
    foreignKey({
      name: "fx_app_relation_semantic_validation_scope_fk",
      columns: [table.scopeId],
      foreignColumns: [fxSystemScopeClocks.scopeId],
    }).onDelete("restrict"),
    foreignKey({
      name: "fx_app_relation_semantic_validation_physical_fk",
      columns: [
        table.scopeId,
        table.edgeDefinitionId,
        table.physicalAttemptFence,
      ],
      foreignColumns: [
        fxSystemEdgeDefinitionReadiness.scopeId,
        fxSystemEdgeDefinitionReadiness.edgeDefinitionId,
        fxSystemEdgeDefinitionReadiness.attemptFence,
      ],
    }).onDelete("restrict"),
    check(
      "fx_app_relation_semantic_validation_identity_check",
      sql`${nonBlankText(table.scopeId)}
        and ${nonBlankText(table.deploymentId)}
        and ${nonBlankText(table.schemaVersionId)}
        and ${table.schemaVersion} between 1 and 2147483647
        and ${table.relationOrdinal} between 1 and 1024
        and ${table.relationId} between 1 and 2147483647
        and ${table.sourceTableId} between 1 and 2147483647
        and ${table.targetTableId} between 1 and 2147483647
        and ${table.edgeDefinitionId} between 1 and 2147483647`,
    ),
    check(
      "fx_app_relation_semantic_validation_digest_check",
      sql`octet_length(${table.applicationSchemaSha256}) = 32
        and octet_length(${table.schemaManifestSha256}) = 32
        and octet_length(${table.boundPublicationSha256}) = 32
        and octet_length(${table.semanticDefinitionSha256}) = 32
        and octet_length(${table.physicalDefinitionSha256}) = 32
        and octet_length(${table.physicalReadinessSha256}) = 32
        and (${table.originSemanticReadinessSha256} is null
          or octet_length(${table.originSemanticReadinessSha256}) = 32)
        and (${table.readinessSha256} is null
          or octet_length(${table.readinessSha256}) = 32)`,
    ),
    check(
      "fx_app_relation_semantic_validation_lineage_check",
      sql`${nonBlankText(table.originSchemaVersionId)}
        and ${table.originRelationOrdinal} between 1 and 1024
        and ${table.originSchemaVersionId} <> ${table.schemaVersionId}
        and ${nonBlankText(table.physicalOriginSchemaVersionId)}
        and ${table.physicalOriginSchemaVersionId} <> ${table.schemaVersionId}
        and ${table.physicalOriginRelationOrdinal} between 1 and 1024
        and ${table.physicalAttemptFence} >= 1
        and (
          (${table.originReadinessKind} = 'physical'
            and ${table.originSemanticAttemptFence} is null
            and ${table.originSemanticReadinessSha256} is null)
          or (${table.originReadinessKind} = 'semantic'
            and ${table.originSemanticAttemptFence} is not null
            and ${table.originSemanticAttemptFence} >= 1
            and ${table.originSemanticReadinessSha256} is not null)
        )`,
    ),
    check(
      "fx_app_relation_semantic_validation_authority_check",
      sql`${table.storageGeneration} = 'flarexdb_v1'
        and ${table.storageGenerationFence} >= 1
        and ${nonBlankText(table.epoch)}
        and ${table.physicalFrontierCommitSeq} >= 0
        and ${table.frontierCommitSeq} >= ${table.physicalFrontierCommitSeq}
        and ${table.attemptFence} >= 1`,
    ),
    check(
      "fx_app_relation_semantic_validation_cursor_check",
      sql`${table.cursorCodecVersion} = ${sql.raw(String(
        APPLICATION_RELATION_SEMANTIC_VALIDATION_CURSOR_CODEC_VERSION,
      ))}
        and (${table.sourceCursorRowId} is null
          or octet_length(${table.sourceCursorRowId}) = 16)
        and (${table.edgeCursorSourceRowId} is null
          or octet_length(${table.edgeCursorSourceRowId}) = 16)
        and (${table.edgeCursorTargetRowId} is null
          or octet_length(${table.edgeCursorTargetRowId}) = 16)
        and (${table.edgeCursorSourceRowId} is null)
          = (${table.edgeCursorTargetRowId} is null)
        and (${table.versionCursorDirection} is null
          or ${table.versionCursorDirection} in ('incoming', 'outgoing'))
        and (${table.versionCursorEndpointRowId} is null
          or octet_length(${table.versionCursorEndpointRowId}) = 16)
        and (${table.versionCursorDirection} is null)
          = (${table.versionCursorEndpointRowId} is null)
        and (
          (${table.lifecycle} = 'validating_sources'
            and ${table.edgeCursorSourceRowId} is null
            and ${table.versionCursorDirection} is null)
          or (${table.lifecycle} = 'validating_edges'
            and ${table.sourceCursorRowId} is null
            and ${table.versionCursorDirection} is null)
          or (${table.lifecycle} = 'validating_versions'
            and ${table.sourceCursorRowId} is null
            and ${table.edgeCursorSourceRowId} is null)
          or (${table.lifecycle} = 'ready'
            and ${table.sourceCursorRowId} is null
            and ${table.edgeCursorSourceRowId} is null
            and ${table.versionCursorDirection} is null)
        )`,
    ),
    check(
      "fx_app_relation_semantic_validation_count_check",
      sql`${table.validatedSourceCount} >= 0
        and ${table.validatedEdgeCount} >= 0
        and ${table.validatedVersionCount} >= 0
        and (${table.lifecycle} <> 'validating_sources'
          or (${table.validatedEdgeCount} = 0
            and ${table.validatedVersionCount} = 0))
        and (${table.lifecycle} <> 'validating_edges'
          or ${table.validatedVersionCount} = 0)
        and (
          (${table.lifecycle} = 'ready'
            and ${table.readinessSha256} is not null)
          or (${table.lifecycle} <> 'ready'
            and ${table.readinessSha256} is null)
        )`,
    ),
    check(
      "fx_app_relation_semantic_validation_time_check",
      sql`isfinite(${table.createdAt}) and isfinite(${table.updatedAt})
        and ${table.updatedAt} >= ${table.createdAt}`,
    ),
  ],
);

/** Immutable semantic-current receipt for one completed validation attempt. */
export const fxSystemApplicationRelationSemanticReadiness = pgTable(
  "fx_system_application_relation_semantic_readiness",
  {
    scopeId: text("scope_id").$type<ScopeId>().notNull(),
    deploymentId: text("deployment_id").notNull(),
    applicationSchemaSha256: bytea("application_schema_sha256").notNull(),
    schemaVersionId: text("schema_version_id")
      .$type<CatalogSchemaVersionId>()
      .notNull(),
    schemaVersion: integer("schema_version")
      .$type<CatalogSchemaVersion>()
      .notNull(),
    schemaManifestSha256: bytea("schema_manifest_sha256").notNull(),
    boundPublicationSha256: bytea("bound_publication_sha256").notNull(),
    relationOrdinal: integer("relation_ordinal").notNull(),
    relationId: integer("relation_id").$type<CatalogRelationId>().notNull(),
    sourceTableId: integer("source_table_id")
      .$type<CatalogTableId>()
      .notNull(),
    targetTableId: integer("target_table_id")
      .$type<CatalogTableId>()
      .notNull(),
    semanticDefinitionSha256: bytea("semantic_definition_sha256").notNull(),
    edgeDefinitionId: integer("edge_definition_id")
      .$type<CatalogEdgeDefinitionId>()
      .notNull(),
    physicalDefinitionSha256: bytea("physical_definition_sha256").notNull(),
    originSchemaVersionId: text("origin_schema_version_id")
      .$type<CatalogSchemaVersionId>()
      .notNull(),
    originRelationOrdinal: integer("origin_relation_ordinal").notNull(),
    originReadinessKind: text("origin_readiness_kind")
      .$type<ApplicationRelationSemanticReadinessOriginKind>()
      .notNull(),
    originSemanticAttemptFence: bigint("origin_semantic_attempt_fence", {
      mode: "bigint",
    }).$type<ApplicationRelationSemanticValidationAttemptFence>(),
    originSemanticReadinessSha256:
      bytea("origin_semantic_readiness_sha256"),
    physicalOriginSchemaVersionId: text("physical_origin_schema_version_id")
      .$type<CatalogSchemaVersionId>()
      .notNull(),
    physicalOriginRelationOrdinal:
      integer("physical_origin_relation_ordinal").notNull(),
    physicalAttemptFence: bigint("physical_attempt_fence", {
      mode: "bigint",
    }).$type<ApplicationRelationBuildAttemptFence>().notNull(),
    physicalReadinessSha256: bytea("physical_readiness_sha256").notNull(),
    physicalFrontierCommitSeq: bigint("physical_frontier_commit_seq", {
      mode: "bigint",
    }).$type<CommitSeq>().notNull(),
    storageGeneration: text("storage_generation")
      .$type<FlarexDbV1StorageGeneration>()
      .notNull(),
    storageGenerationFence: bigint("storage_generation_fence", {
      mode: "bigint",
    }).$type<StorageGenerationFence>().notNull(),
    epoch: text("epoch").$type<ScopeEpoch>().notNull(),
    frontierCommitSeq: bigint("frontier_commit_seq", { mode: "bigint" })
      .$type<CommitSeq>()
      .notNull(),
    attemptFence: bigint("attempt_fence", { mode: "bigint" })
      .$type<ApplicationRelationSemanticValidationAttemptFence>()
      .notNull(),
    receiptCodecVersion: integer("receipt_codec_version").notNull(),
    receiptBytes: bytea("receipt_bytes").notNull(),
    readinessSha256: bytea("readiness_sha256").notNull(),
    sourceCount: bigint("source_count", { mode: "bigint" }).notNull(),
    edgeCount: bigint("edge_count", { mode: "bigint" }).notNull(),
    versionCount: bigint("version_count", { mode: "bigint" }).notNull(),
    settledAt: timestamp("settled_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({
      name: "fx_app_relation_semantic_readiness_pk",
      columns: [
        table.scopeId,
        table.schemaVersionId,
        table.relationOrdinal,
        table.attemptFence,
      ],
    }),
    unique("fx_app_relation_semantic_readiness_origin_unique").on(
      table.scopeId,
      table.schemaVersionId,
      table.relationOrdinal,
      table.attemptFence,
      table.readinessSha256,
    ),
    uniqueIndex("fx_app_relation_semantic_readiness_digest_unique").on(
      table.scopeId,
      table.readinessSha256,
    ),
    foreignKey({
      name: "fx_app_relation_semantic_readiness_head_fk",
      columns: [
        table.scopeId,
        table.schemaVersionId,
        table.relationOrdinal,
      ],
      foreignColumns: [
        fxSystemApplicationRelationSemanticValidations.scopeId,
        fxSystemApplicationRelationSemanticValidations.schemaVersionId,
        fxSystemApplicationRelationSemanticValidations.relationOrdinal,
      ],
    }).onDelete("restrict"),
    foreignKey({
      name: "fx_app_relation_semantic_readiness_physical_fk",
      columns: [
        table.scopeId,
        table.edgeDefinitionId,
        table.physicalAttemptFence,
      ],
      foreignColumns: [
        fxSystemEdgeDefinitionReadiness.scopeId,
        fxSystemEdgeDefinitionReadiness.edgeDefinitionId,
        fxSystemEdgeDefinitionReadiness.attemptFence,
      ],
    }).onDelete("restrict"),
    foreignKey({
      name: "fx_app_relation_semantic_readiness_origin_fk",
      columns: [
        table.scopeId,
        table.originSchemaVersionId,
        table.originRelationOrdinal,
        table.originSemanticAttemptFence,
        table.originSemanticReadinessSha256,
      ],
      foreignColumns: [
        table.scopeId,
        table.schemaVersionId,
        table.relationOrdinal,
        table.attemptFence,
        table.readinessSha256,
      ],
    }).onDelete("restrict"),
    check(
      "fx_app_relation_semantic_readiness_identity_check",
      sql`${nonBlankText(table.scopeId)}
        and ${nonBlankText(table.deploymentId)}
        and ${nonBlankText(table.schemaVersionId)}
        and ${table.schemaVersion} between 1 and 2147483647
        and ${table.relationOrdinal} between 1 and 1024
        and ${table.relationId} between 1 and 2147483647
        and ${table.sourceTableId} between 1 and 2147483647
        and ${table.targetTableId} between 1 and 2147483647
        and ${table.edgeDefinitionId} between 1 and 2147483647
        and ${table.attemptFence} >= 1`,
    ),
    check(
      "fx_app_relation_semantic_readiness_digest_check",
      sql`octet_length(${table.applicationSchemaSha256}) = 32
        and octet_length(${table.schemaManifestSha256}) = 32
        and octet_length(${table.boundPublicationSha256}) = 32
        and octet_length(${table.semanticDefinitionSha256}) = 32
        and octet_length(${table.physicalDefinitionSha256}) = 32
        and octet_length(${table.physicalReadinessSha256}) = 32
        and (${table.originSemanticReadinessSha256} is null
          or octet_length(${table.originSemanticReadinessSha256}) = 32)
        and octet_length(${table.readinessSha256}) = 32`,
    ),
    check(
      "fx_app_relation_semantic_readiness_lineage_check",
      sql`${nonBlankText(table.originSchemaVersionId)}
        and ${table.originRelationOrdinal} between 1 and 1024
        and ${table.originSchemaVersionId} <> ${table.schemaVersionId}
        and ${nonBlankText(table.physicalOriginSchemaVersionId)}
        and ${table.physicalOriginSchemaVersionId} <> ${table.schemaVersionId}
        and ${table.physicalOriginRelationOrdinal} between 1 and 1024
        and ${table.physicalAttemptFence} >= 1
        and (
          (${table.originReadinessKind} = 'physical'
            and ${table.originSemanticAttemptFence} is null
            and ${table.originSemanticReadinessSha256} is null)
          or (${table.originReadinessKind} = 'semantic'
            and ${table.originSemanticAttemptFence} is not null
            and ${table.originSemanticAttemptFence} >= 1
            and ${table.originSemanticReadinessSha256} is not null)
        )`,
    ),
    check(
      "fx_app_relation_semantic_readiness_authority_check",
      sql`${table.storageGeneration} = 'flarexdb_v1'
        and ${table.storageGenerationFence} >= 1
        and ${nonBlankText(table.epoch)}
        and ${table.physicalFrontierCommitSeq} >= 0
        and ${table.frontierCommitSeq} >= ${table.physicalFrontierCommitSeq}`,
    ),
    check(
      "fx_app_relation_semantic_readiness_receipt_check",
      sql`${table.receiptCodecVersion} = ${sql.raw(String(
        APPLICATION_RELATION_SEMANTIC_READINESS_RECEIPT_CODEC_VERSION,
      ))}
        and octet_length(${table.receiptBytes}) between 1 and ${sql.raw(String(
          APPLICATION_RELATION_SEMANTIC_READINESS_RECEIPT_MAXIMUM_BYTES,
        ))}`,
    ),
    check(
      "fx_app_relation_semantic_readiness_count_check",
      sql`${table.sourceCount} >= 0
        and ${table.edgeCount} >= 0
        and ${table.versionCount} >= 0`,
    ),
    check(
      "fx_app_relation_semantic_readiness_time_check",
      sql`isfinite(${table.settledAt})`,
    ),
  ],
);
