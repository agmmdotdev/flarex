import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  doublePrecision,
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { AppCreationTimeV1 } from "flarex-protocol/app-document";
import type { CatalogTableId } from "flarex-protocol/catalog";
import type { CatalogSchemaVersionId } from "flarex-protocol/schema-manifest";
import type { CommitSeq, ScopeEpochUuidV1, ScopeUuidV1 } from "flarex-protocol/storage-authority";
import type {
  CanonicalFlarexValueBytesV1,
  FlarexValueCodecVersion,
  FlarexValueSha256V1,
} from "flarex-protocol/value";
import { bytea, nonBlankText } from "./primitives";
import { fxSystemScopeClocks } from "./scope";

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
    valueBytes: bytea("value_bytes").$type<CanonicalFlarexValueBytesV1>(),
    valueSha256: bytea("value_sha256").$type<FlarexValueSha256V1>(),
    /** Exact physical insertion generation; null retains unknown pre-extension evidence. */
    insertionCommitSeq: bigint("insertion_commit_seq", { mode: "bigint" }).$type<CommitSeq>(),
    insertionAttemptOrdinal: bigint("insertion_attempt_ordinal", { mode: "number" }),
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
    uniqueIndex("fx_app_row_rev_insertion_birth_unique").on(
      table.scopeUuid, table.insertionCommitSeq, table.insertionAttemptOrdinal,
    ).where(sql`${table.insertionCommitSeq} = ${table.commitSeq}`),
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
      "fx_app_row_rev_insertion_generation_check",
      sql`(${table.insertionCommitSeq} is null and ${table.insertionAttemptOrdinal} is null) or
        (${table.insertionCommitSeq} is not null and ${table.insertionAttemptOrdinal} is not null
          and ${table.insertionCommitSeq} >= 1 and ${table.insertionCommitSeq} <= ${table.commitSeq}
          and ${table.insertionAttemptOrdinal} between 0 and 9007199254740991)`,
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
          and ${table.valueBytes} is null
          and ${table.valueSha256} is null
        )
        or
        (
          not ${table.isTombstone}
          and ${table.valueBytes} is not null
          and octet_length(${table.valueBytes}) > 0
          and ${table.valueSha256} is not null
          and octet_length(${table.valueSha256}) = 32
        )
      `,
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
    index("fx_app_row_current_table_frontier_idx").on(
      table.scopeUuid, table.tableId, table.commitSeq,
    ),
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
