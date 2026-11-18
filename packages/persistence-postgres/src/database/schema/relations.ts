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
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type {
  CatalogEdgeDefinitionId,
  CatalogRelationId,
  CatalogTableId,
} from "flarex-protocol/catalog";
import { MAX_RELATION_MANY_ITEMS_V1 } from "flarex-protocol/internal/relation-declaration-v1";
import {
  MAX_RELATION_OCCURRENCE_CANONICAL_BYTES_V1,
  RELATION_OCCURRENCE_DUPLICATE_ORDINAL_V1,
  RELATION_OCCURRENCE_SHA256_BYTES_V1,
  RELATION_OCCURRENCE_VERSION_V1,
} from "flarex-protocol/internal/relation-occurrence-v1";
import type { CatalogSchemaVersionId } from "flarex-protocol/schema-manifest";
import type { CommitSeq, ScopeEpochUuidV1, ScopeUuidV1 } from "flarex-protocol/storage-authority";
import { bytea, nonBlankText } from "./primitives";
import { fxSystemScopeClocks } from "./scope";

/**
 * Current pointer-only relation occurrences for the admitted native profile.
 * The stable edge-definition ID owns physical meaning; retained occurrence
 * bytes are collision evidence, not a second definition authority.
 */
export const fxAppEdgeCurrent = pgTable(
  "fx_app_edge_current",
  {
    scopeUuid: uuid("scope_uuid").$type<ScopeUuidV1>().notNull(),
    relationId: integer("relation_id").$type<CatalogRelationId>().notNull(),
    edgeDefinitionId: integer("edge_definition_id")
      .$type<CatalogEdgeDefinitionId>()
      .notNull(),
    sourceTableId: integer("source_table_id")
      .$type<CatalogTableId>()
      .notNull(),
    sourceRowId: bytea("source_row_id").notNull(),
    targetTableId: integer("target_table_id")
      .$type<CatalogTableId>()
      .notNull(),
    targetRowId: bytea("target_row_id").notNull(),
    duplicateOrdinal: integer("duplicate_ordinal").notNull(),
    occurrenceCodecVersion: integer("occurrence_codec_version").notNull(),
    occurrenceBytes: bytea("occurrence_bytes").notNull(),
    occurrenceSha256: bytea("occurrence_sha256").notNull(),
    locale: text("locale"),
    position: integer("position"),
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
      name: "fx_app_edge_current_pk",
      columns: [
        table.scopeUuid,
        table.edgeDefinitionId,
        table.sourceRowId,
        table.targetRowId,
        table.duplicateOrdinal,
      ],
    }),
    uniqueIndex("fx_app_edge_current_occurrence_digest_unique").on(
      table.scopeUuid,
      table.edgeDefinitionId,
      table.occurrenceSha256,
    ),
    index("fx_app_edge_current_incoming_idx").on(
      table.scopeUuid,
      table.edgeDefinitionId,
      table.targetRowId,
      table.sourceRowId,
      // Drizzle 0.45 has no INCLUDE builder. Keep the exact production index
      // as one stable SQL expression so migration snapshots do not model the
      // projection columns as ordering keys.
      sql.raw(
        '"duplicate_ordinal") INCLUDE ("position", "commit_seq"',
      ),
    ),
    foreignKey({
      name: "fx_app_edge_current_scope_clock_fk",
      columns: [table.scopeUuid],
      foreignColumns: [fxSystemScopeClocks.scopeUuid],
    })
      .onUpdate("restrict")
      .onDelete("restrict"),
    check(
      "fx_app_edge_current_catalog_ids_check",
      sql`${table.relationId} between 1 and 2147483647
        and ${table.edgeDefinitionId} between 1 and 2147483647
        and ${table.sourceTableId} between 1 and 2147483647
        and ${table.targetTableId} between 1 and 2147483647`,
    ),
    check(
      "fx_app_edge_current_row_ids_check",
      sql`octet_length(${table.sourceRowId}) = 16
        and octet_length(${table.targetRowId}) = 16`,
    ),
    check(
      "fx_app_edge_current_occurrence_check",
      sql`${table.duplicateOrdinal} = ${sql.raw(
        String(RELATION_OCCURRENCE_DUPLICATE_ORDINAL_V1),
      )}
        and ${table.occurrenceCodecVersion} = ${sql.raw(
          String(RELATION_OCCURRENCE_VERSION_V1),
        )}
        and octet_length(${table.occurrenceBytes}) between 1 and ${sql.raw(
          String(MAX_RELATION_OCCURRENCE_CANONICAL_BYTES_V1),
        )}
        and octet_length(${table.occurrenceSha256}) = ${sql.raw(
          String(RELATION_OCCURRENCE_SHA256_BYTES_V1),
        )}`,
    ),
    check("fx_app_edge_current_locale_check", sql`${table.locale} is null`),
    check(
      "fx_app_edge_current_position_check",
      sql`${table.position} is null or ${table.position} between 0 and ${sql.raw(
        String(MAX_RELATION_MANY_ITEMS_V1 - 1),
      )}`,
    ),
    check(
      "fx_app_edge_current_schema_version_id_check",
      nonBlankText(table.schemaVersionId),
    ),
    check(
      "fx_app_edge_current_commit_seq_check",
      sql`${table.commitSeq} >= 1`,
    ),
  ],
);

/** Current-edge exact-snapshot authority for one endpoint and direction. */
export const fxAppEdgeAdjacencyVersions = pgTable(
  "fx_app_edge_adjacency_version",
  {
    scopeUuid: uuid("scope_uuid").$type<ScopeUuidV1>().notNull(),
    edgeDefinitionId: integer("edge_definition_id")
      .$type<CatalogEdgeDefinitionId>()
      .notNull(),
    direction: text("direction")
      .$type<"incoming" | "outgoing">()
      .notNull(),
    endpointRowId: bytea("endpoint_row_id").notNull(),
    lastChangedCommitSeq: bigint("last_changed_commit_seq", { mode: "bigint" })
      .$type<CommitSeq>()
      .notNull(),
  },
  (table) => [
    primaryKey({
      name: "fx_app_edge_adjacency_version_pk",
      columns: [
        table.scopeUuid,
        table.edgeDefinitionId,
        table.direction,
        table.endpointRowId,
      ],
    }),
    foreignKey({
      name: "fx_app_edge_adjacency_version_scope_clock_fk",
      columns: [table.scopeUuid],
      foreignColumns: [fxSystemScopeClocks.scopeUuid],
    })
      .onUpdate("restrict")
      .onDelete("restrict"),
    check(
      "fx_app_edge_adjacency_version_definition_id_check",
      sql`${table.edgeDefinitionId} between 1 and 2147483647`,
    ),
    check(
      "fx_app_edge_adjacency_version_direction_check",
      sql`${table.direction} in ('incoming', 'outgoing')`,
    ),
    check(
      "fx_app_edge_adjacency_version_endpoint_row_id_check",
      sql`octet_length(${table.endpointRowId}) = 16`,
    ),
    check(
      "fx_app_edge_adjacency_version_commit_seq_check",
      sql`${table.lastChangedCommitSeq} >= 1`,
    ),
  ],
);
