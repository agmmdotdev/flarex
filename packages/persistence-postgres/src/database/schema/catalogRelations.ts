import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import type {
  CatalogEdgeDefinitionId,
  CatalogRelationId,
  CatalogTableId,
} from "flarex-protocol/catalog";
import {
  MAX_PHYSICAL_EDGE_DEFINITION_CANONICAL_BYTES_V1,
  type PhysicalEdgeDefinitionV1,
} from "flarex-protocol/internal/application-schema-binding";
import type { CatalogSchemaVersionId } from "flarex-protocol/schema-manifest";
import { bytea, nonBlankText } from "./primitives";
import { fxControlSchemaVersions, fxControlTables } from "./catalogIdentity";

/** Stable deployment-scoped logical relation identities. */
export const fxControlRelations = pgTable(
  "fx_control_relation",
  {
    deploymentId: text("deployment_id").notNull(),
    relationId: integer("relation_id").$type<CatalogRelationId>().notNull(),
    createdBySchemaVersionId: text("created_by_schema_version_id")
      .$type<CatalogSchemaVersionId>()
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({
      name: "fx_control_relation_pk",
      columns: [table.deploymentId, table.relationId],
    }),
    foreignKey({
      name: "fx_control_relation_schema_fk",
      columns: [table.deploymentId, table.createdBySchemaVersionId],
      foreignColumns: [
        fxControlSchemaVersions.deploymentId,
        fxControlSchemaVersions.schemaVersionId,
      ],
    }).onDelete("restrict"),
    check(
      "fx_control_relation_identity_check",
      sql`${nonBlankText(table.deploymentId)}
        and ${table.relationId} between 1 and 2147483647
        and ${nonBlankText(table.createdBySchemaVersionId)}`,
    ),
    check("fx_control_relation_time_check", sql`isfinite(${table.createdAt})`),
  ],
);

/** Immutable physical extraction, occurrence, access, and snapshot meaning. */
export const fxControlEdgeDefinitions = pgTable(
  "fx_control_edge_definition",
  {
    deploymentId: text("deployment_id").notNull(),
    edgeDefinitionId: integer("edge_definition_id")
      .$type<CatalogEdgeDefinitionId>()
      .notNull(),
    relationId: integer("relation_id").$type<CatalogRelationId>().notNull(),
    createdBySchemaVersionId: text("created_by_schema_version_id")
      .$type<CatalogSchemaVersionId>()
      .notNull(),
    physicalDefinitionCodecVersion: integer(
      "physical_definition_codec_version",
    ).$type<1>().notNull(),
    physicalDefinitionJson: jsonb("physical_definition_json")
      .$type<PhysicalEdgeDefinitionV1>()
      .notNull(),
    physicalDefinitionBytes: bytea("physical_definition_bytes").notNull(),
    physicalDefinitionSha256: bytea("physical_definition_sha256").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({
      name: "fx_control_edge_definition_pk",
      columns: [table.deploymentId, table.edgeDefinitionId],
    }),
    unique("fx_control_edge_definition_relation_unique").on(
      table.deploymentId,
      table.edgeDefinitionId,
      table.relationId,
    ),
    foreignKey({
      name: "fx_control_edge_definition_relation_fk",
      columns: [table.deploymentId, table.relationId],
      foreignColumns: [
        fxControlRelations.deploymentId,
        fxControlRelations.relationId,
      ],
    }).onDelete("restrict"),
    foreignKey({
      name: "fx_control_edge_definition_schema_fk",
      columns: [table.deploymentId, table.createdBySchemaVersionId],
      foreignColumns: [
        fxControlSchemaVersions.deploymentId,
        fxControlSchemaVersions.schemaVersionId,
      ],
    }).onDelete("restrict"),
    check(
      "fx_control_edge_definition_identity_check",
      sql`${nonBlankText(table.deploymentId)}
        and ${table.edgeDefinitionId} between 1 and 2147483647
        and ${table.relationId} between 1 and 2147483647
        and ${nonBlankText(table.createdBySchemaVersionId)}
        and ${table.physicalDefinitionCodecVersion} = 1`,
    ),
    check(
      "fx_control_edge_definition_json_check",
      sql`(
          jsonb_typeof(${table.physicalDefinitionJson}) = 'object'
          and ${table.physicalDefinitionJson} ->> 'format'
            = 'flarex.physical-edge-definition'
          and ${table.physicalDefinitionJson} -> 'version' = '1'::jsonb
        ) is true`,
    ),
    check(
      "fx_control_edge_definition_bytes_check",
      sql`octet_length(${table.physicalDefinitionBytes}) between 1 and ${sql.raw(
        String(MAX_PHYSICAL_EDGE_DEFINITION_CANONICAL_BYTES_V1),
      )}
        and octet_length(${table.physicalDefinitionSha256}) = 32`,
    ),
    check(
      "fx_control_edge_definition_time_check",
      sql`isfinite(${table.createdAt})`,
    ),
  ],
);

/** Exact stable/semantic/physical relation meaning selected by one schema. */
export const fxControlSchemaVersionRelationBindings = pgTable(
  "fx_control_schema_relation_binding",
  {
    deploymentId: text("deployment_id").notNull(),
    schemaVersionId: text("schema_version_id")
      .$type<CatalogSchemaVersionId>()
      .notNull(),
    relationOrdinal: integer("relation_ordinal").notNull(),
    relationId: integer("relation_id").$type<CatalogRelationId>().notNull(),
    sourceTableId: integer("source_table_id")
      .$type<CatalogTableId>()
      .notNull(),
    targetTableId: integer("target_table_id")
      .$type<CatalogTableId>()
      .notNull(),
    semanticDefinitionSha256: bytea("semantic_definition_sha256").notNull(),
    edgeDefinitionId: integer("edge_definition_id")
      .$type<CatalogEdgeDefinitionId>()
      .notNull(),
    evolutionKind: text("evolution_kind")
      .$type<"new" | "preserve">()
      .notNull(),
    originSchemaVersionId: text("origin_schema_version_id")
      .$type<CatalogSchemaVersionId>(),
    originRelationOrdinal: integer("origin_relation_ordinal"),
    physicalEvolution: text("physical_evolution")
      .$type<"new" | "reuse" | "replace">()
      .notNull(),
    requiredForActivation: boolean("required_for_activation")
      .$type<true>()
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({
      name: "fx_control_schema_relation_binding_pk",
      columns: [
        table.deploymentId,
        table.schemaVersionId,
        table.relationOrdinal,
      ],
    }),
    unique("fx_control_schema_relation_binding_relation_unique").on(
      table.deploymentId,
      table.schemaVersionId,
      table.relationId,
    ),
    index("fx_control_schema_relation_binding_definition_idx").on(
      table.deploymentId,
      table.edgeDefinitionId,
      table.schemaVersionId,
    ),
    foreignKey({
      name: "fx_control_schema_relation_binding_schema_fk",
      columns: [table.deploymentId, table.schemaVersionId],
      foreignColumns: [
        fxControlSchemaVersions.deploymentId,
        fxControlSchemaVersions.schemaVersionId,
      ],
    }).onDelete("restrict"),
    foreignKey({
      name: "fx_control_schema_relation_binding_relation_fk",
      columns: [table.deploymentId, table.relationId],
      foreignColumns: [
        fxControlRelations.deploymentId,
        fxControlRelations.relationId,
      ],
    }).onDelete("restrict"),
    foreignKey({
      name: "fx_control_schema_relation_binding_edge_fk",
      columns: [
        table.deploymentId,
        table.edgeDefinitionId,
        table.relationId,
      ],
      foreignColumns: [
        fxControlEdgeDefinitions.deploymentId,
        fxControlEdgeDefinitions.edgeDefinitionId,
        fxControlEdgeDefinitions.relationId,
      ],
    }).onDelete("restrict"),
    foreignKey({
      name: "fx_control_schema_relation_binding_source_table_fk",
      columns: [table.deploymentId, table.sourceTableId],
      foreignColumns: [fxControlTables.deploymentId, fxControlTables.tableId],
    }).onDelete("restrict"),
    foreignKey({
      name: "fx_control_schema_relation_binding_target_table_fk",
      columns: [table.deploymentId, table.targetTableId],
      foreignColumns: [fxControlTables.deploymentId, fxControlTables.tableId],
    }).onDelete("restrict"),
    foreignKey({
      name: "fx_control_schema_relation_binding_origin_fk",
      columns: [
        table.deploymentId,
        table.originSchemaVersionId,
        table.originRelationOrdinal,
      ],
      foreignColumns: [
        table.deploymentId,
        table.schemaVersionId,
        table.relationOrdinal,
      ],
    }).onDelete("restrict"),
    check(
      "fx_control_schema_relation_binding_identity_check",
      sql`${nonBlankText(table.deploymentId)}
        and ${nonBlankText(table.schemaVersionId)}
        and ${table.relationOrdinal} between 1 and 1024
        and ${table.relationId} between 1 and 2147483647
        and ${table.sourceTableId} between 1 and 2147483647
        and ${table.targetTableId} between 1 and 2147483647
        and octet_length(${table.semanticDefinitionSha256}) = 32
        and ${table.edgeDefinitionId} between 1 and 2147483647
        and ${table.requiredForActivation} is true`,
    ),
    check(
      "fx_control_schema_relation_binding_evolution_check",
      sql`((
          ${table.evolutionKind} = 'new'
          and ${table.originSchemaVersionId} is null
          and ${table.originRelationOrdinal} is null
          and ${table.physicalEvolution} = 'new'
        ) or (
          ${table.evolutionKind} = 'preserve'
          and ${table.originSchemaVersionId} is not null
          and ${nonBlankText(table.originSchemaVersionId)}
          and ${table.originSchemaVersionId} <> ${table.schemaVersionId}
          and ${table.originRelationOrdinal} is not null
          and ${table.originRelationOrdinal} between 1 and 1024
          and ${table.physicalEvolution} in ('reuse', 'replace')
        )) is true`,
    ),
    check(
      "fx_control_schema_relation_binding_time_check",
      sql`isfinite(${table.createdAt})`,
    ),
  ],
);
