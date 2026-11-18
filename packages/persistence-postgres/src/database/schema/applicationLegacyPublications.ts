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
import type {
  FlarexDbV1StorageGeneration,
  ScopeEpoch,
  ScopeId,
  StorageGenerationFence,
} from "flarex-protocol/storage-authority";
import { bytea, nonBlankText } from "./primitives";
import { fxSystemApplicationRevisionsV2 } from "./applicationRevisions";

/**
 * Whole-application runtime publication. Source Artifact V2 remains the sole
 * owner of module bodies; this row binds one inactive analyzed revision to
 * canonical schema and function-catalog projections.
 */
export const fxSystemApplicationPublicationsV1 = pgTable(
  "fx_system_application_publication_v1",
  {
    scopeId: text("scope_id").$type<ScopeId>().notNull(),
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
    publicationSha256: bytea("publication_sha256").notNull(),
    publishedAt: timestamp("published_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.scopeId, table.revisionId] }),
    unique("fx_application_publication_v1_identity_unique").on(
      table.scopeId,
      table.publicationSha256,
    ),
    unique("fx_application_publication_v1_catalog_unique").on(
      table.scopeId,
      table.revisionId,
      table.functionCatalogSha256,
    ),
    unique("fx_application_publication_v1_task_authority_unique").on(
      table.scopeId,
      table.revisionId,
      table.candidateId,
      table.analysisId,
      table.sourceArtifactRootSha256,
      table.publicationSha256,
    ),
    foreignKey({
      name: "fx_application_publication_v1_revision_fk",
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
      "fx_application_publication_v1_identity_check",
      sql`length(${table.revisionId}) between 1 and 256
        and length(${table.candidateId}) between 1 and 256
        and length(${table.analysisId}) between 1 and 256
        and ${table.revisionStatus} = 'inactive'
        and octet_length(${table.sourceArtifactRootSha256}) = 32
        and octet_length(${table.manifestSha256}) = 32
        and octet_length(${table.schemaSha256}) = 32
        and octet_length(${table.schemaBytes}) between 1 and 1048576
        and octet_length(${table.functionCatalogSha256}) = 32
        and octet_length(${table.functionCatalogBytes}) between 1 and 1048576
        and octet_length(${table.publicationSha256}) = 32`,
    ),
    check(
      "fx_application_publication_v1_published_check",
      sql`isfinite(${table.publishedAt})`,
    ),
  ],
);

export const fxSystemApplicationFunctionsV1 = pgTable(
  "fx_system_application_function_v1",
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
      columns: [table.scopeId, table.revisionId, table.functionPath],
    }),
    unique("fx_application_function_v1_entry_unique").on(
      table.scopeId,
      table.revisionId,
      table.functionCatalogSha256,
      table.entrySha256,
    ),
    foreignKey({
      name: "fx_application_function_v1_publication_fk",
      columns: [
        table.scopeId,
        table.revisionId,
        table.functionCatalogSha256,
      ],
      foreignColumns: [
        fxSystemApplicationPublicationsV1.scopeId,
        fxSystemApplicationPublicationsV1.revisionId,
        fxSystemApplicationPublicationsV1.functionCatalogSha256,
      ],
    }).onDelete("restrict"),
    check(
      "fx_application_function_v1_identity_check",
      sql`length(${table.functionPath}) between 1 and 4096
        and length(${table.moduleName}) between 1 and 4096
        and length(${table.exportName}) between 1 and 4096
        and (
          (${table.exportName} = 'default' and ${table.functionPath} = ${table.moduleName})
          or (${table.exportName} <> 'default' and ${table.functionPath} = ${table.moduleName} || ':' || ${table.exportName})
        )
        and ${table.functionKind} in ('query', 'mutation', 'workflowMutation', 'action')
        and ${table.visibility} in ('public', 'internal')
        and octet_length(${table.functionCatalogSha256}) = 32
        and octet_length(${table.entrySha256}) = 32
        and octet_length(${table.entryBytes}) between 1 and 65536`,
    ),
  ],
);

/**
 * Private immutable Application task-catalog binding. One row exists even for
 * an explicitly empty catalog; current task-run consumers do not read it.
 */
export const fxSystemApplicationTaskCatalogsV1 = pgTable(
  "fx_system_application_task_catalog_v1",
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
    primaryKey({ columns: [table.scopeId, table.revisionId] }),
    unique("fx_application_task_catalog_v1_binding_unique").on(
      table.scopeId,
      table.taskCatalogBindingSha256,
    ),
    unique("fx_application_task_catalog_v1_child_fk_unique").on(
      table.scopeId,
      table.revisionId,
      table.taskCatalogBindingSha256,
    ),
    foreignKey({
      name: "fx_application_task_catalog_v1_publication_fk",
      columns: [
        table.scopeId,
        table.revisionId,
        table.candidateId,
        table.analysisId,
        table.sourceArtifactRootSha256,
        table.publicationSha256,
      ],
      foreignColumns: [
        fxSystemApplicationPublicationsV1.scopeId,
        fxSystemApplicationPublicationsV1.revisionId,
        fxSystemApplicationPublicationsV1.candidateId,
        fxSystemApplicationPublicationsV1.analysisId,
        fxSystemApplicationPublicationsV1.sourceArtifactRootSha256,
        fxSystemApplicationPublicationsV1.publicationSha256,
      ],
    }).onDelete("restrict"),
    check(
      "fx_application_task_catalog_v1_identity_check",
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
      "fx_application_task_catalog_v1_registered_check",
      sql`isfinite(${table.registeredAt})`,
    ),
  ],
);

/** Immutable child definitions for one private Application task catalog. */
export const fxSystemApplicationTaskDefinitionsV1 = pgTable(
  "fx_system_application_task_definition_v1",
  {
    scopeId: text("scope_id").$type<ScopeId>().notNull(),
    revisionId: text("revision_id").notNull(),
    taskCatalogBindingSha256: bytea("task_catalog_binding_sha256").notNull(),
    taskDefinitionBindingSha256: bytea("task_definition_binding_sha256")
      .notNull(),
    taskId: text("task_id").notNull(),
    canonicalTaskManifestSha256: bytea("canonical_task_manifest_sha256")
      .notNull(),
    logicalModulePath: text("logical_module_path").notNull(),
    sourceModulePath: text("source_module_path").notNull(),
    exportName: text("export_name").notNull(),
    manifestBytes: bytea("manifest_bytes").notNull(),
    bindingBytes: bytea("binding_bytes").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.scopeId, table.revisionId, table.taskId] }),
    unique("fx_application_task_definition_v1_binding_unique").on(
      table.scopeId,
      table.taskDefinitionBindingSha256,
    ),
    foreignKey({
      name: "fx_application_task_definition_v1_catalog_fk",
      columns: [
        table.scopeId,
        table.revisionId,
        table.taskCatalogBindingSha256,
      ],
      foreignColumns: [
        fxSystemApplicationTaskCatalogsV1.scopeId,
        fxSystemApplicationTaskCatalogsV1.revisionId,
        fxSystemApplicationTaskCatalogsV1.taskCatalogBindingSha256,
      ],
    }).onDelete("restrict"),
    check(
      "fx_application_task_definition_v1_identity_check",
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

/** One inactive Application Revision V2 bound to its catalog schema. */
export const fxSystemApplicationRevisionSchemasV1 = pgTable(
  "fx_system_application_revision_schema_v1",
  {
    scopeId: text("scope_id").$type<ScopeId>().notNull(),
    revisionId: text("revision_id").notNull(),
    deploymentId: text("deployment_id").notNull(),
    applicationSchemaSha256: bytea("application_schema_sha256").notNull(),
    schemaVersionId: text("schema_version_id")
      .$type<CatalogSchemaVersionId>()
      .notNull(),
    schemaVersion: integer("schema_version")
      .$type<CatalogSchemaVersion>()
      .notNull(),
    schemaManifestSha256: bytea("schema_manifest_sha256").notNull(),
    schemaBindingSha256: bytea("schema_binding_sha256").notNull(),
    boundAt: timestamp("bound_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.scopeId, table.revisionId] }),
    unique("fx_application_revision_schema_v1_binding_unique").on(
      table.scopeId,
      table.revisionId,
      table.applicationSchemaSha256,
      table.schemaVersionId,
      table.schemaManifestSha256,
      table.schemaBindingSha256,
    ),
    foreignKey({
      name: "fx_application_revision_schema_v1_revision_fk",
      columns: [table.scopeId, table.revisionId],
      foreignColumns: [
        fxSystemApplicationRevisionsV2.scopeId,
        fxSystemApplicationRevisionsV2.revisionId,
      ],
    }).onDelete("restrict"),
    check(
      "fx_application_revision_schema_v1_identity_check",
      sql`${nonBlankText(table.revisionId)}
        and ${nonBlankText(table.deploymentId)}
        and octet_length(${table.applicationSchemaSha256}) = 32
        and ${nonBlankText(table.schemaVersionId)}
        and ${table.schemaVersion} between 1 and 2147483647
        and octet_length(${table.schemaManifestSha256}) = 32
        and octet_length(${table.schemaBindingSha256}) = 32`,
    ),
    check(
      "fx_application_revision_schema_v1_time_check",
      sql`isfinite(${table.boundAt})`,
    ),
  ],
);

/** Immutable Application readiness receipt; this table owns no active head. */
export const fxSystemApplicationReadinessV1 = pgTable(
  "fx_system_application_readiness_v1",
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
    schemaBindingSha256: bytea("schema_binding_sha256").notNull(),
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
    readinessSha256: bytea("readiness_sha256").notNull(),
    readinessBytes: bytea("readiness_bytes").notNull(),
    readyAt: timestamp("ready_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.scopeId, table.revisionId] }),
    unique("fx_application_readiness_v1_receipt_unique").on(
      table.scopeId,
      table.readinessSha256,
    ),
    unique("fx_application_readiness_v1_child_unique").on(
      table.scopeId,
      table.revisionId,
      table.readinessSha256,
    ),
    foreignKey({
      name: "fx_application_readiness_v1_publication_fk",
      columns: [table.scopeId, table.revisionId],
      foreignColumns: [
        fxSystemApplicationPublicationsV1.scopeId,
        fxSystemApplicationPublicationsV1.revisionId,
      ],
    }).onDelete("restrict"),
    foreignKey({
      name: "fx_application_readiness_v1_schema_fk",
      columns: [
        table.scopeId,
        table.revisionId,
      table.applicationSchemaSha256,
      table.schemaVersionId,
      table.schemaManifestSha256,
      table.schemaBindingSha256,
      ],
      foreignColumns: [
        fxSystemApplicationRevisionSchemasV1.scopeId,
        fxSystemApplicationRevisionSchemasV1.revisionId,
        fxSystemApplicationRevisionSchemasV1.applicationSchemaSha256,
        fxSystemApplicationRevisionSchemasV1.schemaVersionId,
        fxSystemApplicationRevisionSchemasV1.schemaManifestSha256,
        fxSystemApplicationRevisionSchemasV1.schemaBindingSha256,
      ],
    }).onDelete("restrict"),
    foreignKey({
      name: "fx_application_readiness_v1_task_fk",
      columns: [
        table.scopeId,
        table.revisionId,
        table.taskCatalogBindingSha256,
      ],
      foreignColumns: [
        fxSystemApplicationTaskCatalogsV1.scopeId,
        fxSystemApplicationTaskCatalogsV1.revisionId,
        fxSystemApplicationTaskCatalogsV1.taskCatalogBindingSha256,
      ],
    }).onDelete("restrict"),
    check(
      "fx_application_readiness_v1_identity_check",
      sql`${nonBlankText(table.revisionId)}
        and ${nonBlankText(table.deploymentId)}
        and ${nonBlankText(table.candidateId)}
        and ${nonBlankText(table.analysisId)}
        and octet_length(${table.sourceArtifactRootSha256}) = 32
        and octet_length(${table.manifestSha256}) = 32
        and octet_length(${table.publicationSha256}) = 32
        and octet_length(${table.applicationSchemaSha256}) = 32
        and octet_length(${table.functionCatalogSha256}) = 32
        and ${table.storageGeneration} = 'flarexdb_v1'
        and ${table.storageGenerationFence} >= 1
        and ${nonBlankText(table.epoch)}
        and ${nonBlankText(table.schemaVersionId)}
        and octet_length(${table.schemaManifestSha256}) = 32
        and octet_length(${table.schemaBindingSha256}) = 32
        and octet_length(${table.taskCatalogBindingSha256}) = 32
        and ${nonBlankText(table.runtimeHostIdentity)}
        and ${table.compatibilityDate} ~ '^\\d{4}-\\d{2}-\\d{2}$'
        and octet_length(${table.coldReceiptSetSha256}) = 32
        and octet_length(${table.candidateValidationReceiptSha256}) = 32
        and ${table.uniqueConstraintStatus} in ('not_required', 'eligible')
        and octet_length(${table.uniqueConstraintEligibilitySha256}) = 32
        and octet_length(${table.physicalReadinessSha256}) = 32
        and octet_length(${table.readinessSha256}) = 32
        and octet_length(${table.readinessBytes}) between 1 and 16777216`,
    ),
    check(
      "fx_application_readiness_v1_time_check",
      sql`isfinite(${table.readyAt})`,
    ),
  ],
);

/** Per-function cold proof committed by one Application readiness receipt. */
export const fxSystemApplicationReadinessFunctionsV1 = pgTable(
  "fx_system_application_readiness_function_v1",
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
      columns: [table.scopeId, table.revisionId, table.functionPath],
    }),
    unique("fx_application_readiness_function_v1_receipt_unique").on(
      table.scopeId,
      table.revisionId,
      table.readinessSha256,
      table.coldReceiptSha256,
    ),
    foreignKey({
      name: "fx_application_readiness_function_v1_readiness_fk",
      columns: [table.scopeId, table.revisionId, table.readinessSha256],
      foreignColumns: [
        fxSystemApplicationReadinessV1.scopeId,
        fxSystemApplicationReadinessV1.revisionId,
        fxSystemApplicationReadinessV1.readinessSha256,
      ],
    }).onDelete("restrict"),
    foreignKey({
      name: "fx_application_readiness_function_v1_function_fk",
      columns: [table.scopeId, table.revisionId, table.functionPath],
      foreignColumns: [
        fxSystemApplicationFunctionsV1.scopeId,
        fxSystemApplicationFunctionsV1.revisionId,
        fxSystemApplicationFunctionsV1.functionPath,
      ],
    }).onDelete("restrict"),
    check(
      "fx_application_readiness_function_v1_identity_check",
      sql`${nonBlankText(table.functionPath)}
        and octet_length(${table.readinessSha256}) = 32
        and octet_length(${table.runtimeTargetSha256}) = 32
        and octet_length(${table.coldReceiptSha256}) = 32
        and octet_length(${table.coldReceiptBytes}) between 1 and 16384`,
    ),
  ],
);
