import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  foreignKey,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import type {
  DeclarativeV2RuntimeExecutionGroupV1,
} from "flarex-protocol/internal/declarative-v2-physical-v1";
import type { ScopeId } from "flarex-protocol/storage-authority";
import { bytea, nonBlankText } from "./primitives";
import { fxSystemDeclarativeV2Candidates } from "./legacyDeclarativeCandidate";

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
