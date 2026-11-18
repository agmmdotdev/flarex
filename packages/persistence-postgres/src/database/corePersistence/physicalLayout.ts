import { Effect, Schema } from "effect";
import { CorePersistenceError } from "../../core/contracts";
import type { CoreSqlConnection } from "./driver";
import { CORE_PHYSICAL_PREVIOUS_TABLES, CORE_PHYSICAL_TABLES } from "./layout.generated";

export const CorePersistenceNamespaceSchema = Schema.NonEmptyString.check(Schema.makeFilter(value =>
  /^[a-z][a-z0-9_]{0,62}$/.test(value) && value !== "public" && !value.startsWith("pg_") && value !== "information_schema"
    ? undefined : "Expected an explicitly owned core persistence namespace"));
export const decodeCorePersistenceNamespace = Schema.decodeUnknownEffect(CorePersistenceNamespaceSchema);

export function coreTableName(namespace: string, table: string): string {
  // Namespace is decoded before target issuance; tables are code-defined names.
  return `"${namespace}"."${table}"`;
}
export function invalidPhysicalLayout(cause?: unknown): CorePersistenceError {
  return new CorePersistenceError({ reason: "invalidTarget", ...(cause === undefined ? {} : { cause }) });
}

const Relations = Schema.Array(Schema.Struct({ table_name: Schema.String, kind: Schema.String,
  row_security: Schema.Boolean, force_row_security: Schema.Boolean }));
const Columns = Schema.Array(Schema.Struct({ table_name: Schema.String, column_name: Schema.String,
  type_name: Schema.String, not_null: Schema.Boolean, default_sql: Schema.NullOr(Schema.String), position: Schema.Int,
  identity_kind: Schema.String, generated_kind: Schema.String, default_collation: Schema.Boolean }));
const Indexes = Schema.Array(Schema.Struct({ table_name: Schema.String, index_name: Schema.String,
  primary_key: Schema.Boolean, unique_index: Schema.Boolean, method: Schema.String, valid: Schema.Boolean, ready: Schema.Boolean,
  predicate: Schema.NullOr(Schema.String), expressions: Schema.Boolean, columns: Schema.Array(Schema.String),
  total_attributes: Schema.Int, key_attributes: Schema.Int, options: Schema.Array(Schema.Int),
  default_opclasses: Schema.Array(Schema.Boolean), column_collations: Schema.Array(Schema.Boolean) }));
const Constraints = Schema.Array(Schema.Struct({ table_name: Schema.String, constraint_type: Schema.String }));
const Triggers = Schema.Array(Schema.Struct({ table_name: Schema.String, trigger_name: Schema.String }));

const same = (left: readonly string[], right: readonly string[]) => left.length === right.length
  && left.every((value, index) => value === right[index]);

/**
 * SELECT-only physical inspection. Primary constraint/index names are incidental:
 * c554 used PostgreSQL's default names, whereas Drizzle names composite keys.
 * Every other checked property affects the generated layout or write behavior.
 */
export const verifyCorePhysicalLayout = Effect.fn("CorePersistence.verifyPhysicalLayout")(function* (
  connection: CoreSqlConnection, namespace: string, generation: "current" | "baseline" | "adoptable" = "current",
) {
  const relations = yield* Schema.decodeUnknownEffect(Relations)(yield* connection.query(`SELECT c.relname AS table_name,
    c.relkind::text AS kind, c.relrowsecurity AS row_security, c.relforcerowsecurity AS force_row_security
    FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname=$1 AND c.relkind IN ('r','p','v','m','f','S') ORDER BY c.relname`, [namespace])).pipe(Effect.mapError(invalidPhysicalLayout));
  const expectedNames = CORE_PHYSICAL_TABLES.map(table => table.name).toSorted();
  if (!same(relations.map(table => table.table_name), expectedNames)
    || relations.some(table => table.kind !== "r" || table.row_security || table.force_row_security))
    return yield* invalidPhysicalLayout("Physical namespace must contain exactly the five ordinary core tables");

  const columns = yield* Schema.decodeUnknownEffect(Columns)(yield* connection.query(`SELECT c.relname AS table_name,
    a.attname AS column_name, pg_catalog.format_type(a.atttypid,a.atttypmod) AS type_name,
    a.attnotnull AS not_null, pg_catalog.pg_get_expr(d.adbin,d.adrelid) AS default_sql, a.attnum::integer AS position,
    a.attidentity::text AS identity_kind, a.attgenerated::text AS generated_kind,
    a.attcollation=t.typcollation AS default_collation
    FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid JOIN pg_catalog.pg_type t ON t.oid=a.atttypid
    LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum
    WHERE n.nspname=$1 AND c.relkind='r' AND a.attnum>0 AND NOT a.attisdropped
    ORDER BY c.relname,a.attnum`, [namespace])).pipe(Effect.mapError(invalidPhysicalLayout));
  const indexes = yield* Schema.decodeUnknownEffect(Indexes)(yield* connection.query(`SELECT tab.relname AS table_name,
    idx.relname AS index_name, i.indisprimary AS primary_key, i.indisunique AS unique_index,
    am.amname AS method, i.indisvalid AS valid, i.indisready AS ready,
    pg_catalog.pg_get_expr(i.indpred,i.indrelid) AS predicate, i.indexprs IS NOT NULL AS expressions,
    ARRAY(SELECT a.attname::text FROM unnest(i.indkey::smallint[]) WITH ORDINALITY k(attnum,position)
      JOIN pg_catalog.pg_attribute a ON a.attrelid=tab.oid AND a.attnum=k.attnum ORDER BY k.position) AS columns,
    i.indnatts::integer AS total_attributes, i.indnkeyatts::integer AS key_attributes,
    ARRAY(SELECT option::integer FROM unnest(i.indoption::smallint[]) option) AS options,
    ARRAY(SELECT opc.opcdefault FROM unnest(i.indclass::oid[]) WITH ORDINALITY op(class_id,position)
      JOIN pg_catalog.pg_opclass opc ON opc.oid=op.class_id ORDER BY op.position) AS default_opclasses,
    ARRAY(SELECT col.collation_id=a.attcollation FROM unnest(i.indcollation::oid[]) WITH ORDINALITY col(collation_id,position)
      JOIN unnest(i.indkey::smallint[]) WITH ORDINALITY k(attnum,position) ON k.position=col.position
      JOIN pg_catalog.pg_attribute a ON a.attrelid=tab.oid AND a.attnum=k.attnum ORDER BY col.position) AS column_collations
    FROM pg_catalog.pg_index i JOIN pg_catalog.pg_class tab ON tab.oid=i.indrelid
    JOIN pg_catalog.pg_namespace n ON n.oid=tab.relnamespace JOIN pg_catalog.pg_class idx ON idx.oid=i.indexrelid
    JOIN pg_catalog.pg_am am ON am.oid=idx.relam WHERE n.nspname=$1 ORDER BY tab.relname,idx.relname`, [namespace])).pipe(Effect.mapError(invalidPhysicalLayout));
  // The unmarked historical adoption input may have either exact supported
  // layout. All catalog properties below are still verified against that one
  // generated shape; a partial upgrade or redundant secondary fails closed.
  const baseline = generation === "baseline" || generation === "adoptable" && indexes.some(index =>
    index.table_name === "indexes" && index.index_name === "indexes_by_index_id_key_prefix_key_sha256");
  const expectedTables = baseline ? CORE_PHYSICAL_PREVIOUS_TABLES : CORE_PHYSICAL_TABLES;
  const constraints = yield* Schema.decodeUnknownEffect(Constraints)(yield* connection.query(`SELECT c.relname AS table_name,
    k.contype::text AS constraint_type FROM pg_catalog.pg_constraint k
    JOIN pg_catalog.pg_class c ON c.oid=k.conrelid JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname=$1 ORDER BY c.relname`, [namespace])).pipe(Effect.mapError(invalidPhysicalLayout));
  const triggers = yield* Schema.decodeUnknownEffect(Triggers)(yield* connection.query(`SELECT c.relname AS table_name,
    t.tgname AS trigger_name FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_class c ON c.oid=t.tgrelid
    JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 AND NOT t.tgisinternal`, [namespace]))
    .pipe(Effect.mapError(invalidPhysicalLayout));
  // PostgreSQL 18 exposes NOT NULL as contype 'n'; the column comparison already
  // checks that property. Earlier PostgreSQL versions omit these catalog rows.
  if (constraints.some(constraint => constraint.constraint_type !== "p" && constraint.constraint_type !== "n") || triggers.length !== 0)
    return yield* invalidPhysicalLayout("Unexpected physical constraints or triggers");

  for (const table of expectedTables) {
    const actualColumns = columns.filter(column => column.table_name === table.name);
    if (actualColumns.length !== table.columns.length) return yield* invalidPhysicalLayout(`Unexpected columns in ${table.name}`);
    for (let position = 0; position < table.columns.length; position += 1) {
      const expected = table.columns[position]; const actual = actualColumns[position];
      if (actual === undefined || expected === undefined || actual.column_name !== expected.name
        || actual.type_name !== expected.type || actual.not_null !== expected.notNull || actual.position !== position + 1
        || actual.default_sql !== (expected.default === null ? null : String(expected.default))
        || actual.identity_kind !== "" || actual.generated_kind !== "" || !actual.default_collation)
        return yield* invalidPhysicalLayout(`Physical column differs from Drizzle declaration in ${table.name}`);
    }
    const actualIndexes = indexes.filter(index => index.table_name === table.name);
    const primary = actualIndexes.filter(index => index.primary_key);
    const ordinary = actualIndexes.filter(index => !index.primary_key);
    if (primary.length !== 1 || primary[0] === undefined || !same(primary[0].columns, table.primaryKey)
      || !primary[0].unique_index || ordinary.length !== table.indexes.length)
      return yield* invalidPhysicalLayout(`Physical keys differ in ${table.name}`);
    for (const index of actualIndexes) if (!index.valid || !index.ready || index.method !== "btree"
      || index.predicate !== null || index.expressions || index.key_attributes !== index.columns.length
      || index.total_attributes !== index.key_attributes || index.options.some(option => option !== 0)
      || index.default_opclasses.length !== index.key_attributes || index.default_opclasses.some(value => !value)
      || index.column_collations.length !== index.key_attributes || index.column_collations.some(value => !value))
      return yield* invalidPhysicalLayout(`Unsupported physical index semantics in ${table.name}`);
    for (const expected of table.indexes) {
      const actual = ordinary.find(index => index.index_name === expected.name);
      if (actual === undefined || !same(actual.columns, expected.columns) || actual.unique_index !== expected.unique
        || actual.method !== expected.method) return yield* invalidPhysicalLayout(`Physical index differs in ${table.name}`);
    }
  }
  return baseline ? "baseline" as const : "current" as const;
});
