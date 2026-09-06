import { sql } from "drizzle-orm";
import { bigint, check, foreignKey, integer, pgTable, primaryKey, text, unique, uuid } from "drizzle-orm/pg-core";
import type { CommitSeq, ScopeEpochUuidV1, ScopeUuidV1 } from "flarex-protocol/storage-authority";
import type { CatalogTableId } from "flarex-protocol/catalog";
import { bytea, fxAppRowRevisions, fxSystemCommits } from "../schema";

/** Private codec v1: exact deletion identities retained with their scope commit. */
export const fxSystemCommitPayloadPreferenceDeletions = pgTable("fx_system_commit_payload_preference_deletion", {
  scopeUuid: uuid("scope_uuid").$type<ScopeUuidV1>().notNull(),
  epochUuid: uuid("epoch_uuid").$type<ScopeEpochUuidV1>().notNull(),
  commitSeq: bigint("commit_seq", { mode: "bigint" }).$type<CommitSeq>().notNull(),
  changeOrdinal: integer("change_ordinal").notNull(),
  codecVersion: integer("codec_version").notNull(),
  storageGeneration: text("storage_generation").notNull(),
  artifactSha256: text("artifact_sha256").notNull(),
  preferenceId: text("preference_id").notNull(),
  contentTableId: integer("content_table_id").$type<CatalogTableId>().notNull(),
  contentRowId: bytea("content_row_id").notNull(),
}, table => [
  primaryKey({ columns: [table.scopeUuid, table.commitSeq, table.changeOrdinal] }),
  unique("fx_commit_preference_deletion_identity_unique").on(table.scopeUuid, table.commitSeq, table.storageGeneration, table.artifactSha256, table.preferenceId),
  foreignKey({ name: "fx_commit_preference_deletion_header_fk", columns: [table.scopeUuid, table.epochUuid, table.commitSeq],
    foreignColumns: [fxSystemCommits.scopeUuid, fxSystemCommits.epochUuid, fxSystemCommits.commitSeq] }).onDelete("restrict").onUpdate("restrict"),
  foreignKey({ name: "fx_commit_preference_deletion_content_fk", columns: [table.scopeUuid, table.contentTableId, table.contentRowId, table.epochUuid, table.commitSeq],
    foreignColumns: [fxAppRowRevisions.scopeUuid, fxAppRowRevisions.tableId, fxAppRowRevisions.rowId, fxAppRowRevisions.writeEpochUuid, fxAppRowRevisions.commitSeq] }).onDelete("restrict").onUpdate("restrict"),
  check("fx_commit_preference_deletion_values_check", sql`${table.codecVersion} = 1 and ${table.changeOrdinal} between 0 and 255
    and ${table.storageGeneration} = 'flarexdb_v1' and ${table.artifactSha256} ~ '^[0-9a-f]{64}$'
    and octet_length(${table.preferenceId}) between 1 and 2048 and ${table.contentTableId} > 0 and octet_length(${table.contentRowId}) = 16`),
]);
