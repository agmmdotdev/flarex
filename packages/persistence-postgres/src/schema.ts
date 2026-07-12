import { sql, type SQLWrapper } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  customType,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import type { ExecutionIdentity } from "flarex-protocol/auth";
import type {
  CatalogIndexDefinitionId,
  CatalogIndexId,
  CatalogTableId,
  CatalogTableNamespace,
} from "flarex-protocol/catalog";
import {
  MAX_CANONICAL_APP_INDEX_PHYSICAL_SPEC_BYTES_V1,
  type AppIndexPhysicalSpecCodecVersion,
  type AppPhysicalIndexAccessKindV1,
} from "flarex-protocol/index-definition";
import type {
  IndexBuildAttemptFence,
  IndexBuildCursorCodecVersionV1,
  IndexBuildLifecycleV1,
} from "flarex-protocol/index-build-state";
import type { AppOrderedIndexPhysicalSpecV1 } from "flarex-protocol/ordered-index";
import type {
  CanonicalSchemaManifestBytes,
  CatalogSchemaVersion,
  CatalogSchemaVersionId,
  SchemaManifestCodecVersion,
  SchemaManifestJson,
  SchemaManifestSha256,
} from "flarex-protocol/schema-manifest";
import type {
  CommitSeq,
  FlarexDbV1StorageGeneration,
  OutboxSeq,
  ScopeEpoch,
  ScopeId,
  StorageGeneration,
  StorageGenerationFence,
} from "flarex-protocol/storage-authority";

import type { ScopeIsolationKind } from "./scopeMetadataTypes";

export const bytea = customType<{
  data: Uint8Array;
  driverData: Uint8Array;
}>({
  dataType() {
    return "bytea";
  },
});

export const deployments = pgTable("deployments", {
  deploymentId: text("deployment_id").primaryKey(),
  projectId: text("project_id").notNull(),
  activePackageId: text("active_package_id"),
  activeSchemaVersion: bigint("active_schema_version", { mode: "number" })
    .notNull()
    .default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const fxControlSchemaVersions = pgTable(
  "fx_control_schema_version",
  {
    deploymentId: text("deployment_id")
      .notNull()
      .references(() => deployments.deploymentId, { onDelete: "restrict" }),
    schemaVersionId: text("schema_version_id")
      .$type<CatalogSchemaVersionId>()
      .notNull(),
    version: integer("version").$type<CatalogSchemaVersion>().notNull(),
    manifestCodecVersion: integer("manifest_codec_version")
      .$type<SchemaManifestCodecVersion>()
      .notNull(),
    manifestJson: jsonb("manifest_json").$type<SchemaManifestJson>().notNull(),
    manifestBytes: bytea("manifest_bytes")
      .$type<CanonicalSchemaManifestBytes>()
      .notNull(),
    manifestSha256: bytea("manifest_sha256")
      .$type<SchemaManifestSha256>()
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.deploymentId, table.schemaVersionId] }),
    unique("fx_control_schema_version_deployment_version_unique").on(
      table.deploymentId,
      table.version,
    ),
    check(
      "fx_control_schema_version_deployment_id_non_empty_check",
      nonBlankText(table.deploymentId),
    ),
    check(
      "fx_control_schema_version_id_non_empty_check",
      nonBlankText(table.schemaVersionId),
    ),
    check(
      "fx_control_schema_version_version_positive_check",
      sql`${table.version} between 1 and 2147483647`,
    ),
    check(
      "fx_control_schema_version_manifest_codec_check",
      sql`${table.manifestCodecVersion} = 1`,
    ),
    check(
      "fx_control_schema_version_manifest_object_check",
      sql`jsonb_typeof(${table.manifestJson}) = 'object'`,
    ),
    check(
      "fx_control_schema_version_manifest_bytes_non_empty_check",
      sql`octet_length(${table.manifestBytes}) > 0`,
    ),
    check(
      "fx_control_schema_version_manifest_sha256_length_check",
      sql`octet_length(${table.manifestSha256}) = 32`,
    ),
  ],
);

export const fxControlTables = pgTable(
  "fx_control_table",
  {
    deploymentId: text("deployment_id")
      .notNull()
      .references(() => deployments.deploymentId, { onDelete: "restrict" }),
    tableId: integer("table_id").$type<CatalogTableId>().notNull(),
    namespace: text("namespace").$type<CatalogTableNamespace>().notNull(),
    logicalName: text("logical_name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.deploymentId, table.tableId] }),
    unique("fx_control_table_deployment_namespace_name_unique").on(
      table.deploymentId,
      table.namespace,
      table.logicalName,
    ),
    check(
      "fx_control_table_deployment_id_non_empty_check",
      nonBlankText(table.deploymentId),
    ),
    check(
      "fx_control_table_table_id_positive_check",
      sql`${table.tableId} between 1 and 2147483647`,
    ),
    check(
      "fx_control_table_namespace_check",
      sql`${table.namespace} in ('app', 'payload', 'medusa', 'system')`,
    ),
    check(
      "fx_control_table_logical_name_non_empty_check",
      nonBlankText(table.logicalName),
    ),
  ],
);

export const fxControlIndexes = pgTable(
  "fx_control_index",
  {
    deploymentId: text("deployment_id").notNull(),
    logicalIndexId: integer("logical_index_id")
      .$type<CatalogIndexId>()
      .notNull(),
    tableId: integer("table_id").$type<CatalogTableId>().notNull(),
    descriptor: text("descriptor").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.deploymentId, table.logicalIndexId] }),
    unique("fx_control_index_deployment_table_descriptor_unique").on(
      table.deploymentId,
      table.tableId,
      table.descriptor,
    ),
    unique("fx_control_index_deployment_logical_table_unique").on(
      table.deploymentId,
      table.logicalIndexId,
      table.tableId,
    ),
    foreignKey({
      name: "fx_control_index_deployment_table_fk",
      columns: [table.deploymentId, table.tableId],
      foreignColumns: [fxControlTables.deploymentId, fxControlTables.tableId],
    }).onDelete("restrict"),
    check(
      "fx_control_index_deployment_id_non_empty_check",
      nonBlankText(table.deploymentId),
    ),
    check(
      "fx_control_index_logical_index_id_positive_check",
      sql`${table.logicalIndexId} between 1 and 2147483647`,
    ),
    check(
      "fx_control_index_table_id_positive_check",
      sql`${table.tableId} between 1 and 2147483647`,
    ),
    check(
      "fx_control_index_descriptor_non_empty_check",
      nonBlankText(table.descriptor),
    ),
  ],
);

export const fxControlIndexDefinitions = pgTable(
  "fx_control_index_definition",
  {
    deploymentId: text("deployment_id").notNull(),
    indexDefinitionId: integer("index_definition_id")
      .$type<CatalogIndexDefinitionId>()
      .notNull(),
    accessKind: text("access_kind")
      .$type<AppPhysicalIndexAccessKindV1>()
      .notNull(),
    accessIdentityId: integer("access_identity_id")
      .$type<CatalogIndexId | CatalogTableId>()
      .notNull(),
    tableId: integer("table_id").$type<CatalogTableId>().notNull(),
    logicalIndexId: integer("logical_index_id").$type<CatalogIndexId>(),
    physicalSpecCodecVersion: integer("physical_spec_codec_version")
      .$type<AppIndexPhysicalSpecCodecVersion>()
      .notNull(),
    physicalSpecJson: jsonb("physical_spec_json")
      .$type<AppOrderedIndexPhysicalSpecV1>()
      .notNull(),
    physicalSpecBytes: bytea("physical_spec_bytes").notNull(),
    physicalSpecSha256: bytea("physical_spec_sha256").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({
      name: "fx_control_index_definition_pk",
      columns: [table.deploymentId, table.indexDefinitionId],
    }),
    unique("fx_control_index_definition_owner_spec_unique").on(
      table.deploymentId,
      table.accessKind,
      table.accessIdentityId,
      table.physicalSpecSha256,
    ),
    unique("fx_control_index_definition_binding_owner_unique").on(
      table.deploymentId,
      table.indexDefinitionId,
      table.logicalIndexId,
    ),
    foreignKey({
      name: "fx_control_index_definition_table_fk",
      columns: [table.deploymentId, table.tableId],
      foreignColumns: [fxControlTables.deploymentId, fxControlTables.tableId],
    }).onDelete("restrict"),
    foreignKey({
      name: "fx_control_index_definition_logical_fk",
      columns: [table.deploymentId, table.logicalIndexId, table.tableId],
      foreignColumns: [
        fxControlIndexes.deploymentId,
        fxControlIndexes.logicalIndexId,
        fxControlIndexes.tableId,
      ],
    }).onDelete("restrict"),
    check(
      "fx_control_index_definition_deployment_non_empty_check",
      nonBlankText(table.deploymentId),
    ),
    check(
      "fx_control_index_definition_id_positive_check",
      sql`${table.indexDefinitionId} between 1 and 2147483647`,
    ),
    check(
      "fx_control_index_definition_access_identity_positive_check",
      sql`${table.accessIdentityId} between 1 and 2147483647`,
    ),
    check(
      "fx_control_index_definition_table_id_positive_check",
      sql`${table.tableId} between 1 and 2147483647`,
    ),
    check(
      "fx_control_index_definition_logical_id_positive_check",
      sql`${table.logicalIndexId} is null or ${table.logicalIndexId} between 1 and 2147483647`,
    ),
    check(
      "fx_control_index_definition_owner_check",
      sql`
        (
          ${table.accessKind} = 'developer'
          and ${table.logicalIndexId} is not null
          and ${table.accessIdentityId} = ${table.logicalIndexId}
        )
        or
        (
          ${table.accessKind} = 'by_creation_time'
          and ${table.logicalIndexId} is null
          and ${table.accessIdentityId} = ${table.tableId}
        )
      `,
    ),
    check(
      "fx_control_index_definition_spec_codec_check",
      sql`${table.physicalSpecCodecVersion} = 1`,
    ),
    check(
      "fx_control_index_definition_spec_json_check",
      sql`
        (
          jsonb_typeof(${table.physicalSpecJson}) = 'object'
          and octet_length(${table.physicalSpecJson}::text) between 1 and ${sql.raw(
            String(MAX_CANONICAL_APP_INDEX_PHYSICAL_SPEC_BYTES_V1),
          )}
          and (${table.physicalSpecJson} - 'accessPath' - 'collation'
            - 'keyCodecVersion' - 'kind' - 'maxEncodedKeyBytes'
            - 'orderedFields' - 'specVersion' - 'tieBreaker') = '{}'::jsonb
          and ${table.physicalSpecJson} ->> 'kind' = 'appOrdered'
          and ${table.physicalSpecJson} -> 'specVersion' = '1'::jsonb
          and ${table.physicalSpecJson} ->> 'accessPath' = ${table.accessKind}
          and ${table.physicalSpecJson} -> 'keyCodecVersion' = '1'::jsonb
          and ${table.physicalSpecJson} ->> 'collation' = 'binaryUtf8'
          and ${table.physicalSpecJson} -> 'maxEncodedKeyBytes' = '2048'::jsonb
          and jsonb_typeof(${table.physicalSpecJson} -> 'orderedFields') = 'array'
          and ${table.physicalSpecJson} -> 'tieBreaker'
            = '{"byteLength":16,"kind":"separateRowIdentity"}'::jsonb
        ) is true
      `,
    ),
    check(
      "fx_control_index_definition_spec_bytes_length_check",
      sql`octet_length(${table.physicalSpecBytes}) between 1 and ${sql.raw(
        String(MAX_CANONICAL_APP_INDEX_PHYSICAL_SPEC_BYTES_V1),
      )}`,
    ),
    check(
      "fx_control_index_definition_spec_sha256_length_check",
      sql`octet_length(${table.physicalSpecSha256}) = 32`,
    ),
  ],
);

export const fxControlSchemaVersionIndexBindings = pgTable(
  "fx_control_schema_version_index_binding",
  {
    deploymentId: text("deployment_id").notNull(),
    schemaVersionId: text("schema_version_id")
      .$type<CatalogSchemaVersionId>()
      .notNull(),
    logicalIndexId: integer("logical_index_id")
      .$type<CatalogIndexId>()
      .notNull(),
    indexDefinitionId: integer("index_definition_id")
      .$type<CatalogIndexDefinitionId>()
      .notNull(),
    requiredForActivation: boolean("required_for_activation")
      .$type<true>()
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({
      name: "fx_control_schema_index_binding_pk",
      columns: [
        table.deploymentId,
        table.schemaVersionId,
        table.logicalIndexId,
      ],
    }),
    foreignKey({
      name: "fx_control_schema_index_binding_schema_fk",
      columns: [table.deploymentId, table.schemaVersionId],
      foreignColumns: [
        fxControlSchemaVersions.deploymentId,
        fxControlSchemaVersions.schemaVersionId,
      ],
    }).onDelete("restrict"),
    foreignKey({
      name: "fx_control_schema_index_binding_definition_fk",
      columns: [
        table.deploymentId,
        table.indexDefinitionId,
        table.logicalIndexId,
      ],
      foreignColumns: [
        fxControlIndexDefinitions.deploymentId,
        fxControlIndexDefinitions.indexDefinitionId,
        fxControlIndexDefinitions.logicalIndexId,
      ],
    }).onDelete("restrict"),
    check(
      "fx_control_schema_index_binding_deployment_non_empty_check",
      nonBlankText(table.deploymentId),
    ),
    check(
      "fx_control_schema_index_binding_schema_non_empty_check",
      nonBlankText(table.schemaVersionId),
    ),
    check(
      "fx_control_schema_index_binding_logical_id_positive_check",
      sql`${table.logicalIndexId} between 1 and 2147483647`,
    ),
    check(
      "fx_control_schema_index_binding_definition_id_positive_check",
      sql`${table.indexDefinitionId} between 1 and 2147483647`,
    ),
    check(
      "fx_control_schema_index_binding_required_check",
      sql`${table.requiredForActivation} is true`,
    ),
  ],
);

export const fxControlScopes = pgTable(
  "fx_control_scope",
  {
    scopeId: text("id").$type<ScopeId>().primaryKey(),
    deploymentId: text("deployment_id")
      .notNull()
      .references(() => deployments.deploymentId, { onDelete: "restrict" }),
    activeSchemaVersionId: text("active_schema_version_id"),
    isolationKind: text("isolation_kind").$type<ScopeIsolationKind>().notNull(),
    physicalLocator: jsonb("physical_locator_json").$type<unknown>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("fx_control_scope_deployment_id_unique").on(table.deploymentId),
    unique("fx_control_scope_id_deployment_id_unique").on(
      table.scopeId,
      table.deploymentId,
    ),
    check(
      "fx_control_scope_id_non_empty_check",
      nonBlankText(table.scopeId),
    ),
    check(
      "fx_control_scope_active_schema_version_id_non_empty_check",
      sql`${table.activeSchemaVersionId} is null or ${nonBlankText(table.activeSchemaVersionId)}`,
    ),
    check(
      "fx_control_scope_isolation_kind_check",
      sql`${table.isolationKind} in ('shared_database', 'schema_per_scope', 'database_per_scope')`,
    ),
    check(
      "fx_control_scope_physical_locator_check",
      sql`
        jsonb_typeof(${table.physicalLocator}) = 'object'
        and ${table.physicalLocator} ? 'kind'
        and ${table.physicalLocator} ? 'databaseKey'
        and ${table.physicalLocator} ? 'schemaName'
        and (${table.physicalLocator} - 'kind' - 'databaseKey' - 'schemaName') = '{}'::jsonb
        and jsonb_typeof(${table.physicalLocator} -> 'kind') = 'string'
        and ${table.physicalLocator} ->> 'kind' = ${table.isolationKind}
        and jsonb_typeof(${table.physicalLocator} -> 'databaseKey') = 'string'
        and ${nonBlankText(sql`${table.physicalLocator} ->> 'databaseKey'`)}
        and jsonb_typeof(${table.physicalLocator} -> 'schemaName') = 'string'
        and ${nonBlankText(sql`${table.physicalLocator} ->> 'schemaName'`)}
      `,
    ),
  ],
);

export const fxControlScopeProvisioning = pgTable(
  "fx_control_scope_provisioning",
  {
    scopeId: text("scope_id")
      .$type<ScopeId>()
      .primaryKey()
      .references(() => fxControlScopes.scopeId, { onDelete: "restrict" }),
    protocolVersion: text("protocol_version").notNull(),
    state: text("state").notNull(),
    physicalLocator: jsonb("physical_locator_json").$type<unknown>().notNull(),
    initialEpoch: text("initial_epoch").$type<ScopeEpoch>().notNull(),
    reservedAt: timestamp("reserved_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    readyAt: timestamp("ready_at", { withTimezone: true }),
  },
  (table) => [
    check(
      "fx_control_scope_provisioning_protocol_version_check",
      sql`${table.protocolVersion} = 'split_scope_authority_v1'`,
    ),
    check(
      "fx_control_scope_provisioning_state_check",
      sql`${table.state} in ('reserved', 'ready')`,
    ),
    check(
      "fx_control_scope_provisioning_physical_locator_check",
      sql`
        jsonb_typeof(${table.physicalLocator}) = 'object'
        and ${table.physicalLocator} ? 'kind'
        and ${table.physicalLocator} ? 'databaseKey'
        and ${table.physicalLocator} ? 'schemaName'
        and (${table.physicalLocator} - 'kind' - 'databaseKey' - 'schemaName') = '{}'::jsonb
        and jsonb_typeof(${table.physicalLocator} -> 'kind') = 'string'
        and ${table.physicalLocator} ->> 'kind' in ('schema_per_scope', 'database_per_scope')
        and jsonb_typeof(${table.physicalLocator} -> 'databaseKey') = 'string'
        and ${nonBlankText(sql`${table.physicalLocator} ->> 'databaseKey'`)}
        and jsonb_typeof(${table.physicalLocator} -> 'schemaName') = 'string'
        and ${nonBlankText(sql`${table.physicalLocator} ->> 'schemaName'`)}
      `,
    ),
    check(
      "fx_control_scope_provisioning_initial_epoch_non_empty_check",
      nonBlankText(table.initialEpoch),
    ),
    check(
      "fx_control_scope_provisioning_state_ready_at_check",
      sql`
        (${table.state} = 'reserved' and ${table.readyAt} is null)
        or (${table.state} = 'ready' and ${table.readyAt} is not null)
      `,
    ),
    check(
      "fx_control_scope_provisioning_ready_at_order_check",
      sql`${table.readyAt} is null or ${table.readyAt} >= ${table.reservedAt}`,
    ),
  ],
);

export const fxSystemScopeClocks = pgTable(
  "fx_system_scope_clock",
  {
    scopeId: text("scope_id").$type<ScopeId>().primaryKey(),
    storageGeneration: text("storage_generation")
      .$type<StorageGeneration>()
      .notNull(),
    storageGenerationFence: bigint("storage_generation_fence", {
      mode: "bigint",
    })
      .$type<StorageGenerationFence>()
      .notNull()
      .default(sql`1`),
    lastCommitSeq: bigint("last_commit_seq", { mode: "bigint" })
      .$type<CommitSeq>()
      .notNull()
      .default(sql`0`),
    lastOutboxSeq: bigint("last_outbox_seq", { mode: "bigint" })
      .$type<OutboxSeq>()
      .notNull()
      .default(sql`0`),
    epoch: text("epoch").$type<ScopeEpoch>().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      "fx_system_scope_clock_scope_id_non_empty_check",
      nonBlankText(table.scopeId),
    ),
    check(
      "fx_system_scope_clock_storage_generation_check",
      sql`${table.storageGeneration} in ('legacy_v1', 'flarexdb_v1')`,
    ),
    check(
      "fx_system_scope_clock_storage_generation_fence_positive_check",
      sql`${table.storageGenerationFence} >= 1`,
    ),
    check(
      "fx_system_scope_clock_last_commit_seq_non_negative_check",
      sql`${table.lastCommitSeq} >= 0`,
    ),
    check(
      "fx_system_scope_clock_last_outbox_seq_non_negative_check",
      sql`${table.lastOutboxSeq} >= 0`,
    ),
    check(
      "fx_system_scope_clock_epoch_non_empty_check",
      nonBlankText(table.epoch),
    ),
  ],
);

/**
 * Data-plane lifecycle for one scoped physical index definition.
 *
 * The definition itself remains in the deployment control catalog. This row
 * intentionally has no deployment copy or cross-database definition foreign
 * key because the accepted split topologies locate it beside the scope clock.
 */
export const fxSystemIndexBuildStates = pgTable(
  "fx_system_index_build_state",
  {
    scopeId: text("scope_id")
      .$type<ScopeId>()
      .notNull(),
    indexDefinitionId: integer("index_definition_id")
      .$type<CatalogIndexDefinitionId>()
      .notNull(),
    storageGeneration: text("storage_generation")
      .$type<FlarexDbV1StorageGeneration>()
      .notNull(),
    storageGenerationFence: bigint("storage_generation_fence", {
      mode: "bigint",
    })
      .$type<StorageGenerationFence>()
      .notNull(),
    epoch: text("epoch").$type<ScopeEpoch>().notNull(),
    startCommitSeq: bigint("start_commit_seq", { mode: "bigint" })
      .$type<CommitSeq>()
      .notNull(),
    lifecycle: text("lifecycle").$type<IndexBuildLifecycleV1>().notNull(),
    cursorCodecVersion: integer("cursor_codec_version")
      .$type<IndexBuildCursorCodecVersionV1>()
      .notNull(),
    backfillCursorRowId: bytea("backfill_cursor_row_id"),
    attemptFence: bigint("attempt_fence", { mode: "bigint" })
      .$type<IndexBuildAttemptFence>()
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({
      columns: [table.scopeId, table.indexDefinitionId],
    }),
    foreignKey({
      name: "fx_system_index_build_scope_clock_fk",
      columns: [table.scopeId],
      foreignColumns: [fxSystemScopeClocks.scopeId],
    }).onDelete("restrict"),
    check(
      "fx_system_index_build_scope_non_empty",
      nonBlankText(table.scopeId),
    ),
    check(
      "fx_system_index_build_definition_id_positive",
      sql`${table.indexDefinitionId} between 1 and 2147483647`,
    ),
    check(
      "fx_system_index_build_generation_check",
      sql`${table.storageGeneration} = 'flarexdb_v1'`,
    ),
    check(
      "fx_system_index_build_generation_fence_positive",
      sql`${table.storageGenerationFence} >= 1`,
    ),
    check(
      "fx_system_index_build_epoch_non_empty",
      nonBlankText(table.epoch),
    ),
    check(
      "fx_system_index_build_start_seq_non_negative",
      sql`${table.startCommitSeq} >= 0`,
    ),
    check(
      "fx_system_index_build_lifecycle_check",
      sql`${table.lifecycle} in ('declared', 'building', 'backfilling', 'validating', 'enabled', 'retiring')`,
    ),
    check(
      "fx_system_index_build_cursor_codec_check",
      sql`${table.cursorCodecVersion} = 1`,
    ),
    check(
      "fx_system_index_build_cursor_length_check",
      sql`${table.backfillCursorRowId} is null or octet_length(${table.backfillCursorRowId}) = 16`,
    ),
    check(
      "fx_system_index_build_pre_backfill_cursor_check",
      sql`${table.lifecycle} not in ('declared', 'building') or ${table.backfillCursorRowId} is null`,
    ),
    check(
      "fx_system_index_build_attempt_fence_positive",
      sql`${table.attemptFence} >= 1`,
    ),
    check(
      "fx_system_index_build_timestamp_order_check",
      sql`${table.updatedAt} >= ${table.createdAt}`,
    ),
  ],
);

export const deploymentPackages = pgTable(
  "deployment_packages",
  {
    deploymentId: text("deployment_id").notNull(),
    packageId: text("package_id").notNull(),
    sourcePackageHash: text("source_package_hash").notNull(),
    executionModule: text("execution_module").notNull(),
    sourcePackageJson: jsonb("source_package_json")
      .$type<Record<string, unknown>>()
      .notNull(),
    analysisJson: jsonb("analysis_json").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({
      columns: [table.deploymentId, table.packageId],
    }),
  ],
);

export const documents = pgTable(
  "documents",
  {
    deploymentId: text("deployment_id").notNull(),
    id: bytea("id").notNull(),
    ts: bigint("ts", { mode: "number" }).notNull(),
    tableId: bytea("table_id").notNull(),
    jsonValue: bytea("json_value").notNull(),
    deleted: boolean("deleted").notNull().default(false),
    prevTs: bigint("prev_ts", { mode: "number" }),
  },
  (table) => [
    primaryKey({
      columns: [table.deploymentId, table.ts, table.tableId, table.id],
    }),
    index("documents_by_table_and_id").on(
      table.deploymentId,
      table.tableId,
      table.id,
      table.ts,
    ),
    index("documents_by_table_ts_and_id").on(
      table.deploymentId,
      table.tableId,
      table.ts,
      table.id,
    ),
  ],
);

export const indexes = pgTable(
  "indexes",
  {
    deploymentId: text("deployment_id").notNull(),
    indexId: bytea("index_id").notNull(),
    ts: bigint("ts", { mode: "number" }).notNull(),
    keyPrefix: bytea("key_prefix").notNull(),
    keySuffix: bytea("key_suffix"),
    keySha256: bytea("key_sha256").notNull(),
    deleted: boolean("deleted"),
    tableId: bytea("table_id"),
    documentId: bytea("document_id"),
  },
  (table) => [
    primaryKey({
      columns: [table.deploymentId, table.indexId, table.keySha256, table.ts],
    }),
    index("indexes_by_index_id_key_prefix_key_sha256").on(
      table.deploymentId,
      table.indexId,
      table.keyPrefix,
      table.keySha256,
    ),
    index("indexes_by_index_id_key_prefix_ts").on(
      table.deploymentId,
      table.indexId,
      table.keyPrefix,
      table.ts,
    ),
  ],
);

export const leases = pgTable("leases", {
  deploymentId: text("deployment_id").primaryKey(),
  ts: bigint("ts", { mode: "number" }).notNull(),
});

export const readOnly = pgTable("read_only", {
  deploymentId: text("deployment_id").primaryKey(),
});

export const persistenceGlobals = pgTable(
  "persistence_globals",
  {
    deploymentId: text("deployment_id").notNull(),
    key: text("key").notNull(),
    jsonValue: bytea("json_value").notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.deploymentId, table.key],
    }),
  ],
);

export const commits = pgTable(
  "commits",
  {
    deploymentId: text("deployment_id").notNull(),
    ts: bigint("ts", { mode: "number" }).notNull(),
    source: text("source").notNull(),
    writeSummary: jsonb("write_summary")
      .$type<Record<string, unknown>>()
      .notNull(),
    committedAt: timestamp("committed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({
      columns: [table.deploymentId, table.ts],
    }),
  ],
);

export const outbox = pgTable(
  "outbox",
  {
    deploymentId: text("deployment_id").notNull(),
    ts: bigint("ts", { mode: "number" }).notNull(),
    sequence: bigint("sequence", { mode: "number" }).notNull(),
    event: jsonb("event").$type<Record<string, unknown>>().notNull(),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
  },
  (table) => [
    primaryKey({
      columns: [table.deploymentId, table.ts, table.sequence],
    }),
  ],
);

export const freshnessProcessedEvents = pgTable(
  "freshness_processed_events",
  {
    deploymentId: text("deployment_id").notNull(),
    ts: bigint("ts", { mode: "number" }).notNull(),
    sequence: bigint("sequence", { mode: "number" }).notNull(),
    processedAt: timestamp("processed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({
      columns: [table.deploymentId, table.ts, table.sequence],
    }),
  ],
);

export const documentFreshnessVersions = pgTable(
  "document_freshness_versions",
  {
    deploymentId: text("deployment_id").notNull(),
    documentId: text("document_id").notNull(),
    version: bigint("version", { mode: "number" }).notNull(),
    outboxTs: bigint("outbox_ts", { mode: "number" }).notNull(),
    outboxSequence: bigint("outbox_sequence", { mode: "number" }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({
      columns: [table.deploymentId, table.documentId],
    }),
  ],
);

export const tableFreshnessVersions = pgTable(
  "table_freshness_versions",
  {
    deploymentId: text("deployment_id").notNull(),
    tableId: bigint("table_id", { mode: "number" }).notNull(),
    version: bigint("version", { mode: "number" }).notNull(),
    outboxTs: bigint("outbox_ts", { mode: "number" }).notNull(),
    outboxSequence: bigint("outbox_sequence", { mode: "number" }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({
      columns: [table.deploymentId, table.tableId],
    }),
  ],
);

export const liveQuerySubscriptions = pgTable(
  "live_query_subscriptions",
  {
    deploymentId: text("deployment_id").notNull(),
    connectionId: text("connection_id").notNull(),
    queryId: bigint("query_id", { mode: "number" }).notNull(),
    functionPath: text("function_path").notNull(),
    argsJson: jsonb("args_json").$type<unknown>().notNull(),
    identityJson: jsonb("identity_json")
      .$type<ExecutionIdentity>()
      .notNull()
      .default({ kind: "anonymous" }),
    partitionKey: text("partition_key"),
    beginTs: bigint("begin_ts", { mode: "number" }).notNull(),
    readSetJson: jsonb("read_set_json")
      .$type<Record<string, unknown>>()
      .notNull(),
    resultJson: jsonb("result_json").$type<unknown>().notNull(),
    resultHash: text("result_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({
      columns: [table.deploymentId, table.connectionId, table.queryId],
    }),
    index("live_query_subscriptions_by_deployment_updated").on(
      table.deploymentId,
      table.updatedAt,
      table.connectionId,
      table.queryId,
    ),
    index("live_query_subscriptions_by_connection").on(
      table.deploymentId,
      table.connectionId,
      table.queryId,
    ),
  ],
);

export const liveQueryConnections = pgTable(
  "live_query_connections",
  {
    deploymentId: text("deployment_id").notNull(),
    connectionId: text("connection_id").notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({
      columns: [table.deploymentId, table.connectionId],
    }),
    index("live_query_connections_by_expiry").on(
      table.deploymentId,
      table.expiresAt,
      table.connectionId,
    ),
  ],
);

export const liveQueryDeliveries = pgTable(
  "live_query_deliveries",
  {
    deploymentId: text("deployment_id").notNull(),
    deliveryId: text("delivery_id").notNull(),
    connectionId: text("connection_id").notNull(),
    queryId: bigint("query_id", { mode: "number" }).notNull(),
    payloadJson: jsonb("payload_json").$type<unknown>().notNull(),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    claimExpiresAt: timestamp("claim_expires_at", { withTimezone: true }),
    claimOwner: text("claim_owner"),
    attemptCount: integer("attempt_count").notNull().default(0),
    lastAttemptedAt: timestamp("last_attempted_at", { withTimezone: true }),
    lastErrorStage: text("last_error_stage"),
    lastError: text("last_error"),
    deadLetteredAt: timestamp("dead_lettered_at", { withTimezone: true }),
    deadLetterReason: text("dead_letter_reason"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({
      columns: [table.deploymentId, table.deliveryId],
    }),
    index("live_query_deliveries_by_undelivered").on(
      table.deploymentId,
      table.deliveredAt,
      table.deadLetteredAt,
      table.claimExpiresAt,
      table.createdAt,
      table.deliveryId,
    ),
    index("live_query_deliveries_by_connection").on(
      table.deploymentId,
      table.connectionId,
      table.queryId,
      table.createdAt,
      table.deliveryId,
    ),
  ],
);

export const invokeSessions = pgTable(
  "invoke_sessions",
  {
    deploymentId: text("deployment_id").notNull(),
    sessionId: text("session_id").notNull(),
    projectId: text("project_id").notNull(),
    packageId: text("package_id").notNull(),
    functionPath: text("function_path").notNull(),
    functionKind: text("function_kind").notNull(),
    partitionKey: text("partition_key").notNull(),
    scopeJson: jsonb("scope_json").$type<Record<string, unknown>>().notNull(),
    argsJson: jsonb("args_json").$type<unknown>().notNull(),
    identityJson: jsonb("identity_json")
      .$type<ExecutionIdentity>()
      .notNull()
      .default({ kind: "anonymous" }),
    idempotencyKey: text("idempotency_key"),
    state: text("state").notNull().default("active"),
    beginTs: bigint("begin_ts", { mode: "number" }).notNull(),
    schemaVersion: bigint("schema_version", { mode: "number" }).notNull(),
    executionModule: text("execution_module").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (table) => [
    primaryKey({
      columns: [table.deploymentId, table.sessionId],
    }),
    index("invoke_sessions_by_deployment_state_created").on(
      table.deploymentId,
      table.state,
      table.createdAt,
    ),
    index("invoke_sessions_by_deployment_idempotency_key").on(
      table.deploymentId,
      table.idempotencyKey,
    ),
  ],
);

export const invokeSessionDocumentReads = pgTable(
  "invoke_session_document_reads",
  {
    deploymentId: text("deployment_id").notNull(),
    sessionId: text("session_id").notNull(),
    tableId: bigint("table_id", { mode: "number" }).notNull(),
    documentId: text("document_id").notNull(),
    observedTs: bigint("observed_ts", { mode: "number" }),
    readAt: timestamp("read_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({
      columns: [
        table.deploymentId,
        table.sessionId,
        table.tableId,
        table.documentId,
      ],
    }),
    index("invoke_session_document_reads_by_session").on(
      table.deploymentId,
      table.sessionId,
    ),
  ],
);

export const invokeSessionTableReads = pgTable(
  "invoke_session_table_reads",
  {
    deploymentId: text("deployment_id").notNull(),
    sessionId: text("session_id").notNull(),
    tableId: bigint("table_id", { mode: "number" }).notNull(),
    observedTs: bigint("observed_ts", { mode: "number" }).notNull(),
    readAt: timestamp("read_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({
      columns: [
        table.deploymentId,
        table.sessionId,
        table.tableId,
      ],
    }),
    index("invoke_session_table_reads_by_session").on(
      table.deploymentId,
      table.sessionId,
    ),
  ],
);

export const invokeSessionIndexReads = pgTable(
  "invoke_session_index_reads",
  {
    deploymentId: text("deployment_id").notNull(),
    sessionId: text("session_id").notNull(),
    indexId: bigint("index_id", { mode: "number" }).notNull(),
    lowerKey: text("lower_key").notNull(),
    upperKey: text("upper_key").notNull(),
    observedTs: bigint("observed_ts", { mode: "number" }).notNull(),
    readAt: timestamp("read_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({
      columns: [
        table.deploymentId,
        table.sessionId,
        table.indexId,
        table.lowerKey,
        table.upperKey,
      ],
    }),
    index("invoke_session_index_reads_by_session").on(
      table.deploymentId,
      table.sessionId,
    ),
  ],
);

export const invokeSessionDocumentWrites = pgTable(
  "invoke_session_document_writes",
  {
    deploymentId: text("deployment_id").notNull(),
    sessionId: text("session_id").notNull(),
    tableId: bigint("table_id", { mode: "number" }).notNull(),
    documentId: text("document_id").notNull(),
    op: text("op").notNull(),
    valueJson: jsonb("value_json").$type<unknown>(),
    stagedAt: timestamp("staged_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({
      columns: [
        table.deploymentId,
        table.sessionId,
        table.tableId,
        table.documentId,
      ],
    }),
    index("invoke_session_document_writes_by_session").on(
      table.deploymentId,
      table.sessionId,
    ),
  ],
);

export const flarexSchema = {
  commits,
  deploymentPackages,
  deployments,
  documentFreshnessVersions,
  documents,
  fxControlIndexDefinitions,
  freshnessProcessedEvents,
  fxControlIndexes,
  fxControlSchemaVersionIndexBindings,
  fxControlSchemaVersions,
  fxControlTables,
  fxControlScopeProvisioning,
  fxControlScopes,
  fxSystemIndexBuildStates,
  fxSystemScopeClocks,
  indexes,
  invokeSessionDocumentReads,
  invokeSessionTableReads,
  invokeSessionIndexReads,
  invokeSessionDocumentWrites,
  invokeSessions,
  leases,
  liveQueryConnections,
  liveQueryDeliveries,
  liveQuerySubscriptions,
  outbox,
  persistenceGlobals,
  readOnly,
  tableFreshnessVersions,
};

function nonBlankText(value: SQLWrapper) {
  return sql`btrim(${value}, U&' \\0009\\000a\\000b\\000c\\000d\\00a0\\1680\\2000\\2001\\2002\\2003\\2004\\2005\\2006\\2007\\2008\\2009\\200a\\2028\\2029\\202f\\205f\\3000\\feff') <> ''`;
}
