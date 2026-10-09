import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  foreignKey,
  integer,
  pgTable,
  primaryKey,
  text,
  uuid,
} from "drizzle-orm/pg-core";
import type { CommitSeq, ScopeUuidV1 } from "flarex-protocol/storage-authority";
import { fxSystemScopeClocks } from "../../database/schema/scope";

/** A logical source's first-data contract is durable across outcome retention.
 * The stable source key prevents a changed schema from silently reseeding rows. */
export const fxSystemLogicalSourceInitializations = pgTable("fx_system_logical_source_initialization", {
  scopeUuid: uuid("scope_uuid").$type<ScopeUuidV1>().notNull(),
  sourceKey: text("source_key").notNull(),
  sourceSha256: text("source_sha256").notNull(),
  stepId: text("step_id").notNull(),
  contractSha256: text("contract_sha256").notNull(),
  datasetSha256: text("dataset_sha256").notNull(),
  rowCount: integer("row_count").notNull(),
  commitSeq: bigint("commit_seq", { mode: "bigint" }).$type<CommitSeq>().notNull(),
}, table => [
  primaryKey({ columns: [table.scopeUuid, table.sourceKey, table.stepId] }),
  foreignKey({ name: "fx_logical_source_initialization_scope_fk", columns: [table.scopeUuid],
    foreignColumns: [fxSystemScopeClocks.scopeUuid] }).onDelete("restrict").onUpdate("restrict"),
  check("fx_logical_source_initialization_values_check", sql`octet_length(${table.sourceKey}) between 1 and 128
    and octet_length(${table.stepId}) between 1 and 1024
    and ${table.sourceSha256} ~ '^[0-9a-f]{64}$'
    and ${table.contractSha256} ~ '^[0-9a-f]{64}$'
    and ${table.datasetSha256} ~ '^[0-9a-f]{64}$'
    and ${table.rowCount} >= 0 and ${table.commitSeq} > 0`),
]);
