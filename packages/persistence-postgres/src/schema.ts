import { sql, type SQLWrapper } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  customType,
  doublePrecision,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import type { AppCreationTimeV1 } from "flarex-protocol/app-document";
import type { ExecutionIdentity } from "flarex-protocol/auth";
import {
  MAX_COMMIT_CANONICAL_EVIDENCE_BYTES_V1,
  CommitMaterialWriteEventEvidenceBytesV1Schema,
  MAX_COMMIT_MATERIAL_WRITE_EVENT_EVIDENCE_BYTES_V1,
  MAX_COMMIT_POINT_READ_DEPENDENCIES_V1,
  MAX_COMMIT_READ_DOCUMENTS_V1,
  MAX_COMMIT_READ_SEMANTIC_BYTES_V1,
  MAX_COMMIT_RESULT_SEMANTIC_BYTES_V1,
  MAX_COMMIT_WRITE_OPERATIONS_V1,
  MAX_COMMIT_WRITE_SEMANTIC_BYTES_V1,
  type CommitFinalSyscallSequenceV1,
  type CommitMaterialWriteEventEvidenceBytesV1,
  type CommitProtocolV1LimitDimension,
  type CommitSyscallSequenceV1,
  type LogicalAppWriteV1,
} from "flarex-protocol/commit-protocol";
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
import type { Json, JsonObject } from "flarex-protocol/json";
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
  ScopeEpochUuidV1,
  ScopeId,
  ScopeUuidV1,
  StorageGeneration,
  StorageGenerationFence,
} from "flarex-protocol/storage-authority";
import type {
  CanonicalTransactionArgumentsBytesV1,
  CanonicalTransactionAuthorizationGrantBytesV1,
  TransactionArgumentsSha256V1,
  TransactionArtifactIdV1,
  TransactionArtifactRuntimeV1,
  TransactionAttemptFence,
  TransactionAuthorizationGrantIdV1,
  TransactionAuthorizationGrantSha256V1,
  TransactionAuthorizationRevocationEpoch,
  TransactionExecutionModuleV1,
  TransactionFunctionKindV1,
  TransactionFunctionPathV1,
  TransactionIdentityAccessPolicySha256V1,
  TransactionPackageIdV1,
  TransactionPolicyVersionV1,
  TransactionRequestKeyV1,
  TransactionRequestSha256V1,
  TransactionSessionIdV1,
  TransactionSessionLifecycleV1,
  TransactionSessionProtocolVersionV1,
  TransactionSourcePackageSha256HexV1,
} from "flarex-protocol/transaction-session";
import { MAX_TRANSACTION_REQUEST_KEY_UTF8_BYTES_V1 } from "flarex-protocol/transaction-session";
import type {
  CanonicalFlarexValueBytesV1,
  FlarexValueCodecVersion,
  FlarexValueSha256V1,
} from "flarex-protocol/value";
import { MAX_FLAREX_APP_DOCUMENT_SEMANTIC_BYTES_V1 } from "flarex-protocol/value";

import type { ScopeIsolationKind } from "./scopeMetadataTypes";

type TransactionJournalOperationalLimitDimensionV1 = Extract<
  CommitProtocolV1LimitDimension,
  | "readDocuments"
  | "readSemanticBytes"
  | "pointReadDependencies"
  | "writeOperations"
  | "writeSemanticBytes"
  | "materialWriteEventEvidenceBytes"
>;

type TransactionJournalOperationKindV1 =
  | "get"
  | "insert"
  | "patch"
  | "replace"
  | "delete";

type TransactionJournalOutcomeKindV1 =
  | "missing"
  | "present"
  | "inserted"
  | "unit"
  | "error";

type TransactionJournalDependencyKindV1 =
  | "present"
  | "missing_no_visible_revision"
  | "missing_tombstone";

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
    scopeUuid: uuid("scope_uuid")
      .$type<ScopeUuidV1>()
      .generatedAlwaysAs(sql`
        case
          when "scope_id" ~ '^scope_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          then substring("scope_id" from 7)::uuid
          else null
        end
      `),
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
    oldestAvailableCommitSeq: bigint("oldest_available_commit_seq", {
      mode: "bigint",
    })
      .$type<CommitSeq>()
      .notNull()
      .default(sql`0`),
    lastOutboxSeq: bigint("last_outbox_seq", { mode: "bigint" })
      .$type<OutboxSeq>()
      .notNull()
      .default(sql`0`),
    authorizationRevocationEpoch: bigint("authorization_revocation_epoch", {
      mode: "bigint",
    })
      .$type<TransactionAuthorizationRevocationEpoch>()
      .notNull()
      .default(sql`0`),
    epoch: text("epoch").$type<ScopeEpoch>().notNull(),
    epochUuid: uuid("epoch_uuid")
      .$type<ScopeEpochUuidV1>()
      .generatedAlwaysAs(sql`
        case
          when "epoch" ~ '^epoch_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          then substring("epoch" from 7)::uuid
          else null
        end
      `),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("fx_system_scope_clock_scope_uuid_unique").on(table.scopeUuid),
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
      "fx_system_scope_clock_oldest_available_commit_seq_check",
      sql`${table.oldestAvailableCommitSeq} >= 0 and ${table.oldestAvailableCommitSeq} <= ${table.lastCommitSeq}`,
    ),
    check(
      "fx_system_scope_clock_last_outbox_seq_non_negative_check",
      sql`${table.lastOutboxSeq} >= 0`,
    ),
    check(
      "fx_system_scope_clock_authorization_revocation_epoch_non_negative_check",
      sql`${table.authorizationRevocationEpoch} >= 0`,
    ),
    check(
      "fx_system_scope_clock_epoch_non_empty_check",
      nonBlankText(table.epoch),
    ),
  ],
);

/**
 * Scope-local commit headers for the authoritative replacement app-row feed.
 * The sequence, rather than committed_at, defines feed order.
 */
export const fxSystemCommits = pgTable(
  "fx_system_commit",
  {
    scopeUuid: uuid("scope_uuid").$type<ScopeUuidV1>().notNull(),
    epochUuid: uuid("epoch_uuid").$type<ScopeEpochUuidV1>().notNull(),
    commitSeq: bigint("commit_seq", { mode: "bigint" })
      .$type<CommitSeq>()
      .notNull(),
    changeCount: integer("change_count").notNull(),
    committedAt: timestamp("committed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.scopeUuid, table.commitSeq] }),
    unique("fx_system_commit_scope_epoch_seq_unique").on(
      table.scopeUuid,
      table.epochUuid,
      table.commitSeq,
    ),
    foreignKey({
      name: "fx_system_commit_scope_clock_fk",
      columns: [table.scopeUuid],
      foreignColumns: [fxSystemScopeClocks.scopeUuid],
    })
      .onUpdate("restrict")
      .onDelete("restrict"),
    check(
      "fx_system_commit_seq_positive_check",
      sql`${table.commitSeq} >= 1`,
    ),
    check(
      "fx_system_commit_change_count_check",
      sql`${table.changeCount} between 0 and 16000`,
    ),
    check(
      "fx_system_commit_committed_at_finite_check",
      sql`isfinite(${table.committedAt})`,
    ),
  ],
);

/**
 * Located request-level authority for one replacement point-mutation session.
 * O03-B, not this schema gate, owns creation and fenced lifecycle operations.
 */
export const fxSystemTransactionSessions = pgTable(
  "fx_system_tx_session",
  {
    scopeUuid: uuid("scope_uuid").$type<ScopeUuidV1>().notNull(),
    sessionId: uuid("session_id").$type<TransactionSessionIdV1>().notNull(),
    storageGeneration: text("storage_generation")
      .$type<FlarexDbV1StorageGeneration>()
      .notNull(),
    storageGenerationFence: bigint("storage_generation_fence", {
      mode: "bigint",
    })
      .$type<StorageGenerationFence>()
      .notNull(),
    packageId: text("package_id").$type<TransactionPackageIdV1>().notNull(),
    artifactRuntime: text("artifact_runtime")
      .$type<TransactionArtifactRuntimeV1>()
      .notNull(),
    artifactId: text("artifact_id")
      .$type<TransactionArtifactIdV1>()
      .notNull(),
    sourcePackageHash: text("source_package_hash")
      .$type<TransactionSourcePackageSha256HexV1>()
      .notNull(),
    executionModule: text("execution_module")
      .$type<TransactionExecutionModuleV1>()
      .notNull(),
    functionPath: text("function_path")
      .$type<TransactionFunctionPathV1>()
      .notNull(),
    functionKind: text("function_kind")
      .$type<TransactionFunctionKindV1>()
      .notNull(),
    schemaVersionId: text("schema_version_id")
      .$type<CatalogSchemaVersionId>()
      .notNull(),
    policyVersion: text("policy_version")
      .$type<TransactionPolicyVersionV1>()
      .notNull(),
    identityAccessPolicySha256: bytea("identity_access_policy_sha256")
      .$type<TransactionIdentityAccessPolicySha256V1>()
      .notNull(),
    validatedArgsJson: jsonb("validated_args_json")
      .$type<JsonObject>()
      .notNull(),
    validatedArgsValueCodecVersion: integer(
      "validated_args_value_codec_version",
    )
      .$type<FlarexValueCodecVersion>()
      .notNull(),
    validatedArgsCanonicalBytes: bytea("validated_args_canonical_bytes")
      .$type<CanonicalTransactionArgumentsBytesV1>()
      .notNull(),
    validatedArgsSha256: bytea("validated_args_sha256")
      .$type<TransactionArgumentsSha256V1>()
      .notNull(),
    authorizationGrantId: text("authorization_grant_id")
      .$type<TransactionAuthorizationGrantIdV1>()
      .notNull(),
    authorizationGrantJson: jsonb("authorization_grant_json")
      .$type<JsonObject>()
      .notNull(),
    authorizationGrantValueCodecVersion: integer(
      "authorization_grant_value_codec_version",
    )
      .$type<FlarexValueCodecVersion>()
      .notNull(),
    authorizationGrantCanonicalBytes: bytea(
      "authorization_grant_canonical_bytes",
    )
      .$type<CanonicalTransactionAuthorizationGrantBytesV1>()
      .notNull(),
    authorizationGrantSha256: bytea("authorization_grant_sha256")
      .$type<TransactionAuthorizationGrantSha256V1>()
      .notNull(),
    authorizationRevocationEpoch: bigint("authorization_revocation_epoch", {
      mode: "bigint",
    })
      .$type<TransactionAuthorizationRevocationEpoch>()
      .notNull(),
    authorizationGrantExpiresAt: timestamp(
      "authorization_grant_expires_at",
      { withTimezone: true },
    ).notNull(),
    requestKey: text("request_key")
      .$type<TransactionRequestKeyV1>()
      .notNull(),
    requestSha256: bytea("request_sha256")
      .$type<TransactionRequestSha256V1>()
      .notNull(),
    lifecycle: text("lifecycle")
      .$type<TransactionSessionLifecycleV1>()
      .notNull(),
    attemptFence: bigint("attempt_fence", { mode: "bigint" })
      .$type<TransactionAttemptFence>()
      .notNull(),
    protocolVersion: integer("protocol_version")
      .$type<TransactionSessionProtocolVersionV1>()
      .notNull(),
    hardExpiresAt: timestamp("hard_expires_at", {
      withTimezone: true,
    }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.scopeUuid, table.sessionId] }),
    unique("fx_system_tx_session_current_attempt_unique").on(
      table.scopeUuid,
      table.sessionId,
      table.attemptFence,
    ),
    foreignKey({
      name: "fx_system_tx_session_scope_clock_fk",
      columns: [table.scopeUuid],
      foreignColumns: [fxSystemScopeClocks.scopeUuid],
    })
      .onUpdate("restrict")
      .onDelete("restrict"),
    index("fx_system_tx_session_request_lookup_idx").on(
      table.scopeUuid,
      table.requestKey,
    ),
    index("fx_system_tx_session_expiry_idx").on(table.hardExpiresAt),
    check(
      "fx_system_tx_session_generation_check",
      sql`${table.storageGeneration} = 'flarexdb_v1'`,
    ),
    check(
      "fx_system_tx_session_generation_fence_check",
      sql`${table.storageGenerationFence} >= 1`,
    ),
    check(
      "fx_system_tx_session_package_id_check",
      nonBlankText(table.packageId),
    ),
    check(
      "fx_system_tx_session_artifact_runtime_check",
      sql`${table.artifactRuntime} = 'dynamic-worker'`,
    ),
    check(
      "fx_system_tx_session_artifact_id_check",
      sql`${table.artifactId} ~ '^artifact_[0-9a-f]{32}$'`,
    ),
    check(
      "fx_system_tx_session_source_hash_check",
      sql`${table.sourcePackageHash} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "fx_system_tx_session_artifact_source_pair_check",
      sql`${table.artifactId} = 'artifact_' || left(${table.sourcePackageHash}, 32)`,
    ),
    check(
      "fx_system_tx_session_execution_module_check",
      nonBlankText(table.executionModule),
    ),
    check(
      "fx_system_tx_session_function_path_check",
      nonBlankText(table.functionPath),
    ),
    check(
      "fx_system_tx_session_function_kind_check",
      sql`${table.functionKind} = 'mutation'`,
    ),
    check(
      "fx_system_tx_session_schema_version_check",
      nonBlankText(table.schemaVersionId),
    ),
    check(
      "fx_system_tx_session_policy_version_check",
      nonBlankText(table.policyVersion),
    ),
    check(
      "fx_system_tx_session_identity_hash_check",
      sql`octet_length(${table.identityAccessPolicySha256}) = 32`,
    ),
    check(
      "fx_system_tx_session_args_evidence_check",
      sql`
        jsonb_typeof(${table.validatedArgsJson}) = 'object'
        and ${table.validatedArgsValueCodecVersion} = 1
        and octet_length(${table.validatedArgsCanonicalBytes}) > 0
        and octet_length(${table.validatedArgsSha256}) = 32
      `,
    ),
    check(
      "fx_system_tx_session_grant_id_check",
      nonBlankText(table.authorizationGrantId),
    ),
    check(
      "fx_system_tx_session_grant_evidence_check",
      sql`
        jsonb_typeof(${table.authorizationGrantJson}) = 'object'
        and ${table.authorizationGrantValueCodecVersion} = 1
        and octet_length(${table.authorizationGrantCanonicalBytes}) > 0
        and octet_length(${table.authorizationGrantSha256}) = 32
      `,
    ),
    check(
      "fx_system_tx_session_revocation_epoch_check",
      sql`${table.authorizationRevocationEpoch} >= 0`,
    ),
    check(
      "fx_system_tx_session_request_key_check",
      sql`
        ${nonBlankText(table.requestKey)}
        and octet_length(${table.requestKey}) <= ${sql.raw(
          String(MAX_TRANSACTION_REQUEST_KEY_UTF8_BYTES_V1),
        )}
      `,
    ),
    check(
      "fx_system_tx_session_request_hash_check",
      sql`octet_length(${table.requestSha256}) = 32`,
    ),
    check(
      "fx_system_tx_session_lifecycle_check",
      sql`${table.lifecycle} in ('created', 'running', 'finishing', 'committing', 'retrying', 'committed', 'aborted', 'expired')`,
    ),
    check(
      "fx_system_tx_session_attempt_fence_check",
      sql`${table.attemptFence} >= 1`,
    ),
    check(
      "fx_system_tx_session_protocol_version_check",
      sql`${table.protocolVersion} = 1`,
    ),
    check(
      "fx_system_tx_session_expiry_check",
      sql`
        isfinite(${table.authorizationGrantExpiresAt})
        and isfinite(${table.hardExpiresAt})
        and ${table.authorizationGrantExpiresAt} > ${table.createdAt}
        and ${table.hardExpiresAt} > ${table.createdAt}
        and ${table.hardExpiresAt} <= ${table.authorizationGrantExpiresAt}
      `,
    ),
    check(
      "fx_system_tx_session_timestamp_order_check",
      sql`
        isfinite(${table.createdAt})
        and isfinite(${table.updatedAt})
        and ${table.updatedAt} >= ${table.createdAt}
      `,
    ),
  ],
);

/** One retention pin for the exact current attempt of one session. */
export const fxSystemSnapshotLeases = pgTable(
  "fx_system_snapshot_lease",
  {
    scopeUuid: uuid("scope_uuid").$type<ScopeUuidV1>().notNull(),
    sessionId: uuid("session_id").$type<TransactionSessionIdV1>().notNull(),
    attemptFence: bigint("attempt_fence", { mode: "bigint" })
      .$type<TransactionAttemptFence>()
      .notNull(),
    snapshotEpochUuid: uuid("snapshot_epoch_uuid")
      .$type<ScopeEpochUuidV1>()
      .notNull(),
    snapshotCommitSeq: bigint("snapshot_commit_seq", { mode: "bigint" })
      .$type<CommitSeq>()
      .notNull(),
    leaseExpiresAt: timestamp("lease_expires_at", {
      withTimezone: true,
    }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.scopeUuid, table.sessionId] }),
    foreignKey({
      name: "fx_system_snapshot_lease_current_attempt_fk",
      columns: [table.scopeUuid, table.sessionId, table.attemptFence],
      foreignColumns: [
        fxSystemTransactionSessions.scopeUuid,
        fxSystemTransactionSessions.sessionId,
        fxSystemTransactionSessions.attemptFence,
      ],
    })
      .onUpdate("restrict")
      .onDelete("restrict"),
    index("fx_system_snapshot_lease_floor_idx").on(
      table.scopeUuid,
      table.snapshotEpochUuid,
      table.snapshotCommitSeq,
      table.leaseExpiresAt,
    ),
    index("fx_system_snapshot_lease_expiry_idx").on(table.leaseExpiresAt),
    check(
      "fx_system_snapshot_lease_attempt_fence_check",
      sql`${table.attemptFence} >= 1`,
    ),
    check(
      "fx_system_snapshot_lease_commit_seq_check",
      sql`${table.snapshotCommitSeq} >= 0`,
    ),
    check(
      "fx_system_snapshot_lease_expiry_check",
      sql`isfinite(${table.leaseExpiresAt})`,
    ),
  ],
);

/** Bounded, temporary, exact-attempt logical journal authority. */
export const fxSystemTransactionJournals = pgTable(
  "fx_system_tx_journal",
  {
    scopeUuid: uuid("scope_uuid").$type<ScopeUuidV1>().notNull(),
    sessionId: uuid("session_id").$type<TransactionSessionIdV1>().notNull(),
    attemptFence: bigint("attempt_fence", { mode: "bigint" })
      .$type<TransactionAttemptFence>()
      .notNull(),
    state: text("state").$type<"open" | "sealed" | "failed">().notNull(),
    lastSyscallSequence: bigint("last_syscall_sequence", { mode: "bigint" })
      .$type<CommitFinalSyscallSequenceV1>()
      .notNull()
      .default(sql`0`),
    creationTimeSeed: doublePrecision("creation_time_seed")
      .$type<AppCreationTimeV1>()
      .notNull(),
    nextCreationTime: doublePrecision("next_creation_time")
      .$type<AppCreationTimeV1>()
      .notNull(),
    readDocuments: integer("read_documents").notNull().default(0),
    readSemanticBytes: integer("read_semantic_bytes").notNull().default(0),
    pointDependencyCount: integer("point_dependency_count").notNull().default(0),
    writeOperations: integer("write_operations").notNull().default(0),
    writeSemanticBytes: integer("write_semantic_bytes").notNull().default(0),
    materialWriteEventEvidenceBytes: integer(
      "material_write_event_evidence_bytes",
    ).$type<CommitMaterialWriteEventEvidenceBytesV1>().notNull().default(
      CommitMaterialWriteEventEvidenceBytesV1Schema.make(0),
    ),
    failureDimension: text("failure_dimension")
      .$type<TransactionJournalOperationalLimitDimensionV1>(),
    sealedFinalSyscallSequence: bigint("sealed_final_syscall_sequence", {
      mode: "bigint",
    }).$type<CommitFinalSyscallSequenceV1>(),
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
    check(
      "fx_system_tx_journal_state_check",
      sql`${table.state} in ('open', 'sealed', 'failed')`,
    ),
    check(
      "fx_system_tx_journal_sequence_check",
      sql`${table.lastSyscallSequence} >= 0`,
    ),
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
            'writeOperations',
            'writeSemanticBytes',
            'materialWriteEventEvidenceBytes'
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
          and ${table.sealedFinalSyscallSequence} is null
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
          and ${table.sealedFinalSyscallSequence} is null
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
          and ${table.sealedFinalSyscallSequence} is not null
          and ${table.sealedFinalSyscallSequence} = ${table.lastSyscallSequence}
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

/** Constant-cardinality durable replay receipt for one exact attempt. */
export const fxSystemTransactionJournalLatestReceipts = pgTable(
  "fx_system_tx_journal_latest_receipt",
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
      .$type<1>()
      .notNull(),
    requestBytes: bytea("request_bytes").notNull(),
    requestSha256: bytea("request_sha256").notNull(),
    outcomeKind: text("outcome_kind")
      .$type<TransactionJournalOutcomeKindV1>()
      .notNull(),
    outcomeCodecVersion: integer("outcome_codec_version")
      .$type<1>()
      .notNull(),
    outcomeBytes: bytea("outcome_bytes").notNull(),
    outcomeSha256: bytea("outcome_sha256").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    primaryKey({
      name: "fx_system_tx_journal_receipt_pk",
      columns: [table.scopeUuid, table.sessionId, table.attemptFence],
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
      sql`${table.operationKind} in ('get', 'insert', 'patch', 'replace', 'delete')`,
    ),
    check(
      "fx_system_tx_journal_receipt_request_check",
      sql`
        ${table.requestCodecVersion} = 1
        and octet_length(${table.requestBytes}) between 1 and ${sql.raw(String(MAX_COMMIT_CANONICAL_EVIDENCE_BYTES_V1))}
        and octet_length(${table.requestSha256}) = 32
      `,
    ),
    check(
      "fx_system_tx_journal_receipt_outcome_check",
      sql`
        ${table.outcomeKind} in ('missing', 'present', 'inserted', 'unit', 'error')
        and ${table.outcomeCodecVersion} = 1
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

/** One immutable OCC dependency plus deterministic same-row overlay. */
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
      sql`
        (
          ${table.dependencyKind} = 'present'
          and ${table.dependencyRevisionCommitSeq} is not null
          and ${table.dependencyRevisionCommitSeq} >= 1
        )
        or (
          ${table.dependencyKind} = 'missing_no_visible_revision'
          and ${table.dependencyRevisionCommitSeq} is null
        )
        or (
          ${table.dependencyKind} = 'missing_tombstone'
          and ${table.dependencyRevisionCommitSeq} is not null
          and ${table.dependencyRevisionCommitSeq} >= 1
        )
      `,
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
    writeKind: text("write_kind")
      .$type<LogicalAppWriteV1["kind"]>()
      .notNull(),
    eventCodecVersion: integer("event_codec_version").$type<1>().notNull(),
    eventJson: jsonb("event_json").$type<JsonObject>().notNull(),
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
      sql`${table.attemptFence} >= 1 and ${table.syscallSequence} >= 1`,
    ),
    check(
      "fx_system_tx_journal_event_payload_check",
      sql`
        ${table.writeKind} in ('insert', 'patch', 'replace', 'delete')
        and ${table.eventCodecVersion} = 1
        and jsonb_typeof(${table.eventJson}) = 'object'
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

/**
 * Authoritative replacement app-row history. The current table below stores
 * only an exact pointer into this history and never duplicates value evidence.
 */
export const fxAppRowRevisions = pgTable(
  "fx_app_row_rev",
  {
    scopeUuid: uuid("scope_uuid").$type<ScopeUuidV1>().notNull(),
    tableId: integer("table_id").$type<CatalogTableId>().notNull(),
    rowId: bytea("row_id").notNull(),
    commitSeq: bigint("commit_seq", { mode: "bigint" })
      .$type<CommitSeq>()
      .notNull(),
    prevCommitSeq: bigint("prev_commit_seq", { mode: "bigint" }).$type<
      CommitSeq
    >(),
    writeEpochUuid: uuid("write_epoch_uuid")
      .$type<ScopeEpochUuidV1>()
      .notNull(),
    schemaVersionId: text("schema_version_id")
      .$type<CatalogSchemaVersionId>()
      .notNull(),
    creationTime: doublePrecision("creation_time")
      .$type<AppCreationTimeV1>()
      .notNull(),
    valueCodecVersion: integer("value_codec_version")
      .$type<FlarexValueCodecVersion>()
      .notNull(),
    isTombstone: boolean("is_tombstone").notNull(),
    valueJson: jsonb("value_json").$type<Json>(),
    valueBytes: bytea("value_bytes").$type<CanonicalFlarexValueBytesV1>(),
    valueSha256: bytea("value_sha256").$type<FlarexValueSha256V1>(),
  },
  (table) => [
    primaryKey({
      columns: [table.scopeUuid, table.tableId, table.rowId, table.commitSeq],
    }),
    unique("fx_app_row_rev_change_provenance_unique").on(
      table.scopeUuid,
      table.tableId,
      table.rowId,
      table.writeEpochUuid,
      table.commitSeq,
    ),
    foreignKey({
      name: "fx_app_row_rev_scope_clock_fk",
      columns: [table.scopeUuid],
      foreignColumns: [fxSystemScopeClocks.scopeUuid],
    }).onDelete("restrict"),
    check(
      "fx_app_row_rev_table_id_positive_check",
      sql`${table.tableId} between 1 and 2147483647`,
    ),
    check(
      "fx_app_row_rev_row_id_length_check",
      sql`octet_length(${table.rowId}) = 16`,
    ),
    check(
      "fx_app_row_rev_commit_seq_positive_check",
      sql`${table.commitSeq} >= 1`,
    ),
    check(
      "fx_app_row_rev_prev_commit_seq_check",
      sql`${table.prevCommitSeq} is null or (${table.prevCommitSeq} >= 1 and ${table.prevCommitSeq} < ${table.commitSeq})`,
    ),
    check(
      "fx_app_row_rev_schema_version_id_non_empty_check",
      nonBlankText(table.schemaVersionId),
    ),
    check(
      "fx_app_row_rev_creation_time_check",
      sql`${table.creationTime} > 0 and ${table.creationTime} < 9007199254740992`,
    ),
    check(
      "fx_app_row_rev_value_codec_version_check",
      sql`${table.valueCodecVersion} = 1`,
    ),
    check(
      "fx_app_row_rev_value_state_check",
      sql`
        (
          ${table.isTombstone}
          and ${table.valueJson} is null
          and ${table.valueBytes} is null
          and ${table.valueSha256} is null
        )
        or
        (
          not ${table.isTombstone}
          and ${table.valueJson} is not null
          and jsonb_typeof(${table.valueJson}) = 'object'
          and ${table.valueBytes} is not null
          and octet_length(${table.valueBytes}) > 0
          and ${table.valueSha256} is not null
          and octet_length(${table.valueSha256}) = 32
        )
      `,
    ),
  ],
);

/**
 * Typed app-row changes for one committed feed header. Each child is bound to
 * both its exact header epoch and the same-epoch authoritative row revision.
 */
export const fxSystemCommitAppRowChanges = pgTable(
  "fx_system_commit_app_row_change",
  {
    scopeUuid: uuid("scope_uuid").$type<ScopeUuidV1>().notNull(),
    epochUuid: uuid("epoch_uuid").$type<ScopeEpochUuidV1>().notNull(),
    commitSeq: bigint("commit_seq", { mode: "bigint" })
      .$type<CommitSeq>()
      .notNull(),
    changeOrdinal: integer("change_ordinal").notNull(),
    tableId: integer("table_id").$type<CatalogTableId>().notNull(),
    rowId: bytea("row_id").notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.scopeUuid, table.commitSeq, table.changeOrdinal],
    }),
    unique("fx_system_commit_app_row_change_row_unique").on(
      table.scopeUuid,
      table.commitSeq,
      table.tableId,
      table.rowId,
    ),
    foreignKey({
      name: "fx_system_commit_app_row_change_header_fk",
      columns: [table.scopeUuid, table.epochUuid, table.commitSeq],
      foreignColumns: [
        fxSystemCommits.scopeUuid,
        fxSystemCommits.epochUuid,
        fxSystemCommits.commitSeq,
      ],
    })
      .onUpdate("restrict")
      .onDelete("restrict"),
    foreignKey({
      name: "fx_system_commit_app_row_change_revision_fk",
      columns: [
        table.scopeUuid,
        table.tableId,
        table.rowId,
        table.epochUuid,
        table.commitSeq,
      ],
      foreignColumns: [
        fxAppRowRevisions.scopeUuid,
        fxAppRowRevisions.tableId,
        fxAppRowRevisions.rowId,
        fxAppRowRevisions.writeEpochUuid,
        fxAppRowRevisions.commitSeq,
      ],
    })
      .onUpdate("restrict")
      .onDelete("restrict"),
    check(
      "fx_system_commit_app_row_change_ordinal_check",
      sql`${table.changeOrdinal} between 0 and 15999`,
    ),
    check(
      "fx_system_commit_app_row_change_table_id_check",
      sql`${table.tableId} between 1 and 2147483647`,
    ),
    check(
      "fx_system_commit_app_row_change_row_id_length_check",
      sql`octet_length(${table.rowId}) = 16`,
    ),
  ],
);

/** Epoch-independent latest pointer into authoritative app-row history. */
export const fxAppRowCurrent = pgTable(
  "fx_app_row_current",
  {
    scopeUuid: uuid("scope_uuid").$type<ScopeUuidV1>().notNull(),
    tableId: integer("table_id").$type<CatalogTableId>().notNull(),
    rowId: bytea("row_id").notNull(),
    commitSeq: bigint("commit_seq", { mode: "bigint" })
      .$type<CommitSeq>()
      .notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.scopeUuid, table.tableId, table.rowId] }),
    foreignKey({
      name: "fx_app_row_current_revision_fk",
      columns: [table.scopeUuid, table.tableId, table.rowId, table.commitSeq],
      foreignColumns: [
        fxAppRowRevisions.scopeUuid,
        fxAppRowRevisions.tableId,
        fxAppRowRevisions.rowId,
        fxAppRowRevisions.commitSeq,
      ],
    }).onDelete("restrict"),
    check(
      "fx_app_row_current_table_id_positive_check",
      sql`${table.tableId} between 1 and 2147483647`,
    ),
    check(
      "fx_app_row_current_row_id_length_check",
      sql`octet_length(${table.rowId}) = 16`,
    ),
    check(
      "fx_app_row_current_commit_seq_positive_check",
      sql`${table.commitSeq} >= 1`,
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
  fxAppRowCurrent,
  fxAppRowRevisions,
  fxControlIndexDefinitions,
  freshnessProcessedEvents,
  fxControlIndexes,
  fxControlSchemaVersionIndexBindings,
  fxControlSchemaVersions,
  fxControlTables,
  fxControlScopeProvisioning,
  fxControlScopes,
  fxSystemIndexBuildStates,
  fxSystemSnapshotLeases,
  fxSystemScopeClocks,
  fxSystemTransactionJournalLatestReceipts,
  fxSystemTransactionJournalPoints,
  fxSystemTransactionJournals,
  fxSystemTransactionJournalWriteEvents,
  fxSystemTransactionSessions,
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
