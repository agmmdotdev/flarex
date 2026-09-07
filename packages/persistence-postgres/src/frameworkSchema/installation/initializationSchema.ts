import { sql } from "drizzle-orm";
import { bigint, check, foreignKey, integer, pgTable, primaryKey, text, uuid } from "drizzle-orm/pg-core";
import type { CommitSeq, ScopeUuidV1 } from "flarex-protocol/storage-authority";
import { fxSystemScopeClocks } from "../../schema";
/** Completion is checked against an admitted adapter-owned initialization contract. */
export const fxSystemFrameworkInitializations = pgTable("fx_system_framework_initialization", {
  scopeUuid: uuid("scope_uuid").$type<ScopeUuidV1>().notNull(),
  installationSha256: text("installation_sha256").notNull(),
  artifactSha256: text("artifact_sha256").notNull(),
  stepId: text("step_id").notNull(),
  contractSha256: text("contract_sha256").notNull(),
  datasetSha256: text("dataset_sha256").notNull(),
  rowCount: integer("row_count").notNull(),
  commitSeq: bigint("commit_seq", { mode: "bigint" }).$type<CommitSeq>().notNull(),
}, table => [
  primaryKey({ columns: [table.scopeUuid, table.installationSha256, table.stepId] }),
  foreignKey({ name: "fx_framework_initialization_scope_fk", columns: [table.scopeUuid], foreignColumns: [fxSystemScopeClocks.scopeUuid] }).onDelete("restrict").onUpdate("restrict"),
  check("fx_framework_initialization_values_check", sql`${table.installationSha256} ~ '^[0-9a-f]{64}$' and ${table.artifactSha256} ~ '^[0-9a-f]{64}$'
    and ${table.datasetSha256} ~ '^[0-9a-f]{64}$' and ${table.contractSha256} ~ '^[0-9a-f]{64}$'
    and octet_length(${table.stepId}) between 1 and 1024 and ${table.rowCount} >= 0 and ${table.commitSeq} > 0`),
]);
