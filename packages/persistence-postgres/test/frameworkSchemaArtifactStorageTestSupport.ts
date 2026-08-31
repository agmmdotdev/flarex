import { expect } from "vitest";

import type { FlarexSqlClient } from "../src";

export const ARTIFACT_TABLE = "fx_control_framework_schema_artifact";
export const DEPENDENCY_TABLE =
  "fx_control_framework_schema_artifact_dependency";
export const IDENTITY_SEQUENCE = "fx_framework_artifact_storage_id_seq";

type SqlPersistence = Pick<FlarexSqlClient, "query">;

export async function expectFrameworkArtifactStorageCatalog(
  persistence: SqlPersistence,
  expectedSchema: string,
): Promise<void> {
  const columns = await persistence.query<{
    table_name: string;
    column_name: string;
    data_type: string;
    udt_name: string;
    is_nullable: string;
    column_default: string | null;
  }>(`
    select table_name, column_name, data_type, udt_name, is_nullable,
      column_default
    from information_schema.columns
    where table_schema = current_schema()
      and table_name in ('${ARTIFACT_TABLE}', '${DEPENDENCY_TABLE}')
    order by table_name, ordinal_position
  `);
  expect(columns.rows).toEqual([
    column(ARTIFACT_TABLE, "artifact_storage_id", "bigint", "int8"),
    column(ARTIFACT_TABLE, "deployment_id", "text", "text"),
    column(ARTIFACT_TABLE, "owner", "text", "text"),
    column(ARTIFACT_TABLE, "lineage_id", "text", "text"),
    column(ARTIFACT_TABLE, "artifact_sha256", "bytea", "bytea"),
    column(ARTIFACT_TABLE, "frame_format", "text", "text"),
    column(ARTIFACT_TABLE, "frame_version", "integer", "int4"),
    column(
      ARTIFACT_TABLE,
      "canonical_byte_length",
      "integer",
      "int4",
    ),
    column(ARTIFACT_TABLE, "canonical_bytes", "bytea", "bytea"),
    column(
      ARTIFACT_TABLE,
      "admitted_at",
      "timestamp with time zone",
      "timestamptz",
      "now()",
    ),
    column(DEPENDENCY_TABLE, "artifact_storage_id", "bigint", "int8"),
    column(DEPENDENCY_TABLE, "dependency_storage_id", "bigint", "int8"),
    column(DEPENDENCY_TABLE, "deployment_id", "text", "text"),
    column(DEPENDENCY_TABLE, "owner", "text", "text"),
    column(DEPENDENCY_TABLE, "artifact_lineage_id", "text", "text"),
    column(DEPENDENCY_TABLE, "dependency_ordinal", "integer", "int4"),
    column(DEPENDENCY_TABLE, "dependency_lineage_id", "text", "text"),
  ]);

  const identity = await persistence.query<{
    is_identity: string;
    identity_generation: string;
    identity_start: string;
    identity_increment: string;
    identity_cycle: string;
    sequence_name: string | null;
  }>(`
    select is_identity, identity_generation, identity_start,
      identity_increment, identity_cycle,
      pg_get_serial_sequence('${ARTIFACT_TABLE}', 'artifact_storage_id')
        as sequence_name
    from information_schema.columns
    where table_schema = current_schema()
      and table_name = '${ARTIFACT_TABLE}'
      and column_name = 'artifact_storage_id'
  `);
  expect(identity.rows).toEqual([{
    is_identity: "YES",
    identity_generation: "ALWAYS",
    identity_start: "1",
    identity_increment: "1",
    identity_cycle: "NO",
    sequence_name: `${expectedSchema}.${IDENTITY_SEQUENCE}`,
  }]);

  const sequence = await persistence.query<{
    sequence_name: string;
    start_value: string;
    minimum_value: string;
    maximum_value: string;
    increment: string;
    cache_size: string;
    cycles: boolean;
    dependency_type: string;
    owned_table: string;
    owned_column: string;
  }>(`
    select sequence.relname as sequence_name,
      parameters.seqstart::text as start_value,
      parameters.seqmin::text as minimum_value,
      parameters.seqmax::text as maximum_value,
      parameters.seqincrement::text as increment,
      parameters.seqcache::text as cache_size,
      parameters.seqcycle as cycles,
      dependency.deptype as dependency_type,
      owned_table.relname as owned_table,
      owned_column.attname as owned_column
    from pg_class as sequence
    join pg_namespace as namespace
      on namespace.oid = sequence.relnamespace
    join pg_sequence as parameters on parameters.seqrelid = sequence.oid
    join pg_depend as dependency
      on dependency.classid = 'pg_class'::regclass
      and dependency.objid = sequence.oid
      and dependency.deptype = 'i'
    join pg_class as owned_table on owned_table.oid = dependency.refobjid
    join pg_attribute as owned_column
      on owned_column.attrelid = dependency.refobjid
      and owned_column.attnum = dependency.refobjsubid
    where namespace.nspname = current_schema()
      and sequence.relname = '${IDENTITY_SEQUENCE}'
  `);
  expect(sequence.rows).toEqual([{
    sequence_name: IDENTITY_SEQUENCE,
    start_value: "1",
    minimum_value: "1",
    maximum_value: "9223372036854775807",
    increment: "1",
    cache_size: "1",
    cycles: false,
    dependency_type: "i",
    owned_table: ARTIFACT_TABLE,
    owned_column: "artifact_storage_id",
  }]);

  const collations = await persistence.query<{
    table_name: string;
    column_name: string;
    collation_name: string;
  }>(`
    select table_name, column_name, collation_name
    from information_schema.columns
    where table_schema = current_schema()
      and (
        (table_name = '${ARTIFACT_TABLE}'
          and column_name in ('owner', 'lineage_id', 'frame_format'))
        or (table_name = '${DEPENDENCY_TABLE}'
          and column_name in (
            'owner', 'artifact_lineage_id', 'dependency_lineage_id'
          ))
      )
    order by table_name, column_name
  `);
  expect(collations.rows).toEqual([
    {
      table_name: ARTIFACT_TABLE,
      column_name: "frame_format",
      collation_name: "C",
    },
    {
      table_name: ARTIFACT_TABLE,
      column_name: "lineage_id",
      collation_name: "C",
    },
    {
      table_name: ARTIFACT_TABLE,
      column_name: "owner",
      collation_name: "C",
    },
    {
      table_name: DEPENDENCY_TABLE,
      column_name: "artifact_lineage_id",
      collation_name: "C",
    },
    {
      table_name: DEPENDENCY_TABLE,
      column_name: "dependency_lineage_id",
      collation_name: "C",
    },
    {
      table_name: DEPENDENCY_TABLE,
      column_name: "owner",
      collation_name: "C",
    },
  ]);

  const constraints = await persistence.query<{
    constraint_name: string;
    constraint_type: string;
    deferrable: boolean;
    deferred: boolean;
    definition: string;
    source_columns: string | null;
  }>(`
    select conname as constraint_name, contype as constraint_type,
      condeferrable as deferrable, condeferred as deferred,
      pg_get_constraintdef(oid) as definition,
      (select string_agg(source_column.attname, ',' order by key.ordinality)
         from unnest(constraint_row.conkey)
           with ordinality as key(attnum, ordinality)
         join pg_attribute as source_column
           on source_column.attrelid = constraint_row.conrelid
          and source_column.attnum = key.attnum) as source_columns
    from pg_constraint as constraint_row
    where conrelid in (
      '${ARTIFACT_TABLE}'::regclass,
      '${DEPENDENCY_TABLE}'::regclass
    )
      -- PostgreSQL 18 also catalogs NOT NULL here; columns prove it above.
      and constraint_row.contype <> 'n'
    order by conname
  `);
  expect(constraints.rows.map(row => row.constraint_name)).toEqual([
    "fx_framework_artifact_dependency_identity_check",
    "fx_framework_artifact_dependency_parent_fk",
    "fx_framework_artifact_dependency_pk",
    "fx_framework_artifact_dependency_target_fk",
    "fx_framework_artifact_dependency_target_unique",
    "fx_framework_artifact_deployment_fk",
    "fx_framework_artifact_frame_check",
    "fx_framework_artifact_identity_check",
    "fx_framework_artifact_identity_unique",
    "fx_framework_artifact_owner_check",
    "fx_framework_artifact_storage_identity_unique",
    "fx_framework_artifact_storage_pk",
    "fx_framework_artifact_time_check",
  ]);
  expect(constraints.rows.filter(constraint =>
    constraint.constraint_type === "p" || constraint.constraint_type === "u"
  ).map(constraint => ({
    constraintName: constraint.constraint_name,
    sourceColumns: constraint.source_columns,
  }))).toEqual([
    {
      constraintName: "fx_framework_artifact_dependency_pk",
      sourceColumns: "artifact_storage_id,dependency_ordinal",
    },
    {
      constraintName: "fx_framework_artifact_dependency_target_unique",
      sourceColumns: "artifact_storage_id,dependency_storage_id",
    },
    {
      constraintName: "fx_framework_artifact_identity_unique",
      sourceColumns: "deployment_id,owner,lineage_id,artifact_sha256",
    },
    {
      constraintName: "fx_framework_artifact_storage_identity_unique",
      sourceColumns: "artifact_storage_id,deployment_id,owner,lineage_id",
    },
    {
      constraintName: "fx_framework_artifact_storage_pk",
      sourceColumns: "artifact_storage_id",
    },
  ]);
  const foreignKeys = constraints.rows.filter(
    constraint => constraint.constraint_type === "f",
  );
  expect(foreignKeys).toHaveLength(3);
  for (const foreignKey of foreignKeys) {
    expect(foreignKey.deferrable).toBe(false);
    expect(foreignKey.deferred).toBe(false);
    expect(foreignKey.definition).toContain("ON DELETE RESTRICT");
  }

  const foreignKeyColumns = await persistence.query<{
    constraint_name: string;
    delete_action: string;
    target_schema: string;
    target_table: string;
    source_columns: string;
    target_columns: string;
  }>(`
    select constraint_row.conname as constraint_name,
      constraint_row.confdeltype as delete_action,
      target_namespace.nspname as target_schema,
      target_table.relname as target_table,
      (select string_agg(source_column.attname, ',' order by key.ordinality)
        from unnest(constraint_row.conkey) with ordinality as key(attnum, ordinality)
        join pg_attribute as source_column
          on source_column.attrelid = constraint_row.conrelid
          and source_column.attnum = key.attnum) as source_columns,
      (select string_agg(target_column.attname, ',' order by key.ordinality)
        from unnest(constraint_row.confkey) with ordinality as key(attnum, ordinality)
        join pg_attribute as target_column
          on target_column.attrelid = constraint_row.confrelid
          and target_column.attnum = key.attnum) as target_columns
    from pg_constraint as constraint_row
    join pg_class as source_table
      on source_table.oid = constraint_row.conrelid
    join pg_namespace as source_namespace
      on source_namespace.oid = source_table.relnamespace
    join pg_class as target_table
      on target_table.oid = constraint_row.confrelid
    join pg_namespace as target_namespace
      on target_namespace.oid = target_table.relnamespace
    where source_namespace.nspname = current_schema()
      and source_table.relname in ('${ARTIFACT_TABLE}', '${DEPENDENCY_TABLE}')
      and constraint_row.conname in (
      'fx_framework_artifact_deployment_fk',
      'fx_framework_artifact_dependency_parent_fk',
      'fx_framework_artifact_dependency_target_fk'
    )
    order by constraint_row.conname
  `);
  expect(foreignKeyColumns.rows).toEqual([
    {
      constraint_name: "fx_framework_artifact_dependency_parent_fk",
      delete_action: "r",
      target_schema: expectedSchema,
      target_table: ARTIFACT_TABLE,
      source_columns:
        "artifact_storage_id,deployment_id,owner,artifact_lineage_id",
      target_columns: "artifact_storage_id,deployment_id,owner,lineage_id",
    },
    {
      constraint_name: "fx_framework_artifact_dependency_target_fk",
      delete_action: "r",
      target_schema: expectedSchema,
      target_table: ARTIFACT_TABLE,
      source_columns:
        "dependency_storage_id,deployment_id,owner,dependency_lineage_id",
      target_columns: "artifact_storage_id,deployment_id,owner,lineage_id",
    },
    {
      constraint_name: "fx_framework_artifact_deployment_fk",
      delete_action: "r",
      target_schema: expectedSchema,
      target_table: "deployments",
      source_columns: "deployment_id",
      target_columns: "deployment_id",
    },
  ]);

  const indexes = await persistence.query<{
    indexname: string;
    indexdef: string;
  }>(`
    select indexname, indexdef
    from pg_indexes
    where schemaname = current_schema()
      and tablename in ('${ARTIFACT_TABLE}', '${DEPENDENCY_TABLE}')
    order by indexname
  `);
  expect(indexes.rows.map(indexRow => indexRow.indexname)).toEqual([
    "fx_framework_artifact_dependency_pk",
    "fx_framework_artifact_dependency_reverse_idx",
    "fx_framework_artifact_dependency_target_unique",
    "fx_framework_artifact_identity_unique",
    "fx_framework_artifact_storage_identity_unique",
    "fx_framework_artifact_storage_pk",
  ]);
  expect(indexes.rows.find(indexRow =>
    indexRow.indexname === "fx_framework_artifact_dependency_reverse_idx"
  )?.indexdef).toContain(
    "(dependency_storage_id, artifact_storage_id)",
  );
}

function column(
  tableName: string,
  columnName: string,
  dataType: string,
  udtName: string,
  columnDefault: string | null = null,
) {
  return {
    table_name: tableName,
    column_name: columnName,
    data_type: dataType,
    udt_name: udtName,
    is_nullable: "NO",
    column_default: columnDefault,
  };
}
