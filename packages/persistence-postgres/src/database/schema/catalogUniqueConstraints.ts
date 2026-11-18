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
  CatalogTableId,
  CatalogUniqueConstraintDefinitionId,
  CatalogUniqueConstraintId,
} from "flarex-protocol/catalog";
import {
  MAX_CANONICAL_APP_UNIQUE_CONSTRAINT_SPEC_BYTES_V1,
  type AppUniqueConstraintPhysicalSpecCodecVersion,
  type AppUniqueConstraintPhysicalSpecV1,
} from "flarex-protocol/app-unique-constraint-definition";
import type {
  AppUniqueConstraintSetCodecVersionV1,
} from "flarex-protocol/internal/app-unique-constraint-set-v1";
import type { CatalogSchemaVersionId } from "flarex-protocol/schema-manifest";
import { bytea, nonBlankText } from "./primitives";
import { fxControlSchemaVersions, fxControlTables } from "./catalogIdentity";

/** Stable logical names; physical generations and version bindings are separate. */
export const fxControlUniqueConstraints = pgTable(
  "fx_control_unique_constraint",
  {
    deploymentId: text("deployment_id").notNull(),
    logicalUniqueConstraintId: integer("logical_unique_constraint_id")
      .$type<CatalogUniqueConstraintId>()
      .notNull(),
    tableId: integer("table_id").$type<CatalogTableId>().notNull(),
    descriptor: text("descriptor").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({
      name: "fx_control_unique_constraint_pk",
      columns: [table.deploymentId, table.logicalUniqueConstraintId],
    }),
    unique("fx_control_unique_constraint_table_descriptor_unique").on(
      table.deploymentId,
      table.tableId,
      table.descriptor,
    ),
    unique("fx_control_unique_constraint_logical_table_unique").on(
      table.deploymentId,
      table.logicalUniqueConstraintId,
      table.tableId,
    ),
    foreignKey({
      name: "fx_control_unique_constraint_table_fk",
      columns: [table.deploymentId, table.tableId],
      foreignColumns: [fxControlTables.deploymentId, fxControlTables.tableId],
    }).onDelete("restrict"),
    check(
      "fx_control_unique_constraint_deployment_non_empty_check",
      nonBlankText(table.deploymentId),
    ),
    check(
      "fx_control_unique_constraint_id_positive_check",
      sql`${table.logicalUniqueConstraintId} between 1 and 2147483647`,
    ),
    check(
      "fx_control_unique_constraint_table_id_positive_check",
      sql`${table.tableId} between 1 and 2147483647`,
    ),
    check(
      "fx_control_unique_constraint_descriptor_non_empty_check",
      nonBlankText(table.descriptor),
    ),
  ],
);

export const fxControlUniqueConstraintDefinitions = pgTable(
  "fx_control_unique_constraint_definition",
  {
    deploymentId: text("deployment_id").notNull(),
    uniqueConstraintDefinitionId: integer("unique_constraint_definition_id")
      .$type<CatalogUniqueConstraintDefinitionId>()
      .notNull(),
    logicalUniqueConstraintId: integer("logical_unique_constraint_id")
      .$type<CatalogUniqueConstraintId>()
      .notNull(),
    tableId: integer("table_id").$type<CatalogTableId>().notNull(),
    physicalSpecCodecVersion: integer("physical_spec_codec_version")
      .$type<AppUniqueConstraintPhysicalSpecCodecVersion>()
      .notNull(),
    physicalSpecJson: jsonb("physical_spec_json")
      .$type<AppUniqueConstraintPhysicalSpecV1>()
      .notNull(),
    physicalSpecBytes: bytea("physical_spec_bytes").notNull(),
    physicalSpecSha256: bytea("physical_spec_sha256").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({
      name: "fx_control_unique_constraint_definition_pk",
      columns: [table.deploymentId, table.uniqueConstraintDefinitionId],
    }),
    unique("fx_control_unique_constraint_definition_owner_spec_unique").on(
      table.deploymentId,
      table.logicalUniqueConstraintId,
      table.physicalSpecSha256,
    ),
    unique("fx_control_unique_constraint_definition_binding_owner_unique").on(
      table.deploymentId,
      table.uniqueConstraintDefinitionId,
      table.logicalUniqueConstraintId,
    ),
    foreignKey({
      name: "fx_control_unique_constraint_definition_logical_fk",
      columns: [
        table.deploymentId,
        table.logicalUniqueConstraintId,
        table.tableId,
      ],
      foreignColumns: [
        fxControlUniqueConstraints.deploymentId,
        fxControlUniqueConstraints.logicalUniqueConstraintId,
        fxControlUniqueConstraints.tableId,
      ],
    }).onDelete("restrict"),
    check(
      "fx_control_unique_constraint_definition_deployment_non_empty_check",
      nonBlankText(table.deploymentId),
    ),
    check(
      "fx_control_unique_constraint_definition_id_positive_check",
      sql`${table.uniqueConstraintDefinitionId} between 1 and 2147483647`,
    ),
    check(
      "fx_control_unique_constraint_definition_logical_id_positive_check",
      sql`${table.logicalUniqueConstraintId} between 1 and 2147483647`,
    ),
    check(
      "fx_control_unique_constraint_definition_table_id_positive_check",
      sql`${table.tableId} between 1 and 2147483647`,
    ),
    check(
      "fx_control_unique_constraint_definition_spec_codec_check",
      sql`${table.physicalSpecCodecVersion} = 1`,
    ),
    check(
      "fx_control_unique_constraint_definition_spec_json_check",
      sql`
        (
          jsonb_typeof(${table.physicalSpecJson}) = 'object'
          and octet_length(${table.physicalSpecJson}::text) between 1 and ${sql.raw(
            String(MAX_CANONICAL_APP_UNIQUE_CONSTRAINT_SPEC_BYTES_V1),
          )}
          and (${table.physicalSpecJson} - 'keyCodecIdentity'
            - 'keyCodecVersion' - 'kind' - 'localePolicy'
            - 'orderedFields' - 'sparse' - 'specVersion' - 'predicate' - 'nullsDistinct') = '{}'::jsonb
          and ${table.physicalSpecJson} ->> 'kind' = 'appUniqueConstraint'
          and ${table.physicalSpecJson} -> 'specVersion' = '1'::jsonb
          and ${table.physicalSpecJson} ->> 'keyCodecIdentity'
            = 'flarex.unique-key/ordered-index-components/v1'
          and ${table.physicalSpecJson} -> 'keyCodecVersion' = '1'::jsonb
          and ${table.physicalSpecJson} -> 'localePolicy'
            = '{"kind":"none"}'::jsonb
          and jsonb_typeof(${table.physicalSpecJson} -> 'orderedFields') = 'array'
          and jsonb_array_length(${table.physicalSpecJson} -> 'orderedFields')
            between 1 and 15
          and jsonb_typeof(${table.physicalSpecJson} -> 'sparse') = 'boolean'
          and (not (${table.physicalSpecJson} ? 'nullsDistinct')
            or ${table.physicalSpecJson} -> 'nullsDistinct' = 'true'::jsonb)
          and (not (${table.physicalSpecJson} ? 'predicate') or (
            jsonb_typeof(${table.physicalSpecJson} -> 'predicate') = 'object'
            and ((((${table.physicalSpecJson} -> 'predicate') - 'kind' - 'field') = '{}'::jsonb
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
            (((${table.physicalSpecJson} -> 'predicate') - 'kind' - 'nullField' - 'booleanField' - 'value') = '{}'::jsonb
              and ${table.physicalSpecJson} -> 'predicate' ->> 'kind' = 'fieldIsNullAndBooleanEquals'
              and jsonb_typeof(${table.physicalSpecJson} -> 'predicate' -> 'nullField') = 'string'
              and length(${table.physicalSpecJson} -> 'predicate' ->> 'nullField') > 0
              and jsonb_typeof(${table.physicalSpecJson} -> 'predicate' -> 'booleanField') = 'string'
              and length(${table.physicalSpecJson} -> 'predicate' ->> 'booleanField') > 0
              and ${table.physicalSpecJson} -> 'predicate' ->> 'nullField' <> ${table.physicalSpecJson} -> 'predicate' ->> 'booleanField'
              and jsonb_typeof(${table.physicalSpecJson} -> 'predicate' -> 'value') = 'boolean'))
          ))
        ) is true
      `,
    ),
    check(
      "fx_control_unique_constraint_definition_spec_bytes_length_check",
      sql`octet_length(${table.physicalSpecBytes}) between 1 and ${sql.raw(
        String(MAX_CANONICAL_APP_UNIQUE_CONSTRAINT_SPEC_BYTES_V1),
      )}`,
    ),
    check(
      "fx_control_unique_constraint_definition_spec_sha256_length_check",
      sql`octet_length(${table.physicalSpecSha256}) = 32`,
    ),
  ],
);

export const fxControlSchemaVersionUniqueConstraintBindings = pgTable(
  "fx_control_schema_version_unique_constraint_binding",
  {
    deploymentId: text("deployment_id").notNull(),
    schemaVersionId: text("schema_version_id")
      .$type<CatalogSchemaVersionId>()
      .notNull(),
    logicalUniqueConstraintId: integer("logical_unique_constraint_id")
      .$type<CatalogUniqueConstraintId>()
      .notNull(),
    uniqueConstraintDefinitionId: integer("unique_constraint_definition_id")
      .$type<CatalogUniqueConstraintDefinitionId>()
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
      name: "fx_control_schema_unique_constraint_binding_pk",
      columns: [
        table.deploymentId,
        table.schemaVersionId,
        table.logicalUniqueConstraintId,
      ],
    }),
    index(
      "fx_control_schema_unique_binding_definition_lookup_idx",
    ).on(
      table.deploymentId,
      table.uniqueConstraintDefinitionId,
      table.schemaVersionId,
    ),
    foreignKey({
      name: "fx_control_schema_unique_constraint_binding_schema_fk",
      columns: [table.deploymentId, table.schemaVersionId],
      foreignColumns: [
        fxControlSchemaVersions.deploymentId,
        fxControlSchemaVersions.schemaVersionId,
      ],
    }).onDelete("restrict"),
    foreignKey({
      name: "fx_control_schema_unique_constraint_binding_definition_fk",
      columns: [
        table.deploymentId,
        table.uniqueConstraintDefinitionId,
        table.logicalUniqueConstraintId,
      ],
      foreignColumns: [
        fxControlUniqueConstraintDefinitions.deploymentId,
        fxControlUniqueConstraintDefinitions.uniqueConstraintDefinitionId,
        fxControlUniqueConstraintDefinitions.logicalUniqueConstraintId,
      ],
    }).onDelete("restrict"),
    check(
      "fx_control_schema_unique_constraint_binding_deployment_non_empty_check",
      nonBlankText(table.deploymentId),
    ),
    check(
      "fx_control_schema_unique_constraint_binding_schema_non_empty_check",
      nonBlankText(table.schemaVersionId),
    ),
    check(
      "fx_control_schema_unique_constraint_binding_logical_id_positive_check",
      sql`${table.logicalUniqueConstraintId} between 1 and 2147483647`,
    ),
    check(
      "fx_control_schema_unique_constraint_binding_definition_id_positive_check",
      sql`${table.uniqueConstraintDefinitionId} between 1 and 2147483647`,
    ),
    check(
      "fx_control_schema_unique_constraint_binding_required_check",
      sql`${table.requiredForActivation} is true`,
    ),
  ],
);

/** Immutable closure of one schema version's complete unique definition set. */
export const fxControlSchemaVersionUniqueConstraintSets = pgTable(
  "fx_control_schema_unique_constraint_set",
  {
    deploymentId: text("deployment_id").notNull(),
    schemaVersionId: text("schema_version_id")
      .$type<CatalogSchemaVersionId>()
      .notNull(),
    setCodecVersion: integer("set_codec_version")
      .$type<AppUniqueConstraintSetCodecVersionV1>()
      .notNull(),
    definitionCount: integer("definition_count").notNull(),
    definitionSetSha256: bytea("definition_set_sha256").notNull(),
    closedAt: timestamp("closed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({
      name: "fx_control_schema_unique_set_pk",
      columns: [table.deploymentId, table.schemaVersionId],
    }),
    foreignKey({
      name: "fx_control_schema_unique_set_schema_fk",
      columns: [table.deploymentId, table.schemaVersionId],
      foreignColumns: [
        fxControlSchemaVersions.deploymentId,
        fxControlSchemaVersions.schemaVersionId,
      ],
    }).onDelete("restrict"),
    check(
      "fx_control_schema_unique_set_deployment_check",
      nonBlankText(table.deploymentId),
    ),
    check(
      "fx_control_schema_unique_set_schema_check",
      nonBlankText(table.schemaVersionId),
    ),
    check(
      "fx_control_schema_unique_set_codec_check",
      sql`${table.setCodecVersion} = 1`,
    ),
    check(
      "fx_control_schema_unique_set_count_check",
      sql`${table.definitionCount} between 0 and 256`,
    ),
    check(
      "fx_control_schema_unique_set_digest_check",
      sql`octet_length(${table.definitionSetSha256}) = 32`,
    ),
    check(
      "fx_control_schema_unique_set_closed_at_check",
      sql`isfinite(${table.closedAt})`,
    ),
  ],
);
