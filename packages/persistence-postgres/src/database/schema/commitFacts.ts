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
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import type { CatalogEdgeDefinitionId, CatalogTableId } from "flarex-protocol/catalog";
import type { CommitSeq, ScopeEpochUuidV1, ScopeUuidV1 } from "flarex-protocol/storage-authority";
import {
  MAX_APPLICATION_RELATION_ADJACENCY_CHANGES,
} from "../../application/relations/commit/Model";
import { bytea } from "./primitives";
import { fxSystemCommits } from "./commitHeaders";
import { fxAppRowRevisions } from "./documents";

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
    index("fx_system_commit_app_row_change_table_commit_idx").on(
      table.scopeUuid, table.tableId, table.commitSeq,
    ),
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

/**
 * R03 typed adjacency endpoints changed by one authoritative scope commit.
 * The child is retained with its header and is not a second commit stream.
 */
export const fxSystemCommitRelationAdjacencyChanges = pgTable(
  "fx_system_commit_relation_adjacency_change",
  {
    scopeUuid: uuid("scope_uuid").$type<ScopeUuidV1>().notNull(),
    epochUuid: uuid("epoch_uuid").$type<ScopeEpochUuidV1>().notNull(),
    commitSeq: bigint("commit_seq", { mode: "bigint" })
      .$type<CommitSeq>()
      .notNull(),
    changeOrdinal: integer("change_ordinal").notNull(),
    edgeDefinitionId: integer("edge_definition_id")
      .$type<CatalogEdgeDefinitionId>()
      .notNull(),
    direction: text("direction")
      .$type<"incoming" | "outgoing">()
      .notNull(),
    endpointRowId: bytea("endpoint_row_id").notNull(),
  },
  (table) => [
    primaryKey({
      name: "fx_system_commit_relation_adjacency_pk",
      columns: [table.scopeUuid, table.commitSeq, table.changeOrdinal],
    }),
    unique("fx_system_commit_relation_adjacency_endpoint_unique").on(
      table.scopeUuid,
      table.commitSeq,
      table.edgeDefinitionId,
      table.direction,
      table.endpointRowId,
    ),
    foreignKey({
      name: "fx_system_commit_relation_adjacency_header_fk",
      columns: [table.scopeUuid, table.epochUuid, table.commitSeq],
      foreignColumns: [
        fxSystemCommits.scopeUuid,
        fxSystemCommits.epochUuid,
        fxSystemCommits.commitSeq,
      ],
    })
      .onUpdate("restrict")
      .onDelete("restrict"),
    check(
      "fx_system_commit_relation_adjacency_ordinal_check",
      sql`${table.changeOrdinal} between 0 and ${sql.raw(
        String(MAX_APPLICATION_RELATION_ADJACENCY_CHANGES - 1),
      )}`,
    ),
    check(
      "fx_system_commit_relation_adjacency_edge_id_check",
      sql`${table.edgeDefinitionId} between 1 and 2147483647`,
    ),
    check(
      "fx_system_commit_relation_adjacency_direction_check",
      sql`${table.direction} in ('incoming', 'outgoing')`,
    ),
    check(
      "fx_system_commit_relation_adjacency_row_id_length_check",
      sql`octet_length(${table.endpointRowId}) = 16`,
    ),
  ],
);
