import { sql } from "drizzle-orm";
import { bigint, check, foreignKey, integer, pgTable, primaryKey, text, uuid } from "drizzle-orm/pg-core";
import type { CommitSeq, ScopeEpochUuidV1, ScopeUuidV1 } from "flarex-protocol/storage-authority";
import { bytea, fxSystemCommits } from "../schema";
/** Ordered admitted relational identities, distinct from Application document facts. */
export const fxSystemCommitRelationalChanges = pgTable("fx_system_commit_relational_change", {
  scopeUuid: uuid("scope_uuid").$type<ScopeUuidV1>().notNull(),
  epochUuid: uuid("epoch_uuid").$type<ScopeEpochUuidV1>().notNull(),
  commitSeq: bigint("commit_seq", { mode: "bigint" }).$type<CommitSeq>().notNull(),
  changeOrdinal: integer("change_ordinal").notNull(),
  codecVersion: integer("codec_version").notNull(),
  installationSha256: text("installation_sha256").notNull(),
  artifactSha256: text("artifact_sha256").notNull(),
  tableId: text("table_id").notNull(),
  keyBytes: bytea("key_bytes").notNull(),
  operation: text("operation").$type<"insert" | "update" | "delete">().notNull(),
}, table => [
  primaryKey({ columns: [table.scopeUuid, table.commitSeq, table.changeOrdinal] }),
  foreignKey({ name: "fx_commit_relational_header_fk", columns: [table.scopeUuid, table.epochUuid, table.commitSeq],
    foreignColumns: [fxSystemCommits.scopeUuid, fxSystemCommits.epochUuid, fxSystemCommits.commitSeq] }).onDelete("restrict").onUpdate("restrict"),
  check("fx_commit_relational_values_check", sql`${table.codecVersion} = 1 and ${table.changeOrdinal} between 0 and 15999
    and ${table.installationSha256} ~ '^[0-9a-f]{64}$' and ${table.artifactSha256} ~ '^[0-9a-f]{64}$'
    and octet_length(${table.tableId}) between 1 and 1024 and octet_length(${table.keyBytes}) between 1 and 4096
    and ${table.operation} in ('insert', 'update', 'delete')`),
]);
