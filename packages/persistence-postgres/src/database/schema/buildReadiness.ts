import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import type {
  CatalogIndexDefinitionId,
  CatalogIndexId,
  CatalogTableId,
  CatalogUniqueConstraintDefinitionId,
} from "flarex-protocol/catalog";
import type {
  AppUniqueConstraintSetBuildAttemptFenceV1,
  AppUniqueConstraintSetBuildLifecycleV1,
} from "flarex-protocol/internal/app-unique-constraint-set-v1";
import {
  MAX_APP_SCHEMA_CANDIDATE_VALIDATION_CANONICAL_FRAME_BYTES_V1,
  type AppSchemaCandidateValidationAttemptFenceV1,
  type AppSchemaCandidateValidationCodecVersionV1,
  type AppSchemaCandidateValidationFrameV1,
} from "flarex-protocol/internal/app-schema-candidate-validation-v1";
import type {
  IndexBuildAttemptFence,
  IndexBuildCursorCodecVersionV1,
  IndexBuildLifecycleV1,
} from "flarex-protocol/index-build-state";
import type { CatalogSchemaVersionId } from "flarex-protocol/schema-manifest";
import type {
  CommitSeq,
  FlarexDbV1StorageGeneration,
  ScopeEpoch,
  ScopeId,
  ScopeUuidV1,
  StorageGenerationFence,
} from "flarex-protocol/storage-authority";
import { bytea, nonBlankText } from "./primitives";
import { fxSystemScopeClocks } from "./scope";

/** Search coverage is scoped to an exact logical source generation. Absence or
 * a stale digest cannot authorize serving; the shared binding owner may mark
 * an empty table ready under the publication lock. */
export const fxSystemSearchBuildStates = pgTable(
  "fx_system_search_build_state",
  {
    scopeUuid: uuid("scope_uuid").$type<ScopeUuidV1>().notNull(),
    tableId: integer("table_id").$type<CatalogTableId>().notNull(),
    logicalIndexId: integer("logical_index_id").$type<CatalogIndexId>().notNull(),
    sourceSha256: text("source_sha256").notNull(),
    lifecycle: text("lifecycle").$type<"building" | "ready">().notNull(),
    coveredThroughCommitSeq: bigint("covered_through_commit_seq", { mode: "bigint" })
      .$type<CommitSeq>().notNull(),
  },
  (table) => [
    primaryKey({ name: "fx_system_search_build_state_pk", columns: [
      table.scopeUuid, table.tableId, table.logicalIndexId,
    ] }),
    foreignKey({ name: "fx_system_search_build_state_scope_fk", columns: [table.scopeUuid],
      foreignColumns: [fxSystemScopeClocks.scopeUuid] }).onUpdate("restrict").onDelete("restrict"),
    check("fx_system_search_build_state_table_check", sql`${table.tableId} between 1 and 2147483647`),
    check("fx_system_search_build_state_index_check", sql`${table.logicalIndexId} between 1 and 2147483647`),
    check("fx_system_search_build_state_source_check", sql`${table.sourceSha256} ~ '^[0-9a-f]{64}$'`),
    check("fx_system_search_build_state_lifecycle_check", sql`${table.lifecycle} in ('building', 'ready')`),
    check("fx_system_search_build_state_coverage_check", sql`${table.coveredThroughCommitSeq} >= 0`),
  ],
);

/**
 * Data-plane lifecycle for one scoped physical index definition.
 *
 * The definition itself remains in the deployment control catalog. This row
 * intentionally has no deployment copy or cross-database definition foreign
 * key because the accepted split topologies locate it beside the scope clock.
 */
/** Immutable activation-issued opening pins. The mutable build references this
 * independent witness; retained history never references a future build tuple. */
export const fxSystemIndexMaintenanceObligations = pgTable("fx_system_index_maintenance_obligation", {
  scopeId: text("scope_id").$type<ScopeId>().notNull(),
  indexDefinitionId: integer("index_definition_id").$type<CatalogIndexDefinitionId>().notNull(),
  activationSequence: bigint("activation_sequence", { mode: "bigint" }).notNull(),
  storageGeneration: text("storage_generation").$type<FlarexDbV1StorageGeneration>().notNull(),
  storageGenerationFence: bigint("storage_generation_fence", { mode: "bigint" }).$type<StorageGenerationFence>().notNull(),
  epoch: text("epoch").$type<ScopeEpoch>().notNull(),
  attemptFence: bigint("attempt_fence", { mode: "bigint" }).$type<IndexBuildAttemptFence>().notNull(),
  firstReadableCommitSeq: bigint("first_readable_commit_seq", { mode: "bigint" }).$type<CommitSeq>().notNull(),
  openedCommitSeq: bigint("opened_commit_seq", { mode: "bigint" }).$type<CommitSeq>().notNull(),
  tableId: integer("table_id").$type<CatalogTableId>().notNull(),
  physicalSpecSha256: bytea("physical_spec_sha256").notNull(),
  deploymentId: text("deployment_id").notNull(),
  schemaVersionId: text("schema_version_id").notNull(),
  schemaManifestSha256: bytea("schema_manifest_sha256").notNull(),
  activationSha256: bytea("activation_sha256").notNull(),
  headSha256: bytea("head_sha256").notNull(),
}, table => [
  primaryKey({ name: "fx_index_maintenance_obligation_pk", columns: [table.scopeId, table.indexDefinitionId, table.activationSequence] }),
  unique("fx_index_maintenance_opening_unique").on(table.scopeId, table.indexDefinitionId, table.activationSequence,
    table.storageGeneration, table.storageGenerationFence, table.epoch, table.attemptFence, table.openedCommitSeq, table.firstReadableCommitSeq),
  check("fx_index_maintenance_identity_check", sql`${table.indexDefinitionId} > 0 and ${table.tableId} > 0 and ${table.activationSequence} > 0`),
  check("fx_index_maintenance_authority_check", sql`${table.storageGeneration} = 'flarexdb_v1' and ${table.storageGenerationFence} > 0 and ${table.attemptFence} > 0`),
  check("fx_index_maintenance_frontier_check", sql`${table.firstReadableCommitSeq} >= 0 and ${table.openedCommitSeq} >= ${table.firstReadableCommitSeq}`),
  check("fx_index_maintenance_text_check", sql`length(${table.scopeId}) > 0 and length(${table.epoch}) > 0 and length(${table.deploymentId}) > 0 and length(${table.schemaVersionId}) > 0`),
  check("fx_index_maintenance_digest_check", sql`octet_length(${table.physicalSpecSha256}) = 32 and octet_length(${table.schemaManifestSha256}) = 32 and octet_length(${table.activationSha256}) = 32 and octet_length(${table.headSha256}) = 32`),
]);

export const fxSystemUniqueMaintenanceObligations = pgTable("fx_system_unique_maintenance_obligation", {
  scopeId: text("scope_id").$type<ScopeId>().notNull(),
  uniqueConstraintDefinitionId: integer("unique_constraint_definition_id").$type<CatalogUniqueConstraintDefinitionId>().notNull(),
  activationSequence: bigint("activation_sequence", { mode: "bigint" }).notNull(),
  storageGeneration: text("storage_generation").$type<FlarexDbV1StorageGeneration>().notNull(),
  storageGenerationFence: bigint("storage_generation_fence", { mode: "bigint" }).$type<StorageGenerationFence>().notNull(),
  epoch: text("epoch").$type<ScopeEpoch>().notNull(),
  attemptFence: bigint("attempt_fence", { mode: "bigint" }).$type<AppUniqueConstraintSetBuildAttemptFenceV1>().notNull(),
  startCommitSeq: bigint("start_commit_seq", { mode: "bigint" }).$type<CommitSeq>().notNull(),
  openedCommitSeq: bigint("opened_commit_seq", { mode: "bigint" }).$type<CommitSeq>().notNull(),
  tableId: integer("table_id").$type<CatalogTableId>().notNull(),
  physicalSpecSha256: bytea("physical_spec_sha256").notNull(),
  deploymentId: text("deployment_id").notNull(),
  schemaVersionId: text("schema_version_id").notNull(),
  activationSha256: bytea("activation_sha256").notNull(),
  headSha256: bytea("head_sha256").notNull(),
}, table => [
  primaryKey({ name: "fx_unique_maintenance_obligation_pk", columns: [table.scopeId, table.uniqueConstraintDefinitionId, table.activationSequence] }),
  unique("fx_unique_maintenance_opening_unique").on(table.scopeId, table.uniqueConstraintDefinitionId, table.activationSequence,
    table.storageGeneration, table.storageGenerationFence, table.epoch, table.attemptFence, table.openedCommitSeq, table.startCommitSeq),
  check("fx_unique_maintenance_identity_check", sql`${table.uniqueConstraintDefinitionId} > 0 and ${table.tableId} > 0 and ${table.activationSequence} > 0`),
  check("fx_unique_maintenance_authority_check", sql`${table.storageGeneration} = 'flarexdb_v1' and ${table.storageGenerationFence} > 0 and ${table.attemptFence} > 0`),
  check("fx_unique_maintenance_frontier_check", sql`${table.startCommitSeq} >= 0 and ${table.openedCommitSeq} >= ${table.startCommitSeq}`),
  check("fx_unique_maintenance_text_check", sql`length(${table.scopeId}) > 0 and length(${table.epoch}) > 0 and length(${table.deploymentId}) > 0 and length(${table.schemaVersionId}) > 0`),
  check("fx_unique_maintenance_digest_check", sql`octet_length(${table.physicalSpecSha256}) = 32 and octet_length(${table.activationSha256}) = 32 and octet_length(${table.headSha256}) = 32`),
]);

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
    coveredThroughCommitSeq: bigint("covered_through_commit_seq", { mode: "bigint" })
      .$type<CommitSeq>(),
    firstReadableCommitSeq: bigint("first_readable_commit_seq", { mode: "bigint" })
      .$type<CommitSeq>(),
    maintenanceActivationSequence: bigint("maintenance_activation_sequence", { mode: "bigint" }),
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
    index("fx_system_index_build_maintenance_idx")
      .on(table.scopeId, table.maintenanceActivationSequence)
      .where(sql`${table.maintenanceActivationSequence} is not null`),
    check("fx_system_index_build_maintenance_check", sql`
      ${table.maintenanceActivationSequence} is null
      or (${table.maintenanceActivationSequence} is not null and ${table.maintenanceActivationSequence} > 0
        and ${table.lifecycle} = 'enabled' and ${table.firstReadableCommitSeq} is not null and ${table.coveredThroughCommitSeq} is not null)`),
    foreignKey({ name: "fx_index_build_maintenance_opening_fk",
      columns: [table.scopeId, table.indexDefinitionId, table.maintenanceActivationSequence, table.storageGeneration,
        table.storageGenerationFence, table.epoch, table.attemptFence, table.coveredThroughCommitSeq, table.firstReadableCommitSeq],
      foreignColumns: [fxSystemIndexMaintenanceObligations.scopeId, fxSystemIndexMaintenanceObligations.indexDefinitionId,
        fxSystemIndexMaintenanceObligations.activationSequence, fxSystemIndexMaintenanceObligations.storageGeneration,
        fxSystemIndexMaintenanceObligations.storageGenerationFence, fxSystemIndexMaintenanceObligations.epoch,
        fxSystemIndexMaintenanceObligations.attemptFence, fxSystemIndexMaintenanceObligations.openedCommitSeq,
        fxSystemIndexMaintenanceObligations.firstReadableCommitSeq] }).onUpdate("restrict").onDelete("restrict"),
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
      "fx_system_index_build_coverage_check",
      sql`${table.coveredThroughCommitSeq} is null or ${table.coveredThroughCommitSeq} >= 0`,
    ),
    check(
      "fx_system_index_build_readable_check",
      sql`${table.firstReadableCommitSeq} is null or (${table.coveredThroughCommitSeq} is not null and ${table.firstReadableCommitSeq} >= 0 and ${table.firstReadableCommitSeq} <= ${table.coveredThroughCommitSeq})`,
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

export type PhysicalDefinitionLifecycleKindV1 =
  | "index"
  | "unique_constraint";

export type PhysicalDefinitionLifecycleV1 =
  | "active"
  | "draining"
  | "retired"
  | "reactivating";

/**
 * Scope-local availability authority for one immutable control definition.
 *
 * Absence means the subject has never entered retirement and remains active.
 * The immutable definition body and schema bindings stay in the control
 * catalog, so this target-local row intentionally has no cross-database FK.
 */
export const fxSystemPhysicalDefinitionLifecycles = pgTable(
  "fx_system_physical_definition_lifecycle",
  {
    scopeId: text("scope_id").$type<ScopeId>().notNull(),
    deploymentId: text("deployment_id").notNull(),
    definitionKind: text("definition_kind")
      .$type<PhysicalDefinitionLifecycleKindV1>()
      .notNull(),
    definitionId: integer("definition_id").notNull(),
    lifecycle: text("lifecycle")
      .$type<PhysicalDefinitionLifecycleV1>()
      .notNull(),
    transitionFence: bigint("transition_fence", { mode: "bigint" }).notNull(),
    physicalSpecSha256: bytea("physical_spec_sha256").notNull(),
    requestCodecVersion: integer("request_codec_version").notNull(),
    requestSha256: bytea("request_sha256").notNull(),
    storageGeneration: text("storage_generation")
      .$type<FlarexDbV1StorageGeneration>()
      .notNull(),
    storageGenerationFence: bigint("storage_generation_fence", {
      mode: "bigint",
    }).$type<StorageGenerationFence>().notNull(),
    epoch: text("epoch").$type<ScopeEpoch>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({
      name: "fx_system_physical_definition_lifecycle_pk",
      columns: [table.scopeId, table.definitionKind, table.definitionId],
    }),
    foreignKey({
      name: "fx_system_physical_definition_lifecycle_scope_fk",
      columns: [table.scopeId],
      foreignColumns: [fxSystemScopeClocks.scopeId],
    }).onDelete("restrict"),
    check(
      "fx_system_physical_definition_lifecycle_scope_check",
      nonBlankText(table.scopeId),
    ),
    check(
      "fx_system_physical_definition_lifecycle_deployment_check",
      nonBlankText(table.deploymentId),
    ),
    check(
      "fx_system_physical_definition_lifecycle_kind_check",
      sql`${table.definitionKind} in ('index', 'unique_constraint')`,
    ),
    check(
      "fx_system_physical_definition_lifecycle_definition_check",
      sql`${table.definitionId} between 1 and 2147483647`,
    ),
    check(
      "fx_system_physical_definition_lifecycle_state_check",
      sql`${table.lifecycle} in ('active', 'draining', 'retired', 'reactivating')`,
    ),
    check(
      "fx_system_physical_definition_lifecycle_fence_check",
      sql`${table.transitionFence} >= 1`,
    ),
    check(
      "fx_system_physical_definition_lifecycle_digest_check",
      sql`octet_length(${table.physicalSpecSha256}) = 32
        and ${table.requestCodecVersion} = 1
        and octet_length(${table.requestSha256}) = 32`,
    ),
    check(
      "fx_system_physical_definition_lifecycle_authority_check",
      sql`${table.storageGeneration} = 'flarexdb_v1'
        and ${table.storageGenerationFence} >= 1
        and ${nonBlankText(table.epoch)}`,
    ),
    check(
      "fx_system_physical_definition_lifecycle_time_check",
      sql`isfinite(${table.createdAt}) and isfinite(${table.updatedAt})
        and ${table.updatedAt} >= ${table.createdAt}`,
    ),
  ],
);

/** One fenced population and coverage workspace per physical unique constraint. */
export const fxSystemUniqueConstraintBuilds = pgTable(
  "fx_system_unique_constraint_build",
  {
    scopeId: text("scope_id").$type<ScopeId>().notNull(),
    uniqueConstraintDefinitionId: integer("unique_constraint_definition_id")
      .$type<CatalogUniqueConstraintDefinitionId>().notNull(),
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
    coveredThroughCommitSeq: bigint("covered_through_commit_seq", { mode: "bigint" })
      .$type<CommitSeq>(),
    maintenanceActivationSequence: bigint("maintenance_activation_sequence", { mode: "bigint" }),
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
      name: "fx_system_unique_build_pk",
      columns: [table.scopeId, table.uniqueConstraintDefinitionId],
    }),
    index("fx_system_unique_build_maintenance_idx")
      .on(table.scopeId, table.maintenanceActivationSequence)
      .where(sql`${table.maintenanceActivationSequence} is not null`),
    check("fx_system_unique_build_maintenance_check", sql`
      ${table.maintenanceActivationSequence} is null
      or (${table.maintenanceActivationSequence} is not null and ${table.maintenanceActivationSequence} > 0
        and ${table.lifecycle} = 'enabled' and ${table.coveredThroughCommitSeq} is not null)`),
    foreignKey({ name: "fx_unique_build_maintenance_opening_fk",
      columns: [table.scopeId, table.uniqueConstraintDefinitionId, table.maintenanceActivationSequence, table.storageGeneration,
        table.storageGenerationFence, table.epoch, table.attemptFence, table.coveredThroughCommitSeq, table.startCommitSeq],
      foreignColumns: [fxSystemUniqueMaintenanceObligations.scopeId, fxSystemUniqueMaintenanceObligations.uniqueConstraintDefinitionId,
        fxSystemUniqueMaintenanceObligations.activationSequence, fxSystemUniqueMaintenanceObligations.storageGeneration,
        fxSystemUniqueMaintenanceObligations.storageGenerationFence, fxSystemUniqueMaintenanceObligations.epoch,
        fxSystemUniqueMaintenanceObligations.attemptFence, fxSystemUniqueMaintenanceObligations.openedCommitSeq,
        fxSystemUniqueMaintenanceObligations.startCommitSeq] }).onUpdate("restrict").onDelete("restrict"),
    foreignKey({
      name: "fx_system_unique_build_scope_fk",
      columns: [table.scopeId],
      foreignColumns: [fxSystemScopeClocks.scopeId],
    }).onDelete("restrict"),
    check("fx_system_unique_build_scope_check", nonBlankText(table.scopeId)),
    check("fx_system_unique_build_identity_check",
      sql`${table.uniqueConstraintDefinitionId} between 1 and 2147483647`),
    check(
      "fx_system_unique_build_clock_check",
      sql`${table.storageGeneration} = 'flarexdb_v1'
        and ${table.storageGenerationFence} >= 1
        and ${nonBlankText(table.epoch)}
        and ${table.startCommitSeq} >= 0`,
    ),
    check(
      "fx_system_unique_build_lifecycle_check",
      sql`${table.lifecycle} in ('declared', 'building', 'backfilling', 'validating', 'enabled')`,
    ),
    check(
      "fx_system_unique_build_cursor_check",
      sql`(${table.cursorRowId} is null or octet_length(${table.cursorRowId}) = 16)
        and (${table.lifecycle} not in ('declared', 'building', 'enabled')
          or ${table.cursorRowId} is null)`,
    ),
    check("fx_system_unique_build_coverage_check",
      sql`(${table.coveredThroughCommitSeq} is null or ${table.coveredThroughCommitSeq} >= ${table.startCommitSeq})
        and (${table.lifecycle} not in ('declared', 'building') or ${table.coveredThroughCommitSeq} is null)
        and (${table.lifecycle} <> 'enabled' or ${table.coveredThroughCommitSeq} is not null)`),
    check(
      "fx_system_unique_build_attempt_check",
      sql`${table.attemptFence} >= 1`,
    ),
    check(
      "fx_system_unique_build_time_check",
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
