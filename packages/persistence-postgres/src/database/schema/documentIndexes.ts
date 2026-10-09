import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import type {
  CatalogIndexDefinitionId,
  CatalogIndexId,
  CatalogTableId,
} from "flarex-protocol/catalog";
import {
  MAX_ORDERED_INDEX_KEY_BYTES_V1,
  type OrderedIndexKeyCodecVersion,
} from "flarex-protocol/ordered-index";
import type { Json } from "flarex-protocol/json";
import type { CommitSeq, ScopeUuidV1 } from "flarex-protocol/storage-authority";
import {
  MAX_APP_UNIQUE_CONSTRAINT_ID_V1,
  MAX_APP_UNIQUE_LOCALE_KEY_BYTES_V1,
  type AppUniqueConstraintIdV1,
} from "../../storage/unique/appUniqueKeyContract";
import { bytea } from "./primitives";
import { fxAppRowRevisions, fxAppRowCurrent } from "./documents";

/** Current values of explicitly declared logical searchable text fields.
 * This is a derived, scope-confined access family, not an authoritative row
 * body. The revision link lets readers reject stale or corrupted entries. */
export const fxAppSearchEntryCurrent = pgTable(
  "fx_app_search_entry_current",
  {
    scopeUuid: uuid("scope_uuid").$type<ScopeUuidV1>().notNull(),
    tableId: integer("table_id").$type<CatalogTableId>().notNull(),
    logicalIndexId: integer("logical_index_id").$type<CatalogIndexId>().notNull(),
    sourceSha256: text("source_sha256").notNull(),
    fieldId: text("field_id").notNull(),
    rowId: bytea("row_id").notNull(),
    commitSeq: bigint("commit_seq", { mode: "bigint" }).$type<CommitSeq>().notNull(),
    foldedText: text("folded_text").notNull(),
  },
  (table) => [
    primaryKey({ name: "fx_app_search_entry_current_pk", columns: [
      table.scopeUuid, table.tableId, table.logicalIndexId, table.fieldId, table.rowId,
    ] }),
    index("fx_app_search_entry_current_row_idx").on(table.scopeUuid, table.tableId, table.rowId),
    index("fx_app_search_entry_current_lookup_gin").using("gin", table.scopeUuid,
      table.logicalIndexId, sql`${table.foldedText} gin_trgm_ops`),
    foreignKey({
      name: "fx_app_search_entry_current_revision_fk",
      columns: [table.scopeUuid, table.tableId, table.rowId, table.commitSeq],
      foreignColumns: [fxAppRowRevisions.scopeUuid, fxAppRowRevisions.tableId,
        fxAppRowRevisions.rowId, fxAppRowRevisions.commitSeq],
    }).onUpdate("restrict").onDelete("restrict"),
    check("fx_app_search_entry_current_table_id_check", sql`${table.tableId} between 1 and 2147483647`),
    check("fx_app_search_entry_current_index_id_check", sql`${table.logicalIndexId} between 1 and 2147483647`),
    check("fx_app_search_entry_current_source_check", sql`${table.sourceSha256} ~ '^[0-9a-f]{64}$'`),
    check("fx_app_search_entry_current_field_check", sql`length(${table.fieldId}) between 1 and 512`),
    check("fx_app_search_entry_current_row_id_check", sql`octet_length(${table.rowId}) = 16`),
    check("fx_app_search_entry_current_commit_seq_check", sql`${table.commitSeq} >= 1`),
    check("fx_app_search_entry_current_ascii_fold_check", sql`${table.foldedText} = translate(${table.foldedText},
      'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz')`),
  ],
);

/** Current values of explicitly declared JSON containment fields. One shared
 * physical GIN family serves all scopes and logical definitions. The revision
 * link is checked again by readers before a candidate is used. */
export const fxAppJsonEntryCurrent = pgTable(
  "fx_app_json_entry_current",
  {
    scopeUuid: uuid("scope_uuid").$type<ScopeUuidV1>().notNull(),
    tableId: integer("table_id").$type<CatalogTableId>().notNull(),
    logicalIndexId: integer("logical_index_id").$type<CatalogIndexId>().notNull(),
    sourceSha256: text("source_sha256").notNull(),
    fieldId: text("field_id").notNull(),
    rowId: bytea("row_id").notNull(),
    commitSeq: bigint("commit_seq", { mode: "bigint" }).$type<CommitSeq>().notNull(),
    valueJson: jsonb("value_json").$type<Json>().notNull(),
  },
  (table) => [
    primaryKey({ name: "fx_app_json_entry_current_pk", columns: [
      table.scopeUuid, table.tableId, table.logicalIndexId, table.fieldId, table.rowId,
    ] }),
    index("fx_app_json_entry_current_row_idx").on(table.scopeUuid, table.tableId, table.rowId),
    index("fx_app_json_entry_current_lookup_gin").using("gin", table.scopeUuid,
      table.logicalIndexId, sql`${table.valueJson} jsonb_path_ops`),
    foreignKey({ name: "fx_app_json_entry_current_revision_fk",
      columns: [table.scopeUuid, table.tableId, table.rowId, table.commitSeq],
      foreignColumns: [fxAppRowRevisions.scopeUuid, fxAppRowRevisions.tableId,
        fxAppRowRevisions.rowId, fxAppRowRevisions.commitSeq],
    }).onUpdate("restrict").onDelete("restrict"),
    check("fx_app_json_entry_current_table_id_check", sql`${table.tableId} between 1 and 2147483647`),
    check("fx_app_json_entry_current_index_id_check", sql`${table.logicalIndexId} between 1 and 2147483647`),
    check("fx_app_json_entry_current_source_check", sql`${table.sourceSha256} ~ '^[0-9a-f]{64}$'`),
    check("fx_app_json_entry_current_field_check", sql`length(${table.fieldId}) between 1 and 512`),
    check("fx_app_json_entry_current_row_id_check", sql`octet_length(${table.rowId}) = 16`),
    check("fx_app_json_entry_current_commit_seq_check", sql`${table.commitSeq} >= 1`),
  ],
);

/**
 * Immutable target-local history for one physical ordered-index position.
 *
 * Membership transitions reference the stable authoritative row identity.
 * Row bodies evolve independently; a tombstone removes only this encoded-key/row
 * position. The existing commit transaction derives changes from final bodies.
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
      name: "fx_app_index_entry_rev_row_identity_fk",
      columns: [table.scopeUuid, table.tableId, table.rowId],
      foreignColumns: [
        fxAppRowCurrent.scopeUuid,
        fxAppRowCurrent.tableId,
        fxAppRowCurrent.rowId,
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
  ],
);

/**
 * Epoch-independent live pointer for one ordered-index position.
 *
 * The row contains no duplicated value or lifecycle evidence. Tombstones
 * remove this range-facing pointer. Its sequence identifies the latest live
 * membership transition, independently of the current row body.
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
 * The foreign key protects stable current-row identity. The materializer derives
 * ownership from authenticated prior/final documents; unchanged keys do not
 * refresh the claim or pin a superseded document revision.
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
      name: "fx_app_unique_key_row_identity_fk",
      columns: [table.scopeUuid, table.tableId, table.rowId],
      foreignColumns: [fxAppRowCurrent.scopeUuid, fxAppRowCurrent.tableId, fxAppRowCurrent.rowId],
    }).onUpdate("restrict").onDelete("restrict"),
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

  ],
);
