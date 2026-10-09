import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  unique,
} from "drizzle-orm/pg-core";
import type { CatalogTableId } from "flarex-protocol/catalog";
import type {
  CatalogSchemaVersion,
  CatalogSchemaVersionId,
  SchemaManifestSha256,
} from "flarex-protocol/schema-manifest";
import { bytea } from "./primitives";
import { fxControlSchemaVersions, fxControlTables } from "./catalogIdentity";

/** Trusted catalog publication derives these immutable, independently decoded
 * read projections. Runtime credentials have SELECT authority only. */
export const fxControlLogicalReadSources = pgTable("fx_control_logical_read_source", {
  deploymentId: text("deployment_id").notNull(),
  schemaVersionId: text("schema_version_id").$type<CatalogSchemaVersionId>().notNull(),
  sourceKey: text("source_key").notNull(),
  sourceSha256: text("source_sha256").notNull(),
  artifactVersion: integer("artifact_version").$type<CatalogSchemaVersion>().notNull(),
  manifestSha256: bytea("manifest_sha256").$type<SchemaManifestSha256>().notNull(),
  projectionJson: jsonb("projection_json").$type<unknown>().notNull(),
  projectionSha256: text("projection_sha256").notNull(),
}, table => [
  primaryKey({ columns: [table.deploymentId, table.schemaVersionId, table.sourceKey] }),
  unique("fx_control_logical_read_source_identity").on(table.deploymentId, table.schemaVersionId, table.sourceKey, table.sourceSha256),
  foreignKey({ name: "fx_control_logical_read_source_artifact_fk",
    columns: [table.deploymentId, table.schemaVersionId, table.artifactVersion, table.manifestSha256],
    foreignColumns: [fxControlSchemaVersions.deploymentId, fxControlSchemaVersions.schemaVersionId, fxControlSchemaVersions.version, fxControlSchemaVersions.manifestSha256] }),
  check("fx_control_logical_read_source_digest", sql`${table.sourceSha256} ~ '^[a-f0-9]{64}$' and ${table.projectionSha256} ~ '^[a-f0-9]{64}$'`),
]);

export const fxControlLogicalReadTables = pgTable("fx_control_logical_read_table", {
  deploymentId: text("deployment_id").notNull(),
  schemaVersionId: text("schema_version_id").$type<CatalogSchemaVersionId>().notNull(),
  sourceKey: text("source_key").notNull(),
  sourceSha256: text("source_sha256").notNull(),
  localName: text("local_name").notNull(),
  tableId: integer("table_id").$type<CatalogTableId>().notNull(),
  projectionJson: jsonb("projection_json").$type<unknown>().notNull(),
  projectionSha256: text("projection_sha256").notNull(),
}, table => [
  primaryKey({ columns: [table.deploymentId, table.schemaVersionId, table.sourceKey, table.localName] }),
  index("fx_control_logical_read_table_identity").on(table.deploymentId, table.schemaVersionId, table.sourceKey, table.tableId),
  foreignKey({ name: "fx_control_logical_read_table_source_fk",
    columns: [table.deploymentId, table.schemaVersionId, table.sourceKey, table.sourceSha256],
    foreignColumns: [fxControlLogicalReadSources.deploymentId, fxControlLogicalReadSources.schemaVersionId, fxControlLogicalReadSources.sourceKey, fxControlLogicalReadSources.sourceSha256] }),
  foreignKey({ name: "fx_control_logical_read_table_identity_fk", columns: [table.deploymentId, table.tableId],
    foreignColumns: [fxControlTables.deploymentId, fxControlTables.tableId] }),
  check("fx_control_logical_read_table_digest", sql`${table.projectionSha256} ~ '^[a-f0-9]{64}$'`),
]);

export const fxControlLogicalReadAccess = pgTable("fx_control_logical_read_access", {
  deploymentId: text("deployment_id").notNull(),
  schemaVersionId: text("schema_version_id").$type<CatalogSchemaVersionId>().notNull(),
  sourceKey: text("source_key").notNull(),
  localName: text("local_name").notNull(),
  selectorKind: text("selector_kind").notNull(),
  selectorKey: text("selector_key").notNull(),
  leadingField: text("leading_field").notNull(),
  prefixLength: integer("prefix_length").notNull(),
  ordinal: integer("ordinal").notNull(),
  projectionJson: jsonb("projection_json").$type<unknown>().notNull(),
  projectionSha256: text("projection_sha256").notNull(),
}, table => [
  primaryKey({ columns: [table.deploymentId, table.schemaVersionId, table.sourceKey, table.localName, table.selectorKind, table.selectorKey] }),
    index("fx_control_logical_read_access_search").using("gin", sql`${table.deploymentId} public.text_ops`,
      sql`${table.schemaVersionId} public.text_ops`, sql`${table.sourceKey} public.text_ops`, sql`${table.localName} public.text_ops`,
      sql`(${table.projectionJson}->'fields') jsonb_path_ops`).where(sql`${table.selectorKind} = 'search'`),
  foreignKey({ name: "fx_control_logical_read_access_table_fk", columns: [table.deploymentId, table.schemaVersionId, table.sourceKey, table.localName],
    foreignColumns: [fxControlLogicalReadTables.deploymentId, fxControlLogicalReadTables.schemaVersionId, fxControlLogicalReadTables.sourceKey, fxControlLogicalReadTables.localName] }),
  check("fx_control_logical_read_access_digest", sql`${table.projectionSha256} ~ '^[a-f0-9]{64}$'`),
]);
