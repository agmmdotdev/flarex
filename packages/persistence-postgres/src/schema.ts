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
  type CanonicalSuccessfulResultBytesV1,
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
import type {
  DeclarativeV2ActivationRevisionFrameV1,
  DeclarativeV2AttemptLifecycleV1,
  DeclarativeV2CommandKindV1,
  DeclarativeV2FrontierEntryFrameV1,
  DeclarativeV2LinkNodeFrameV1,
  DeclarativeV2PageManifestFrameV1,
  DeclarativeV2VerdictFrameV1,
} from "flarex-protocol/internal/declarative-v2-physical-v1";
import type {
  DeclarativeV2VerifierDurableCommandKindV2,
  DeclarativeV2VerifierRestartCommandKindV2,
} from "flarex-protocol/internal/declarative-v2-verifier-progress-v2";
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
import type {
  TransactionExecutionClaimFenceV1,
  TransactionExecutionClaimOwnerV1,
} from "./transactionExecutionClaimModel";
import {
  MAX_POINT_MUTATION_REDELIVERY_SCHEDULER_CONTINUATION_BYTES_V1,
  POINT_MUTATION_REDELIVERY_SCHEDULER_CONTINUATION_CODEC_V1,
  POINT_MUTATION_REDELIVERY_SCHEDULER_KEY_V1,
} from "./pointMutationRedeliverySchedulerModel";

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

type IdempotencyResultState = "available" | "expired";

export type CommitWakeOutboxEventKindV1 =
  "deployment_sync_commit_wake_v1";

export type CommitWakeOutboxDeliveryStateV1 =
  | "pending"
  | "claimed"
  | "delivered"
  | "dead_lettered";

export type CommitWakeOutboxFailureCodeV1 =
  | "transient_delivery"
  | "claim_lease_expired"
  | "terminal_delivery"
  | "attempts_exhausted";

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
 * Scope-lifetime committed-success request outcomes. The commit token is an
 * immutable receipt, not a foreign-key pointer to compactable feed history.
 */
export const fxSystemIdempotency = pgTable(
  "fx_system_idempotency",
  {
    scopeUuid: uuid("scope_uuid").$type<ScopeUuidV1>().notNull(),
    requestKey: text("request_key")
      .$type<TransactionRequestKeyV1>()
      .notNull(),
    identityAccessPolicySha256: bytea("identity_access_policy_sha256")
      .$type<TransactionIdentityAccessPolicySha256V1>()
      .notNull(),
    functionPath: text("function_path")
      .$type<TransactionFunctionPathV1>()
      .notNull(),
    requestSha256: bytea("request_sha256")
      .$type<TransactionRequestSha256V1>()
      .notNull(),
    epochUuid: uuid("epoch_uuid").$type<ScopeEpochUuidV1>().notNull(),
    commitSeq: bigint("commit_seq", { mode: "bigint" })
      .$type<CommitSeq>()
      .notNull(),
    resultState: text("result_state")
      .$type<IdempotencyResultState>()
      .notNull(),
    resultValueCodecVersion: integer("result_value_codec_version").$type<
      FlarexValueCodecVersion
    >(),
    resultSemanticBytes: integer("result_semantic_bytes"),
    resultBytes: bytea("result_bytes").$type<
      CanonicalSuccessfulResultBytesV1
    >(),
    resultSha256: bytea("result_sha256").$type<FlarexValueSha256V1>(),
    resultExpiredAt: timestamp("result_expired_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.scopeUuid, table.requestKey] }),
    foreignKey({
      name: "fx_system_idempotency_scope_clock_fk",
      columns: [table.scopeUuid],
      foreignColumns: [fxSystemScopeClocks.scopeUuid],
    })
      .onUpdate("restrict")
      .onDelete("restrict"),
    index("fx_system_idempotency_commit_token_idx").on(
      table.scopeUuid,
      table.commitSeq,
      table.epochUuid,
    ),
    check(
      "fx_system_idempotency_request_key_check",
      sql`
        ${nonBlankText(table.requestKey)}
        and octet_length(${table.requestKey}) <= ${sql.raw(
          String(MAX_TRANSACTION_REQUEST_KEY_UTF8_BYTES_V1),
        )}
      `,
    ),
    check(
      "fx_system_idempotency_identity_hash_check",
      sql`octet_length(${table.identityAccessPolicySha256}) = 32`,
    ),
    check(
      "fx_system_idempotency_function_path_check",
      nonBlankText(table.functionPath),
    ),
    check(
      "fx_system_idempotency_request_hash_check",
      sql`octet_length(${table.requestSha256}) = 32`,
    ),
    check(
      "fx_system_idempotency_commit_seq_check",
      sql`${table.commitSeq} >= 1`,
    ),
    check(
      "fx_system_idempotency_result_state_check",
      sql`${table.resultState} in ('available', 'expired')`,
    ),
    check(
      "fx_system_idempotency_result_evidence_check",
      sql`
        (
          ${table.resultState} = 'available'
          and ${table.resultValueCodecVersion} is not null
          and ${table.resultValueCodecVersion} = 1
          and ${table.resultSemanticBytes} is not null
          and ${table.resultSemanticBytes} between 0 and ${sql.raw(
            String(MAX_COMMIT_RESULT_SEMANTIC_BYTES_V1),
          )}
          and ${table.resultBytes} is not null
          and octet_length(${table.resultBytes}) between 1 and ${sql.raw(
            String(MAX_COMMIT_CANONICAL_EVIDENCE_BYTES_V1),
          )}
          and ${table.resultSha256} is not null
          and octet_length(${table.resultSha256}) = 32
          and ${table.resultExpiredAt} is null
        )
        or
        (
          ${table.resultState} = 'expired'
          and ${table.resultValueCodecVersion} is null
          and ${table.resultSemanticBytes} is null
          and ${table.resultBytes} is null
          and ${table.resultSha256} is null
          and ${table.resultExpiredAt} is not null
          and isfinite(${table.resultExpiredAt})
          and ${table.resultExpiredAt} >= ${table.createdAt}
        )
      `,
    ),
    check(
      "fx_system_idempotency_created_at_check",
      sql`isfinite(${table.createdAt})`,
    ),
  ],
);

/**
 * Scope-local durable wake evidence for the first replacement commit
 * dispatcher. The commit token is correlated by the private repository rather
 * than foreign-keyed to compactable feed history.
 */
export const fxSystemOutbox = pgTable(
  "fx_system_outbox",
  {
    scopeUuid: uuid("scope_uuid").$type<ScopeUuidV1>().notNull(),
    outboxSeq: bigint("outbox_seq", { mode: "bigint" })
      .$type<OutboxSeq>()
      .notNull(),
    epochUuid: uuid("epoch_uuid").$type<ScopeEpochUuidV1>().notNull(),
    commitSeq: bigint("commit_seq", { mode: "bigint" })
      .$type<CommitSeq>()
      .notNull(),
    eventKind: text("event_kind")
      .$type<CommitWakeOutboxEventKindV1>()
      .notNull(),
    deliveryState: text("delivery_state")
      .$type<CommitWakeOutboxDeliveryStateV1>()
      .notNull()
      .default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true })
      .defaultNow(),
    attemptCount: bigint("attempt_count", { mode: "bigint" })
      .notNull()
      .default(sql`0`),
    claimFence: bigint("claim_fence", { mode: "bigint" })
      .notNull()
      .default(sql`0`),
    claimOwner: uuid("claim_owner"),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    claimExpiresAt: timestamp("claim_expires_at", { withTimezone: true }),
    lastFailureCode: text("last_failure_code")
      .$type<CommitWakeOutboxFailureCodeV1>(),
    lastFailureSummary: text("last_failure_summary"),
    lastFailedAt: timestamp("last_failed_at", { withTimezone: true }),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    deadLetteredAt: timestamp("dead_lettered_at", { withTimezone: true }),
  },
  (table) => [
    primaryKey({ columns: [table.scopeUuid, table.outboxSeq] }),
    unique("fx_system_outbox_commit_event_unique").on(
      table.scopeUuid,
      table.eventKind,
      table.commitSeq,
    ),
    foreignKey({
      name: "fx_system_outbox_scope_clock_fk",
      columns: [table.scopeUuid],
      foreignColumns: [fxSystemScopeClocks.scopeUuid],
    })
      .onUpdate("restrict")
      .onDelete("restrict"),
    index("fx_system_outbox_claimable_idx")
      .on(
        table.scopeUuid,
        sql`(
          case
            when ${table.deliveryState} = 'pending' then ${table.nextAttemptAt}
            when ${table.deliveryState} = 'claimed' then ${table.claimExpiresAt}
            else null
          end
        )`,
        table.outboxSeq,
      )
      .where(sql`${table.deliveryState} in ('pending', 'claimed')`),
    index("fx_system_outbox_commit_token_idx").on(
      table.scopeUuid,
      table.commitSeq,
      table.epochUuid,
      table.outboxSeq,
    ),
    check(
      "fx_system_outbox_outbox_seq_check",
      sql`${table.outboxSeq} >= 1`,
    ),
    check(
      "fx_system_outbox_commit_seq_check",
      sql`${table.commitSeq} >= 1`,
    ),
    check(
      "fx_system_outbox_event_kind_check",
      sql`${table.eventKind} = 'deployment_sync_commit_wake_v1'`,
    ),
    check(
      "fx_system_outbox_delivery_state_check",
      sql`${table.deliveryState} in ('pending', 'claimed', 'delivered', 'dead_lettered')`,
    ),
    check(
      "fx_system_outbox_attempt_fence_check",
      sql`
        ${table.attemptCount} >= 0
        and ${table.claimFence} >= 0
        and ${table.attemptCount} = ${table.claimFence}
      `,
    ),
    check(
      "fx_system_outbox_failure_evidence_check",
      sql`
        (
          (
            ${table.lastFailureCode} is null
            and ${table.lastFailureSummary} is null
            and ${table.lastFailedAt} is null
          )
          or
          (
            ${table.lastFailureCode} in (
              'transient_delivery',
              'claim_lease_expired',
              'terminal_delivery',
              'attempts_exhausted'
            )
            and ${table.lastFailedAt} is not null
            and isfinite(${table.lastFailedAt})
            and ${table.lastFailedAt} >= ${table.createdAt}
            and (
              ${table.lastFailureSummary} is null
              or (
                ${nonBlankText(table.lastFailureSummary)}
                and octet_length(${table.lastFailureSummary}) <= 1024
              )
            )
          )
        ) is true
      `,
    ),
    check(
      "fx_system_outbox_state_shape_check",
      sql`
        (
          (
            ${table.deliveryState} = 'pending'
            and ${table.nextAttemptAt} is not null
            and isfinite(${table.nextAttemptAt})
            and ${table.nextAttemptAt} >= ${table.createdAt}
            and ${table.claimOwner} is null
            and ${table.claimedAt} is null
            and ${table.claimExpiresAt} is null
            and ${table.deliveredAt} is null
            and ${table.deadLetteredAt} is null
            and (
              (
                ${table.attemptCount} = 0
                and ${table.nextAttemptAt} = ${table.createdAt}
                and ${table.lastFailureCode} is null
                and ${table.lastFailureSummary} is null
                and ${table.lastFailedAt} is null
              )
              or
              (
                ${table.attemptCount} >= 1
                and ${table.lastFailureCode} is not null
                and ${table.lastFailedAt} is not null
                and ${table.nextAttemptAt} >= ${table.lastFailedAt}
              )
            )
          )
          or
          (
            ${table.deliveryState} = 'claimed'
            and ${table.attemptCount} >= 1
            and ${table.nextAttemptAt} is null
            and ${table.claimOwner} is not null
            and ${table.claimedAt} is not null
            and isfinite(${table.claimedAt})
            and ${table.claimedAt} >= ${table.createdAt}
            and ${table.claimExpiresAt} is not null
            and isfinite(${table.claimExpiresAt})
            and ${table.claimExpiresAt} > ${table.claimedAt}
            and ${table.deliveredAt} is null
            and ${table.deadLetteredAt} is null
            and (
              (
                ${table.attemptCount} = 1
                and ${table.lastFailureCode} is null
                and ${table.lastFailureSummary} is null
                and ${table.lastFailedAt} is null
              )
              or
              (
                ${table.attemptCount} > 1
                and ${table.lastFailureCode} is not null
                and ${table.lastFailedAt} is not null
              )
            )
          )
          or
          (
            ${table.deliveryState} = 'delivered'
            and ${table.attemptCount} >= 1
            and ${table.nextAttemptAt} is null
            and ${table.claimOwner} is null
            and ${table.claimedAt} is null
            and ${table.claimExpiresAt} is null
            and ${table.deliveredAt} is not null
            and isfinite(${table.deliveredAt})
            and ${table.deliveredAt} >= ${table.createdAt}
            and ${table.deadLetteredAt} is null
            and (
              (
                ${table.attemptCount} = 1
                and ${table.lastFailureCode} is null
                and ${table.lastFailureSummary} is null
                and ${table.lastFailedAt} is null
              )
              or
              (
                ${table.attemptCount} > 1
                and ${table.lastFailureCode} is not null
                and ${table.lastFailedAt} is not null
              )
            )
          )
          or
          (
            ${table.deliveryState} = 'dead_lettered'
            and ${table.attemptCount} >= 1
            and ${table.nextAttemptAt} is null
            and ${table.claimOwner} is null
            and ${table.claimedAt} is null
            and ${table.claimExpiresAt} is null
            and ${table.lastFailureCode} in (
              'terminal_delivery',
              'attempts_exhausted'
            )
            and ${table.lastFailedAt} is not null
            and ${table.deliveredAt} is null
            and ${table.deadLetteredAt} is not null
            and isfinite(${table.deadLetteredAt})
            and ${table.deadLetteredAt} >= ${table.createdAt}
            and ${table.deadLetteredAt} = ${table.lastFailedAt}
          )
        ) is true
      `,
    ),
    check(
      "fx_system_outbox_created_at_check",
      sql`isfinite(${table.createdAt})`,
    ),
  ],
);

/**
 * Inert, database-owned progress for the one point-mutation redelivery
 * scheduler associated with this located metadata database. Its owner/fence
 * controls checkpoint writes only and never grants attempt execution.
 */
export const fxSystemPointMutationRedeliveryScheduler = pgTable(
  "fx_system_point_mutation_redelivery_scheduler",
  {
    schedulerKey: text("scheduler_key").primaryKey(),
    schedulerState: text("scheduler_state")
      .$type<"idle" | "claimed">()
      .notNull(),
    runFence: bigint("run_fence", { mode: "bigint" }).notNull(),
    checkpointSequence: bigint("checkpoint_sequence", {
      mode: "bigint",
    }).notNull(),
    runOwner: uuid("run_owner"),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    claimExpiresAt: timestamp("claim_expires_at", { withTimezone: true }),
    nextRunAt: timestamp("next_run_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    continuationCodecVersion: integer("continuation_codec_version"),
    continuationBytes: bytea("continuation_bytes"),
    continuationSha256: bytea("continuation_sha256"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      "fx_system_point_mutation_redelivery_scheduler_key_check",
      sql`${table.schedulerKey} = ${sql.raw(
        `'${POINT_MUTATION_REDELIVERY_SCHEDULER_KEY_V1}'`,
      )}`,
    ),
    check(
      "fx_system_point_mutation_redelivery_scheduler_state_check",
      sql`${table.schedulerState} in ('idle', 'claimed')`,
    ),
    check(
      "fx_system_point_mutation_redelivery_scheduler_fence_check",
      sql`${table.runFence} >= 0`,
    ),
    check(
      "fx_system_point_mutation_redelivery_scheduler_checkpoint_sequence_check",
      sql`${table.checkpointSequence} >= 0`,
    ),
    check(
      "fx_system_point_mutation_redelivery_scheduler_claim_check",
      sql`
        (
          ${table.schedulerState} = 'idle'
          and ${table.runOwner} is null
          and ${table.claimedAt} is null
          and ${table.claimExpiresAt} is null
        )
        or
        (
          ${table.schedulerState} = 'claimed'
          and ${table.runOwner} is not null
          and ${table.claimedAt} is not null
          and isfinite(${table.claimedAt})
          and ${table.claimExpiresAt} is not null
          and isfinite(${table.claimExpiresAt})
          and ${table.claimExpiresAt} > ${table.claimedAt}
        )
      `,
    ),
    check(
      "fx_system_point_mutation_redelivery_scheduler_continuation_check",
      sql`
        (
          ${table.continuationCodecVersion} is null
          and ${table.continuationBytes} is null
          and ${table.continuationSha256} is null
        )
        or
        (
          ${table.continuationCodecVersion} = ${sql.raw(
            String(
              POINT_MUTATION_REDELIVERY_SCHEDULER_CONTINUATION_CODEC_V1,
            ),
          )}
          and ${table.continuationBytes} is not null
          and octet_length(${table.continuationBytes}) between 1 and ${sql.raw(
            String(
              MAX_POINT_MUTATION_REDELIVERY_SCHEDULER_CONTINUATION_BYTES_V1,
            ),
          )}
          and ${table.continuationSha256} is not null
          and octet_length(${table.continuationSha256}) = 32
        )
      `,
    ),
    check(
      "fx_system_point_mutation_redelivery_scheduler_timestamp_check",
      sql`
        isfinite(${table.nextRunAt})
        and isfinite(${table.createdAt})
        and isfinite(${table.updatedAt})
        and ${table.updatedAt} >= ${table.createdAt}
      `,
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
    index("fx_system_tx_session_finishing_discovery_idx")
      .on(
        table.scopeUuid,
        table.updatedAt,
        table.sessionId,
        table.attemptFence,
      )
      .where(sql`${table.lifecycle} = 'finishing'`),
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

/**
 * Singular execution ownership for one exact running attempt.
 *
 * The row is intentionally a child of the journal root rather than a second
 * lifecycle authority. Deleting or replacing the root therefore removes the
 * corresponding execution authority in the same transaction.
 */
export const fxSystemTransactionExecutionClaims = pgTable(
  "fx_system_tx_execution_claim",
  {
    scopeUuid: uuid("scope_uuid").$type<ScopeUuidV1>().notNull(),
    sessionId: uuid("session_id").$type<TransactionSessionIdV1>().notNull(),
    attemptFence: bigint("attempt_fence", { mode: "bigint" })
      .$type<TransactionAttemptFence>()
      .notNull(),
    claimFence: bigint("claim_fence", { mode: "bigint" })
      .$type<TransactionExecutionClaimFenceV1>()
      .notNull(),
    claimOwner: uuid("claim_owner")
      .$type<TransactionExecutionClaimOwnerV1>()
      .notNull(),
    claimedAt: timestamp("claimed_at", { withTimezone: true }).notNull(),
    claimExpiresAt: timestamp("claim_expires_at", {
      withTimezone: true,
    }).notNull(),
  },
  (table) => [
    primaryKey({
      name: "fx_system_tx_execution_claim_pk",
      columns: [table.scopeUuid, table.sessionId, table.attemptFence],
    }),
    foreignKey({
      name: "fx_system_tx_execution_claim_journal_fk",
      columns: [table.scopeUuid, table.sessionId, table.attemptFence],
      foreignColumns: [
        fxSystemTransactionJournals.scopeUuid,
        fxSystemTransactionJournals.sessionId,
        fxSystemTransactionJournals.attemptFence,
      ],
    })
      .onUpdate("restrict")
      .onDelete("cascade"),
    index("fx_system_tx_execution_claim_expiry_idx").on(
      table.scopeUuid,
      table.claimExpiresAt,
      table.sessionId,
      table.attemptFence,
    ),
    check(
      "fx_system_tx_execution_claim_attempt_fence_check",
      sql`${table.attemptFence} >= 1`,
    ),
    check(
      "fx_system_tx_execution_claim_fence_check",
      sql`${table.claimFence} >= 1`,
    ),
    check(
      "fx_system_tx_execution_claim_owner_check",
      sql`${table.claimOwner}::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'`,
    ),
    check(
      "fx_system_tx_execution_claim_time_check",
      sql`
        isfinite(${table.claimedAt})
        and isfinite(${table.claimExpiresAt})
        and ${table.claimExpiresAt} > ${table.claimedAt}
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

export const fxSystemDeclarativeV2CandidateProjections = pgTable(
  "fx_system_declarative_v2_candidate_projection",
  {
    scopeId: text("scope_id").$type<ScopeId>().notNull(),
    candidateSha256: bytea("candidate_sha256").notNull(),
    projectionKind: text("projection_kind")
      .$type<"deployment_analysis" | "deployment_codegen_analysis">()
      .notNull(),
    frameCodecVersion: integer("frame_codec_version").notNull(),
    frameByteLength: bigint("frame_byte_length", { mode: "bigint" }).notNull(),
    frameSha256: bytea("frame_sha256").notNull(),
    frameBytes: bytea("frame_bytes").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({
      columns: [table.scopeId, table.candidateSha256, table.projectionKind],
    }),
    foreignKey({
      name: "fx_dv2_projection_candidate_fk",
      columns: [table.scopeId, table.candidateSha256],
      foreignColumns: [
        fxSystemDeclarativeV2Candidates.scopeId,
        fxSystemDeclarativeV2Candidates.candidateSha256,
      ],
    }).onDelete("restrict"),
    check(
      "fx_dv2_projection_kind_check",
      sql`${table.projectionKind} in (
        'deployment_analysis',
        'deployment_codegen_analysis'
      )`,
    ),
    check(
      "fx_dv2_projection_frame_check",
      requiredFrameCheck(
        table.frameCodecVersion,
        table.frameByteLength,
        table.frameSha256,
        table.frameBytes,
      ),
    ),
    check("fx_dv2_projection_created_check", sql`isfinite(${table.createdAt})`),
  ],
);

export const fxSystemDeclarativeV2VerifierAttempts = pgTable(
  "fx_system_declarative_v2_verifier_attempt",
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
    lastCommandSha256: bytea("last_command_sha256"),
    lastReceiptCodecVersion: integer("last_receipt_codec_version"),
    lastReceiptByteLength: bigint("last_receipt_byte_length", {
      mode: "bigint",
    }),
    lastReceiptSha256: bytea("last_receipt_sha256"),
    lastReceiptBytes: bytea("last_receipt_bytes"),
    pendingKind: text("pending_kind").$type<DeclarativeV2CommandKindV1>(),
    pendingSequence: bigint("pending_sequence", { mode: "bigint" }),
    pendingCommandSha256: bytea("pending_command_sha256"),
    pendingReservedByFence: bigint("pending_reserved_by_fence", {
      mode: "bigint",
    }),
    pendingStartedAt: timestamp("pending_started_at", { withTimezone: true }),
    pendingBudgetCodecVersion: integer("pending_budget_codec_version"),
    pendingBudgetByteLength: bigint("pending_budget_byte_length", {
      mode: "bigint",
    }),
    pendingBudgetSha256: bytea("pending_budget_sha256"),
    pendingBudgetBytes: bytea("pending_budget_bytes"),
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
      name: "fx_dv2_attempt_candidate_fk",
      columns: [table.scopeId, table.candidateSha256],
      foreignColumns: [
        fxSystemDeclarativeV2Candidates.scopeId,
        fxSystemDeclarativeV2Candidates.candidateSha256,
      ],
    }).onDelete("restrict"),
    check(
      "fx_dv2_attempt_digest_check",
      sql`octet_length(${table.attemptSha256}) = 32
        and octet_length(${table.candidateSha256}) = 32
        and ${table.attemptSha256} = ${table.identitySha256}`,
    ),
    check(
      "fx_dv2_attempt_lifecycle_check",
      sql`${table.lifecycle} in (
        'open', 'parsing', 'parse_complete', 'linking', 'link_complete',
        'registering', 'ready', 'rejected', 'abandoned'
      )`,
    ),
    check("fx_dv2_attempt_fence_check", sql`${table.writerFence} >= 0`),
    check(
      "fx_dv2_attempt_lease_check",
      sql`
        ((
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
        )) is true
      `,
    ),
    check(
      "fx_dv2_attempt_settled_check",
      sql`
        (
        ${table.settledSequence} >= 0
        and (
          (
            ${table.settledSequence} = 0
            and ${table.lastCommandSha256} is null
            and ${nullableFrameAbsent(
              table.lastReceiptCodecVersion,
              table.lastReceiptByteLength,
              table.lastReceiptSha256,
              table.lastReceiptBytes,
            )}
          )
          or
          (
            ${table.settledSequence} >= 1
            and ${table.lastCommandSha256} is not null
            and octet_length(${table.lastCommandSha256}) = 32
            and ${requiredFrameCheck(
              table.lastReceiptCodecVersion,
              table.lastReceiptByteLength,
              table.lastReceiptSha256,
              table.lastReceiptBytes,
            )}
          )
        )
        ) is true
      `,
    ),
    check(
      "fx_dv2_attempt_pending_check",
      sql`
        ((
          ${table.pendingKind} is null
          and ${table.pendingSequence} is null
          and ${table.pendingCommandSha256} is null
          and ${table.pendingReservedByFence} is null
          and ${table.pendingStartedAt} is null
          and ${nullableFrameAbsent(
            table.pendingBudgetCodecVersion,
            table.pendingBudgetByteLength,
            table.pendingBudgetSha256,
            table.pendingBudgetBytes,
          )}
        )
        or
        (
          ${table.pendingKind} in (
            'source_page', 'parse_module', 'link_page',
            'registration_page', 'finalize'
          )
          and ${table.pendingSequence} = ${table.settledSequence} + 1
          and ${table.settledSequence} < 9223372036854775807
          and ${table.pendingCommandSha256} is not null
          and octet_length(${table.pendingCommandSha256}) = 32
          and ${table.pendingReservedByFence} is not null
          and ${table.pendingReservedByFence} >= 1
          and ${table.pendingStartedAt} is not null
          and isfinite(${table.pendingStartedAt})
          and ${requiredFrameCheck(
            table.pendingBudgetCodecVersion,
            table.pendingBudgetByteLength,
            table.pendingBudgetSha256,
            table.pendingBudgetBytes,
          )}
        )) is true
      `,
    ),
    check(
      "fx_dv2_attempt_identity_frame_check",
      requiredFrameCheck(
        table.identityCodecVersion,
        table.identityByteLength,
        table.identitySha256,
        table.identityBytes,
      ),
    ),
    check(
      "fx_dv2_attempt_ceilings_frame_check",
      requiredFrameCheck(
        table.ceilingsCodecVersion,
        table.ceilingsByteLength,
        table.ceilingsSha256,
        table.ceilingsBytes,
      ),
    ),
    check(
      "fx_dv2_attempt_usage_frame_check",
      requiredFrameCheck(
        table.usageCodecVersion,
        table.usageByteLength,
        table.usageSha256,
        table.usageBytes,
      ),
    ),
    check(
      "fx_dv2_attempt_progress_frame_check",
      requiredFrameCheck(
        table.progressCodecVersion,
        table.progressByteLength,
        table.progressSha256,
        table.progressBytes,
      ),
    ),
    check(
      "fx_dv2_attempt_timestamps_check",
      sql`isfinite(${table.createdAt})
        and isfinite(${table.updatedAt})
        and ${table.updatedAt} >= ${table.createdAt}`,
    ),
  ],
);

/**
 * Additive inert Durable Command V2 storage.
 *
 * These rows preserve canonical portable bytes and the metadata required for
 * bounded reads and later transaction predicates. They do not mint verifier
 * authority: leases, normalized columns, digests, and serialized frames remain
 * inert until a later private composition reacquires fresh authenticated input.
 * The V1 attempt and evidence tables above remain byte-for-byte compatible and
 * retain their original meanings.
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

/**
 * Inactive application-revision registration evidence.
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

export const fxSystemDeclarativeV2ModuleSummaries = pgTable(
  "fx_system_declarative_v2_module_summary",
  {
    scopeId: text("scope_id").$type<ScopeId>().notNull(),
    attemptSha256: bytea("attempt_sha256").notNull(),
    moduleOrdinal: bigint("module_ordinal", { mode: "bigint" }).notNull(),
    modulePathSha256: bytea("module_path_sha256").notNull(),
    frameCodecVersion: integer("frame_codec_version").notNull(),
    frameByteLength: bigint("frame_byte_length", { mode: "bigint" }).notNull(),
    frameSha256: bytea("frame_sha256").notNull(),
    frameBytes: bytea("frame_bytes").notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.scopeId, table.attemptSha256, table.moduleOrdinal],
    }),
    unique("fx_dv2_module_path_unique").on(
      table.scopeId,
      table.attemptSha256,
      table.modulePathSha256,
    ),
    foreignKey({
      name: "fx_dv2_module_attempt_fk",
      columns: [table.scopeId, table.attemptSha256],
      foreignColumns: [
        fxSystemDeclarativeV2VerifierAttempts.scopeId,
        fxSystemDeclarativeV2VerifierAttempts.attemptSha256,
      ],
    }).onDelete("restrict"),
    check(
      "fx_dv2_module_check",
      sql`${table.moduleOrdinal} >= 0
        and octet_length(${table.modulePathSha256}) = 32
        and ${requiredFrameCheck(
          table.frameCodecVersion,
          table.frameByteLength,
          table.frameSha256,
          table.frameBytes,
        )}`,
    ),
  ],
);

export const fxSystemDeclarativeV2ImportEdges = pgTable(
  "fx_system_declarative_v2_import_edge",
  {
    scopeId: text("scope_id").$type<ScopeId>().notNull(),
    attemptSha256: bytea("attempt_sha256").notNull(),
    moduleOrdinal: bigint("module_ordinal", { mode: "bigint" }).notNull(),
    edgeOrdinal: bigint("edge_ordinal", { mode: "bigint" }).notNull(),
    frameCodecVersion: integer("frame_codec_version").notNull(),
    frameByteLength: bigint("frame_byte_length", { mode: "bigint" }).notNull(),
    frameSha256: bytea("frame_sha256").notNull(),
    frameBytes: bytea("frame_bytes").notNull(),
  },
  (table) => [
    primaryKey({
      columns: [
        table.scopeId,
        table.attemptSha256,
        table.moduleOrdinal,
        table.edgeOrdinal,
      ],
    }),
    foreignKey({
      name: "fx_dv2_edge_attempt_fk",
      columns: [table.scopeId, table.attemptSha256],
      foreignColumns: [
        fxSystemDeclarativeV2VerifierAttempts.scopeId,
        fxSystemDeclarativeV2VerifierAttempts.attemptSha256,
      ],
    }).onDelete("restrict"),
    check(
      "fx_dv2_edge_check",
      sql`${table.moduleOrdinal} >= 0
        and ${table.edgeOrdinal} >= 0
        and ${requiredFrameCheck(
          table.frameCodecVersion,
          table.frameByteLength,
          table.frameSha256,
          table.frameBytes,
        )}`,
    ),
  ],
);

export const fxSystemDeclarativeV2PageManifests = pgTable(
  "fx_system_declarative_v2_page_manifest",
  {
    scopeId: text("scope_id").$type<ScopeId>().notNull(),
    attemptSha256: bytea("attempt_sha256").notNull(),
    phase: text("phase")
      .$type<DeclarativeV2PageManifestFrameV1["phase"]>()
      .notNull(),
    pageOrdinal: bigint("page_ordinal", { mode: "bigint" }).notNull(),
    firstItemOrdinal: bigint("first_item_ordinal", { mode: "bigint" }).notNull(),
    itemCount: bigint("item_count", { mode: "bigint" }).notNull(),
    previousPageSha256: bytea("previous_page_sha256"),
    frameCodecVersion: integer("frame_codec_version").notNull(),
    frameByteLength: bigint("frame_byte_length", { mode: "bigint" }).notNull(),
    frameSha256: bytea("frame_sha256").notNull(),
    frameBytes: bytea("frame_bytes").notNull(),
  },
  (table) => [
    primaryKey({
      columns: [
        table.scopeId,
        table.attemptSha256,
        table.phase,
        table.pageOrdinal,
      ],
    }),
    foreignKey({
      name: "fx_dv2_page_attempt_fk",
      columns: [table.scopeId, table.attemptSha256],
      foreignColumns: [
        fxSystemDeclarativeV2VerifierAttempts.scopeId,
        fxSystemDeclarativeV2VerifierAttempts.attemptSha256,
      ],
    }).onDelete("restrict"),
    check(
      "fx_dv2_page_phase_check",
      sql`${table.phase} in ('source', 'parse', 'link', 'registration', 'verdict')`,
    ),
    check(
      "fx_dv2_page_range_check",
      sql`${table.pageOrdinal} >= 0
        and ${table.firstItemOrdinal} >= 0
        and ${table.itemCount} >= 1
        and ((
          (${table.pageOrdinal} = 0 and ${table.previousPageSha256} is null)
          or (
            ${table.pageOrdinal} >= 1
            and octet_length(${table.previousPageSha256}) = 32
          )
        )) is true`,
    ),
    check(
      "fx_dv2_page_frame_check",
      requiredFrameCheck(
        table.frameCodecVersion,
        table.frameByteLength,
        table.frameSha256,
        table.frameBytes,
      ),
    ),
  ],
);

export const fxSystemDeclarativeV2LinkNodes = pgTable(
  "fx_system_declarative_v2_link_node",
  {
    scopeId: text("scope_id").$type<ScopeId>().notNull(),
    attemptSha256: bytea("attempt_sha256").notNull(),
    moduleOrdinal: bigint("module_ordinal", { mode: "bigint" }).notNull(),
    remainingIndegree: bigint("remaining_indegree", { mode: "bigint" })
      .notNull(),
    nextEdgeOrdinal: bigint("next_edge_ordinal", { mode: "bigint" }).notNull(),
    state: text("state").$type<DeclarativeV2LinkNodeFrameV1["state"]>().notNull(),
    rowVersion: bigint("row_version", { mode: "bigint" }).notNull(),
    rowCodecVersion: integer("row_codec_version").notNull(),
    rowByteLength: bigint("row_byte_length", { mode: "bigint" }).notNull(),
    rowSha256: bytea("row_sha256").notNull(),
    rowBytes: bytea("row_bytes").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({
      columns: [table.scopeId, table.attemptSha256, table.moduleOrdinal],
    }),
    foreignKey({
      name: "fx_dv2_link_attempt_fk",
      columns: [table.scopeId, table.attemptSha256],
      foreignColumns: [
        fxSystemDeclarativeV2VerifierAttempts.scopeId,
        fxSystemDeclarativeV2VerifierAttempts.attemptSha256,
      ],
    }).onDelete("restrict"),
    check(
      "fx_dv2_link_state_check",
      sql`${table.moduleOrdinal} >= 0
        and ${table.remainingIndegree} >= 0
        and ${table.nextEdgeOrdinal} >= 0
        and ${table.rowVersion} >= 0
        and ${table.state} in ('pending', 'linked', 'rejected')`,
    ),
    check(
      "fx_dv2_link_frame_check",
      requiredFrameCheck(
        table.rowCodecVersion,
        table.rowByteLength,
        table.rowSha256,
        table.rowBytes,
      ),
    ),
    check("fx_dv2_link_updated_check", sql`isfinite(${table.updatedAt})`),
  ],
);

export const fxSystemDeclarativeV2FrontierEntries = pgTable(
  "fx_system_declarative_v2_frontier_entry",
  {
    scopeId: text("scope_id").$type<ScopeId>().notNull(),
    attemptSha256: bytea("attempt_sha256").notNull(),
    frontierSequence: bigint("frontier_sequence", { mode: "bigint" }).notNull(),
    moduleOrdinal: bigint("module_ordinal", { mode: "bigint" }).notNull(),
    state: text("state")
      .$type<DeclarativeV2FrontierEntryFrameV1["state"]>()
      .notNull(),
    rowVersion: bigint("row_version", { mode: "bigint" }).notNull(),
    rowCodecVersion: integer("row_codec_version").notNull(),
    rowByteLength: bigint("row_byte_length", { mode: "bigint" }).notNull(),
    rowSha256: bytea("row_sha256").notNull(),
    rowBytes: bytea("row_bytes").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({
      columns: [table.scopeId, table.attemptSha256, table.frontierSequence],
    }),
    unique("fx_dv2_frontier_module_unique").on(
      table.scopeId,
      table.attemptSha256,
      table.moduleOrdinal,
    ),
    foreignKey({
      name: "fx_dv2_frontier_attempt_fk",
      columns: [table.scopeId, table.attemptSha256],
      foreignColumns: [
        fxSystemDeclarativeV2VerifierAttempts.scopeId,
        fxSystemDeclarativeV2VerifierAttempts.attemptSha256,
      ],
    }).onDelete("restrict"),
    check(
      "fx_dv2_frontier_state_check",
      sql`${table.frontierSequence} >= 0
        and ${table.moduleOrdinal} >= 0
        and ${table.rowVersion} >= 0
        and ${table.state} in ('queued', 'consumed')`,
    ),
    check(
      "fx_dv2_frontier_frame_check",
      requiredFrameCheck(
        table.rowCodecVersion,
        table.rowByteLength,
        table.rowSha256,
        table.rowBytes,
      ),
    ),
    check("fx_dv2_frontier_updated_check", sql`isfinite(${table.updatedAt})`),
  ],
);

export const fxSystemDeclarativeV2Registrations = pgTable(
  "fx_system_declarative_v2_registration",
  {
    scopeId: text("scope_id").$type<ScopeId>().notNull(),
    attemptSha256: bytea("attempt_sha256").notNull(),
    registrationOrdinal: bigint("registration_ordinal", {
      mode: "bigint",
    }).notNull(),
    handlerIdentitySha256: bytea("handler_identity_sha256").notNull(),
    frameCodecVersion: integer("frame_codec_version").notNull(),
    frameByteLength: bigint("frame_byte_length", { mode: "bigint" }).notNull(),
    frameSha256: bytea("frame_sha256").notNull(),
    frameBytes: bytea("frame_bytes").notNull(),
  },
  (table) => [
    primaryKey({
      columns: [
        table.scopeId,
        table.attemptSha256,
        table.registrationOrdinal,
      ],
    }),
    unique("fx_dv2_registration_handler_unique").on(
      table.scopeId,
      table.attemptSha256,
      table.handlerIdentitySha256,
    ),
    foreignKey({
      name: "fx_dv2_registration_attempt_fk",
      columns: [table.scopeId, table.attemptSha256],
      foreignColumns: [
        fxSystemDeclarativeV2VerifierAttempts.scopeId,
        fxSystemDeclarativeV2VerifierAttempts.attemptSha256,
      ],
    }).onDelete("restrict"),
    check(
      "fx_dv2_registration_check",
      sql`${table.registrationOrdinal} >= 0
        and octet_length(${table.handlerIdentitySha256}) = 32
        and ${requiredFrameCheck(
          table.frameCodecVersion,
          table.frameByteLength,
          table.frameSha256,
          table.frameBytes,
        )}`,
    ),
  ],
);

export const fxSystemDeclarativeV2Diagnostics = pgTable(
  "fx_system_declarative_v2_diagnostic",
  {
    scopeId: text("scope_id").$type<ScopeId>().notNull(),
    attemptSha256: bytea("attempt_sha256").notNull(),
    diagnosticOrdinal: bigint("diagnostic_ordinal", {
      mode: "bigint",
    }).notNull(),
    frameCodecVersion: integer("frame_codec_version").notNull(),
    frameByteLength: bigint("frame_byte_length", { mode: "bigint" }).notNull(),
    frameSha256: bytea("frame_sha256").notNull(),
    frameBytes: bytea("frame_bytes").notNull(),
  },
  (table) => [
    primaryKey({
      columns: [
        table.scopeId,
        table.attemptSha256,
        table.diagnosticOrdinal,
      ],
    }),
    foreignKey({
      name: "fx_dv2_diagnostic_attempt_fk",
      columns: [table.scopeId, table.attemptSha256],
      foreignColumns: [
        fxSystemDeclarativeV2VerifierAttempts.scopeId,
        fxSystemDeclarativeV2VerifierAttempts.attemptSha256,
      ],
    }).onDelete("restrict"),
    check(
      "fx_dv2_diagnostic_check",
      sql`${table.diagnosticOrdinal} >= 0
        and ${requiredFrameCheck(
          table.frameCodecVersion,
          table.frameByteLength,
          table.frameSha256,
          table.frameBytes,
        )}`,
    ),
  ],
);

export const fxSystemDeclarativeV2Verdicts = pgTable(
  "fx_system_declarative_v2_verdict",
  {
    scopeId: text("scope_id").$type<ScopeId>().notNull(),
    attemptSha256: bytea("attempt_sha256").notNull(),
    candidateSha256: bytea("candidate_sha256").notNull(),
    verdictSha256: bytea("verdict_sha256").notNull(),
    verdict: text("verdict").$type<DeclarativeV2VerdictFrameV1["verdict"]>().notNull(),
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
        fxSystemDeclarativeV2VerifierAttempts.scopeId,
        fxSystemDeclarativeV2VerifierAttempts.attemptSha256,
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
    check(
      "fx_dv2_verdict_state_check",
      sql`
        ((
          ${table.verdict} = 'ready'
          and ${table.failureCode} is null
        )
        or
        (
          ${table.verdict} = 'rejected'
          and ${nonBlankText(table.failureCode)}
        )) is true
      `,
    ),
    check(
      "fx_dv2_verdict_frame_check",
      sql`octet_length(${table.verdictSha256}) = 32
        and ${table.verdictSha256} = ${table.frameSha256}
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
  fxSystemApplicationRevisionRequestsV1,
  fxSystemApplicationRevisionsV1,
  fxSystemDeclarativeV2ActivationHeads,
  fxSystemDeclarativeV2ActivationRevisions,
  fxSystemDeclarativeV2Candidates,
  fxSystemDeclarativeV2CandidateProjections,
  fxSystemDeclarativeV2Diagnostics,
  fxSystemDeclarativeV2FrontierEntries,
  fxSystemDeclarativeV2ImportEdges,
  fxSystemDeclarativeV2LinkNodes,
  fxSystemDeclarativeV2ModuleSummaries,
  fxSystemDeclarativeV2PageManifests,
  fxSystemDeclarativeV2Registrations,
  fxSystemDeclarativeV2Verdicts,
  fxSystemDeclarativeV2VerifierAttempts,
  fxSystemDeclarativeV2VerifierAttemptsV2,
  fxSystemDeclarativeV2VerifierCommandsV2,
  fxSystemDeclarativeV2VerifierEvidencePagesV2,
  fxSystemIndexBuildStates,
  fxSystemSnapshotLeases,
  fxSystemScopeClocks,
  fxSystemPointMutationRedeliveryScheduler,
  fxSystemTransactionExecutionClaims,
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

function requiredFrameCheck(
  codecVersion: SQLWrapper,
  byteLength: SQLWrapper,
  sha256: SQLWrapper,
  bytes: SQLWrapper,
) {
  return sql`(
    ${codecVersion} = 1
    and ${byteLength} >= 1
    and octet_length(${sha256}) = 32
    and octet_length(${bytes}) = ${byteLength}
  ) is true`;
}

function requiredFrameCheckV2(
  codecVersion: SQLWrapper,
  byteLength: SQLWrapper,
  sha256: SQLWrapper,
  bytes: SQLWrapper,
) {
  return sql`(
    ${codecVersion} = 2
    and ${byteLength} >= 1
    and octet_length(${sha256}) = 32
    and octet_length(${bytes}) = ${byteLength}
  ) is true`;
}

function nullableFrameAbsent(
  codecVersion: SQLWrapper,
  byteLength: SQLWrapper,
  sha256: SQLWrapper,
  bytes: SQLWrapper,
) {
  return sql`(
    ${codecVersion} is null
    and ${byteLength} is null
    and ${sha256} is null
    and ${bytes} is null
  )`;
}
