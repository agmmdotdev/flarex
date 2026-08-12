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
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import {
  MAX_TASK_REQUESTED_EFFECT_PERSISTED_JSON_BYTES_V1,
  MAX_TASK_RUN_ATTEMPT_PERSISTED_JSON_BYTES_V1,
  type TaskAttemptIdV1,
  type TaskAttemptNumberV1,
  type TaskCancellationGenerationV1,
  type TaskDefinitionRevisionIdV1,
  type TaskDurationMsV1,
  type TaskExecutionFenceV1,
  type TaskLeaseVersionV1,
  type TaskRequestedEffectPersistenceCursorV1,
  type TaskRequestedEffectSequenceV1,
  type TaskRequestedEffectV1,
  type TaskRunAttemptPersistenceProjectionV1,
  type TaskRunIdV1,
  type TaskRunVersionV1,
} from "@flarex/durable-task/internal/run-attempt-v1";
import {
  MAX_TASK_INPUT_CANONICAL_BYTES_V1,
  type TaskInputSha256V1,
  type TaskRunCreationAuthoritySha256V1,
  type TaskRunCreationRequestKeySha256V1,
  type TaskRunCreationRequestSha256V1,
} from "@flarex/durable-task/internal/run-creation-v1";
import {
  MAX_TASK_DEFINITION_CANONICAL_BYTES_V1,
  MAX_TASK_ID_UTF8_BYTES_V1,
  MAX_TASK_RUNTIME_PUBLICATION_OBJECTS_V1,
  MAX_TASK_RUNTIME_PUBLICATION_CANONICAL_BYTES_V1,
  MAX_TASK_RUNTIME_PUBLICATION_RECEIPT_CANONICAL_BYTES_V1,
  type TaskRuntimeObjectRoleV1,
  type TaskDefinitionSha256V1,
  type TaskIdV1,
} from "@flarex/standard-application-definition/internal/task-definition-v1";
import type { AppCreationTimeV1 } from "flarex-protocol/app-document";
import type { ExecutionIdentity } from "flarex-protocol/auth";
import {
  MAX_COMMIT_CANONICAL_EVIDENCE_BYTES_V1,
  CommitMaterialWriteEventEvidenceBytesV1Schema,
  MAX_COMMIT_MATERIAL_WRITE_EVENT_EVIDENCE_BYTES_V1,
  MAX_COMMIT_INDEXED_QUERY_SYSCALLS_V1,
  MAX_COMMIT_INDEX_RANGE_READ_DEPENDENCIES_V1,
  MAX_COMMIT_INDEX_RANGE_DEPENDENCY_EVIDENCE_BYTES_V1,
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
  CatalogUniqueConstraintDefinitionId,
  CatalogUniqueConstraintId,
} from "flarex-protocol/catalog";
import {
  MAX_CANONICAL_APP_UNIQUE_CONSTRAINT_SPEC_BYTES_V1,
  type AppUniqueConstraintPhysicalSpecCodecVersion,
  type AppUniqueConstraintPhysicalSpecV1,
} from "flarex-protocol/app-unique-constraint-definition";
import type {
  AppUniqueConstraintSetBuildAttemptFenceV1,
  AppUniqueConstraintSetBuildCursorCodecVersionV1,
  AppUniqueConstraintSetBuildLifecycleV1,
  AppUniqueConstraintSetCodecVersionV1,
} from "flarex-protocol/internal/app-unique-constraint-set-v1";
import {
  MAX_APP_SCHEMA_CANDIDATE_VALIDATION_CANONICAL_FRAME_BYTES_V1,
  type AppSchemaCandidateValidationAttemptFenceV1,
  type AppSchemaCandidateValidationCodecVersionV1,
  type AppSchemaCandidateValidationFrameV1,
} from "flarex-protocol/internal/app-schema-candidate-validation-v1";
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
  DeclarativeV2RuntimeExecutionGroupV1,
} from "flarex-protocol/internal/declarative-v2-physical-v1";
import type {
  DeclarativeV2VerifierDurableCommandKindV2,
  DeclarativeV2VerifierRestartCommandKindV2,
} from "flarex-protocol/internal/declarative-v2-verifier-progress-v2";
import {
  MAX_ORDERED_INDEX_BOUND_BYTES_V1,
  MAX_ORDERED_INDEX_KEY_BYTES_V1,
  type OrderedIndexKeyCodecVersion,
  type AppOrderedIndexPhysicalSpecV1,
} from "flarex-protocol/ordered-index";
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
import type {
  ApplicationMutationExecutionAuthorityV1,
} from "flarex-protocol/internal/application-mutation-authority-v1";
import { MAX_TRANSACTION_REQUEST_KEY_UTF8_BYTES_V1 } from "flarex-protocol/transaction-session";
import type {
  CanonicalFlarexValueBytesV1,
  FlarexValueCodecVersion,
  FlarexValueSha256V1,
} from "flarex-protocol/value";

import {
  MAX_APP_UNIQUE_CONSTRAINT_ID_V1,
  MAX_APP_UNIQUE_LOCALE_KEY_BYTES_V1,
  type AppUniqueConstraintIdV1,
} from "./appUniqueKeyContract";
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
import {
  MAX_TASK_REPAIR_SCHEDULER_CONTINUATION_BYTES_V1,
  TASK_REPAIR_SCHEDULER_CONTINUATION_CODEC_V1,
  TASK_REPAIR_SCHEDULER_KEY_V1,
} from "./taskRepairSchedulerModelV1";
import {
  MAX_TASK_COMPUTE_DELIVERY_EVIDENCE_BYTES_V1,
  MAX_TASK_COMPUTE_DELIVERY_REASON_CODE_UTF8_BYTES_V1,
  MAX_TASK_COMPUTE_PROFILE_STORAGE_BYTES_V1,
  TASK_COMPUTE_DELIVERY_EVIDENCE_CODEC_V1,
  TASK_COMPUTE_PROFILE_STORAGE_CODEC_V1,
  type TaskComputeCancellationDeliveryStateV1,
  type TaskComputeDispatchDeliveryStateV1,
} from "./taskComputeDeliveryEvidenceV1";

type TransactionJournalOperationalLimitDimensionV1 = Extract<
  CommitProtocolV1LimitDimension,
  | "readDocuments"
  | "readSemanticBytes"
  | "pointReadDependencies"
  | "indexedQuerySyscalls"
  | "indexRangeReadDependencies"
  | "indexRangeDependencyEvidenceBytes"
  | "writeOperations"
  | "writeSemanticBytes"
  | "materialWriteEventEvidenceBytes"
>;

type TransactionJournalOperationKindV1 =
  | "get"
  | "insert"
  | "patch"
  | "replace"
  | "delete"
  | "indexRange";

type TransactionJournalOutcomeKindV1 =
  | "missing"
  | "present"
  | "inserted"
  | "unit"
  | "indexRangePage"
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

/** Stable logical names; physical generations and version bindings are separate. */
export const fxControlUniqueConstraints = pgTable(
  "fx_control_unique_constraint",
  {
    deploymentId: text("deployment_id").notNull(),
    logicalUniqueConstraintId: integer("logical_unique_constraint_id")
      .$type<CatalogUniqueConstraintId>()
      .notNull(),
    tableId: integer("table_id").$type<CatalogTableId>().notNull(),
    descriptor: text("descriptor").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({
      name: "fx_control_unique_constraint_pk",
      columns: [table.deploymentId, table.logicalUniqueConstraintId],
    }),
    unique("fx_control_unique_constraint_table_descriptor_unique").on(
      table.deploymentId,
      table.tableId,
      table.descriptor,
    ),
    unique("fx_control_unique_constraint_logical_table_unique").on(
      table.deploymentId,
      table.logicalUniqueConstraintId,
      table.tableId,
    ),
    foreignKey({
      name: "fx_control_unique_constraint_table_fk",
      columns: [table.deploymentId, table.tableId],
      foreignColumns: [fxControlTables.deploymentId, fxControlTables.tableId],
    }).onDelete("restrict"),
    check(
      "fx_control_unique_constraint_deployment_non_empty_check",
      nonBlankText(table.deploymentId),
    ),
    check(
      "fx_control_unique_constraint_id_positive_check",
      sql`${table.logicalUniqueConstraintId} between 1 and 2147483647`,
    ),
    check(
      "fx_control_unique_constraint_table_id_positive_check",
      sql`${table.tableId} between 1 and 2147483647`,
    ),
    check(
      "fx_control_unique_constraint_descriptor_non_empty_check",
      nonBlankText(table.descriptor),
    ),
  ],
);

export const fxControlUniqueConstraintDefinitions = pgTable(
  "fx_control_unique_constraint_definition",
  {
    deploymentId: text("deployment_id").notNull(),
    uniqueConstraintDefinitionId: integer("unique_constraint_definition_id")
      .$type<CatalogUniqueConstraintDefinitionId>()
      .notNull(),
    logicalUniqueConstraintId: integer("logical_unique_constraint_id")
      .$type<CatalogUniqueConstraintId>()
      .notNull(),
    tableId: integer("table_id").$type<CatalogTableId>().notNull(),
    physicalSpecCodecVersion: integer("physical_spec_codec_version")
      .$type<AppUniqueConstraintPhysicalSpecCodecVersion>()
      .notNull(),
    physicalSpecJson: jsonb("physical_spec_json")
      .$type<AppUniqueConstraintPhysicalSpecV1>()
      .notNull(),
    physicalSpecBytes: bytea("physical_spec_bytes").notNull(),
    physicalSpecSha256: bytea("physical_spec_sha256").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({
      name: "fx_control_unique_constraint_definition_pk",
      columns: [table.deploymentId, table.uniqueConstraintDefinitionId],
    }),
    unique("fx_control_unique_constraint_definition_owner_spec_unique").on(
      table.deploymentId,
      table.logicalUniqueConstraintId,
      table.physicalSpecSha256,
    ),
    unique("fx_control_unique_constraint_definition_binding_owner_unique").on(
      table.deploymentId,
      table.uniqueConstraintDefinitionId,
      table.logicalUniqueConstraintId,
    ),
    foreignKey({
      name: "fx_control_unique_constraint_definition_logical_fk",
      columns: [
        table.deploymentId,
        table.logicalUniqueConstraintId,
        table.tableId,
      ],
      foreignColumns: [
        fxControlUniqueConstraints.deploymentId,
        fxControlUniqueConstraints.logicalUniqueConstraintId,
        fxControlUniqueConstraints.tableId,
      ],
    }).onDelete("restrict"),
    check(
      "fx_control_unique_constraint_definition_deployment_non_empty_check",
      nonBlankText(table.deploymentId),
    ),
    check(
      "fx_control_unique_constraint_definition_id_positive_check",
      sql`${table.uniqueConstraintDefinitionId} between 1 and 2147483647`,
    ),
    check(
      "fx_control_unique_constraint_definition_logical_id_positive_check",
      sql`${table.logicalUniqueConstraintId} between 1 and 2147483647`,
    ),
    check(
      "fx_control_unique_constraint_definition_table_id_positive_check",
      sql`${table.tableId} between 1 and 2147483647`,
    ),
    check(
      "fx_control_unique_constraint_definition_spec_codec_check",
      sql`${table.physicalSpecCodecVersion} = 1`,
    ),
    check(
      "fx_control_unique_constraint_definition_spec_json_check",
      sql`
        (
          jsonb_typeof(${table.physicalSpecJson}) = 'object'
          and octet_length(${table.physicalSpecJson}::text) between 1 and ${sql.raw(
            String(MAX_CANONICAL_APP_UNIQUE_CONSTRAINT_SPEC_BYTES_V1),
          )}
          and (${table.physicalSpecJson} - 'keyCodecIdentity'
            - 'keyCodecVersion' - 'kind' - 'localePolicy'
            - 'orderedFields' - 'sparse' - 'specVersion') = '{}'::jsonb
          and ${table.physicalSpecJson} ->> 'kind' = 'appUniqueConstraint'
          and ${table.physicalSpecJson} -> 'specVersion' = '1'::jsonb
          and ${table.physicalSpecJson} ->> 'keyCodecIdentity'
            = 'flarex.unique-key/ordered-index-components/v1'
          and ${table.physicalSpecJson} -> 'keyCodecVersion' = '1'::jsonb
          and ${table.physicalSpecJson} -> 'localePolicy'
            = '{"kind":"none"}'::jsonb
          and jsonb_typeof(${table.physicalSpecJson} -> 'orderedFields') = 'array'
          and jsonb_array_length(${table.physicalSpecJson} -> 'orderedFields')
            between 1 and 15
          and jsonb_typeof(${table.physicalSpecJson} -> 'sparse') = 'boolean'
        ) is true
      `,
    ),
    check(
      "fx_control_unique_constraint_definition_spec_bytes_length_check",
      sql`octet_length(${table.physicalSpecBytes}) between 1 and ${sql.raw(
        String(MAX_CANONICAL_APP_UNIQUE_CONSTRAINT_SPEC_BYTES_V1),
      )}`,
    ),
    check(
      "fx_control_unique_constraint_definition_spec_sha256_length_check",
      sql`octet_length(${table.physicalSpecSha256}) = 32`,
    ),
  ],
);

export const fxControlSchemaVersionUniqueConstraintBindings = pgTable(
  "fx_control_schema_version_unique_constraint_binding",
  {
    deploymentId: text("deployment_id").notNull(),
    schemaVersionId: text("schema_version_id")
      .$type<CatalogSchemaVersionId>()
      .notNull(),
    logicalUniqueConstraintId: integer("logical_unique_constraint_id")
      .$type<CatalogUniqueConstraintId>()
      .notNull(),
    uniqueConstraintDefinitionId: integer("unique_constraint_definition_id")
      .$type<CatalogUniqueConstraintDefinitionId>()
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
      name: "fx_control_schema_unique_constraint_binding_pk",
      columns: [
        table.deploymentId,
        table.schemaVersionId,
        table.logicalUniqueConstraintId,
      ],
    }),
    foreignKey({
      name: "fx_control_schema_unique_constraint_binding_schema_fk",
      columns: [table.deploymentId, table.schemaVersionId],
      foreignColumns: [
        fxControlSchemaVersions.deploymentId,
        fxControlSchemaVersions.schemaVersionId,
      ],
    }).onDelete("restrict"),
    foreignKey({
      name: "fx_control_schema_unique_constraint_binding_definition_fk",
      columns: [
        table.deploymentId,
        table.uniqueConstraintDefinitionId,
        table.logicalUniqueConstraintId,
      ],
      foreignColumns: [
        fxControlUniqueConstraintDefinitions.deploymentId,
        fxControlUniqueConstraintDefinitions.uniqueConstraintDefinitionId,
        fxControlUniqueConstraintDefinitions.logicalUniqueConstraintId,
      ],
    }).onDelete("restrict"),
    check(
      "fx_control_schema_unique_constraint_binding_deployment_non_empty_check",
      nonBlankText(table.deploymentId),
    ),
    check(
      "fx_control_schema_unique_constraint_binding_schema_non_empty_check",
      nonBlankText(table.schemaVersionId),
    ),
    check(
      "fx_control_schema_unique_constraint_binding_logical_id_positive_check",
      sql`${table.logicalUniqueConstraintId} between 1 and 2147483647`,
    ),
    check(
      "fx_control_schema_unique_constraint_binding_definition_id_positive_check",
      sql`${table.uniqueConstraintDefinitionId} between 1 and 2147483647`,
    ),
    check(
      "fx_control_schema_unique_constraint_binding_required_check",
      sql`${table.requiredForActivation} is true`,
    ),
  ],
);

/** Immutable closure of one schema version's complete unique definition set. */
export const fxControlSchemaVersionUniqueConstraintSets = pgTable(
  "fx_control_schema_unique_constraint_set",
  {
    deploymentId: text("deployment_id").notNull(),
    schemaVersionId: text("schema_version_id")
      .$type<CatalogSchemaVersionId>()
      .notNull(),
    setCodecVersion: integer("set_codec_version")
      .$type<AppUniqueConstraintSetCodecVersionV1>()
      .notNull(),
    definitionCount: integer("definition_count").notNull(),
    definitionSetSha256: bytea("definition_set_sha256").notNull(),
    closedAt: timestamp("closed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({
      name: "fx_control_schema_unique_set_pk",
      columns: [table.deploymentId, table.schemaVersionId],
    }),
    foreignKey({
      name: "fx_control_schema_unique_set_schema_fk",
      columns: [table.deploymentId, table.schemaVersionId],
      foreignColumns: [
        fxControlSchemaVersions.deploymentId,
        fxControlSchemaVersions.schemaVersionId,
      ],
    }).onDelete("restrict"),
    check(
      "fx_control_schema_unique_set_deployment_check",
      nonBlankText(table.deploymentId),
    ),
    check(
      "fx_control_schema_unique_set_schema_check",
      nonBlankText(table.schemaVersionId),
    ),
    check(
      "fx_control_schema_unique_set_codec_check",
      sql`${table.setCodecVersion} = 1`,
    ),
    check(
      "fx_control_schema_unique_set_count_check",
      sql`${table.definitionCount} between 0 and 256`,
    ),
    check(
      "fx_control_schema_unique_set_digest_check",
      sql`octet_length(${table.definitionSetSha256}) = 32`,
    ),
    check(
      "fx_control_schema_unique_set_closed_at_check",
      sql`isfinite(${table.closedAt})`,
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
 * Inert, database-owned progress foundation for the one Task repair scheduler
 * associated with the control metadata database. E2A exposes no mutation
 * repository; the row grants neither scope authority nor attempt execution.
 */
export const fxSystemDurableTaskRepairSchedulerV1 = pgTable(
  "fx_system_durable_task_repair_scheduler_v1",
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
      "fx_system_durable_task_repair_scheduler_v1_key_check",
      sql`${table.schedulerKey} = ${sql.raw(`'${TASK_REPAIR_SCHEDULER_KEY_V1}'`)}`,
    ),
    check(
      "fx_system_durable_task_repair_scheduler_v1_state_check",
      sql`${table.schedulerState} in ('idle', 'claimed')`,
    ),
    check(
      "fx_system_durable_task_repair_scheduler_v1_fence_check",
      sql`${table.runFence} >= 0`,
    ),
    check(
      "fx_system_durable_task_repair_scheduler_v1_checkpoint_sequence_check",
      sql`${table.checkpointSequence} >= 0`,
    ),
    check(
      "fx_system_durable_task_repair_scheduler_v1_claim_check",
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
      "fx_system_durable_task_repair_scheduler_v1_continuation_check",
      sql`
        (
          ${table.continuationCodecVersion} is null
          and ${table.continuationBytes} is null
          and ${table.continuationSha256} is null
        )
        or
        (
          ${table.continuationCodecVersion} = ${sql.raw(
            String(TASK_REPAIR_SCHEDULER_CONTINUATION_CODEC_V1),
          )}
          and ${table.continuationBytes} is not null
          and octet_length(${table.continuationBytes}) between 1 and ${sql.raw(
            String(MAX_TASK_REPAIR_SCHEDULER_CONTINUATION_BYTES_V1),
          )}
          and ${table.continuationSha256} is not null
          and octet_length(${table.continuationSha256}) = 32
        )
      `,
    ),
    check(
      "fx_system_durable_task_repair_scheduler_v1_timestamp_check",
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
    executionAuthorityGeneration: text("execution_authority_generation")
      .$type<"legacy_dynamic_worker_v1" | "application_v1">()
      .notNull()
      .default("legacy_dynamic_worker_v1"),
    applicationExecutionAuthorityJson: jsonb(
      "application_execution_authority_json",
    ).$type<ApplicationMutationExecutionAuthorityV1>(),
    applicationExecutionAuthorityCanonicalBytes: bytea(
      "application_execution_authority_canonical_bytes",
    ),
    applicationExecutionAuthoritySha256: bytea(
      "application_execution_authority_sha256",
    ),
    packageId: text("package_id").$type<TransactionPackageIdV1>(),
    artifactRuntime: text("artifact_runtime")
      .$type<TransactionArtifactRuntimeV1>(),
    artifactId: text("artifact_id")
      .$type<TransactionArtifactIdV1>(),
    sourcePackageHash: text("source_package_hash")
      .$type<TransactionSourcePackageSha256HexV1>(),
    executionModule: text("execution_module")
      .$type<TransactionExecutionModuleV1>(),
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
      "fx_system_tx_session_execution_authority_check",
      sql`
        (${table.executionAuthorityGeneration} = 'legacy_dynamic_worker_v1'
          and ${table.packageId} is not null
          and ${nonBlankText(table.packageId)}
          and ${table.artifactRuntime} is not null
          and ${table.artifactRuntime} = 'dynamic-worker'
          and ${table.artifactId} is not null
          and ${table.artifactId} ~ '^artifact_[0-9a-f]{32}$'
          and ${table.sourcePackageHash} is not null
          and ${table.sourcePackageHash} ~ '^[0-9a-f]{64}$'
          and ${table.artifactId} = 'artifact_' || left(${table.sourcePackageHash}, 32)
          and ${table.executionModule} is not null
          and ${nonBlankText(table.executionModule)}
          and ${table.applicationExecutionAuthorityJson} is null
          and ${table.applicationExecutionAuthorityCanonicalBytes} is null
          and ${table.applicationExecutionAuthoritySha256} is null)
        or
        (${table.executionAuthorityGeneration} = 'application_v1'
          and ${table.packageId} is null
          and ${table.artifactRuntime} is null
          and ${table.artifactId} is null
          and ${table.sourcePackageHash} is null
          and ${table.executionModule} is null
          and ${table.applicationExecutionAuthorityJson} is not null
          and jsonb_typeof(${table.applicationExecutionAuthorityJson}) = 'object'
          and ${table.applicationExecutionAuthorityCanonicalBytes} is not null
          and octet_length(${table.applicationExecutionAuthorityCanonicalBytes}) between 1 and 131072
          and ${table.applicationExecutionAuthoritySha256} is not null
          and octet_length(${table.applicationExecutionAuthoritySha256}) = 32)
      `,
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
    indexedQuerySyscalls: integer("indexed_query_syscalls").notNull().default(0),
    indexRangeDependencyCount: integer("index_range_dependency_count")
      .notNull().default(0),
    indexRangeDependencyEvidenceBytes: integer(
      "index_range_dependency_evidence_bytes",
    ).notNull().default(0),
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
      "fx_system_tx_journal_indexed_query_count_check",
      sql`${table.indexedQuerySyscalls} between 0 and ${sql.raw(String(MAX_COMMIT_INDEXED_QUERY_SYSCALLS_V1))}`,
    ),
    check(
      "fx_system_tx_journal_index_range_count_check",
      sql`${table.indexRangeDependencyCount} between 0 and ${sql.raw(String(MAX_COMMIT_INDEX_RANGE_READ_DEPENDENCIES_V1))}`,
    ),
    check(
      "fx_system_tx_journal_index_range_evidence_bytes_check",
      sql`${table.indexRangeDependencyEvidenceBytes} between 0 and ${sql.raw(String(MAX_COMMIT_INDEX_RANGE_DEPENDENCY_EVIDENCE_BYTES_V1))}`,
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
            'indexedQuerySyscalls',
            'indexRangeReadDependencies',
            'indexRangeDependencyEvidenceBytes',
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
      sql`${table.operationKind} in ('get', 'insert', 'patch', 'replace', 'delete', 'indexRange')`,
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
        ${table.outcomeKind} in ('missing', 'present', 'inserted', 'unit', 'indexRangePage', 'error')
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

/** Canonically merged, bounded indexed-range OCC dependencies for one attempt. */
export const fxSystemTransactionJournalIndexRanges = pgTable(
  "fx_system_tx_journal_index_range",
  {
    scopeUuid: uuid("scope_uuid").$type<ScopeUuidV1>().notNull(),
    sessionId: uuid("session_id").$type<TransactionSessionIdV1>().notNull(),
    attemptFence: bigint("attempt_fence", { mode: "bigint" })
      .$type<TransactionAttemptFence>().notNull(),
    ordinal: integer("ordinal").notNull(),
    tableId: integer("table_id").$type<CatalogTableId>().notNull(),
    indexDefinitionId: integer("index_definition_id")
      .$type<CatalogIndexDefinitionId>().notNull(),
    keyCodecVersion: integer("key_codec_version")
      .$type<OrderedIndexKeyCodecVersion>().notNull(),
    physicalSpecSha256: bytea("physical_spec_sha256").notNull(),
    direction: text("direction").$type<"asc">().notNull(),
    lowerKind: text("lower_kind")
      .$type<"unbounded" | "key_inclusive">().notNull(),
    lowerEncodedKey: bytea("lower_encoded_key"),
    upperKind: text("upper_kind")
      .$type<"unbounded" | "key_exclusive" | "position_inclusive">()
      .notNull(),
    upperEncodedKey: bytea("upper_encoded_key"),
    upperRowId: bytea("upper_row_id"),
    evidenceBytes: integer("evidence_bytes").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    primaryKey({
      name: "fx_system_tx_journal_index_range_pk",
      columns: [
        table.scopeUuid,
        table.sessionId,
        table.attemptFence,
        table.ordinal,
      ],
    }),
    foreignKey({
      name: "fx_system_tx_journal_index_range_root_fk",
      columns: [table.scopeUuid, table.sessionId, table.attemptFence],
      foreignColumns: [
        fxSystemTransactionJournals.scopeUuid,
        fxSystemTransactionJournals.sessionId,
        fxSystemTransactionJournals.attemptFence,
      ],
    }).onUpdate("restrict").onDelete("cascade"),
    check(
      "fx_system_tx_journal_index_range_identity_check",
      sql`
        ${table.attemptFence} >= 1
        and ${table.ordinal} between 0 and ${sql.raw(String(MAX_COMMIT_INDEX_RANGE_READ_DEPENDENCIES_V1 - 1))}
        and ${table.tableId} between 1 and 2147483647
        and ${table.indexDefinitionId} between 1 and 2147483647
        and ${table.keyCodecVersion} = 1
        and octet_length(${table.physicalSpecSha256}) = 32
        and ${table.direction} = 'asc'
        and ${table.evidenceBytes} between 1 and ${sql.raw(String(MAX_COMMIT_INDEX_RANGE_DEPENDENCY_EVIDENCE_BYTES_V1))}
      `,
    ),
    check(
      "fx_system_tx_journal_index_range_lower_check",
      sql`
        (
          ${table.lowerKind} = 'unbounded'
          and ${table.lowerEncodedKey} is null
        )
        or (
          ${table.lowerKind} = 'key_inclusive'
          and ${table.lowerEncodedKey} is not null
          and octet_length(${table.lowerEncodedKey}) between 0 and ${sql.raw(String(MAX_ORDERED_INDEX_BOUND_BYTES_V1))}
        )
      `,
    ),
    check(
      "fx_system_tx_journal_index_range_upper_check",
      sql`
        (
          ${table.upperKind} = 'unbounded'
          and ${table.upperEncodedKey} is null
          and ${table.upperRowId} is null
        )
        or (
          ${table.upperKind} = 'key_exclusive'
          and ${table.upperEncodedKey} is not null
          and octet_length(${table.upperEncodedKey}) between 0 and ${sql.raw(String(MAX_ORDERED_INDEX_BOUND_BYTES_V1))}
          and ${table.upperRowId} is null
        )
        or (
          ${table.upperKind} = 'position_inclusive'
          and ${table.upperEncodedKey} is not null
          and octet_length(${table.upperEncodedKey}) between 0 and ${sql.raw(String(MAX_ORDERED_INDEX_KEY_BYTES_V1))}
          and ${table.upperRowId} is not null
          and octet_length(${table.upperRowId}) = 16
        )
      `,
    ),
    check(
      "fx_system_tx_journal_index_range_timestamp_check",
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
    uniqueIndex("fx_app_row_rev_first_identity_unique").on(
      table.scopeUuid,
      table.tableId,
      table.rowId,
    ).where(sql`${table.prevCommitSeq} is null`),
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
 * Immutable target-local history for one physical ordered-index position.
 *
 * Each revision is tied to the exact same-commit authoritative app-row
 * revision. A tombstone removes only this encoded-key/row position; C08 later
 * owns deriving those revisions from final row bodies inside the existing
 * commit transaction.
 */
export const fxAppIndexEntryRevisions = pgTable(
  "fx_app_index_entry_rev",
  {
    scopeUuid: uuid("scope_uuid").$type<ScopeUuidV1>().notNull(),
    indexDefinitionId: integer("index_definition_id")
      .$type<CatalogIndexDefinitionId>()
      .notNull(),
    tableId: integer("table_id").$type<CatalogTableId>().notNull(),
    keyCodecVersion: integer("key_codec_version")
      .$type<OrderedIndexKeyCodecVersion>()
      .notNull(),
    physicalSpecSha256: bytea("physical_spec_sha256").notNull(),
    encodedKey: bytea("encoded_key").notNull(),
    keySha256: bytea("key_sha256").notNull(),
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
    isTombstone: boolean("is_tombstone").notNull(),
  },
  (table) => [
    primaryKey({
      name: "fx_app_index_entry_rev_pk",
      columns: [
        table.scopeUuid,
        table.indexDefinitionId,
        table.encodedKey,
        table.rowId,
        table.commitSeq,
      ],
    }),
    foreignKey({
      name: "fx_app_index_entry_rev_row_revision_fk",
      columns: [
        table.scopeUuid,
        table.tableId,
        table.rowId,
        table.writeEpochUuid,
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
    index("fx_app_index_entry_rev_range_idx").on(
      table.scopeUuid,
      table.indexDefinitionId,
      table.encodedKey,
      table.rowId,
      table.commitSeq.desc(),
    ),
    index("fx_app_index_entry_rev_commit_range_idx").on(
      table.scopeUuid,
      table.indexDefinitionId,
      table.commitSeq,
      table.encodedKey,
      table.rowId,
    ),
    check(
      "fx_app_index_entry_rev_definition_id_check",
      sql`${table.indexDefinitionId} between 1 and 2147483647`,
    ),
    check(
      "fx_app_index_entry_rev_table_id_check",
      sql`${table.tableId} between 1 and 2147483647`,
    ),
    check(
      "fx_app_index_entry_rev_key_codec_check",
      sql`${table.keyCodecVersion} = 1`,
    ),
    check(
      "fx_app_index_entry_rev_spec_sha256_length_check",
      sql`octet_length(${table.physicalSpecSha256}) = 32`,
    ),
    check(
      "fx_app_index_entry_rev_encoded_key_length_check",
      sql`octet_length(${table.encodedKey}) between 1 and ${sql.raw(
        String(MAX_ORDERED_INDEX_KEY_BYTES_V1),
      )}`,
    ),
    check(
      "fx_app_index_entry_rev_key_sha256_length_check",
      sql`octet_length(${table.keySha256}) = 32`,
    ),
    check(
      "fx_app_index_entry_rev_row_id_length_check",
      sql`octet_length(${table.rowId}) = 16`,
    ),
    check(
      "fx_app_index_entry_rev_commit_seq_check",
      sql`${table.commitSeq} >= 1`,
    ),
    check(
      "fx_app_index_entry_rev_prev_commit_seq_check",
      sql`${table.prevCommitSeq} is null or (${table.prevCommitSeq} >= 1 and ${table.prevCommitSeq} < ${table.commitSeq})`,
    ),
  ],
);

/**
 * Epoch-independent live pointer for one ordered-index position.
 *
 * The row contains no duplicated value or lifecycle evidence. Tombstones
 * remove this range-facing pointer while immutable history retains chain-head
 * provenance for later key reuse.
 */
export const fxAppIndexEntryCurrent = pgTable(
  "fx_app_index_entry_current",
  {
    scopeUuid: uuid("scope_uuid").$type<ScopeUuidV1>().notNull(),
    indexDefinitionId: integer("index_definition_id")
      .$type<CatalogIndexDefinitionId>()
      .notNull(),
    encodedKey: bytea("encoded_key").notNull(),
    rowId: bytea("row_id").notNull(),
    commitSeq: bigint("commit_seq", { mode: "bigint" })
      .$type<CommitSeq>()
      .notNull(),
  },
  (table) => [
    primaryKey({
      name: "fx_app_index_entry_current_pk",
      columns: [
        table.scopeUuid,
        table.indexDefinitionId,
        table.encodedKey,
        table.rowId,
      ],
    }),
    index("fx_app_index_entry_current_scope_definition_row_idx").on(
      table.scopeUuid,
      table.indexDefinitionId,
      table.rowId,
    ),
    foreignKey({
      name: "fx_app_index_entry_current_revision_fk",
      columns: [
        table.scopeUuid,
        table.indexDefinitionId,
        table.encodedKey,
        table.rowId,
        table.commitSeq,
      ],
      foreignColumns: [
        fxAppIndexEntryRevisions.scopeUuid,
        fxAppIndexEntryRevisions.indexDefinitionId,
        fxAppIndexEntryRevisions.encodedKey,
        fxAppIndexEntryRevisions.rowId,
        fxAppIndexEntryRevisions.commitSeq,
      ],
    })
      .onUpdate("restrict")
      .onDelete("restrict"),
    check(
      "fx_app_index_entry_current_definition_id_check",
      sql`${table.indexDefinitionId} between 1 and 2147483647`,
    ),
    check(
      "fx_app_index_entry_current_encoded_key_length_check",
      sql`octet_length(${table.encodedKey}) between 1 and ${sql.raw(
        String(MAX_ORDERED_INDEX_KEY_BYTES_V1),
      )}`,
    ),
    check(
      "fx_app_index_entry_current_row_id_length_check",
      sql`octet_length(${table.rowId}) = 16`,
    ),
    check(
      "fx_app_index_entry_current_commit_seq_check",
      sql`${table.commitSeq} >= 1`,
    ),
  ],
);

/**
 * Current target-native occupancy for one declared unique-key slot.
 *
 * The authoritative value remains the exact app-row revision referenced below.
 * C08 later owns deriving these rows from trusted constraint definitions and
 * final row bodies inside the existing commit transaction.
 */
export const fxAppUniqueKeys = pgTable(
  "fx_app_unique_key",
  {
    scopeUuid: uuid("scope_uuid").$type<ScopeUuidV1>().notNull(),
    constraintId: integer("constraint_id")
      .$type<AppUniqueConstraintIdV1>()
      .notNull(),
    localeKey: text("locale_key").notNull(),
    canonicalKeySha256: bytea("canonical_key_sha256").notNull(),
    keyCodecVersion: integer("key_codec_version")
      .$type<OrderedIndexKeyCodecVersion>()
      .notNull(),
    encodedKey: bytea("encoded_key").notNull(),
    tableId: integer("table_id").$type<CatalogTableId>().notNull(),
    rowId: bytea("row_id").notNull(),
    schemaVersionId: text("schema_version_id")
      .$type<CatalogSchemaVersionId>()
      .notNull(),
    writeEpochUuid: uuid("write_epoch_uuid")
      .$type<ScopeEpochUuidV1>()
      .notNull(),
    commitSeq: bigint("commit_seq", { mode: "bigint" })
      .$type<CommitSeq>()
      .notNull(),
  },
  (table) => [
    primaryKey({
      name: "fx_app_unique_key_pk",
      columns: [
        table.scopeUuid,
        table.constraintId,
        table.localeKey,
        table.canonicalKeySha256,
      ],
    }),
    unique("fx_app_unique_key_owner_unique").on(
      table.scopeUuid,
      table.constraintId,
      table.localeKey,
      table.tableId,
      table.rowId,
    ),
    foreignKey({
      name: "fx_app_unique_key_scope_clock_fk",
      columns: [table.scopeUuid],
      foreignColumns: [fxSystemScopeClocks.scopeUuid],
    }).onDelete("restrict"),
    foreignKey({
      name: "fx_app_unique_key_row_revision_fk",
      columns: [
        table.scopeUuid,
        table.tableId,
        table.rowId,
        table.writeEpochUuid,
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
      "fx_app_unique_key_constraint_id_check",
      sql`${table.constraintId} between 1 and ${sql.raw(
        String(MAX_APP_UNIQUE_CONSTRAINT_ID_V1),
      )}`,
    ),
    check(
      "fx_app_unique_key_locale_key_check",
      sql`${table.localeKey} = '' or (octet_length(${table.localeKey}) between 1 and ${sql.raw(
        String(MAX_APP_UNIQUE_LOCALE_KEY_BYTES_V1),
      )} and ${table.localeKey} ~ '^[a-z0-9]{1,8}(-[a-z0-9]{1,8})*$')`,
    ),
    check(
      "fx_app_unique_key_digest_length_check",
      sql`octet_length(${table.canonicalKeySha256}) = 32`,
    ),
    check(
      "fx_app_unique_key_codec_version_check",
      sql`${table.keyCodecVersion} = 1`,
    ),
    check(
      "fx_app_unique_key_encoded_key_length_check",
      sql`octet_length(${table.encodedKey}) between 1 and ${sql.raw(
        String(MAX_ORDERED_INDEX_KEY_BYTES_V1),
      )}`,
    ),
    check(
      "fx_app_unique_key_table_id_check",
      sql`${table.tableId} between 1 and 2147483647`,
    ),
    check(
      "fx_app_unique_key_row_id_length_check",
      sql`octet_length(${table.rowId}) = 16`,
    ),
    check(
      "fx_app_unique_key_schema_version_id_check",
      nonBlankText(table.schemaVersionId),
    ),
    check(
      "fx_app_unique_key_commit_seq_check",
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

/** One fenced build/readiness row for a schema version's closed unique set. */
export const fxSystemUniqueConstraintSetBuilds = pgTable(
  "fx_system_unique_constraint_set_build",
  {
    scopeId: text("scope_id").$type<ScopeId>().notNull(),
    schemaVersionId: text("schema_version_id")
      .$type<CatalogSchemaVersionId>()
      .notNull(),
    setCodecVersion: integer("set_codec_version")
      .$type<AppUniqueConstraintSetCodecVersionV1>()
      .notNull(),
    definitionCount: integer("definition_count").notNull(),
    definitionSetSha256: bytea("definition_set_sha256").notNull(),
    storageGeneration: text("storage_generation")
      .$type<FlarexDbV1StorageGeneration>()
      .notNull(),
    storageGenerationFence: bigint("storage_generation_fence", {
      mode: "bigint",
    }).$type<StorageGenerationFence>().notNull(),
    epoch: text("epoch").$type<ScopeEpoch>().notNull(),
    startCommitSeq: bigint("start_commit_seq", { mode: "bigint" })
      .$type<CommitSeq>()
      .notNull(),
    lifecycle: text("lifecycle")
      .$type<AppUniqueConstraintSetBuildLifecycleV1>()
      .notNull(),
    cursorCodecVersion: integer("cursor_codec_version")
      .$type<AppUniqueConstraintSetBuildCursorCodecVersionV1>()
      .notNull(),
    cursorDefinitionId: integer("cursor_definition_id")
      .$type<CatalogUniqueConstraintDefinitionId>(),
    cursorRowId: bytea("cursor_row_id"),
    attemptFence: bigint("attempt_fence", { mode: "bigint" })
      .$type<AppUniqueConstraintSetBuildAttemptFenceV1>()
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
      name: "fx_system_unique_set_build_pk",
      columns: [table.scopeId, table.schemaVersionId],
    }),
    foreignKey({
      name: "fx_system_unique_set_build_scope_fk",
      columns: [table.scopeId],
      foreignColumns: [fxSystemScopeClocks.scopeId],
    }).onDelete("restrict"),
    check("fx_system_unique_set_build_scope_check", nonBlankText(table.scopeId)),
    check(
      "fx_system_unique_set_build_schema_check",
      nonBlankText(table.schemaVersionId),
    ),
    check(
      "fx_system_unique_set_build_identity_check",
      sql`${table.setCodecVersion} = 1
        and ${table.definitionCount} between 0 and 256
        and octet_length(${table.definitionSetSha256}) = 32`,
    ),
    check(
      "fx_system_unique_set_build_clock_check",
      sql`${table.storageGeneration} = 'flarexdb_v1'
        and ${table.storageGenerationFence} >= 1
        and ${nonBlankText(table.epoch)}
        and ${table.startCommitSeq} >= 0`,
    ),
    check(
      "fx_system_unique_set_build_lifecycle_check",
      sql`${table.lifecycle} in ('declared', 'building', 'backfilling', 'validating', 'enabled')`,
    ),
    check(
      "fx_system_unique_set_build_cursor_check",
      sql`${table.cursorCodecVersion} = 1
        and (${table.cursorDefinitionId} is null or ${table.cursorDefinitionId} between 1 and 2147483647)
        and (${table.cursorRowId} is null or octet_length(${table.cursorRowId}) = 16)
        and (${table.cursorDefinitionId} is not null or ${table.cursorRowId} is null)
        and (${table.lifecycle} not in ('declared', 'building', 'enabled')
          or (${table.cursorDefinitionId} is null and ${table.cursorRowId} is null))`,
    ),
    check(
      "fx_system_unique_set_build_attempt_check",
      sql`${table.attemptFence} >= 1`,
    ),
    check(
      "fx_system_unique_set_build_time_check",
      sql`isfinite(${table.createdAt}) and isfinite(${table.updatedAt})
        and ${table.updatedAt} >= ${table.createdAt}`,
    ),
  ],
);

/**
 * One target-local non-active app-schema validation head per scope.
 *
 * The canonical frame is the semantic authority. Scalar columns are bounded
 * lock/CAS and metadata-first admission evidence only; user documents remain
 * exclusively in authoritative app-row revision storage.
 */
export const fxSystemAppSchemaCandidateValidations = pgTable(
  "fx_system_app_schema_candidate_validation",
  {
    scopeId: text("scope_id").$type<ScopeId>().notNull(),
    deploymentId: text("deployment_id").notNull(),
    schemaVersionId: text("schema_version_id")
      .$type<CatalogSchemaVersionId>()
      .notNull(),
    schemaManifestSha256: bytea("schema_manifest_sha256").notNull(),
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
      .$type<AppSchemaCandidateValidationAttemptFenceV1>()
      .notNull(),
    frameCodecVersion: integer("frame_codec_version")
      .$type<AppSchemaCandidateValidationCodecVersionV1>()
      .notNull(),
    frameKind: text("frame_kind")
      .$type<AppSchemaCandidateValidationFrameV1["kind"]>()
      .notNull(),
    frameByteLength: bigint("frame_byte_length", { mode: "bigint" })
      .notNull(),
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
    primaryKey({
      name: "fx_system_app_schema_candidate_validation_pk",
      columns: [table.scopeId],
    }),
    foreignKey({
      name: "fx_system_app_schema_candidate_validation_scope_fk",
      columns: [table.scopeId],
      foreignColumns: [fxSystemScopeClocks.scopeId],
    }).onDelete("restrict"),
    check(
      "fx_system_app_schema_candidate_validation_identity_check",
      sql`${nonBlankText(table.scopeId)}
        and ${nonBlankText(table.deploymentId)}
        and ${nonBlankText(table.schemaVersionId)}
        and octet_length(${table.schemaManifestSha256}) = 32`,
    ),
    check(
      "fx_system_app_schema_candidate_validation_clock_check",
      sql`${table.storageGeneration} = 'flarexdb_v1'
        and ${table.storageGenerationFence} >= 1
        and ${nonBlankText(table.epoch)}
        and ${table.frontierCommitSeq} >= 0
        and ${table.attemptFence} >= 1`,
    ),
    check(
      "fx_system_app_schema_candidate_validation_frame_check",
      sql`${table.frameCodecVersion} = 1
        and ${table.frameKind} in (
          'app_schema_candidate_validation_progress',
          'app_schema_candidate_validation_failure_evidence',
          'app_schema_candidate_validation_receipt'
        )
        and ${table.frameByteLength} between 1 and ${sql.raw(String(MAX_APP_SCHEMA_CANDIDATE_VALIDATION_CANONICAL_FRAME_BYTES_V1))}
        and octet_length(${table.frameBytes}) = ${table.frameByteLength}
        and octet_length(${table.frameSha256}) = 32`,
    ),
    check(
      "fx_system_app_schema_candidate_validation_time_check",
      sql`isfinite(${table.createdAt}) and isfinite(${table.updatedAt})
        and ${table.updatedAt} >= ${table.createdAt}`,
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

export const fxSystemDeclarativeV2RuntimeProjections = pgTable(
  "fx_system_declarative_v2_runtime_projection",
  {
    scopeId: text("scope_id").$type<ScopeId>().notNull(),
    candidateSha256: bytea("candidate_sha256").notNull(),
    executionGroup: text("execution_group")
      .$type<DeclarativeV2RuntimeExecutionGroupV1>()
      .notNull(),
    executionModule: text("execution_module").notNull(),
    moduleCount: bigint("module_count", { mode: "bigint" }).notNull(),
    rawByteLength: bigint("raw_byte_length", { mode: "bigint" }).notNull(),
    moduleRootSha256: bytea("module_root_sha256").notNull(),
    objectStoreIdentity: text("object_store_identity").notNull(),
    objectCodecIdentity: text("object_codec_identity").notNull(),
    objectKey: text("object_key").notNull(),
    objectByteLength: bigint("object_byte_length", { mode: "bigint" }).notNull(),
    objectSha256: bytea("object_sha256").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({
      columns: [table.scopeId, table.candidateSha256, table.executionGroup],
    }),
    foreignKey({
      name: "fx_dv2_runtime_projection_candidate_fk",
      columns: [table.scopeId, table.candidateSha256],
      foreignColumns: [
        fxSystemDeclarativeV2Candidates.scopeId,
        fxSystemDeclarativeV2Candidates.candidateSha256,
      ],
    }).onDelete("restrict"),
    check(
      "fx_dv2_runtime_projection_group_check",
      sql`${table.executionGroup} in ('transaction', 'edge_action')`,
    ),
    check(
      "fx_dv2_runtime_projection_authority_check",
      sql`${nonBlankText(table.executionModule)}
        and ${table.moduleCount} >= 1
        and ${table.rawByteLength} >= 1
        and octet_length(${table.moduleRootSha256}) = 32
        and ${table.objectStoreIdentity} = 'flarex.r2/declarative-v2-runtime-artifact/v1'
        and ${table.objectCodecIdentity} = 'flarex.declarative-v2/runtime-projection/v1'
        and ${nonBlankText(table.objectKey)}
        and ${table.objectByteLength} >= 1
        and octet_length(${table.objectSha256}) = 32`,
    ),
    check(
      "fx_dv2_runtime_projection_created_check",
      sql`isfinite(${table.createdAt})`,
    ),
  ],
);

export const fxSystemDeclarativeV2RuntimeProjectionModules = pgTable(
  "fx_system_declarative_v2_runtime_projection_module",
  {
    scopeId: text("scope_id").$type<ScopeId>().notNull(),
    candidateSha256: bytea("candidate_sha256").notNull(),
    executionGroup: text("execution_group")
      .$type<DeclarativeV2RuntimeExecutionGroupV1>()
      .notNull(),
    moduleOrdinal: bigint("module_ordinal", { mode: "bigint" }).notNull(),
    modulePath: text("module_path").notNull(),
    roles: bigint("roles", { mode: "bigint" }).notNull(),
    sourceByteLength: bigint("source_byte_length", { mode: "bigint" }).notNull(),
    sourceSha256: bytea("source_sha256").notNull(),
    objectStoreIdentity: text("object_store_identity").notNull(),
    objectCodecIdentity: text("object_codec_identity").notNull(),
    objectKey: text("object_key").notNull(),
    objectByteLength: bigint("object_byte_length", { mode: "bigint" }).notNull(),
    objectSha256: bytea("object_sha256").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({
      columns: [
        table.scopeId,
        table.candidateSha256,
        table.executionGroup,
        table.moduleOrdinal,
      ],
    }),
    foreignKey({
      name: "fx_dv2_runtime_module_projection_fk",
      columns: [
        table.scopeId,
        table.candidateSha256,
        table.executionGroup,
      ],
      foreignColumns: [
        fxSystemDeclarativeV2RuntimeProjections.scopeId,
        fxSystemDeclarativeV2RuntimeProjections.candidateSha256,
        fxSystemDeclarativeV2RuntimeProjections.executionGroup,
      ],
    }).onDelete("restrict"),
    check(
      "fx_dv2_runtime_module_ordinal_check",
      sql`${table.moduleOrdinal} >= 0`,
    ),
    check(
      "fx_dv2_runtime_module_authority_check",
      sql`${nonBlankText(table.modulePath)}
        and ${table.roles} >= 0
        and ${table.sourceByteLength} >= 1
        and octet_length(${table.sourceSha256}) = 32
        and ${table.objectStoreIdentity} = 'flarex.r2/declarative-v2-runtime-artifact/v1'
        and ${table.objectCodecIdentity} = 'flarex.declarative-v2/runtime-projection/v1'
        and ${nonBlankText(table.objectKey)}
        and ${table.objectByteLength} >= 1
        and octet_length(${table.objectSha256}) = 32`,
    ),
    check(
      "fx_dv2_runtime_module_created_check",
      sql`isfinite(${table.createdAt})`,
    ),
  ],
);

export const fxSystemDeclarativeV2FunctionGroupManifests = pgTable(
  "fx_system_declarative_v2_function_group_manifest",
  {
    scopeId: text("scope_id").$type<ScopeId>().notNull(),
    candidateSha256: bytea("candidate_sha256").notNull(),
    projectionSetObjectStoreIdentity:
      text("projection_set_object_store_identity").notNull(),
    projectionSetObjectCodecIdentity:
      text("projection_set_object_codec_identity").notNull(),
    projectionSetObjectKey: text("projection_set_object_key").notNull(),
    projectionSetObjectByteLength:
      bigint("projection_set_object_byte_length", { mode: "bigint" }).notNull(),
    projectionSetSha256: bytea("projection_set_sha256").notNull(),
    manifestObjectStoreIdentity:
      text("manifest_object_store_identity").notNull(),
    manifestObjectCodecIdentity:
      text("manifest_object_codec_identity").notNull(),
    manifestObjectKey: text("manifest_object_key").notNull(),
    manifestObjectByteLength:
      bigint("manifest_object_byte_length", { mode: "bigint" }).notNull(),
    manifestSha256: bytea("manifest_sha256").notNull(),
    functionCount: bigint("function_count", { mode: "bigint" }).notNull(),
    functionRootSha256: bytea("function_root_sha256").notNull(),
    validatorRootSha256: bytea("validator_root_sha256").notNull(),
    declaredHandlerSetSha256: bytea("declared_handler_set_sha256").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.scopeId, table.candidateSha256] }),
    foreignKey({
      name: "fx_dv2_function_group_manifest_candidate_fk",
      columns: [table.scopeId, table.candidateSha256],
      foreignColumns: [
        fxSystemDeclarativeV2Candidates.scopeId,
        fxSystemDeclarativeV2Candidates.candidateSha256,
      ],
    }).onDelete("restrict"),
    check(
      "fx_dv2_function_group_manifest_projection_set_check",
      sql`${table.projectionSetObjectStoreIdentity} = 'flarex.r2/declarative-v2-runtime-artifact/v1'
        and ${table.projectionSetObjectCodecIdentity} = 'flarex.declarative-v2/runtime-projection/v1'
        and ${nonBlankText(table.projectionSetObjectKey)}
        and ${table.projectionSetObjectByteLength} >= 1
        and octet_length(${table.projectionSetSha256}) = 32
        and ${table.manifestObjectStoreIdentity} = 'flarex.r2/declarative-v2-runtime-artifact/v1'
        and ${table.manifestObjectCodecIdentity} = 'flarex.declarative-v2/function-group-manifest/v1'
        and ${nonBlankText(table.manifestObjectKey)}
        and ${table.manifestObjectByteLength} >= 1
        and octet_length(${table.manifestSha256}) = 32`,
    ),
    check(
      "fx_dv2_function_group_manifest_authority_check",
      sql`${table.functionCount} >= 0
        and octet_length(${table.functionRootSha256}) = 32
        and octet_length(${table.validatorRootSha256}) = 32
        and octet_length(${table.declaredHandlerSetSha256}) = 32`,
    ),
    check(
      "fx_dv2_function_group_manifest_created_check",
      sql`isfinite(${table.createdAt})`,
    ),
  ],
);

export const fxSystemDeclarativeV2FunctionGroupEntries = pgTable(
  "fx_system_declarative_v2_function_group_entry",
  {
    scopeId: text("scope_id").$type<ScopeId>().notNull(),
    candidateSha256: bytea("candidate_sha256").notNull(),
    functionOrdinal: bigint("function_ordinal", { mode: "bigint" }).notNull(),
    functionPath: text("function_path").notNull(),
    executionModule: text("execution_module").notNull(),
    exportName: text("export_name").notNull(),
    handlerKind: text("handler_kind").notNull(),
    visibility: text("visibility").notNull(),
    executionGroup: text("execution_group")
      .$type<DeclarativeV2RuntimeExecutionGroupV1>()
      .notNull(),
    projectionSha256: bytea("projection_sha256").notNull(),
    objectStoreIdentity: text("object_store_identity").notNull(),
    objectCodecIdentity: text("object_codec_identity").notNull(),
    objectKey: text("object_key").notNull(),
    objectByteLength: bigint("object_byte_length", { mode: "bigint" }).notNull(),
    objectSha256: bytea("object_sha256").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({
      columns: [table.scopeId, table.candidateSha256, table.functionOrdinal],
    }),
    foreignKey({
      name: "fx_dv2_function_group_entry_manifest_fk",
      columns: [table.scopeId, table.candidateSha256],
      foreignColumns: [
        fxSystemDeclarativeV2FunctionGroupManifests.scopeId,
        fxSystemDeclarativeV2FunctionGroupManifests.candidateSha256,
      ],
    }).onDelete("restrict"),
    check(
      "fx_dv2_function_group_entry_ordinal_check",
      sql`${table.functionOrdinal} >= 0`,
    ),
    check(
      "fx_dv2_function_group_entry_authority_check",
      sql`${nonBlankText(table.functionPath)}
        and ${nonBlankText(table.executionModule)}
        and ${nonBlankText(table.exportName)}
        and ${table.handlerKind} in ('query', 'mutation', 'workflowMutation', 'action')
        and ${table.visibility} in ('public', 'internal')
        and ${table.executionGroup} in ('transaction', 'edge_action')
        and octet_length(${table.projectionSha256}) = 32
        and ${table.objectStoreIdentity} = 'flarex.r2/declarative-v2-runtime-artifact/v1'
        and ${table.objectCodecIdentity} = 'flarex.declarative-v2/function-group-manifest/v1'
        and ${nonBlankText(table.objectKey)}
        and ${table.objectByteLength} >= 1
        and octet_length(${table.objectSha256}) = 32`,
    ),
    check(
      "fx_dv2_function_group_entry_created_check",
      sql`isfinite(${table.createdAt})`,
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
 * The superseded, production-inert V1 progress island was retired after the
 * V2 repository became the sole non-test consumer.
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

/**
 * Private authenticated-command continuity. This is deliberately separate
 * from the stable V2 command row: the V2 reservation/receipt identity stays
 * unchanged while authenticated hosts can require durable pre-execution
 * intent and terminal analysis authority.
 */
export const fxSystemDeclarativeV2VerifierCommandAuthorityV1 = pgTable(
  "fx_system_declarative_v2_verifier_command_authority_v1",
  {
    scopeId: text("scope_id").$type<ScopeId>().notNull(),
    attemptSha256: bytea("attempt_sha256").notNull(),
    sequence: bigint("sequence", { mode: "bigint" }).notNull(),
    commandKind: text("command_kind")
      .$type<DeclarativeV2VerifierDurableCommandKindV2>()
      .notNull(),
    reservationSha256: bytea("reservation_sha256").notNull(),
    reservedByFence: bigint("reserved_by_fence", { mode: "bigint" }).notNull(),
    reservedAt: timestamp("reserved_at", { withTimezone: true }).notNull(),
    futureRegistrationIntentCodecVersion: integer(
      "future_registration_intent_codec_version",
    ),
    futureRegistrationIntentByteLength: bigint(
      "future_registration_intent_byte_length",
      { mode: "bigint" },
    ),
    futureRegistrationIntentSha256: bytea(
      "future_registration_intent_sha256",
    ),
    futureRegistrationIntentBytes: bytea(
      "future_registration_intent_bytes",
    ),
    terminalProofCodecVersion: integer("terminal_proof_codec_version"),
    terminalProofByteLength: bigint("terminal_proof_byte_length", {
      mode: "bigint",
    }),
    terminalProofSha256: bytea("terminal_proof_sha256"),
    terminalProofBytes: bytea("terminal_proof_bytes"),
    settledAt: timestamp("settled_at", { withTimezone: true }),
  },
  (table) => [
    primaryKey({
      columns: [table.scopeId, table.attemptSha256, table.sequence],
    }),
    unique("fx_dv2_command_authority_v1_identity_unique").on(
      table.scopeId,
      table.attemptSha256,
      table.sequence,
      table.reservationSha256,
      table.commandKind,
    ),
    foreignKey({
      name: "fx_dv2_command_authority_v1_command_fk",
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
      "fx_dv2_command_authority_v1_identity_check",
      sql`${table.sequence} >= 1
        and ${table.commandKind} in (
          'source_page', 'parse_module', 'link_page', 'registration_page'
        )
        and octet_length(${table.attemptSha256}) = 32
        and octet_length(${table.reservationSha256}) = 32
        and ${table.reservedByFence} >= 1
        and isfinite(${table.reservedAt})`,
    ),
    check(
      "fx_dv2_command_authority_v1_intent_check",
      sql`(
        (
          ${table.commandKind} in ('source_page', 'parse_module')
          and ${nullableFrameAbsent(
            table.futureRegistrationIntentCodecVersion,
            table.futureRegistrationIntentByteLength,
            table.futureRegistrationIntentSha256,
            table.futureRegistrationIntentBytes,
          )}
        )
        or
        (
          ${table.commandKind} in ('link_page', 'registration_page')
          and ${requiredFrameCheck(
            table.futureRegistrationIntentCodecVersion,
            table.futureRegistrationIntentByteLength,
            table.futureRegistrationIntentSha256,
            table.futureRegistrationIntentBytes,
          )}
        )
      ) is true`,
    ),
    check(
      "fx_dv2_command_authority_v1_terminal_check",
      sql`(
        (
          ${nullableFrameAbsent(
            table.terminalProofCodecVersion,
            table.terminalProofByteLength,
            table.terminalProofSha256,
            table.terminalProofBytes,
          )}
          and ${table.settledAt} is null
        )
        or
        (
          ${requiredFrameCheck(
            table.terminalProofCodecVersion,
            table.terminalProofByteLength,
            table.terminalProofSha256,
            table.terminalProofBytes,
          )}
          and ${table.settledAt} is not null
          and isfinite(${table.settledAt})
          and ${table.settledAt} >= ${table.reservedAt}
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
    unique("fx_application_task_catalog_v1_runtime_fk_unique").on(
      table.scopeId,
      table.revisionId,
      table.candidateId,
      table.taskCatalogSha256,
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
        and length(${table.runtimeHostIdentity}) between 1 and 256
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

/** Immutable task-runtime publication receipt under one Application catalog. */
export const fxSystemApplicationTaskRuntimePublicationsV1 = pgTable(
  "fx_system_application_task_runtime_publication_v1",
  {
    scopeId: text("scope_id").$type<ScopeId>().notNull(),
    revisionId: text("revision_id").notNull(),
    candidateId: text("candidate_id").notNull(),
    taskCatalogSha256: bytea("task_catalog_sha256").notNull(),
    taskCatalogBindingSha256: bytea("task_catalog_binding_sha256").notNull(),
    candidateSha256: bytea("candidate_sha256").notNull(),
    applicationRevisionTaskBindingSha256:
      bytea("application_revision_task_binding_sha256").notNull(),
    taskEntryRootSha256: bytea("task_entry_root_sha256").notNull(),
    taskRuntimeProjectionSha256: bytea("task_runtime_projection_sha256"),
    taskRuntimeGroupManifestSha256:
      bytea("task_runtime_group_manifest_sha256"),
    taskRuntimeMaterializationSpecSha256:
      bytea("task_runtime_materialization_spec_sha256"),
    packageSha256: bytea("package_sha256").notNull(),
    artifactSha256: bytea("artifact_sha256").notNull(),
    sourceRootSha256: bytea("source_root_sha256").notNull(),
    semanticRootSha256: bytea("semantic_root_sha256").notNull(),
    objectCount: integer("object_count").notNull(),
    receiptSha256: bytea("receipt_sha256").notNull(),
    receiptBytes: bytea("receipt_bytes").notNull(),
    publishedAt: timestamp("published_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.scopeId, table.revisionId] }),
    unique("fx_application_task_runtime_pub_v1_receipt_unique").on(
      table.scopeId,
      table.receiptSha256,
    ),
    unique("fx_application_task_runtime_pub_v1_child_unique").on(
      table.scopeId,
      table.revisionId,
      table.receiptSha256,
    ),
    foreignKey({
      name: "fx_application_task_runtime_pub_v1_catalog_fk",
      columns: [
        table.scopeId,
        table.revisionId,
        table.candidateId,
        table.taskCatalogSha256,
        table.taskCatalogBindingSha256,
      ],
      foreignColumns: [
        fxSystemApplicationTaskCatalogsV1.scopeId,
        fxSystemApplicationTaskCatalogsV1.revisionId,
        fxSystemApplicationTaskCatalogsV1.candidateId,
        fxSystemApplicationTaskCatalogsV1.taskCatalogSha256,
        fxSystemApplicationTaskCatalogsV1.taskCatalogBindingSha256,
      ],
    }).onDelete("restrict"),
    check(
      "fx_application_task_runtime_pub_v1_identity_check",
      sql`octet_length(convert_to(${table.revisionId}, 'UTF8')) between 1 and 256
        and octet_length(convert_to(${table.candidateId}, 'UTF8')) between 1 and 256
        and octet_length(${table.taskCatalogSha256}) = 32
        and octet_length(${table.taskCatalogBindingSha256}) = 32
        and octet_length(${table.candidateSha256}) = 32
        and octet_length(${table.applicationRevisionTaskBindingSha256}) = 32
        and octet_length(${table.taskEntryRootSha256}) = 32
        and octet_length(${table.packageSha256}) = 32
        and octet_length(${table.artifactSha256}) = 32
        and octet_length(${table.sourceRootSha256}) = 32
        and octet_length(${table.semanticRootSha256}) = 32
        and octet_length(${table.receiptSha256}) = 32
        and octet_length(${table.receiptBytes}) between 1 and ${sql.raw(String(MAX_TASK_RUNTIME_PUBLICATION_RECEIPT_CANONICAL_BYTES_V1))}`,
    ),
    check(
      "fx_application_task_runtime_pub_v1_shape_check",
      sql`(
          ${table.objectCount} = 0
          and ${table.taskRuntimeProjectionSha256} is null
          and ${table.taskRuntimeGroupManifestSha256} is null
          and ${table.taskRuntimeMaterializationSpecSha256} is null
        ) or (
          ${table.objectCount} between 1 and ${sql.raw(String(MAX_TASK_RUNTIME_PUBLICATION_OBJECTS_V1))}
          and octet_length(${table.taskRuntimeProjectionSha256}) = 32
          and octet_length(${table.taskRuntimeGroupManifestSha256}) = 32
          and octet_length(${table.taskRuntimeMaterializationSpecSha256}) = 32
        )`,
    ),
    check(
      "fx_application_task_runtime_pub_v1_time_check",
      sql`isfinite(${table.publishedAt})`,
    ),
  ],
);

/** Ordered immutable object references belonging to one task-runtime receipt. */
export const fxSystemApplicationTaskRuntimeObjectsV1 = pgTable(
  "fx_system_application_task_runtime_object_v1",
  {
    scopeId: text("scope_id").$type<ScopeId>().notNull(),
    revisionId: text("revision_id").notNull(),
    receiptSha256: bytea("receipt_sha256").notNull(),
    role: text("role").$type<TaskRuntimeObjectRoleV1>().notNull(),
    ordinal: bigint("ordinal", { mode: "bigint" }).notNull(),
    storeIdentity: text("store_identity").notNull(),
    codecIdentity: text("codec_identity").notNull(),
    objectKey: text("object_key").notNull(),
    byteLength: bigint("byte_length", { mode: "bigint" }).notNull(),
    sha256: bytea("sha256").notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.scopeId, table.revisionId, table.role, table.ordinal],
    }),
    unique("fx_application_task_runtime_obj_v1_key_unique").on(
      table.scopeId,
      table.revisionId,
      table.objectKey,
    ),
    foreignKey({
      name: "fx_application_task_runtime_obj_v1_publication_fk",
      columns: [table.scopeId, table.revisionId, table.receiptSha256],
      foreignColumns: [
        fxSystemApplicationTaskRuntimePublicationsV1.scopeId,
        fxSystemApplicationTaskRuntimePublicationsV1.revisionId,
        fxSystemApplicationTaskRuntimePublicationsV1.receiptSha256,
      ],
    }).onDelete("restrict"),
    uniqueIndex("fx_application_task_runtime_obj_v1_projection_unique")
      .on(table.scopeId, table.revisionId, table.role)
      .where(sql`${table.role} = 'task_runtime_projection'`),
    uniqueIndex("fx_application_task_runtime_obj_v1_manifest_unique")
      .on(table.scopeId, table.revisionId, table.role)
      .where(sql`${table.role} = 'task_runtime_group_manifest'`),
    uniqueIndex("fx_application_task_runtime_obj_v1_spec_unique")
      .on(table.scopeId, table.revisionId, table.role)
      .where(sql`${table.role} = 'task_runtime_materialization_spec'`),
    check(
      "fx_application_task_runtime_obj_v1_shape_check",
      sql`${table.role} in (
          'runtime_projection_module', 'task_runtime_projection',
          'task_runtime_entry', 'task_runtime_group_manifest',
          'task_runtime_materialization_spec'
        )
        and ${table.ordinal} between 0 and ${sql.raw(String(MAX_TASK_RUNTIME_PUBLICATION_OBJECTS_V1 - 1))}
        and ${table.storeIdentity} = 'flarex.r2/standard-application-task-runtime/v1'
        and ${table.byteLength} between 1 and ${sql.raw(String(MAX_TASK_RUNTIME_PUBLICATION_CANONICAL_BYTES_V1))}
        and octet_length(${table.sha256}) = 32
        and octet_length(convert_to(${table.codecIdentity}, 'UTF8')) between 1 and 256
        and octet_length(convert_to(${table.objectKey}, 'UTF8')) between 1 and 512
        and ${table.objectKey} = 'standard-application-task-runtime/v1/' || ${table.role} || '/' || encode(${table.sha256}, 'hex')
        and (
          (${table.role} = 'runtime_projection_module' and ${table.codecIdentity} = 'flarex.standard-application/task-runtime-projection-module/v1')
          or (${table.role} = 'task_runtime_projection' and ${table.codecIdentity} = 'flarex.standard-application/task-runtime-projection/v1')
          or (${table.role} = 'task_runtime_entry' and ${table.codecIdentity} = 'flarex.standard-application/task-runtime-entry/v1')
          or (${table.role} = 'task_runtime_group_manifest' and ${table.codecIdentity} = 'flarex.standard-application/task-runtime-group-manifest/v1')
          or (${table.role} = 'task_runtime_materialization_spec' and ${table.codecIdentity} = 'flarex.standard-application/task-runtime-materialization-spec/v1')
        )`,
    ),
  ],
);

/**
 * Reserved and then published bridge from one canonical Application schema
 * digest to the existing deployment-stable app-schema catalog.
 */
export const fxControlApplicationSchemaAuthoritiesV1 = pgTable(
  "fx_control_application_schema_authority_v1",
  {
    deploymentId: text("deployment_id").notNull(),
    applicationSchemaSha256: bytea("application_schema_sha256").notNull(),
    schemaVersionId: text("schema_version_id")
      .$type<CatalogSchemaVersionId>()
      .notNull(),
    schemaVersion: integer("schema_version")
      .$type<CatalogSchemaVersion>()
      .notNull(),
    status: text("status").$type<"reserved" | "published">().notNull(),
    schemaManifestSha256: bytea("schema_manifest_sha256"),
    bindingSha256: bytea("binding_sha256"),
    bindingBytes: bytea("binding_bytes"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
  },
  (table) => [
    primaryKey({
      columns: [table.deploymentId, table.applicationSchemaSha256],
    }),
    unique("fx_application_schema_authority_v1_version_id_unique").on(
      table.deploymentId,
      table.schemaVersionId,
    ),
    unique("fx_application_schema_authority_v1_version_unique").on(
      table.deploymentId,
      table.schemaVersion,
    ),
    unique("fx_application_schema_authority_v1_binding_unique").on(
      table.deploymentId,
      table.applicationSchemaSha256,
      table.schemaVersionId,
      table.schemaVersion,
    ),
    foreignKey({
      name: "fx_application_schema_authority_v1_deployment_fk",
      columns: [table.deploymentId],
      foreignColumns: [deployments.deploymentId],
    }).onDelete("restrict"),
    check(
      "fx_application_schema_authority_v1_identity_check",
      sql`${nonBlankText(table.deploymentId)}
        and octet_length(${table.applicationSchemaSha256}) = 32
        and ${nonBlankText(table.schemaVersionId)}
        and ${table.schemaVersion} between 1 and 2147483647`,
    ),
    check(
      "fx_application_schema_authority_v1_state_check",
      sql`(
          ${table.status} = 'reserved'
          and ${table.schemaManifestSha256} is null
          and ${table.bindingSha256} is null
          and ${table.bindingBytes} is null
          and ${table.publishedAt} is null
        ) or (
          ${table.status} = 'published'
          and octet_length(${table.schemaManifestSha256}) = 32
          and octet_length(${table.bindingSha256}) = 32
          and octet_length(${table.bindingBytes}) between 1 and 1048576
          and ${table.publishedAt} is not null
        )`,
    ),
    check(
      "fx_application_schema_authority_v1_time_check",
      sql`isfinite(${table.createdAt})
        and (${table.publishedAt} is null or (
          isfinite(${table.publishedAt}) and ${table.publishedAt} >= ${table.createdAt}
        ))`,
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

/** Immutable Application activation history; revision rows stay inactive. */
export const fxSystemApplicationActivationsV1 = pgTable(
  "fx_system_application_activation_v1",
  {
    scopeId: text("scope_id").$type<ScopeId>().notNull(),
    activationSequence: bigint("activation_sequence", { mode: "bigint" })
      .notNull(),
    previousActivationSequence: bigint("previous_activation_sequence", {
      mode: "bigint",
    }),
    revisionId: text("revision_id").notNull(),
    readinessSha256: bytea("readiness_sha256").notNull(),
    activationRequestSha256: bytea("activation_request_sha256").notNull(),
    activationSha256: bytea("activation_sha256").notNull(),
    activationBytes: bytea("activation_bytes").notNull(),
    activatedAt: timestamp("activated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.scopeId, table.activationSequence] }),
    unique("fx_application_activation_v1_request_unique").on(
      table.scopeId,
      table.activationRequestSha256,
    ),
    unique("fx_application_activation_v1_head_child_unique").on(
      table.scopeId,
      table.activationSequence,
      table.revisionId,
      table.readinessSha256,
      table.activationSha256,
    ),
    foreignKey({
      name: "fx_application_activation_v1_readiness_fk",
      columns: [table.scopeId, table.revisionId, table.readinessSha256],
      foreignColumns: [
        fxSystemApplicationReadinessV1.scopeId,
        fxSystemApplicationReadinessV1.revisionId,
        fxSystemApplicationReadinessV1.readinessSha256,
      ],
    }).onDelete("restrict"),
    check(
      "fx_application_activation_v1_identity_check",
      sql`${table.activationSequence} between 1 and 9223372036854775807
        and (${table.previousActivationSequence} is null or (
          ${table.previousActivationSequence} between 1 and 9223372036854775806
          and ${table.previousActivationSequence} < ${table.activationSequence}
        ))
        and ${nonBlankText(table.revisionId)}
        and octet_length(${table.readinessSha256}) = 32
        and octet_length(${table.activationRequestSha256}) = 32
        and octet_length(${table.activationSha256}) = 32
        and octet_length(${table.activationBytes}) between 1 and 1048576`,
    ),
    check(
      "fx_application_activation_v1_time_check",
      sql`isfinite(${table.activatedAt})`,
    ),
  ],
);

/** One CAS-protected Application active head per scope. */
export const fxSystemApplicationActiveHeadsV1 = pgTable(
  "fx_system_application_active_head_v1",
  {
    scopeId: text("scope_id").$type<ScopeId>().primaryKey(),
    activationSequence: bigint("activation_sequence", { mode: "bigint" })
      .notNull(),
    revisionId: text("revision_id").notNull(),
    readinessSha256: bytea("readiness_sha256").notNull(),
    activationSha256: bytea("activation_sha256").notNull(),
    headSha256: bytea("head_sha256").notNull(),
    headBytes: bytea("head_bytes").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      name: "fx_application_active_head_v1_activation_fk",
      columns: [
        table.scopeId,
        table.activationSequence,
        table.revisionId,
        table.readinessSha256,
        table.activationSha256,
      ],
      foreignColumns: [
        fxSystemApplicationActivationsV1.scopeId,
        fxSystemApplicationActivationsV1.activationSequence,
        fxSystemApplicationActivationsV1.revisionId,
        fxSystemApplicationActivationsV1.readinessSha256,
        fxSystemApplicationActivationsV1.activationSha256,
      ],
    }).onDelete("restrict"),
    check(
      "fx_application_active_head_v1_identity_check",
      sql`${table.activationSequence} between 1 and 9223372036854775807
        and ${nonBlankText(table.revisionId)}
        and octet_length(${table.readinessSha256}) = 32
        and octet_length(${table.activationSha256}) = 32
        and octet_length(${table.headSha256}) = 32
        and octet_length(${table.headBytes}) between 1 and 1048576`,
    ),
    check(
      "fx_application_active_head_v1_time_check",
      sql`isfinite(${table.createdAt})
        and isfinite(${table.updatedAt})
        and ${table.updatedAt} >= ${table.createdAt}`,
    ),
  ],
);

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

/**
 * Private, route-independent direct edge-action invocation authority.
 * Canonical arguments and results remain in R2; this row stores only their
 * content-addressed references and the fenced lifecycle decision.
 */
export const fxSystemApplicationActionInvocationsV1 = pgTable(
  "fx_system_application_action_invocation_v1",
  {
    scopeId: text("scope_id").$type<ScopeId>().notNull(),
    scopeUuid: uuid("scope_uuid")
      .$type<ScopeUuidV1>()
      .generatedAlwaysAs(sql`
        case
          when "scope_id" ~ '^scope_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          then substring("scope_id" from 7)::uuid
          else null
        end
      `),
    scopeEpoch: text("scope_epoch").$type<ScopeEpoch>().notNull(),
    storageGenerationFence: bigint("storage_generation_fence", {
      mode: "bigint",
    }).$type<StorageGenerationFence>().notNull(),
    requestKey: text("request_key").notNull(),
    invocationId: uuid("invocation_id").notNull(),
    requestIdentitySha256: bytea("request_identity_sha256").notNull(),
    actionBindingSha256: bytea("action_binding_sha256").notNull(),
    applicationRevisionId: text("application_revision_id").notNull(),
    candidateSha256: bytea("candidate_sha256").notNull(),
    actionFunctionPath: text("action_function_path").notNull(),
    executionIdentitySha256: bytea("execution_identity_sha256").notNull(),
    compatibilityDate: text("compatibility_date").notNull(),
    hostPolicySha256: bytea("host_policy_sha256").notNull(),
    argumentStoreIdentity: text("argument_store_identity").notNull(),
    argumentCodecIdentity: text("argument_codec_identity").notNull(),
    argumentObjectKey: text("argument_object_key").notNull(),
    argumentByteLength: bigint("argument_byte_length", { mode: "bigint" })
      .notNull(),
    argumentSha256: bytea("argument_sha256").notNull(),
    lifecycle: text("lifecycle").$type<
      "admitted" | "executing" | "completed" | "failed" | "uncertain" |
        "cancelled"
    >().notNull(),
    executionGeneration: bigint("execution_generation", { mode: "bigint" })
      .notNull().default(sql`0`),
    invocationTime: timestamp("invocation_time", { withTimezone: true }),
    executionDeadline: timestamp("execution_deadline", { withTimezone: true }),
    randomSeedSha256: bytea("random_seed_sha256"),
    lastEffectOrdinal: bigint("last_effect_ordinal", { mode: "bigint" })
      .notNull().default(sql`0`),
    cancellationRequestedAt: timestamp("cancellation_requested_at", {
      withTimezone: true,
    }),
    resultStoreIdentity: text("result_store_identity"),
    resultCodecIdentity: text("result_codec_identity"),
    resultObjectKey: text("result_object_key"),
    resultByteLength: bigint("result_byte_length", { mode: "bigint" }),
    resultSha256: bytea("result_sha256"),
    terminalCode: text("terminal_code"),
    admittedAt: timestamp("admitted_at", { withTimezone: true })
      .notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull().defaultNow(),
    terminalAt: timestamp("terminal_at", { withTimezone: true }),
  },
  table => [
    primaryKey({ columns: [table.scopeUuid, table.requestKey] }),
    unique("fx_action_invocation_v1_scope_invocation_unique").on(
      table.scopeUuid,
      table.invocationId,
    ),
    foreignKey({
      name: "fx_action_invocation_v1_scope_fk",
      columns: [table.scopeId],
      foreignColumns: [fxSystemScopeClocks.scopeId],
    }).onDelete("restrict"),
    foreignKey({
      name: "fx_action_invocation_v1_revision_fk",
      columns: [
        table.scopeId,
        table.candidateSha256,
        table.applicationRevisionId,
      ],
      foreignColumns: [
        fxSystemApplicationRevisionsV1.scopeId,
        fxSystemApplicationRevisionsV1.candidateSha256,
        fxSystemApplicationRevisionsV1.revisionId,
      ],
    }).onDelete("restrict"),
    check(
      "fx_action_invocation_v1_identity_check",
      sql`${nonBlankText(table.scopeId)}
        and ${nonBlankText(table.requestKey)}
        and octet_length(convert_to(${table.requestKey}, 'UTF8')) <= 2048
        and ${nonBlankText(table.applicationRevisionId)}
        and octet_length(convert_to(${table.applicationRevisionId}, 'UTF8')) <= 2048
        and ${nonBlankText(table.actionFunctionPath)}
        and octet_length(convert_to(${table.actionFunctionPath}, 'UTF8')) <= 2048
        and ${nonBlankText(table.compatibilityDate)}
        and octet_length(convert_to(${table.compatibilityDate}, 'UTF8')) <= 2048
        and octet_length(${table.requestIdentitySha256}) = 32
        and octet_length(${table.actionBindingSha256}) = 32
        and octet_length(${table.candidateSha256}) = 32
        and octet_length(${table.executionIdentitySha256}) = 32
        and octet_length(${table.hostPolicySha256}) = 32
        and ${table.storageGenerationFence} >= 1`,
    ),
    check(
      "fx_action_invocation_v1_argument_reference_check",
      sql`${table.argumentStoreIdentity} =
          'flarex.r2/execution-evidence-body/v1'
        and ${table.argumentCodecIdentity} =
          'flarex.codec/canonical-flarex-value/v1'
        and ${nonBlankText(table.argumentObjectKey)}
        and octet_length(convert_to(${table.argumentObjectKey}, 'UTF8')) <= 2048
        and ${table.argumentByteLength} >= 1
        and octet_length(${table.argumentSha256}) = 32`,
    ),
    check(
      "fx_action_invocation_v1_execution_check",
      sql`(
        (${table.lifecycle} = 'admitted'
          and ${table.invocationTime} is null
          and ${table.executionDeadline} is null
          and ${table.randomSeedSha256} is null)
        or (${table.lifecycle} <> 'admitted'
          and (${table.executionGeneration} >= 1 or
            (${table.lifecycle} = 'cancelled' and
              ${table.executionGeneration} = 0))
          and ((${table.executionGeneration} = 0
              and ${table.invocationTime} is null
              and ${table.executionDeadline} is null
              and ${table.randomSeedSha256} is null)
            or (${table.executionGeneration} >= 1
              and ${table.invocationTime} is not null
              and ${table.executionDeadline} is not null
              and ${table.executionDeadline} > ${table.invocationTime}
              and octet_length(${table.randomSeedSha256}) = 32)))
      ) and ${table.executionGeneration} >= 0
        and ${table.lastEffectOrdinal} >= 0`,
    ),
    check(
      "fx_action_invocation_v1_terminal_check",
      sql`(
        (${table.lifecycle} in ('admitted', 'executing')
          and ${table.terminalAt} is null
          and ${table.terminalCode} is null
          and ${table.resultStoreIdentity} is null
          and ${table.resultCodecIdentity} is null
          and ${table.resultObjectKey} is null
          and ${table.resultByteLength} is null
          and ${table.resultSha256} is null)
        or (${table.lifecycle} = 'completed'
          and ${table.terminalAt} is not null
          and ${table.terminalCode} is null
          and ${table.resultStoreIdentity} =
            'flarex.r2/execution-evidence-body/v1'
          and ${table.resultCodecIdentity} =
            'flarex.codec/canonical-flarex-value/v1'
          and ${nonBlankText(table.resultObjectKey)}
          and octet_length(convert_to(${table.resultObjectKey}, 'UTF8')) <= 2048
          and ${table.resultByteLength} >= 1
          and octet_length(${table.resultSha256}) = 32)
        or (${table.lifecycle} in ('failed', 'uncertain', 'cancelled')
          and ${table.terminalAt} is not null
          and ${nonBlankText(table.terminalCode)}
          and octet_length(convert_to(${table.terminalCode}, 'UTF8')) <= 2048
          and ${table.resultStoreIdentity} is null
          and ${table.resultCodecIdentity} is null
          and ${table.resultObjectKey} is null
          and ${table.resultByteLength} is null
          and ${table.resultSha256} is null)
      )`,
    ),
    check(
      "fx_action_invocation_v1_timestamp_check",
      sql`isfinite(${table.admittedAt})
        and isfinite(${table.updatedAt})
        and ${table.updatedAt} >= ${table.admittedAt}
        and (${table.terminalAt} is null or
          (isfinite(${table.terminalAt}) and
            ${table.terminalAt} >= ${table.admittedAt}))
        and (${table.cancellationRequestedAt} is null or
          isfinite(${table.cancellationRequestedAt}))`,
    ),
  ],
);

/** Shared evidence for possibly externally visible effects. */
export const fxSystemExternalEffectAttemptsV1 = pgTable(
  "fx_system_external_effect_attempt_v1",
  {
    scopeId: text("scope_id").$type<ScopeId>().notNull(),
    scopeUuid: uuid("scope_uuid")
      .$type<ScopeUuidV1>()
      .generatedAlwaysAs(sql`
        case
          when "scope_id" ~ '^scope_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          then substring("scope_id" from 7)::uuid
          else null
        end
      `),
    subjectKind: text("subject_kind").$type<
      "direct_action" | "durable_task_attempt"
    >().notNull(),
    subjectIdentitySha256: bytea("subject_identity_sha256").notNull(),
    subjectFence: bigint("subject_fence", { mode: "bigint" }).notNull(),
    effectOrdinal: bigint("effect_ordinal", { mode: "bigint" }).notNull(),
    effectKind: text("effect_kind").$type<
      "outbound_http" | "child_mutation"
    >().notNull(),
    stableEffectKey: text("stable_effect_key").notNull(),
    requestIdentitySha256: bytea("request_identity_sha256").notNull(),
    requestStoreIdentity: text("request_store_identity"),
    requestCodecIdentity: text("request_codec_identity"),
    requestObjectKey: text("request_object_key"),
    requestByteLength: bigint("request_byte_length", { mode: "bigint" }),
    requestSha256: bytea("request_sha256"),
    childMutationRequestKey: text("child_mutation_request_key"),
    childMutationFunctionPath: text("child_mutation_function_path"),
    childMutationArgumentsSha256: bytea("child_mutation_arguments_sha256"),
    state: text("state").$type<
      "prepared" | "failed_before_dispatch" | "dispatching" | "confirmed" |
        "uncertain"
    >().notNull(),
    preparedAt: timestamp("prepared_at", { withTimezone: true })
      .notNull().defaultNow(),
    dispatchDeclaredAt: timestamp("dispatch_declared_at", {
      withTimezone: true,
    }),
    settledAt: timestamp("settled_at", { withTimezone: true }),
    responseStoreIdentity: text("response_store_identity"),
    responseCodecIdentity: text("response_codec_identity"),
    responseObjectKey: text("response_object_key"),
    responseByteLength: bigint("response_byte_length", { mode: "bigint" }),
    responseSha256: bytea("response_sha256"),
    childMutationOutcomeSha256: bytea("child_mutation_outcome_sha256"),
    terminalCode: text("terminal_code"),
  },
  table => [
    primaryKey({ columns: [
      table.scopeUuid,
      table.subjectKind,
      table.subjectIdentitySha256,
      table.subjectFence,
      table.effectOrdinal,
    ] }),
    foreignKey({
      name: "fx_external_effect_attempt_v1_scope_fk",
      columns: [table.scopeId],
      foreignColumns: [fxSystemScopeClocks.scopeId],
    }).onDelete("restrict"),
    check(
      "fx_external_effect_attempt_v1_identity_check",
      sql`${table.subjectKind} in ('direct_action', 'durable_task_attempt')
        and octet_length(${table.subjectIdentitySha256}) = 32
        and ${table.subjectFence} >= 1
        and ${table.effectOrdinal} >= 1
        and ${table.effectKind} in ('outbound_http', 'child_mutation')
        and ${nonBlankText(table.stableEffectKey)}
        and octet_length(convert_to(${table.stableEffectKey}, 'UTF8')) <= 2048
        and octet_length(${table.requestIdentitySha256}) = 32`,
    ),
    check(
      "fx_external_effect_attempt_v1_request_check",
      sql`(
        (${table.effectKind} = 'outbound_http'
          and ${table.requestStoreIdentity} =
            'flarex.r2/execution-evidence-body/v1'
          and ${table.requestCodecIdentity} =
            'flarex.codec/canonical-http-request/v1'
          and ${nonBlankText(table.requestObjectKey)}
          and octet_length(convert_to(${table.requestObjectKey}, 'UTF8')) <= 2048
          and ${table.requestByteLength} >= 1
          and octet_length(${table.requestSha256}) = 32
          and ${table.childMutationRequestKey} is null
          and ${table.childMutationFunctionPath} is null
          and ${table.childMutationArgumentsSha256} is null)
        or (${table.effectKind} = 'child_mutation'
          and ${table.requestStoreIdentity} is null
          and ${table.requestCodecIdentity} is null
          and ${table.requestObjectKey} is null
          and ${table.requestByteLength} is null
          and ${table.requestSha256} is null
          and ${nonBlankText(table.childMutationRequestKey)}
          and octet_length(convert_to(${table.childMutationRequestKey}, 'UTF8')) <= 2048
          and ${nonBlankText(table.childMutationFunctionPath)}
          and octet_length(convert_to(${table.childMutationFunctionPath}, 'UTF8')) <= 2048
          and octet_length(${table.childMutationArgumentsSha256}) = 32)
      )`,
    ),
    check(
      "fx_external_effect_attempt_v1_state_check",
      sql`(
        (${table.state} = 'prepared'
          and ${table.dispatchDeclaredAt} is null
          and ${table.settledAt} is null
          and ${table.terminalCode} is null)
        or (${table.state} = 'failed_before_dispatch'
          and ${table.dispatchDeclaredAt} is null
          and ${table.settledAt} is not null
          and ${nonBlankText(table.terminalCode)})
        or (${table.state} = 'dispatching'
          and ${table.dispatchDeclaredAt} is not null
          and ${table.settledAt} is null
          and ${table.terminalCode} is null)
        or (${table.state} = 'uncertain'
          and ${table.dispatchDeclaredAt} is not null
          and ${table.settledAt} is not null
          and ${nonBlankText(table.terminalCode)})
        or (${table.state} = 'confirmed'
          and ${table.dispatchDeclaredAt} is not null
          and ${table.settledAt} is not null
          and ${table.terminalCode} is null)
      )`,
    ),
    check(
      "fx_external_effect_attempt_v1_outcome_check",
      sql`(
        (${table.state} <> 'confirmed'
          and ${table.responseStoreIdentity} is null
          and ${table.responseCodecIdentity} is null
          and ${table.responseObjectKey} is null
          and ${table.responseByteLength} is null
          and ${table.responseSha256} is null
          and ${table.childMutationOutcomeSha256} is null)
        or (${table.state} = 'confirmed'
          and ${table.effectKind} = 'outbound_http'
          and ${table.responseStoreIdentity} =
            'flarex.r2/execution-evidence-body/v1'
          and ${table.responseCodecIdentity} =
            'flarex.codec/canonical-http-response/v1'
          and ${nonBlankText(table.responseObjectKey)}
          and octet_length(convert_to(${table.responseObjectKey}, 'UTF8')) <= 2048
          and ${table.responseByteLength} >= 1
          and octet_length(${table.responseSha256}) = 32
          and ${table.childMutationOutcomeSha256} is null)
        or (${table.state} = 'confirmed'
          and ${table.effectKind} = 'child_mutation'
          and ${table.responseStoreIdentity} is null
          and ${table.responseCodecIdentity} is null
          and ${table.responseObjectKey} is null
          and ${table.responseByteLength} is null
          and ${table.responseSha256} is null
          and octet_length(${table.childMutationOutcomeSha256}) = 32)
      )`,
    ),
    check(
      "fx_external_effect_attempt_v1_timestamp_check",
      sql`isfinite(${table.preparedAt})
        and (${table.dispatchDeclaredAt} is null or
          (isfinite(${table.dispatchDeclaredAt}) and
            ${table.dispatchDeclaredAt} >= ${table.preparedAt}))
        and (${table.settledAt} is null or
          (isfinite(${table.settledAt}) and
            ${table.settledAt} >= ${table.preparedAt}))`,
    ),
  ],
);

/** Immutable, scope-owned Standard Application task/runtime binding. */
export const fxSystemDurableTaskDefinitionRevisionsV1 = pgTable(
  "fx_system_durable_task_definition_revision_v1",
  {
    scopeId: text("scope_id").$type<ScopeId>().notNull(),
    taskDefinitionRevisionId: text("task_definition_revision_id")
      .$type<TaskDefinitionRevisionIdV1>()
      .notNull(),
    taskId: text("task_id").$type<TaskIdV1>().notNull(),
    applicationRevisionId: text("application_revision_id").notNull(),
    candidateSha256: bytea("candidate_sha256")
      .$type<TaskDefinitionSha256V1>()
      .notNull(),
    bindingCodecVersion: integer("binding_codec_version").notNull(),
    bindingByteLength: bigint("binding_byte_length", { mode: "bigint" })
      .notNull(),
    bindingSha256: bytea("binding_sha256")
      .$type<TaskDefinitionSha256V1>()
      .notNull(),
    bindingBytes: bytea("binding_bytes").notNull(),
    applicationRevisionTaskBindingSha256: bytea(
      "application_revision_task_binding_sha256",
    ).$type<TaskDefinitionSha256V1>().notNull(),
    canonicalTaskManifestSha256: bytea("canonical_task_manifest_sha256")
      .$type<TaskDefinitionSha256V1>()
      .notNull(),
    taskRuntimeEntrySha256: bytea("task_runtime_entry_sha256")
      .$type<TaskDefinitionSha256V1>()
      .notNull(),
    taskCatalogSha256: bytea("task_catalog_sha256")
      .$type<TaskDefinitionSha256V1>()
      .notNull(),
    taskEntryRootSha256: bytea("task_entry_root_sha256")
      .$type<TaskDefinitionSha256V1>()
      .notNull(),
    taskRuntimeProjectionSha256: bytea("task_runtime_projection_sha256")
      .$type<TaskDefinitionSha256V1>()
      .notNull(),
    taskRuntimeGroupManifestSha256: bytea(
      "task_runtime_group_manifest_sha256",
    ).$type<TaskDefinitionSha256V1>().notNull(),
    taskRuntimeMaterializationSpecSha256: bytea(
      "task_runtime_materialization_spec_sha256",
    ).$type<TaskDefinitionSha256V1>().notNull(),
    packageSha256: bytea("package_sha256")
      .$type<TaskDefinitionSha256V1>()
      .notNull(),
    artifactSha256: bytea("artifact_sha256")
      .$type<TaskDefinitionSha256V1>()
      .notNull(),
    sourceRootSha256: bytea("source_root_sha256")
      .$type<TaskDefinitionSha256V1>()
      .notNull(),
    semanticRootSha256: bytea("semantic_root_sha256")
      .$type<TaskDefinitionSha256V1>()
      .notNull(),
  },
  table => [
    primaryKey({
      columns: [table.scopeId, table.taskDefinitionRevisionId],
      name: "fx_task_definition_v1_pk",
    }),
    unique("fx_task_definition_v1_binding_unique").on(
      table.scopeId,
      table.bindingSha256,
    ),
    unique("fx_task_definition_v1_revision_task_unique").on(
      table.scopeId,
      table.candidateSha256,
      table.applicationRevisionId,
      table.taskId,
    ),
    foreignKey({
      name: "fx_task_definition_v1_scope_fk",
      columns: [table.scopeId],
      foreignColumns: [fxSystemScopeClocks.scopeId],
    }).onDelete("restrict"),
    foreignKey({
      name: "fx_task_definition_v1_application_revision_fk",
      columns: [
        table.scopeId,
        table.candidateSha256,
        table.applicationRevisionId,
      ],
      foreignColumns: [
        fxSystemApplicationRevisionsV1.scopeId,
        fxSystemApplicationRevisionsV1.candidateSha256,
        fxSystemApplicationRevisionsV1.revisionId,
      ],
    }).onDelete("restrict"),
    check(
      "fx_task_definition_v1_identity_check",
      sql`${table.taskDefinitionRevisionId} ~ '^taskdef_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        and ${nonBlankText(table.taskId)}
        and octet_length(convert_to(${table.taskId}, 'UTF8')) between 1 and ${sql.raw(
          String(MAX_TASK_ID_UTF8_BYTES_V1),
        )}
        and ${nonBlankText(table.applicationRevisionId)}
        and octet_length(convert_to(${table.applicationRevisionId}, 'UTF8')) <= 2048
        and octet_length(${table.candidateSha256}) = 32`,
    ),
    check(
      "fx_task_definition_v1_binding_check",
      sql`${table.bindingCodecVersion} = 1
        and ${table.bindingByteLength} between 1 and ${sql.raw(
          String(MAX_TASK_DEFINITION_CANONICAL_BYTES_V1),
        )}
        and octet_length(${table.bindingSha256}) = 32
        and octet_length(${table.bindingBytes}) = ${table.bindingByteLength}`,
    ),
    check(
      "fx_task_definition_v1_projection_check",
      sql`octet_length(${table.applicationRevisionTaskBindingSha256}) = 32
        and octet_length(${table.canonicalTaskManifestSha256}) = 32
        and octet_length(${table.taskRuntimeEntrySha256}) = 32
        and octet_length(${table.taskCatalogSha256}) = 32
        and octet_length(${table.taskEntryRootSha256}) = 32
        and octet_length(${table.taskRuntimeProjectionSha256}) = 32
        and octet_length(${table.taskRuntimeGroupManifestSha256}) = 32
        and octet_length(${table.taskRuntimeMaterializationSpecSha256}) = 32
        and octet_length(${table.packageSha256}) = 32
        and octet_length(${table.artifactSha256}) = 32
        and octet_length(${table.sourceRootSha256}) = 32
        and octet_length(${table.semanticRootSha256}) = 32`,
    ),
  ],
);

/** Authoritative lifecycle aggregate plus relational discovery projections. */
export const fxSystemDurableTaskRunsV1 = pgTable(
  "fx_system_durable_task_run_v1",
  {
    scopeId: text("scope_id").$type<ScopeId>().notNull(),
    runId: text("run_id").$type<TaskRunIdV1>().notNull(),
    taskDefinitionRevisionId: text("task_definition_revision_id")
      .$type<TaskDefinitionRevisionIdV1>()
      .notNull(),
    createdAtMs: bigint("created_at_ms", { mode: "bigint" }).notNull(),
    inputCodec: text("input_codec").notNull(),
    inputStore: text("input_store").notNull(),
    inputValueCodec: text("input_value_codec").notNull(),
    inputObjectKey: text("input_object_key").notNull(),
    inputByteLength: bigint("input_byte_length", { mode: "bigint" })
      .notNull(),
    inputSha256: bytea("input_sha256").$type<TaskInputSha256V1>().notNull(),
    inputRetention: text("input_retention").notNull(),
    creationAuthorityCodecVersion: integer(
      "creation_authority_codec_version",
    ).notNull(),
    creationAuthorityByteLength: bigint(
      "creation_authority_byte_length",
      { mode: "bigint" },
    ).notNull(),
    creationAuthoritySha256: bytea("creation_authority_sha256")
      .$type<TaskRunCreationAuthoritySha256V1>()
      .notNull(),
    creationAuthorityBytes: bytea("creation_authority_bytes").notNull(),
    aggregateCodecVersion: integer("aggregate_codec_version").notNull(),
    aggregateByteLength: bigint("aggregate_byte_length", { mode: "bigint" })
      .notNull(),
    aggregateJson: jsonb("aggregate_json").$type<unknown>().notNull(),
    runVersion: bigint("run_version", { mode: "bigint" })
      .$type<TaskRunVersionV1>()
      .notNull(),
    phase: text("phase")
      .$type<TaskRunAttemptPersistenceProjectionV1["phase"]>()
      .notNull(),
    dueKind: text("due_kind").$type<Exclude<
      TaskRunAttemptPersistenceProjectionV1["dueKind"],
      null
    >>(),
    dueAtMs: bigint("due_at_ms", { mode: "bigint" }),
    currentAttemptId: text("current_attempt_id").$type<TaskAttemptIdV1>(),
    executionFenceBasis: bigint("execution_fence_basis", { mode: "bigint" })
      .$type<TaskExecutionFenceV1>(),
    currentLeaseVersion: bigint("current_lease_version", { mode: "bigint" })
      .$type<TaskLeaseVersionV1>(),
    currentLeaseExpiresAtMs: bigint("current_lease_expires_at_ms", {
      mode: "bigint",
    }),
    cancellationGeneration: bigint("cancellation_generation", {
      mode: "bigint",
    }).$type<TaskCancellationGenerationV1>().notNull(),
    requestedEffectSequence: bigint("requested_effect_sequence", {
      mode: "bigint",
    }).$type<TaskRequestedEffectPersistenceCursorV1>().notNull(),
  },
  table => [
    primaryKey({
      columns: [table.scopeId, table.runId],
      name: "fx_task_run_v1_pk",
    }),
    foreignKey({
      name: "fx_task_run_v1_definition_fk",
      columns: [table.scopeId, table.taskDefinitionRevisionId],
      foreignColumns: [
        fxSystemDurableTaskDefinitionRevisionsV1.scopeId,
        fxSystemDurableTaskDefinitionRevisionsV1.taskDefinitionRevisionId,
      ],
    }).onDelete("restrict"),
    index("fx_task_run_v1_due_discovery_idx").on(
      table.scopeId,
      table.dueKind,
      table.dueAtMs,
      table.runId,
    ).where(sql`${table.dueKind} is not null`),
    check(
      "fx_task_run_v1_identity_check",
      sql`${table.runId} ~ '^run_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        and ${table.taskDefinitionRevisionId} ~ '^taskdef_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        and ${table.createdAtMs} between 0 and 9007199254740991`,
    ),
    check(
      "fx_task_run_v1_input_check",
      sql`${table.inputCodec} = 'flarex.task-input-reference.v1'
        and ${table.inputStore} = 'flarex.task-input-object-store.v1'
        and ${table.inputValueCodec} = 'flarex-value/v1'
        and ${table.inputRetention} = 'run_lifetime'
        and ${table.inputObjectKey} ~ '^durable-task-input/v1/sha256/[0-9a-f]{64}$'
        and ${table.inputByteLength} between 1 and ${sql.raw(
          String(MAX_TASK_INPUT_CANONICAL_BYTES_V1),
        )}
        and octet_length(${table.inputSha256}) = 32
        and right(${table.inputObjectKey}, 64) = encode(${table.inputSha256}, 'hex')`,
    ),
    check(
      "fx_task_run_v1_authority_check",
      sql`${table.creationAuthorityCodecVersion} = 1
        and ${table.creationAuthorityByteLength} between 1 and ${sql.raw(
          String(MAX_TASK_DEFINITION_CANONICAL_BYTES_V1),
        )}
        and octet_length(${table.creationAuthoritySha256}) = 32
        and octet_length(${table.creationAuthorityBytes}) =
          ${table.creationAuthorityByteLength}`,
    ),
    check(
      "fx_task_run_v1_aggregate_check",
      sql`${table.aggregateCodecVersion} = 1
        and ${table.aggregateByteLength} between 1 and ${sql.raw(
          String(MAX_TASK_RUN_ATTEMPT_PERSISTED_JSON_BYTES_V1),
        )}
        and jsonb_typeof(${table.aggregateJson}) = 'object'`,
    ),
    check(
      "fx_task_run_v1_projection_counter_check",
      sql`${table.runVersion} >= 1
        and ${table.cancellationGeneration} >= 0
        and ${table.requestedEffectSequence} >= 0`,
    ),
    check(
      "fx_task_run_v1_projection_shape_check",
      sql`(
        (${table.phase} = 'ready'
          and ${table.dueKind} = 'start_attempt'
          and ${table.dueAtMs} is not null
          and ${table.currentAttemptId} is null
          and ${table.currentLeaseVersion} is null
          and ${table.currentLeaseExpiresAtMs} is null)
        or (${table.phase} = 'retry_waiting'
          and ${table.dueKind} = 'start_attempt'
          and ${table.dueAtMs} is not null
          and ${table.currentAttemptId} is null
          and ${table.executionFenceBasis} is not null
          and ${table.currentLeaseVersion} is null
          and ${table.currentLeaseExpiresAtMs} is null)
        or (${table.phase} in ('attempt_granted', 'executing')
          and ${table.dueKind} = 'handle_lease_expiry'
          and ${table.dueAtMs} is not null
          and ${table.currentAttemptId} is not null
          and ${table.executionFenceBasis} is not null
          and ${table.currentLeaseVersion} is not null
          and ${table.currentLeaseExpiresAtMs} = ${table.dueAtMs})
        or (${table.phase} = 'terminal'
          and ${table.dueKind} is null
          and ${table.dueAtMs} is null
          and ${table.currentAttemptId} is null
          and ${table.executionFenceBasis} is null
          and ${table.currentLeaseVersion} is null
          and ${table.currentLeaseExpiresAtMs} is null)
      )`,
    ),
    check(
      "fx_task_run_v1_projection_value_check",
      sql`(${table.dueAtMs} is null or
          ${table.dueAtMs} between 0 and 9007199254740991)
        and (${table.currentAttemptId} is null or
          ${table.currentAttemptId} ~ '^attempt_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')
        and (${table.executionFenceBasis} is null or
          ${table.executionFenceBasis} >= 1)
        and (${table.currentLeaseVersion} is null or
          ${table.currentLeaseVersion} >= 1)
        and (${table.currentLeaseExpiresAtMs} is null or
          ${table.currentLeaseExpiresAtMs} between 0 and 9007199254740991)`,
    ),
  ],
);

/** Scope-local run-creation idempotency identity and stable replay basis. */
export const fxSystemDurableTaskRunRequestsV1 = pgTable(
  "fx_system_durable_task_run_request_v1",
  {
    scopeId: text("scope_id").$type<ScopeId>().notNull(),
    requestKeyCodecVersion: integer("request_key_codec_version").notNull(),
    requestKeySha256: bytea("request_key_sha256")
      .$type<TaskRunCreationRequestKeySha256V1>()
      .notNull(),
    requestCodecVersion: integer("request_codec_version").notNull(),
    requestSha256: bytea("request_sha256")
      .$type<TaskRunCreationRequestSha256V1>()
      .notNull(),
    runId: text("run_id").$type<TaskRunIdV1>().notNull(),
    receiptVersion: integer("receipt_version").notNull(),
  },
  table => [
    primaryKey({
      columns: [table.scopeId, table.requestKeySha256],
      name: "fx_task_run_request_v1_pk",
    }),
    unique("fx_task_run_request_v1_run_unique").on(
      table.scopeId,
      table.runId,
    ),
    foreignKey({
      name: "fx_task_run_request_v1_run_fk",
      columns: [table.scopeId, table.runId],
      foreignColumns: [
        fxSystemDurableTaskRunsV1.scopeId,
        fxSystemDurableTaskRunsV1.runId,
      ],
    }).onDelete("restrict"),
    check(
      "fx_task_run_request_v1_identity_check",
      sql`${table.requestKeyCodecVersion} = 1
        and ${table.requestCodecVersion} = 1
        and ${table.receiptVersion} = 1
        and octet_length(${table.requestKeySha256}) = 32
        and octet_length(${table.requestSha256}) = 32
        and ${table.runId} ~ '^run_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'`,
    ),
  ],
);

/** Immutable attempt-history identity and collision evidence. */
export const fxSystemDurableTaskAttemptIdentitiesV1 = pgTable(
  "fx_system_durable_task_attempt_identity_v1",
  {
    scopeId: text("scope_id").$type<ScopeId>().notNull(),
    attemptId: text("attempt_id").$type<TaskAttemptIdV1>().notNull(),
    runId: text("run_id").$type<TaskRunIdV1>().notNull(),
    attemptNumber: integer("attempt_number").notNull(),
    executionFence: bigint("execution_fence", { mode: "bigint" })
      .$type<TaskExecutionFenceV1>()
      .notNull(),
    acceptedRunVersion: bigint("accepted_run_version", { mode: "bigint" })
      .$type<TaskRunVersionV1>()
      .notNull(),
  },
  table => [
    primaryKey({
      columns: [table.scopeId, table.attemptId],
      name: "fx_task_attempt_identity_v1_pk",
    }),
    unique("fx_task_attempt_identity_v1_ordinal_unique").on(
      table.scopeId,
      table.runId,
      table.attemptNumber,
    ),
    unique("fx_task_attempt_identity_v1_fence_unique").on(
      table.scopeId,
      table.runId,
      table.executionFence,
    ),
    foreignKey({
      name: "fx_task_attempt_identity_v1_run_fk",
      columns: [table.scopeId, table.runId],
      foreignColumns: [
        fxSystemDurableTaskRunsV1.scopeId,
        fxSystemDurableTaskRunsV1.runId,
      ],
    }).onDelete("restrict"),
    check(
      "fx_task_attempt_identity_v1_value_check",
      sql`${table.attemptId} ~ '^attempt_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        and ${table.runId} ~ '^run_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        and ${table.attemptNumber} between 1 and 250
        and ${table.executionFence} >= 1
        and ${table.acceptedRunVersion} >= 1`,
    ),
  ],
);

/** Immutable, ordered lifecycle intent; delivery remains Roadmap 05-owned. */
export const fxSystemDurableTaskRequestedEffectsV1 = pgTable(
  "fx_system_durable_task_requested_effect_v1",
  {
    scopeId: text("scope_id").$type<ScopeId>().notNull(),
    runId: text("run_id").$type<TaskRunIdV1>().notNull(),
    sequence: bigint("sequence", { mode: "bigint" })
      .$type<TaskRequestedEffectSequenceV1>()
      .notNull(),
    acceptedRunVersion: bigint("accepted_run_version", { mode: "bigint" })
      .$type<TaskRunVersionV1>()
      .notNull(),
    kind: text("kind").$type<TaskRequestedEffectV1["kind"]>().notNull(),
    payloadCodecVersion: integer("payload_codec_version").notNull(),
    payloadByteLength: bigint("payload_byte_length", { mode: "bigint" })
      .notNull(),
    payloadJson: jsonb("payload_json").$type<unknown>().notNull(),
    notBeforeMs: bigint("not_before_ms", { mode: "bigint" }),
  },
  table => [
    primaryKey({
      columns: [table.scopeId, table.runId, table.sequence],
      name: "fx_task_requested_effect_v1_pk",
    }),
    foreignKey({
      name: "fx_task_requested_effect_v1_run_fk",
      columns: [table.scopeId, table.runId],
      foreignColumns: [
        fxSystemDurableTaskRunsV1.scopeId,
        fxSystemDurableTaskRunsV1.runId,
      ],
    }).onDelete("restrict"),
    index("fx_task_requested_effect_v1_kind_idx").on(
      table.scopeId,
      table.kind,
      table.runId,
      table.sequence,
    ),
    check(
      "fx_task_requested_effect_v1_identity_check",
      sql`${table.runId} ~ '^run_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        and ${table.sequence} >= 1
        and ${table.acceptedRunVersion} >= 1`,
    ),
    check(
      "fx_task_requested_effect_v1_payload_check",
      sql`${table.payloadCodecVersion} = 1
        and ${table.payloadByteLength} between 1 and ${sql.raw(
          String(MAX_TASK_REQUESTED_EFFECT_PERSISTED_JSON_BYTES_V1),
        )}
        and jsonb_typeof(${table.payloadJson}) = 'object'`,
    ),
    check(
      "fx_task_requested_effect_v1_schedule_check",
      sql`(
        (${table.kind} in ('continue_retry', 'wake_retry', 'wake_lease_expiry')
          and ${table.notBeforeMs} between 0 and 9007199254740991)
        or (${table.kind} in (
            'dispatch_attempt',
            'request_execution_cancellation',
            'release_queue_ownership',
            'publish_lifecycle_event',
            'notify_current_state',
            'cancel_obsolete_lease_wake'
          ) and ${table.notBeforeMs} is null)
      )`,
    ),
  ],
);

type TaskComputePendingRequestedEffectKindV1 = Extract<
  TaskRequestedEffectV1["kind"],
  "dispatch_attempt" | "request_execution_cancellation"
>;

/** Indexed membership only; the immutable requested effect remains authority. */
export const fxSystemDurableTaskComputePendingV1 = pgTable(
  "fx_system_durable_task_compute_pending_v1",
  {
    scopeId: text("scope_id").$type<ScopeId>().notNull(),
    runId: text("run_id").$type<TaskRunIdV1>().notNull(),
    requestedEffectSequence: bigint("requested_effect_sequence", {
      mode: "bigint",
    }).$type<TaskRequestedEffectSequenceV1>().notNull(),
    kind: text("kind").$type<TaskComputePendingRequestedEffectKindV1>()
      .notNull(),
    eligibleAt: timestamp("eligible_at", { withTimezone: true }).notNull(),
  },
  table => [
    primaryKey({
      columns: [
        table.scopeId,
        table.runId,
        table.requestedEffectSequence,
      ],
      name: "fx_task_compute_pending_v1_pk",
    }),
    foreignKey({
      name: "fx_task_compute_pending_v1_effect_fk",
      columns: [
        table.scopeId,
        table.runId,
        table.requestedEffectSequence,
      ],
      foreignColumns: [
        fxSystemDurableTaskRequestedEffectsV1.scopeId,
        fxSystemDurableTaskRequestedEffectsV1.runId,
        fxSystemDurableTaskRequestedEffectsV1.sequence,
      ],
    }).onDelete("restrict"),
    index("fx_task_compute_pending_v1_discovery_idx").on(
      table.scopeId,
      table.kind,
      table.eligibleAt,
      table.runId,
      table.requestedEffectSequence,
    ),
    check(
      "fx_task_compute_pending_v1_identity_check",
      sql`${table.runId} ~ '^run_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        and ${table.requestedEffectSequence} >= 1
        and ${table.kind} in (
          'dispatch_attempt',
          'request_execution_cancellation'
        )`,
    ),
    check(
      "fx_task_compute_pending_v1_eligible_at_check",
      sql`isfinite(${table.eligibleAt})
        and ${table.eligibleAt} = date_trunc('milliseconds', ${table.eligibleAt})`,
    ),
  ],
);

/** Subordinate, operation-specific evidence for one exact dispatch effect. */
export const fxSystemDurableTaskComputeDispatchesV1 = pgTable(
  "fx_system_durable_task_compute_dispatch_v1",
  {
    scopeId: text("scope_id").$type<ScopeId>().notNull(),
    runId: text("run_id").$type<TaskRunIdV1>().notNull(),
    requestedEffectSequence: bigint("requested_effect_sequence", {
      mode: "bigint",
    }).$type<TaskRequestedEffectSequenceV1>().notNull(),
    acceptedRunVersion: bigint("accepted_run_version", { mode: "bigint" })
      .$type<TaskRunVersionV1>()
      .notNull(),
    taskDefinitionRevisionId: text("task_definition_revision_id")
      .$type<TaskDefinitionRevisionIdV1>()
      .notNull(),
    attemptId: text("attempt_id").$type<TaskAttemptIdV1>().notNull(),
    attemptNumber: integer("attempt_number")
      .$type<TaskAttemptNumberV1>()
      .notNull(),
    executionFence: bigint("execution_fence", { mode: "bigint" })
      .$type<TaskExecutionFenceV1>()
      .notNull(),
    leaseVersion: bigint("lease_version", { mode: "bigint" })
      .$type<TaskLeaseVersionV1>()
      .notNull(),
    computeProfileCodecVersion: integer("compute_profile_codec_version")
      .notNull(),
    computeProfileByteLength: integer("compute_profile_byte_length")
      .notNull(),
    computeProfileBytes: bytea("compute_profile_bytes").notNull(),
    cancellationKind: text("cancellation_kind")
      .$type<"not_requested" | "requested">()
      .notNull(),
    cancellationGeneration: bigint("cancellation_generation", {
      mode: "bigint",
    }).$type<TaskCancellationGenerationV1>().notNull(),
    maximumDurationMs: bigint("maximum_duration_ms", { mode: "number" })
      .$type<TaskDurationMsV1>()
      .notNull(),
    requestCodecVersion: integer("request_codec_version").notNull(),
    requestByteLength: bigint("request_byte_length", { mode: "bigint" })
      .notNull(),
    requestSha256: bytea("request_sha256").notNull(),
    requestBytes: bytea("request_bytes").notNull(),
    deliveryState: text("delivery_state")
      .$type<TaskComputeDispatchDeliveryStateV1>()
      .notNull(),
    claimOwner: uuid("claim_owner"),
    claimFence: bigint("claim_fence", { mode: "bigint" }).notNull(),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    claimExpiresAt: timestamp("claim_expires_at", { withTimezone: true }),
    deliveryAttemptCount: bigint("delivery_attempt_count", {
      mode: "bigint",
    }).notNull(),
    deliveryStartedAt: timestamp("delivery_started_at", {
      withTimezone: true,
    }),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
    reasonCode: text("reason_code"),
    acceptanceCodecVersion: integer("acceptance_codec_version"),
    acceptanceByteLength: bigint("acceptance_byte_length", {
      mode: "bigint",
    }),
    acceptanceSha256: bytea("acceptance_sha256"),
    acceptanceBytes: bytea("acceptance_bytes"),
    settledAt: timestamp("settled_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  table => [
    primaryKey({
      columns: [
        table.scopeId,
        table.runId,
        table.requestedEffectSequence,
      ],
      name: "fx_task_compute_dispatch_v1_pk",
    }),
    unique("fx_task_compute_dispatch_v1_attempt_unique").on(
      table.scopeId,
      table.runId,
      table.attemptId,
      table.executionFence,
    ),
    foreignKey({
      name: "fx_task_compute_dispatch_v1_run_fk",
      columns: [table.scopeId, table.runId],
      foreignColumns: [
        fxSystemDurableTaskRunsV1.scopeId,
        fxSystemDurableTaskRunsV1.runId,
      ],
    }).onDelete("restrict"),
    foreignKey({
      name: "fx_task_compute_dispatch_v1_effect_fk",
      columns: [
        table.scopeId,
        table.runId,
        table.requestedEffectSequence,
      ],
      foreignColumns: [
        fxSystemDurableTaskRequestedEffectsV1.scopeId,
        fxSystemDurableTaskRequestedEffectsV1.runId,
        fxSystemDurableTaskRequestedEffectsV1.sequence,
      ],
    }).onDelete("restrict"),
    foreignKey({
      name: "fx_task_compute_dispatch_v1_definition_fk",
      columns: [table.scopeId, table.taskDefinitionRevisionId],
      foreignColumns: [
        fxSystemDurableTaskDefinitionRevisionsV1.scopeId,
        fxSystemDurableTaskDefinitionRevisionsV1.taskDefinitionRevisionId,
      ],
    }).onDelete("restrict"),
    index("fx_task_compute_dispatch_v1_due_idx").on(
      table.scopeId,
      table.deliveryState,
      table.nextAttemptAt,
      table.runId,
      table.requestedEffectSequence,
    ).where(sql`${table.claimOwner} is null`),
    index("fx_task_compute_dispatch_v1_claim_idx").on(
      table.scopeId,
      table.claimExpiresAt,
      table.runId,
      table.requestedEffectSequence,
    ).where(sql`${table.claimOwner} is not null`),
    check(
      "fx_task_compute_dispatch_v1_identity_check",
      sql`${table.runId} ~ '^run_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        and ${table.requestedEffectSequence} >= 1
        and ${table.acceptedRunVersion} >= 1
        and ${table.taskDefinitionRevisionId} ~ '^taskdef_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        and ${table.attemptId} ~ '^attempt_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        and ${table.attemptNumber} between 1 and 250
        and ${table.executionFence} >= 1
        and ${table.leaseVersion} >= 1
        and ${table.computeProfileCodecVersion} = ${sql.raw(String(TASK_COMPUTE_PROFILE_STORAGE_CODEC_V1))}
        and ${table.computeProfileByteLength} between 2 and ${sql.raw(String(MAX_TASK_COMPUTE_PROFILE_STORAGE_BYTES_V1))}
        and ${table.computeProfileByteLength} % 2 = 0
        and octet_length(${table.computeProfileBytes}) = ${table.computeProfileByteLength}
        and ${table.maximumDurationMs} between 1 and 9007199254740991
        and ((${table.cancellationKind} = 'not_requested'
              and ${table.cancellationGeneration} = 0)
          or (${table.cancellationKind} = 'requested'
              and ${table.cancellationGeneration} >= 1))`,
    ),
    check(
      "fx_task_compute_dispatch_v1_request_check",
      sql`${table.requestCodecVersion} = ${sql.raw(
        String(TASK_COMPUTE_DELIVERY_EVIDENCE_CODEC_V1),
      )}
        and ${table.requestByteLength} between 1 and ${sql.raw(
          String(MAX_TASK_COMPUTE_DELIVERY_EVIDENCE_BYTES_V1),
        )}
        and octet_length(${table.requestBytes}) = ${table.requestByteLength}
        and octet_length(${table.requestSha256}) = 32`,
    ),
    check(
      "fx_task_compute_dispatch_v1_claim_check",
      sql`(${table.claimFence} >= 0 and (
        (${table.claimOwner} is null
          and ${table.claimedAt} is null
          and ${table.claimExpiresAt} is null)
        or (${table.claimOwner} is not null
          and ${table.claimFence} >= 1
          and ${table.deliveryState} in ('prepared', 'delivering', 'retry_wait')
          and ${table.claimedAt} is not null
          and isfinite(${table.claimedAt})
          and ${table.claimExpiresAt} is not null
          and isfinite(${table.claimExpiresAt})
          and ${table.claimExpiresAt} > ${table.claimedAt})
      )) is true`,
    ),
    check(
      "fx_task_compute_dispatch_v1_acceptance_check",
      sql`(
        (${table.acceptanceCodecVersion} is null
          and ${table.acceptanceByteLength} is null
          and ${table.acceptanceSha256} is null
          and ${table.acceptanceBytes} is null)
        or (${table.acceptanceCodecVersion} = ${sql.raw(
          String(TASK_COMPUTE_DELIVERY_EVIDENCE_CODEC_V1),
        )}
          and ${table.acceptanceByteLength} between 1 and ${sql.raw(
            String(MAX_TASK_COMPUTE_DELIVERY_EVIDENCE_BYTES_V1),
          )}
          and octet_length(${table.acceptanceBytes}) =
            ${table.acceptanceByteLength}
          and octet_length(${table.acceptanceSha256}) = 32)
      ) is true`,
    ),
    check(
      "fx_task_compute_dispatch_v1_state_check",
      sql`(
        (${table.deliveryState} = 'prepared'
          and ${table.deliveryAttemptCount} = 0
          and ${table.deliveryStartedAt} is null
          and ${table.nextAttemptAt} is null
          and ${table.reasonCode} is null
          and ${table.acceptanceCodecVersion} is null
          and ${table.settledAt} is null)
        or (${table.deliveryState} = 'delivering'
          and ${table.deliveryAttemptCount} >= 1
          and ${table.deliveryStartedAt} is not null
          and ${table.nextAttemptAt} is null
          and ${table.reasonCode} is null
          and ${table.acceptanceCodecVersion} is null
          and ${table.settledAt} is null
          and ${table.claimOwner} is not null)
        or (${table.deliveryState} = 'accepted'
          and ${table.deliveryAttemptCount} >= 1
          and ${table.deliveryStartedAt} is not null
          and ${table.nextAttemptAt} is null
          and ${table.reasonCode} is null
          and ${table.acceptanceCodecVersion} is not null
          and ${table.settledAt} is not null
          and ${table.claimOwner} is null)
        or (${table.deliveryState} = 'retry_wait'
          and ${table.deliveryAttemptCount} >= 1
          and ${table.deliveryStartedAt} is not null
          and ${table.nextAttemptAt} is not null
          and ${table.nextAttemptAt} > ${table.deliveryStartedAt}
          and ${table.reasonCode} is not null
          and ${table.acceptanceCodecVersion} is null
          and ${table.settledAt} is null)
        or (${table.deliveryState} = 'rejected'
          and ${table.deliveryAttemptCount} >= 1
          and ${table.deliveryStartedAt} is not null
          and ${table.nextAttemptAt} is null
          and ${table.reasonCode} is not null
          and ${table.acceptanceCodecVersion} is null
          and ${table.settledAt} is not null
          and ${table.claimOwner} is null)
        or (${table.deliveryState} = 'quarantined'
          and ${table.deliveryAttemptCount} >= 0
          and ((${table.deliveryAttemptCount} = 0
              and ${table.deliveryStartedAt} is null)
            or (${table.deliveryAttemptCount} >= 1
              and ${table.deliveryStartedAt} is not null))
          and ${table.nextAttemptAt} is null
          and ${table.reasonCode} is not null
          and ${table.acceptanceCodecVersion} is null
          and ${table.settledAt} is not null
          and ${table.claimOwner} is null)
        or (${table.deliveryState} = 'obsolete'
          and ${table.deliveryAttemptCount} = 0
          and ${table.deliveryStartedAt} is null
          and ${table.nextAttemptAt} is null
          and ${table.reasonCode} is not null
          and ${table.acceptanceCodecVersion} is null
          and ${table.settledAt} is not null
          and ${table.claimOwner} is null)
      ) is true`,
    ),
    check(
      "fx_task_compute_dispatch_v1_reason_check",
      sql`(${table.reasonCode} is null or (
        ${table.reasonCode} ~ '^[a-z][a-z0-9_]*$'
        and octet_length(convert_to(${table.reasonCode}, 'UTF8')) between 1 and ${sql.raw(
          String(MAX_TASK_COMPUTE_DELIVERY_REASON_CODE_UTF8_BYTES_V1),
        )}
      )) is true`,
    ),
    check(
      "fx_task_compute_dispatch_v1_time_check",
      sql`(isfinite(${table.createdAt})
        and isfinite(${table.updatedAt})
        and ${table.updatedAt} >= ${table.createdAt}
        and (${table.deliveryStartedAt} is null
          or (isfinite(${table.deliveryStartedAt})
            and ${table.deliveryStartedAt} >= ${table.createdAt}))
        and (${table.nextAttemptAt} is null
          or isfinite(${table.nextAttemptAt}))
        and (${table.settledAt} is null
          or (isfinite(${table.settledAt})
            and ${table.settledAt} >= ${table.createdAt}
            and (${table.deliveryStartedAt} is null
              or ${table.settledAt} >= ${table.deliveryStartedAt})))) is true`,
    ),
  ],
);

/** Subordinate evidence for one exact cancellation-delivery effect. */
export const fxSystemDurableTaskComputeCancellationsV1 = pgTable(
  "fx_system_durable_task_compute_cancellation_v1",
  {
    scopeId: text("scope_id").$type<ScopeId>().notNull(),
    runId: text("run_id").$type<TaskRunIdV1>().notNull(),
    requestedEffectSequence: bigint("requested_effect_sequence", {
      mode: "bigint",
    }).$type<TaskRequestedEffectSequenceV1>().notNull(),
    acceptedRunVersion: bigint("accepted_run_version", { mode: "bigint" })
      .$type<TaskRunVersionV1>()
      .notNull(),
    dispatchRequestedEffectSequence: bigint(
      "dispatch_requested_effect_sequence",
      { mode: "bigint" },
    ).$type<TaskRequestedEffectSequenceV1>().notNull(),
    attemptId: text("attempt_id").$type<TaskAttemptIdV1>().notNull(),
    executionFence: bigint("execution_fence", { mode: "bigint" })
      .$type<TaskExecutionFenceV1>()
      .notNull(),
    cancellationGeneration: bigint("cancellation_generation", {
      mode: "bigint",
    }).$type<TaskCancellationGenerationV1>().notNull(),
    requestCodecVersion: integer("request_codec_version"),
    requestByteLength: bigint("request_byte_length", { mode: "bigint" }),
    requestSha256: bytea("request_sha256"),
    requestBytes: bytea("request_bytes"),
    deliveryState: text("delivery_state")
      .$type<TaskComputeCancellationDeliveryStateV1>()
      .notNull(),
    claimOwner: uuid("claim_owner"),
    claimFence: bigint("claim_fence", { mode: "bigint" }).notNull(),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    claimExpiresAt: timestamp("claim_expires_at", { withTimezone: true }),
    deliveryAttemptCount: bigint("delivery_attempt_count", {
      mode: "bigint",
    }).notNull(),
    deliveryStartedAt: timestamp("delivery_started_at", {
      withTimezone: true,
    }),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
    reasonCode: text("reason_code"),
    receiptCodecVersion: integer("receipt_codec_version"),
    receiptByteLength: bigint("receipt_byte_length", { mode: "bigint" }),
    receiptSha256: bytea("receipt_sha256"),
    receiptBytes: bytea("receipt_bytes"),
    settledAt: timestamp("settled_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  table => [
    primaryKey({
      columns: [
        table.scopeId,
        table.runId,
        table.requestedEffectSequence,
      ],
      name: "fx_task_compute_cancel_v1_pk",
    }),
    unique("fx_task_compute_cancel_v1_generation_unique").on(
      table.scopeId,
      table.runId,
      table.attemptId,
      table.executionFence,
      table.cancellationGeneration,
    ),
    foreignKey({
      name: "fx_task_compute_cancel_v1_run_fk",
      columns: [table.scopeId, table.runId],
      foreignColumns: [
        fxSystemDurableTaskRunsV1.scopeId,
        fxSystemDurableTaskRunsV1.runId,
      ],
    }).onDelete("restrict"),
    foreignKey({
      name: "fx_task_compute_cancel_v1_effect_fk",
      columns: [
        table.scopeId,
        table.runId,
        table.requestedEffectSequence,
      ],
      foreignColumns: [
        fxSystemDurableTaskRequestedEffectsV1.scopeId,
        fxSystemDurableTaskRequestedEffectsV1.runId,
        fxSystemDurableTaskRequestedEffectsV1.sequence,
      ],
    }).onDelete("restrict"),
    foreignKey({
      name: "fx_task_compute_cancel_v1_dispatch_fk",
      columns: [
        table.scopeId,
        table.runId,
        table.dispatchRequestedEffectSequence,
      ],
      foreignColumns: [
        fxSystemDurableTaskComputeDispatchesV1.scopeId,
        fxSystemDurableTaskComputeDispatchesV1.runId,
        fxSystemDurableTaskComputeDispatchesV1.requestedEffectSequence,
      ],
    }).onDelete("restrict"),
    index("fx_task_compute_cancel_v1_due_idx").on(
      table.scopeId,
      table.deliveryState,
      table.nextAttemptAt,
      table.runId,
      table.requestedEffectSequence,
    ).where(sql`${table.claimOwner} is null`),
    index("fx_task_compute_cancel_v1_claim_idx").on(
      table.scopeId,
      table.claimExpiresAt,
      table.runId,
      table.requestedEffectSequence,
    ).where(sql`${table.claimOwner} is not null`),
    check(
      "fx_task_compute_cancel_v1_identity_check",
      sql`${table.runId} ~ '^run_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        and ${table.requestedEffectSequence} >= 1
        and ${table.acceptedRunVersion} >= 1
        and ${table.dispatchRequestedEffectSequence} >= 1
        and ${table.dispatchRequestedEffectSequence} <
          ${table.requestedEffectSequence}
        and ${table.attemptId} ~ '^attempt_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        and ${table.executionFence} >= 1
        and ${table.cancellationGeneration} >= 1`,
    ),
    check(
      "fx_task_compute_cancel_v1_request_check",
      sql`(
        (${table.requestCodecVersion} is null
          and ${table.requestByteLength} is null
          and ${table.requestSha256} is null
          and ${table.requestBytes} is null)
        or (${table.requestCodecVersion} = ${sql.raw(
          String(TASK_COMPUTE_DELIVERY_EVIDENCE_CODEC_V1),
        )}
          and ${table.requestByteLength} between 1 and ${sql.raw(
            String(MAX_TASK_COMPUTE_DELIVERY_EVIDENCE_BYTES_V1),
          )}
          and octet_length(${table.requestBytes}) = ${table.requestByteLength}
          and octet_length(${table.requestSha256}) = 32)
      ) is true`,
    ),
    check(
      "fx_task_compute_cancel_v1_claim_check",
      sql`(${table.claimFence} >= 0 and (
        (${table.claimOwner} is null
          and ${table.claimedAt} is null
          and ${table.claimExpiresAt} is null)
        or (${table.claimOwner} is not null
          and ${table.claimFence} >= 1
          and ${table.deliveryState} in ('prepared', 'delivering', 'retry_wait')
          and ${table.claimedAt} is not null
          and isfinite(${table.claimedAt})
          and ${table.claimExpiresAt} is not null
          and isfinite(${table.claimExpiresAt})
          and ${table.claimExpiresAt} > ${table.claimedAt})
      )) is true`,
    ),
    check(
      "fx_task_compute_cancel_v1_receipt_check",
      sql`(
        (${table.receiptCodecVersion} is null
          and ${table.receiptByteLength} is null
          and ${table.receiptSha256} is null
          and ${table.receiptBytes} is null)
        or (${table.receiptCodecVersion} = ${sql.raw(
          String(TASK_COMPUTE_DELIVERY_EVIDENCE_CODEC_V1),
        )}
          and ${table.receiptByteLength} between 1 and ${sql.raw(
            String(MAX_TASK_COMPUTE_DELIVERY_EVIDENCE_BYTES_V1),
          )}
          and octet_length(${table.receiptBytes}) = ${table.receiptByteLength}
          and octet_length(${table.receiptSha256}) = 32)
      ) is true`,
    ),
    check(
      "fx_task_compute_cancel_v1_state_check",
      sql`(
        (${table.deliveryState} = 'waiting_dispatch'
          and ${table.requestCodecVersion} is null
          and ${table.deliveryAttemptCount} = 0
          and ${table.deliveryStartedAt} is null
          and ${table.nextAttemptAt} is null
          and ${table.reasonCode} is null
          and ${table.receiptCodecVersion} is null
          and ${table.settledAt} is null
          and ${table.claimOwner} is null)
        or (${table.deliveryState} = 'prepared'
          and ${table.requestCodecVersion} is not null
          and ${table.deliveryAttemptCount} = 0
          and ${table.deliveryStartedAt} is null
          and ${table.nextAttemptAt} is null
          and ${table.reasonCode} is null
          and ${table.receiptCodecVersion} is null
          and ${table.settledAt} is null)
        or (${table.deliveryState} = 'delivering'
          and ${table.requestCodecVersion} is not null
          and ${table.deliveryAttemptCount} >= 1
          and ${table.deliveryStartedAt} is not null
          and ${table.nextAttemptAt} is null
          and ${table.reasonCode} is null
          and ${table.receiptCodecVersion} is null
          and ${table.settledAt} is null
          and ${table.claimOwner} is not null)
        or (${table.deliveryState} = 'delivered'
          and ${table.requestCodecVersion} is not null
          and ${table.deliveryAttemptCount} >= 1
          and ${table.deliveryStartedAt} is not null
          and ${table.nextAttemptAt} is null
          and ${table.reasonCode} is null
          and ${table.receiptCodecVersion} is not null
          and ${table.settledAt} is not null
          and ${table.claimOwner} is null)
        or (${table.deliveryState} = 'retry_wait'
          and ${table.requestCodecVersion} is not null
          and ${table.deliveryAttemptCount} >= 1
          and ${table.deliveryStartedAt} is not null
          and ${table.nextAttemptAt} is not null
          and ${table.nextAttemptAt} > ${table.deliveryStartedAt}
          and ${table.reasonCode} is not null
          and ${table.receiptCodecVersion} is null
          and ${table.settledAt} is null)
        or (${table.deliveryState} = 'rejected'
          and ${table.requestCodecVersion} is not null
          and ${table.deliveryAttemptCount} >= 1
          and ${table.deliveryStartedAt} is not null
          and ${table.nextAttemptAt} is null
          and ${table.reasonCode} is not null
          and ${table.receiptCodecVersion} is null
          and ${table.settledAt} is not null
          and ${table.claimOwner} is null)
        or (${table.deliveryState} = 'obsolete'
          and ${table.deliveryAttemptCount} = 0
          and ${table.deliveryStartedAt} is null
          and ${table.nextAttemptAt} is null
          and ${table.reasonCode} is not null
          and ${table.receiptCodecVersion} is null
          and ${table.settledAt} is not null
          and ${table.claimOwner} is null)
        or (${table.deliveryState} = 'quarantined'
          and ${table.deliveryAttemptCount} >= 0
          and ((${table.deliveryAttemptCount} = 0
              and ${table.deliveryStartedAt} is null)
            or (${table.deliveryAttemptCount} >= 1
              and ${table.deliveryStartedAt} is not null
              and ${table.requestCodecVersion} is not null))
          and ${table.nextAttemptAt} is null
          and ${table.reasonCode} is not null
          and ${table.receiptCodecVersion} is null
          and ${table.settledAt} is not null
          and ${table.claimOwner} is null)
      ) is true`,
    ),
    check(
      "fx_task_compute_cancel_v1_reason_check",
      sql`(${table.reasonCode} is null or (
        ${table.reasonCode} ~ '^[a-z][a-z0-9_]*$'
        and octet_length(convert_to(${table.reasonCode}, 'UTF8')) between 1 and ${sql.raw(
          String(MAX_TASK_COMPUTE_DELIVERY_REASON_CODE_UTF8_BYTES_V1),
        )}
      )) is true`,
    ),
    check(
      "fx_task_compute_cancel_v1_time_check",
      sql`(isfinite(${table.createdAt})
        and isfinite(${table.updatedAt})
        and ${table.updatedAt} >= ${table.createdAt}
        and (${table.deliveryStartedAt} is null
          or (isfinite(${table.deliveryStartedAt})
            and ${table.deliveryStartedAt} >= ${table.createdAt}))
        and (${table.nextAttemptAt} is null
          or isfinite(${table.nextAttemptAt}))
        and (${table.settledAt} is null
          or (isfinite(${table.settledAt})
            and ${table.settledAt} >= ${table.createdAt}
            and (${table.deliveryStartedAt} is null
              or ${table.settledAt} >= ${table.deliveryStartedAt})))) is true`,
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
  fxAppIndexEntryCurrent,
  fxAppIndexEntryRevisions,
  fxAppUniqueKeys,
  fxControlIndexDefinitions,
  freshnessProcessedEvents,
  fxControlIndexes,
  fxControlSchemaVersionIndexBindings,
  fxControlSchemaVersionUniqueConstraintBindings,
  fxControlSchemaVersionUniqueConstraintSets,
  fxControlSchemaVersions,
  fxControlTables,
  fxControlUniqueConstraintDefinitions,
  fxControlUniqueConstraints,
  fxControlScopeProvisioning,
  fxControlScopes,
  fxSystemApplicationAnalysesV1,
  fxSystemApplicationActivationsV1,
  fxSystemApplicationActiveHeadsV1,
  fxSystemApplicationCandidatesV1,
  fxSystemApplicationFunctionsV1,
  fxSystemApplicationPublicationsV1,
  fxSystemApplicationReadinessFunctionsV1,
  fxSystemApplicationReadinessV1,
  fxSystemApplicationRevisionRequestsV1,
  fxSystemApplicationRevisionSchemasV1,
  fxSystemApplicationRevisionsV1,
  fxSystemApplicationRevisionsV2,
  fxControlApplicationSchemaAuthoritiesV1,
  fxSystemApplicationActionInvocationsV1,
  fxSystemDeclarativeV2ActivationHeads,
  fxSystemDeclarativeV2ActivationRevisions,
  fxSystemDeclarativeV2Candidates,
  fxSystemDeclarativeV2Verdicts,
  fxSystemDeclarativeV2VerifierAttemptsV2,
  fxSystemDeclarativeV2VerifierCommandsV2,
  fxSystemDeclarativeV2VerifierEvidencePagesV2,
  fxSystemDurableTaskAttemptIdentitiesV1,
  fxSystemDurableTaskComputeCancellationsV1,
  fxSystemDurableTaskComputeDispatchesV1,
  fxSystemDurableTaskComputePendingV1,
  fxSystemDurableTaskDefinitionRevisionsV1,
  fxSystemDurableTaskRequestedEffectsV1,
  fxSystemDurableTaskRunRequestsV1,
  fxSystemDurableTaskRunsV1,
  fxSystemIndexBuildStates,
  fxSystemAppSchemaCandidateValidations,
  fxSystemUniqueConstraintSetBuilds,
  fxSystemExternalEffectAttemptsV1,
  fxSystemSnapshotLeases,
  fxSystemScopeClocks,
  fxSystemPointMutationRedeliveryScheduler,
  fxSystemDurableTaskRepairSchedulerV1,
  fxSystemTransactionExecutionClaims,
  fxSystemTransactionJournalLatestReceipts,
  fxSystemTransactionJournalIndexRanges,
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
