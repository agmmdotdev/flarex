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
  CatalogEdgeDefinitionId,
  CatalogRelationId,
  CatalogTableId,
} from "flarex-protocol/catalog";
import type {
  CatalogSchemaVersion,
  CatalogSchemaVersionId,
} from "flarex-protocol/schema-manifest";
import type {
  CommitSeq,
  FlarexDbV1StorageGeneration,
  ScopeEpoch,
  ScopeId,
  StorageGenerationFence,
} from "flarex-protocol/storage-authority";

import type { ApplicationRelationBuildAttemptFence } from
  "./applicationRelationBuild/Model";
import type {
  ApplicationRelationSemanticValidationAttemptFence,
  ApplicationRelationSetReadinessKind,
} from "./applicationRelationReadiness/Model";
import {
  bytea,
  fxSystemApplicationRelationSemanticReadiness,
  fxSystemApplicationRevisionsV2,
  fxSystemEdgeDefinitionReadiness,
} from "./schema";

/**
 * Relation-aware Application lifecycle storage. These are the accepted
 * current product names; the retained `_v1` tables in `schema.ts` remain the
 * exact legacy compatibility generation and are never reinterpreted here.
 */
export const fxSystemApplicationPublications = pgTable(
  "fx_system_application_publication",
  {
    scopeId: text("scope_id").$type<ScopeId>().notNull(),
    deploymentId: text("deployment_id").notNull(),
    revisionId: text("revision_id").notNull(),
    candidateId: text("candidate_id").notNull(),
    analysisId: text("analysis_id").notNull(),
    revisionStatus: text("revision_status").$type<"inactive">().notNull(),
    sourceArtifactRootSha256: bytea("source_artifact_root_sha256").notNull(),
    manifestSha256: bytea("manifest_sha256").notNull(),
    schemaSha256: bytea("schema_sha256").notNull(),
    schemaBytes: bytea("schema_bytes").notNull(),
    functionCatalogSha256: bytea("function_catalog_sha256").notNull(),
    functionCatalogBytes: bytea("function_catalog_bytes").notNull(),
    schemaVersionId: text("schema_version_id")
      .$type<CatalogSchemaVersionId>()
      .notNull(),
    schemaManifestSha256: bytea("schema_manifest_sha256").notNull(),
    manifestSchemaBindingSha256:
      bytea("manifest_schema_binding_sha256").notNull(),
    boundPublicationSha256: bytea("bound_publication_sha256").notNull(),
    publicationSha256: bytea("publication_sha256").notNull(),
    publishedAt: timestamp("published_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({
      name: "fx_application_publication_pk",
      columns: [table.scopeId, table.revisionId],
    }),
    unique("fx_application_publication_digest_unique").on(
      table.scopeId,
      table.publicationSha256,
    ),
    unique("fx_application_publication_catalog_unique").on(
      table.scopeId,
      table.revisionId,
      table.functionCatalogSha256,
    ),
    unique("fx_application_publication_task_unique").on(
      table.scopeId,
      table.revisionId,
      table.candidateId,
      table.analysisId,
      table.sourceArtifactRootSha256,
      table.publicationSha256,
    ),
    unique("fx_application_publication_schema_unique").on(
      table.scopeId,
      table.revisionId,
      table.manifestSha256,
      table.schemaSha256,
      table.schemaVersionId,
      table.schemaManifestSha256,
      table.manifestSchemaBindingSha256,
      table.boundPublicationSha256,
      table.publicationSha256,
    ),
    foreignKey({
      name: "fx_application_publication_revision_fk",
      columns: [
        table.scopeId,
        table.revisionId,
        table.candidateId,
        table.analysisId,
        table.sourceArtifactRootSha256,
        table.manifestSha256,
        table.revisionStatus,
      ],
      foreignColumns: [
        fxSystemApplicationRevisionsV2.scopeId,
        fxSystemApplicationRevisionsV2.revisionId,
        fxSystemApplicationRevisionsV2.candidateId,
        fxSystemApplicationRevisionsV2.analysisId,
        fxSystemApplicationRevisionsV2.sourceArtifactRootSha256,
        fxSystemApplicationRevisionsV2.manifestSha256,
        fxSystemApplicationRevisionsV2.status,
      ],
    }).onDelete("restrict"),
    check(
      "fx_application_publication_identity_check",
      sql`length(${table.deploymentId}) between 1 and 1024
        and length(${table.revisionId}) between 1 and 256
        and length(${table.candidateId}) between 1 and 256
        and length(${table.analysisId}) between 1 and 256
        and ${table.revisionStatus} = 'inactive'
        and octet_length(${table.sourceArtifactRootSha256}) = 32
        and octet_length(${table.manifestSha256}) = 32
        and octet_length(${table.schemaSha256}) = 32
        and octet_length(${table.schemaBytes}) between 1 and 1048576
        and octet_length(${table.functionCatalogSha256}) = 32
        and octet_length(${table.functionCatalogBytes}) between 1 and 1048576
        and length(${table.schemaVersionId}) between 1 and 1024
        and octet_length(${table.schemaManifestSha256}) = 32
        and octet_length(${table.manifestSchemaBindingSha256}) = 32
        and octet_length(${table.boundPublicationSha256}) = 32
        and octet_length(${table.publicationSha256}) = 32`,
    ),
    check(
      "fx_application_publication_time_check",
      sql`isfinite(${table.publishedAt})`,
    ),
  ],
);

export const fxSystemApplicationFunctions = pgTable(
  "fx_system_application_function",
  {
    scopeId: text("scope_id").$type<ScopeId>().notNull(),
    revisionId: text("revision_id").notNull(),
    functionCatalogSha256: bytea("function_catalog_sha256").notNull(),
    functionPath: text("function_path").notNull(),
    moduleName: text("module_name").notNull(),
    exportName: text("export_name").notNull(),
    functionKind: text("function_kind")
      .$type<"query" | "mutation" | "workflowMutation" | "action">()
      .notNull(),
    visibility: text("visibility").$type<"public" | "internal">().notNull(),
    entrySha256: bytea("entry_sha256").notNull(),
    entryBytes: bytea("entry_bytes").notNull(),
  },
  (table) => [
    primaryKey({
      name: "fx_application_function_pk",
      columns: [table.scopeId, table.revisionId, table.functionPath],
    }),
    unique("fx_application_function_entry_unique").on(
      table.scopeId,
      table.revisionId,
      table.functionCatalogSha256,
      table.entrySha256,
    ),
    foreignKey({
      name: "fx_application_function_publication_fk",
      columns: [table.scopeId, table.revisionId, table.functionCatalogSha256],
      foreignColumns: [
        fxSystemApplicationPublications.scopeId,
        fxSystemApplicationPublications.revisionId,
        fxSystemApplicationPublications.functionCatalogSha256,
      ],
    }).onDelete("restrict"),
    check(
      "fx_application_function_identity_check",
      sql`length(${table.functionPath}) between 1 and 4096
        and length(${table.moduleName}) between 1 and 4096
        and length(${table.exportName}) between 1 and 4096
        and ${table.functionKind} in ('query', 'mutation', 'workflowMutation', 'action')
        and ${table.visibility} in ('public', 'internal')
        and octet_length(${table.functionCatalogSha256}) = 32
        and octet_length(${table.entrySha256}) = 32
        and octet_length(${table.entryBytes}) between 1 and 65536`,
    ),
  ],
);

export const fxSystemApplicationTaskCatalogs = pgTable(
  "fx_system_application_task_catalog",
  {
    scopeId: text("scope_id").$type<ScopeId>().notNull(),
    revisionId: text("revision_id").notNull(),
    candidateId: text("candidate_id").notNull(),
    analysisId: text("analysis_id").notNull(),
    sourceArtifactRootSha256: bytea("source_artifact_root_sha256").notNull(),
    publicationSha256: bytea("publication_sha256").notNull(),
    taskCatalogSha256: bytea("task_catalog_sha256").notNull(),
    taskCatalogBindingSha256: bytea("task_catalog_binding_sha256").notNull(),
    taskCount: integer("task_count").notNull(),
    runtimeHostIdentity: text("runtime_host_identity").notNull(),
    compatibilityDate: text("compatibility_date").notNull(),
    bindingBytes: bytea("binding_bytes").notNull(),
    registeredAt: timestamp("registered_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({
      name: "fx_application_task_catalog_pk",
      columns: [table.scopeId, table.revisionId],
    }),
    unique("fx_application_task_catalog_binding_unique").on(
      table.scopeId,
      table.taskCatalogBindingSha256,
    ),
    unique("fx_application_task_catalog_child_unique").on(
      table.scopeId,
      table.revisionId,
      table.taskCatalogBindingSha256,
    ),
    foreignKey({
      name: "fx_application_task_catalog_publication_fk",
      columns: [
        table.scopeId,
        table.revisionId,
        table.candidateId,
        table.analysisId,
        table.sourceArtifactRootSha256,
        table.publicationSha256,
      ],
      foreignColumns: [
        fxSystemApplicationPublications.scopeId,
        fxSystemApplicationPublications.revisionId,
        fxSystemApplicationPublications.candidateId,
        fxSystemApplicationPublications.analysisId,
        fxSystemApplicationPublications.sourceArtifactRootSha256,
        fxSystemApplicationPublications.publicationSha256,
      ],
    }).onDelete("restrict"),
    check(
      "fx_application_task_catalog_identity_check",
      sql`length(${table.revisionId}) between 1 and 256
        and length(${table.candidateId}) between 1 and 256
        and length(${table.analysisId}) between 1 and 256
        and length(${table.runtimeHostIdentity}) between 1 and 1024
        and ${table.compatibilityDate} ~ '^\\d{4}-\\d{2}-\\d{2}$'
        and octet_length(${table.sourceArtifactRootSha256}) = 32
        and octet_length(${table.publicationSha256}) = 32
        and octet_length(${table.taskCatalogSha256}) = 32
        and octet_length(${table.taskCatalogBindingSha256}) = 32
        and ${table.taskCount} between 0 and 4096
        and octet_length(${table.bindingBytes}) between 1 and 16777216`,
    ),
    check(
      "fx_application_task_catalog_time_check",
      sql`isfinite(${table.registeredAt})`,
    ),
  ],
);

export const fxSystemApplicationTaskDefinitions = pgTable(
  "fx_system_application_task_definition",
  {
    scopeId: text("scope_id").$type<ScopeId>().notNull(),
    revisionId: text("revision_id").notNull(),
    taskCatalogBindingSha256: bytea("task_catalog_binding_sha256").notNull(),
    taskDefinitionBindingSha256:
      bytea("task_definition_binding_sha256").notNull(),
    taskId: text("task_id").notNull(),
    canonicalTaskManifestSha256:
      bytea("canonical_task_manifest_sha256").notNull(),
    logicalModulePath: text("logical_module_path").notNull(),
    sourceModulePath: text("source_module_path").notNull(),
    exportName: text("export_name").notNull(),
    manifestBytes: bytea("manifest_bytes").notNull(),
    bindingBytes: bytea("binding_bytes").notNull(),
  },
  (table) => [
    primaryKey({
      name: "fx_application_task_definition_pk",
      columns: [table.scopeId, table.revisionId, table.taskId],
    }),
    unique("fx_application_task_definition_binding_unique").on(
      table.scopeId,
      table.taskDefinitionBindingSha256,
    ),
    foreignKey({
      name: "fx_application_task_definition_catalog_fk",
      columns: [
        table.scopeId,
        table.revisionId,
        table.taskCatalogBindingSha256,
      ],
      foreignColumns: [
        fxSystemApplicationTaskCatalogs.scopeId,
        fxSystemApplicationTaskCatalogs.revisionId,
        fxSystemApplicationTaskCatalogs.taskCatalogBindingSha256,
      ],
    }).onDelete("restrict"),
    check(
      "fx_application_task_definition_identity_check",
      sql`octet_length(convert_to(${table.taskId}, 'UTF8')) between 1 and 255
        and octet_length(convert_to(${table.logicalModulePath}, 'UTF8')) between 1 and 1024
        and octet_length(convert_to(${table.sourceModulePath}, 'UTF8')) between 1 and 1024
        and octet_length(convert_to(${table.exportName}, 'UTF8')) between 1 and 1024
        and octet_length(${table.taskCatalogBindingSha256}) = 32
        and octet_length(${table.taskDefinitionBindingSha256}) = 32
        and octet_length(${table.canonicalTaskManifestSha256}) = 32
        and octet_length(${table.manifestBytes}) between 1 and 16777216
        and octet_length(${table.bindingBytes}) between 1 and 16777216`,
    ),
  ],
);

export const fxSystemApplicationRevisionSchemas = pgTable(
  "fx_system_application_revision_schema",
  {
    scopeId: text("scope_id").$type<ScopeId>().notNull(),
    revisionId: text("revision_id").notNull(),
    deploymentId: text("deployment_id").notNull(),
    manifestSha256: bytea("manifest_sha256").notNull(),
    publicationSha256: bytea("publication_sha256").notNull(),
    applicationSchemaSha256: bytea("application_schema_sha256").notNull(),
    schemaVersionId: text("schema_version_id")
      .$type<CatalogSchemaVersionId>()
      .notNull(),
    schemaVersion: integer("schema_version")
      .$type<CatalogSchemaVersion>()
      .notNull(),
    schemaManifestSha256: bytea("schema_manifest_sha256").notNull(),
    manifestSchemaBindingSha256:
      bytea("manifest_schema_binding_sha256").notNull(),
    boundPublicationSha256: bytea("bound_publication_sha256").notNull(),
    boundAt: timestamp("bound_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({
      name: "fx_application_revision_schema_pk",
      columns: [table.scopeId, table.revisionId],
    }),
    unique("fx_application_revision_schema_binding_unique").on(
      table.scopeId,
      table.revisionId,
      table.manifestSha256,
      table.publicationSha256,
      table.applicationSchemaSha256,
      table.schemaVersionId,
      table.schemaManifestSha256,
      table.manifestSchemaBindingSha256,
      table.boundPublicationSha256,
    ),
    foreignKey({
      name: "fx_application_revision_schema_publication_fk",
      columns: [
        table.scopeId,
        table.revisionId,
        table.manifestSha256,
        table.applicationSchemaSha256,
        table.schemaVersionId,
        table.schemaManifestSha256,
        table.manifestSchemaBindingSha256,
        table.boundPublicationSha256,
        table.publicationSha256,
      ],
      foreignColumns: [
        fxSystemApplicationPublications.scopeId,
        fxSystemApplicationPublications.revisionId,
        fxSystemApplicationPublications.manifestSha256,
        fxSystemApplicationPublications.schemaSha256,
        fxSystemApplicationPublications.schemaVersionId,
        fxSystemApplicationPublications.schemaManifestSha256,
        fxSystemApplicationPublications.manifestSchemaBindingSha256,
        fxSystemApplicationPublications.boundPublicationSha256,
        fxSystemApplicationPublications.publicationSha256,
      ],
    }).onDelete("restrict"),
    check(
      "fx_application_revision_schema_identity_check",
      sql`length(${table.revisionId}) between 1 and 256
        and length(${table.deploymentId}) between 1 and 1024
        and octet_length(${table.manifestSha256}) = 32
        and octet_length(${table.publicationSha256}) = 32
        and octet_length(${table.applicationSchemaSha256}) = 32
        and length(${table.schemaVersionId}) between 1 and 1024
        and ${table.schemaVersion} between 1 and 2147483647
        and octet_length(${table.schemaManifestSha256}) = 32
        and octet_length(${table.manifestSchemaBindingSha256}) = 32
        and octet_length(${table.boundPublicationSha256}) = 32`,
    ),
    check(
      "fx_application_revision_schema_time_check",
      sql`isfinite(${table.boundAt})`,
    ),
  ],
);

export const fxSystemApplicationReadiness = pgTable(
  "fx_system_application_readiness",
  {
    scopeId: text("scope_id").$type<ScopeId>().notNull(),
    revisionId: text("revision_id").notNull(),
    deploymentId: text("deployment_id").notNull(),
    candidateId: text("candidate_id").notNull(),
    analysisId: text("analysis_id").notNull(),
    sourceArtifactRootSha256: bytea("source_artifact_root_sha256").notNull(),
    manifestSha256: bytea("manifest_sha256").notNull(),
    publicationSha256: bytea("publication_sha256").notNull(),
    applicationSchemaSha256: bytea("application_schema_sha256").notNull(),
    functionCatalogSha256: bytea("function_catalog_sha256").notNull(),
    storageGeneration: text("storage_generation")
      .$type<FlarexDbV1StorageGeneration>()
      .notNull(),
    storageGenerationFence: bigint("storage_generation_fence", {
      mode: "bigint",
    }).$type<StorageGenerationFence>().notNull(),
    epoch: text("epoch").$type<ScopeEpoch>().notNull(),
    schemaVersionId: text("schema_version_id")
      .$type<CatalogSchemaVersionId>()
      .notNull(),
    schemaManifestSha256: bytea("schema_manifest_sha256").notNull(),
    manifestSchemaBindingSha256:
      bytea("manifest_schema_binding_sha256").notNull(),
    boundPublicationSha256: bytea("bound_publication_sha256").notNull(),
    taskCatalogBindingSha256: bytea("task_catalog_binding_sha256").notNull(),
    runtimeHostIdentity: text("runtime_host_identity").notNull(),
    compatibilityDate: text("compatibility_date").notNull(),
    coldReceiptSetSha256: bytea("cold_receipt_set_sha256").notNull(),
    candidateValidationReceiptSha256:
      bytea("candidate_validation_receipt_sha256").notNull(),
    uniqueConstraintStatus: text("unique_constraint_status")
      .$type<"not_required" | "eligible">()
      .notNull(),
    uniqueConstraintEligibilitySha256:
      bytea("unique_constraint_eligibility_sha256").notNull(),
    physicalReadinessSha256: bytea("physical_readiness_sha256").notNull(),
    relationSetCodecVersion: integer("relation_set_codec_version").notNull(),
    relationFrontierCommitSeq: bigint("relation_frontier_commit_seq", {
      mode: "bigint",
    }).$type<CommitSeq>().notNull(),
    relationCount: integer("relation_count").notNull(),
    relationSetReadinessSha256:
      bytea("relation_set_readiness_sha256").notNull(),
    relationSetReadinessBytes: bytea("relation_set_readiness_bytes").notNull(),
    readinessCodecVersion: integer("readiness_codec_version").notNull(),
    readinessSha256: bytea("readiness_sha256").notNull(),
    readinessBytes: bytea("readiness_bytes").notNull(),
    readyAt: timestamp("ready_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({
      name: "fx_application_readiness_pk",
      columns: [table.scopeId, table.revisionId],
    }),
    unique("fx_application_readiness_digest_unique").on(
      table.scopeId,
      table.readinessSha256,
    ),
    unique("fx_application_readiness_child_unique").on(
      table.scopeId,
      table.revisionId,
      table.readinessSha256,
    ),
    unique("fx_application_readiness_relation_unique").on(
      table.scopeId,
      table.revisionId,
      table.readinessSha256,
      table.relationSetReadinessSha256,
      table.relationCount,
    ),
    foreignKey({
      name: "fx_application_readiness_publication_fk",
      columns: [
        table.scopeId,
        table.revisionId,
        table.manifestSha256,
        table.applicationSchemaSha256,
        table.schemaVersionId,
        table.schemaManifestSha256,
        table.manifestSchemaBindingSha256,
        table.boundPublicationSha256,
        table.publicationSha256,
      ],
      foreignColumns: [
        fxSystemApplicationPublications.scopeId,
        fxSystemApplicationPublications.revisionId,
        fxSystemApplicationPublications.manifestSha256,
        fxSystemApplicationPublications.schemaSha256,
        fxSystemApplicationPublications.schemaVersionId,
        fxSystemApplicationPublications.schemaManifestSha256,
        fxSystemApplicationPublications.manifestSchemaBindingSha256,
        fxSystemApplicationPublications.boundPublicationSha256,
        fxSystemApplicationPublications.publicationSha256,
      ],
    }).onDelete("restrict"),
    foreignKey({
      name: "fx_application_readiness_schema_fk",
      columns: [
        table.scopeId,
        table.revisionId,
        table.manifestSha256,
        table.publicationSha256,
        table.applicationSchemaSha256,
        table.schemaVersionId,
        table.schemaManifestSha256,
        table.manifestSchemaBindingSha256,
        table.boundPublicationSha256,
      ],
      foreignColumns: [
        fxSystemApplicationRevisionSchemas.scopeId,
        fxSystemApplicationRevisionSchemas.revisionId,
        fxSystemApplicationRevisionSchemas.manifestSha256,
        fxSystemApplicationRevisionSchemas.publicationSha256,
        fxSystemApplicationRevisionSchemas.applicationSchemaSha256,
        fxSystemApplicationRevisionSchemas.schemaVersionId,
        fxSystemApplicationRevisionSchemas.schemaManifestSha256,
        fxSystemApplicationRevisionSchemas.manifestSchemaBindingSha256,
        fxSystemApplicationRevisionSchemas.boundPublicationSha256,
      ],
    }).onDelete("restrict"),
    foreignKey({
      name: "fx_application_readiness_task_fk",
      columns: [
        table.scopeId,
        table.revisionId,
        table.taskCatalogBindingSha256,
      ],
      foreignColumns: [
        fxSystemApplicationTaskCatalogs.scopeId,
        fxSystemApplicationTaskCatalogs.revisionId,
        fxSystemApplicationTaskCatalogs.taskCatalogBindingSha256,
      ],
    }).onDelete("restrict"),
    check(
      "fx_application_readiness_identity_check",
      sql`length(${table.revisionId}) between 1 and 256
        and length(${table.deploymentId}) between 1 and 1024
        and length(${table.candidateId}) between 1 and 256
        and length(${table.analysisId}) between 1 and 256
        and octet_length(${table.sourceArtifactRootSha256}) = 32
        and octet_length(${table.manifestSha256}) = 32
        and octet_length(${table.publicationSha256}) = 32
        and octet_length(${table.applicationSchemaSha256}) = 32
        and octet_length(${table.functionCatalogSha256}) = 32
        and ${table.storageGeneration} = 'flarexdb_v1'
        and ${table.storageGenerationFence} >= 1
        and length(${table.epoch}) between 1 and 1024
        and length(${table.schemaVersionId}) between 1 and 1024
        and octet_length(${table.schemaManifestSha256}) = 32
        and octet_length(${table.manifestSchemaBindingSha256}) = 32
        and octet_length(${table.boundPublicationSha256}) = 32
        and octet_length(${table.taskCatalogBindingSha256}) = 32
        and length(${table.runtimeHostIdentity}) between 1 and 1024
        and ${table.compatibilityDate} ~ '^\\d{4}-\\d{2}-\\d{2}$'
        and octet_length(${table.coldReceiptSetSha256}) = 32
        and octet_length(${table.candidateValidationReceiptSha256}) = 32
        and ${table.uniqueConstraintStatus} in ('not_required', 'eligible')
        and octet_length(${table.uniqueConstraintEligibilitySha256}) = 32
        and octet_length(${table.physicalReadinessSha256}) = 32
        and ${table.relationSetCodecVersion} = 1
        and ${table.relationFrontierCommitSeq} >= 0
        and ${table.relationCount} between 1 and 1024
        and octet_length(${table.relationSetReadinessSha256}) = 32
        and octet_length(${table.relationSetReadinessBytes}) between 1 and 1048576
        and ${table.readinessCodecVersion} = 2
        and octet_length(${table.readinessSha256}) = 32
        and octet_length(${table.readinessBytes}) between 1 and 16777216`,
    ),
    check(
      "fx_application_readiness_time_check",
      sql`isfinite(${table.readyAt})`,
    ),
  ],
);

export const fxSystemApplicationReadinessFunctions = pgTable(
  "fx_system_application_readiness_function",
  {
    scopeId: text("scope_id").$type<ScopeId>().notNull(),
    revisionId: text("revision_id").notNull(),
    readinessSha256: bytea("readiness_sha256").notNull(),
    functionPath: text("function_path").notNull(),
    runtimeTargetSha256: bytea("runtime_target_sha256").notNull(),
    coldReceiptSha256: bytea("cold_receipt_sha256").notNull(),
    coldReceiptBytes: bytea("cold_receipt_bytes").notNull(),
  },
  (table) => [
    primaryKey({
      name: "fx_application_readiness_function_pk",
      columns: [table.scopeId, table.revisionId, table.functionPath],
    }),
    unique("fx_application_readiness_function_receipt_unique").on(
      table.scopeId,
      table.revisionId,
      table.readinessSha256,
      table.coldReceiptSha256,
    ),
    foreignKey({
      name: "fx_application_readiness_function_readiness_fk",
      columns: [table.scopeId, table.revisionId, table.readinessSha256],
      foreignColumns: [
        fxSystemApplicationReadiness.scopeId,
        fxSystemApplicationReadiness.revisionId,
        fxSystemApplicationReadiness.readinessSha256,
      ],
    }).onDelete("restrict"),
    foreignKey({
      name: "fx_application_readiness_function_function_fk",
      columns: [table.scopeId, table.revisionId, table.functionPath],
      foreignColumns: [
        fxSystemApplicationFunctions.scopeId,
        fxSystemApplicationFunctions.revisionId,
        fxSystemApplicationFunctions.functionPath,
      ],
    }).onDelete("restrict"),
    check(
      "fx_application_readiness_function_identity_check",
      sql`length(${table.functionPath}) between 1 and 4096
        and octet_length(${table.readinessSha256}) = 32
        and octet_length(${table.runtimeTargetSha256}) = 32
        and octet_length(${table.coldReceiptSha256}) = 32
        and octet_length(${table.coldReceiptBytes}) between 1 and 16384`,
    ),
  ],
);

export const fxSystemApplicationReadinessRelations = pgTable(
  "fx_system_application_readiness_relation",
  {
    scopeId: text("scope_id").$type<ScopeId>().notNull(),
    revisionId: text("revision_id").notNull(),
    readinessSha256: bytea("readiness_sha256").notNull(),
    relationSetReadinessSha256:
      bytea("relation_set_readiness_sha256").notNull(),
    relationCount: integer("relation_count").notNull(),
    schemaVersionId: text("schema_version_id")
      .$type<CatalogSchemaVersionId>()
      .notNull(),
    relationOrdinal: integer("relation_ordinal").notNull(),
    relationId: integer("relation_id").$type<CatalogRelationId>().notNull(),
    sourceTableId: integer("source_table_id")
      .$type<CatalogTableId>()
      .notNull(),
    targetTableId: integer("target_table_id")
      .$type<CatalogTableId>()
      .notNull(),
    semanticDefinitionSha256:
      bytea("semantic_definition_sha256").notNull(),
    edgeDefinitionId: integer("edge_definition_id")
      .$type<CatalogEdgeDefinitionId>()
      .notNull(),
    physicalDefinitionSha256:
      bytea("physical_definition_sha256").notNull(),
    readinessKind: text("readiness_kind")
      .$type<ApplicationRelationSetReadinessKind>()
      .notNull(),
    physicalAttemptFence: bigint("physical_attempt_fence", {
      mode: "bigint",
    }).$type<ApplicationRelationBuildAttemptFence>(),
    semanticAttemptFence: bigint("semantic_attempt_fence", {
      mode: "bigint",
    }).$type<ApplicationRelationSemanticValidationAttemptFence>(),
    relationReadinessSha256: bytea("relation_readiness_sha256").notNull(),
  },
  (table) => [
    primaryKey({
      name: "fx_application_readiness_relation_pk",
      columns: [table.scopeId, table.revisionId, table.relationOrdinal],
    }),
    unique("fx_application_readiness_relation_digest_unique").on(
      table.scopeId,
      table.revisionId,
      table.relationReadinessSha256,
    ),
    foreignKey({
      name: "fx_application_readiness_relation_root_fk",
      columns: [
        table.scopeId,
        table.revisionId,
        table.readinessSha256,
        table.relationSetReadinessSha256,
        table.relationCount,
      ],
      foreignColumns: [
        fxSystemApplicationReadiness.scopeId,
        fxSystemApplicationReadiness.revisionId,
        fxSystemApplicationReadiness.readinessSha256,
        fxSystemApplicationReadiness.relationSetReadinessSha256,
        fxSystemApplicationReadiness.relationCount,
      ],
    }).onDelete("restrict"),
    foreignKey({
      name: "fx_application_readiness_relation_physical_fk",
      columns: [
        table.scopeId,
        table.edgeDefinitionId,
        table.physicalAttemptFence,
        table.relationReadinessSha256,
      ],
      foreignColumns: [
        fxSystemEdgeDefinitionReadiness.scopeId,
        fxSystemEdgeDefinitionReadiness.edgeDefinitionId,
        fxSystemEdgeDefinitionReadiness.attemptFence,
        fxSystemEdgeDefinitionReadiness.readinessSha256,
      ],
    }).onDelete("restrict"),
    foreignKey({
      name: "fx_application_readiness_relation_semantic_fk",
      columns: [
        table.scopeId,
        table.schemaVersionId,
        table.relationOrdinal,
        table.semanticAttemptFence,
        table.relationReadinessSha256,
      ],
      foreignColumns: [
        fxSystemApplicationRelationSemanticReadiness.scopeId,
        fxSystemApplicationRelationSemanticReadiness.schemaVersionId,
        fxSystemApplicationRelationSemanticReadiness.relationOrdinal,
        fxSystemApplicationRelationSemanticReadiness.attemptFence,
        fxSystemApplicationRelationSemanticReadiness.readinessSha256,
      ],
    }).onDelete("restrict"),
    check(
      "fx_application_readiness_relation_identity_check",
      sql`length(${table.revisionId}) between 1 and 256
        and length(${table.schemaVersionId}) between 1 and 1024
        and ${table.relationCount} between 1 and 1024
        and ${table.relationOrdinal} between 1 and ${table.relationCount}
        and ${table.relationId} between 1 and 2147483647
        and ${table.sourceTableId} between 1 and 2147483647
        and ${table.targetTableId} between 1 and 2147483647
        and ${table.edgeDefinitionId} between 1 and 2147483647
        and octet_length(${table.readinessSha256}) = 32
        and octet_length(${table.relationSetReadinessSha256}) = 32
        and octet_length(${table.semanticDefinitionSha256}) = 32
        and octet_length(${table.physicalDefinitionSha256}) = 32
        and octet_length(${table.relationReadinessSha256}) = 32`,
    ),
    check(
      "fx_application_readiness_relation_kind_check",
      sql`(
        (${table.readinessKind} = 'physical'
          and ${table.physicalAttemptFence} is not null
          and ${table.physicalAttemptFence} >= 1
          and ${table.semanticAttemptFence} is null)
        or (${table.readinessKind} = 'semantic'
          and ${table.physicalAttemptFence} is null
          and ${table.semanticAttemptFence} is not null
          and ${table.semanticAttemptFence} >= 1)
      )`,
    ),
  ],
);
