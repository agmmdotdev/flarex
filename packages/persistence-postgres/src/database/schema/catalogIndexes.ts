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
  CatalogIndexDefinitionId,
  CatalogIndexId,
  CatalogTableId,
} from "flarex-protocol/catalog";
import {
  MAX_CANONICAL_APP_INDEX_PHYSICAL_SPEC_BYTES_V1,
  type AppIndexPhysicalSpecCodecVersion,
  type AppPhysicalIndexAccessKindV1,
} from "flarex-protocol/index-definition";
import type { AppOrderedIndexPhysicalSpecV1 } from "flarex-protocol/ordered-index";
import type { CatalogSchemaVersionId } from "flarex-protocol/schema-manifest";
import { bytea, nonBlankText } from "./primitives";
import { fxControlSchemaVersions, fxControlTables } from "./catalogIdentity";

export const fxControlIndexes = pgTable(
  "fx_control_index",
  {
    deploymentId: text("deployment_id").notNull(),
    logicalIndexId: integer("logical_index_id")
      .$type<CatalogIndexId>()
      .notNull(),
    tableId: integer("table_id").$type<CatalogTableId>().notNull(),
    descriptor: text("descriptor").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.deploymentId, table.logicalIndexId] }),
    unique("fx_control_index_deployment_table_descriptor_unique").on(
      table.deploymentId,
      table.tableId,
      table.descriptor,
    ),
    unique("fx_control_index_deployment_logical_table_unique").on(
      table.deploymentId,
      table.logicalIndexId,
      table.tableId,
    ),
    foreignKey({
      name: "fx_control_index_deployment_table_fk",
      columns: [table.deploymentId, table.tableId],
      foreignColumns: [fxControlTables.deploymentId, fxControlTables.tableId],
    }).onDelete("restrict"),
    check(
      "fx_control_index_deployment_id_non_empty_check",
      nonBlankText(table.deploymentId),
    ),
    check(
      "fx_control_index_logical_index_id_positive_check",
      sql`${table.logicalIndexId} between 1 and 2147483647`,
    ),
    check(
      "fx_control_index_table_id_positive_check",
      sql`${table.tableId} between 1 and 2147483647`,
    ),
    check(
      "fx_control_index_descriptor_non_empty_check",
      nonBlankText(table.descriptor),
    ),
  ],
);

export const fxControlIndexDefinitions = pgTable(
  "fx_control_index_definition",
  {
    deploymentId: text("deployment_id").notNull(),
    indexDefinitionId: integer("index_definition_id")
      .$type<CatalogIndexDefinitionId>()
      .notNull(),
    accessKind: text("access_kind")
      .$type<AppPhysicalIndexAccessKindV1>()
      .notNull(),
    accessIdentityId: integer("access_identity_id")
      .$type<CatalogIndexId | CatalogTableId>()
      .notNull(),
    tableId: integer("table_id").$type<CatalogTableId>().notNull(),
    logicalIndexId: integer("logical_index_id").$type<CatalogIndexId>(),
    physicalSpecCodecVersion: integer("physical_spec_codec_version")
      .$type<AppIndexPhysicalSpecCodecVersion>()
      .notNull(),
    physicalSpecJson: jsonb("physical_spec_json")
      .$type<AppOrderedIndexPhysicalSpecV1>()
      .notNull(),
    physicalSpecBytes: bytea("physical_spec_bytes").notNull(),
    physicalSpecSha256: bytea("physical_spec_sha256").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({
      name: "fx_control_index_definition_pk",
      columns: [table.deploymentId, table.indexDefinitionId],
    }),
    unique("fx_control_index_definition_owner_spec_unique").on(
      table.deploymentId,
      table.accessKind,
      table.accessIdentityId,
      table.physicalSpecSha256,
    ),
    unique("fx_control_index_definition_binding_owner_unique").on(
      table.deploymentId,
      table.indexDefinitionId,
      table.logicalIndexId,
    ),
    foreignKey({
      name: "fx_control_index_definition_table_fk",
      columns: [table.deploymentId, table.tableId],
      foreignColumns: [fxControlTables.deploymentId, fxControlTables.tableId],
    }).onDelete("restrict"),
    foreignKey({
      name: "fx_control_index_definition_logical_fk",
      columns: [table.deploymentId, table.logicalIndexId, table.tableId],
      foreignColumns: [
        fxControlIndexes.deploymentId,
        fxControlIndexes.logicalIndexId,
        fxControlIndexes.tableId,
      ],
    }).onDelete("restrict"),
    check(
      "fx_control_index_definition_deployment_non_empty_check",
      nonBlankText(table.deploymentId),
    ),
    check(
      "fx_control_index_definition_id_positive_check",
      sql`${table.indexDefinitionId} between 1 and 2147483647`,
    ),
    check(
      "fx_control_index_definition_access_identity_positive_check",
      sql`${table.accessIdentityId} between 1 and 2147483647`,
    ),
    check(
      "fx_control_index_definition_table_id_positive_check",
      sql`${table.tableId} between 1 and 2147483647`,
    ),
    check(
      "fx_control_index_definition_logical_id_positive_check",
      sql`${table.logicalIndexId} is null or ${table.logicalIndexId} between 1 and 2147483647`,
    ),
    check(
      "fx_control_index_definition_owner_check",
      sql`
        (
          ${table.accessKind} = 'developer'
          and ${table.logicalIndexId} is not null
          and ${table.accessIdentityId} = ${table.logicalIndexId}
        )
        or
        (
          ${table.accessKind} = 'by_creation_time'
          and ${table.logicalIndexId} is null
          and ${table.accessIdentityId} = ${table.tableId}
        )
      `,
    ),
    check(
      "fx_control_index_definition_spec_codec_check",
      sql`${table.physicalSpecCodecVersion} = 1`,
    ),
    check(
      "fx_control_index_definition_spec_json_check",
      sql`
        (
          jsonb_typeof(${table.physicalSpecJson}) = 'object'
          and octet_length(${table.physicalSpecJson}::text) between 1 and ${sql.raw(
            String(MAX_CANONICAL_APP_INDEX_PHYSICAL_SPEC_BYTES_V1),
          )}
          and (${table.physicalSpecJson} - 'accessPath' - 'collation'
            - 'keyCodecVersion' - 'kind' - 'maxEncodedKeyBytes'
            - 'orderedFields' - 'specVersion' - 'tieBreaker' - 'predicate') = '{}'::jsonb
          and ${table.physicalSpecJson} ->> 'kind' = 'appOrdered'
          and ${table.physicalSpecJson} -> 'specVersion' = '1'::jsonb
          and ${table.physicalSpecJson} ->> 'accessPath' = ${table.accessKind}
          and ${table.physicalSpecJson} -> 'keyCodecVersion' = '1'::jsonb
          and ${table.physicalSpecJson} ->> 'collation' = 'binaryUtf8'
          and ${table.physicalSpecJson} -> 'maxEncodedKeyBytes' = '2048'::jsonb
          and jsonb_typeof(${table.physicalSpecJson} -> 'orderedFields') = 'array'
          and ${table.physicalSpecJson} -> 'tieBreaker'
            = '{"byteLength":16,"kind":"separateRowIdentity"}'::jsonb
          and (not (${table.physicalSpecJson} ? 'predicate') or (
            ${table.accessKind} = 'developer'
            and jsonb_typeof(${table.physicalSpecJson} -> 'predicate') = 'object'
            and (
              (((${table.physicalSpecJson} -> 'predicate') - 'kind' - 'field') = '{}'::jsonb
                and ${table.physicalSpecJson} -> 'predicate' ->> 'kind' = 'fieldIsNull'
                and jsonb_typeof(${table.physicalSpecJson} -> 'predicate' -> 'field') = 'string'
                and length(${table.physicalSpecJson} -> 'predicate' ->> 'field') > 0)
              or
              (((${table.physicalSpecJson} -> 'predicate') - 'kind' - 'fields') = '{}'::jsonb
                and ${table.physicalSpecJson} -> 'predicate' ->> 'kind' = 'fieldsAreNull'
                and jsonb_typeof(${table.physicalSpecJson} -> 'predicate' -> 'fields') = 'array'
                and case when jsonb_typeof(${table.physicalSpecJson} -> 'predicate' -> 'fields') = 'array'
                  then jsonb_array_length(${table.physicalSpecJson} -> 'predicate' -> 'fields') = 2 else false end
                and jsonb_typeof(${table.physicalSpecJson} -> 'predicate' -> 'fields' -> 0) = 'string'
                and jsonb_typeof(${table.physicalSpecJson} -> 'predicate' -> 'fields' -> 1) = 'string'
                and length(${table.physicalSpecJson} -> 'predicate' -> 'fields' ->> 0) > 0
                and length(${table.physicalSpecJson} -> 'predicate' -> 'fields' ->> 1) > 0
                and ${table.physicalSpecJson} -> 'predicate' -> 'fields' ->> 0 <> ${table.physicalSpecJson} -> 'predicate' -> 'fields' ->> 1)
              or
              (((${table.physicalSpecJson} -> 'predicate') - 'kind' - 'nullField' - 'textField' - 'value') = '{}'::jsonb
                and ${table.physicalSpecJson} -> 'predicate' ->> 'kind' = 'fieldIsNullAndTextEquals'
                and jsonb_typeof(${table.physicalSpecJson} -> 'predicate' -> 'nullField') = 'string'
                and length(${table.physicalSpecJson} -> 'predicate' ->> 'nullField') > 0
                and jsonb_typeof(${table.physicalSpecJson} -> 'predicate' -> 'textField') = 'string'
                and length(${table.physicalSpecJson} -> 'predicate' ->> 'textField') > 0
                and jsonb_typeof(${table.physicalSpecJson} -> 'predicate' -> 'value') = 'string'
                and length(${table.physicalSpecJson} -> 'predicate' ->> 'value') between 1 and 256)
              or
              (((${table.physicalSpecJson} -> 'predicate') - 'kind' - 'nullField' - 'booleanField' - 'value') = '{}'::jsonb
                and ${table.physicalSpecJson} -> 'predicate' ->> 'kind' = 'fieldIsNullAndBooleanEquals'
                and jsonb_typeof(${table.physicalSpecJson} -> 'predicate' -> 'nullField') = 'string'
                and length(${table.physicalSpecJson} -> 'predicate' ->> 'nullField') > 0
                and jsonb_typeof(${table.physicalSpecJson} -> 'predicate' -> 'booleanField') = 'string'
                and length(${table.physicalSpecJson} -> 'predicate' ->> 'booleanField') > 0
                and ${table.physicalSpecJson} -> 'predicate' ->> 'nullField' <> ${table.physicalSpecJson} -> 'predicate' ->> 'booleanField'
                and jsonb_typeof(${table.physicalSpecJson} -> 'predicate' -> 'value') = 'boolean')
            )
          ))
        ) is true
      `,
    ),
    check(
      "fx_control_index_definition_spec_bytes_length_check",
      sql`octet_length(${table.physicalSpecBytes}) between 1 and ${sql.raw(
        String(MAX_CANONICAL_APP_INDEX_PHYSICAL_SPEC_BYTES_V1),
      )}`,
    ),
    check(
      "fx_control_index_definition_spec_sha256_length_check",
      sql`octet_length(${table.physicalSpecSha256}) = 32`,
    ),
  ],
);

export const fxControlSchemaVersionIndexBindings = pgTable(
  "fx_control_schema_version_index_binding",
  {
    deploymentId: text("deployment_id").notNull(),
    schemaVersionId: text("schema_version_id")
      .$type<CatalogSchemaVersionId>()
      .notNull(),
    logicalIndexId: integer("logical_index_id")
      .$type<CatalogIndexId>()
      .notNull(),
    indexDefinitionId: integer("index_definition_id")
      .$type<CatalogIndexDefinitionId>()
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
      name: "fx_control_schema_index_binding_pk",
      columns: [
        table.deploymentId,
        table.schemaVersionId,
        table.logicalIndexId,
      ],
    }),
    index("fx_control_schema_index_binding_definition_lookup_idx").on(
      table.deploymentId,
      table.indexDefinitionId,
      table.schemaVersionId,
    ),
    foreignKey({
      name: "fx_control_schema_index_binding_schema_fk",
      columns: [table.deploymentId, table.schemaVersionId],
      foreignColumns: [
        fxControlSchemaVersions.deploymentId,
        fxControlSchemaVersions.schemaVersionId,
      ],
    }).onDelete("restrict"),
    foreignKey({
      name: "fx_control_schema_index_binding_definition_fk",
      columns: [
        table.deploymentId,
        table.indexDefinitionId,
        table.logicalIndexId,
      ],
      foreignColumns: [
        fxControlIndexDefinitions.deploymentId,
        fxControlIndexDefinitions.indexDefinitionId,
        fxControlIndexDefinitions.logicalIndexId,
      ],
    }).onDelete("restrict"),
    check(
      "fx_control_schema_index_binding_deployment_non_empty_check",
      nonBlankText(table.deploymentId),
    ),
    check(
      "fx_control_schema_index_binding_schema_non_empty_check",
      nonBlankText(table.schemaVersionId),
    ),
    check(
      "fx_control_schema_index_binding_logical_id_positive_check",
      sql`${table.logicalIndexId} between 1 and 2147483647`,
    ),
    check(
      "fx_control_schema_index_binding_definition_id_positive_check",
      sql`${table.indexDefinitionId} between 1 and 2147483647`,
    ),
    check(
      "fx_control_schema_index_binding_required_check",
      sql`${table.requiredForActivation} is true`,
    ),
  ],
);
